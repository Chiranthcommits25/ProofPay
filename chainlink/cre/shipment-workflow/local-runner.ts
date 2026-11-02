#!/usr/bin/env bun
/**
 * Local CRE execution bridge: runs the real CRE workflow simulation, relays the
 * exact report bytes it emits to ProofPayCREReceiver.processReport, and verifies
 * the receipt. It never fetches shipment data and never decides settlement.
 *
 * This is NOT Chainlink DON execution: no DON signs or submits these reports.
 * No private key is used — the Hardhat node's unlocked admin account signs via
 * eth_sendTransaction — and LOCAL_BRIDGE_DRY_RUN defaults to true.
 *
 * Replay safety is per order, not per configuration: the order must exist and be
 * Funded, the bytes must decode to that order and an accepted outcome, and
 * orderSettled / processedReports / the local state file must all be clear.
 *
 *   bun local-runner.ts                              dry run (default)
 *   LOCAL_BRIDGE_DRY_RUN=false bun local-runner.ts    submit
 */

import { spawn } from "node:child_process";
import { open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type Address,
  type Hex,
  createPublicClient,
  createWalletClient,
  decodeAbiParameters,
  decodeErrorResult,
  encodeFunctionData,
  encodePacked,
  formatEther,
  formatUnits,
  getAddress,
  http,
  keccak256,
  parseAbiParameters,
} from "viem";

// ---------------------------------------------------------------------------
// Paths and constants
// ---------------------------------------------------------------------------

const HERE = fileURLToPath(new URL(".", import.meta.url));
const CRE_PROJECT_DIR = resolve(HERE, "..");
const DEFAULT_STATE_FILE = resolve(CRE_PROJECT_DIR, ".local-bridge-state.json");
const LOCK_FILE = resolve(CRE_PROJECT_DIR, ".local-bridge.lock");

/** Must match REPORT_LOG_PREFIX in main.ts. */
const REPORT_LOG_PREFIX = "PROOFPAY_REPORT_V1:";

const SETTLEMENT_REPORT_ABI = parseAbiParameters("bytes32, string, bytes32, string");

const ESCROW_STATUS_LABELS: Record<number, string> = {
  0: "None",
  1: "Funded",
  2: "Released",
  3: "Refunded",
};

const SUPPORTED_OUTCOMES = ["DELIVERED", "LOST"];

// ---------------------------------------------------------------------------
// ABIs
// ---------------------------------------------------------------------------

const RECEIVER_ABI = [
  {
    type: "function",
    name: "manualOracle",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "orderSettled",
    stateMutability: "view",
    inputs: [{ name: "orderId", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "processedReports",
    stateMutability: "view",
    inputs: [{ name: "reportId", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "processReport",
    stateMutability: "nonpayable",
    inputs: [
      { name: "metadata", type: "bytes" },
      { name: "report", type: "bytes" },
    ],
    outputs: [],
  },
  // Custom errors, used only to explain reverts in logs.
  { type: "error", name: "UnauthorizedCaller", inputs: [{ name: "caller", type: "address" }] },
  { type: "error", name: "ReportAlreadyProcessed", inputs: [{ name: "reportId", type: "bytes32" }] },
  { type: "error", name: "OrderAlreadySettled", inputs: [{ name: "orderId", type: "bytes32" }] },
  { type: "error", name: "EscrowNotFunded", inputs: [{ name: "orderId", type: "bytes32" }] },
  { type: "error", name: "EscrowNotFound", inputs: [{ name: "orderId", type: "bytes32" }] },
  { type: "error", name: "UnsupportedOutcome", inputs: [{ name: "outcome", type: "string" }] },
  { type: "error", name: "InvalidReportData", inputs: [] },
] as const;

const ESCROW_ABI = [
  {
    type: "function",
    name: "oracle",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "getEscrow",
    stateMutability: "view",
    inputs: [{ name: "orderId", type: "bytes32" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "orderId", type: "bytes32" },
          { name: "buyer", type: "address" },
          { name: "seller", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "createdAt", type: "uint64" },
          { name: "settledAt", type: "uint64" },
          { name: "status", type: "uint8" },
        ],
      },
    ],
  },
] as const;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

type BridgeConfig = {
  rpcUrl: string;
  expectedChainId: number;
  receiver: Address;
  escrow: Address;
  admin: Address;
  /** When non-empty, only these order IDs may be settled. */
  allowedOrderIds: Set<string>;
  dryRun: boolean;
  simulationTimeoutMs: number;
  stateFile: string;
  creCommand: string;
};

function envFlag(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  throw new Error(`${name} must be a boolean (true/false), got "${raw}"`);
}

function envAddress(name: string, fallback: string): Address {
  const raw = (process.env[name] ?? "").trim() || fallback;
  if (!/^0x[0-9a-fA-F]{40}$/.test(raw)) {
    throw new Error(`${name} must be a 0x-prefixed 20-byte address, got "${raw}"`);
  }
  return getAddress(raw);
}

/**
 * Comma-separated order-ID allowlist. When set, every other CRE report is
 * ignored, so a simulation that emits several eligible reports can only ever
 * settle the orders that were explicitly listed.
 */
function parseOrderAllowlist(raw: string | undefined): Set<string> {
  const ids = new Set<string>();
  for (const part of (raw ?? "").split(",")) {
    const value = part.trim();
    if (value.length === 0) continue;
    if (!ORDER_ID_PATTERN.test(value)) {
      throw new Error(`BRIDGE_ORDER_ALLOWLIST contains an invalid orderId: ${value}`);
    }
    ids.add(value.toLowerCase());
  }
  return ids;
}

function loadConfig(): BridgeConfig {
  return {
    rpcUrl: process.env.HARDHAT_RPC_URL ?? process.env.LOCAL_RPC_URL ?? "http://127.0.0.1:8545",
    expectedChainId: Number(process.env.BRIDGE_EXPECTED_CHAIN_ID ?? 31337),
    receiver: envAddress("BRIDGE_RECEIVER", "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0"),
    escrow: envAddress("BRIDGE_ESCROW", "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512"),
    admin: envAddress("BRIDGE_ADMIN_ACCOUNT", "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"),
    allowedOrderIds: parseOrderAllowlist(process.env.BRIDGE_ORDER_ALLOWLIST),
    // Default true: the bridge sends nothing until explicitly enabled.
    dryRun: envFlag("LOCAL_BRIDGE_DRY_RUN", true),
    simulationTimeoutMs: Number(process.env.BRIDGE_SIM_TIMEOUT_MS ?? 240_000),
    stateFile: process.env.BRIDGE_STATE_FILE ?? DEFAULT_STATE_FILE,
    creCommand: process.env.BRIDGE_CRE_COMMAND ?? "cre",
  };
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const ANSI_PATTERN = /\u001b\[[0-9;]*[A-Za-z]/g;
const HEX_PATTERN = /^0x[0-9a-fA-F]*$/;
const ORDER_ID_PATTERN = /^0x[0-9a-fA-F]{64}$/;

class BridgeError extends Error {}

function log(message = ""): void {
  console.log(message);
}

function short(value: string, head = 10, tail = 6): string {
  if (value.length <= head + tail + 3) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolvePromise => setTimeout(resolvePromise, ms));
}

/** Reads are retried; writes never are (see runLiveReport). */
async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      log(`  ! ${label} failed (attempt ${attempt}/${attempts}), retrying: ${describeError(error)}`);
      await sleep(250 * attempt);
    }
  }
  throw lastError;
}

function describeError(error: unknown): string {
  if (error instanceof BridgeError) return error.message;
  if (error instanceof Error) return error.message.split("\n")[0];
  return String(error);
}

/** Decodes a ProofPayCREReceiver custom error when the RPC provides revert data. */
function describeRevert(error: unknown): string {
  const data = findHexData(error);
  if (data) {
    try {
      const decoded = decodeErrorResult({ abi: RECEIVER_ABI, data });
      const args = decoded.args && decoded.args.length > 0 ? `(${decoded.args.join(", ")})` : "";
      return `reverted with ${decoded.errorName}${args}`;
    } catch {
      // not one of our custom errors
    }
  }
  return `reverted: ${describeError(error)}`;
}

function findHexData(error: unknown, depth = 0): Hex | null {
  if (!error || typeof error !== "object" || depth > 6) return null;
  const candidate = (error as { data?: unknown }).data;
  if (typeof candidate === "string" && HEX_PATTERN.test(candidate) && candidate.length > 10) {
    return candidate as Hex;
  }
  if (candidate && typeof candidate === "object") {
    const nested = (candidate as { data?: unknown }).data;
    if (typeof nested === "string" && HEX_PATTERN.test(nested) && nested.length > 10) {
      return nested as Hex;
    }
  }
  const cause = (error as { cause?: unknown }).cause;
  if (cause) return findHexData(cause, depth + 1);
  return null;
}

// ---------------------------------------------------------------------------
// CRE simulation
// ---------------------------------------------------------------------------

type ReportLine = {
  type: "report";
  orderId: Hex;
  outcome: string;
  trackingId: string;
  observedAt: string;
  metadata: Hex;
  report: Hex;
};

type MetaLine = {
  type: "meta";
  orderId: Hex;
  action?: string;
  trackingIdHash?: string;
  reportSource?: string;
  reportDecodesToReceiverAbi?: boolean;
  creRawReportLength?: number;
  creMetadataHeaderLength?: number;
  creRawReportHash?: string;
  receiver?: string;
  escrow?: string;
  creDryRun?: boolean;
};

type SimulationOutput = {
  exitCode: number | null;
  timedOut: boolean;
  reportLines: ReportLine[];
  metaLines: MetaLine[];
  parseProblems: string[];
  rawLines: string[];
};

function runCreSimulation(config: BridgeConfig): Promise<SimulationOutput> {
  const args = [
    "workflow",
    "simulate",
    "shipment-workflow",
    "--target",
    "staging-settings",
    "--trigger-index",
    "0",
    "--non-interactive",
  ];

  log(`$ ${config.creCommand} ${args.join(" ")}`);
  log(`  (cwd: ${CRE_PROJECT_DIR})`);

  return new Promise(resolvePromise => {
    const reportLines: ReportLine[] = [];
    const metaLines: MetaLine[] = [];
    const parseProblems: string[] = [];
    const rawLines: string[] = [];
    let buffered = "";
    let timedOut = false;

    const child = spawn(config.creCommand, args, {
      cwd: CRE_PROJECT_DIR,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const handleChunk = (chunk: Buffer): void => {
      buffered += chunk.toString("utf8");
      const parts = buffered.split(/\r?\n/);
      buffered = parts.pop() ?? "";
      for (const line of parts) {
        rawLines.push(line);
        consumeLine(line, reportLines, metaLines, parseProblems);
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
    }, config.simulationTimeoutMs);

    child.stdout?.on("data", handleChunk);
    child.stderr?.on("data", handleChunk);

    child.on("error", error => {
      clearTimeout(timer);
      parseProblems.push(
        (error as NodeJS.ErrnoException).code === "ENOENT"
          ? `CRE CLI not found as "${config.creCommand}". Is it on PATH?`
          : `Failed to start CRE simulation: ${describeError(error)}`
      );
      resolvePromise({ exitCode: null, timedOut, reportLines, metaLines, parseProblems, rawLines });
    });

    child.on("close", code => {
      clearTimeout(timer);
      if (buffered.trim().length > 0) {
        rawLines.push(buffered);
        consumeLine(buffered, reportLines, metaLines, parseProblems);
      }
      resolvePromise({ exitCode: code, timedOut, reportLines, metaLines, parseProblems, rawLines });
    });
  });
}

/**
 * Pulls one `PROOFPAY_REPORT_V1:` payload out of a CRE log line.
 * CRE prefixes lines with timestamps and truncates around 1 KB, so a truncated
 * line is reported as a hard parse problem instead of being silently dropped.
 */
function consumeLine(
  line: string,
  reportLines: ReportLine[],
  metaLines: MetaLine[],
  parseProblems: string[]
): void {
  const clean = line.replace(ANSI_PATTERN, "");
  const at = clean.indexOf(REPORT_LOG_PREFIX);
  if (at === -1) return;

  const payload = clean.slice(at + REPORT_LOG_PREFIX.length).trim();

  if (/\.\.\.\(truncated\)/.test(payload)) {
    parseProblems.push(
      "A PROOFPAY_REPORT_V1 line was truncated by the CRE runtime; the bridge cannot trust it."
    );
    return;
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(payload) as Record<string, unknown>;
  } catch (error) {
    parseProblems.push(`Malformed PROOFPAY_REPORT_V1 JSON: ${describeError(error)}`);
    return;
  }

  if (parsed.type === "report") {
    reportLines.push(parsed as unknown as ReportLine);
    return;
  }
  if (parsed.type === "meta") {
    metaLines.push(parsed as unknown as MetaLine);
    return;
  }
  parseProblems.push(`Unknown PROOFPAY_REPORT_V1 record type: ${String(parsed.type)}`);
}

// ---------------------------------------------------------------------------
// Report validation (validation only, never a settlement decision)
// ---------------------------------------------------------------------------

type ValidatedReport = {
  orderId: Hex;
  outcome: string;
  trackingId: string;
  observedAt: string;
  metadata: Hex;
  report: Hex;
  trackingIdHash: Hex;
  reportId: Hex;
  action?: string;
};

type ValidationResult = { ok: true; value: ValidatedReport } | { ok: false; problems: string[] };

function validateReport(
  line: ReportLine,
  meta: MetaLine | undefined,
  config: BridgeConfig
): ValidationResult {
  const problems: string[] = [];

  if (typeof line.orderId !== "string" || !ORDER_ID_PATTERN.test(line.orderId)) {
    problems.push(`orderId is not a bytes32 hex string: ${String(line.orderId)}`);
  }
  if (typeof line.outcome !== "string" || !SUPPORTED_OUTCOMES.includes(line.outcome)) {
    problems.push(
      `outcome "${String(line.outcome)}" is not one of the CRE settlement outputs (${SUPPORTED_OUTCOMES.join(", ")})`
    );
  }
  if (typeof line.report !== "string" || !HEX_PATTERN.test(line.report)) {
    problems.push("report is not hex-encoded bytes");
  }
  if (typeof line.metadata !== "string" || !HEX_PATTERN.test(line.metadata)) {
    problems.push("metadata is not hex-encoded bytes");
  }
  if (typeof line.observedAt !== "string" || line.observedAt.length === 0) {
    problems.push("observedAt is missing");
  }

  if (meta) {
    if (meta.orderId && meta.orderId.toLowerCase() !== line.orderId?.toLowerCase()) {
      problems.push("meta.orderId does not match the report line");
    }
    if (meta.reportDecodesToReceiverAbi === false) {
      problems.push("CRE reported that its bytes are not the receiver ABI payload");
    }
    if (meta.receiver && meta.receiver.toLowerCase() !== config.receiver.toLowerCase()) {
      problems.push(`CRE targeted receiver ${meta.receiver}, but the bridge is configured for ${config.receiver}`);
    }
    if (meta.escrow && meta.escrow.toLowerCase() !== config.escrow.toLowerCase()) {
      problems.push(`CRE read escrow ${meta.escrow}, but the bridge is configured for ${config.escrow}`);
    }
    if (meta.creDryRun === false) {
      problems.push(
        "CRE dryRun is false: CRE itself may submit reports. Refusing to bridge to avoid a duplicate settlement."
      );
    }
  }

  if (problems.length > 0) return { ok: false, problems };

  // Independent check that the relayed bytes really are the ABI payload the
  // receiver abi.decode()s, and that they agree with the line's own fields.
  let decodedOrderId: string;
  let decodedOutcome: string;
  let decodedTrackingIdHash: Hex;
  let decodedObservedAt: string;
  try {
    const decoded = decodeAbiParameters(SETTLEMENT_REPORT_ABI, line.report);
    decodedOrderId = decoded[0] as string;
    decodedOutcome = decoded[1] as string;
    decodedTrackingIdHash = decoded[2] as Hex;
    decodedObservedAt = decoded[3] as string;
  } catch (error) {
    return {
      ok: false,
      problems: [`report bytes do not decode as (bytes32,string,bytes32,string): ${describeError(error)}`],
    };
  }

  if (decodedOrderId.toLowerCase() !== line.orderId.toLowerCase()) {
    problems.push("bytes decode to a different orderId than the line advertises");
  }
  if (decodedOutcome !== line.outcome) {
    problems.push("bytes decode to a different outcome than the line advertises");
  }
  if (decodedObservedAt !== line.observedAt) {
    problems.push("bytes decode to a different observedAt than the line advertises");
  }
  if (problems.length > 0) return { ok: false, problems };

  // Mirrors ProofPayCREReceiver._processReport so the bridge and the contract
  // agree on the replay-protection key.
  const reportId = keccak256(
    encodePacked(
      ["bytes32", "string", "bytes32", "string", "bytes"],
      [line.orderId, line.outcome, decodedTrackingIdHash, decodedObservedAt, line.metadata]
    )
  );

  return {
    ok: true,
    value: {
      orderId: line.orderId,
      outcome: line.outcome,
      trackingId: line.trackingId ?? "(unknown)",
      observedAt: decodedObservedAt,
      metadata: line.metadata,
      report: line.report,
      trackingIdHash: decodedTrackingIdHash,
      reportId,
      action: meta?.action,
    },
  };
}

// ---------------------------------------------------------------------------
// Persistent state (successful submissions only)
// ---------------------------------------------------------------------------

type SubmissionRecord = {
  orderId: string;
  outcome: string;
  reportId: string;
  txHash: string;
  blockNumber: string;
  from: string;
  submittedAt: string;
};

type BridgeState = {
  version: 1;
  submissions: Record<string, SubmissionRecord>;
};

async function loadState(file: string): Promise<BridgeState> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: 1, submissions: {} };
    }
    throw new BridgeError(`Cannot read bridge state ${file}: ${describeError(error)}`);
  }

  try {
    const parsed = JSON.parse(raw) as BridgeState;
    if (!parsed || parsed.version !== 1 || typeof parsed.submissions !== "object") {
      throw new Error("unexpected shape");
    }
    return parsed;
  } catch {
    const backup = `${file}.corrupt-${Date.now()}`;
    await rename(file, backup);
    log(`! Bridge state was unreadable; moved to ${backup} and starting fresh.`);
    return { version: 1, submissions: {} };
  }
}

async function saveState(file: string, state: BridgeState): Promise<void> {
  const temp = `${file}.tmp-${process.pid}`;
  await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temp, file);
}

// ---------------------------------------------------------------------------
// Single-run lock (no overlapping simulations)
// ---------------------------------------------------------------------------

let releaseLock: (() => Promise<void>) | null = null;

async function acquireLock(file: string): Promise<void> {
  const write = async (): Promise<void> => {
    const handle = await open(file, "wx");
    await handle.writeFile(`${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`);
    await handle.close();
  };

  try {
    await write();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw new BridgeError(`Cannot create lock ${file}: ${describeError(error)}`);
    }

    const existing = (await readFile(file, "utf8").catch(() => "")).trim();
    let holderPid = 0;
    try {
      holderPid = Number(JSON.parse(existing).pid ?? 0);
    } catch {
      holderPid = 0;
    }

    if (holderPid > 0 && isProcessAlive(holderPid)) {
      throw new BridgeError(
        `Another bridge run is active (pid ${holderPid}). Refusing to start a second simulation.`
      );
    }

    log(`! Removing stale lock left by pid ${holderPid || "unknown"}.`);
    await unlink(file).catch(() => undefined);
    await write();
  }

  releaseLock = async () => {
    await unlink(file).catch(() => undefined);
    releaseLock = null;
  };
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Chain preflight
// ---------------------------------------------------------------------------

type ChainContext = {
  publicClient: ReturnType<typeof createPublicClient>;
  walletClient: ReturnType<typeof createWalletClient>;
  unlockedAccounts: Address[];
  adminBalance: bigint;
};

function createClients(config: BridgeConfig): ChainContext {
  const transport = http(config.rpcUrl, { timeout: 15_000 });
  const publicClient = createPublicClient({ transport });
  // Passing the account as an address makes viem use eth_sendTransaction,
  // i.e. the Hardhat node's unlocked account. No key material is involved.
  const walletClient = createWalletClient({ account: config.admin, transport });
  return { publicClient, walletClient, unlockedAccounts: [], adminBalance: 0n };
}

async function preflight(config: BridgeConfig, context: ChainContext): Promise<void> {
  const { publicClient, walletClient } = context;
  const failures: string[] = [];

  log("Preflight");

  const chainId = await withRetry("chain id", () => publicClient.getChainId());
  const chainOk = chainId === config.expectedChainId;
  log(`  chainId            ${chainId} ${chainOk ? "ok" : `EXPECTED ${config.expectedChainId}`}`);
  if (!chainOk) {
    failures.push(`Chain ID ${chainId} is not ${config.expectedChainId}. Wrong network; refusing to continue.`);
  }

  const receiverCode = await withRetry("receiver code", () => publicClient.getCode({ address: config.receiver }));
  const receiverHasCode = Boolean(receiverCode && receiverCode !== "0x");
  log(`  receiver code      ${receiverHasCode ? `${(receiverCode!.length - 2) / 2} bytes ok` : "MISSING"}`);
  if (!receiverHasCode) failures.push(`No bytecode at receiver ${config.receiver}.`);

  const escrowCode = await withRetry("escrow code", () => publicClient.getCode({ address: config.escrow }));
  const escrowHasCode = Boolean(escrowCode && escrowCode !== "0x");
  log(`  escrow code        ${escrowHasCode ? `${(escrowCode!.length - 2) / 2} bytes ok` : "MISSING"}`);
  if (!escrowHasCode) failures.push(`No bytecode at escrow ${config.escrow}.`);

  let unlocked: Address[] = [];
  try {
    unlocked = (await walletClient.getAddresses()).map(address => getAddress(address));
  } catch (error) {
    failures.push(`Cannot list RPC accounts: ${describeError(error)}`);
  }
  const adminUnlocked = unlocked.some(address => address.toLowerCase() === config.admin.toLowerCase());
  log(
    `  admin unlocked     ${adminUnlocked ? "ok" : "NOT UNLOCKED"} ${config.admin} (rpc accounts: ${unlocked.length})`
  );
  if (!adminUnlocked) {
    failures.push(
      `Admin ${config.admin} is not an unlocked RPC account. The bridge only uses eth_sendTransaction and never a private key. ` +
        `Start the node with its default accounts or point BRIDGE_ADMIN_ACCOUNT at an unlocked one.`
    );
  }

  if (receiverHasCode) {
    try {
      const manualOracle = await withRetry("receiver.manualOracle", () =>
        publicClient.readContract({
          address: config.receiver,
          abi: RECEIVER_ABI,
          functionName: "manualOracle",
        })
      );
      const matches = getAddress(manualOracle).toLowerCase() === config.admin.toLowerCase();
      log(`  receiver.oracle    ${manualOracle} ${matches ? "ok (== signer)" : "MISMATCH"}`);
      if (!matches) {
        failures.push(
          `receiver.manualOracle() is ${manualOracle}, but the bridge signer is ${config.admin}. processReport would revert.`
        );
      }
    } catch (error) {
      failures.push(`Cannot read receiver.manualOracle(): ${describeError(error)}`);
    }
  }

  if (escrowHasCode) {
    try {
      const oracle = await withRetry("escrow.oracle", () =>
        publicClient.readContract({ address: config.escrow, abi: ESCROW_ABI, functionName: "oracle" })
      );
      const matches = getAddress(oracle).toLowerCase() === config.receiver.toLowerCase();
      log(`  escrow.oracle      ${oracle} ${matches ? "ok (== receiver)" : "MISMATCH"}`);
      if (!matches) {
        failures.push(`escrow.oracle() is ${oracle}, expected the receiver ${config.receiver}.`);
      }
    } catch (error) {
      failures.push(`Cannot read escrow.oracle(): ${describeError(error)}`);
    }
  }

  try {
    const balance = await withRetry("admin balance", () => publicClient.getBalance({ address: config.admin }));
    context.adminBalance = balance;
    log(`  admin balance      ${formatEther(balance)} ETH ${balance > 0n ? "ok" : "EMPTY"}`);
    if (balance === 0n) failures.push(`Admin ${config.admin} has no ETH for gas.`);
  } catch (error) {
    failures.push(`Cannot read admin balance: ${describeError(error)}`);
  }

  context.unlockedAccounts = unlocked;

  if (failures.length > 0) {
    log("");
    for (const failure of failures) log(`  ✗ ${failure}`);
    throw new BridgeError("Preflight failed. No simulation was started and no transaction was sent.");
  }
  log("  all checks passed");
}

// ---------------------------------------------------------------------------
// On-chain escrow state
// ---------------------------------------------------------------------------

type EscrowSnapshot = { status: number; buyer: Address; seller: Address; amount: bigint } | null;

async function readEscrow(context: ChainContext, config: BridgeConfig, orderId: Hex): Promise<EscrowSnapshot> {
  try {
    const raw = await withRetry("escrow.getEscrow", () =>
      context.publicClient.readContract({
        address: config.escrow,
        abi: ESCROW_ABI,
        functionName: "getEscrow",
        args: [orderId],
      })
    );

    // viem may return the struct as an object (named components) or a tuple.
    const record = raw as unknown as
      | { status?: unknown; buyer?: unknown; seller?: unknown; amount?: unknown }
      | readonly unknown[];

    if (Array.isArray(record)) {
      const tuple = record as readonly unknown[];
      return {
        status: Number(tuple[6]),
        buyer: getAddress(String(tuple[1])),
        seller: getAddress(String(tuple[2])),
        amount: BigInt(String(tuple[3])),
      };
    }
    const struct = record as {
      status?: unknown;
      buyer?: unknown;
      seller?: unknown;
      amount?: unknown;
    };
    return {
      status: Number(struct.status),
      buyer: getAddress(String(struct.buyer)),
      seller: getAddress(String(struct.seller)),
      amount: BigInt(String(struct.amount)),
    };
  } catch (error) {
    if (describeError(error).includes("EscrowNotFound")) return null;
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Submission
// ---------------------------------------------------------------------------

type PreparedTransaction = {
  to: Address;
  from: Address;
  data: Hex;
  gasEstimate: bigint | null;
  estimateError: string | null;
};

async function prepareTransaction(
  context: ChainContext,
  config: BridgeConfig,
  report: ValidatedReport
): Promise<PreparedTransaction> {
  const data = encodeFunctionData({
    abi: RECEIVER_ABI,
    functionName: "processReport",
    args: [report.metadata, report.report],
  });

  let gasEstimate: bigint | null = null;
  let estimateError: string | null = null;
  try {
    gasEstimate = await context.publicClient.estimateGas({
      account: config.admin,
      to: config.receiver,
      data,
    });
  } catch (error) {
    estimateError = describeRevert(error);
  }

  return { to: config.receiver, from: config.admin, data, gasEstimate, estimateError };
}

async function submitTransaction(
  context: ChainContext,
  config: BridgeConfig,
  transaction: PreparedTransaction
): Promise<{ txHash: Hex; blockNumber: bigint }> {
  const txHash = await context.walletClient.sendTransaction({
    account: config.admin,
    chain: null,
    to: transaction.to,
    data: transaction.data,
    gas: transaction.gasEstimate ? (transaction.gasEstimate * 12n) / 10n : undefined,
  });

  const receipt = await context.publicClient.waitForTransactionReceipt({ hash: txHash, confirmations: 1 });
  if (receipt.status !== "success") {
    throw new BridgeError(`Transaction ${txHash} mined with status ${receipt.status}.`);
  }
  return { txHash, blockNumber: receipt.blockNumber };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

type Outcome = "submitted" | "planned" | "skipped" | "failed";

type RunSummary = {
  reports: number;
  submitted: number;
  planned: number;
  skipped: number;
  failed: number;
};

async function processReport(
  context: ChainContext,
  config: BridgeConfig,
  state: BridgeState,
  report: ValidatedReport,
  summary: RunSummary
): Promise<void> {
  const label = `${short(report.orderId)} (${report.outcome})`;
  log("");
  log(`Report ${label}`);

  const escrow = await readEscrow(context, config, report.orderId);
  if (!escrow) {
    log("  skip: no escrow exists on-chain for this order");
    summary.skipped++;
    return;
  }
  const statusLabel = ESCROW_STATUS_LABELS[escrow.status] ?? `Unknown(${escrow.status})`;
  if (escrow.status !== 1) {
    log(`  skip: escrow is ${statusLabel}, not Funded (nothing left to settle)`);
    summary.skipped++;
    return;
  }

  const orderSettled = await withRetry("receiver.orderSettled", () =>
    context.publicClient.readContract({
      address: config.receiver,
      abi: RECEIVER_ABI,
      functionName: "orderSettled",
      args: [report.orderId],
    })
  );
  if (orderSettled) {
    log("  skip: receiver already settled this order");
    summary.skipped++;
    return;
  }

  const reportAlreadyProcessed = await withRetry("receiver.processedReports", () =>
    context.publicClient.readContract({
      address: config.receiver,
      abi: RECEIVER_ABI,
      functionName: "processedReports",
      args: [report.reportId],
    })
  );
  if (reportAlreadyProcessed) {
    log("  skip: receiver already processed this exact report");
    summary.skipped++;
    return;
  }

  const recorded = state.submissions[report.reportId];
  if (recorded) {
    log(`  skip: bridge already submitted this report in tx ${recorded.txHash}`);
    summary.skipped++;
    return;
  }

  const transaction = await prepareTransaction(context, config, report);

  log(`  escrow seller      ${escrow.seller}`);
  log(`  escrow amount      ${formatUnits(escrow.amount, 18)} pUSD`);
  log(`  receiver           ${config.receiver}`);
  log(`  metadata           ${report.metadata} (${(report.metadata.length - 2) / 2} bytes)`);
  log(`  report             ${(report.report.length - 2) / 2} bytes`);
  log(`  calldata           ${(transaction.data.length - 2) / 2} bytes -> processReport(bytes,bytes)`);
  log(`  reportId           ${report.reportId}`);
  log(`  CRE action         ${report.action ?? "(meta line not emitted)"}`);
  log(
    `  gas estimate       ${transaction.gasEstimate !== null ? `${transaction.gasEstimate} (eth_call simulation succeeded)` : `would revert -> ${transaction.estimateError}`}`
  );

  if (transaction.estimateError !== null && config.dryRun) {
    log("  ! The receiver would reject these bytes right now. Not submitting (dry run).");
    summary.failed++;
    return;
  }

  if (config.dryRun) {
    log("");
    log("  [DRY RUN] would submit this transaction:");
    log(`    from   ${transaction.from}  (Hardhat unlocked account, eth_sendTransaction)`);
    log(`    to     ${transaction.to}`);
    log(`    value  0`);
    log(`    data   ${transaction.data}`);
    log("  Nothing was broadcast. Set LOCAL_BRIDGE_DRY_RUN=false to submit.");
    summary.planned++;
    return;
  }

  if (transaction.estimateError !== null) {
    log(`  ✗ refusing to submit: ${transaction.estimateError}`);
    summary.failed++;
    return;
  }

  const { txHash, blockNumber } = await submitTransaction(context, config, transaction);
  log(`  ✓ submitted tx ${txHash} in block ${blockNumber}`);

  state.submissions[report.reportId] = {
    orderId: report.orderId,
    outcome: report.outcome,
    reportId: report.reportId,
    txHash,
    blockNumber: blockNumber.toString(),
    from: config.admin,
    submittedAt: new Date().toISOString(),
  };
  await saveState(config.stateFile, state);

  const settled = await context.publicClient.readContract({
    address: config.receiver,
    abi: RECEIVER_ABI,
    functionName: "orderSettled",
    args: [report.orderId],
  });
  log(`  receiver.orderSettled(orderId) = ${settled}`);
  summary.submitted++;
}

async function main(): Promise<number> {
  const config = loadConfig();

  log("ProofPay local CRE execution bridge");
  log("  Mode: CRE workflow simulation + local report relay (not DON execution)");
  log(`  Bridge mode: ${config.dryRun ? "DRY RUN (no transaction will be sent)" : "LIVE (will submit transactions)"}`);
  log(`  RPC: ${config.rpcUrl}`);
  log(`  Receiver: ${config.receiver}`);
  log(`  Escrow:   ${config.escrow}`);
  log(`  Signer:   ${config.admin} (unlocked Hardhat account, no private key)`);
  log(
    `  Allowlist: ${
      config.allowedOrderIds.size > 0
        ? `${[...config.allowedOrderIds].join(", ")} (only these orders may be settled)`
        : "(not set - every eligible CRE report is validated per order)"
    }`
  );
  log("");

  await acquireLock(LOCK_FILE);

  try {
    const context = createClients(config);
    await preflight(config, context);

    log("");
    log("Running CRE workflow");
    const simulation = await runCreSimulation(config);

    if (simulation.parseProblems.length > 0) {
      log("");
      for (const problem of simulation.parseProblems) log(`  ✗ ${problem}`);
      throw new BridgeError("CRE output could not be parsed. Nothing was submitted.");
    }

    if (simulation.exitCode !== 0) {
      const reason = simulation.timedOut
        ? `simulation exceeded ${config.simulationTimeoutMs} ms and was stopped`
        : `simulation exited with code ${simulation.exitCode}`;
      for (const line of simulation.rawLines.slice(-12)) log(`  | ${line}`);
      throw new BridgeError(`CRE ${reason}. Nothing was submitted.`);
    }

    // CRE prints the result header and the actual value on the following line.
    const resultIndex = simulation.rawLines.findIndex(line =>
      line.includes("Workflow Simulation Result")
    );
    const resultValue =
      resultIndex >= 0
        ? (simulation.rawLines.slice(resultIndex + 1).find(line => line.trim().length > 0) ?? "").trim()
        : "";
    log(`  CRE result: ${resultValue || "(no result line)"}`);

    if (simulation.reportLines.length === 0) {
      log("");
      log("CRE emitted no settlement reports in this run (nothing DELIVERED or LOST with a funded escrow).");
      log("No transaction was sent.");
      return 0;
    }

    const metaByOrder = new Map<string, MetaLine>();
    for (const meta of simulation.metaLines) {
      if (typeof meta.orderId === "string") metaByOrder.set(meta.orderId.toLowerCase(), meta);
    }

    const state = await loadState(config.stateFile);
    const summary: RunSummary = { reports: 0, submitted: 0, planned: 0, skipped: 0, failed: 0 };

    log("");
    log(`CRE emitted ${simulation.reportLines.length} report(s):`);
    for (const line of simulation.reportLines) {
      const orderId = String(line.orderId ?? "").toLowerCase();
      const eligible = config.allowedOrderIds.size === 0 || config.allowedOrderIds.has(orderId);
      log(
        `  ${String(line.orderId)}  ${String(line.outcome)}  ${
          eligible ? "ELIGIBLE" : "NOT IN ALLOWLIST - will not be submitted"
        }`
      );
    }
    log("validating eligible reports");

    for (const line of simulation.reportLines) {
      summary.reports++;
      const orderIdForFilter = String(line.orderId ?? "").toLowerCase();
      if (config.allowedOrderIds.size > 0 && !config.allowedOrderIds.has(orderIdForFilter)) {
        log("");
        log(`Report ${short(String(line.orderId))} skipped: not in BRIDGE_ORDER_ALLOWLIST`);
        summary.skipped++;
        continue;
      }
      const meta = typeof line.orderId === "string" ? metaByOrder.get(line.orderId.toLowerCase()) : undefined;
      const validation = validateReport(line, meta, config);

      if (!validation.ok) {
        log("");
        log(`Report ${short(String(line.orderId))} REJECTED:`);
        for (const problem of validation.problems) log(`  ✗ ${problem}`);
        summary.failed++;
        continue;
      }

      try {
        await processReport(context, config, state, validation.value, summary);
      } catch (error) {
        log(`  ✗ bridge error: ${describeRevert(error)}`);
        summary.failed++;
      }
    }

    log("");
    log("Summary");
    log(`  reports from CRE   ${summary.reports}`);
    log(`  submitted          ${summary.submitted}`);
    log(`  would submit       ${summary.planned}`);
    log(`  skipped            ${summary.skipped}`);
    log(`  failed             ${summary.failed}`);
    log(`  state file         ${config.stateFile}`);

    if (config.dryRun) {
      log("");
      log("Dry run complete. No transaction was submitted.");
    }

    return summary.failed > 0 ? 1 : 0;
  } finally {
    if (releaseLock) await releaseLock();
  }
}

main()
  .then(code => process.exit(code))
  .catch(error => {
    log("");
    log(`✗ ${error instanceof BridgeError ? error.message : describeError(error)}`);
    if (!(error instanceof BridgeError)) {
      log(error instanceof Error && error.stack ? error.stack : String(error));
    }
    process.exit(1);
  });

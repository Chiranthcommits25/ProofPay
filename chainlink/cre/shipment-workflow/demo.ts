#!/usr/bin/env bun
import {
  type Address,
  type Hex,
  type PublicClient,
  createPublicClient,
  getAddress,
  http,
} from "viem";
import stagingConfig from "./config.staging.json";

const HERE = (import.meta as ImportMeta & { dir?: string }).dir ?? process.cwd();
const FINAL_STATUSES = ["DELIVERED", "LOST"] as const;
const ACTIVE_STATUSES = new Set(["CREATED", "SHIPPED", "IN_TRANSIT"]);
const TERMINAL_STATUSES = new Set(["DELIVERED", "LOST"]);
const ORDER_ID_PATTERN = /^0x[0-9a-f]{64}$/i;
const TRACKING_ID_PATTERN = /^[A-Z0-9][A-Z0-9_-]{3,63}$/i;
const ANSI_PATTERN = /\u001b\[[0-9;]*[A-Za-z]/g;
const SCHEDULER_RUN_SECONDS = 60;
const COURIER_DELAY_MS = "2000";

type FinalStatus = (typeof FINAL_STATUSES)[number];
type DemoMode = "scheduler" | "direct";

type RawConfig = {
  shipmentApiBaseUrl: string;
  shipmentApiPath: string;
  rpcUrl: string;
  chainId: number;
  escrowContractAddress: string;
  receiverContractAddress: string;
  dryRun: boolean;
};

type RuntimeConfig = {
  shipmentApiBaseUrl: string;
  shipmentApiPath: string;
  rpcUrl: string;
  chainId: number;
  escrowContractAddress: Address;
  receiverContractAddress: Address;
};

type Shipment = {
  trackingId: string;
  orderId: string;
  sellerAddress: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

type EscrowSnapshot = {
  orderId: string;
  buyer: Address;
  seller: Address;
  amount: bigint;
  status: number;
};

type Preflight = {
  client: PublicClient;
  escrow: EscrowSnapshot;
  receiverSettled: boolean;
};

type SelectedRoute =
  | { kind: "already-settled" }
  | { kind: "run"; mode: DemoMode };

type ChildRun = {
  exitCode: number;
  txHash: string | null;
  blockNumber: string | null;
  statusChanges: string[];
};

type StdinLike = {
  setEncoding(encoding: string): void;
  on(event: "data", listener: (chunk: string | Buffer) => void): void;
  on(event: "end" | "error", listener: () => void): void;
  resume(): void;
};

type StdoutLike = {
  write(value: string): boolean;
};

type BunChild = {
  pid: number;
  exited: Promise<number>;
  stdout?: AsyncIterable<Uint8Array> | null;
  stderr?: AsyncIterable<Uint8Array> | null;
  kill(signal?: string | number): void;
};

type BunFile = {
  exists(): Promise<boolean>;
  text(): Promise<string>;
  delete(): Promise<void>;
};

type BunRuntime = {
  spawn(options: {
    cmd: string[];
    cwd?: string;
    env?: Record<string, string | undefined>;
    stdin?: "ignore";
    stdout?: "pipe";
    stderr?: "pipe";
    detached?: boolean;
  }): BunChild;
  file(path: string): BunFile;
};

type ProcessApi = {
  platform?: string;
  kill(pid: number, signal?: string | number): boolean;
};

const ESCROW_STATUS_LABELS: Record<number, string> = {
  0: "None",
  1: "Funded",
  2: "Released",
  3: "Refunded",
};

const RECEIVER_ABI = [
  {
    type: "function",
    name: "orderSettled",
    stateMutability: "view",
    inputs: [{ name: "orderId", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const ESCROW_ABI = [
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

class DemoError extends Error {}

let activeChild: BunChild | null = null;
let interrupting = false;

function log(message = ""): void {
  console.log(message);
}

function describeError(error: unknown): string {
  if (error instanceof DemoError) return error.message;
  if (error instanceof Error) return error.message.split("\n")[0];
  return String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolvePromise => setTimeout(resolvePromise, ms));
}

function bunRuntime(): BunRuntime {
  const runtime = (globalThis as { Bun?: BunRuntime }).Bun;
  if (!runtime) {
    throw new DemoError("demo.ts must be run with Bun: bun demo.ts");
  }
  return runtime;
}

function processApi(): ProcessApi {
  return process as unknown as ProcessApi;
}

function useProcessGroups(): boolean {
  return processApi().platform !== "win32";
}

function signalChild(child: BunChild, signal: string): void {
  if (useProcessGroups()) {
    try {
      processApi().kill(-child.pid, signal);
      return;
    } catch {
      // fall back to signalling only the direct child
    }
  }
  try {
    child.kill(signal);
  } catch {
    // already exited
  }
}

function isProcessAlive(pid: number): boolean {
  if (pid <= 0) return false;
  try {
    processApi().kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function cleanupStaleLocks(): Promise<void> {
  const runtime = bunRuntime();
  const locks = [
    `${HERE}/../.local-bridge.lock`,
    `${HERE}/../.courier-scheduler.lock`,
  ];

  for (const path of locks) {
    const lock = runtime.file(path);
    if (!(await lock.exists())) continue;

    let pid = 0;
    try {
      const parsed = JSON.parse(await lock.text()) as { pid?: unknown };
      pid = Number(parsed.pid ?? 0);
    } catch {
      continue;
    }

    if (isProcessAlive(pid)) continue;
    await lock.delete().catch(() => undefined);
  }
}

function envValue(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function parseAddress(label: string, value: string): Address {
  try {
    return getAddress(value);
  } catch {
    throw new DemoError(`${label} is not a valid 0x address: ${value}`);
  }
}

function resolveConfig(raw: RawConfig): RuntimeConfig {
  if (raw.dryRun !== true) {
    throw new DemoError(
      "config.staging.json must keep dryRun=true so CRE does not submit reports directly."
    );
  }

  const apiBase = (envValue("COURIER_API_BASE") ?? raw.shipmentApiBaseUrl).replace(/\/+$/, "");
  const rpcUrl =
    envValue("HARDHAT_RPC_URL") ?? envValue("LOCAL_RPC_URL") ?? raw.rpcUrl;
  const chainId = Number(envValue("BRIDGE_EXPECTED_CHAIN_ID") ?? raw.chainId);

  if (!Number.isInteger(chainId) || chainId <= 0) {
    throw new DemoError(`Invalid chain ID: ${String(chainId)}`);
  }

  return {
    shipmentApiBaseUrl: apiBase,
    shipmentApiPath: raw.shipmentApiPath,
    rpcUrl,
    chainId,
    escrowContractAddress: parseAddress(
      "Escrow address",
      envValue("BRIDGE_ESCROW") ?? raw.escrowContractAddress
    ),
    receiverContractAddress: parseAddress(
      "Receiver address",
      envValue("BRIDGE_RECEIVER") ?? raw.receiverContractAddress
    ),
  };
}

class ConsoleInput {
  private buffer = "";
  private lines: string[] = [];
  private waiters: Array<(line: string | null) => void> = [];
  private ended = false;

  constructor() {
    const stdin = process.stdin as unknown as StdinLike;
    stdin.setEncoding("utf8");
    stdin.on("data", (chunk: string | Buffer) => this.receive(String(chunk)));
    stdin.on("end", () => this.finish());
    stdin.on("error", () => this.finish());
    stdin.resume();
  }

  private receive(chunk: string): void {
    this.buffer += chunk;
    let newline = this.buffer.indexOf("\n");
    while (newline !== -1) {
      const line = this.buffer.slice(0, newline).replace(/\r$/, "");
      this.buffer = this.buffer.slice(newline + 1);
      this.deliver(line);
      newline = this.buffer.indexOf("\n");
    }
  }

  private deliver(line: string): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(line);
      return;
    }
    this.lines.push(line);
  }

  private finish(): void {
    if (this.ended) return;
    this.ended = true;
    if (this.buffer.length > 0) {
      const line = this.buffer.replace(/\r$/, "");
      this.buffer = "";
      this.deliver(line);
    }
    for (const waiter of this.waiters.splice(0)) waiter(null);
  }

  async question(prompt: string): Promise<string | null> {
    (process.stdout as unknown as StdoutLike).write(prompt);
    const queued = this.lines.shift();
    if (queued !== undefined) return queued;
    if (this.ended) return null;
    return new Promise(resolvePromise => this.waiters.push(resolvePromise));
  }
}

async function askTrackingId(input: ConsoleInput): Promise<string> {
  const raw = await input.question("Tracking ID: ");
  if (raw === null) throw new DemoError("No tracking ID was provided.");

  const trackingId = raw.trim().toUpperCase();
  if (trackingId.length === 0) throw new DemoError("Tracking ID is required.");
  if (!TRACKING_ID_PATTERN.test(trackingId)) {
    throw new DemoError(
      "Invalid tracking ID format. Use 4-64 letters, numbers, hyphens or underscores."
    );
  }
  return trackingId;
}

async function askFinalStatus(input: ConsoleInput): Promise<FinalStatus> {
  while (true) {
    const raw = await input.question("Final status (DELIVERED/LOST): ");
    if (raw === null) throw new DemoError("No final status was provided.");

    const status = raw.trim().toUpperCase();
    if (status === "DELIVERED" || status === "LOST") return status;
    log("  Enter exactly DELIVERED or LOST.");
  }
}

async function confirmRun(input: ConsoleInput): Promise<boolean> {
  while (true) {
    const raw = await input.question("Continue? [y/N]: ");
    if (raw === null) throw new DemoError("Confirmation was not provided.");

    const answer = raw.trim().toLowerCase();
    if (answer === "y" || answer === "yes") return true;
    if (answer === "n" || answer === "no" || answer.length === 0) return false;
    log("  Enter y or n.");
  }
}

function isShipment(value: unknown): value is Shipment {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.trackingId === "string" &&
    typeof record.orderId === "string" &&
    typeof record.sellerAddress === "string" &&
    typeof record.status === "string" &&
    typeof record.createdAt === "string" &&
    typeof record.updatedAt === "string"
  );
}

async function fetchShipments(config: RuntimeConfig): Promise<Shipment[]> {
  const url = `${config.shipmentApiBaseUrl}${config.shipmentApiPath}`;
  let response: Response;

  try {
    response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    throw new DemoError(`Cannot reach the shipment API at ${url}: ${describeError(error)}`);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new DemoError(
      `GET ${url} failed with ${response.status}${detail ? `: ${detail}` : ""}`
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new DemoError(`GET ${url} returned non-JSON data.`);
  }

  const rawShipments = Array.isArray(body)
    ? body
    : body && typeof body === "object" && Array.isArray((body as { shipments?: unknown }).shipments)
      ? (body as { shipments: unknown[] }).shipments
      : null;

  if (!rawShipments) {
    throw new DemoError(`GET ${url} did not return a shipments list.`);
  }

  for (const value of rawShipments) {
    if (!isShipment(value)) {
      throw new DemoError(`GET ${url} returned a shipment with an unexpected shape.`);
    }
  }
  return rawShipments;
}

function findExactShipment(shipments: Shipment[], trackingId: string): Shipment {
  const matches = shipments.filter(
    shipment => shipment.trackingId.trim().toUpperCase() === trackingId
  );

  if (matches.length === 0) {
    throw new DemoError(`No shipment exists for tracking ID ${trackingId}.`);
  }

  if (matches.length > 1) {
    log(`Multiple shipments match ${trackingId}:`);
    for (const shipment of matches) {
      log(`  ${shipment.trackingId}  ${shipment.orderId}  ${shipment.status}`);
    }
    throw new DemoError("Refusing to guess which shipment to settle.");
  }

  return matches[0];
}

function shipmentOrderId(shipment: Shipment): string {
  if (!ORDER_ID_PATTERN.test(shipment.orderId)) {
    throw new DemoError(
      `Shipment ${shipment.trackingId} has an invalid order ID: ${shipment.orderId}`
    );
  }
  return shipment.orderId.toLowerCase();
}

function validateChoice(
  shipment: Shipment,
  finalStatus: FinalStatus,
  shipments: Shipment[],
  orderId: string
): void {
  const status = shipment.status.trim().toUpperCase();

  if (status === "RETURNED") {
    throw new DemoError(
      `Shipment ${shipment.trackingId} is RETURNED and requires manual review. Nothing was run.`
    );
  }

  if (!ACTIVE_STATUSES.has(status) && !TERMINAL_STATUSES.has(status)) {
    throw new DemoError(
      `Shipment ${shipment.trackingId} has unsupported status ${shipment.status}. Nothing was run.`
    );
  }

  if (TERMINAL_STATUSES.has(status) && finalStatus !== status) {
    throw new DemoError(
      `Shipment ${shipment.trackingId} is already ${status}; requested ${finalStatus} conflicts with it. Nothing was run.`
    );
  }

  const selectedTrackingId = shipment.trackingId.trim().toUpperCase();
  const prefixMatches = shipments.filter(other => {
    const otherTrackingId = other.trackingId.trim().toUpperCase();
    return (
      otherTrackingId !== selectedTrackingId &&
      otherTrackingId.startsWith(selectedTrackingId)
    );
  });
  if (prefixMatches.length > 0) {
    log("Other shipments share the selected tracking-ID prefix:");
    for (const other of prefixMatches) {
      log(`  ${other.trackingId}  ${other.status}`);
    }
    throw new DemoError(
      "Refusing to run: COURIER_MANAGE_PREFIX is prefix-based and could touch another shipment."
    );
  }

  const duplicateOrders = shipments.filter(
    other =>
      other.trackingId !== shipment.trackingId &&
      other.orderId.toLowerCase() === orderId
  );
  if (duplicateOrders.length > 0) {
    throw new DemoError(
      `Another shipment already references order ${orderId}. Refusing to run.`
    );
  }
}

async function readEscrow(
  client: PublicClient,
  config: RuntimeConfig,
  orderId: Hex
): Promise<EscrowSnapshot | null> {
  let raw: unknown;
  try {
    raw = await client.readContract({
      address: config.escrowContractAddress,
      abi: ESCROW_ABI,
      functionName: "getEscrow",
      args: [orderId],
    });
  } catch (error) {
    if (/revert|EscrowNotFound/i.test(describeError(error))) return null;
    throw new DemoError(`Cannot read escrow ${orderId}: ${describeError(error)}`);
  }

  let snapshot: EscrowSnapshot;
  if (Array.isArray(raw)) {
    const tuple = raw as readonly unknown[];
    snapshot = {
      orderId: String(tuple[0]),
      buyer: getAddress(String(tuple[1])),
      seller: getAddress(String(tuple[2])),
      amount: BigInt(String(tuple[3])),
      status: Number(tuple[6]),
    };
  } else {
    const struct = raw as {
      orderId?: unknown;
      buyer?: unknown;
      seller?: unknown;
      amount?: unknown;
      status?: unknown;
    };
    snapshot = {
      orderId: String(struct.orderId),
      buyer: getAddress(String(struct.buyer)),
      seller: getAddress(String(struct.seller)),
      amount: BigInt(String(struct.amount)),
      status: Number(struct.status),
    };
  }

  if (snapshot.status === 0) return null;
  if (snapshot.orderId.toLowerCase() !== orderId.toLowerCase()) {
    throw new DemoError(
      `Escrow returned order ${snapshot.orderId}, expected ${orderId}. Refusing to continue.`
    );
  }
  return snapshot;
}

async function readOrderSettled(
  client: PublicClient,
  config: RuntimeConfig,
  orderId: Hex
): Promise<boolean> {
  try {
    return await client.readContract({
      address: config.receiverContractAddress,
      abi: RECEIVER_ABI,
      functionName: "orderSettled",
      args: [orderId],
    });
  } catch (error) {
    throw new DemoError(
      `Cannot read receiver.orderSettled(${orderId}): ${describeError(error)}`
    );
  }
}

async function preflight(
  config: RuntimeConfig,
  orderId: string
): Promise<Preflight> {
  const client = createPublicClient({
    transport: http(config.rpcUrl, { timeout: 15_000 }),
  });

  let chainId: number;
  try {
    chainId = await client.getChainId();
  } catch (error) {
    throw new DemoError(`Cannot reach the RPC at ${config.rpcUrl}: ${describeError(error)}`);
  }

  if (chainId !== config.chainId) {
    throw new DemoError(
      `RPC reports chain ${chainId}, but the demo is configured for ${config.chainId}. Refusing to continue.`
    );
  }

  let receiverCode: Hex | undefined;
  let escrowCode: Hex | undefined;
  try {
    [receiverCode, escrowCode] = await Promise.all([
      client.getCode({ address: config.receiverContractAddress }),
      client.getCode({ address: config.escrowContractAddress }),
    ]);
  } catch (error) {
    throw new DemoError(`Cannot read contract bytecode: ${describeError(error)}`);
  }

  if (!receiverCode || receiverCode === "0x") {
    throw new DemoError(
      `No receiver bytecode at ${config.receiverContractAddress}. Refusing to continue.`
    );
  }
  if (!escrowCode || escrowCode === "0x") {
    throw new DemoError(
      `No escrow bytecode at ${config.escrowContractAddress}. Refusing to continue.`
    );
  }

  const orderIdHex = orderId as Hex;
  const escrow = await readEscrow(client, config, orderIdHex);
  if (!escrow) {
    throw new DemoError(`No escrow exists on-chain for order ${orderId}.`);
  }

  const receiverSettled = await readOrderSettled(client, config, orderIdHex);
  return { client, escrow, receiverSettled };
}

function expectedEscrowStatus(finalStatus: FinalStatus): number {
  return finalStatus === "DELIVERED" ? 2 : 3;
}

function chooseRoute(
  shipment: Shipment,
  finalStatus: FinalStatus,
  preflightResult: Preflight
): SelectedRoute {
  const status = shipment.status.trim().toUpperCase();
  const { escrow, receiverSettled } = preflightResult;
  const escrowLabel = ESCROW_STATUS_LABELS[escrow.status] ?? `Unknown(${escrow.status})`;
  const expectedStatus = expectedEscrowStatus(finalStatus);

  if (TERMINAL_STATUSES.has(status)) {
    if (receiverSettled || escrow.status === 2 || escrow.status === 3) {
      if (escrow.status !== expectedStatus) {
        throw new DemoError(
          `Shipment is ${status}, but the escrow is ${escrowLabel}. ` +
            `Expected ${ESCROW_STATUS_LABELS[expectedStatus]}. Refusing to run.`
        );
      }
      return { kind: "already-settled" };
    }

    if (escrow.status !== 1) {
      throw new DemoError(
        `Escrow is ${escrowLabel}, not Funded. Nothing can be settled.`
      );
    }

    return { kind: "run", mode: "direct" };
  }

  if (receiverSettled) {
    throw new DemoError(
      `Receiver already settled this order while the shipment is ${status}. Refusing to run.`
    );
  }

  if (escrow.status !== 1) {
    throw new DemoError(
      `Escrow is ${escrowLabel}, not Funded. Refusing to advance the shipment.`
    );
  }

  return { kind: "run", mode: "scheduler" };
}

function childEnvironment(
  config: RuntimeConfig,
  orderId: string,
  extras: Record<string, string>
): Record<string, string | undefined> {
  return {
    ...process.env,
    HARDHAT_RPC_URL: config.rpcUrl,
    BRIDGE_EXPECTED_CHAIN_ID: String(config.chainId),
    BRIDGE_ESCROW: config.escrowContractAddress,
    BRIDGE_RECEIVER: config.receiverContractAddress,
    LOCAL_BRIDGE_DRY_RUN: "false",
    BRIDGE_ORDER_ALLOWLIST: orderId,
    ...extras,
  };
}

function schedulerEnvironment(
  config: RuntimeConfig,
  shipment: Shipment,
  orderId: string,
  finalStatus: FinalStatus
): Record<string, string | undefined> {
  return childEnvironment(config, orderId, {
    COURIER_API_BASE: config.shipmentApiBaseUrl,
    COURIER_MANAGE_PREFIX: shipment.trackingId,
    COURIER_FINAL_STATUS: finalStatus,
    COURIER_SHIPPED_AFTER_MS: COURIER_DELAY_MS,
    COURIER_IN_TRANSIT_AFTER_MS: COURIER_DELAY_MS,
    COURIER_FINAL_AFTER_MS: COURIER_DELAY_MS,
    COURIER_POLL_MS: "1000",
    COURIER_RUN_BRIDGE: "true",
    COURIER_RUN_SECONDS: String(SCHEDULER_RUN_SECONDS),
    COURIER_ONCE: "false",
    COURIER_BRIDGE_CMD: process.execPath,
  });
}

async function relayLines(
  stream: AsyncIterable<Uint8Array>,
  onLine: (line: string) => void
): Promise<void> {
  const decoder = new TextDecoder();
  let buffered = "";

  for await (const chunk of stream) {
    buffered += decoder.decode(chunk, { stream: true });
    const lines = buffered.split(/\r?\n/);
    buffered = lines.pop() ?? "";
    for (const line of lines) onLine(line);
  }

  buffered += decoder.decode();
  if (buffered.length > 0) onLine(buffered);
}

async function runScript(
  config: RuntimeConfig,
  shipment: Shipment,
  orderId: string,
  finalStatus: FinalStatus,
  mode: DemoMode
): Promise<ChildRun> {
  const script = mode === "scheduler" ? "courier-scheduler.ts" : "local-runner.ts";
  const env =
    mode === "scheduler"
      ? schedulerEnvironment(config, shipment, orderId, finalStatus)
      : childEnvironment(config, orderId, {});

  log("");
  log(`Running ${script} ...`);
  if (mode === "scheduler") {
    log(`The courier scheduler may run for up to ${SCHEDULER_RUN_SECONDS} seconds.`);
  }

  let child: BunChild;
  try {
    child = bunRuntime().spawn({
      cmd: [process.execPath, script],
      cwd: HERE,
      env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      detached: useProcessGroups(),
    });
  } catch (error) {
    throw new DemoError(`Failed to start ${script}: ${describeError(error)}`);
  }

  activeChild = child;
  const result: ChildRun = {
    exitCode: 1,
    txHash: null,
    blockNumber: null,
    statusChanges: [],
  };

  const parseLine = (line: string): void => {
    const clean = line.replace(ANSI_PATTERN, "");
    log(line);

    const transaction = clean.match(
      /submitted tx (0x[0-9a-fA-F]{64}) in block (\d+)/
    );
    if (transaction) {
      result.txHash = transaction[1];
      result.blockNumber = transaction[2];
    }

    const change = clean.match(/\[courier\]\s+(\S+):\s+(\S+)\s+->\s+(\S+)/);
    if (change) {
      result.statusChanges.push(`${change[1]}: ${change[2]} -> ${change[3]}`);
    }
  };

  const stdoutTask = child.stdout
    ? relayLines(child.stdout, parseLine)
    : Promise.resolve();
  const stderrTask = child.stderr
    ? relayLines(child.stderr, parseLine)
    : Promise.resolve();

  try {
    result.exitCode = await child.exited;
  } catch (error) {
    throw new DemoError(`${script} failed to start: ${describeError(error)}`);
  } finally {
    await Promise.allSettled([stdoutTask, stderrTask]);
    if (activeChild === child) activeChild = null;
  }

  if (result.exitCode !== 0) {
    throw new DemoError(`${script} exited with code ${result.exitCode}.`);
  }

  return result;
}

async function verifySettlement(
  config: RuntimeConfig,
  preflightResult: Preflight,
  orderId: string,
  finalStatus: FinalStatus
): Promise<EscrowSnapshot> {
  const orderIdHex = orderId as Hex;
  const receiverSettled = await readOrderSettled(
    preflightResult.client,
    config,
    orderIdHex
  );
  if (!receiverSettled) {
    throw new DemoError(
      "The workflow finished, but receiver.orderSettled(orderId) is still false. No settlement occurred."
    );
  }

  const escrow = await readEscrow(preflightResult.client, config, orderIdHex);
  if (!escrow) {
    throw new DemoError("The workflow finished, but the escrow could not be read.");
  }

  const expectedStatus = expectedEscrowStatus(finalStatus);
  if (escrow.status !== expectedStatus) {
    throw new DemoError(
      `Receiver reports settlement, but the escrow is ${ESCROW_STATUS_LABELS[escrow.status] ?? escrow.status}; ` +
        `expected ${ESCROW_STATUS_LABELS[expectedStatus]}.`
    );
  }

  return escrow;
}

function printHeader(config: RuntimeConfig): void {
  log("ProofPay settlement demo");
  log(`  Shipment API: ${config.shipmentApiBaseUrl}${config.shipmentApiPath}`);
  log(`  RPC:          ${config.rpcUrl} (chain ${config.chainId})`);
  log(`  Escrow:       ${config.escrowContractAddress}`);
  log(`  Receiver:     ${config.receiverContractAddress}`);
  log("");
}

async function main(): Promise<number> {
  const rawConfig = stagingConfig as RawConfig;
  const config = resolveConfig(rawConfig);
  const input = new ConsoleInput();

  printHeader(config);
  const trackingId = await askTrackingId(input);
  const shipments = await fetchShipments(config);
  const shipment = findExactShipment(shipments, trackingId);
  const orderId = shipmentOrderId(shipment);

  log(`Found ${shipment.trackingId} (${shipment.status}) for ${orderId}`);
  const finalStatus = await askFinalStatus(input);
  validateChoice(shipment, finalStatus, shipments, orderId);

  log("");
  log("Preflight");
  const preflightResult = await preflight(config, orderId);
  const escrowLabel =
    ESCROW_STATUS_LABELS[preflightResult.escrow.status] ??
    `Unknown(${preflightResult.escrow.status})`;
  log(`  escrow status:  ${escrowLabel}`);
  log(`  receiver:       ${preflightResult.receiverSettled ? "already settled" : "not settled"}`);

  const route = chooseRoute(shipment, finalStatus, preflightResult);
  if (route.kind === "already-settled") {
    log("");
    log("Nothing to do");
    log(`  ${shipment.trackingId} is already ${shipment.status}.`);
    log(`  Escrow: ${escrowLabel}.`);
    log("  No workflow was started and no transaction was sent.");
    return 0;
  }

  log("");
  log("Ready to run");
  log(`  Tracking:   ${shipment.trackingId}`);
  log(`  Order:      ${orderId}`);
  log(`  Current:    ${shipment.status}`);
  log(`  Final:      ${finalStatus}`);
  log(`  Workflow:   ${route.mode === "scheduler" ? "courier scheduler, then local bridge" : "local CRE bridge"}`);
  log(`  Allowlist:  ${orderId} (only this order may settle)`);
  log("  Mode:       LIVE - this will submit an on-chain settlement transaction");

  const confirmed = await confirmRun(input);
  if (!confirmed) {
    log("Cancelled. No workflow was started and no transaction was sent.");
    return 0;
  }

  const run = await runScript(config, shipment, orderId, finalStatus, route.mode);

  if (route.mode === "scheduler") {
    const refreshed = findExactShipment(await fetchShipments(config), trackingId);
    if (refreshed.status !== finalStatus) {
      throw new DemoError(
        `Scheduler finished, but shipment ${trackingId} is ${refreshed.status}, not ${finalStatus}.`
      );
    }
  }

  const escrow = await verifySettlement(
    config,
    preflightResult,
    orderId,
    finalStatus
  );

  log("");
  log("Settlement complete");
  log(`  Tracking:   ${shipment.trackingId}`);
  log(`  Order:      ${orderId}`);
  log(`  Final:      ${finalStatus}`);
  log(`  Escrow:     ${ESCROW_STATUS_LABELS[escrow.status] ?? escrow.status}`);
  if (run.txHash) log(`  Transaction: ${run.txHash}`);
  if (run.blockNumber) log(`  Block:       ${run.blockNumber}`);
  if (run.statusChanges.length > 0) {
    log("  Status path:");
    for (const change of run.statusChanges) log(`    ${change}`);
  }

  return 0;
}

async function handleInterrupt(): Promise<void> {
  if (interrupting) return;
  interrupting = true;
  log("");
  log("Interrupted. Stopping the child process...");

  const child = activeChild;
  if (child) {
    signalChild(child, "SIGINT");
    await Promise.race([child.exited.catch(() => 1), sleep(4_000)]);
    signalChild(child, "SIGKILL");
  }

  await cleanupStaleLocks();
  process.exit(130);
}

process.on("SIGINT", () => {
  void handleInterrupt();
});

main()
  .then(code => process.exit(code))
  .catch(error => {
    log("");
    log(`✗ ${describeError(error)}`);
    if (!(error instanceof DemoError) && error instanceof Error && error.stack) {
      log(error.stack);
    }
    process.exit(1);
  });

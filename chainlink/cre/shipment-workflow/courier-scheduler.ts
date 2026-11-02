#!/usr/bin/env bun
/**
 * Demo courier scheduler: advances PPD- shipments through
 * CREATED -> SHIPPED -> IN_TRANSIT -> DELIVERED|LOST, then runs the CRE workflow
 * and the local bridge. It never touches the contracts, never decides settlement
 * and never submits a transaction itself.
 *
 * The final outcome is a courier fact, not a payment decision. It is chosen in
 * this order:
 *   1. COURIER_FINAL_STATUS=DELIVERED|LOST, when set, wins for every shipment;
 *   2. otherwise a tracking ID ending in "-LOST" ends in LOST;
 *   3. otherwise the outcome is DELIVERED (the default).
 * Terminal shipments (DELIVERED, LOST, RETURNED) are never touched. Only
 * shipments whose tracking ID starts with COURIER_MANAGE_PREFIX are advanced.
 *
 *   bun courier-scheduler.ts                          run until Ctrl+C
 *   COURIER_RUN_SECONDS=60 bun courier-scheduler.ts    bounded run
 *   COURIER_ONCE=true bun courier-scheduler.ts         single tick
 *   COURIER_FINAL_STATUS=LOST bun courier-scheduler.ts force the LOST outcome
 */

import { spawn } from "node:child_process";
import { open, readFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const LOCK_FILE = resolve(HERE, "..", ".courier-scheduler.lock");

type ShipmentStatus = "CREATED" | "SHIPPED" | "IN_TRANSIT" | "DELIVERED" | "LOST" | "RETURNED";

type Shipment = {
  trackingId: string;
  orderId: string;
  status: ShipmentStatus | string;
  createdAt: string;
  updatedAt: string;
};

const FINAL_OUTCOMES = ["DELIVERED", "LOST"] as const;
type FinalOutcome = (typeof FINAL_OUTCOMES)[number];

type Config = {
  apiBase: string;
  managePrefix: string;
  /** Explicit final hop; null keeps the tracking-ID suffix rule. */
  finalStatus: FinalOutcome | null;
  delays: { shipped: number; inTransit: number; final: number };
  pollMs: number;
  runBridge: boolean;
  runSeconds: number;
  once: boolean;
  bridgeCommand: string;
  bridgeDryRun: boolean;
};

class SchedulerError extends Error {}

// ---------------------------------------------------------------------------
// Configuration helpers
// ---------------------------------------------------------------------------

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new SchedulerError(`${name} must be a non-negative number, got "${raw}"`);
  }
  return value;
}

function envFlag(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  throw new SchedulerError(`${name} must be a boolean (true/false), got "${raw}"`);
}

function envFinalOutcome(name: string): FinalOutcome | null {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return null;
  const value = raw.trim().toUpperCase();
  if (!(FINAL_OUTCOMES as readonly string[]).includes(value)) {
    throw new SchedulerError(`${name} must be one of ${FINAL_OUTCOMES.join(", ")}, got "${raw}"`);
  }
  return value as FinalOutcome;
}

function loadConfig(): Config {
  return {
    apiBase: (process.env.COURIER_API_BASE ?? "http://localhost:5001").replace(/\/+$/, ""),
    managePrefix: process.env.COURIER_MANAGE_PREFIX ?? "PPD-",
    finalStatus: envFinalOutcome("COURIER_FINAL_STATUS"),
    delays: {
      shipped: envNumber("COURIER_SHIPPED_AFTER_MS", 10_000),
      inTransit: envNumber("COURIER_IN_TRANSIT_AFTER_MS", 10_000),
      final: envNumber("COURIER_FINAL_AFTER_MS", 20_000),
    },
    pollMs: envNumber("COURIER_POLL_MS", 3_000),
    runBridge: envFlag("COURIER_RUN_BRIDGE", true),
    runSeconds: envNumber("COURIER_RUN_SECONDS", 0),
    once: envFlag("COURIER_ONCE", false),
    bridgeCommand: process.env.COURIER_BRIDGE_CMD ?? "bun",
    // Same default as the bridge: never submit unless explicitly enabled.
    bridgeDryRun: envFlag("LOCAL_BRIDGE_DRY_RUN", true),
  };
}

function log(message = ""): void {
  console.log(message);
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message.split("\n")[0];
  return String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise(done => setTimeout(done, ms));
}

// ---------------------------------------------------------------------------
// Courier timeline (pure functions, no settlement logic)
// ---------------------------------------------------------------------------

/** Milliseconds a shipment must sit in its current status before advancing. */
function delayFor(status: string, config: Config): number | null {
  switch (status) {
    case "CREATED":
      return config.delays.shipped;
    case "SHIPPED":
      return config.delays.inTransit;
    case "IN_TRANSIT":
      return config.delays.final;
    default:
      return null;
  }
}

/**
 * Courier-only transition. The final hop is a delivery fact reported by the
 * dummy courier, not a payment decision.
 */
function nextStatus(status: string, trackingId: string, config: Config): ShipmentStatus | null {
  switch (status) {
    case "CREATED":
      return "SHIPPED";
    case "SHIPPED":
      return "IN_TRANSIT";
    case "IN_TRANSIT":
      if (config.finalStatus) return config.finalStatus;
      return trackingId.toUpperCase().endsWith("-LOST") ? "LOST" : "DELIVERED";
    default:
      return null;
  }
}

const EVENT_TEXT: Record<string, string> = {
  SHIPPED: "Auto courier: package dispatched.",
  IN_TRANSIT: "Auto courier: package is in transit.",
  DELIVERED: "Auto courier: package delivered.",
  LOST: "Auto courier: package reported lost.",
};

// ---------------------------------------------------------------------------
// Backend API (existing endpoints and validation rules)
// ---------------------------------------------------------------------------

async function listShipments(config: Config): Promise<Shipment[]> {
  const response = await fetch(`${config.apiBase}/api/shipments`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new SchedulerError(`GET /api/shipments failed with ${response.status}`);
  }
  const body = (await response.json()) as { shipments?: Shipment[] } | Shipment[];
  if (Array.isArray(body)) return body;
  return body.shipments ?? [];
}

async function patchStatus(
  config: Config,
  trackingId: string,
  status: ShipmentStatus
): Promise<Shipment> {
  const response = await fetch(
    `${config.apiBase}/api/shipments/${encodeURIComponent(trackingId)}/status`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, description: EVENT_TEXT[status] }),
      signal: AbortSignal.timeout(10_000),
    }
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new SchedulerError(`PATCH ${trackingId} -> ${status} failed with ${response.status} ${detail}`);
  }
  return (await response.json()) as Shipment;
}

// ---------------------------------------------------------------------------
// Bridge invocation (existing local-runner.ts, never inlined)
// ---------------------------------------------------------------------------

function runBridge(config: Config): Promise<number> {
  log(`  [bridge] ${config.bridgeCommand} local-runner.ts (${config.bridgeDryRun ? "dry run" : "LIVE"})`);

  return new Promise(done => {
    const child = spawn(config.bridgeCommand, ["local-runner.ts"], {
      cwd: HERE,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let buffered = "";
    let timedOut = false;

    const relay = (chunk: Buffer): void => {
      buffered += chunk.toString("utf8");
      const parts = buffered.split(/\r?\n/);
      buffered = parts.pop() ?? "";
      for (const line of parts) {
        if (line.trim().length > 0) log(`  [bridge] ${line}`);
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
    }, 300_000);

    child.stdout?.on("data", relay);
    child.stderr?.on("data", relay);

    child.on("error", error => {
      clearTimeout(timer);
      log(`  [bridge] failed to start: ${describeError(error)}`);
      done(1);
    });

    child.on("close", code => {
      clearTimeout(timer);
      if (buffered.trim().length > 0) log(`  [bridge] ${buffered.trim()}`);
      log(`  [bridge] finished with exit code ${code}${timedOut ? " (timed out)" : ""}`);
      done(timedOut ? 1 : (code ?? 1));
    });
  });
}

// ---------------------------------------------------------------------------
// One scheduler tick
// ---------------------------------------------------------------------------

// Idle ticks are collapsed into a single line so a long demo run does not flood
// the console while shipments are still waiting on their next transition.
let lastIdleSignature: string | null = null;

function logIdleOnce(signature: string, message: string): void {
  if (lastIdleSignature === signature) return;
  lastIdleSignature = signature;
  log(message);
}

async function tick(config: Config): Promise<number> {
  const shipments = await listShipments(config);
  const managed = shipments.filter(shipment => shipment.trackingId.startsWith(config.managePrefix));
  const now = Date.now();

  const due = managed
    .filter(shipment => {
      const delay = delayFor(shipment.status, config);
      if (delay === null) return false;
      return now - new Date(shipment.updatedAt).getTime() >= delay;
    })
    .sort((a, b) => a.trackingId.localeCompare(b.trackingId));

  const pending = managed.filter(shipment => delayFor(shipment.status, config) !== null);
  if (pending.length === 0) {
    logIdleOnce("no-managed", `[courier] no managed shipments in flight (${managed.length} managed)`);
    return 0;
  }
  if (due.length === 0) {
    const waiting = pending
      .map(s => `${s.trackingId}=${s.status}`)
      .join(", ");
    logIdleOnce(`waiting:${waiting}`, `[courier] waiting: ${waiting}`);
    return 0;
  }
  lastIdleSignature = null;

  let updates = 0;
  for (const shipment of due) {
    const target = nextStatus(shipment.status, shipment.trackingId, config);
    if (!target) continue;
    try {
      const updated = await patchStatus(config, shipment.trackingId, target);
      log(`[courier] ${shipment.trackingId}: ${shipment.status} -> ${updated.status}`);
      updates++;
    } catch (error) {
      log(`[courier] ${shipment.trackingId}: update failed - ${describeError(error)}`);
    }
  }

  if (updates > 0 && config.runBridge) {
    log(`[courier] ${updates} update(s); starting CRE workflow + local bridge`);
    await runBridge(config);
  }

  return updates;
}

// ---------------------------------------------------------------------------
// Single-instance lock
// ---------------------------------------------------------------------------

let releaseLock: (() => Promise<void>) | null = null;

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

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
      throw new SchedulerError(`Cannot create lock ${file}: ${describeError(error)}`);
    }
    const existing = (await readFile(file, "utf8").catch(() => "")).trim();
    let holderPid = 0;
    try {
      holderPid = Number(JSON.parse(existing).pid ?? 0);
    } catch {
      holderPid = 0;
    }
    if (holderPid > 0 && isProcessAlive(holderPid)) {
      throw new SchedulerError(`Another courier scheduler is running (pid ${holderPid}).`);
    }
    log(`! Removing stale scheduler lock left by pid ${holderPid || "unknown"}.`);
    await unlink(file).catch(() => undefined);
    await write();
  }

  releaseLock = async () => {
    await unlink(file).catch(() => undefined);
    releaseLock = null;
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<number> {
  const config = loadConfig();

  log("ProofPay demo courier scheduler");
  log(`  API:          ${config.apiBase}`);
  log(`  Managed IDs:  tracking IDs starting with "${config.managePrefix}"`);
  log(
    `  Timeline:     CREATED -${config.delays.shipped}ms-> SHIPPED -${config.delays.inTransit}ms-> ` +
      `IN_TRANSIT -${config.delays.final}ms-> DELIVERED|LOST`
  );
  log(`  Poll:         ${config.pollMs}ms${config.runSeconds > 0 ? `, stops after ${config.runSeconds}s` : ", runs until Ctrl+C"}`);
  log(`  Bridge:       ${config.runBridge ? "run after each update" : "disabled (COURIER_RUN_BRIDGE=false)"}`);
  log(
    `  Settlement:   ${config.bridgeDryRun ? "DRY RUN - no transaction will be sent" : "LIVE - bridge may submit transactions"}`
  );
  log("                (CRE dryRun stays true; the bridge decides nothing)");
  log(
    config.finalStatus
      ? `  Final status: ${config.finalStatus} (COURIER_FINAL_STATUS; overrides the "-LOST" tracking-ID suffix)`
      : `  Final status: DELIVERED unless the tracking ID ends in "-LOST" (set COURIER_FINAL_STATUS to force one)`
  );
  log("");

  await acquireLock(LOCK_FILE);

  const deadline = config.runSeconds > 0 ? Date.now() + config.runSeconds * 1_000 : null;
  const stop = async (): Promise<void> => {
    if (releaseLock) await releaseLock();
  };

  process.on("SIGINT", () => {
    void stop().then(() => process.exit(0));
  });

  try {
    let tickNumber = 0;
    while (true) {
      tickNumber++;
      try {
        await tick(config);
      } catch (error) {
        log(`[scheduler] tick ${tickNumber} error: ${describeError(error)}`);
      }

      if (config.once) break;
      if (deadline !== null && Date.now() >= deadline) {
        log("[scheduler] run window elapsed; stopping");
        break;
      }
      await sleep(config.pollMs);
    }
    return 0;
  } finally {
    await stop();
  }
}

main()
  .then(code => process.exit(code))
  .catch(error => {
    log("");
    log(`✗ ${error instanceof SchedulerError ? error.message : describeError(error)}`);
    process.exit(1);
  });

import {
  CronCapability,
  EVMClient,
  HTTPClient,
  LAST_FINALIZED_BLOCK_NUMBER,
  REPORT_METADATA_HEADER_LENGTH,
  Runner,
  bytesToHex,
  consensusIdenticalAggregation,
  encodeCallMsg,
  getNetwork,
  handler,
  ok,
  prepareReportRequest,
  text,
  type HTTPSendRequester,
  type Runtime,
} from "@chainlink/cre-sdk";
import {
  type Address,
  type Hex,
  decodeAbiParameters,
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  parseAbiParameters,
  toHex,
  zeroAddress,
} from "viem";

export type Config = {
  shipmentApiBaseUrl: string;
  shipmentApiPath: string;
  rpcUrl: string;
  chainId: number;
  escrowContractAddress: string;
  receiverContractAddress: string;
  forwarderAddress: string;
  dryRun: boolean;
};

const ESCROW_STATUS_FUNDED = 1;

const ESCROW_ABI = [
  {
    type: "function",
    name: "getEscrow",
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
    stateMutability: "view",
  },
] as const;

type SettlementAction = "RELEASE" | "REFUND" | "NONE" | "MANUAL_REVIEW";

interface SettlementDecision {
  action: SettlementAction;
  reason: string;
  outcome?: "DELIVERED" | "LOST";
}

function shouldSettle(shipment: { status: string }): SettlementDecision {
  switch (shipment.status) {
    case "DELIVERED":
      return {
        action: "RELEASE",
        reason: "Shipment delivered - eligible for seller payment",
        outcome: "DELIVERED",
      };
    case "LOST":
      return {
        action: "REFUND",
        reason: "Shipment lost - eligible for buyer refund",
        outcome: "LOST",
      };
    case "IN_TRANSIT":
    case "SHIPPED":
      return {
        action: "NONE",
        reason: "Shipment in transit/shipped - payment remains locked",
      };
    case "RETURNED":
      return {
        action: "MANUAL_REVIEW",
        reason: "Returned after delivery - requires manual review",
      };
    case "CREATED":
      return {
        action: "NONE",
        reason: "Shipment just registered - not ready for settlement",
      };
    default:
      return {
        action: "NONE",
        reason: `Unknown shipment status: ${shipment.status}`,
      };
  }
}

/**
 * Prefix for the structured, machine-readable report line.
 * The local execution bridge (local-runner.ts) parses ONLY lines starting with this prefix.
 */
const REPORT_LOG_PREFIX = "PROOFPAY_REPORT_V1:";

const SETTLEMENT_REPORT_ABI = parseAbiParameters("bytes32, string, bytes32, string");

/**
 * Checks that a byte slice is the ABI-encoded settlement payload the receiver expects,
 * i.e. abi.decode(report, (bytes32, string, bytes32, string)) yields our order/outcome.
 */
function isExpectedAbiPayload(
  bytes: Uint8Array,
  orderIdBytes32: Hex,
  outcome: string
): boolean {
  try {
    const [decodedOrderId, decodedOutcome] = decodeAbiParameters(
      SETTLEMENT_REPORT_ABI,
      bytesToHex(bytes)
    );
    return (
      typeof decodedOrderId === "string" &&
      decodedOrderId.toLowerCase() === orderIdBytes32.toLowerCase() &&
      decodedOutcome === outcome
    );
  } catch {
    return false;
  }
}

/**
 * Extracts the raw ABI payload from the CRE report object.
 *
 * Report.rawReport() is a 109-byte CRE metadata header followed by the encoded payload.
 * ProofPayCREReceiver._processReport does abi.decode(report, ...) on the bytes it receives,
 * so the header must be stripped (Report.body()). We only accept a slice that actually
 * decodes to our order and outcome, so a header-less runtime cannot silently lose 109 bytes.
 */
function extractAbiPayload(
  report: { rawReport: () => Uint8Array; body: () => Uint8Array },
  orderIdBytes32: Hex,
  outcome: string
): { payloadHex: Hex; payloadSource: "body" | "rawReport" | "unverified"; creRawReportHex: Hex } {
  const creRawReportHex = bytesToHex(report.rawReport());

  let bodyBytes: Uint8Array | undefined;
  try {
    bodyBytes = report.body();
  } catch {
    bodyBytes = undefined;
  }

  if (bodyBytes && isExpectedAbiPayload(bodyBytes, orderIdBytes32, outcome)) {
    return { payloadHex: bytesToHex(bodyBytes), payloadSource: "body", creRawReportHex };
  }

  const rawBytes = report.rawReport();
  if (isExpectedAbiPayload(rawBytes, orderIdBytes32, outcome)) {
    return { payloadHex: creRawReportHex, payloadSource: "rawReport", creRawReportHex };
  }

  return { payloadHex: creRawReportHex, payloadSource: "unverified", creRawReportHex };
}

function createReportPayload(
  orderId: string,
  outcome: "DELIVERED" | "LOST",
  trackingId: string,
  observedAt: string
): Hex {
  const orderIdHex = orderId.startsWith("0x") ? (orderId as Hex) : (`0x${orderId}` as Hex);
  const orderIdBytes32 = (orderIdHex.padEnd(66, "0").slice(0, 66)) as Hex;
  const trackingIdHash = keccak256(toHex(trackingId));

  return encodeAbiParameters(
    parseAbiParameters("bytes32, string, bytes32, string"),
    [orderIdBytes32, outcome, trackingIdHash, observedAt]
  );
}

const fetchShipments = (
  sendRequester: HTTPSendRequester,
  config: Config
): string => {
  const url = `${config.shipmentApiBaseUrl}${config.shipmentApiPath}`;
  const response = sendRequester.sendRequest({ url, method: "GET" }).result();
  if (!ok(response)) {
    throw new Error(`HTTP request failed with status: ${response.statusCode}`);
  }
  return text(response);
};

const onCronTrigger = async (
  runtime: Runtime<Config>,
  _triggerOutput: unknown
): Promise<string> => {
  const config = runtime.config;
  runtime.log(`ProofPay CRE: Checking shipments from ${config.shipmentApiBaseUrl}`);

  const httpClient = new HTTPClient();
  let responseBody: string;
  try {
    responseBody = httpClient
      .sendRequest(runtime, fetchShipments, consensusIdenticalAggregation<string>())(
        runtime.config
      )
      .result();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    runtime.log(`ProofPay CRE HTTP error: ${message}`);
    return `HTTP error: ${message}`;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(responseBody);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    runtime.log(`Failed to parse shipment API response: ${message}`);
    return `JSON parse error: ${message}`;
  }

  let shipments: any[] = [];
  if (Array.isArray(parsed)) {
    shipments = parsed;
  } else if (
    parsed &&
    typeof parsed === "object" &&
    "shipments" in parsed &&
    Array.isArray((parsed as any).shipments)
  ) {
    shipments = (parsed as any).shipments;
  } else {
    runtime.log("No shipments found in response");
    return "No shipments";
  }

  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName: "ethereum-testnet-sepolia",
    isTestnet: true,
  });
  if (!network) {
    runtime.log("Chain selector not found for ethereum-testnet-sepolia");
    return "Network not found";
  }

  const evmClient = new EVMClient(network.chainSelector.selector);
  let processedCount = 0;

  for (const shipment of shipments) {
    try {
      const decision = shouldSettle(shipment);
      if (decision.action === "NONE" || decision.action === "MANUAL_REVIEW") {
        runtime.log(`Shipment ${shipment.trackingId}: ${decision.reason}`);
        continue;
      }

      if (!decision.outcome) continue;

      const orderIdHex = shipment.orderId.startsWith("0x")
        ? (shipment.orderId as Hex)
        : (`0x${shipment.orderId}` as Hex);
      const orderIdBytes32 = (orderIdHex.padEnd(66, "0").slice(0, 66)) as Hex;

      const callData = encodeFunctionData({
        abi: ESCROW_ABI,
        functionName: "getEscrow",
        args: [orderIdBytes32],
      });

      const callMsg = encodeCallMsg({
        from: zeroAddress,
        to: config.escrowContractAddress as Address,
        data: callData,
      });

      const evmResp = evmClient
        .callContract(runtime, {
          call: callMsg,
          blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
        })
        .result();

      const escrow = decodeFunctionResult({
        abi: ESCROW_ABI,
        functionName: "getEscrow",
        data: bytesToHex(evmResp.data),
      });

      if (escrow.status !== ESCROW_STATUS_FUNDED) {
        runtime.log(
          `Shipment ${shipment.trackingId}: Escrow not funded (status ${escrow.status}), skipping`
        );
        continue;
      }

      runtime.log(`Shipment ${shipment.trackingId}: Generating ${decision.outcome} report`);
      processedCount++;

      if (
        !config.receiverContractAddress ||
        config.receiverContractAddress === "0x0000000000000000000000000000000000000000"
      ) {
        runtime.log(
          `Shipment ${shipment.trackingId}: No receiver configured, report not generated in this run`
        );
        continue;
      }

      // Report generation MUST happen before the dryRun branch, so the local
      // execution bridge can capture the exact bytes CRE produced.
      const observedAt =
        shipment.updatedAt || shipment.createdAt || "2026-11-01T00:00:00.000Z";
      const trackingIdHash = keccak256(toHex(shipment.trackingId));

      const reportPayload = createReportPayload(
        shipment.orderId,
        decision.outcome,
        shipment.trackingId,
        observedAt
      );
      const reportRequest = prepareReportRequest(reportPayload);
      const report = runtime.report(reportRequest).result();

      const { payloadHex, payloadSource, creRawReportHex } = extractAbiPayload(
        report,
        orderIdBytes32,
        decision.outcome
      );

      const creRawReportLength = creRawReportHex.length / 2 - 1;
      const creRawReportHash = keccak256(creRawReportHex);

      // The CRE runtime truncates USER LOG lines at roughly 1 KB, so the report is
      // emitted as two tagged lines that the bridge joins by orderId:
      //   type=report -> the exact bytes for processReport(metadata, report)
      //   type=meta   -> CRE provenance and non-submission context, never submitted
      runtime.log(
        `${REPORT_LOG_PREFIX}${JSON.stringify({
          type: "report",
          orderId: orderIdBytes32,
          outcome: decision.outcome,
          trackingId: shipment.trackingId,
          observedAt,
          metadata: "0x",
          report: payloadHex,
        })}`
      );

      runtime.log(
        `${REPORT_LOG_PREFIX}${JSON.stringify({
          type: "meta",
          orderId: orderIdBytes32,
          action: decision.action,
          trackingIdHash,
          reportSource: payloadSource,
          reportDecodesToReceiverAbi: payloadSource !== "unverified",
          creRawReportLength,
          creMetadataHeaderLength: REPORT_METADATA_HEADER_LENGTH,
          creRawReportHash,
          receiver: config.receiverContractAddress,
          escrow: config.escrowContractAddress,
          creDryRun: config.dryRun,
        })}`
      );

      if (payloadSource === "unverified") {
        runtime.log(
          `Shipment ${shipment.trackingId}: Report bytes do not decode as the receiver ABI payload; bridge must not submit this`
        );
      }

      if (config.dryRun) {
        runtime.log(
          `DRY RUN: Report generated for order ${shipment.orderId}; CRE write skipped`
        );
        continue;
      }

      evmClient
        .writeReport(runtime, {
          receiver: config.receiverContractAddress,
          report: report,
          gasConfig: {
            gasLimit: "1000000",
          },
        })
        .result();

      runtime.log(`Shipment ${shipment.trackingId}: Report submitted on-chain via CRE`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      runtime.log(`Error processing shipment ${shipment.trackingId}: ${message}`);
    }
  }

  return `Processed ${processedCount} settlements`;
};

const initWorkflow = (_config: Config) => {
  const cron = new CronCapability();
  return [
    handler(
      cron.trigger({ schedule: "0 */5 * * * *" }),
      onCronTrigger
    ),
  ];
};

export async function main() {
  const runner = await Runner.newRunner<Config>();
  await runner.run(initWorkflow);
}

main();

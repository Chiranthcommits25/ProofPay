require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { ethers, network } = require("hardhat");

/**
 * Points the escrow's oracle at ProofPayCREReceiver, after verifying the chain,
 * the deployed bytecode and the signer.
 *
 * Addresses are read from the deployment records written by the deploy scripts
 * (or from ESCROW_ADDRESS / RECEIVER_ADDRESS), never hardcoded. An earlier
 * version hardcoded both addresses, so on any fresh chain it aborted with
 * "No deployed receiver contract" and left the escrow pointing at the admin.
 */

const EXPECTED_CHAIN_ID = 31337;

const ESCROW_ABI = [
  "function oracle() view returns (address)",
  "function owner() view returns (address)",
  "function setOracle(address newOracle) external",
];

function readDeployment(file) {
  const full = path.join(__dirname, "..", "deployments", file);
  if (!fs.existsSync(full)) return null;
  try {
    return JSON.parse(fs.readFileSync(full, "utf8"));
  } catch (error) {
    throw new Error(`Deployment record ${full} is not valid JSON: ${error.message}`);
  }
}

function resolveAddresses() {
  const escrowRecord = readDeployment(`${network.name}.json`);
  const receiverRecord = readDeployment(`cre-receiver-${network.name}.json`);

  const escrowAddress = process.env.ESCROW_ADDRESS || escrowRecord?.escrow;
  const receiverAddress = process.env.RECEIVER_ADDRESS || receiverRecord?.receiver;

  if (!escrowAddress) {
    throw new Error(
      "Escrow address unknown. Run scripts/deploy-all.js first or set ESCROW_ADDRESS."
    );
  }
  if (!receiverAddress) {
    throw new Error(
      "Receiver address unknown. Deploy the receiver first or set RECEIVER_ADDRESS."
    );
  }

  return { escrowAddress, receiverAddress };
}

async function main() {
  const { escrowAddress, receiverAddress } = resolveAddresses();

  console.log("Network:", network.name);
  console.log("Chain ID:", (await ethers.provider.getNetwork()).chainId);
  console.log("Escrow:", escrowAddress);
  console.log("Receiver:", receiverAddress);

  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  if (chainId !== EXPECTED_CHAIN_ID) {
    throw new Error(
      `Wrong chain ID: ${chainId}. Expected ${EXPECTED_CHAIN_ID} (Hardhat Local). Aborting.`
    );
  }

  const [signer] = await ethers.getSigners();
  const signerAddress = await signer.getAddress();
  console.log("Signer:", signerAddress);

  const escrowCode = await ethers.provider.getCode(escrowAddress);
  if (!escrowCode || escrowCode === "0x") {
    throw new Error(`No deployed escrow contract at ${escrowAddress}. Aborting.`);
  }

  const receiverCode = await ethers.provider.getCode(receiverAddress);
  if (!receiverCode || receiverCode === "0x") {
    throw new Error(`No deployed receiver contract at ${receiverAddress}. Aborting.`);
  }
  console.log("Escrow bytecode length:", escrowCode.length);
  console.log("Receiver bytecode length:", receiverCode.length);

  const escrow = new ethers.Contract(escrowAddress, ESCROW_ABI, signer);

  const owner = await escrow.owner();
  console.log("Escrow owner:", owner);
  if (owner.toLowerCase() !== signerAddress.toLowerCase()) {
    throw new Error(
      `Escrow owner ${owner} is not the signer ${signerAddress}. Only the owner can call setOracle. Aborting.`
    );
  }

  const currentOracle = await escrow.oracle();
  console.log("Current escrow oracle:", currentOracle);

  if (currentOracle.toLowerCase() === receiverAddress.toLowerCase()) {
    console.log("SUCCESS: escrow.oracle() already equals the receiver. Nothing to do.");
    return;
  }

  console.log("Calling escrow.setOracle(", receiverAddress, ")...");
  const tx = await escrow.setOracle(receiverAddress);
  console.log("Transaction hash:", tx.hash);

  const receipt = await tx.wait();
  console.log("Confirmation block:", receipt.blockNumber);
  console.log("Transaction status:", receipt.status);

  const newOracle = await escrow.oracle();
  console.log("New escrow oracle:", newOracle);

  if (newOracle.toLowerCase() !== receiverAddress.toLowerCase()) {
    throw new Error(
      `setOracle did not take effect. Oracle is ${newOracle}, expected ${receiverAddress}.`
    );
  }

  console.log("SUCCESS: escrow.oracle() now equals the receiver address.");
  console.log("Before oracle:", currentOracle);
  console.log("After oracle:", newOracle);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

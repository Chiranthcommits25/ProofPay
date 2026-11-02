const fs = require("fs");
const path = require("path");
const { ethers, network } = require("hardhat");

async function main() {
  const signers = await ethers.getSigners();
  if (signers.length === 0) {
    throw new Error("No signer available.");
  }

  const [deployer] = signers;
  const { chainId } = await ethers.provider.getNetwork();

  const escrowAddress = process.env.ESCROW_ADDRESS || "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";
  const forwarderAddress = process.env.CRE_FORWARDER_ADDRESS || ethers.ZeroAddress;
  const manualOracleAddress = process.env.MANUAL_ORACLE_ADDRESS || deployer.address;

  const Receiver = await ethers.getContractFactory("ProofPayCREReceiver");
  const receiver = await Receiver.deploy(escrowAddress, deployer.address, forwarderAddress, manualOracleAddress);
  await receiver.waitForDeployment();
  const receiverAddress = await receiver.getAddress();

  const deployment = {
    network: network.name,
    chainId: chainId.toString(),
    deployer: deployer.address,
    owner: deployer.address,
    escrow: escrowAddress,
    forwarder: forwarderAddress,
    manualOracle: manualOracleAddress,
    receiver: receiverAddress,
    deployedAt: new Date().toISOString(),
  };

  const outputDirectory = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(outputDirectory, { recursive: true });
  const outputFile = path.join(outputDirectory, `cre-receiver-${network.name}.json`);
  fs.writeFileSync(outputFile, `${JSON.stringify(deployment, null, 2)}\n`);

  console.log(`ProofPayCREReceiver deployed: ${receiverAddress}`);
  console.log(`Escrow: ${escrowAddress}`);
  console.log(`Forwarder: ${forwarderAddress}`);
  console.log(`Manual Oracle: ${manualOracleAddress}`);
  console.log(`Deployment saved: ${outputFile}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

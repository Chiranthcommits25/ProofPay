/**
 * Deterministic one-shot local deployment.
 *
 * Deploying all three contracts from a single script on a fresh Hardhat node
 * always produces the same addresses, because account 0 creates them at
 * nonces 0, 1 and 2:
 *
 *   ProofPayUSD          0x5FbDB2315678afecb367f032d93F642f64180aa3
 *   ProofPayEscrow       0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512
 *   ProofPayCREReceiver  0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0
 *
 * Running the old three-script sequence produced a different receiver address
 * on every fresh chain, which silently broke the frontend, the CRE config and
 * the bridge. This script removes that drift: one command, fixed addresses.
 *
 * Usage:
 *   npx hardhat run scripts/deploy-all.js --network localhost
 */
const fs = require("fs");
const path = require("path");
const { ethers, network } = require("hardhat");

const BUYER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const SELLER = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";

const ADMIN_MINT = "1000000";
const DEMO_SEED = "5000";

async function main() {
  const [deployer] = await ethers.getSigners();
  const { chainId } = await ethers.provider.getNetwork();

  if (Number(chainId) !== 31337) {
    throw new Error(`Refusing to deploy on chain ${chainId}: expected 31337 (Hardhat Local).`);
  }

  console.log(`Network: ${network.name} (${chainId})`);
  console.log(`Deployer: ${deployer.address}`);

  const Token = await ethers.getContractFactory("ProofPayUSD");
  const token = await Token.deploy(deployer.address);
  await token.waitForDeployment();
  const tokenAddress = await token.getAddress();

  const Escrow = await ethers.getContractFactory("ProofPayEscrow");
  const escrow = await Escrow.deploy(tokenAddress, deployer.address);
  await escrow.waitForDeployment();
  const escrowAddress = await escrow.getAddress();

  const Receiver = await ethers.getContractFactory("ProofPayCREReceiver");
  const receiver = await Receiver.deploy(
    escrowAddress,
    deployer.address,
    ethers.ZeroAddress,
    deployer.address
  );
  await receiver.waitForDeployment();
  const receiverAddress = await receiver.getAddress();

  // The escrow must hand settlement authority to the receiver, so that only the
  // receiver (through a CRE report or the manual oracle) can move funds.
  if ((await escrow.oracle()).toLowerCase() !== receiverAddress.toLowerCase()) {
    await (await escrow.setOracle(receiverAddress)).wait();
  }

  await (await token.mint(deployer.address, ethers.parseUnits(ADMIN_MINT, 18))).wait();
  await (await token.mint(BUYER, ethers.parseUnits(DEMO_SEED, 18))).wait();
  await (await token.mint(SELLER, ethers.parseUnits(DEMO_SEED, 18))).wait();

  const escrowDeployment = {
    network: network.name,
    chainId: chainId.toString(),
    deployer: deployer.address,
    owner: deployer.address,
    oracle: receiverAddress,
    paymentToken: tokenAddress,
    escrow: escrowAddress,
    initialMint: ADMIN_MINT,
    mintRecipient: deployer.address,
    deployedAt: new Date().toISOString(),
  };

  const receiverDeployment = {
    network: network.name,
    chainId: chainId.toString(),
    deployer: deployer.address,
    owner: deployer.address,
    escrow: escrowAddress,
    forwarder: ethers.ZeroAddress,
    manualOracle: deployer.address,
    receiver: receiverAddress,
    deployedAt: new Date().toISOString(),
  };

  const outputDirectory = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(outputDirectory, `${network.name}.json`),
    `${JSON.stringify(escrowDeployment, null, 2)}\n`
  );
  fs.writeFileSync(
    path.join(outputDirectory, `cre-receiver-${network.name}.json`),
    `${JSON.stringify(receiverDeployment, null, 2)}\n`
  );

  console.log(`ProofPayUSD:          ${tokenAddress}`);
  console.log(`ProofPayEscrow:       ${escrowAddress}`);
  console.log(`ProofPayCREReceiver:  ${receiverAddress}`);
  console.log(`escrow.oracle():      ${await escrow.oracle()}`);
  console.log(`Minted ${ADMIN_MINT} pUSD to admin, ${DEMO_SEED} each to buyer and seller.`);
  console.log(`Deployment records written to ${outputDirectory}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

const fs = require("fs");
const path = require("path");
const { ethers, network } = require("hardhat");

async function main() {
  const signers = await ethers.getSigners();
  if (signers.length === 0) {
    throw new Error("No signer available. Set PRIVATE_KEY for the selected network.");
  }

  const [deployer] = signers;
  const { chainId } = await ethers.provider.getNetwork();

  const ownerAddress = process.env.CONTRACT_OWNER || deployer.address;
  const oracleAddress = process.env.ORACLE_ADDRESS || deployer.address;
  const mintRecipient = process.env.INITIAL_MINT_RECIPIENT || deployer.address;
  const initialMint = process.env.INITIAL_MINT || "1000000";

  for (const [name, address] of [
    ["CONTRACT_OWNER", ownerAddress],
    ["ORACLE_ADDRESS", oracleAddress],
    ["INITIAL_MINT_RECIPIENT", mintRecipient],
  ]) {
    if (!ethers.isAddress(address)) {
      throw new Error(`${name} is not a valid address: ${address}`);
    }
  }

  const Token = await ethers.getContractFactory("ProofPayUSD");
  const token = await Token.deploy(deployer.address);
  await token.waitForDeployment();
  const tokenAddress = await token.getAddress();

  const Escrow = await ethers.getContractFactory("ProofPayEscrow");
  const escrow = await Escrow.deploy(tokenAddress, deployer.address);
  await escrow.waitForDeployment();
  const escrowAddress = await escrow.getAddress();

  if (oracleAddress.toLowerCase() !== (await escrow.oracle()).toLowerCase()) {
    await (await escrow.setOracle(oracleAddress)).wait();
  }

  if (initialMint !== "0") {
    const mintAmount = ethers.parseUnits(initialMint, 18);
    await (await token.mint(mintRecipient, mintAmount)).wait();
  }

  if (ownerAddress.toLowerCase() !== deployer.address.toLowerCase()) {
    await (await token.transferOwnership(ownerAddress)).wait();
    await (await escrow.transferOwnership(ownerAddress)).wait();
  }

  const deployment = {
    network: network.name,
    chainId: chainId.toString(),
    deployer: deployer.address,
    owner: ownerAddress,
    oracle: oracleAddress,
    paymentToken: tokenAddress,
    escrow: escrowAddress,
    initialMint,
    mintRecipient,
    deployedAt: new Date().toISOString(),
  };

  const outputDirectory = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(outputDirectory, { recursive: true });
  const outputFile = path.join(outputDirectory, `${network.name}.json`);
  fs.writeFileSync(outputFile, `${JSON.stringify(deployment, null, 2)}\n`);

  console.log(`Network: ${network.name} (${chainId})`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Owner: ${ownerAddress}`);
  console.log(`Oracle: ${oracleAddress}`);
  console.log(`ProofPayUSD: ${tokenAddress}`);
  console.log(`ProofPayEscrow: ${escrowAddress}`);
  console.log(`Initial mint: ${initialMint} pUSD to ${mintRecipient}`);
  console.log(`Deployment saved: ${outputFile}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

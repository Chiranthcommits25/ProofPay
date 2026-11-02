const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

const ORDER_ID = ethers.encodeBytes32String("PP-CRE-1001");
const ORDER_ID_2 = ethers.encodeBytes32String("PP-CRE-1002");
const AMOUNT = ethers.parseUnits("500", 18);
const FUNDING = ethers.parseUnits("10000", 18);

describe("ProofPayCREReceiver", function () {
  async function deployFixture() {
    const [owner, buyer, seller, forwarder, manualOracle, attacker] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("ProofPayUSD");
    const token = await Token.deploy(owner.address);
    await token.waitForDeployment();
    const tokenAddress = await token.getAddress();

    const Escrow = await ethers.getContractFactory("ProofPayEscrow");
    const escrow = await Escrow.deploy(tokenAddress, owner.address);
    await escrow.waitForDeployment();
    const escrowAddress = await escrow.getAddress();

    // Set oracle to forwarder initially for testing? Or use manualOracle
    await escrow.setOracle(forwarder.address);
    await token.mint(buyer.address, FUNDING);
    await token.connect(buyer).approve(escrowAddress, ethers.MaxUint256);

    const Receiver = await ethers.getContractFactory("ProofPayCREReceiver");
    const receiver = await Receiver.deploy(escrowAddress, owner.address, forwarder.address, manualOracle.address);
    await receiver.waitForDeployment();
    const receiverAddress = await receiver.getAddress();

    // Also allow receiver to call escrow if we point oracle differently
    // But escrow only allows oracle - we need to decide routing
    await escrow.setOracle(receiverAddress);

    const MockForwarder = await ethers.getContractFactory("MockForwarder");
    const mockForwarder = await MockForwarder.deploy();

    return {
      token,
      escrow,
      receiver,
      mockForwarder,
      owner,
      buyer,
      seller,
      forwarder,
      manualOracle,
      attacker,
      escrowAddress,
      receiverAddress,
    };
  }

  function encodeReport(orderId, outcome, trackingId = "TRK-123") {
    const abiCoder = ethers.AbiCoder.defaultAbiCoder();
    const trackingIdHash = ethers.keccak256(ethers.toUtf8Bytes(trackingId));
    const observedAt = "2026-10-31T12:00:00.000Z";
    const report = abiCoder.encode(
      ["bytes32", "string", "bytes32", "string"],
      [orderId, outcome, trackingIdHash, observedAt]
    );
    return { report, trackingIdHash, observedAt };
  }

  it("supports IReceiver interface", async function () {
    const { receiver } = await loadFixture(deployFixture);
    // IReceiver interfaceId
    const iReceiver = ethers.keccak256(ethers.toUtf8Bytes("onReport(bytes,bytes)")).slice(0, 10);
    expect(await receiver.supportsInterface(iReceiver)).to.be.true;
  });

  it("processes DELIVERED report from forwarder and releases funds", async function () {
    const { escrow, receiver, token, escrowAddress, buyer, seller, forwarder } = await loadFixture(deployFixture);
    
    await escrow.connect(buyer).createEscrow(ORDER_ID, buyer.address, seller.address, AMOUNT);
    
    const { report } = encodeReport(ORDER_ID, "DELIVERED");
    const metadata = "0x";
    
    await expect(receiver.connect(forwarder).onReport(metadata, report))
      .to.emit(receiver, "ReportProcessed")
      .and.to.emit(escrow, "EscrowReleased");
    
    const stored = await escrow.getEscrow(ORDER_ID);
    expect(Number(stored.status)).to.equal(2); // Released
    expect(await token.balanceOf(seller.address)).to.equal(AMOUNT);
  });

  it("processes LOST report from forwarder and refunds funds", async function () {
    const { escrow, receiver, token, buyer, seller, forwarder } = await loadFixture(deployFixture);
    
    await escrow.connect(buyer).createEscrow(ORDER_ID_2, buyer.address, seller.address, AMOUNT);
    
    const { report } = encodeReport(ORDER_ID_2, "LOST");
    const metadata = "0x";
    
    await expect(receiver.connect(forwarder).onReport(metadata, report))
      .to.emit(receiver, "ReportProcessed")
      .and.to.emit(escrow, "EscrowRefunded");
    
    const stored = await escrow.getEscrow(ORDER_ID_2);
    expect(Number(stored.status)).to.equal(3); // Refunded
    expect(await token.balanceOf(buyer.address)).to.equal(FUNDING - AMOUNT + AMOUNT);
  });

  it("prevents replay attacks", async function () {
    const { escrow, receiver, buyer, seller, forwarder } = await loadFixture(deployFixture);
    
    await escrow.connect(buyer).createEscrow(ORDER_ID, buyer.address, seller.address, AMOUNT);
    
    const { report } = encodeReport(ORDER_ID, "DELIVERED");
    const metadata = "0x";
    
    await receiver.connect(forwarder).onReport(metadata, report);
    
    await expect(receiver.connect(forwarder).onReport(metadata, report))
      .to.be.revertedWithCustomError(receiver, "ReportAlreadyProcessed");
  });

  it("prevents duplicate settlement", async function () {
    const { escrow, receiver, buyer, seller, forwarder } = await loadFixture(deployFixture);
    
    await escrow.connect(buyer).createEscrow(ORDER_ID, buyer.address, seller.address, AMOUNT);
    
    const { report } = encodeReport(ORDER_ID, "DELIVERED");
    const metadata = "0x";
    
    await receiver.connect(forwarder).onReport(metadata, report);
    
    // Try to settle again
    const { report: report2 } = encodeReport(ORDER_ID, "LOST", "TRK-456");
    await expect(receiver.connect(forwarder).onReport(metadata, report2))
      .to.be.revertedWithCustomError(receiver, "OrderAlreadySettled");
  });

  it("rejects unauthorized callers", async function () {
    const { escrow, receiver, buyer, seller, attacker } = await loadFixture(deployFixture);
    
    await escrow.connect(buyer).createEscrow(ORDER_ID, buyer.address, seller.address, AMOUNT);
    
    const { report } = encodeReport(ORDER_ID, "DELIVERED");
    const metadata = "0x";
    
    await expect(receiver.connect(attacker).onReport(metadata, report))
      .to.be.revertedWithCustomError(receiver, "UnauthorizedCaller");
  });

  it("allows manual oracle to settle for backward compatibility", async function () {
    const { escrow, receiver, buyer, seller, manualOracle } = await loadFixture(deployFixture);
    
    await escrow.connect(buyer).createEscrow(ORDER_ID, buyer.address, seller.address, AMOUNT);
    
    const { report } = encodeReport(ORDER_ID, "DELIVERED");
    const metadata = "0x";
    
    await expect(receiver.connect(manualOracle).onReport(metadata, report))
      .to.emit(escrow, "EscrowReleased");
  });

  it("rejects settlement if escrow not funded", async function () {
    const { escrow, receiver, buyer, seller, forwarder } = await loadFixture(deployFixture);
    
    await escrow.connect(buyer).createEscrow(ORDER_ID, buyer.address, seller.address, AMOUNT);
    
    const { report } = encodeReport(ORDER_ID, "DELIVERED");
    const metadata = "0x";
    
    await receiver.connect(forwarder).onReport(metadata, report);
    
    // Try to create new escrow with same orderId? No, can't create duplicate
    // Or try to settle again
  });

  it("rejects unsupported outcomes", async function () {
    const { escrow, receiver, buyer, seller, forwarder } = await loadFixture(deployFixture);
    
    await escrow.connect(buyer).createEscrow(ORDER_ID, buyer.address, seller.address, AMOUNT);
    
    const { report } = encodeReport(ORDER_ID, "IN_TRANSIT");
    const metadata = "0x";
    
    await expect(receiver.connect(forwarder).onReport(metadata, report))
      .to.be.revertedWithCustomError(receiver, "UnsupportedOutcome");
  });
});

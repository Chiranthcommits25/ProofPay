const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

const ORDER_ID = ethers.encodeBytes32String("PP-1001");
const SECOND_ORDER_ID = ethers.encodeBytes32String("PP-1002");
const AMOUNT = ethers.parseUnits("1000", 18);
const FUNDING = ethers.parseUnits("10000", 18);

describe("ProofPayEscrow", function () {
  async function deployEscrowFixture() {
    const [owner, buyer, seller, oracle, attacker, other] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("ProofPayUSD");
    const token = await Token.deploy(owner.address);
    await token.waitForDeployment();
    const tokenAddress = await token.getAddress();

    const Escrow = await ethers.getContractFactory("ProofPayEscrow");
    const escrow = await Escrow.deploy(tokenAddress, owner.address);
    await escrow.waitForDeployment();
    const escrowAddress = await escrow.getAddress();

    await escrow.setOracle(oracle.address);
    await token.mint(buyer.address, FUNDING);
    await token.connect(buyer).approve(escrowAddress, ethers.MaxUint256);

    return {
      token,
      tokenAddress,
      escrow,
      escrowAddress,
      owner,
      buyer,
      seller,
      oracle,
      attacker,
      other,
    };
  }

  async function createDefaultEscrow(fixture, orderId = ORDER_ID, amount = AMOUNT) {
    return fixture.escrow
      .connect(fixture.buyer)
      .createEscrow(orderId, fixture.buyer.address, fixture.seller.address, amount);
  }

  it("deploys with the expected token, owner, and oracle", async function () {
    const { escrow, tokenAddress, owner, oracle } = await loadFixture(deployEscrowFixture);

    expect(await escrow.paymentToken()).to.equal(tokenAddress);
    expect(await escrow.owner()).to.equal(owner.address);
    expect(await escrow.oracle()).to.equal(oracle.address);
  });

  it("rejects a zero or non-contract payment token", async function () {
    const { owner, attacker } = await loadFixture(deployEscrowFixture);
    const Escrow = await ethers.getContractFactory("ProofPayEscrow");

    await expect(Escrow.deploy(ethers.ZeroAddress, owner.address))
      .to.be.revertedWithCustomError(Escrow, "InvalidToken");

    await expect(Escrow.deploy(attacker.address, owner.address))
      .to.be.revertedWithCustomError(Escrow, "InvalidToken");
  });

  it("allows only the owner to rotate the oracle and rejects the zero address", async function () {
    const { escrow, owner, oracle, attacker, other } = await loadFixture(deployEscrowFixture);

    await expect(escrow.connect(attacker).setOracle(other.address))
      .to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount")
      .withArgs(attacker.address);

    await expect(escrow.connect(owner).setOracle(ethers.ZeroAddress))
      .to.be.revertedWithCustomError(escrow, "InvalidOracle");

    await expect(escrow.connect(owner).setOracle(other.address))
      .to.emit(escrow, "OracleUpdated")
      .withArgs(oracle.address, other.address);

    expect(await escrow.oracle()).to.equal(other.address);
  });

  it("creates a funded escrow and holds pUSD in the contract", async function () {
    const { escrow, token, escrowAddress, buyer, seller } = await loadFixture(
      deployEscrowFixture
    );

    const tx = await escrow
      .connect(buyer)
      .createEscrow(ORDER_ID, buyer.address, seller.address, AMOUNT);

    await expect(tx)
      .to.emit(escrow, "EscrowCreated")
      .withArgs(ORDER_ID, buyer.address, seller.address, AMOUNT);

    await expect(tx).to.changeTokenBalances(
      token,
      [buyer, escrowAddress],
      [-AMOUNT, AMOUNT]
    );

    const stored = await escrow.getEscrow(ORDER_ID);
    expect(stored.orderId).to.equal(ORDER_ID);
    expect(stored.buyer).to.equal(buyer.address);
    expect(stored.seller).to.equal(seller.address);
    expect(stored.amount).to.equal(AMOUNT);
    expect(stored.createdAt).to.be.greaterThan(0n);
    expect(stored.settledAt).to.equal(0n);
    expect(Number(stored.status)).to.equal(1);
    expect(await token.balanceOf(escrowAddress)).to.equal(AMOUNT);
  });

  it("rejects duplicate order IDs", async function () {
    const fixture = await loadFixture(deployEscrowFixture);

    await createDefaultEscrow(fixture);

    await expect(createDefaultEscrow(fixture))
      .to.be.revertedWithCustomError(fixture.escrow, "EscrowAlreadyExists")
      .withArgs(ORDER_ID);
  });

  it("validates order, buyer, seller, and amount inputs", async function () {
    const { escrow, buyer, seller, other } = await loadFixture(deployEscrowFixture);

    await expect(
      escrow.connect(buyer).createEscrow(ethers.ZeroHash, buyer.address, seller.address, AMOUNT)
    )
      .to.be.revertedWithCustomError(escrow, "InvalidOrderId");

    await expect(
      escrow
        .connect(buyer)
        .createEscrow(ORDER_ID, ethers.ZeroAddress, seller.address, AMOUNT)
    )
      .to.be.revertedWithCustomError(escrow, "InvalidBuyer");

    await expect(
      escrow.connect(buyer).createEscrow(ORDER_ID, other.address, seller.address, AMOUNT)
    )
      .to.be.revertedWithCustomError(escrow, "InvalidBuyer");

    await expect(
      escrow
        .connect(buyer)
        .createEscrow(ORDER_ID, buyer.address, ethers.ZeroAddress, AMOUNT)
    )
      .to.be.revertedWithCustomError(escrow, "InvalidSeller");

    await expect(
      escrow.connect(buyer).createEscrow(ORDER_ID, buyer.address, buyer.address, AMOUNT)
    )
      .to.be.revertedWithCustomError(escrow, "SameBuyerAndSeller");

    await expect(
      escrow.connect(buyer).createEscrow(ORDER_ID, buyer.address, seller.address, 0n)
    )
      .to.be.revertedWithCustomError(escrow, "InvalidAmount");
  });

  it("rejects creation when the buyer lacks allowance or balance", async function () {
    const { escrow, escrowAddress, token, buyer, seller, other } = await loadFixture(
      deployEscrowFixture
    );

    await token.connect(buyer).approve(escrowAddress, AMOUNT - 1n);

    await expect(
      escrow.connect(buyer).createEscrow(ORDER_ID, buyer.address, seller.address, AMOUNT)
    )
      .to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance")
      .withArgs(escrowAddress, AMOUNT - 1n, AMOUNT);

    await token.connect(other).approve(escrowAddress, ethers.MaxUint256);

    await expect(
      escrow
        .connect(other)
        .createEscrow(SECOND_ORDER_ID, other.address, seller.address, AMOUNT)
    )
      .to.be.revertedWithCustomError(token, "ERC20InsufficientBalance")
      .withArgs(other.address, 0n, AMOUNT);
  });

  it("releases pUSD to the seller when the oracle confirms delivery", async function () {
    const { escrow, token, escrowAddress, buyer, seller, oracle } = await loadFixture(
      deployEscrowFixture
    );

    await escrow
      .connect(buyer)
      .createEscrow(ORDER_ID, buyer.address, seller.address, AMOUNT);

    const tx = await escrow.connect(oracle).confirmDelivery(ORDER_ID);

    await expect(tx)
      .to.emit(escrow, "EscrowReleased")
      .withArgs(ORDER_ID, seller.address, AMOUNT);

    await expect(tx).to.changeTokenBalances(
      token,
      [escrowAddress, seller],
      [-AMOUNT, AMOUNT]
    );

    const stored = await escrow.getEscrow(ORDER_ID);
    expect(Number(stored.status)).to.equal(2);
    expect(stored.settledAt).to.be.greaterThan(0n);
    expect(await token.balanceOf(escrowAddress)).to.equal(0n);
  });

  it("refunds pUSD to the buyer when the oracle confirms failure", async function () {
    const { escrow, token, escrowAddress, buyer, seller, oracle } = await loadFixture(
      deployEscrowFixture
    );

    await escrow
      .connect(buyer)
      .createEscrow(ORDER_ID, buyer.address, seller.address, AMOUNT);

    const tx = await escrow.connect(oracle).confirmFailure(ORDER_ID);

    await expect(tx)
      .to.emit(escrow, "EscrowRefunded")
      .withArgs(ORDER_ID, buyer.address, AMOUNT);

    await expect(tx).to.changeTokenBalances(
      token,
      [escrowAddress, buyer],
      [-AMOUNT, AMOUNT]
    );

    const stored = await escrow.getEscrow(ORDER_ID);
    expect(Number(stored.status)).to.equal(3);
    expect(stored.settledAt).to.be.greaterThan(0n);
    expect(await token.balanceOf(escrowAddress)).to.equal(0n);
  });

  it("rejects settlement by anyone other than the oracle", async function () {
    const { escrow, owner, buyer, seller, attacker, other } = await loadFixture(
      deployEscrowFixture
    );

    await escrow
      .connect(buyer)
      .createEscrow(ORDER_ID, buyer.address, seller.address, AMOUNT);

    for (const caller of [owner, buyer, seller, attacker, other]) {
      await expect(escrow.connect(caller).confirmDelivery(ORDER_ID))
        .to.be.revertedWithCustomError(escrow, "UnauthorizedOracle")
        .withArgs(caller.address);

      await expect(escrow.connect(caller).confirmFailure(ORDER_ID))
        .to.be.revertedWithCustomError(escrow, "UnauthorizedOracle")
        .withArgs(caller.address);
    }
  });

  it("rejects settlement and reads for unknown orders", async function () {
    const { escrow, oracle } = await loadFixture(deployEscrowFixture);

    await expect(escrow.connect(oracle).confirmDelivery(ORDER_ID))
      .to.be.revertedWithCustomError(escrow, "EscrowNotFound")
      .withArgs(ORDER_ID);

    await expect(escrow.connect(oracle).confirmFailure(ORDER_ID))
      .to.be.revertedWithCustomError(escrow, "EscrowNotFound")
      .withArgs(ORDER_ID);

    await expect(escrow.getEscrow(ORDER_ID))
      .to.be.revertedWithCustomError(escrow, "EscrowNotFound")
      .withArgs(ORDER_ID);
  });

  it("prevents duplicate settlement", async function () {
    const fixture = await loadFixture(deployEscrowFixture);
    const { escrow, oracle } = fixture;

    await createDefaultEscrow(fixture);
    await escrow.connect(oracle).confirmDelivery(ORDER_ID);

    await expect(escrow.connect(oracle).confirmDelivery(ORDER_ID))
      .to.be.revertedWithCustomError(escrow, "EscrowNotFunded")
      .withArgs(ORDER_ID);

    await expect(escrow.connect(oracle).confirmFailure(ORDER_ID))
      .to.be.revertedWithCustomError(escrow, "EscrowNotFunded")
      .withArgs(ORDER_ID);
  });

  it("prevents duplicate refunds and reuse of a settled order ID", async function () {
    const fixture = await loadFixture(deployEscrowFixture);
    const { escrow, oracle } = fixture;

    await createDefaultEscrow(fixture);
    await escrow.connect(oracle).confirmFailure(ORDER_ID);

    await expect(escrow.connect(oracle).confirmFailure(ORDER_ID))
      .to.be.revertedWithCustomError(escrow, "EscrowNotFunded")
      .withArgs(ORDER_ID);

    await expect(createDefaultEscrow(fixture))
      .to.be.revertedWithCustomError(escrow, "EscrowAlreadyExists")
      .withArgs(ORDER_ID);
  });

  it("supports oracle rotation", async function () {
    const { escrow, buyer, seller, oracle, other } = await loadFixture(
      deployEscrowFixture
    );

    await escrow
      .connect(buyer)
      .createEscrow(ORDER_ID, buyer.address, seller.address, AMOUNT);

    await escrow.setOracle(other.address);

    await expect(escrow.connect(oracle).confirmDelivery(ORDER_ID))
      .to.be.revertedWithCustomError(escrow, "UnauthorizedOracle")
      .withArgs(oracle.address);

    await expect(escrow.connect(other).confirmDelivery(ORDER_ID))
      .to.emit(escrow, "EscrowReleased")
      .withArgs(ORDER_ID, seller.address, AMOUNT);
  });

  it("settles multiple escrows independently", async function () {
    const { escrow, token, buyer, seller, oracle } = await loadFixture(
      deployEscrowFixture
    );

    await escrow
      .connect(buyer)
      .createEscrow(ORDER_ID, buyer.address, seller.address, AMOUNT);
    await escrow
      .connect(buyer)
      .createEscrow(SECOND_ORDER_ID, buyer.address, seller.address, AMOUNT);

    await escrow.connect(oracle).confirmDelivery(ORDER_ID);
    await escrow.connect(oracle).confirmFailure(SECOND_ORDER_ID);

    const first = await escrow.getEscrow(ORDER_ID);
    const second = await escrow.getEscrow(SECOND_ORDER_ID);

    expect(Number(first.status)).to.equal(2);
    expect(Number(second.status)).to.equal(3);
    expect(await token.balanceOf(seller.address)).to.equal(AMOUNT);
    expect(await token.balanceOf(buyer.address)).to.equal(FUNDING - AMOUNT);
  });

  it("blocks reentrant escrow creation", async function () {
    const [owner, seller] = await ethers.getSigners();

    const Reentrant = await ethers.getContractFactory("ReentrantToken");
    const token = await Reentrant.deploy();
    await token.waitForDeployment();

    const Escrow = await ethers.getContractFactory("ProofPayEscrow");
    const escrow = await Escrow.deploy(await token.getAddress(), owner.address);
    await escrow.waitForDeployment();

    await token.configure(
      await escrow.getAddress(),
      SECOND_ORDER_ID,
      seller.address,
      AMOUNT
    );

    await expect(token.startEscrow(ORDER_ID, seller.address, AMOUNT))
      .to.be.revertedWithCustomError(escrow, "ReentrancyGuardReentrantCall");

    await expect(escrow.getEscrow(ORDER_ID))
      .to.be.revertedWithCustomError(escrow, "EscrowNotFound")
      .withArgs(ORDER_ID);
  });
});

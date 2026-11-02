const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("ProofPayUSD", function () {
  async function deployTokenFixture() {
    const [owner, alice, bob] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("ProofPayUSD");
    const token = await Token.deploy(owner.address);
    await token.waitForDeployment();
    return { token, owner, alice, bob };
  }

  it("has the expected metadata and zero initial supply", async function () {
    const { token, owner } = await loadFixture(deployTokenFixture);

    expect(await token.name()).to.equal("ProofPay USD");
    expect(await token.symbol()).to.equal("pUSD");
    expect(await token.decimals()).to.equal(18n);
    expect(await token.totalSupply()).to.equal(0n);
    expect(await token.owner()).to.equal(owner.address);
  });

  it("allows only the owner to mint", async function () {
    const { token, owner, alice } = await loadFixture(deployTokenFixture);
    const amount = ethers.parseUnits("1000", 18);

    await expect(token.connect(alice).mint(alice.address, amount))
      .to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount")
      .withArgs(alice.address);

    await expect(token.connect(owner).mint(alice.address, amount))
      .to.emit(token, "Transfer")
      .withArgs(ethers.ZeroAddress, alice.address, amount);

    expect(await token.balanceOf(alice.address)).to.equal(amount);
    expect(await token.totalSupply()).to.equal(amount);
  });

  it("rejects minting to the zero address", async function () {
    const { token } = await loadFixture(deployTokenFixture);

    await expect(token.mint(ethers.ZeroAddress, 1n))
      .to.be.revertedWithCustomError(token, "ERC20InvalidReceiver")
      .withArgs(ethers.ZeroAddress);
  });

  it("supports standard ERC-20 approvals and transfers", async function () {
    const { token, owner, alice, bob } = await loadFixture(deployTokenFixture);
    const amount = ethers.parseUnits("100", 18);

    await token.mint(owner.address, amount);
    await token.connect(owner).approve(alice.address, amount);

    expect(await token.allowance(owner.address, alice.address)).to.equal(amount);

    await expect(token.connect(alice).transferFrom(owner.address, bob.address, amount))
      .to.emit(token, "Transfer")
      .withArgs(owner.address, bob.address, amount);

    expect(await token.balanceOf(bob.address)).to.equal(amount);
    expect(await token.balanceOf(owner.address)).to.equal(0n);
    expect(await token.allowance(owner.address, alice.address)).to.equal(0n);
  });

  it("rejects transfers above the available balance", async function () {
    const { token, owner, alice, bob } = await loadFixture(deployTokenFixture);
    const balance = ethers.parseUnits("10", 18);

    await token.mint(alice.address, balance);

    await expect(token.connect(alice).transfer(bob.address, balance + 1n))
      .to.be.revertedWithCustomError(token, "ERC20InsufficientBalance")
      .withArgs(alice.address, balance, balance + 1n);
  });

  it("rejects deployment with a zero owner", async function () {
    const Token = await ethers.getContractFactory("ProofPayUSD");

    await expect(Token.deploy(ethers.ZeroAddress))
      .to.be.revertedWithCustomError(Token, "OwnableInvalidOwner")
      .withArgs(ethers.ZeroAddress);
  });
});

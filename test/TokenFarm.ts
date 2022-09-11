import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

describe("TokenFarm", function () {
    const depositAmount = 100;
    async function deployDefaultTokenFarm() {
        const [owner, user1, user2, user3, user4] = await ethers.getSigners();

        const LPToken = await ethers.getContractFactory("LPToken");
        const lpToken = await LPToken.deploy();

        const DappToken = await ethers.getContractFactory("DappToken");
        const dappToken = await DappToken.deploy();

        const TokenFarm = await ethers.getContractFactory("TokenFarm");
        const tokenFarm = await TokenFarm.deploy(dappToken.address, lpToken.address);

        await tokenFarm.deployed();

        const roleMinter = await dappToken.MINTER_ROLE()
        await dappToken.grantRole(roleMinter, tokenFarm.address);

        return { lpToken, dappToken, tokenFarm, owner, user1, user2, user3, user4 };
    }

    describe("Deployment", function () {
        it("Should have the right LPToken contract", async function () {
            const { lpToken, tokenFarm } = await loadFixture(deployDefaultTokenFarm);

            expect(await tokenFarm.lpToken()).to.equal(lpToken.address);
        });

        it("Should have the right DappToken contract", async function () {
            const { dappToken, tokenFarm } = await loadFixture(deployDefaultTokenFarm);

            expect(await tokenFarm.dappToken()).to.equal(dappToken.address);
        });

        it("Should have the right minter admin role for DappToken", async function () {
            const { dappToken, owner } = await loadFixture(deployDefaultTokenFarm);

            expect(await dappToken.hasRole(dappToken.DEFAULT_ADMIN_ROLE(), owner.address)).to.equal(true);
        })
    });

    describe("Deposit", function () {
        it("Cannot deposit without allowance", async function () {
            const { tokenFarm } = await loadFixture(deployDefaultTokenFarm);

            await expect(tokenFarm.deposit(depositAmount))
                .to.be.revertedWith("Not enough allowance.");
        });

        it("Can deposit successfully", async function () {
            const { lpToken, tokenFarm, owner } = await loadFixture(deployDefaultTokenFarm);

            // increase allowance and mint some tokens to owner address before depositing
            await lpToken.increaseAllowance(tokenFarm.address, depositAmount);
            await lpToken.mintTo(owner.address, depositAmount);

            // make deposit and check for event
            const tx = await tokenFarm.deposit(depositAmount);
            await expect(tx)
                .to.emit(tokenFarm, "Deposit")
                .withArgs(owner.address, depositAmount);

            // test all other deposit related state variables
            const user = await tokenFarm.users(owner.address);
            expect(user.stakingBalance).to.equal(depositAmount);
            expect(user.isStaking).to.equal(true);
            expect(user.pendingRewards).to.equal(0);
        });
    });

    describe("Withdraw", function () {
        it("Cannot withdraw before depositing", async function () {
            const { tokenFarm, owner } = await loadFixture(deployDefaultTokenFarm);
            await expect(tokenFarm.withdraw())
                .to.be.revertedWith("Nothing staked.");
        });

        it("Can withdraw successfully", async function () {
            const { lpToken, tokenFarm, owner } = await loadFixture(deployDefaultTokenFarm);

            await lpToken.increaseAllowance(tokenFarm.address, depositAmount);
            await lpToken.mintTo(owner.address, depositAmount);

            await tokenFarm.deposit(depositAmount);

            const txWithdraw = await tokenFarm.withdraw();
            await expect(txWithdraw)
                .to.emit(tokenFarm, "Withdraw")
                .withArgs(owner.address, depositAmount);

            const user = await tokenFarm.users(owner.address);
            expect(user.stakingBalance).to.equal(0);
            expect(user.isStaking).to.equal(false);
            expect(user.pendingRewards).to.be.greaterThan(0);
        });
    });

    describe("Harvest", function () {
        it("Can harvest simple rewards", async function () {
            const { tokenFarm, owner, lpToken, dappToken } = await loadFixture(deployDefaultTokenFarm);
            const deposit = 10;

            await lpToken.increaseAllowance(tokenFarm.address, deposit);
            await lpToken.mintTo(owner.address, deposit);

            await tokenFarm.deposit(deposit);
            await hre.network.provider.send("hardhat_mine", ["0x9"]);

            await tokenFarm.withdraw();

            const user = await tokenFarm.users(owner.address);

            expect(user.pendingRewards)
                .to.equal(ethers.utils.parseEther("10"));

            await expect(tokenFarm.harvest())
                .to.emit(tokenFarm, "Harvest")
                .withArgs(owner.address, ethers.utils.parseEther("10"));

            expect(await dappToken.balanceOf(owner.address))
                .to.equal(ethers.utils.parseEther("10"));
        });

        it("Can harvest multiple deposit rewards", async function () {
            const { tokenFarm, owner, lpToken, dappToken } = await loadFixture(deployDefaultTokenFarm);
            const deposits = [100, 100, 50];

            await lpToken.increaseAllowance(tokenFarm.address, deposits.reduce((p, v) => p + v, 0));
            await lpToken.mintTo(owner.address, deposits.reduce((p, v) => p + v, 0));

            await tokenFarm.deposit(deposits[0]);
            await hre.network.provider.send("hardhat_mine", ["0x9"]);

            await tokenFarm.deposit(deposits[1]);
            await hre.network.provider.send("hardhat_mine", ["0x9"]);

            await tokenFarm.deposit(deposits[2]);
            await hre.network.provider.send("hardhat_mine", ["0x9"]);

            await tokenFarm.withdraw();
            await hre.network.provider.send("hardhat_mine", ["0x9"]);

            const user = await tokenFarm.users(owner.address);

            expect(user.pendingRewards)
                .to.equal(ethers.utils.parseEther("30"));

            await expect(tokenFarm.harvest())
                .to.emit(tokenFarm, "Harvest")
                .withArgs(owner.address, ethers.utils.parseEther("30"));

            expect(await dappToken.balanceOf(owner.address))
                .to.equal(ethers.utils.parseEther("30"));
        });
    });

    describe("Distribute Rewards All", function () {
        it("Should distribute rewards for just 1 depositor", async function () {
            const { tokenFarm, owner, lpToken, dappToken } = await loadFixture(deployDefaultTokenFarm);
            const deposit = 100;

            await lpToken.increaseAllowance(tokenFarm.address, deposit);
            await lpToken.mintTo(owner.address, deposit);

            await tokenFarm.deposit(deposit);
            await hre.network.provider.send("hardhat_mine", ["0x9"]);

            let user = await tokenFarm.users(owner.address);

            expect(user.pendingRewards)
                .to.equal(ethers.utils.parseEther("0"));

            await expect(tokenFarm.distributeRewardsAll())
                .to.emit(tokenFarm, "Distribute")
                .withArgs(ethers.utils.parseEther("10"));

            user = await tokenFarm.users(owner.address);

            expect(user.pendingRewards)
                .to.equal(ethers.utils.parseEther("10"));
        });

        it("Should distribute rewards for multiple depositors", async function () {
            const { tokenFarm, lpToken, user1, user2, user3 } = await loadFixture(deployDefaultTokenFarm);
            const deposit = 100;

            await lpToken.connect(user1).increaseAllowance(tokenFarm.address, deposit);
            await lpToken.connect(user2).increaseAllowance(tokenFarm.address, deposit);
            await lpToken.connect(user3).increaseAllowance(tokenFarm.address, deposit);
            await lpToken.mintTo(user1.address, deposit);
            await lpToken.mintTo(user2.address, deposit);
            await lpToken.mintTo(user3.address, deposit);

            await tokenFarm.connect(user1).deposit(deposit);
            await hre.network.provider.send("hardhat_mine", ["0x9"]);

            await tokenFarm.connect(user2).deposit(deposit);
            await hre.network.provider.send("hardhat_mine", ["0x9"]);

            await tokenFarm.connect(user3).deposit(deposit);
            await hre.network.provider.send("hardhat_mine", ["0x9"]);

            await expect(tokenFarm.distributeRewardsAll())
                .to.emit(tokenFarm, "Distribute")
                .withArgs(ethers.utils.parseEther("29.999999999999999999"));

            let user = await tokenFarm.users(user1.address);

            expect(user.pendingRewards)
                .to.equal(ethers.utils.parseEther("18.333333333333333333"));

            user = await tokenFarm.users(user2.address);

            expect(user.pendingRewards)
                .to.equal(ethers.utils.parseEther("8.333333333333333333"));

            user = await tokenFarm.users(user3.address);

            expect(user.pendingRewards)
                .to.equal(ethers.utils.parseEther("3.333333333333333333"));
        });
    });

    describe("Update Reward Per Block", function () {
        it("Should not allow a reward bigger than MAX_REWARD_PER_BLOCK", async function () {
            const { tokenFarm } = await loadFixture(deployDefaultTokenFarm);

            await expect(tokenFarm.updateRewardPerBlock(ethers.utils.parseEther("101")))
                .to.be.revertedWith("Exceeds maximum reward.");
        });

        it("Should apply new reward successfully", async function () {
            const { tokenFarm, lpToken, owner, dappToken } = await loadFixture(deployDefaultTokenFarm);
            const deposit = 100;

            await lpToken.increaseAllowance(tokenFarm.address, deposit);
            await lpToken.mintTo(owner.address, deposit);

            await tokenFarm.updateRewardPerBlock(ethers.utils.parseEther("15"));

            await tokenFarm.deposit(deposit);
            await hre.network.provider.send("hardhat_mine", ["0x9"]);

            await tokenFarm.withdraw();

            const user = await tokenFarm.users(owner.address);

            // Reward 10 blocks at 15 rewards per block = 150
            expect(user.pendingRewards)
                .to.equal(ethers.utils.parseEther("150"));

            await expect(tokenFarm.harvest())
                .to.emit(tokenFarm, "Harvest")
                .withArgs(owner.address, ethers.utils.parseEther("150"));

            expect(await dappToken.balanceOf(owner.address))
                .to.equal(ethers.utils.parseEther("150"));
        });
    });
});
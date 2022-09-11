import { ethers } from "hardhat";

async function main() {
    const DappToken = await ethers.getContractFactory("DappToken");
    const dappToken = await DappToken.deploy();

    await dappToken.deployed();

    const LPToken = await ethers.getContractFactory("LPToken");
    const lpToken = await LPToken.deploy();

    await lpToken.deployed();

    const TokenFarm = await ethers.getContractFactory("TokenFarm");
    const tokenFarm = await TokenFarm.deploy(dappToken.address, lpToken.address);

    await tokenFarm.deployed();
    console.log(`TokenFarm deployed successfully`);

    const roleMinter = await dappToken.MINTER_ROLE()
    await dappToken.grantRole(roleMinter, tokenFarm.address);
    console.log(`Minter role granter for TokenFarm over DappToken.`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
})
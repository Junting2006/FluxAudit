import { network } from "hardhat";

const { ethers } = await network.create();
const [deployer] = await ethers.getSigners();
const connectedNetwork = await ethers.provider.getNetwork();
const requiredChainId = 11155111n;

if (connectedNetwork.chainId !== requiredChainId) {
  throw new Error(
    `Refusing to deploy: expected Sepolia chain ${requiredChainId}, connected to ${connectedNetwork.chainId}`,
  );
}

const attestation = await ethers.deployContract("Attestation", [], deployer);
await attestation.waitForDeployment();

const deploymentTransaction = attestation.deploymentTransaction();
if (deploymentTransaction === null) {
  throw new Error("deployment transaction is unavailable");
}
const receipt = await deploymentTransaction.wait(1);
if (receipt === null) {
  throw new Error("deployment transaction was not mined");
}

const contractAddress = await attestation.getAddress();
const chainId = Number(connectedNetwork.chainId);
const transactionHash = receipt.hash;

const deployment = {
  contract: "Attestation",
  contractAddress,
  authorizedAttestor: await deployer.getAddress(),
  chainId,
  transactionHash,
  blockNumber: receipt.blockNumber,
  explorerUrl: chainId === 11155111
    ? `https://sepolia.etherscan.io/tx/${transactionHash}`
    : null,
  deployedAt: new Date().toISOString(),
};

console.log(JSON.stringify(deployment, null, 2));

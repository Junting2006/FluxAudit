import { readFileSync } from "node:fs";
import { network } from "hardhat";

import { attestReport, verifyReportOnChain } from "../src/attestation.js";

const { ethers } = await network.create();
const [authorizedAttestor] = await ethers.getSigners();
const contract = await ethers.deployContract("Attestation", [], authorizedAttestor);
await contract.waitForDeployment();

const report = JSON.parse(
  readFileSync(new URL("../fixtures/golden-report.json", import.meta.url), "utf8"),
);
const tamperedReport = JSON.parse(
  readFileSync(new URL("../fixtures/tampered-report.json", import.meta.url), "utf8"),
);
const contractAddress = await contract.getAddress();
const trustedAuditor = await authorizedAttestor.getAddress();

const anchored = await attestReport({
  report,
  signer: authorizedAttestor,
  contractAddress,
  expectedChainId: 31337,
});
const verification = await verifyReportOnChain({
  report,
  provider: ethers.provider,
  contractAddress,
  trustedAuditor,
  expectedChainId: 31337,
});
const tamperedVerification = await verifyReportOnChain({
  report: tamperedReport,
  provider: ethers.provider,
  contractAddress,
  trustedAuditor,
  expectedChainId: 31337,
});

console.log(JSON.stringify({ anchored, verification, tamperedVerification }, (_, value) =>
  typeof value === "bigint" ? value.toString() : value, 2));

if (!verification.isVerified || tamperedVerification.isVerified) process.exitCode = 1;

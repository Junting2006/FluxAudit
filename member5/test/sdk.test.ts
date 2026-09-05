import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { network } from "hardhat";

import {
  attestReport,
  verifyReportOnChain,
  type VerifyReportOptions,
} from "../src/attestation.js";
import { computeReportHash } from "../src/hashing.js";

const { ethers } = await network.create();

function makeReport() {
  return JSON.parse(readFileSync(new URL("../fixtures/seven-step-report.json", import.meta.url), "utf8"));
}

async function deployFixture() {
  const [authorizedAttestor, other] = await ethers.getSigners();
  const contract = await ethers.deployContract("Attestation");
  await contract.waitForDeployment();
  return {
    authorizedAttestor,
    other,
    authorizedAttestorAddress: await authorizedAttestor.getAddress(),
    contractAddress: await contract.getAddress(),
  };
}

describe("member5 ethers SDK", function () {
  it("anchors a locally valid report and verifies all on-chain fields", async function () {
    const { authorizedAttestor, authorizedAttestorAddress, contractAddress } = await deployFixture();
    const report = makeReport();

    const anchored = await attestReport({
      report,
      signer: authorizedAttestor,
      contractAddress,
      expectedChainId: 31337,
    });
    assert.match(anchored.transactionHash, /^0x[0-9a-f]{64}$/);
    assert.ok(anchored.blockNumber > 0);

    const result = await verifyReportOnChain({
      report,
      provider: ethers.provider,
      contractAddress,
      expectedChainId: 31337,
      trustedAuditor: authorizedAttestorAddress,
    });
    assert.equal(result.isVerified, true);
    assert.equal(result.isLocallyValid, true);
    assert.equal(result.isAnchored, true);
    assert.equal(result.isMerkleRootMatch, true);
    assert.equal(result.isRiskScoreMatch, true);
    assert.equal(result.isAuditorTrusted, true);
  });

  it("refuses invalid internal steps even when the outer hash was refreshed", async () => {
    const { authorizedAttestor, contractAddress } = await deployFixture();
    const report = makeReport();
    report.proof_data.steps[2].output.team_allocation_pct = 99;
    report.proof_data.report_hash = computeReportHash(report);
    await assert.rejects(attestReport({ report, signer: authorizedAttestor, contractAddress, expectedChainId: 31337 }), /verification/);
  });

  it("does not accept a body-tampered report", async function () {
    const { authorizedAttestor, authorizedAttestorAddress, contractAddress } = await deployFixture();
    const report = makeReport();
    await attestReport({ report, signer: authorizedAttestor, contractAddress, expectedChainId: 31337 });

    report.summary.overall_risk_score = 10;
    const result = await verifyReportOnChain({
      report,
      provider: ethers.provider,
      contractAddress,
      expectedChainId: 31337,
      trustedAuditor: authorizedAttestorAddress,
    });
    assert.equal(result.isVerified, false);
    assert.equal(result.isLocallyValid, false);
  });

  it("requires the trusted team auditor instead of trusting an arbitrary contract", async function () {
    const { authorizedAttestor, contractAddress } = await deployFixture();
    const report = makeReport();
    await attestReport({ report, signer: authorizedAttestor, contractAddress, expectedChainId: 31337 });

    await assert.rejects(
      verifyReportOnChain({
        report,
        provider: ethers.provider,
        contractAddress,
        expectedChainId: 31337,
        trustedAuditor: undefined,
      } as unknown as VerifyReportOptions),
      /trustedAuditor/,
    );
  });

  it("marks a record invalid when it is not signed by the configured team auditor", async function () {
    const { authorizedAttestor, other, contractAddress } = await deployFixture();
    const report = makeReport();
    await attestReport({ report, signer: authorizedAttestor, contractAddress, expectedChainId: 31337 });

    const result = await verifyReportOnChain({
      report,
      provider: ethers.provider,
      contractAddress,
      expectedChainId: 31337,
      trustedAuditor: await other.getAddress(),
    });
    assert.equal(result.isAuditorTrusted, false);
    assert.equal(result.isVerified, false);
  });

  it("rejects the wrong network before sending a transaction", async function () {
    const { authorizedAttestor, contractAddress } = await deployFixture();
    await assert.rejects(
      attestReport({
        report: makeReport(),
        signer: authorizedAttestor,
        contractAddress,
        expectedChainId: 11155111,
      }),
      /Expected chain 11155111, connected to 31337/,
    );
  });

  it("rejects an unauthorized signer before sending a transaction", async function () {
    const { other, contractAddress } = await deployFixture();
    await assert.rejects(
      attestReport({ report: makeReport(), signer: other, contractAddress, expectedChainId: 31337 }),
      /not the contract's authorized attestor/,
    );
  });

  it("rejects an address without deployed contract code", async function () {
    const [signer] = await ethers.getSigners();
    await assert.rejects(
      attestReport({
        report: makeReport(),
        signer,
        contractAddress: "0x0000000000000000000000000000000000000001",
        expectedChainId: 31337,
      }),
      /no contract code/,
    );
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LogDescription } from "ethers";
import { network } from "hardhat";

const { ethers } = await network.create();

const REPORT_HASH = `0x${"11".repeat(32)}`;
const MERKLE_ROOT = `0x${"22".repeat(32)}`;

async function deployFixture() {
  const [authorizedAttestor, other] = await ethers.getSigners();
  const attestation = await ethers.deployContract("Attestation");
  await attestation.waitForDeployment();
  return { attestation, authorizedAttestor, other };
}

describe("Attestation", function () {
  it("anchors and verifies a report", async function () {
    const { attestation, authorizedAttestor } = await deployFixture();

    const transaction = await attestation.attest(REPORT_HASH, MERKLE_ROOT, 85);
    const receipt = await transaction.wait();
    assert.ok(receipt);

    const event = receipt.logs
      .map((log: { topics: readonly string[]; data: string }) => {
        try {
          return attestation.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((parsedLog: LogDescription | null) => parsedLog?.name === "Attested");
    assert.ok(event);
    assert.equal(event.args.reportHash, REPORT_HASH);
    assert.equal(event.args.merkleRoot, MERKLE_ROOT);
    assert.equal(event.args.riskScore, 85n);
    assert.equal(event.args.auditor, await authorizedAttestor.getAddress());

    const [isVerified, merkleRoot, riskScore, timestamp, auditor] =
      await attestation.verify(REPORT_HASH);
    assert.equal(isVerified, true);
    assert.equal(merkleRoot, MERKLE_ROOT);
    assert.equal(riskScore, 85n);
    assert.ok(timestamp > 0n);
    assert.equal(auditor, await authorizedAttestor.getAddress());
  });

  it("returns an empty record for an unknown report", async function () {
    const { attestation } = await deployFixture();
    const [isVerified, merkleRoot, riskScore, timestamp, auditor] =
      await attestation.verify(REPORT_HASH);

    assert.equal(isVerified, false);
    assert.equal(merkleRoot, ethers.ZeroHash);
    assert.equal(riskScore, 0n);
    assert.equal(timestamp, 0n);
    assert.equal(auditor, ethers.ZeroAddress);
  });

  it("rejects duplicate reports", async function () {
    const { attestation } = await deployFixture();
    await attestation.attest(REPORT_HASH, MERKLE_ROOT, 85);

    await assert.rejects(
      attestation.attest(REPORT_HASH, MERKLE_ROOT, 85),
      /RecordAlreadyExists/,
    );
  });

  it("rejects zero hashes and out-of-range risk scores", async function () {
    const { attestation } = await deployFixture();

    await assert.rejects(attestation.attest(ethers.ZeroHash, MERKLE_ROOT, 85), /ZeroReportHash/);
    await assert.rejects(attestation.attest(REPORT_HASH, ethers.ZeroHash, 85), /ZeroMerkleRoot/);
    await assert.rejects(attestation.attest(REPORT_HASH, MERKLE_ROOT, 101), /InvalidRiskScore/);
  });

  it("rejects an unauthorized anchoring wallet", async function () {
    const { attestation, other } = await deployFixture();

    await assert.rejects(
      attestation.connect(other).getFunction("attest")(REPORT_HASH, MERKLE_ROOT, 85),
      /UnauthorizedAttestor/,
    );
  });
});

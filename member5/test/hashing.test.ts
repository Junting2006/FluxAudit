import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { keccak256, toUtf8Bytes } from "ethers";

import {
  ZERO_HASH,
  canonicalJson,
  computeReportHash,
  hashStep,
  merkleRoot,
  parseAttestationInput,
  verifyReportLocally,
} from "../src/hashing.js";

const BASE_REPORT = JSON.parse(readFileSync(new URL("../fixtures/seven-step-report.json", import.meta.url), "utf8"));

describe("FluxAudit Ethereum keccak256 compatibility", function () {
  it("matches the agreed Ethereum keccak256 vectors", function () {
    assert.equal(keccak256(toUtf8Bytes("")),
      "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470",
    );
    assert.equal(keccak256(toUtf8Bytes("fluxaudit-test")),
      "0xcce8555ed74ef8887a1250c7048b9910d0e5fdd755836f4ffe4f4059a7fef103",
    );
  });

  it("serializes JSON like Python json.dumps with the agreed options", function () {
    assert.equal(canonicalJson({ z: 2, message: "完成", a: [true, null, 1] }),
      '{"a":[true,null,1],"message":"完成","z":2}',
    );
  });

  it("hashes the 0x-prefixed previous hash as UTF-8 text", function () {
    const expected = keccak256(toUtf8Bytes(`${ZERO_HASH}|step0|1000`));
    assert.equal(hashStep(ZERO_HASH, "step0", 1000), expected);
  });

  it("rejects values that cannot round-trip to the Python JSON contract", function () {
    assert.throws(() => canonicalJson({ unsafe: Number.MAX_SAFE_INTEGER + 1 }), /safe integer/);
    assert.throws(() => canonicalJson({ nonfinite: Infinity }), /finite/);
    assert.throws(() => canonicalJson({ missing: undefined }), /undefined/);
    assert.throws(() => canonicalJson(Array(1)), /array hole/);
  });

  it("preserves historical primitive hashStep golden vectors", function () {
    const inputSummary = {
      target_type: "HYBRID",
      contract_address: "0x1111111111111111111111111111111111111111",
      chain_id: 11155111,
    };
    const chainData = {
      team_wallet_pct: 82,
      has_timelock: false,
      contract_verified: false,
    };
    const docOutput = {
      team_allocation_pct: 10,
      has_lockup_claim: true,
      statements: [{ field: "team_allocation_pct", value: 10 }],
    };
    const contradictions = [{
      category: "TOKENOMICS_MISMATCH",
      severity: "CRITICAL",
      title: "代币分配不一致",
      description: "文档声明 10%，链上为 82%。",
      evidence: "Whitepaper vs chain",
    }];
    const risk = {
      risk_score: 85,
      risk_level: "HIGH",
      risk_reasons: ["代币分配不符"],
    };

    const inputHash = hashStep(
      ZERO_HASH,
      `INPUT_VALIDATED|${canonicalJson(inputSummary)}`,
      1700000000000,
    );
    assert.equal(inputHash, "0x4f7fe6a90a819bdb7f041bfa290a9361de2af79acdafef29ecda190a23770f39");

    const chainHash = hashStep(
      inputHash,
      `CHAIN_FETCHED|${canonicalJson(chainData)}`,
      1700000000001,
    );
    assert.equal(chainHash, "0xdecb8dfcd618cf4814743a8c0c1a923d757737f1de5d02e238d3b5149f6f5fc9");

    const docHash = hashStep(
      chainHash,
      `${canonicalJson(docOutput)}|DocAgent 完成文档解析，提取声明 1 条。`,
      1700000000002,
    );
    assert.equal(docHash, "0xa27fb549e09d4d5f293f310b641bbff8f7d253d5e481f4edd23bdf911681060b");

    const crossCheckHash = hashStep(
      docHash,
      `${canonicalJson(contradictions)}|CrossCheckAgent 完成文档-链上交叉核验，发现矛盾 1 条。`,
      1700000000003,
    );
    assert.equal(crossCheckHash, "0xa617adbacb2694ef127f1f1a215097ab4f4d4446465773f8a8e5a5d9344b6023");

    const riskHash = hashStep(
      crossCheckHash,
      `${canonicalJson(risk)}|RiskAgent 综合打分：85 分，风险等级 HIGH。`,
      1700000000004,
    );
    assert.equal(riskHash, "0x800a9e601ef13cf9d72895313e652de9ea2a4d1c9113ee6449ed09798061d22f");

    assert.equal(
      merkleRoot([docHash, crossCheckHash, riskHash]),
      "0x8922629a31f3edd81d0aef2c408c61c7a5aae7c5ef99e35021cfd24541a9c3e5",
    );
  });
});

describe("FluxAudit proof verification", function () {
  it("matches the fixed Python reportHash and Merkle Root fixture", function () {
    const report = JSON.parse(
      readFileSync(new URL("../fixtures/golden-report.json", import.meta.url), "utf8"),
    );
    const result = verifyReportLocally(report);

    assert.equal(result.computedReportHash, "0x98265bfbf5ba86ba364be6f52801db3ca058b66cffa938c9f811e6286050df95");
    assert.equal(result.computedMerkleRoot, "0x0ed187aff0d0e6e9a190fea4ac458b1986e38969faee732b4f0acac3586fa64f");
    assert.equal(result.isLocallyValid, true);
  });

  it("rejects the supplied body-tampered fixture", function () {
    const report = JSON.parse(
      readFileSync(new URL("../fixtures/tampered-report.json", import.meta.url), "utf8"),
    );
    assert.equal(verifyReportLocally(report).isLocallyValid, false);
  });

  it("builds the member4-compatible Merkle root deterministically", function () {
    const leaves = BASE_REPORT.proof_data.step_hashes;
    assert.equal(merkleRoot(leaves), merkleRoot([...leaves]));
    assert.equal(merkleRoot([]), ZERO_HASH);
    assert.throws(() => merkleRoot(Array(1)), /array hole/);
  });

  it("excludes only report_hash to avoid self-reference", function () {
    const original = computeReportHash(BASE_REPORT);
    const changedProof = structuredClone(BASE_REPORT);
    changedProof.proof_data.report_hash = `0x${"1".repeat(64)}`;
    assert.equal(computeReportHash(changedProof), original);
  });

  it("detects a change to the report body", function () {
    const report = structuredClone(BASE_REPORT);
    report.proof_data.merkle_root = merkleRoot(report.proof_data.step_hashes);
    report.proof_data.report_hash = computeReportHash(report);

    assert.equal(verifyReportLocally(report).isLocallyValid, true);

    report.summary.overall_risk_score = 10;
    const result = verifyReportLocally(report);
    assert.equal(result.isLocallyValid, false);
    assert.equal(result.isReportHashValid, false);
  });

  it("detects a change to a reasoning step hash through the Merkle root", function () {
    const report = structuredClone(BASE_REPORT);
    report.proof_data.merkle_root = merkleRoot(report.proof_data.step_hashes);
    report.proof_data.report_hash = computeReportHash(report);
    report.proof_data.step_hashes[1] = `0x${"a".repeat(64)}`;

    const result = verifyReportLocally(report);
    assert.equal(result.isLocallyValid, false);
    assert.equal(result.isMerkleRootValid, false);
  });

  it("validates the three on-chain fields at the boundary", function () {
    const report = structuredClone(BASE_REPORT);
    report.proof_data.merkle_root = merkleRoot(report.proof_data.step_hashes);
    report.proof_data.report_hash = computeReportHash(report);

    assert.deepEqual(parseAttestationInput(report), {
      reportHash: report.proof_data.report_hash,
      merkleRoot: report.proof_data.merkle_root,
      riskScore: 85,
    });

    report.summary.overall_risk_score = 101;
    assert.throws(() => parseAttestationInput(report), /riskScore/);

    const sparseProof = structuredClone(BASE_REPORT);
    sparseProof.proof_data.step_hashes = Array(1);
    sparseProof.proof_data.merkle_root = ZERO_HASH;
    sparseProof.proof_data.report_hash = BASE_REPORT.proof_data.report_hash;
    assert.throws(() => parseAttestationInput(sparseProof), /array hole/);
  });
});

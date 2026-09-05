import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  FluxAuditFrontendError,
  parseReportJsonFile,
  toVerificationUiState,
  type VerifyReportResult,
} from "../src/index.js";

function verifiedResult(overrides: Partial<VerifyReportResult> = {}): VerifyReportResult {
  return {
    isLocallyValid: true,
    isReportHashValid: true,
    isMerkleRootValid: true,
    isStepChainValid: true,
    isManifestValid: true,
    computedReportHash: `0x${"11".repeat(32)}`,
    computedMerkleRoot: `0x${"22".repeat(32)}`,
    suppliedReportHash: `0x${"11".repeat(32)}`,
    suppliedMerkleRoot: `0x${"22".repeat(32)}`,
    isVerified: true,
    isAnchored: true,
    isMerkleRootMatch: true,
    isRiskScoreMatch: true,
    isAuditorTrusted: true,
    onChainTimestamp: 1n,
    onChainAuditor: "0x0000000000000000000000000000000000000001",
    ...overrides,
  };
}

describe("frontend verification state", function () {
  it("shows VERIFIED only when every local and on-chain check passed", function () {
    assert.deepEqual(toVerificationUiState(verifiedResult()), {
      code: "VERIFIED",
      tone: "success",
      title: "链上验证通过",
      detail: "报告正文、推理证明、链上记录和团队审计钱包全部一致。",
    });
  });

  for (const field of ["isStepChainValid", "isManifestValid"] as const) {
    it(`refuses a green state when ${field} is false`, () => {
      assert.equal(toVerificationUiState(verifiedResult({ [field]: false })).code, "REASONING_PROOF_MISMATCH");
    });
  }

  it("shows a report hash mismatch before any green verification state", function () {
    const state = toVerificationUiState(verifiedResult({
      isVerified: false,
      isLocallyValid: false,
      isReportHashValid: false,
    }));
    assert.equal(state.code, "REPORT_HASH_MISMATCH");
    assert.equal(state.tone, "danger");
  });

  it("distinguishes an unanchored valid report from a tampered report", function () {
    const state = toVerificationUiState(verifiedResult({
      isVerified: false,
      isAnchored: false,
      isMerkleRootMatch: false,
      isRiskScoreMatch: false,
      isAuditorTrusted: false,
    }));
    assert.equal(state.code, "NOT_ANCHORED");
    assert.equal(state.tone, "warning");
  });

  it("does not trust a record from the wrong auditor", function () {
    const state = toVerificationUiState(verifiedResult({
      isVerified: false,
      isAuditorTrusted: false,
    }));
    assert.equal(state.code, "UNTRUSTED_AUDITOR");
    assert.equal(state.tone, "danger");
  });
});

describe("frontend report file boundary", function () {
  it("parses a JSON report without depending on the browser File class", async function () {
    const report = await parseReportJsonFile({
      name: "audit-report.json",
      size: 17,
      text: async () => '{"task_id":"1"}',
    });
    assert.deepEqual(report, { task_id: "1" });
  });

  it("rejects unsupported, oversized, and malformed files with stable codes", async function () {
    const cases = [
      {
        file: { name: "report.pdf", size: 10, text: async () => "{}" },
        code: "UNSUPPORTED_FILE",
      },
      {
        file: { name: "report.json", size: 10_485_761, text: async () => "{}" },
        code: "FILE_TOO_LARGE",
      },
      {
        file: { name: "report.json", size: 5, text: async () => "nope" },
        code: "INVALID_JSON",
      },
    ] as const;

    for (const testCase of cases) {
      await assert.rejects(
        parseReportJsonFile(testCase.file),
        (error) => error instanceof FluxAuditFrontendError && error.code === testCase.code,
      );
    }
  });
});

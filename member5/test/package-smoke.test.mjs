import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ZERO_HASH,
  hashStep,
  parseReportJsonFile,
  toVerificationUiState,
  verifyReportLocally,
} from "@fluxaudit/member5-web3";

describe("published SDK entry point", function () {
  it("loads through package exports and exposes the public API", function () {
    assert.match(hashStep(ZERO_HASH, "package-smoke", 1), /^0x[0-9a-f]{64}$/);
    assert.equal(typeof parseReportJsonFile, "function");
    assert.equal(typeof toVerificationUiState, "function");
    assert.equal(typeof verifyReportLocally, "function");
  });
});

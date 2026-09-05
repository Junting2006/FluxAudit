import assert from "node:assert/strict";
import test from "node:test";
import {
  HASH_ALGORITHM,
  HASH_VERSION,
  ZERO_HASH,
  canonicalJson,
  computeMerkleRoot,
  computeReportHash,
  computeReportPayloadHash,
  hashCanonicalValue,
  hashStep,
  parseAuditReportJson,
  verifyAuditReport,
} from "../src/lib/proof.js";
import { presentRiskAssessment } from "../src/lib/riskPresentation.js";
import { analysisEngineLabel, getRuntimeReadiness, runtimeLabel } from "../src/lib/runtimeHealth.js";

const STEP_NAMES = [
  "INPUT_VALIDATED",
  "CHAIN_FETCHED",
  "DOC_PARSING",
  "CROSS_CHECKING",
  "RISK_SCORING",
  "REPORT_ASSEMBLED",
  "PROOF_MANIFEST_COMPILED",
];

function makeStep({ index, previousStepHash, input, output, currentStep }) {
  const source = [2, 3, 4].includes(index) ? "AI" : "BACKEND";
  const payload = {
    task_id: "task_frontend_verify",
    step_index: index,
    source,
    agent: source === "AI" ? "RiskAgent" : "Backend",
    current_step: currentStep,
    message: `${currentStep} complete.`,
    evidence: [`step:${index}`],
    input_hash: hashCanonicalValue(input),
    output_hash: hashCanonicalValue(output),
  };
  const hashContent = canonicalJson(payload);
  const timestampMs = 1_788_490_149_000 + index * 1_000;
  return {
    ...payload,
    input,
    output,
    timestamp: timestampMs,
    timestamp_ms: timestampMs,
    previous_step_hash: previousStepHash,
    hash_content: hashContent,
    step_hash: hashStep(previousStepHash, hashContent, timestampMs),
    hash_algorithm: HASH_ALGORITHM,
    hash_version: HASH_VERSION,
  };
}

function buildReport() {
  const floatValue = parseAuditReportJson('{"lockup_years":2.0}').losslessReport;
  const report = {
    task_id: "task_frontend_verify",
    meta: {
      model_version: "test-v1",
      data_sources: ["Mock Chain Data", "Whitepaper", "Rule Engine"],
      data_mode: "mock",
      data_provenance: { lockup_years: "whitepaper" },
      timestamp: 1_788_490_149,
    },
    summary: { overall_risk_score: 85, risk_level: "HIGH", verdict: "Test report." },
    findings: [],
    proof_data: {
      hash_algorithm: HASH_ALGORITHM,
      hash_version: HASH_VERSION,
      manifest_version: "proof-manifest-v1",
      steps: [],
      step_hashes: [],
      reasoning_step_hashes: [],
      backend_step_hashes: [],
      manifest_step_hash: "",
      report_payload_hash: "",
      merkle_root: "",
      report_hash: "",
    },
    disclaimer: "Integrity is not a safety guarantee.",
  };

  const payloadHash = computeReportPayloadHash(report);
  let previousStepHash = ZERO_HASH;
  const steps = STEP_NAMES.map((currentStep, index) => {
    const isManifest = currentStep === "PROOF_MANIFEST_COMPILED";
    const input = isManifest
      ? {
          ordered_prior_step_hashes: report.proof_data.steps.map((step) => step.step_hash),
          report_payload_hash: payloadHash,
        }
      : index === 2
        ? floatValue
        : { previous_index: index - 1 };
    const output = isManifest
      ? {
          manifest_version: "proof-manifest-v1",
          hash_algorithm: HASH_ALGORITHM,
          hash_version: HASH_VERSION,
          ordered_steps: STEP_NAMES,
          prior_step_count: 6,
          final_step_count: 7,
          report_payload_hash: payloadHash,
        }
      : { completed: true, index };
    const step = makeStep({ index, previousStepHash, input, output, currentStep });
    previousStepHash = step.step_hash;
    report.proof_data.steps.push(step);
    return step;
  });

  const stepHashes = steps.map((step) => step.step_hash);
  report.proof_data.step_hashes = stepHashes;
  report.proof_data.reasoning_step_hashes = steps
    .filter((step) => step.source === "AI")
    .map((step) => step.step_hash);
  report.proof_data.backend_step_hashes = steps
    .filter((step) => step.source === "BACKEND")
    .map((step) => step.step_hash);
  report.proof_data.manifest_step_hash = steps.at(-1).step_hash;
  report.proof_data.report_payload_hash = payloadHash;
  report.proof_data.merkle_root = computeMerkleRoot(stepHashes);
  report.proof_data.report_hash = computeReportHash(report);
  return report;
}

test("verifies the complete seven-step Ethereum keccak256 report", () => {
  const source = canonicalJson(buildReport());
  assert.match(source, /"lockup_years":2/);
  const parsed = parseAuditReportJson(source);
  const result = verifyAuditReport(parsed.losslessReport);

  assert.equal(result.valid, true);
  assert.equal(result.stepsTotal, 7);
  assert.equal(result.stepsPassed, 7);
  assert.equal(result.firstMismatch, null);
  assert.equal(result.computedMerkleRoot, parsed.report.proof_data.merkle_root);
  assert.equal(result.computedReportHash, parsed.report.proof_data.report_hash);
});

test("matches the backend canonical JSON and Ethereum keccak256 vector", () => {
  const parsed = parseAuditReportJson(
    '{"ratio":2.5,"lockup_years":2.0,"nested":[-0.0,true,null,"2.0",{"negative":-3.0}]}',
  );
  const expected = '{"lockup_years":2,"nested":[0,true,null,"2.0",{"negative":-3}],"ratio":2.5}';

  assert.equal(canonicalJson(parsed.losslessReport), expected);
  assert.equal(
    hashCanonicalValue(parsed.losslessReport),
    "0xae69b1383574e561399317147549ebb6bdec10e6f5deebcade7893a0802ff8df",
  );
});

test("reports the first modified step field instead of accepting a demo proof", () => {
  const report = buildReport();
  report.proof_data.steps[3].output.completed = false;
  const result = verifyAuditReport(report);

  assert.equal(result.valid, false);
  assert.equal(result.firstMismatch.index, 3);
  assert.equal(result.firstMismatch.reason, "output_hash");
});

test("rejects a non-Ethereum hash contract", () => {
  const report = buildReport();
  report.proof_data.hash_algorithm = "sha3-256";
  const result = verifyAuditReport(report);

  assert.equal(result.valid, false);
  assert.equal(result.firstMismatch.reason, "hash_algorithm");
});

test("report_hash excludes only its self-referential field", () => {
  const report = buildReport();
  const expected = computeReportHash(report);
  report.proof_data.report_hash = `0x${"1".repeat(64)}`;
  assert.equal(computeReportHash(report), expected);

  report.proof_data.merkle_root = `0x${"2".repeat(64)}`;
  assert.notEqual(computeReportHash(report), expected);
});

test("failed and unverified reports never present a green low-risk conclusion", () => {
  const failed = presentRiskAssessment({
    failed: true,
    ready: false,
    locallyVerified: false,
    riskLevel: "LOW",
    riskScore: 0,
  });
  assert.deepEqual(
    { level: failed.level, score: failed.score, state: failed.state, trusted: failed.trusted },
    { level: "NOT ASSESSED", score: null, state: "failed", trusted: false },
  );

  const tampered = presentRiskAssessment({
    ready: true,
    locallyVerified: false,
    riskLevel: "LOW",
    riskScore: 12,
  });
  assert.equal(tampered.level, "LOW");
  assert.equal(tampered.state, "unverified");
  assert.equal(tampered.trusted, false);

  const verified = presentRiskAssessment({
    ready: true,
    locallyVerified: true,
    riskLevel: "LOW",
    riskScore: 12,
  });
  assert.equal(verified.state, "trusted");
  assert.equal(verified.trusted, true);

  const unsupported = presentRiskAssessment({
    ready: true,
    locallyVerified: true,
    riskLevel: "UNKNOWN",
    riskScore: 0,
  });
  assert.equal(unsupported.level, "UNAVAILABLE");
  assert.equal(unsupported.state, "unavailable");
  assert.equal(unsupported.trusted, false);
});

test("a reachable backend is not audit-ready without member 3 or the mock fallback", () => {
  const incompleteHealth = {
    status: "ok",
    use_mock_data: false,
    member3_connected: false,
    chain_agent_status: "mock",
  };
  const incomplete = getRuntimeReadiness(incompleteHealth, "healthy");
  assert.equal(incomplete.backendReachable, true);
  assert.equal(incomplete.analysisReady, false);
  assert.match(runtimeLabel(incompleteHealth, "healthy"), /Member 3 unavailable/);
  assert.match(analysisEngineLabel(null, "checking"), /Checking/);
  assert.match(analysisEngineLabel(null, "offline"), /unknown/);

  assert.equal(getRuntimeReadiness({
    ...incompleteHealth,
    member3_connected: true,
  }, "healthy").analysisReady, true);
  assert.equal(analysisEngineLabel({
    ...incompleteHealth,
    use_mock_data: true,
    member3_connected: true,
  }, "healthy"), "Member 3 connected");
  assert.equal(getRuntimeReadiness({
    ...incompleteHealth,
    use_mock_data: true,
  }, "healthy").analysisReady, true);
});

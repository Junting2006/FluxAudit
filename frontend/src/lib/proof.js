import { keccak256, toUtf8Bytes } from "ethers";
import {
  HASH_ALGORITHM as MEMBER5_HASH_ALGORITHM,
  HASH_VERSION as MEMBER5_HASH_VERSION,
  MANIFEST_VERSION,
  SUCCESS_PROOF_STEPS,
  ZERO_HASH as MEMBER5_ZERO_HASH,
  canonicalJson as member5CanonicalJson,
  computeReportHash as member5ComputeReportHash,
  hashStep as member5HashStep,
  merkleRoot as member5MerkleRoot,
  verifyReportLocally as verifyMember5ReportLocally,
} from "@fluxaudit/member5-web3";

export const ZERO_HASH = MEMBER5_ZERO_HASH;
export const HASH_ALGORITHM = MEMBER5_HASH_ALGORITHM;
export const HASH_VERSION = MEMBER5_HASH_VERSION;
export { MANIFEST_VERSION, SUCCESS_PROOF_STEPS };

export const ETHEREUM_EMPTY_VECTOR =
  "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470";

export const ethereumKeccakReady =
  keccak256(toUtf8Bytes("")) === ETHEREUM_EMPTY_VECTOR;

export function canonicalJson(value) {
  return member5CanonicalJson(value);
}

/** Parse report JSON into the plain values consumed by the member 5 verifier. */
export function parseAuditReportJson(source) {
  const report = JSON.parse(source);
  return {
    report,
    losslessReport: report,
    preservesNumberTokens: false,
  };
}

export function hashStep(previousStepHash, hashContent, timestampMs) {
  return member5HashStep(previousStepHash, hashContent, timestampMs);
}

export function computeMerkleRoot(stepHashes) {
  return member5MerkleRoot(stepHashes);
}

export function hashCanonicalValue(value) {
  const canonical = canonicalJson(value);
  if (typeof canonical !== "string") {
    throw new TypeError("Value cannot be represented as canonical JSON");
  }
  return keccak256(toUtf8Bytes(canonical));
}

export function computeReportHash(report) {
  return member5ComputeReportHash(report);
}

export function computeReportPayloadHash(report) {
  const payload = Object.fromEntries(
    ["task_id", "meta", "summary", "findings", "disclaimer"]
      .filter((key) => Object.hasOwn(report || {}, key))
      .map((key) => [key, report[key]]),
  );
  return hashCanonicalValue(payload);
}

function sameArray(left, right) {
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function isHash(value) {
  return typeof value === "string" && /^0x[0-9a-f]{64}$/.test(value);
}

function readNumber(value) {
  return value;
}

function failure(scope, reason, expected, actual, index) {
  return { scope, reason, expected, actual, ...(index === undefined ? {} : { index }) };
}

function sameCanonical(left, right) {
  try {
    return canonicalJson(left) === canonicalJson(right);
  } catch {
    return false;
  }
}

/** Verify a member-4 report using only fields contained in that report. */
export function verifyAuditReport(report) {
  const failures = [];
  const proofData = report?.proof_data;
  const steps = Array.isArray(proofData?.steps) ? proofData.steps : [];
  let member5Verification = null;
  let member5Error = null;
  const protocolSupported = proofData?.hash_algorithm === HASH_ALGORITHM
    && proofData?.hash_version === HASH_VERSION
    && proofData?.manifest_version === MANIFEST_VERSION;

  if (!report || typeof report !== "object" || Array.isArray(report)) {
    failures.push(failure("report", "invalid_report", "JSON object", typeof report));
  }
  if (!proofData || typeof proofData !== "object" || Array.isArray(proofData)) {
    failures.push(failure("proof", "missing_proof_data", "proof_data object", proofData));
  }
  if (!ethereumKeccakReady) {
    failures.push(failure("contract", "keccak_unavailable", ETHEREUM_EMPTY_VECTOR, null));
  }
  if (proofData?.hash_algorithm !== HASH_ALGORITHM) {
    failures.push(failure("contract", "hash_algorithm", HASH_ALGORITHM, proofData?.hash_algorithm));
  }
  if (proofData?.hash_version !== HASH_VERSION) {
    failures.push(failure("contract", "hash_version", HASH_VERSION, proofData?.hash_version));
  }
  if (proofData?.manifest_version !== MANIFEST_VERSION) {
    failures.push(
      failure("manifest", "manifest_version", MANIFEST_VERSION, proofData?.manifest_version),
    );
  }
  if (!Array.isArray(proofData?.steps) || proofData.steps.length !== SUCCESS_PROOF_STEPS.length) {
    failures.push(
      failure(
        "chain",
        "step_count",
        SUCCESS_PROOF_STEPS.length,
        Array.isArray(proofData?.steps) ? proofData.steps.length : proofData?.steps,
      ),
    );
  }
  if (typeof report?.task_id !== "string" || report.task_id.trim().length === 0) {
    failures.push(failure("chain", "task_id", "non-empty string", report?.task_id));
  }
  try {
    member5Verification = verifyMember5ReportLocally(report);
  } catch (error) {
    member5Error = error;
    failures.push(
      failure(
        "protocol",
        "unsupported_protocol",
        `${HASH_ALGORITHM}/${HASH_VERSION}/${MANIFEST_VERSION}`,
        error instanceof Error ? error.message : String(error),
      ),
    );
  }

  // The SDK is the authority. If it cannot safely interpret the structure, stop
  // diagnostics here instead of letting best-effort UI detail throw as well.
  if (member5Error) {
    return {
      valid: false,
      isLocallyValid: false,
      isReportHashValid: false,
      isMerkleRootValid: false,
      isStepChainValid: false,
      isManifestValid: false,
      protocolSupported,
      verificationError: member5Error instanceof Error ? member5Error.message : null,
      failures,
      firstMismatch: failures[0] || null,
      stepsTotal: steps.length,
      stepsPassed: 0,
      stepResults: [],
      stepHashes: steps.map((step) => step?.step_hash),
      chainValid: false,
      merkleValid: false,
      manifestValid: false,
      stepChainValid: false,
      reportHashValid: false,
      computedMerkleRoot: null,
      declaredMerkleRoot: proofData?.merkle_root || null,
      computedReportHash: null,
      declaredReportHash: proofData?.report_hash || null,
    };
  }

  const stepResults = [];
  let previousStepHash = ZERO_HASH;

  steps.forEach((step, index) => {
    const before = failures.length;
    const stepIndex = readNumber(step?.step_index);
    const timestamp = readNumber(step?.timestamp);
    const timestampMs = readNumber(step?.timestamp_ms);
    const expectedStepName = SUCCESS_PROOF_STEPS[index];
    const expectedSource = index >= 2 && index <= 4 ? "AI" : "BACKEND";

    if (stepIndex !== index) {
      failures.push(failure("step", "step_index", index, stepIndex, index));
    }
    if (step?.task_id !== report?.task_id) {
      failures.push(failure("step", "task_id", report?.task_id, step?.task_id, index));
    }
    if (step?.current_step !== expectedStepName) {
      failures.push(
        failure("step", "step_order", expectedStepName, step?.current_step, index),
      );
    }
    if (step?.source !== expectedSource) {
      failures.push(failure("step", "step_source", expectedSource, step?.source, index));
    }
    if (step?.hash_algorithm !== HASH_ALGORITHM || step?.hash_version !== HASH_VERSION) {
      failures.push(
        failure(
          "step",
          "hash_contract",
          `${HASH_ALGORITHM}/${HASH_VERSION}`,
          `${step?.hash_algorithm}/${step?.hash_version}`,
          index,
        ),
      );
    }
    if (step?.previous_step_hash !== previousStepHash) {
      failures.push(
        failure("step", "previous_step_hash", previousStepHash, step?.previous_step_hash, index),
      );
    }

    if (!Object.hasOwn(step || {}, "input")) {
      failures.push(failure("step", "missing_input", "input field", undefined, index));
    }
    if (!Object.hasOwn(step || {}, "output")) {
      failures.push(failure("step", "missing_output", "output field", undefined, index));
    }
    if (!Array.isArray(step?.evidence)) {
      failures.push(failure("step", "evidence", "array", step?.evidence, index));
    }

    let expectedInputHash = null;
    let expectedOutputHash = null;
    try {
      expectedInputHash = hashCanonicalValue(step?.input);
      expectedOutputHash = hashCanonicalValue(step?.output);
    } catch {
      failures.push(failure("step", "canonical_input_output", "valid JSON values", null, index));
    }
    if (step?.input_hash !== expectedInputHash) {
      failures.push(failure("step", "input_hash", expectedInputHash, step?.input_hash, index));
    }
    if (step?.output_hash !== expectedOutputHash) {
      failures.push(failure("step", "output_hash", expectedOutputHash, step?.output_hash, index));
    }

    let expectedContent = null;
    try {
      expectedContent = canonicalJson({
        task_id: step?.task_id,
        step_index: step?.step_index,
        source: step?.source,
        agent: step?.agent,
        current_step: step?.current_step,
        message: step?.message,
        evidence: step?.evidence,
        input_hash: expectedInputHash,
        output_hash: expectedOutputHash,
      });
    } catch {
      failures.push(failure("step", "hash_content", "canonical step content", null, index));
    }
    if (step?.hash_content !== expectedContent) {
      failures.push(failure("step", "hash_content", expectedContent, step?.hash_content, index));
    }

    if (!Number.isSafeInteger(timestampMs) || timestampMs < 0) {
      failures.push(
        failure("step", "timestamp_ms", "non-negative safe integer", timestampMs, index),
      );
    }
    if (!Number.isSafeInteger(timestamp) || timestamp < 0 || timestamp !== timestampMs) {
      failures.push(failure("step", "timestamp", timestampMs, timestamp, index));
    }
    let expectedStepHash = null;
    if (Number.isSafeInteger(timestampMs) && timestampMs >= 0 && expectedContent !== null) {
      try {
        expectedStepHash = hashStep(previousStepHash, expectedContent, timestampMs);
      } catch {
        failures.push(failure("step", "step_hash", "valid keccak step input", null, index));
      }
    }
    if (step?.step_hash !== expectedStepHash) {
      failures.push(failure("step", "step_hash", expectedStepHash, step?.step_hash, index));
    }

    stepResults.push({
      index,
      currentStep: step?.current_step || `STEP_${index}`,
      valid: failures.length === before,
      expectedStepHash,
      declaredStepHash: step?.step_hash,
    });
    previousStepHash = step?.step_hash;
  });

  const stepHashes = steps.map((step) => step?.step_hash);
  if (!sameArray(proofData?.step_hashes, stepHashes)) {
    failures.push(
      failure("chain", "step_hashes_manifest", stepHashes, proofData?.step_hashes),
    );
  }
  const reasoningStepHashes = steps
    .filter((step) => step?.source === "AI")
    .map((step) => step.step_hash);
  if (!sameArray(proofData?.reasoning_step_hashes, reasoningStepHashes)) {
    failures.push(
      failure(
        "chain",
        "reasoning_step_hashes",
        reasoningStepHashes,
        proofData?.reasoning_step_hashes,
      ),
    );
  }
  const backendStepHashes = steps
    .filter((step) => step?.source === "BACKEND")
    .map((step) => step.step_hash);
  if (!sameArray(proofData?.backend_step_hashes, backendStepHashes)) {
    failures.push(
      failure(
        "chain",
        "backend_step_hashes",
        backendStepHashes,
        proofData?.backend_step_hashes,
      ),
    );
  }

  const manifestStep = steps[SUCCESS_PROOF_STEPS.length - 1];
  const payloadKeys = ["task_id", "meta", "summary", "findings", "disclaimer"];
  const missingPayloadKeys = payloadKeys.filter((key) => !Object.hasOwn(report || {}, key));
  if (missingPayloadKeys.length) {
    failures.push(
      failure("manifest", "report_payload_fields", payloadKeys, missingPayloadKeys),
    );
  }

  let expectedPayloadHash = null;
  try {
    expectedPayloadHash = computeReportPayloadHash(report);
  } catch (error) {
    failures.push(
      failure(
        "manifest",
        "report_payload_hash",
        "canonical report payload",
        error instanceof Error ? error.message : String(error),
      ),
    );
  }

  if (proofData?.manifest_step_hash !== manifestStep?.step_hash) {
    failures.push(
      failure(
        "manifest",
        "manifest_step_hash",
        manifestStep?.step_hash,
        proofData?.manifest_step_hash,
      ),
    );
  }
  if (proofData?.report_payload_hash !== expectedPayloadHash) {
    failures.push(
      failure(
        "manifest",
        "report_payload_hash",
        expectedPayloadHash,
        proofData?.report_payload_hash,
      ),
    );
  }

  const expectedManifestInput = {
    ordered_prior_step_hashes: stepHashes.slice(0, SUCCESS_PROOF_STEPS.length - 1),
    report_payload_hash: expectedPayloadHash,
  };
  if (!sameCanonical(manifestStep?.input, expectedManifestInput)) {
    failures.push(
      failure("manifest", "manifest_input", expectedManifestInput, manifestStep?.input),
    );
  }

  const expectedManifestOutput = {
    manifest_version: MANIFEST_VERSION,
    hash_algorithm: HASH_ALGORITHM,
    hash_version: HASH_VERSION,
    ordered_steps: [...SUCCESS_PROOF_STEPS],
    prior_step_count: SUCCESS_PROOF_STEPS.length - 1,
    final_step_count: SUCCESS_PROOF_STEPS.length,
    report_payload_hash: expectedPayloadHash,
  };
  if (!sameCanonical(manifestStep?.output, expectedManifestOutput)) {
    failures.push(
      failure("manifest", "manifest_output", expectedManifestOutput, manifestStep?.output),
    );
  }

  let computedMerkleRoot = null;
  if (stepHashes.length && stepHashes.every(isHash)) {
    computedMerkleRoot = member5Verification?.computedMerkleRoot
      || computeMerkleRoot(stepHashes);
    if (proofData?.merkle_root !== computedMerkleRoot) {
      failures.push(
        failure("merkle", "merkle_root", computedMerkleRoot, proofData?.merkle_root),
      );
    }
  } else if (stepHashes.length) {
    failures.push(failure("merkle", "invalid_step_hash", "0x-prefixed 32-byte hashes", stepHashes));
  }

  let computedReportHash = member5Verification?.computedReportHash || null;
  if (!computedReportHash && report && typeof report === "object") {
    try {
      computedReportHash = computeReportHash(report);
    } catch (error) {
      failures.push(
        failure(
          "report",
          "report_not_canonical",
          "canonical JSON report",
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
  }
  if (proofData?.report_hash !== computedReportHash) {
    failures.push(
      failure("report", "report_hash", computedReportHash, proofData?.report_hash),
    );
  }

  const reportHashValid = member5Verification?.isReportHashValid === true;
  const merkleValid = member5Verification?.isMerkleRootValid === true;
  const stepChainValid = member5Verification?.isStepChainValid === true;
  const manifestValid = member5Verification?.isManifestValid === true;
  const chainValid = stepChainValid && manifestValid;
  const valid = member5Verification?.isLocallyValid === true && failures.length === 0;

  return {
    valid,
    isLocallyValid: valid,
    isReportHashValid: reportHashValid,
    isMerkleRootValid: merkleValid,
    isStepChainValid: stepChainValid,
    isManifestValid: manifestValid,
    protocolSupported,
    verificationError: member5Error instanceof Error ? member5Error.message : null,
    failures,
    firstMismatch: failures[0] || null,
    stepsTotal: steps.length,
    stepsPassed: stepResults.filter(({ valid }) => valid).length,
    stepResults,
    stepHashes,
    chainValid,
    merkleValid,
    manifestValid,
    stepChainValid,
    reportHashValid,
    computedMerkleRoot,
    declaredMerkleRoot: proofData?.merkle_root || null,
    computedReportHash,
    declaredReportHash: proofData?.report_hash || null,
  };
}

export function createProofChain(definitions, taskId = "NOVA-DEMO-001") {
  let previousStepHash = ZERO_HASH;

  return definitions.map((definition, arrayIndex) => {
    const stepIndex = arrayIndex + 1;
    const timestampMs = 1788490149000 + stepIndex * 3000;
    const payload = {
      task_id: taskId,
      step_index: stepIndex,
      source: definition.source,
      agent: definition.agent,
      current_step: definition.title,
      message: definition.message,
      evidence_count: definition.evidenceCount,
      risk: definition.risk ?? null,
    };
    const hashContent = canonicalJson(payload);
    const stepHash = hashStep(previousStepHash, hashContent, timestampMs);
    const step = {
      ...definition,
      taskId,
      stepIndex,
      timestampMs,
      previousStepHash,
      hashContent,
      stepHash,
      hashAlgorithm: HASH_ALGORITHM,
      hashVersion: HASH_VERSION,
    };
    previousStepHash = stepHash;
    return step;
  });
}

export function verifyProofChain(steps) {
  const failures = [];

  steps.forEach((step, index) => {
    const expectedPrevious = index === 0 ? ZERO_HASH : steps[index - 1].stepHash;
    if (step.previousStepHash !== expectedPrevious) {
      failures.push({ index, reason: "previous_step_hash" });
    }
    const recomputed = hashStep(
      step.previousStepHash,
      step.hashContent,
      step.timestampMs,
    );
    if (recomputed !== step.stepHash) {
      failures.push({ index, reason: "step_hash" });
    }
    if (
      step.hashAlgorithm !== HASH_ALGORITHM ||
      step.hashVersion !== HASH_VERSION
    ) {
      failures.push({ index, reason: "hash_contract" });
    }
  });

  const stepHashes = steps.map((step) => step.stepHash);
  return {
    valid: failures.length === 0 && ethereumKeccakReady,
    failures,
    merkleRoot: computeMerkleRoot(stepHashes),
    stepHashes,
  };
}

export function shortHash(hash, leading = 6, trailing = 4) {
  if (!hash || hash.length < leading + trailing + 1) return hash;
  return `${hash.slice(0, leading)}…${hash.slice(-trailing)}`;
}

import { canonicalJson, isPlainObject } from "./canonical.js";
export { canonicalJson } from "./canonical.js";
import { concat, getBytes, keccak256, toUtf8Bytes } from "ethers";

export const ZERO_HASH = `0x${"0".repeat(64)}` as Hex32;
export const HASH_ALGORITHM = "ethereum-keccak256";
export const HASH_VERSION = "keccak-v1";
export const MANIFEST_VERSION = "proof-manifest-v1";
export const SUCCESS_PROOF_STEPS = [
  "INPUT_VALIDATED", "CHAIN_FETCHED", "DOC_PARSING", "CROSS_CHECKING",
  "RISK_SCORING", "REPORT_ASSEMBLED", "PROOF_MANIFEST_COMPILED",
] as const;

export type Hex32 = `0x${string}`;

export interface AttestationInput {
  reportHash: Hex32;
  merkleRoot: Hex32;
  riskScore: number;
}

export interface LocalVerificationResult {
  isLocallyValid: boolean;
  isReportHashValid: boolean;
  isMerkleRootValid: boolean;
  isStepChainValid: boolean;
  isManifestValid: boolean;
  computedReportHash: Hex32;
  computedMerkleRoot: Hex32;
  suppliedReportHash: Hex32;
  suppliedMerkleRoot: Hex32;
}

export interface ReportProofFields extends AttestationInput {
  stepHashes: Hex32[];
}

export function assertHex32(value: unknown, fieldName: string): asserts value is Hex32 {
  if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/.test(value)) {
    throw new TypeError(`${fieldName} must be a lowercase 0x-prefixed bytes32 value`);
  }
}

function assertDenseArray(value: readonly unknown[], fieldName: string): void {
  for (let index = 0; index < value.length; index += 1) {
    if (!(index in value)) {
      throw new TypeError(`${fieldName}[${index}] cannot be an array hole`);
    }
  }
}

/** Reproduces member3/member4: keccak256(UTF8(`${prev}|${content}|${timestamp}`)). */
export function hashStep(prevHash: Hex32, content: string, timestampMs: number): Hex32 {
  assertHex32(prevHash, "prevHash");
  if (typeof content !== "string") throw new TypeError("content must be a string");
  if (!Number.isSafeInteger(timestampMs) || timestampMs < 0) {
    throw new TypeError("timestampMs must be a non-negative safe integer");
  }
  return keccak256(toUtf8Bytes(`${prevHash}|${content}|${timestampMs}`)) as Hex32;
}

/** Reproduces member4's text-leaf Merkle algorithm exactly. */
export function merkleRoot(stepHashes: readonly unknown[]): Hex32 {
  if (!Array.isArray(stepHashes)) throw new TypeError("stepHashes must be an array");
  if (stepHashes.length === 0) return ZERO_HASH;
  assertDenseArray(stepHashes, "stepHashes");

  let level = stepHashes.map((hash, index) => {
    assertHex32(hash, `stepHashes[${index}]`);
    return keccak256(toUtf8Bytes(hash)) as Hex32;
  });

  while (level.length > 1) {
    if (level.length % 2 === 1) level = [...level, level[level.length - 1]];
    const next: Hex32[] = [];
    for (let index = 0; index < level.length; index += 2) {
      next.push(keccak256(concat([getBytes(level[index]), getBytes(level[index + 1])])) as Hex32);
    }
    level = next;
  }

  return level[0];
}

function reportWithoutSelfHash(report: unknown): Record<string, unknown> {
  if (!isPlainObject(report)) throw new TypeError("report must be a JSON object");
  if (!isPlainObject(report.proof_data)) throw new TypeError("report.proof_data must be an object");
  return {
    ...report,
    proof_data: Object.fromEntries(Object.entries(report.proof_data).filter(([key]) => key !== "report_hash")),
  };
}

/** keccak-v1: excludes only proof_data.report_hash; does not mutate the report. */
export function computeReportHash(report: unknown): Hex32 {
  return hashJson(reportWithoutSelfHash(report));
}

export function extractReportProof(report: unknown): ReportProofFields {
  if (!isPlainObject(report)) throw new TypeError("report must be a JSON object");
  const proofData = report.proof_data;
  const summary = report.summary;
  if (!isPlainObject(proofData)) throw new TypeError("report.proof_data must be an object");
  if (!isPlainObject(summary)) throw new TypeError("report.summary must be an object");
  assertProtocol(proofData);

  const reportHash = proofData.report_hash;
  const root = proofData.merkle_root;
  assertHex32(reportHash, "proof_data.report_hash");
  assertHex32(root, "proof_data.merkle_root");

  if (!Array.isArray(proofData.step_hashes) || proofData.step_hashes.length === 0) {
    throw new TypeError("proof_data.step_hashes must be a non-empty array");
  }
  assertDenseArray(proofData.step_hashes, "proof_data.step_hashes");
  const stepHashes = proofData.step_hashes.map((value, index) => {
    assertHex32(value, `proof_data.step_hashes[${index}]`);
    return value;
  });

  const riskScore = summary.overall_risk_score;
  if (!Number.isSafeInteger(riskScore) || (riskScore as number) < 0 || (riskScore as number) > 100) {
    throw new TypeError("summary.overall_risk_score (riskScore) must be an integer from 0 to 100");
  }

  return { reportHash, merkleRoot: root, stepHashes, riskScore: riskScore as number };
}

export function verifyReportLocally(report: unknown): LocalVerificationResult {
  const supplied = extractReportProof(report);
  const computedReportHash = computeReportHash(report);
  const computedMerkleRoot = merkleRoot(supplied.stepHashes);
  const isReportHashValid = computedReportHash === supplied.reportHash;
  const isMerkleRootValid = computedMerkleRoot === supplied.merkleRoot;
  const { isStepChainValid, isManifestValid } = verifyProofSteps(report);

  return {
    isLocallyValid: isReportHashValid && isMerkleRootValid && isStepChainValid && isManifestValid,
    isReportHashValid,
    isMerkleRootValid,
    isStepChainValid,
    isManifestValid,
    computedReportHash,
    computedMerkleRoot,
    suppliedReportHash: supplied.reportHash,
    suppliedMerkleRoot: supplied.merkleRoot,
  };
}

/** Returns safe on-chain values only after local integrity checks pass. */
export function parseAttestationInput(report: unknown): AttestationInput {
  const fields = extractReportProof(report);
  const verification = verifyReportLocally(report);
  if (!verification.isLocallyValid) {
    throw new Error("report failed local seven-step chain, manifest, reportHash or merkleRoot verification");
  }
  return {
    reportHash: fields.reportHash,
    merkleRoot: fields.merkleRoot,
    riskScore: fields.riskScore,
  };
}

function hashJson(value: unknown): Hex32 {
  return keccak256(toUtf8Bytes(canonicalJson(value))) as Hex32;
}

function assertProtocol(proof: Record<string, unknown>): void {
  if (proof.hash_algorithm !== HASH_ALGORITHM || proof.hash_version !== HASH_VERSION ||
      proof.manifest_version !== MANIFEST_VERSION) {
    throw new TypeError("unsupported proof protocol: require ethereum-keccak256 / keccak-v1 / proof-manifest-v1; legacy reports must be regenerated");
  }
}

interface ProofStep extends Record<string, unknown> {
  task_id: string;
  step_index: number;
  source: string;
  agent: string;
  current_step: string;
  message: string;
  evidence: unknown[];
  input: unknown;
  output: unknown;
  input_hash: Hex32;
  output_hash: Hex32;
  hash_content: string;
  previous_step_hash: Hex32;
  step_hash: Hex32;
  timestamp: number;
  timestamp_ms: number;
  hash_algorithm: string;
  hash_version: string;
}

function assertProofStep(value: unknown, index: number): asserts value is ProofStep {
  const path = `proof_data.steps[${index}]`;
  if (!isPlainObject(value)) throw new TypeError(`${path} must be an object`);
  for (const key of ["task_id", "source", "agent", "current_step", "message", "hash_content", "hash_algorithm", "hash_version"]) {
    if (typeof value[key] !== "string") throw new TypeError(`${path}.${key} must be a string`);
  }
  for (const key of ["step_index", "timestamp", "timestamp_ms"]) {
    if (typeof value[key] !== "number" || !Number.isSafeInteger(value[key]) || value[key] < 0) {
      throw new TypeError(`${path}.${key} must be a non-negative safe integer`);
    }
  }
  for (const key of ["input_hash", "output_hash", "previous_step_hash", "step_hash"]) {
    assertHex32(value[key], `${path}.${key}`);
  }
  if (!("input" in value) || !("output" in value) || !Array.isArray(value.evidence)) {
    throw new TypeError(`${path} requires input, output and evidence array`);
  }
}

function sameJson(left: unknown, right: unknown): boolean {
  return left !== undefined && right !== undefined && canonicalJson(left) === canonicalJson(right);
}

/** Checks all supplied data, not just hash_content strings, before allowing attestation. */
function verifyProofSteps(report: unknown): { isStepChainValid: boolean; isManifestValid: boolean } {
  if (!isPlainObject(report) || !isPlainObject(report.proof_data)) {
    throw new TypeError("report and proof_data must be objects");
  }
  const proof = report.proof_data;
  if (!Array.isArray(proof.steps)) throw new TypeError("proof_data.steps must be an array");
  assertDenseArray(proof.steps, "proof_data.steps");
  // Failed/partial workflows are readable backend artifacts, never eligible for attestation.
  if (proof.steps.length !== SUCCESS_PROOF_STEPS.length) {
    return { isStepChainValid: false, isManifestValid: false };
  }
  const steps = proof.steps.map((step, index) => {
    assertProofStep(step, index);
    return step;
  });
  let previous = ZERO_HASH;
  let isStepChainValid = typeof report.task_id === "string" && report.task_id.length > 0;
  for (const [index, step] of steps.entries()) {
    const inputHash = hashJson(step.input);
    const outputHash = hashJson(step.output);
    const content = canonicalJson({
      task_id: step.task_id,
      step_index: step.step_index,
      source: step.source,
      agent: step.agent,
      current_step: step.current_step,
      message: step.message,
      evidence: step.evidence,
      input_hash: inputHash,
      output_hash: outputHash,
    });
    const expectedSource = index >= 2 && index <= 4 ? "AI" : "BACKEND";
    const valid = step.step_index === index && step.task_id === report.task_id &&
      step.current_step === SUCCESS_PROOF_STEPS[index] && step.source === expectedSource &&
      step.hash_algorithm === HASH_ALGORITHM && step.hash_version === HASH_VERSION &&
      step.previous_step_hash === previous && step.timestamp === step.timestamp_ms &&
      step.input_hash === inputHash && step.output_hash === outputHash &&
      step.hash_content === content && hashStep(previous, content, step.timestamp_ms) === step.step_hash;
    isStepChainValid = isStepChainValid && valid;
    previous = step.step_hash;
  }

  const payloadKeys = ["task_id", "meta", "summary", "findings", "disclaimer"];
  const hasPayload = payloadKeys.every(key => Object.hasOwn(report, key));
  const payloadHash = hashJson(Object.fromEntries(payloadKeys.filter(key => Object.hasOwn(report, key)).map(key => [key, report[key]])));
  const manifest = steps[6];
  const priorHashes = steps.slice(0, 6).map(step => step.step_hash);
  const manifestInput = { ordered_prior_step_hashes: priorHashes, report_payload_hash: payloadHash };
  const manifestOutput = {
    manifest_version: MANIFEST_VERSION,
    hash_algorithm: HASH_ALGORITHM,
    hash_version: HASH_VERSION,
    ordered_steps: [...SUCCESS_PROOF_STEPS],
    prior_step_count: 6,
    final_step_count: 7,
    report_payload_hash: payloadHash,
  };
  const isManifestValid = hasPayload &&
    sameJson(manifest.input, manifestInput) && sameJson(manifest.output, manifestOutput) &&
    proof.manifest_step_hash === manifest.step_hash && proof.report_payload_hash === payloadHash &&
    sameJson(proof.step_hashes, steps.map(step => step.step_hash)) &&
    sameJson(proof.reasoning_step_hashes, steps.filter(step => step.source === "AI").map(step => step.step_hash)) &&
    sameJson(proof.backend_step_hashes, steps.filter(step => step.source === "BACKEND").map(step => step.step_hash));
  return { isStepChainValid, isManifestValid };
}

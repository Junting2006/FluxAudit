import { createProofChain, verifyProofChain } from "./proof.js";

export const DEMO_CASE_ID = "NOVA-DEMO-001";
export const DEMO_RUN_ID = "A-1042";
export const DEMO_ADDRESS = "0x71F4A0B2C3D4E5F60718293A4B5C6D7E8F9092A8";

const syntheticFullHash = (head, fill, tail) =>
  `0x${head}${fill.repeat(28)}${tail}`;

export const DEMO_HANDOFF_45 = syntheticFullHash("5d89", "11", "2e7f");
export const DEMO_HANDOFF_67 = syntheticFullHash("7a91", "22", "19ce");
export const DEMO_REPORT_HASH = syntheticFullHash("9a7e", "33", "3d45");
export const DEMO_MERKLE_ROOT = syntheticFullHash("2f9b", "44", "9a6b");

export const STAGE_DEFINITIONS = [
  {
    title: "Data Collection",
    shortTitle: "Data Collection",
    agent: "Collector",
    source: "BACKEND",
    message: "Public contract and document inputs normalized.",
    evidenceCount: 12,
  },
  {
    title: "Contract Analysis",
    shortTitle: "Contract Analysis",
    agent: "Tokenomics Agent",
    source: "AI",
    message: "Ownership and token-control surfaces analyzed.",
    evidenceCount: 18,
    risk: "MEDIUM",
  },
  {
    title: "On-chain Analysis",
    shortTitle: "On-chain Analysis",
    agent: "Reputation Agent",
    source: "AI",
    message: "Synthetic Sepolia activity fixture analyzed.",
    evidenceCount: 14,
    risk: "MEDIUM",
  },
  {
    title: "Security Analysis",
    shortTitle: "Security Analysis",
    agent: "Security Agent",
    source: "AI",
    message: "Privileged-control and withdrawal paths analyzed.",
    evidenceCount: 15,
    risk: "HIGH",
  },
  {
    title: "Consensus Synthesis",
    shortTitle: "Consensus Synthesis",
    agent: "Consensus Agent",
    source: "AI",
    message: "Public agent outputs reconciled into consensus.",
    evidenceCount: 59,
    risk: "HIGH",
  },
  {
    title: "Risk Adjudication",
    shortTitle: "Risk Adjudication",
    agent: "Risk Arbiter",
    source: "BACKEND",
    message: "Conflicts adjudicated against evidence coverage.",
    evidenceCount: 9,
    risk: "HIGH",
  },
  {
    title: "Report Compiler",
    shortTitle: "Report Compiler",
    agent: "Report Builder",
    source: "BACKEND",
    message: "Public report and proof manifest compiled.",
    evidenceCount: 7,
    risk: "HIGH",
  },
];

export const PROOF_STEPS = createProofChain(STAGE_DEFINITIONS);
export const PROOF_RESULT = verifyProofChain(PROOF_STEPS);

export const LIVE_EVENTS = [
  { time: "10:49:14", tone: "ok", text: "Evidence bundle received · 59 items" },
  { time: "10:49:16", tone: "ok", text: "Tokenomics Agent complete", value: "MEDIUM 72%" },
  { time: "10:49:18", tone: "ok", text: "Security Agent complete", value: "HIGH 86%" },
  { time: "10:49:21", tone: "ok", text: "Reputation Agent complete", value: "MEDIUM 64%" },
  { time: "10:49:23", tone: "info", text: "Reconciling agent disagreement" },
  { time: "10:49:27", tone: "active", text: "Computing step hash", value: "Ethereum keccak256" },
];

export const AGENTS = [
  { name: "Tokenomics", risk: "MEDIUM", confidence: "72%", source: "Step 02" },
  { name: "Security", risk: "HIGH", confidence: "86%", source: "Step 04" },
  { name: "Reputation", risk: "MEDIUM", confidence: "64%", source: "Step 01" },
];

export const FINDINGS = [
  { severity: "HIGH", title: "Privileged mint authority", source: "Security · Step 04", evidence: "3 items" },
  { severity: "HIGH", title: "Unprotected admin withdrawal", source: "Security · Step 04", evidence: "2 items" },
  { severity: "MEDIUM", title: "Concentrated token supply", source: "Tokenomics · Step 02", evidence: "4 items" },
];

export const AGENT_ASSESSMENTS = [
  { domain: "Tokenomics", consensus: "MEDIUM", confidence: "72%", takeaway: "Treasury address disclosed; spend policy missing." },
  { domain: "Security", consensus: "HIGH", confidence: "86%", takeaway: "Transfer restrictions absent; admin withdrawal exposed." },
  { domain: "Reputation", consensus: "MEDIUM", confidence: "64%", takeaway: "Team partly verified; limited track record." },
];

export const MOCK_REPORT = {
  task_id: DEMO_CASE_ID,
  case_alias: DEMO_RUN_ID,
  meta: {
    project: "NOVA Protocol",
    network: "Sepolia",
    mode: "Deterministic Mock",
    generated: "May 26, 2025 · 10:48:32 UTC",
    last_verified: "May 26, 2025 · 10:50:01 UTC",
    public_stages: 7,
    data_provenance: "Synthetic fixture · Sepolia not queried",
  },
  summary: {
    overall_risk_score: 78,
    risk_level: "HIGH",
    verdict:
      "Elevated control risk is driven by privileged mint authority and an unprotected admin withdrawal path.",
  },
  findings: FINDINGS,
  proof_data: {
    hash_algorithm: "ethereum-keccak256",
    hash_version: "keccak-v1",
    steps: PROOF_STEPS,
    step_hashes: PROOF_RESULT.stepHashes,
    computed_merkle_root: PROOF_RESULT.merkleRoot,
    merkle_root: DEMO_MERKLE_ROOT,
    report_hash: DEMO_REPORT_HASH,
    synthetic_fixture: true,
  },
  disclaimer:
    "This deterministic hackathon fixture demonstrates report integrity and lineage. It does not establish protocol safety and does not represent a live-chain attestation.",
};

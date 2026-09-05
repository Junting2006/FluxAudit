import { useEffect, useMemo, useRef, useState } from "react";
import {
  Anchor,
  ArrowsClockwise,
  BracketsCurly,
  CalendarBlank,
  CheckCircle,
  Circle,
  CirclesThreePlus,
  Cube,
  FileJs,
  Globe,
  Info,
  ListBullets,
  Minus,
  UploadSimple,
  XCircle,
} from "@phosphor-icons/react";
import {
  FluxAuditFrontendError,
  parseReportJsonFile,
} from "@fluxaudit/member5-web3";
import {
  AppShell,
  Breadcrumbs,
  Button,
  DataRow,
  HashValue,
  Panel,
  PanelHeader,
  StatusBadge,
  StatusLed,
} from "../components/ui.jsx";
import {
  HASH_ALGORITHM,
  parseAuditReportJson,
  shortHash,
  verifyAuditReport,
} from "../lib/proof.js";
import {
  describeAttestationError,
  getAttestationConfig,
  isCurrentVerifiedChainResult,
  verifyReportOnSepolia,
} from "../lib/attestationClient.js";

const MISMATCH_LABELS = {
  hash_algorithm: "Hash algorithm",
  hash_version: "Hash version",
  manifest_version: "Manifest version",
  hash_contract: "Step hash contract",
  step_count: "Seven-step protocol",
  step_order: "Step order",
  step_source: "Step source",
  step_index: "Step index",
  task_id: "Task ID",
  input_hash: "Input hash",
  output_hash: "Output hash",
  hash_content: "Canonical content",
  previous_step_hash: "Previous-step handoff",
  step_hash: "Step hash",
  step_hashes_manifest: "Step manifest",
  merkle_root: "Merkle root",
  report_hash: "Report hash",
  manifest_step_hash: "Manifest step hash",
  report_payload_hash: "Report payload hash",
  manifest_payload_hash: "Manifest payload hash",
  ordered_prior_step_hashes: "Manifest order",
  manifest_input: "Manifest input",
  manifest_output: "Manifest output",
  report_payload_fields: "Report payload fields",
  timestamp: "Step timestamp",
  unsupported_protocol: "Unsupported report protocol",
  missing_steps: "Proof steps",
};

const FILE_ERROR_MESSAGES = {
  INVALID_FILE: "Choose a valid report JSON file.",
  UNSUPPORTED_FILE: "Verification accepts exported report JSON, not PDF files.",
  FILE_TOO_LARGE: "The report JSON must be 10 MB or smaller.",
  FILE_READ_FAILED: "The selected report could not be read.",
  INVALID_JSON: "The selected file is not valid JSON.",
};

const CHAIN_UI_COPY = {
  VERIFIED: {
    title: "On-chain verification passed",
    detail: "Report content, seven-step proof, Sepolia record, and trusted team auditor all match.",
  },
  REPORT_HASH_MISMATCH: {
    title: "Report content changed",
    detail: "The locally recomputed report hash does not match the report declaration.",
  },
  REASONING_PROOF_MISMATCH: {
    title: "Proof chain mismatch",
    detail: "One or more step-chain, manifest, or seven-leaf Merkle checks failed.",
  },
  NOT_ANCHORED: {
    title: "No registry record found",
    detail: "Local integrity passed, but the trusted Sepolia registry has no matching report hash.",
  },
  ONCHAIN_RECORD_MISMATCH: {
    title: "Registry record mismatch",
    detail: "The on-chain Merkle root or risk score differs from this report.",
  },
  UNTRUSTED_AUDITOR: {
    title: "Untrusted attestor",
    detail: "The registry record was not issued by the configured team auditor.",
  },
  INCONSISTENT_RESULT: {
    title: "Inconsistent verification state",
    detail: "The returned checks cannot support a verified result.",
  },
};

const PUBLIC_STEP_LABELS = {
  INPUT_VALIDATED: "Input",
  CHAIN_FETCHED: "Chain data",
  DOC_PARSING: "Document",
  CROSS_CHECKING: "Cross-check",
  RISK_SCORING: "Risk",
  REPORT_ASSEMBLED: "Report",
  PROOF_MANIFEST_COMPILED: "Proof",
};

function formatTimestamp(timestamp) {
  if (!timestamp) return "Not declared";
  const milliseconds = Number(timestamp) < 10_000_000_000
    ? Number(timestamp) * 1000
    : Number(timestamp);
  const date = new Date(milliseconds);
  if (Number.isNaN(date.getTime())) return "Not declared";
  return `${date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "UTC",
  })} UTC`;
}

function formatMode(mode) {
  if (!mode) return "Not declared";
  return String(mode)
    .split(/[_-]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function mismatchLabel(mismatch) {
  if (!mismatch) return "None";
  const label = MISMATCH_LABELS[mismatch.reason] || mismatch.reason.replaceAll("_", " ");
  return mismatch.index === undefined ? label : `Step #${mismatch.index + 1} · ${label}`;
}

const publicStepNumber = (step, fallbackIndex = 0) =>
  Number.isInteger(Number(step?.step_index))
    ? Number(step.step_index) + 1
    : fallbackIndex + 1;

const publicStepLabel = (step, fallbackIndex = 0) =>
  PUBLIC_STEP_LABELS[step?.current_step]
    || String(step?.current_step || `Step ${fallbackIndex + 1}`).replaceAll("_", " ");

function networkLabel(steps) {
  const validatedInput = steps.find((step) => step?.current_step === "INPUT_VALIDATED")?.input;
  const chainId = Number(validatedInput?.chain_id);
  if (chainId === 11155111) return "Sepolia · 11155111";
  if (Number.isSafeInteger(chainId) && chainId > 0) return `Chain ${chainId}`;
  return "Not declared";
}

function ResultState({ checked, valid, validLabel, invalidLabel, unavailableLabel = "" }) {
  if (!checked) return <span className="result-muted"><Minus size={21} /> NOT RUN</span>;
  if (unavailableLabel) return <span className="result-muted"><Info size={21} /> {unavailableLabel}</span>;
  return valid
    ? <span className="result-ok"><CheckCircle size={21} /> {validLabel}</span>
    : <span className="result-error"><XCircle size={21} /> {invalidLabel}</span>;
}

function initialChainState(config) {
  return {
    status: config.canRead ? "idle" : "unconfigured",
    result: null,
    ui: null,
    error: "",
    reportHash: null,
  };
}

function chainLabel(chainCheck) {
  if (chainCheck.status === "checking") return "CHECKING";
  if (chainCheck.status === "unavailable") return "UNAVAILABLE";
  if (chainCheck.status === "unconfigured") return "NOT CONFIGURED";
  if (chainCheck.status === "complete") return chainCheck.ui?.code || "INCONSISTENT";
  return "NOT CHECKED";
}

function ChainResultState({ chainCheck, chainVerified }) {
  const label = chainLabel(chainCheck);
  if (chainCheck.status === "checking") {
    return <span className="result-muted"><ArrowsClockwise size={19} /> {label}</span>;
  }
  if (chainCheck.status !== "complete") {
    return <span className="result-muted"><Minus size={21} /> {label}</span>;
  }
  if (chainCheck.ui?.code === "VERIFIED" && !chainVerified) {
    return <span className="result-error"><XCircle size={21} /> STALE RESULT</span>;
  }
  return chainVerified
    ? <span className="result-ok"><CheckCircle size={21} /> VERIFIED</span>
    : <span className={chainCheck.ui?.tone === "danger" ? "result-error" : "result-muted"}><XCircle size={21} /> {label}</span>;
}

export function VerifyPage({ onNavigate, onInspectHash, report: providedReport, initialReport }) {
  const inputRef = useRef(null);
  const fileRequestRef = useRef(0);
  const chainRequestRef = useRef(0);
  const attestationConfig = useMemo(() => getAttestationConfig(), []);
  const [file, setFile] = useState(null);
  const [parsed, setParsed] = useState(null);
  const [verification, setVerification] = useState(null);
  const [status, setStatus] = useState("empty");
  const [selectedCheck, setSelectedCheck] = useState(2);
  const [lastVerifiedAt, setLastVerifiedAt] = useState(null);
  const [error, setError] = useState("");
  const [chainCheck, setChainCheck] = useState(() => initialChainState(attestationConfig));

  const resetChainCheck = () => {
    chainRequestRef.current += 1;
    setChainCheck(initialChainState(attestationConfig));
  };

  useEffect(() => {
    const incoming = providedReport ?? initialReport;
    if (!incoming) return;
    fileRequestRef.current += 1;
    chainRequestRef.current += 1;
    setParsed(null);
    setVerification(null);
    setLastVerifiedAt(null);
    setChainCheck(initialChainState(attestationConfig));
    setError("");
    try {
      const nextParsed = typeof incoming === "string"
        ? parseAuditReportJson(incoming)
        : incoming.losslessReport && incoming.report
          ? incoming
          : { report: incoming, losslessReport: incoming, preservesNumberTokens: false };
      const result = verifyAuditReport(nextParsed.report);
      setParsed(nextParsed);
      setFile({
        name: `${nextParsed.report?.task_id || "current-audit-report"}.json`,
        size: "Current run",
      });
      setVerification(result);
      setLastVerifiedAt(Date.now());
      setStatus(result.valid ? "verified" : "failed");
      setError(!result.protocolSupported
        ? "Unsupported proof protocol. Export a fresh proof-manifest-v1 report."
        : result.verificationError
          ? "The report uses the supported protocol but its proof structure is malformed."
          : "");
    } catch {
      setParsed(null);
      setFile(null);
      setVerification(null);
      setLastVerifiedAt(null);
      setChainCheck(initialChainState(attestationConfig));
      setError("Current report could not be parsed or verified.");
      setStatus("failed");
    }
  }, [providedReport, initialReport, attestationConfig]);

  const report = parsed?.report || null;
  const proofData = report?.proof_data || {};
  const steps = Array.isArray(proofData.steps) ? proofData.steps : [];
  const network = report?.meta?.network || networkLabel(steps);
  const checked = Boolean(verification);
  const localUnavailableLabel = checked && verification?.verificationError
    ? verification.protocolSupported ? "MALFORMED" : "UNSUPPORTED"
    : "";
  const localChecksAvailable = checked && !localUnavailableLabel;
  const verified = status === "verified" && verification?.isLocallyValid;
  const reportHashValid = localChecksAvailable && verification.isReportHashValid;
  const stepChainValid = localChecksAvailable && verification.isStepChainValid;
  const manifestValid = localChecksAvailable && verification.isManifestValid;
  const merkleValid = localChecksAvailable && verification.isMerkleRootValid;
  const onChainVerified = verified
    && isCurrentVerifiedChainResult(verification, chainCheck);
  const completedChecks = localChecksAvailable
    ? [reportHashValid, stepChainValid, manifestValid, merkleValid].filter(Boolean).length
    : 0;
  const failedChecks = localChecksAvailable ? 4 - completedChecks : 0;
  const localStatusTone = (valid) => !checked
    ? "muted"
    : localUnavailableLabel
      ? "warning"
      : valid ? "verified" : "danger";
  const localStatusLabel = (valid, validLabel, invalidLabel) => !checked
    ? "NOT RUN"
    : localUnavailableLabel || (valid ? validLabel : invalidLabel);
  const transition = steps.length > 1
    ? { previous: steps.at(-2), current: steps.at(-1) }
    : null;
  const handoffMatches = Boolean(
    transition && transition.current.previous_step_hash === transition.previous.step_hash,
  );

  const runVerification = async () => {
    if (!parsed) return;
    const requestId = ++fileRequestRef.current;
    const reportForRequest = parsed.report;
    resetChainCheck();
    setStatus("checking");
    setError("");
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
    if (requestId !== fileRequestRef.current) return;
    try {
      const result = verifyAuditReport(reportForRequest);
      if (requestId !== fileRequestRef.current) return;
      setVerification(result);
      setLastVerifiedAt(Date.now());
      setStatus(result.valid ? "verified" : "failed");
      setError(!result.protocolSupported
        ? "Unsupported proof protocol. Export a fresh proof-manifest-v1 report."
        : result.verificationError
          ? "The report uses the supported protocol but its proof structure is malformed."
          : "");
    } catch {
      if (requestId !== fileRequestRef.current) return;
      setVerification(null);
      setStatus("failed");
      setError("Verification could not safely interpret this report.");
    }
  };

  const handleFile = async (event) => {
    const selected = event.target.files?.[0];
    event.target.value = "";
    if (!selected) return;
    const requestId = ++fileRequestRef.current;
    resetChainCheck();
    setError("");
    setVerification(null);
    setLastVerifiedAt(null);
    setParsed(null);
    setFile({
      name: selected.name,
      size: `${Math.max(1, Math.round(selected.size / 1024))} KB`,
    });
    setStatus("reading");
    try {
      const nextReport = await parseReportJsonFile(selected);
      if (requestId !== fileRequestRef.current) return;
      const nextParsed = {
        report: nextReport,
        losslessReport: nextReport,
        preservesNumberTokens: false,
      };
      setParsed(nextParsed);
      setStatus("ready");
    } catch (parseError) {
      if (requestId !== fileRequestRef.current) return;
      setParsed(null);
      setFile(null);
      setError(parseError instanceof FluxAuditFrontendError
        ? FILE_ERROR_MESSAGES[parseError.code] || parseError.message
        : "The selected report could not be read.");
      setStatus("failed");
    }
  };

  const removeFile = () => {
    fileRequestRef.current += 1;
    resetChainCheck();
    setFile(null);
    setParsed(null);
    setVerification(null);
    setLastVerifiedAt(null);
    setError("");
    setStatus("empty");
  };

  const runChainVerification = async () => {
    if (!parsed || !verified || !attestationConfig.canRead) return;
    const requestId = ++chainRequestRef.current;
    const reportHash = verification.computedReportHash;
    setChainCheck({ status: "checking", result: null, ui: null, error: "", reportHash });
    try {
      const next = await verifyReportOnSepolia(parsed.report, attestationConfig);
      if (requestId !== chainRequestRef.current) return;
      setChainCheck({ status: "complete", result: next.result, ui: next.ui, error: "", reportHash });
    } catch (chainError) {
      if (requestId !== chainRequestRef.current) return;
      setChainCheck({
        status: "unavailable",
        result: null,
        ui: null,
        error: describeAttestationError(chainError),
        reportHash,
      });
    }
  };

  const chainCopy = chainCheck.ui?.code
    ? CHAIN_UI_COPY[chainCheck.ui.code] || CHAIN_UI_COPY.INCONSISTENT_RESULT
    : null;
  const chainDisplayLabel = chainCheck.ui?.code === "VERIFIED" && !onChainVerified
    ? "STALE RESULT"
    : chainLabel(chainCheck);
  const chainBadgeTone = chainCheck.ui?.tone === "success"
    ? onChainVerified ? "verified" : "danger"
    : chainCheck.ui?.tone === "danger"
      ? "danger"
      : chainCheck.ui?.tone === "warning"
        ? "warning"
        : "muted";
  const chainMeta = chainCheck.status === "unconfigured"
    ? "Sepolia registry not configured"
    : chainCheck.status === "checking"
      ? "Checking trusted Sepolia registry"
      : chainCheck.status === "complete"
        ? chainCheck.ui?.code === "VERIFIED" && !onChainVerified
          ? "Chain result belongs to a previous report"
          : chainCopy?.title
        : chainCheck.status === "unavailable"
          ? "Sepolia check unavailable"
          : "Sepolia anchor not checked";
  const chainComplete = chainCheck.status === "complete";
  const badgeTone = chainComplete
    ? chainBadgeTone
    : localUnavailableLabel
      ? "warning"
    : verified
      ? "verified"
      : status === "failed"
        ? "danger"
        : status === "empty"
          ? "muted"
          : "active";
  const badgeLabel = chainComplete
    ? onChainVerified
      ? "VERIFIED ON SEPOLIA"
      : chainCheck.ui?.code === "VERIFIED"
        ? "STALE CHAIN RESULT"
        : chainCheck.ui?.code?.replaceAll("_", " ") || "CHAIN CHECK FAILED"
    : localUnavailableLabel
      ? `${localUnavailableLabel} REPORT`
    : verified
      ? "VERIFIED LOCALLY"
      : status === "checking"
        ? "VERIFYING"
        : status === "reading"
          ? "READING REPORT"
          : status === "failed"
            ? "VERIFICATION FAILED"
            : status === "ready"
              ? "READY"
              : "NO REPORT";

  return (
    <AppShell active="verify" onNavigate={onNavigate} className="verify-shell">
      <div className="page verify-page">
        <header className="verify-header">
          <div>
            <Breadcrumbs items={["Verify", report?.task_id || "Local report"]} />
            <div className="title-with-status"><h1>Verify report</h1><StatusBadge tone={badgeTone}>{badgeLabel}</StatusBadge></div>
            <div className="run-meta"><span>{file?.name || "No report selected"}</span><i>•</i><span>{formatMode(report?.meta?.data_mode || report?.meta?.mode)}</span><i>•</i><span>{chainMeta}</span></div>
          </div>
          <div className="verify-header-actions">
            <div><Button icon={ArrowsClockwise} variant="primary" onClick={runVerification} disabled={!parsed || status === "checking"}>{status === "checking" ? "Verifying…" : checked ? "Run verification again" : "Run local verification"}</Button></div>
            <p>Verifies report integrity, not protocol safety.</p>
          </div>
        </header>

        <input ref={inputRef} type="file" accept="application/json,.json" hidden onChange={handleFile} />

        <div className="verify-grid">
          <div className="verify-left">
            <Panel className="verify-dossier-panel">
              <section className="report-file-panel">
                <PanelHeader title="Report dossier" />
                {file ? <div className="evidence-cartridge report-file-cartridge"><FileJs size={46} weight="duotone" /><div><small>JSON REPORT</small><strong>{file.name}</strong><span>{file.size}</span></div><span className="report-file-state"><Info size={14} aria-hidden="true" />{status === "reading" ? "READING" : parsed ? "PARSED" : "SELECTED"}</span></div> : <button className="verify-dropzone" onClick={() => inputRef.current?.click()}><UploadSimple size={28} weight="duotone" /><span>Choose a JSON report</span></button>}
                <div className="file-actions"><Button variant="primary" onClick={() => inputRef.current?.click()}>{file ? "Replace file" : "Choose file"}</Button><Button variant="quiet" onClick={removeFile} disabled={!file}>Remove</Button></div>
                {error && <p className="file-error-message" role="alert"><XCircle size={18} /> {error}</p>}
              </section>

              <section className="metadata-panel dossier-section">
                <PanelHeader title="Report metadata" />
                <DataRow label="Audit task" icon={Cube}>{report?.task_id || "Not loaded"}</DataRow>
                <DataRow label="Network" icon={Globe}><span className="inline-led"><StatusLed tone={network.startsWith("Sepolia") ? "active" : "muted"} /> {network}</span></DataRow>
                <DataRow label="Data mode" icon={CirclesThreePlus}>{formatMode(report?.meta?.data_mode || report?.meta?.mode)}</DataRow>
                <DataRow label="Generated" icon={CalendarBlank}>{formatTimestamp(report?.meta?.timestamp || report?.meta?.generated)}</DataRow>
                <DataRow label="Last verification run" icon={CalendarBlank}>{formatTimestamp(lastVerifiedAt)}</DataRow>
                <DataRow label="Proof steps" icon={ListBullets}>{steps.length || "—"}</DataRow>
              </section>

              <section className="scope-panel dossier-section">
                <PanelHeader title="Verification scope" />
                {["Report content hash", "Required seven-step hash chain", "Required proof-manifest-v1", "Merkle root from all seven leaves", "On-chain anchor remains separate"].map((item) => <div className="scope-row" key={item}><Circle size={17} /> {item}</div>)}
                <div className="scope-note"><Info size={20} /> Local checks use {HASH_ALGORITHM}; no wallet required.</div>
              </section>
            </Panel>
          </div>

          <div className="verify-right">
            <Panel className="verification-results-panel" aria-live="polite" aria-busy={status === "checking" || chainCheck.status === "checking"}>
              <PanelHeader title="Verification results" meta={localUnavailableLabel ? `Local checks unavailable · ${localUnavailableLabel.toLowerCase()} report` : checked ? `${completedChecks} local passed · ${failedChecks} failed · chain ${chainDisplayLabel.toLowerCase()}` : "4 local not run · chain not checked"} />
              <button aria-pressed={selectedCheck === 1} className={`verification-row ${selectedCheck === 1 ? "is-selected" : ""} ${localUnavailableLabel ? "is-unchecked" : checked ? reportHashValid ? "is-pass" : "is-fail" : "is-idle"}`} onClick={() => setSelectedCheck(1)}><span>1</span><strong>Report content hash</strong><ResultState checked={checked} unavailableLabel={localUnavailableLabel} valid={reportHashValid} validLabel="MATCH" invalidLabel="MISMATCH" /><code>{localChecksAvailable ? shortHash(verification.computedReportHash) : "—"}</code><small>Recomputed locally</small></button>
              <button aria-pressed={selectedCheck === 2} className={`verification-row ${selectedCheck === 2 ? "is-selected" : ""} ${localUnavailableLabel ? "is-unchecked" : checked ? stepChainValid ? "is-pass" : "is-fail" : "is-idle"}`} onClick={() => setSelectedCheck(2)}><span>2</span><strong>Seven-step hash chain</strong><ResultState checked={checked} unavailableLabel={localUnavailableLabel} valid={stepChainValid} validLabel={`${verification?.stepsPassed || 0} / 7 VERIFIED`} invalidLabel="CHAIN MISMATCH" /><StatusBadge tone={selectedCheck === 2 ? "active" : "muted"}>{selectedCheck === 2 ? "SELECTED" : "DETAILS"}</StatusBadge><small>Fixed order and sources</small></button>
              <button aria-pressed={selectedCheck === 3} className={`verification-row ${selectedCheck === 3 ? "is-selected" : ""} ${localUnavailableLabel ? "is-unchecked" : checked ? manifestValid ? "is-pass" : "is-fail" : "is-idle"}`} onClick={() => setSelectedCheck(3)}><span>3</span><strong>Proof manifest</strong><ResultState checked={checked} unavailableLabel={localUnavailableLabel} valid={manifestValid} validLabel="MATCH" invalidLabel="MISMATCH" /><code>{proofData.manifest_version || "—"}</code><small>Required protocol</small></button>
              <button aria-pressed={selectedCheck === 4} className={`verification-row ${selectedCheck === 4 ? "is-selected" : ""} ${localUnavailableLabel ? "is-unchecked" : checked ? merkleValid ? "is-pass" : "is-fail" : "is-idle"}`} onClick={() => setSelectedCheck(4)}><span>4</span><strong>Seven-leaf Merkle root</strong><ResultState checked={checked} unavailableLabel={localUnavailableLabel} valid={merkleValid} validLabel="MATCH" invalidLabel="MISMATCH" /><code>{localChecksAvailable ? shortHash(verification.computedMerkleRoot) : "—"}</code><small>All step hashes</small></button>
              <button aria-pressed={selectedCheck === 5} className={`verification-row ${selectedCheck === 5 ? "is-selected" : ""} ${onChainVerified ? "is-pass" : chainCheck.ui?.tone === "danger" || chainDisplayLabel === "STALE RESULT" ? "is-fail" : "is-unchecked"}`} onClick={() => setSelectedCheck(5)}><span>5</span><strong>Sepolia registry</strong><ChainResultState chainCheck={chainCheck} chainVerified={onChainVerified} /><StatusBadge tone={chainBadgeTone}>{chainDisplayLabel}</StatusBadge><small>Read-only · no wallet</small></button>
            </Panel>

            {selectedCheck === 1 && <Panel className="verification-detail-panel report-hash-detail-panel">
              <div className="verification-detail-heading"><span className="detail-icon"><BracketsCurly size={24} weight="duotone" /></span><div><h2>Report content hash</h2><p>Canonical report content is recomputed locally with <code>Ethereum keccak256</code>.</p></div><StatusBadge tone={localStatusTone(reportHashValid)}>{localStatusLabel(reportHashValid, "MATCH", "MISMATCH")}</StatusBadge></div>
              <div className="hash-comparison-ledger"><div><span>Computed locally</span>{verification?.computedReportHash ? <HashValue label="Computed report hash" value={verification.computedReportHash} onInspect={onInspectHash} /> : <code>Not computed</code>}</div><b>=</b><div><span>Declared by report</span>{proofData.report_hash ? <HashValue label="Declared report hash" value={proofData.report_hash} onInspect={onInspectHash} /> : <code>Not declared</code>}</div></div>
              <p className="detail-boundary"><Info size={17} /> The self-referential report_hash field is excluded before recomputation; all other report content remains covered.</p>
            </Panel>}

            {selectedCheck === 2 && <Panel className="chain-merkle-panel verification-detail-panel">
              <h2>Seven-step hash chain</h2>
              <p className="chain-helper">Every step is independently recomputed · fixed order · fixed source · <code>Ethereum keccak256</code></p>
              <div className="proof-stats"><div><span>Chain relation</span><code>step_hash[n] → prev_hash[n+1]</code></div><div><span>Steps verified</span><strong>{localChecksAvailable ? `${verification.stepsPassed} / 7` : checked ? "Not evaluated" : `0 / ${steps.length || 7}`}</strong></div><div><span>First mismatch</span><strong className={localChecksAvailable && stepChainValid ? "positive-text" : ""}>{localUnavailableLabel || (localChecksAvailable ? mismatchLabel(verification.failures.find(({ scope }) => ["contract", "step", "chain", "protocol"].includes(scope))) : "Not run")}</strong></div></div>
              {transition ? <div className="verify-handoff">
                <div><h3>#{publicStepNumber(transition.previous, steps.length - 2)} → #{publicStepNumber(transition.current, steps.length - 1)} Handoff</h3><span>step_hash #{publicStepNumber(transition.previous, steps.length - 2)}</span><HashValue label={`Step hash #${publicStepNumber(transition.previous, steps.length - 2)}`} value={transition.previous.step_hash} onInspect={onInspectHash} /></div>
                <div><span>prev_hash #{publicStepNumber(transition.current, steps.length - 1)}</span><HashValue label={`Previous hash #${publicStepNumber(transition.current, steps.length - 1)}`} value={transition.current.previous_step_hash} onInspect={onInspectHash} /></div>
                <strong className={!localChecksAvailable ? "result-muted" : handoffMatches ? "result-ok" : "result-error"}>{localUnavailableLabel || (localChecksAvailable ? handoffMatches ? "EXACT MATCH" : "MISMATCH" : "NOT RUN")}</strong>
              </div> : <div className="verify-handoff"><div><h3>Hash handoff</h3><span>Load a report with at least two steps.</span></div></div>}
              <div className="canonical-stages">
                <h3>{steps.length || "No"} received proof steps</h3>
                <div className={`stage-stepper ${stepChainValid ? "tone-verified" : "tone-received"}`}>
                  {steps.map((step, index) => <div className={`stepper-item ${!localChecksAvailable ? "is-received" : verification?.stepResults?.[index]?.valid ? "is-verified" : "is-failed"}`} key={`${step.step_hash}-${index}`} title={step.current_step || undefined}><span>{publicStepNumber(step, index)}</span><strong>{publicStepLabel(step, index)}</strong>{index < steps.length - 1 && <i>→</i>}</div>)}
                </div>
              </div>
            </Panel>}

            {selectedCheck === 3 && <Panel className="verification-detail-panel report-hash-detail-panel">
              <div className="verification-detail-heading"><span className="detail-icon"><ListBullets size={24} weight="duotone" /></span><div><h2>Proof manifest</h2><p>The seventh step commits the exact prior order and the business-report payload.</p></div><StatusBadge tone={localStatusTone(manifestValid)}>{localStatusLabel(manifestValid, "MATCH", "MISMATCH")}</StatusBadge></div>
              <div className="proof-stats"><div><span>Protocol</span><code>{proofData.manifest_version || "Not declared"}</code></div><div><span>Ordered prior leaves</span><strong>{Array.isArray(steps[6]?.input?.ordered_prior_step_hashes) ? steps[6].input.ordered_prior_step_hashes.length : "—"} / 6</strong></div><div><span>Compatibility views</span><strong>{Array.isArray(proofData.reasoning_step_hashes) ? proofData.reasoning_step_hashes.length : 0} AI · {Array.isArray(proofData.backend_step_hashes) ? proofData.backend_step_hashes.length : 0} backend</strong></div></div>
              <div className="hash-comparison-ledger"><div><span>Manifest step declaration</span>{proofData.manifest_step_hash ? <HashValue label="Manifest step hash" value={proofData.manifest_step_hash} onInspect={onInspectHash} /> : <code>Not declared</code>}</div><b>=</b><div><span>Seventh step hash</span>{steps[6]?.step_hash ? <HashValue label="Seventh step hash" value={steps[6].step_hash} onInspect={onInspectHash} /> : <code>Not present</code>}</div></div>
              <p className="detail-boundary"><Info size={17} /> A missing manifest is an unsupported report structure, never an optional check.</p>
            </Panel>}

            {selectedCheck === 4 && <Panel className="chain-merkle-panel verification-detail-panel">
              <h2>Seven-leaf Merkle root</h2>
              <p className="chain-helper">Leaves are all ordered <code>proof_data.step_hashes</code>, including backend and AI stages.</p>
              <div className="merkle-comparison"><div><span>Computed locally</span>{verification?.computedMerkleRoot ? <HashValue label="Computed Merkle root" value={verification.computedMerkleRoot} onInspect={onInspectHash} /> : <code>Not computed</code>}</div><b>=</b><div><span>Declared by report</span>{proofData.merkle_root ? <HashValue label="Declared Merkle root" value={proofData.merkle_root} onInspect={onInspectHash} /> : <code>Not declared</code>}</div><strong className={!localChecksAvailable ? "result-muted" : merkleValid ? "result-ok" : "result-error"}>{localStatusLabel(merkleValid, "MATCH", "MISMATCH")}</strong></div>
              {verification?.computedMerkleRoot && <button className="full-values-control" onClick={() => onInspectHash?.({ label: "Computed Merkle root", value: verification.computedMerkleRoot })}><BracketsCurly size={20} /> View / copy full Merkle root</button>}
              <div className="canonical-stages"><h3>{steps.length || "No"} ordered leaves</h3><div className={`stage-stepper ${merkleValid ? "tone-verified" : "tone-received"}`}>{steps.map((step, index) => <div className={`stepper-item ${!localChecksAvailable ? "is-received" : verification?.stepResults?.[index]?.valid ? "is-verified" : "is-failed"}`} key={`${step.step_hash}-${index}`}><span>{index + 1}</span><strong>{publicStepLabel(step, index)}</strong>{index < steps.length - 1 && <i>→</i>}</div>)}</div></div>
            </Panel>}

            {selectedCheck === 5 && <Panel className="verification-detail-panel anchor-detail-panel">
              <span className="anchor-detail-emblem"><Anchor size={34} weight="duotone" /></span>
              <div>
                <div className="title-with-status"><h2>Sepolia registry</h2><StatusBadge tone={chainBadgeTone}>{chainDisplayLabel}</StatusBadge></div>
                <p>{chainCheck.status === "unconfigured" ? "Waiting for a trusted registry address, team auditor, and restricted Sepolia RPC URL." : chainCheck.status === "idle" ? "Local verification does not automatically query the registry. Run the read-only check when you are ready." : chainCheck.status === "checking" ? "Reading the trusted Sepolia registry. No wallet permission is requested." : chainCheck.status === "unavailable" ? `${chainCheck.error} Local integrity status is unchanged.` : chainCopy?.detail}</p>
                <div className="trust-boundary-ledger">
                  <span>Local report integrity<strong>{verified ? "Verified" : "Not established"}</strong></span>
                  <span>Registry record<strong>{chainCheck.status === "complete" ? chainCheck.result?.isAnchored ? "Found" : "Not found" : "Not queried"}</strong></span>
                  <span>Trusted team auditor<strong>{chainCheck.status === "complete" ? chainCheck.result?.isAuditorTrusted ? "Match" : "Not established" : attestationConfig.trustedAuditor ? shortHash(attestationConfig.trustedAuditor, 10, 6) : "Not configured"}</strong></span>
                  <span>On-chain timestamp<strong>{chainCheck.result?.onChainTimestamp ? formatTimestamp(chainCheck.result.onChainTimestamp) : "Unavailable"}</strong></span>
                  <span>Wallet required<strong>No · read-only</strong></span>
                </div>
                <div className="anchor-detail-actions"><Button variant="primary" onClick={runChainVerification} disabled={!verified || !attestationConfig.canRead || chainCheck.status === "checking"}>{chainCheck.status === "checking" ? "Checking Sepolia…" : "Verify on Sepolia"}</Button>{attestationConfig.contractExplorerUrl && <a href={attestationConfig.contractExplorerUrl} target="_blank" rel="noreferrer">View trusted registry ↗</a>}</div>
                {!attestationConfig.canRead && <small className="chain-config-note">Chain verification stays disabled until member 5 supplies a confirmed deployment record. Local verification remains complete.</small>}
              </div>
            </Panel>}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Anchor,
  ArrowLeft,
  CaretDown,
  CaretRight,
  CheckCircle,
  DownloadSimple,
  Info,
  ShieldCheck,
  ShieldWarning,
  UsersThree,
} from "@phosphor-icons/react";
import {
  AppShell,
  Breadcrumbs,
  Button,
  HashValue,
  Panel,
  StatusBadge,
} from "../components/ui.jsx";
import { shortHash, verifyAuditReport } from "../lib/proof.js";
import { presentRiskAssessment } from "../lib/riskPresentation.js";
import {
  anchorReportWithBrowserWallet,
  classifyAttestationError,
  describeAttestationError,
  getAttestationConfig,
  isCurrentAnchorResult,
  subscribeToWalletContext,
} from "../lib/attestationClient.js";

const EXPECTED_STAGE_COUNT = 7;
const EXPECTED_STAGE_KEYS = new Set([
  "INPUT_VALIDATED",
  "CHAIN_FETCHED",
  "DOC_PARSING",
  "CROSS_CHECKING",
  "RISK_SCORING",
  "REPORT_ASSEMBLED",
  "PROOF_MANIFEST_COMPILED",
]);
const RESULT_BOUND_ANCHOR_STATUSES = new Set([
  "confirmed",
  "already-anchored",
  "mined-unverified",
]);
const NON_RETRYABLE_ANCHOR_STATUSES = new Set([
  ...RESULT_BOUND_ANCHOR_STATUSES,
  "submission-unknown",
]);
const PERSISTED_GUARD_STATUSES = new Set(["mined-unverified", "submission-unknown"]);
const ATTESTATION_GUARD_KEY = "fluxaudit.attestation-guard.v1";

function readAttestationGuard(identity) {
  try {
    const saved = JSON.parse(globalThis.window?.sessionStorage?.getItem(ATTESTATION_GUARD_KEY));
    return saved?.identity === identity && PERSISTED_GUARD_STATUSES.has(saved?.state?.status)
      ? saved.state
      : null;
  } catch {
    return null;
  }
}

function persistAttestationGuard(identity, state) {
  if (!PERSISTED_GUARD_STATUSES.has(state?.status)) return;
  try {
    globalThis.window?.sessionStorage?.setItem(
      ATTESTATION_GUARD_KEY,
      JSON.stringify({ identity, state }),
    );
  } catch {
    // Session storage is a convenience guard; the in-memory lock remains authoritative.
  }
}

function clearAttestationGuard(identity) {
  try {
    const saved = JSON.parse(globalThis.window?.sessionStorage?.getItem(ATTESTATION_GUARD_KEY));
    if (saved?.identity === identity) {
      globalThis.window?.sessionStorage?.removeItem(ATTESTATION_GUARD_KEY);
    }
  } catch {
    // Ignore unavailable or malformed session storage.
  }
}

function displayTitle(key) {
  return String(key || "Proof step").toLowerCase().replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

function formatTimestamp(timestamp) {
  if (!timestamp) return "Generated time unavailable";
  return new Date(Number(timestamp) * 1000).toLocaleString([], { dateStyle: "medium", timeStyle: "medium", timeZone: "UTC" }) + " UTC";
}

function riskTone(level) {
  if (level === "HIGH" || level === "CRITICAL") return "danger";
  if (level === "MEDIUM") return "warning";
  if (level === "LOW") return "verified";
  return "warning";
}

function evidenceSummary(value) {
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? "" : "s"}`;
  if (value && typeof value === "object") return `${Object.keys(value).length} field${Object.keys(value).length === 1 ? "" : "s"}`;
  if (typeof value === "string" && value.trim()) return value;
  return "Recorded in report";
}

function dataModeLabel(mode) {
  return ({ mock: "Deterministic Mock", hybrid: "Hybrid provenance", fallback: "Fallback data", real: "Real sources" })[mode] || mode || "Unknown mode";
}

export function ReportPage({ onNavigate, onInspectHash, taskId, context, report, reportState, error, onRetryLoad }) {
  const [tab, setTab] = useState("overview");
  const [expandedStep, setExpandedStep] = useState(EXPECTED_STAGE_COUNT - 1);
  const anchorRequestRef = useRef(0);
  const anchorBusyRef = useRef(false);
  const walletContextDirtyRef = useRef(false);
  const [anchorBusy, setAnchorBusy] = useState(false);
  const attestationConfig = useMemo(() => getAttestationConfig(), []);
  const localVerification = useMemo(() => {
    if (!report) return null;
    try {
      return verifyAuditReport(report);
    } catch {
      return null;
    }
  }, [report]);
  const attestationIdentity = [
    attestationConfig.chainId,
    attestationConfig.contractAddress || "unconfigured",
    report?.proof_data?.report_hash || "missing-report-hash",
    localVerification?.computedReportHash || "uncomputable-report-hash",
    localVerification?.isLocallyValid ? "locally-valid" : "locally-invalid",
  ].join(":");
  const [anchorState, setAnchorState] = useState(() => readAttestationGuard(attestationIdentity) || ({
    status: attestationConfig.canWrite ? "idle" : "unconfigured",
    result: null,
    error: "",
  }));

  useEffect(() => {
    anchorRequestRef.current += 1;
    setAnchorState(readAttestationGuard(attestationIdentity) || {
      status: attestationConfig.canWrite ? "idle" : "unconfigured",
      result: null,
      error: "",
    });
  }, [attestationIdentity, attestationConfig.canWrite]);

  useEffect(() => subscribeToWalletContext(globalThis.window?.ethereum, () => {
    if (anchorBusyRef.current) {
      walletContextDirtyRef.current = true;
      return;
    }
    anchorRequestRef.current += 1;
    setAnchorState((current) => NON_RETRYABLE_ANCHOR_STATUSES.has(current.status)
      ? current
      : {
        status: attestationConfig.canWrite ? "idle" : "unconfigured",
        result: null,
        error: "Wallet account or network changed. Recheck before attesting.",
      });
  }), [attestationConfig]);

  if (!report) {
    return (
      <AppShell active="audits" onNavigate={onNavigate} className="report-shell">
        <div className="page report-page">
          <div className="report-layout">
            <div className="report-main">
              <header className="report-header"><Breadcrumbs items={["Audits", context?.project || "Audit", taskId || "Unknown task", "Report"]} /><div className="title-with-status"><h1>Audit report</h1><StatusBadge tone={reportState === "error" ? "danger" : "active"}>{reportState === "processing" ? "PROCESSING" : reportState === "error" ? "LOAD FAILED" : "LOADING"}</StatusBadge></div></header>
              <article className="report-slab"><section className="report-tab-content"><h2>{reportState === "processing" ? "The audit is still processing" : reportState === "error" ? "The report could not be loaded" : "Fetching final report"}</h2><p>{error || "FluxAudit is waiting for the backend report payload."}</p><div className="report-header-actions" style={{ position: "static", alignItems: "flex-start", marginTop: 20 }}><div><Button onClick={() => onNavigate(`/audit/${encodeURIComponent(taskId)}`)}>Back to execution</Button><Button variant="primary" onClick={onRetryLoad}>Retry report fetch</Button></div></div></section></article>
            </div>
          </div>
        </div>
      </AppShell>
    );
  }

  const proof = report.proof_data || {};
  const steps = Array.isArray(proof.steps) ? proof.steps : [];
  const receivedStageCount = new Set(
    steps.filter((step) => EXPECTED_STAGE_KEYS.has(step.current_step)).map((step) => step.current_step),
  ).size;
  const findings = Array.isArray(report.findings) ? report.findings : [];
  const aiSteps = steps.filter((step) => step.source === "AI");
  const backendSteps = steps.filter((step) => step.source === "BACKEND");
  const summary = report.summary || {};
  const meta = report.meta || {};
  const riskLevel = summary.risk_level || "UNKNOWN";
  const riskScore = summary.overall_risk_score;
  const project = context?.project || "FluxAudit target";
  const contractAddress = context?.contractAddress;
  const locallyVerified = localVerification?.isLocallyValid === true;
  const verificationUnsupported = localVerification?.protocolSupported === false;
  const proofReceived = receivedStageCount === EXPECTED_STAGE_COUNT && steps.length === EXPECTED_STAGE_COUNT;
  const failed = reportState === "failed" || meta.status === "FAILED";
  const reportReady = reportState === "ready" && !failed;
  const riskPresentation = presentRiskAssessment({
    failed,
    ready: reportReady,
    locallyVerified,
    riskLevel,
    riskScore,
  });
  const displayedRiskTone = riskPresentation.trusted
    ? riskTone(riskPresentation.level)
    : riskPresentation.state === "failed" ? "danger" : "warning";
  const reportHeaderTone = failed || (reportReady && !locallyVerified)
    ? "danger"
    : reportReady && locallyVerified
      ? "verified"
      : "warning";
  const reportHeaderLabel = failed
    ? "FAILED"
    : !reportReady
      ? String(reportState || meta.status || "STATUS UNKNOWN").replaceAll("_", " ").toUpperCase()
      : locallyVerified
        ? "COMPLETED"
        : verificationUnsupported ? "UNSUPPORTED PROOF" : "PROOF FAILED";
  const anchorResultMatchesReport = isCurrentAnchorResult(
    localVerification,
    proof.report_hash,
    anchorState.result,
  );
  const anchorStatus = RESULT_BOUND_ANCHOR_STATUSES.has(anchorState.status) && !anchorResultMatchesReport
    ? attestationConfig.canWrite ? "idle" : "unconfigured"
    : anchorState.status;
  const anchorLabel = anchorStatus === "confirmed"
    ? "CONFIRMED"
    : anchorStatus === "already-anchored"
      ? "ALREADY ANCHORED"
      : anchorStatus === "mined-unverified"
        ? "MINED / UNVERIFIED"
        : anchorStatus === "submission-unknown"
          ? "SUBMISSION UNKNOWN"
        : anchorStatus === "pending"
      ? "AWAITING WALLET"
      : anchorStatus === "unconfigured"
        ? "NOT CONFIGURED"
        : anchorStatus === "cancelled"
          ? "WALLET CANCELLED"
          : anchorStatus === "action-required"
            ? "ACTION REQUIRED"
            : anchorStatus === "failed"
              ? "PRECHECK / SUBMIT FAILED"
          : "NOT CHECKED";
  const anchorTone = anchorStatus === "confirmed" || anchorStatus === "already-anchored"
    ? "verified"
    : anchorStatus === "failed"
      ? "danger"
      : anchorStatus === "pending"
        ? "active"
        : ["mined-unverified", "submission-unknown", "action-required"].includes(anchorStatus)
          ? "warning"
        : "muted";

  const downloadReport = () => {
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${report.task_id || "fluxaudit"}-report.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const anchorReport = async () => {
    if (!locallyVerified || !attestationConfig.canWrite || anchorBusyRef.current) return;
    const requestId = ++anchorRequestRef.current;
    anchorBusyRef.current = true;
    walletContextDirtyRef.current = false;
    setAnchorBusy(true);
    setAnchorState({ status: "pending", result: null, error: "" });
    try {
      const result = await anchorReportWithBrowserWallet(report, globalThis.window?.ethereum, attestationConfig);
      if (requestId !== anchorRequestRef.current) return;
      setAnchorState({
        status: result.alreadyAnchored ? "already-anchored" : "confirmed",
        result,
        error: "",
      });
      clearAttestationGuard(attestationIdentity);
    } catch (anchorError) {
      if (requestId !== anchorRequestRef.current) return;
      const failureStatus = classifyAttestationError(anchorError);
      const nextState = {
        status: failureStatus,
        result: anchorError?.minedResult || null,
        error: describeAttestationError(anchorError),
      };
      persistAttestationGuard(attestationIdentity, nextState);
      setAnchorState(nextState);
    } finally {
      const walletContextChanged = walletContextDirtyRef.current;
      walletContextDirtyRef.current = false;
      anchorBusyRef.current = false;
      setAnchorBusy(false);
      if (walletContextChanged && requestId === anchorRequestRef.current) {
        setAnchorState((current) => NON_RETRYABLE_ANCHOR_STATUSES.has(current.status)
          ? current
          : {
            status: attestationConfig.canWrite ? "idle" : "unconfigured",
            result: null,
            error: "Wallet account or network changed. Recheck before attesting.",
          });
      }
    }
  };

  return (
    <AppShell active="audits" onNavigate={onNavigate} className="report-shell">
      <div className="page report-page">
        <div className="report-layout">
          <div className="report-main">
            <header className="report-header">
              <Breadcrumbs items={["Audits", project, report.task_id || taskId, "Report"]} />
              <div className="report-title-line">
                <div>
                  <div className="title-with-status"><h1>{project} audit report</h1><StatusBadge tone={reportHeaderTone}>{reportHeaderLabel}</StatusBadge></div>
                  <div className="run-meta"><span>Audit target · {shortHash(contractAddress, 8, 4) || "Address unavailable"}</span><i>•</i><span>{report.task_id || taskId}</span><i>•</i><span>Sepolia</span><i>•</i><StatusBadge>{dataModeLabel(meta.data_mode)}</StatusBadge></div>
                </div>
                <div className="report-header-actions"><div><Button icon={DownloadSimple} onClick={downloadReport}>Download JSON</Button><Button variant="primary" onClick={() => onNavigate("/verify")}>Verify report</Button></div><time>{formatTimestamp(meta.timestamp)}</time></div>
              </div>
              <div className="segment-tabs report-tabs" aria-label="Report section">{["overview", "findings", "evidence", "proof"].map((name) => <button key={name} aria-pressed={tab === name} className={tab === name ? "is-selected" : ""} onClick={() => setTab(name)}>{name[0].toUpperCase() + name.slice(1)}</button>)}</div>
            </header>

            <article className="report-slab">
              {tab === "overview" && <>
                <div className={`report-verdict-hero tone-${displayedRiskTone}`}>
                  <div className="report-risk-seal">
                    <ShieldWarning size={30} weight="duotone" />
                    <span>{riskPresentation.eyebrow}</span>
                    <strong>{riskPresentation.level}</strong>
                    <b>{riskPresentation.score ?? "—"}{riskPresentation.score !== null && <small>/100</small>}</b>
                  </div>
                  <div className="report-verdict-copy">
                    <h2>{riskPresentation.state === "failed" ? `${project} assessment unavailable` : `${project} risk assessment`}</h2>
                    <p>{riskPresentation.trusted ? summary.verdict || "No verdict was returned." : riskPresentation.detail}</p>
                    <p>The proof below establishes report integrity and lineage; it does not establish protocol safety.</p>
                  </div>
                </div>

                <div className="report-assurance-row">
                  <div><span className={`verdict-icon ${locallyVerified ? "verified" : "danger"}`}><ShieldCheck size={24} weight="duotone" /></span><p>Proof integrity<strong>{locallyVerified ? "LOCALLY VERIFIED" : verificationUnsupported ? "UNSUPPORTED REPORT" : "INTEGRITY FAILED"}</strong></p></div>
                  <div><span className="verdict-icon active"><UsersThree size={24} weight="duotone" /></span><p>Agent outputs<strong>{aiSteps.length} STAGES RECEIVED</strong></p></div>
                  <div><span className={`verdict-icon ${anchorTone}`}><Anchor size={24} weight="duotone" /></span><p>Anchor status<strong>{anchorLabel}</strong></p></div>
                </div>

                <section className="report-section"><h2>Top findings</h2><div className="light-table findings-table"><div className="light-table-head"><span>Severity</span><span>Finding</span><span>Category</span><span>Evidence</span><span>Action</span></div>{findings.slice(0, 3).map((finding, index) => <div className="light-table-row" key={`${finding.category || finding.title}-${index}`}><span data-label="Severity"><StatusBadge tone={locallyVerified ? riskTone(finding.severity) : "warning"}>{finding.severity || "INFO"}{locallyVerified ? "" : " · UNVERIFIED"}</StatusBadge></span><strong data-label="Finding">{finding.title || "Untitled finding"}</strong><span data-label="Category">{finding.category || "General"}</span><span data-label="Evidence">{evidenceSummary(finding.evidence)}</span><button data-label="Action" onClick={() => setTab("findings")}>Inspect <CaretRight size={15} /></button></div>)}{findings.length === 0 && <div className="light-table-row"><span data-label="Severity"><StatusBadge tone="muted">NONE RETURNED</StatusBadge></span><strong data-label="Finding">{locallyVerified ? "No findings were returned by this report" : "Findings state is not trusted until proof verification passes"}</strong><span data-label="Category">—</span><span data-label="Evidence">—</span><span data-label="Action">—</span></div>}</div></section>

                <section className="report-section assessment-section"><h2>Agent pipeline</h2><div className="light-table assessment-table"><div className="light-table-head"><span>Agent</span><span>Stage</span><span>Evidence</span><span>Public output</span></div>{aiSteps.map((step) => <div className="light-table-row" key={step.step_hash}><span data-label="Agent">{step.agent}</span><span data-label="Stage"><StatusBadge tone="active">#{String(step.step_index + 1).padStart(2, "0")}</StatusBadge></span><span data-label="Evidence">{Array.isArray(step.evidence) ? step.evidence.length : 0}</span><span data-label="Public output">{step.message}</span></div>)}</div></section>

                <section className="report-bottom-grid"><div><h2>Evidence coverage</h2><div className="coverage-row"><span>Backend stages</span><strong>{backendSteps.length}</strong></div><div className="coverage-row"><span>AI stages</span><strong>{aiSteps.length}</strong></div><div className="coverage-row"><span>Findings</span><strong>{findings.length}</strong></div></div><div><h2>Limitations & disclaimer</h2><p>{report.disclaimer || "The proof verifies report integrity and data lineage, not the factual truth of findings or protocol safety."}</p></div></section>

                <button className="back-link" onClick={() => onNavigate(`/audit/${encodeURIComponent(report.task_id || taskId)}`)}><ArrowLeft size={17} /> Back to execution</button>
              </>}

              {tab === "findings" && <ReportTab title={`All findings · ${findings.length}`}><p>{locallyVerified ? "Findings are rendered directly from the member 3/member 4 report contract." : "These findings are untrusted until the complete proof passes local verification."}</p>{findings.map((finding, index) => <div className="report-list-item" key={`${finding.category || finding.title}-${index}`}><StatusBadge tone={locallyVerified ? riskTone(finding.severity) : "warning"}>{finding.severity || "INFO"}{locallyVerified ? "" : " · UNVERIFIED"}</StatusBadge><div><strong>{finding.title || "Untitled finding"}</strong><p>{finding.category || "General"} · {finding.description || evidenceSummary(finding.evidence)}</p></div></div>)}{findings.length === 0 && <div className="report-list-item">{locallyVerified ? <CheckCircle size={21} /> : <Info size={21} />}<strong>{locallyVerified ? "No findings returned by the audit." : "Findings state is unavailable because the proof is not trusted."}</strong></div>}</ReportTab>}
              {tab === "evidence" && <ReportTab title="Evidence & provenance"><p>Report mode: {dataModeLabel(meta.data_mode)}. Field-level provenance remains visible and is never promoted to a broader live claim.</p>{(meta.data_sources || []).map((source) => <div className="report-list-item" key={source}><CheckCircle size={21} /><strong>{source}</strong></div>)}<div className="report-list-item"><Info size={21} /><div><strong>Data provenance</strong><p>{JSON.stringify(meta.data_provenance || {})}</p></div></div></ReportTab>}
              {tab === "proof" && <ReportTab title="Proof manifest"><p>All received public steps use {proof.hash_algorithm || "an unspecified algorithm"}. Expected policy: Ethereum keccak256.</p>{steps.map((step) => <div className="report-list-item" key={step.step_hash}><StatusBadge tone={locallyVerified ? "verified" : "active"}>{String(step.step_index + 1).padStart(2, "0")}</StatusBadge><div><strong>{displayTitle(step.current_step)}</strong><p>{shortHash(step.step_hash, 10, 6)} · {step.source} / {step.agent}</p></div></div>)}</ReportTab>}
            </article>
          </div>

          <aside className="proof-manifest-column">
            <Panel className="proof-summary-panel">
              <div className="proof-summary-title"><h2>Proof manifest</h2><span className={locallyVerified ? "positive-text" : "blocked-text"}>{locallyVerified ? "SDK 0.2 VERIFIED" : `${receivedStageCount} / ${EXPECTED_STAGE_COUNT} unique stages received`}</span></div>
              <p>{locallyVerified ? "Seven public steps received and independently recomputed" : proofReceived ? "Seven public steps received; local recomputation did not pass" : "Incomplete seven-step proof structure"}</p>
              <div className="hash-pair"><div><span>Report hash</span>{proof.report_hash ? <HashValue label="Report hash" value={proof.report_hash} onInspect={onInspectHash} /> : <strong>Unavailable</strong>}</div><div><span>Merkle root</span>{proof.merkle_root ? <HashValue label="Merkle root" value={proof.merkle_root} onInspect={onInspectHash} /> : <strong>Unavailable</strong>}</div></div>
              {(proof.manifest_step_hash || proof.report_payload_hash) && <div className="hash-pair"><div><span>Manifest step</span>{proof.manifest_step_hash ? <HashValue label="Manifest step hash" value={proof.manifest_step_hash} onInspect={onInspectHash} /> : <strong>Unavailable</strong>}</div><div><span>Report payload</span>{proof.report_payload_hash ? <HashValue label="Report payload hash" value={proof.report_payload_hash} onInspect={onInspectHash} /> : <strong>Unavailable</strong>}</div></div>}
              <div className="algorithm-row"><span>Algorithm</span><code>{proof.hash_algorithm || "Unknown"}</code></div>
              {proof.report_hash && <button className="manifest-link" onClick={() => onInspectHash({ label: "Report hash", value: proof.report_hash })}>View full 66-character values ↗</button>}
            </Panel>

            <Panel className="proof-steps-panel">
              {steps.map((step, index) => {
                const expanded = expandedStep === index;
                const previousStep = steps[index - 1];
                const continuity = index === 0 ? /^0x0{64}$/.test(step.previous_step_hash || "") : step.previous_step_hash === previousStep?.step_hash;
                const stepVerified = localVerification?.stepResults?.[index]?.valid === true;
                const proofTone = stepVerified ? "verified" : continuity ? "received" : "danger";
                return <div className={`proof-step-row ${expanded ? "is-expanded" : ""}`} key={step.step_hash || index}><button className={`proof-step-button tone-${proofTone}`} aria-expanded={expanded} onClick={() => setExpandedStep(expanded ? -1 : index)}><span>{String(index + 1).padStart(2, "0")}</span><strong>{displayTitle(step.current_step)}</strong><em>{stepVerified ? "STEP MATCH" : continuity ? "HANDOFF MATCH" : "MISMATCH"}</em>{expanded ? <CaretDown size={17} /> : <CaretRight size={17} />}</button>{expanded && <div className={`proof-step-detail tone-${proofTone}`}><h3>Step #{String(index + 1).padStart(2, "0")} cryptographic input</h3><div><span>step_hash</span><HashValue label={`Step hash #${index + 1}`} value={step.step_hash} onInspect={onInspectHash} /></div><div><span>previous_step_hash</span><HashValue label={`Previous hash #${index + 1}`} value={step.previous_step_hash} onInspect={onInspectHash} /></div><p>{stepVerified ? <CheckCircle size={17} /> : <Info size={17} />} {stepVerified ? "FULL STEP HASH MATCH" : continuity ? "HANDOFF FIELD MATCH ONLY" : "CHAIN LINK MISMATCH"}</p><button onClick={() => onInspectHash({ label: `Step ${index + 1} hash_content`, value: step.hash_content })}>View canonical hash_content ↗</button></div>}</div>;
              })}
            </Panel>

            <Panel className="proof-policy-panel"><h3>Proof policy</h3><code>step_hash[n] → prev_hash[n+1]</code></Panel>
            <Panel className="anchor-panel" aria-live="polite" aria-busy={anchorBusy}><h3>Team attestation</h3><p>Optional · after report · outside the seven-step proof</p><p><Info size={17} /> {anchorStatus === "unconfigured" ? "Waiting for member 5 deployment configuration" : anchorStatus === "pending" ? "Confirm with the authorized team wallet" : anchorStatus === "confirmed" ? `Attested and read back in block ${anchorState.result.blockNumber}` : anchorStatus === "already-anchored" ? "A matching trusted registry record already exists; no new transaction was sent" : ["mined-unverified", "submission-unknown"].includes(anchorStatus) ? anchorState.error : anchorState.error || "Not checked or submitted"}</p><Button disabled={!locallyVerified || !attestationConfig.canWrite || anchorBusy || ["confirmed", "already-anchored", "mined-unverified", "submission-unknown"].includes(anchorStatus)} icon={Anchor} onClick={anchorReport}>{anchorStatus === "pending" ? "Awaiting confirmation…" : anchorStatus === "confirmed" ? "Anchor confirmed" : anchorStatus === "already-anchored" ? "Already anchored" : anchorStatus === "mined-unverified" ? "Mined · review required" : anchorStatus === "submission-unknown" ? "Submission · check registry" : "Anchor with team wallet"}</Button>{anchorResultMatchesReport && anchorState.result?.transactionExplorerUrl && <a className="anchor-transaction-link" href={anchorState.result.transactionExplorerUrl} target="_blank" rel="noreferrer">View mined transaction ↗</a>}{anchorStatus === "already-anchored" && attestationConfig.contractExplorerUrl && <a className="anchor-transaction-link" href={attestationConfig.contractExplorerUrl} target="_blank" rel="noreferrer">View trusted registry ↗</a>}<small>Wallet access occurs only on click. Green requires local verification plus a trusted event and registry read-back.</small></Panel>
          </aside>
        </div>
      </div>
    </AppShell>
  );
}

function ReportTab({ title, children }) {
  return <section className="report-tab-content"><h2>{title}</h2>{children}</section>;
}

import { useEffect, useMemo, useState } from "react";
import {
  Anchor,
  ArrowRight,
  ArrowsClockwise,
  ChartBar,
  CheckCircle,
  Circle,
  CircleNotch,
  FileText,
  Fingerprint,
  Info,
  Link,
  MagnifyingGlass,
  ShieldWarning,
  UsersThree,
  WarningCircle,
} from "@phosphor-icons/react";
import {
  AppShell,
  Breadcrumbs,
  Button,
  HashValue,
  Panel,
  PanelHeader,
  StatusBadge,
  StatusLed,
} from "../components/ui.jsx";
import { shortHash, verifyAuditReport } from "../lib/proof.js";
import { getAttestationConfig } from "../lib/attestationClient.js";
import { presentRiskAssessment } from "../lib/riskPresentation.js";

const EXPECTED_STAGES = [
  ["INPUT_VALIDATED", "Input validated"],
  ["CHAIN_FETCHED", "Chain data fetched"],
  ["DOC_PARSING", "Document parsed"],
  ["CROSS_CHECKING", "Evidence cross-checked"],
  ["RISK_SCORING", "Risk scored"],
  ["REPORT_ASSEMBLED", "Report assembled"],
  ["PROOF_MANIFEST_COMPILED", "Proof manifest compiled"],
];

function displayTitle(key) {
  return EXPECTED_STAGES.find(([name]) => name === key)?.[1]
    || String(key || "Awaiting stage").toLowerCase().replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

function StageIcon({ status }) {
  if (status === "verified") return <CheckCircle size={21} weight="regular" />;
  if (status === "received") return <Info size={21} weight="regular" />;
  if (status === "running") return <CircleNotch size={22} weight="bold" className="spin-slow" />;
  if (status === "failed") return <WarningCircle size={21} weight="regular" />;
  return <Circle size={21} weight="regular" />;
}

function formatTime(timestampMs) {
  if (!timestampMs) return "—";
  return new Date(timestampMs).toLocaleTimeString([], { hour12: false });
}

function runtimeMode(context, report) {
  const mode = report?.meta?.data_mode;
  if (mode) return mode.toUpperCase();
  return context?.backendMode === "mock" ? "Deterministic Mock" : "Backend runtime";
}

function evidenceItems(step) {
  if (Array.isArray(step?.evidence)) return step.evidence;
  return [];
}

function outputFindings(step) {
  if (Array.isArray(step?.output)) return step.output.filter((item) => item && typeof item === "object");
  if (Array.isArray(step?.output?.contradictions)) return step.output.contradictions;
  return [];
}

export function ExecutionPage({
  onNavigate,
  onInspectHash,
  taskId,
  context,
  steps,
  events,
  selectedStep,
  setSelectedStep,
  runState,
  runError,
  lastEventAt,
  onReconnect,
  report,
}) {
  const [inspectorTab, setInspectorTab] = useState("proof");
  const [now, setNow] = useState(Date.now());
  const attestationConfig = useMemo(() => getAttestationConfig(), []);
  const expectedCount = EXPECTED_STAGES.length;
  const expectedKeys = EXPECTED_STAGES.map(([key]) => key);
  const expectedSteps = steps.filter((step) => expectedKeys.includes(step.current_step));
  const failureStep = steps.find((step) => step.current_step === "PROCESS_FAILED");
  const receivedCount = new Set(expectedSteps.map((step) => step.current_step)).size;
  const receivedProgress = `${(receivedCount / expectedCount) * 100}%`;
  const completed = runState === "completed";
  const failed = runState === "failed";

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const displayStages = useMemo(() => EXPECTED_STAGES.map(([key, title], index) => ({
    key,
    title,
    step: steps.find((item) => item.current_step === key) || null,
  })), [steps]);
  const safeSelectedIndex = Math.min(Math.max(selectedStep, 0), expectedCount - 1);
  const selectedStage = displayStages[safeSelectedIndex];
  const activeStep = failed && failureStep ? failureStep : selectedStage?.step || null;
  const activeStageNumber = Number.isInteger(activeStep?.step_index)
    ? activeStep.step_index + 1
    : safeSelectedIndex + 1;
  const aiSteps = expectedSteps.filter((step) => step.source === "AI");
  const evidenceCount = expectedSteps.reduce((total, step) => total + evidenceItems(step).length, 0);
  const riskStep = [...expectedSteps].reverse().find((step) => step.output?.risk_score !== undefined || step.output?.risk_level);
  const riskScore = report?.summary?.overall_risk_score ?? riskStep?.output?.risk_score;
  const riskLevel = report?.summary?.risk_level ?? riskStep?.output?.risk_level;
  const localVerification = useMemo(() => report ? verifyAuditReport(report) : null, [report]);
  const riskPresentation = presentRiskAssessment({
    failed,
    ready: completed,
    locallyVerified: localVerification?.isLocallyValid === true,
    riskLevel,
    riskScore,
  });
  const riskBadgeTone = riskPresentation.state === "trusted"
    ? riskPresentation.level === "HIGH" || riskPresentation.level === "CRITICAL"
      ? "danger"
      : riskPresentation.level === "MEDIUM"
        ? "warning"
        : "verified"
    : riskPresentation.state === "failed"
      ? "danger"
      : ["unverified", "unavailable"].includes(riskPresentation.state) ? "warning" : "muted";
  const selectedAgentStep = activeStep?.source === "AI" ? activeStep : aiSteps.at(-1);
  const findings = outputFindings(selectedAgentStep);
  const handoffIndex = Math.max(0, Math.min(expectedSteps.length - 2, safeSelectedIndex - 1));
  const handoffFrom = expectedSteps[handoffIndex];
  const handoffTo = expectedSteps[handoffIndex + 1];
  const handoffMatches = Boolean(handoffFrom && handoffTo && handoffTo.previous_step_hash === handoffFrom.step_hash);
  const createdAtMs = context?.createdAt ? Number(context.createdAt) * 1000 : now;
  const elapsedSeconds = Math.max(0, Math.floor((now - createdAtMs) / 1000));
  const elapsed = `${String(Math.floor(elapsedSeconds / 60)).padStart(2, "0")}:${String(elapsedSeconds % 60).padStart(2, "0")}`;
  const lastEventSeconds = lastEventAt ? Math.max(0, Math.floor((now - lastEventAt) / 1000)) : null;
  const latestEvents = events.slice(-6);
  const streamLabel = ({
    connecting: "Connecting SSE",
    disconnected: "SSE disconnected",
    completed: "Stream complete",
    failed: "Processing failed",
    running: "SSE connected",
  })[runState] || "Waiting for stream";
  const statusLabel = failed ? "FAILED" : completed ? "COMPLETED" : runState === "disconnected" ? "DISCONNECTED" : "RUNNING";
  const activeVisualStatus = failed
    ? "failed"
    : activeStep
      ? "received"
      : safeSelectedIndex === receivedCount && !completed
        ? "running"
        : "queued";

  return (
    <AppShell active="audits" onNavigate={onNavigate} className="execution-shell">
      <div className="page execution-page">
        <header className="execution-header">
          <div>
            <Breadcrumbs items={["Audits", context?.project || "Audit", taskId || "Unknown task"]} />
            <div className="title-with-status"><h1>{context?.project || "Protocol"} audit</h1><StatusBadge tone={failed ? "danger" : completed ? "verified" : "active"}>{statusLabel}</StatusBadge></div>
            <div className="run-meta"><span>Audit target · {shortHash(context?.contractAddress, 8, 4) || "Address unavailable"}</span><i>•</i><span>{taskId || "No task"}</span><i>•</i><span>Sepolia</span><i>•</i><StatusBadge>{runtimeMode(context, report)}</StatusBadge></div>
          </div>
          <p className="header-note">Report unlocks after proof step 07.</p>
        </header>

        <Panel className="run-control-bar">
          <div className="run-health"><StatusLed tone={failed || runState === "disconnected" ? "danger" : completed ? "verified" : "active"} pulse={runState === "connecting"} /><span>{streamLabel}</span></div>
          <div className="run-kpi"><span>Last event</span><strong>{lastEventSeconds === null ? "—" : `${lastEventSeconds}s ago`}</strong></div>
          <div className="run-kpi"><span>Elapsed</span><strong>{elapsed}</strong></div>
          <div className="run-kpi"><span>Checkpoint</span><strong>{receivedCount} / {expectedCount}</strong></div>
          <div className="run-controls"><Button icon={ArrowsClockwise} onClick={onReconnect} disabled={completed || failed}>Reconnect stream</Button></div>
        </Panel>

        <div className="execution-grid">
          <div className="execution-left">
            <Panel className="stages-panel">
              <PanelHeader title="Execution stages" meta={`${receivedCount} / ${expectedCount} received`} />
              <div className="stage-list" style={{ "--stage-progress": receivedProgress }}>
                {displayStages.map(({ key, title, step }, index) => {
                  let status = step ? "received" : "queued";
                  if (!step && index === receivedCount && !completed && !failed) status = "running";
                  if (!step && failed && index === receivedCount) status = "failed";
                  return (
                    <button key={key} className={`stage-row status-${status} ${safeSelectedIndex === index ? "is-selected" : ""}`} onClick={() => setSelectedStep(index)}>
                      <span className="stage-node"><StageIcon status={status} /></span>
                      <span className="stage-number">{String(index + 1).padStart(2, "0")}</span>
                      <span className="stage-copy"><strong>{step ? displayTitle(step.current_step) : title}</strong><code>{step?.step_hash ? `step ${shortHash(step.step_hash, 8, 4)}` : "Hash pending"}</code></span>
                      <span className={`stage-status ${status}`}>{step ? "RECEIVED" : status.toUpperCase()}</span>
                    </button>
                  );
                })}
              </div>
            </Panel>

            <section className="handoff-cartridge evidence-cartridge">
              <h3>{handoffFrom && handoffTo ? `#${String(handoffIndex + 1).padStart(2, "0")} → #${String(handoffIndex + 2).padStart(2, "0")} Handoff` : "Hash handoff"}</h3>
              <div><span>step_hash</span>{handoffFrom ? <HashValue label="Step hash" value={handoffFrom.step_hash} onInspect={onInspectHash} /> : <strong>Pending</strong>}</div>
              <div><span>prev_hash</span>{handoffTo ? <HashValue label="Previous step hash" value={handoffTo.previous_step_hash} onInspect={onInspectHash} /> : <strong>Pending</strong>}</div>
              <div className={`handoff-match ${handoffMatches ? "is-matched" : ""}`}>{handoffMatches ? <Link size={18} /> : <Circle size={18} />} {handoffMatches ? "EXACT MATCH" : "AWAITING BOTH STEPS"}</div>
              {handoffFrom && <button onClick={() => onInspectHash({ label: "Full handoff hash", value: handoffFrom.step_hash })}>View full 66-character value</button>}
            </section>

            <Panel className="attestation-compact"><Link size={26} /><div><strong>Attestation · after report</strong><p>Outside seven-step Merkle proof chain</p><p>{attestationConfig.canRead ? "Trusted registry ready · not checked" : "Waiting for trusted deployment configuration"}</p></div></Panel>
          </div>

          <div className="execution-center">
            <Panel className={`active-stage-panel status-${activeVisualStatus}`}>
              <div className="active-stage-core">
                <span className="active-stage-emblem"><Fingerprint size={31} weight="duotone" /></span>
                <div className="active-stage-heading"><div><span className="active-stage-index">{String(activeStageNumber).padStart(2, "0")}</span><h2>{activeStep ? displayTitle(activeStep.current_step) : selectedStage?.title}</h2></div><p role={failed ? "alert" : undefined}>{activeStep?.message || (failed ? runError : "Waiting for the backend to publish this hashed stage.")}</p></div>
                <span className="active-stage-state"><StatusLed tone={activeVisualStatus === "failed" ? "danger" : activeVisualStatus === "verified" ? "verified" : activeVisualStatus === "received" ? "info" : "active"} pulse={activeVisualStatus === "running"} />{activeVisualStatus === "verified" ? "Locally verified" : activeVisualStatus === "received" ? "Hash received" : activeVisualStatus === "failed" ? "Chain interrupted" : "Awaiting hash"}</span>
              </div>
              <div className="stage-proof-track">
                <div><span>Previous handoff</span><code>{activeStep?.previous_step_hash ? shortHash(activeStep.previous_step_hash, 8, 4) : "0x0000…0000"}</code></div>
                <i aria-hidden="true"><ArrowRight size={18} weight="bold" /></i>
                <div><span>Ethereum keccak256</span><code>{activeStep?.step_hash ? shortHash(activeStep.step_hash, 8, 4) : "Hash pending"}</code></div>
              </div>
              <div className="stage-metrics">
                <div><UsersThree size={28} /><strong>{aiSteps.length}</strong><span>AI stages received</span></div>
                <div><FileText size={28} /><strong>{evidenceCount}</strong><span>evidence references</span></div>
                <div><ChartBar size={28} /><strong>{receivedCount}/{expectedCount}</strong><span>proof stages received</span></div>
              </div>
            </Panel>

            <Panel className="events-panel">
              <PanelHeader title="Live events" meta="Backend outputs only" />
              <div className="events-list" role="log" aria-live="polite" aria-relevant="additions text">
                {latestEvents.length === 0 && <div className="event-row tone-active"><time>—</time><CircleNotch size={19} className="spin-slow" /><span>Waiting for first SSE event</span></div>}
                {latestEvents.map((event, index) => {
                  if (event.type === "STEP") {
                    const isFailureStep = event.step.current_step === "PROCESS_FAILED";
                    return <div className={`event-row tone-${isFailureStep ? "danger" : "info"}`} key={`step-${event.step.step_index}`}><time>{formatTime(event.step.timestamp_ms)}</time>{isFailureStep ? <WarningCircle size={19} /> : <Info size={19} />}<span>{event.step.message || displayTitle(event.step.current_step)}</span><strong>{isFailureStep ? "FAILED" : `#${String(event.step.step_index + 1).padStart(2, "0")}`}</strong></div>;
                  }
                  const isFailure = event.type === "FAILED";
                  return <div className={`event-row tone-${isFailure ? "danger" : "info"}`} key={`${event.type}-${index}`}><time>{formatTime(lastEventAt)}</time>{isFailure ? <WarningCircle size={19} /> : <Info size={19} />}<span>{isFailure ? event.payload?.message || "Audit failed" : "Audit complete · fetching final report"}</span><strong>{event.type}</strong></div>;
                })}
              </div>
            </Panel>

            <Panel className="latest-output-panel">
              <PanelHeader title="Latest public output" />
              <div className="output-grid"><span>Risk</span><StatusBadge tone={riskBadgeTone}>{riskPresentation.level}{riskPresentation.state === "unverified" ? " · UNVERIFIED" : ""}</StatusBadge><span>Risk score</span><strong>{riskPresentation.score ?? "—"}</strong><span>step_hash #{String((activeStep?.step_index ?? safeSelectedIndex) + 1).padStart(2, "0")}</span><strong>{activeStep?.step_hash ? shortHash(activeStep.step_hash, 8, 4) : "Pending"}</strong></div>
              <div className="integrity-quad">
                <div><Info size={32} /><strong>Proof receipt</strong><span>{receivedCount === expectedCount ? "7 stages received" : `${receivedCount} / ${expectedCount} received`}</span></div>
                <div><UsersThree size={32} /><strong>Agent pipeline</strong><span>{aiSteps.length} AI steps received</span></div>
                <div><ShieldWarning size={32} /><strong>Final risk</strong><span>{riskPresentation.state === "trusted" ? `${riskPresentation.level} · ${riskPresentation.score ?? "—"} / 100` : riskPresentation.state === "unverified" ? `${riskPresentation.level} · UNVERIFIED` : `${riskPresentation.level} · —`}</span></div>
                <div><Anchor size={32} /><strong>Anchor status</strong><span>{attestationConfig.canRead ? "Not checked" : "Not configured"}</span></div>
              </div>
            </Panel>
          </div>

          <div className="execution-right">
            <Panel className="agent-inputs-panel">
              <PanelHeader title="Agent inputs" meta={<span className={aiSteps.length === 3 ? "received-text" : "blocked-text"}>{aiSteps.length} / 3 received</span>} />
              <div className="agent-table-head"><span>Agent</span><span>Risk</span><span>Evidence</span><span>Source</span></div>
              {aiSteps.map((step) => <button key={step.step_hash} className={`agent-row ${activeStep?.step_hash === step.step_hash ? "is-selected" : ""}`} onClick={() => setSelectedStep(step.step_index)}><span>{step.agent}</span><span className={`risk-text risk-${String(step.output?.risk_level || "").toLowerCase()}`}>{step.output?.risk_level || "—"}</span><span>{evidenceItems(step).length}</span><span>Step {String(step.step_index + 1).padStart(2, "0")}</span></button>)}
              {aiSteps.length === 0 && <div className="agent-row"><span>Awaiting agents</span><span>—</span><span>0</span><span>—</span></div>}
            </Panel>

            <Panel className="agent-detail-panel">
              <h2>{selectedAgentStep?.agent || "Agent evidence"}</h2>
              <p>{selectedAgentStep ? `Source: Step ${String(selectedAgentStep.step_index + 1).padStart(2, "0")} · ${displayTitle(selectedAgentStep.current_step)}` : "Waiting for member 3 output"}</p>
              <p className="evidence-count">{findings.length || evidenceItems(selectedAgentStep).length} evidence items</p>
              {(findings.length ? findings : evidenceItems(selectedAgentStep).map((item) => ({ title: String(item) }))).slice(0, 3).map((finding, index) => <div className="finding-row" key={`${finding.category || finding.title || index}-${index}`}><span>Evidence {String(index + 1).padStart(2, "0")}</span><strong>{finding.title || finding.description || finding.evidence || "Evidence item"}</strong><span>·</span></div>)}
              {!selectedAgentStep && <div className="finding-row"><span>Pending</span><strong>No synthetic finding inserted</strong><span>·</span></div>}
              <Button icon={MagnifyingGlass} onClick={() => setInspectorTab("evidence")} disabled={!selectedAgentStep}>Inspect evidence</Button>
            </Panel>

            <Panel className="proof-inspector-panel">
              <div className="inspector-title"><span>Step proof</span><strong>#{String((activeStep?.step_index ?? safeSelectedIndex) + 1).padStart(2, "0")}</strong></div>
              <div className="segment-tabs compact-tabs" aria-label="Inspector view">{["evidence", "proof", "payload", "provenance"].map((tab) => <button aria-pressed={inspectorTab === tab} className={inspectorTab === tab ? "is-selected" : ""} onClick={() => setInspectorTab(tab)} key={tab}>{tab[0].toUpperCase() + tab.slice(1)}</button>)}</div>
              <div className="proof-tab-body">
                {inspectorTab === "evidence" && <><p>{activeStep ? `${evidenceItems(activeStep).length} backend-provided evidence references` : "Evidence pending"}</p><code className="chain-relation">step_hash[n] → prev_hash[n+1]</code>{activeStep?.step_hash && <button onClick={() => onInspectHash({ label: `Full Step ${activeStep.step_index + 1} hash`, value: activeStep.step_hash })}>View full 66-character step hash ↗</button>}</>}
                {inspectorTab === "proof" && <>{activeStep ? <><p>Selected backend step proof</p><HashValue label={`Step ${activeStep.step_index + 1} hash`} value={activeStep.step_hash} onInspect={onInspectHash} compact /><HashValue label={`Step ${activeStep.step_index + 1} previous hash`} value={activeStep.previous_step_hash} onInspect={onInspectHash} compact /></> : <p>Proof pending</p>}</>}
                {inspectorTab === "payload" && <><p>Canonical backend hash_content</p><code className="payload-preview">{activeStep?.hash_content || "Pending"}</code></>}
                {inspectorTab === "provenance" && <><p>Source: {activeStep?.source || "Pending"} · Agent: {activeStep?.agent || "Pending"}</p><code className="chain-relation">{JSON.stringify(activeStep?.output?.provenance || report?.meta?.data_provenance || { mode: runtimeMode(context, report) })}</code></>}
              </div>
            </Panel>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle, Info, ShieldCheck } from "@phosphor-icons/react";
import { Button, HashInspector, Modal } from "./components/ui.jsx";
import { HomePage } from "./pages/HomePage.jsx";
import { ExecutionPage } from "./pages/ExecutionPage.jsx";
import { ReportPage } from "./pages/ReportPage.jsx";
import { VerifyPage } from "./pages/VerifyPage.jsx";
import {
  checkBackendHealth,
  getLiveReport,
  startLiveAudit,
  streamLiveAudit,
} from "./lib/auditClient.js";
import { isCurrentTaskRoute, matchesTaskId, scopeValueToTask } from "./lib/taskScope.js";

const SESSION_KEY = "fluxaudit.current-audit.v1";

function routeFor(pathname) {
  if (pathname === "/verify") return "verify";
  if (pathname.endsWith("/report")) return "report";
  if (pathname.startsWith("/audit/")) return "execution";
  return "home";
}

function taskIdFor(pathname) {
  const match = pathname.match(/^\/audit\/([^/]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function restoreContext() {
  try {
    return JSON.parse(window.sessionStorage.getItem(SESSION_KEY)) || null;
  } catch {
    return null;
  }
}

export function App() {
  const [pathname, setPathname] = useState(window.location.pathname);
  const [inspectedHash, setInspectedHash] = useState(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [health, setHealth] = useState(null);
  const [healthState, setHealthState] = useState("checking");
  const [auditContext, setAuditContext] = useState(restoreContext);
  const [steps, setSteps] = useState([]);
  const [events, setEvents] = useState([]);
  const [selectedStep, setSelectedStep] = useState(0);
  const [runState, setRunState] = useState("idle");
  const [runError, setRunError] = useState("");
  const [lastEventAt, setLastEventAt] = useState(null);
  const [report, setReport] = useState(null);
  const [reportState, setReportState] = useState("idle");
  const [reportStateTaskId, setReportStateTaskId] = useState(null);
  const [executionTaskId, setExecutionTaskId] = useState(null);
  const [streamRevision, setStreamRevision] = useState(0);
  const reportRequestRef = useRef(0);
  const executionGenerationRef = useRef(0);
  const route = routeFor(pathname);
  const routeTaskId = useMemo(() => taskIdFor(pathname), [pathname]);
  const routeRef = useRef({ route, taskId: routeTaskId });
  routeRef.current = { route, taskId: routeTaskId };
  const routeReport = scopeValueToTask(report, report?.task_id, routeTaskId);
  const routeContext = scopeValueToTask(auditContext, auditContext?.taskId, routeTaskId);
  const executionStateMatchesRoute = matchesTaskId(executionTaskId, routeTaskId);
  const routeReportState = matchesTaskId(reportStateTaskId, routeTaskId)
    ? reportState
    : routeReport
      ? routeReport.meta?.status === "FAILED" ? "failed" : "ready"
      : "loading";
  const routeError = executionStateMatchesRoute || matchesTaskId(reportStateTaskId, routeTaskId)
    ? runError
    : "";

  useEffect(() => {
    const onPopState = () => {
      const nextPath = window.location.pathname;
      const nextTaskId = taskIdFor(nextPath);
      if (nextTaskId !== routeRef.current.taskId) {
        reportRequestRef.current += 1;
        executionGenerationRef.current += 1;
      }
      routeRef.current = { route: routeFor(nextPath), taskId: nextTaskId };
      setPathname(nextPath);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    const title = ({ home: "Create audit", execution: "Audit execution", report: "Audit report", verify: "Verify report" })[route];
    document.title = `${title || "FluxAudit"} · FluxAudit`;
    const focusFrame = window.requestAnimationFrame(() => {
      const heading = document.querySelector(".main-viewport h1");
      if (!heading) return;
      heading.setAttribute("tabindex", "-1");
      heading.focus({ preventScroll: true });
      heading.addEventListener("blur", () => heading.removeAttribute("tabindex"), { once: true });
    });
    return () => window.cancelAnimationFrame(focusFrame);
  }, [pathname, route]);

  const navigate = (nextPath) => {
    if (nextPath === "/about") {
      setAboutOpen(true);
      return;
    }
    const nextTaskId = taskIdFor(nextPath);
    if (nextTaskId !== routeRef.current.taskId) {
      reportRequestRef.current += 1;
      executionGenerationRef.current += 1;
    }
    routeRef.current = { route: routeFor(nextPath), taskId: nextTaskId };
    window.history.pushState({}, "", nextPath);
    setPathname(nextPath);
    window.scrollTo({ top: 0, behavior: "instant" });
  };

  const refreshHealth = async () => {
    setHealthState("checking");
    try {
      const nextHealth = await checkBackendHealth();
      setHealth(nextHealth);
      setHealthState(nextHealth.status === "ok" ? "healthy" : "degraded");
      return nextHealth;
    } catch (error) {
      setHealth(null);
      setHealthState("offline");
      throw error;
    }
  };

  useEffect(() => {
    if (route !== "home") return undefined;
    const controller = new AbortController();
    setHealthState("checking");
    checkBackendHealth(controller.signal)
      .then((nextHealth) => {
        setHealth(nextHealth);
        setHealthState(nextHealth.status === "ok" ? "healthy" : "degraded");
      })
      .catch((error) => {
        if (error.name !== "AbortError") {
          setHealth(null);
          setHealthState("offline");
        }
      });
    return () => controller.abort();
  }, [route]);

  const fetchReport = async (taskId, { signal } = {}) => {
    const requestId = ++reportRequestRef.current;
    const isCurrentRequest = () => !signal?.aborted
      && requestId === reportRequestRef.current
      && isCurrentTaskRoute(routeRef.current, taskId);
    if (isCurrentRequest()) {
      setReportStateTaskId(taskId);
      setReportState("loading");
    }
    try {
      const payload = await getLiveReport(taskId, signal);
      if (!isCurrentRequest()) return null;
      if (!payload.proof_data) {
        setReportState("processing");
        return null;
      }
      setReport(payload);
      setReportState(payload.meta?.status === "FAILED" ? "failed" : "ready");
      return payload;
    } catch (error) {
      if (error.name === "AbortError" || !isCurrentRequest()) return null;
      setReportState("error");
      setRunError(error.message);
      throw error;
    }
  };

  const startAudit = async (request, context) => {
    reportRequestRef.current += 1;
    executionGenerationRef.current += 1;
    setRunState("starting");
    setRunError("");
    const created = await startLiveAudit(request);
    const nextContext = {
      ...context,
      taskId: created.task_id,
      createdAt: created.created_at,
      contractAddress: request.contract_address,
      chainId: request.chain_id,
      backendMode: health?.use_mock_data ? "mock" : "configured",
    };
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(nextContext));
    setAuditContext(nextContext);
    setExecutionTaskId(created.task_id);
    setSteps([]);
    setEvents([]);
    setSelectedStep(0);
    setReport(null);
    setReportStateTaskId(null);
    setReportState("idle");
    setRunState("connecting");
    navigate(`/audit/${encodeURIComponent(created.task_id)}`);
    return created;
  };

  useEffect(() => {
    if (route !== "execution" || !routeTaskId) return undefined;

    const generation = ++executionGenerationRef.current;
    let cancelled = false;
    const isCurrentExecution = () => !cancelled
      && generation === executionGenerationRef.current
      && isCurrentTaskRoute(routeRef.current, routeTaskId, "execution");
    setExecutionTaskId(routeTaskId);

    if (report?.task_id === routeTaskId) {
      const reportSteps = report.proof_data?.steps || [];
      setSteps(reportSteps);
      setEvents(reportSteps.map((step) => ({ type: "STEP", step })));
      setSelectedStep(Math.max(0, reportSteps.length - 1));
      setRunState(report.meta?.status === "FAILED" ? "failed" : "completed");
      return () => {
        cancelled = true;
        if (executionGenerationRef.current === generation) executionGenerationRef.current += 1;
      };
    }

    setSteps([]);
    setEvents([]);
    setSelectedStep(0);
    setLastEventAt(null);
    setRunState("connecting");
    setRunError("");
    const closeStream = streamLiveAudit(routeTaskId, {
      onStep: (payload) => {
        if (!isCurrentExecution()) return;
        const step = payload.log_entry;
        setSteps((current) => {
          const withoutDuplicate = current.filter((item) => item.step_index !== step.step_index);
          return [...withoutDuplicate, step].sort((a, b) => a.step_index - b.step_index);
        });
        setEvents((current) => {
          if (current.some((item) => item.type === "STEP" && item.step.step_index === step.step_index)) return current;
          return [...current, { type: "STEP", step }];
        });
        setSelectedStep(step.step_index);
        setLastEventAt(Date.now());
        setRunState("running");
      },
      onCompleted: async (payload) => {
        if (!isCurrentExecution()) return;
        setLastEventAt(Date.now());
        setEvents((current) => [...current, { type: "COMPLETED", payload }]);
        setRunState("completed");
        try {
          const finalReport = await fetchReport(routeTaskId);
          if (finalReport && isCurrentTaskRoute(routeRef.current, routeTaskId, "execution")) {
            navigate(`/audit/${encodeURIComponent(routeTaskId)}/report`);
          }
        } catch {
          // Keep the terminal state visible if report recovery fails.
        }
      },
      onFailed: async (payload) => {
        if (!isCurrentExecution()) return;
        setLastEventAt(Date.now());
        setEvents((current) => [...current, { type: "FAILED", payload }]);
        setRunError(payload.message || "Audit processing failed.");
        setRunState("failed");
        try {
          await fetchReport(routeTaskId);
        } catch {
          // Keep the original terminal error visible.
        }
      },
      onDisconnect: () => {
        if (!isCurrentExecution()) return;
        setRunState((current) => current === "completed" || current === "failed" ? current : "disconnected");
      },
    });
    return () => {
      cancelled = true;
      if (executionGenerationRef.current === generation) executionGenerationRef.current += 1;
      closeStream();
    };
  }, [route, routeTaskId, streamRevision, report?.task_id]);

  useEffect(() => {
    if (route !== "report" || !routeTaskId || report?.task_id === routeTaskId) return undefined;
    const controller = new AbortController();
    fetchReport(routeTaskId, { signal: controller.signal }).catch(() => {});
    return () => controller.abort();
  }, [route, routeTaskId, report?.task_id]);

  const reconnect = () => {
    setRunState("connecting");
    setStreamRevision((current) => current + 1);
  };

  return (
    <>
      {route === "home" && <HomePage onNavigate={navigate} onStart={startAudit} health={health} healthState={healthState} onRefreshHealth={refreshHealth} />}
      {route === "execution" && <ExecutionPage onNavigate={navigate} onInspectHash={setInspectedHash} taskId={routeTaskId} context={routeContext} steps={executionStateMatchesRoute ? steps : []} events={executionStateMatchesRoute ? events : []} selectedStep={executionStateMatchesRoute ? selectedStep : 0} setSelectedStep={setSelectedStep} runState={executionStateMatchesRoute ? runState : "connecting"} runError={routeError} lastEventAt={executionStateMatchesRoute ? lastEventAt : null} onReconnect={reconnect} report={routeReport} />}
      {route === "report" && <ReportPage onNavigate={navigate} onInspectHash={setInspectedHash} taskId={routeTaskId} context={routeContext} report={routeReport} reportState={routeReportState} error={routeError} onRetryLoad={() => fetchReport(routeTaskId)} />}
      {route === "verify" && <VerifyPage onNavigate={navigate} onInspectHash={setInspectedHash} report={report} initialReport={report} />}

      <HashInspector inspected={inspectedHash} onClose={() => setInspectedHash(null)} />

      <Modal open={aboutOpen} title="About FluxAudit proof" onClose={() => setAboutOpen(false)}>
        <div className="about-proof-content">
          <ShieldCheck size={42} />
          <div><h3>Public evidence, independently verifiable</h3><p>FluxAudit hashes every received public stage with Ethereum keccak256 and links each step to the previous hash.</p></div>
          <div className="about-proof-rule"><CheckCircle size={20} /><code>step_hash[n] → prev_hash[n+1]</code></div>
          <div className="about-proof-rule"><Info size={20} /><span>Optional attestation happens after the report and stays outside the Merkle proof chain.</span></div>
          <p className="modal-helper">Runtime provenance is read from the backend report. No live-chain claim is inferred by the client.</p>
        </div>
        <div className="modal-actions"><Button variant="primary" onClick={() => { setAboutOpen(false); navigate("/verify"); }}>Open verifier</Button><Button variant="quiet" onClick={() => setAboutOpen(false)}>Close</Button></div>
      </Modal>
    </>
  );
}

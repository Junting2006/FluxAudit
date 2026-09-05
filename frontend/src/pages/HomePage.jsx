import { useRef, useState } from "react";
import {
  ArrowRight,
  ArrowSquareOut,
  CheckCircle,
  Clock,
  Copy,
  FilePdf,
  Globe,
  ShieldCheck,
  X,
} from "@phosphor-icons/react";
import {
  AppShell,
  Breadcrumbs,
  Button,
  DataRow,
  Panel,
  PanelHeader,
  ReadyMark,
  StatusLed,
} from "../components/ui.jsx";
import { AUDIT_CASES, DEFAULT_AUDIT_CASE, inferAuditCase } from "../lib/auditCases.js";
import { getAttestationConfig } from "../lib/attestationClient.js";
import { ethereumKeccakReady } from "../lib/proof.js";
import { analysisEngineLabel, getRuntimeReadiness, runtimeLabel } from "../lib/runtimeHealth.js";

const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const MAX_FILE_BASE64_LENGTH = 8_000_000;
const MAX_WHITEPAPER_LENGTH = 200_000;
const PROOF_SPINE = ["Input", "Chain", "Document", "Cross-check", "Risk", "Report", "Manifest"];

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error("Unable to read the selected file."));
    reader.readAsDataURL(file);
  });
}

export function HomePage({ onNavigate, onStart, health, healthState, onRefreshHealth }) {
  const [selectedCase, setSelectedCase] = useState(DEFAULT_AUDIT_CASE.id);
  const [address, setAddress] = useState(DEFAULT_AUDIT_CASE.contractAddress);
  const [whitepaperText, setWhitepaperText] = useState(DEFAULT_AUDIT_CASE.whitepaperText);
  const [note, setNote] = useState("");
  const [file, setFile] = useState(null);
  const [fileBase64, setFileBase64] = useState(null);
  const [fileError, setFileError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const fileInput = useRef(null);
  const validAddress = ADDRESS_PATTERN.test(address);
  const validText = whitepaperText.trim().length > 0 && whitepaperText.length <= MAX_WHITEPAPER_LENGTH;
  const runtimeReadiness = getRuntimeReadiness(health, healthState);
  const ready = validAddress && validText && ethereumKeccakReady && runtimeReadiness.analysisReady && !fileError;
  const activeCase = AUDIT_CASES[selectedCase] || null;
  const checksReady = [
    validAddress,
    validText,
    ethereumKeccakReady,
    runtimeReadiness.backendReachable,
    runtimeReadiness.analysisReady,
  ].filter(Boolean).length;
  const modeLabel = runtimeLabel(health, healthState);
  const engineLabel = analysisEngineLabel(health, healthState);
  const attestationConfig = getAttestationConfig();

  const applyCase = (nextCase) => {
    setSelectedCase(nextCase.id);
    setAddress(nextCase.contractAddress);
    setWhitepaperText(nextCase.whitepaperText);
    setFile(null);
    setFileBase64(null);
    setFileError("");
    setSubmitError("");
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!ready || submitting) return;
    setSubmitting(true);
    setSubmitError("");
    const request = {
      target_type: "HYBRID",
      contract_address: address.trim(),
      chain_id: 11155111,
      whitepaper_text: whitepaperText.trim(),
    };
    if (fileBase64) request.file_base64 = fileBase64;
    try {
      await onStart(request, {
        caseId: activeCase?.id || "custom",
        project: activeCase?.project || "Custom audit",
        expected: activeCase?.expected || null,
        note,
        sourceFileName: file?.name || null,
      });
    } catch (error) {
      setSubmitError(error.message || "Unable to create the audit.");
      setSubmitting(false);
    }
  };

  const handleFile = async (event) => {
    const nextFile = event.target.files?.[0];
    if (!nextFile) return;
    setFileError("");
    setSubmitError("");
    try {
      const dataUrl = await readAsDataUrl(nextFile);
      if (dataUrl.length > MAX_FILE_BASE64_LENGTH) {
        throw new Error("Encoded attachment exceeds the backend limit of 8,000,000 characters.");
      }

      const lowerName = nextFile.name.toLowerCase();
      if (lowerName.endsWith(".txt")) {
        const text = await nextFile.text();
        if (!text.trim()) throw new Error("The selected text file is empty.");
        if (text.length > MAX_WHITEPAPER_LENGTH) throw new Error("Whitepaper text exceeds 200,000 characters.");
        setWhitepaperText(text);
        setSelectedCase("custom");
      } else if (lowerName.endsWith(".json")) {
        const parsed = JSON.parse(await nextFile.text());
        if (typeof parsed.whitepaper_text !== "string" || !parsed.whitepaper_text.trim()) {
          throw new Error("JSON input must contain a non-empty whitepaper_text field.");
        }
        if (parsed.whitepaper_text.length > MAX_WHITEPAPER_LENGTH) throw new Error("Whitepaper text exceeds 200,000 characters.");
        setWhitepaperText(parsed.whitepaper_text);
        if (typeof parsed.contract_address === "string" && ADDRESS_PATTERN.test(parsed.contract_address)) {
          setAddress(parsed.contract_address);
        }
        const importedCase = inferAuditCase(parsed.contract_address);
        setSelectedCase(importedCase?.whitepaperText === parsed.whitepaper_text ? importedCase.id : "custom");
      } else if (!lowerName.endsWith(".pdf")) {
        throw new Error("Choose a JSON, TXT, or PDF source file.");
      }

      setFile({
        name: nextFile.name,
        size: `${Math.max(0.1, nextFile.size / 1024 / 1024).toFixed(1)} MB`,
        isPdf: lowerName.endsWith(".pdf"),
      });
      setFileBase64(dataUrl);
      if (lowerName.endsWith(".pdf") && !whitepaperText.trim()) {
        setFileError("PDF is attached but not parsed by the backend. Paste the whitepaper text before starting.");
      }
    } catch (error) {
      setFile(null);
      setFileBase64(null);
      setFileError(error instanceof SyntaxError ? "The selected JSON file is invalid." : error.message);
    } finally {
      event.target.value = "";
    }
  };

  const removeFile = () => {
    setFile(null);
    setFileBase64(null);
    setFileError("");
  };

  return (
    <AppShell active="new" onNavigate={onNavigate} className="home-shell">
      <div className="page home-page">
        <header className="page-topbar">
          <div>
            <Breadcrumbs items={["Audits", "New audit"]} />
            <h1>Create audit</h1>
            <p className="page-subtitle">Submit a contract and source text for a seven-stage verifiable review.</p>
          </div>
          <div className="header-statuses">
            <span className="service-health" role="status" aria-live="polite"><StatusLed tone={runtimeReadiness.analysisReady ? "verified" : healthState === "checking" ? "active" : "danger"} /> {runtimeReadiness.analysisReady ? "Audit runtime ready" : healthState === "checking" ? "Checking service" : runtimeReadiness.backendReachable ? "Runtime incomplete" : "Service unavailable"}</span>
            <span className="header-chip"><StatusLed tone="active" /> Sepolia</span>
            <span className="header-chip"><StatusLed tone={health?.use_mock_data ? "active" : runtimeReadiness.analysisReady ? "verified" : "danger"} /> {modeLabel}</span>
          </div>
        </header>

        <div className="home-grid">
          <Panel className="audit-target-panel">
            <PanelHeader title="Audit target" />
            <form onSubmit={handleSubmit} className="audit-form">
              <fieldset className="field-group run-mode-fieldset">
                <legend className="field-label">Deterministic dataset</legend>
                <div className="segmented-control">
                  {[AUDIT_CASES.novapay, AUDIT_CASES.atlas].map((item) => (
                    <button type="button" aria-pressed={selectedCase === item.id} className={selectedCase === item.id ? "is-selected" : ""} onClick={() => applyCase(item)} key={item.id}>{item.label}</button>
                  ))}
                </div>
                <span className="field-hint">{activeCase ? `Expected deterministic result: ${activeCase.expected}` : "Custom input · results depend on the submitted evidence."}</span>
              </fieldset>

              <div className="form-divider" />

              <label className="field-group">
                <span className="field-label">Contract address</span>
                <span className="text-field with-action">
                  <input value={address} onChange={(event) => { setAddress(event.target.value); setSelectedCase("custom"); }} spellCheck="false" aria-invalid={!validAddress} />
                  <button type="button" className="field-action" onClick={() => navigator.clipboard?.writeText(address)} aria-label="Copy contract address"><Copy size={21} /></button>
                </span>
                <span className={`field-feedback ${validAddress ? "is-valid" : "is-error"}`}>{validAddress ? <CheckCircle size={18} /> : <X size={18} />}{validAddress ? "Valid EVM address format" : "Enter a 20-byte 0x-prefixed address"}</span>
              </label>

              <div className="form-divider" />

              <label className="field-group">
                <span className="field-label">Whitepaper text</span>
                <textarea value={whitepaperText} onChange={(event) => { setWhitepaperText(event.target.value); setSelectedCase("custom"); setFileError(""); }} placeholder="Paste the source text that member 3 will audit" aria-invalid={!validText} />
                <span className={`field-hint ${validText ? "" : "is-error"}`}>{whitepaperText.length.toLocaleString()} / {MAX_WHITEPAPER_LENGTH.toLocaleString()} characters · required because PDF attachments are not parsed by the backend</span>
              </label>

              <div className="form-divider" />

              <div className="field-group">
                <span className="field-label">Source attachment (optional)</span>
                {file ? (
                  <div className="evidence-cartridge source-cartridge">
                    <FilePdf size={23} weight="regular" />
                    <strong>{file.name}</strong>
                    <span>· {file.size}</span>
                    <ReadyMark>ATTACHED</ReadyMark>
                    <button type="button" className="cartridge-control" onClick={() => fileInput.current?.click()}>Replace</button>
                    <button type="button" className="cartridge-control icon-only" onClick={removeFile} aria-label="Remove file"><X size={20} /></button>
                  </div>
                ) : <button type="button" className="empty-upload" onClick={() => fileInput.current?.click()}><FilePdf size={22} /> Choose source material</button>}
                <input ref={fileInput} type="file" accept=".json,.txt,.pdf,application/json,text/plain,application/pdf" hidden onChange={handleFile} />
                <span className="field-hint">JSON or TXT imports whitepaper_text · PDF is attachment-only · encoded payload max 8,000,000 characters</span>
                {fileError && <span className="field-feedback is-error"><X size={18} />{fileError}</span>}
              </div>

              <div className="form-divider" />

              <div className="field-group">
                <span className="field-label">Runtime</span>
                <div className="network-well"><span><Globe size={21} /> Sepolia · {modeLabel}</span><small>Final provenance is reported per field</small></div>
              </div>

              <div className="form-divider" />

              <label className="field-group">
                <span className="field-label">Audit note (local only)</span>
                <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add context for teammates; this is not sent to the API" />
              </label>

              <div className="submit-row">
                <Button type="submit" icon={ArrowRight} variant="primary" disabled={!ready || submitting}>{submitting ? "Creating audit…" : "Start 7-stage audit"}</Button>
                <p>Wallet not required. The API receives only contract, chain, whitepaper, and optional attachment fields.</p>
              </div>
              {submitError && <p className="file-error"><X size={18} /> {submitError} <button type="button" onClick={() => onRefreshHealth().catch(() => {})}>Check service again</button></p>}
            </form>
          </Panel>

          <div className="home-side-stack">
            <Panel className="preflight-panel">
              <PanelHeader title="Preflight" meta={<span className={ready ? "positive-text" : "blocked-text"}>{checksReady} / 5 ready</span>} />
              <div className="check-list">
                <DataRow label="Contract address" icon={validAddress ? CheckCircle : X} tone={validAddress ? "verified" : "danger"}>{validAddress ? "Validated" : "Invalid"}</DataRow>
                <DataRow label="Whitepaper text" icon={validText ? CheckCircle : X} tone={validText ? "verified" : "danger"}>{validText ? "Ready" : "Required"}</DataRow>
                <DataRow label="Ethereum keccak256" icon={ethereumKeccakReady ? CheckCircle : X} tone={ethereumKeccakReady ? "verified" : "danger"}>{ethereumKeccakReady ? "Available" : "Unavailable"}</DataRow>
                <DataRow label="Backend API" icon={runtimeReadiness.backendReachable ? CheckCircle : X} tone={runtimeReadiness.backendReachable ? "verified" : healthState === "checking" ? "active" : "danger"}>{runtimeReadiness.backendReachable ? "Connected" : modeLabel}</DataRow>
                <DataRow label="Analysis engine" icon={runtimeReadiness.analysisReady ? CheckCircle : healthState === "checking" || !runtimeReadiness.backendReachable ? Clock : X} tone={runtimeReadiness.analysisReady ? "verified" : healthState === "checking" || !runtimeReadiness.backendReachable ? "active" : "danger"}>{engineLabel}</DataRow>
                <DataRow label="Expected run" icon={Clock} tone="active">7 hashed stages · SSE live progress</DataRow>
              </div>
            </Panel>

            <Panel className="audit-config-panel">
              <PanelHeader title="Audit configuration" />
              <div className="proof-mini-spine" aria-label="Seven public hashed stages">
                {PROOF_SPINE.map((label, index) => (
                  <div className="proof-mini-step" key={label}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <small>{label}</small>
                    {index < PROOF_SPINE.length - 1 && <i aria-hidden="true" />}
                  </div>
                ))}
              </div>
              <div className="config-table">
                <DataRow label="Public stages">7</DataRow>
                <DataRow label="Step hashing">Every step independently</DataRow>
                <DataRow label="Algorithm"><code>Ethereum keccak256</code></DataRow>
                <DataRow label="Chain relation"><code>step_hash[n] → prev_hash[n+1]</code></DataRow>
                <DataRow label="Runtime mode">{modeLabel}</DataRow>
              </div>
              <button className="proof-policy-button" type="button" onClick={() => onNavigate("/verify")}>View proof policy <ArrowSquareOut size={16} /></button>
              <div className="attestation-note"><ShieldCheck size={35} weight="regular" /><div><strong>Optional attestation</strong><p>After report · outside the seven-step Merkle proof chain</p><p>{attestationConfig.canRead ? "Trusted registry configured · checked only after report" : "Waiting for trusted Sepolia deployment configuration"}</p></div></div>
            </Panel>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

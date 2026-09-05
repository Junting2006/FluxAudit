import {
  ArrowSquareOut,
  CaretRight,
  Check,
  ClipboardText,
  Copy,
  Info,
  PlusSquare,
  ShieldCheck,
  X,
} from "@phosphor-icons/react";
import { useEffect, useLayoutEffect, useRef } from "react";
import { shortHash } from "../lib/proof.js";

const NAV_ITEMS = [
  { id: "audits", label: "Audits", icon: ClipboardText, path: "/" },
  { id: "new", label: "New audit", icon: PlusSquare, path: "/" },
  { id: "verify", label: "Verify", icon: ShieldCheck, path: "/verify" },
  { id: "about", label: "About proof", icon: Info, path: "/about" },
];

function currentAuditPath() {
  try {
    const context = JSON.parse(window.sessionStorage.getItem("fluxaudit.current-audit.v1"));
    return context?.taskId ? `/audit/${encodeURIComponent(context.taskId)}` : "/";
  } catch {
    return "/";
  }
}

export function Sidebar({ active, onNavigate }) {
  const auditPath = currentAuditPath();
  return (
    <aside className="sidebar" aria-label="Primary navigation">
      <button className="brand" onClick={() => onNavigate("/")} aria-label="FluxAudit home">
        <img src="/assets/fluxaudit-logo-lockup.png" alt="FluxAudit" />
      </button>

      <nav className="sidebar-nav">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const path = item.id === "audits" ? auditPath : item.path;
          const selected = active === item.id;
          return (
            <button
              key={item.id}
              className={`nav-item ${selected ? "is-active" : ""}`}
              onClick={() => onNavigate(path)}
              title={item.label}
            >
              <span className="nav-icon-plate">
                <Icon size={20} weight={selected ? "duotone" : "regular"} aria-hidden="true" />
              </span>
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="recent-runs">
        <div className="recent-label">RECENT</div>
        {auditPath === "/" ? <span className="recent-row"><StatusLed /><span>No audit in this session</span></span> : <button className="recent-row is-current" onClick={() => onNavigate(auditPath)}><StatusLed tone="active" /><span>Current audit</span></button>}
      </div>
    </aside>
  );
}

export function MobileNav({ active, onNavigate }) {
  const auditPath = currentAuditPath();
  return (
    <nav className="mobile-nav" aria-label="Mobile navigation">
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        const selected = active === item.id;
        return (
          <button
            key={item.id}
            className={selected ? "is-active" : ""}
            onClick={() => onNavigate(item.id === "audits" ? auditPath : item.path)}
          >
            <Icon size={21} weight={selected ? "duotone" : "regular"} aria-hidden="true" />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

export function AppShell({ active, onNavigate, children, className = "" }) {
  return (
    <div className={`app-shell ${className}`}>
      <Sidebar active={active} onNavigate={onNavigate} />
      <main className="main-viewport">{children}</main>
      <MobileNav active={active} onNavigate={onNavigate} />
    </div>
  );
}

export function Breadcrumbs({ items }) {
  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      {items.map((item, index) => (
        <span key={`${item}-${index}`}>
          {index > 0 && <span className="breadcrumb-separator">/</span>}
          {item}
        </span>
      ))}
    </nav>
  );
}

export function StatusLed({ tone = "muted", pulse = false }) {
  return <span className={`status-led tone-${tone} ${pulse ? "is-pulsing" : ""}`} aria-hidden="true" />;
}

export function StatusBadge({ tone = "muted", children }) {
  return <span className={`status-badge tone-${tone}`}>{children}</span>;
}

export function Panel({ children, className = "", as: Tag = "section", ...props }) {
  return <Tag className={`panel ${className}`} {...props}>{children}</Tag>;
}

export function PanelHeader({ title, meta, children }) {
  return (
    <div className="panel-header">
      <h2>{title}</h2>
      {meta && <span className="panel-meta">{meta}</span>}
      {children}
    </div>
  );
}

export function Button({
  children,
  icon: Icon,
  variant = "default",
  className = "",
  ...props
}) {
  return (
    <button className={`control-button variant-${variant} ${className}`} {...props}>
      {Icon && <span className="control-icon"><Icon size={18} weight="duotone" aria-hidden="true" /></span>}
      <span>{children}</span>
    </button>
  );
}

export function HashValue({ label, value, display, onInspect, compact = false }) {
  const shown = display || shortHash(value, compact ? 8 : 6, 4);
  return (
    <button
      className={`hash-value ${compact ? "is-compact" : ""}`}
      onClick={() => onInspect?.({ label, value })}
      title={`Inspect full ${label}`}
      aria-label={`${label}: ${value}. Open full value.`}
    >
      <code>{shown}</code>
      <Copy size={16} aria-hidden="true" />
    </button>
  );
}

export function DataRow({ label, children, icon: Icon, className = "", tone = "neutral" }) {
  return (
    <div className={`data-row tone-${tone} ${className}`}>
      <div className="data-row-label">
        {Icon && <span className="data-icon-plate"><Icon size={16} weight="duotone" aria-hidden="true" /></span>}
        <span>{label}</span>
      </div>
      <div className="data-row-value">{children}</div>
    </div>
  );
}

export function Modal({ open, title, children, onClose }) {
  const dialogRef = useRef(null);
  const closeButtonRef = useRef(null);
  const previousFocusRef = useRef(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useLayoutEffect(() => {
    if (!open) return undefined;
    previousFocusRef.current = document.activeElement;
    closeButtonRef.current?.focus();
    return () => previousFocusRef.current?.focus?.();
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current?.();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(dialogRef.current?.querySelectorAll(
        'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) || [])];
      if (!focusable.length) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        ref={dialogRef}
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <h2 id="modal-title">{title}</h2>
          <button ref={closeButtonRef} className="icon-button" onClick={onClose} aria-label="Close dialog">
            <X size={20} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

export function HashInspector({ inspected, onClose }) {
  const copy = async () => {
    if (inspected?.value) await navigator.clipboard?.writeText(inspected.value);
  };
  return (
    <Modal open={Boolean(inspected)} title={inspected?.label || "Full hash value"} onClose={onClose}>
      <p className="modal-helper">Full 66-character Ethereum value</p>
      <div className="full-hash-well">
        <code>{inspected?.value}</code>
      </div>
      <div className="modal-actions">
        <Button icon={Copy} onClick={copy}>Copy full value</Button>
        <Button variant="quiet" onClick={onClose}>Done</Button>
      </div>
    </Modal>
  );
}

export function ReadyMark({ children }) {
  return (
    <span className="ready-mark">
      <Check size={14} weight="bold" aria-hidden="true" />
      {children}
    </span>
  );
}

export function InlineLink({ children, onClick, external = false }) {
  return (
    <button className="inline-link" onClick={onClick}>
      <span>{children}</span>
      {external ? <ArrowSquareOut size={15} /> : <CaretRight size={15} />}
    </button>
  );
}

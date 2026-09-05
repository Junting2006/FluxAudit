const SUPPORTED_RISK_LEVELS = new Set(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);

function normalizeRiskLevel(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const normalized = value.trim().toUpperCase();
  return SUPPORTED_RISK_LEVELS.has(normalized) ? normalized : null;
}

function normalizeRiskScore(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100
    ? value
    : null;
}

export function presentRiskAssessment({
  failed = false,
  ready = false,
  locallyVerified = false,
  riskLevel,
  riskScore,
}) {
  if (failed) {
    return {
      level: "NOT ASSESSED",
      score: null,
      state: "failed",
      trusted: false,
      eyebrow: "Assessment status",
      detail: "Audit processing failed before a trustworthy risk assessment was produced.",
    };
  }

  const level = normalizeRiskLevel(riskLevel);
  const score = normalizeRiskScore(riskScore);
  if (!level || score === null) {
    return {
      level: ready ? "UNAVAILABLE" : "PENDING",
      score: null,
      state: ready ? "unavailable" : "pending",
      trusted: false,
      eyebrow: "Assessment status",
      detail: ready
        ? "The completed response did not include a supported risk level and integer score from 0 to 100."
        : "The final risk assessment is still pending.",
    };
  }

  if (!ready || !locallyVerified) {
    return {
      level,
      score,
      state: "unverified",
      trusted: false,
      eyebrow: "Claimed risk",
      detail: "The report contains this risk claim, but its complete seven-step proof has not passed local verification.",
    };
  }

  return {
    level,
    score,
    state: "trusted",
    trusted: true,
    eyebrow: "Final risk",
    detail: "Risk result from a report whose complete seven-step proof passed local verification.",
  };
}

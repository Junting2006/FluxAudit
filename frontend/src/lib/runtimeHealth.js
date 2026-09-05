export function getRuntimeReadiness(health, healthState) {
  const backendReachable = healthState === "healthy";
  const mockFallbackReady = health?.use_mock_data === true;
  const member3Connected = health?.member3_connected === true;
  const analysisReady = backendReachable && (mockFallbackReady || member3Connected);

  return {
    backendReachable,
    mockFallbackReady,
    member3Connected,
    analysisReady,
  };
}

export function runtimeLabel(health, healthState) {
  const readiness = getRuntimeReadiness(health, healthState);
  if (healthState === "checking") return "Checking backend";
  if (!readiness.backendReachable) return "Backend unavailable";
  if (readiness.member3Connected) {
    return `Member 3 connected · ${health.chain_agent_status || "chain mode pending"} chain`;
  }
  if (readiness.mockFallbackReady) return "Deterministic Mock fallback";
  if (!readiness.member3Connected) return "Member 3 unavailable · Mock disabled";
  return "Analysis runtime unavailable";
}

export function analysisEngineLabel(health, healthState) {
  const readiness = getRuntimeReadiness(health, healthState);
  if (healthState === "checking") return "Checking availability";
  if (!readiness.backendReachable) return "Status unknown · API unavailable";
  if (readiness.member3Connected) return "Member 3 connected";
  if (readiness.mockFallbackReady) return "Mock fallback enabled";
  return "Member 3 missing · Mock disabled";
}

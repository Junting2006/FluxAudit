const API_BASE = "/api/v1";

async function parseResponse(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload.detail || payload.message || `Request failed (${response.status})`;
    throw new Error(typeof message === "string" ? message : JSON.stringify(message));
  }
  return payload;
}

export async function checkBackendHealth(signal) {
  const response = await fetch(`${API_BASE}/health`, { signal });
  return parseResponse(response);
}

export async function startLiveAudit(input, signal) {
  const response = await fetch(`${API_BASE}/audit/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal,
  });
  return parseResponse(response);
}

export function streamLiveAudit(taskId, handlers) {
  const stream = new EventSource(`${API_BASE}/audit/stream/${taskId}`);
  const seenStepIndexes = new Set();

  stream.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (payload.event === "STEP") {
        const stepIndex = payload.log_entry?.step_index;
        if (seenStepIndexes.has(stepIndex)) return;
        seenStepIndexes.add(stepIndex);
        handlers.onStep?.(payload);
      } else if (payload.event === "COMPLETED") {
        handlers.onCompleted?.(payload);
        stream.close();
      } else if (payload.event === "FAILED") {
        handlers.onFailed?.(payload);
        stream.close();
      }
    } catch (error) {
      handlers.onFailed?.({ message: "Malformed SSE payload", cause: error });
    }
  };

  stream.onerror = () => handlers.onDisconnect?.();
  return () => stream.close();
}

export async function getLiveReport(taskId, signal) {
  const response = await fetch(`${API_BASE}/audit/report/${taskId}`, { signal });
  return parseResponse(response);
}

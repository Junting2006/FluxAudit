export function matchesTaskId(valueTaskId, routeTaskId) {
  return typeof routeTaskId === "string"
    && routeTaskId.length > 0
    && valueTaskId === routeTaskId;
}

export function isCurrentTaskRoute(routeSnapshot, expectedTaskId, expectedRoute = null) {
  return Boolean(
    routeSnapshot
    && matchesTaskId(routeSnapshot.taskId, expectedTaskId)
    && (expectedRoute === null || routeSnapshot.route === expectedRoute),
  );
}

export function scopeValueToTask(value, valueTaskId, routeTaskId, fallback = null) {
  return matchesTaskId(valueTaskId, routeTaskId) ? value : fallback;
}

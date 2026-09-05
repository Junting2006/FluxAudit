import assert from "node:assert/strict";
import test from "node:test";
import {
  isCurrentTaskRoute,
  matchesTaskId,
  scopeValueToTask,
} from "../src/lib/taskScope.js";

test("reports and contexts are exposed only to their exact route task", () => {
  const reportA = { task_id: "task_a" };
  const contextA = { taskId: "task_a", project: "Project A" };

  assert.equal(scopeValueToTask(reportA, reportA.task_id, "task_a"), reportA);
  assert.equal(scopeValueToTask(contextA, contextA.taskId, "task_a"), contextA);
  assert.equal(scopeValueToTask(reportA, reportA.task_id, "task_b"), null);
  assert.equal(scopeValueToTask(contextA, contextA.taskId, "task_b"), null);
});

test("empty or missing task identifiers never match", () => {
  assert.equal(matchesTaskId("", ""), false);
  assert.equal(matchesTaskId(null, null), false);
  assert.equal(matchesTaskId("task_a", null), false);
});

test("async task operations require the current task and expected route", () => {
  const snapshot = { route: "execution", taskId: "task_b" };
  assert.equal(isCurrentTaskRoute(snapshot, "task_b"), true);
  assert.equal(isCurrentTaskRoute(snapshot, "task_b", "execution"), true);
  assert.equal(isCurrentTaskRoute(snapshot, "task_a", "execution"), false);
  assert.equal(isCurrentTaskRoute(snapshot, "task_b", "report"), false);
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDailyTaskProgress,
  buildSevenDayTaskStats,
  createRecurrenceRule,
  formatTaskHistory,
  isTaskActionable,
  mergeTaskHistory,
  nextOccurrenceForRule,
  normalizeTaskEntry,
  reopenOccurrence,
  reconcileRecurringState,
  scheduledAtForOccurrence,
  stopRecurringSeries,
  taskMatchesFilters,
  type RecurrenceRule,
  type Task,
  type TaskHistoryEntry,
} from "./task-model.ts";

function localDate(year: number, month: number, day: number, hour = 0, minute = 0) {
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
}

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-test",
    title: "Test task",
    color: "orange",
    completed: false,
    createdAt: localDate(2026, 1, 1, 8),
    completedAt: null,
    important: false,
    category: null,
    recurrence: null,
    scheduledAt: null,
    occurrenceIndex: null,
    ...overrides,
  };
}

function history(entry: Task): TaskHistoryEntry {
  return { ...entry, createdAt: entry.createdAt ?? null, completedAt: entry.completedAt ?? null };
}

function recurringFixture() {
  const anchorAt = localDate(2026, 1, 10, 9);
  const recurrence = createRecurrenceRule("daily", anchorAt, "series-daily", 9 * 60, "Test/Local");
  const first = task({
    id: "occurrence-0",
    title: "Take vitamins",
    recurrence,
    scheduledAt: scheduledAtForOccurrence(recurrence, 0),
    occurrenceIndex: 0,
  });
  return { recurrence, first };
}

test("daily schedules follow local calendar boundaries instead of fixed 24-hour math", () => {
  const { recurrence } = recurringFixture();
  const tomorrow = scheduledAtForOccurrence(recurrence, 1);
  const date = new Date(tomorrow);
  assert.equal(date.getFullYear(), 2026);
  assert.equal(date.getMonth(), 0);
  assert.equal(date.getDate(), 11);
  assert.equal(date.getHours(), 9);
  assert.equal(date.getMinutes(), 0);
});

test("hourly schedules stay anchored when completion is late", () => {
  const anchorAt = localDate(2026, 1, 10, 9);
  const recurrence = createRecurrenceRule("hourly", anchorAt, "series-hourly");
  const lateNow = localDate(2026, 1, 10, 12, 35);
  const next = nextOccurrenceForRule(recurrence, 0, lateNow);
  assert.equal(next.occurrenceIndex, 1);
  assert.equal(next.nominalScheduledAt, anchorAt + 3_600_000);
  assert.equal(next.scheduledAt, lateNow);
  assert.equal(scheduledAtForOccurrence(recurrence, 3), anchorAt + (3 * 3_600_000));
});

test("missed periods carry one actionable occurrence and repeated reconciliation is idempotent", () => {
  const { recurrence, first } = recurringFixture();
  const completed = { ...first, completed: true, completedAt: localDate(2026, 1, 10, 9, 5) };
  const now = localDate(2026, 1, 14, 16);
  const firstPass = reconcileRecurringState([completed], [history(completed)], now, { idFactory: () => "occurrence-1" });
  const pending = firstPass.tasks.find((item) => !item.completed);
  assert.ok(pending);
  assert.equal(firstPass.tasks.filter((item) => !item.completed).length, 1);
  assert.equal(pending?.occurrenceIndex, 1);
  assert.equal(pending?.scheduledAt, now);
  assert.equal(isTaskActionable(pending as Task, now), true);

  const secondPass = reconcileRecurringState(firstPass.tasks, firstPass.history, now, { idFactory: () => "would-be-duplicate" });
  assert.deepEqual(secondPass.tasks, firstPass.tasks);
  assert.deepEqual(secondPass.history, firstPass.history);
});

test("reload normalization preserves recurrence fields and does not duplicate a pending occurrence", () => {
  const { recurrence, first } = recurringFixture();
  const completed = { ...first, completed: true, completedAt: localDate(2026, 1, 10, 9, 5) };
  const reconciled = reconcileRecurringState([completed], [history(completed)], localDate(2026, 1, 11, 12), { idFactory: () => "occurrence-1" });
  const reloadedTasks = reconciled.tasks.map((item, index) => normalizeTaskEntry(JSON.parse(JSON.stringify(item)), index)).filter((item): item is Task => Boolean(item));
  const reloadedHistory = reconciled.history.map((item, index) => normalizeTaskEntry(JSON.parse(JSON.stringify(item)), index)).filter((item): item is Task => Boolean(item)).map(history);
  const afterReload = reconcileRecurringState(reloadedTasks, reloadedHistory, localDate(2026, 1, 11, 12), { idFactory: () => "duplicate" });
  assert.equal(afterReload.tasks.filter((item) => !item.completed && item.recurrence?.seriesId === recurrence.seriesId).length, 1);
  assert.equal(afterReload.tasks.filter((item) => item.id === "occurrence-1").length, 1);
});

test("DST calendar construction keeps the intended local date and documents the native Date rule", () => {
  const anchorAt = localDate(2026, 3, 7, 9);
  const recurrence = createRecurrenceRule("daily", anchorAt, "series-dst", 2 * 60 + 30, "Test/Local");
  const springBoundary = new Date(scheduledAtForOccurrence(recurrence, 1));
  assert.equal(springBoundary.getFullYear(), 2026);
  assert.equal(springBoundary.getMonth(), 2);
  assert.equal(springBoundary.getDate(), 8);
  assert.ok(springBoundary.getHours() === 2 || springBoundary.getHours() === 3);
  assert.equal(recurrence.timezone, "Test/Local");
});

test("timezone changes keep daily recurrence on the current device wall clock", () => {
  const anchorAt = localDate(2026, 6, 1, 8);
  const original = createRecurrenceRule("daily", anchorAt, "series-timezone", 8 * 60, "America/Los_Angeles");
  const moved = { ...original, timezone: "Europe/Berlin" };
  const originalDate = new Date(scheduledAtForOccurrence(original, 2));
  const movedDate = new Date(scheduledAtForOccurrence(moved, 2));
  assert.equal(movedDate.getFullYear(), originalDate.getFullYear());
  assert.equal(movedDate.getMonth(), originalDate.getMonth());
  assert.equal(movedDate.getDate(), originalDate.getDate());
  assert.equal(movedDate.getHours(), 8);
  assert.equal(movedDate.getMinutes(), 0);
});

test("a corrected clock changes due status without shifting the anchored hourly slot", () => {
  const anchorAt = localDate(2026, 6, 1, 8);
  const recurrence = createRecurrenceRule("hourly", anchorAt, "series-clock");
  const beforeSlot = nextOccurrenceForRule(recurrence, 0, localDate(2026, 6, 1, 8, 30));
  const afterSlot = nextOccurrenceForRule(recurrence, 0, localDate(2026, 6, 1, 10, 30));
  assert.equal(beforeSlot.scheduledAt, anchorAt + 3_600_000);
  assert.equal(afterSlot.scheduledAt, localDate(2026, 6, 1, 10, 30));
  assert.equal(afterSlot.nominalScheduledAt, anchorAt + 3_600_000);
});

test("legacy tasks migrate as one-off records with safe defaults", () => {
  const migrated = normalizeTaskEntry({ id: "legacy", title: "Same title", completed: false }, 0);
  assert.ok(migrated);
  assert.equal(migrated?.recurrence, null);
  assert.equal(migrated?.scheduledAt, null);
  assert.equal(migrated?.occurrenceIndex, null);
  assert.equal(migrated?.important, false);
  assert.equal(migrated?.category, null);
});

test("same-title occurrences retain distinct identity and permanent completion history", () => {
  const { recurrence, first } = recurringFixture();
  const second = task({
    id: "occurrence-1",
    title: first.title,
    completed: true,
    completedAt: localDate(2026, 1, 11, 9, 3),
    recurrence,
    scheduledAt: scheduledAtForOccurrence(recurrence, 1),
    occurrenceIndex: 1,
  });
  const entries = mergeTaskHistory([], [
    { ...first, completed: true, completedAt: localDate(2026, 1, 10, 9, 2) },
    second,
  ], localDate(2026, 1, 11, 10));
  assert.equal(entries.filter((entry) => entry.title === "Take vitamins").length, 2);
  assert.deepEqual(new Set(entries.map((entry) => entry.id)), new Set(["occurrence-0", "occurrence-1"]));
});

test("reopening an older occurrence removes only the pending successor and preserves later DONE records", () => {
  const { recurrence, first } = recurringFixture();
  const laterDone = task({
    id: "occurrence-2",
    title: first.title,
    completed: true,
    completedAt: localDate(2026, 1, 12, 9, 1),
    recurrence,
    scheduledAt: scheduledAtForOccurrence(recurrence, 2),
    occurrenceIndex: 2,
  });
  const successor = task({
    id: "occurrence-3",
    title: first.title,
    recurrence,
    scheduledAt: scheduledAtForOccurrence(recurrence, 3),
    occurrenceIndex: 3,
  });
  const olderDone = { ...first, completed: true, completedAt: localDate(2026, 1, 10, 9, 1) };
  const result = reopenOccurrence(
    [olderDone, laterDone, successor],
    [history(olderDone), history(laterDone), history(successor)],
    olderDone.id,
    localDate(2026, 1, 13, 10),
  );
  assert.deepEqual(result.tasks.filter((item) => !item.completed).map((item) => item.id), [olderDone.id]);
  assert.equal(result.tasks.find((item) => item.id === "occurrence-2")?.completed, true);
  assert.equal(result.history.some((entry) => entry.id === "occurrence-3"), false);
});

test("stopping and removing a recurring series cannot resurrect it on reconciliation", () => {
  const { first } = recurringFixture();
  const stopped = stopRecurringSeries([first], [history(first)], "series-daily", first.id, localDate(2026, 1, 10, 10));
  const kept = stopped.tasks.find((item) => item.id === first.id);
  assert.equal(kept?.recurrence, null);
  assert.equal(kept?.scheduledAt, null);
  const historyEntry = stopped.history.find((entry) => entry.id === first.id);
  assert.equal(historyEntry?.recurrence?.active, false);

  const removed = stopRecurringSeries([first], [history(first)], "series-daily", null, localDate(2026, 1, 10, 10));
  const afterRemoveAll = reconcileRecurringState([], removed.history, localDate(2026, 1, 20, 10), { idFactory: () => "unexpected" });
  assert.equal(afterRemoveAll.tasks.length, 0);
});

test("filters, today's progress, seven-day stats, and export keep the new fields visible", () => {
  const now = localDate(2026, 1, 15, 12);
  const rule: RecurrenceRule = createRecurrenceRule("daily", localDate(2026, 1, 15, 8), "series-filter", 8 * 60, "Test/Local");
  const doneToday = task({ id: "done-today", createdAt: now, completed: true, completedAt: localDate(2026, 1, 15, 9), important: true, category: "HOME", recurrence: rule, scheduledAt: localDate(2026, 1, 15, 8), occurrenceIndex: 0 });
  const ready = task({ id: "ready", category: "HOME", createdAt: now });
  const future = task({ id: "future", createdAt: now, scheduledAt: localDate(2026, 1, 15, 20) });
  const entries = [history(doneToday), history(ready), history(future)];
  assert.equal(taskMatchesFilters(doneToday, { importantOnly: true, category: "HOME" }), true);
  assert.equal(taskMatchesFilters(ready, { repeatingOnly: true }), false);
  const progress = buildDailyTaskProgress([doneToday, ready, future], entries, now);
  assert.deepEqual(progress, { completedToday: 1, ready: 1, denominator: 2, percentage: 50 });
  const stats = buildSevenDayTaskStats(entries, now);
  const today = stats[stats.length - 1];
  assert.equal(today.added, 3);
  assert.equal(today.completed, 1);
  const exported = formatTaskHistory(entries, now);
  assert.match(exported, /IMPORTANT: YES/);
  assert.match(exported, /CATEGORY: HOME/);
  assert.match(exported, /SERIES ID: series-filter/);
  assert.match(exported, /SCHEDULED FOR:/);
});

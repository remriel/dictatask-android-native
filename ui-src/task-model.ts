export type TaskColor = "orange" | "blue" | "cyan" | "lime" | "violet";

export type RepeatFrequency = "daily" | "hourly";
export type RepeatSelection = "none" | RepeatFrequency;

export type RecurrenceRule = {
  seriesId: string;
  frequency: RepeatFrequency;
  anchorAt: number;
  timeOfDayMinutes: number | null;
  timezone: string;
  active: boolean;
};

export type Task = {
  id: string;
  title: string;
  color: TaskColor;
  completed: boolean;
  createdAt?: number | null;
  completedAt?: number | null;
  historyOnly?: boolean;
  important?: boolean;
  category?: string | null;
  recurrence?: RecurrenceRule | null;
  scheduledAt?: number | null;
  occurrenceIndex?: number | null;
};

export type TaskHistoryEntry = Task & {
  createdAt: number | null;
  completedAt: number | null;
};

export type RecurrenceState = {
  tasks: Task[];
  history: TaskHistoryEntry[];
};

export type TaskFilters = {
  query?: string;
  importantOnly?: boolean;
  repeatingOnly?: boolean;
  category?: string;
};

export type DailyTaskProgress = {
  completedToday: number;
  ready: number;
  denominator: number;
  percentage: number;
};

export type DailyTaskStat = {
  dayNumber: number;
  dayLabel: string;
  dateLabel: string;
  added: number;
  completed: number;
};

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MAX_TIME_OF_DAY_MINUTES = 23 * 60 + 59;
const fallbackColors: TaskColor[] = ["orange", "blue", "cyan", "lime", "violet"];
const colorAliases: Record<string, TaskColor> = {
  orange: "orange",
  rust: "orange",
  tangerine: "orange",
  amber: "orange",
  brick: "orange",
  red: "orange",
  coral: "orange",
  crimson: "orange",
  pink: "orange",
  magenta: "orange",
  blue: "blue",
  cobalt: "blue",
  navy: "blue",
  cyan: "cyan",
  teal: "cyan",
  aqua: "cyan",
  lime: "lime",
  green: "lime",
  mint: "lime",
  forest: "lime",
  violet: "violet",
  purple: "violet",
  lavender: "violet",
};

function stableColorIndex(seed: string) {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = ((hash << 5) - hash + seed.charCodeAt(index)) | 0;
  }
  return Math.abs(hash) % fallbackColors.length;
}

function normalizeColor(value: unknown, seed: string, index: number): TaskColor {
  const token = typeof value === "string" ? value.trim().toLowerCase() : "";
  return colorAliases[token] ?? fallbackColors[seed ? stableColorIndex(seed) : index % fallbackColors.length];
}

function localTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "local";
  } catch {
    return "local";
  }
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function positiveInteger(value: unknown) {
  const number = finiteNumber(value);
  return number !== null && number >= 0 ? Math.floor(number) : null;
}

function normalizeCategory(value: unknown) {
  if (typeof value !== "string") return null;
  const category = value.trim().replace(/\s+/g, " ");
  return category ? category.slice(0, 32) : null;
}

function getLocalMinutes(timestamp: number) {
  const date = new Date(timestamp);
  return date.getHours() * 60 + date.getMinutes();
}

function normalizeTimeOfDay(value: unknown, fallback: number) {
  const number = finiteNumber(value);
  if (number === null) return Math.max(0, Math.min(MAX_TIME_OF_DAY_MINUTES, Math.round(fallback)));
  return Math.max(0, Math.min(MAX_TIME_OF_DAY_MINUTES, Math.round(number)));
}

function normalizeRecurrence(value: unknown, entry: Record<string, unknown>, fallbackSeed: string): RecurrenceRule | null {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : null;
  const frequencyValue = record?.frequency ?? entry.repeatFrequency ?? entry.repeat;
  const frequency = frequencyValue === "daily" || frequencyValue === "hourly" ? frequencyValue : null;
  if (!frequency) return null;

  const anchorAt = finiteNumber(record?.anchorAt ?? entry.repeatAnchorAt) ?? finiteNumber(entry.scheduledAt) ?? Date.now();
  const seriesIdValue = record?.seriesId ?? entry.seriesId;
  const seriesId = typeof seriesIdValue === "string" && seriesIdValue.trim()
    ? seriesIdValue.trim()
    : `series-${fallbackSeed}`;
  const timeOfDayMinutes = frequency === "daily"
    ? normalizeTimeOfDay(record?.timeOfDayMinutes ?? entry.repeatTimeMinutes, getLocalMinutes(anchorAt))
    : null;
  const timezone = typeof record?.timezone === "string" && record.timezone.trim()
    ? record.timezone.trim()
    : localTimezone();

  return {
    seriesId,
    frequency,
    anchorAt,
    timeOfDayMinutes,
    timezone,
    active: record?.active !== false,
  };
}

export function normalizeTaskEntry(value: unknown, index: number): Task | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Record<string, unknown>;
  const title = typeof entry.title === "string" ? entry.title.trim() : "";
  if (!title) return null;

  const id = typeof entry.id === "string" && entry.id.trim()
    ? entry.id.trim()
    : `legacy-task-${index}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
  const createdAt = finiteNumber(entry.createdAt);
  const completedAt = finiteNumber(entry.completedAt);
  const recurrence = normalizeRecurrence(entry.recurrence, entry, `${id}:${title}`);
  const scheduledAt = finiteNumber(entry.scheduledAt);
  const occurrenceIndex = positiveInteger(entry.occurrenceIndex);

  return {
    id,
    title,
    color: normalizeColor(entry.color, `${id}:${title}`, index),
    completed: entry.completed === true,
    createdAt,
    completedAt,
    historyOnly: entry.historyOnly === true ? true : undefined,
    important: entry.important === true,
    category: normalizeCategory(entry.category),
    recurrence,
    scheduledAt: recurrence ? scheduledAt : null,
    occurrenceIndex: recurrence ? occurrenceIndex ?? 0 : null,
  };
}

function cloneTask(task: Task): Task {
  return {
    ...task,
    recurrence: task.recurrence ? { ...task.recurrence } : null,
  };
}

function cloneHistoryEntry(entry: TaskHistoryEntry): TaskHistoryEntry {
  return cloneTask(entry) as TaskHistoryEntry;
}

export function normalizeTaskHistoryEntry(value: unknown, index: number): TaskHistoryEntry | null {
  const task = normalizeTaskEntry(value, index);
  if (!task || !value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  return {
    ...task,
    createdAt: finiteNumber(record.createdAt),
    completedAt: finiteNumber(record.completedAt),
  };
}

export function normalizeTaskList(value: unknown, fallback: Task[]): Task[] {
  if (!Array.isArray(value)) return fallback.map(cloneTask);
  return value.flatMap((entry, index) => {
    const task = normalizeTaskEntry(entry, index);
    return task ? [task] : [];
  });
}

export function normalizeTaskHistoryList(value: unknown, fallback: TaskHistoryEntry[]): TaskHistoryEntry[] {
  if (!Array.isArray(value)) return fallback.map(cloneHistoryEntry);
  return value.flatMap((entry, index) => {
    const task = normalizeTaskHistoryEntry(entry, index);
    return task ? [task] : [];
  });
}

export function isActiveRecurrence(task: Task): task is Task & { recurrence: RecurrenceRule } {
  return Boolean(task.recurrence?.active);
}

export function isTaskActionable(task: Task, now: number) {
  return !task.completed && (!Number.isFinite(task.scheduledAt ?? NaN) || (task.scheduledAt as number) <= now);
}

export function taskMatchesFilters(task: Task, filters: TaskFilters) {
  const query = filters.query?.trim().toLocaleLowerCase() ?? "";
  if (query && !task.title.toLocaleLowerCase().includes(query)) return false;
  if (filters.importantOnly && task.important !== true) return false;
  if (filters.repeatingOnly && !task.recurrence) return false;
  if (filters.category && (task.category ?? "") !== filters.category) return false;
  return true;
}

function startOfLocalDay(timestamp: number) {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function isSameLocalDay(left: number, right: number) {
  return startOfLocalDay(left) === startOfLocalDay(right);
}

export function getLocalDayNumber(timestamp: number) {
  const date = new Date(timestamp);
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS;
}

export function buildSevenDayTaskStats(entries: TaskHistoryEntry[], now: number): DailyTaskStat[] {
  const today = new Date(now);
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const stats = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(todayStart.getFullYear(), todayStart.getMonth(), todayStart.getDate() - (6 - index));
    return {
      dayNumber: getLocalDayNumber(date.getTime()),
      dayLabel: date.toLocaleDateString(undefined, { weekday: "short" }).toUpperCase(),
      dateLabel: date.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      added: 0,
      completed: 0,
    };
  });
  const byDayNumber = new Map(stats.map((stat) => [stat.dayNumber, stat]));

  entries.forEach((entry) => {
    if (typeof entry.createdAt === "number" && Number.isFinite(entry.createdAt)) {
      const stat = byDayNumber.get(getLocalDayNumber(entry.createdAt));
      if (stat) stat.added += 1;
    }
    if (typeof entry.completedAt === "number" && Number.isFinite(entry.completedAt)) {
      const stat = byDayNumber.get(getLocalDayNumber(entry.completedAt));
      if (stat) stat.completed += 1;
    }
  });

  return stats;
}

export function buildDailyTaskProgress(tasks: Task[], history: TaskHistoryEntry[], now: number): DailyTaskProgress {
  const completionIds = new Set<string>();
  history.forEach((entry) => {
    if (typeof entry.completedAt === "number" && isSameLocalDay(entry.completedAt, now)) completionIds.add(entry.id);
  });
  tasks.forEach((task) => {
    if (task.completed && typeof task.completedAt === "number" && isSameLocalDay(task.completedAt, now)) completionIds.add(task.id);
  });

  const completedToday = completionIds.size;
  const ready = tasks.filter((task) => isTaskActionable(task, now)).length;
  const denominator = completedToday + ready;
  return {
    completedToday,
    ready,
    denominator,
    percentage: denominator ? Math.round((completedToday / denominator) * 100) : 0,
  };
}

function localDateForIndex(anchorAt: number, occurrenceIndex: number) {
  const anchor = new Date(anchorAt);
  return new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + occurrenceIndex);
}

export function makeLocalDateTime(date: Date, minutes: number) {
  const safeMinutes = Math.max(0, Math.min(MAX_TIME_OF_DAY_MINUTES, Math.round(minutes)));
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    Math.floor(safeMinutes / 60),
    safeMinutes % 60,
    0,
    0,
  ).getTime();
}

export function scheduledAtForOccurrence(rule: RecurrenceRule, occurrenceIndex: number) {
  const index = Math.max(0, Math.floor(occurrenceIndex));
  if (rule.frequency === "hourly") return rule.anchorAt + (index * HOUR_MS);
  return makeLocalDateTime(localDateForIndex(rule.anchorAt, index), rule.timeOfDayMinutes ?? getLocalMinutes(rule.anchorAt));
}

export function nextOccurrenceForRule(rule: RecurrenceRule, latestIndex: number | null, now: number) {
  const occurrenceIndex = Math.max(0, (latestIndex ?? -1) + 1);
  const nominalScheduledAt = scheduledAtForOccurrence(rule, occurrenceIndex);
  return {
    occurrenceIndex,
    nominalScheduledAt,
    // A late return to the app carries one missed period forward as one
    // actionable task. The index remains anchored to the original cadence.
    scheduledAt: nominalScheduledAt <= now ? now : nominalScheduledAt,
  };
}

export function createRecurrenceRule(
  frequency: RepeatFrequency,
  scheduledAt: number,
  seriesId: string,
  timeOfDayMinutes: number | null = null,
  timezone = localTimezone(),
): RecurrenceRule {
  return {
    seriesId,
    frequency,
    anchorAt: scheduledAt,
    timeOfDayMinutes: frequency === "daily"
      ? normalizeTimeOfDay(timeOfDayMinutes, getLocalMinutes(scheduledAt))
      : null,
    timezone,
    active: true,
  };
}

export function mergeTaskHistory(current: TaskHistoryEntry[], tasks: Task[], now: number): TaskHistoryEntry[] {
  const byId = new Map<string, TaskHistoryEntry>();
  current.forEach((entry) => byId.set(entry.id, cloneHistoryEntry(entry)));

  tasks.forEach((task) => {
    const previous = byId.get(task.id);
    const completedAt = task.completed
      ? task.completedAt ?? (previous?.completed ? previous.completedAt ?? now : now)
      : null;
    byId.set(task.id, {
      ...cloneTask(task),
      createdAt: task.createdAt ?? previous?.createdAt ?? now,
      completedAt,
    });
  });

  return Array.from(byId.values()).sort((left, right) => (
    (right.completedAt ?? 0) - (left.completedAt ?? 0)
    || (right.createdAt ?? 0) - (left.createdAt ?? 0)
    || left.id.localeCompare(right.id)
  ));
}

function formatHistoryDate(timestamp: number | null) {
  return timestamp ? new Date(timestamp).toLocaleString() : "Not recorded";
}

export function formatTaskHistory(entries: TaskHistoryEntry[], exportedAt = Date.now()) {
  const sortedEntries = [...entries].sort((left, right) => (
    (left.createdAt ?? 0) - (right.createdAt ?? 0)
    || left.id.localeCompare(right.id)
  ));
  return [
    "DICTATASK TASK HISTORY",
    `EXPORTED: ${new Date(exportedAt).toLocaleString()}`,
    `TOTAL RECORDS: ${sortedEntries.length}`,
    "",
    ...sortedEntries.map((task, index) => [
      `${index + 1}. [${task.completed ? "DONE" : "OPEN"}] ${task.title}`,
      `   CREATED: ${formatHistoryDate(task.createdAt)}`,
      `   COMPLETED: ${formatHistoryDate(task.completedAt)}`,
      `   IMPORTANT: ${task.important ? "YES" : "NO"}`,
      `   CATEGORY: ${task.category ?? "Unassigned"}`,
      `   REPEATING: ${task.recurrence ? `${task.recurrence.frequency.toUpperCase()} / ${task.recurrence.active ? "ACTIVE" : "STOPPED"}` : "OFF"}`,
      `   SERIES ID: ${task.recurrence?.seriesId ?? "None"}`,
      `   SCHEDULED FOR: ${formatHistoryDate(task.scheduledAt ?? null)}`,
      `   OCCURRENCE: ${task.occurrenceIndex === null || task.occurrenceIndex === undefined ? "None" : task.occurrenceIndex + 1}`,
      "",
    ].join("\n")),
  ].join("\n");
}

function occurrenceSort(left: Task, right: Task) {
  return (
    (left.occurrenceIndex ?? -1) - (right.occurrenceIndex ?? -1)
    || (left.scheduledAt ?? left.createdAt ?? 0) - (right.scheduledAt ?? right.createdAt ?? 0)
    || left.id.localeCompare(right.id)
  );
}

function uniqueActiveSeries(tasks: Task[]) {
  const series = new Map<string, RecurrenceRule>();
  tasks.forEach((task) => {
    if (isActiveRecurrence(task)) series.set(task.recurrence.seriesId, task.recurrence);
  });
  return series;
}

function makeOccurrenceId(rule: RecurrenceRule, occurrenceIndex: number, now: number, usedIds: Set<string>, idFactory?: () => string) {
  let id = idFactory?.() ?? `occurrence-${rule.seriesId}-${occurrenceIndex}-${now}-${Math.random().toString(16).slice(2)}`;
  while (usedIds.has(id)) id = `${id}-${Math.random().toString(16).slice(2)}`;
  return id;
}

export function reconcileRecurringState(
  inputTasks: Task[],
  inputHistory: TaskHistoryEntry[],
  now: number,
  options: { idFactory?: () => string } = {},
): RecurrenceState {
  let tasks = inputTasks.map(cloneTask);
  const history = inputHistory.map(cloneHistoryEntry);
  const usedIds = new Set([...tasks, ...history].map((task) => task.id));

  for (const [seriesId, rule] of uniqueActiveSeries(tasks)) {
    const seriesTasks = tasks.filter((task) => task.recurrence?.seriesId === seriesId);
    const pending = seriesTasks
      .filter((task) => !task.completed)
      .sort((left, right) => (
        (left.scheduledAt ?? 0) - (right.scheduledAt ?? 0)
        || (left.createdAt ?? 0) - (right.createdAt ?? 0)
        || left.id.localeCompare(right.id)
      ));

    if (pending.length > 1) {
      const keepId = pending[0].id;
      tasks = tasks.filter((task) => task.recurrence?.seriesId !== seriesId || task.completed || task.id === keepId);
    }
    if (pending.length) continue;

    const allOccurrences = [...tasks, ...history]
      .filter((task) => task.recurrence?.seriesId === seriesId)
      .sort(occurrenceSort);
    const latest = allOccurrences[allOccurrences.length - 1];
    const latestIndex = allOccurrences.reduce<number | null>((highest, task) => (
      task.occurrenceIndex === null || task.occurrenceIndex === undefined
        ? highest
        : Math.max(highest ?? -1, task.occurrenceIndex)
    ), null);
    const next = nextOccurrenceForRule(rule, latestIndex, now);
    const source = latest ?? seriesTasks[seriesTasks.length - 1];
    if (!source) continue;

    const occurrence: Task = {
      id: makeOccurrenceId(rule, next.occurrenceIndex, now, usedIds, options.idFactory),
      title: source.title,
      color: source.color,
      completed: false,
      createdAt: now,
      completedAt: null,
      important: source.important === true,
      category: source.category ?? null,
      recurrence: { ...rule, active: true },
      scheduledAt: next.scheduledAt,
      occurrenceIndex: next.occurrenceIndex,
    };
    usedIds.add(occurrence.id);
    tasks = [...tasks, occurrence];
  }

  return {
    tasks,
    history: mergeTaskHistory(history, tasks, now),
  };
}

export function stopRecurringSeries(
  inputTasks: Task[],
  inputHistory: TaskHistoryEntry[],
  seriesId: string,
  keepTaskId: string | null,
  now: number,
): RecurrenceState {
  const stoppedRules = new Map<string, RecurrenceRule>();
  const stopRule = (rule: RecurrenceRule) => {
    const stopped = { ...rule, active: false };
    stoppedRules.set(rule.seriesId, stopped);
    return stopped;
  };
  const tasks = inputTasks.map((task) => {
    if (task.recurrence?.seriesId !== seriesId) return cloneTask(task);
    const stopped = stopRule(task.recurrence);
    if (task.id === keepTaskId && !task.completed) {
      return {
        ...cloneTask(task),
        recurrence: null,
        scheduledAt: null,
        occurrenceIndex: null,
      };
    }
    return { ...cloneTask(task), recurrence: stopped };
  });
  const history = inputHistory.map((entry) => {
    if (entry.recurrence?.seriesId !== seriesId) return cloneHistoryEntry(entry);
    return { ...cloneHistoryEntry(entry), recurrence: stopRule(entry.recurrence) };
  });
  const mergedHistory = mergeTaskHistory(history, tasks, now);
  if (keepTaskId) {
    const stopped = stoppedRules.get(seriesId);
    if (stopped) {
      return {
        tasks,
        history: mergedHistory.map((entry) => entry.id === keepTaskId
          ? { ...entry, recurrence: stopped }
          : entry),
      };
    }
  }
  return { tasks, history: mergedHistory };
}

export function reopenOccurrence(
  inputTasks: Task[],
  inputHistory: TaskHistoryEntry[],
  occurrenceId: string,
  now: number,
): RecurrenceState {
  const original = inputTasks.find((task) => task.id === occurrenceId)
    ?? inputHistory.find((entry) => entry.id === occurrenceId);
  if (!original) return { tasks: inputTasks.map(cloneTask), history: inputHistory.map(cloneHistoryEntry) };

  const seriesId = original.recurrence?.seriesId ?? null;
  const removedSuccessorIds = new Set<string>();
  let tasks = inputTasks.map((task) => {
    if (seriesId && task.recurrence?.seriesId === seriesId && !task.completed && task.id !== occurrenceId) {
      removedSuccessorIds.add(task.id);
      return null;
    }
    if (task.id !== occurrenceId) return cloneTask(task);
    const recurrence = task.recurrence?.active === false
      ? { ...task.recurrence, active: true }
      : task.recurrence;
    return { ...cloneTask(task), completed: false, completedAt: null, historyOnly: false, recurrence };
  }).filter((task): task is Task => Boolean(task));

  if (!tasks.some((task) => task.id === occurrenceId)) {
    const recurrence = original.recurrence?.active === false
      ? { ...original.recurrence, active: true }
      : original.recurrence;
    tasks = [...tasks, {
      ...cloneTask(original),
      completed: false,
      completedAt: null,
      historyOnly: false,
      recurrence,
    }];
  }

  const history = inputHistory.filter((entry) => entry.id !== occurrenceId && !removedSuccessorIds.has(entry.id));
  return { tasks, history: mergeTaskHistory(history, tasks, now) };
}

export function formatRecurrenceLabel(task: Task, now: number) {
  const rule = task.recurrence;
  if (!rule) return "";
  const frequency = rule.frequency === "daily" ? "DAILY" : "HOURLY";
  const detail = rule.frequency === "daily"
    ? new Date(scheduledAtForOccurrence(rule, task.occurrenceIndex ?? 0)).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : "FIXED 1-HOUR SLOTS";
  const due = task.completed ? "COMPLETED" : task.scheduledAt && task.scheduledAt <= now ? "DUE NOW" : task.scheduledAt
    ? `NEXT ${new Date(task.scheduledAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
    : "SCHEDULED";
  return `${frequency} · ${detail} · ${due}`;
}

export function getNextRecurrenceBoundary(tasks: Task[], now: number) {
  const future = tasks
    .filter((task) => isActiveRecurrence(task) && !task.completed && typeof task.scheduledAt === "number" && task.scheduledAt > now)
    .map((task) => task.scheduledAt as number);
  return future.length ? Math.min(...future) : null;
}

export const recurrenceConstants = {
  DAY_MS,
  HOUR_MS,
};

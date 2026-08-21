"use client";

import type { CSSProperties, FormEvent } from "react";
import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

type TaskColor = "orange" | "blue" | "cyan" | "lime" | "violet";
type Filter = "open" | "done";
type Theme = "midnight" | "paper";
type CelebrationVariant = "burst" | "stamp" | "jackpot" | "massacre";

type WheelSettings = {
  durationMinutes: number;
};

type FocusEntry = "wheel" | "direct";

type WheelChallenge = {
  taskId: string;
  startedAt: number;
  durationSeconds: number;
  expired: boolean;
  source: FocusEntry;
};

type WheelPhase = "list" | "converging" | "wheel" | "spinning" | "challenge" | "complete";

type Task = {
  id: string;
  title: string;
  color: TaskColor;
  completed: boolean;
  createdAt?: number | null;
  completedAt?: number | null;
  historyOnly?: boolean;
};

type TaskHistoryEntry = Task & {
  createdAt: number | null;
  completedAt: number | null;
};

type UndoCompletion = {
  id: string;
  title: string;
  previousHistory: TaskHistoryEntry | null;
  wasDismissed: boolean;
};

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort?: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string };
  }>;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
    DictaTaskAndroid?: {
      startRecognition?: () => void;
      stopRecognition?: () => void;
      abortRecognition?: () => void;
      getStoredState?: (key: string) => string;
      setStoredState?: (key: string, raw: string) => void;
      exportTaskHistory?: (contents: string) => void;
      setColorScheme?: (scheme: "dark" | "light") => void;
    };
  }
}

const starterTranscript =
  "I need to text Mom the dentist appointment time, call the pharmacy before 5, send Weston the apartment photos, and buy toothpaste on the way home. Also remember to review the Qcells job description tonight.";

const starterTasks: Task[] = [
  {
    id: "task-1",
    title: "Text Mom the dentist appointment time",
    color: "orange",
    completed: false,
  },
  {
    id: "task-2",
    title: "Call the pharmacy before 5",
    color: "blue",
    completed: false,
  },
  {
    id: "task-3",
    title: "Send Weston the apartment photos",
    color: "cyan",
    completed: true,
  },
  {
    id: "task-4",
    title: "Buy toothpaste on the way home",
    color: "lime",
    completed: false,
  },
  {
    id: "task-5",
    title: "Review the Qcells job description tonight",
    color: "violet",
    completed: false,
  },
];

const starterTaskHistory: TaskHistoryEntry[] = starterTasks.map((task) => ({
  ...task,
  createdAt: null,
  completedAt: null,
}));

const taskVerbPattern = "(?:call|text|email|send|buy|pick up|book|schedule|finish|submit|pay|check|review|ask|take|bring|set up|clean|upload|download|follow up|order|make|research|plan|confirm|renew|return|cancel|update|create|write|meet|visit|go to|message|remind|tell|complete|apply|look up|pack|prepare|fix|contact|reply|wash|do|drive|leave|get|feed|cook|eat|read|watch|start|stop|go)";
const actionWords = new RegExp(`\\b${taskVerbPattern}\\b`, "i");
const taskLeadPattern = "(?:i|we)\\s+(?:need to|have to|should|must|want to|can|need|have)";

const colors: TaskColor[] = ["orange", "blue", "cyan", "lime", "violet"];
const taskColorAliases: Record<string, TaskColor> = {
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
const RECORDING_LIMIT_SECONDS = 30;
const RECOGNITION_RESTART_DELAY_MS = 350;
const MAX_HISTORY_RECORDS = 500;
const EMPTY_STRING_ARRAY: string[] = [];
const TASK_AGE_REFRESH_PADDING_MS = 250;
const WHEEL_DURATION_OPTIONS = [5, 10, 15, 25] as const;
const WHEEL_CONVERGE_DURATION_MS = 560;
const WHEEL_SPIN_DURATION_MS = 3000;
const WHEEL_TASK_COLOR_VARIABLES: Record<TaskColor, string> = {
  orange: "var(--task-tile-orange-shadow)",
  blue: "var(--task-tile-blue-shadow)",
  cyan: "var(--task-tile-cyan-shadow)",
  lime: "var(--task-tile-lime-shadow)",
  violet: "var(--task-tile-violet-shadow)",
};
const defaultWheelSettings: WheelSettings = {
  durationMinutes: 10,
};
const confettiPieces = Array.from({ length: 20 }, (_, index) => ({
  left: `${-8 + ((index * 29) % 116)}vw`,
  x: `${((index * 43) % 160) - 80}vw`,
  y: `${72 + ((index * 17) % 32)}vh`,
  spin: `${(index % 2 === 0 ? 1 : -1) * (280 + ((index * 59) % 360))}deg`,
  delay: `${(index % 10) * 22}ms`,
  width: `${8 + (index % 4) * 3}px`,
  height: `${12 + (index % 3) * 5}px`,
}));

const storageListeners = new Map<string, Set<() => void>>();
const storageSnapshots = new Map<string, { raw: string | null; value: unknown }>();
const nativeRawSnapshots = new Map<string, string | null>();
const memoryValues = new Map<string, unknown>();

function getStorage() {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function getNativeStoredRaw(key: string) {
  if (typeof window === "undefined") return null;
  if (nativeRawSnapshots.has(key)) return nativeRawSnapshots.get(key) ?? null;
  try {
    const raw = window.DictaTaskAndroid?.getStoredState?.(key);
    const normalized = raw || null;
    nativeRawSnapshots.set(key, normalized);
    return normalized;
  } catch {
    return null;
  }
}

function setNativeStoredRaw(key: string, raw: string) {
  nativeRawSnapshots.set(key, raw);
  try {
    window.DictaTaskAndroid?.setStoredState?.(key, raw);
  } catch {
    // The browser fallback remains the source of truth outside Android.
  }
}

function readStoredValue<T>(key: string, fallback: T) {
  if (typeof window === "undefined") return fallback;
  const storage = getStorage();
  const isNative = typeof window.DictaTaskAndroid?.getStoredState === "function";
  const nativeRaw = isNative ? getNativeStoredRaw(key) : null;
  if (!storage && !nativeRaw && memoryValues.has(key)) return memoryValues.get(key) as T;
  const raw = nativeRaw ?? storage?.getItem(key) ?? null;
  const cached = storageSnapshots.get(key);
  if (cached?.raw === raw) return cached.value as T;

  let value = fallback;
  if (raw) {
    try {
      value = JSON.parse(raw) as T;
    } catch {
      storage?.removeItem(key);
    }
  }
  storageSnapshots.set(key, { raw, value });
  return value;
}

function useStoredState<T>(key: string, fallback: T) {
  const subscribe = useCallback((listener: () => void) => {
    const listeners = storageListeners.get(key) ?? new Set<() => void>();
    listeners.add(listener);
    storageListeners.set(key, listeners);
    return () => listeners.delete(listener);
  }, [key]);

  const value = useSyncExternalStore(
    subscribe,
    () => readStoredValue(key, fallback),
    () => fallback,
  );

  const setValue = useCallback((next: T | ((current: T) => T)) => {
    if (typeof window === "undefined") return;
    const current = readStoredValue<T>(key, fallback);
    const resolved = typeof next === "function"
      ? (next as (current: T) => T)(current)
      : next;
    const raw = JSON.stringify(resolved);
    const cached = storageSnapshots.get(key);
    if (Object.is(resolved, current) || cached?.raw === raw) return;
    const storage = getStorage();
    const isNative = typeof window.DictaTaskAndroid?.setStoredState === "function";
    memoryValues.set(key, resolved);
    if (isNative) {
      setNativeStoredRaw(key, raw);
    } else {
      try {
        storage?.setItem(key, raw);
      } catch {
        // In-memory state still keeps this browser session usable.
      }
    }
    storageSnapshots.set(key, { raw, value: resolved });
    storageListeners.get(key)?.forEach((listener) => listener());
  }, [fallback, key]);

  return [value, setValue] as const;
}

function useDebouncedStoredString(key: string, fallback: string, delay = 350) {
  const [persisted, setPersisted] = useStoredState(key, fallback);
  const [draft, setDraft] = useState(persisted);
  const draftRef = useRef(draft);
  const persistedRef = useRef(persisted);

  useEffect(() => {
    persistedRef.current = persisted;
    if (persisted !== draftRef.current) {
      draftRef.current = persisted;
      setDraft(persisted);
    }
  }, [persisted]);

  const updateDraft = useCallback((next: string | ((current: string) => string)) => {
    setDraft((current) => {
      const resolved = typeof next === "function" ? next(current) : next;
      draftRef.current = resolved;
      return resolved;
    });
  }, []);

  const flush = useCallback(() => {
    if (draftRef.current !== persistedRef.current) {
      setPersisted(draftRef.current);
    }
  }, [setPersisted]);

  useEffect(() => {
    if (draft === persisted) return;
    const timer = window.setTimeout(flush, delay);
    return () => window.clearTimeout(timer);
  }, [delay, draft, flush, persisted]);

  useEffect(() => () => flush(), [flush]);

  return [draft, updateDraft, flush] as const;
}

function useNormalizedStoredState<T>(
  key: string,
  fallback: T,
  normalize: (value: unknown) => T,
) {
  const [stored, setStored] = useStoredState<unknown>(key, fallback);
  const value = useMemo(() => normalize(stored), [normalize, stored]);

  useEffect(() => {
    if (JSON.stringify(stored) !== JSON.stringify(value)) {
      setStored(value);
    }
  }, [setStored, stored, value]);

  const setValue = useCallback((next: T | ((current: T) => T)) => {
    setStored((currentStored: unknown) => {
      const current = normalize(currentStored);
      const resolved = typeof next === "function"
        ? (next as (currentValue: T) => T)(current)
        : next;
      return normalize(resolved);
    });
  }, [normalize, setStored]);

  return [value, setValue] as const;
}

function createId() {
  return `task-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function stableColorIndex(seed: string) {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = ((hash << 5) - hash + seed.charCodeAt(index)) | 0;
  }
  return Math.abs(hash) % colors.length;
}

function normalizeTaskColor(value: unknown, seed: string, index: number): TaskColor {
  const token = typeof value === "string" ? value.trim().toLowerCase() : "";
  return taskColorAliases[token] ?? colors[seed ? stableColorIndex(seed) : index % colors.length];
}

function normalizeTaskEntry(value: unknown, index: number): Task | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Record<string, unknown>;
  const title = typeof entry.title === "string" ? entry.title.trim() : "";
  if (!title) return null;

  const id = typeof entry.id === "string" && entry.id.trim()
    ? entry.id
    : `legacy-task-${index}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;

  return {
    id,
    title,
    color: normalizeTaskColor(entry.color, `${id}:${title}`, index),
    completed: entry.completed === true,
    createdAt: typeof entry.createdAt === "number" && Number.isFinite(entry.createdAt)
      ? entry.createdAt
      : null,
    completedAt: typeof entry.completedAt === "number" && Number.isFinite(entry.completedAt)
      ? entry.completedAt
      : null,
  };
}

function normalizeTasks(value: unknown): Task[] {
  if (!Array.isArray(value)) return starterTasks;
  return value.flatMap((entry, index) => {
    const task = normalizeTaskEntry(entry, index);
    return task ? [task] : [];
  });
}

function normalizeTaskHistory(value: unknown): TaskHistoryEntry[] {
  if (!Array.isArray(value)) return starterTaskHistory;
  return value.flatMap((entry, index) => {
    const task = normalizeTaskEntry(entry, index);
    if (!task || !entry || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    return [{
      ...task,
      createdAt: typeof record.createdAt === "number" && Number.isFinite(record.createdAt)
        ? record.createdAt
        : null,
      completedAt: typeof record.completedAt === "number" && Number.isFinite(record.completedAt)
        ? record.completedAt
        : null,
    }];
  });
}

function normalizeTheme(value: unknown): Theme {
  if (value === "paper" || value === "light") return "paper";
  return "midnight";
}

function normalizeWheelSettings(value: unknown): WheelSettings {
  if (!value || typeof value !== "object") return defaultWheelSettings;
  const durationMinutes = (value as Record<string, unknown>).durationMinutes;
  if (typeof durationMinutes !== "number" || !Number.isFinite(durationMinutes)) {
    return defaultWheelSettings;
  }

  const rounded = Math.round(durationMinutes);
  return WHEEL_DURATION_OPTIONS.includes(rounded as (typeof WHEEL_DURATION_OPTIONS)[number])
    ? { durationMinutes: rounded }
    : defaultWheelSettings;
}

function normalizeWheelChallenge(value: unknown): WheelChallenge | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const taskId = typeof record.taskId === "string" ? record.taskId.trim() : "";
  const startedAt = typeof record.startedAt === "number" && Number.isFinite(record.startedAt)
    ? record.startedAt
    : 0;
  const durationSeconds = typeof record.durationSeconds === "number" && Number.isFinite(record.durationSeconds)
    ? Math.floor(record.durationSeconds)
    : 0;

  if (!taskId || startedAt <= 0 || durationSeconds < 60 || durationSeconds > 7200) return null;
  return {
    taskId,
    startedAt,
    durationSeconds,
    expired: record.expired === true,
    source: record.source === "direct" ? "direct" : "wheel",
  };
}

function mergeTaskHistory(current: TaskHistoryEntry[], tasks: Task[]) {
  const now = Date.now();
  const byId = new Map(current.map((entry) => [entry.id, {
    id: entry.id,
    title: entry.title,
    color: entry.color,
    completed: entry.completed,
    createdAt: entry.createdAt,
    completedAt: entry.completedAt,
  }]));

  tasks.forEach((task) => {
    const previous = byId.get(task.id);
    byId.set(task.id, {
      ...task,
      createdAt: task.createdAt ?? previous?.createdAt ?? now,
      completedAt: task.completed
        ? task.completedAt ?? (previous?.completed ? previous.completedAt ?? now : now)
        : null,
    });
  });

  const sorted = Array.from(byId.values())
    .sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0));
  const permanentDoneHistory = sorted.filter((entry) => entry.completed || entry.completedAt !== null);
  const openHistory = sorted
    .filter((entry) => !entry.completed && entry.completedAt === null)
    .slice(0, MAX_HISTORY_RECORDS);

  return [...permanentDoneHistory, ...openHistory];
}

function getRemainingFocusSeconds(challenge: WheelChallenge) {
  const deadline = challenge.startedAt + (challenge.durationSeconds * 1000);
  return Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
}

function formatFocusCountdown(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function buildWheelGradient(tasks: Task[]) {
  if (!tasks.length) {
    return "conic-gradient(from -90deg, var(--task-tile-default-shadow) 0deg 360deg)";
  }

  const segmentAngle = 360 / tasks.length;
  const separator = Math.min(1.5, segmentAngle * 0.08);
  const stops = tasks.flatMap((task, index) => {
    const start = index * segmentAngle;
    const end = (index + 1) * segmentAngle;
    const color = WHEEL_TASK_COLOR_VARIABLES[task.color];
    const wedgeEnd = Math.max(start, end - separator);
    return [
      `${color} ${start.toFixed(2)}deg ${wedgeEnd.toFixed(2)}deg`,
      `var(--juice-black) ${wedgeEnd.toFixed(2)}deg ${end.toFixed(2)}deg`,
    ];
  });

  return `conic-gradient(from -90deg, ${stops.join(", ")})`;
}

function formatHistoryDate(timestamp: number | null) {
  return timestamp ? new Date(timestamp).toLocaleString() : "Not recorded";
}

function getLocalDayNumber(timestamp: number) {
  const date = new Date(timestamp);
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000;
}

function getTaskOpenDays(createdAt: number | null | undefined, now: number) {
  if (!createdAt || !Number.isFinite(createdAt)) return 0;
  return Math.max(0, getLocalDayNumber(now) - getLocalDayNumber(createdAt));
}

function formatTaskOpenAge(daysOpen: number, completed: boolean) {
  return `${completed ? "OPEN FOR" : "OPEN"} ${daysOpen} ${daysOpen === 1 ? "DAY" : "DAYS"}`;
}

function getNextLocalMidnightDelay(timestamp: number) {
  const date = new Date(timestamp);
  const nextMidnight = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + 1,
  ).getTime();
  return Math.max(1000, nextMidnight - timestamp + TASK_AGE_REFRESH_PADDING_MS);
}

function formatTaskHistory(entries: TaskHistoryEntry[]) {
  const sortedEntries = [...entries].sort((a, b) => (
    (a.createdAt ?? 0) - (b.createdAt ?? 0)
  ));

  return [
    "DICTATASK TASK HISTORY",
    `EXPORTED: ${new Date().toLocaleString()}`,
    `TOTAL RECORDS: ${sortedEntries.length}`,
    "",
    ...sortedEntries.map((task, index) => [
      `${index + 1}. [${task.completed ? "DONE" : "OPEN"}] ${task.title}`,
      `   CREATED: ${formatHistoryDate(task.createdAt)}`,
      `   FIRST COMPLETED: ${formatHistoryDate(task.completedAt)}`,
      "",
    ].join("\n")),
  ].join("\n");
}

function tidyTask(raw: string) {
  return raw
    .replace(/^\s*(?:(?:and|then|also|plus)\s+)+/i, "")
    .replace(/^\s*(i need to|i have to|i should|i must|i want to|i can|we need to|we have to|we should|we must|remember to|don\'t forget to|please)\s+/i, "")
    .replace(/^\s*to\s+/i, "")
    .replace(/\s+(?:(?:and|then|also|plus)\s*)+$/i, "")
    .replace(/[.!?,;:]+$/g, "")
    .trim()
    .replace(/^./, (letter) => letter.toUpperCase());
}

function taskKey(title: string) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function extractTasks(transcript: string): Task[] {
  const normalized = transcript.replace(/\n+/g, ". ").trim();
  if (!normalized) return [];

  const sentences = normalized
    .split(/(?<=[.!?])\s+|[;]+/)
    .flatMap((sentence) => {
      const repeatedRequests = sentence.split(new RegExp(`\\s+(?:(?:and|then|also)\\s+)?(?=${taskLeadPattern}\\b)`, "i"));
      return repeatedRequests.flatMap((request) => {
        const chunks = request.split(/,\s*/);
        return chunks.flatMap((chunk) => chunk.split(new RegExp(`\\s+(?:(?:and|then|also)\\s+)(?=${taskVerbPattern}\\b)`, "i")));
      });
    })
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  const candidates = sentences.filter((sentence) => {
    const isAction = actionWords.test(sentence);
    const hasTime = /\b(today|tomorrow|tonight|morning|afternoon|evening|before|after|at \d|by [a-z]+day|next week)\b/i.test(sentence);
    const isFirstPerson = /^\s*(i|we)\s+(need|have|should|want|must|can)\b/i.test(sentence);
    return sentence.length > 9 && (isAction || hasTime || isFirstPerson);
  });

  const usable = candidates.length ? candidates : sentences.filter((sentence) => sentence.length > 9);
  const unique = Array.from(new Set(usable.map(tidyTask))).filter((title) => title.length > 3);
  const createdAt = Date.now();

  return unique.slice(0, 12).map((title, index) => ({
    id: createId(),
    title,
    color: colors[index % colors.length],
    completed: false,
    createdAt,
    completedAt: null,
  }));
}

function Icon({ name }: { name: "mic" | "spark" | "arrow" | "plus" | "trash" | "check" | "wave" | "download" }) {
  if (name === "mic") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="8" y="3" width="8" height="12" rx="4" />
        <path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" />
      </svg>
    );
  }
  if (name === "spark") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m12 2 1.7 7.3L21 11l-7.3 1.7L12 20l-1.7-7.3L3 11l7.3-1.7L12 2Z" />
      </svg>
    );
  }
  if (name === "arrow") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 12h15M13 6l6 6-6 6" />
      </svg>
    );
  }
  if (name === "plus") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 5v14M5 12h14" />
      </svg>
    );
  }
  if (name === "trash") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V4h6v3" />
      </svg>
    );
  }
  if (name === "wave") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 12h2M7 9v6M11 5v14M15 8v8M19 10v4M22 12h-1" />
      </svg>
    );
  }
  if (name === "download") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3v12M7 10l5 5 5-5M4 20h16" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m5 12 4 4L19 6" />
    </svg>
  );
}

const TaskRow = memo(function TaskRow({
  task,
  index,
  daysOpen,
  celebrating,
  onToggle,
  onFocus,
}: {
  task: Task;
  index: number;
  daysOpen: number;
  celebrating: boolean;
  onToggle: (id: string) => void;
  onFocus: (id: string) => void;
}) {
  const historyOnly = task.historyOnly === true;

  return (
    <div
      className={`task-row task-${task.color} ${task.completed ? "is-complete" : ""} ${historyOnly ? "is-history" : ""} ${celebrating ? "is-celebrating" : ""}`}
      id={`task-${task.id}`}
      style={{
        "--task-stack-index": index,
        "--task-stack-offset": `${(2 - index) * 94}px`,
      } as CSSProperties}
      role="checkbox"
      aria-checked={task.completed}
      tabIndex={0}
      aria-label={`${task.completed ? "Reopen" : "Complete"} ${task.title}`}
      onClick={() => onToggle(task.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onToggle(task.id);
        }
      }}
    >
      <span
        className={`task-checkbox ${task.completed ? "checked" : ""} ${celebrating ? "is-celebrating" : ""}`}
        aria-hidden="true"
      >
        {task.completed && <Icon name="check" />}
      </span>
      <div className="task-content">
        <span className="task-index">{String(index + 1).padStart(2, "0")}</span>
        <div>
          <p className="task-title">{task.title}</p>
          <div className="task-meta" aria-label={`${formatTaskOpenAge(daysOpen, task.completed)} since this task was created`}>
            <span>{formatTaskOpenAge(daysOpen, task.completed)}</span>
          </div>
          {!task.completed && (
            <button
              className="task-focus-button"
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onFocus(task.id);
              }}
              onKeyDown={(event) => event.stopPropagation()}
              aria-label={`Focus ${task.title} without spinning the wheel`}
            >
              FOCUS
            </button>
          )}
        </div>
      </div>
      <span className="task-badge">{historyOnly ? "HISTORY" : task.completed ? "DONE" : "NEXT"}</span>
      <span className="task-swipe" aria-hidden="true">→</span>
    </div>
  );
});

const FocusCountdown = memo(function FocusCountdown({
  challenge,
  onExpire,
}: {
  challenge: WheelChallenge;
  onExpire: () => void;
}) {
  const deadline = challenge.startedAt + (challenge.durationSeconds * 1000);
  const [remainingSeconds, setRemainingSeconds] = useState(() => getRemainingFocusSeconds(challenge));
  const onExpireRef = useRef(onExpire);
  const expirationNotifiedRef = useRef(Boolean(challenge.expired));

  useEffect(() => {
    onExpireRef.current = onExpire;
  }, [onExpire]);

  useEffect(() => {
    expirationNotifiedRef.current = Boolean(challenge.expired);
    const tick = () => {
      const next = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setRemainingSeconds((current) => current === next ? current : next);
      if (next === 0 && !challenge.expired && !expirationNotifiedRef.current) {
        expirationNotifiedRef.current = true;
        onExpireRef.current();
      }
    };

    tick();
    if (challenge.expired) return undefined;
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [challenge.expired, deadline]);

  const expired = challenge.expired || remainingSeconds === 0;
  return (
    <span
      className={`wheel-countdown ${expired ? "is-expired" : ""}`}
      role="timer"
      aria-label={expired ? "Focus timer ended" : `${remainingSeconds} seconds remaining`}
      aria-live="off"
    >
      {expired ? "TIME CALLED" : formatFocusCountdown(remainingSeconds)}
    </span>
  );
});

function CelebrationBurst({ variant, nonce }: { variant: CelebrationVariant; nonce: number }) {
  const word = variant === "jackpot" ? "ON A ROLL" : variant === "massacre" ? "MOMENTUM" : "HANDLED";

  const celebration = (
    <div className={`screen-celebration screen-${variant}`} key={nonce} aria-hidden="true">
      <div className="screen-wash" />
      <div className="screen-grid" />
      <div className="screen-confetti">
        {confettiPieces.map((piece, index) => (
          <span
            className={`confetti-piece confetti-color-${index % 5}`}
            key={index}
            style={{
              "--confetti-left": piece.left,
              "--confetti-x": piece.x,
              "--confetti-y": piece.y,
              "--confetti-spin": piece.spin,
              "--confetti-delay": piece.delay,
              "--confetti-width": piece.width,
              "--confetti-height": piece.height,
            } as CSSProperties}
          />
        ))}
      </div>
      <div className={`celebration-burst burst-${variant}`}>
        <img
          className="completion-mascot"
          src="./dictatask-task-champion-512.png"
          alt=""
          draggable={false}
        />
        <span className="burst-word">{word}</span>
        <span className="burst-reward">+1 DONE</span>
        <span className="burst-ring ring-one" />
        <span className="burst-ring ring-two" />
        <span className="burst-particle particle-1" />
        <span className="burst-particle particle-2" />
        <span className="burst-particle particle-3" />
        <span className="burst-particle particle-4" />
        <span className="burst-particle particle-5" />
        <span className="burst-particle particle-6" />
        <span className="burst-particle particle-7" />
        <span className="burst-particle particle-8" />
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(celebration, document.body);
}

export default function Home() {
  const [transcript, setTranscript, flushTranscript] = useDebouncedStoredString("dictatask-transcript", starterTranscript);
  const [tasks, setTasks] = useNormalizedStoredState("dictatask-tasks", starterTasks, normalizeTasks);
  const [taskHistory, setTaskHistory] = useNormalizedStoredState("dictatask-task-history", starterTaskHistory, normalizeTaskHistory);
  const [theme, setTheme] = useNormalizedStoredState("dictatask-theme", "midnight" as Theme, normalizeTheme);
  const [wheelSettings, setWheelSettings] = useNormalizedStoredState(
    "dictatask-wheel-settings",
    defaultWheelSettings,
    normalizeWheelSettings,
  );
  const [wheelChallenge, setWheelChallenge] = useNormalizedStoredState<WheelChallenge | null>(
    "dictatask-wheel-challenge",
    null,
    normalizeWheelChallenge,
  );
  const [filter, setFilter] = useState<Filter>("open");
  const [newTask, setNewTask] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [isManualDictating, setIsManualDictating] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const setNotice = useCallback((_message: string) => undefined, []);
  const [undoCompletion, setUndoCompletion] = useState<UndoCompletion | null>(null);
  const [celebratingTaskId, setCelebratingTaskId] = useState<string | null>(null);
  const [dismissedTaskIds, setDismissedTaskIds] = useStoredState<string[]>("dictatask-dismissed-task-ids", EMPTY_STRING_ARRAY);
  const [celebrationVariant, setCelebrationVariant] = useState<CelebrationVariant>("burst");
  const [celebrationNonce, setCelebrationNonce] = useState(0);
  const [milestone, setMilestone] = useState<string | null>(null);
  const [combo, setCombo] = useState(0);
  const [wheelPhase, setWheelPhase] = useState<WheelPhase>("list");
  const [focusEntryMode, setFocusEntryMode] = useState<FocusEntry>("wheel");
  const [wheelRotation, setWheelRotation] = useState(0);
  const [wheelCandidates, setWheelCandidates] = useState<Task[]>([]);
  const [pendingWheelTaskId, setPendingWheelTaskId] = useState<string | null>(null);
  const [wheelSettingsOpen, setWheelSettingsOpen] = useState(false);
  const [taskAgeNow, setTaskAgeNow] = useState(() => Date.now());
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const manualTaskInputRef = useRef<HTMLInputElement | null>(null);
  const manualRecognitionTimerRef = useRef<number | null>(null);
  const voiceBufferRef = useRef("");
  const voiceInterimRef = useRef("");
  const fallbackInterimRef = useRef("");
  const keepListeningRef = useRef(false);
  const voiceSessionRef = useRef(0);
  const recordingStartedAtRef = useRef(0);
  const restartTimerRef = useRef<number | null>(null);
  const celebrationTimerRef = useRef<number | null>(null);
  const milestoneTimerRef = useRef<number | null>(null);
  const comboTimerRef = useRef<number | null>(null);
  const wheelRevealTimerRef = useRef<number | null>(null);
  const wheelSpinTimerRef = useRef<number | null>(null);
  const wheelReturnTimerRef = useRef<number | null>(null);
  const wheelAnimationFrameRef = useRef<number | null>(null);
  const wheelRotorRef = useRef<HTMLDivElement | null>(null);
  const wheelRunIdRef = useRef(0);
  const lastCompletionAtRef = useRef(0);
  const milestonesSeenRef = useRef(new Set<number>());
  const toggleTaskRef = useRef<(id: string) => void>(() => undefined);
  const focusTaskRef = useRef<(id: string) => void>(() => undefined);
  const handleTaskToggle = useCallback((id: string) => toggleTaskRef.current(id), []);
  const handleTaskFocus = useCallback((id: string) => focusTaskRef.current(id), []);
  const colorScheme = theme === "paper" ? "light" : "dark";

  useEffect(() => {
    document.documentElement.dataset.dictataskTheme = theme;
    document.documentElement.style.colorScheme = colorScheme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute(
      "content",
      theme === "paper" ? "#f0e2c2" : "#0d0d12",
    );
    window.DictaTaskAndroid?.setColorScheme?.(colorScheme);
    return () => {
      delete document.documentElement.dataset.dictataskTheme;
      document.documentElement.style.removeProperty("color-scheme");
    };
  }, [colorScheme, theme]);

  useEffect(() => {
    // Warm the small raster once after the first paint so checking a task feels
    // instantaneous even on a cold Android WebView cache.
    const preloadTimer = window.setTimeout(() => {
      const mascot = new Image();
      mascot.src = "./dictatask-task-champion-512.png";
    }, 350);
    return () => window.clearTimeout(preloadTimer);
  }, []);

  useEffect(() => {
    let timer: number | null = null;
    const refresh = () => {
      const now = Date.now();
      setTaskAgeNow(now);
      timer = window.setTimeout(refresh, getNextLocalMidnightDelay(now));
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") setTaskAgeNow(Date.now());
    };

    refresh();
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, []);

  useEffect(() => {
    setTaskHistory((current) => mergeTaskHistory(current, tasks));
  }, [setTaskHistory, tasks]);

  useEffect(() => {
    const historyById = new Map(taskHistory.map((entry) => [entry.id, entry]));
    const now = Date.now();
    setTasks((current) => {
      let changed = false;
      const next = current.map((task) => {
        const history = historyById.get(task.id);
        const createdAt = typeof task.createdAt === "number" && Number.isFinite(task.createdAt)
          ? task.createdAt
          : history?.createdAt ?? now;
        const completedAt = task.completed
          ? task.completedAt ?? history?.completedAt ?? null
          : null;
        if (createdAt === task.createdAt && completedAt === task.completedAt) return task;
        changed = true;
        return { ...task, createdAt, completedAt };
      });
      return changed ? next : current;
    });
  }, [setTasks, taskHistory]);

  const dismissedTaskIdSet = useMemo(() => new Set(dismissedTaskIds), [dismissedTaskIds]);

  useEffect(() => {
    const completedIds = tasks.filter((task) => task.completed).map((task) => task.id);
    const activeIds = new Set(tasks.map((task) => task.id));
    setDismissedTaskIds((current) => {
      const next = Array.from(new Set([
        ...current.filter((id) => activeIds.has(id)),
        ...completedIds,
      ])).slice(-MAX_HISTORY_RECORDS);
      return next.length === current.length && next.every((id, index) => id === current[index])
        ? current
        : next;
    });
  }, [setDismissedTaskIds, tasks]);

  const openTasks = useMemo(() => tasks.filter((task) => !task.completed), [tasks]);
  const openCount = openTasks.length;
  const completedCount = tasks.filter((task) => task.completed).length;
  const doneHistoryTasks = useMemo(() => {
    const fallbackCompletionTime = Date.now();
    const history = new Map<string, TaskHistoryEntry>();

    taskHistory.forEach((entry) => {
      if (entry.completed || entry.completedAt !== null) {
        history.set(entry.id, {
          ...entry,
          completed: true,
          historyOnly: true,
        });
      }
    });

    tasks.forEach((task) => {
      if (task.completed) {
        const previous = history.get(task.id);
        history.set(task.id, {
          ...task,
          createdAt: task.createdAt ?? previous?.createdAt ?? null,
          completedAt: task.completedAt ?? previous?.completedAt ?? fallbackCompletionTime,
          historyOnly: false,
        });
      }
    });

    return Array.from(history.values())
      .sort((left, right) => (
        (right.completedAt ?? 0) - (left.completedAt ?? 0)
        || (right.createdAt ?? 0) - (left.createdAt ?? 0)
      ))
      .map(({ id, title, color, completed, createdAt, completedAt, historyOnly }) => ({
        id,
        title,
        color,
        completed,
        createdAt,
        completedAt,
        historyOnly,
      }));
  }, [taskHistory, tasks]);
  const doneCount = doneHistoryTasks.length;
  const totalCount = tasks.length;
  const createdAtByTaskId = useMemo(() => {
    const timestamps = new Map<string, number>();
    taskHistory.forEach((entry) => {
      if (typeof entry.createdAt === "number" && Number.isFinite(entry.createdAt)) {
        timestamps.set(entry.id, entry.createdAt);
      }
    });
    tasks.forEach((task) => {
      if (typeof task.createdAt === "number" && Number.isFinite(task.createdAt)) {
        timestamps.set(task.id, task.createdAt);
      }
    });
    return timestamps;
  }, [taskHistory, tasks]);
  const filteredTasks = useMemo(() => {
    if (filter === "done") return doneHistoryTasks;
    return tasks
      .filter((task) => !task.completed || task.id === celebratingTaskId)
      .filter((task) => task.id === celebratingTaskId || !dismissedTaskIdSet.has(task.id));
  }, [celebratingTaskId, dismissedTaskIdSet, doneHistoryTasks, filter, tasks]);

  const wheelTaskPool = wheelCandidates.length ? wheelCandidates : openTasks;
  const wheelColorGradient = useMemo(() => buildWheelGradient(wheelTaskPool), [wheelTaskPool]);
  const wheelFocusTaskId = wheelChallenge?.taskId ?? pendingWheelTaskId;
  const wheelFocusTask = wheelFocusTaskId
    ? tasks.find((task) => task.id === wheelFocusTaskId) ?? null
    : null;

  const handleWheelDeadline = useCallback(() => {
    setWheelChallenge((current) => {
      if (!current || current.expired) return current;
      return { ...current, expired: true };
    });
    setNotice("Clock called. Reset when you are ready, then take the task cleanly.");
  }, [setWheelChallenge]);

  useEffect(() => {
    if (!wheelChallenge) return;
    const activeTask = tasks.find((task) => task.id === wheelChallenge.taskId);
    if (!activeTask || activeTask.completed) {
      setWheelChallenge(null);
      if (wheelPhase === "challenge") setWheelPhase("list");
      setFocusEntryMode("wheel");
      return;
    }

    if (wheelPhase === "list") {
      setFocusEntryMode(wheelChallenge.source);
      setWheelCandidates((current) => current.length ? current : openTasks);
      setPendingWheelTaskId(activeTask.id);
      setWheelPhase("challenge");
    }
  }, [openTasks, setWheelChallenge, tasks, wheelChallenge, wheelPhase]);

  function publishTranscriptPreview() {
    const preview = [voiceBufferRef.current.trim(), voiceInterimRef.current.trim()]
      .filter(Boolean)
      .join(" ");
    setTranscript(preview);
  }

  function commitPendingSpeech(keepFallback = false) {
    const pending = voiceInterimRef.current.trim();
    if (!pending) return;

    voiceBufferRef.current = `${voiceBufferRef.current} ${pending}`.trim();
    voiceInterimRef.current = "";
    fallbackInterimRef.current = keepFallback ? pending : "";
    publishTranscriptPreview();
  }

  function appendFinalSpeech(spoken: string) {
    const finalText = spoken.trim();
    if (!finalText) return;

    const fallback = fallbackInterimRef.current.trim();
    let base = voiceBufferRef.current.trim();
    if (fallback && base.toLowerCase().endsWith(fallback.toLowerCase())) {
      base = base.slice(0, base.length - fallback.length).trim();
    }

    voiceBufferRef.current = `${base} ${finalText}`.trim();
    voiceInterimRef.current = "";
    fallbackInterimRef.current = "";
    publishTranscriptPreview();
  }

  function finishListening(message: string) {
    keepListeningRef.current = false;
    if (restartTimerRef.current !== null) {
      window.clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }

    try {
      recognitionRef.current?.stop();
    } catch {
      recognitionRef.current?.abort?.();
    }
    commitPendingSpeech(true);
    setTranscript(voiceBufferRef.current.trim());
    setIsListening(false);
    setRecordingSeconds(0);
    setNotice(message);
  }

  useEffect(() => {
    if (!isListening) return;

    const timer = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - recordingStartedAtRef.current) / 1000);
      if (elapsed >= RECORDING_LIMIT_SECONDS) {
        finishListening("30-second voice note complete. Scan it whenever you are ready.");
        return;
      }
      setRecordingSeconds(elapsed);
    }, 1000);

    return () => window.clearInterval(timer);
  }, [isListening]);

  useEffect(() => () => {
    keepListeningRef.current = false;
    voiceSessionRef.current += 1;
    if (restartTimerRef.current !== null) window.clearTimeout(restartTimerRef.current);
    if (manualRecognitionTimerRef.current !== null) window.clearTimeout(manualRecognitionTimerRef.current);
    if (celebrationTimerRef.current !== null) window.clearTimeout(celebrationTimerRef.current);
    if (milestoneTimerRef.current !== null) window.clearTimeout(milestoneTimerRef.current);
    if (comboTimerRef.current !== null) window.clearTimeout(comboTimerRef.current);
    wheelRunIdRef.current += 1;
    clearWheelTimers();
    try {
      recognitionRef.current?.stop();
    } catch {
      recognitionRef.current?.abort?.();
    }
  }, []);

  function clearWheelTimers() {
    if (wheelRevealTimerRef.current !== null) {
      window.clearTimeout(wheelRevealTimerRef.current);
      wheelRevealTimerRef.current = null;
    }
    if (wheelSpinTimerRef.current !== null) {
      window.clearTimeout(wheelSpinTimerRef.current);
      wheelSpinTimerRef.current = null;
    }
    if (wheelReturnTimerRef.current !== null) {
      window.clearTimeout(wheelReturnTimerRef.current);
      wheelReturnTimerRef.current = null;
    }
    if (wheelAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(wheelAnimationFrameRef.current);
      wheelAnimationFrameRef.current = null;
    }
  }

  function putWheelAway(message?: string) {
    wheelRunIdRef.current += 1;
    clearWheelTimers();
    setWheelChallenge(null);
    setWheelPhase("list");
    setFocusEntryMode("wheel");
    setWheelCandidates([]);
    setPendingWheelTaskId(null);
    setWheelSettingsOpen(false);
    setNotice(message ?? (focusEntryMode === "direct"
      ? "Focus cancelled. Your tasks are unchanged."
      : "Wheel cancelled. Your tasks are unchanged."));
  }

  function finishWheelSpin(runId: number, selectedTask: Task, targetRotation: number, durationMinutes: number) {
    if (wheelRunIdRef.current !== runId) return;
    clearWheelTimers();
    if (wheelRotorRef.current) {
      wheelRotorRef.current.style.transform = `rotate(${targetRotation}deg)`;
    }
    setWheelRotation(targetRotation);
    setWheelChallenge({
      taskId: selectedTask.id,
      startedAt: Date.now(),
      durationSeconds: durationMinutes * 60,
      expired: false,
      source: "wheel",
    });
    setWheelPhase("challenge");
    setNotice(`${selectedTask.title} is the move. ${durationMinutes} minutes, clean finish.`);
  }

  function spinTheWheel() {
    const eligibleTasks = tasks.filter((task) => !task.completed);
    if (!eligibleTasks.length) {
      setNotice("Add an open task before you spin the wheel.");
      return;
    }

    if (wheelChallenge && !wheelChallenge.expired) {
      setWheelPhase("challenge");
      setNotice("Your focus clock is already running. Finish that task before the next spin.");
      return;
    }

    const runId = wheelRunIdRef.current + 1;
    wheelRunIdRef.current = runId;
    clearWheelTimers();
    setWheelChallenge(null);
    setFocusEntryMode("wheel");
    const selectedIndex = Math.floor(Math.random() * eligibleTasks.length);
    const selectedTask = eligibleTasks[selectedIndex];
    const segmentAngle = 360 / eligibleTasks.length;
    const targetAngle = selectedIndex * segmentAngle + (segmentAngle / 2);
    const startRotation = wheelRotation;
    const normalizedCurrent = ((startRotation % 360) + 360) % 360;
    const alignment = (360 - targetAngle - normalizedCurrent + 360) % 360;
    const targetRotation = startRotation + (6 * 360) + alignment;
    const durationMinutes = wheelSettings.durationMinutes;

    setWheelCandidates(eligibleTasks);
    setPendingWheelTaskId(selectedTask.id);
    setWheelSettingsOpen(false);
    setWheelPhase("converging");
    setNotice("The board is closing in. One task is about to get the spotlight.");

    wheelRevealTimerRef.current = window.setTimeout(() => {
      wheelRevealTimerRef.current = null;
      if (wheelRunIdRef.current !== runId) return;
      setWheelPhase("wheel");
      window.requestAnimationFrame(() => {
        if (wheelRunIdRef.current !== runId) return;
        setWheelPhase("spinning");
        window.requestAnimationFrame(() => {
          if (wheelRunIdRef.current !== runId) return;
          const animationStartedAt = window.performance.now();
          const animateWheel = (now: number) => {
            if (wheelRunIdRef.current !== runId) return;
            const progress = Math.min(1, (now - animationStartedAt) / WHEEL_SPIN_DURATION_MS);
            const easedProgress = 1 - Math.pow(1 - progress, 4);
            const rotation = startRotation + ((targetRotation - startRotation) * easedProgress);
            if (wheelRotorRef.current) {
              wheelRotorRef.current.style.transform = `rotate(${rotation}deg)`;
            }

            if (progress < 1) {
              wheelAnimationFrameRef.current = window.requestAnimationFrame(animateWheel);
              return;
            }

            wheelAnimationFrameRef.current = null;
            finishWheelSpin(runId, selectedTask, targetRotation, durationMinutes);
          };

          wheelAnimationFrameRef.current = window.requestAnimationFrame(animateWheel);
        });
      });

      wheelSpinTimerRef.current = window.setTimeout(() => {
        wheelSpinTimerRef.current = null;
        finishWheelSpin(runId, selectedTask, targetRotation, durationMinutes);
      }, WHEEL_SPIN_DURATION_MS + 240);
    }, WHEEL_CONVERGE_DURATION_MS);
  }

  function focusTaskDirectly(taskId: string) {
    const selectedTask = tasks.find((task) => task.id === taskId);
    if (!selectedTask || selectedTask.completed) {
      setNotice("Choose an open task to start a focus clock.");
      return;
    }

    if (wheelChallenge && !wheelChallenge.expired) {
      setWheelPhase("challenge");
      setNotice("Your focus clock is already running. Finish that task before choosing another.");
      return;
    }

    wheelRunIdRef.current += 1;
    clearWheelTimers();
    setWheelChallenge({
      taskId: selectedTask.id,
      startedAt: Date.now(),
      durationSeconds: wheelSettings.durationMinutes * 60,
      expired: false,
      source: "direct",
    });
    setWheelPhase("challenge");
    setFocusEntryMode("direct");
    setWheelCandidates([]);
    setPendingWheelTaskId(selectedTask.id);
    setWheelSettingsOpen(false);
    setNotice(`${selectedTask.title} is locked in. ${wheelSettings.durationMinutes} minutes, clean finish.`);
  }

  function rerollWheel() {
    wheelRunIdRef.current += 1;
    clearWheelTimers();
    setWheelChallenge(null);
    setWheelPhase("list");
    setFocusEntryMode("wheel");
    const rerollId = wheelRunIdRef.current;
    window.setTimeout(() => {
      if (wheelRunIdRef.current !== rerollId) return;
      spinTheWheel();
    }, 120);
  }

  function generateTasks() {
    const nextTasks = extractTasks(transcript);
    if (!nextTasks.length) {
      setNotice("Give me a little more to work with — mention the things you need to do.");
      return;
    }
    const existingKeys = new Set(tasks.map((task) => taskKey(task.title)));
    const additions = nextTasks.filter((task) => !existingKeys.has(taskKey(task.title)));
    const isDemoList = tasks.length === starterTasks.length && tasks.every((task, index) => (
      task.id === starterTasks[index]?.id && task.completed === starterTasks[index]?.completed
    ));

    if (!additions.length) {
      setNotice("Those tasks are already on your list.");
      return;
    }

    setTasks([...(isDemoList ? [] : tasks), ...additions]);
    setFilter("open");
    setNotice(`${additions.length} new ${additions.length === 1 ? "task" : "tasks"} added. Your dictated text is still here.`);
  }

  function stopListening(message = "Voice note stopped. Scan it whenever you are ready.") {
    finishListening(message);
  }

  function toggleListening() {
    if (isListening) {
      stopListening();
      return;
    }

    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Recognition) {
      setNotice("Voice capture is supported in Chrome and Edge. You can still paste a transcript here.");
      return;
    }

    const existingTranscript = transcript.trim();
    voiceBufferRef.current = existingTranscript === starterTranscript ? "" : existingTranscript;
    voiceInterimRef.current = "";
    fallbackInterimRef.current = "";
    keepListeningRef.current = true;
    voiceSessionRef.current += 1;
    const sessionId = voiceSessionRef.current;
    recordingStartedAtRef.current = Date.now();
    setRecordingSeconds(0);

    const startRecognitionSegment = () => {
      if (!keepListeningRef.current || sessionId !== voiceSessionRef.current) return;

      const recognition = new Recognition();
      const committedFinalResults = new Set<string>();
      voiceInterimRef.current = "";
      fallbackInterimRef.current = "";

      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = "en-US";
      recognition.onresult = (event) => {
        if (sessionId !== voiceSessionRef.current || recognitionRef.current !== recognition) return;

        let interim = "";
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index];
          const spoken = result[0].transcript.trim();
          if (!spoken) continue;

          if (result.isFinal) {
            const resultKey = `${index}:${spoken.toLowerCase()}`;
            if (!committedFinalResults.has(resultKey)) {
              committedFinalResults.add(resultKey);
              appendFinalSpeech(spoken);
            }
          } else {
            interim = `${interim} ${spoken}`.trim();
          }
        }

        voiceInterimRef.current = interim;
        publishTranscriptPreview();
      };
      recognition.onerror = (event) => {
        if (sessionId !== voiceSessionRef.current || recognitionRef.current !== recognition) return;

        if (event.error === "not-allowed" || event.error === "service-not-allowed") {
          keepListeningRef.current = false;
          setIsListening(false);
          setRecordingSeconds(0);
          setNotice("Microphone permission is blocked. You can still paste a transcript here.");
          return;
        }

        if (event.error === "audio-capture") {
          setNotice("Microphone signal lost. Stop and try again.");
        } else if (event.error === "network") {
          setNotice("Transcription service paused. Stop and try again.");
        } else if (event.error !== "aborted") {
          setNotice("Still listening... take your time.");
        }
      };
      recognition.onend = () => {
        if (sessionId !== voiceSessionRef.current || recognitionRef.current !== recognition) return;

        commitPendingSpeech(true);
        if (keepListeningRef.current) {
          const elapsed = (Date.now() - recordingStartedAtRef.current) / 1000;
          finishListening(elapsed >= RECORDING_LIMIT_SECONDS
            ? "30-second voice note complete. Scan it whenever you are ready."
            : "Voice note captured. Scan it whenever you are ready.");
        }
      };
      recognitionRef.current = recognition;
      try {
        recognition.start();
      } catch {
        if (sessionId !== voiceSessionRef.current || !keepListeningRef.current) return;
        keepListeningRef.current = false;
        setIsListening(false);
        setRecordingSeconds(0);
        setNotice("I could not start the microphone. You can still paste a transcript here.");
      }
    };

    setIsListening(true);
    setNotice("Recording now. Live transcript will appear as you speak.");
    startRecognitionSegment();
  }

  function stopManualDictation(message = "Task dictation stopped.") {
    voiceSessionRef.current += 1;
    if (manualRecognitionTimerRef.current !== null) {
      window.clearTimeout(manualRecognitionTimerRef.current);
      manualRecognitionTimerRef.current = null;
    }

    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    try {
      recognition?.stop();
    } catch {
      recognition?.abort?.();
    }
    setIsManualDictating(false);
    setNotice(message);
  }

  function toggleManualDictation() {
    if (isManualDictating) {
      stopManualDictation();
      return;
    }

    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Recognition) {
      setNotice("Microphone dictation is unavailable here. You can still type the task.");
      return;
    }

    if (isListening) {
      finishListening("Voice note stopped. Dictating a task instead.");
    }

    manualTaskInputRef.current?.focus();
    voiceSessionRef.current += 1;
    const sessionId = voiceSessionRef.current;
    const initialTask = newTask.trim();
    let finalSpeech = "";
    let interimSpeech = "";
    const committedFinalResults = new Set<string>();
    const recognition = new Recognition();

    const publishTaskPreview = () => {
      const spoken = [finalSpeech, interimSpeech].filter(Boolean).join(" ").trim();
      setNewTask([initialTask, spoken].filter(Boolean).join(" "));
    };

    const finishManualSession = (message: string) => {
      if (sessionId !== voiceSessionRef.current || recognitionRef.current !== recognition) return;
      if (manualRecognitionTimerRef.current !== null) {
        window.clearTimeout(manualRecognitionTimerRef.current);
        manualRecognitionTimerRef.current = null;
      }
      recognitionRef.current = null;
      setIsManualDictating(false);
      setNotice(message);
    };

    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.onresult = (event) => {
      if (sessionId !== voiceSessionRef.current || recognitionRef.current !== recognition) return;

      let nextInterim = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const spoken = result[0].transcript.trim();
        if (!spoken) continue;
        if (result.isFinal) {
          const resultKey = `${index}:${spoken.toLowerCase()}`;
          if (!committedFinalResults.has(resultKey)) {
            committedFinalResults.add(resultKey);
            finalSpeech = `${finalSpeech} ${spoken}`.trim();
          }
        } else {
          nextInterim = `${nextInterim} ${spoken}`.trim();
        }
      }
      interimSpeech = nextInterim;
      publishTaskPreview();
    };
    recognition.onerror = (event) => {
      if (sessionId !== voiceSessionRef.current || recognitionRef.current !== recognition) return;
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        finishManualSession("Microphone permission is blocked. You can still type the task.");
      } else if (event.error !== "aborted") {
        finishManualSession("Task dictation stopped. Try the mic again when you are ready.");
      }
    };
    recognition.onend = () => {
      finishManualSession(finalSpeech.trim()
        ? "Task dictation is ready to add."
        : "No task was heard. Try the mic again or type it in.");
    };

    recognitionRef.current = recognition;
    setIsManualDictating(true);
    setNotice("Dictating a task. Tap the mic again when you are done.");
    manualRecognitionTimerRef.current = window.setTimeout(() => {
      if (sessionId !== voiceSessionRef.current || recognitionRef.current !== recognition) return;
      try {
        recognition.stop();
      } catch {
        recognition.abort?.();
      }
      finishManualSession("30-second task dictation complete.");
    }, RECORDING_LIMIT_SECONDS * 1000);

    try {
      recognition.start();
    } catch {
      finishManualSession("I could not start the microphone. You can still type the task.");
    }
  }

  function clearUndoCompletion() {
    setUndoCompletion(null);
  }

  function undoLastCompletion() {
    const action = undoCompletion;
    if (!action) return;

    clearUndoCompletion();
    const activeTask = tasks.find((task) => task.id === action.id);
    if (!activeTask || !activeTask.completed) return;

    setTasks((current) => current.map((task) => (
      task.id === action.id ? { ...task, completed: false, completedAt: null } : task
    )));
    setTaskHistory((current) => {
      if (!action.previousHistory) return current.filter((entry) => entry.id !== action.id);
      const restored = { ...action.previousHistory, completed: false };
      let restoredInPlace = false;
      const next = current.map((entry) => {
        if (entry.id !== action.id) return entry;
        restoredInPlace = true;
        return restored;
      });
      return restoredInPlace ? next : [...next, restored];
    });
    setDismissedTaskIds((current) => action.wasDismissed
      ? current
      : current.filter((taskId) => taskId !== action.id));
    if (celebrationTimerRef.current !== null) {
      window.clearTimeout(celebrationTimerRef.current);
      celebrationTimerRef.current = null;
    }
    setCelebratingTaskId(null);
    setMilestone(null);

    if (wheelFocusTaskId === action.id) {
      wheelRunIdRef.current += 1;
      clearWheelTimers();
      setWheelChallenge(null);
      setWheelPhase("list");
      setFocusEntryMode("wheel");
      setWheelCandidates([]);
      setPendingWheelTaskId(null);
    }
    setNotice("Task restored. Nothing was completed.");
  }

  function toggleTask(id: string) {
    const task = tasks.find((item) => item.id === id) ?? doneHistoryTasks.find((item) => item.id === id);
    const willComplete = Boolean(task && !task.completed);
    const isWheelFocusTask = willComplete && wheelChallenge?.taskId === id;
    const completionTimestamp = willComplete ? Date.now() : null;

    if (celebrationTimerRef.current !== null) {
      window.clearTimeout(celebrationTimerRef.current);
      celebrationTimerRef.current = null;
    }

    setTasks((current) => {
      if (current.some((item) => item.id === id)) {
        return current.map((item) => (item.id === id
          ? {
              ...item,
              completed: !item.completed,
              completedAt: item.completed ? null : completionTimestamp,
            }
          : item));
      }
      if (!task || !task.completed) return current;
      return [...current, {
        id: task.id,
        title: task.title,
        color: task.color,
        completed: false,
        createdAt: task.createdAt ?? taskHistory.find((entry) => entry.id === task.id)?.createdAt ?? Date.now(),
        completedAt: null,
      }];
    });

    if (willComplete) {
      setUndoCompletion({
        id,
        title: task?.title ?? "Task",
        previousHistory: taskHistory.find((entry) => entry.id === id) ?? null,
        wasDismissed: dismissedTaskIdSet.has(id),
      });
      const previousPercent = totalCount ? Math.round((completedCount / totalCount) * 100) : 0;
      const nextDoneCount = completedCount + 1;
      const nextPercent = totalCount ? Math.round((nextDoneCount / totalCount) * 100) : 100;
      const now = Date.now();
      const nextCombo = now - lastCompletionAtRef.current < 3600 ? Math.min(combo + 1, 4) : 1;
      const variants: CelebrationVariant[] = ["burst", "stamp", "jackpot", "massacre"];

      lastCompletionAtRef.current = now;
      setCombo(nextCombo);
      setCelebrationVariant(variants[celebrationNonce % variants.length]);
      setCelebrationNonce((current) => current + 1);
      if (comboTimerRef.current !== null) window.clearTimeout(comboTimerRef.current);
      comboTimerRef.current = window.setTimeout(() => {
        setCombo(0);
        comboTimerRef.current = null;
      }, 4200);

      const crossedMilestone = [25, 50, 75, 100].find((threshold) => (
        nextPercent >= threshold && previousPercent < threshold && !milestonesSeenRef.current.has(threshold)
      ));

      if (crossedMilestone) {
        milestonesSeenRef.current.add(crossedMilestone);
        setMilestone(crossedMilestone === 100 ? "LEVEL COMPLETE" : `${crossedMilestone}% UNLOCKED`);
        if (milestoneTimerRef.current !== null) window.clearTimeout(milestoneTimerRef.current);
        milestoneTimerRef.current = window.setTimeout(() => {
          setMilestone(null);
          milestoneTimerRef.current = null;
        }, crossedMilestone === 100 ? 2600 : 1700);
      }

      setCelebratingTaskId(id);
      setNotice(nextCombo >= 4 ? "Focus streak. Keep the sequence moving." : `${nextCombo}x momentum. Next move handled.`);

      if (isWheelFocusTask) {
        clearWheelTimers();
        setWheelChallenge(null);
        setWheelPhase("complete");
        setFocusEntryMode(wheelChallenge?.source ?? "wheel");
        setNotice(wheelChallenge?.expired
          ? "Task cleared after the buzzer. Still a win."
          : "Focus task cleared. You held the line.");
        wheelReturnTimerRef.current = window.setTimeout(() => {
          wheelReturnTimerRef.current = null;
          setWheelPhase("list");
          setFocusEntryMode("wheel");
          setWheelCandidates([]);
          setPendingWheelTaskId(null);
        }, 1400);
      }

      celebrationTimerRef.current = window.setTimeout(() => {
        setDismissedTaskIds((current) => {
          return current.includes(id) ? current : [...current, id];
        });
        setCelebratingTaskId(null);
        celebrationTimerRef.current = null;
      }, 1050);
    } else {
      if (undoCompletion?.id === id) clearUndoCompletion();
      setTaskHistory((current) => current.filter((entry) => entry.id !== id));
      lastCompletionAtRef.current = 0;
      setCombo(0);
      setDismissedTaskIds((current) => {
        return current.includes(id) ? current.filter((taskId) => taskId !== id) : current;
      });
      setCelebratingTaskId(null);
      setNotice("Task reopened.");
    }
  }

  function addTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = tidyTask(newTask);
    if (!title) return;
    setTasks((current) => [
      ...current,
      {
        id: createId(),
        title,
        color: colors[current.length % colors.length],
        completed: false,
        createdAt: Date.now(),
        completedAt: null,
      },
    ]);
    setNewTask("");
    setNotice("Added to the list.");
  }

  function clearCompleted() {
    const completedTasks = tasks.filter((task) => task.completed);
    if (undoCompletion && completedTasks.some((task) => task.id === undoCompletion.id)) {
      clearUndoCompletion();
    }
    if (completedTasks.length) {
      setTaskHistory((current) => mergeTaskHistory(current, completedTasks));
    }
    setTasks((current) => current.filter((task) => !task.completed));
    setNotice("Finished items cleared.");
  }

  function clearAllTasks() {
    clearUndoCompletion();
    setTaskHistory((current) => mergeTaskHistory(current, tasks));
    wheelRunIdRef.current += 1;
    clearWheelTimers();
    setTasks([]);
    setFilter("open");
    setDismissedTaskIds([]);
    setCombo(0);
    setWheelChallenge(null);
    setWheelPhase("list");
    setFocusEntryMode("wheel");
    setWheelCandidates([]);
    setPendingWheelTaskId(null);
    setWheelSettingsOpen(false);
    setNotice("All tasks removed.");
  }

  function clearTranscript() {
    if (isListening) stopListening();
    setTranscript("");
    setNotice("Dictated text cleared. Your task list is still here.");
  }

  function exportTaskHistory() {
    const records = mergeTaskHistory(taskHistory, tasks);
    const contents = formatTaskHistory(records);
    setTaskHistory(records);

    if (window.DictaTaskAndroid?.exportTaskHistory) {
      window.DictaTaskAndroid.exportTaskHistory(contents);
    } else {
      const blob = new Blob([contents], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "dictatask-task-history.txt";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    setNotice(`Exported ${records.length} task ${records.length === 1 ? "record" : "records"}.`);
  }

  toggleTaskRef.current = toggleTask;
  focusTaskRef.current = focusTaskDirectly;

  return (
    <main className={`app-shell juice-shell theme-${theme} ${milestone ? "has-milestone" : ""} ${celebratingTaskId ? "is-screen-celebrating" : ""}`} id="top">
      <div className="noise" aria-hidden="true" />
      {celebratingTaskId && <CelebrationBurst key={celebrationNonce} variant={celebrationVariant} nonce={celebrationNonce} />}
      {milestone && (
        <div className={`milestone-overlay ${milestone === "LEVEL COMPLETE" ? "is-final" : ""}`} role="status" aria-live="polite">
          <span className="milestone-kicker">PROGRESS UNLOCKED</span>
          <strong>{milestone}</strong>
          <span className="milestone-sub">{milestone === "LEVEL COMPLETE" ? "YOU CLEARED THE WHOLE BOARD" : "KEEP THE MOMENTUM"}</span>
        </div>
      )}
      <div className="top-banner" role="img" aria-label="DictaTask">
        <span className="top-banner-name" aria-hidden="true">
          <span className="top-banner-name-dicta">DICTA</span>
          <span className="top-banner-name-task">TASK</span>
        </span>
        <span className="top-banner-block top-banner-block-orange" />
        <span className="top-banner-block top-banner-block-blue" />
        <span className="top-banner-block top-banner-block-lime" />
      </div>
      <section className="workspace-grid juice-workspace" aria-label="Dictation workspace">
        <article className="transcript-card card-shadow juice-panel">
          <div className="recording-bar">
            <button
              className={`record-button ${isListening ? "is-listening" : ""}`}
              type="button"
              aria-label={isListening ? "Stop voice recording" : "Start a 30-second voice recording"}
              onClick={toggleListening}
            >
              <span className="record-button-icon"><Icon name="mic" /></span>
              <span className="record-button-copy">
                <strong>{isListening ? "LISTENING NOW" : "TAP TO RECORD"}</strong>
              </span>
              <span className="record-button-wave" aria-hidden="true"><i /><i /><i /><i /><i /></span>
              <span className="shortcut">{isListening ? `${String(RECORDING_LIMIT_SECONDS - recordingSeconds).padStart(2, "0")}s LEFT` : "30s MAX"}</span>
            </button>
            <span className="recording-hint">{isListening ? "Live transcript appears as you speak" : "or paste a transcription"}</span>
          </div>

          <div
            className={`recording-limit ${isListening ? "is-active" : ""}`}
            role="progressbar"
            aria-label="Voice recording time"
            aria-valuemin={0}
            aria-valuemax={RECORDING_LIMIT_SECONDS}
            aria-valuenow={isListening ? recordingSeconds : 0}
          >
            <span>{isListening ? `AUTO-STOPS IN ${String(RECORDING_LIMIT_SECONDS - recordingSeconds).padStart(2, "0")} SEC` : "VOICE SESSION: 30 SEC MAX"}</span>
            <span className="recording-progress"><i style={{ width: isListening ? `${(recordingSeconds / RECORDING_LIMIT_SECONDS) * 100}%` : "0%" }} /></span>
          </div>

          <textarea
            className="transcript-input"
            aria-label="Voice dictation transcript"
            value={transcript}
            onChange={(event) => setTranscript(event.target.value)}
            onBlur={flushTranscript}
            placeholder="Start talking about everything you need to do…"
            readOnly={isListening}
          />

          <div className="transcript-footer">
            <div className="transcript-footer-actions">
              <span className="character-count">{transcript.length} characters</span>
            </div>
            <span className="voice-wave" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /></span>
          </div>

          <div className="transcript-action-row">
            <button className="scan-button compact-scan-button" type="button" onClick={generateTasks} disabled={!transcript.trim() || isListening}>
              <span><Icon name="spark" /> CONVERT TO TASKS</span>
              <span className="button-arrow"><Icon name="arrow" /></span>
            </button>
            <button className="clear-transcript-button transcript-clear-action" type="button" onClick={clearTranscript} disabled={!transcript.trim()}>
              <Icon name="trash" /> CLEAR TEXT
            </button>
          </div>
          <form className="manual-task-card add-task-form" onSubmit={addTask}>
            <span className="add-icon manual-task-icon"><Icon name="plus" /></span>
            <label className={`manual-task-copy ${newTask ? "has-value" : ""} ${isManualDictating ? "is-dictating" : ""}`}>
              <strong>Add task manually…</strong>
              <input
                ref={manualTaskInputRef}
                value={newTask}
                onChange={(event) => setNewTask(event.target.value)}
                placeholder=""
                aria-label="New task"
              />
            </label>
            <button
              className={`manual-dictate-button ${isManualDictating ? "is-dictating" : ""}`}
              type="button"
              onClick={toggleManualDictation}
              aria-label={isManualDictating ? "Stop dictating the new task" : "Dictate the new task"}
              aria-pressed={isManualDictating}
            >
              <Icon name="mic" />
            </button>
            <button
              className="manual-submit-button"
              type="submit"
              disabled={!newTask.trim() || isManualDictating}
              aria-label="Add task"
            >
              <Icon name="arrow" />
            </button>
          </form>
          <span className="transcript-end-divider" aria-hidden="true" />
        </article>

        <article className={`tasks-card card-shadow juice-panel ${wheelPhase !== "list" ? "is-wheel-mode" : ""} ${wheelPhase === "converging" ? "is-wheel-converging" : ""}`}>
          <div className={`task-board-flip ${wheelPhase !== "list" ? "is-wheel-revealed" : ""}`}>
            <div className="task-board-face task-board-face-front" aria-hidden={wheelPhase !== "list"}>
              <div className="task-toolbar">
                <div className="filter-tabs" role="group" aria-label="Filter tasks">
                  {(["open", "done"] as Filter[]).map((item) => (
                    <button
                      className={filter === item ? "active" : ""}
                      key={item}
                      type="button"
                      aria-pressed={filter === item}
                      onClick={() => setFilter(item)}
                    >
                      {item === "open" ? "TO DO" : "DONE"}
                      <span>{item === "open" ? openCount : doneCount}</span>
                    </button>
                  ))}
                </div>
                <span className="task-sort">AUTO-SORTED ↕</span>
              </div>

              {undoCompletion && (
                <div className="undo-inline" role="status" aria-live="polite">
                  <div className="undo-inline-copy">
                    <strong>LAST MOVE</strong>
                    <span>{undoCompletion.title}</span>
                  </div>
                  <button
                    type="button"
                    onClick={undoLastCompletion}
                    aria-label={`Undo marking ${undoCompletion.title} done`}
                  >
                    UNDO
                  </button>
                </div>
              )}

              <div className="task-list">
                {filteredTasks.length ? (
                  filteredTasks.map((task, index) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      index={index}
                      daysOpen={getTaskOpenDays(
                        task.createdAt ?? createdAtByTaskId.get(task.id),
                        task.completed ? task.completedAt ?? taskAgeNow : taskAgeNow,
                      )}
                      celebrating={celebratingTaskId === task.id}
                      onToggle={handleTaskToggle}
                      onFocus={handleTaskFocus}
                    />
                  ))
                ) : (
                  <div className="empty-state">
                    <span className="empty-icon"><Icon name="check" /></span>
                    <strong>{filter === "done" ? "Nothing finished yet." : "Clean slate."}</strong>
                    <span>{filter === "done" ? "Check off a task and it will land here." : "Everything in this view is already handled."}</span>
                  </div>
                )}
              </div>

              <div className="task-actions task-actions-footer" aria-label="Task list actions">
                <button
                  className={`clear-button wheel-settings-button ${wheelSettingsOpen ? "is-open" : ""}`}
                  type="button"
                  onClick={() => setWheelSettingsOpen((open) => !open)}
                  aria-expanded={wheelSettingsOpen}
                  aria-controls="wheel-settings"
                >
                  <span>Focus clock</span><b>{wheelSettings.durationMinutes}m</b>
                </button>
                <button className="clear-button export-history-button" type="button" onClick={exportTaskHistory} disabled={!taskHistory.length && !tasks.length}>
                  <Icon name="download" /> Export .txt
                </button>
                <button className="clear-button" type="button" onClick={clearCompleted} disabled={!completedCount}>
                  <Icon name="trash" /> Clear done
                </button>
                <button className="clear-button remove-all-button" type="button" onClick={clearAllTasks} disabled={!tasks.length}>
                  <Icon name="trash" /> Remove all
                </button>
              </div>

              {wheelSettingsOpen && (
                  <section className="wheel-settings-inline" id="wheel-settings" aria-label="Focus countdown settings">
                    <div className="wheel-settings-copy">
                      <span>FOCUS CLOCK / SETTINGS</span>
                      <strong>Focus countdown</strong>
                      <small>Choose the clock for your next focus run.</small>
                  </div>
                  <div className="wheel-duration-options" role="group" aria-label="Focus countdown duration">
                    {WHEEL_DURATION_OPTIONS.map((minutes) => (
                      <button
                        className={wheelSettings.durationMinutes === minutes ? "is-selected" : ""}
                        key={minutes}
                        type="button"
                        aria-pressed={wheelSettings.durationMinutes === minutes}
                        onClick={() => {
                          setWheelSettings({ durationMinutes: minutes });
                          setNotice(`Focus clock set for ${minutes} minutes. It applies to your next focus run.`);
                        }}
                      >
                        {minutes} MIN
                      </button>
                    ))}
                  </div>
                </section>
              )}

            </div>

            <div className="task-board-face task-board-face-back" aria-hidden={wheelPhase === "list"}>
              <section className="wheel-stage" aria-label="Spin the Wheel focus challenge">
                <div className="wheel-stage-kicker">
                  <span>{focusEntryMode === "direct" ? "DIRECT FOCUS" : "SPIN THE WHEEL"}</span>
                  <span>FOCUS CLOCK · {wheelSettings.durationMinutes} MIN</span>
                </div>

                {wheelPhase !== "complete" && (
                  <button
                    className="wheel-cancel-button"
                    type="button"
                    onClick={() => putWheelAway()}
                    aria-label="Cancel focus and return to the current tasks"
                  >
                    <span aria-hidden="true">×</span> CANCEL / KEEP TASKS
                  </button>
                )}

                {focusEntryMode === "direct" ? (
                  wheelPhase === "challenge" && wheelFocusTask && (
                    <div className={`direct-focus-panel task-${wheelFocusTask.color}`} role="status">
                      <span>DIRECT FOCUS</span>
                      <strong>YOUR CHOICE</strong>
                      <small>No spin. Start with the task you picked.</small>
                    </div>
                  )
                ) : (
                  <div className={`wheel-machine ${wheelPhase === "spinning" ? "is-spinning" : ""}`}>
                    <span className="wheel-landing-marker">LAND HERE</span>
                    <div
                      ref={wheelRotorRef}
                      className={`wheel-rotor ${wheelPhase === "spinning" ? "is-spinning" : ""}`}
                      style={{
                        "--wheel-color-gradient": wheelColorGradient,
                        transform: `rotate(${wheelRotation}deg)`,
                      } as CSSProperties}
                      role="img"
                      aria-label="A colorful task-selection wheel"
                    >
                      <span className="wheel-color-field" aria-hidden="true" />
                      <img className="wheel-ink-overlay" src="./dictatask-wheel-face.jpg" alt="" />
                      <span className="wheel-light-sweep" aria-hidden="true" />
                      <span className="wheel-hub-mark" aria-hidden="true">SPIN</span>
                    </div>
                  </div>
                )}

                {(wheelPhase === "wheel" || wheelPhase === "spinning") && (
                  <div className="wheel-result-card is-spinning" role="status" aria-live="polite">
                    <span>{wheelPhase === "wheel" ? "LOCKING IN" : "THE WHEEL IS SPINNING"}</span>
                    <strong>One clean move is on its way.</strong>
                    <small>Keep your eyes on the landing mark.</small>
                  </div>
                )}

                {wheelPhase === "challenge" && wheelChallenge && wheelFocusTask && (
                  <div className={`wheel-result-card is-challenge ${wheelChallenge.expired ? "is-expired" : ""}`} role="status" aria-live="polite">
                    <span>{wheelChallenge.expired ? "TIME CALLED" : "FOCUS LOCKED"}</span>
                    <strong>{wheelFocusTask.title}</strong>
                    <FocusCountdown
                      key={`${wheelChallenge.taskId}-${wheelChallenge.startedAt}`}
                      challenge={wheelChallenge}
                      onExpire={handleWheelDeadline}
                    />
                    <small>{wheelChallenge.expired ? "Finish it anyway, or reset for another focused run." : "This is the only task that matters until the clock stops."}</small>
                    <div className="wheel-result-actions">
                      <button className="wheel-complete-button" type="button" onClick={() => toggleTask(wheelFocusTask.id)}>
                        {wheelChallenge.expired ? "MARK DONE ANYWAY" : "MARK COMPLETE"}
                      </button>
                      {wheelChallenge.expired && (
                        <button className="wheel-reroll-button" type="button" onClick={rerollWheel}>
                          RESET + SPIN
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {wheelPhase === "complete" && (
                  <div className="wheel-result-card is-complete" role="status" aria-live="polite">
                    <span>FOCUS CLEARED</span>
                    <strong>That was the move.</strong>
                    <small>Sending you back to the board.</small>
                  </div>
                )}
              </section>
            </div>
          </div>
        </article>

        {wheelPhase === "list" && (
          <section className="spin-launch-card juice-panel" aria-label="Focus selection">
            <button
              className="clear-button wheel-launch-button"
              type="button"
              onClick={spinTheWheel}
              disabled={!openCount}
              aria-label="Spin the wheel to choose an open task"
            >
              <span className="wheel-launch-art" aria-hidden="true"><img src="./dictatask-wheel-face.jpg" alt="" /></span>
              <span>Spin the wheel</span>
            </button>
          </section>
        )}
      </section>

    </main>
  );
}

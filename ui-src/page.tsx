"use client";

import type { CSSProperties, FormEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import {
  buildDailyTaskProgress,
  buildSevenDayTaskStats,
  createRecurrenceRule,
  formatRecurrenceLabel,
  formatTaskHistory as formatRecurringTaskHistory,
  getNextRecurrenceBoundary,
  isTaskActionable,
  mergeTaskHistory as mergeRecurringTaskHistory,
  normalizeTaskHistoryList,
  normalizeTaskList,
  reopenOccurrence,
  reconcileRecurringState,
  scheduledAtForOccurrence,
  stopRecurringSeries,
  taskMatchesFilters,
  type DailyTaskStat,
  type RecurrenceRule,
  type RepeatFrequency,
  type RepeatSelection,
  type Task,
  type TaskColor,
  type TaskHistoryEntry,
} from "./task-model";

type Filter = "open" | "done";
type Theme = "midnight" | "paper" | "sunset" | "ocean" | "grape";
type AppView = "board" | "settings";
type TranscriptionProvider = "device" | "groq";
type CelebrationVariant = "burst" | "stamp" | "jackpot" | "massacre";

type WheelSettings = {
  durationMinutes: number;
};

type AppSettings = {
  transcriptionProvider: TranscriptionProvider;
  groqModel: "whisper-large-v3-turbo" | "whisper-large-v3";
  groqLanguage: "auto" | "en" | "es" | "fr" | "de";
  recordingDurationSeconds: 15 | 30 | 60;
  showTaskAge: boolean;
  celebrationsEnabled: boolean;
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

type UndoCompletion = {
  id: string;
  title: string;
  previousTask: Task | null;
  previousHistory: TaskHistoryEntry | null;
  wasDismissed: boolean;
  seriesId: string | null;
  occurrenceIndex: number | null;
};

type UndoRemoveAll = {
  tasks: Task[];
  taskHistory: TaskHistoryEntry[];
  dismissedTaskIds: string[];
  filter: Filter;
};

type TaskDetailsDraft = {
  title: string;
  category: string;
  important: boolean;
  repeat: RepeatSelection;
  dailyTime: string;
  hourlyStart: string;
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
      startGroqRecording?: (model: string, language: string, durationSeconds: number) => void;
      stopGroqRecording?: () => void;
      setGroqApiKey?: (key: string) => void;
      clearGroqApiKey?: () => void;
      hasGroqApiKey?: () => boolean;
      setBackHandlerEnabled?: (enabled: boolean) => void;
    };
    __dictaSpeechResult?: (transcript: string, isFinal: boolean) => void;
    __dictaSpeechError?: (code: string) => void;
    __dictaSpeechEnd?: () => void;
    __dictaGroqResult?: (transcript: string) => void;
    __dictaGroqError?: (code: string) => void;
    __dictaGroqEnd?: () => void;
    __dictaBack?: () => void;
    __dictaGroqKeySaved?: (saved: boolean) => void;
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
const RECORDING_LIMIT_SECONDS = 30;
const RECOGNITION_RESTART_DELAY_MS = 350;
const EMPTY_STRING_ARRAY: string[] = [];
const TASK_AGE_REFRESH_PADDING_MS = 250;
const MAX_RECURRENCE_REFRESH_DELAY_MS = 60_000;
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
const defaultAppSettings: AppSettings = {
  transcriptionProvider: "device",
  groqModel: "whisper-large-v3-turbo",
  groqLanguage: "auto",
  recordingDurationSeconds: 30,
  showTaskAge: true,
  celebrationsEnabled: true,
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
  if (memoryValues.has(key)) return memoryValues.get(key) as T;
  const storage = getStorage();
  const isNative = typeof window.DictaTaskAndroid?.getStoredState === "function";
  const nativeRaw = isNative ? getNativeStoredRaw(key) : null;
  if (!storage && !nativeRaw && memoryValues.has(key)) return memoryValues.get(key) as T;
  let raw = nativeRaw;
  try { raw ??= storage?.getItem(key) ?? null; } catch { /* Restricted storage remains usable in memory. */ }
  const cached = storageSnapshots.get(key);
  if (cached?.raw === raw) return cached.value as T;

  let value = fallback;
  if (raw) {
    try {
      value = JSON.parse(raw) as T;
    } catch {
      // Leave malformed persisted bytes intact; a subsequent edit repairs them.
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
  const [stored, setPersisted] = useStoredState(key, fallback);
  const persisted = typeof stored === "string" ? stored : fallback;
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

  useEffect(() => {
    const onHidden = () => { if (document.visibilityState === "hidden") flush(); };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onHidden);
    };
  }, [flush]);

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

function normalizeTasks(value: unknown): Task[] {
  return normalizeTaskList(value, starterTasks);
}

function normalizeTaskHistory(value: unknown): TaskHistoryEntry[] {
  return normalizeTaskHistoryList(value, starterTaskHistory);
}

function normalizeTheme(value: unknown): Theme {
  if (value === "paper" || value === "light") return "paper";
  if (value === "sunset" || value === "ocean" || value === "grape") return value;
  return "midnight";
}

function normalizeAppSettings(value: unknown): AppSettings {
  if (!value || typeof value !== "object") return defaultAppSettings;
  const record = value as Record<string, unknown>;
  const provider: TranscriptionProvider = record.transcriptionProvider === "groq" ? "groq" : "device";
  const model = record.groqModel === "whisper-large-v3" ? "whisper-large-v3" : "whisper-large-v3-turbo";
  const language = ["auto", "en", "es", "fr", "de"].includes(String(record.groqLanguage))
    ? String(record.groqLanguage) as AppSettings["groqLanguage"]
    : "auto";
  const duration = Number(record.recordingDurationSeconds);
  const recordingDurationSeconds: AppSettings["recordingDurationSeconds"] = duration === 15 || duration === 60 ? duration : 30;
  return {
    transcriptionProvider: provider,
    groqModel: model,
    groqLanguage: language,
    recordingDurationSeconds,
    showTaskAge: record.showTaskAge !== false,
    celebrationsEnabled: record.celebrationsEnabled !== false,
  };
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

function mergeTaskHistory(current: TaskHistoryEntry[], tasks: Task[], now = Date.now()) {
  return mergeRecurringTaskHistory(current, tasks, now);
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
    return "conic-gradient(from 0deg, var(--task-tile-default-shadow) 0deg 360deg)";
  }

  const segmentAngle = 360 / tasks.length;
  const stops = tasks.map((task, index) => {
    const start = index * segmentAngle;
    const end = (index + 1) * segmentAngle;
    const color = WHEEL_TASK_COLOR_VARIABLES[task.color];
    return `${color} ${start.toFixed(2)}deg ${end.toFixed(2)}deg`;
  });

  return `conic-gradient(from 0deg, ${stops.join(", ")})`;
}

function getLocalDayNumber(timestamp: number) {
  const date = new Date(timestamp);
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000;
}

function getTaskOpenDays(createdAt: number | null | undefined, now: number) {
  if (!createdAt || !Number.isFinite(createdAt)) return 0;
  return Math.max(0, getLocalDayNumber(now) - getLocalDayNumber(createdAt));
}

function sortTasksNewestFirst<T extends { createdAt?: number | null }>(items: T[]) {
  return items
    .map((task, index) => ({ task, index }))
    .sort((left, right) => (
      (right.task.createdAt ?? 0) - (left.task.createdAt ?? 0)
      || right.index - left.index
    ))
    .map(({ task }) => task);
}

function formatTaskOpenAge(daysOpen: number, completed: boolean) {
  if (completed) {
    return `DONE ${daysOpen} ${daysOpen === 1 ? "DAY" : "DAYS"} AGO`;
  }
  return `OPEN ${daysOpen} ${daysOpen === 1 ? "DAY" : "DAYS"}`;
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

function padTimePart(value: number) {
  return String(value).padStart(2, "0");
}

function minutesToTimeInput(minutes: number) {
  const safeMinutes = Math.max(0, Math.min(1439, Math.round(minutes)));
  return `${padTimePart(Math.floor(safeMinutes / 60))}:${padTimePart(safeMinutes % 60)}`;
}

function localTimeInputValue(timestamp = Date.now()) {
  const date = new Date(timestamp);
  return minutesToTimeInput(date.getHours() * 60 + date.getMinutes());
}

function parseTimeInput(value: string, fallbackMinutes: number) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return fallbackMinutes;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return fallbackMinutes;
  return (hours * 60) + minutes;
}

function localDateTimeInputValue(timestamp: number) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${padTimePart(date.getMonth() + 1)}-${padTimePart(date.getDate())}T${padTimePart(date.getHours())}:${padTimePart(date.getMinutes())}`;
}

function nextWholeHour(timestamp: number) {
  const date = new Date(timestamp);
  date.setMinutes(0, 0, 0);
  date.setHours(date.getHours() + 1);
  return date.getTime();
}

function parseLocalDateTimeInput(value: string, fallbackTimestamp: number) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return fallbackTimestamp;
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    0,
    0,
  );
  return Number.isFinite(date.getTime()) ? date.getTime() : fallbackTimestamp;
}

function defaultTaskDetailsDraft(task: Task, now = Date.now()): TaskDetailsDraft {
  const recurrence = task.recurrence;
  const dailyMinutes = recurrence?.timeOfDayMinutes ?? (task.scheduledAt ? new Date(task.scheduledAt).getHours() * 60 + new Date(task.scheduledAt).getMinutes() : new Date(now).getHours() * 60 + new Date(now).getMinutes());
  return {
    title: task.title,
    category: task.category ?? "",
    important: task.important === true,
    repeat: recurrence?.frequency ?? "none",
    dailyTime: minutesToTimeInput(dailyMinutes),
    hourlyStart: localDateTimeInputValue(task.scheduledAt ?? recurrence?.anchorAt ?? nextWholeHour(now)),
  };
}

function recurrenceFromTaskDraft(
  draft: TaskDetailsDraft,
  task: Task | null,
  now: number,
): { recurrence: RecurrenceRule | null; scheduledAt: number | null; occurrenceIndex: number | null } {
  if (draft.repeat === "none") {
    return { recurrence: null, scheduledAt: null, occurrenceIndex: null };
  }

  const existing = task?.recurrence;
  const seriesId = existing?.seriesId ?? createId();
  if (draft.repeat === "daily") {
    const minutes = parseTimeInput(draft.dailyTime, new Date(now).getHours() * 60 + new Date(now).getMinutes());
    const baseTimestamp = existing?.anchorAt ?? now;
    const recurrence = createRecurrenceRule("daily", baseTimestamp, seriesId, minutes);
    const occurrenceIndex = task?.occurrenceIndex ?? 0;
    const scheduledAt = scheduledAtForOccurrence(recurrence, occurrenceIndex);
    return { recurrence, scheduledAt, occurrenceIndex };
  }

  const scheduledAt = parseLocalDateTimeInput(draft.hourlyStart, task?.scheduledAt ?? nextWholeHour(now));
  const recurrence = createRecurrenceRule("hourly", scheduledAt, seriesId, null);
  return { recurrence, scheduledAt, occurrenceIndex: 0 };
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

function Icon({ name }: { name: "mic" | "spark" | "arrow" | "plus" | "trash" | "check" | "wave" | "download" | "settings" | "back" }) {
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
  if (name === "settings") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" /><circle cx="12" cy="12" r="4" /></svg>;
  }
  if (name === "back") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12H5M11 6l-6 6 6 6" /></svg>;
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m5 12 4 4L19 6" />
    </svg>
  );
}

function TaskDetailsEditor({
  task,
  now,
  onSave,
  onClose,
  onStop,
  onDelete,
}: {
  task: Task;
  now: number;
  onSave: (draft: TaskDetailsDraft) => void;
  onClose: () => void;
  onStop: (() => void) | null;
  onDelete: (() => void) | null;
}) {
  const [draft, setDraft] = useState(() => defaultTaskDetailsDraft(task, now));

  useEffect(() => {
    setDraft(defaultTaskDetailsDraft(task, now));
  }, [now, task.id]);

  const updateDraft = <K extends keyof TaskDetailsDraft>(key: K, value: TaskDetailsDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  return (
    <form className="task-details-panel" onSubmit={(event) => { event.preventDefault(); onSave(draft); onClose(); }} aria-label={`Edit details for ${task.title}`}>
      <div className="task-details-heading">
        <div>
          <span> TASK DETAILS</span>
          <strong>{task.recurrence ? "SERIES-AWARE OCCURRENCE" : "ONE-OFF TASK"}</strong>
        </div>
        <button type="button" className="task-details-close" onClick={onClose} aria-label={`Close details for ${task.title}`}>×</button>
      </div>
      <div className="task-details-fields">
        <label>
          <span>TITLE</span>
          <input value={draft.title} onChange={(event) => updateDraft("title", event.target.value)} aria-label="Task title" />
        </label>
        <label>
          <span>CATEGORY <small>(OPTIONAL)</small></span>
          <input value={draft.category} maxLength={32} onChange={(event) => updateDraft("category", event.target.value)} placeholder="e.g. HOME" aria-label="Task category" />
        </label>
        <label className="task-important-toggle">
          <span>IMPORTANT</span>
          <input type="checkbox" checked={draft.important} onChange={(event) => updateDraft("important", event.target.checked)} />
          <i aria-hidden="true" />
        </label>
        <label>
          <span>REPEAT</span>
          <select value={draft.repeat} onChange={(event) => updateDraft("repeat", event.target.value as RepeatSelection)} aria-label="Repeat schedule">
            <option value="none">OFF</option>
            <option value="daily">DAILY</option>
            <option value="hourly">HOURLY</option>
          </select>
        </label>
        {draft.repeat === "daily" && (
          <label>
            <span>DAILY AT LOCAL TIME</span>
            <input type="time" value={draft.dailyTime} onChange={(event) => updateDraft("dailyTime", event.target.value)} aria-label="Daily local time" />
          </label>
        )}
        {draft.repeat === "hourly" && (
          <label>
            <span>HOURLY START</span>
            <input type="datetime-local" value={draft.hourlyStart} onChange={(event) => updateDraft("hourlyStart", event.target.value)} aria-label="Hourly schedule start" />
          </label>
        )}
      </div>
      <p className="task-details-schedule">
        {task.recurrence
          ? `Saved schedule: ${formatRecurrenceLabel(task, now)}. ${task.recurrence.active ? "The next completed occurrence creates one successor." : "Repeating is stopped."}`
          : "Repeating is off. Turn it on to keep one scheduled occurrence moving forward."}
      </p>
      <div className="task-details-actions">
        <button type="submit" className="task-details-save">SAVE DETAILS</button>
        {onStop && <button type="button" className="task-details-stop" onClick={onStop}>STOP REPEATING</button>}
        {onDelete && <button type="button" className="task-details-delete" onClick={onDelete}><Icon name="trash" /> DELETE</button>}
      </div>
    </form>
  );
}

function UpcomingTaskRow({
  task,
  now,
  onSave,
  onStop,
  onDelete,
}: {
  task: Task;
  now: number;
  onSave: (id: string, draft: TaskDetailsDraft) => void;
  onStop: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  return (
    <article className={`upcoming-task task-${task.color}`}>
      <div className="upcoming-task-copy">
        <span>UPCOMING OCCURRENCE</span>
        <strong>{task.title}</strong>
        <small>{formatRecurrenceLabel(task, now)}</small>
      </div>
      <div className="upcoming-task-actions">
        <button type="button" onClick={() => setDetailsOpen((open) => !open)} aria-expanded={detailsOpen} aria-label={`Edit details for upcoming ${task.title}`}>DETAILS</button>
        <button type="button" onClick={() => onStop(task.id)} aria-label={`Stop repeating ${task.title}`}>STOP</button>
      </div>
      {detailsOpen && <TaskDetailsEditor task={task} now={now} onSave={(draft) => onSave(task.id, draft)} onClose={() => setDetailsOpen(false)} onStop={() => onStop(task.id)} onDelete={() => onDelete(task.id)} />}
    </article>
  );
}

const TaskRow = memo(function TaskRow({
  task,
  index,
  daysOpen,
  now,
  showTaskAge,
  actionable,
  celebrating,
  onToggle,
  onFocus,
  onDelete,
  onSaveDetails,
  onStopRepeating,
}: {
  task: Task;
  index: number;
  daysOpen: number;
  now: number;
  showTaskAge: boolean;
  actionable: boolean;
  celebrating: boolean;
  onToggle: (id: string) => void;
  onFocus: (id: string) => void;
  onDelete: (id: string) => void;
  onSaveDetails: (id: string, draft: TaskDetailsDraft) => void;
  onStopRepeating: (id: string) => void;
}) {
  const historyOnly = task.historyOnly === true;
  const canDelete = !task.completed && !historyOnly;
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [isSwipeOpen, setIsSwipeOpen] = useState(false);
  const [isSwiping, setIsSwiping] = useState(false);
  const swipeStartRef = useRef<{
    x: number;
    y: number;
    offset: number;
    axis: "horizontal" | "vertical" | null;
    active: boolean;
  }>({ x: 0, y: 0, offset: 0, axis: null, active: false });
  const suppressClickRef = useRef(false);
  const suppressClickTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (suppressClickTimerRef.current !== null) {
      window.clearTimeout(suppressClickTimerRef.current);
    }
  }, []);

  const closeSwipe = useCallback(() => {
    setSwipeOffset(0);
    setIsSwipeOpen(false);
  }, []);

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!canDelete || (event.pointerType === "mouse" && event.button !== 0)) return;
    if (event.target instanceof Element && event.target.closest("button")) return;

    swipeStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      offset: swipeOffset,
      axis: null,
      active: true,
    };
  }, [canDelete, swipeOffset]);

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const start = swipeStartRef.current;
    if (!start.active) return;

    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    if (!start.axis) {
      if (Math.abs(deltaY) > Math.abs(deltaX) + 8) {
        start.active = false;
        setIsSwiping(false);
        closeSwipe();
        return;
      }
      if (Math.abs(deltaX) > 8) {
        start.axis = "horizontal";
        setIsSwiping(true);
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // Some older WebViews do not support pointer capture for every input type.
        }
      }
    }
    if (start.axis !== "horizontal") return;

    const nextOffset = Math.max(-116, Math.min(0, start.offset + deltaX));
    setSwipeOffset(nextOffset);
  }, [closeSwipe]);

  const handlePointerEnd = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const start = swipeStartRef.current;
    if (!start.active) return;
    start.active = false;
    setIsSwiping(false);

    if (start.axis !== "horizontal") {
      closeSwipe();
      return;
    }

    suppressClickRef.current = true;
    if (suppressClickTimerRef.current !== null) {
      window.clearTimeout(suppressClickTimerRef.current);
    }
    suppressClickTimerRef.current = window.setTimeout(() => {
      suppressClickRef.current = false;
      suppressClickTimerRef.current = null;
    }, 450);

    const deltaX = event.clientX - start.x;
    if (start.offset + deltaX <= -84) {
      setSwipeOffset(-116);
      setIsSwipeOpen(true);
    } else {
      closeSwipe();
    }
  }, [closeSwipe]);

  const handleRowClick = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.target instanceof Element && event.target.closest("button")) return;
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      if (suppressClickTimerRef.current !== null) {
        window.clearTimeout(suppressClickTimerRef.current);
        suppressClickTimerRef.current = null;
      }
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (isSwipeOpen) {
      event.stopPropagation();
      closeSwipe();
    }
  }, [closeSwipe, isSwipeOpen]);

  return (
    <div className={`task-swipe-shell task-${task.color} ${isSwiping ? "is-swiping" : ""} ${isSwipeOpen ? "is-swipe-open" : ""}`}>
      {canDelete && (
        <div className="task-delete-reveal" aria-hidden={!isSwipeOpen}>
          <button
            className="task-delete-action"
            type="button"
            disabled={!isSwipeOpen}
            onClick={(event) => {
              event.stopPropagation();
              onDelete(task.id);
            }}
            aria-label={`Delete ${task.title} without completing it`}
          >
            <Icon name="trash" />
            <span>DELETE</span>
          </button>
        </div>
      )}
      <div
        className={`task-row task-${task.color} ${task.completed ? "is-complete" : ""} ${historyOnly ? "is-history" : ""} ${celebrating ? "is-celebrating" : ""} ${isSwiping ? "is-swiping" : ""} ${isSwipeOpen ? "is-swipe-open" : ""}`}
        id={`task-${task.id}`}
        style={{
          "--task-stack-index": index,
          "--task-stack-offset": `${(2 - index) * 94}px`,
          "--task-swipe-offset": `${swipeOffset}px`,
        } as CSSProperties}
        onPointerDown={canDelete ? handlePointerDown : undefined}
        onPointerMove={canDelete ? handlePointerMove : undefined}
        onPointerUp={canDelete ? handlePointerEnd : undefined}
        onPointerCancel={canDelete ? handlePointerEnd : undefined}
        onClick={handleRowClick}
      >
        <button
          className={`task-checkbox ${task.completed ? "checked" : ""} ${celebrating ? "is-celebrating" : ""}`}
          type="button"
          role="checkbox"
          aria-checked={task.completed}
          aria-label={`${task.completed ? "Reopen" : "Complete"} ${task.title}`}
          onClick={(event) => {
            event.stopPropagation();
            onToggle(task.id);
          }}
        >
          {task.completed && <Icon name="check" />}
        </button>
        <div className="task-content">
          <span className="task-index">{String(index + 1).padStart(2, "0")}</span>
          <div>
                    <p className="task-title" data-title={task.title}>
                      {task.title}
                      <span className="task-title-strike" aria-hidden="true">{task.title}</span>
                    </p>
            <div className="task-detail-row">
               {showTaskAge && <div className="task-meta" aria-label={task.completed ? `${formatTaskOpenAge(daysOpen, true)} since completion` : `${formatTaskOpenAge(daysOpen, false)} since this task was created`}><span>{formatTaskOpenAge(daysOpen, task.completed)}</span></div>}
               {task.important && <span className="task-important-badge" aria-label="Important task">IMPORTANT</span>}
               {task.recurrence && <span className={`task-repeat-badge ${task.recurrence.active ? "is-active" : "is-stopped"}`} aria-label={task.recurrence.active ? "Repeating task" : "Repeating stopped"}>{task.recurrence.active ? "REPEAT" : "STOPPED"}</span>}
               {task.recurrence && <span className="task-schedule-label" title={formatRecurrenceLabel(task, now)}>{formatRecurrenceLabel(task, now)}</span>}
               {!task.completed && actionable && (
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
               <button className="task-details-trigger" type="button" onClick={(event) => { event.stopPropagation(); setDetailsOpen((open) => !open); }} aria-expanded={detailsOpen} aria-label={`${detailsOpen ? "Close" : "Open"} details for ${task.title}`}>
                 {detailsOpen ? "CLOSE" : "DETAILS"}
               </button>
             </div>
           </div>
        </div>
        <span className="task-badge">{historyOnly ? "HISTORY" : task.completed ? "DONE" : "NEXT"}</span>
         {canDelete && <span className="task-swipe" aria-hidden="true">←</span>}
       </div>
       {detailsOpen && <TaskDetailsEditor task={task} now={now} onSave={(draft) => onSaveDetails(task.id, draft)} onClose={() => setDetailsOpen(false)} onStop={task.recurrence?.active ? () => onStopRepeating(task.id) : null} onDelete={canDelete ? () => onDelete(task.id) : null} />}
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
  const totalSeconds = challenge.durationSeconds;
  const elapsedSeconds = Math.max(0, Math.min(totalSeconds, totalSeconds - remainingSeconds));
  const elapsedPercentage = totalSeconds ? Math.min(100, (elapsedSeconds / totalSeconds) * 100) : 0;
  return (
    <span className="focus-timer-wrap">
      <span
        className={`wheel-countdown ${expired ? "is-expired" : ""}`}
        role="timer"
        aria-label={expired ? "Focus timer ended" : `${remainingSeconds} seconds remaining`}
        aria-live="off"
      >
        {expired ? "TIME CALLED" : formatFocusCountdown(remainingSeconds)}
      </span>
      <span className="focus-progress-bar" role="progressbar" aria-label={`${formatFocusCountdown(elapsedSeconds)} elapsed of ${formatFocusCountdown(totalSeconds)}`} aria-valuemin={0} aria-valuemax={totalSeconds} aria-valuenow={elapsedSeconds}>
        <span style={{ width: `${elapsedPercentage}%` }} />
      </span>
      <span className="focus-progress-labels"><small>ELAPSED {formatFocusCountdown(elapsedSeconds)}</small><small>{expired ? "FINISHED" : `REMAINING ${formatFocusCountdown(remainingSeconds)}`}</small></span>
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

function SettingsToggle({ label, copy, checked, onChange }: { label: string; copy: string; checked: boolean; onChange: (next: boolean) => void }) {
  return <label className="settings-toggle"><span><strong>{label}</strong><small>{copy}</small></span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><i aria-hidden="true" /></label>;
}

function SettingsPage({ theme, setTheme, settings, setSettings, wheelSettings, setWheelSettings, groqKeySaved, onSaveGroqKey, onClearGroqKey, onBack }: {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  settings: AppSettings;
  setSettings: (next: AppSettings) => void;
  wheelSettings: WheelSettings;
  setWheelSettings: (next: WheelSettings) => void;
  groqKeySaved: boolean;
  onSaveGroqKey: (key: string) => void;
  onClearGroqKey: () => void;
  onBack: () => void;
}) {
  const [keyDraft, setKeyDraft] = useState("");
  const nativeGroqAvailable = typeof window.DictaTaskAndroid?.setGroqApiKey === "function";
  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => setSettings({ ...settings, [key]: value });
  const themes: Array<[Theme, string, string]> = [
    ["midnight", "MIDNIGHT", "INK / NEON / ELECTRIC"],
    ["paper", "PAPER", "NAVY / OCHRE / STUDIO"],
    ["sunset", "SUNSET", "PLUM / CORAL / GOLD"],
    ["ocean", "OCEAN", "NAVY / AQUA / MINT"],
    ["grape", "GRAPE", "PURPLE / CITRUS / CREAM"],
  ];
  return <section className="settings-page" aria-labelledby="settings-title">
    <div className="settings-page-topline"><button className="settings-back-button" type="button" onClick={onBack}><Icon name="back" /> BOARD</button><span>LOCAL CONTROL PANEL</span></div>
    <div className="settings-title-card"><span>DICTATASK / SETTINGS</span><h1 id="settings-title">MAKE IT YOURS.</h1><p>Preferences save on this device. Your Groq key stays in Android’s encrypted storage and is never copied into task data or exports.</p></div>
    <section className="settings-section" aria-labelledby="theme-settings-title"><div className="settings-section-heading"><span>01 / VISUAL SYSTEM</span><h2 id="theme-settings-title">THEME</h2></div><div className="theme-choice-grid" role="group" aria-label="App theme">{themes.map(([value, label, copy]) => <button className={`theme-choice theme-choice-${value} ${theme === value ? "is-selected" : ""}`} type="button" key={value} aria-pressed={theme === value} onClick={() => setTheme(value)}><span className="theme-choice-preview" aria-hidden="true"><i /><i /><i /><i /><i /></span><span className="theme-choice-copy"><strong>{label}</strong><small>{copy}</small></span><span className="theme-choice-state">{theme === value ? "ACTIVE" : "SELECT"}</span></button>)}</div></section>
    <section className="settings-section" aria-labelledby="transcription-settings-title"><div className="settings-section-heading"><span>02 / VOICE CAPTURE</span><h2 id="transcription-settings-title">TRANSCRIPTION</h2></div><div className="settings-option-grid"><label className="settings-field"><span>TRANSCRIPTION ENGINE</span><select value={settings.transcriptionProvider} onChange={(event) => update("transcriptionProvider", event.target.value === "groq" ? "groq" : "device")}><option value="device">DEVICE SPEECH</option><option value="groq">GROQ WHISPER</option></select><small>{settings.transcriptionProvider === "groq" ? "Records a short .m4a then sends it directly to Groq for transcription." : "Uses the device or browser speech service. No API key needed."}</small></label><label className="settings-field"><span>RECORDING LENGTH</span><select value={settings.recordingDurationSeconds} onChange={(event) => update("recordingDurationSeconds", Number(event.target.value) as AppSettings["recordingDurationSeconds"])}><option value="15">15 SECONDS</option><option value="30">30 SECONDS</option><option value="60">60 SECONDS</option></select><small>Applies to the main Tap to Record capture. Groq audio is deleted after each request.</small></label></div>{settings.transcriptionProvider === "groq" && <div className="groq-settings-card"><div className="groq-settings-heading"><div><span>GROQ CLOUD TRANSCRIPTION</span><strong>{groqKeySaved ? "KEY CONNECTED" : "KEY REQUIRED"}</strong></div><i className={groqKeySaved ? "is-connected" : ""} aria-label={groqKeySaved ? "Groq API key saved" : "Groq API key not saved"} /></div>{!nativeGroqAvailable && <p className="settings-warning">Groq capture is available in the Android app. The browser preview uses device speech instead.</p>}<div className="settings-option-grid"><label className="settings-field"><span>WHISPER MODEL</span><select value={settings.groqModel} onChange={(event) => update("groqModel", event.target.value === "whisper-large-v3" ? "whisper-large-v3" : "whisper-large-v3-turbo")}><option value="whisper-large-v3-turbo">WHISPER LARGE V3 TURBO</option><option value="whisper-large-v3">WHISPER LARGE V3</option></select><small>Turbo is the fast default. Large V3 prioritizes accuracy.</small></label><label className="settings-field"><span>SPOKEN LANGUAGE</span><select value={settings.groqLanguage} onChange={(event) => update("groqLanguage", event.target.value as AppSettings["groqLanguage"])}><option value="auto">AUTO DETECT</option><option value="en">ENGLISH</option><option value="es">SPANISH</option><option value="fr">FRENCH</option><option value="de">GERMAN</option></select><small>Specifying a language can reduce latency and improve recognition.</small></label></div><label className="settings-field groq-key-field"><span>GROQ API KEY</span><div className="key-input-row"><input value={keyDraft} onChange={(event) => setKeyDraft(event.target.value)} type="password" autoComplete="off" spellCheck={false} placeholder={groqKeySaved ? "Saved securely — enter a replacement" : "gsk_…"} aria-label="Groq API key" /><button type="button" onClick={() => { onSaveGroqKey(keyDraft); setKeyDraft(""); }} disabled={!keyDraft.trim()}>SAVE KEY</button>{groqKeySaved && <button className="danger" type="button" onClick={onClearGroqKey}>REMOVE</button>}</div><small>The key is encrypted by Android Keystore before it is written to private app storage. It is used only for the Groq transcription request.</small></label></div>}</section>
    <section className="settings-section" aria-labelledby="workflow-settings-title"><div className="settings-section-heading"><span>03 / WORKFLOW</span><h2 id="workflow-settings-title">TASK FLOW</h2></div><div className="settings-option-grid"><label className="settings-field"><span>DEFAULT FOCUS CLOCK</span><select value={wheelSettings.durationMinutes} onChange={(event) => setWheelSettings({ durationMinutes: Number(event.target.value) })}>{WHEEL_DURATION_OPTIONS.map((minutes) => <option value={minutes} key={minutes}>{minutes} MINUTES</option>)}</select><small>Used by direct focus and Spin the Wheel.</small></label><SettingsToggle label="SHOW TASK AGE" copy="Displays OPEN X DAYS and DONE X DAYS AGO on cards." checked={settings.showTaskAge} onChange={(value) => update("showTaskAge", value)} /><SettingsToggle label="COMPLETION CELEBRATION" copy="Plays the short confetti finish after a task is checked off." checked={settings.celebrationsEnabled} onChange={(value) => update("celebrationsEnabled", value)} /></div></section>
  </section>;
}

export default function Home() {
  const [transcript, setTranscript, flushTranscript] = useDebouncedStoredString("dictatask-transcript", starterTranscript);
  const [tasks, setTasks] = useNormalizedStoredState("dictatask-tasks", starterTasks, normalizeTasks);
  const [taskHistory, setTaskHistory] = useNormalizedStoredState("dictatask-task-history", starterTaskHistory, normalizeTaskHistory);
  const [theme, setTheme] = useNormalizedStoredState("dictatask-theme", "midnight" as Theme, normalizeTheme);
  const [appSettings, setAppSettings] = useNormalizedStoredState("dictatask-app-settings", defaultAppSettings, normalizeAppSettings);
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
  const [searchQuery, setSearchQuery] = useState("");
  const [importantOnly, setImportantOnly] = useState(false);
  const [repeatingOnly, setRepeatingOnly] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [visibleTaskLimit, setVisibleTaskLimit] = useState(30);
  const [view, setView] = useState<AppView>("board");
  const [newTask, setNewTask] = useState("");
  const [newTaskRepeat, setNewTaskRepeat] = useState<RepeatSelection>("none");
  const [newTaskDailyTime, setNewTaskDailyTime] = useState(() => localTimeInputValue());
  const [newTaskHourlyStart, setNewTaskHourlyStart] = useState(() => localDateTimeInputValue(nextWholeHour(Date.now())));
  const [newTaskCategory, setNewTaskCategory] = useState("");
  const [newTaskImportant, setNewTaskImportant] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isGroqTranscribing, setIsGroqTranscribing] = useState(false);
  const [groqKeySaved, setGroqKeySaved] = useState(false);
  const [isManualDictating, setIsManualDictating] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 8000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  const [undoCompletion, setUndoCompletion] = useState<UndoCompletion | null>(null);
  const [removeAllConfirmOpen, setRemoveAllConfirmOpen] = useState(false);
  const [undoRemoveAll, setUndoRemoveAll] = useState<UndoRemoveAll | null>(null);
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
  const deleteTaskRef = useRef<(id: string) => void>(() => undefined);
  const saveTaskDetailsRef = useRef<(id: string, draft: TaskDetailsDraft) => void>(() => undefined);
  const stopRepeatingRef = useRef<(id: string) => void>(() => undefined);
  const handleTaskToggle = useCallback((id: string) => toggleTaskRef.current(id), []);
  const handleTaskFocus = useCallback((id: string) => focusTaskRef.current(id), []);
  const handleTaskDelete = useCallback((id: string) => deleteTaskRef.current(id), []);
  const handleTaskDetailsSave = useCallback((id: string, draft: TaskDetailsDraft) => saveTaskDetailsRef.current(id, draft), []);
  const handleStopRepeating = useCallback((id: string) => stopRepeatingRef.current(id), []);

  useEffect(() => {
    window.__dictaGroqKeySaved = (saved) => {
      setGroqKeySaved(saved);
      setNotice(saved ? "Groq key saved." : "Could not save the key. Please try again.");
    };
    return () => { delete window.__dictaGroqKeySaved; };
  }, []);

  useEffect(() => {
    window.__dictaBack = () => {
      if (view === "settings") setView("board");
      else if (removeAllConfirmOpen) setRemoveAllConfirmOpen(false);
      else if (wheelPhase !== "list") putWheelAway();
    };
    window.DictaTaskAndroid?.setBackHandlerEnabled?.(view === "settings" || removeAllConfirmOpen || wheelPhase !== "list");
    return () => { delete window.__dictaBack; };
  }, [view, removeAllConfirmOpen, wheelPhase]);
  const colorScheme = theme === "paper" ? "light" : "dark";
  const themeChromeColor = theme === "paper"
    ? "#f0e2c2"
    : theme === "sunset"
      ? "#4a2030"
      : theme === "ocean"
        ? "#06395d"
        : theme === "grape"
          ? "#3c245c"
          : "#0d0d12";
  const recordingLimitSeconds = appSettings.recordingDurationSeconds;
  const recordingProgress = isListening
    ? Math.min(100, (recordingSeconds / recordingLimitSeconds) * 100)
    : 0;

  useEffect(() => {
    document.documentElement.dataset.dictataskTheme = theme;
    document.documentElement.style.colorScheme = colorScheme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute(
      "content",
      themeChromeColor,
    );
    window.DictaTaskAndroid?.setColorScheme?.(colorScheme);
    return () => {
      delete document.documentElement.dataset.dictataskTheme;
      document.documentElement.style.removeProperty("color-scheme");
    };
  }, [colorScheme, theme, themeChromeColor]);

  useEffect(() => {
    try {
      setGroqKeySaved(Boolean(window.DictaTaskAndroid?.hasGroqApiKey?.()));
    } catch {
      setGroqKeySaved(false);
    }
  }, [view]);

  useEffect(() => {
    let timer: number | null = null;
    const refresh = () => setTaskAgeNow(Date.now());
    const scheduleNextRefresh = () => {
      const now = Date.now();
      const boundary = getNextRecurrenceBoundary(tasks, now);
      const delay = boundary
        ? Math.min(MAX_RECURRENCE_REFRESH_DELAY_MS, Math.max(1000, boundary - now + 80))
        : getNextLocalMidnightDelay(now);
      timer = window.setTimeout(() => {
        refresh();
        scheduleNextRefresh();
      }, delay);
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };

    refresh();
    scheduleNextRefresh();
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("focus", refreshWhenVisible);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("focus", refreshWhenVisible);
    };
  }, [tasks]);

  useEffect(() => {
    const reconciled = reconcileRecurringState(tasks, taskHistory, taskAgeNow);
    if (JSON.stringify(reconciled.tasks) !== JSON.stringify(tasks)) setTasks(reconciled.tasks);
    if (JSON.stringify(reconciled.history) !== JSON.stringify(taskHistory)) setTaskHistory(reconciled.history);
  }, [setTaskHistory, setTasks, taskAgeNow, taskHistory, tasks]);

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
      ]));
      return next.length === current.length && next.every((id, index) => id === current[index])
        ? current
        : next;
    });
  }, [setDismissedTaskIds, tasks]);

  const allOpenTasks = useMemo(() => sortTasksNewestFirst(tasks.filter((task) => !task.completed)), [tasks]);
  const openCount = allOpenTasks.length;
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
      ));
  }, [taskHistory, tasks]);
  const doneCount = doneHistoryTasks.length;

  const dailyProgress = useMemo(
    () => buildDailyTaskProgress(tasks, taskHistory, taskAgeNow),
    [taskAgeNow, taskHistory, tasks],
  );
  const categoryOptions = useMemo(() => Array.from(new Set(
    [...tasks, ...taskHistory]
      .map((task) => task.category?.trim())
      .filter((category): category is string => Boolean(category)),
  )).sort((left, right) => left.localeCompare(right)), [taskHistory, tasks]);
  const taskFilters = useMemo(() => ({
    query: searchQuery,
    importantOnly,
    repeatingOnly,
    category: categoryFilter,
  }), [categoryFilter, importantOnly, repeatingOnly, searchQuery]);

  const sevenDayTaskStats = useMemo(
    () => buildSevenDayTaskStats(taskHistory, taskAgeNow),
    [taskAgeNow, taskHistory],
  );
  const sevenDayMax = Math.max(
    1,
    ...sevenDayTaskStats.flatMap((stat) => [stat.added, stat.completed]),
  );
  const sevenDayAddedTotal = sevenDayTaskStats.reduce((total, stat) => total + stat.added, 0);
  const sevenDayCompletedTotal = sevenDayTaskStats.reduce((total, stat) => total + stat.completed, 0);

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
  const matchingOpenTasks = useMemo(() => allOpenTasks.filter((task) => taskMatchesFilters(task, taskFilters)), [allOpenTasks, taskFilters]);
  const matchingDoneTasks = useMemo(() => doneHistoryTasks.filter((task) => taskMatchesFilters(task, taskFilters)), [doneHistoryTasks, taskFilters]);
  const actionableOpenTasks = useMemo(() => matchingOpenTasks.filter((task) => isTaskActionable(task, taskAgeNow)), [matchingOpenTasks, taskAgeNow]);
  const filteredTasks = useMemo(() => {
    if (filter === "done") return matchingDoneTasks;
    return actionableOpenTasks.filter((task) => task.id === celebratingTaskId || !dismissedTaskIdSet.has(task.id));
  }, [actionableOpenTasks, celebratingTaskId, dismissedTaskIdSet, filter, matchingDoneTasks]);
  const upcomingTasks = useMemo(() => matchingOpenTasks.filter((task) => !isTaskActionable(task, taskAgeNow)), [matchingOpenTasks, taskAgeNow]);
  const filteredMatchingCount = filter === "done" ? matchingDoneTasks.length : matchingOpenTasks.length;
  const visibleFilteredTasks = filteredTasks.slice(0, visibleTaskLimit);
  const visibleUpcomingTasks = upcomingTasks.slice(0, visibleTaskLimit);
  const hasActiveFilters = Boolean(searchQuery.trim() || importantOnly || repeatingOnly || categoryFilter);
  const clearFilters = useCallback(() => {
    setSearchQuery("");
    setImportantOnly(false);
    setRepeatingOnly(false);
    setCategoryFilter("");
  }, []);
  useEffect(() => {
    setVisibleTaskLimit(30);
  }, [categoryFilter, filter, importantOnly, repeatingOnly, searchQuery]);

  const emptyStateTitle = filter === "done"
    ? doneHistoryTasks.length ? "NO MATCHES." : "NOTHING FINISHED YET."
    : openCount === 0
      ? "CLEAN SLATE."
      : matchingOpenTasks.length === 0
        ? "NO MATCHES."
        : actionableOpenTasks.length === 0
          ? "NO READY TASKS."
          : "CELEBRATION IN PROGRESS.";
  const emptyStateCopy = filter === "done"
    ? doneHistoryTasks.length ? "Try another title, category, or filter." : "Check off a task and it will land here."
    : openCount === 0
      ? "Add a task above to start the board."
      : matchingOpenTasks.length === 0
        ? "Try another title, category, or filter."
        : actionableOpenTasks.length === 0
          ? "Upcoming repeating work is kept below in its collapsed schedule."
          : "The last move is still finishing. Your task will return shortly.";

  const wheelEligibleTasks = useMemo(() => filter === "open"
    ? actionableOpenTasks.filter((task) => task.id === celebratingTaskId || !dismissedTaskIdSet.has(task.id))
    : [], [actionableOpenTasks, celebratingTaskId, dismissedTaskIdSet, filter]);
  const wheelTaskPool = wheelCandidates.length ? wheelCandidates : wheelEligibleTasks;
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
       setWheelCandidates((current) => current.length ? current : wheelEligibleTasks);
      setPendingWheelTaskId(activeTask.id);
      setWheelPhase("challenge");
    }
  }, [setWheelChallenge, tasks, wheelChallenge, wheelEligibleTasks, wheelPhase]);

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

  function finishGroqCapture(message: string) {
    setIsListening(false);
    setRecordingSeconds(0);
    setIsGroqTranscribing(true);
    window.DictaTaskAndroid?.stopGroqRecording?.();
    setNotice(message);
  }

  useEffect(() => {
    const previousGroqResult = window.__dictaGroqResult;
    const previousGroqError = window.__dictaGroqError;
    const previousGroqEnd = window.__dictaGroqEnd;
    window.__dictaGroqResult = (spoken) => { if (spoken.trim()) setTranscript([voiceBufferRef.current.trim(), spoken.trim()].filter(Boolean).join(" ")); };
    window.__dictaGroqError = (code) => setNotice(code === "api-key" ? "Groq rejected the saved key. Update it in Settings." : code === "network" ? "Groq could not be reached. Check your connection and try again." : code === "no-speech" ? "No speech was captured. Try again closer to the mic." : "Groq could not transcribe that recording. Try again.");
    window.__dictaGroqEnd = () => { setIsListening(false); setIsGroqTranscribing(false); setRecordingSeconds(0); };
    return () => { window.__dictaGroqResult = previousGroqResult; window.__dictaGroqError = previousGroqError; window.__dictaGroqEnd = previousGroqEnd; };
  }, []);

  useEffect(() => {
    if (!isListening) return;

    const timer = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - recordingStartedAtRef.current) / 1000);
      if (elapsed >= recordingLimitSeconds) {
        if (appSettings.transcriptionProvider === "groq" && groqKeySaved && window.DictaTaskAndroid?.stopGroqRecording) {
          finishGroqCapture("Recording complete. Groq is transcribing it now.");
        } else {
          finishListening(`${recordingLimitSeconds}-second voice note complete. Scan it whenever you are ready.`);
        }
        return;
      }
      setRecordingSeconds(elapsed);
    }, 1000);

    return () => window.clearInterval(timer);
  }, [appSettings.transcriptionProvider, groqKeySaved, isListening, recordingLimitSeconds]);

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
    const eligibleTasks = wheelEligibleTasks;
    if (!eligibleTasks.length) {
      setNotice(filter === "done"
        ? "Switch to TO DO to choose an actionable task."
        : hasActiveFilters
          ? "No filtered actionable tasks are ready for the wheel."
          : "Add an open task before you spin the wheel.");
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
    const targetRotation = startRotation + (8 * 360) + alignment;
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
            // A short wind-up makes the spin readable before it accelerates,
            // then a long ease-out gives the landing marker a satisfying finish.
            const windUpEnd = 0.12;
            const windUpDistance = 0.08;
            const easedProgress = progress < windUpEnd
              ? windUpDistance * Math.pow(progress / windUpEnd, 2)
              : windUpDistance + ((1 - windUpDistance) * (1 - Math.pow(1 - ((progress - windUpEnd) / (1 - windUpEnd)), 4)));
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
    if (!selectedTask || !isTaskActionable(selectedTask, Date.now())) {
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
    // IDs, not titles, define task identity. A repeated occurrence and two
    // valid requests with the same wording must remain separate records.
    const additions = nextTasks;
    const isDemoList = tasks.length === starterTasks.length && tasks.every((task, index) => (
      task.id === starterTasks[index]?.id && task.completed === starterTasks[index]?.completed
    ));

    if (!additions.length) {
      setNotice("Those tasks are already on your list.");
      return;
    }

    const nextBoard = [...(isDemoList ? [] : tasks), ...additions];
    setTasks(nextBoard);
    setTaskHistory((current) => mergeTaskHistory(current, additions, Date.now()));
    setFilter("open");
    setNotice(`${additions.length} new ${additions.length === 1 ? "task" : "tasks"} added. Your dictated text is still here.`);
  }

  function stopListening(message = "Voice note stopped. Scan it whenever you are ready.") {
    finishListening(message);
  }

  function toggleListening() {
    if (isGroqTranscribing) return;
    if (isManualDictating) { setNotice("Stop task dictation before recording a voice note."); return; }
    if (isListening) {
      if (appSettings.transcriptionProvider === "groq" && window.DictaTaskAndroid?.stopGroqRecording) {
        finishGroqCapture("Recording stopped. Groq is transcribing it now.");
        return;
      }
      stopListening();
      return;
    }

    if (appSettings.transcriptionProvider === "groq") {
      if (!groqKeySaved) {
        setView("settings");
        setNotice("Add your Groq API key in Settings before using Groq transcription.");
        return;
      }
      if (!window.DictaTaskAndroid?.startGroqRecording) {
        setNotice("Groq capture is available in the installed Android app. This browser preview uses device speech.");
        return;
      }
      voiceBufferRef.current = transcript.trim() === starterTranscript ? "" : transcript.trim();
      recordingStartedAtRef.current = Date.now();
      setRecordingSeconds(0);
      setIsListening(true);
      setNotice("Recording for Groq. The transcript arrives after you stop.");
      window.DictaTaskAndroid.startGroqRecording(appSettings.groqModel, appSettings.groqLanguage === "auto" ? "" : appSettings.groqLanguage, recordingLimitSeconds);
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
        keepListeningRef.current = false;
        setIsListening(false);
        setRecordingSeconds(0);

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
          setNotice("No speech was captured. Tap the microphone to try again.");
        }
      };
      recognition.onend = () => {
        if (sessionId !== voiceSessionRef.current || recognitionRef.current !== recognition) return;

        commitPendingSpeech(true);
        if (keepListeningRef.current) {
          const elapsed = (Date.now() - recordingStartedAtRef.current) / 1000;
          finishListening(elapsed >= recordingLimitSeconds
            ? `${recordingLimitSeconds}-second voice note complete. Scan it whenever you are ready.`
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
    if (manualRecognitionTimerRef.current !== null) {
      window.clearTimeout(manualRecognitionTimerRef.current);
      manualRecognitionTimerRef.current = null;
    }

    const recognition = recognitionRef.current;
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

    if (isListening || isGroqTranscribing) {
      setNotice("Finish the voice recording before dictating a task.");
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
      setIsManualDictating(false);
      setNotice("Finishing task dictation…");
    }, RECORDING_LIMIT_SECONDS * 1000);

    try {
      recognition.start();
    } catch {
      finishManualSession("I could not start the microphone. You can still type the task.");
    }
  }

  function saveTaskDetails(id: string, draft: TaskDetailsDraft) {
    const task = tasks.find((item) => item.id === id) ?? doneHistoryTasks.find((item) => item.id === id);
    if (!task) return;
    const title = draft.title.trim();
    if (!title) {
      setNotice("A task needs a title before it can be saved.");
      return;
    }

    const now = Date.now();
    let nextTasks: Task[] = tasks.map((item) => ({ ...item, recurrence: item.recurrence ? { ...item.recurrence } : null }));
    let nextHistory: TaskHistoryEntry[] = taskHistory.map((entry) => ({ ...entry, recurrence: entry.recurrence ? { ...entry.recurrence } : null }));
    const currentSeriesId = task.recurrence?.seriesId ?? null;
    const existingHistoryEntry = nextHistory.find((entry) => entry.id === id);
    if (draft.repeat === "none" && currentSeriesId) {
      const stopped = stopRecurringSeries(nextTasks, nextHistory, currentSeriesId, task.completed ? null : id, now);
      nextTasks = stopped.tasks;
      nextHistory = stopped.history;
    }

    const recurrenceDetails = recurrenceFromTaskDraft(draft, task, now);
    const updated = {
      ...task,
      createdAt: task.createdAt ?? existingHistoryEntry?.createdAt ?? now,
      completed: task.completed,
      completedAt: task.completed ? task.completedAt ?? existingHistoryEntry?.completedAt ?? now : null,
      title,
      category: draft.category.trim().replace(/\s+/g, " ").slice(0, 32) || null,
      important: draft.important,
      recurrence: recurrenceDetails.recurrence,
      scheduledAt: recurrenceDetails.scheduledAt,
      occurrenceIndex: recurrenceDetails.occurrenceIndex,
      historyOnly: false,
    };
    if (task.completed) {
      if (nextTasks.some((item) => item.id === id)) {
        nextTasks = nextTasks.map((item) => item.id === id ? { ...updated } : item);
      } else if (recurrenceDetails.recurrence) {
        // Editing a history-only DONE row can intentionally restart its series,
        // but a metadata/title edit must never silently reopen a completed record.
        nextTasks = [...nextTasks, { ...updated }];
      }
      nextHistory = [
        ...nextHistory.filter((entry) => entry.id !== id),
        {
          ...updated,
          historyOnly: true,
          createdAt: updated.createdAt ?? now,
          completedAt: updated.completedAt ?? now,
        },
      ];
      nextHistory = mergeTaskHistory(nextHistory, nextTasks, now);
    } else {
      if (nextTasks.some((item) => item.id === id)) {
        nextTasks = nextTasks.map((item) => item.id === id ? { ...updated } : item);
      } else {
        nextTasks = [...nextTasks, { ...updated, completed: false, completedAt: null }];
      }
      nextHistory = mergeTaskHistory(nextHistory.filter((entry) => entry.id !== id), nextTasks, now);
    }
    setTasks(nextTasks);
    setTaskHistory(nextHistory);
    setUndoRemoveAll(null);
    setRemoveAllConfirmOpen(false);
    setFilter(task.completed ? "done" : "open");
    setNotice(updated.recurrence
      ? `${title} now repeats ${updated.recurrence.frequency === "daily" ? "daily" : "hourly"}.`
      : `${title} saved as a one-off task.`);
  }

  function stopRepeating(id: string) {
    const task = tasks.find((item) => item.id === id);
    const seriesId = task?.recurrence?.seriesId;
    if (!task || !seriesId) return;
    const now = Date.now();
    const stopped = stopRecurringSeries(tasks, taskHistory, seriesId, task.completed ? null : id, now);
    setTasks(stopped.tasks);
    setTaskHistory(stopped.history);
    setNotice(`Repeating stopped for ${task.title}. The current task stays on your board.`);
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

    const reopened = reopenOccurrence(tasks, taskHistory, action.id, Date.now());
    setTasks(reopened.tasks);
    setTaskHistory(reopened.history);
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
    if (undoRemoveAll) setUndoRemoveAll(null);
    setRemoveAllConfirmOpen(false);
    const task = tasks.find((item) => item.id === id) ?? doneHistoryTasks.find((item) => item.id === id);
    if (!task) return;
    const willComplete = !task.completed;
    const isWheelFocusTask = willComplete && wheelChallenge?.taskId === id;
    const completionTimestamp = willComplete ? Date.now() : null;

    if (celebrationTimerRef.current !== null) {
      window.clearTimeout(celebrationTimerRef.current);
      celebrationTimerRef.current = null;
    }
    if (!willComplete) {
      const reopened = reopenOccurrence(tasks, taskHistory, id, Date.now());
      setTasks(reopened.tasks);
      setTaskHistory(reopened.history);
      if (undoCompletion?.id === id) clearUndoCompletion();
      lastCompletionAtRef.current = 0;
      setCombo(0);
      setDismissedTaskIds((current) => current.filter((taskId) => taskId !== id));
      setCelebratingTaskId(null);
      setNotice("Task reopened. Later completed occurrences stay in DONE.");
      return;
    }

    const nextTasks = tasks.some((item) => item.id === id)
      ? tasks.map((item) => item.id === id
        ? { ...item, completed: true, completedAt: completionTimestamp }
        : item)
      : [...tasks, {
          ...task,
          completed: true,
          completedAt: completionTimestamp,
          historyOnly: false,
        }];
    setTasks(nextTasks);
    setTaskHistory((current) => mergeTaskHistory(current, nextTasks, completionTimestamp ?? Date.now()));

    if (willComplete) {
      setUndoCompletion({
        id,
        title: task?.title ?? "Task",
        previousTask: tasks.find((item) => item.id === id) ?? null,
        previousHistory: taskHistory.find((entry) => entry.id === id) ?? null,
        wasDismissed: dismissedTaskIdSet.has(id),
        seriesId: task.recurrence?.seriesId ?? null,
        occurrenceIndex: task.occurrenceIndex ?? null,
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

      if (crossedMilestone && appSettings.celebrationsEnabled) {
        milestonesSeenRef.current.add(crossedMilestone);
        setMilestone(crossedMilestone === 100 ? "LEVEL COMPLETE" : `${crossedMilestone}% UNLOCKED`);
        if (milestoneTimerRef.current !== null) window.clearTimeout(milestoneTimerRef.current);
        milestoneTimerRef.current = window.setTimeout(() => {
          setMilestone(null);
          milestoneTimerRef.current = null;
        }, crossedMilestone === 100 ? 2600 : 1700);
      }

      setCelebratingTaskId(appSettings.celebrationsEnabled ? id : null);
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
      }, appSettings.celebrationsEnabled ? 1050 : 0);
    }
  }

  function deleteTask(id: string) {
    const task = tasks.find((item) => item.id === id);
    if (!task || task.completed) return;

    if (undoRemoveAll) setUndoRemoveAll(null);
    setRemoveAllConfirmOpen(false);

    if (undoCompletion?.id === id) clearUndoCompletion();
    if (celebrationTimerRef.current !== null) {
      window.clearTimeout(celebrationTimerRef.current);
      celebrationTimerRef.current = null;
    }
    if (celebratingTaskId === id) setCelebratingTaskId(null);

    if (wheelFocusTaskId === id) {
      wheelRunIdRef.current += 1;
      clearWheelTimers();
      setWheelChallenge(null);
      setWheelPhase("list");
      setFocusEntryMode("wheel");
      setWheelCandidates([]);
      setPendingWheelTaskId(null);
      setWheelSettingsOpen(false);
    }

    const now = Date.now();
    const stopped = task.recurrence?.seriesId
      ? stopRecurringSeries(tasks, taskHistory, task.recurrence.seriesId, null, now)
      : { tasks, history: taskHistory };
    const nextTasks = stopped.tasks.filter((item) => item.id !== id);
    const nextHistory = mergeTaskHistory(stopped.history.filter((entry) => entry.id !== id), nextTasks, now);
    setTasks(nextTasks);
    setTaskHistory(nextHistory);
    setDismissedTaskIds((current) => current.filter((taskId) => taskId !== id));
    setNotice(`Deleted "${task.title}" without completing it.`);
  }

  function addTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = tidyTask(newTask);
    if (!title) return;
    if (undoRemoveAll) setUndoRemoveAll(null);
    setRemoveAllConfirmOpen(false);
    const now = Date.now();
    const draft: TaskDetailsDraft = {
      title,
      category: newTaskCategory,
      important: newTaskImportant,
      repeat: newTaskRepeat,
      dailyTime: newTaskDailyTime,
      hourlyStart: newTaskHourlyStart,
    };
    const recurrenceDetails = recurrenceFromTaskDraft(draft, null, now);
    const taskToAdd: Task = {
      id: createId(),
      title,
      color: colors[tasks.length % colors.length],
      completed: false,
      createdAt: now,
      completedAt: null,
      important: newTaskImportant,
      category: newTaskCategory.trim().replace(/\s+/g, " ").slice(0, 32) || null,
      recurrence: recurrenceDetails.recurrence,
      scheduledAt: recurrenceDetails.scheduledAt,
      occurrenceIndex: recurrenceDetails.occurrenceIndex,
    };
    setTasks((current) => [...current, taskToAdd]);
    setTaskHistory((current) => mergeTaskHistory(current, [taskToAdd], now));
    setNewTask("");
    setNewTaskRepeat("none");
    setNewTaskCategory("");
    setNewTaskImportant(false);
    setNotice(recurrenceDetails.recurrence
      ? `Added ${title} with a ${recurrenceDetails.recurrence.frequency} schedule.`
      : "Added to the list.");
  }

  function requestClearAllTasks() {
    if (!tasks.length) return;
    setRemoveAllConfirmOpen(true);
  }

  function clearAllTasks() {
    if (!tasks.length) return;
    setUndoRemoveAll({
      tasks: tasks.map((task) => ({ ...task })),
      taskHistory: taskHistory.map((entry) => ({ ...entry })),
      dismissedTaskIds: [...dismissedTaskIds],
      filter,
    });
    clearUndoCompletion();
    const now = Date.now();
    let clearedTasks = tasks;
    let clearedHistory = mergeTaskHistory(taskHistory, tasks, now);
    const seriesIds = Array.from(new Set(clearedTasks
      .map((task) => task.recurrence?.seriesId)
      .filter((seriesId): seriesId is string => Boolean(seriesId))));
    seriesIds.forEach((seriesId) => {
      const stopped = stopRecurringSeries(clearedTasks, clearedHistory, seriesId, null, now);
      clearedTasks = stopped.tasks;
      clearedHistory = stopped.history;
    });
    setTaskHistory(clearedHistory);
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
    setRemoveAllConfirmOpen(false);
    setNotice("All tasks removed.");
  }

  function undoClearAllTasks() {
    const action = undoRemoveAll;
    if (!action) return;

    setTasks(action.tasks.map((task) => ({ ...task })));
    setTaskHistory(action.taskHistory.map((entry) => ({ ...entry })));
    setDismissedTaskIds([...action.dismissedTaskIds]);
    setFilter(action.filter);
    setUndoRemoveAll(null);
    setRemoveAllConfirmOpen(false);
    setNotice(`Restored ${action.tasks.length} ${action.tasks.length === 1 ? "task" : "tasks"}.`);
  }

  function clearTranscript() {
    if (isListening) stopListening();
    setTranscript("");
    setNotice("Dictated text cleared. Your task list is still here.");
  }

  function exportTaskHistory() {
    const records = mergeTaskHistory(taskHistory, tasks);
    const contents = formatRecurringTaskHistory(records);
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
  deleteTaskRef.current = deleteTask;
  saveTaskDetailsRef.current = saveTaskDetails;
  stopRepeatingRef.current = stopRepeating;

  return (
    <main className={`app-shell juice-shell theme-${theme} ${milestone ? "has-milestone" : ""} ${celebratingTaskId ? "is-screen-celebrating" : ""}`} id="top">
      <div className="noise" aria-hidden="true" />
      {celebratingTaskId && appSettings.celebrationsEnabled && <CelebrationBurst key={celebrationNonce} variant={celebrationVariant} nonce={celebrationNonce} />}
      {milestone && (
        <div className={`milestone-overlay ${milestone === "LEVEL COMPLETE" ? "is-final" : ""}`} role="status" aria-live="polite">
          <span className="milestone-kicker">PROGRESS UNLOCKED</span>
          <strong>{milestone}</strong>
          <span className="milestone-sub">{milestone === "LEVEL COMPLETE" ? "YOU CLEARED THE WHOLE BOARD" : "KEEP THE MOMENTUM"}</span>
        </div>
      )}
      <header className="top-banner" aria-label="DictaTask navigation">
        <span className="top-banner-name" aria-hidden="true">
          <span className="top-banner-name-dicta">DICTA</span>
          <span className="top-banner-name-task">TASK</span>
        </span>
        <span className="top-banner-block top-banner-block-orange" />
        <span className="top-banner-block top-banner-block-blue" />
        <span className="top-banner-block top-banner-block-lime" />
        <button className="top-banner-settings" type="button" onClick={() => setView("settings")} aria-label="Open settings"><Icon name="settings" /></button>
      </header>
      {notice && <div className="app-notice" role="status"><span>{notice}</span><button type="button" aria-label="Dismiss message" onClick={() => setNotice("")}>×</button></div>}
      {view === "settings" ? (
        <SettingsPage theme={theme} setTheme={setTheme} settings={appSettings} setSettings={setAppSettings} wheelSettings={wheelSettings} setWheelSettings={setWheelSettings} groqKeySaved={groqKeySaved} onSaveGroqKey={(key) => {
          if (!window.DictaTaskAndroid?.setGroqApiKey) { setNotice("Save your Groq key in the Android app."); return; }
          setNotice("Saving key…");
          window.DictaTaskAndroid.setGroqApiKey(key);
        }} onClearGroqKey={() => { window.DictaTaskAndroid?.clearGroqApiKey?.(); setGroqKeySaved(false); if (appSettings.transcriptionProvider === "groq") setAppSettings({ ...appSettings, transcriptionProvider: "device" }); setNotice("Groq API key removed from this device."); }} onBack={() => setView("board")} />
      ) : <section className="workspace-grid juice-workspace" aria-label="Dictation workspace">
        <article className="transcript-card card-shadow juice-panel">
          <div className="recording-bar">
            <button
              className={`record-button ${isListening ? "is-listening" : ""} ${isGroqTranscribing ? "is-transcribing" : ""}`}
              type="button"
              aria-label={isListening
                ? `Stop voice recording. ${recordingLimitSeconds - recordingSeconds} seconds remaining`
                : `Start a ${recordingLimitSeconds}-second voice recording`}
              style={{ "--recording-progress": `${recordingProgress}%` } as CSSProperties}
              onClick={toggleListening}
              disabled={isGroqTranscribing}
            >
              <span className="record-button-progress" aria-hidden="true" />
              <span className="record-button-icon"><Icon name="mic" /></span>
              <span className="record-button-copy">
                <strong>{isGroqTranscribing ? "TRANSCRIBING" : isListening ? "LISTENING NOW" : "TAP TO RECORD"}</strong>
              </span>
              <span className="record-button-wave" aria-hidden="true"><i /><i /><i /><i /><i /></span>
              <span className="shortcut">{isGroqTranscribing ? "GROQ" : isListening ? `${String(recordingLimitSeconds - recordingSeconds).padStart(2, "0")}s LEFT` : `${recordingLimitSeconds}s MAX`}</span>
            </button>
            <span className="recording-hint">{isGroqTranscribing ? "Groq is turning your recording into text" : isListening ? appSettings.transcriptionProvider === "groq" ? "Tap again when you are done" : "Live transcript appears as you speak" : "or paste a transcription"}</span>
          </div>

          <textarea
            className="transcript-input"
            aria-label="Voice dictation transcript"
            value={transcript}
            onChange={(event) => setTranscript(event.target.value)}
            onBlur={flushTranscript}
            placeholder="Start talking about everything you need to do…"
            readOnly={isListening || isGroqTranscribing}
          />

          <div className="transcript-footer">
            <div className="transcript-footer-actions">
              <span className="character-count">{transcript.length} characters</span>
            </div>
            <span className="voice-wave" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /></span>
          </div>

          <div className="transcript-action-row">
            <button className="scan-button compact-scan-button" type="button" onClick={generateTasks} disabled={!transcript.trim() || isListening || isGroqTranscribing}>
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
          <details className="new-task-advanced">
            <summary><span>ADVANCED TASK OPTIONS</span><small>{newTaskRepeat === "none" ? "REPEAT OFF" : newTaskRepeat === "daily" ? `DAILY AT ${newTaskDailyTime}` : "HOURLY SLOTS"}</small></summary>
            <div className="new-task-advanced-fields">
              <label>
                <span>REPEAT</span>
                <select value={newTaskRepeat} onChange={(event) => setNewTaskRepeat(event.target.value as RepeatSelection)} aria-label="Repeat new task">
                  <option value="none">OFF</option>
                  <option value="daily">DAILY</option>
                  <option value="hourly">HOURLY</option>
                </select>
              </label>
              {newTaskRepeat === "daily" && <label><span>DAILY AT LOCAL TIME</span><input type="time" value={newTaskDailyTime} onChange={(event) => setNewTaskDailyTime(event.target.value)} aria-label="New task daily local time" /></label>}
              {newTaskRepeat === "hourly" && <label><span>HOURLY START</span><input type="datetime-local" value={newTaskHourlyStart} onChange={(event) => setNewTaskHourlyStart(event.target.value)} aria-label="New task hourly schedule start" /></label>}
              <label><span>CATEGORY <small>(OPTIONAL)</small></span><input value={newTaskCategory} maxLength={32} onChange={(event) => setNewTaskCategory(event.target.value)} placeholder="e.g. HOME" aria-label="New task category" /></label>
              <label className="new-task-important"><span>IMPORTANT</span><input type="checkbox" checked={newTaskImportant} onChange={(event) => setNewTaskImportant(event.target.checked)} /><i aria-hidden="true" /></label>
            </div>
          </details>
          <span className="transcript-end-divider" aria-hidden="true" />
        </article>

        <article className={`tasks-card card-shadow juice-panel ${wheelPhase !== "list" ? "is-wheel-mode" : ""} ${wheelPhase === "converging" ? "is-wheel-converging" : ""}`}>
          <div className={`task-board-flip ${wheelPhase !== "list" ? "is-wheel-revealed" : ""}`}>
            <div className="task-board-face task-board-face-front" aria-hidden={wheelPhase !== "list"}>
              <section className="progress-strip" aria-label="Today's task progress">
                <div className="progress-strip-heading">
                  <div><span>TODAY'S RUNWAY</span><strong>{dailyProgress.completedToday} DONE TODAY · {dailyProgress.ready} READY</strong></div>
                  <span>{dailyProgress.denominator ? `${dailyProgress.percentage}% MOVING` : tasks.length ? "NO READY WORK" : "EMPTY BOARD"}</span>
                </div>
                <div className="progress-strip-track" role="progressbar" aria-label={`${dailyProgress.completedToday} done today out of ${dailyProgress.denominator} total progress items`} aria-valuemin={0} aria-valuemax={dailyProgress.denominator || 1} aria-valuenow={dailyProgress.completedToday}><span style={{ width: `${dailyProgress.percentage}%` }} /></div>
                <small>{tasks.length ? (dailyProgress.ready ? "Ready tasks stay here until their scheduled time arrives." : "Add or schedule a task to put something on deck.") : "Your board is empty. Add a task above to get moving."}</small>
              </section>
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

              <div className="task-search-row">
                <label className="task-search-field"><span>SEARCH ALL {filter === "done" ? "DONE" : "TO DO"}</span><input type="search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Find by title…" aria-label={`Search ${filter === "done" ? "done" : "to do"} task titles`} /></label>
                <span className="task-match-count">{filteredMatchingCount} MATCHING</span>
                {hasActiveFilters && <button type="button" className="clear-task-filters" onClick={clearFilters}>CLEAR FILTERS</button>}
              </div>
              <div className="task-filter-row" aria-label="Task filters">
                <button type="button" className={importantOnly ? "is-active" : ""} aria-pressed={importantOnly} onClick={() => setImportantOnly((value) => !value)}>IMPORTANT</button>
                <button type="button" className={repeatingOnly ? "is-active" : ""} aria-pressed={repeatingOnly} onClick={() => setRepeatingOnly((value) => !value)}>REPEATING</button>
                <label><span>CATEGORY</span><select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} aria-label="Filter by category"><option value="">ALL</option>{categoryOptions.map((category) => <option value={category} key={category}>{category}</option>)}</select></label>
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

              {undoRemoveAll && (
                <div className="undo-inline undo-remove-all-inline" role="status" aria-live="polite">
                  <div className="undo-inline-copy">
                    <strong>BOARD CLEARED</strong>
                    <span>{undoRemoveAll.tasks.length} {undoRemoveAll.tasks.length === 1 ? "task" : "tasks"} removed</span>
                  </div>
                  <button type="button" onClick={undoClearAllTasks} aria-label="Undo removing all tasks">
                    UNDO
                  </button>
                </div>
              )}

              <div className="task-list">
                {filteredTasks.length ? (
                  visibleFilteredTasks.map((task, index) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      index={index}
                      now={taskAgeNow}
                      daysOpen={task.completed
                        ? getTaskOpenDays(task.completedAt, taskAgeNow)
                        : getTaskOpenDays(task.createdAt ?? createdAtByTaskId.get(task.id), taskAgeNow)}
                      showTaskAge={appSettings.showTaskAge}
                      actionable={isTaskActionable(task, taskAgeNow)}
                      celebrating={celebratingTaskId === task.id}
                      onToggle={handleTaskToggle}
                      onFocus={handleTaskFocus}
                      onDelete={handleTaskDelete}
                      onSaveDetails={handleTaskDetailsSave}
                      onStopRepeating={handleStopRepeating}
                    />
                  ))
                ) : (
                  <div className="empty-state">
                    <span className="empty-icon"><Icon name="check" /></span>
                    <strong>{emptyStateTitle}</strong>
                    <span>{emptyStateCopy}</span>
                  </div>
                )}
              </div>
              {filteredTasks.length > visibleTaskLimit && <button type="button" className="show-more-tasks" onClick={() => setVisibleTaskLimit((limit) => limit + 30)}>SHOW 30 MORE · {filteredTasks.length - visibleTaskLimit} LEFT</button>}
              {filter === "open" && upcomingTasks.length > 0 && (
                <details className="upcoming-section">
                  <summary><span>UPCOMING REPEATING WORK</span><strong>{upcomingTasks.length} {upcomingTasks.length === 1 ? "TASK" : "TASKS"}</strong><small>Collapsed until due</small></summary>
                  <div className="upcoming-task-list">
                    {visibleUpcomingTasks.map((task) => <UpcomingTaskRow key={task.id} task={task} now={taskAgeNow} onSave={handleTaskDetailsSave} onStop={handleStopRepeating} onDelete={handleTaskDelete} />)}
                  </div>
                  {upcomingTasks.length > visibleTaskLimit && <button type="button" className="show-more-tasks" onClick={() => setVisibleTaskLimit((limit) => limit + 30)}>SHOW MORE UPCOMING</button>}
                </details>
              )}

              <div className="task-actions task-actions-footer" aria-label="Task list actions">
                <button className="clear-button wheel-settings-button" type="button" onClick={() => setView("settings")}>
                  <Icon name="settings" /> Settings
                </button>
                <button className="clear-button export-history-button" type="button" onClick={exportTaskHistory} disabled={!taskHistory.length && !tasks.length}>
                  <Icon name="download" /> Export .txt
                </button>
                <button className="clear-button remove-all-button" type="button" onClick={requestClearAllTasks} disabled={!tasks.length}>
                  <Icon name="trash" /> Remove all
                </button>
              </div>

              {removeAllConfirmOpen && (
                <div className="remove-all-confirm" role="alertdialog" aria-labelledby="remove-all-confirm-title" aria-describedby="remove-all-confirm-copy">
                  <div className="remove-all-confirm-copy">
                    <strong id="remove-all-confirm-title">REMOVE ALL TASKS?</strong>
                    <span id="remove-all-confirm-copy">This clears the current board. You can undo it right after.</span>
                  </div>
                  <div className="remove-all-confirm-actions">
                    <button type="button" className="remove-all-confirm-cancel" onClick={() => setRemoveAllConfirmOpen(false)}>
                      CANCEL
                    </button>
                    <button type="button" className="remove-all-confirm-delete" onClick={clearAllTasks}>
                      REMOVE ALL
                    </button>
                  </div>
                </div>
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
              disabled={!wheelEligibleTasks.length}
              aria-label="Spin the wheel to choose an open task"
            >
              <span className="wheel-launch-art" aria-hidden="true"><img src="./dictatask-wheel-face.jpg" alt="" /></span>
              <span>Spin the wheel</span>
            </button>
          </section>
        )}

        {wheelPhase === "list" && (
          <section className="stats-card juice-panel" aria-labelledby="weekly-stats-title">
            <div className="stats-card-heading">
              <div>
                <span>LAST 7 DAYS</span>
                <h2 id="weekly-stats-title">TASK STATS</h2>
              </div>
              <strong aria-label={`${sevenDayCompletedTotal} tasks completed in the last 7 days`}>
                {sevenDayCompletedTotal}<small> DONE</small>
              </strong>
            </div>

            <div className="stats-legend" aria-label={`Legend. ${sevenDayCompletedTotal} completed and ${sevenDayAddedTotal} added in the last 7 days`}>
              <span className="stats-legend-completed"><i aria-hidden="true" /> COMPLETED</span>
              <span className="stats-legend-added"><i aria-hidden="true" /> ADDED</span>
            </div>

            <div className="weekly-chart" role="img" aria-label={`Tasks per day for the last 7 days. ${sevenDayTaskStats.map((stat) => `${stat.dateLabel}: ${stat.completed} completed, ${stat.added} added`).join("; ")}.`}>
              {sevenDayTaskStats.map((stat) => (
                <div className="weekly-chart-day" key={stat.dayNumber}>
                  <div className="weekly-chart-bars" aria-hidden="true">
                    <span
                      className={`weekly-chart-bar is-completed ${stat.completed ? "" : "is-zero"}`}
                      style={{ "--bar-height": `${(stat.completed / sevenDayMax) * 100}%` } as CSSProperties}
                    >
                      <b>{stat.completed}</b>
                    </span>
                    <span
                      className={`weekly-chart-bar is-added ${stat.added ? "" : "is-zero"}`}
                      style={{ "--bar-height": `${(stat.added / sevenDayMax) * 100}%` } as CSSProperties}
                    >
                      <b>{stat.added}</b>
                    </span>
                  </div>
                  <span className="weekly-chart-day-label">{stat.dayLabel}</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </section>}

    </main>
  );
}

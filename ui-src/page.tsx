"use client";

import type { CSSProperties, FormEvent } from "react";
import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

type TaskColor = "orange" | "blue" | "cyan" | "lime" | "violet";
type Filter = "all" | "open" | "done";
type Theme = "midnight" | "paper";
type CelebrationVariant = "burst" | "stamp" | "jackpot" | "massacre";

type ReminderSettings = {
  enabled: boolean;
  permissionGranted: boolean;
  notificationsEnabled: boolean;
  quietStartHour: number;
  quietEndHour: number;
};

type Task = {
  id: string;
  title: string;
  color: TaskColor;
  completed: boolean;
};

type TaskHistoryEntry = Task & {
  createdAt: number | null;
  completedAt: number | null;
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
      getReminderSettings?: () => string;
      setRemindersEnabled?: (enabled: boolean) => void;
      requestNotificationPermission?: () => void;
      openNotificationSettings?: () => void;
      setColorScheme?: (scheme: "dark" | "light") => void;
      notifyWebReady?: () => void;
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
const defaultReminderSettings: ReminderSettings = {
  enabled: false,
  permissionGranted: false,
  notificationsEnabled: false,
  quietStartHour: 22,
  quietEndHour: 8,
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

function invalidateStoredValue(key: string) {
  nativeRawSnapshots.delete(key);
  storageSnapshots.delete(key);
  storageListeners.get(key)?.forEach((listener) => listener());
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
      createdAt: previous?.createdAt ?? now,
      completedAt: task.completed ? previous?.completedAt ?? now : previous?.completedAt ?? null,
    });
  });

  return Array.from(byId.values())
    .sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0))
    .slice(0, MAX_HISTORY_RECORDS);
}

function parseReminderSettings(raw: string | undefined): ReminderSettings {
  if (!raw) return defaultReminderSettings;
  try {
    const parsed = JSON.parse(raw) as Partial<ReminderSettings>;
    return {
      enabled: parsed.enabled === true,
      permissionGranted: parsed.permissionGranted === true,
      notificationsEnabled: parsed.notificationsEnabled === true,
      quietStartHour: Number.isInteger(parsed.quietStartHour) ? Number(parsed.quietStartHour) : 22,
      quietEndHour: Number.isInteger(parsed.quietEndHour) ? Number(parsed.quietEndHour) : 8,
    };
  } catch {
    return defaultReminderSettings;
  }
}

function formatHour(hour: number) {
  const normalized = ((hour % 24) + 24) % 24;
  if (normalized === 0) return "12 AM";
  if (normalized === 12) return "12 PM";
  return normalized < 12 ? `${normalized} AM` : `${normalized - 12} PM`;
}

function formatHistoryDate(timestamp: number | null) {
  return timestamp ? new Date(timestamp).toLocaleString() : "Not recorded";
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

  return unique.slice(0, 12).map((title, index) => ({
    id: createId(),
    title,
    color: colors[index % colors.length],
    completed: false,
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
  celebrating,
  onToggle,
}: {
  task: Task;
  index: number;
  celebrating: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <div
      className={`task-row task-${task.color} ${task.completed ? "is-complete" : ""} ${celebrating ? "is-celebrating" : ""}`}
      id={`task-${task.id}`}
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
        </div>
      </div>
      <span className="task-badge">{task.completed ? "DONE" : "NEXT"}</span>
      <span className="task-swipe" aria-hidden="true">→</span>
    </div>
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

export default function Home() {
  const [transcript, setTranscript, flushTranscript] = useDebouncedStoredString("dictatask-transcript", starterTranscript);
  const [tasks, setTasks] = useNormalizedStoredState("dictatask-tasks", starterTasks, normalizeTasks);
  const [taskHistory, setTaskHistory] = useNormalizedStoredState("dictatask-task-history", starterTaskHistory, normalizeTaskHistory);
  const [theme, setTheme] = useNormalizedStoredState("dictatask-theme", "midnight" as Theme, normalizeTheme);
  const [filter, setFilter] = useState<Filter>("all");
  const [newTask, setNewTask] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [notice, setNotice] = useState("Ready when you are.");
  const [celebratingTaskId, setCelebratingTaskId] = useState<string | null>(null);
  const [dismissedTaskIds, setDismissedTaskIds] = useStoredState<string[]>("dictatask-dismissed-task-ids", EMPTY_STRING_ARRAY);
  const [celebrationVariant, setCelebrationVariant] = useState<CelebrationVariant>("burst");
  const [celebrationNonce, setCelebrationNonce] = useState(0);
  const [floatingReward, setFloatingReward] = useState<{ label: string; id: number } | null>(null);
  const [milestone, setMilestone] = useState<string | null>(null);
  const [sessionXp, setSessionXp] = useState(0);
  const [combo, setCombo] = useState(0);
  const [reminderSettings, setReminderSettings] = useState(defaultReminderSettings);
  const [reminderBusy, setReminderBusy] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const voiceBufferRef = useRef("");
  const voiceInterimRef = useRef("");
  const fallbackInterimRef = useRef("");
  const keepListeningRef = useRef(false);
  const voiceSessionRef = useRef(0);
  const recordingStartedAtRef = useRef(0);
  const restartTimerRef = useRef<number | null>(null);
  const celebrationTimerRef = useRef<number | null>(null);
  const milestoneTimerRef = useRef<number | null>(null);
  const rewardTimerRef = useRef<number | null>(null);
  const comboTimerRef = useRef<number | null>(null);
  const lastCompletionAtRef = useRef(0);
  const milestonesSeenRef = useRef(new Set<number>());
  const toggleTaskRef = useRef<(id: string) => void>(() => undefined);
  const handleTaskToggle = useCallback((id: string) => toggleTaskRef.current(id), []);
  const colorScheme = theme === "paper" ? "light" : "dark";
  const isNativeAndroid = typeof window !== "undefined"
    && typeof window.DictaTaskAndroid?.getStoredState === "function";

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

  const refreshReminderSettings = useCallback(() => {
    setReminderSettings(parseReminderSettings(window.DictaTaskAndroid?.getReminderSettings?.()));
    setReminderBusy(false);
  }, []);

  useEffect(() => {
    refreshReminderSettings();
    const handleReminderSettings = (event: Event) => {
      const detail = (event as CustomEvent<Partial<ReminderSettings>>).detail;
      if (detail && typeof detail === "object") {
        setReminderSettings((current) => ({ ...current, ...detail }));
        setReminderBusy(false);
      } else {
        refreshReminderSettings();
      }
    };
    const handleNativeState = (event: Event) => {
      const key = (event as CustomEvent<{ key?: string }>).detail?.key ?? "dictatask-tasks";
      invalidateStoredValue(key);
      if (key === "dictatask-tasks") {
        setNotice("Task updated from your notification.");
      }
    };
    const handleNavigate = (event: Event) => {
      const detail = (event as CustomEvent<{ destination?: string; taskId?: string }>).detail;
      if (detail?.destination !== "task") return;
      setFilter("open");
      window.setTimeout(() => {
        const target = detail.taskId ? document.getElementById(`task-${detail.taskId}`) : null;
        (target ?? document.querySelector(".tasks-card"))?.scrollIntoView({ behavior: "smooth", block: "center" });
        if (target instanceof HTMLElement) target.focus({ preventScroll: true });
      }, 120);
    };
    window.addEventListener("dictatask:reminder-settings-changed", handleReminderSettings);
    window.addEventListener("dictatask:native-state-changed", handleNativeState);
    window.addEventListener("dictatask:navigate", handleNavigate);
    window.dispatchEvent(new CustomEvent("dictatask:web-ready"));
    return () => {
      window.removeEventListener("dictatask:reminder-settings-changed", handleReminderSettings);
      window.removeEventListener("dictatask:native-state-changed", handleNativeState);
      window.removeEventListener("dictatask:navigate", handleNavigate);
    };
  }, [refreshReminderSettings]);

  useEffect(() => {
    setTaskHistory((current) => mergeTaskHistory(current, tasks));
  }, [setTaskHistory, tasks]);

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

  const openCount = tasks.filter((task) => !task.completed).length;
  const doneCount = tasks.filter((task) => task.completed).length;
  const totalCount = tasks.length;
  const progressPercent = totalCount ? Math.round((doneCount / totalCount) * 100) : 0;
  const filteredTasks = useMemo(() => {
    const visibleTasks = filter === "open"
      ? tasks.filter((task) => !task.completed || task.id === celebratingTaskId)
      : filter === "done"
        ? tasks.filter((task) => task.completed)
        : tasks;

    return filter === "open"
      ? visibleTasks.filter((task) => task.id === celebratingTaskId || !dismissedTaskIdSet.has(task.id))
      : visibleTasks;
  }, [celebratingTaskId, dismissedTaskIdSet, filter, tasks]);

  const nextTaskTitle = tasks.find((task) => !task.completed)?.title
    ?? "Board clear — reminders automatically stay quiet.";

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
    if (celebrationTimerRef.current !== null) window.clearTimeout(celebrationTimerRef.current);
    if (milestoneTimerRef.current !== null) window.clearTimeout(milestoneTimerRef.current);
    if (rewardTimerRef.current !== null) window.clearTimeout(rewardTimerRef.current);
    if (comboTimerRef.current !== null) window.clearTimeout(comboTimerRef.current);
    try {
      recognitionRef.current?.stop();
    } catch {
      recognitionRef.current?.abort?.();
    }
  }, []);

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
    setFilter("all");
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

  function toggleTask(id: string) {
    const task = tasks.find((item) => item.id === id);
    const willComplete = Boolean(task && !task.completed);

    if (celebrationTimerRef.current !== null) {
      window.clearTimeout(celebrationTimerRef.current);
      celebrationTimerRef.current = null;
    }

    setTasks((current) =>
      current.map((task) => (task.id === id ? { ...task, completed: !task.completed } : task)),
    );

    if (willComplete) {
      const previousPercent = totalCount ? Math.round((doneCount / totalCount) * 100) : 0;
      const nextDoneCount = doneCount + 1;
      const nextPercent = totalCount ? Math.round((nextDoneCount / totalCount) * 100) : 100;
      const now = Date.now();
      const nextCombo = now - lastCompletionAtRef.current < 3600 ? Math.min(combo + 1, 4) : 1;
      const variants: CelebrationVariant[] = ["burst", "stamp", "jackpot", "massacre"];

      lastCompletionAtRef.current = now;
      setCombo(nextCombo);
      setCelebrationVariant(variants[celebrationNonce % variants.length]);
      setCelebrationNonce((current) => current + 1);
      setSessionXp((current) => current + (nextCombo >= 4 ? 50 : nextCombo * 10));
      setFloatingReward({
        label: nextCombo >= 4 ? "FOCUS STREAK" : `+${nextCombo * 10} XP`,
        id: now,
      });

      if (comboTimerRef.current !== null) window.clearTimeout(comboTimerRef.current);
      comboTimerRef.current = window.setTimeout(() => {
        setCombo(0);
        comboTimerRef.current = null;
      }, 4200);

      if (rewardTimerRef.current !== null) window.clearTimeout(rewardTimerRef.current);
      rewardTimerRef.current = window.setTimeout(() => {
        setFloatingReward(null);
        rewardTimerRef.current = null;
      }, 1250);

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
      celebrationTimerRef.current = window.setTimeout(() => {
        setDismissedTaskIds((current) => {
          return current.includes(id) ? current : [...current, id];
        });
        setCelebratingTaskId(null);
        celebrationTimerRef.current = null;
      }, 1050);
    } else {
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
      },
    ]);
    setNewTask("");
    setNotice("Added to the list.");
  }

  function clearCompleted() {
    setTasks((current) => current.filter((task) => !task.completed));
    setNotice("Finished items cleared.");
  }

  function clearAllTasks() {
    setTasks([]);
    setFilter("all");
    setDismissedTaskIds([]);
    setCombo(0);
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

  function toggleTheme() {
    setTheme(theme === "paper" ? "midnight" : "paper");
  }

  function toggleReminders() {
    if (!isNativeAndroid || !window.DictaTaskAndroid?.setRemindersEnabled) {
      setNotice("Focus reminders are available in the Android app.");
      return;
    }

    const nextEnabled = !reminderSettings.enabled;
    setReminderBusy(true);
    window.DictaTaskAndroid.setRemindersEnabled(nextEnabled);
    if (nextEnabled && !reminderSettings.permissionGranted) {
      window.DictaTaskAndroid.requestNotificationPermission?.();
    }
    window.setTimeout(refreshReminderSettings, 450);
  }

  function openNotificationSettings() {
    window.DictaTaskAndroid?.openNotificationSettings?.();
  }

  toggleTaskRef.current = toggleTask;

  return (
    <main className={`app-shell juice-shell theme-${theme} ${milestone ? "has-milestone" : ""} ${celebratingTaskId ? "is-screen-celebrating" : ""}`} id="top">
      <div className="noise" aria-hidden="true" />
      {celebratingTaskId && <CelebrationBurst key={celebrationNonce} variant={celebrationVariant} nonce={celebrationNonce} />}
      {floatingReward && <div className="floating-reward" key={floatingReward.id} aria-live="polite">{floatingReward.label}</div>}
      {milestone && (
        <div className={`milestone-overlay ${milestone === "LEVEL COMPLETE" ? "is-final" : ""}`} role="status" aria-live="polite">
          <span className="milestone-kicker">PROGRESS UNLOCKED</span>
          <strong>{milestone}</strong>
          <span className="milestone-sub">{milestone === "LEVEL COMPLETE" ? "YOU CLEARED THE WHOLE BOARD" : "KEEP THE MOMENTUM"}</span>
        </div>
      )}
      <header className="topbar juice-topbar">
        <a className="brand" href="#top" aria-label="DictaTask home">
          <span className="brand-mark"><Icon name="wave" /></span>
          <span className="brand-word">DICTA<span className="brand-accent">TASK</span></span>
        </a>
        <div className="topbar-actions">
          <div className="topbar-center"><span className="status-dot" /> PRIVATE / ON DEVICE · {progressPercent}% CLEAR</div>
          <button
            className="mode-toggle"
            type="button"
            aria-label={`Switch to ${theme === "paper" ? "dark" : "light"} mode`}
            aria-pressed={theme === "paper"}
            onClick={toggleTheme}
          >
            <span className="mode-toggle-glyph" aria-hidden="true"><i /><i /><i /></span>
            <span className="mode-toggle-copy"><small>MODE</small><strong>{theme === "paper" ? "LIGHT" : "DARK"}</strong></span>
          </button>
        </div>
      </header>

      <section className="focus-banner" aria-label="Task board progress">
        <div className="focus-banner-score" aria-label={`${progressPercent} percent of tasks complete`}>
          <span>BOARD STATUS</span>
          <strong>{progressPercent}%</strong>
          <small>CLEAR</small>
        </div>
      </section>

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
                <small>{isListening ? "Speak naturally" : "VOICE NOTE / 30 SEC MAX"}</small>
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
              <span><Icon name="spark" /> CONVERT</span>
              <span className="button-arrow"><Icon name="arrow" /></span>
            </button>
            <button className="clear-transcript-button transcript-clear-action" type="button" onClick={clearTranscript} disabled={!transcript.trim()}>
              <Icon name="trash" /> CLEAR TEXT
            </button>
          </div>
        </article>

        <article className="tasks-card card-shadow juice-panel">
          <div className="card-heading task-heading">
            <div className="task-heading-copy">
              <div className="task-actions">
                <button className="clear-button export-history-button" type="button" onClick={exportTaskHistory} disabled={!taskHistory.length && !tasks.length}>
                  <Icon name="download" /> Export .txt
                </button>
                <button className="clear-button" type="button" onClick={clearCompleted} disabled={!doneCount}>
                  <Icon name="trash" /> Clear done
                </button>
                <button className="clear-button remove-all-button" type="button" onClick={clearAllTasks} disabled={!tasks.length}>
                  <Icon name="trash" /> Remove all
                </button>
              </div>
              <h2>Your next moves</h2>
            </div>
          </div>

          <div className="task-toolbar">
            <div className="filter-tabs" role="group" aria-label="Filter tasks">
              {(["all", "open", "done"] as Filter[]).map((item) => (
                <button
                  className={filter === item ? "active" : ""}
                  key={item}
                  type="button"
                  aria-pressed={filter === item}
                  onClick={() => setFilter(item)}
                >
                  {item === "all" ? "All" : item === "open" ? "To do" : "Done"}
                  <span>{item === "all" ? tasks.length : item === "open" ? openCount : doneCount}</span>
                </button>
              ))}
            </div>
            <span className="task-sort">AUTO-SORTED ↕</span>
          </div>

          <div className="task-list">
            {filteredTasks.length ? (
              filteredTasks.map((task, index) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  index={index}
                  celebrating={celebratingTaskId === task.id}
                  onToggle={handleTaskToggle}
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

          <form className="add-task-form" onSubmit={addTask}>
            <span className="add-icon"><Icon name="plus" /></span>
            <input value={newTask} onChange={(event) => setNewTask(event.target.value)} placeholder="Add a task manually…" aria-label="New task" />
            <button type="submit" disabled={!newTask.trim()}>ADD TASK</button>
          </form>
        </article>
      </section>

      <section className="focus-reminders" aria-labelledby="focus-reminders-title">
        <div className="reminder-copy">
          <span className="reminder-kicker">FOCUS SIGNALS / ANDROID</span>
          <h2 id="focus-reminders-title">Notifications with a point.</h2>
          <p>One real unfinished task, delivered quietly with <b>Done</b> and <b>Snooze</b>. No empty nudges. No late-night noise.</p>
          <span className="quiet-hours">QUIET · {formatHour(reminderSettings.quietStartHour)}–{formatHour(reminderSettings.quietEndHour)}</span>
        </div>
        <div className="notification-preview" aria-label="Notification preview">
          <span className="preview-app"><i /> DICTATASK FOCUS</span>
          <strong>Your next move</strong>
          <p>{nextTaskTitle}</p>
          <div><span>DONE</span><span>SNOOZE 30M</span></div>
        </div>
        <div className="reminder-control">
          <span className={`reminder-state ${reminderSettings.enabled && reminderSettings.notificationsEnabled ? "is-on" : ""}`}>
            {reminderSettings.enabled && reminderSettings.notificationsEnabled ? "FOCUS SIGNALS ON" : "FOCUS SIGNALS OFF"}
          </span>
          <button
            className={`reminder-toggle ${reminderSettings.enabled ? "is-on" : ""}`}
            type="button"
            aria-pressed={reminderSettings.enabled}
            disabled={reminderBusy || !isNativeAndroid}
            onClick={toggleReminders}
          >
            <span aria-hidden="true"><i /></span>
            {reminderBusy ? "WORKING…" : reminderSettings.enabled ? "TURN OFF" : "TURN ON"}
          </button>
          {isNativeAndroid && (
            <button className="notification-settings-link" type="button" onClick={openNotificationSettings}>
              SYSTEM SETTINGS
            </button>
          )}
          <small>{isNativeAndroid ? "TASK DETAILS STAY PRIVATE ON LOCK SCREEN" : "AVAILABLE IN THE ANDROID APP"}</small>
        </div>
      </section>

      <section className="status-strip juice-status-strip">
        <div className="status-message" role="status" aria-live="polite" aria-atomic="true"><span className="status-message-dot" /> <strong>{notice}</strong></div>
        <div className="stats-row">
          <span><b>{totalCount.toString().padStart(2, "0")}</b> TOTAL</span>
          <span><b>{doneCount.toString().padStart(2, "0")}</b> DONE</span>
          <span><b>{progressPercent}%</b> CLEAR</span>
          <span><b>{sessionXp.toString().padStart(4, "0")}</b> XP</span>
        </div>
      </section>

      <footer className="footer">
        <span>DICTATASK / LOCAL-FIRST FOCUS</span>
        <span className="footer-mark">DT<span>_</span></span>
      </footer>
    </main>
  );
}

import { createRoot } from "react-dom/client";
import { useCallback, useEffect, useState } from "react";
import "./globals.css";
import "./native.css";

type TaskColor = "orange" | "blue" | "cyan" | "lime" | "violet";

type HatchVaultEntry = {
  taskId: string;
  title: string;
  color: TaskColor;
  hatchedAt: number;
};

type VaultNativeBridge = {
  closeHatchVault?: () => void;
  getStoredState?: (key: string) => string;
};

const HATCH_VAULT_KEY = "dictatask-hatch-vault";
const fallbackColor: TaskColor = "violet";
const validColors = new Set<TaskColor>(["orange", "blue", "cyan", "lime", "violet"]);

function getNativeBridge() {
  return (window as Window & { DictaTaskAndroid?: VaultNativeBridge }).DictaTaskAndroid;
}

function normalizeVault(value: unknown): HatchVaultEntry[] {
  if (!Array.isArray(value)) return [];

  const byTaskId = new Map<string, HatchVaultEntry>();
  value.forEach((value) => {
    if (!value || typeof value !== "object") return;
    const entry = value as Record<string, unknown>;
    const taskId = typeof entry.taskId === "string" ? entry.taskId.trim() : "";
    if (!taskId) return;

    const title = typeof entry.title === "string" && entry.title.trim()
      ? entry.title.trim()
      : "Completed task";
    const candidate: HatchVaultEntry = {
      taskId,
      title,
      color: typeof entry.color === "string" && validColors.has(entry.color as TaskColor)
        ? entry.color as TaskColor
        : fallbackColor,
      hatchedAt: typeof entry.hatchedAt === "number" && Number.isFinite(entry.hatchedAt)
        ? entry.hatchedAt
        : 0,
    };
    const previous = byTaskId.get(taskId);
    if (!previous || candidate.hatchedAt >= previous.hatchedAt) {
      byTaskId.set(taskId, candidate);
    }
  });

  return Array.from(byTaskId.values()).sort((left, right) => right.hatchedAt - left.hatchedAt);
}

function readVault() {
  let raw = "";
  try {
    raw = getNativeBridge()?.getStoredState?.(HATCH_VAULT_KEY) ?? "";
  } catch {
    raw = "";
  }

  if (!raw) {
    try {
      raw = window.localStorage.getItem(HATCH_VAULT_KEY) ?? "";
    } catch {
      raw = "";
    }
  }

  if (!raw) return [];
  try {
    return normalizeVault(JSON.parse(raw));
  } catch {
    return [];
  }
}

function HatchVault() {
  const [entries, setEntries] = useState<HatchVaultEntry[]>(readVault);
  const taskLabel = entries.length === 1 ? "TASK HATCHED" : "TASKS HATCHED";

  const refreshCollection = useCallback(() => {
    setEntries(readVault());
  }, []);

  useEffect(() => {
    const refreshOnVisible = () => {
      if (!document.hidden) refreshCollection();
    };

    window.addEventListener("focus", refreshCollection);
    document.addEventListener("visibilitychange", refreshOnVisible);
    return () => {
      window.removeEventListener("focus", refreshCollection);
      document.removeEventListener("visibilitychange", refreshOnVisible);
    };
  }, [refreshCollection]);

  const returnToTasks = useCallback(() => {
    try {
      if (getNativeBridge()?.closeHatchVault) {
        getNativeBridge()?.closeHatchVault?.();
        return;
      }
    } catch {
      // Use the standalone browser page as a dependable fallback.
    }
    window.location.assign("./index.html");
  }, []);

  return (
    <main className="hatch-vault-screen" aria-label="Hatch Vault">
      <header className="hatch-vault-screen-header">
        <button className="hatch-vault-back" type="button" onClick={returnToTasks}>
          <span aria-hidden="true">←</span> BACK TO TASKS
        </button>
        <span>PERSONAL COLLECTION</span>
      </header>

      <section className="hatch-vault-screen-hero" aria-label={`${entries.length} ${taskLabel.toLowerCase()}`}>
        <span className="hatch-vault-screen-hero-art" aria-hidden="true">
          <img src="./collectibles/task-egg-hatched-relic.png" alt="" />
        </span>
        <div>
          <span>HATCH VAULT</span>
          <strong>{entries.length}</strong>
          <b>{taskLabel}</b>
          <p>Every task you finish hatches one relic. This is your all-time archive.</p>
        </div>
      </section>

      {entries.length ? (
        <section className="hatch-vault-screen-grid" role="list" aria-label="Collected task relics">
          {entries.map((entry) => (
            <article className={`hatch-vault-screen-relic relic-${entry.color}`} key={entry.taskId} role="listitem">
              <img src="./collectibles/task-egg-hatched-relic.png" alt="" />
              <span>HATCHED</span>
              <strong>{entry.title}</strong>
            </article>
          ))}
        </section>
      ) : (
        <section className="hatch-vault-screen-empty">
          <img src="./collectibles/task-egg-unhatched.png" alt="" />
          <div>
            <strong>YOUR FIRST EGG IS WAITING</strong>
            <span>Finish any task to send its relic here.</span>
          </div>
        </section>
      )}
    </main>
  );
}

const root = document.getElementById("root");

if (!root) {
  throw new Error("DictaTask could not find the Hatch Vault root.");
}

createRoot(root).render(<HatchVault />);

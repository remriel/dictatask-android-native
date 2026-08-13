package com.remriel.dictatask;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Reads and minimally updates the task JSON owned by the bundled interface. */
final class TaskSnapshotRepository {
    static final String PREFERENCES_NAME = "dictatask_state";
    static final String TASKS_KEY = "dictatask-tasks";

    private static final Object LOCK = new Object();

    private TaskSnapshotRepository() {
    }

    static OpenTask findNextOpenTask(Context context) {
        synchronized (LOCK) {
            SharedPreferences preferences = context.getSharedPreferences(
                    PREFERENCES_NAME,
                    Context.MODE_PRIVATE
            );
            if (!preferences.contains(TASKS_KEY)) {
                return null;
            }

            String raw = preferences.getString(TASKS_KEY, null);
            if (raw == null || raw.isBlank()) {
                return null;
            }

            try {
                JSONArray tasks = new JSONArray(raw);
                String selectedId = null;
                String selectedTitle = null;
                int openCount = 0;
                for (int index = 0; index < tasks.length(); index++) {
                    JSONObject task = tasks.optJSONObject(index);
                    if (task == null || task.optBoolean("completed", false)) {
                        continue;
                    }
                    String id = task.optString("id", "").trim();
                    String title = task.optString("title", "").trim();
                    if (id.isEmpty() || title.isEmpty()) {
                        continue;
                    }
                    openCount++;
                    if (selectedId == null) {
                        selectedId = id;
                        selectedTitle = title;
                    }
                }
                return selectedId == null
                        ? null
                        : new OpenTask(selectedId, selectedTitle, openCount);
            } catch (JSONException ignored) {
                return null;
            }
        }
    }

    static boolean markCompleted(Context context, String taskId) {
        if (taskId == null || taskId.isBlank()) {
            return false;
        }
        synchronized (LOCK) {
            SharedPreferences preferences = context.getSharedPreferences(
                    PREFERENCES_NAME,
                    Context.MODE_PRIVATE
            );
            String raw = preferences.getString(TASKS_KEY, null);
            if (raw == null || raw.isBlank()) {
                return false;
            }
            try {
                JSONArray tasks = new JSONArray(raw);
                for (int index = 0; index < tasks.length(); index++) {
                    JSONObject task = tasks.optJSONObject(index);
                    if (task == null || !taskId.equals(task.optString("id"))) {
                        continue;
                    }
                    if (task.optBoolean("completed", false)) {
                        return false;
                    }
                    task.put("completed", true);
                    return preferences.edit()
                            .putString(TASKS_KEY, tasks.toString())
                            .commit();
                }
            } catch (JSONException ignored) {
                return false;
            }
            return false;
        }
    }

    static final class OpenTask {
        private final String id;
        private final String title;
        private final int openCount;

        OpenTask(String id, String title, int openCount) {
            this.id = id;
            this.title = title;
            this.openCount = openCount;
        }

        String getId() {
            return id;
        }

        String getTitle() {
            return title;
        }

        int getOpenCount() {
            return openCount;
        }
    }
}

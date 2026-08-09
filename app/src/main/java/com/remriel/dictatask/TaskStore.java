package com.remriel.dictatask;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;

public final class TaskStore {
    private static final String PREFERENCES_NAME = "dictatask_local_store";
    private static final String TASKS_KEY = "tasks";

    private final SharedPreferences preferences;

    public TaskStore(Context context) {
        preferences = context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE);
    }

    public List<Task> load() {
        List<Task> tasks = new ArrayList<>();
        String stored = preferences.getString(TASKS_KEY, "[]");

        try {
            JSONArray taskArray = new JSONArray(stored == null ? "[]" : stored);
            for (int index = 0; index < taskArray.length(); index++) {
                JSONObject item = taskArray.optJSONObject(index);
                if (item == null) {
                    continue;
                }

                long id = item.optLong("id", -1L);
                String title = item.optString("title", "").trim();
                long createdAt = item.optLong("createdAt", System.currentTimeMillis());
                boolean completed = item.optBoolean("completed", false);

                if (id > 0L && !title.isEmpty()) {
                    tasks.add(new Task(id, title, createdAt, completed));
                }
            }
        } catch (JSONException ignored) {
            // A malformed local cache is treated as empty rather than blocking capture.
        }

        sortNewestFirst(tasks);
        return tasks;
    }

    public void save(List<Task> tasks) {
        JSONArray taskArray = new JSONArray();
        for (Task task : tasks) {
            JSONObject item = new JSONObject();
            try {
                item.put("id", task.getId());
                item.put("title", task.getTitle());
                item.put("createdAt", task.getCreatedAt());
                item.put("completed", task.isCompleted());
                taskArray.put(item);
            } catch (JSONException ignored) {
                // This should never occur with the primitives above; skip only that item.
            }
        }

        preferences.edit().putString(TASKS_KEY, taskArray.toString()).apply();
    }

    private void sortNewestFirst(List<Task> tasks) {
        Collections.sort(tasks, new Comparator<Task>() {
            @Override
            public int compare(Task left, Task right) {
                return Long.compare(right.getCreatedAt(), left.getCreatedAt());
            }
        });
    }
}


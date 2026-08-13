package com.remriel.dictatask;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

/** Evaluates reminder policy at delivery time, then posts at most one notification. */
public final class ReminderWorker extends Worker {
    static final String INPUT_IS_SNOOZE = "is_snooze";

    public ReminderWorker(@NonNull Context context, @NonNull WorkerParameters workerParams) {
        super(context, workerParams);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context context = getApplicationContext();
        ReminderPreferences preferences = new ReminderPreferences(context);
        boolean isSnooze = getInputData().getBoolean(INPUT_IS_SNOOZE, false);
        long now = System.currentTimeMillis();

        if (isSnooze) {
            preferences.clearSnooze();
        }
        if (!preferences.isEnabled()
                || !ReminderNotification.areNotificationsUsable(context)
                || MainActivity.isAppInForeground()
                || preferences.isQuietHour()
                || preferences.wasRecentlyForeground(now)
                || (!isSnooze && preferences.isDismissed(now))
                || (!isSnooze && preferences.isSnoozed(now))) {
            ReminderNotification.cancel(context);
            return Result.success();
        }

        TaskSnapshotRepository.OpenTask task =
                TaskSnapshotRepository.findNextOpenTask(context);
        if (task == null) {
            ReminderNotification.cancel(context);
            return Result.success();
        }

        ReminderNotification.show(context, task);
        return Result.success();
    }
}

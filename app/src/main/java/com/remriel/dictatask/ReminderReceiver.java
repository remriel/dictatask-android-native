package com.remriel.dictatask;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Handles fast, local actions exposed by a DictaTask reminder. */
public final class ReminderReceiver extends BroadcastReceiver {
    static final String ACTION_DONE = "com.remriel.dictatask.action.REMINDER_DONE";
    static final String ACTION_SNOOZE = "com.remriel.dictatask.action.REMINDER_SNOOZE";
    static final String ACTION_DISMISS = "com.remriel.dictatask.action.REMINDER_DISMISS";
    static final String EXTRA_TASK_ID = "task_id";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || intent.getAction() == null) {
            return;
        }

        String action = intent.getAction();
        if (ReminderScheduler.LEGACY_ALARM_ACTION.equals(action)) {
            ReminderScheduler.cancelLegacyAlarm(context);
            return;
        }

        if (ACTION_DONE.equals(action)) {
            String taskId = intent.getStringExtra(EXTRA_TASK_ID);
            boolean changed = TaskSnapshotRepository.markCompleted(context, taskId);
            ReminderNotification.cancel(context);
            if (changed) {
                MainActivity.dispatchNativeStateChangedIfActive();
            }
            return;
        }

        if (ACTION_SNOOZE.equals(action)) {
            ReminderScheduler.scheduleSnooze(context);
            return;
        }

        if (ACTION_DISMISS.equals(action)) {
            new ReminderPreferences(context).startDismissCooldown();
        }
    }
}

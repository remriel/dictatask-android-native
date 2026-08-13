package com.remriel.dictatask;

import android.app.AlarmManager;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;

import androidx.work.Data;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;

import java.util.concurrent.TimeUnit;

/** Owns the single periodic focus reminder and the replaceable snooze request. */
public final class ReminderScheduler {
    static final String LEGACY_ALARM_ACTION =
            "com.remriel.dictatask.action.HOURLY_REMINDER";

    private static final String PERIODIC_WORK_NAME = "dictatask_focus_reminder_v2";
    private static final String SNOOZE_WORK_NAME = "dictatask_focus_snooze_v2";
    private static final int LEGACY_REQUEST_CODE = 7041;
    private static final String LEGACY_CHANNEL_ID = "dictatask_hourly_reminders";

    private ReminderScheduler() {
    }

    public static void ensureNotificationChannel(Context context) {
        ReminderNotification.ensureChannel(context);
    }

    /** Restores opted-in work without moving an existing periodic cadence. */
    public static void reconcile(Context context) {
        Context appContext = context.getApplicationContext();
        cancelLegacyAlarm(appContext);
        ReminderPreferences preferences = new ReminderPreferences(appContext);
        if (!preferences.isEnabled()) {
            return;
        }
        ensureNotificationChannel(appContext);
        if (ReminderNotification.areNotificationsUsable(appContext)) {
            schedulePeriodic(appContext);
        } else {
            cancelWorkAndNotification(appContext);
        }
    }

    static void schedulePeriodic(Context context) {
        PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(
                ReminderWorker.class,
                1,
                TimeUnit.HOURS
        )
                .setInitialDelay(1, TimeUnit.HOURS)
                .build();
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                PERIODIC_WORK_NAME,
                ExistingPeriodicWorkPolicy.KEEP,
                request
        );
    }

    static void scheduleSnooze(Context context) {
        Context appContext = context.getApplicationContext();
        ReminderPreferences preferences = new ReminderPreferences(appContext);
        if (!preferences.isEnabled() || !ReminderNotification.areNotificationsUsable(appContext)) {
            return;
        }

        long triggerAt = System.currentTimeMillis() + ReminderPreferences.SNOOZE_MILLIS;
        preferences.setSnoozedUntil(triggerAt);
        ReminderNotification.cancel(appContext);
        schedulePeriodic(appContext);

        Data input = new Data.Builder()
                .putBoolean(ReminderWorker.INPUT_IS_SNOOZE, true)
                .build();
        OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(ReminderWorker.class)
                .setInitialDelay(ReminderPreferences.SNOOZE_MILLIS, TimeUnit.MILLISECONDS)
                .setInputData(input)
                .build();
        WorkManager.getInstance(appContext).enqueueUniqueWork(
                SNOOZE_WORK_NAME,
                ExistingWorkPolicy.REPLACE,
                request
        );
    }

    public static void cancel(Context context) {
        Context appContext = context.getApplicationContext();
        cancelLegacyAlarm(appContext);
        cancelWorkAndNotification(appContext);
    }

    private static void cancelWorkAndNotification(Context context) {
        WorkManager workManager = WorkManager.getInstance(context);
        workManager.cancelUniqueWork(PERIODIC_WORK_NAME);
        workManager.cancelUniqueWork(SNOOZE_WORK_NAME);
        new ReminderPreferences(context).clearSnooze();
        ReminderNotification.cancel(context);
    }

    static void cancelLegacyAlarm(Context context) {
        AlarmManager alarmManager = context.getSystemService(AlarmManager.class);
        Intent intent = new Intent(context, ReminderReceiver.class)
                .setAction(LEGACY_ALARM_ACTION);
        PendingIntent pendingIntent = PendingIntent.getBroadcast(
                context,
                LEGACY_REQUEST_CODE,
                intent,
                PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE
        );
        if (alarmManager != null && pendingIntent != null) {
            alarmManager.cancel(pendingIntent);
            pendingIntent.cancel();
        }
        NotificationManager notificationManager = context.getSystemService(NotificationManager.class);
        if (notificationManager != null) {
            notificationManager.cancel(LEGACY_REQUEST_CODE);
            notificationManager.deleteNotificationChannel(LEGACY_CHANNEL_ID);
        }
    }
}

package com.remriel.dictatask;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

/** Schedules the local, offline hourly DictaTask reminder. */
public final class ReminderScheduler {
    public static final String ACTION_HOURLY_REMINDER =
            "com.remriel.dictatask.action.HOURLY_REMINDER";
    public static final String CHANNEL_ID = "dictatask_hourly_reminders";
    public static final int REQUEST_CODE = 7041;
    private static final long HOUR_MILLIS = 60L * 60L * 1000L;

    private ReminderScheduler() {
    }

    public static void ensureNotificationChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }

        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) {
            return;
        }

        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                context.getString(R.string.notification_channel_name),
                NotificationManager.IMPORTANCE_DEFAULT
        );
        channel.setDescription(context.getString(R.string.notification_channel_description));
        manager.createNotificationChannel(channel);
    }

    public static void schedule(Context context) {
        AlarmManager alarmManager = context.getSystemService(AlarmManager.class);
        if (alarmManager == null) {
            return;
        }

        alarmManager.setInexactRepeating(
                AlarmManager.RTC_WAKEUP,
                System.currentTimeMillis() + HOUR_MILLIS,
                HOUR_MILLIS,
                reminderPendingIntent(context)
        );
    }

    private static PendingIntent reminderPendingIntent(Context context) {
        Intent intent = new Intent(context, ReminderReceiver.class)
                .setAction(ACTION_HOURLY_REMINDER);
        return PendingIntent.getBroadcast(
                context,
                REQUEST_CODE,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }
}

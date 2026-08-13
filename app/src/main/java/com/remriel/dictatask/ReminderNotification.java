package com.remriel.dictatask;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import java.util.concurrent.TimeUnit;

/** Builds the standard, private, task-aware focus notification. */
final class ReminderNotification {
    static final String CHANNEL_ID = "dictatask_focus_v2";
    private static final int NOTIFICATION_ID = 7042;

    private ReminderNotification() {
    }

    static void ensureChannel(Context context) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) {
            return;
        }
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                context.getString(R.string.notification_channel_name),
                NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription(context.getString(R.string.notification_channel_description));
        channel.setShowBadge(false);
        channel.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
        manager.createNotificationChannel(channel);
    }

    static boolean hasRuntimePermission(Context context) {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
                || ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED;
    }

    static boolean areNotificationsUsable(Context context) {
        if (!hasRuntimePermission(context)
                || !NotificationManagerCompat.from(context).areNotificationsEnabled()) {
            return false;
        }
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) {
            return false;
        }
        NotificationChannel channel = manager.getNotificationChannel(CHANNEL_ID);
        return channel == null || channel.getImportance() != NotificationManager.IMPORTANCE_NONE;
    }

    @SuppressLint("MissingPermission")
    static void show(Context context, TaskSnapshotRepository.OpenTask task) {
        ensureChannel(context);
        if (!areNotificationsUsable(context)) {
            cancel(context);
            return;
        }

        String progress = context.getResources().getQuantityString(
                R.plurals.notification_open_count,
                task.getOpenCount(),
                task.getOpenCount()
        );
        PendingIntent openTaskIntent = openTaskPendingIntent(context, task.getId());

        Notification publicVersion = new NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_dictatask)
                .setColor(ContextCompat.getColor(context, R.color.dt_lime))
                .setContentTitle(context.getString(R.string.notification_public_title))
                .setContentText(context.getString(R.string.notification_public_text))
                .setCategory(NotificationCompat.CATEGORY_REMINDER)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setContentIntent(openTaskIntent)
                .setAutoCancel(true)
                .build();

        Notification notification = new NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_dictatask)
                .setColor(ContextCompat.getColor(context, R.color.dt_lime))
                .setContentTitle(context.getString(R.string.notification_title))
                .setContentText(task.getTitle())
                .setStyle(new NotificationCompat.BigTextStyle()
                        .bigText(task.getTitle())
                        .setSummaryText(progress))
                .setSubText(progress)
                .setCategory(NotificationCompat.CATEGORY_REMINDER)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                .setPublicVersion(publicVersion)
                .setContentIntent(openTaskIntent)
                .addAction(
                        R.drawable.ic_notification_done,
                        context.getString(R.string.notification_action_done),
                        actionPendingIntent(context, ReminderReceiver.ACTION_DONE, task.getId())
                )
                .addAction(
                        R.drawable.ic_notification_snooze,
                        context.getString(R.string.notification_action_snooze),
                        actionPendingIntent(context, ReminderReceiver.ACTION_SNOOZE, task.getId())
                )
                .setDeleteIntent(actionPendingIntent(
                        context,
                        ReminderReceiver.ACTION_DISMISS,
                        task.getId()
                ))
                .setAutoCancel(true)
                .setOnlyAlertOnce(true)
                .setTimeoutAfter(TimeUnit.MINUTES.toMillis(55))
                .build();

        try {
            NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, notification);
        } catch (SecurityException ignored) {
            // Permission or channel state may change between the checks and notify().
        }
    }

    static void cancel(Context context) {
        NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID);
    }

    private static PendingIntent openTaskPendingIntent(Context context, String taskId) {
        Intent intent = new Intent(context, MainActivity.class)
                .setAction(MainActivity.ACTION_OPEN_TASK)
                .setData(actionUri("task", taskId))
                .putExtra(MainActivity.EXTRA_TASK_ID, taskId)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(
                context,
                requestCode("open", taskId),
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private static PendingIntent actionPendingIntent(
            Context context,
            String action,
            String taskId
    ) {
        Intent intent = new Intent(context, ReminderReceiver.class)
                .setAction(action)
                .setData(actionUri(action, taskId))
                .putExtra(ReminderReceiver.EXTRA_TASK_ID, taskId);
        return PendingIntent.getBroadcast(
                context,
                requestCode(action, taskId),
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private static Uri actionUri(String action, String taskId) {
        return new Uri.Builder()
                .scheme("dictatask")
                .authority(action.replace('.', '-'))
                .appendPath(taskId)
                .build();
    }

    private static int requestCode(String action, String taskId) {
        return (action + ':' + taskId).hashCode() & 0x7fffffff;
    }
}

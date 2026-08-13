package com.remriel.dictatask;

import android.content.Context;
import android.content.SharedPreferences;

import java.util.Calendar;

/** Small persisted policy surface for local focus reminders. */
final class ReminderPreferences {
    static final int DEFAULT_QUIET_START_HOUR = 22;
    static final int DEFAULT_QUIET_END_HOUR = 8;
    static final long SNOOZE_MILLIS = 30L * 60L * 1000L;

    private static final String PREFERENCES_NAME = "dictatask_reminders";
    private static final String KEY_ENABLED = "enabled";
    private static final String KEY_QUIET_START_HOUR = "quiet_start_hour";
    private static final String KEY_QUIET_END_HOUR = "quiet_end_hour";
    private static final String KEY_LAST_FOREGROUND_AT = "last_foreground_at";
    private static final String KEY_DISMISSED_UNTIL = "dismissed_until";
    private static final String KEY_SNOOZED_UNTIL = "snoozed_until";
    private static final long RECENT_FOREGROUND_MILLIS = 20L * 60L * 1000L;
    private static final long DISMISS_COOLDOWN_MILLIS = 3L * 60L * 60L * 1000L;

    private final SharedPreferences preferences;

    ReminderPreferences(Context context) {
        preferences = context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE);
    }

    boolean isEnabled() {
        return preferences.getBoolean(KEY_ENABLED, false);
    }

    void setEnabled(boolean enabled) {
        SharedPreferences.Editor editor = preferences.edit().putBoolean(KEY_ENABLED, enabled);
        if (enabled) {
            editor.remove(KEY_DISMISSED_UNTIL).remove(KEY_SNOOZED_UNTIL);
        }
        editor.apply();
    }

    int getQuietStartHour() {
        return preferences.getInt(KEY_QUIET_START_HOUR, DEFAULT_QUIET_START_HOUR);
    }

    int getQuietEndHour() {
        return preferences.getInt(KEY_QUIET_END_HOUR, DEFAULT_QUIET_END_HOUR);
    }

    void markForeground() {
        preferences.edit()
                .putLong(KEY_LAST_FOREGROUND_AT, System.currentTimeMillis())
                .apply();
    }

    boolean wasRecentlyForeground(long now) {
        long lastForegroundAt = preferences.getLong(KEY_LAST_FOREGROUND_AT, 0L);
        return lastForegroundAt > 0L && now - lastForegroundAt < RECENT_FOREGROUND_MILLIS;
    }

    boolean isQuietHour() {
        int hour = Calendar.getInstance().get(Calendar.HOUR_OF_DAY);
        return isHourInQuietWindow(hour, getQuietStartHour(), getQuietEndHour());
    }

    static boolean isHourInQuietWindow(int hour, int start, int end) {
        if (hour < 0 || hour > 23 || start < 0 || start > 23 || end < 0 || end > 23) {
            return false;
        }
        if (start == end) {
            return false;
        }
        return start < end ? hour >= start && hour < end : hour >= start || hour < end;
    }

    void startDismissCooldown() {
        preferences.edit()
                .putLong(KEY_DISMISSED_UNTIL, System.currentTimeMillis() + DISMISS_COOLDOWN_MILLIS)
                .apply();
    }

    boolean isDismissed(long now) {
        return now < preferences.getLong(KEY_DISMISSED_UNTIL, 0L);
    }

    void setSnoozedUntil(long timestamp) {
        preferences.edit().putLong(KEY_SNOOZED_UNTIL, timestamp).apply();
    }

    boolean isSnoozed(long now) {
        return now < preferences.getLong(KEY_SNOOZED_UNTIL, 0L);
    }

    void clearSnooze() {
        preferences.edit().remove(KEY_SNOOZED_UNTIL).apply();
    }
}

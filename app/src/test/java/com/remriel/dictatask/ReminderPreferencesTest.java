package com.remriel.dictatask;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public final class ReminderPreferencesTest {
    @Test
    public void overnightWindowIncludesLateNightAndEarlyMorning() {
        assertTrue(ReminderPreferences.isHourInQuietWindow(22, 22, 8));
        assertTrue(ReminderPreferences.isHourInQuietWindow(7, 22, 8));
        assertFalse(ReminderPreferences.isHourInQuietWindow(8, 22, 8));
        assertFalse(ReminderPreferences.isHourInQuietWindow(14, 22, 8));
    }

    @Test
    public void daytimeWindowUsesInclusiveStartAndExclusiveEnd() {
        assertFalse(ReminderPreferences.isHourInQuietWindow(8, 9, 17));
        assertTrue(ReminderPreferences.isHourInQuietWindow(9, 9, 17));
        assertTrue(ReminderPreferences.isHourInQuietWindow(16, 9, 17));
        assertFalse(ReminderPreferences.isHourInQuietWindow(17, 9, 17));
    }

    @Test
    public void equalOrInvalidBoundsNeverSuppress() {
        assertFalse(ReminderPreferences.isHourInQuietWindow(12, 12, 12));
        assertFalse(ReminderPreferences.isHourInQuietWindow(-1, 22, 8));
        assertFalse(ReminderPreferences.isHourInQuietWindow(12, 24, 8));
    }
}

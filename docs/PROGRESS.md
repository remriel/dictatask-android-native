# DictaTask progress

## Objective

Ship the recurring-task board requested in `DictaTask-Luna-Max-Prompt.md` from the current `main` baseline, with tested React/WebView behavior, synchronized generated assets, and a reviewable Android APK.

## Current implementation state

- Working branch: `codex/recurring-task-board`, based on `98ee34c` / Android `1.5.36` (`versionCode 22`). Release metadata is now Android `1.6.0` (`versionCode 23`).
- Recurrence state lives in `ui-src/task-model.ts`; the UI remains in `ui-src/page.tsx` and is bundled into `app/src/main/assets/` by Vite.
- Daily schedules use the selected local calendar time. Hourly schedules use fixed one-hour slots anchored to the schedule timestamp. A late return carries one missed period as one actionable item; no backlog is generated.
- Every occurrence has its own ID and occurrence index. Completed records stay in DONE history. Reopening an older occurrence removes only the pending successor for that series and preserves later completed records.
- Startup, foreground/resume, due-boundary, and clock-correction reconciliation is idempotent. Remove All stops series before clearing active tasks; its existing undo restores the captured board and history.
- Future occurrences are shown in a collapsed upcoming section and are excluded from progress, direct focus, and the wheel. Search/filter counts include matching open records while the empty state distinguishes no matches from no ready work.
- Added title search, Important, Repeating, and category filters; incremental rendering; task details editing; recurrence controls; explicit schedule badges; progress strip; elapsed/remaining focus progress; and recurrence-aware export fields.

## Important decisions

- The persisted rule stores the device timezone name for audit/export. Daily recurrence is resolved through the current device JavaScript local calendar on each reconciliation, so moving timezones changes the local wall-clock interpretation without a background service. Hourly slots remain absolute one-hour intervals from the anchor.
- DST uses native local `Date` construction. A nonexistent local time is normalized by the platform (for example, a spring-forward 2:30 can land at 3:30); the calendar date and selected wall-clock intent are retained as closely as the platform permits.
- Clock changes are handled by foreground/focus/visibility refreshes plus a bounded recurrence refresh timer. No notifications or background work are introduced.
- Editing a completed/history-only row updates its title/category/Important metadata without reopening or deleting its permanent DONE record. Reopening remains an explicit checkbox action. Re-enabling recurrence from a completed record intentionally creates a new active series successor.

## Completed work

- Added `task-model.ts` normalization, recurrence scheduling/reconciliation, history merge, filters, progress, stats, and export helpers.
- Updated `page.tsx` for recurrence creation/edit/stop/delete/reopen/undo, search/filter/pagination, progress and focus feedback, upcoming work, and accessibility labels.
- Added `task-model.test.ts` with controlled-clock coverage for daily/hourly boundaries, missed periods, idempotent reload, DST/local-date behavior, migration, same-title identity, reopen/stop/remove-all, fields, filters, progress, stats, and export.
- Added responsive neo-brutalist styles for the new controls while preserving all five existing themes and production artwork.
- Browser QA at a 360px viewport covered recurring creation/edit/stop, search in TO DO and DONE, Important/category filters, future upcoming work, reload persistence, direct focus elapsed/remaining progress, wheel focus, five themes, and no horizontal overflow.

## Verification already run

- `ui-src`: `npm ci` passed with 0 vulnerabilities; `npm test` passed (12 tests); `npx tsc --noEmit` passed; `npm run build` passed.
- Direct Playwright CLI with Microsoft Edge passed because the provided WSL wrapper had no usable WSL distribution. No browser console errors were reported.
- `:app:testReleaseUnitTest :app:lintRelease :app:assembleRelease` passed with Gradle 8.13, Android Studio JBR 21, and the installed Android SDK. The release APK is v2-signed, package `com.remriel.dictatask`, versionCode 23, versionName 1.6.0, 1,234,130 bytes, SHA-256 `9A53F7E35442C7386E4CAAEBE50976BB333FA2186493F2D006280691D772DFD7`.
- The uniquely named APK was copied to `dist/` and the task outputs folder, then uploaded to [Google Drive](https://drive.google.com/file/d/1089yblmlh7Ju31xF2nM1kQgY9PjWMl0W/view?usp=drivesdk).

## Constraints and unresolved work

- No Android device or configured AVD is available for hardware microphone, Android Back/IME, or live Groq validation; browser/native bridge evidence must be labeled separately.
- The branch still needs its final commit/push and a reviewable GitHub link.

## Exact next steps

1. Commit all source, generated assets, tests, and release documentation.
2. Push `codex/recurring-task-board` and verify the remote branch/ref.
3. If GitHub CLI release creation is available, publish the verified APK as v1.6.0; otherwise leave the branch and Drive artifact as the reviewable handoff.

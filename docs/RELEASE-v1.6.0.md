# DictaTask v1.6.0 — Recurring task board

## What changed

- Added daily-at-local-time and fixed-hourly recurring tasks with persisted series rules, distinct occurrence IDs, scheduled timestamps, and occurrence numbers.
- Reconciles schedules on startup, foreground/resume, due boundaries, and bounded clock-correction checks. Missed periods produce one actionable pending occurrence instead of a backlog.
- Keeps completed occurrences in permanent DONE history. Reopening is explicit; reopening an older occurrence removes only the pending successor for that series and preserves later completed records.
- Added task details editing, Important flag, optional categories, stop repeating, safe delete, recurrence-aware undo, and recurrence-aware text export.
- Added a collapsed upcoming-work section. Future occurrences do not enter the direct-focus or Spin the Wheel candidate set.
- Added case-insensitive title search in TO DO and DONE, Important/Repeating/category filters, match counts, clear controls, distinct no-match/no-ready/empty states, and incremental rendering for large lists.
- Added the device-independent `DONE TODAY · READY` progress strip and elapsed/remaining focus progress bar. Focus expiry never completes a task automatically.
- Preserved the five neo-brutalist themes, existing production artwork, tactile straight-press interaction, and Android/WebView storage bridge.

## Edge-case rules

- Daily recurrence follows the current device JavaScript local calendar and selected wall-clock minute. The rule stores the timezone name for export/audit; moving devices/timezones changes the local wall-clock interpretation on reconciliation.
- Hourly recurrence uses absolute one-hour slots from its anchor timestamp, so late completion does not shift future slots.
- DST is delegated to native local `Date` construction. A nonexistent local time is normalized by the platform; the intended calendar day and wall-clock minute are retained as closely as the platform allows.
- Clock corrections are noticed on visibility/focus and by a maximum one-minute recurrence refresh while the page is open. No notifications or background service are required.
- Remove All stops active series before removing current tasks. Its undo snapshot restores the prior task/history state, and an emptied board cannot resurrect a removed series from history alone.

## Verification

- UI model tests: 12 controlled-clock tests passed.
- UI typecheck: `npx tsc --noEmit` passed.
- UI production bundle: `npm run build` passed and refreshed `app/src/main/assets/`.
- Browser QA: Microsoft Edge via direct Playwright CLI at 360px covered recurring creation/edit/stop, search in both tabs, Important/category filters, future upcoming work, reload persistence, direct focus progress, wheel focus, all five themes, and no horizontal overflow. The browser/native bridge was mocked; no console errors were reported.
- Android device/AVD: unavailable in this environment. Hardware microphone, Android Back/IME, live Groq, and device performance remain follow-up validation.

## Artifact

- APK: `DictaTask-v1.6.0-recurring-task-board.apk` (version code 23; Android debug-signed for internal review with the existing signing identity).
- SHA-256: `9A53F7E35442C7386E4CAAEBE50976BB333FA2186493F2D006280691D772DFD7`; size: `1,234,130` bytes.
- Signature verification: Android APK Signature Scheme v2 verified with Build Tools 36.0.0; one signer.
- Google Drive: [DictaTask-v1.6.0-recurring-task-board.apk](https://drive.google.com/file/d/1089yblmlh7Ju31xF2nM1kQgY9PjWMl0W/view?usp=drivesdk).
- GitHub release: [v1.6.0 — Recurring task board](https://github.com/remriel/dictatask-android-native/releases/tag/v1.6.0).
- GitHub APK download: [DictaTask-v1.6.0-recurring-task-board.apk](https://github.com/remriel/dictatask-android-native/releases/download/v1.6.0/DictaTask-v1.6.0-recurring-task-board.apk).

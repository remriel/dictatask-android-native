# Current task

## Objective

Keep direct focus optional, place Spin the Wheel below the task list, keep only TO DO/DONE tabs, preserve completed history in completion order, add a safe undo for accidental completions, allow DONE rows to be reopened into TO DO, remove the percentage/status panel, XP, and bottom footer/logo, put recording first, compact the recording form, and keep task actions in one row.

## Current implementation

- The shipped UI is the bundled React/Vite app in `ui-src/`, copied into `app/src/main/assets/`.
- Spin the Wheel uses a persisted configurable countdown, cancel-safe run IDs, bright task-card shadow colors, and a WebView-safe `requestAnimationFrame` rotation loop.
- The recording panel is first on open; the task board follows with Spin the Wheel directly below the task list and task actions below the wheel control.
- Manual task entry is a standalone green card between the recording and task panels on mobile (and occupies the left-side gap below recording on wider layouts), with its own `ADD TASK` button.
- The former percentage/clear board panel is removed. A colorful 16px top flare remains as a completion progress bar with no visible percentage copy; this is the current 30%-larger banner pass.
- Recording-panel spacing is reduced, and the transcription field is 154px on larger layouts / 133px on mobile (a 30% reduction from the previous compact field values).
- Each open task row has a `FOCUS` action. It starts the same countdown directly, persists a `source: "direct"` challenge, and shows a direct-focus card without the wheel face.
- The Spin the Wheel launch row has an 8px top and bottom gap so its borders stay clear of the task cards and actions below it.
- Direct focus cancellation uses the same consequence-free path as wheel cancellation and leaves task counts unchanged.
- The bottom orange status panel and its stats row are removed.
- XP state, XP accumulation, XP display, and floating XP rewards are removed for now; completion progress is represented only by the thin top flare.
- The task board has only `TO DO` and `DONE` tabs, with `TO DO` as the default.
- Completed records remain available in `DONE` through persistent task history, even after active completed rows are cleared.
- `DONE` history is sorted by `completedAt` descending, so the most recently completed task is always at the top. Re-completing a reopened task refreshes its completion timestamp.
- Completing a task shows a persistent inline `UNDO` bar beneath the task toolbar, so it remains reachable on mobile until the user dismisses it or takes another task action. Undo restores the task, dismiss state, and prior history entry without leaving a false completion behind.
- Every `DONE` row is an accessible checkbox. Tapping, pressing Enter, or pressing Space on a completed row reopens it, removes it from the completion history list, and returns it to `TO DO` without a completion side effect.
- Task titles use a larger mobile-first type scale so they fill more of each card; the per-row `FOCUS` action is intentionally smaller to keep the title dominant.
- The bottom `DICTATASK / LOCAL-FIRST FOCUS` footer and `DT_` mark are removed so the page ends with the task workspace rather than extra branding copy.
- Focus clock, Export .txt, Clear done, and Remove all are compacted to roughly 60% of their former mobile height and forced into one responsive row.
- The current branch is `agent/spin-wheel-focus-cleanup`; the release APK was rebuilt and the existing Google Drive file was updated in place.

## Verification completed

- `npx tsc --noEmit` passed.
- `npm run build` passed and refreshed the packaged WebView assets.
- Browser QA passed for the new below-list placement, two-tab flow, completion-to-DONE history, Clear done history retention, compact action sizing, direct focus, direct cancellation, wheel selection, and the 3-second wheel spin path.
- Browser QA passed for recording-first order, the absent percentage/clear panel, the 16px progress flare, the 133px mobile transcription field, and a four-button action row with one shared top coordinate at 390px and 320px widths.
- Browser QA passed for the accidental-completion `UNDO` flow (persistent inline control appeared, task restored, counts/progress restored, control dismissed) and deterministic DONE ordering with the newest completion first.
- Browser QA passed for reopening a completed row from `DONE` (accessible `Reopen …` checkbox, row removed from `DONE`, task returned to `TO DO`) plus mobile typography sizing (16px title / 26px focus button at 390px with no horizontal overflow).
- Browser QA passed for the footerless mobile shell: no `<footer>`, `LOCAL-FIRST FOCUS`, or `DT_` copy remains in the rendered page; the top flare is 16px tall and the viewport has no horizontal overflow.
- Browser QA passed for the standalone manual-task card: it renders between the recording and task panels, the task list remains in its own panel, and submitting the `ADD TASK` form creates a new TO DO row.
- The wheel control is the task list's immediate next sibling in the DOM, and the bottom status panel is absent.
- `:app:testReleaseUnitTest :app:lintRelease :app:assembleRelease` passed. Unit tests remain `NO-SOURCE` because the project has no test files.
- APK SHA-256: `8BE6CE4AC0119D5BB673F0E7CB352CCFCC9B62F9B4033EC9E8C7E9BE651F9767` (1,205,426 bytes).
- Google Drive APK: https://drive.google.com/file/d/1W3aWlos7bXlG_41qdqL__K9_TOXSeLYn/view?usp=drivesdk

## Constraints

- No Android emulator or physical device is currently attached; browser QA plus packaged-asset verification are available.
- Keep cancellation consequence-free and preserve the existing configurable countdown.
- The release APK is still Android Debug signed for internal review, not Play Store distribution.

## GitHub handoff

- Changes are pushed to `agent/spin-wheel-focus-cleanup`.
- Draft PR: https://github.com/remriel/dictatask-android-native/pull/5
- Run a physical-device smoke test when an Android target is available.

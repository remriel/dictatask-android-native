# Current task

## Objective

Keep direct focus optional, place Spin the Wheel below the task list, keep only TO DO/DONE tabs, preserve completed history in completion order, add a safe undo for accidental completions, remove the percentage/status panel and XP, put recording first, compact the recording form, and keep task actions in one row.

## Current implementation

- The shipped UI is the bundled React/Vite app in `ui-src/`, copied into `app/src/main/assets/`.
- Spin the Wheel uses a persisted configurable countdown, cancel-safe run IDs, bright task-card shadow colors, and a WebView-safe `requestAnimationFrame` rotation loop.
- The recording panel is first on open; the task board follows with Spin the Wheel directly below the task list and task actions below the wheel control.
- The former percentage/clear board panel is removed. A thin colorful top flare remains as a completion progress bar with no visible percentage copy.
- Recording-panel spacing is reduced, and the transcription field is 154px on larger layouts / 133px on mobile (a 30% reduction from the previous compact field values).
- Each open task row has a `FOCUS` action. It starts the same countdown directly, persists a `source: "direct"` challenge, and shows a direct-focus card without the wheel face.
- The Spin the Wheel launch row has an 8px top and bottom gap so its borders stay clear of the task cards and actions below it.
- Direct focus cancellation uses the same consequence-free path as wheel cancellation and leaves task counts unchanged.
- The bottom orange status panel and its stats row are removed.
- XP state, XP accumulation, XP display, and floating XP rewards are removed for now; completion progress is represented only by the thin top flare.
- The task board has only `TO DO` and `DONE` tabs, with `TO DO` as the default.
- Completed records remain available in `DONE` through persistent task history, even after active completed rows are cleared.
- `DONE` history is sorted by `completedAt` descending, so the most recently completed task is always at the top. Re-completing a reopened task refreshes its completion timestamp.
- Completing a task shows a short fixed `UNDO` toast. Undo restores the task, dismiss state, and prior history entry without leaving a false completion behind.
- Focus clock, Export .txt, Clear done, and Remove all are compacted to roughly 60% of their former mobile height and forced into one responsive row.
- The current branch is `agent/spin-wheel-focus-cleanup`; the release APK was rebuilt and the existing Google Drive file was updated in place.

## Verification completed

- `npx tsc --noEmit` passed.
- `npm run build` passed and refreshed the packaged WebView assets.
- Browser QA passed for the new below-list placement, two-tab flow, completion-to-DONE history, Clear done history retention, compact action sizing, direct focus, direct cancellation, wheel selection, and the 3-second wheel spin path.
- Browser QA passed for recording-first order, the absent percentage/clear panel, the 10px progress flare, the 133px mobile transcription field, and a four-button action row with one shared top coordinate at 390px and 320px widths.
- Browser QA passed for the accidental-completion `UNDO` flow (task restored, counts/progress restored, toast dismissed) and deterministic DONE ordering with the newest completion first.
- The wheel control is the task list's immediate next sibling in the DOM, and the bottom status panel is absent.
- `:app:testReleaseUnitTest :app:lintRelease :app:assembleRelease` passed. Unit tests remain `NO-SOURCE` because the project has no test files.
- APK SHA-256: `0D0BA001132BA0FC2AAE2CDF7A9279F2B327D3C64D26D7D75BD5FC88C864C098` (1,205,662 bytes).
- Google Drive APK: https://drive.google.com/file/d/1W3aWlos7bXlG_41qdqL__K9_TOXSeLYn/view?usp=drivesdk

## Constraints

- No Android emulator or physical device is currently attached; browser QA plus packaged-asset verification are available.
- Keep cancellation consequence-free and preserve the existing configurable countdown.
- The release APK is still Android Debug signed for internal review, not Play Store distribution.

## GitHub handoff

- Changes are pushed to `agent/spin-wheel-focus-cleanup`.
- Draft PR: https://github.com/remriel/dictatask-android-native/pull/5
- Run a physical-device smoke test when an Android target is available.

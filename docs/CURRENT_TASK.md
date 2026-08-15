# Current task

## Objective

Keep direct focus optional, place Spin the Wheel below the task list, keep only TO DO/DONE tabs, preserve completed history, remove the bottom status panel, temporarily remove XP, and compact the task actions.

## Current implementation

- The shipped UI is the bundled React/Vite app in `ui-src/`, copied into `app/src/main/assets/`.
- Spin the Wheel uses a persisted configurable countdown, cancel-safe run IDs, bright task-card shadow colors, and a WebView-safe `requestAnimationFrame` rotation loop.
- The task board is visually first, with Spin the Wheel directly below the task list and task actions below the wheel control.
- Each open task row has a `FOCUS` action. It starts the same countdown directly, persists a `source: "direct"` challenge, and shows a direct-focus card without the wheel face.
- The Spin the Wheel launch row has an 8px top and bottom gap so its borders stay clear of the task cards and actions below it.
- Direct focus cancellation uses the same consequence-free path as wheel cancellation and leaves task counts unchanged.
- The bottom orange status panel and its stats row are removed.
- XP state, XP accumulation, XP display, and floating XP rewards are removed for now; completion progress remains available in the board percentage.
- The task board has only `TO DO` and `DONE` tabs, with `TO DO` as the default.
- Completed records remain available in `DONE` through persistent task history, even after active completed rows are cleared.
- Focus clock, Export .txt, Clear done, and Remove all are compacted to roughly 60% of their former mobile height.
- The current branch is `agent/spin-wheel-focus-cleanup`; the release APK was rebuilt and the existing Google Drive file was updated in place.

## Verification completed

- `npx tsc --noEmit` passed.
- `npm run build` passed and refreshed the packaged WebView assets.
- Browser QA passed for the new below-list placement, two-tab flow, completion-to-DONE history, Clear done history retention, compact action sizing, direct focus, direct cancellation, wheel selection, and the 3-second wheel spin path.
- The wheel control is the task list's immediate next sibling in the DOM, and the bottom status panel is absent.
- `:app:testReleaseUnitTest :app:lintRelease :app:assembleRelease` passed. Unit tests remain `NO-SOURCE` because the project has no test files.
- APK SHA-256: `B156F926767C0DA29605FE649F60432AC9FB0D8B213502FDC39C68C5D3035D1A`.
- Google Drive APK: https://drive.google.com/file/d/1W3aWlos7bXlG_41qdqL__K9_TOXSeLYn/view?usp=drivesdk

## Constraints

- No Android emulator or physical device is currently attached; browser QA plus packaged-asset verification are available.
- Keep cancellation consequence-free and preserve the existing configurable countdown.
- The release APK is still Android Debug signed for internal review, not Play Store distribution.

## GitHub handoff

- Changes are pushed to `agent/spin-wheel-focus-cleanup`.
- Draft PR: https://github.com/remriel/dictatask-android-native/pull/5
- Run a physical-device smoke test when an Android target is available.

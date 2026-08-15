# Current task

## Objective

Add direct task selection for focus mode so Spin the Wheel is optional, and add a small visual gap below the Spin the Wheel launch button.

## Current implementation

- The shipped UI is the bundled React/Vite app in `ui-src/`, copied into `app/src/main/assets/`.
- Spin the Wheel uses a persisted configurable countdown, cancel-safe run IDs, bright task-card shadow colors, and a WebView-safe `requestAnimationFrame` rotation loop.
- The task board is visually first, with Spin the Wheel above the list and task actions below it.
- Each open task row has a `FOCUS` action. It starts the same countdown directly, persists a `source: "direct"` challenge, and shows a direct-focus card without the wheel face.
- The Spin the Wheel launch row has an 8px bottom gap so its border does not touch the task filters.
- Direct focus cancellation uses the same consequence-free path as wheel cancellation and leaves task counts unchanged.
- The current branch is `agent/spin-wheel-focus-cleanup`; the release APK was rebuilt and the existing Google Drive file was updated in place.

## Verification completed

- `npx tsc --noEmit` passed.
- `npm run build` passed and refreshed the packaged WebView assets.
- Browser QA passed for direct focus, direct cancellation, wheel selection, and the 3-second wheel spin path.
- The computed launch-row gap is `8px`.
- `:app:testReleaseUnitTest :app:lintRelease :app:assembleRelease` passed. Unit tests remain `NO-SOURCE` because the project has no test files.
- APK SHA-256: `46F3CCFBBF8D069FF762511000333133F7DDB9850A130BB3FA1C4A4130339E68`.
- Google Drive APK: https://drive.google.com/file/d/1W3aWlos7bXlG_41qdqL__K9_TOXSeLYn/view?usp=drivesdk

## Constraints

- No Android emulator or physical device is currently attached; browser QA plus packaged-asset verification are available.
- Keep cancellation consequence-free and preserve the existing configurable countdown.
- The release APK is still Android Debug signed for internal review, not Play Store distribution.

## Next steps

1. Commit and push the direct-focus and spacing changes.
2. Open or update the GitHub review PR.
3. Run a physical-device smoke test when an Android target is available.

# DictaTask for Android

DictaTask is a local-first Android task app built around a bundled React interface. The APK never loads the product UI from the network: `MainActivity` serves the compiled files from `app/src/main/assets` through `WebViewAssetLoader` and blocks external navigation.

## Product behavior

- Turns a 30-second native Android voice session or pasted transcript into editable tasks.
- Keeps transcripts, tasks, completion history, theme, and reminder preference on the device.
- Includes real dark and light palettes, responsive 320 px+ layouts, task filters, completion feedback, and text-history export.
- Offers opt-in, task-aware focus reminders with **Done** and **Snooze 30 min** actions, quiet hours from 10 PM–8 AM, foreground suppression, and private lock-screen copy.
- Requests microphone access only when recording starts and notification access only after the user enables Focus Signals.
- Declares no `INTERNET` permission.

## Source layout

- `ui-src/` — maintainable React, TypeScript, CSS, font licenses, and production artwork.
- `app/src/main/assets/` — generated offline web bundle packaged in the APK.
- `app/src/main/java/com/remriel/dictatask/` — speech, persistence, export, theme, and notification bridges.
- `dist/DictaTask.apk` — packaged internal-review APK.

## Build

Prerequisites are Node.js/npm, Android SDK 36, and JDK 17. On Windows with Android Studio installed:

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME

Push-Location ui-src
npm ci
npm run build
Pop-Location

.\gradlew.bat :app:testReleaseUnitTest :app:lintRelease :app:assembleRelease
Copy-Item app\build\outputs\apk\release\app-release.apk dist\DictaTask.apk -Force
```

The optimized APK is written to `app/build/outputs/apk/release/app-release.apk`. The checked-in build uses the Android debug signing key so it can be installed for internal review; a Play Store release must be signed with the repository owner’s protected release key.

# DictaTask for Android

DictaTask is a local-first Android task app built around a bundled React interface. The APK never loads the product UI from the network: `MainActivity` serves the compiled files from `app/src/main/assets` through `WebViewAssetLoader` and blocks external navigation.

## Product behavior

- Turns a 30-second native Android voice session or pasted transcript into editable tasks.
- Keeps transcripts, tasks, completion history, theme, and focus-clock preference on the device.
- Includes a dark-first neo-brutalist palette, responsive 320 px+ layouts, task filters, completion feedback, and text-history export.
- Includes **Spin the Wheel**: live task cards converge, the panel flips into a printed task wheel, one open task lands under the marker, and a configurable 5/10/15/25-minute countdown starts.
- Requests microphone access only when recording starts. DictaTask does not schedule its own reminder notifications.
- Declares no `INTERNET` permission.

## Source layout

- `ui-src/` — maintainable React, TypeScript, CSS, font licenses, and production artwork.
- `app/src/main/assets/` — generated offline web bundle packaged in the APK.
- `app/src/main/java/com/remriel/dictatask/` — speech, persistence, export, and theme bridges.
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

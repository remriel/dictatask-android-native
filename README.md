# DictaTask for Android

DictaTask for Android is a standalone Android package containing the exact compiled DictaTask interface and client-side behavior from the website. It does not load, synchronize with, or otherwise communicate with the DictaTask site at runtime.

## What it does

- Bundles the same DictaTask UI, copy, starter data, task parser, filters, completion flow, XP/combo behavior, confetti, and local persistence as the website.
- Uses Android's native speech-recognition service through a small bridge that feeds live transcripts into the original DictaTask voice-input flow.
- Stores task state locally within the app's bundled interface.
- Blocks external page navigation and has no `INTERNET` permission.

The app requests microphone access only when the user starts a voice note. Availability of speech recognition depends on the Android recognition provider configured on the device.

## Build

Open the project in Android Studio or run:

```powershell
.\gradlew.bat assembleDebug
```

The installable debug APK is written to `app/build/outputs/apk/debug/app-debug.apk`. The packaged delivery copy is at `dist/DictaTask.apk` after a release build.

# DictaTask for Android

DictaTask is a standalone, native Android task-capture app. It does not embed, load, synchronize with, or otherwise communicate with the DictaTask site.

## What it does

- Captures a spoken thought using Android's on-device speech-recognition provider.
- Lets the user refine the transcript before saving it as a task.
- Stores tasks locally on the device using `SharedPreferences`.
- Marks tasks complete or removes them.
- Uses a dark, colorful neo-brutalist visual system with a custom generated launcher icon.

The app itself requests microphone access only when the user starts dictation. It has no `INTERNET` permission and makes no app-owned network requests. Availability of speech recognition depends on the Android recognition provider configured on the device.

## Build

Open the project in Android Studio or run:

```powershell
.\gradlew.bat assembleDebug
```

The installable debug APK is written to `app/build/outputs/apk/debug/app-debug.apk`. The packaged delivery copy is at `dist/DictaTask.apk` after a release build.


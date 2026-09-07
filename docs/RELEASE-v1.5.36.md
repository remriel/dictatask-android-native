# DictaTask v1.5.36 — The wheel spins again

This hotfix restores the fun, visible Spin the Wheel animation on Android.

- Removed the Reduce Motion setting and every app/OS rule that suppressed animation.
- The task-selection wheel now always spins for three seconds.
- Added an eight-turn motion curve: readable wind-up, energetic acceleration, and a controlled landing.
- Added a playful tick to the stationary landing marker while the rotor moves.
- Preserved the flat wheel, exact task-shadow colors, centered axis, symmetric rotation, and fixed non-rotating black shadow.
- Cancellation remains consequence-free and never completes a task.

Verified with frame-by-frame mobile browser regression checks, TypeScript, production UI build, Android release lint, and APK assembly. The wheel produced distinct live angles throughout the spin even when migrating an old saved `reducedMotion: true` preference.

No Android device or emulator was available, so the native WebView build is verified statically and through the existing Android-compatible animation path rather than a physical-device recording.

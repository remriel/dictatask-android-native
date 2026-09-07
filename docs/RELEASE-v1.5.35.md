# DictaTask v1.5.35 — Reliability and responsiveness

- Fixed Android manual-task dictation routing and late results after stopping.
- Preserved browser speech recognition instead of installing an Android-only adapter everywhere.
- Prevented overlapping capture sessions; retained existing text when Groq returns a transcript.
- Restored visible, dismissible errors and honest secure-key save status.
- Added Android Back handling for Settings, focus, and delete confirmation; improved keyboard insets and microphone permission cancellation.
- Kept editing functional if browser storage fails, flushed transcripts on background, and removed open-history truncation.
- Fixed theme-specific green card colors, reduced-motion wheel behavior, disabled celebration behavior, and stale completion timestamps on Undo.
- Released recorder resources on initialization failure and restricted generic native state access to app-state keys.

## Verification

TypeScript, production UI build, release APK build, APK v2 signature, and Android lint passed (no lint issues). npm audit: zero known vulnerabilities. Browser regression checks covered speech callbacks, task complete/reopen, delete confirmation/undo, safe wheel cancellation, theme colors, Android Back callbacks, and storage failure/background saving.

No Android device/emulator was available. Speech callbacks were simulated; live microphone, Groq network transcription, and device frame performance still need hardware testing. The native unit-test task has no test sources. This is an installable review APK using the same signing certificate as v1.5.34, not a Play Store production-signed release.

APK: `DictaTask-v1.5.35-reliability-responsiveness.apk` (version code 21).

SHA-256: `68315AC0727A737CC68678A6CA3B23BA8C09401A0D6AB3422ABA2AB0DC62701E`

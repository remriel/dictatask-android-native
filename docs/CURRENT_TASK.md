# Current task

## Objective

Keep direct focus optional, place Spin the Wheel below the task list, keep only TO DO/DONE tabs, preserve completed history in completion order, add a safe undo for accidental completions, allow DONE rows to be reopened into TO DO, remove the percentage/status panel, XP, and bottom footer/logo, put recording first, compact the recording form, keep task actions in one row, replace the former daily progress flare with a static theme banner, compact the task filters, keep all button press feedback straight rather than tilted, show how many calendar days each task has been open, remove the experimental egg/Vault feature completely, and keep the manual-entry card the same height as TAP TO RECORD.

## Current implementation

- The shipped UI is the bundled React/Vite app in `ui-src/`, copied into `app/src/main/assets/`.
- Spin the Wheel uses a persisted configurable countdown, cancel-safe run IDs, bright task-card shadow colors, and a WebView-safe `requestAnimationFrame` rotation loop.
- The Spin the Wheel face now uses a coherent 90s arcade-console redesign: a cream cabinet with a four-color header stripe, symmetric blue/orange circular frame, yellow ray ring, task-colored wedges, restrained texture, centered `SPIN` hub, and a clear yellow landing marker. The rotor, hub, and landing marker share one measured center so the wheel spins symmetrically around its axis; the orbit, ring-spin, halo, light sweep, marker pulse, and hub pulse run only during the exact three-second spin, while reduced-motion mode disables the decorative loops.
- The recording panel is first on open; the task board follows with Spin the Wheel directly below the task list and task actions below the wheel control.
- Manual task entry is a green 68px inset composer at the bottom of the extended yellow recording panel on mobile, exactly matching the 68px TAP TO RECORD card height. It shares TAP TO RECORD's 90s control language while retaining its green identity: a 3px solid ink frame, 5px hard ink shadow, centered framed yellow plus/mic/arrow tiles, and a persistent one-line `Add task manually…` heading with no explanatory subline. The field reveals only while typing or after dictation has supplied text. Its mic always retains the mic glyph and inverts from the normal yellow/ink tile to a black/yellow tile during active dictation. The yellow panel remains visibly above, beside, and below the green card and ends with a flush ink divider after a small clearance for the card shadow. It retains direct typing, a dedicated mic that dictates into the new-task field, and a real submit action.
- On mobile the workspace is a flush full-width stack: one extended yellow recording panel (including the inset green manual composer), cream task board, then a separate green Spin the Wheel card. At every WebView width, the old black canvas/grid and former outer panel-border bands are removed; the deliberately framed green Spin card is the sole final card treatment, and a safe-area-aware bottom lane keeps it clear of Android navigation controls.
- Task tiles now use a 4px darkened version of their own fill color for the border (dark green around green, dark blue around blue, and so on), while retaining their bright shadow color.
- The Spin the Wheel launch label is centered and larger, with the wheel icon anchored to the left edge of its green launch band.
- TO DO and DONE filters are now an equal-width, centered pair that fills the task toolbar. They use visible cream/orange cards with black borders, 35px mobile controls (about 20% above the former compact 29px height), and enlarged count badges while remaining keyboard and touch accessible.
- The former percentage/clear board panel and its daily progress indicator are removed. The top of the mobile workspace now uses a static 42px geometric color banner with a larger rustic `DICTA`/`TASK` sticker: its skewed cream plate and offset black border intentionally break across the banner's lower line and render above the yellow recording surface, with no progress semantics, fill state, timer, or completion-dependent behavior.
- Recording-panel spacing is reduced, the separate `VOICE SESSION: 30 SEC MAX` label/progress row is removed, and the TAP TO RECORD card itself fills left-to-right while recording. The transcription field is 184px on larger layouts / 160px on mobile so it uses more of its vertical space.
- Each open task row has a `FOCUS` action. It starts the same countdown directly, persists a `source: "direct"` challenge, and shows a direct-focus card without the wheel face.
- The Spin the Wheel launch row has an 8px top and bottom gap so its borders stay clear of the task cards and actions below it.
- Direct focus cancellation uses the same consequence-free path as wheel cancellation and leaves task counts unchanged.
- The bottom orange status panel and its stats row are removed.
- XP state, XP accumulation, XP display, and floating XP rewards are removed for now; the top banner is decorative and does not represent completion progress.
- The task board has only `TO DO` and `DONE` tabs, with `TO DO` as the default.
- Completed records remain available in `DONE` through persistent task history, even after active completed rows are cleared.
- `DONE` history is sorted by `completedAt` descending, so the most recently completed task is always at the top. Re-completing a reopened task refreshes its completion timestamp.
- Every task now persists `createdAt` (with a migration fallback for older records). Open task rows show a local-calendar age badge such as `OPEN 3 DAYS`; completed rows show elapsed time since `completedAt`, such as `DONE 3 DAYS AGO`. The display refreshes at the next local midnight and when the app becomes visible.
- Completing a task shows a persistent inline `UNDO` bar beneath the task toolbar, so it remains reachable on mobile until the user dismisses it or takes another task action. Undo restores the task, dismiss state, and prior history entry without leaving a false completion behind.
- Every task state change is isolated to its visible, accessible checkbox. Tapping elsewhere on a card only triggers the card's tactile press feedback; it never completes or reopens the task. The checkbox supports tapping, Enter, and Space; in `DONE`, it reopens the task, removes it from the completion history list, and returns it to `TO DO` without a completion side effect.
- Task titles use a larger mobile-first type scale and the approved Soft Archivo face at a medium-bold weight with lightly relaxed negative tracking and a subtle 1px offset shadow; the per-row `FOCUS` action is intentionally smaller to keep the title dominant.
- Completing a task checks the box first, then draws an animated strike-through across every wrapped title line before the completion transition finishes. The line is static for existing `DONE` history and reduced-motion mode.
- Each open task keeps its `OPEN X DAYS` badge and `FOCUS` action on one horizontal detail row beneath the title, rather than spending a separate line on each.
- Open task titles render in uppercase on the TO DO board for faster visual scanning. This is display-only: the preserved title text remains available in normal case for exports, accessibility labels, dictation, and DONE history.
- The bottom `DICTATASK / LOCAL-FIRST FOCUS` footer and `DT_` mark are removed so the page ends with the task workspace rather than extra branding copy.
- Focus clock, Export .txt, Clear done, and Remove all are compacted to roughly 60% of their former mobile height and forced into one responsive row.
- The transcript action now reads `CONVERT TO TASKS`; its and the `CLEAR TEXT` control's rendered mobile height is roughly 20% smaller (about 57px versus the former 72px) while retaining clear icon and label treatment.
- The standalone bottom Spin the Wheel launch panel remains a 76px green launcher, approximately 30% taller than its former 58px control, and now uses a 3px ink frame with a 5px hard ink shadow so it reads as a proper card without changing its green color or the safe-area lane below it.
- Every enabled button now has straight tactile motion only: hover/focus lifts it by 1px and a press moves it straight down by 2px with no rotation, skew, or scale tilt.
- Every task completion still opens a brief, completion-only full-screen celebration with the existing colorful confetti cannon, rings, and success copy, but the mascot/character art has been removed completely. Reduced-motion mode suppresses the decorative movement while keeping the completion state and strike-through readable.
- The current branch is `agent/spin-wheel-focus-cleanup`; each release APK is uploaded to Google Drive as a new uniquely named file so prior versions remain available.

## Verification completed

- `npx tsc --noEmit` passed.
- `npm run build` passed and refreshed the packaged WebView assets.
- Browser QA passed for the new below-list placement, two-tab flow, completion-to-DONE history, Clear done history retention, compact action sizing, direct focus, direct cancellation, wheel selection, and the 3-second wheel spin path.
- Browser QA passed for recording-first order, the absent percentage/clear panel, the current static 42px theme banner, the in-button recording fill with no `VOICE SESSION: 30 SEC MAX` label or `.recording-progress` row, the 160px mobile transcription field, and a four-button action row with one shared top coordinate at 390px and 320px widths.
- Browser QA passed for the accidental-completion `UNDO` flow (persistent inline control appeared, task restored, counts/progress restored, control dismissed) and deterministic DONE ordering with the newest completion first.
- Browser QA passed for reopening a completed row from `DONE` (accessible `Reopen …` checkbox, row removed from `DONE`, task returned to `TO DO`) plus mobile typography sizing (16px title / 26px focus button at 390px with no horizontal overflow).
- Browser QA passed for the footerless mobile shell: no `<footer>`, `LOCAL-FIRST FOCUS`, or `DT_` copy remains in the rendered page; the static top banner is 42px tall and the viewport has no horizontal overflow.
- Browser QA at a mobile viewport confirmed task borders resolve to dark color-mixes of each tile (including dark green around the green tile), TO DO/DONE controls render at 29px tall with 7px labels, and the Spin the Wheel label is centered at 14px with its icon anchored left.
- TypeScript and Vite production build passed after replacing the top progress flare with the static decorative banner; the packaged bundle contains no `top-flare`, daily-cycle state, or top progress-bar markup.
- Browser QA passed for the manual-task card nested at the bottom of the yellow recording panel: it follows the transcript actions, the task list remains in its own cream panel, and submitting the manual composer creates a new TO DO row.
- Browser QA passed for the flush mobile stack: the yellow recording panel extends around the inset manual card, the Spin the Wheel launch control remains in its own panel below the cream task board, and the workspace has no external gap or side inset.
- The Android handoff includes a safe-area-aware mobile bottom inset for the Spin the Wheel card. The extended yellow transcript panel now deliberately surrounds the inset manual composer, giving the green control the same framed-card presentation as TAP TO RECORD.
- Browser QA confirmed the workspace bands remain flush at `x: 0` and full viewport width at a 640px Android-style viewport; the green manual composer intentionally retains its 3px frame and 5px hard shadow within the yellow recording panel, the body background is cream, and there is no horizontal overflow. A simulated Android speech bridge filled the manual task field from the dedicated mic control.
- Browser QA at a mobile Android-style viewport confirmed the exact current dimensions: static top banner `42px`, inset manual composer `68px` with 42px framed controls (matching the 68px TAP TO RECORD card), transcript actions about `57px`, compact TO DO/DONE controls `29px`, centered Spin the Wheel launch band `76px`, and no horizontal overflow.
- Browser QA held representative controls in hover and pressed states: the TO DO tab computed to a straight `-1px, -1px` lift, the recording button computed to a straight `2px, 2px` press, and no rendered button had a rotational transform.
- Browser QA confirmed active tasks still render `OPEN 0 DAYS` in the current mobile flow, and a task completed today renders `DONE 0 DAYS AGO` in `DONE`; the completed-row calculation now derives the number from `completedAt`.
- Browser QA confirmed the banner wordmark is visible at a 360px mobile viewport, remains inside the 42px banner, preserves zero horizontal overflow, and exposes an accessible `DictaTask` banner label.
- Browser QA confirmed the larger sticker measures about 180px wide and 39px tall at 360px, visibly extends past the banner's lower edge, and still preserves zero horizontal overflow.
- Browser QA confirmed the sticker's lower edge remains the topmost element over the yellow surface at the overlap points after the banner stacking layer was raised.
- Browser QA confirmed the Android-style wheel screen renders the redesigned console face without horizontal overflow, the active state exposes `wheel-orbit`, `wheel-halo`, `wheel-ring-spin`, and `wheel-light-sweep`, and the measured machine/rotor/hub centers all align at the same viewport coordinates during the spin.
- Browser QA confirmed TO DO and DONE each render as a centered, equal-width 35px card spanning the task toolbar, with the inactive DONE card visibly outlined instead of collapsing to text-only styling.
- Browser QA confirmed checkbox state changes first, the task title's `task-title-strike` pseudo-element is mid-draw during the completion transition, the final `DONE` row retains a full strike-through across wrapped lines, the celebration still renders all 20 existing confetti pieces, and no mascot DOM node or mascot asset remains. The completion still exposes UNDO and restoring the task returns it to TO DO.
- Browser QA confirmed task-card presses are consequence-free: a row tap left TO DO/DONE counts unchanged, while the visible checkbox alone completed the task, updated the counts, and exposed UNDO; undo restored the original counts and row.
- Browser QA confirmed the green manual composer now sits inside the extended yellow recording panel in the same inset-card relationship as TAP TO RECORD. It retains its 3px solid ink frame, 5px hard ink shadow, framed yellow plus/mic/arrow controls, and bold title hierarchy without a subline. At 320px it measures 294.5px by 68px, exactly matching the 68px recording card, exposes yellow on every side including a lower clearance beneath its shadow, ends the yellow panel with a full-width 4px ink divider, produces no horizontal overflow, and a real type-and-submit flow created a new TO DO row. The active dictation state retains a yellow mic glyph on an inverted black tile instead of replacing it with text.
- Browser QA at a narrow Android-style viewport confirmed the compact `Add task manually…` label remains one unbroken line and that all visible TO DO card titles render in uppercase without horizontal overflow.
- Browser QA confirmed the `OPEN X DAYS` badge and `FOCUS` control share one horizontal row below each open task title, and the separate Spin the Wheel launcher renders as a green 76px card with a 3px ink border and 5px hard ink shadow.
- The wheel control is the task list's immediate next sibling in the DOM, and the bottom status panel is absent.
- `:app:testReleaseUnitTest :app:lintRelease :app:assembleRelease` passed after the egg/Vault removal. Unit tests remain `NO-SOURCE` because the project has no test files. The release manifest contains only `MainActivity` as the app destination; the generated WebView asset directory is single-page and contains no Vault document or collectible assets.
- APK v1.5.23 SHA-256: `B75F5B17021B681976D2F730F93A59556E1842EE6E8E2B07AC9D03204506B458` (1,209,270 bytes); verified with Android APK Signature Scheme v2. It reports `versionCode=9` / `versionName=1.5.23` and packages the egg/Vault removal plus the matched 68px manual and recording cards.
- Google Drive APK (new uniquely named file; prior versions preserved): https://drive.google.com/file/d/1g7tTiSfCgqQuHslDztDcYg2Km3ks-YfT/view?usp=drivesdk

## Constraints

- No Android emulator or physical device is currently attached; browser QA plus packaged-asset verification are available.
- Keep cancellation consequence-free and preserve the existing configurable countdown.
- The release APK is still Android Debug signed for internal review, not Play Store distribution.

## GitHub handoff

- Changes are ready to push to `agent/spin-wheel-focus-cleanup` as the v1.5.23 egg/Vault revert.
- Historical PR #5 is merged: https://github.com/remriel/dictatask-android-native/pull/5
- Run a physical-device smoke test when an Android target is available.

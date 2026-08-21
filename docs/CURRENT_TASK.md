# Current task

## Objective

Keep direct focus optional, place Spin the Wheel below the task list, keep only TO DO/DONE tabs, preserve completed history in completion order, add a safe undo for accidental completions, allow DONE rows to be reopened into TO DO, remove the percentage/status panel, XP, and bottom footer/logo, put recording first, compact the recording form, keep task actions in one row, make the manual-entry surface 50% taller, replace the former daily progress flare with a static theme banner, compact the task filters, keep all button press feedback straight rather than tilted, and show how many calendar days each task has been open.

## Current implementation

- The shipped UI is the bundled React/Vite app in `ui-src/`, copied into `app/src/main/assets/`.
- Spin the Wheel uses a persisted configurable countdown, cancel-safe run IDs, bright task-card shadow colors, and a WebView-safe `requestAnimationFrame` rotation loop.
- The Spin the Wheel face now uses a coherent 90s arcade-console redesign: a cream cabinet with a four-color header stripe, symmetric blue/orange circular frame, yellow ray ring, task-colored wedges, restrained texture, centered `SPIN` hub, and a clear yellow landing marker. The rotor, hub, and landing marker share one measured center so the wheel spins symmetrically around its axis; the orbit, ring-spin, halo, light sweep, marker pulse, and hub pulse run only during the exact three-second spin, while reduced-motion mode disables the decorative loops.
- The recording panel is first on open; the task board follows with Spin the Wheel directly below the task list and task actions below the wheel control.
- Manual task entry is a green 72px inset composer at the bottom of the extended yellow recording panel on mobile. It shares TAP TO RECORD's 90s control language while retaining its green identity: a 3px solid ink frame, 5px hard ink shadow, framed yellow plus/mic/arrow tiles, and a persistent `ADD A TASK MANUALLY` heading with no explanatory subline. The field reveals only while typing or after dictation has supplied text. Its mic always retains the mic glyph and inverts from the normal yellow/ink tile to a black/yellow tile during active dictation. The yellow panel remains visibly above, beside, and below the green card and ends with a flush ink divider after a small clearance for the card shadow. It retains direct typing, a dedicated mic that dictates into the new-task field, and a real submit action.
- On mobile the workspace is a flush full-width stack: one extended yellow recording panel (including the inset green manual composer), cream task board, then a separate green Spin the Wheel card. At every WebView width, the old black canvas/grid and all outer panel border/shadow bands are removed; a safe-area-aware bottom lane keeps the final card clear of Android navigation controls.
- Task tiles now use a 4px darkened version of their own fill color for the border (dark green around green, dark blue around blue, and so on), while retaining their bright shadow color.
- The Spin the Wheel launch label is centered and larger, with the wheel icon anchored to the left edge of its green launch band.
- TO DO and DONE filters are now an equal-width, centered pair that fills the task toolbar. They use visible cream/orange cards with black borders, 35px mobile controls (about 20% above the former compact 29px height), and enlarged count badges while remaining keyboard and touch accessible.
- The former percentage/clear board panel and its daily progress indicator are removed. The top of the mobile workspace now uses a static 42px geometric color banner with a larger rustic `DICTA`/`TASK` sticker: its skewed cream plate and offset black border intentionally break across the banner's lower line and render above the yellow recording surface, with no progress semantics, fill state, timer, or completion-dependent behavior.
- Recording-panel spacing is reduced, and the transcription field is 154px on larger layouts / 133px on mobile (a 30% reduction from the previous compact field values).
- Each open task row has a `FOCUS` action. It starts the same countdown directly, persists a `source: "direct"` challenge, and shows a direct-focus card without the wheel face.
- The Spin the Wheel launch row has an 8px top and bottom gap so its borders stay clear of the task cards and actions below it.
- Direct focus cancellation uses the same consequence-free path as wheel cancellation and leaves task counts unchanged.
- The bottom orange status panel and its stats row are removed.
- XP state, XP accumulation, XP display, and floating XP rewards are removed for now; the top banner is decorative and does not represent completion progress.
- The task board has only `TO DO` and `DONE` tabs, with `TO DO` as the default.
- Completed records remain available in `DONE` through persistent task history, even after active completed rows are cleared.
- `DONE` history is sorted by `completedAt` descending, so the most recently completed task is always at the top. Re-completing a reopened task refreshes its completion timestamp.
- Every task now persists `createdAt` (with a migration fallback for older records). Task rows show a local-calendar age badge such as `OPEN 3 DAYS`; completed history freezes the duration at completion as `OPEN FOR 3 DAYS`. The display refreshes at the next local midnight and when the app becomes visible.
- Completing a task shows a persistent inline `UNDO` bar beneath the task toolbar, so it remains reachable on mobile until the user dismisses it or takes another task action. Undo restores the task, dismiss state, and prior history entry without leaving a false completion behind.
- Every `DONE` row is an accessible checkbox. Tapping, pressing Enter, or pressing Space on a completed row reopens it, removes it from the completion history list, and returns it to `TO DO` without a completion side effect.
- Task titles use a larger mobile-first type scale so they fill more of each card; the per-row `FOCUS` action is intentionally smaller to keep the title dominant.
- The bottom `DICTATASK / LOCAL-FIRST FOCUS` footer and `DT_` mark are removed so the page ends with the task workspace rather than extra branding copy.
- Focus clock, Export .txt, Clear done, and Remove all are compacted to roughly 60% of their former mobile height and forced into one responsive row.
- The transcript action now reads `CONVERT TO TASKS`; its and the `CLEAR TEXT` control's rendered mobile height is roughly 20% smaller (about 57px versus the former 72px) while retaining clear icon and label treatment.
- The standalone bottom Spin the Wheel launch panel is 76px tall, approximately 30% taller than its former 58px control, without changing the safe-area lane below it.
- Every enabled button now has straight tactile motion only: hover/focus lifts it by 1px and a press moves it straight down by 2px with no rotation, skew, or scale tilt.
- Every task completion now opens a brief, completion-only full-screen celebration: the original illustrated yellow checklist “task champion” jumps into view with the existing colorful confetti cannon, rings, and success copy. The 512px transparent PNG is preloaded after first paint for instant Android WebView playback, then does not render while the app is idle. Reduced-motion mode shows the mascot statically and suppresses decorative movement.
- The current branch is `agent/spin-wheel-focus-cleanup`; each release APK is uploaded to Google Drive as a new uniquely named file so prior versions remain available.

## Verification completed

- `npx tsc --noEmit` passed.
- `npm run build` passed and refreshed the packaged WebView assets.
- Browser QA passed for the new below-list placement, two-tab flow, completion-to-DONE history, Clear done history retention, compact action sizing, direct focus, direct cancellation, wheel selection, and the 3-second wheel spin path.
- Browser QA passed for recording-first order, the absent percentage/clear panel, the current static 42px theme banner, the 133px mobile transcription field, and a four-button action row with one shared top coordinate at 390px and 320px widths.
- Browser QA passed for the accidental-completion `UNDO` flow (persistent inline control appeared, task restored, counts/progress restored, control dismissed) and deterministic DONE ordering with the newest completion first.
- Browser QA passed for reopening a completed row from `DONE` (accessible `Reopen …` checkbox, row removed from `DONE`, task returned to `TO DO`) plus mobile typography sizing (16px title / 26px focus button at 390px with no horizontal overflow).
- Browser QA passed for the footerless mobile shell: no `<footer>`, `LOCAL-FIRST FOCUS`, or `DT_` copy remains in the rendered page; the static top banner is 42px tall and the viewport has no horizontal overflow.
- Browser QA at a mobile viewport confirmed task borders resolve to dark color-mixes of each tile (including dark green around the green tile), TO DO/DONE controls render at 29px tall with 7px labels, and the Spin the Wheel label is centered at 14px with its icon anchored left.
- TypeScript and Vite production build passed after replacing the top progress flare with the static decorative banner; the packaged bundle contains no `top-flare`, daily-cycle state, or top progress-bar markup.
- Browser QA passed for the manual-task card nested at the bottom of the yellow recording panel: it follows the transcript actions, the task list remains in its own cream panel, and submitting the manual composer creates a new TO DO row.
- Browser QA passed for the flush mobile stack: the yellow recording panel extends around the inset manual card, the Spin the Wheel launch control remains in its own panel below the cream task board, and the workspace has no external gap or side inset.
- The Android handoff includes a safe-area-aware mobile bottom inset for the Spin the Wheel card. The extended yellow transcript panel now deliberately surrounds the inset manual composer, giving the green control the same framed-card presentation as TAP TO RECORD.
- Browser QA confirmed the workspace bands remain flush at `x: 0` and full viewport width at a 640px Android-style viewport; the green manual composer intentionally retains its 3px frame and 5px hard shadow within the yellow recording panel, the body background is cream, and there is no horizontal overflow. A simulated Android speech bridge filled the manual task field from the dedicated mic control.
- Browser QA at a mobile Android-style viewport confirmed the exact current dimensions: static top banner `42px`, inset manual composer `72px` with 42px framed controls, transcript actions about `57px`, compact TO DO/DONE controls `29px`, centered Spin the Wheel launch band `76px`, and no horizontal overflow.
- Browser QA held representative controls in hover and pressed states: the TO DO tab computed to a straight `-1px, -1px` lift, the recording button computed to a straight `2px, 2px` press, and no rendered button had a rotational transform.
- Browser QA confirmed an active task created three calendar days earlier renders `OPEN 3 DAYS`, while a task created five days earlier and completed two days earlier renders `OPEN FOR 3 DAYS` in `DONE`.
- Browser QA confirmed the banner wordmark is visible at a 360px mobile viewport, remains inside the 42px banner, preserves zero horizontal overflow, and exposes an accessible `DictaTask` banner label.
- Browser QA confirmed the larger sticker measures about 180px wide and 39px tall at 360px, visibly extends past the banner's lower edge, and still preserves zero horizontal overflow.
- Browser QA confirmed the sticker's lower edge remains the topmost element over the yellow surface at the overlap points after the banner stacking layer was raised.
- Browser QA confirmed the Android-style wheel screen renders the redesigned console face without horizontal overflow, the active state exposes `wheel-orbit`, `wheel-halo`, `wheel-ring-spin`, and `wheel-light-sweep`, and the measured machine/rotor/hub centers all align at the same viewport coordinates during the spin.
- Browser QA confirmed TO DO and DONE each render as a centered, equal-width 35px card spanning the task toolbar, with the inactive DONE card visibly outlined instead of collapsing to text-only styling.
- Browser QA confirmed the completion event mounts the new 512px task-champion PNG, runs its `completion-mascot-celebrate` animation with opacity at `1` after 220ms, and renders all 20 existing confetti pieces without horizontal overflow. The completion still exposes UNDO and restoring the task returns it to TO DO.
- Browser QA confirmed the green manual composer now sits inside the extended yellow recording panel in the same inset-card relationship as TAP TO RECORD. It retains its 3px solid ink frame, 5px hard ink shadow, framed yellow plus/mic/arrow controls, and bold title hierarchy without a subline. At 320px it measures 292px by 72px, exposes yellow on every side including a 12px lower clearance beneath its shadow, ends the yellow panel with a full-width 4px ink divider, produces no horizontal overflow, and a real type-and-submit flow created a new TO DO row. The active dictation state retains a yellow mic glyph on an inverted black tile instead of replacing it with text.
- The wheel control is the task list's immediate next sibling in the DOM, and the bottom status panel is absent.
- `:app:testReleaseUnitTest :app:lintRelease :app:assembleRelease` passed. Unit tests remain `NO-SOURCE` because the project has no test files.
- APK v1.5.13 SHA-256: `2EDD5218C5D6421B4A99F2A38C7CF7018ECFFA418955A0025F37D35D72307698` (1,480,006 bytes); `apksigner` verified its Android APK Signature Scheme v2 signature.
- Google Drive APK (new named file; prior versions preserved): https://drive.google.com/file/d/1WQzHDHsd3CHTehF3UT3RY28m9oJsxlaN/view?usp=drivesdk

## Constraints

- No Android emulator or physical device is currently attached; browser QA plus packaged-asset verification are available.
- Keep cancellation consequence-free and preserve the existing configurable countdown.
- The release APK is still Android Debug signed for internal review, not Play Store distribution.

## GitHub handoff

- Changes are pushed to `agent/spin-wheel-focus-cleanup`.
- Draft PR: https://github.com/remriel/dictatask-android-native/pull/5
- Run a physical-device smoke test when an Android target is available.

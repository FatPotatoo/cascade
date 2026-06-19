# PRD — "Cascade" (working title)

**A browser game where you guide falling balls into a bucket by physically arranging colored sticky notes on a real wall.**

| | |
|---|---|
| Status | Draft v0.2 |
| Owner | _you_ |
| Last updated | 19 Jun 2026 |
| Type | Web app / browser game (real-time computer vision) |

> **v0.2 changes:** MVP reframed from a scored arcade game into a **no-pressure "zen physics sandbox with a goal."** No score, no timer, no fail state. The MVP color set is now **two behaviors (pink bouncer + blue brake)**; the green attractor is deferred. See [§17](#17-mvp-scope-what-ships-first) for the slimmed scope and the changelog at the end.

---

## 1. Summary

Cascade is a single-player browser game played in front of a webcam. The camera looks at a wall. The game overlays a physics world onto the live feed: balls fall from the top, and a digital bucket sits at the bottom. The player's job is to get the balls into the bucket — but the only controls are **physical sticky notes stuck on the real wall**. Different colors do different things (bounce, brake), and the *angle* you tilt a note at changes where the ball goes.

It turns a wall and a pack of sticky notes into a tactile, real-world physics puzzle. Nothing leaves the device — all vision and physics run client-side in the browser.

There is no scoring, clock, or fail state in v1. The single goal is simple and embodied: **arrange real paper until a falling ball drops into the bucket.** When one does, the game says "Well done!" and balls keep falling so you can keep sinking them.

This is a direct, game-shaped evolution of an existing prototype that already does HSV color detection, contour + angle extraction, corner-pin perspective warping, anti-jitter spatial tracking, and Matter.js collision generation. Cascade reuses that whole pipeline and adds game rules on top.

---

## 2. Background & rationale

The prototype proved the hard part works: colored objects on a wall can be detected, de-warped, and turned into live physics colliders in real time. But a tech demo isn't sticky on its own — there's no goal, no feedback loop, no reason to keep playing.

Cascade adds the missing layer: **a goal (land a ball in the bucket) and a constraint (you can only use physical notes), with skill coming from color choice + angle + placement.** The physicality is the hook — it's the rare game where the controller is a stack of Post-its and your own hands.

We deliberately keep v1 *calm*: no score chasing, no time pressure. The satisfaction is the tactile "aha" of tilting paper a few degrees and watching a digital ball respond, then funnel home. Pressure mechanics (scoring, combos, timers) are a fast-follow once the core loop is proven fun.

**Why it can become a real app:** zero install (browser), zero special hardware (any webcam + sticky notes most people already own), instantly understandable goal, and a natural freemium path (free core game, paid level packs / premium colors / no-camera "sandbox" mode).

---

## 3. Goals & non-goals

**Goals**
- Ship a playable browser game runnable on a laptop webcam with no install.
- Make the color-behavior system the core, learnable mechanic, with **two behaviors** that are both load-bearing (you need both aim *and* speed control to reliably score).
- Keep end-to-end latency low enough that physically moving a note feels immediate (target < 100 ms feed-to-physics).
- Make onboarding (camera + color calibration) take under 60 seconds.
- Keep 100% of processing on-device for privacy.
- Keep the experience **low-pressure**: a player can succeed at their own pace, with no failure punishment.

**Non-goals (for v1)**
- Scoring, combos, timers, leaderboards (including local high scores). v1 has **no scoring system at all**.
- Multiplayer / networked play.
- Mobile-phone-as-camera (desktop webcam first; phone is a fast-follow).
- True depth sensing / stereo 3D. (But see **Visual foreground occlusion** below — a 2D approximation is a planned late-stage polish, not a hard non-goal.)
- Handwriting/OCR or any reading of note content.
- Account systems, cloud save.
- Green attractor and other expansion behaviors (deferred — see [§7](#7-the-core-mechanic-color-coded-behaviors)).

---

## 4. Target audience

- **Tinkerers & makers** — the original audience who'd find this on Patreon/Reddit/Hacker News and love the CV angle.
- **Casual puzzle players** — anyone who likes physics sandboxes (think Crayon Physics, Incredible Machine, Peggle), now with a tactile twist and no pressure.
- **Classrooms / family / offices** — a quick, screen-shareable group activity using stuff already on the desk.

---

## 5. Core gameplay loop

1. A session starts. A spawn spout is placed at a **random spot along the top** of the play area, then **fixed for the rest of the session**.
2. Balls fall from that same fixed spout as a **gentle stream** (roughly one every 2–3 seconds).
3. The player watches the trajectory.
4. The player **physically moves, rotates, adds, or removes a sticky note** on the wall.
5. The detection pipeline picks up the change and updates the collider's position, angle, and behavior live.
6. Balls deflect (pink) and brake (blue) accordingly and, ideally, land in the bucket.
7. **Miss:** no penalty — the ball simply exits the play area and the next ball keeps coming.
8. **Catch:** a "**Well done!**" celebration plays, and balls keep falling from the same spot so the player can keep sinking them.

The tension is real-time and embodied: you're reaching up to a wall, tilting paper a few degrees, and watching a digital ball respond. The "aha" is realizing **the angle of the note is your aim — and a brake is what makes it stay in the bucket instead of bouncing out.**

There is no clock and no fail state. The session continues as long as the player wants.

---

## 6. Game mode

v1 ships with a **single game mode — Zen.** There is no mode selector; "Play" goes straight into it.

**Zen:** a continuous gentle ball stream from a fixed-per-session spout. Rearrange notes live. No score, no clock, no fail state. Land a ball → "Well done!"; balls keep coming. The player plays as long as they like.

**Possible future modes (not planned, captured only so the design leaves room for them):** a scored *Arcade* (combos, miss-cap), a *Puzzle* mode (fixed scenarios, star ratings), and a *Timed challenge*. These are explicitly out of scope and have no committed priority; revisit only after Zen is proven fun.

---

## 7. The core mechanic: color-coded behaviors

Each sticky-note color maps to a physics behavior. The detected **bounding box + rotation angle** define the collider; the **color** defines how it behaves. **The color→behavior mapping is chosen by the player at calibration** (bring-your-own palette — see [§11.1](#111-first-time-setup-target--60s)), not hardcoded. The table below uses the *default suggested* colors.

### MVP behaviors (2 roles)

| Role (behavior) | Default color | Physics implementation | Player use |
|---|---|---|---|
| **Bouncer / Ramp** | Magenta (suggested) | Static body, high restitution (~0.9). Reflection follows the note's surface angle. | The primary aiming tool. Tilt it to redirect balls toward the bucket. **Its angle is the aim.** |
| **Dampener / Brake** | Cyan-blue (suggested) | Static body, near-zero restitution (~0.05) + high surface friction. | Kills speed so a ball drops *into* the bucket instead of bouncing back out. Essential, not optional flavor. |

Colors are **suggestions, not requirements** — a player who only owns yellow and green can assign yellow→Bouncer and green→Brake. The app auto-suggests the two best-separated colors from whatever the player has, and warns if the chosen pair is hard to tell apart (see [§13](#13-functional-requirements) FR-9a/9b/12).

**Both behaviors are load-bearing.** The bucket's inner walls carry slight restitution, so a ball arriving too fast bounces out. To reliably score you must **aim with the Bouncer** *and* **control speed with the Brake**. The satisfying core beat is the sequence "redirect it over the bucket, then brake it in." Depth in the MVP comes from angle precision + speed control + combining notes (two Bouncers form a longer bounce lane; Bouncer-then-Brake is aim-then-settle), not from adding more colors. (With only one color assigned, the player has the Bouncer alone — playable but harder.)

### Expansion colors (post-MVP)

| Color | Behavior | Notes |
|---|---|---|
| **Green** | **Attractor / Magnet** | Invisible radial force field pulling nearby balls toward its center. Deferred from MVP: it's the least tactile behavior (invisible, ignores angle) and risks trivializing aiming. Reintroduce with a strict strength cap and field-count limit once the core loop is proven. |
| **Yellow** | **Booster / Conveyor** | Applies directional force along the note's long axis (uses angle). Pushes balls "uphill" or speeds them up. |
| **Orange** | **Bumper / Repeller** | Pinball-style outward impulse on contact. High energy, hard to control — high skill ceiling. |
| **Purple** | **Splitter / Portal** | Advanced/novelty: spawns a second ball, or teleports to a paired purple note. Gated to later levels. |

**Design rule:** every behavior must plausibly serve the funnel-to-bucket goal, and angle/placement must matter. Behaviors that are pure RNG get cut. Two notes of the same color must combine sensibly (two ramps = a longer ramp).

---

## 8. The bucket & ball rules

- **Bucket:** a digital container rendered at the bottom of the play area, with an open top of a defined width and solid walls/floor (static Matter bodies). **Fixed position for the whole session** in Zen mode. Its inner walls carry slight restitution so a ball arriving too fast bounces out — this is what makes the blue brake matter.
- **Catch:** a ball is "caught" when it enters the opening and comes to rest (low velocity) inside. Triggers the "Well done!" celebration. Caught balls settle visually / are removed.
- **Miss:** a ball exits the bottom edge of the play area *outside* the bucket, or leaves the play area sideways. **No penalty** — play simply continues.
- **Spawn:** balls drop from a single spout at the top. The spout position is **randomized at session start, then fixed for the rest of the session**. Balls fall as a **gentle stream** (~one every 2–3 s). Ball size and fall speed are difficulty knobs for later modes; in Zen they're tuned to be forgiving (slower, heavier early balls).

---

## 9. Win / lose & scoring

**Zen (MVP)**
- **No score, no timer, no fail state, no leaderboard.**
- The only success event is **landing a ball in the bucket**, which shows a "**Well done!**" celebration. Balls keep falling from the same spot afterward; the player keeps playing as long as they like.

**Arcade / Puzzle (fast-follow)** — scoring, combos, miss-caps, and star ratings live here, not in the MVP. Specced when those modes are built.

No backend in v1. Because the MVP has no score, there is **no high-score persistence**; localStorage is used only for calibration (see [§11.2](#112-returning-session)).

---

## 10. Difficulty & variety (Zen mode)

Zen mode has no escalating difficulty curve — it's a calm, self-paced sandbox. Variety comes from:
- **Spawn spout randomized per session**, so each new session is a fresh geometry to solve.
- **Bucket position** may be varied per session in a later iteration (fixed in the first cut).
- Ball fall speed/weight tuned to be forgiving and consistent within a session.

(The escalating difficulty knobs — ball speed, spawn rate, off-axis spawn, narrowing bucket, multiple spouts, digital obstacles, expansion colors — belong to the **Arcade** and **Puzzle** modes and are deferred with them.)

---

## 11. User flows

### 11.1 First-time setup (target < 60s)
1. Land on site → "Play" → browser camera permission prompt.
2. **Define play area (corner-pin):** drag four corners over the wall region the game should use (reuses existing perspective-transform tool). Everything outside is ignored.
3. **Pick your colors (bring-your-own palette):** rather than requiring a specific kit, ask *"Which sticky-note colors do you have?"* The player taps the colors they own from a palette of common sticky-note hues; each swatch shows a detection-reliability hint (bright magenta = great, pale yellow = tricky).
4. **Assign roles:** Cascade needs two kinds of block — **Bouncer** (aim) and **Brake** (speed control). Each role gets a color picker populated from the colors chosen in step 3. The app auto-suggests the two best-separated colors, but the mapping is **fully editable** — the player decides which color is which block.
   - **1-color play:** if the player only has one usable color, they may still play with the **Bouncer only** (aiming, no brake — harder to keep balls in, but never blocked). We recommend a second color but don't require it.
   - **Extra colors:** colors beyond the two roles are ignored in v1 (only Bouncer + Brake exist); the UI may note "more block types coming soon."
5. **Color calibration:** for each *assigned* color, "Hold up your [magenta] note and tap it." The app samples the actual HSV under current lighting and sets the threshold. (Critical — lighting varies wildly; hardcoded thresholds fail.) Calibration warns if the two assigned colors are too close in HSV to separate reliably, and lets the player swap a color without restarting.
6. Short interactive tutorial: one ball, the Bouncer note, "tilt it to drop the ball in the bucket," then (if assigned) introduce the Brake to "stop it bouncing back out."
7. Play.

### 11.2 Returning session
- Remembers last calibration (localStorage). Offer "Re-calibrate" if detection looks off. A lightweight "lighting changed?" recheck on launch.
- A new session re-randomizes the spawn spout (see [§8](#8-the-bucket--ball-rules)).

---

## 12. Screens / UI surfaces

- **Landing page** — pitch, short looping demo, Play button, link to your Patreon/source.
- **Permission + calibration flow** — camera prompt, corner-pin, color sampling (pink + blue).
- **Game view** — live feed with physics overlay; minimal HUD: active color legend (pink/blue), pause, re-calibrate. **No score/combo/miss counters in MVP.** A "Well done!" celebration overlay on each catch.
- **Settings** — camera select, sensitivity, audio, color-behavior legend/reference.

(There is no mode-select screen — "Play" goes straight into Zen. Level select, game-over/results, and high-score screens are not part of v1.)

---

## 13. Functional requirements

**Camera & feed**
- FR-1 Request webcam via `getUserMedia`; handle denied/no-camera gracefully with a clear message and a no-camera Sandbox fallback (virtual mouse-placed notes).
- FR-2 Let the user pick among multiple cameras.
- FR-3 Run the capture/process loop at a stable frame rate (target 30 fps).

**Detection (CV)**
- FR-4 Convert each frame to HSV and threshold against the *calibrated* ranges for each active color (pink, blue).
- FR-5 Find contours, derive each note's bounding box, centroid, and rotation angle (`minAreaRect`).
- FR-6 Apply the corner-pin perspective transform so detected positions map correctly into game space.
- FR-7 Apply spatial/temporal smoothing (existing anti-jitter "freeze") so static notes produce stable colliders.
- FR-8 Track notes frame-to-frame so a moved note updates the *same* collider rather than spawning a new one (track-by-proximity).
- FR-8a **Occlusion hold:** when a tracked note's detection is briefly lost (e.g. a hand crosses it), **hold its collider in the last known position** rather than deleting it. Only remove the collider after detection has been absent for several consecutive frames. A passing arm must never drop a ball.

**Calibration**
- FR-9 Interactive four-corner play-area definition.
- FR-9a **Color selection:** present a palette of common sticky-note colors with reliability hints; the player selects which colors they physically have.
- FR-9b **Role assignment:** map each behavior role (Bouncer, Brake) to one of the selected colors. Auto-suggest the two best-separated colors; allow the player to edit the mapping freely. Support **1-color play** (Bouncer only) and ignore colors beyond the two roles.
- FR-10 Per-(assigned-)color HSV sampling from a held-up note; persist the full calibration profile (selected colors, role→color mapping, sampled HSV ranges) to localStorage.
- FR-11 Re-calibration available any time without restarting, including changing color selection and re-assigning roles.
- FR-12 Calibration warns/rejects if the two assigned color samples overlap too much in HSV to be separated reliably, and offers to swap a color.

**Physics (Matter.js)**
- FR-13 Generate a static body per detected note, sized/angled to the detection.
- FR-14 Apply the behavior (pink: high restitution; blue: low restitution + high friction) based on the note's color.
- FR-15 Spawn balls at the session's fixed spout as a gentle stream; apply gravity.
- FR-16 Bucket as static container with slight inner-wall restitution; detect catch (enters opening + rests) and miss (exits play area outside bucket). Miss has no penalty.

**Game logic & UI**
- FR-17 Choose a random spawn spout at session start; keep it fixed for the session.
- FR-18 On catch, trigger a "Well done!" celebration; continue spawning from the same spout.
- FR-19 Render the physics overlay aligned to the feed.
- FR-20 Pause/resume; restart session (re-randomizes spout).

**Audio (nice-to-have for v1)**
- FR-21 Bounce, brake, catch ("well done" sting), and ambient sounds (Web Audio / Tone.js). Mappable to pitch by position for flavor.

**Accessibility**
- FR-22 Colorblind-aware legend: pair each color with an icon/pattern, and optionally overlay a distinguishing symbol on detected notes, since color *is* the mechanic.

---

## 14. Technical architecture

**Stack:** vanilla JS (ES modules, built with Vite), a **dependency-free pure-JS computer-vision pipeline** for detection, Matter.js for physics, Canvas 2D for rendering, Web Audio/Tone.js for sound, localStorage for calibration persistence. No backend required for v1.

> **Vision: pure JS, not OpenCV.js.** We originally planned OpenCV.js, but its ~11 MB WASM build initializes synchronously and froze the main thread (and blocked the camera prompt). Our detection needs are modest — HSV threshold, blob finding, orientation — so vision is now hand-written JS that runs in a few ms on a downscaled frame: zero dependency, no WASM, no freeze, and trivially movable into a Web Worker later if needed.

**Pipeline (per frame):**
```
webcam frame
  → pure-JS: RGB→HSV per pixel
  → per-color threshold (calibrated colors) → binary mask
  → connected-components (flood fill) → blobs
  → image moments → centroid + orientation + size
  → perspective transform (corner-pin) → game coordinates
  → temporal smoothing / freeze (anti-jitter)
  → diff against tracked notes (moved? new? gone?  + occlusion-hold)
  → update Matter.js static bodies (position / angle / behavior)
Matter.js step:
  → integrate balls under gravity
  → resolve collisions (restitution/friction per color; bucket inner-wall restitution)
  → catch/miss detection (miss = no penalty)
Render:
  → draw feed + physics overlay + bucket + spout + "Well done!" celebration
```

**Detection detail.** Color = behavior assignment, so the calibrated HSV ranges must be well-separated; the calibration step warns if the two sampled colors overlap. Note angle comes from `minAreaRect`. Track-by-proximity (nearest previous note within a radius) so moving a note updates one body, not create-destroy churn. Apply the occlusion-hold rule (FR-8a) so transient detection loss doesn't delete a collider.

**Physics detail.** Notes are *static* bodies whose transform is driven by detection each frame. Move static bodies via `Matter.Body.setPosition/setAngle` (not by re-creating) to keep the world stable. The bucket's inner walls carry slight restitution so fast balls bounce out — making the blue brake meaningful. (Field forces like the green attractor/yellow booster are deferred with those colors.)

**Recommended starter color kit.** With only two colors, separation is both easier and more important. Recommend **hot magenta/pink + strong cyan-blue** — maximally separated in HSV and robust under typical indoor lighting. Onboarding should nudge users toward **bright, saturated** notes; pastels wash out and overlap with skin/wall tones.

**Performance budget (per frame, ~33 ms at 30 fps):** vision ≤ ~20 ms, physics + render ≤ ~10 ms. If over budget: downscale the processed frame (process at lower res than displayed), cap ball count, throttle detection to ~15–20 Hz while rendering physics at 60.

**Visual foreground occlusion (planned, late-stage polish — NOT in early milestones).** Today the physics overlay is a single flat layer drawn *on top of* the webcam image, so anything between the camera and wall (a hand, a person) has balls sliding over it — which looks wrong, since balls should appear to move *on the wall* and pass *behind* real objects in front of it. The intended fix is **2D foreground segmentation**, not true depth: each frame, derive a foreground mask (person/hand segmentation, e.g. MediaPipe Selfie Segmentation, or background subtraction against the calibrated empty wall) and **render balls only where the mask says "wall,"** clipping them behind foreground objects. This is a render-time masking change plus one more per-frame model in the budget; it is deliberately scheduled at the **end** (polish), after the core loop and detection are solid. It is distinct from the gameplay occlusion-hold (FR-8a), which keeps a note's *collider* alive during brief occlusion — that is already required and unaffected.

---

## 15. Non-functional requirements

- **Latency:** feed-to-physics under ~100 ms so note moves feel live.
- **Privacy:** all processing on-device; no video/frames leave the browser. State this prominently — it's a feature.
- **Performance:** playable on a mid-range laptop with integrated webcam.
- **Resilience:** survive lighting shifts (re-calibration), partial occlusion (a hand reaching to a note must not drop a ball or crash the world — see FR-8a), and momentary detection loss (smooth, don't snap).
- **Accessibility:** colorblind-aware — pair each color with an icon/pattern in the legend and (optionally) an overlay symbol on detected notes, since color *is* the mechanic.
- **Tone:** the experience should feel calm and forgiving — no punishment, no urgency, no clutter.

---

## 16. Edge cases & risks

| Risk | Mitigation |
|---|---|
| **Lighting variance breaks color thresholds** (biggest risk) | Per-session color calibration from real notes; overlap warning; quick re-cal. |
| **Hands/arms enter frame while placing notes** | Occlusion-hold (FR-8a): keep the collider in place during brief detection loss. Size/shape filtering; temporal smoothing rides over occlusion. |
| **Jitter creates unstable colliders** | Existing freeze/anti-jitter; deadzone so sub-threshold movement doesn't update the body. |
| **Two colors too similar to the camera** | Recommend hot-magenta + cyan-blue (well separated); calibration rejects overlapping samples. |
| **Latency makes it feel laggy** | Process at reduced resolution; decouple detection rate from render rate. |
| **No webcam / permission denied** | Clear messaging + no-camera Sandbox using mouse-placed virtual notes. |
| **Fast balls bounce straight out of the bucket** | Intended — it's what makes blue matter. Tune inner-wall restitution so a *braked* ball settles but a fast one rejects. |
| **Background clutter detected as notes** | Corner-pin play area limits the active region; size/aspect filtering. |

---

## 17. MVP scope (what ships first)

**In:**
- Webcam feed + corner-pin + color calibration (pink, blue) with overlap warning.
- Two behaviors: **pink bouncer (aim)** + **blue brake (speed control)**, both load-bearing.
- Falling balls as a gentle stream from a fixed-per-session, randomly-placed spout.
- One bucket (fixed position) with slight inner-wall restitution.
- **Zen mode** only: no score, no clock, no fail state. Catch → "Well done!" → keep playing.
- Occlusion-hold so a reaching hand never drops a ball.
- Basic sound.
- Colorblind-aware legend.

**Out (fast-follow):** scoring/Arcade mode, Puzzle/Sandbox modes, green attractor + other expansion colors, levels & difficulty progression, high scores, phone camera, sharing, daily challenge.

A reasonable v1 "good enough to release": a person points their laptop at a wall, calibrates in under a minute, and — by tilting a pink note to aim and placing a blue note to kill speed — can reliably land a ball in the bucket and see "Well done!"

---

## 18. Success metrics

- **Activation:** % who grant camera and finish calibration → reach first ball drop.
- **First-catch rate:** % who land a ball in their first session (the core "it works!" moment — now the single most important metric, since it *is* the goal).
- **Session length & repeat play.**
- **Re-calibration frequency** (proxy for detection reliability — want it low after first setup).
- Qualitative: does moving a physical note feel responsive and fun? Does the calm, no-pressure framing land?

---

## 19. Open questions

1. **Bucket position — fixed forever, or varied per session?** First cut fixes it; per-session variety could add freshness without adding pressure.
2. **"Well done!" cadence** — celebrate every catch, or only the first catch of a session (then a quieter chime for subsequent catches to avoid fatigue)?
3. **Ball stream rate** — is ~one every 2–3 s the right "gentle"? Should it pause briefly after a catch?
4. **When to reintroduce green** — and at what capped strength so it doesn't trivialize aiming?
5. **Phone-as-camera** — worth prioritizing given most people would point a phone at a wall rather than a laptop? (Possibly a better primary platform long-term.)
6. **Ball appearance/feedback** — trail, squash-and-stretch, sound-by-position — how much juice before it stops being calm?

---

## 20. Suggested milestones

1. **M0 – Harness:** port the existing detection + corner-pin + Matter pipeline into a clean game scaffold.
2. **M1 – Calibration:** interactive corner-pin + per-color HSV sampling (pink, blue) with persistence and overlap warning.
3. **M2 – Core loop:** gentle ball stream from a fixed-per-session random spout, gravity, one bucket, catch/miss detection (miss = no penalty).
4. **M3 – Behaviors:** pink bouncer + blue brake wired to detected color; bucket inner-wall restitution tuned so both matter.
5. **M4 – Zen feel:** "Well done!" celebration, occlusion-hold robustness, calm tuning.
6. **M5 – Polish:** sound, tutorial, landing page, colorblind legend.
7. **M6 – Release:** ship v1; gather feedback; then scoring/Arcade, Puzzle mode, and expansion colors.
8. **M7 – Visual foreground occlusion (end-stage):** 2D foreground segmentation so balls render *behind* hands/people and appear to move on the wall (see [§14](#14-technical-architecture)). Deliberately last — it's a render-time polish layer, not core to the loop.

---

## Changelog

- **v0.2.3 (19 Jun 2026)** — **Dropped OpenCV.js for a dependency-free pure-JS vision pipeline** (HSV threshold → connected-components → image-moment orientation). OpenCV's ~11 MB WASM init froze the main thread and blocked the camera prompt. Also: camera now starts only on a user gesture (Play), and a denied/blocked camera redirects to the landing page with a clear message. Game lives at its own route (#/play); Exit + browser Back return home and release the camera.

- **v0.2.2 (19 Jun 2026)** — Added **visual foreground occlusion** as a planned end-stage polish (M7): balls should render behind real objects in front of the wall via 2D foreground segmentation (not true depth). Softened the §3 depth non-goal accordingly. Added the **landing page** (camera stays off until Play) and the **bring-your-own-palette corner-pin + detection** build (corner-pin play area, OpenCV HSV detection, proximity tracking with occlusion-hold, role-based note colliders).
- **v0.2.1 (19 Jun 2026)** — **Bring-your-own palette:** calibration now asks which colors the player has and lets them assign each color to a behavior role (Bouncer/Brake), instead of requiring a fixed kit. Supports 1-color play (Bouncer only); ignores colors beyond the two roles. Reframed §7 around behavior *roles* with suggested (not required) colors; added FR-9a/9b and updated FR-10–12 and the onboarding flow (§11.1).
- **v0.2 (19 Jun 2026)** — Reframed MVP from scored Arcade to no-pressure **Zen mode** (no score/clock/fail/leaderboard). Reduced MVP color set to **2 behaviors (pink + blue)**; deferred green attractor. Defined fixed-per-session random spawn spout, gentle ball stream, "Well done!" celebration, and bucket inner-wall restitution so both colors are load-bearing. Added occlusion-hold requirement (FR-8a). Recommended hot-magenta + cyan-blue color kit. Removed high-score persistence. Renumbered functional requirements; updated modes, scope, risks, metrics, open questions, and milestones accordingly.
- **v0.1** — Initial draft: scored Arcade MVP with 3 behaviors (pink/blue/green).

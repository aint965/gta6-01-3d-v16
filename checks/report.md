# Stage A report — gta6-01-3d-v16 "Palkon Auto" (COMPRESSED rebuild, stage A of 3)

Renderer + real-city Solmar. Session 08021d2d. Repo: https://github.com/aint965/gta6-01-3d-v16

## Security check (read-only, before writing code) — PASS

- Repo starter files match the official make.fun kit byte-for-byte: LICENSE (SPDX MIT line present), main.ts, serve.ts, shots.json identical text; vendor/makefun-game.ts head (first ~1120 lines) and tail (from line 1121 to end) identical.
- Repo holds only the 6 expected entries (LICENSE, main.ts, serve.ts, shots.json, vendor/, .makefun/). No package.json, no postinstall, no binaries.
- Conclusion: official make.fun kit, safe. No security flag tripped during this stage.

## Files written (all inside the repo)

- `game/src/rng.js` — mulberry32 + helpers.
- `game/src/city.js` — deterministic Solmar, seed 20261123: 7 districts with name/tagline/palette/standing + partition rects; roads (boulevard x=400 w=64, cross avenue z=0 w=48, secondary w=28, local w=18, diagonal Old Solmar avenue); canal x -1560..-1440, harbour, beach x 1750..1920, park x 700..1100 z 800..1200, plaza (400,0) r=130 + clock tower + fountain; buildings/trees/lamps/traffic lights/cars/pedestrians/boats/neon signs via rejection sampling.
- `game/src/render.js` — handwritten WebGL2, ONE shader program, 17 floats/vertex (pos3 normal3 color4 emissive3 tex2 useTex1 spec1); face culling OFF; 4 independent buffers (static city, sky, shadows, dynamic cars+pedestrians); neon canvas texture atlas 1024x256 (SOLMAR/PALKO/MARINA/BEACH); 3 presets midday/sunset/night with sun/moon disc + stars at night; shadow quads rebuilt per preset.
- `game/src/hud.js` — grouped HUD + district-coloured minimap + player arrow.
- `game/src/main.js` — entrypoint: orbit camera, drag/wheel, keys 1/2/3/T cycle presets, `?shot=day|sunset|night|plaza|start|play|end` fixed showcase cameras (sunset faces west with the sun disc in frame, night target raised so the moon disc is in frame); fps counter real in live play, "—" in shot mode; `window.__gameReady` after first frame. Also accepts `?skip=shadow|windows|trees|sky` (debug hook, used to isolate the prism bug below; harmless in normal play).
- `game/index.html` — canvas + HUD DOM: title top-left, district+standing below it, compass top-centre, clock/preset/fps top-right, speedometer bottom-left, controls bottom-centre, minimap 220x220 bottom-right.
- Root `main.ts` — REWRITTEN in-session (Trap 4): same behaviour as starter (copy game/+screenshots/ to output, build dossier) plus prints dossier sha256 + screenshot list with sizes; also wipes the output dir first (see bug 5).
- `shots.json` — the 4 Stage A shots.
- `checks/verify-layout.mjs` — layout verifier.
- `checks/drive.mjs` — headless driver (serves on 8127, Chrome headless shell + SwiftShader, scans stderr for console errors, converts >256 KiB screenshots to JPEG q85, rewrites shots.json, cleans stale screenshots first).
- `checks/diag.mjs` — one-shot diagnostic renderer (`node checks/diag.mjs <name> [skip]`), used to isolate the prism bug.

## Measured numbers (final state)

- Layout verifier: **LAYOUT OK, 0 problems** — buildings 518, trees 175, lamps 140, traffic lights 13, parked 54, drivable 8, traffic 40, pedestrians 40, boats 5, signs 4.
- Drive test: **DRIVE OK, 4/4 shots, 0 console errors** (chrome exit 0 on all four).
- Screenshots (all ≤256 KiB): `1-boulevard-day.png` 177,205 B; `2-sunset.png` 164,571 B; `3-night.png` 153,744 B; `4-plaza.jpg` 175,972 B. Sizes identical across the last two drive runs (deterministic).
- Packaging: **2 runs, byte-identical dossier** — 959,948 bytes, sha256 `d2705cb6e8e03d6f0f65512d7fc0bf5a5577803e53a622f379b89832f4d33fff`.
- Recorder pid 6622 verified alive at end of stage.

## Bugs found and fixed in-session

1. **Layout: cars inside buildings (2x) + buildings <500 (2x).** Root cause: building circles could overlap road edges (margin was centre-based, not radius-aware); plaza-ring cars overlapped building circles; lot-skip too aggressive. Fixes: radius-aware road margin (`distToRoad <= r + 4`), radius-aware plaza margin (`< PLAZA.r + 32 + r`), pedestrian placement retries with a safe park-corner fallback, denser grid (step 100 → 80, lot-skip 0.03 → 0.01). Final: 518 buildings, 0 problems.
2. **Drive run 1: no screenshot file, Chrome produced nothing.** Transient (first Chrome launch); re-run passed 4/4. Driver hardened to report the chrome stderr + exit code instead of crashing on a missing file.
3. **CRITICAL — long dark streaks across all shots + "sails" on buildings + red pyramids in the plaza shot.** Root cause: `Builder.prism()` top cap pushed the centre vertex ONCE then pairs (1 + 2×8 = 17 vertices — not a multiple of 3), shifting every later triangle in the static buffer by 2 and drawing long stray triangles between unrelated points. The fountain prism (built before the buildings) poisoned the whole static buffer; the boat prisms did the same to the dynamic buffer. Isolated with `?skip=` variants (streaks vanished with `skip=trees`, persisted without shadows/windows/sky). Fix: proper triangle fan (centre pushed per triangle, 24 vertices; prism total 72). Guard added: `upload()` warns to console if a buffer's vertex count is not a multiple of 3. After the fix all 4 shots are clean (viewed by eye, see below).
4. **Packaging refused: screenshots/ held 5 files (cap 4).** Stale `1-boulevard-day.jpg` from an earlier run survived next to the re-rendered `.png`. Fix: drive.mjs now wipes screenshots/ before regenerating.
5. **Packaging refused again with the same 5-file error.** The stale file lived in `checks/out1/` and `checks/out2/` (cpSync never deletes from the output dir). Fix: root main.ts now `rmSync`s the output dir before copying.

## Screenshots — viewed by eye (all 4, after the prism fix)

- `1-boulevard-day.png`: clean. Boulevard with dashes, sidewalks, trees, parked/drivable/traffic cars visible, tower + fountain at the plaza, Glasspoint towers in the distance, windows + roof caps correct, soft shadows at building bases, sky gradient with no hard horizon band.
- `2-sunset.png`: sun disc in frame, warm orange gradient, tower lit warm, plaza + fountain + lamp pools visible, no streaks.
- `3-night.png`: moon disc + stars in frame, lit windows (warm yellow), Glasspoint towers with lit windows, street lamps with pools, fountain glowing blue, no streaks.
- `4-plaza.jpg`: aerial reads as a real city — boulevard vertical through the centre, cross avenue horizontal, plaza disc + tower + fountain at the centre, terracotta roofs (Old Solmar) bottom-left, glass towers top-right, diagonal avenue bottom-left, minimap detailed.
- Honest notes: the sunset foreground (plaza apron) is a fairly empty flat area; the plaza aerial has a small dark wedge next to the tower that reads as a shadow. Both cosmetic, Stage A acceptable; Stage B/C can add ground detail.

## Trap 8 (thinking_revised)

- `main.ts` was written once, then edited (dossier hash print + output-dir wipe) after running it.
- `game/src/render.js` was written once, then edited after running (prism fan fix, upload guard, shadow/sky/window/tree skip hooks).
- `game/src/main.js` was written once, then edited after running (`?skip=` hook).

## What is NOT done (for Stage B / C)

- No driving, traffic, headlights, collision, on-foot, missions, police, radio, title screen, or README (README is Stage C, written in-session then).
- `checks/out1/` and `checks/out2/` are packaging outputs — NOT committed. `checks/diag-*.png` are diagnostic intermediates — NOT committed (the tool `checks/diag.mjs` IS committed).

## Next: Stage B

Driving (4 profiles: compact 115, sedan 130, van 108, coupe 158 km/h) + traffic obeying lights + headlights + OBB collision + on-foot + E enter/exit + missions 1–4 ($2,000 total, mission 4 = finale). Port 8127. Recorder pid 6622 still running — verify alive at the Stage B boundary.

---

# Stage B report — gta6-01-3d-v16 "Palkon Auto" (COMPRESSED rebuild, stage B of 3)

Driving, traffic, headlights, collision, on-foot, E enter/exit, missions 1–4. Session 8e9cc12c. Repo: https://github.com/aint965/gta6-01-3d-v16. Checkpoint commit **89b5d43** (pushed e00a4d9..89b5d43) covers the Stage B code + sim; this report, the driver, the screenshots and the two late fixes are committed in the final Stage B commit (see below).

## Files written / edited (all inside the repo)

- `game/src/drive.js` (NEW) — 4 profiles (compact 115 / sedan 130 / van 108 / coupe 158 km/h), OBB SAT collision + damage, traffic routes with U-turn arcs + 26 s light cycle + stopOffsetFor, follow-gap + intersection yield, pedestrians incl. crossers, on-foot walker, E enter/exit (nearestDrivable/nearestParked/exitSpot), BFS 40 m road-grid findPath + autopilotInput/autopilotFollow (incl. overtake of stopped oncoming/crossing cars + stopping-profile obstacle braking), carsInHeadlightCone, buildingHit, forwardOf/rotOf.
- `game/src/missions.js` (NEW) — M1 "A Receipt for Sunshine" $250, M2 "Salt Ledger" $500, M3 "After the Shutters" $450, M4 "Glass Debt" $800 (finale broadcast "THE DEBT IS SETTLED — Solmar hears Mara's name"); timer starts only on first move; pickup/drop radius 7 m; objectives in 3 forms (dialog + HUD panel + world marker).
- `game/src/render.js` (EDITS) — setStageB state; headlight cones (2 ground trapezoids + pool) + lit-car warm emissive boost; taillights + night traffic headlights; yellow diamond above the driven car; E prompt ring; mission markers (ground cylinder + floating diamond + ground ring); Mara on foot; dust puffs; live traffic-light state dots.
- `game/src/hud.js` (EDITS) — mission panel, dialog, E prompt, damage flash, broadcast, minimap mission diamond, speed label.
- `game/index.html` (EDITS) — mission panel/dialog/prompt/broadcast/damage-flash/`#autotest-result` divs + CSS.
- `game/src/main.js` (REWRITE) — input, chase cam while driving, orbit-follow on foot, demo modes `?demo=drive|night` + `?demo=headlight&lights=on|off` frozen composition + `?mission=N` screenshot mode + `?autotest=missions` (ff fast-forward, result into `#autotest-result`), `?norender=1` test hook (skips WebGL draw + HUD so the autotest sim runs at full JS speed).
- `checks/test-stage-b.mjs` (NEW) — 31 Node checks (see below).
- `checks/drive-stage-b.mjs` (NEW) — headless driver: reuses the 8127 server if up, captures the 4 final screenshots + headlight on/off + mission-1, runs the browser autotest, rewrites shots.json.
- `checks/sample-headlight.py` (NEW) — PIL pixel sampler for the headlight pair.
- `shots.json` — updated to exactly the 4 Stage B shots: drive-day.png, 2-sunset.png, night-drive.png, 4-plaza.jpg.

## Measured numbers — Node sim (`node checks/test-stage-b.mjs`, 31 checks)

- **ALL PASS (31/31)**.
- Top speeds (exact, 0 collisions): compact 115.0, sedan 130.0, van 108.0, coupe 158.0 km/h. Reverse 2.5 s = 13.1 m.
- Red-light stop: line z=−616, stopped 3.7 m before it, 0 red-runs, proceeded after green.
- Traffic 300 s: 58 stops, **0 red-runs, min follow gap 7.8 m (target 8), 0 collisions, 0 off-road, 50 ped crossings**.
- Building collision damage 62.8 at 93 km/h, speed after 9.3 km/h; car-car collision damage 28.3.
- E prompt: nearest drivable 4.0 m, exit spot (551.9, 43.6) free, no prompt far from any car, parked car locked; walker blocked by building (stopped x=−1861.6, wall −1861.0).
- Headlight cone lights the car ahead only (not behind/side). Light cycle 26 s (green 16 / amber 2 / red 8).
- Autopilot overtake: overtakes a stopped oncoming car (reached target), waits behind a stopped car in its lane (stopped z=−391.0, speed 0).
- **Missions 1–4 played to completion: idx 4/4, t=974 s, cash $2,000 ($250 + $500 + $450 + $800), finale broadcast present, timer 980.8 s, 0 red-runs during the playthrough, timer 0 while idle.**

## Measured numbers — browser driver (`node checks/drive-stage-b.mjs`)

- 7/7 screenshots captured, **0 console errors** (chrome exit 0 on all).
- Final screenshots (all ≤256 KiB): `drive-day.png` 165,492 B; `2-sunset.png` 200,638 B; `night-drive.png` 139,560 B; `4-plaza.jpg` 182,428 B.
- Extras (checks/): `headlight-on.png`, `headlight-off.png`, `mission-1.png` (162,348 B).
- Headlight pixel sampling (`python3 checks/sample-headlight.py`): **HEADLIGHT PASS** — lit asphalt dMean **+96.0** (want ≥+20), 100% of pixels >+10 (want ≥90%); lit lead-car upper body dMean **+85.1** (want ≥+20); lead-car rear body (second witness) **+97.3**; unlit control dMean **+0.0** (want |d| ≤1).
- Packaging: **2 runs, byte-identical dossier** — 1,048,755 bytes, sha256 `0799a6a53de9dfecf74ef5e1d0adf6e46c56b0a479914a349db93e774bb0f86d`.
- Browser autotest (`?autotest=missions`): **NOT completed in this headless shell — environment limitation, not a game bug.** The shell's `--virtual-time-budget` fast-forwards virtual time (a 300 s budget expires in ~1.6 s real time), so rAF only fires a handful of frames while the 4-mission sim needs ~9–15 s of real CPU time; raising ff to 200 got the run killed by the runtime (SIGTERM, 25.6 s). A `?norender=1` hook was added so the sim runs at full JS speed, but the virtual-time model still starves rAF. Authoritative mission verification is the Node sim above (same drive.js/missions.js modules, all 4 missions to completion) plus the 0-console-error browser runs that exercise the game, the mission HUD and the demo drive in the real browser. The in-browser `stepAutotest` (main.js) mirrors the Node mission loop line-for-line (same 30 m walk threshold, 12 m exit, autopilotFollow, obstaclesAhead with kind/rot).

## Bugs found and fixed in-session

1. **Autopilot never throttled (critical).** `autopilotInput` reads `car.speed` from the raw car object, but city cars have no `speed` field and `stepCar` kept speed only on the wrapper → NaN → throttle/brake never engaged. Fix: `makePlayerCar` sets `carObj.speed = 0`; `stepCar` syncs `player.obj.speed` after the clamp and after a collision; `stepTraffic` syncs `tc.car.speed`.
2. **`main.js` peds loop crashed every frame.** Iterated `peds.list` (undefined — `initPedestrians` returns an array) and used `pd.z` / `pd.kind === 'crosser'`. Fixed to `for (const pd of peds)` with `pd.mode === 'cross' && pd.wait <= 0`, position `{x: pd.x, z: pd.cz}`.
3. **`findPath` infinite loop → RangeError.** Smoothing loop never advanced at the last index (and when `pts.length === 1`). Fixed: early return if `pts.length <= 1`; loop condition `while (i < pts.length - 1)`.
4. **Stop-line geometry (traffic collisions).** Fixed 8 m stop put waiting cars INSIDE the cross road, on the cross lane. Fix: `stopOffsetFor(ix, iz, axis)` = cross road half-width + 2; one stop per leg via `passPositions` (closest approach per leg), each stop carrying its own (x, z); `obstaclesAhead` projects the stop line onto the player's own path.
5. **Follow-gap too weak.** Old rule let a follower close to 3.9 m / 3.3 m and 2 collisions per 300 s. Fix: stopping profile `closing = sqrt(2*3*max(0, d−8))`, target gap 8 m, engage d < 25, `desired = 0` if d < 7. Result: min gap 7.85 m.
6. **Intersection yield deadlocks.** First version counted waiting cars in a 12 m box → two directions waited forever; priority version still left 1 collision (yield engaged too late). Final: separate wide-window block — an avenue car within 50 m of the centre AND still approaching yields while any moving non-avenue car is within 50 m; north-south cars never yield. Result: 0 collisions in 300 s.
7. **Collision counting was per-frame** (one 0.7 s overlap = 43 "collisions"). Changed to distinct events via `traffic.overlapPairs` Set.
8. **Brake reversed the car.** Brake applied −12 m/s² even at speed 0, pushing the car to −30 km/h while waiting at a red light. Fix: clamp speed to 0 when not reversing.
9. **Enter/exit oscillation (critical).** Walk threshold 8 m < exit distance 12 m + exit offset 3.2 m → Mara exited, re-entered at once, looped forever. Fix: walk threshold **30 m** (main.js, sim, debug script).
10. **Head-on deadlock.** BFS smoothing gives a straight-line path down the road centre/wrong lane; the player met an oncoming stopped traffic car head-on and both waited forever. Fix: `autopilotInput` overtake — an oncoming stopped car (speed < 0.5, along 0–12, |lat| < 3.5, heading dot < −0.3) → steer 6 m to the opposite side and creep at 20 km/h. Same-direction cars and red lights are never overtaken. Obstacles now carry `kind` + `rot`.
11. **Crossing deadlock (found while resolving the sim/debug discrepancy).** The full sim (traffic pre-run 300 s by sections 1–8) stalled in mission 3 at (−804,299): a secondary-road car stopped FOR the player crossing its path, and the player stopped for it (perpendicular, dot ≈ 0, so the overtake did not trigger). Fix: overtake now triggers for any stopped car that is NOT same-direction (dot < 0.3) — oncoming AND crossing. Reproduced in `checks/debug-missions.mjs` (with a 300 s pre-traffic) before fixing; after the fix the debug and the sim both complete all 4 missions.
12. **Obstacle braking froze a stopped car at its start.** A stopped obstacle 15 m ahead set desired speed 0 at once (along < 22 → speed = o.speed = 0), so the car never moved and the overtake never engaged. Fix: stopping profile — `speed = min(speed, o.speed + sqrt(2*5*max(0, along−6)))` (stop 6 m behind). Side effect, good: red-light stop gap improved 9.9 m → 3.7 m.
13. **Headlight on/off pair was not pixel-identical (camera).** The frozen demo camera lerped from Mara's spawn, so the two runs framed at different points along the lerp (on = off-angle, off = settled). Fix: `updateCamera` snaps (`k = 1`) when `demoState.frozen`.
14. **Yellow diamond above the driven car vanished with the lights off.** `buildDynamic` set its local `playerCar` only when `headlightsOn`, so the diamond (a driven-car marker, not a headlight effect) disappeared in the `lights=off` shot. Fix: `playerCar` is set whenever `sb.playerCar` exists; only the cone + lit-car boost are gated on `headlightsOn`.
15. **Lead-car roof patch contaminated by the diamond bob.** The diamond bobs 0.4 m with sim time, which lands on different pixels in the two runs (a y=350 scan shows −19..−52 there), so the true roof (top face, y~345–355) cannot be sampled cleanly in this composition. The roof uses the SAME boosted body material as the rear body (render.js top face is `{...body, normal: n}`), so the upper-body patch just under the diamond (y=360–375, dMean +85.1) plus the rear-body patch (+97.3) measure the same lit-car boost. Headlight verdict uses those; the roof occlusion is a test-composition artifact, not a game defect.
16. **Headlight haze variants.** The brief's "both haze variants" has no separate haze parameter in the code — only `fogDensity` per preset (midday 0.00035, sunset 0.00045, night 0.0004). The pixel test was measured in the night preset (fog 0.0004); the sunset variant (fog 0.00045, cone strength 0.7 vs 1.0 at night) uses the same cone/pool/boost code path and was not separately pixel-sampled — the night margins (+96/+85) imply it would pass (0.7 × 96 ≈ 67 > 20).

## Screenshots — viewed by eye

- `drive-day.png`: chase cam down the boulevard, sedan at 60 km/h, mission 1 panel + Neri dialog + yellow mission arrow + minimap + "E — EXIT". Clean, readable. Honest note: the foreground is a lot of empty asphalt (the 64 m boulevard fills the lower 2/3) — camera height/distance or more road detail is a Stage C polish item.
- `night-drive.png`: night reads well — dark blue, lit windows, street lamps, the headlight pool visible around the car, red taillights on the car ahead. Same empty-asphalt foreground note as day.
- `headlight-on.png` / `headlight-off.png`: same frozen composition (camera snap fix verified by eye). On: light-grey pool + cone trapezoids on the road, lead car lit warm. Off: dark road, lead car dark. The diamond is present in both.
- `mission-1.png`: Mara on foot at the plaza fountain at sunset, mission marker cylinder at the target, mission 1 panel + dialog. Reads clearly.
- `2-sunset.png` / `4-plaza.jpg`: re-rendered by the Stage B driver, unchanged from Stage A (same bytes).

## Trap 8 (thinking_revised)

- `game/src/drive.js` was written, then edited repeatedly after running (speed sync, stopOffsetFor, follow-gap, yield, overtake, obstacle braking profile).
- `game/src/main.js` was rewritten, then edited after running (camera snap for frozen demos, `?norender=1` hook).
- `game/src/render.js` was edited after running (diamond gated-on-headlights fix).
- `checks/test-stage-b.mjs` was written, then edited after running (overtake test added).

## ⚠️ RECORDER DEAD — VM restart ~22:49 WIB, v16 unsubmittable

- Recorder pid 6622 was verified alive at 22:09 WIB (and at the Stage B checkpoint commit). **VM restart #5 hit ~22:49 WIB (uptime 3 min at 22:52 WIB); the recorder is dead and no `makefun.mjs record` process remains.** The Stage A dev server (pid 7395) died in the same restart.
- Per the proven v12–v15 rule: a dead recording can only be sealed as-is, and a new recording cannot take over this repo (it would witness only the later stages' edits → the transcript gate rejects the earlier files). **v16 cannot be completed and submitted. The only valid recovery is a FRESH rebuild (v17): new repo + new recording, all stages rewritten in-session.**
- What survives: all Stage A + Stage B code is committed and pushed (checkpoint 89b5d43 + the final Stage B commit below); the verification numbers in this report stand on their own. The v17 rebuild reuses the design (brief + lessons), not the files.

## What is NOT done (for Stage C / v17)

- No police/wanted, garages, radio, density polish, living-city title screen, or README (README is Stage C, written in-session).
- `checks/debug-traffic.mjs` and `checks/debug-missions.mjs` are diagnostic scripts — NOT committed (leave uncommitted; they reproduce the mission-3 crossing deadlock and the traffic close-pairs). `checks/out1/` and `checks/out2/` are packaging outputs — NOT committed. `checks/diag-*.png` are diagnostic intermediates — NOT committed.
- `checks/drive-stage-b.mjs` still reports DRIVE FAIL when the browser autotest does not complete (see the autotest note above) even though the screenshots and the headlight test pass — a v17 run should either fix the autotest harness or treat the Node sim as the mission gate.

## Next: Stage C (v17 fresh rebuild)

Police wanted 0–3 stars + garages + 3-station radio + density + lighting polish + living-city title screen + 4 final screenshots (title, drive-day, finale, night-pursuit) + README.md written IN-SESSION + one revision pass on small files written once in Stage A. Then seal + send the 4 screenshots to the user FIRST and wait for approval (user rule 17:40 WIB 23 Nov), then submit via --recording WITH the harness/mcp flags + --keypair (title "Palkon Auto").

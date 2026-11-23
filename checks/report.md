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

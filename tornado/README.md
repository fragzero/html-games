# Tornado — Vortex Ingesting a Field

A self-contained HTML physics simulation of a tornado ripping through a wheat field. No dependencies, no build step — just open `index.html` in a browser.

![EF3 tornado](https://img.shields.io/badge/default-EF3-orange) ![self-contained](https://img.shields.io/badge/deps-none-green)

---

## How It Works

### Wind Field (the physics core)

The tornado is modelled as a **Rankine vortex** — the standard analytical model used in structural wind engineering:

| Component | Formula | Effect |
|-----------|---------|--------|
| **Tangential** | `v = Γ/(2πr)` outside core, linear ramp inside | The spinning motion |
| **Radial inflow** | Peaks at core radius, decays exponentially with height | Sucks debris inward near the ground |
| **Updraft** | Gaussian profile centred on the axis, ramps with altitude | Lofts material into the funnel |
| **No-slip layer** | Exponential damping near z = 0 | Ground friction — wind is zero at the surface |

The core radius **widens with height** (tight and violent near the surface, broad and gentle aloft), which is why the funnel has a cone shape.

### Crop Interaction

~12,500 wheat stalks are planted on a grid with random jitter. Each frame, the wind speed at stalk height is evaluated for cells near the vortex. When it exceeds a hold threshold (~13 m/s), the stalk is "uprooted" — removed from the field and replaced by debris particles.

Stalks that are still standing **bend into the wind** proportionally to wind speed, giving the field a visible reaction wave ahead of the tornado.

### Debris Integration

Every piece of matter (straw, soil, fence planks, hay bales, stones) is a point mass with:

```
acceleration = gravity + drag
drag = 0.5 * Cd * ρ * A / m * |v_rel|² * direction
```

The **ballistic coefficient** `k = 0.5·Cd·ρ·A/m` is the single number that determines how an object responds to wind:
- **Straw** (k ≈ 2.6): immediately lofted, spirals to cloud base
- **Soil** (k ≈ 7.0): light dust carried far
- **Hay bale** (k ≈ 0.055): tumbles along the ground, briefly airborne in the core
- **Stone** (k ≈ 0.02): barely moves

Ground contact is inelastic with friction. Objects come to rest naturally when kinetic energy is dissipated.

### Rendering Pipeline

All done in **Canvas 2D** (no WebGL):

1. **Backdrop** — sky gradient + overcast deck + bare ground. Baked into an off-screen canvas, only refreshed when the camera pitches.
2. **Crop** — far-field stalks cached; only the ~2000 stalks near the vortex are redrawn every frame.
3. **Cloud ceiling** — pre-computed puff positions translated with the storm.
4. **Funnel** — 2300 massless tracers riding the flow exactly, rendered as soft sprites into a **half-resolution layer** (4× fill-rate savings).
5. **Debris** — batched into 3 depth tiers using `Path2D`, ~12 draw calls total instead of thousands of individual strokes.

### Controls

| Input | Action |
|-------|--------|
| Drag | Orbit camera |
| Scroll wheel | Zoom |
| Space | Pause/resume |
| C | Toggle chase cam |
| R | Reset field |
| Sliders | Adjust circulation Γ, core radius, updraft, inflow, storm speed |

---

## Session TLDR — Thinking Log

1. **Designed the wind model** — chose a Rankine vortex with height-dependent core radius, added a frictional inflow layer and Gaussian updraft profile. This gives a physically plausible velocity field without solving Navier-Stokes.

2. **Built the crop grid** — 112×112 stalks with random jitter. Each is tested against the wind at its height; if the speed exceeds a threshold the stalk is removed and debris spawned.

3. **Implemented debris physics** — quadratic aerodynamic drag integrated with an exponential scheme (unconditionally stable regardless of timestep). Five material types with realistic ballistic coefficients.

4. **Added funnel visualization** — massless tracers that follow the flow exactly, rendered as soft radial-gradient sprites. Their emergent spatial distribution *is* the funnel shape — nothing is prescribed.

5. **Profiled and optimized** — headless Chromium profiling revealed:
   - `drawTracers` (40 ms) → moved to half-res off-screen canvas → 12 ms
   - `drawCrop` (16 ms for 12k stalks) → split into cached far-field + live near-field → ~5 ms/frame
   - `drawDebris` (27 ms for 7000 strokes) → batched into 3 depth tiers with `Path2D` → <1 ms
   - Backdrop fills → baked once into off-screen canvas
   - Final: ~15 ms draw + 4 ms step = ~40 fps under software rasterization; 60 fps on real GPU

6. **Shipped** — committed to `tornado/index.html`, pushed branch `feat/tornado-scene`, opened PR #1.

---

## Build Stats

| Metric | Value |
|--------|-------|
| Model | **Claude Opus 5** (2.2× credits) |
| Est. Credits Used | 16.69 |
| Elapsed Time | 20m 54s |

---

## Running

```bash
# just open it
open tornado/index.html
# or serve locally
python3 -m http.server 8000
# then visit http://localhost:8000/tornado/
```

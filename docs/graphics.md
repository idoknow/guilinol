## Main-camera graphics

The first terrain frame does not wait for effects. Subsequent main-camera frames use N8AO, threshold bloom, the selected tone mapper and (except on low) SMAA. Offscreen callers still render directly. Desktop defaults to mid; coarse-pointer devices default to low. The graphics selector in the range panel is independent of tile radius. `?gfx=low|mid|high` overrides `glol.gfx` at entry. A continuous three seconds below 40 FPS lowers the tier; `?verify&gfx=…` pins the benchmark tier.

| Tier | AO | Bloom | Daytime sun shadows | Additional |
| --- | --- | --- | --- | --- |
| low | off; optional half-resolution, four samples | off | off | native tone mapping, single fullscreen grade only if needed |
| mid | half-resolution | threshold | single 2048² by default, PCF soft | SMAA |
| high | full-resolution | threshold | PCSS blocker search | godrays, optional depth of field, SMAA |

`GET /api/gfx` returns shared defaults or the last audited configuration. Verified admins use `GET/PUT /api/admin/gfx` or the 光影 form. Invalid payloads are rejected; clients fall back to local defaults when the public endpoint is unavailable. Changes apply on next entry. Presets can be sparse (e.g. `presets.dusk.bloom.intensity`); absent values inherit the global value. Numeric controls blend over the time system's hours. Map size, switches and the tone mapper change at segment midpoints. Exposure multiplies the existing environment exposure.

With `?debug`, use `window.gfx.set({shadow:{strength:0.4}})`, `window.gfx.toggle('bloom')`, or `window.gfx.select('high')`. Enable DOF in high only. Intensity and radius are independent. Tune AO first with bloom/shadows disabled, then compare shadows with identical camera and time, before enabling godrays.

Low uses `ao.lowEnabled` (default false); `window.gfx.set({ao:{enabled:true}})` while low enables it. Sustained frame times over 25 ms demote high → mid → low → direct. Direct bypasses global grading; manually selecting a tier re-enables it. Mid shadows refresh every `shadow.updateEvery` frames (default 3), or sooner when the target moves `shadow.moveThreshold` metres. `shadow.distance` is the shadow camera width (150 m default). Global batches larger than a tile radius do not cast.

Build both projects with the same release world in `public/world`, then run `GFX_BASELINE=../baseline node scripts/verify-gfx.mjs`. `GFX_OUT` selects the capture directory. Three rounds cycle baseline/low/mid/high for each hour. Each measurement discards 30 warmup frames and averages 120 frames; the report gives the median and max-minus-min across rounds. GL draw commands (counting multi-draw subdraws), triangles and runs of draws to the same framebuffer include reflections on both builds. Casters counts eligible visible meshes rather than shadow-map refreshes. JS gzip covers scripts received before the first terrain frame only. `node scripts/verify-gfx-night.mjs` checks high-tier walk interactions and captures local simulated multiplayer participants; it does not log in to production.

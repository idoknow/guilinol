## Main-camera graphics

The first terrain frame does not wait for effects. Subsequent main-camera frames use N8AO, threshold bloom, the selected tone mapper and (except on low) SMAA. Offscreen callers still render directly. Desktop defaults to mid; coarse-pointer devices default to low. The graphics selector in the range panel is independent of tile radius. `?gfx=low|mid|high` overrides `glol.gfx` at entry. A continuous three seconds below 40 FPS lowers the tier; `?verify&gfx=…` pins the benchmark tier.

| Tier | AO | Bloom | Daytime sun shadows | Additional |
| --- | --- | --- | --- | --- |
| low | half-resolution, four samples | off | off | tone mapping |
| mid | half-resolution | threshold | single 2048² by default, PCF soft | SMAA |
| high | full-resolution | threshold | PCSS blocker search | godrays, optional depth of field, SMAA |

`GET /api/gfx` returns shared defaults or the last audited configuration. Verified admins use `GET/PUT /api/admin/gfx` or the 光影 form. Invalid payloads are rejected; clients fall back to local defaults when the public endpoint is unavailable. Changes apply on next entry. Presets can be sparse (e.g. `presets.dusk.bloom.intensity`); absent values inherit the global value. Numeric controls blend over the time system's hours. Map size, switches and the tone mapper change at segment midpoints. Exposure multiplies the existing environment exposure.

With `?debug`, use `window.gfx.set({shadow:{strength:0.4}})`, `window.gfx.toggle('bloom')`, or `window.gfx.select('high')`. Enable DOF in high only. Intensity and radius are independent. Tune AO first with bloom/shadows disabled, then compare shadows with identical camera and time, before enabling godrays.

For repeatable comparisons use the same release world in `public/world`, build, then run `node scripts/verify-gfx.mjs`. `GFX_OUT` selects a screenshot directory and `GFX_PROJECT` points at a separately built baseline checkout. Run sequentially on the same GPU. The script reports presented FPS, calls and first-frame JS gzip (each requested asset compressed independently). Baseline Three resets draw calls per render; the graphics build counts all passes, including reflections.

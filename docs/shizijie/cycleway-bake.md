## East cycleway repair (IDOK-456)

`npm run world` applies this repair after protected-tile restoration and roadbed generation. To update an already assembled world without raw OSM or changes to the underpass, run from the repository root:

```sh
uv run --locked python pipeline/shizijie_underpass.py --cycle-only --world public/world
uv run --locked python scripts/check-shizijie-cycle-bake.py public/world
npm run build
node scripts/verify-shizijie-cycle-ride.mjs
```

Start from a pinned input world, not the superseded experimental cycleway bake. The repair extends the lower motor-road polygon across the gap and under the adjoining higher cycle strips by up to 18 cm. The former zigzag edge is internal to the asphalt surface. The cycle strips and safety islands retain their original boundaries and path indices.

The first command updates the compressed GL04 and its manifest entry together. Do not distribute the tile alone: the complete world uses path-indexed roadbed metadata, unlike the pinned development crop. No client patch or new material is needed. Promote the tested complete world via the existing ops world archive/pin workflow, not by editing the live tile.

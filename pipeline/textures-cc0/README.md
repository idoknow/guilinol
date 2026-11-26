## CC0 detail sources

These are greyscale, 512 px downsamples of ambientCG colour maps. They are used by `pipeline/make_city_textures.py` as the road and wall detail tiles (IDOK-291). ambientCG publishes all assets under CC0 1.0 (public domain), so no attribution is required. They are listed here for provenance.

| File | ambientCG asset | Source |
|---|---|---|
| `road-Asphalt031.png` | Asphalt 031 | https://ambientcg.com/view?id=Asphalt031 |
| `wall-Plaster001.png` | Plaster 001 | https://ambientcg.com/view?id=Plaster001 |

The generator divides each image by its mean so the result stays luminance-neutral. The colours still come from the palette in `web/src/look/config.ts`.

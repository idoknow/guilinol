"""Compare finished rail endpoints in all chunks within 600 m of Guilin station."""
import argparse
import json
from collections import Counter
from pathlib import Path

from shapely.geometry import box

from check_rail_section_tracks import tile_rails
from common import CHUNK, load_osm
from station_corridor import station_pad


def corridor(world, pad):
    manifest = json.loads((world / "manifest.json").read_bytes())
    tiles = {}
    for tile in manifest["chunks"]:
        x, z = tile["x"], tile["z"]
        if box(x, z, x + CHUNK, z + CHUNK).distance(pad) < 600:
            tiles[x, z] = sorted(tuple(row[:6]) for row in tile_rails(world, tile))
    return tiles


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("reference", type=Path, help="finished world from PR #300")
    parser.add_argument("candidate", type=Path)
    args = parser.parse_args()
    pad = station_pad({w["id"]: w for w in load_osm() if w["type"] == "way"})
    before, after = (corridor(world, pad) for world in (args.reference, args.candidate))
    changed = sorted(k for k in before.keys() | after.keys() if before.get(k) != after.get(k))
    differences = []
    for key in changed:
        reference = Counter(before.get(key, []))
        candidate = Counter(after.get(key, []))
        differences.append({
            "chunk": key,
            "referenceOnly": list((reference - candidate).elements()),
            "candidateOnly": list((candidate - reference).elements()),
        })
    segments = sum(map(len, before.values()))
    print(json.dumps(dict(referenceSegments=segments, changedChunks=changed, differences=differences), indent=2))
    raise SystemExit(int(not segments or bool(changed)))

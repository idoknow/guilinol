"""Compare finished rail endpoints in all chunks within 600 m of Guilin station."""
import argparse
import json
from collections import Counter
from pathlib import Path

from shapely.geometry import box

from check_rail_section_tracks import tile_rails
from station_rail_reference import differences, reference_tiles
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


def compare(candidate_world, reference_world=None):
    pad = station_pad({w["id"]: w for w in load_osm() if w["type"] == "way"})
    before = corridor(reference_world, pad) if reference_world else reference_tiles()
    after = corridor(candidate_world, pad)
    changed = sorted(k for k in before.keys() | after.keys() if k not in before or k not in after or differences(before[k], after[k]))
    details = []
    for key in changed:
        reference = Counter(map(tuple, before.get(key, [])))
        candidate = Counter(after.get(key, []))
        details.append({
            "chunk": key,
            "referenceOnly": list((reference - candidate).elements()),
            "candidateOnly": list((candidate - reference).elements()),
        })
    segments = sum(map(len, before.values()))
    return dict(referenceSegments=segments, changedChunks=changed, differences=details)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("reference", type=Path, nargs="?", help="finished world from PR #300")
    parser.add_argument("candidate", type=Path)
    args = parser.parse_args()
    result = compare(args.candidate, args.reference)
    print(json.dumps(result, indent=2))
    raise SystemExit(int(result["referenceSegments"] != 1139 or bool(result["changedChunks"])))

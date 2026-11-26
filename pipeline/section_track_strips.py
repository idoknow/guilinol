"""Read the finished rail chords covered by each cumulative section design."""

import json
from collections import defaultdict
from pathlib import Path

from shapely import LineString, Point, STRtree, box
from shapely.ops import substring

from check_rail_section_tracks import load_tracks, tile_rails
from features import points


def section_strips(world, *, terrain_only=False, design_flag=None):
    root = Path(__file__).resolve().parent
    designs = sorted((root / "rail-audits").glob("01-*.json")) + sorted(
        (root / "rail-sections").glob("*.json")
    )
    if terrain_only:
        design_flag = "gradeTrackTerrain"
    ties = []
    for path in designs:
        design = json.loads(path.read_bytes())
        if design_flag and not design.get(design_flag):
            continue
        survey = root / "rail-audits" / path.name
        if not design_flag and survey != path and survey.exists():
            design = json.loads(survey.read_bytes())
        ties.extend(
            (path.stem, int(w), sorted(s)) for w, s in design["railTies"].items()
        )
    ways = load_tracks({w for _, w, _ in ties})
    axes = [substring(LineString(points(ways[w])), *limits) for _, w, limits in ties]
    lookup = STRtree(axes)
    strips = defaultdict(list)
    for tile in json.loads((world / "manifest.json").read_bytes())["chunks"]:
        x, z = tile["x"], tile["z"]
        if not lookup.query(box(x - 0.001, z - 0.001, x + 256.001, z + 256.001)).size:
            continue
        for ax, az, ay, bx, bz, by, _, flags, *_ in tile_rails(world, tile):
            a = Point(tile["x"] + ax / 100, tile["z"] + az / 100)
            b = Point(tile["x"] + bx / 100, tile["z"] + bz / 100)
            for idx in lookup.query(a, predicate="dwithin", distance=0.001):
                if axes[idx].distance(b) <= 0.001 and a.distance(b) > 0:
                    name, wid, _ = ties[idx]
                    strips[name].append(
                        [wid, a.x, a.y, ay / 100, b.x, b.y, by / 100, flags]
                    )
    found = {(section, row[0]) for section, rows in strips.items() for row in rows}
    if {(name, wid) for name, wid, _ in ties} != found:
        raise ValueError("Missing section track in finished rail geometry")
    return strips


if __name__ == "__main__":
    import sys

    print(json.dumps(section_strips(Path(sys.argv[1])), separators=(",", ":")))

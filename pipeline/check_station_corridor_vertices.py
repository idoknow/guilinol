"""Compare finished rail endpoints in all chunks within 600 m of Guilin station."""
import argparse
import json
import math
from collections import Counter
from pathlib import Path

from shapely.geometry import box

from check_rail_section_tracks import tile_rails
from station_rail_reference import differences, reference_tiles, section_reference
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


def huancheng_survey(candidate, reference):
    """Use encoded heights on both copies of each shared endpoint."""
    design = json.loads(Path(__file__).with_name("rail-sections").joinpath("13-guilin-south.json").read_bytes())
    limits = {(v["x"], v["z"]): v for v in design["approvedCorridorVertices"]}
    heights = {key: [] for key in limits}
    chords = []
    valid = True
    for (x, z), rows in reference.items():
        index = {tuple(r[k] for k in (0, 1, 3, 4)): r for r in candidate.get((x, z), ())}
        for r in rows:
            ends = [(round(x + r[k]/100, 6), round(z + r[k+1]/100, 6)) for k in (0, 3)]
            if not any(pt in limits for pt in ends):
                continue
            current = index.get(tuple(r[k] for k in (0, 1, 3, 4)))
            if current is None:
                valid = False
                continue
            before = [r[2]/100, r[5]/100]
            after = [current[2]/100, current[5]/100]
            for pt, old, new in zip(ends, before, after):
                if pt in limits:
                    heights[pt].append(new)
                elif old != new:
                    valid = False
            length = math.dist(*ends)
            grade = 1000 * abs(after[1]-after[0]) / length
            valid &= grade <= 12
            chords.append(dict(ends=ends, beforeM=before, afterM=after,
                               beforePermille=1000*abs(before[1]-before[0])/length, afterPermille=grade))
    vertices = []
    for pt, values in heights.items():
        v = limits[pt]
        drops = [round((v["referenceM"]-level)*1000, 6) for level in values]
        valid &= len(drops) == 2 and max(drops)-min(drops) <= .1 and all(
            v["minimumDropMm"] <= d <= v["maximumDropMm"] for d in drops)
        vertices.append(dict(x=pt[0], z=pt[1], referenceM=v["referenceM"], finishedM=values, dropMm=drops))
    return dict(passed=bool(valid and len(chords)==5), chords=chords, vertices=vertices)


def compare(candidate_world, reference_world=None):
    pad = station_pad({w["id"]: w for w in load_osm() if w["type"] == "way"})
    before = corridor(reference_world, pad) if reference_world else reference_tiles()
    after = corridor(candidate_world, pad)
    survey = huancheng_survey(after, before)
    before = section_reference(before)
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
    ties = json.loads(Path(__file__).with_name("station-corridor-ties.json").read_bytes())
    expected = {(r["x"], r["z"]): r["heightM"] for r in ties}
    actual = {xy: set() for xy in expected}
    for tile in json.loads((candidate_world / "manifest.json").read_bytes())["chunks"]:
        x, z = tile["x"], tile["z"]
        if not any(x <= a <= x + CHUNK and z <= b <= z + CHUNK for a, b in expected):
            continue
        for row in tile_rails(candidate_world, tile):
            for dx, dz, h in (row[:3], row[3:6]):
                xy = (round(x + dx / 100, 6), round(z + dz / 100, 6))
                if xy in actual:
                    actual[xy].add(h / 100)
    exterior = [xy for xy, values in actual.items() if not values or
                any(abs(y - expected[xy]) > 1e-6 for y in values)]
    segments = sum(map(len, before.values()))
    return dict(huancheng=survey, referenceSegments=segments, changedChunks=changed, differences=details,
                exteriorTies=len(expected), changedExteriorTies=exterior)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("reference", type=Path, nargs="?", help="finished world from PR #300")
    parser.add_argument("candidate", type=Path)
    args = parser.parse_args()
    result = compare(args.candidate, args.reference)
    print(json.dumps(result, indent=2))
    raise SystemExit(int(not result["huancheng"]["passed"] or result["referenceSegments"] != 1139 or bool(result["changedChunks"])
                         or result["exteriorTies"] != 13 or bool(result["changedExteriorTies"])))

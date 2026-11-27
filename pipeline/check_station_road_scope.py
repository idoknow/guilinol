"""Check the station's finished road profiles outside the five Tiexi approaches."""
import argparse
import json
from pathlib import Path

from common import load_osm


TIEXI = {169505553, 265411063, 412456329, 1017595561, 690703974}


def station_chords(world, ways):
    manifest = json.loads((world / "manifest.json").read_bytes())
    result = {}
    for row in manifest["tunnels"]:
        if row["way"] in ways:
            key = (row["way"], *row["nodes"])
            if key in result:
                raise ValueError(f"Duplicate station road chord {key}")
            result[key] = row
    missing = ways - {key[0] for key in result}
    if missing:
        raise ValueError(f"Missing station roads: {sorted(missing)}")
    return result


def compare(reference, candidate):
    station_ways = set(map(int, json.loads(Path(__file__).with_name("station-road-profiles.json").read_bytes())))
    # Footways have paving geometry but no tunnel/chord records.
    fixed = {way["id"] for way in load_osm() if way["type"] == "way"
             and way["id"] in station_ways - TIEXI
             and way["tags"]["highway"] not in {"footway", "pedestrian"}}
    before, after = (station_chords(world, fixed) for world in (reference, candidate))
    changed = [key for key in sorted(before.keys() | after.keys()) if before.get(key) != after.get(key)]
    return {"fixedWays": len(fixed), "referenceChords": len(before), "changedChords": changed}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("reference", type=Path)
    parser.add_argument("candidate", type=Path)
    args = parser.parse_args()
    report = compare(args.reference, args.candidate)
    print(json.dumps(report, indent=2))
    raise SystemExit(bool(report["changedChords"]))

"""Surveyed #300 endpoints in GL04 units (centimetres, with four decimals)."""
import json
from pathlib import Path


def reference_tiles():
    data = json.loads(Path(__file__).with_name("station-corridor-300.json").read_bytes())
    tiles = {tuple(map(int, key.split(","))): rows for key, rows in data.items()}
    if sum(map(len, tiles.values())) != 1139:
        raise ValueError("Incomplete #300 station corridor reference")
    return tiles


def section_reference(tiles):
    """Apply only the five surveyed railhead corrections at the Tiexi siding bridge."""
    file = Path(__file__).with_name("rail-sections") / "12-guilin-station.json"
    changes = {(r["x"], r["z"]): r for r in json.loads(file.read_bytes())["approvedCorridorVertices"]}
    if len(changes) != 5:
        raise ValueError("Incomplete Tiexi siding vertex list")
    seen = set()
    for (x, z), rows in tiles.items():
        for i, chord in enumerate(rows):
            row = list(chord)
            for j in (0, 3):
                xy = (round(x + row[j] / 100, 6), round(z + row[j + 1] / 100, 6))
                if xy in changes:
                    change = changes[xy]
                    if abs(row[j + 2] - 100 * change["referenceM"]) > .0001:
                        raise ValueError(f"Unexpected #300 height at {xy}")
                    row[j + 2] = round(100 * change["railheadM"], 4)
                    seen.add(xy)
            rows[i] = row
    if seen != changes.keys():
        raise ValueError("Tiexi correction outside reference corridor")
    return tiles


def locked_heights():
    heights = {}
    for (x, z), rows in section_reference(reference_tiles()).items():
        for row in rows:
            for dx, dz, height in (row[:3], row[3:6]):
                key = (round(x + dx / 100, 6), round(z + dz / 100, 6))
                if heights.setdefault(key, height) != height:
                    raise ValueError(f"Ambiguous #300 reference at {key}")
    ties = json.loads(Path(__file__).with_name("station-corridor-ties.json").read_bytes())
    for tie in ties:
        key = (tie["x"], tie["z"])
        if key in heights:
            raise ValueError(f"Exterior tie overlaps corridor at {key}")
        heights[key] = round(tie["heightM"] * 100, 4)
    return heights


def differences(reference, actual):
    """Compare each GL04 chord in plan, allowing 0.01 cm error in height."""
    if len(reference) != len(actual):
        return max(len(reference), len(actual))
    def by_plan(row):
        return row[0], row[1], row[3], row[4], row[2], row[5]
    count = 0
    for a, b in zip(sorted(reference, key=by_plan), sorted(actual, key=by_plan)):
        if by_plan(a)[:4] != by_plan(b)[:4] or max(abs(a[i]-b[i]) for i in (2,5)) > .010000001:
            count += 1
    return count


def verify_tiles(tiles):
    for key, rows in section_reference(reference_tiles()).items():
        if differences(rows, tiles.get(key, [])):
            raise ValueError(f"Station corridor differs from #300 in tile {key}")

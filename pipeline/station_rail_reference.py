"""Surveyed #300 endpoints in GL04 units (centimetres, with four decimals)."""
import json
from pathlib import Path


def reference_tiles():
    data = json.loads(Path(__file__).with_name("station-corridor-300.json").read_bytes())
    tiles = {tuple(map(int, key.split(","))): rows for key, rows in data.items()}
    if sum(map(len, tiles.values())) != 1139:
        raise ValueError("Incomplete #300 station corridor reference")
    return tiles


def locked_heights():
    heights = {}
    for (x, z), rows in reference_tiles().items():
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
    for key, rows in reference_tiles().items():
        if differences(rows, tiles.get(key, [])):
            raise ValueError(f"Station corridor differs from #300 in tile {key}")

"""Carry the opening world's surveyed curb faces with each section 12 road grade."""
import json
from pathlib import Path

import numpy as np


def apply(manifest, sections):
    tiles = {t["file"]: t for t in manifest["chunks"]}
    for section in sections:
        source = section.get("curbReturnSurvey")
        if not source:
            continue
        survey = json.loads((Path(__file__).with_name("rail-sections") / source).read_bytes())
        lanes = []
        for key, profile in section["priorRoadProfiles"]["01"].items():
            chain = [road for road in manifest["tunnels"] if road["way"] == int(key)]
            first, last = profile["pavingNodes"]
            by_start = {road["nodes"][0]: road for road in chain}
            node = first
            while node != last:
                road = by_start.pop(node)
                a, b = np.array(road["portals"])[:, [0, 2]]
                axis = (b - a) / road["length"]
                # Keep the carriageway edge inside the protected polygon after
                # tile-local float32 conversion in the mesh worker.
                normal = np.array([-axis[1], axis[0]]) * (road["halfWidth"] + .003)
                a, b = a - axis * .003, b + axis * .003
                lanes.append(np.array([a-normal, b-normal, b+normal, a+normal]))
                node = road["nodes"][1]
        for row in survey["returns"]:
            end = row["end"]
            chord, = [t for t in manifest["tunnels"] if t["way"] == row["way"]
                      and t["nodes"][end] == row["node"]]
            stations = np.array(chord["stations"])
            if end:
                stations = stations[::-1].copy()
                stations[:, 0] = chord["length"] - stations[:, 0]
            native = np.array(sorted(row["stations"]))
            chain = np.unique(np.clip(np.r_[stations[:, 0], native[:, 0], row["along"]], *row["along"]))
            change = np.interp(chain, *stations.T) - np.interp(chain, *native.T)
            tile = tiles[row["file"]]
            x, y, z = row["origin"]
            patch = dict(origin=[x - tile["x"], y, z - tile["z"]], axis=row["axis"],
                         along=row["along"], lateral=row["lateral"], faces=row["faces"],
                         displacement=np.column_stack((chain, change)).tolist())
            center = np.array([x, z])
            patch["lanes"] = [(ring - [tile["x"], tile["z"]]).tolist() for ring in lanes
                              if np.all(ring.max(axis=0) >= center - 26)
                              and np.all(ring.min(axis=0) <= center + 26)]
            tile.setdefault("stationPaving", {}).setdefault("curbReturns", []).append(patch)

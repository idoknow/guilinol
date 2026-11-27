"""Carry the opening world's surveyed curb faces with each section 12 road grade."""
import json
from pathlib import Path

import numpy as np
from shapely import LineString


def grade_apron(faces, stations):
    """Split at grade breaks before converting curb reveals into tile elevations."""
    # A 0.05 mm tolerance removes numerical knots along the same grade.
    stations = np.asarray(LineString(stations).simplify(.00005).coords)
    baked = []
    for kind, *points in faces:
        polygon = np.array(points, dtype=float)
        # The road and the taper triangulate their common edge independently.
        # Underlap by 0.25 mm to cover the tile-local float32 T-junction.
        for seam, direction in ((-3, -1), (-.025, 1), (4, -1), (14, 1)):
            polygon[np.abs(polygon[:, 0] - seam) < 1e-7, 0] += direction * .00025
        pieces = [polygon]
        for station in stations[:, 0]:
            if not min(p[0] for p in points) < station < max(p[0] for p in points):
                continue
            split = []
            for poly in pieces:
                if min(poly[:, 0]) >= station or max(poly[:, 0]) <= station:
                    split.append(poly)
                    continue
                left, right = [], []
                for a, b in zip(poly, np.roll(poly, -1, axis=0)):
                    (left if a[0] < station else right).append(a)
                    if (a[0] < station) != (b[0] < station):
                        tie = a + (b - a) * ((station - a[0]) / (b[0] - a[0]))
                        left.append(tie)
                        right.append(tie)
                split.extend(np.array(part) for part in (left, right) if len(part) >= 3)
            pieces = split
        for poly in pieces:
            poly[:, 1] += np.interp(poly[:, 0], *stations.T)
            for i in range(1, len(poly) - 1):
                triangle = poly[[0, i, i+1]]
                a, b = (triangle[1:] - triangle[0])[:, [0, 2]]
                if abs(a[0] * b[1] - a[1] * b[0]) > 1e-9:
                    baked.append([kind, *triangle.round(7).tolist()])
    return baked


def apply(manifest, sections):
    tiles = {t["file"]: t for t in manifest["chunks"]}
    for section in sections:
        if section.get("cutSidewalkSurvey"):
            path = Path(__file__).with_name("rail-sections") / section["cutSidewalkSurvey"]
            for patch in json.loads(path.read_bytes()):
                tile = tiles[patch.pop("file")]
                tile.setdefault("stationPaving", {}).setdefault("curbReturns", []).append(patch)
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
                         aprons=grade_apron(row["aprons"], stations),
                         displacement=np.column_stack((chain, change)).tolist())
            center = np.array([x, z])
            patch["lanes"] = [(ring - [tile["x"], tile["z"]]).tolist() for ring in lanes
                              if np.all(ring.max(axis=0) >= center - 26)
                              and np.all(ring.min(axis=0) <= center + 26)]
            tile.setdefault("stationPaving", {}).setdefault("curbReturns", []).append(patch)

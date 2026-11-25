"""Coupled Hengliu underpass and S2201 bridge approaches outside the station corridor."""

import gzip
import struct

import numpy as np
from shapely import LineString, Point, box

from dingjiang import hengliu
from features import points
from station_roads import samples

# Endpoint heights tie the raised carriageways to existing main vertices.
# Stations on the two western decks come from their crossings with the yard tracks.
YARD_DECK = {
    983781250: (160.92, 23.9011, 160.3891, 29.7878, 160.3298, 161.10),
    983781252: (161.10, 29.3699, 160.2656, 35.5002, 160.3273, 160.92),
}
BRIDGES = {500400553, 500400554, *YARD_DECK}
APPROACHES = {
    205756891: (1869164152, 1869155088, 162.800, None),
    500400555: (1869105879, 1869164132, None, 162.433),
    983781249: (9096632979, 2157336104, 161.10, None),
    983781251: (2157336106, 9096632980, None, 161.10),
    983781245: (1869155282, 13681251548, 160.92, 160.200),
    983781247: (13681251549, 1331240999, 160.200, 160.92),
    459580310: (9344231203, 7613431624, 160.587, None),
    815078158: (7613431623, 6821480678, None, 159.812),
}
TUNNEL = 815078159


def bridge_height(wid, line, at):
    if wid not in YARD_DECK:
        return hengliu(line.interpolate(at).y) + 8.715
    first, a, ya, b, yb, last = YARD_DECK[wid]
    grade = (yb - ya) / (b - a)
    # Keep a full triangulation interval on the tangent at each crossing.
    return np.interp(
        at,
        [0.0, a - 5, b + 5, line.length],
        [first, ya - 5 * grade + 0.016, yb + 5 * grade + 0.016, last],
    )


def road_profiles(elements, widths):
    profiles = {}
    for way in elements:
        wid = way.get("id")
        if way["type"] != "way" or wid not in {*APPROACHES, TUNNEL}:
            continue
        if wid == TUNNEL:
            line = LineString(points(way))
            heights = [
                (s, hengliu(line.interpolate(s).y) - 5.7)
                for s in np.linspace(0, line.length, 1 + int(np.ceil(line.length / 2)))
            ]
            local = dict(way)
        else:
            first, last, ya, yb = APPROACHES[wid]
            i, j = way["nodes"].index(first), way["nodes"].index(last)
            local = dict(
                way,
                nodes=way["nodes"][i : j + 1],
                geometry=way["geometry"][i : j + 1],
                trafficNodes=way["nodes"][max(0, i - 1) : j + 2],
                surfaceApproach=True,
            )
            line = LineString(points(local))
            levels = [ya, yb]
            for end in (0, 1):
                if levels[end] is None:
                    z = line.coords[-1 if end else 0][1]
                    levels[end] = hengliu(z) + (
                        -5.7 if wid in (459580310, 815078158) else 8.715
                    )
            knots = [(0.0, levels[0])]
            if wid == 500400555:
                knots.append((line.length - 6, 162.28425))
            heights = samples([*knots, (line.length, levels[1])], transition=1.0)
        if wid in widths:
            local["stationWidth"] = widths[wid]
        profiles[wid] = local, line, np.array(heights)
    return profiles


def raise_decks(directory, manifest, elements):
    """Raise only the four existing GL04 deck meshes after the native rail solve."""
    ways = {w["id"]: w for w in elements if w["type"] == "way" and w["id"] in BRIDGES}
    lines = {wid: LineString(points(w)) for wid, w in ways.items()}
    found = {wid: 0 for wid in ways}
    for chunk in manifest["chunks"]:
        x, z = chunk["x"], chunk["z"]
        bounds = box(x, z, x + 256, z + 256)
        local = {wid: l for wid, l in lines.items() if bounds.distance(l) <= 6}
        if not local:
            continue
        path = directory / chunk["file"]
        data = bytearray(gzip.decompress(path.read_bytes()))
        v, i, size, image, count = struct.unpack_from("<5I", data, 4)
        start = 16924 + 9 * v + 4 * i + size + image
        tris = np.frombuffer(data, dtype="<i2", count=9 * count, offset=start).reshape(
            -1, 3, 3
        )
        changed = False
        for tri in tris:
            xy = tri[:, [0, 2]] / 100 + [x, z]
            for wid, line in local.items():
                # Every original bridge vertex is within the 10 m wide span.
                if not all(line.distance(Point(p)) <= 5.02 for p in xy):
                    continue
                for vertex, p in zip(tri, xy):
                    y = round(bridge_height(wid, line, line.project(Point(p))) * 100)
                    if y < vertex[1]:
                        raise ValueError(f"S2201 deck lowered on {wid}")
                    vertex[1] = y
                    # The cm-encoded deck must cover its shared OSM endpoint.
                    # Overlap the approach by 3 cm to absorb XY rounding.
                    along = line.project(Point(p))
                    if along < 0.012 or line.length - along < 0.012:
                        delta = np.subtract(line.coords[-1], line.coords[0])
                        outward = (
                            delta
                            / np.linalg.norm(delta)
                            * (-0.03 if along < 0.012 else 0.03)
                        )
                        vertex[[0, 2]] = np.rint((p + outward - [x, z]) * 100).astype(
                            "<i2"
                        )
                found[wid] += 1
                changed = True
                break
        if changed:
            path.write_bytes(gzip.compress(data, mtime=0))
            chunk["bytes"] = path.stat().st_size
    if not all(found.values()):
        raise ValueError(f"Missing S2201 deck faces: {found}")
    return ways

"""Coupled Hengliu underpass and S2201 bridge approaches outside the station corridor."""

import gzip
import struct

import numpy as np
from shapely import LineString, MultiPoint, Point, box

from shapely.ops import substring

from common import xz2ll
from dingjiang import hengliu
from features import points
from station_roads import samples

# Endpoint heights tie the raised carriageways to existing main vertices.
# Stations on the two western decks come from their crossings with the yard tracks.
YARD_DECK = {
    983781250: (160.92, 23.9011, 160.3891, 29.7878, 160.3298, 161.10),
    983781252: (161.10, 29.3699, 160.2656, 35.5002, 160.3273, 160.92),
}
ROAD_SPANS = {983781246: (160.20, 159.95), 983781248: (159.95, 160.20)}
BRIDGES = {500400553, 500400554, *YARD_DECK}
APPROACHES = {
    205756891: (1869164152, 1869155088, 162.800, None),
    500400555: (1869105879, 1869164132, None, 162.433),
    983781249: (9096632979, 2157336104, 161.10, None),
    983781251: (2157336106, 9096632980, None, 161.10),
    983781245: (1869155282, 9096632976, 160.92, 160.20),
    983781247: (9096632977, 1331240999, 160.20, 160.92),
    500400552: (9096632975, 3101394803, 159.95, 160.0),
    500571918: (3101394796, 9096632978, 159.50, 159.95),
    459580310: (9344231203, 7613431624, 160.587, None),
    815078158: (7613431623, 6821480678, None, 159.812),
}
# The traffic network retains its released extent. The new short bridge
# approaches only change surface geometry and player vehicle support.
TRAFFIC_ENDS = {
    983781245: (1869155282, 13681251548),
    983781247: (13681251549, 1331240999),
}
# Native terrain vertices on the carriageways. Place the transverse tie
# through each vertex without moving the source centreline in plan.
OUTER_TIES = {500400552: (-136, -9568), 500571918: (-128, -9560)}
TUNNEL = 815078159


def motorway_sections(elements):
    """Motorway lanes on the four raised decks and their graded approaches."""
    for way in elements:
        if way.get("tags", {}).get("highway") != "motorway" or way["type"] != "way":
            continue
        wid = way["id"]
        if wid in BRIDGES:
            yield way
        elif wid in APPROACHES and wid not in OUTER_TIES:
            first, last = TRAFFIC_ENDS.get(wid, APPROACHES[wid][:2])
            start = way["nodes"].index(first)
            stop = way["nodes"].index(last) + 1
            yield dict(
                way,
                nodes=way["nodes"][start:stop],
                geometry=way["geometry"][start:stop],
            )


def bridge_height(wid, line, at):
    if wid in ROAD_SPANS:
        return np.interp(at, [0, line.length], ROAD_SPANS[wid])
    if wid not in YARD_DECK:
        return hengliu(line.interpolate(at).y) + 8.715
    first, a, ya, b, yb, last = YARD_DECK[wid]
    grade = (yb - ya) / (b - a)
    # The two yard railheads rise away from their old deck-centre pins.
    # Reserve 18 cm for that rise across the full slab and cm encoding.
    return np.interp(
        at,
        [0.0, a - 5, b + 5, line.length],
        [first, ya - 5 * grade + 0.18, yb + 5 * grade + 0.18, last],
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
            if wid in OUTER_TIES:
                # These native OSM chords extend hundreds of metres beyond
                # the abutment. Clip each landing at its surveyed native tie.
                full = LineString(points(way))
                at_start = wid == 500400552
                boundary = full.project(Point(OUTER_TIES[wid]))
                tie = full.interpolate(boundary)
                lat, lon = xz2ll(tie.x, tie.y)
                index = -1 if at_start else 0
                local["nodes"][index] = -wid
                local["geometry"][index] = {"lat": lat, "lon": lon}
                local["nativeRemainder"] = list(
                    substring(full, boundary, full.length).coords
                    if at_start
                    else substring(full, 0, boundary).coords
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
            if wid == 983781245:
                knots.extend([(95.63, 160.20), (line.length - 5, 160.20)])
            if wid == 983781247:
                knots.extend([(5, 160.20), (144.96, 160.20)])
            if wid == 500400552:
                knots.append((5, 159.95))
            if wid == 500571918:
                knots.append((line.length - 5, 159.95))
            if wid == 500400555:
                knots.append((line.length - 6, 162.28425))
            heights = samples([*knots, (line.length, levels[1])], transition=1.0)
        if wid in widths:
            local["stationWidth"] = widths[wid]
        profiles[wid] = local, line, np.array(heights)
    return profiles


def raise_decks(directory, manifest, elements, profiles):
    """Fit the six existing GL04 road decks and stitch their approaches."""
    ways = {
        w["id"]: w
        for w in elements
        if w["type"] == "way" and w["id"] in BRIDGES | ROAD_SPANS.keys()
    }
    lines = {wid: LineString(points(w)) for wid, w in ways.items()}
    approaches = {}
    for road, alignment, levels in profiles.values():
        if road["id"] in APPROACHES and road["tags"]["highway"] == "motorway":
            for node in (road["nodes"][0], road["nodes"][-1]):
                approaches[node] = alignment, levels
    found = {wid: 0 for wid in ways}
    faces = {
        node: []
        for way in ways.values()
        for node in (way["nodes"][0], way["nodes"][-1])
    }
    footprints = {
        wid: line.buffer(5.02, cap_style="square") for wid, line in lines.items()
    }
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
                if not all(footprints[wid].covers(Point(p)) for p in xy):
                    continue
                ends = set()
                axis = np.subtract(line.coords[-1], line.coords[0]) / line.length
                for vertex, p in zip(tri, xy):
                    native_cm = int(vertex[1])
                    along = line.project(Point(p))
                    height = bridge_height(wid, line, along)
                    if wid not in YARD_DECK and wid not in ROAD_SPANS:
                        # Follow the Hengliu plane across the slab width as well.
                        height += hengliu(p[1]) - hengliu(line.interpolate(along).y)
                    y = round(height * 100)
                    vertex[1] = y
                    # The approach and deck share an abutment slab wide enough
                    # to support both axles while a vehicle straddles the joint.
                    along = (p - line.coords[0]) @ axis
                    if along < 0.012 or along > line.length - 0.012:
                        first = along < 0.012
                        target = -2.5 if first else line.length + 2.5
                        vertex[[0, 2]] = np.rint(
                            (p + (target - along) * axis - [x, z]) * 100
                        )
                        node = ways[wid]["nodes"][0 if first else -1]
                        approach, levels = approaches[node]
                        at = approach.project(
                            Point(vertex[0] / 100 + x, vertex[2] / 100 + z)
                        )
                        vertex[1] = round(
                            np.interp(at, levels[:, 0], levels[:, 1]) * 100
                        )
                        ends.add(node)
                    if vertex[1] < native_cm:
                        raise ValueError(f"S2201 deck lowered on {wid}")
                for node in ends:
                    faces[node].append((tri / 100 + [x, 0, z]).tolist())
                found[wid] += 1
                changed = True
                break
        if changed:
            path.write_bytes(gzip.compress(data, mtime=0))
            chunk["bytes"] = path.stat().st_size
    if not all(found.values()):
        raise ValueError(f"Missing S2201 deck faces: {found}")
    landings = {}
    for node, triangles in faces.items():
        if not triangles:
            raise ValueError(f"Missing bridge abutment at {node}")
        ring = MultiPoint(np.array(triangles).reshape(-1, 3)[:, [0, 2]]).convex_hull
        # The deck already draws these faces. Sharing their exact positions
        # clips the overlapping road floor and gives both ways the same support.
        landings[node] = dict(
            ring=list(ring.exterior.coords)[:-1], faces=triangles, draw=False
        )
    return ways, landings

"""Grade existing GL04 road bridges after solving the railway, then join their approaches."""
import gzip
import json
import math
import struct

import numpy as np
from shapely import LineString, MultiPoint, Point, Polygon, box
from shapely.geometry.polygon import orient

from features import points


def access_faces(center, forward, width, top, design):
    """Use horizontal treads for short platform exits and an inclined deck for ramps."""
    length, bottom = design["length"], design["landing"]
    side = np.array([-forward[1], forward[0]]) * width
    if design["kind"] == "stairs":
        count = max(1, math.ceil(abs(top - bottom) / .15))
        if (length - 1.) / count < .28:
            raise ValueError("Insufficient tread depth on bridge access")
        edges = np.r_[0., np.linspace(.5, length - .5, count + 1), length]
        levels = np.r_[top, np.linspace(top, bottom, count + 1)[1:], bottom]
    else:
        if abs(top - bottom) > .08 * length:
            raise ValueError("Bridge access ramp exceeds 8%")
        edges, levels = [0., length], [top, bottom]
    widths = [width] * len(edges)
    if "approachHalfWidth" in design:
        # Flare from the native bridge slab across the skew joint. Without
        # the inside overlap one outer wheel can land on the road below.
        edges = [-design["overlap"], *edges]
        levels = [design["insideLevel"], *levels]
        widths = [width, design["approachHalfWidth"], design["approachHalfWidth"]]
    faces = []
    for i, (a, b) in enumerate(zip(edges, edges[1:])):
        left, right = center + a * forward, center + b * forward
        start = levels[i]
        end = start if design["kind"] == "stairs" else levels[i + 1]
        first_side = side * (widths[i] / width)
        last_side = side * (widths[i + 1] / width)
        corners = [(left + first_side, start), (left - first_side, start),
                   (right - last_side, end), (right + last_side, end)]
        for indices in [(0, 1, 2), (0, 2, 3)]:
            faces.append(np.array([[p[0], y, p[1]] for p, y in [corners[k] for k in indices]]))
    return faces


def clipped_faces(face, tile):
    xy = face[:, [0, 2]]
    overlap = Polygon(xy).intersection(tile)
    if overlap.area < 1e-6:
        return
    slope = np.linalg.solve(xy[1:] - xy[0], face[1:, 1] - face[0, 1])
    ring = list(orient(overlap, sign=-1).exterior.coords)[:-1]
    for a, b in zip(ring[1:], ring[2:]):
        yield np.array([[x, face[0, 1] + slope @ (np.array([x, z])-xy[0]), z]
                        for x, z in (ring[0], a, b)])


def grade_decks(directory, manifest, designs, ways, profiles, passage=None, *, preserve_paving=False):
    axes = {d["way"]: LineString(points(ways[d["way"]])) for d in designs}
    patches = {}
    abutments = {}
    deck_ends = {}
    found = set()
    for d in designs:
        wid = d["way"]
        line = axes[wid]
        levels = np.asarray(d["controls"])
        if levels[0, 0] != 0 or abs(levels[-1, 0] - line.length) > .001:
            raise ValueError(f"Incomplete bridge profile on {wid}")
        if np.any(np.diff(levels[:, 0]) <= 0) or np.any(abs(np.diff(levels[:, 1])) >
                d["maximumGrade"] * np.diff(levels[:, 0]) + 1e-6):
            raise ValueError(f"Invalid deck grade on {wid}")
        for end, access in enumerate(d["access"]):
            i, j = (-1, -2) if end else (0, 1)
            node = ways[wid]["nodes"][i]
            center = np.asarray(line.coords[i])
            direction = center - line.coords[j]
            direction /= np.linalg.norm(direction)
            top = levels[i, 1]
            if passage and node in passage.entrances:
                if abs(top - passage.entrances[node][3]) > .005:
                    raise ValueError(f"Passage entrance does not meet bridge {wid}")
                patches[node] = []
                continue
            if "approachWay" in access:
                way, approach, samples = profiles[access["approachWay"]]
                landing = center + access["length"] * direction
                y = np.interp(approach.project(Point(landing)), samples[:, 0], samples[:, 1])
                access = dict(access, kind="ramp", landing=y)
                if preserve_paving and way.get("profileWidth", 0) > 2 * d["halfWidthM"]:
                    overlap = min(1., line.length)
                    inside = line.length - overlap if end else overlap
                    access.update(approachHalfWidth=way["profileWidth"]/2, overlap=overlap,
                                  insideLevel=float(np.interp(inside, *levels.T)))
                abutments[node] = []
                deck_ends[node] = LineString([center, center - access["length"] * direction]).buffer(
                    d["halfWidthM"], cap_style="flat")
            patches[node] = access_faces(center, direction, d["halfWidthM"], top, access)

    for chunk in manifest["chunks"]:
        x, z = chunk["x"], chunk["z"]
        tile = box(x, z, x + manifest["chunkSize"], z + manifest["chunkSize"])
        local = [d for d in designs if tile.distance(axes[d["way"]]) <=
                 d["halfWidthM"] + max(a["length"] for a in d["access"])]
        if not local:
            continue
        path = directory / chunk["file"]
        raw = bytearray(gzip.decompress(path.read_bytes()))
        vertices, indices, size, image, count = struct.unpack_from("<5I", raw, 4)
        start = 16924 + 9 * vertices + 4 * indices + size + image
        triangles = np.frombuffer(raw, "<i2", count * 9, start).reshape(-1, 3, 3)
        changed = False
        added = []
        origin = np.array([x, 0., z])
        for d in local:
            wid = d["way"]
            axis = axes[wid]
            strip = axis.buffer(d["halfWidthM"], cap_style="flat").buffer(.02)
            control = np.asarray(d["controls"])
            for triangle in triangles:
                xy = triangle[:, [0, 2]] / 100 + [x, z]
                if not all(strip.covers(Point(p)) for p in xy):
                    continue
                stations = [axis.project(Point(p)) for p in xy]
                y = np.rint(100 * np.interp(stations, control[:, 0], control[:, 1])).astype(int)
                if np.any(y < triangle[:, 1]):
                    raise ValueError(f"Road bridge {wid} would be lowered")
                triangle[:, 1] = y
                # A wheel or transverse grade probe at an oblique joint can land
                # on either side of the abutment. Include the actual deck there.
                for node in (ways[wid]["nodes"][0], ways[wid]["nodes"][-1]):
                    if node in deck_ends:
                        face = triangle.astype(float) / 100 + origin
                        abutments[node].extend(p.tolist() for p in clipped_faces(face, deck_ends[node]))
                found.add(wid)
                changed = True
            for node in (ways[wid]["nodes"][0], ways[wid]["nodes"][-1]):
                for patch in patches[node]:
                    for face in clipped_faces(patch, tile):
                        encoded = np.rint(100 * (face - origin)).astype("<i2")
                        added.append(encoded)
                        if node in abutments:
                            abutments[node].append((encoded / 100 + origin).tolist())
        if changed or added:
            if preserve_paving and added:
                # These abutments sit over existing roads. Keep their triangles
                # out of the planar mask that cuts the native pavement below.
                chunk.setdefault("elevatedAbutments", []).append([count, len(added)])
            stop = start + 18 * count
            struct.pack_into("<I", raw, 20, count + len(added))
            payload = raw[:stop] + np.asarray(added, dtype="<i2").tobytes() + raw[stop:]
            path.write_bytes(gzip.compress(payload, mtime=0))
            chunk["bytes"] = path.stat().st_size
    if found != set(axes):
        raise ValueError(f"Missing GL04 bridge decks {set(axes) - found}")
    joints = {}
    for node, faces in abutments.items():
        ring = MultiPoint(np.reshape(faces, (-1, 3))[:, [0, 2]]).convex_hull
        joints[node] = dict(ring=list(ring.exterior.coords)[:-1], faces=faces, draw=False)
    return [ways[wid] for wid in axes], joints

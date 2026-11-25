"""Fit the native pavement, markings, median and terrain to the Dingjiang road profiles."""

import gzip
import json
import math
import struct

import numpy as np
from shapely import LineString, box

from dingjiang import ROAD_IDS
from features import points


def finish_paving(directory, manifest, profiles, elements):
    sections = [s for s in manifest["tunnels"] if s["way"] in ROAD_IDS]
    alignments = []
    for section in sections:
        section["nativePaving"] = True
        a, b = np.asarray(section["portals"])[:, [0, 2]]
        alignments.append((LineString([a, b]), section, a, b))
    elevated = [
        LineString(points(w))
        for w in elements
        if w["type"] == "way"
        and "highway" in w.get("tags", {})
        and w["tags"].get("bridge") == "yes"
        and len(w.get("geometry", [])) >= 2
    ]
    # The first few metres of a clipped way's own continuation join its
    # graded shoulder. Retain the guard protecting the remaining native way.
    continuations = []
    for way in elements:
        if way.get("type") != "way" or way["id"] not in ROAD_IDS:
            continue
        solved = profiles[way["id"]][0]["nodes"]
        xy = np.array(points(way))
        for i, (u, v) in enumerate(zip(way["nodes"], way["nodes"][1:])):
            if v == solved[0] or u == solved[-1]:
                a, b = xy[i : i + 2]
                shift = (b - a) * min(0.95, 10 / np.linalg.norm(b - a))
                continuations.append(
                    (
                        a,
                        b,
                        a + shift if u == solved[-1] else a,
                        b - shift if v == solved[0] else b,
                    )
                )
    for tile in manifest["chunks"]:
        x, z = tile["x"], tile["z"]
        bounds = box(x, z, x + 256, z + 256)
        local = []
        for line, section, a, b in alignments:
            if bounds.distance(line) < section["halfWidth"] + 24:
                local.append((section, a, b))
        if not local:
            continue
        path = directory / tile["file"]
        raw = gzip.decompress(path.read_bytes())
        v, i, size = struct.unpack_from("<3I", raw, 4)
        offset = 16924 + 9 * v + 4 * i
        collision = json.loads(raw[offset : offset + size])
        streets = collision[1]
        if len(streets) < 16:
            continue
        wet = np.frombuffer(raw, "<i2", 4225, 8474)
        step = 4 if np.any(wet != -32768) else 8
        zz, xx = np.mgrid[0:257:step, 0:257:step]
        xx, zz = xx + x, zz + z
        target = np.full(xx.shape, np.inf)
        segments = {}
        axes = set()

        def key(a, b):
            return tuple(round(float(v), 4) for v in (*a, *b))

        for section, a, b in local:
            vec = (b - a) / section["length"]
            along = np.clip(
                (xx - a[0]) * vec[0] + (zz - a[1]) * vec[1], 0, section["length"]
            )
            distance = np.hypot(xx - a[0] - along * vec[0], zz - a[1] - along * vec[1])
            stations, levels = np.array(section["stations"]).T
            # Cover the shoulder and the support vertices of each intersecting
            # terrain triangle. Keep a graded bank beyond the paved band.
            shoulder = section["halfWidth"] + 2
            bed = np.interp(along, stations, levels) - 0.22
            bed += np.maximum(0, distance - shoulder - step * math.sqrt(2)) * 0.5
            near = distance <= shoulder + step * math.sqrt(2) + 6
            target[near] = np.minimum(target[near], bed[near])
            axes.add(key(a - [x, z], b - [x, z]))
        for wid in {section["way"] for section, _, _ in local}:
            _, line, levels = profiles[wid]
            width = next(s["halfWidth"] for s, _, _ in local if s["way"] == wid)
            pts = [
                np.asarray(line.interpolate(d).coords[0]) - [x, z] for d in levels[:, 0]
            ]
            for a, b in zip(pts, pts[1:]):
                segments[key(a, b)] = (width + 8, wid)
        # Elevated road decks do not own the ground-level paving beneath them.
        overhead = set()
        for line in elevated:
            if bounds.distance(line) > 24 or all(
                LineString([a, b]).distance(line) > 24 for _, a, b in local
            ):
                continue
            coords = np.asarray(line.coords) - [x, z]
            overhead.update(key(a, b) for a, b in zip(coords, coords[1:]))
        streets[14] = [
            s for s in streets[14] if s[5] is not None or tuple(s[:4]) not in overhead
        ]
        ties = {
            key(a - [x, z], b - [x, z]): key(c - [x, z], d - [x, z])
            for a, b, c, d in continuations
        }
        for seg in streets[14]:
            if seg[5] is None and tuple(seg[:4]) in ties:
                seg[:4] = ties[tuple(seg[:4])]
            profile = segments.get(tuple(seg[:4]))
            if profile is not None and seg[5] is not None:
                seg[4], owner = profile
                seg.append(owner)
                # Put the original asphalt just above the collision floor.
                seg[5] += 0.012
                seg[6] += 0.012
        streets[15] = [cut for cut in streets[15] if key(cut[:2], cut[2:4]) not in axes]
        while len(collision) < 7:
            collision.append([])
        cuts = dict(collision[6])
        _, _, _, texture, triangles = struct.unpack_from("<5I", raw, 4)
        tail = offset + size + texture + 18 * triangles
        start = tail if len(raw) - tail == 8450 else 24
        grid = (
            np.frombuffer(raw, "<i2", 4225, start).reshape(65, 65)[
                :: step // 4, :: step // 4
            ]
            / 10
        )
        for k in np.flatnonzero(np.isfinite(target)):
            level = math.floor(target.flat[k] * 100)
            if level < cuts.get(int(k), grid.flat[k] * 100):
                cuts[int(k)] = level
        collision[6] = sorted(cuts.items())
        packed = json.dumps(collision, separators=(",", ":")).encode()
        payload = (
            raw[:12]
            + struct.pack("<I", len(packed))
            + raw[16:offset]
            + packed
            + raw[offset + size :]
        )
        path.write_bytes(gzip.compress(payload, mtime=0))
        tile["bytes"] = path.stat().st_size

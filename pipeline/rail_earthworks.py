"""Fit the finished terrain grid below a section's ballast and grade its side slopes."""

import gzip
import json
import struct

import numpy as np
from shapely import LineString, STRtree, box, points

from landmarks.world_surface import Surface
from section_track_strips import section_strips


def bake(world, manifest):
    sections = section_strips(world, terrain_only=True)
    # Bridges and tunnels keep their separate structural support.
    rows = [r for chords in sections.values() for r in chords if not int(r[7]) & 3]
    if not rows:
        return
    ground_tracks = np.asarray(rows)
    starts = ground_tracks[:, [1, 2]]
    vectors = ground_tracks[:, [4, 5]] - starts
    lengths2 = np.sum(vectors * vectors, axis=1)
    tree = STRtree([LineString([a, a + d]) for a, d in zip(starts, vectors)])
    road_bands = []
    for road in manifest.get("tunnels", []):
        a, b = road["portals"]
        axis = LineString([(a[0], a[2]), (b[0], b[2])])
        road_bands.append(axis.buffer(road["halfWidth"] + 2))
    roads = STRtree(road_bands)
    surface = Surface(world, manifest)
    for tile in manifest["chunks"]:
        x, z = tile["x"], tile["z"]
        if not tree.query(box(x - 48, z - 48, x + 304, z + 304)).size:
            continue
        grid, _, step = surface.tile((x, z))
        xx, zz = np.meshgrid(
            x + step * np.arange(len(grid)), z + step * np.arange(len(grid))
        )
        xy = np.column_stack((xx.ravel(), zz.ravel()))
        k, j = tree.query(points(xy), predicate="dwithin", distance=48)
        if not len(k):
            continue
        delta = xy[k] - starts[j]
        t = np.clip(np.sum(delta * vectors[j], axis=1) / lengths2[j], 0, 1)
        lateral = np.linalg.norm(delta - t[:, None] * vectors[j], axis=1)
        rail = ground_tracks[j, 3] + t * (ground_tracks[j, 6] - ground_tracks[j, 3])
        # Each coarse cell touching the inspection strip must support its whole
        # triangle. Beyond that bench, meet the original surface at 1:2.
        flank = np.maximum(0, lateral - (3.7 + 8 * np.sqrt(2))) / 2
        upper = np.full(grid.size, np.inf)
        lower = np.full(grid.size, -np.inf)
        np.minimum.at(upper, k, rail - 0.65 + flank)
        np.maximum.at(lower, k, rail - 0.85 - flank)
        f = world / tile["file"]
        data = gzip.decompress(f.read_bytes())
        v, i, n = struct.unpack_from("<3I", data, 4)
        off = 16924 + 9 * v + 4 * i
        c = json.loads(data[off : off + n])
        while len(c) < 7:
            c.append([])
        existing = dict(c[6])
        old = grid.flatten()
        for idx, cm in existing.items():
            old[idx] = cm / 100
        # Keep the original excavation around driving surfaces and box roofs.
        # Fade fill outside the last grid triangle touching the road margin.
        indices, gaps = roads.query_nearest(
            points(xy), max_distance=48, return_distance=True, all_matches=False
        )
        lower[indices[0]] = np.minimum(
            lower[indices[0]],
            old[indices[0]] + np.maximum(0, gaps - 8 * np.sqrt(2)) / 2,
        )
        target = np.minimum(np.maximum(old, lower), upper)
        changed = np.flatnonzero(np.abs(target - old) > 0.005)
        if not len(changed):
            continue
        for idx in changed:
            existing[int(idx)] = round(target[idx] * 100)
        c[6] = sorted(existing.items())
        encoded = json.dumps(c, separators=(",", ":")).encode()
        f.write_bytes(
            gzip.compress(
                data[:12]
                + struct.pack("<I", len(encoded))
                + data[16:off]
                + encoded
                + data[off + n :],
                mtime=0,
            )
        )
        tile["bytes"] = f.stat().st_size

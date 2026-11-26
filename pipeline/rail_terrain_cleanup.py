"""Lower rendered terrain triangles only where they intrude on a surveyed rail strip."""
import gzip
import json
import struct
from pathlib import Path

import numpy as np
from shapely import STRtree, box, get_coordinates, intersection, polygons

from landmarks.world_surface import Surface
from section_track_strips import section_strips

BALLAST_TOP = -0.22


def cut_high_terrain(world, manifest):
    sections = section_strips(world, design_flag="cutHighTerrain")
    rows = np.asarray([row for tracks in sections.values() for row in tracks if not int(row[7]) & 2])
    if not len(rows):
        return
    start, end = rows[:, [1, 2]], rows[:, [4, 5]]
    delta = end - start
    length2 = np.sum(delta**2, axis=1)
    style = json.loads(Path(__file__).with_name("railway-style.json").read_bytes())
    half_width = style["ballastHalfWidth"] + 2
    normal = delta[:, ::-1] * [-1, 1] * (half_width / np.sqrt(length2))[:, None]
    strips = polygons(np.stack((start-normal, end-normal, end+normal, start+normal), axis=1))
    tree = STRtree(strips)
    surface = Surface(world, manifest)
    corrections = {}
    work = []
    for tile in manifest["chunks"]:
        x, z = tile["x"], tile["z"]
        # Include the neighbouring tile's copy of every shared grid vertex.
        nearby = tree.query(box(x - 8, z - 8, x + surface.size + 8, z + surface.size + 8))
        if not len(nearby):
            continue
        path = world / tile["file"]
        raw = gzip.decompress(path.read_bytes())
        v, i, size = struct.unpack_from("<3I", raw, 4)
        off = 16924 + 9*v + 4*i
        collision = json.loads(raw[off:off+size])
        grid, _, step = surface.tile((x,z))
        ny, nx = grid.shape
        heights = grid.flatten()
        for idx, cm in collision[6] if len(collision) > 6 else ():
            heights[idx] = cm / 100
        zz, xx = np.indices(grid.shape)
        xy = np.column_stack((x + step * xx.ravel(), z + step * zz.ravel()))
        work.append((tile, path, raw, collision, off, size, heights, xy))
        idx = np.arange(ny*nx).reshape(grid.shape)[:-1, :-1].ravel()
        tris = np.vstack((np.stack((idx,idx+1,idx+nx),axis=1),
                          np.stack((idx+nx+1,idx+nx,idx+1),axis=1)))
        footprints = polygons(xy[tris])
        strip_idx, triangle_idx = STRtree(footprints).query(strips[nearby], predicate="intersects")
        chord, face = nearby[strip_idx], tris[triangle_idx]
        # A linear height difference on two planes peaks at a vertex of the
        # clipped polygon. There is no sampling gap at the sleeper margin.
        loc, pair = get_coordinates(intersection(footprints[triangle_idx], strips[chord]), return_index=True)
        if not len(pair):
            continue
        base = face[:, 0]
        dx = (heights[face[:, 1]] - heights[base])/(xy[face[:, 1], 0] - xy[base, 0])
        dz = (heights[face[:, 2]] - heights[base])/(xy[face[:, 2], 1] - xy[base, 1])
        local = loc - xy[base[pair]]
        ground = heights[base[pair]] + dx[pair]*local[:,0] + dz[pair]*local[:,1]
        rail = chord[pair]
        along = np.sum((loc-start[rail])*delta[rail],axis=1)/length2[rail]
        gap = ground - (rows[rail, 3]+along*(rows[rail, 6]-rows[rail, 3]))
        excess = np.full(len(face), -np.inf)
        np.maximum.at(excess, pair, gap)
        hit = excess > BALLAST_TOP
        cuts = np.zeros(len(xy))
        # Lower all three corners equally to maintain clearance over the whole
        # intersection. Reserve one centimetre for GL04 quantisation.
        for col in range(3):
            np.maximum.at(cuts, face[hit, col], excess[hit] - BALLAST_TOP + 0.01)
        for k in np.flatnonzero(cuts):
            key = tuple(xy[k])
            corrections[key] = max(corrections.get(key, 0), cuts[k])

    for tile, path, raw, collision, off, size, heights, xy in work:
        changes = {idx: int(np.floor((heights[idx]-corrections[tuple(p)])*100))
                   for idx, p in enumerate(xy) if tuple(p) in corrections}
        if not changes:
            continue
        while len(collision) < 7:
            collision.append([])
        terrain = dict(collision[6])
        terrain.update(changes)
        collision[6] = sorted(terrain.items())
        encoded = json.dumps(collision,separators=(",",":")).encode()
        path.write_bytes(gzip.compress(raw[:12]+struct.pack("<I",len(encoded))+raw[16:off]
                                      +encoded+raw[off+size:],mtime=0))
        tile["bytes"] = path.stat().st_size

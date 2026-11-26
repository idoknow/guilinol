"""Compare the platform-to-rail step at half-metre intervals on finished platform edges."""
import argparse
import json
import subprocess
from pathlib import Path

import numpy as np
from shapely import LineString, STRtree, box, points as sample_points, polygons

from check_rail_section_tracks import tile_rails
from common import load_osm
from features import area

ROOT = Path(__file__).resolve().parents[1]


def rail_chords(world, region):
    chords = {}
    for tile in json.loads((world / "manifest.json").read_bytes())["chunks"]:
        x, z = tile["x"], tile["z"]
        if not box(x, z, x + 256, z + 256).intersects(region):
            continue
        for ax, az, ah, bx, bz, bh, _, flags, *_ in tile_rails(world, tile):
            if flags & 3:
                continue
            key = (x + ax / 100, z + az / 100, x + bx / 100, z + bz / 100)
            chords[key] = [ah / 100, bh / 100]
    return chords


def pavement(world, bounds, xy):
    output = subprocess.check_output([ROOT / "node_modules/.bin/tsx", ROOT / "scripts/approach-faces.ts", world],
                                     cwd=ROOT, input=json.dumps(bounds).encode())
    faces = [tri for role, tri in map(json.loads, output.splitlines()) if role == "paving-1"]
    triangles = np.array(faces)
    footprint = triangles[:, :, [0, 2]]
    basis = footprint[:, 1:] - footprint[:, :1]
    valid = abs(np.linalg.det(basis)) > 1e-7
    footprint, basis, triangles = footprint[valid], basis[valid], triangles[valid]
    probe, face = STRtree(polygons(footprint)).query(sample_points(xy), predicate="intersects")
    gradient = np.linalg.solve(basis[face], (triangles[face, 1:, 1] - triangles[face, :1, 1])[:, :, None])
    height = triangles[face, 0, 1] + np.sum(gradient[:, :, 0] * (xy[probe] - footprint[face, 0]), axis=1)
    result = np.full(len(xy), -np.inf)
    np.maximum.at(result, probe, height)
    return result


def check(base, world, ids):
    platforms = {w["id"]: area(w) for w in load_osm() if w["type"] == "way" and w["id"] in ids}
    if set(platforms) != set(ids):
        raise ValueError("Missing OSM platform")
    region = box(*np.min([p.bounds[:2] for p in platforms.values()], axis=0),
                 *np.max([p.bounds[2:] for p in platforms.values()], axis=0)).buffer(10)
    native = rail_chords(base, region)
    finished = rail_chords(world, region)
    if native.keys() != finished.keys():
        raise ValueError("Changed track plan at a platform")
    keys = list(native)
    axes = [LineString([key[:2], key[2:]]) for key in keys]
    tree = STRtree(axes)
    owners, probes, deltas = [], [], []
    for wid, polygon in platforms.items():
        # Inspect the walkable top, beyond the centimetre-rounded vertical curb.
        edge = polygon.buffer(-.08).exterior
        for s in np.arange(0, edge.length, .5):
            pt = edge.interpolate(s)
            j = int(tree.nearest(pt))
            line = axes[j]
            tangent = np.subtract(edge.interpolate((s+.05) % edge.length).coords[0],
                                  edge.interpolate((s-.05) % edge.length).coords[0])
            if line.distance(pt) > 6 or abs(tangent @ np.diff(line.coords, axis=0)[0]) < .9*np.linalg.norm(tangent)*line.length:
                continue
            t = line.project(pt, normalized=True)
            key = keys[j]
            deltas.append(np.dot([1-t, t], np.subtract(finished[key], native[key])))
            probes.append(pt.coords[0])
            owners.append(wid)
    bounds = [p.bounds for p in platforms.values()]
    xy = np.array(probes)
    old, new = (pavement(w, bounds, xy) for w in (base, world))
    paved = np.isfinite(old)
    if not np.array_equal(paved, np.isfinite(new)):
        raise ValueError("A finished platform edge has lost or gained pavement")
    result = []
    for wid in ids:
        inside = np.array(owners) == wid
        mask = paved & inside
        if not np.any(mask):
            raise ValueError(f"No walkable platform samples on {wid}")
        errors = abs(new[mask] - old[mask] - np.asarray(deltas)[mask])
        k = int(np.argmax(errors))
        result.append(dict(way=wid, samples=int(mask.sum()), nativeOpenings=int((inside & ~paved).sum()),
                           maximumErrorM=errors[k], worstXZ=xy[mask][k].tolist(),
                           over2cm=int(np.sum(errors > .02))))
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("base", "world", "design"):
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    rows = check(args.base.resolve(), args.world.resolve(), json.loads(args.design.read_bytes())["fitPlatforms"])
    print(json.dumps(rows, indent=2))
    raise SystemExit(any(row["over2cm"] for row in rows))

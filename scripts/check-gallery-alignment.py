"""Measure the mapped eaves in the shipped LOD0; stairs and city walls have no roof reference."""
import json
from pathlib import Path
import subprocess
import sys

import numpy as np
from shapely import polygons, union_all

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "pipeline"))
from common import load_osm
from features import area


def axis(shape):
    ring = list(shape.minimum_rotated_rectangle.exterior.coords)
    start, end = max(zip(ring, ring[1:]), key=lambda edge: np.linalg.norm(np.subtract(*edge)))
    dx, dz = np.subtract(end, start)
    return np.degrees(np.arctan2(dx, -dz)) % 180


def check(entry, way):
    data = subprocess.check_output(["node", ROOT / "pipeline/glb-triangles.mjs", ROOT / "public" / entry["file"]], timeout=90)
    tri = np.frombuffer(data, "<f4").astype(float).reshape(-1, 3, 3)
    # Select the continuous gallery gable or the tower's lowest roof by height.
    if entry["id"] == "zhuangyuan_gallery":
        keep = (tri[:,:,1].min(axis=1)>3.32) & (tri[:,:,1].max(axis=1)<4.50) & (tri[:,:,0].max(axis=1)<21.4) & (np.abs(tri[:,:,2]).max(axis=1)<2.2)
    else:
        keep = (tri[:,:,1].min(axis=1)>14.49) & (tri[:,:,1].max(axis=1)<17.71)
    local = tri[keep][:,:,[0,2]]
    angle = np.radians(entry["rotation"])
    c,s = np.cos(angle), np.sin(angle)
    xy = local @ np.array([[c,-s],[s,c]]) + np.array(entry["position"])[[0,2]]
    faces = polygons(xy)
    from shapely import area as face_area
    roof = union_all(faces[face_area(faces)>.001], grid_size=.01)
    target = area(way)
    overlap = roof.intersection(target).area / roof.union(target).area
    center = roof.centroid.distance(target.centroid)
    direction = abs((axis(roof)-axis(target)+90)%180-90)
    print(f"{entry['id']} vs way/{way['id']}: IoU {overlap:.3f}, centroid {center:.2f} m, angle {direction:.2f}°")
    return overlap >= .70 and center <= 5 and direction <= 5


if __name__ == "__main__":
    ways = {e["id"]:e for e in load_osm() if e["type"]=="way"}
    manifest=json.loads((ROOT/"public/world/manifest.json").read_text())
    entries={item["id"]:item for item in manifest["landmarks"]}
    passed=[check(entries[name],ways[key]) for name,key in (("zhuangyuan_gallery",1531321916),("xiaoyao_tower",702352884))]
    sys.exit(0 if all(passed) else 1)

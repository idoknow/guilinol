"""Packed landmark solids shared by the world builder and independent scene checks."""
import math
import os
import tempfile
import subprocess
from pathlib import Path

import numpy as np
import trimesh
from shapely import build_area, union_all
from shapely.geometry import LineString, Polygon
from shapely.ops import polygonize, unary_union


def solid_projection(triangles, ground):
    pieces = []
    for triangle in triangles:
        outline = triangle[:, ::2]
        if abs((outline[1,0]-outline[0,0])*(outline[2,1]-outline[0,1])
               -(outline[2,0]-outline[0,0])*(outline[1,1]-outline[0,1])) < .002:
            continue
        gaps = [height-ground(east,south)-.30 for east,height,south in triangle]
        if max(gaps) <= 0:
            continue
        clipped = []
        for index, gap in enumerate(gaps):
            prior = gaps[index-1]
            if (gap > 0) != (prior > 0):
                clipped.append(outline[index-1]+prior/(prior-gap)*(outline[index]-outline[index-1]))
            if gap > 0:
                clipped.append(outline[index])
        if len(clipped) >= 3:
            pieces.append(Polygon(clipped))
    return union_all(pieces, grid_size=.01)


def slice_tris_at_y(tris: np.ndarray, y_plane: float, grid_size=None):
    segs = []
    for tri in tris:
        ys = tri[:, 1] - y_plane
        if (ys > 0).all() or (ys < 0).all():
            continue
        pts = []
        for i in range(3):
            j = (i + 1) % 3
            y1, y2 = ys[i], ys[j]
            if (y1 <= 0 < y2) or (y2 <= 0 < y1):
                t = -y1 / (y2 - y1)
                p = tri[i] + t * (tri[j] - tri[i])
                pts.append((float(p[0]), float(p[2])))
            elif abs(y1) < 1e-6:
                pts.append((float(tri[i][0]), float(tri[i][2])))
        if len(pts) >= 2 and (pts[0][0] - pts[1][0]) ** 2 + (pts[0][1] - pts[1][1]) ** 2 > 1e-8:
            segs.append(LineString([pts[0], pts[1]]))
    if not segs:
        return Polygon()
    merged = union_all(segs, grid_size=grid_size)
    if grid_size is not None:
        return build_area(merged)
    polys = list(polygonize(merged))
    if polys:
        return unary_union(polys).buffer(0)
    return merged.buffer(0.05)


def structural_footprint(data, ground, blocking):
    collision = solid_projection(data['coll_tris'], ground).union(blocking)
    walls = data['vis_tris'][np.abs(data['vis_normals'][:, 1]) < .72].copy()
    if not len(walls):
        return collision
    corners, indices = np.unique(walls[:, :, ::2].reshape(-1, 2), axis=0, return_inverse=True)
    terrain = np.fromiter((ground(*point) for point in corners), float)
    walls[:, :, 1] -= terrain[indices].reshape(-1, 3)
    sections = [slice_tris_at_y(walls[(walls[:,:,1].min(axis=1) <= level) &
                                      (walls[:,:,1].max(axis=1) >= level)], level, grid_size=.001)
                for level in (.6, 1.2)]
    return unary_union([collision, *sections]).buffer(0)


def load_landmark_meshes(root: Path, manifest: dict):
    gltfpack = os.getenv('GLTFPACK') or 'gltfpack'
    out = {}
    for lm in manifest.get('landmarks', []):
        glb = root / 'public' / lm['file']
        if not glb.exists():
            continue
        px, py, pz = lm['position']
        rot = math.radians(lm.get('rotation', 0.0))
        cs, sn = math.cos(rot), math.sin(rot)
        T = np.array([[cs, 0, sn, px], [0, 1, 0, py], [-sn, 0, cs, pz], [0, 0, 0, 1]], dtype=float)
        with tempfile.NamedTemporaryFile(suffix='.glb') as tmp:
            subprocess.run([gltfpack, '-i', str(glb), '-o', tmp.name, '-kn'], check=True, capture_output=True)
            sc = trimesh.load_scene(tmp.name)
            edges = {child: parent for parent, child, _ in sc.graph.to_edgelist()}
            coll_tris, vis_tris = [], []
            coll_normals, vis_normals = [], []
            for node in sc.graph.nodes_geometry:
                cur = node
                in_coll, in_lod12 = False, False
                while cur and cur != sc.graph.base_frame:
                    nm = str(cur).lower()
                    if nm.startswith('collision'):
                        in_coll = True
                    if nm in ('lod1', 'lod2'):
                        in_lod12 = True
                    cur = edges.get(cur)
                if in_lod12:
                    continue
                mat, gname = sc.graph[node]
                g = sc.geometry[gname].copy()
                g.apply_transform(T @ mat)
                tris = g.vertices[g.faces]
                norms = g.face_normals
                if in_coll:
                    coll_tris.append(tris)
                    coll_normals.append(norms)
                else:
                    vis_tris.append(tris)
                    vis_normals.append(norms)
            out[lm['id']] = {
                'entry': lm,
                'coll_tris': np.concatenate(coll_tris, axis=0) if coll_tris else np.zeros((0, 3, 3)),
                'coll_normals': np.concatenate(coll_normals, axis=0) if coll_normals else np.zeros((0, 3)),
                'vis_tris': np.concatenate(vis_tris, axis=0) if vis_tris else np.zeros((0, 3, 3)),
                'vis_normals': np.concatenate(vis_normals, axis=0) if vis_normals else np.zeros((0, 3)),
            }
    return out



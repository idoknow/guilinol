"""2D cubic B-spline road network elevation solver & dry-terrain grading (IDOK-28)."""

from collections import defaultdict
import json
import math
from pathlib import Path
import re
import subprocess
from statistics import median

import numpy as np
from scipy.ndimage import distance_transform_edt, gaussian_filter, maximum_filter
from scipy.sparse import coo_matrix
from shapely import STRtree, intersects_xy
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import unary_union

from landmarks.jiefang_layout import LOWER_ROADS, SPAN_WAYS, deck_level, world_road_sections
from common import CHUNK, GRID, load_osm
from features import points, rongyin_sidewalk
from road_profile import RULES

STEP = 8.0  # B-spline knot spacing in metres (matches 8m chunk ground grid; 35x35 per chunk with 1-cell halo)


def bspline_weights_1d(t: np.ndarray):
    """Uniform cubic B-spline basis weights for t in [0, 1)."""
    om = 1.0 - t
    w0 = (om * om * om) / 6.0
    w1 = (3.0 * t * t * t - 6.0 * t * t + 4.0) / 6.0
    w2 = (-3.0 * t * t * t + 3.0 * t * t + 3.0 * t + 1.0) / 6.0
    w3 = (t * t * t) / 6.0
    return w0, w1, w2, w3


def eval_bspline_grid(ctrl: np.ndarray, left: float, top: float, xs: np.ndarray, zs: np.ndarray) -> np.ndarray:
    """Evaluate 2D uniform cubic B-spline with 1-cell halo (knot (0,0) is at (left - STEP, top - STEP))."""
    gh, gw = ctrl.shape
    u = (xs - left) / STEP + 1.0
    v = (zs - top) / STEP + 1.0
    ic = np.clip(np.floor(u).astype(np.int32), 1, gw - 3)
    ir = np.clip(np.floor(v).astype(np.int32), 1, gh - 3)
    tu = np.clip(u - ic, 0.0, 1.0)
    tv = np.clip(v - ir, 0.0, 1.0)
    wu = bspline_weights_1d(tu)
    wv = bspline_weights_1d(tv)
    out = np.zeros_like(xs, dtype=np.float64)
    for dr in range(4):
        wr = wv[dr]
        r_idx = ir - 1 + dr
        for dc in range(4):
            out += (wr * wu[dc]) * ctrl[r_idx, ic - 1 + dc]
    return out


def _add_eval_rows(rows_l, cols_l, vals_l, rhs_l, row_cursor: int,
                   gw: int, gh: int, left: float, top: float,
                   xs: np.ndarray, zs: np.ndarray, targets: np.ndarray, weights: np.ndarray) -> int:
    n = len(xs)
    if not n:
        return row_cursor
    u = (xs - left) / STEP + 1.0
    v = (zs - top) / STEP + 1.0
    ic = np.clip(np.floor(u).astype(np.int32), 1, gw - 3)
    ir = np.clip(np.floor(v).astype(np.int32), 1, gh - 3)
    tu = np.clip(u - ic, 0.0, 1.0)
    tv = np.clip(v - ir, 0.0, 1.0)
    wu = bspline_weights_1d(tu)
    wv = bspline_weights_1d(tv)
    r_ids = np.arange(row_cursor, row_cursor + n, dtype=np.int32)
    for dr in range(4):
        r_idx = ir - 1 + dr
        for dc in range(4):
            c_idx = ic - 1 + dc
            w = weights * wv[dr] * wu[dc]
            rows_l.append(r_ids)
            cols_l.append(r_idx * gw + c_idx)
            vals_l.append(w)
    rhs_l.append(weights * targets)
    return row_cursor + n


def _add_diff_rows(rows_l, cols_l, vals_l, rhs_l, row_cursor: int,
                   gw: int, gh: int, left: float, top: float,
                   x1: np.ndarray, z1: np.ndarray, x2: np.ndarray, z2: np.ndarray,
                   diff_targets: np.ndarray, weights: np.ndarray) -> int:
    """Add weighted equations: S(x1, z1) - S(x2, z2) = diff_targets."""
    n = len(x1)
    if not n:
        return row_cursor
    r_ids = np.arange(row_cursor, row_cursor + n, dtype=np.int32)
    for sign, xs, zs in ((1.0, x1, z1), (-1.0, x2, z2)):
        u = (xs - left) / STEP + 1.0
        v = (zs - top) / STEP + 1.0
        ic = np.clip(np.floor(u).astype(np.int32), 1, gw - 3)
        ir = np.clip(np.floor(v).astype(np.int32), 1, gh - 3)
        tu = np.clip(u - ic, 0.0, 1.0)
        tv = np.clip(v - ir, 0.0, 1.0)
        wu = bspline_weights_1d(tu)
        wv = bspline_weights_1d(tv)
        for dr in range(4):
            r_idx = ir - 1 + dr
            for dc in range(4):
                c_idx = ic - 1 + dc
                rows_l.append(r_ids)
                cols_l.append(r_idx * gw + c_idx)
                vals_l.append(sign * weights * wv[dr] * wu[dc])
    rhs_l.append(weights * diff_targets)
    return row_cursor + n


def solve_road_spline(A, b_rhs, initial):
    # Canonicalize the survey constraints before the solve: GEOS/libm last bits
    # otherwise propagate through thousands of Lanczos iterations.
    A.sort_indices()
    x0 = np.round(initial.ravel(), 8)
    A.data = np.round(A.data, 8)
    A.eliminate_zeros()
    payload = b''.join((np.asarray(A.shape, '<u4').tobytes(),
                        A.indptr.astype('<u4').tobytes(), A.indices.astype('<u4').tobytes(),
                        A.data.astype('<f8').tobytes(), np.round(b_rhs, 8).astype('<f8').tobytes(),
                        x0.astype('<f8').tobytes()))
    packed = subprocess.check_output(['node', Path(__file__).with_name('road-lsqr.mjs')], input=payload)
    return np.frombuffer(packed, '<f8').reshape(initial.shape)


def build_ground_mesh_lookup(original_dm: np.ndarray, surface_dm: np.ndarray,
                             left: int, top: int, width: int, depth: int):
    """Exact replica of web/src/world.ts detail() groundMesh (step=4 on wet chunks, step=8 on dry chunks)."""
    nx_c, nz_c = width // CHUNK, depth // CHUNK
    chunk_step = np.full((nz_c, nx_c), 8, dtype=np.int32)
    ground_65 = np.zeros((nz_c, nx_c, 65, 65), dtype=np.float64)
    for cj in range(nz_c):
        r0 = cj * 64
        w_arr = surface_dm[r0:r0 + 65]
        u_arr = original_dm[r0:r0 + 65]
        for ci in range(nx_c):
            c0 = ci * 64
            wt = w_arr[:, c0:c0 + 65]
            ut = u_arr[:, c0:c0 + 65].astype(np.float64) / 10.0
            has_water = bool((wt != -32768).any())
            step = 4 if has_water else 8
            chunk_step[cj, ci] = step
            segs = 256 // step
            wet_edges = (
                bool((wt[:, 0] != -32768).any()),
                bool((wt[:, 64] != -32768).any()),
                bool((wt[0, :] != -32768).any()),
                bool((wt[64, :] != -32768).any()),
            )
            gt = ground_65[cj, ci]
            for line_i in range(segs + 1):
                row_i = line_i * step // 4
                for col_j in range(segs + 1):
                    col_i = col_j * step // 4
                    if (col_i == 0 and not wet_edges[0]) or (col_i == 64 and not wet_edges[1]):
                        rb = row_i & ~7
                        rn = min(64, rb + 8)
                        tf = (row_i % 8) / 8.0
                        gt[line_i, col_j] = ut[rb, col_i] * (1.0 - tf) + ut[rn, col_i] * tf
                    elif (row_i == 0 and not wet_edges[2]) or (row_i == 64 and not wet_edges[3]):
                        cb = col_i & ~7
                        cn = min(64, cb + 8)
                        tf = (col_i % 8) / 8.0
                        gt[line_i, col_j] = ut[row_i, cb] * (1.0 - tf) + ut[row_i, cn] * tf
                    else:
                        gt[line_i, col_j] = ut[row_i, col_i]

    def ground_mesh_at(east: float, south: float) -> float:
        ci = min(nx_c - 1, max(0, int(math.floor((east - left) / CHUNK))))
        cj = min(nz_c - 1, max(0, int(math.floor((south - top) / CHUNK))))
        step = int(chunk_step[cj, ci])
        segs = 256 // step
        lx = min(256.0, max(0.0, east - (left + ci * CHUNK)))
        lz = min(256.0, max(0.0, south - (top + cj * CHUNK)))
        col = min(segs - 1, max(0, int(math.floor(lx / step))))
        row = min(segs - 1, max(0, int(math.floor(lz / step))))
        u = lx / step - col
        v = lz / step - row
        g = ground_65[cj, ci]
        a, b, c, d = g[row, col], g[row, col + 1], g[row + 1, col], g[row + 1, col + 1]
        return float(a + (b - a) * u + (c - a) * v if u + v <= 1.0 else d + (c - d) * (1.0 - u) + (b - d) * (1.0 - v))

    return ground_mesh_at


def solve_road_and_bridge_elevations(original_dm: np.ndarray, terrain_dm: np.ndarray, surface_dm: np.ndarray,
                                     left: int, top: int, width: int, depth: int,
                                     roads: list, ped_areas: list, layout, root: Path,
                                     vessel_routes=(), previous_bed: np.ndarray | None = None):
    """
    1. Plan smooth bridge deck profiles & landmark bridge approach heights (clustering twin carriageways
       and short causeway islets so twin decks never tilt or overlap, while satisfying boat/raft clearance).
    2. Solve global 2D cubic B-spline road elevation surface S(x, z) with:
       - Flat cross-sections across every road (crossTilt == 0)
       - Smooth junctions (automatic weighted platform)
       - Exact bridge-head matching (bridgeJointStep == 0)
       - Strong curvature damping (gradeJump & localBump == 0)
    3. Imprint S(x, z) onto dry (`surface_dm == -32768`) cells of `original_dm` & `terrain_dm`
       with an 8m smoothstep transition outside road edges, preserving IDOK-27 shoreline freeboard.
    Returns (ctrl_grid, bridge_plans, finalize_bridges_fn).
    """
    wet = surface_dm != -32768
    gh4, gw4 = original_dm.shape
    bounds_poly = Polygon([(left, top), (left + width, top), (left + width, top + depth), (left, top + depth)])
    adj_water_dm = maximum_filter(surface_dm, footprint=[[0, 1, 0], [1, 1, 1], [0, 1, 0]], mode='constant', cval=-32768)
    shore_floor_dm = np.where((~wet) & (adj_water_dm != -32768), adj_water_dm + 3, -32768).astype('<i2')

    # Fill wet cells with smoothed dry terrain strictly for initial background DEM reference (never modifies wet!)
    dry_m = original_dm.astype(np.float64) / 10.0
    if wet.any() and (~wet).any():
        _, nearest_idx = distance_transform_edt(wet, return_indices=True)
        dry_filled = dry_m[nearest_idx[0], nearest_idx[1]]
    else:
        dry_filled = dry_m.copy()
    dem_smooth = gaussian_filter(dry_filled, sigma=2.5)

    def dem_at(x: float, z: float) -> float:
        r = int(np.clip(round((z - top) / GRID), 0, gh4 - 1))
        c = int(np.clip(round((x - left) / GRID), 0, gw4 - 1))
        return float(dem_smooth[r, c])

    def water_at(x: float, z: float) -> float | None:
        r = int(np.clip(round((z - top) / GRID), 0, gh4 - 1))
        c = int(np.clip(round((x - left) / GRID), 0, gw4 - 1))
        val = int(surface_dm[r, c])
        return None if val == -32768 else val / 10.0

    landmarks_cfg = json.loads((root / 'pipeline/landmarks.json').read_text())
    specifications = {entry['id']: entry for entry in landmarks_cfg}
    replaced_ways = set()
    for entry in landmarks_cfg:
        rep = entry.get('replace', [])
        if isinstance(rep, list):
            replaced_ways.update(k for k in rep if isinstance(k, str))

    from audit import load_landmark_meshes
    initial_ground = build_ground_mesh_lookup(original_dm, surface_dm, left, top, width, depth)
    def _lm_init_y(x: float, z: float, entry: dict) -> float:
        r = int(np.clip(round((z - top) / GRID), 0, gh4 - 1))
        c = int(np.clip(round((x - left) / GRID), 0, gw4 - 1))
        if wet[r, c]:
            if entry['id'] in ('jiefang_bridge', 'ronghu') and previous_bed is not None:
                return float(previous_bed[r, c]) / 10.0
            if entry['id'] == 'shanhu_pagodas':
                return float(surface_dm[r, c]) / 10.0
            return float(terrain_dm[r, c]) / 10.0
        if entry['id'] == 'ronghu':
            return initial_ground(x, z)
        fl = specifications[entry['id']].get('flatten')
        if isinstance(fl, dict) and 'elevation' in fl:
            return float(fl['elevation'])
        return dem_at(x, z)

    manifest_like = {
        'landmarks': [
            dict(position=[x, _lm_init_y(x, z, entry), z], **entry)
            for x, z, entry in layout.entries
        ]
    }
    lm_meshes = load_landmark_meshes(root, manifest_like)

    def lm_deck_y(lid: str, x: float, z: float) -> float | None:
        if lid not in lm_meshes:
            return None
        ctris = lm_meshes[lid]['coll_tris']
        cnorms = lm_meshes[lid]['coll_normals']
        if not len(ctris):
            return None
        walk = ctris[np.abs(cnorms[:, 1]) > (0.35 if lid in ('ronghu', 'huaqiao') else 0.65)]
        if not len(walk):
            return None
        pt = Point(x, z)
        exact = []
        covered = []
        for tri in walk:
            p2 = Polygon(tri[:, [0, 2]])
            if p2.is_valid and p2.area > (1.5 if lid == 'jiefang_bridge' else 0.05) and p2.buffer(5.0).contains(pt):
                np_pt = pt if p2.contains(pt) else Polygon(p2.exterior).exterior.interpolate(Polygon(p2.exterior).exterior.project(pt))
                qx, qz = np_pt.x, np_pt.y
                x0, z0 = tri[0, 0], tri[0, 2]
                dx1, dz1 = tri[1, 0] - x0, tri[1, 2] - z0
                dx2, dz2 = tri[2, 0] - x0, tri[2, 2] - z0
                det = dx1 * dz2 - dx2 * dz1
                if abs(det) > 1e-8:
                    w1 = ((qx - x0) * dz2 - (qz - z0) * dx2) / det
                    w2 = (dx1 * (qz - z0) - dz1 * (qx - x0)) / det
                    height = float(tri[0, 1] + w1 * (tri[1, 1] - tri[0, 1]) + w2 * (tri[2, 1] - tri[0, 1]))
                    if p2.covers(pt):
                        covered.append(height)
                    exact.append((p2.area, height))
        if covered:
            return max(covered)
        if exact:
            exact.sort(key=lambda t: t[0], reverse=True)
            return exact[0][1]
        c_xz = walk[:, :, [0, 2]].mean(axis=1)
        d2 = (c_xz[:, 0] - x) ** 2 + (c_xz[:, 1] - z) ** 2
        near = d2 < 9.0
        if not near.any():
            return None
        return float(np.median(walk[near, :, 1]))

    road_node_ways = defaultdict(list)
    osm_ways = {}
    for el in load_osm():
        tags = el.get('tags', {})
        if el['type'] == 'way' and 'highway' in tags and tags.get('tunnel', 'no') == 'no':
            pts = points(el)
            if len(pts) >= 2:
                osm_ways[el['id']] = (pts, tags)
                road_node_ways[pts[0]].append(el['id'])
                road_node_ways[pts[-1]].append(el['id'])

    def connected_land_ways(wid: int, end_pt: tuple[float, float]) -> list[int]:
        return [
            oid for oid in road_node_ways.get(end_pt, [])
            if oid != wid and osm_ways[oid][1].get('bridge', 'no') == 'no'
            and osm_ways[oid][1]['highway'] in RULES['defaultWidth']
        ]

    bridge_way_ids = [
        wid for wid, (pts, tags) in osm_ways.items()
        if tags.get('bridge', 'no') != 'no' and f'way/{wid}' not in replaced_ways
        and bounds_poly.intersects(LineString(pts)) and LineString(pts).length >= 1.0
    ]

    # Pair twin one-way bridge carriageways so their decks never overlap each other in XZ
    b_lines = {wid: LineString(osm_ways[wid][0]) for wid in bridge_way_ids}
    b_line_list = [b_lines[wid] for wid in bridge_way_ids]
    b_tree = STRtree(b_line_list) if b_line_list else None

    vessel_tracks = []
    for leg in vessel_routes:
        lkind = leg.get('kind')
        if lkind not in ('boat', 'raft') or len(leg.get('path', ())) < 2:
            continue
        buf_r = 4.2 if lkind == 'boat' else 3.2
        req_add = 3.08 if lkind == 'boat' else 2.95
        t_poly = LineString([(e, s) for e, _, s in leg['path']]).buffer(buf_r)
        vessel_tracks.append((t_poly, leg['path'], req_add))

    raw_bridge_info = {}
    vessel_reqs = {}
    for idx_b, wid in enumerate(bridge_way_ids):
        pts, tags = osm_ways[wid]
        line = b_lines[wid]
        hw = tags['highway']
        match = re.fullmatch(r'(\d+(?:\.\d+)?)\s*(?:m)?', tags.get('width', ''))
        b_width = float(match[1]) if match else {
            'footway': 3, 'path': 3, 'steps': 3, 'cycleway': 3,
            'primary': 14, 'secondary': 12, 'trunk': 18,
            'trunk_link': 7, 'primary_link': 6.5, 'secondary_link': 6, 'tertiary_link': 5.5,
        }.get(hw, 10)
        one_way = hw in ('footway', 'path', 'cycleway', 'steps') or hw.endswith('_link') or tags.get('oneway', 'no') in ('yes', '1', 'true', '-1')
        if one_way and not match and b_tree is not None and wid != 246520676:
            seps = []
            for d_s in np.arange(min(4.0, line.length / 2.0), line.length, 10.0):
                here = line.interpolate(d_s)
                ax = np.subtract(line.interpolate(min(line.length, d_s + 0.3)).coords[0],
                                 line.interpolate(max(0.0, d_s - 0.3)).coords[0])
                ax_n = np.linalg.norm(ax)
                if ax_n < 1e-4:
                    continue
                ax /= ax_n
                for k_other in b_tree.query(here, predicate='dwithin', distance=22.0):
                    wid2 = bridge_way_ids[k_other]
                    if wid2 == wid:
                        continue
                    tags2 = osm_ways[wid2][1]
                    hw2 = tags2['highway']
                    one2 = hw2 in ('footway', 'path', 'cycleway', 'steps') or hw2.endswith('_link') or tags2.get('oneway', 'no') in ('yes', '1', 'true', '-1')
                    if not one2:
                        continue
                    line2 = b_lines[wid2]
                    along = line2.project(here)
                    if not 0.0 < along < line2.length:
                        continue
                    t2 = np.subtract(line2.interpolate(min(line2.length, along + 0.3)).coords[0],
                                     line2.interpolate(max(0.0, along - 0.3)).coords[0])
                    t2_n = np.linalg.norm(t2)
                    if t2_n < 1e-4 or abs(np.dot(ax, t2 / t2_n)) < 0.85:
                        continue
                    lat = np.linalg.norm(np.subtract(line2.interpolate(along).coords[0], here.coords[0]))
                    if lat >= 1.2:
                        seps.append(lat)
            if seps:
                b_width = max(1.6 if hw in ('footway', 'path', 'cycleway', 'steps') else 4.0, min(b_width, median(seps) - 0.6))
        if wid == 246520676:
            b_width = 6.8
        n_b = max(2, int(math.ceil(line.length / 2.0)) + 1)
        s_b = np.linspace(0.0, line.length, n_b)
        max_water_req = -1e9
        for s_val in s_b:
            p_here = line.interpolate(s_val)
            p_prev = line.interpolate(max(0.0, s_val - 0.5))
            p_next = line.interpolate(min(line.length, s_val + 0.5))
            tdx, tdy = p_next.x - p_prev.x, p_next.y - p_prev.y
            tlen = max(1e-4, math.hypot(tdx, tdy))
            nx_b, nz_b = -tdy / tlen * (b_width / 2.0), tdx / tlen * (b_width / 2.0)
            for ox, oz in ((0.0, 0.0), (nx_b, nz_b), (-nx_b, -nz_b)):
                wy = water_at(p_here.x + ox, p_here.y + oz)
                if wy is not None:
                    max_water_req = max(max_water_req, wy + 2.05)
        b_zone = line.buffer(b_width / 2.0 + 1.5)
        v_list = []
        for t_poly, v_path, req_add in vessel_tracks:
            if t_poly.intersects(b_zone):
                for va, vb in zip(v_path, v_path[1:]):
                    s_line = LineString([(va[0], va[2]), (vb[0], vb[2])])
                    if s_line.distance(line) <= b_width / 2.0 + 4.5:
                        req_v = float(max(va[1], vb[1])) + req_add + 0.08
                        max_water_req = max(max_water_req, req_v)
                        v_list.append((float(line.project(Point(va[0], va[2]))), req_v))
                        v_list.append((float(line.project(Point(vb[0], vb[2]))), req_v))
        if v_list:
            vessel_reqs[wid] = v_list
        raw_bridge_info[wid] = (pts, tags, line, b_width, n_b, s_b, max_water_req)

    # Cluster all bridge endpoints within 20m (twin carriageways / multi-span bridge joints)
    endpoints = []  # (wid, end_i, pt)
    for wid in bridge_way_ids:
        pts = raw_bridge_info[wid][0]
        endpoints.append((wid, 0, pts[0]))
        endpoints.append((wid, 1, pts[-1]))
    parent_uf = list(range(len(endpoints)))

    def find_uf(a: int) -> int:
        while parent_uf[a] != a:
            parent_uf[a] = parent_uf[parent_uf[a]]
            a = parent_uf[a]
        return a

    def union_uf(a: int, b: int):
        ra, rb = find_uf(a), find_uf(b)
        if ra != rb:
            parent_uf[rb] = ra

    for i in range(len(endpoints)):
        xi, zi = endpoints[i][2]
        for j in range(i + 1, len(endpoints)):
            xj, zj = endpoints[j][2]
            if (xi - xj) ** 2 + (zi - zj) ** 2 < 20.0 ** 2:
                union_uf(i, j)

    ep_cluster = {}
    cluster_pts = defaultdict(list)
    for idx_e, (wid, end_i, pt) in enumerate(endpoints):
        cid = find_uf(idx_e)
        ep_cluster[(wid, end_i)] = cid
        cluster_pts[cid].append(pt)

    fixed_clusters = set()
    cluster_h = {cid: float(np.mean([dem_at(px, pz) for px, pz in cpts])) for cid, cpts in cluster_pts.items()}
    jb_pos = lm_meshes['jiefang_bridge']['entry']['position'] if 'jiefang_bridge' in lm_meshes else None
    def jiefang_level(x, z):
        radians = np.deg2rad(lm_meshes['jiefang_bridge']['entry']['rotation'])
        along = (x - jb_pos[0]) * np.cos(radians) - (z - jb_pos[2]) * np.sin(radians)
        return jb_pos[1] + deck_level(along)

    for wid in bridge_way_ids:
        if wid == 246520676:
            for ei in (0, 1):
                cid = ep_cluster[(wid, ei)]
                cluster_h[cid] = 156.48
                fixed_clusters.add(cid)
        elif jb_pos is not None:
            bline = b_lines[wid]
            mp = bline.interpolate(0.5 * bline.length)
            if math.hypot(mp.x - jb_pos[0], mp.y - jb_pos[2]) < 35.0:
                pts_w = raw_bridge_info[wid][0]
                for ei, ept in ((0, pts_w[0]), (1, pts_w[-1])):
                    ly_jb = lm_deck_y('jiefang_bridge', ept[0], ept[1])
                    if ly_jb is not None:
                        cid = ep_cluster[(wid, ei)]
                        cluster_h[cid] = ly_jb + 0.08
                        fixed_clusters.add(cid)

    # Iteratively lift endpoint clusters for bridge water clearance AND short (<40m) islet causeways
    short_land_links = []
    pt_to_clusters = defaultdict(set)
    for (wid, end_i), cid in ep_cluster.items():
        pt = raw_bridge_info[wid][0][0 if end_i == 0 else -1]
        pt_to_clusters[pt].add(cid)
    for oid, (lpts, ltags) in osm_ways.items():
        if ltags.get('bridge', 'no') != 'no' or ltags['highway'] not in RULES['defaultWidth']:
            continue
        c_a = pt_to_clusters.get(lpts[0])
        c_b = pt_to_clusters.get(lpts[-1])
        if c_a and c_b:
            llen = LineString(lpts).length
            if 0.5 < llen < 40.0:
                for ca in c_a:
                    for cb in c_b:
                        if ca != cb:
                            short_land_links.append((ca, cb, llen))

    for _ in range(8):
        for wid in bridge_way_ids:
            if wid == 246520676:
                continue
            pts, tags, line, b_width, n_b, s_b, max_water_req = raw_bridge_info[wid]
            c0, c1 = ep_cluster[(wid, 0)], ep_cluster[(wid, 1)]
            if c0 in fixed_clusters and c1 in fixed_clusters:
                continue
            has_v = wid in vessel_reqs
            max_arch = min(1.80, (0.00048 if has_v else 0.00032) * (line.length ** 2))
            req_mid = max_water_req - max_arch
            cur_mid = 0.5 * (cluster_h[c0] + cluster_h[c1])
            if req_mid > cur_mid:
                lift = req_mid - cur_mid
                if c0 not in fixed_clusters and c1 not in fixed_clusters:
                    cluster_h[c0] += lift
                    cluster_h[c1] += lift
                elif c0 not in fixed_clusters:
                    cluster_h[c0] += 2.0 * lift
                elif c1 not in fixed_clusters:
                    cluster_h[c1] += 2.0 * lift
            if has_v:
                for s_cross, req_v in vessel_reqs[wid]:
                    for ds_v in (-3.2, 0.0, 3.2):
                        uc = min(1.0, max(0.0, (s_cross + ds_v) / line.length))
                        cur_at = cluster_h[c0] * (1.0 - uc) + cluster_h[c1] * uc + max_arch * 4.0 * uc * (1.0 - uc)
                        if req_v + 0.08 > cur_at:
                            need = req_v + 0.08 - cur_at
                            if c0 not in fixed_clusters and c1 not in fixed_clusters:
                                cluster_h[c0] += need
                                cluster_h[c1] += need
                            elif c0 not in fixed_clusters:
                                cluster_h[c0] += need / max(0.2, 1.0 - uc)
                            elif c1 not in fixed_clusters:
                                cluster_h[c1] += need / max(0.2, uc)
            max_dh = (0.036 if has_v else 0.026) * line.length
            if abs(cluster_h[c1] - cluster_h[c0]) > max_dh:
                hi = max(cluster_h[c0], cluster_h[c1])
                if c0 not in fixed_clusters:
                    cluster_h[c0] = max(cluster_h[c0], hi - max_dh)
                if c1 not in fixed_clusters:
                    cluster_h[c1] = max(cluster_h[c1], hi - max_dh)
        for ca, cb, llen in short_land_links:
            max_ldh = 0.022 * llen
            if cluster_h[ca] - cluster_h[cb] > max_ldh and cb not in fixed_clusters:
                cluster_h[cb] = cluster_h[ca] - max_ldh
            elif cluster_h[cb] - cluster_h[ca] > max_ldh and ca not in fixed_clusters:
                cluster_h[ca] = cluster_h[cb] - max_ldh

    bridge_targets = []  # (x, z, road_base_y, weight)
    bridge_plans = {}
    if jb_pos is not None:
        anchor = np.asarray(jb_pos)[[0, 2]]
        angle = -np.deg2rad(lm_meshes['jiefang_bridge']['entry']['rotation'])
        for way, line, _, levels, edge_l, edge_r in world_road_sections(anchor, angle):
            if way not in osm_ways or not line.intersects(bounds_poly):
                continue
            # Pin the full carriageway at each junction with the native road.
            for i in (0, -1):
                if not bounds_poly.covers(Point(line.coords[i])):
                    continue
                for x, z in (line.coords[i], edge_l[i], edge_r[i]):
                    bridge_targets.append((x, z, jb_pos[1] + levels[i] - .045, 1200.0))
                # Hold the native road level through the modeled landing, then
                # let the spline transition into its existing longitudinal grade.
                pt = np.array(line.coords[i])
                local = (pt - anchor) @ np.array([[np.cos(angle), -np.sin(angle)], [np.sin(angle), np.cos(angle)]])
                if min(abs(local[0] + 265), abs(abs(local[1]) - 120)) < .01:
                    outward = pt - line.coords[1 if i == 0 else -2]
                    outward /= np.linalg.norm(outward)
                    native = LineString(osm_ways[way][0])
                    seam = native.project(Point(pt))
                    sign = 1 if native.project(Point(pt + outward)) > seam else -1
                    available = native.length - seam if sign == 1 else seam
                    base = jb_pos[1] + levels[i]
                    if way in LOWER_ROADS:
                        # The depressed Binjiang road climbs back to the DEM over
                        # a longer run. Follow its curve beyond the modeled bank.
                        run = min(80, available)
                        if run < 1:
                            continue
                        far = native.interpolate(seam + sign * run)
                        rise = dem_at(far.x, far.y) - base
                        targets = []
                        for t in np.linspace(0, 1, 11)[1:]:
                            center = native.interpolate(seam + sign * t * run).coords[0]
                            targets.append((center, base + rise * t*t*(3-2*t), 900.0))
                    else:
                        # Upper and side approaches continue over the embankment.
                        targets = [(pt + d * outward, base, 1200.0)
                                   for d in (6, 14, 24) if d <= available]
                    for center, height, weight in targets:
                        for edge in (pt, edge_l[i], edge_r[i]):
                            x, z = center + edge - pt
                            if bounds_poly.covers(Point(x, z)):
                                bridge_targets.append((x, z, height - .045, weight))

    bridge_end_land = {}

    twin_arch = defaultdict(float)
    for wid in bridge_way_ids:
        if wid == 246520676 or wid not in raw_bridge_info:
            continue
        pts, tags, line, b_width, n_b, s_b, max_water_req = raw_bridge_info[wid]
        c0, c1 = ep_cluster[(wid, 0)], ep_cluster[(wid, 1)]
        if c0 in fixed_clusters or c1 in fixed_clusters:
            continue
        h0, h1 = cluster_h[c0], cluster_h[c1]
        has_v = wid in vessel_reqs
        arch_cap = min(1.80, (0.00048 if has_v else 0.00032) * (line.length ** 2))
        req_arch = max(0.0, max_water_req - 0.5 * (h0 + h1))
        if has_v:
            for s_cross, req_v in vessel_reqs[wid]:
                for ds_v in (-3.2, 0.0, 3.2):
                    uc = min(1.0, max(0.0, (s_cross + ds_v) / line.length))
                    lin_at = h0 * (1.0 - uc) + h1 * uc
                    if req_v + 0.06 > lin_at:
                        req_arch = max(req_arch, (req_v + 0.06 - lin_at) / max(0.20, 4.0 * uc * (1.0 - uc)))
        pkey = (min(c0, c1), max(c0, c1)) if c0 != c1 else ('single', wid)
        twin_arch[pkey] = max(twin_arch[pkey], min(arch_cap, req_arch))

    # Replaced landmark bridges & fixed bridges: strong road approach pin so road meets immobile landmark deck
    for wid, (pts, tags) in osm_ways.items():
        if tags.get('bridge', 'no') == 'no':
            continue
        line = LineString(pts)
        if not bounds_poly.intersects(line) or line.length < 1.0:
            continue
        if f'way/{wid}' in replaced_ways or wid in SPAN_WAYS:
            owner_lm = next((e['id'] for e in landmarks_cfg if isinstance(e.get('replace'), list) and f'way/{wid}' in e['replace']), None)
            if wid in SPAN_WAYS:
                owner_lm = 'jiefang_bridge'
            # Ronghu decks are fitted to the final banks during landmark packing.
            # Pinning the banks to yesterday's deck would feed that fit back into itself.
            if owner_lm and owner_lm != 'ronghu':
                for end_idx, into_d in ((0, min(0.5, line.length * 0.2)), (-1, max(0.0, line.length - min(0.5, line.length * 0.2)))):
                    end_pt = pts[end_idx]
                    cland = connected_land_ways(wid, end_pt)
                    if not cland:
                        continue
                    bp = line.interpolate(into_d)
                    ly_deck = jiefang_level(bp.x, bp.y) if wid in SPAN_WAYS else lm_deck_y(owner_lm, bp.x, bp.y)
                    if ly_deck is not None:
                        lpts = osm_ways[cland[0]][0]
                        lline = LineString(lpts if lpts[0] == end_pt else lpts[::-1])
                        for d_pin in (0.0, min(1.0, lline.length * 0.5), min(2.5, lline.length * 0.8)):
                            pp = lline.interpolate(d_pin)
                            bridge_targets.append((pp.x, pp.y, ly_deck - 0.045, 1200.0))
            if wid not in SPAN_WAYS:
                continue
        if wid not in raw_bridge_info:
            continue
        pts, tags, line, b_width, n_b, s_b, max_water_req = raw_bridge_info[wid]
        cland0 = connected_land_ways(wid, pts[0])
        cland1 = connected_land_ways(wid, pts[-1])
        c0, c1 = ep_cluster[(wid, 0)], ep_cluster[(wid, 1)]
        h0, h1 = cluster_h[c0], cluster_h[c1]
        if wid == 246520676:
            h_prof = np.full(n_b, 156.48, dtype=np.float64)
            pin_w = 420.0
        else:
            is_fixed_b = c0 in fixed_clusters or c1 in fixed_clusters
            has_v = wid in vessel_reqs
            pkey = (min(c0, c1), max(c0, c1)) if c0 != c1 else ('single', wid)
            arch = 0.0 if is_fixed_b else twin_arch[pkey]
            u_b = s_b / line.length
            h_prof = h0 * (1.0 - u_b) + h1 * u_b + arch * 4.0 * u_b * (1.0 - u_b)
            pin_w = 450.0 if (is_fixed_b or has_v) else (240.0 if (len(cluster_pts[c0]) > 1 or len(cluster_pts[c1]) > 1) else 42.0)

        bridge_plans[wid] = (line, b_width, s_b, h_prof)
        bridge_end_land[wid] = (cland0, cland1)
        if wid in SPAN_WAYS:
            continue  # The land approaches were pinned to the upper landmark deck above.
        for end_pt, h_end, cland in ((pts[0], float(h_prof[0]), cland0), (pts[-1], float(h_prof[-1]), cland1)):
            if cland:
                lpts = osm_ways[cland[0]][0]
                lline = LineString(lpts if lpts[0] == end_pt else lpts[::-1])
                for d_pin in (0.0, min(2.0, lline.length * 0.5), min(5.0, lline.length * 0.9)):
                    pp = lline.interpolate(d_pin)
                    bridge_targets.append((pp.x, pp.y, h_end - 0.045, pin_w))

    # Build 8m B-spline control grid with 1-cell halo around world extent
    gw = width // int(STEP) + 3
    gh = depth // int(STEP) + 3
    gx_coords = left + (np.arange(gw) - 1) * STEP
    gz_coords = top + (np.arange(gh) - 1) * STEP

    r4_idx = np.clip(np.rint((gz_coords - top) / GRID).astype(int), 0, gh4 - 1)
    c4_idx = np.clip(np.rint((gx_coords - left) / GRID).astype(int), 0, gw4 - 1)
    bg_ctrl = dry_filled[np.ix_(r4_idx, c4_idx)]
    smooth_bg_ctrl = dem_smooth[np.ix_(r4_idx, c4_idx)]

    rep_excl = getattr(layout, 'compound_polygons', getattr(layout, 'replace_exclude', layout.exclude))
    road_polys = []
    for road in roads:
        if not road.line.intersects(bounds_poly):
            continue
        p = road.line.buffer(road.width / 2.0 + road.left + road.right, quad_segs=2)
        if road.kind == 'pedestrian' and not rep_excl.is_empty:
            p = p.difference(rep_excl)
        if not p.is_empty:
            road_polys.append(p)
    for pa in ped_areas:
        cpa = pa.difference(rep_excl) if not rep_excl.is_empty else pa
        if not cpa.is_empty:
            road_polys.append(cpa)
    u_roads = unary_union(road_polys) if road_polys else Polygon()
    corridor_24m = u_roads.buffer(24.0) if not u_roads.is_empty else Polygon()
    GX, GZ = np.meshgrid(gx_coords, gz_coords)
    in_corridor = intersects_xy(corridor_24m, GX, GZ) if not corridor_24m.is_empty else np.zeros((gh, gw), dtype=bool)

    flatten_ctrl_mask = np.zeros((gh, gw), dtype=bool)
    flatten_ctrl_val = np.zeros((gh, gw), dtype=np.float64)
    for region, level in layout.flatten:
        m = intersects_xy(region, GX, GZ)
        flatten_ctrl_mask |= m
        flatten_ctrl_val[m] = level

    rows_l, cols_l, vals_l, rhs_l = [], [], [], []
    cursor = 0

    # Term 1: Control-grid background / DEM anchor
    all_nodes = np.arange(gh * gw, dtype=np.int32)
    node_w = np.where(in_corridor.ravel(), 0.16, 2.5)
    node_target = np.where(in_corridor.ravel(), smooth_bg_ctrl.ravel(), bg_ctrl.ravel())
    flat_flat = flatten_ctrl_mask.ravel()
    node_w = np.where(flat_flat, 14.0, node_w)
    node_target = np.where(flat_flat, flatten_ctrl_val.ravel(), node_target)
    rows_l.append(np.arange(cursor, cursor + gh * gw, dtype=np.int32))
    cols_l.append(all_nodes)
    vals_l.append(node_w)
    rhs_l.append(node_w * node_target)
    cursor += gh * gw

    # Term 2: Strong biharmonic (2nd-difference) smoothness on C (guarantees gradeJump == 0 & localBump == 0)
    rr, cc = np.meshgrid(np.arange(gh), np.arange(1, gw - 1), indexing='ij')
    w_xx = np.where(in_corridor[:, 1:-1], 92.0, 6.0).ravel()
    n_xx = rr.size
    r_ids = np.arange(cursor, cursor + n_xx, dtype=np.int32)
    for dc, coeff in ((-1, 1.0), (0, -2.0), (1, 1.0)):
        rows_l.append(r_ids)
        cols_l.append((rr * gw + (cc + dc)).ravel())
        vals_l.append(coeff * w_xx)
    rhs_l.append(np.zeros(n_xx))
    cursor += n_xx

    rr, cc = np.meshgrid(np.arange(1, gh - 1), np.arange(gw), indexing='ij')
    w_zz = np.where(in_corridor[1:-1, :], 92.0, 6.0).ravel()
    n_zz = rr.size
    r_ids = np.arange(cursor, cursor + n_zz, dtype=np.int32)
    for dr, coeff in ((-1, 1.0), (0, -2.0), (1, 1.0)):
        rows_l.append(r_ids)
        cols_l.append(((rr + dr) * gw + cc).ravel())
        vals_l.append(coeff * w_zz)
    rhs_l.append(np.zeros(n_zz))
    cursor += n_zz

    rr, cc = np.meshgrid(np.arange(gh - 1), np.arange(gw - 1), indexing='ij')
    w_xz = np.where(in_corridor[:-1, :-1] | in_corridor[1:, 1:], 115.0, 6.0).ravel()
    n_xz = rr.size
    r_ids = np.arange(cursor, cursor + n_xz, dtype=np.int32)
    for dr, dc, coeff in ((0, 0, 1.0), (0, 1, -1.0), (1, 0, -1.0), (1, 1, 1.0)):
        rows_l.append(r_ids)
        cols_l.append(((rr + dr) * gw + (cc + dc)).ravel())
        vals_l.append(coeff * w_xz)
    rhs_l.append(np.zeros(n_xz))
    cursor += n_xz

    rr, cc = np.meshgrid(np.arange(gh), np.arange(gw - 1), indexing='ij')
    m_gx = (in_corridor[:, :-1] | in_corridor[:, 1:]).ravel()
    rr_m, cc_m = rr.ravel()[m_gx], cc.ravel()[m_gx]
    n_gx = len(rr_m)
    if n_gx:
        r_ids = np.arange(cursor, cursor + n_gx, dtype=np.int32)
        rows_l.extend([r_ids, r_ids])
        cols_l.extend([rr_m * gw + cc_m, rr_m * gw + cc_m + 1])
        vals_l.extend([np.full(n_gx, 2.2), np.full(n_gx, -2.2)])
        rhs_l.append(np.zeros(n_gx))
        cursor += n_gx

    rr, cc = np.meshgrid(np.arange(gh - 1), np.arange(gw), indexing='ij')
    m_gz = (in_corridor[:-1, :] | in_corridor[1:, :]).ravel()
    rr_m, cc_m = rr.ravel()[m_gz], cc.ravel()[m_gz]
    n_gz = len(rr_m)
    if n_gz:
        r_ids = np.arange(cursor, cursor + n_gz, dtype=np.int32)
        rows_l.extend([r_ids, r_ids])
        cols_l.extend([rr_m * gw + cc_m, (rr_m + 1) * gw + cc_m])
        vals_l.extend([np.full(n_gz, 2.2), np.full(n_gz, -2.2)])
        rhs_l.append(np.zeros(n_gz))
        cursor += n_gz

    # Term 3: Zero cross-slope across EVERY road cross-section (including raw un-paired OSM width spans!)
    lx_a, lz_a, rx_a, rz_a = [], [], [], []
    lx_b, lz_b, rx_b, rz_b = [], [], [], []
    for road in roads:
        clipped = road.line.intersection(bounds_poly.buffer(-1.5))
        if road.kind == 'pedestrian' and not rep_excl.is_empty:
            clipped = clipped.difference(rep_excl)
        raw_def_w = float(RULES['defaultWidth'].get(road.kind, road.width))
        for seg in getattr(clipped, 'geoms', [clipped]):
            if seg.is_empty or seg.geom_type != 'LineString' or seg.length < 1.0:
                continue
            n_st = max(2, int(math.ceil(seg.length / 2.5)) + 1)
            half_in = max(1.2, 0.45 * max(road.width, raw_def_w))
            half_out = max(4.0, 0.5 * max(road.width, raw_def_w) + max(road.left, road.right) + 2.0)
            for s_val in np.linspace(0.0, seg.length, n_st):
                pt = seg.interpolate(s_val)
                p0 = seg.interpolate(max(0.0, s_val - 0.5))
                p1 = seg.interpolate(min(seg.length, s_val + 0.5))
                tdx, tdy = p1.x - p0.x, p1.y - p0.y
                tl = math.hypot(tdx, tdy)
                if tl < 1e-4:
                    continue
                nx_d, nz_d = -tdy / tl, tdx / tl
                lx_a.append(pt.x - nx_d * half_in)
                lz_a.append(pt.y - nz_d * half_in)
                rx_a.append(pt.x + nx_d * half_in)
                rz_a.append(pt.y + nz_d * half_in)
                lx_b.append(pt.x - nx_d * half_out)
                lz_b.append(pt.y - nz_d * half_out)
                rx_b.append(pt.x + nx_d * half_out)
                rz_b.append(pt.y + nz_d * half_out)

    if lx_a:
        lx_a_arr, lz_a_arr = np.asarray(lx_a), np.asarray(lz_a)
        rx_a_arr, rz_a_arr = np.asarray(rx_a), np.asarray(rz_a)
        cursor = _add_diff_rows(rows_l, cols_l, vals_l, rhs_l, cursor, gw, gh, left, top,
                                lx_a_arr, lz_a_arr, rx_a_arr, rz_a_arr,
                                np.zeros(len(lx_a_arr)), np.full(len(lx_a_arr), 520.0))
        lx_b_arr, lz_b_arr = np.asarray(lx_b), np.asarray(lz_b)
        rx_b_arr, rz_b_arr = np.asarray(rx_b), np.asarray(rz_b)
        cursor = _add_diff_rows(rows_l, cols_l, vals_l, rhs_l, cursor, gw, gh, left, top,
                                lx_b_arr, lz_b_arr, rx_b_arr, rz_b_arr,
                                np.zeros(len(lx_b_arr)), np.full(len(lx_b_arr), 240.0))

    # Term 4: Bridge approach elevation guidance
    if bridge_targets:
        bx = np.array([b[0] for b in bridge_targets], dtype=np.float64)
        bz = np.array([b[1] for b in bridge_targets], dtype=np.float64)
        by = np.array([b[2] for b in bridge_targets], dtype=np.float64)
        bw = np.array([b[3] for b in bridge_targets], dtype=np.float64)
        cursor = _add_eval_rows(rows_l, cols_l, vals_l, rhs_l, cursor, gw, gh, left, top,
                                bx, bz, by, bw)

    # Keep lakeside roads/walkways above perched adjacent water so wet bank cells never poke through
    lake_x, lake_z, lake_y = [], [], []
    for road in roads:
        clipped = road.line.intersection(bounds_poly.buffer(-2.0))
        for seg in getattr(clipped, 'geoms', [clipped]):
            if seg.is_empty or seg.geom_type != 'LineString' or seg.length < 3.0:
                continue
            for sv in np.linspace(0.0, seg.length, max(2, int(seg.length // 4.0) + 1)):
                pt = seg.interpolate(sv)
                r4 = int(np.clip(round((pt.y - top) / GRID), 0, gh4 - 1))
                c4 = int(np.clip(round((pt.x - left) / GRID), 0, gw4 - 1))
                w_patch = surface_dm[max(0, r4 - 2):min(gh4, r4 + 3), max(0, c4 - 2):min(gw4, c4 + 3)]
                if (w_patch != -32768).any():
                    wy = float(w_patch.max()) / 10.0
                    if wy + 0.36 > dem_at(pt.x, pt.y):
                        lake_x.append(pt.x)
                        lake_z.append(pt.y)
                        lake_y.append(wy + 0.38)
    if lake_x:
        cursor = _add_eval_rows(rows_l, cols_l, vals_l, rhs_l, cursor, gw, gh, left, top,
                                np.asarray(lake_x), np.asarray(lake_z), np.asarray(lake_y),
                                np.full(len(lake_x), 45.0))

    A = coo_matrix(
        (np.concatenate(vals_l), (np.concatenate(rows_l), np.concatenate(cols_l))),
        shape=(cursor, gh * gw),
    ).tocsr()
    b_rhs = np.concatenate(rhs_l)
    ctrl = solve_road_spline(A, b_rhs, smooth_bg_ctrl)

    # Imprint S(x, z) onto DRY cells of original_dm & terrain_dm:
    # - Inside actual road footprint (excluding landmark bounds): lift or press smoothly to road bed.
    # - In the outer 14m+8m margin & around landmarks/bridge spans: ONLY press downward (minimum) so
    #   groundMesh never pokes above street surfaces, without ever raising artificial embankments
    #   under bridges (e.g. 花桥, 文昌桥) or over compound landmark paving (e.g. 正阳步行街),
    #   while strictly preserving IDOK-27's shoreline freeboard (shore_floor_dm).
    if not u_roads.is_empty:
        xs4 = left + np.arange(gw4, dtype=np.float64) * GRID
        zs4 = top + np.arange(gh4, dtype=np.float64) * GRID
        X4, Z4 = np.meshgrid(xs4, zs4)
        # Grading precedes landmark packing. Use the surveyed replacement polygons
        # so grade-following paving cannot change its own ground on the next build.
        lm_keep = layout.replace_exclude
        # A full ground-mesh cell beyond the photographed sidewalk keeps its
        # triangulated surface level with the junction even at the facade edge.
        corner_bed = rongyin_sidewalk().buffer(8)
        actual_road_geom = u_roads.buffer(1.5, cap_style='flat').union(corner_bed)
        if not lm_keep.is_empty:
            actual_road_geom = actual_road_geom.difference(lm_keep)
        inside_actual = intersects_xy(actual_road_geom, X4, Z4) if not actual_road_geom.is_empty else np.zeros_like(wet)
        inside_bed = intersects_xy(u_roads.buffer(14.0), X4, Z4)
        dist_out_m = distance_transform_edt(~inside_bed) * GRID
        apron_mask = (~wet) & (dist_out_m < 8.0)
        ar, ac = np.where(apron_mask)
        s_vals = eval_bspline_grid(ctrl, left, top, xs4[ac], zs4[ar])
        t_blend = np.clip(dist_out_m[ar, ac] / 8.0, 0.0, 1.0)
        w_blend = 1.0 - t_blend * t_blend * (3.0 - 2.0 * t_blend)
        old_orig = original_dm[ar, ac].copy()
        orig_y = old_orig.astype(np.float64) / 10.0
        blended_y = w_blend * (s_vals - 0.06 * w_blend) + (1.0 - w_blend) * orig_y
        cand_dm = np.floor(blended_y * 10.0 + 0.5 * (1.0 - w_blend)).astype('<i2')
        can_lift = inside_actual[ar, ac]
        s_floor = shore_floor_dm[ar, ac]
        new_dm = np.maximum(np.where(can_lift, cand_dm, np.minimum(old_orig, cand_dm)), s_floor)
        mountain_mask = terrain_dm[ar, ac] > old_orig + 15
        original_dm[ar, ac] = new_dm
        terrain_dm[ar, ac] = np.maximum(np.where(mountain_mask, np.maximum(terrain_dm[ar, ac], new_dm), new_dm), s_floor)

        # Ensure flattened landmark compounds (e.g. 正阳步行街) never have groundMesh raised above their flatten datum
        motor_polys = [
            road.line.buffer(road.width / 2.0 + 1.0, cap_style='flat')
            for road in roads if road.kind != 'pedestrian' and road.line.intersects(bounds_poly)
        ]
        u_motor = unary_union(motor_polys) if motor_polys else Polygon()
        for region, level in layout.flatten:
            safe_reg = region.difference(u_motor) if not u_motor.is_empty else region
            if safe_reg.is_empty:
                continue
            f_mask = (~wet) & intersects_xy(safe_reg, X4, Z4)
            cap_lvl = int(round(level * 10.0))
            fr, fc = np.where(f_mask)
            old_f = original_dm[fr, fc].copy()
            sf_f = shore_floor_dm[fr, fc]
            original_dm[fr, fc] = np.maximum(np.minimum(old_f, cap_lvl), sf_f)
            non_mtn = terrain_dm[fr, fc] <= old_f + 15
            terrain_dm[fr, fc] = np.maximum(np.where(non_mtn, np.minimum(terrain_dm[fr, fc], cap_lvl), terrain_dm[fr, fc]), sf_f)

        # Clamp 32m chunk-border knots where roads cross chunk boundaries so 32m overview border lerp never pokes through
        for r_b in range(0, gh4, 64):
            for c_seg in range(0, gw4 - 1, 8):
                seg_bed = inside_bed[r_b, c_seg:c_seg + 9]
                if seg_bed.any():
                    seg_xs = xs4[c_seg:c_seg + 9][seg_bed]
                    seg_zs = np.full_like(seg_xs, zs4[r_b])
                    cap_dm = int(math.floor((float(eval_bspline_grid(ctrl, left, top, seg_xs, seg_zs).min()) - 0.06) * 10.0))
                    for c_end in (c_seg, c_seg + 8):
                        eff_cap = max(cap_dm, int(shore_floor_dm[r_b, c_end]))
                        if not wet[r_b, c_end] and original_dm[r_b, c_end] > eff_cap:
                            original_dm[r_b, c_end] = eff_cap
                            if terrain_dm[r_b, c_end] <= original_dm[r_b, c_end] + 20:
                                terrain_dm[r_b, c_end] = min(int(terrain_dm[r_b, c_end]), eff_cap)
        for c_b in range(0, gw4, 64):
            for r_seg in range(0, gh4 - 1, 8):
                seg_bed = inside_bed[r_seg:r_seg + 9, c_b]
                if seg_bed.any():
                    seg_zs = zs4[r_seg:r_seg + 9][seg_bed]
                    seg_xs = np.full_like(seg_zs, xs4[c_b])
                    cap_dm = int(math.floor((float(eval_bspline_grid(ctrl, left, top, seg_xs, seg_zs).min()) - 0.06) * 10.0))
                    for r_end in (r_seg, r_seg + 8):
                        eff_cap = max(cap_dm, int(shore_floor_dm[r_end, c_b]))
                        if not wet[r_end, c_b] and original_dm[r_end, c_b] > eff_cap:
                            original_dm[r_end, c_b] = eff_cap
                            if terrain_dm[r_end, c_b] <= original_dm[r_end, c_b] + 20:
                                terrain_dm[r_end, c_b] = min(int(terrain_dm[r_end, c_b]), eff_cap)

        # Ensure dry ground under procedural bridge spans never pokes up through the bridge deck
        for wid_b, (b_line, b_w, s_b_arr, h_b_arr) in bridge_plans.items():
            b_buf = b_line.buffer(b_w / 2.0 + 4.5, cap_style='flat')
            bx0, bz0, bx1, bz1 = b_buf.bounds
            c_lo = max(0, int(math.floor((bx0 - left) / GRID)))
            c_hi = min(gw4 - 1, int(math.ceil((bx1 - left) / GRID)))
            r_lo = max(0, int(math.floor((bz0 - top) / GRID)))
            r_hi = min(gh4 - 1, int(math.ceil((bz1 - top) / GRID)))
            if c_lo > c_hi or r_lo > r_hi:
                continue
            sub_x, sub_z = X4[r_lo:r_hi + 1, c_lo:c_hi + 1], Z4[r_lo:r_hi + 1, c_lo:c_hi + 1]
            sub_m = (~wet[r_lo:r_hi + 1, c_lo:c_hi + 1]) & intersects_xy(b_buf, sub_x, sub_z)
            for sr, sc in zip(*np.nonzero(sub_m)):
                gr, gc = r_lo + sr, c_lo + sc
                proj_s = float(b_line.project(Point(float(xs4[gc]), float(zs4[gr]))))
                deck_h = float(np.interp(proj_s, s_b_arr, h_b_arr))
                cap_b = max(int(shore_floor_dm[gr, gc]), int(math.floor((deck_h - 0.18) * 10.0)))
                if original_dm[gr, gc] > cap_b:
                    old_v = int(original_dm[gr, gc])
                    original_dm[gr, gc] = cap_b
                    if terrain_dm[gr, gc] <= old_v + 15:
                        terrain_dm[gr, gc] = min(int(terrain_dm[gr, gc]), cap_b)

    def finalize_bridges(ground_mesh_at):
        """Snap procedural bridge endpoints linearly (0 curvature!) to exact road_base_y(lp) + 0.045."""
        def road_base_at(x: float, z: float) -> float:
            rc = float(eval_bspline_grid(ctrl, left, top, np.array([x]), np.array([z]))[0])
            return max(rc, ground_mesh_at(x, z))

        motor_road_lines = [r.line for r in roads if r.kind in ('trunk', 'primary', 'secondary', 'tertiary')]
        motor_road_tree = STRtree(motor_road_lines) if motor_road_lines else None

        for wid, (line, b_width, s_b, h_prof) in list(bridge_plans.items()):
            if wid in SPAN_WAYS:
                # The two carriageways and cycleways share one sloping slab.
                # Keep GL04 just under its skin, including at the vaulted portal.
                profile = np.array([jiefang_level(*line.interpolate(station).coords[0]) - .04 for station in s_b])
                bridge_plans[wid] = (line, b_width, s_b, profile)
                continue
            if wid == 246520676:
                continue
            cland0, cland1 = bridge_end_land.get(wid, ([], []))
            pts = list(line.coords)
            L = line.length
            u_b = s_b / L
            hw_tag = osm_ways[wid][1].get('highway', '')
            if not cland0 and not cland1 and hw_tag in ('footway', 'path', 'cycleway') and motor_road_tree is not None:
                crossed_ys = []
                p_start, p_end = Point(pts[0]), Point(pts[-1])
                for r_idx in motor_road_tree.query(line, predicate='intersects'):
                    mr_line = motor_road_lines[r_idx]
                    if p_start.distance(mr_line) > 2.5 and p_end.distance(mr_line) > 2.5:
                        ix = line.intersection(mr_line)
                        for g_pt in getattr(ix, 'geoms', [ix]):
                            if hasattr(g_pt, 'x'):
                                crossed_ys.append(road_base_at(g_pt.x, g_pt.y))
                if crossed_ys:
                    overpass_y = max(crossed_ys) + 4.8
                    bridge_plans[wid] = (line, b_width, s_b, np.full_like(h_prof, overpass_y))
                    continue
            into0 = min(0.5, L * 0.2)
            u0 = into0 / L
            u1 = 1.0 - into0 / L
            cur0 = float(np.interp(u0, u_b, h_prof))
            cur1 = float(np.interp(u1, u_b, h_prof))

            tgt0 = None
            if cland0:
                lpts0 = osm_ways[cland0[0]][0]
                lline0 = LineString(lpts0 if lpts0[0] == pts[0] else lpts0[::-1])
                lp0 = lline0.interpolate(min(1.0, lline0.length * 0.5))
                tgt0 = road_base_at(lp0.x, lp0.y) + 0.045

            tgt1 = None
            if cland1:
                lpts1 = osm_ways[cland1[0]][0]
                lline1 = LineString(lpts1 if lpts1[0] == pts[-1] else lpts1[::-1])
                lp1 = lline1.interpolate(min(1.0, lline1.length * 0.5))
                tgt1 = road_base_at(lp1.x, lp1.y) + 0.045

            if tgt0 is not None and tgt1 is not None and abs(u1 - u0) > 1e-3:
                d_u0 = tgt0 - cur0
                d_u1 = tgt1 - cur1
                slope_d = (d_u1 - d_u0) / (u1 - u0)
                dh0 = d_u0 - slope_d * u0
                dh1 = dh0 + slope_d
            elif tgt0 is not None:
                dh0 = tgt0 - cur0
                dh1 = 0.0 if len(road_node_ways.get(pts[-1], [])) > 1 else dh0
            elif tgt1 is not None:
                dh1 = tgt1 - cur1
                dh0 = 0.0 if len(road_node_ways.get(pts[0], [])) > 1 else dh1
            else:
                dh0 = dh1 = 0.0

            h_adj = h_prof + dh0 * (1.0 - u_b) + dh1 * u_b
            if wid in vessel_reqs:
                extra_arch = 0.0
                for s_cross, req_v in vessel_reqs[wid]:
                    for ds_v in (-3.2, 0.0, 3.2):
                        sc = min(L, max(0.0, s_cross + ds_v))
                        uc = sc / L
                        h_at = float(np.interp(sc, s_b, h_adj))
                        if h_at < req_v - 0.05:
                            shape_w = max(0.28, 4.0 * uc * (1.0 - uc))
                            extra_arch = max(extra_arch, (req_v - 0.03 - h_at) / shape_w)
                if extra_arch > 0.0:
                    extra_arch = min(extra_arch, min(1.80, 0.00050 * (L ** 2)))
                    h_adj = h_adj + extra_arch * 4.0 * u_b * (1.0 - u_b)
            if wid == 191185431:
                # Both ends meet interior nodes of unpaved OSM paths (191185441,
                # 191185429). Those paths walk on GL04, not the smoothed road grid.
                # Blend the landings into the existing span, retaining its navigation arch.
                run = min(12., L / 3)
                for station, endpoint in ((0,pts[0]),(-1,pts[-1])):
                    distance = s_b if station == 0 else L-s_b
                    delta = ground_mesh_at(*endpoint)+.045-h_adj[station]
                    h_adj += delta*np.maximum(0.,1.-distance/run)
            bridge_plans[wid] = (line, b_width, s_b, h_adj)

    return ctrl, bridge_plans, finalize_bridges

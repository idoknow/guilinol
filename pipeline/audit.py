"""Scene quality audit on shipped world + landmark assets (IDOK-28)."""

import argparse
from collections import defaultdict
from functools import lru_cache
import gzip
import io
import json
import math
import os
from pathlib import Path
import re
import struct

import numpy as np
from PIL import Image, ImageColor
from shapely import box as box_array, prepare, STRtree, build_area, contains_xy, union_all
from shapely.geometry import LineString, Point, Polygon, box
from shapely.ops import nearest_points, polygonize, unary_union
from landmark_solids import load_landmark_meshes, structural_footprint, slice_tris_at_y, solid_projection

from landmarks.jiefang_layout import SPAN_WAYS, world_road_sections
from common import CHUNK, GRID, OUT, load_osm, xz2ll
from features import area, points, polygons
from road_profile import RULES


def read_tile_metres(root: Path) -> dict[str, float]:
    tiles_ts = (root / 'web/src/look/tiles.ts').read_text()
    match = re.search(r'metres:\s*\{([^}]+)\}', tiles_ts)
    if not match:
        return {'wall': 4.0, 'roof': 4.0, 'road': 6.0, 'sidewalk': 2.0, 'bank': 3.0}
    out = {}
    for pair in match.group(1).split(','):
        if ':' in pair:
            k, v = pair.split(':', 1)
            out[k.strip()] = float(v.strip())
    return out


def uv_stretch_ratio(p0: np.ndarray, p1: np.ndarray, p2: np.ndarray,
                     uv0: np.ndarray, uv1: np.ndarray, uv2: np.ndarray) -> float | None:
    """Return max(sigma_max, 1 / sigma_min) of mapping 3D metres -> UV-target metres."""
    e1 = p1 - p0
    e2 = p2 - p0
    l1 = float(np.linalg.norm(e1))
    if l1 < 1e-4:
        return None
    t1 = e1 / l1
    n = np.cross(e1, e2)
    area2 = float(np.linalg.norm(n))
    if area2 < 0.02:  # skip microscopic sliver triangles < 0.01 m^2
        return None
    n /= area2
    t2 = np.cross(n, t1)
    x1 = np.array([l1, 0.0])
    x2 = np.array([float(np.dot(e2, t1)), float(np.dot(e2, t2))])
    X = np.column_stack([x1, x2])
    det = float(np.linalg.det(X))
    if abs(det) < 1e-6:
        return None
    U = np.column_stack([uv1 - uv0, uv2 - uv0])
    J = U @ np.linalg.inv(X)
    s = np.linalg.svd(J, compute_uv=False)
    s_max = float(s[0])
    s_min = float(s[1])
    if s_min < 1e-6:
        return 999.0
    return max(s_max, 1.0 / s_min)


def make_issue(subtype: str, x: float, z: float, value: float, detail: str = '', **extra) -> dict:
    lat, lon = xz2ll(x, z)
    rec = {
        'subtype': subtype,
        'x': round(float(x), 2),
        'z': round(float(z), 2),
        'lat': round(float(lat), 6),
        'lon': round(float(lon), 6),
        'value': round(float(value), 4),
    }
    if detail:
        rec['detail'] = detail
    rec.update(extra)
    return rec


def apply_landmark_exceptions(rules, *categories):
    limits = {(rule['id'], rule['subtype']): rule for rule in rules}
    allowed = []
    hits = defaultdict(int)
    for findings in categories:
        remaining = []
        for issue in findings:
            identity = '+'.join(sorted(issue.get('landmarks', [issue.get('landmark', '')])))
            key = identity, issue['subtype']
            rule = limits.get(key)
            if rule and issue['value'] <= rule['maxArea'] and hits[key] < rule['maxCount']:
                hits[key] += 1
                allowed.append({**issue, 'reason': rule['reason']})
            else:
                remaining.append(issue)
        findings[:] = remaining
    return allowed


def run_audit(world_dir: Path, root: Path) -> dict:
    manifest = json.loads((world_dir / 'manifest.json').read_text())
    left, top, width, depth = manifest['extent']
    bounds = box(left, top, left + width, top + depth)
    gw, gh = width // GRID + 1, depth // GRID + 1
    nx_chunks, nz_chunks = width // CHUNK, depth // CHUNK

    terrain_dm = np.zeros((gh, gw), dtype=np.int16)
    water_dm = np.full((gh, gw), -32768, dtype=np.int16)
    underlay_dm = np.zeros((gh, gw), dtype=np.int16)

    # Rendered ground mesh per chunk (65x65 on wet chunks, 33x33 on dry chunks), matching web/src/world.ts detail()
    chunk_step = np.full((nz_chunks, nx_chunks), 8, dtype=np.int32)
    ground_65 = np.zeros((nz_chunks, nx_chunks, 65, 65), dtype=np.float64)

    by_bldg = defaultdict(list)
    bldg_chunk_parts = []
    roads0_polys, roads1_polys, roads2_polys, cycle_polys = [], [], [], []
    street_topology_issues = []
    chunk_streets = {}
    lamps, signals, stops, banks, stone_rails = [], [], [], [], []
    deck_tris_by_chunk = {}
    all_deck_tris = []
    trees = []

    for tile in manifest['chunks']:
        tx, tz = tile['x'], tile['z']
        ci, cj = (tx - left) // CHUNK, (tz - top) // CHUNK
        blob = gzip.decompress((world_dir / tile['file']).read_bytes())
        v_cnt, i_cnt, c_size, p_size, b_tri = struct.unpack_from('<5I', blob, 4)
        r0, c0 = (tz - top) // GRID, (tx - left) // GRID
        t_arr, w_arr = np.frombuffer(blob, '<i2', 8450, 24).reshape(2, 65, 65)
        terrain_dm[r0:r0 + 65, c0:c0 + 65] = t_arr
        water_dm[r0:r0 + 65, c0:c0 + 65] = w_arr
        v_off = 24 + 16900
        n_off = v_off + v_cnt * 6
        idx_off = n_off + v_cnt * 3
        c_off = idx_off + i_cnt * 4
        p_off = c_off + c_size
        d_off = p_off + p_size
        tail = d_off + b_tri * 18
        u_arr = np.frombuffer(blob, '<i2', 4225, tail).reshape(65, 65) if tail < len(blob) else t_arr
        underlay_dm[r0:r0 + 65, c0:c0 + 65] = u_arr

        # Exact groundMesh vertex heights for this chunk (matching web/src/world.ts)
        has_water = bool((w_arr != -32768).any())
        step = 4 if has_water else 8
        chunk_step[cj, ci] = step
        segs = 256 // step
        wet_edges = (
            bool((w_arr[:, 0] != -32768).any()),
            bool((w_arr[:, 64] != -32768).any()),
            bool((w_arr[0, :] != -32768).any()),
            bool((w_arr[64, :] != -32768).any()),
        )
        ut = u_arr.astype(np.float64) / 10.0
        g_tile = ground_65[cj, ci]
        for line in range(segs + 1):
            row = line * step // 4
            for column in range(segs + 1):
                col = column * step // 4
                if (col == 0 and not wet_edges[0]) or (col == 64 and not wet_edges[1]):
                    r_base = row & ~7
                    r_next = min(64, r_base + 8)
                    t_frac = (row % 8) / 8.0
                    y = ut[r_base, col] * (1.0 - t_frac) + ut[r_next, col] * t_frac
                elif (row == 0 and not wet_edges[2]) or (row == 64 and not wet_edges[3]):
                    c_base = col & ~7
                    c_next = min(64, c_base + 8)
                    t_frac = (col % 8) / 8.0
                    y = ut[row, c_base] * (1.0 - t_frac) + ut[row, c_next] * t_frac
                else:
                    y = ut[row, col]
                g_tile[line, column] = y

        b_pos = np.frombuffer(blob, '<i2', v_cnt * 3, v_off).reshape(-1, 3) if v_cnt else np.zeros((0, 3))
        b_idx = np.frombuffer(blob, '<u4', i_cnt, idx_off).reshape(-1, 3) if i_cnt else np.zeros((0, 3), dtype=np.uint32)
        rings, streets, *_ = json.loads(blob[c_off:c_off + c_size])
        chunk_streets[(ci, cj)] = (tx, tz, streets, rings, b_pos, b_idx)

        for base, roof, loops, kind, floors, seed, *_ in rings:
            pts = [np.asarray(lp, dtype=float) / 100.0 + [tx, tz] for lp in loops]
            if len(pts[0]) >= 3:
                poly = Polygon(pts[0], pts[1:]).buffer(0)
                if not poly.is_empty:
                    by_bldg[(seed, base, roof)].append(poly)
                    bldg_chunk_parts.append((tx, tz, base / 10.0, roof / 10.0, kind, floors, loops, poly))

        for path_index, (skind, *loops) in enumerate(streets[0]):
            if any(len(loop) < 3 for loop in loops) or not loops:
                street_topology_issues.append(make_issue('invalidStreetPolygon', tx, tz, 1,
                                                        f'chunk({tx},{tz}).paths[{path_index}] short ring'))
                continue
            pts = [np.asarray(lp, dtype=float) / 100.0 + [tx, tz] for lp in loops]
            if not Polygon(loops[0], loops[1:]).is_valid:
                street_topology_issues.append(make_issue('invalidStreetPolygon', *pts[0][0], 1,
                                                        f'chunk({tx},{tz}).paths[{path_index}] kind {skind}'))
            poly = Polygon(pts[0], pts[1:]).buffer(0)
            if poly.is_empty:
                continue
            if skind == 0:
                roads0_polys.append(poly)
            elif skind in (1, 4, 6):
                roads1_polys.append(poly)
            elif skind == 5:
                cycle_polys.append(poly)
            elif skind == 2:
                roads2_polys.append(poly)

        for lx, lz in streets[1]:
            lamps.append((tx + lx / 10.0, tz + lz / 10.0))
        for ax, az, bx, bz, btop, bbot, *end in streets[2]:
            banks.append((tx + ax / 10.0, tz + az / 10.0, tx + bx / 10.0, tz + bz / 10.0, btop / 10.0, bbot / 10.0, (end[0] if end else btop) / 10.0))
        if len(streets) > 3:
            for sx, sz in streets[3]:
                signals.append((tx + sx / 10.0, tz + sz / 10.0))
        if len(streets) > 4:
            for bx, bz in streets[4]:
                stops.append((tx + bx / 10.0, tz + bz / 10.0))
        if len(streets) > 6 and streets[6]:
            for ax, az, bx, bz in streets[6]:
                stone_rails.append((tx + ax / 10.0, tz + az / 10.0, tx + bx / 10.0, tz + bz / 10.0))

        if b_tri:
            d = np.frombuffer(blob, '<i2', b_tri * 9, d_off).reshape(-1, 3, 3).astype(np.float64)
            d[:, :, 0] = d[:, :, 0] / 100.0 + tx
            d[:, :, 1] = d[:, :, 1] / 100.0
            d[:, :, 2] = d[:, :, 2] / 100.0 + tz
            deck_tris_by_chunk[(ci, cj)] = d
            all_deck_tris.append(d)

        t_file = world_dir / tile['file'].replace('.glc', '.trees')
        if t_file.exists():
            tblob = gzip.decompress(t_file.read_bytes())
            for off in range(0, len(tblob), 12):
                lx, lz, ly, tkind, tscale, *_ = struct.unpack_from('<HHhBBBBbb', tblob, off)
                trees.append((tx + lx / 100.0, ly / 10.0, tz + lz / 100.0, tkind, tscale / 100.0))

    def ground_mesh_y(x: float, z: float) -> float:
        ci = int(np.clip(math.floor((x - left) / CHUNK), 0, nx_chunks - 1))
        cj = int(np.clip(math.floor((z - top) / CHUNK), 0, nz_chunks - 1))
        step = int(chunk_step[cj, ci])
        segs = 256 // step
        lx = np.clip(x - (left + ci * CHUNK), 0.0, 256.0)
        lz = np.clip(z - (top + cj * CHUNK), 0.0, 256.0)
        col = min(segs - 1, max(0, int(math.floor(lx / step))))
        row = min(segs - 1, max(0, int(math.floor(lz / step))))
        u = lx / step - col
        v = lz / step - row
        g = ground_65[cj, ci]
        a, b, c, d = g[row, col], g[row, col + 1], g[row + 1, col], g[row + 1, col + 1]
        return float(a + (b - a) * u + (c - a) * v if u + v <= 1.0 else d + (c - d) * (1.0 - u) + (b - d) * (1.0 - v))

    def terrain_4m_y(x: float, z: float) -> float:
        r = int(np.clip(round((z - top) / GRID), 0, gh - 1))
        c = int(np.clip(round((x - left) / GRID), 0, gw - 1))
        return float(terrain_dm[r, c]) / 10.0

    def is_wet(x: float, z: float) -> bool:
        r = int(np.clip(round((z - top) / GRID), 0, gh - 1))
        c = int(np.clip(round((x - left) / GRID), 0, gw - 1))
        return bool(water_dm[r, c] != -32768)

    raw_deck_tris = np.concatenate(all_deck_tris, axis=0) if all_deck_tris else np.zeros((0, 3, 3))
    valid_deck_tris = []
    deck_polys = []
    for t in raw_deck_tris:
        p = Polygon(t[:, [0, 2]])
        if p.is_valid and p.area > 1e-4:
            valid_deck_tris.append(t)
            deck_polys.append(p.buffer(0))
    deck_tris = np.asarray(valid_deck_tris) if valid_deck_tris else np.zeros((0, 3, 3))
    deck_tree = STRtree(deck_polys) if deck_polys else None

    def deck_y_at(x: float, z: float, tol: float = 0.0) -> float | None:
        if not deck_tree:
            return None
        pt = Point(x, z)
        query_geom = pt.buffer(tol) if tol > 0 else pt
        best = None
        for idx in deck_tree.query(query_geom, predicate='intersects'):
            tri = deck_tris[idx]
            qx, qz = x, z
            if tol > 0 and not deck_polys[idx].contains(pt):
                np_pt = nearest_points(pt, deck_polys[idx])[1]
                qx, qz = np_pt.x, np_pt.y
            x0, z0 = tri[0, 0], tri[0, 2]
            dx1, dz1 = tri[1, 0] - x0, tri[1, 2] - z0
            dx2, dz2 = tri[2, 0] - x0, tri[2, 2] - z0
            det = dx1 * dz2 - dx2 * dz1
            if abs(det) < 1e-8:
                continue
            w1 = ((qx - x0) * dz2 - (qz - z0) * dx2) / det
            w2 = (dx1 * (qz - z0) - dz1 * (qx - x0)) / det
            margin = 0.05 if tol > 0 else 1e-3
            if w1 >= -margin and w2 >= -margin and w1 + w2 <= 1.0 + margin:
                y = float(tri[0, 1] + w1 * (tri[1, 1] - tri[0, 1]) + w2 * (tri[2, 1] - tri[0, 1]))
                if best is None or y > best:
                    best = y
        return best

    u_road0 = unary_union(roads0_polys) if roads0_polys else Polygon()
    u_deck = unary_union(deck_polys) if deck_polys else Polygon()
    u_cycle = unary_union(cycle_polys) if cycle_polys else Polygon()
    u_carriageway = unary_union([u_road0, u_deck, u_cycle])
    u_sidewalk = unary_union(roads1_polys) if roads1_polys else Polygon()
    u_all_road_surface = unary_union([u_carriageway, u_sidewalk])

    for geom in (u_carriageway,u_sidewalk,u_all_road_surface):
        prepare(geom)

    # Load landmarks
    landmarks = load_landmark_meshes(root, manifest)

    # Build landmark walkable surfaces (for bridgeJointStep & roadGap on landmark bridges/streets)
    lm_walk_tris = []
    lm_walk_polys = []
    for lid, ldata in landmarks.items():
        ctris = ldata['coll_tris']
        cnorms = ldata['coll_normals']
        if len(ctris):
            walk_mask = np.abs(cnorms[:, 1]) >= (0.35 if lid in ('ronghu', 'huaqiao', 'jiefang_bridge') else 0.72)
            for tri in ctris[walk_mask]:
                p2 = Polygon(tri[:, [0, 2]])
                if p2.is_valid and p2.area > 1e-3:
                    lm_walk_tris.append(tri)
                    lm_walk_polys.append(p2.buffer(0))
    lm_walk_tris_arr = np.asarray(lm_walk_tris) if lm_walk_tris else np.zeros((0, 3, 3))
    lm_walk_tree = STRtree(lm_walk_polys) if lm_walk_polys else None
    # Projected edges of adjacent packed triangles can differ below GL04 precision.
    # Snap the coverage union to a millimetre; height queries still use the original triangles.
    u_lm_walk = union_all(lm_walk_polys, grid_size=.001) if lm_walk_polys else Polygon()

    def lm_walk_y_at(x: float, z: float, ref_y: float | None = None) -> float | None:
        if not lm_walk_tree:
            return None
        pt = Point(x, z)
        candidates = []
        for idx in lm_walk_tree.query(pt, predicate='intersects'):
            tri = lm_walk_tris_arr[idx]
            x0, z0 = tri[0, 0], tri[0, 2]
            dx1, dz1 = tri[1, 0] - x0, tri[1, 2] - z0
            dx2, dz2 = tri[2, 0] - x0, tri[2, 2] - z0
            det = dx1 * dz2 - dx2 * dz1
            if abs(det) < 1e-8:
                continue
            w1 = ((x - x0) * dz2 - (z - z0) * dx2) / det
            w2 = (dx1 * (z - z0) - dz1 * (x - x0)) / det
            if w1 >= -1e-3 and w2 >= -1e-3 and w1 + w2 <= 1.001:
                y = float(tri[0, 1] + w1 * (tri[1, 1] - tri[0, 1]) + w2 * (tri[2, 1] - tri[0, 1]))
                candidates.append(y)
        if not candidates:
            return None
        if ref_y is not None:
            return min(candidates, key=lambda v: abs(v - ref_y))
        return max(candidates)

    # Load PK02 near-LOD peak meshes for mountain tree & peak landmark / invisible collider checks
    pk_blob = gzip.decompress((world_dir / manifest['peaks']['file']).read_bytes())
    peak_tris_list = []
    peak_polys_list = []
    peak_summits = {}
    for pentry in manifest['peaks']['entries']:
        peak_summits[pentry['name']] = pentry['center']
        if not pentry.get('lods'):
            continue
        lod0 = pentry['lods'][0]
        vcnt, off = lod0['vertices'], lod0['offset']
        p_pos = np.frombuffer(pk_blob, '<i2', vcnt * 3, off).reshape(-1, 3) / 100.0 + pentry['center']
        p_idx = np.frombuffer(pk_blob, '<u2', lod0['indices'], lod0['indexOffset']).reshape(-1, 3)
        ptris = p_pos[p_idx]
        peak_tris_list.append(ptris)
        ring0 = p_pos[:128, [0, 2]]
        peak_polys_list.append(Polygon(ring0).buffer(0))
    all_peak_tris = np.concatenate(peak_tris_list, axis=0) if peak_tris_list else np.zeros((0, 3, 3))
    if len(all_peak_tris):
        minima = all_peak_tris.min(axis=1)
        maxima = all_peak_tris.max(axis=1)
        peak_tri_tree = STRtree(box_array(minima[:,0],minima[:,2],maxima[:,0],maxima[:,2]))
    else:
        peak_tri_tree = None

    def nearest_peak_y(x: float, y: float, z: float) -> float | None:
        if not peak_tri_tree:
            return None
        pt = Point(x, z)
        best_y = None
        best_err = 1e9
        for idx in peak_tri_tree.query(pt.buffer(0.85), predicate='intersects'):
            tri = all_peak_tris[idx]
            # Check vertical projection or closest triangle height within 0.85m (karst.py shifts inward by 0.3*normal)
            ymin_t, ymax_t = float(tri[:, 1].min()), float(tri[:, 1].max())
            cand_y = float(np.clip(y + 0.25, ymin_t, ymax_t))
            err = abs(y - (cand_y - 0.25))
            if err < best_err:
                best_err = err
                best_y = cand_y - 0.25
        return best_y

    # =========================================================================
    # 1. 楼压路 (buildingOnRoad)
    # =========================================================================
    bldg_issues = []
    proc_bldg_polys = []
    for (seed, base, roof), parts in by_bldg.items():
        poly = unary_union(parts).buffer(0)
        if poly.is_empty:
            continue
        proc_bldg_polys.append(poly)
        inter_road = poly.intersection(u_carriageway) if u_carriageway.intersects(poly) else Polygon()
        if inter_road.area > 0.5:
            rp = inter_road.representative_point()
            bldg_issues.append(make_issue('proceduralOnCarriageway', rp.x, rp.y, inter_road.area,
                                          f'procedural building seed={seed} overlaps carriageway {inter_road.area:.1f} m²'))
        inter_sw = poly.intersection(u_sidewalk) if u_sidewalk.intersects(poly) else Polygon()
        if inter_sw.area > 0.5:
            rp = inter_sw.representative_point()
            bldg_issues.append(make_issue('proceduralOnSidewalk', rp.x, rp.y, inter_sw.area,
                                          f'procedural building seed={seed} overlaps sidewalk {inter_sw.area:.1f} m²'))

    lm_block_footprints = {}
    for lid, ldata in landmarks.items():
        ctris = ldata['coll_tris']
        cnorms = ldata['coll_normals']
        if not len(ctris):
            continue
        steep = ctris[np.abs(cnorms[:, 1]) < 0.72]
        if not len(steep):
            continue
        # Skip low bridge curb/railing slabs over water for bridge landmarks where road passes over deck
        if lid in ('jiefang_bridge', 'huaqiao'):
            # Only keep walls blocking the carriageway deck itself (check relative to local deck height)
            pass
        cx = np.clip(np.rint((steep[:, :, 0].mean(axis=1) - left) / GRID).astype(int), 0, gw - 1)
        cz = np.clip(np.rint((steep[:, :, 2].mean(axis=1) - top) / GRID).astype(int), 0, gh - 1)
        rel = steep.copy()
        rel[:, :, 1] -= (terrain_dm[cz, cx] / 10.0)[:, None]
        foot = unary_union([slice_tris_at_y(rel, 0.6), slice_tris_at_y(rel, 1.2)]).buffer(0)
        lm_block_footprints[lid] = foot
        if foot.is_empty:
            continue
        inter_r = foot.intersection(u_road0)
        if inter_r.area > 0.5:
            rp = inter_r.representative_point()
            bldg_issues.append(make_issue('landmarkOnCarriageway', rp.x, rp.y, inter_r.area,
                                          f'landmark {lid} collision* overlaps carriageway {inter_r.area:.1f} m²', landmark=lid))
        inter_s = foot.intersection(u_sidewalk)
        if inter_s.area > 0.5:
            rp = inter_s.representative_point()
            bldg_issues.append(make_issue('landmarkOnSidewalk', rp.x, rp.y, inter_s.area,
                                          f'landmark {lid} collision* overlaps sidewalk {inter_s.area:.1f} m²', landmark=lid))

    bldg_issues.sort(key=lambda r: r['value'], reverse=True)

    # =========================================================================
    # 2. 路面不平 (unevenRoad) & road list for 路面缺口
    # =========================================================================
    landmarks_cfg = json.loads((root / 'pipeline/landmarks.json').read_text())
    replaced_ways = set()
    landmark_polygons = []
    for entry in landmarks_cfg:
        rep = entry.get('replace', [])
        if isinstance(rep, list):
            replaced_ways.update(k for k in rep if isinstance(k, str))
        elif isinstance(rep, dict) and 'polygon' in rep:
            from common import ll2xz
            landmark_polygons.append(Polygon([ll2xz(lat, lon) for lon, lat in rep['polygon']]).buffer(0))
    u_lm_replace_poly = unary_union(landmark_polygons).buffer(1.1) if landmark_polygons else Polygon()
    u_surface_check = unary_union([u_all_road_surface, u_lm_walk])
    prepare(u_surface_check)

    # A pedestrian plaza can also be paved directly on the walkable GL04
    # terrain. Verify the emitted texels across its interior if vector
    # coverage is missing. Grass or bare ground still fails the audit.
    tile_files = {(t['x'],t['z']): t['file'] for t in manifest['chunks']}
    road_color = ImageColor.getrgb(json.loads((root/'pipeline/palette.json').read_text())['road'])

    @lru_cache(maxsize=8)
    def ground_texture(origin):
        raw = gzip.decompress((world_dir/tile_files[origin]).read_bytes())
        vertices,indices,collision,size = struct.unpack_from('<4I',raw,4)
        start = 24+16900+vertices*9+indices*4+collision
        return Image.open(io.BytesIO(raw[start:start+size])).convert('RGB')

    def has_ground_paving(plaza):
        # One texel is one metre. At edges the raster contains mixed coverage.
        interior = plaza.buffer(-.75)
        if interior.is_empty:
            return False
        xmin,zmin,xmax,zmax = interior.bounds
        count = 0
        for z in range(math.floor(zmin),math.ceil(zmax)):
            for x in range(math.floor(xmin),math.ceil(xmax)):
                point = Point(x+.5,z+.5)
                if not interior.covers(point) or u_surface_check.covers(point):
                    continue
                origin = (x//CHUNK*CHUNK,z//CHUNK*CHUNK)
                if ground_texture(origin).getpixel((x-origin[0],z-origin[1])) != road_color:
                    return False
                count += 1
        return count>0

    uneven_issues = []
    gap_issues = []
    road_Elements = []
    for el in load_osm():
        tags = el.get('tags', {})
        if el['type'] != 'way' or 'highway' not in tags or tags.get('tunnel', 'no') != 'no':
            continue
        hw = tags['highway']
        if hw not in RULES['defaultWidth']:
            continue
        if hw == 'pedestrian' and tags.get('area') == 'yes':
            poly_a = area(el).intersection(bounds.buffer(-2.0))
            if not poly_a.is_empty and not u_lm_replace_poly.contains(poly_a.representative_point()):
                rp = poly_a.representative_point()
                if not u_surface_check.intersects(rp.buffer(1.0)) and not has_ground_paving(poly_a):
                    gap_issues.append(make_issue('roadGap', rp.x, rp.y, 1.0,
                                                 f'way/{el["id"]} pedestrian plaza missing surface', way=el['id']))
            continue
        coords = points(el)
        if len(coords) < 2:
            continue
        full_line = LineString(coords)
        if el['id']==682893309: east_axis=full_line
        if not bounds.intersects(full_line):
            continue
        is_bridge = tags.get('bridge', 'no') != 'no'
        m_w = re.fullmatch(r'(\d+(?:\.\d+)?)\s*(?:m)?', tags.get('width', '').strip())
        w_est = float(m_w[1]) if m_w else float(RULES['defaultWidth'].get(hw, 8.0))
        clipped = full_line.intersection(bounds.buffer(-2.0))
        if hw == 'pedestrian' and not u_lm_replace_poly.is_empty:
            clipped = clipped.difference(u_lm_replace_poly)
        for seg in getattr(clipped, 'geoms', [clipped]):
            if seg.is_empty or seg.geom_type != 'LineString' or seg.length < 4.0:
                continue
            road_Elements.append((el['id'], tags.get('name', ''), hw, is_bridge, w_est, seg))

    def road_ctrl_y(x: float, z: float) -> float | None:
        ci = int(np.clip(math.floor((x - left) / CHUNK), 0, nx_chunks - 1))
        cj = int(np.clip(math.floor((z - top) / CHUNK), 0, nz_chunks - 1))
        entry_cs = chunk_streets.get((ci, cj))
        if not entry_cs:
            return None
        tx, tz, streets, *_ = entry_cs
        if len(streets) < 6 or not streets[5]:
            return None
        base_mm, deltas = streets[5]
        lx = np.clip(x - tx, 0.0, 256.0)
        lz = np.clip(z - tz, 0.0, 256.0)
        u = lx / 8.0 + 1.0
        v = lz / 8.0 + 1.0
        ic = min(32, max(1, int(math.floor(u))))
        ir = min(32, max(1, int(math.floor(v))))
        tu = min(1.0, max(0.0, u - ic))
        tv = min(1.0, max(0.0, v - ir))
        omu, omv = 1.0 - tu, 1.0 - tv
        wu = (omu ** 3 / 6.0, (3 * tu ** 3 - 6 * tu ** 2 + 4) / 6.0, (-3 * tu ** 3 + 3 * tu ** 2 + 3 * tu + 1) / 6.0, tu ** 3 / 6.0)
        wv = (omv ** 3 / 6.0, (3 * tv ** 3 - 6 * tv ** 2 + 4) / 6.0, (-3 * tv ** 3 + 3 * tv ** 2 + 3 * tv + 1) / 6.0, tv ** 3 / 6.0)
        total = 0.0
        for dr in range(4):
            roff = (ir - 1 + dr) * 35
            wr = wv[dr]
            for dc in range(4):
                total += wr * wu[dc] * deltas[roff + ic - 1 + dc]
        return (base_mm + total) / 1000.0

    def road_base_y(x: float, z: float) -> float:
        g = ground_mesh_y(x, z)
        rc = road_ctrl_y(x, z)
        return max(rc, g) if rc is not None else g

    interchange = {}
    if 'jiefang_bridge' in landmarks:
        bridge = landmarks['jiefang_bridge']['entry']
        bx, datum, bz = bridge['position']
        for way, line, stations, levels, left_edge, right_edge in world_road_sections(
                (bx, bz), -np.deg2rad(bridge['rotation'])):
            pavement = Polygon(np.vstack([left_edge, right_edge[::-1]])).buffer(.025)
            interchange[way] = line, stations, datum + levels, pavement, left_edge, right_edge

    def road_surface_y(x: float, z: float, is_bridge: bool, way_id: int) -> float:
        if way_id==682893309 and 'jiefang_bridge' in landmarks:
            from east_grading import STATIONS, LEVELS, cut_weight
            station=east_axis.project(Point(x,z)); weight=cut_weight(station)
            return (1-weight)*road_base_y(x,z)+weight*(np.interp(station,STATIONS,LEVELS)+.025)+.045
        if way_id in interchange:
            line, stations, levels, pavement, _, _ = interchange[way_id]
            point = Point(x, z)
            if pavement.covers(point):
                ref = np.interp(line.project(point), stations, levels)
                modeled = lm_walk_y_at(x, z, ref)
                if modeled is not None:
                    return modeled
        if is_bridge:
            if f'way/{way_id}' in replaced_ways:
                ly = lm_walk_y_at(x, z)
                if ly is not None:
                    return ly
            dy = deck_y_at(x, z, tol=0.45)
            if way_id in SPAN_WAYS:
                # The upper road is jointly supplied by GL04 and the landmark.
                modeled = lm_walk_y_at(x, z)
                if modeled is not None:
                    return max(dy, modeled) if dy is not None else modeled
            if dy is not None:
                return dy
        return road_base_y(x, z) + 0.045

    for way_id, name, hw, is_bridge, width_m, seg in road_Elements:
        length = seg.length
        n_pts = max(2, int(math.floor(length / 2.0)) + 1)
        dists = np.linspace(0.0, length, n_pts)
        hs = np.zeros(n_pts, dtype=np.float64)
        xs = np.zeros(n_pts, dtype=np.float64)
        zs = np.zeros(n_pts, dtype=np.float64)
        half_span = max(1.0, 0.45 * width_m)

        for i, s in enumerate(dists):
            pt = seg.interpolate(s)
            xs[i], zs[i] = pt.x, pt.y
            hs[i] = road_surface_y(pt.x, pt.y, is_bridge, way_id)

            # Cross-tilt check (skip bridge/landmark transitions within 2m of ends)
            p_prev = seg.interpolate(max(0.0, s - 0.5))
            p_next = seg.interpolate(min(length, s + 0.5))
            tx_d, tz_d = p_next.x - p_prev.x, p_next.y - p_prev.y
            t_len = math.hypot(tx_d, tz_d)
            if t_len > 1e-4 and not is_bridge:
                nx_d, nz_d = -tz_d / t_len, tx_d / t_len
                lx, lz = pt.x - nx_d * half_span, pt.y - nz_d * half_span
                rx, rz = pt.x + nx_d * half_span, pt.y + nz_d * half_span
                span = 2.0 * half_span
                if way_id in interchange:
                    line, stations, _, pavement, left_edge, right_edge = interchange[way_id]
                    if pavement.covers(pt):
                        # Paired one-way ramps have asymmetric lanes. Sample across
                        # this carriageway rather than across its inner retaining wall.
                        station = line.project(pt)
                        left_pt, right_pt = (np.array([np.interp(station, stations, axis) for axis in edge.T])
                                             for edge in (left_edge, right_edge))
                        lx, lz = .95 * left_pt + .05 * right_pt
                        rx, rz = .05 * left_pt + .95 * right_pt
                        span = math.hypot(rx - lx, rz - lz)
                if bounds.contains(Point(lx, lz)) and bounds.contains(Point(rx, rz)):
                    hl = road_surface_y(lx, lz, False, way_id)
                    hr = road_surface_y(rx, rz, False, way_id)
                    tilt = abs(hr - hl) / span
                    if tilt > 0.03:
                        uneven_issues.append(make_issue('crossTilt', pt.x, pt.y, tilt,
                                                        f'way/{way_id} {name or hw} cross-tilt {tilt*100:.1f}% (>3%)', way=way_id))

            # Road gap check (1m radius around centerline must have road/bridge/landmark surface)
            if not (hw == 'pedestrian' and u_lm_replace_poly.contains(pt)):
                if not u_surface_check.intersects(pt.buffer(1.0)):
                    gap_issues.append(make_issue('roadGap', pt.x, pt.y, 1.0,
                                                 f'way/{way_id} {name or hw} missing road mesh within 1m', way=way_id))

        # Grade jump (> 4% between adjacent 2m segments)
        if n_pts >= 3:
            ds = np.diff(dists)
            grades = np.diff(hs) / np.maximum(ds, 1e-3)
            jumps = np.abs(np.diff(grades))
            for i, jmp in enumerate(jumps, start=1):
                if jmp > 0.04:
                    uneven_issues.append(make_issue('gradeJump', xs[i], zs[i], float(jmp),
                                                    f'way/{way_id} {name or hw} grade jump {jmp*100:.1f}% (>4%)', way=way_id))

        # Local bump (> 0.15m from symmetric 20m sliding average)
        for i in range(n_pts):
            k = min(i, n_pts - 1 - i, 5)
            if k >= 1:
                avg20 = float(np.mean(hs[i - k:i + k + 1]))
                bump = abs(float(hs[i]) - avg20)
                if bump > 0.15:
                    uneven_issues.append(make_issue('localBump', xs[i], zs[i], bump,
                                                    f'way/{way_id} {name or hw} local bump {bump:.3f} m (>0.15m)', way=way_id))

    uneven_issues.sort(key=lambda r: r['value'], reverse=True)

    # =========================================================================
    # 3. 贴图异常 (textureIssue)
    #    Note: zFighting, downwardNormal, uvStretch on live triangulated street
    #    and building meshes are ALSO checked in browser; here we check pipeline
    #    groundMesh 8m grid convexity vs street polygons, KTX2 files, deck normals,
    #    bank & wall UV stretch, and roadGap.
    # =========================================================================
    texture_issues = list(gap_issues)
    for x, z, overlap in json.loads((world_dir / 'marking-audit.json').read_text()):
        texture_issues.append(make_issue('markingOverlap', x, z, overlap, 'Marking overlap before tile union'))
    metres_cfg = read_tile_metres(root)

    # 3a. KTX2 files check (header, budget, non-placeholder check)
    tex_dir = root / 'public/textures'
    expected_ktx = ('wall', 'roof', 'road', 'sidewalk', 'bank')
    total_ktx_bytes = 0
    for ch in expected_ktx:
        kf = tex_dir / f'{ch}.ktx2'
        if not kf.exists():
            texture_issues.append(make_issue('ktx2Failure', 0.0, 0.0, 1.0, f'Missing {ch}.ktx2'))
            continue
        raw_b = kf.read_bytes()
        total_ktx_bytes += len(raw_b)
        if not raw_b.startswith(b'\xabKTX 20'):
            texture_issues.append(make_issue('ktx2Failure', 0.0, 0.0, 1.0, f'Invalid KTX2 magic in {ch}.ktx2'))
            continue
        kw, kh = struct.unpack_from('<II', raw_b, 20)
        if len(raw_b) <= 512 or kw <= 8 or kh <= 8:
            texture_issues.append(make_issue('ktx2Failure', 0.0, 0.0, 1.0,
                                             f'{ch}.ktx2 is an {kw}x{kh} ({len(raw_b)}B) solid-color placeholder'))
    if total_ktx_bytes > 1_500_000:
        texture_issues.append(make_issue('ktx2Failure', 0.0, 0.0, total_ktx_bytes / 1e6,
                                         f'KTX2 total bytes {total_ktx_bytes} > 1.5MB'))

    # 3b. Bridge deck downward normal check
    for tri in deck_tris:
        e1 = tri[1] - tri[0]
        e2 = tri[2] - tri[0]
        n = np.cross(e1, e2)
        nlen = float(np.linalg.norm(n))
        if nlen > 1e-5 and n[1] / nlen <= 0.0:
            c_pt = tri.mean(axis=0)
            texture_issues.append(make_issue('downwardNormal', c_pt[0], c_pt[2], float(-n[1] / nlen),
                                             'Bridge deck triangle has downward normal'))

    # 3c. Bank wall UV stretch check against current tiles.ts shader formula
    tiles_ts_src = (root / 'web/src/look/tiles.ts').read_text()
    uses_x_plus_z_bank = 'vFogWorld.x+vFogWorld.z' in tiles_ts_src.replace(' ', '')
    if uses_x_plus_z_bank:
        for ax, az, bx, bz, btop, bbot, end_top in banks:
            seg_len = math.hypot(bx - ax, bz - az)
            if seg_len < 0.2 or btop - bbot < 0.2:
                continue
            du = abs((bx + bz) - (ax + az)) / seg_len
            if du < 0.5 or du > 2.0:
                ratio = 999.0 if du < 1e-4 else max(du, 1.0 / du)
                texture_issues.append(make_issue('uvStretch', (ax + bx) / 2, (az + bz) / 2, ratio,
                                                 f'Bank wall world-UV (x+z) density ratio={du:.2f}x deviates >2x'))

    # Check steep road/sidewalk slopes (>60 deg -> cos < 0.5 -> xz UV stretches >2x)
    for ci in range(nx_chunks):
        for cj in range(nz_chunks):
            if (ci, cj) not in chunk_streets:
                continue
            tx, tz, streets, *_ = chunk_streets[(ci, cj)]
            if not streets[0]:
                continue
            step = int(chunk_step[cj, ci])
            segs = 256 // step
            centers = (np.arange(segs)+.5)*step
            street_cells = contains_xy(u_all_road_surface,tx+centers,tz+centers[:,None])
            for row,col in zip(*np.nonzero(street_cells)):
                x0_s, z0_s = tx + int(col) * step, tz + int(row) * step
                cx, cz = x0_s + step * .5, z0_s + step * .5
                y00 = road_base_y(x0_s, z0_s)
                dz_dx = (road_base_y(x0_s + step, z0_s) - y00) / step
                dz_dy = (road_base_y(x0_s, z0_s + step) - y00) / step
                cos_slope = 1.0 / math.sqrt(1.0 + dz_dx ** 2 + dz_dy ** 2)
                if cos_slope < 0.5:
                    texture_issues.append(make_issue('uvStretch', cx, cz, 1.0 / cos_slope,
                                                     f'Steep road slope foreshortens xz UV by {1.0/cos_slope:.2f}x (>2x)'))

    texture_issues.sort(key=lambda r: r['value'], reverse=True)

    # =========================================================================
    # 4. 其他基本问题 (otherBasic)
    # =========================================================================

    other_issues = street_topology_issues

    # 4a. Props on carriageway (trees, lamps, railings, traffic_signals, bus_stops, stone_rails)
    if trees:
        txs = np.array([t[0] for t in trees])
        tzs = np.array([t[2] for t in trees])
        on_road_mask = contains_xy(u_carriageway, txs, tzs)
        for idx in np.flatnonzero(on_road_mask):
            tx_i, ty_i, tz_i, tkind, _ = trees[idx]
            other_issues.append(make_issue('propOnCarriageway', tx_i, tz_i, 1.0,
                                           f'Tree (kind={tkind}) stands on carriageway'))
    for lx, lz in lamps:
        if u_carriageway.contains(Point(lx, lz)):
            other_issues.append(make_issue('propOnCarriageway', lx, lz, 1.0, 'Street lamp stands on carriageway'))
    for sx, sz in signals:
        if u_carriageway.contains(Point(sx, sz)):
            other_issues.append(make_issue('propOnCarriageway', sx, sz, 1.0, 'Traffic signal stands on carriageway'))
    for bx, bz in stops:
        if u_carriageway.contains(Point(bx, bz)):
            other_issues.append(make_issue('propOnCarriageway', bx, bz, 1.0, 'Bus stop stands on carriageway'))
    for ax, az, bx, bz, *_ in banks:
        seg = LineString([(ax, az), (bx, bz)])
        if u_carriageway.intersects(seg):
            other_issues.append(make_issue('propOnCarriageway', (ax + bx) / 2, (az + bz) / 2, 1.0,
                                           'Bank railing intersects carriageway'))
    for ax, az, bx, bz in stone_rails:
        geom = Point(ax, az) if math.hypot(bx - ax, bz - az) < 0.05 else LineString([(ax, az), (bx, bz)])
        if u_carriageway.intersects(geom):
            other_issues.append(make_issue('propOnCarriageway', (ax + bx) / 2, (az + bz) / 2, 1.0,
                                           'Stone rail/bollard intersects carriageway'))

    # 4b. Floating (> 0.2m) or buried (> 0.5m): trees, lamps, railings, landmarks
    if trees:
        txs = np.array([t[0] for t in trees])
        tzs = np.array([t[2] for t in trees])
        on_sw = contains_xy(u_sidewalk, txs, tzs)
        on_rd = contains_xy(u_road0, txs, tzs)
        on_cycle = contains_xy(u_cycle, txs, tzs)
        u_peaks = unary_union(peak_polys_list).buffer(1.0) if peak_polys_list else Polygon()
        in_peak = contains_xy(u_peaks, txs, tzs)
        for i, (tx_i, ty_i, tz_i, tkind, _) in enumerate(trees):
            gm = ground_mesh_y(tx_i, tz_i)
            offset = 0.195 if on_sw[i] else 0.045 if on_rd[i] else 0.060 if on_cycle[i] else None
            sup = road_base_y(tx_i, tz_i) + offset if offset is not None else gm
            if in_peak[i]:
                py_m = nearest_peak_y(tx_i, ty_i, tz_i)
                if py_m is not None and abs(ty_i - py_m) < abs(ty_i - sup):
                    sup = py_m
            diff = ty_i - sup
            if diff > 0.20 or diff < -0.50:
                other_issues.append(make_issue('floatingOrBuried', tx_i, tz_i, abs(diff),
                                               f'Tree (kind={tkind}) y={ty_i:.2f} vs support={sup:.2f} (diff={diff:+.2f}m)'))

    endpoints = defaultdict(list)
    for ax, az, bx, bz, start_top, _, end_top in banks:
        for x, z, height in ((ax, az, start_top), (bx, bz, end_top)):
            endpoints[round(x, 1), round(z, 1)].append(height)
            delta = height - ground_mesh_y(x, z)
            if delta > .20 or delta < -.50:
                other_issues.append(make_issue('floatingOrBuried', x, z, abs(delta), 'Bank endpoint vs ground mesh'))
    for (x, z), heights in endpoints.items():
        step = max(heights) - min(heights)
        if step > .05:
            other_issues.append(make_issue('railStep', x, z, step, 'Shared bank endpoint height mismatch'))

    # Landmarks vertical placement check
    peak_lm_map = {'fubo': '伏波山', 'diecai': '明月峰', 'duxiu': '独秀峰'}
    for lid, ldata in landmarks.items():
        lm = ldata['entry']
        px, py, pz = lm['position']
        vtris = ldata['vis_tris']
        if not len(vtris):
            continue
        ymin = float(vtris[:, :, 1].min())
        ymax = float(vtris[:, :, 1].max())
        if lid in peak_lm_map:
            pname = peak_lm_map[lid]
            if pname in peak_summits:
                summit_y = peak_summits[pname][1]
                # Summit pavilion / top features should align near peak summit, and base must not be >5m below river/ground
                gm_foot = ground_mesh_y(px, pz)
                if ymin < gm_foot - 15.0 or (lid in ('fubo', 'diecai') and ymax < summit_y - 10.0):
                    err = max(gm_foot - ymin, summit_y - ymax)
                    other_issues.append(make_issue('floatingOrBuried', px, pz, err,
                                                   f'Peak landmark {lid} y=[{ymin:.1f},{ymax:.1f}] misaligned with {pname} summit={summit_y:.1f}m', landmark=lid))
        elif lid in ('jiefang_bridge', 'huaqiao'):
            # Bridge piers should reach down to water/ground and not float above deck approach
            gm = ground_mesh_y(px, pz)
            if ymin > gm + 5.0:
                other_issues.append(make_issue('floatingOrBuried', px, pz, ymin - gm,
                                               f'Bridge landmark {lid} piers float at {ymin:.2f} above {gm:.2f}', landmark=lid))
        else:
            gm = ground_mesh_y(px, pz)
            # Check both that visual bottom isn't floating > 0.20m above anchor ground, and datum py isn't off >0.5m
            if not is_wet(px, pz):
                if ymin - gm > 0.20:
                    other_issues.append(make_issue('floatingOrBuried', px, pz, ymin - gm,
                                                   f'Landmark {lid} floats {ymin - gm:.2f}m above groundMesh', landmark=lid))
                elif py - gm > 0.20 or py - gm < -0.50:
                    other_issues.append(make_issue('floatingOrBuried', px, pz, abs(py - gm),
                                                   f'Landmark {lid} datum y={py:.2f} vs groundMesh={gm:.2f} (diff={py - gm:+.2f}m)', landmark=lid))

    # 4c. Bridge joint step (> 0.10m between bridge end and connecting land road)
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

    for wid, (pts, tags) in osm_ways.items():
        if tags.get('bridge', 'no') == 'no':
            continue
        bline = LineString(pts)
        if not bounds.intersects(bline):
            continue
        for end_idx, into_bridge_dist in ((0, min(0.5, bline.length * 0.2)), (-1, max(0.0, bline.length - min(0.5, bline.length * 0.2)))):
            end_pt = pts[end_idx]
            if not bounds.buffer(-4.0).contains(Point(end_pt)):
                continue
            connected_land = [oid for oid in road_node_ways.get(end_pt, [])
                              if oid != wid and osm_ways[oid][1].get('bridge', 'no') == 'no'
                              and osm_ways[oid][1]['highway'] in RULES['defaultWidth']]
            if not connected_land:
                continue
            bp = bline.interpolate(into_bridge_dist)
            by = lm_walk_y_at(bp.x, bp.y) if f'way/{wid}' in replaced_ways else deck_y_at(bp.x, bp.y, tol=0.45)
            if wid in SPAN_WAYS:
                by = road_surface_y(bp.x, bp.y, True, wid)
            if by is None:
                continue
            # Sample 1.0m along the connecting land road
            lid_way = connected_land[0]
            lpts = osm_ways[lid_way][0]
            lline = LineString(lpts if lpts[0] == end_pt else lpts[::-1])
            lp = lline.interpolate(min(1.0, lline.length * 0.5))
            ly = road_surface_y(lp.x, lp.y, False, lid_way)
            step = abs(by - ly)
            if step > 0.10:
                other_issues.append(make_issue('bridgeJointStep', end_pt[0], end_pt[1], step,
                                               f'Bridge way/{wid} ({tags.get("name", "")}) end y={by:.2f} vs road way/{lid_way} y={ly:.2f} (step={step:.2f}m)', way=wid))

    # 4d. Invisible colliders on walkable roads (collision* blocking road with no visible lod0 within 0.5m)
    for lid, foot in lm_block_footprints.items():
        if foot.is_empty:
            continue
        on_walk = foot.intersection(u_all_road_surface)
        if on_walk.area <= 0.1:
            continue
        vtris = landmarks[lid]['vis_tris']
        vnorms = landmarks[lid]['vis_normals']
        vis_foot = Polygon()
        if len(vtris):
            vsteep = vtris[np.abs(vnorms[:, 1]) < 0.85]
            if len(vsteep):
                cx = np.clip(np.rint((vsteep[:, :, 0].mean(axis=1) - left) / GRID).astype(int), 0, gw - 1)
                cz = np.clip(np.rint((vsteep[:, :, 2].mean(axis=1) - top) / GRID).astype(int), 0, gh - 1)
                vrel = vsteep.copy()
                vrel[:, :, 1] -= (terrain_dm[cz, cx] / 10.0)[:, None]
                vis_foot = unary_union([slice_tris_at_y(vrel, 0.6), slice_tris_at_y(vrel, 1.2)]).buffer(0.5)
        ghost = on_walk.difference(vis_foot)
        if ghost.area > 0.5:
            rp = ghost.representative_point()
            other_issues.append(make_issue('invisibleColliderOnRoad', rp.x, rp.y, ghost.area,
                                           f'Landmark {lid} has {ghost.area:.1f} m² invisible collision* on road/sidewalk', landmark=lid))

    # 4e. Landmark-Landmark and Landmark-ProceduralBuilding overlaps (> 0.5 m²)
    proc_index = STRtree(proc_bldg_polys)
    from landmarks.world_surface import Surface
    surface = Surface(root/'public/world')
    @lru_cache(maxsize=262144)
    def ground(east,south):
        return surface.sample(east,south)[0]
    solids = {lid: structural_footprint(data,ground,lm_block_footprints.get(lid,Polygon()))
              for lid,data in landmarks.items()}
    lids = list(solids)
    for i, lid_a in enumerate(lids):
        nearby = proc_index.query(solids[lid_a],predicate="intersects")
        inter_p = solids[lid_a].intersection(unary_union(proc_index.geometries.take(nearby)))
        if inter_p.area > 0.5:
            rp = inter_p.representative_point()
            other_issues.append(make_issue('landmarkOverlap', rp.x, rp.y, inter_p.area,
                                           f'Landmark {lid_a} overlaps procedural buildings by {inter_p.area:.1f} m²', landmark=lid_a))
        for lid_b in lids[i + 1:]:
            if solids[lid_a].is_empty or solids[lid_b].is_empty:
                continue
            inter_ll = solids[lid_a].intersection(solids[lid_b])
            if inter_ll.area > 0.5:
                rp = inter_ll.representative_point()
                other_issues.append(make_issue('landmarkOverlap', rp.x, rp.y, inter_ll.area,
                                               f'Landmark {lid_a} overlaps landmark {lid_b} by {inter_ll.area:.1f} m²',
                                               landmarks=[lid_a, lid_b]))

    other_issues.sort(key=lambda r: r['value'], reverse=True)

    approved = json.loads((root / 'pipeline/audit-allow.json').read_text())
    allowed = apply_landmark_exceptions(approved, bldg_issues, other_issues)

    def summarize(items):
        by_sub = defaultdict(int)
        sub_samples = defaultdict(list)
        for it in items:
            by_sub[it['subtype']] += 1
            if len(sub_samples[it['subtype']]) < 10:
                sub_samples[it['subtype']].append(it)
        return {
            'count': len(items),
            'bySubtype': dict(sorted(by_sub.items())),
            'bySubtypeSamples': dict(sub_samples),
            'top20': items[:20],
            'sample100': items[:100],
        }

    return {
        'source': 'pipeline',
        'approvedExceptions': allowed,
        'counts': {
            'buildingOnRoad': len(bldg_issues),
            'unevenRoad': len(uneven_issues),
            'textureIssue': len(texture_issues),
            'otherBasic': len(other_issues),
        },
        'categories': {
            'buildingOnRoad': summarize(bldg_issues),
            'unevenRoad': summarize(uneven_issues),
            'textureIssue': summarize(texture_issues),
            'otherBasic': summarize(other_issues),
        },
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--world', type=Path, default=Path(OUT))
    parser.add_argument('--out', type=Path, default=Path('captures/audit-pipeline.json'))
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    result = run_audit(args.world, root)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print('Pipeline audit counts:', json.dumps(result['counts'], ensure_ascii=False))
    for cat, data in result['categories'].items():
        print(f'  {cat}: {data["count"]} {data["bySubtype"]}')


if __name__ == '__main__':
    main()

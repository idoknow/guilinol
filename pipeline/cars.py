"""Motorway mask (excluding pedestrian streets & bridge sidewalks) and curbside car spawns."""

import base64
import json
import math
import random
import re
from pathlib import Path
from statistics import median

import numpy as np
from shapely import STRtree, intersects_xy
from shapely.affinity import rotate
from shapely.geometry import LineString, Point, Polygon, box
from shapely.ops import unary_union

from common import ll2xz, load_osm
from features import points
from landmarks.jiefang_layout import motor_carriageways
from road_profile import RULES, Road, facade_gap, pair_carriageways

MOTOR_STEP = 2
MOTOR_HIGHWAYS = {
    'motorway', 'motorway_link',
    'trunk', 'trunk_link', 'primary', 'primary_link',
    'secondary', 'secondary_link', 'tertiary', 'tertiary_link',
    'residential', 'unclassified', 'living_street',
}
EXTRA_WIDTHS = {
    'motorway': 14.0, 'motorway_link': 7.0,
    'trunk_link': 7.0, 'primary_link': 6.5, 'secondary_link': 6.0, 'tertiary_link': 5.5,
    'unclassified': 6.0, 'living_street': 6.0,
}
EXTRA_MAX_LANES = {
    'trunk_link': 2, 'primary_link': 2, 'secondary_link': 2, 'tertiary_link': 1,
    'unclassified': 2, 'living_street': 2,
}
PED_LANDMARK_IDS = {
    'zhengyang', 'dongxixiang', 'wangcheng_market', 'jingjiang',
    'central_square', 'xiaoyao_tower', 'zhuangyuan_gallery',
}


def _motor_profile(line: LineString, tags: dict, facades: STRtree, way_id: int) -> Road:
    kind = tags['highway']
    is_link = kind.endswith('_link')
    one_way = is_link or tags.get('oneway', 'yes' if tags.get('junction') == 'roundabout' else 'no') in ('yes', '1', 'true', '-1')
    lane = RULES['laneWidth']
    tag_width = re.fullmatch(r'(\d+(?:\.\d+)?)\s*(?:m)?', tags.get('width', '').strip())
    width = float(tag_width[1]) if tag_width else None
    count = tags.get('lanes', '')
    lanes = int(count) if count.isdecimal() and 0 < int(count) <= 16 else None
    sidewalk = tags.get('sidewalk', 'none' if is_link or kind=='motorway' else 'both')

    def edge(side: str) -> float:
        default = 'yes' if sidewalk in ('both', side, 'yes') else 'no'
        return RULES['sidewalkWidth'] if tags.get('sidewalk:' + side, default) == 'yes' else 0.0

    left_sw, right_sw = edge('left'), edge('right')
    samples = facade_gap(line, facades) if not width and not is_link and not lanes else ()
    gap = median(s[2] for s in samples) if samples else None
    default_w = RULES['defaultWidth'].get(kind, EXTRA_WIDTHS.get(kind, 6.0))
    max_lanes = RULES['maxLanes'].get(kind, EXTRA_MAX_LANES.get(kind, 2))

    if width:
        source = 'width'
    elif lanes:
        width, source = lanes * lane, 'lanes'
    elif gap is not None:
        width, source = max(3.5, gap - left_sw - right_sw), 'frontage'
    else:
        width, source = default_w, 'class'

    if lanes is None:
        lanes = min(max_lanes, max(1 if one_way else 2, round(width / lane)))
        if source == 'frontage':
            width = min(width, lanes * lane)

    inferred_div = way_id != 221349755 and not one_way and not is_link and lanes >= 4 and kind in ('trunk', 'primary', 'secondary')
    divided = tags.get('divider', 'yes' if inferred_div else 'no') not in ('no', 'none', 'line')
    return Road(line, width, kind, tags.get('name', ''), lanes, left_sw, right_sw, divided, gap, source, one_way, way_id, samples)


def _pedestrian_landmark_exclusions() -> Polygon:
    landmarks_path = Path(__file__).with_name('landmarks.json')
    polys = []
    for lm in json.loads(landmarks_path.read_text()):
        if lm.get('id') not in PED_LANDMARK_IDS:
            continue
        for key in ('replace', 'flatten'):
            val = lm.get(key)
            if isinstance(val, dict) and 'polygon' in val:
                polys.append(Polygon([ll2xz(lat, lon) for lon, lat in val['polygon']]))
        for ring in lm.get('replacePolygons', []):
            polys.append(Polygon([ll2xz(lat, lon) for lon, lat in ring]))
    return unary_union(polys) if polys else Polygon()


def plan_cars(bounds, surface, buildings, sample, existing_bikes=(), docks=None, interchange=None):
    left, top, right, bottom = bounds.bounds
    cols = int((right - left) // MOTOR_STEP) + 1
    rows = int((bottom - top) // MOTOR_STEP) + 1
    xs = left + np.arange(cols) * MOTOR_STEP
    zs = top + np.arange(rows) * MOTOR_STEP

    facades = STRtree(buildings)
    ped_excl = _pedestrian_landmark_exclusions()

    ground_roads = []
    way_oneway_rev = set()
    bridge_roads = []
    bridge_tunnel_lines = []
    control_pts = []

    for el in load_osm():
        tags = el.get('tags', {})
        if el['type'] == 'node' and tags.get('highway') in ('crossing', 'traffic_signals', 'bus_stop', 'street_lamp'):
            control_pts.append((Point(ll2xz(el['lat'], el['lon'])), tags['highway']))
            continue
        if el['type'] != 'way':
            continue
        hw = tags.get('highway')
        if not hw:
            continue
        pts = points(el)
        if len(pts) < 2:
            continue
        line = LineString(pts)
        if not bounds.intersects(line):
            continue
        is_bridge = tags.get('bridge', 'no') != 'no'
        is_tunnel = tags.get('tunnel', 'no') != 'no'
        if is_bridge or is_tunnel:
            bridge_tunnel_lines.append(line)
        if is_tunnel or tags.get('access') in ('no', 'private') or tags.get('motor_vehicle') == 'no':
            continue
        if hw not in MOTOR_HIGHWAYS:
            continue
        if tags.get('oneway') == '-1':
            way_oneway_rev.add(el['id'])
        if is_bridge:
            bridge_roads.append((el['id'], hw, tags, line))
        else:
            ground_roads.append(_motor_profile(line, tags, facades, el['id']))

    ground_roads = list(pair_carriageways(ground_roads))

    # Build bridge motor carriageways, trimming outer sidewalks on both single and paired spans.
    bridge_polys = []
    b_tree = STRtree([b[3] for b in bridge_roads]) if bridge_roads else None
    handled_pairs = set()
    for idx, (wid, hw, tags, ln) in enumerate(bridge_roads):
        one_way = hw.endswith('_link') or tags.get('oneway') in ('yes', '1', 'true', '-1')
        tag_w = re.fullmatch(r'(\d+(?:\.\d+)?)\s*(?:m)?', tags.get('width', '').strip())
        explicit_w = float(tag_w[1]) if tag_w else None
        paired_idx = None
        paired_sep = None
        if one_way and b_tree is not None:
            mid = ln.interpolate(0.5, normalized=True)
            a_tan = np.subtract(
                ln.interpolate(min(ln.length, ln.length * 0.5 + 0.5)).coords[0],
                ln.interpolate(max(0.0, ln.length * 0.5 - 0.5)).coords[0],
            )
            for j in b_tree.query(mid, predicate='dwithin', distance=22.0):
                if j == idx:
                    continue
                oid, ohw, otags, oln = bridge_roads[j]
                o_one = ohw.endswith('_link') or otags.get('oneway') in ('yes', '1', 'true', '-1')
                if not o_one:
                    continue
                along = oln.project(mid)
                if not 0.0 < along < oln.length:
                    continue
                b_tan = np.subtract(
                    oln.interpolate(min(oln.length, along + 0.5)).coords[0],
                    oln.interpolate(max(0.0, along - 0.5)).coords[0],
                )
                norm_prod = max(1e-4, np.linalg.norm(a_tan) * np.linalg.norm(b_tan))
                if np.dot(a_tan, b_tan) < -0.7 * norm_prod:
                    d = oln.distance(mid)
                    if 3.0 <= d and (paired_sep is None or d < paired_sep):
                        paired_sep = d
                        paired_idx = j

        if paired_sep is not None:
            cap_w = explicit_w if explicit_w else {'trunk': 11.0, 'primary': 10.0, 'secondary': 9.0}.get(hw, 8.0)
            bw = min(cap_w, max(4.8, paired_sep - 1.0))
            bridge_polys.append(ln.buffer(bw * 0.5, quad_segs=2))
            pair_key = (min(idx, paired_idx), max(idx, paired_idx))
            if pair_key not in handled_pairs and paired_sep <= 15.0:
                handled_pairs.add(pair_key)
                oln = bridge_roads[paired_idx][3]
                steps = max(4, int(min(ln.length, oln.length) // 8) + 1)
                mid_pts = []
                for frac in np.linspace(0.0, 1.0, steps):
                    pa = ln.interpolate(frac, normalized=True)
                    pb = oln.interpolate(oln.project(pa))
                    mid_pts.append(((pa.x + pb.x) * 0.5, (pa.y + pb.y) * 0.5))
                if len(mid_pts) >= 2:
                    gap_half = max(0.8, (paired_sep - bw) * 0.5 + 0.5)
                    bridge_polys.append(LineString(mid_pts).buffer(gap_half, quad_segs=2, cap_style='flat'))
        else:
            total_bw = explicit_w if explicit_w else {'trunk': 18.0, 'primary': 14.0, 'secondary': 12.0}.get(hw, 10.0)
            bw = min(7.0, total_bw * 0.55) if one_way else max(5.5, total_bw - 3.5)
            bridge_polys.append(ln.buffer(bw * 0.5, quad_segs=2))

    if interchange is not None:
        anchor, angle, _ = interchange
        ic_motor = motor_carriageways(anchor, angle)
        if not ped_excl.is_empty:
            ic_motor = ic_motor.difference(ped_excl)
        if not ic_motor.is_empty:
            bridge_polys.append(ic_motor)

    ground_polys = []
    for r in ground_roads:
        if not r.line.intersects(bounds):
            continue
        gp = r.line.buffer(r.width * 0.5, quad_segs=2)
        if not ped_excl.is_empty:
            gp = gp.difference(ped_excl)
        if not gp.is_empty:
            ground_polys.append(gp)

    # Bridge the narrow centerline gap between paired opposing one-way ground carriageways (e.g. Jiefang East Rd).
    oneway_ground = [r for r in ground_roads if r.oneway and r.kind in ('trunk', 'primary', 'secondary', 'tertiary') and r.line.intersects(bounds)]
    if len(oneway_ground) >= 2:
        og_tree = STRtree([r.line for r in oneway_ground])
        og_handled = set()
        for idx, ra in enumerate(oneway_ground):
            mid = ra.line.interpolate(0.5, normalized=True)
            a_tan = np.subtract(
                ra.line.interpolate(min(ra.line.length, ra.line.length * 0.5 + 0.5)).coords[0],
                ra.line.interpolate(max(0.0, ra.line.length * 0.5 - 0.5)).coords[0],
            )
            best_j = None
            best_sep = None
            for j in og_tree.query(mid, predicate='dwithin', distance=18.0):
                if j == idx:
                    continue
                rb = oneway_ground[j]
                along = rb.line.project(mid)
                if not 0.0 < along < rb.line.length:
                    continue
                b_tan = np.subtract(
                    rb.line.interpolate(min(rb.line.length, along + 0.5)).coords[0],
                    rb.line.interpolate(max(0.0, along - 0.5)).coords[0],
                )
                norm_prod = max(1e-4, np.linalg.norm(a_tan) * np.linalg.norm(b_tan))
                if np.dot(a_tan, b_tan) < -0.7 * norm_prod:
                    d = rb.line.distance(mid)
                    if 3.0 <= d <= 15.0 and (best_sep is None or d < best_sep):
                        best_sep = d
                        best_j = j
            if best_j is not None:
                pair_key = (min(idx, best_j), max(idx, best_j))
                if pair_key in og_handled:
                    continue
                og_handled.add(pair_key)
                rb = oneway_ground[best_j]
                steps = max(4, int(min(ra.line.length, rb.line.length) // 6) + 1)
                mid_pts = []
                for frac in np.linspace(0.0, 1.0, steps):
                    pa = ra.line.interpolate(frac, normalized=True)
                    pb = rb.line.interpolate(rb.line.project(pa))
                    if pa.distance(pb) <= 16.0:
                        mid_pts.append(((pa.x + pb.x) * 0.5, (pa.y + pb.y) * 0.5))
                if len(mid_pts) >= 2:
                    gap_half = max(1.2, (best_sep - (ra.width + rb.width) * 0.5) * 0.5 + 0.9)
                    strip = LineString(mid_pts).buffer(gap_half, quad_segs=2, cap_style='flat')
                    if not ped_excl.is_empty:
                        strip = strip.difference(ped_excl)
                    hits = [buildings[k] for k in facades.query(strip, predicate='intersects')]
                    if hits:
                        strip = strip.difference(unary_union(hits))
                    if not strip.is_empty:
                        ground_polys.append(strip)

    motor_geom = unary_union([*ground_polys, *bridge_polys])
    if not motor_geom.is_empty:
        motor_geom = motor_geom.buffer(0.35, quad_segs=2).intersection(bounds)
    mask_arr = intersects_xy(motor_geom, xs[None, :], zs[:, None]) if not motor_geom.is_empty else np.zeros((rows, cols), dtype=bool)

    def on_motor(east: float, south: float) -> bool:
        c = round((east - left) / MOTOR_STEP)
        rw = round((south - top) / MOTOR_STEP)
        return 0 <= c < cols and 0 <= rw < rows and bool(mask_arr[rw, c])

    # Curbside parallel car parking generation.
    jct_widths = {}
    for r in ground_roads:
        for coord in set(r.line.coords):
            jct_widths.setdefault(coord, []).append(r.width)
    no_park_zones = [
        Point(coord).buffer(max(ws) * 0.5 + 12.0)
        for coord, ws in jct_widths.items() if len(ws) >= 2
    ]
    for pt, feat in control_pts:
        no_park_zones.append(pt.buffer(3.2 if feat == 'street_lamp' else 12.0))
    for bln in bridge_tunnel_lines:
        no_park_zones.append(bln.buffer(18.0))
    if not ped_excl.is_empty:
        no_park_zones.append(ped_excl.buffer(4.0))
    no_park_tree = STRtree(no_park_zones) if no_park_zones else None

    avoid_pts = [Point(b[0], b[2]) for b in existing_bikes]
    if docks:
        avoid_pts.extend(Point(pos[0], pos[2]) for pos in docks.values())
    avoid_tree = STRtree(avoid_pts) if avoid_pts else None

    safe_bounds = bounds.buffer(-16.0)
    cars = []
    for r in ground_roads:
        if r.kind not in ('trunk', 'primary', 'secondary', 'tertiary', 'residential'):
            continue
        min_w = 5.5 if r.oneway else 7.0
        if r.width < min_w or r.line.length < 65.0:
            continue
        rng = random.Random(r.way ^ 0xCA45)
        dist = min(r.line.length * 0.35, rng.uniform(42.0, 88.0))
        rev_dir = -1.0 if r.way in way_oneway_rev else 1.0
        lat_off = r.width * 0.5 - 1.15
        while dist < r.line.length - 26.0:
            c_pt = np.asarray(r.line.interpolate(dist).coords[0])
            ahead = np.asarray(r.line.interpolate(min(r.line.length, dist + 1.5)).coords[0])
            behind = np.asarray(r.line.interpolate(max(0.0, dist - 1.5)).coords[0])
            t_vec = (ahead - behind) * rev_dir
            t_norm = np.linalg.norm(t_vec)
            if t_norm < 1e-3:
                dist += 40.0
                continue
            t_vec /= t_norm
            right_n = np.array([-t_vec[1], t_vec[0]])
            heading = math.atan2(-t_vec[0], -t_vec[1])
            fx, fz = -math.sin(heading), -math.cos(heading)
            rx, rz = math.cos(heading), -math.sin(heading)

            group = []
            for slot in range(rng.randint(1, 2)):
                pos = c_pt + right_n * lat_off + t_vec * (slot * 5.8)
                east, south = float(pos[0]), float(pos[1])
                pt = Point(east, south)
                if not safe_bounds.contains(pt):
                    continue
                if no_park_tree is not None and no_park_tree.query(pt, predicate='intersects').size:
                    continue
                if avoid_tree is not None and avoid_tree.query(pt, predicate='dwithin', distance=18.0).size:
                    continue
                car_obb = rotate(box(east - 1.32, south - 2.62, east + 1.32, south + 2.62), -math.degrees(heading), origin=(east, south))
                if facades.query(car_obb, predicate='intersects').size:
                    continue

                ground_c, water_c = sample(east, south)
                if water_c != -32768 or not on_motor(east, south):
                    continue
                wheels_ok = True
                for sx in (-0.80, 0.80):
                    for sz in (-1.35, 1.35):
                        wx = east + sx * rx + sz * fx
                        wz = south + sz * fz + sx * rz
                        _, w_wat = sample(wx, wz)
                        if w_wat != -32768 or not on_motor(wx, wz):
                            wheels_ok = False
                            break
                    if not wheels_ok:
                        break
                if not wheels_ok:
                    continue

                gf, _ = sample(east + fx * 1.35, south + fz * 1.35)
                gb, _ = sample(east - fx * 1.35, south - fz * 1.35)
                gl, _ = sample(east - rx * 0.85, south - rz * 0.85)
                gr, _ = sample(east + rx * 0.85, south + rz * 0.85)
                if abs(gf - gb) > 0.42 or abs(gl - gr) > 0.24:
                    continue

                door_clear = False
                for side_x in (-1.42, 1.42):
                    dx = east + side_x * rx + 0.15 * fx
                    dz = south + side_x * rz + 0.15 * fz
                    dg, dw = sample(dx, dz)
                    if dw == -32768 and abs(dg - ground_c) <= 0.65 and not facades.query(Point(dx, dz).buffer(0.45), predicate='intersects').size:
                        door_clear = True
                        break
                if not door_clear:
                    continue

                group.append([round(east, 1), round(ground_c, 2), round(south, 1), round(heading, 3), rng.randrange(4)])

            if group and all(math.hypot(group[0][0] - c[0], group[0][2] - c[2]) > 130.0 for c in cars):
                cars.extend(group)
            dist += rng.uniform(145.0, 220.0)

    # Guaranteed starter roadside sedan just south of Zhengyang gate on Jiefang East Rd (-572, -92).
    if all(math.hypot(-572.0 - c[0], -92.0 - c[2]) > 50.0 for c in cars):
        sx, sz, s_heading, s_paint = -572.0, -92.0, -1.86, 1
        sfx, sfz = -math.sin(s_heading), -math.cos(s_heading)
        srx, srz = math.cos(s_heading), -math.sin(s_heading)
        sg, sw = sample(sx, sz)
        s_obb = rotate(box(sx - 1.32, sz - 2.62, sx + 1.32, sz + 2.62), -math.degrees(s_heading), origin=(sx, sz))
        s_wheels_ok = (
            sw == -32768
            and on_motor(sx, sz)
            and not facades.query(s_obb, predicate='intersects').size
            and all(
                sample(sx + ox * srx + oz * sfx, sz + oz * sfz + ox * srz)[1] == -32768
                and on_motor(sx + ox * srx + oz * sfx, sz + oz * sfz + ox * srz)
                for ox in (-0.80, 0.80) for oz in (-1.35, 1.35)
            )
        )
        if s_wheels_ok:
            cars.append([round(sx, 1), round(sg, 2), round(sz, 1), round(s_heading, 3), s_paint])

    return dict(
        cars=cars,
        motorGrid=[left, top, cols, rows, MOTOR_STEP],
        motorMask=base64.b64encode(np.packbits(mask_arr).tobytes()).decode(),
    )

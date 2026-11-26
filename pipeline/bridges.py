import json
import re
from pathlib import Path

import numpy as np
from shapely import STRtree
from shapely.geometry import LineString, Point, Polygon
from shapely.geometry.polygon import orient

from common import load_osm
import bridgeheads
import station_footbridge
from features import points, polygons
from landmarks.jiefang_layout import SPAN_WAYS


def _append_span_quad(spans, thin_spans, owners, profiles, first, second, is_thin, owner_id, portal_deck=False, west_portal=None):
    for pts, levels in (([first[0], first[1], second[0]], [first[2], first[2], second[2]]),
                        ([second[1], second[0], first[1]], [second[2], second[2], first[2]])):
        poly = Polygon(pts)
        if poly.area < 0.001:
            continue
        # The landmark supplies the deck, vaulted underside and collision here.
        if portal_deck and west_portal is not None and west_portal.covers(poly):
            continue
        spans.append(poly)
        thin_spans.append(is_thin)
        owners.append(owner_id)
        profiles.append(np.linalg.solve(np.column_stack((pts, np.ones(3))), levels))


def _stitch_parallel_water_spans(way_records, sample, spans, thin_spans, owners, profiles):
    """Close open water chasms between parallel bridge decks (e.g. carriageway + flanking footbridge)."""
    if len(way_records) < 2:
        return
    # For each bridge way, match each side (+1 left / -1 right) only to its nearest parallel neighbor.
    stitched_pairs = set()
    for i, rec_a in enumerate(way_records):
        line_a, sec_a, thin_a, wid_a = rec_a
        if len(sec_a) < 2 or line_a.length < 4.0:
            continue
        va = np.subtract(line_a.coords[-1], line_a.coords[0])
        la = float(np.linalg.norm(va))
        if la < 1e-4:
            continue
        dir_a = va / la
        n_left_a = np.array([-dir_a[1], dir_a[0]])
        mid_a = np.asarray(line_a.interpolate(0.5 * line_a.length).coords[0])

        for side_idx in (0, 1):  # 0 = left edge (sec[0]), 1 = right edge (sec[1])
            outward = n_left_a if side_idx == 0 else -n_left_a
            best = None
            for j, rec_b in enumerate(way_records):
                if j == i:
                    continue
                line_b, sec_b, thin_b, wid_b = rec_b
                if len(sec_b) < 2 or line_b.length < 4.0:
                    continue
                vb = np.subtract(line_b.coords[-1], line_b.coords[0])
                lb = float(np.linalg.norm(vb))
                if lb < 1e-4:
                    continue
                dir_b = vb / lb
                cos_ab = float(np.dot(dir_a, dir_b))
                if abs(cos_ab) < 0.85:
                    continue
                mid_b = np.asarray(line_b.interpolate(0.5 * line_b.length).coords[0])
                if float(np.linalg.norm(mid_b - mid_a)) > max(line_a.length, line_b.length) * 0.75 + 20.0:
                    continue
                # Align B's direction to match A's direction, and pick the facing edge of B.
                b_edges = [(s[0], s[1], s[2]) for s in (sec_b if cos_ab > 0 else reversed(sec_b))]
                b_facing_idx = (1 - side_idx) if cos_ab > 0 else side_idx
                edge_a = [s[side_idx] for s in sec_a]
                edge_b = [s[b_facing_idx] for s in b_edges]
                ma = edge_a[len(edge_a) // 2]
                mb = edge_b[len(edge_b) // 2]
                sep = float(np.dot(mb - ma, outward))
                if not (0.15 <= sep <= 14.5):
                    continue
                if abs(sec_a[len(sec_a) // 2][2] - b_edges[len(b_edges) // 2][2]) > 1.2:
                    continue
                # Strictly require water in the gap between the two spans.
                mid_gap = 0.5 * (ma + mb)
                if sample(float(mid_gap[0]), float(mid_gap[1]))[1] == -32768:
                    continue
                if best is None or sep < best[0]:
                    best = (sep, j, b_edges, b_facing_idx, thin_b)
            if best is None:
                continue
            _, j, b_edges, b_facing_idx, thin_b = best
            pair_key = (min(i, j), max(i, j))
            if pair_key in stitched_pairs:
                continue
            stitched_pairs.add(pair_key)

            # Resample both facing side polylines over their shared longitudinal overlap and bridge.
            la_edge = LineString([s[side_idx] for s in sec_a])
            lb_edge = LineString([s[b_facing_idx] for s in b_edges])
            ha_vals = np.array([s[2] for s in sec_a], dtype=float)
            hb_vals = np.array([s[2] for s in b_edges], dtype=float)
            sa_vals = np.array([la_edge.project(Point(s[side_idx])) for s in sec_a], dtype=float)
            sb_vals = np.array([lb_edge.project(Point(s[b_facing_idx])) for s in b_edges], dtype=float)

            # Project B's endpoints onto A's edge line to get shared span range.
            s0 = max(0.0, min(la_edge.length, la_edge.project(Point(lb_edge.coords[0]))))
            s1 = max(0.0, min(la_edge.length, la_edge.project(Point(lb_edge.coords[-1]))))
            lo, hi = min(s0, s1), max(s0, s1)
            if hi - lo < 3.0:
                continue
            n_steps = max(2, int(np.ceil((hi - lo) / 2.5)) + 1)
            bridge_secs = []
            for sv in np.linspace(lo, hi, n_steps):
                pa = np.asarray(la_edge.interpolate(float(sv)).coords[0])
                sb_proj = lb_edge.project(Point(pa))
                pb = np.asarray(lb_edge.interpolate(float(sb_proj)).coords[0])
                ya = float(np.interp(sv, sa_vals, ha_vals))
                yb = float(np.interp(sb_proj, sb_vals, hb_vals))
                bridge_secs.append((pa, pb, 0.5 * (ya + yb)))
            is_thin = bool(thin_a or thin_b)
            for first, second in zip(bridge_secs, bridge_secs[1:]):
                _append_span_quad(spans, thin_spans, owners, profiles, first, second, is_thin, wid_a)


def bridge_tiles(bounds, sample, routes=(), raised=(), plans=None, west_portal=None, canopies=()):
    spans, profiles, owners, emitted = [], [], [], []
    thin_spans = []
    way_records = []
    tracks = [
        (LineString([(east, south) for east, level, south in leg['path']]).buffer(4.2), leg['path'])
        for leg in routes if leg['kind'] == 'boat'
    ]
    # Landmark GLBs already contain these spans. A second procedural deck would z-fight.
    replaced = set()
    for entry in json.loads((Path(__file__).resolve().parent / 'landmarks.json').read_text()):
        replace = entry.get('replace', [])
        if isinstance(replace, list):
            replaced.update(key for key in replace if isinstance(key, str))
    ways = load_osm()
    station_nodes = next((set(w['nodes']) for w in ways if w['type'] == 'way'
                          and w['id'] == station_footbridge.BRIDGE), set())
    for way in ways:
        tags = way.get('tags', {})
        if way['type'] != 'way' or 'highway' not in tags:
            continue
        if tags.get('bridge', 'no') == 'no' and way['id'] not in station_footbridge.STAIRS:
            continue
        if f"way/{way['id']}" in replaced:
            continue
        portal_deck = west_portal is not None and way['id'] in SPAN_WAYS
        coords = points(way)
        if len(coords) < 2:
            continue
        if way['id'] in raised and not (plans and way['id'] in plans):
            coords = raised[way['id']][0]
        line = LineString(coords)
        if not bounds.intersects(line) or not line.length:
            continue
        sections = []
        if way['id'] == station_footbridge.BRIDGE or way['id'] in station_footbridge.STAIRS:
            sections = station_footbridge.sections(way, coords, station_nodes)
            crossings = []
        elif plans and way['id'] in plans:
            pline, width, s_b, h_prof = plans[way['id']]
            zone = pline.buffer(width / 2)
            crossings = [track.intersection(zone) for track, _ in tracks if track.intersects(zone)]
            pts_s = [np.array(pline.interpolate(float(sv)).coords[0]) for sv in s_b]
            for index, coord in enumerate(pts_s):
                tangent = pts_s[min(index + 1, len(pts_s) - 1)] - pts_s[max(index - 1, 0)]
                length = np.linalg.norm(tangent)
                if not length:
                    continue
                side = np.array([-tangent[1], tangent[0]]) * (width / 2 / length)
                sections.append((coord + side, coord - side, float(h_prof[index])))
        else:
            match = re.fullmatch(r'(\d+(?:\.\d+)?)\s*(?:m)?', tags.get('width', ''))
            width = float(match[1]) if match else {
                'footway': 3, 'path': 3, 'steps': 3, 'cycleway': 3,
                'primary': 14, 'secondary': 12, 'trunk': 18,
            }.get(tags['highway'], 10)
            ends = []
            for end, sign in [(0, 1), (line.length, -1)]:
                point = line.interpolate(end)
                direction = np.array(point.coords[0]) - line.interpolate(end + sign * min(1, line.length)).coords[0]
                d_norm = float(np.linalg.norm(direction))
                if d_norm > 1e-6:
                    direction = direction / d_norm
                height = sample(*point.coords[0])[0]
                first_dry = None
                for distance in range(0, 65, 2):
                    h_s, water = sample(*(point.coords[0] + direction * distance))
                    if water == -32768:
                        if first_dry is None:
                            first_dry = (distance, h_s)
                            height = h_s
                        else:
                            if h_s > height:
                                height = h_s
                            if distance >= first_dry[0] + 8:
                                break
                ends.append(height)
            coords = list(line.segmentize(4).coords)
            zone = line.buffer(width / 2)
            crossings = [track.intersection(zone) for track, _ in tracks if track.intersects(zone)]
            targets = [
                (line.project(Point(east, south)), level + 3.0)
                for track, path in tracks if track.intersects(zone)
                for east, level, south in path if line.distance(Point(east, south)) <= width / 2 + 6
            ]
            for index, coord in enumerate(coords):
                tangent = np.subtract(coords[min(index + 1, len(coords) - 1)], coords[max(index - 1, 0)])
                length = np.linalg.norm(tangent)
                if not length:
                    continue
                side = np.array([-tangent[1], tangent[0]]) * (width / 2 / length)
                frac = line.project(Point(coord)) / line.length
                height = ends[0] * (1 - frac) + ends[1] * frac
                for test in [coord, coord + side, coord - side]:
                    _, water = sample(*test)
                    if water != -32768:
                        height = max(height, water / 10 + 2)
                if targets and abs(ends[1] - ends[0]) <= 0.055 * line.length:
                    station = frac * line.length
                    ceiling = min(ends[0] + station * 0.045, ends[1] + (line.length - station) * 0.045)
                    target = max(level - 0.045 * max(0, abs(station - crossing) - 5) for crossing, level in targets)
                    height = max(height, min(ceiling, target))
                if way['id'] == 246520676:
                    height = 156.48
                    side *= 6.8 / width
                if way['id'] in raised:
                    height = raised[way['id']][1][index] / 10
                sections.append((coord + side, coord - side, height))
        if portal_deck and not (plans and way['id'] in plans):
            sections = [(left, right, height - .65 * max(0, 1 - west_portal.distance(Point((left + right) / 2)) / 18))
                        for left, right, height in sections]
        # IDOK-431: extend procedural bridge endpoints that hang over water or a steep wet bank onto dry land.
        if (
            len(sections) >= 2
            and not portal_deck
            and way['id'] != station_footbridge.BRIDGE
            and way['id'] not in station_footbridge.STAIRS
        ):
            center_pts = [tuple(0.5 * (s[0] + s[1])) for s in sections]
            ext_pts, ext0, ext1 = bridgeheads.extend_to_dry_bank(
                center_pts, sample, max_extend=18.0, step=2.0,
                end_heights=(sections[0][2], sections[-1][2]),
            )
            if ext0 > 0:
                half_w = 0.5 * (sections[0][0] - sections[0][1])
                p0 = np.asarray(ext_pts[0], dtype=float)
                g0 = sample(float(p0[0]), float(p0[1]))[0]
                h0_new = max(g0 + 0.045, min(sections[0][2], g0 + 0.25))
                if sections[0][2] < g0 - 0.5:
                    sections[0] = (sections[0][0], sections[0][1], h0_new)
                sections.insert(0, (p0 + half_w, p0 - half_w, h0_new))
            if ext1 > 0:
                half_w = 0.5 * (sections[-1][0] - sections[-1][1])
                p1 = np.asarray(ext_pts[-1], dtype=float)
                g1 = sample(float(p1[0]), float(p1[1]))[0]
                h1_new = max(g1 + 0.045, min(sections[-1][2], g1 + 0.25))
                if sections[-1][2] < g1 - 0.5:
                    sections[-1] = (sections[-1][0], sections[-1][1], h1_new)
                sections.append((p1 + half_w, p1 - half_w, h1_new))
            if way['id'] != 246520676:
                way_records.append((LineString([0.5 * (s[0] + s[1]) for s in sections]), sections, bool(crossings), way['id']))
        for first, second in zip(sections, sections[1:]):
            for pts, levels in [([first[0], first[1], second[0]], [first[2], first[2], second[2]]),
                                ([second[1], second[0], first[1]], [second[2], second[2], first[2]])]:
                poly = Polygon(pts)
                if poly.area < 0.001:
                    continue
                # The landmark supplies the deck, vaulted underside and collision here.
                if portal_deck and west_portal.covers(poly):
                    continue
                spans.append(poly)
                thin_spans.append(any(poly.intersects(part) for part in crossings))
                owners.append(way['id'])
                profiles.append(np.linalg.solve(np.column_stack((pts, np.ones(3))), levels))
    _stitch_parallel_water_spans(way_records, sample, spans, thin_spans, owners, profiles)
    from shapely import constrained_delaunay_triangles
    # The detailed station landmark supplies the northern crossing once installed.
    for face,level in station_footbridge.fallback_north_faces(ways):
        if not bounds.intersects(face):
            continue
        for triangle in constrained_delaunay_triangles(face).geoms:
            spans.append(triangle)
            thin_spans.append(True)
            owners.append(0)  # Survey geometry has no OSM bridge way.
            profiles.append(np.array([0,0,level]))
    for el,roof,_ in canopies:
        center = roof.representative_point()
        level = sample(center.x,center.y)[0]+6.2
        for triangle in constrained_delaunay_triangles(roof).geoms:
            spans.append(triangle)
            thin_spans.append(True)
            owners.append(el['id'])
            profiles.append(np.array([0,0,level]))
    tree = STRtree(spans)

    def encode(tile, origin):
        triangles = []
        thin=[]
        asphalt=[]
        for index in sorted(tree.query(tile)):
            for poly in polygons(spans[index].intersection(tile)):
                ring = list(orient(poly,sign=-1).exterior.coords)[:-1]
                for at in range(1,len(ring)-1):
                    if thin_spans[index]: thin.append(len(triangles)//3)
                    if owners[index] in (121981963,1023638023,259011247,259011248):
                        asphalt.append(len(triangles)//3)
                    for east,south in (ring[0],ring[at],ring[at+1]):
                        height = profiles[index] @ [east,south,1]
                        triangles.append([round((east-origin[0])*100),round(height*100),round((south-origin[1])*100)])
                    emitted.append((owners[index],np.array(triangles[-3:])/100+[origin[0],0,origin[1]],.6 if thin_spans[index] else 1.2))
        return np.asarray(triangles,dtype='<i2').tobytes(),thin,asphalt
    return encode, emitted

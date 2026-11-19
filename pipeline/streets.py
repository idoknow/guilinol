import math
from collections import defaultdict

import numpy as np
from shapely import STRtree
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import nearest_points, unary_union

from markings import junction_cores, violations
from common import CHUNK, ll2xz, load_osm
from features import points, polygons, rongyin_photo, rongyin_sidewalk
from scatter import CONFIG, walk_line


def chunks(roads,banks,bounds,water,sample,exclude,ped_areas=(),replace_exclude=None,road_ctrl=None,world_origin=None,ground_mesh_fn=None,footprints=(),modeled_paving=None):
    surfaces, sidewalks, stripes, medians, gaps = [],[],[],[],[]
    sidewalks.append(rongyin_sidewalk())
    rep_excl = replace_exclude if replace_exclude is not None else Polygon()
    for pa in ped_areas:
        clipped_pa = pa.difference(rep_excl) if not rep_excl.is_empty else pa
        if not clipped_pa.is_empty:
            surfaces.append(clipped_pa)
    fixtures = defaultdict(lambda: [[],[],[],[],[]])
    lengths = dict(road=0,bank=0)
    def store(which,pt,item):
        if which==0 and modeled_paving is not None and modeled_paving.distance(pt)<2.5:
            return
        if bounds.contains(pt) and (which!=0 or not exclude.covers(pt)):
            origin = tuple(math.floor(v/CHUNK)*CHUNK for v in pt.coords[0])
            fixtures[origin][which].append(item(origin))

    junctions = defaultdict(list)
    motor_arms = defaultdict(list)
    for road in roads:
        coords = list(road.line.coords)
        for coord in set(coords):
            junctions[coord].extend([road.width] * (1 if coord in (coords[0],coords[-1]) else 2))
        if road.kind in ('trunk', 'primary', 'secondary', 'tertiary'):
            for idx_c, coord in enumerate(coords):
                if idx_c > 0:
                    motor_arms[coord].append((road, -1))
                if idx_c < len(coords) - 1:
                    motor_arms[coord].append((road, 1))
    clear = STRtree([Point(coord).buffer(max(widths)/2+3.2) for coord,widths in junctions.items() if len(widths)>2])
    controls = [(Point(ll2xz(node['lat'],node['lon'])),node['tags']['highway']) for node in load_osm()
                if node['type']=='node' and node.get('tags',{}).get('highway') in ('crossing','traffic_signals','bus_stop','street_lamp')]
    control_index = STRtree([pt for pt,_ in controls])
    xing_pts = [pt for pt, feat in controls if feat in ('crossing', 'traffic_signals')]
    xing_tree = STRtree(xing_pts) if xing_pts else None
    cores = junction_cores(roads)
    crosswalk_groups = []
    crossing_centres = []
    lane_stripes = []
    lamp_candidates = []

    def emit_crosswalk(line, width, left_w, right_w, dist, sign_away, with_stop, search=0):
        if not 0 <= dist <= line.length:
            return
        mid = np.array(line.interpolate(dist).coords[0])
        delta = np.subtract(line.interpolate(min(line.length, dist + .25)).coords[0], line.interpolate(max(0, dist - .25)).coords[0])
        tangent = sign_away * delta / max(.001, np.linalg.norm(delta))
        normal = np.array([-tangent[1], tangent[0]])
        bars = []
        for span in np.arange(-width / 2 + .55, width / 2 - .35, 1.0):
            center = mid + normal * span
            bars.append(LineString([center - tangent * 1.9, center + tangent * 1.9]).buffer(.24, cap_style='flat'))
        if with_stop:
            stop = mid + tangent * 2.5
            bars.append(LineString([stop, stop + normal * width / 2]).buffer(.22, cap_style='flat'))
        group = unary_union(bars)
        if cores.query(group, predicate='intersects').size:
            if search < 24:
                emit_crosswalk(line, width, left_w, right_w, dist + sign_away * 2, sign_away, with_stop, search + 2)
            return
        if any(Point(mid).distance(c) < 8 for c in crossing_centres):
            return
        if any(group.intersects(other) for other in crosswalk_groups):
            return
        crossing_centres.append(Point(mid))
        crosswalk_groups.append(group)
        gaps.append(LineString([mid - normal * (width / 2 + left_w + 1), mid + normal * (width / 2 + right_w + 1)]).buffer(2.05, cap_style='flat'))

    for road in roads:
        line,width,kind = road.line,road.width,road.kind
        if not line.intersects(bounds):
            continue
        lengths['road']+=line.intersection(bounds).length
        surf_poly = line.buffer(width/2,quad_segs=2)
        if kind == 'pedestrian' and not rep_excl.is_empty:
            surf_poly = surf_poly.difference(rep_excl)
        if not surf_poly.is_empty:
            surfaces.append(surf_poly)
        for side,extra in ((-1,road.left),(1,road.right)):
            if extra:
                sw_p = line.buffer(side*(width/2+extra),single_sided=True,quad_segs=2)
                if not rep_excl.is_empty:
                    sw_p = sw_p.difference(rep_excl)
                if not sw_p.is_empty:
                    sidewalks.append(sw_p)
        masks = unary_union(clear.geometries.take(clear.query(line.buffer(width/2))))
        for lane in range(1,road.lanes):
            offset = width*(lane/road.lanes-.5)
            stripe = line.offset_curve(offset).buffer(.09,quad_segs=1).difference(masks)
            lane_stripes.append(stripe)
        if road.divided:
            medians.append(line.buffer(.55).difference(masks))
        for index in control_index.query(line,predicate='dwithin',distance=max(2,width/2+3)):
            point,feature = controls[index]
            along = line.project(point)
            if feature in ('street_lamp', 'bus_stop'):
                continue
            if kind=='pedestrian' or point.distance(line)>2:
                continue
            directions = (-1,1) if feature=='traffic_signals' else (1,)
            for direction in directions:
                offset = (width/2+3) if feature=='traffic_signals' else 0
                emit_crosswalk(line, width, road.left, road.right, along + direction * offset, direction, feature == 'traffic_signals')
        if kind in CONFIG['mainStreets']:
            for side in [-1,1]:
                for pt in walk_line(line,CONFIG['lampSpacing'],side*(width/2+2.6)):
                    lamp_candidates.append(pt)

    # Synthesize crosswalks at untagged >=3-arm urban motor intersections (e.g. 榕荫路 × 三多路, IMG_1299.jpg)
    for coord, arms in motor_arms.items():
        if len(arms) < 3 or len({r.way for r, _ in arms}) < 2:
            continue
        jpt = Point(coord)
        if not bounds.contains(jpt):
            continue
        if xing_tree is not None and xing_tree.query(jpt, predicate='dwithin', distance=20.0).size:
            continue
        for arm_road, step_dir in arms:
            if not arm_road.name and len(arms) < 4:
                continue
            other_w = max((r.width for r, _ in arms if r.way != arm_road.way), default=arm_road.width)
            s_jct = arm_road.line.project(jpt)
            dist = s_jct + step_dir * (other_w / 2.0 + 2.8)
            if arm_road.way == 221349761 and any(r.way == 121981960 for r, _ in arms):
                # IMG_1299 shows the crossing on the right side of the frame.
                # Intersect its estimated image bearing with the OSM centreline.
                photo = rongyin_photo()
                eye = np.array([photo['x'], photo['z']])
                bearing = math.radians(photo['heading']) + math.atan(.4 * 18 / photo['focal35'])
                ray = LineString([eye, eye + 60 * np.array([math.sin(bearing), -math.cos(bearing)])])
                crossing = ray.intersection(arm_road.line)
                if crossing.geom_type == 'Point' and not crossing.is_empty:
                    station = arm_road.line.project(crossing)
                    if 0 < step_dir * (station - s_jct) < 40:
                        dist = station
            if 2.2 <= dist <= arm_road.line.length - 2.2:
                emit_crosswalk(arm_road.line, arm_road.width, arm_road.left, arm_road.right, dist, step_dir, len(arms) >= 4)
    # Reserve the approach from the first stripe through the stop line.
    reserved = STRtree([*cores.geometries, *(g.convex_hull.buffer(.05) for g in crosswalk_groups)])
    lanes = unary_union([lane.difference(unary_union(reserved.geometries.take(reserved.query(lane))))
                         for lane in lane_stripes])
    stripes = [*polygons(lanes), *crosswalk_groups]
    lengths['markingOverlap'] = list(violations(stripes, cores, bounds))
    bridge_ways = [LineString(points(el)) for el in load_osm() if el['type']=='way' and
                   el.get('tags',{}).get('bridge','no')!='no' and 'highway' in el.get('tags',{}) and len(points(el))>1]
    bridge = STRtree([bw.buffer(11) for bw in bridge_ways])
    carriageway_union = unary_union([*surfaces, *(bw.buffer(10, quad_segs=2) for bw in bridge_ways)])
    carriageway_avoid = carriageway_union.buffer(0.35) if not carriageway_union.is_empty else Polygon()
    curb_shell = carriageway_union.buffer(0.85) if not carriageway_union.is_empty else Polygon()
    bldg_tree = STRtree(footprints) if footprints else None
    water_tree = STRtree(water) if water else None

    def off_carriageway(pt: Point, allow_relocate: bool) -> Point | None:
        if carriageway_avoid.is_empty or not carriageway_avoid.contains(pt):
            if bldg_tree and bldg_tree.query(pt, predicate='intersects').size:
                return None if not allow_relocate else pt
            if water_tree and water_tree.query(pt, predicate='intersects').size:
                return None
            return pt
        if not allow_relocate:
            return None
        snapped = nearest_points(pt, curb_shell.boundary)[1]
        if water_tree and water_tree.query(snapped, predicate='intersects').size:
            return None
        return snapped

    for point, feature in controls:
        slot = {'street_lamp': 0, 'traffic_signals': 2, 'bus_stop': 3}.get(feature)
        if slot is None:
            continue
        placed = off_carriageway(point, allow_relocate=(feature in ('traffic_signals', 'bus_stop', 'street_lamp')))
        if placed is None:
            continue
        if feature == 'bus_stop':
            sidewalks.append(placed.buffer(1.5, quad_segs=1))
        store(slot, placed, lambda origin, p=placed: [round((v - o) * 10) for v, o in zip(p.coords[0], origin)])

    for pt in lamp_candidates:
        placed = off_carriageway(pt, allow_relocate=False)
        if placed is not None:
            store(0, placed, lambda origin, p=placed: [round((v - o) * 10) for v, o in zip(p.coords[0], origin)])

    streets = STRtree(surfaces)
    shore = unary_union(water).boundary
    for poly,name,kind in banks:
        if name not in CONFIG['urbanBanks']:
            continue
        ring = poly.exterior
        for dist in np.arange(0,ring.length,2):
            a,b = ring.interpolate(dist),ring.interpolate(min(dist+2,ring.length))
            mid = ring.interpolate((dist+min(dist+2,ring.length))/2)
            if not bounds.contains(mid) or mid.distance(shore)>.25 or bridge.query(mid,predicate='intersects').size:
                continue
            if not carriageway_avoid.is_empty and carriageway_avoid.intersects(LineString([a, b])):
                continue
            if kind=='river' and not streets.query(mid,predicate='dwithin',distance=CONFIG['riverRoadProximity']).size:
                continue
            delta=np.subtract(b.coords[0],a.coords[0]); length=np.linalg.norm(delta)
            if length<.1:
                continue
            normal=np.array([-delta[1],delta[0]])/length
            if poly.contains(Point(mid.coords[0]+normal)):
                normal=-normal
            ground,_=sample(*(mid.coords[0]+3*normal));_,water_y=sample(*(mid.coords[0]-3*normal))
            if water_y==-32768:
                continue
            lengths['bank']+=length
            qa_x, qa_z = round(a.x * 10) / 10.0, round(a.y * 10) / 10.0
            qb_x, qb_z = round(b.x * 10) / 10.0, round(b.y * 10) / 10.0
            if ground_mesh_fn is not None:
                top_dm = round(ground_mesh_fn(qa_x, qa_z) * 10)
                end_dm = round(ground_mesh_fn(qb_x, qb_z) * 10)
            else:
                top_dm = max(round(ground*10)+1,int(water_y)+1)
                end_dm = top_dm
            bot_dm = min(min(top_dm, end_dm) - 12, int(water_y) - 10)
            def segment(origin, ax=qa_x, az=qa_z, bx=qb_x, bz=qb_z, t_dm=top_dm, b_dm=bot_dm, end=end_dm):
                return [round((ax-origin[0])*10), round((az-origin[1])*10), round((bx-origin[0])*10), round((bz-origin[1])*10), t_dm, b_dm, end]
            store(1,mid,segment)

    # Granite stone curb bench-rails & drum bollards around historic banyan crossroads (榕荫路 × 三多路, IMG_1299.jpg)
    ry_r = next((r for r in roads if r.way == 221349761), None)
    sd_r = next((r for r in roads if r.way == 121981960), None)
    if ry_r is not None and sd_r is not None:
        jct_g = ry_r.line.intersection(sd_r.line)
        if not jct_g.is_empty and hasattr(jct_g, 'x'):
            zone_box = jct_g.buffer(26.0)
            gap_avoid = unary_union(gaps).buffer(0.45) if gaps else Polygon()
            rail_avoid = unary_union([
                carriageway_union.intersection(zone_box.buffer(6.0)).buffer(0.58),
                gap_avoid.intersection(zone_box.buffer(6.0)),
            ])
            for h_road in (ry_r, sd_r):
                if not h_road.left and not h_road.right:
                    continue
                for side_sgn, sw_w in ((-1, h_road.left), (1, h_road.right)):
                    if not sw_w:
                        continue
                    curb_off = h_road.line.intersection(zone_box).offset_curve(side_sgn * (h_road.width / 2.0 + 0.72))
                    safe_curb = curb_off.difference(rail_avoid)
                    if not exclude.is_empty:
                        safe_curb = safe_curb.difference(exclude)
                    for part_l in getattr(safe_curb, 'geoms', [safe_curb]):
                        if part_l.is_empty or part_l.geom_type != 'LineString':
                            continue
                        L_p = part_l.length
                        if L_p < 0.7:
                            continue
                        if L_p < 1.9:
                            mp = part_l.interpolate(0.5 * L_p)
                            if (bldg_tree and bldg_tree.query(mp.buffer(0.35), predicate='intersects').size) or (water_tree and water_tree.query(mp, predicate='intersects').size):
                                continue
                            qx, qz = round(mp.x * 10) / 10.0, round(mp.y * 10) / 10.0
                            store(4, mp, lambda origin, ax=qx, az=qz: [round((ax - origin[0]) * 10), round((az - origin[1]) * 10), round((ax - origin[0]) * 10), round((az - origin[1]) * 10)])
                        else:
                            pos_s = 0.25
                            while pos_s + 1.6 <= L_p:
                                pa = part_l.interpolate(pos_s)
                                pb = part_l.interpolate(min(L_p - 0.15, pos_s + 2.0))
                                pm = part_l.interpolate(0.5 * (pos_s + min(L_p - 0.15, pos_s + 2.0)))
                                seg_cand = LineString([pa, pb])
                                if not carriageway_avoid.intersects(seg_cand) and not (bldg_tree and bldg_tree.query(seg_cand.buffer(0.3), predicate='intersects').size) and not (water_tree and water_tree.query(seg_cand, predicate='intersects').size):
                                    qax, qaz = round(pa.x * 10) / 10.0, round(pa.y * 10) / 10.0
                                    qbx, qbz = round(pb.x * 10) / 10.0, round(pb.y * 10) / 10.0
                                    store(4, pm, lambda origin, ax=qax, az=qaz, bx=qbx, bz=qbz: [round((ax - origin[0]) * 10), round((az - origin[1]) * 10), round((bx - origin[0]) * 10), round((bz - origin[1]) * 10)])
                                pos_s += 3.1

    layers=[STRtree(values) for values in (surfaces,sidewalks,stripes,medians,gaps)]
    def encode(tile,origin):
        shapes = [unary_union([layer.geometries[idx].intersection(tile) for idx in sorted(layer.query(tile))]) for layer in layers]
        shapes[1]=shapes[1].difference(shapes[0]).union(shapes[3]).difference(shapes[4])
        shapes[2]=shapes[2].difference(shapes[3])
        if modeled_paving is not None and tile.intersects(modeled_paving):
            shapes[:3]=[shape.difference(modeled_paving) for shape in shapes[:3]]
        items=[]
        for kind,shape in enumerate(shapes[:3]):
            for poly in polygons(shape):
                if poly.area<.005:
                    continue
                items.append([kind,*[np.rint((np.asarray(r.coords)[:-1]-origin)*100).astype(int).tolist() for r in [poly.exterior,*poly.interiors]]])
        ctrl_patch = None
        fx = fixtures[origin]
        if road_ctrl is not None and world_origin is not None and (items or any(fx) or layers[0].query(tile.buffer(24)).size):
            c0 = (origin[0] - world_origin[0]) // 8
            r0 = (origin[1] - world_origin[1]) // 8
            sub = road_ctrl[r0:r0 + 35, c0:c0 + 35]
            base_mm = int(round(float(sub.min()) * 1000))
            deltas = np.rint(sub * 1000 - base_mm).astype(int).ravel().tolist()
            ctrl_patch = [base_mm, deltas]
        out = [items, *fx[:4]]
        if ctrl_patch is not None or fx[4]:
            out.append(ctrl_patch)
        if fx[4]:
            out.append(fx[4])
        return out
    return encode,lengths

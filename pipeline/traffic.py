import gzip
import json
import math
import re
import subprocess
import tempfile
from collections import defaultdict
from functools import lru_cache
from itertools import chain
from pathlib import Path

import numpy as np
from shapely.geometry import LineString, Polygon
from shapely.ops import unary_union
from shapely.prepared import prep

from corridor_objects import relocate
from portal_paving import trim as trim_portal_paving, restore as restore_portal_paving
from portal_routes import permits, routes as portal_routes
from common import OUT, ll2xz, load_osm
from road_tunnels import clear_approach_paving
from station_road_corridor import bake as bake_station_corridor
from surveyed_corridors import bake as bake_surveyed_corridors, restore as restore_corridors
import narrow_streets
import ground_passages
import vehicle_surface_grades
import portal_landings
from vehicle_approaches import cycleway_deck_profile, cycleway_grades, cycleway_street_tie, ring_road_widths, plan as plan_approaches, surface_guides, portal_openings
from vehicle_tunnels import mark_underpasses, mountain_roofs, underground, sections as tunnel_sections, solve as solve_tunnels
from service_streets import mark_drivable_services, width as minor_road_width
from traffic_parking import allowed, bake_parking
from landmarks.jiefang_layout import SPAN_WAYS, deck_level
from landmarks.world_surface import Surface

ROOT = Path(__file__).resolve().parents[1]
MOTOR = {'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'living_street', 'unclassified', 'service', 'busway'}
WALK = {'footway', 'pedestrian', 'path'}
RENDERED_LANE_WAYS = {674460013}  # Longyin Road: OSM has no lane count; GL04 has a painted section.


def number(value, fallback):
    match = re.fullmatch(r'(\d+(?:\.\d+)?)(?:\s*(mph|km/h))?', str(value))
    return float(match[1]) * (1.609344 if match[2] == 'mph' else 1) if match else fallback


def simplify_profile(samples):
    keep = {0,len(samples)-1}
    pending = [(0,len(samples)-1)]
    while pending:
        first,last = pending.pop()
        start,low = samples[first]
        stop,high = samples[last]
        worst,split = .025,None
        for index in range(first+1,last):
            fraction,level = samples[index]
            error = abs(level-(low+(high-low)*(fraction-start)/(stop-start)))
            if error>worst:
                worst,split = error,index
        if split is not None:
            keep.add(split)
            pending.extend(((first,split),(split,last)))
    return [value for index in sorted(keep) for value in samples[index]]


def signal_schedule(lanes, nodes):
    headings = []
    for lane in lanes:
        src, dst = nodes[lane['from']], nodes[lane['to']]
        angle = math.atan2(dst['z']-src['z'], dst['x']-src['x']) % math.pi
        headings.append((angle, lane['id']))
    headings.sort()
    def partition(first):
        wrapped = headings[first:] + [(angle+math.pi, ref) for angle, ref in headings[:first]]
        families = []
        for angle, ref in wrapped:
            if not families or angle-start >= math.pi/4-1e-10:
                families.append([])
                start = angle
            families[-1].append(ref)
        return families
    families = min((partition(first) for first in range(len(headings))), key=len)
    return [dict(lanes=sorted(family),green=18,yellow=3) for family in families]


def align_airport_lane(nodes, lanes, node_height, profile):
    start_ref, end_ref = 3891288847, 3891288846
    way = 385796480
    lane = next((r for r in lanes if (r['way'],r['from'],r['to']) ==
                 (way,start_ref,end_ref)), None)
    if lane is None:
        return
    a,b = nodes[start_ref],nodes[end_ref]
    dx,dz = b['x']-a['x'],b['z']-a['z']
    length = math.hypot(dx,dz)
    dx,dz = dx/length,dz/length
    # The centre of tunnel 385795252's crossing is in projected city metres.
    # Keep 20 cm outside each wheel, and return to the original junction.
    station = (-18814.81-a['x'])*dx+(3934.32-a['z'])*dz
    shoulder = [(-22,0),(-18,.15),(-14,.5),(-10,.85),(-6,1),
                (2,1),(4,.85),(6,.5),(8,.15),(10,0)]
    if station <= 22 or station+10 >= length:
        raise ValueError('Airport upper road survey no longer matches the crossing')
    route = [start_ref]
    for i,(dist,scale) in enumerate(shoulder):
        ref = -4_000_000_000_000-way*100-i
        x = round(a['x']+(station+dist)*dx+.55*scale*dz,2)
        z = round(a['z']+(station+dist)*dz-.55*scale*dx,2)
        nodes[ref] = dict(id=ref,x=x,z=z,y=node_height(x,z,way))
        route.append(ref)
    route.append(end_ref)
    # Keep the incoming lane ID at its original downstream signal.
    for head,tail in zip(route[:-2],route[1:-1],strict=True):
        lanes.append({**lane,'id':len(lanes),'from':head,'to':tail,
                      'heights':profile(head,tail,lane['offset'],way)})
    lane['from'] = route[-2]
    lane['heights'] = profile(route[-2],end_ref,lane['offset'],way)


# Surveyed motor lane centres within the final paved cross-sections.
# (fixed vertex, station, transition start, full shift, return start, end,
# signed lateral shift, distance between the two opposing lane centres)
FACADE_LANES={
    383576398:(2303787983,285.4,264.,278.,290.,310.,-1.43,2.4),
    237982795:(9112786463,630.,592.,604.,616.,628.,1.24,2.30),
}


def facade_alignment(way, coords):
    axis=LineString(coords)
    ref,station,start,full,back,end,shift,_=FACADE_LANES[way['id']]
    ds=np.r_[0.,np.cumsum(np.linalg.norm(np.diff(coords,axis=0),axis=1))]
    refs=dict(zip(ds,way['nodes'],strict=True))
    if ref not in way['nodes'] or abs(ds[way['nodes'].index(ref)]-station)>1:
        raise ValueError(f"Recheck the facade survey for {way['id']}")
    route=[]
    for i,d in enumerate(np.unique(np.r_[ds,np.arange(start,end+1,2.)])):
        pt=axis.interpolate(d)
        lo=np.array(axis.interpolate(max(0,d-.2)).coords[0])
        hi=np.array(axis.interpolate(min(d+.2,axis.length)).coords[0])
        dx,dz=(hi-lo)/np.linalg.norm(hi-lo)
        t=np.clip(min((d-start)/(full-start),(end-d)/(end-back)),0,1)
        offset=shift*t*t*(3-2*t)
        route.append((pt.x-dz*offset,pt.y+dx*offset,refs.get(d,-43_000_000_000_000-way['id']*1000-i)))
    return route


def round_service_corner(way, coords):
    # The car body overhangs both straight road segments at this right-angle
    # bend. Join them with a tangent curve inside the existing asphalt.
    i=way['nodes'].index(4138785723)
    previous,corner,following=np.asarray(coords[i-1:i+2])
    start=corner+4.5*(previous-corner)/np.linalg.norm(previous-corner)
    end=corner+4.5*(following-corner)/np.linalg.norm(following-corner)
    route=[(*xy,ref) for xy,ref in zip(coords,way['nodes'],strict=True)]
    turn=[]
    for j,t in enumerate(np.linspace(0,1,9)):
        point=(1-t)**2*start+2*t*(1-t)*corner+t*t*end
        turn.append((*point,way['nodes'][i] if j==4 else -44_000_000_000_000-j))
    return route[:i]+turn+route[i+1:]


# Retain the native Dingjiang road design until the underpass is built in IDOK-247.
DINGJIANG_NATIVE = {1030049241, 727929887, 459580311, 815078158}
DINGJIANG_MOUTHS = {6821480678:727929887, 6821524191:727929887}


def native_dingjiang_lanes(graph_path, elements):
    # A full world build applies the native railway road profiles after traffic.
    # A traffic-only rebake starts from those finished profiles. Match by OSM
    # endpoints because the lane IDs differ between the two traffic graphs.
    if not graph_path.exists():
        return {}
    pairs = {(a,b) for w in elements if w['type']=='way' and w['id'] in DINGJIANG_NATIVE
             for a,b in zip(w['nodes'],w['nodes'][1:])}
    graph = json.loads(gzip.decompress(graph_path.read_bytes()))
    return {(lane['from'],lane['to']): {k:lane[k] for k in ('offset','floor','heights') if k in lane}
            for lane in graph['lanes'] if (lane['from'],lane['to']) in pairs or (lane['to'],lane['from']) in pairs}


def bake_after_roads(output, manifest, rendered_roads, station_ways):
    import copy
    import shutil
    ways = [way for way in station_ways if way['id'] in DINGJIANG_NATIVE]
    with tempfile.TemporaryDirectory() as tmp:
        directory = Path(tmp)
        native = copy.deepcopy(manifest)
        for tile in native['chunks']:
            shutil.copyfile(output/tile['file'],directory/tile['file'])
        bake(output, manifest, rendered_roads, native_surface=(directory, native, ways))


def bake(output, manifest, rendered_roads=None, *, native_surface=None):
    from shapely.geometry import box
    left, top, width, depth = manifest['extent']
    native_world = rendered_roads is not None
    if rendered_roads is None:
        from features import raw_overture_footprints
        from scatter import extract_road_network
        bounds = box(left, top, left+width, top+depth)
        rendered_roads = extract_road_network(raw_overture_footprints(bounds))[1]
    region = prep(Polygon(manifest['region']['local'])) if 'region' in manifest else None
    carriageways = {road.way: road for road in rendered_roads if road.way in RENDERED_LANE_WAYS}
    surface = Surface(output, manifest)
    bridge = next((entry for entry in manifest['landmarks'] if entry['id'] == 'jiefang_bridge'), None)

    @lru_cache(maxsize=96)
    def original_grid(key):
        data = gzip.decompress((output/surface.files[key]).read_bytes())
        return np.frombuffer(data, '<i2', 65*65, 24).reshape(65,65)

    def node_height(x,z,way):
        if way in SPAN_WAYS:
            return height(x,z,way)
        key = (math.floor(x/256)*256,math.floor(z/256)*256)
        return float(original_grid(key)[round((z-key[1])/4),round((x-key[0])/4)])/10

    def height(x, z, way):
        if bridge and way in SPAN_WAYS:
            bx, by, bz = bridge['position']
            angle = math.radians(-bridge['rotation'])
            return round(by + float(deck_level((x-bx)*math.cos(angle)+(z-bz)*math.sin(angle))), 2)
        return surface.sample(max(left,min(left+width,x)), max(top,min(top+depth,z)), include_peaks=False)[0]

    def profile(head, tail, offset, way):
        start, end = nodes[head], nodes[tail]
        east, south = end['x']-start['x'], end['z']-start['z']
        length = math.hypot(east, south)
        x = start['x']-south/length*offset
        z = start['z']+east/length*offset
        fractions = {0.,1.}
        for origin, delta, axis in ((x,east,True),(z,south,True),(x+z,east+south,False)):
            lo, hi = sorted((origin,origin+delta))
            for line in range(math.floor(lo/4)+1,math.ceil(hi/4)):
                fraction = round((4*line-origin)/delta,10)
                fractions.add(fraction)
                if axis and line%64==0:
                    fractions.update((max(0,round(fraction-1e-9,10)),min(1,round(fraction+1e-9,10))))
        samples = []
        for fraction in sorted(fractions):
            y = round(height(x+east*fraction,z+south*fraction,way),2)
            samples.append((fraction,y))
        return simplify_profile(samples)

    def add_walk(head, tail, offset, way, linear):
        walk = [head,tail,offset,len(walks)]
        if not linear:
            walk.append(profile(head,tail,offset,way))
        walks.append(walk)

    registry = (ROOT/'web/src/game/quiet-zones.ts').read_text().split('QuietZonePolygon[] = ', 1)[1].split(' as const', 1)[0]
    quiet = json.loads(registry)
    banned = [Polygon(zone['polygon']).buffer(5) for zone in quiet]
    for zone in json.loads((ROOT/'web/src/game/car-free-polygons.json').read_text()):
        shell, *holes = zone['rings']
        banned.append(Polygon(shell, holes))
    forbidden = prep(unary_union(banned))
    nodes, lanes, walks, incoming = {}, [], [], defaultdict(list)
    elements = load_osm()
    dest = output/'roads'/'graph.json.gz'
    native_lanes = {} if native_world else native_dingjiang_lanes(dest, elements)
    mark_underpasses(elements)
    # Legacy expanded worlds carry the original continuous surface street
    # through both open Wuling cuttings, above the actual tunnel floor.
    clear_approach_paving(output,manifest['chunks'],[t for t in manifest.get('tunnels',[]) if t['way']==237985762])
    garage=ground_passages.garage_boundary(output,manifest["chunks"],elements)
    garage_curbs=[]
    parking_segments = []
    from dingjiang_paving import complete_merge_pavement
    complete_merge_pavement(output, manifest, elements)
    sections = {road['way']:road['width'] for road in json.loads((output/'street-report.json').read_text())}
    restore_portal_paving(output,manifest['chunks'])
    restore_corridors(output,manifest['chunks'])
    from canal_passages import plan as plan_canal_passages, sample_road_heights
    from terminal_decks import grade as grade_terminal_decks, grade_airport_fork, grade_service_overpass, trim_bridge_endcaps
    ground_passages.close_qingtian_road(elements,sections,garage_curbs)
    ground_passages.grain_yard(output,manifest,elements,sections)
    clearances=narrow_streets.classify(output,manifest['chunks'],elements,MOTOR,sections)
    narrow_ways={row['way']:row['alignment'] for row in clearances}
    (output/'vehicle-narrow-streets.json').write_text(json.dumps(clearances))
    grade_airport_fork(output,manifest,elements)
    from crossing_spans import grade_crossings
    from terminal_decks import complete_lower_paving
    complete_lower_paving(output, manifest, elements)
    terminal_grades = grade_terminal_decks(output, manifest, elements)
    terminal_grades.extend(grade_crossings(output, manifest, elements, sections))
    canal_grades = plan_canal_passages(output, manifest, elements, sections)
    from canal_east import plan as plan_east_canal
    east_canal,continuous_canal=plan_east_canal(output,manifest,elements,sections,canal_grades)
    graded_sections,grade_points=vehicle_surface_grades.stations(elements,sections,box(left,top,left+width,top+depth))
    native_levels=sample_road_heights(output,manifest,grade_points)
    bake_station_corridor(output, manifest['chunks'], elements)
    bake_surveyed_corridors(output,manifest['chunks'],elements,sections)
    from dingjiang_structures import motorway_sections
    from rail_sections import motorway_sections as graded_motorways
    # Append the modeled motorway segments after the existing network so every
    # pre-existing lane keeps its ID in graph.json.gz and all streaming cells.
    existing = (way for way in elements if way.get('tags', {}).get('highway')
                not in ('motorway', 'motorway_link'))
    for way in chain(existing, motorway_sections(elements), graded_motorways(elements)):
        tags = way.get('tags', {})
        linear = way['id'] not in SPAN_WAYS and (tags.get('bridge','no')!='no' or underground(way))
        kind = tags.get('highway', '').removesuffix('_link')
        if way['type'] != 'way' or kind not in MOTOR | WALK | {'cycleway','motorway'} or tags.get('area') == 'yes' or (tags.get('access') in ('no', 'private') and way['id'] not in ground_passages.YARD_ROADS):
            continue
        refs = way['nodes']
        coords = [ll2xz(pt['lat'], pt['lon']) if pt else None for pt in way['geometry']]
        direction = tags.get('oneway', 'yes' if tags.get('junction') == 'roundabout' else 'no')
        single = direction in ('yes', '1', 'true', '-1')
        bridge_motor = way['id'] in SPAN_WAYS and kind in MOTOR
        fallback = 3 if bridge_motor else 1 if single or kind in WALK or kind == 'residential' else 2
        count = max(1, min(12, int(number(tags.get('lanes'), fallback))))
        size = min(4, max(2, number(tags.get('width'), count*(3.7 if bridge_motor else 3))/count))
        paved = sections.get(way['id'], number(tags.get('width'), {'tertiary':10,'residential':6}.get(kind, 3)))
        section = carriageways.get(way['id'])
        if single and section and 'lanes' not in tags and not bridge_motor:
            count, paved = section.lanes, section.width
            size = paved/count
        if kind == 'residential' and 'lanes' not in tags:
            paved = number(tags.get('width'), 6.5)
        curb = 0
        curb_sign = -1 if direction == '-1' else 1
        if (kind == 'residential' and 1 <= count <= 2 and paved >= 3*count+2.1 and
                allowed(tags, 'right' if curb_sign > 0 else 'left', kind)):
            curb = min(2.4, paved-3*count)
            size = (paved-curb)/count
        narrow=way['id'] in narrow_ways
        two_wheel_modes=[m for m in ('bike','bicycle') if permits(tags,m)] if narrow or kind=='cycleway' else []
        if narrow:
            narrow_streets.end_curbs(LineString(coords),paved,garage_curbs)
        alignment=way
        if way['id'] in FACADE_LANES or way['id']==412456970:
            route=(facade_alignment(way,coords) if way['id'] in FACADE_LANES
                   else round_service_corner(way,coords))
            coords=[(x,z) for x,z,_ in route]
            alignment=dict(way,nodes=[ref for _,_,ref in route])
        if narrow:
            route=narrow_ways[way['id']]
            coords=[(x,z) for x,z,_ in route]
            alignment=dict(way,nodes=[ref for _,_,ref in route])
        for start,end,start_id,end_id in ground_passages.open_segments(alignment,coords,garage,garage_curbs,paved):
            if not start or not end or not all(left <= x < left+width and top <= z < top+depth for x,z in (start,end)):
                continue
            if region and not region.covers(LineString([start,end]).buffer(count*size/2+2)):
                continue
            length = math.dist(start,end)
            if length < .5:
                continue
            for ref, (x,z) in zip((start_id,end_id),(start,end)):
                if ref not in nodes:
                    nodes[ref] = dict(id=ref,x=round(x,2),z=round(z,2),y=node_height(x,z,way['id']))
            if any(nodes[ref]['y'] is None for ref in (start_id,end_id)):
                continue
            if narrow:
                if permits(tags,'foot'):
                    add_walk(start_id,end_id,0,way['id'],linear)
                if two_wheel_modes:
                    for sign,head,tail in ((1,start_id,end_id),(-1,end_id,start_id)):
                        modes=[]
                        for mode in two_wheel_modes:
                            rule=tags.get('oneway:bicycle',direction)
                            if mode=='bike':
                                rule=tags.get('oneway:electric_bicycle',rule)
                            if (rule=='-1' and sign>0) or (rule in ('yes','true','1') and sign<0):
                                continue
                            modes.append(mode)
                        if not modes:
                            continue
                        lanes.append(dict(id=len(lanes),**{'from':head},to=tail,width=min(paved,2.22),
                                          offset=0,kind='nonmotor',cls=kind,way=way['id'],speedKmh=10,
                                          modes=modes,oneway=single,heights=profile(head,tail,0,way['id'])))
                        incoming[tail].append(lanes[-1])
                continue
            if kind in WALK:
                add_walk(start_id,end_id,0,way['id'],linear)
                continue
            if kind in MOTOR and tags.get('sidewalk') in ('left','right','both'):
                for side in (-1,1):
                    if tags['sidewalk'] in ('both','left' if side<0 else 'right'):
                        add_walk(start_id,end_id,side*(count*size/2+1),way['id'],linear)
            if way['id'] not in ground_passages.YARD_ROADS and not (two_wheel_modes if kind=='cycleway' else permits(tags,'car')):
                continue
            if forbidden.intersects(LineString([start,end]).buffer(count*size/2+2)):
                continue
            for sign in ([-1] if direction=='-1' else [1] if single else [1,-1]):
                head, tail = (start_id,end_id) if sign==1 else (end_id,start_id)
                n = count if single else max(1, count//2 if sign==-1 else (count+1)//2)
                shift = -curb_sign*sign*curb/2
                outer = ((n-.5-(count/2 if single else 0))*size if count>1 else 0) + size/2 + shift
                if way['id'] not in ground_passages.YARD_ROADS:parking_segments.append((head, tail, way['id'], tags, kind, sign, outer, paved/2))
                for slot in range(n):
                    offset = (slot+.5-(count/2 if single else 0))*size if count>1 else 0
                    offset += shift
                    if way['id'] in FACADE_LANES:
                        offset=FACADE_LANES[way['id']][-1]/2
                    if not linear and kind in ('service', 'living_street'):
                        # The renderer uses a 3 m or 4 m strip for unsigned minor
                        # streets. Keep the outer contact 20 cm inside that strip.
                        limit = max(0, minor_road_width(tags)/2-.795-.21)
                        offset = max(-limit, min(limit, offset))
                    if kind=='cycleway' and not linear:
                        # Both directions share the mapped strip. Keep the
                        # outside wheel and its curb clearance on that strip.
                        limit=max(0,paved/2-.795-.21)
                        offset=max(-limit,min(limit,offset))
                    if bridge and kind=='cycleway' and way['id'] in SPAN_WAYS:
                        # On the river span the cycle stripe is between the
                        # 12 m divider and the 16.1 m carriageway edge.
                        angle=math.radians(bridge['rotation'])
                        sin,cos=math.sin(angle),math.cos(angle)
                        bx,_,bz=bridge['position']
                        a,b=nodes[head],nodes[tail]
                        lateral=((a['x']+b['x'])/2-bx)*sin+((a['z']+b['z'])/2-bz)*cos
                        normal=(-(b['z']-a['z'])*sin+(b['x']-a['x'])*cos)/length
                        if abs(normal)>.9:
                            offset=(math.copysign(14.05,lateral)-lateral)/normal
                    lane = dict(id=len(lanes), to=tail, width=size, offset=round(offset,2), kind='nonmotor' if kind=='cycleway' else 'bus' if kind=='busway' else 'motor',speedKmh=number(tags.get('maxspeed'),20 if kind in ('cycleway','service') else 40),oneway=single)
                    if way['id'] in ground_passages.YARD_ROADS:lane['privateAccess']=True
                    if kind=='cycleway':lane['modes']=two_wheel_modes
                    lane['from'] = head
                    lane['cls'] = kind
                    lane['way'] = way['id']
                    if linear:
                        lane['structure'] = 'tunnel' if underground(way) else 'bridge'
                    if not linear:
                        lane['heights'] = profile(head,tail,lane['offset'],way['id'])
                    if linear or way['id'] in SPAN_WAYS:
                        lane['gradeSeparated'] = 'linear' if linear else 'jiefang'
                    lanes.append(lane)
                    incoming[tail].append(lane)

    signals = []
    remaining = {element['id'] for element in elements if element['type']=='node'
                 and element.get('tags',{}).get('highway')=='traffic_signals' and element['id'] in incoming}
    while remaining:
        group = [min(remaining)]
        remaining.remove(group[0])
        for ref in group:
            nearby = sorted(other for other in remaining if
                            math.hypot(nodes[ref]['x']-nodes[other]['x'],nodes[ref]['z']-nodes[other]['z'])<=45)
            remaining.difference_update(nearby)
            group.extend(nearby)
        schedule = signal_schedule((lane for ref in group for lane in incoming[ref]), nodes)
        signals.extend(dict(node=ref,group=group[0],offset=group[0]%31,phases=schedule) for ref in group)
    # Mark the unbuilt crossing and its immediate landings for native player
    # support too. The bounds carry actual lane heights to distinguish decks.
    manifest['nativeCarLandings'] = []
    landing_pairs = set()
    landing_probes = []
    landing_ranges = []
    for lane in lanes:
        pair = tuple(sorted((lane['from'],lane['to'])))
        if lane['way'] not in DINGJIANG_NATIVE or pair in landing_pairs:
            continue
        a, b = nodes[lane['from']], nodes[lane['to']]
        if a['id'] not in DINGJIANG_MOUTHS and b['id'] not in DINGJIANG_MOUTHS:
            continue
        landing_pairs.add(pair)
        count = math.ceil(math.hypot(b['x']-a['x'], b['z']-a['z']) / 4)
        start = len(landing_probes)
        for fraction in np.linspace(0, 1, count+1):
            landing_probes.append(dict(x=a['x']+(b['x']-a['x'])*fraction,
                                       z=a['z']+(b['z']-a['z'])*fraction, way=lane['way']))
        landing_ranges.append((start, start+count, abs(lane['offset'])+lane['width']/2+.5))
    if landing_probes:
        levels = sample_road_heights(output, manifest, landing_probes)
        for start, end, width_limit in landing_ranges:
            for i in range(start, end):
                p, q = landing_probes[i:i+2]
                manifest['nativeCarLandings'].append([p['x'],p['z'],levels[i],
                                                      q['x'],q['z'],levels[i+1],width_limit])
    ground_passages.set_terminal_stops(nodes,lanes,node_height,profile)
    align_airport_lane(nodes, lanes, node_height, profile)
    result = dict(nodes=[node for node in nodes.values() if node['y'] is not None],lanes=lanes,signals=signals,quiet=quiet,walks=walks)
    dest.parent.mkdir(exist_ok=True)
    if native_surface is not None:
        from station_roads import sample_lane_profiles
        directory, native_manifest, ways = native_surface
        originals = [lane for lane in lanes if lane['way'] in DINGJIANG_NATIVE]
        changes = sample_lane_profiles(directory, native_manifest, ways, dict(nodes=result['nodes'], lanes=originals))
        for lane in originals:
            if str(lane['id']) in changes:
                native_lanes[lane['from'],lane['to']] = {**{k:lane[k] for k in ('offset','heights') if k in lane}, **changes[str(lane['id'])]}
    with tempfile.TemporaryDirectory() as tmp:
        request = Path(tmp)/'request.json'
        original_tunnels = [t for t in manifest.get('tunnels',[]) if not t.get('generated')]
        manifest['tunnels'] = original_tunnels
        survey_nodes = dict(nodes)
        updated_lanes = [lane for lane in lanes if lane['way'] not in DINGJIANG_NATIVE]
        network = tunnel_sections(updated_lanes,elements,original_tunnels,survey_nodes)
        graded_links = set()
        if network['edges']:
            mountain_roofs(network,survey_nodes,surface.peaks)
            bridge_nodes=[];bridge_samples=[]
            # The east service bridge cannot propagate its cut into the accepted
            # west canal road. Keep that road on its own surveyed bridge grade.
            for way in elements:
                if way['type']!='way' or way['id'] not in (988474372,347655716,815075448,882767818,835693641):continue
                coords=ground_passages.points(way)
                for i,j in ((0,1),(-1,-2)):
                    ref=way['nodes'][i]
                    if ref not in survey_nodes:continue
                    x,z=coords[i];u,v=coords[j]
                    bridge_nodes.append(ref);bridge_samples.append(dict(x=x,z=z,bridge=[u-x,v-z]))
            bridge_levels=sample_road_heights(output,manifest,bridge_samples) if bridge_samples else []
            alley_tie=13919458302
            if alley_tie in survey_nodes:
                pt=survey_nodes[alley_tie]
                h=sample_road_heights(output,manifest,[dict(x=pt['x'],z=pt['z'],way=1527450562)])[0]
                bridge_nodes.append(alley_tie)
                bridge_levels.append(h)
            guides=surface_guides(elements,[*network['portals'],*bridge_nodes],survey_nodes,manifest['chunks'])
            request.write_text(json.dumps(dict(manifest=manifest,network=network,nodes=list(survey_nodes.values()),guideNodes=sorted({g[k] for g in guides for k in ('from','to')}))))
            subprocess.run([str(ROOT/'node_modules/.bin/tsx'),str(ROOT/'scripts/vehicle-grounding.ts'),
                            'portals',str(output.resolve()),str(request)],check=True,cwd=ROOT)
            samples=json.loads(request.read_text())
            cycleway=cycleway_deck_profile(output,manifest,elements,network,sections)
            if cycleway:samples['approachLimits']={cycleway[0]:cycleway[3][0]}
            generated,conflicts = solve_tunnels(network,survey_nodes,samples)
            fixed={ref for way in elements if way['type']=='way' and way.get('tags',{}).get('railway')=='rail'
                   and way['tags'].get('layer','0')=='0' for ref in way['nodes']}
            # Propagate the measured bridge lip into the land-side road network
            # when a single short OSM segment cannot absorb the height change.
            anchors=[dict(node=n,floor=h,approachCut=True) for n,h in zip(bridge_nodes,bridge_levels,strict=True)]
            approach_widths=ring_road_widths(elements,sections)
            # An approach belongs to its active portal. In particular the far
            # end of 1030049241 still serves 1030049246, outside Dingjiang.
            access,limits,graded_links=plan_approaches(conflicts+anchors,lanes+guides,survey_nodes,
                {int(k):v for k,v in samples['heights'].items()},fixed,approach_widths)
            cycling=cycleway_grades(cycleway,conflicts)
            access=cycling+access
            surveyed=vehicle_surface_grades.profiles(graded_sections,native_levels,access+canal_grades+terminal_grades)
            from pedestrian_approaches import profiles as path_profiles, footbridge_landing
            planned=access+canal_grades+terminal_grades+surveyed
            landing=footbridge_landing(output,manifest,elements,planned)
            pedestrian=landing+path_profiles(output,manifest,elements,sections,planned+landing)
            pedestrian+=cycleway_street_tie(output,manifest,elements,sections,cycleway)
            from junction_grades import profiles as junction_profiles
            pedestrian+=junction_profiles(output,manifest,elements,sections,planned)
            from terminal_decks import pickup_merge
            pedestrian+=pickup_merge(output,manifest,elements,terminal_grades)
            from local_junctions import profiles as connected_profiles
            pedestrian+=connected_profiles(output, manifest, elements, sections, planned+pedestrian)
            pedestrian+=east_canal
            bake_surveyed_corridors(output,manifest['chunks'],elements,sections,planned+pedestrian,only_approaches=True,bridge_profiles=canal_grades,preferred=pedestrian+cycling,continuous=continuous_canal)
            trim_portal_paving(output,manifest['chunks'],generated,elements,sections)
            for tunnel in generated:
                tunnel['gradedAccess']=True
            portal_openings(generated,elements,approach_widths)
            portal_landings.bake(output,manifest,generated,elements)
            conflicts.extend(limits)
            manifest['tunnels'] = original_tunnels+generated
            request.write_text(json.dumps(dict(manifest=manifest,nodes=list(survey_nodes.values()),constraints=conflicts,pedestrianNodes=sorted({g[k] for g in guides if g['surfaceKind']==1 for k in ('from','to')}))))
            subprocess.run([str(ROOT/'node_modules/.bin/tsx'),str(ROOT/'scripts/vehicle-grounding.ts'),
                            'portal-check',str(output.resolve()),str(request)],check=True,cwd=ROOT)
            (output/'vehicle-tunnel-grades.json').write_bytes(request.read_bytes())
        ground_passages.bake(output,manifest,elements,sections,garage_curbs)
        ground_passages.level_soffits(output,manifest,elements,sections)
        from verge_crossings import open_verges
        open_verges(output,manifest,elements,sections)
        portal_landings.carriageways(output,manifest,elements,sections)
        grade_service_overpass(output,manifest,elements)
        from terminal_decks import grade_airport_ramp_merge, grade_zhongshan_merge
        grade_zhongshan_merge(output,manifest,elements)
        grade_airport_ramp_merge(output,manifest,elements)
        trim_bridge_endcaps(output,manifest,elements)
        portal_landings.ground_ties(output,manifest,elements)
        road_tiles=[tile for tile in manifest['chunks'] if tile.get('gradedCorridor')]
        request.write_text(json.dumps([tile['file'] for tile in road_tiles]))
        packed=subprocess.run(['node',str(ROOT/'scripts/simplify-roadbeds.mjs'),str(output.resolve()),
                               str(request.resolve())],check=True,capture_output=True,text=True,cwd=ROOT)
        sizes=json.loads(packed.stdout)
        for tile in road_tiles:
            if tile['file'] in sizes:
                tile['bytes']=sizes[tile['file']]
        from sitang_profile import install as install_sitang
        raised, adjoining = install_sitang(output, manifest, elements)
        if network['edges']:
            route_file=output/'vehicle-portal-routes.json'
            yard_routes=[]
            for way in elements:
                if way['type']!='way' or way['id'] not in ground_passages.YARD_ROADS:continue
                route=[[x,z,way['id']] for x,z in ground_passages.points(way)]
                if not all(left<=x<left+width and top<=z<top+depth for x,z,_ in route):continue
                modes=[dict(mode='car',direction='in',route=route),dict(mode='car',direction='out',route=route[::-1])]
                if 'openStations' in way:
                    axis=LineString(ground_passages.points(way));modes=[]
                    for index,(lo,hi) in enumerate(way['openStations']):
                        piece=ground_passages.substring(axis,lo,hi)
                        xy=list(piece.coords)
                        if index:xy.reverse()
                        modes.append(dict(mode='car',direction=('in','out')[index],boundary=True,
                                          route=[[x,z,way['id']] for x,z in xy]))
                yard_routes.append(dict(id=way['id'],way=way['id'],modes=modes))
            route_file.write_text(json.dumps(dict(manifest=manifest,routes=portal_routes(elements,network,survey_nodes,DINGJIANG_MOUTHS),yardRoutes=yard_routes,narrowRoutes=narrow_streets.driving_sites(elements,clearances,permits),campusRoutes=ground_passages.campus_boundary_routes(elements))))
            subprocess.run([str(ROOT/'node_modules/.bin/tsx'),str(ROOT/'scripts/vehicle-grounding.ts'),
                            'portal-routes',str(output.resolve()),str(route_file.resolve())],check=True,cwd=ROOT)
        print('Roadside relocations:',relocate(output,manifest,elements,raised,adjoining))
        from junction_grades import align_service_junction
        align_service_junction(nodes,lanes,elements,node_height,profile)
        request.write_text(json.dumps(dict(manifest=manifest,nodes=result['nodes'],lanes=lanes),separators=(',',':')))
        subprocess.run([str(ROOT/'node_modules/.bin/tsx'),str(ROOT/'scripts/vehicle-grounding.ts'),
                        'bake',str(output.resolve()),str(request)], check=True, cwd=ROOT)
        for lane, pose in zip(lanes,json.loads(request.read_text()),strict=True):
            a,b = sorted((lane['from'],lane['to']))
            if lane['way'] in DINGJIANG_NATIVE and (a,b,lane['way']) not in graded_links:
                native = native_lanes.get((lane['from'],lane['to']))
                if native is not None:
                    lane.pop('heights', None)
                    lane.update(native)
            elif pose is not None:
                lane.update(pose)
    headroom = {}
    for tunnel in manifest.get('tunnels', []):
        wid = tunnel['way']
        headroom[wid] = min(headroom.get(wid, math.inf), tunnel['clearance'])
    for lane in lanes:
        if lane.get('structure') == 'tunnel' and lane['way'] in headroom:
            lane['clearance'] = headroom[lane['way']]
    dest.write_bytes(gzip.compress(json.dumps(result, ensure_ascii=False, separators=(',',':')).encode(),mtime=0))
    # A halo contains all spawn and retention candidates until the next cell loads.
    cells = defaultdict(lambda: dict(lanes=[],walks=[],refs=set()))
    for collection in ('lanes','walks'):
        for item in result[collection]:
            refs = (item['from'],item['to']) if collection=='lanes' else item[:2]
            if collection=='lanes' and item.get('floor'):
                item={k:v for k,v in item.items() if k not in ('heights','way','structure','gradeSeparated')}
            center = [(nodes[refs[0]][axis]+nodes[refs[1]][axis])/2 for axis in ('x','z')]
            for col in range(math.floor((center[0]-260)/512),math.floor((center[0]+260)/512)+1):
                for row in range(math.floor((center[1]-260)/512),math.floor((center[1]+260)/512)+1):
                    cell=cells[col,row]
                    cell[collection].append(item);cell['refs'].update(refs)
    for (col,row),cell in cells.items():
        refs=cell.pop('refs');cell['nodes']=[nodes[ref] for ref in sorted(refs)]
        cell['signals']=[signal for signal in signals if signal['node'] in refs]
        (dest.parent/f'{col}_{row}.json.gz').write_bytes(gzip.compress(json.dumps(cell,separators=(',',':')).encode(),mtime=0))
    (dest.parent/'cells.json').write_text(json.dumps([f'{col}_{row}' for col,row in sorted(cells)]))
    print('Traffic:', {key:len(value) for key,value in result.items()}, dest.stat().st_size, 'bytes')
    mark_drivable_services(output,elements,lanes)
    bake_parking(output, parking_segments, elements, nodes, forbidden, height)


if __name__ == '__main__':
    path = Path(OUT)
    manifest=json.loads((path/'manifest.json').read_text())
    bake(path,manifest)
    (path/'manifest.json').write_text(json.dumps(manifest,separators=(',',':'))+'\n')

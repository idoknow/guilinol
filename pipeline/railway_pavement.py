"""Fill missing drivable pavement on rail crossings and their approaches."""
import gzip
import json
import struct
from collections import defaultdict
from pathlib import Path

import numpy as np
from shapely import LineString, Point, Polygon, STRtree, box, make_valid, union_all
from shapely.affinity import translate
from shapely.ops import substring

from common import ll2xz, load_osm
from features import points
from road_profile import RULES
from service_streets import rings, width


def bake(directory, chunks, graded=None, tunnels=()):
    inventory = json.loads((Path(__file__).resolve().parents[1]/'docs/railway-crossings.json').read_bytes())
    sites = defaultdict(list)
    for row in inventory:
        if row['type'] in ('level','rail_over') and all(row['roadTags'].get(k,'no')=='no' for k in ('bridge','tunnel')):
            sites[row['road']].append(Point(ll2xz(row['lat'],row['lon'])))
    shapes, landings = [], []
    daylight = {node for t in tunnels if t.get('openCut')
                for node,mouth in zip(t['nodes'],t['mouths']) if mouth}
    elements = load_osm()
    from features import area
    footprints = [area(w) for w in elements if w.get('tags',{}).get('building') and
                  w['type']=='way' and len(w.get('geometry',()))>=4]
    buildings = STRtree(footprints)
    bridge_nodes = {node for w in elements if w['type']=='way' and w.get('tags',{}).get('highway')
                    and w['tags'].get('bridge','no')!='no' and len(w['nodes'])>=2
                    for node in (w['nodes'][0],w['nodes'][-1])}
    for way in elements:
        if way['type']!='way' or not way.get('tags',{}).get('highway') or len(way.get('geometry',()))<2:
            continue
        tags = way['tags']
        # The city road layer also omits motorway carriageways and slip roads.
        # Regraded stretches need asphalt supported by the fitted road grid.
        missing_layer = tags['highway'] in ('service','unclassified','living_street','motorway','motorway_link')
        graded_road = graded is not None and missing_layer and all(
            tags.get(k,'no')=='no' for k in ('bridge','tunnel')) and tags.get('access') not in ('no','private')
        if way['id'] not in sites and not graded_road:
            continue
        if tags['highway'] in ('footway','cycleway','steps','path','pedestrian'):
            continue
        lanes = tags.get('lanes','')
        single = tags.get('oneway') in ('yes','1','true','-1') or tags.get('junction')=='roundabout'
        inferred_width = 3. if single or tags['highway']=='residential' else 6.
        lane_width = int(lanes)*RULES['laneWidth'] if lanes.isdecimal() else inferred_width
        road_width = max(width(tags),lane_width,
                         RULES['defaultWidth'].get(tags['highway'],0.))
        center = LineString(points(way))
        for node,xy in zip(way['nodes'],center.coords):
            if node in daylight:
                at = center.project(Point(xy))
                landing = substring(center,max(0,at-20),min(center.length,at+20))
                landings.append(landing.buffer(min(road_width,lane_width)/2,cap_style='flat'))
        segments = []
        for site in sites.get(way['id'],()):
            at = center.project(site)
            segments.append(substring(center,max(0.,at-60),min(center.length,at+60)))
        if graded_road:
            coords = np.asarray(center.coords)
            for a,b in zip(coords,coords[1:]):
                if graded.affects_carriageway(a,b,road_width/2):
                    segments.append(LineString([a,b]))
        for segment in segments:
            face = segment.buffer(road_width/2,cap_style='flat')
            # Join consecutive road sections through the wheel turning area.
            # At a bridge, only overlap the quantized deck edge by 10 cm.
            bridge_ends = {tuple(center.coords[k]) for k in (0,-1) if way['nodes'][k] in bridge_nodes}
            for k,j in ((0,1),(-1,-2)):
                point = Point(segment.coords[k])
                if tuple(segment.coords[k]) not in bridge_ends:
                    face = face.union(point.buffer(road_width/2))
                    continue
                outward = np.subtract(segment.coords[k],segment.coords[j])
                length = np.linalg.norm(outward)
                if length>.01:
                    extended = translate(face,*(outward*.10/length))
                    face = face.union(extended.intersection(point.buffer(road_width)))
            occupied = buildings.query(face,predicate='intersects')
            if len(occupied):
                face = face.difference(union_all([make_valid(footprints[i]) for i in occupied]))
            if not face.is_empty:
                shapes.append(face)
    # The axle on a surface lane can enter a bore before the vehicle centre.
    # Share a short asphalt landing across each open surface-to-tunnel seam.
    from station_levels import UNDERPASS
    for tunnel in tunnels:
        if 'nodes' not in tunnel and tunnel['way']!=UNDERPASS:
            continue
        for end,mouth in enumerate(tunnel.get('mouths',(True,True))):
            if not mouth:
                continue
            a,b = np.asarray(tunnel['portals'])[[end,1-end]][:,[0,2]]
            tangent = b-a
            tangent /= np.linalg.norm(tangent)
            landing = LineString([a-3*tangent,a+3*tangent])
            shapes.append(landing.buffer(tunnel['halfWidth'],cap_style='flat'))
    # Preserve the open approaches when a newly paved service road runs
    # alongside a cutting. At a daylight mouth the two road edges meet.
    cuts = []
    for tunnel in tunnels:
        if not tunnel.get('openCut'):
            continue
        axis = LineString([(x,z) for x,_,z in tunnel['portals']])
        cuts.append(axis.buffer(tunnel['halfWidth'],cap_style='flat'))
    cut_tree = STRtree(cuts)
    new_pavement = []
    tree = STRtree(shapes)
    landing_tree = STRtree(landings)
    for tile in chunks:
        x,z = tile['x'],tile['z']
        bounds = box(x,z,x+256,z+256)
        hits = tree.query(bounds,predicate='intersects')
        if not len(hits):
            continue
        pavement = union_all([shapes[i] for i in hits]).intersection(bounds)
        cut_hits = cut_tree.query(bounds,predicate='intersects')
        if len(cut_hits):
            pavement = pavement.difference(union_all([cuts[i] for i in cut_hits]))
        local = translate(pavement,-x,-z)
        file = directory/tile['file']
        data = gzip.decompress(file.read_bytes())
        vertices,indices,size = struct.unpack_from('<3I',data,4)
        start = 24+16900+9*vertices+4*indices
        collision = json.loads(data[start:start+size])
        streets = collision[1]
        lower = streets[11] if len(streets)>11 else None
        end = lower[0] if lower else len(streets[0])
        existing = [make_valid(Polygon(np.array(shell)/100,[np.array(r)/100 for r in holes])) if len(shell)>=3 else Polygon()
                    for kind,shell,*holes in streets[0][:end]]
        missing = local.difference(union_all(existing))
        # Where a daylight lane crosses a sidewalk polygon the old paving mask
        # left a hole between two raised asphalt strips. Continue the motor
        # strip along its OSM axis and rebuild the curb at its actual edge.
        landing_hits = landing_tree.query(bounds,predicate='intersects')
        sidewalk = None
        if len(landing_hits):
            inset = translate(union_all([landings[i] for i in landing_hits]),-x,-z).intersection(local)
            walk = [poly for poly,ring in zip(existing,streets[0][:end]) if ring[0] in (1,4,6)]
            motor = [poly for poly,ring in zip(existing,streets[0][:end]) if ring[0] in (0,5)]
            sidewalk = inset.intersection(union_all(walk)).difference(union_all(motor))
            missing = missing.union(sidewalk)
        if missing.is_empty:
            continue
        blocks = [make_valid(Polygon(np.asarray(loops[0])/100,[np.asarray(r)/100 for r in loops[1:]]))
                  for _,_,loops,*_ in collision[0] if loops and len(loops[0])>=3]
        if blocks:
            missing = missing.difference(union_all(blocks))
        patches = list(rings(0,missing))
        if not patches:
            continue
        new_pavement.append(translate(missing,x,z))
        if sidewalk is not None and not sidewalk.is_empty:
            area = sidewalk.intersection(missing)
            rebuilt = []
            counts = [0]
            for ring,poly in zip(streets[0][:end],existing):
                rebuilt.extend(rings(ring[0],poly.difference(area)) if
                               ring[0] in (1,4,6) and poly.intersects(area) else [ring])
                counts.append(len(rebuilt))
            platform = streets[12] if len(streets)>12 else None
            if platform:
                for idx in (0,1):
                    old = platform[idx]
                    platform[idx] = counts[old] if old<=end else old+len(rebuilt)-end
            streets[0][:end] = rebuilt
            end = len(rebuilt)
            if lower:
                lower[0] = end
        platform = streets[12] if len(streets)>12 else None
        if platform and platform[0]>=end:
            platform[0] += len(patches)
            platform[1] += len(patches)
        streets[0][end:end] = patches
        if graded is not None and (len(streets)<6 or not streets[5]):
            # Rural tiles may first receive drivable geometry here. Encode
            # the fitted road spline along with the new pavement triangles.
            from road_grading import STEP
            row,col = int((z-graded.top)//STEP),int((x-graded.left)//STEP)
            control = graded.after[2][row:row+35,col:col+35]
            mm = np.rint(control*1000).astype(int)
            knots = [int(mm.min()),(mm-mm.min()).ravel().tolist()]
            while len(streets)<6:
                streets.append(None if len(streets)==5 else [])
            streets[5] = knots
        if lower:
            lower[0] += len(patches)
        encoded = json.dumps(collision,separators=(',',':')).encode()
        raw = data[:12]+struct.pack('<I',len(encoded))+data[16:start]+encoded+data[start+size:]
        file.write_bytes(gzip.compress(raw,compresslevel=5,mtime=0))
        tile['bytes'] = file.stat().st_size
    if graded is not None:
        bake_level_panels(directory, chunks, elements, graded.level_panels)
    return new_pavement


def bake_level_panels(directory, chunks, elements, panels):
    """Mark each flat plank run for finer sampling of the fitted road at its edges."""
    by_way = {w['id']: w for w in elements if w['type']=='way'}
    lines, sections = [], []
    for panel in panels:
        w = by_way[panel['road']]
        axis = substring(LineString(points(w)),panel['fromM'],panel['toM'])
        if axis.geom_type != 'LineString':
            continue
        for a,b in zip(axis.coords,list(axis.coords)[1:]):
            if a==b:
                continue
            half = max(width(w['tags']),RULES['defaultWidth'].get(w['tags']['highway'],0.))/2
            lines.append(LineString([a,b]).buffer(half+12))
            sections.append((*a,*b,half,panel['railY']))
    tree = STRtree(lines)
    for tile in chunks:
        x,z = tile['x'],tile['z']
        hits = tree.query(box(x,z,x+256,z+256),predicate='intersects')
        if not len(hits):
            continue
        file = directory/tile['file']
        raw = gzip.decompress(file.read_bytes())
        v,i,size = struct.unpack_from('<3I',raw,4)
        off = 16924+9*v+4*i
        collision = json.loads(raw[off:off+size])
        streets = collision[1]
        defaults = [[],[],[],[],[],None,[],[],[],[],[],None,None]
        streets.extend(defaults[len(streets):])
        local = [[round(a-x,3),round(b-z,3),round(c-x,3),round(d-z,3),half,y]
                 for idx in hits for a,b,c,d,half,y in [sections[idx]]]
        streets[13:14] = [local]
        payload = json.dumps(collision,separators=(',',':')).encode()
        file.write_bytes(gzip.compress(raw[:12]+struct.pack('<I',len(payload))+raw[16:off]+
                                       payload+raw[off+size:],compresslevel=5,mtime=0))
        tile['bytes'] = file.stat().st_size


def relocate_daylight_lamps(directory, chunks, tunnels):
    """Keep street lamps on the remaining sidewalk at shared cutting mouths."""
    from shapely.ops import nearest_points
    tips = STRtree([Point(x,z) for t in tunnels if t.get('openCut')
                    for (x,_,z),mouth in zip(t['portals'],t['mouths']) if mouth])
    for tile in chunks:
        x,z = tile['x'],tile['z']
        if not len(tips.query(box(x,z,x+256,z+256),predicate='dwithin',distance=22)):
            continue
        file = directory/tile['file']
        raw = gzip.decompress(file.read_bytes())
        v,i,size = struct.unpack_from('<3I',raw,4)
        off = 16924+9*v+4*i
        collision = json.loads(raw[off:off+size])
        streets = collision[1]
        nearby = [lamp for lamp in streets[1] if len(tips.query(
            Point(x+lamp[0]/10,z+lamp[1]/10),predicate='dwithin',distance=22))]
        if not nearby:
            continue
        surface = [(kind,make_valid(Polygon(np.asarray(shell)/100,[np.asarray(h)/100 for h in holes])))
                   for kind,shell,*holes in streets[0] if len(shell)>=3]
        road = union_all([p for kind,p in surface if kind in (0,5)])
        sidewalk = union_all([p for kind,p in surface if kind in (1,4,6)]).difference(road).buffer(-.4)
        changed = False
        for lamp in nearby:
            point = Point(lamp[0]/10,lamp[1]/10)
            if sidewalk.is_empty or not road.covers(point) or sidewalk.distance(point)>8:
                continue
            target = nearest_points(point,sidewalk)[1]
            lamp[:] = [round(10*target.x),round(10*target.y)]
            changed = True
        if changed:
            payload = json.dumps(collision,separators=(',',':')).encode()
            file.write_bytes(gzip.compress(raw[:12]+struct.pack('<I',len(payload))+raw[16:off]+
                                           payload+raw[off+size:],compresslevel=5,mtime=0))
            tile['bytes'] = file.stat().st_size

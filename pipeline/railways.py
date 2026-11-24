"""Bake connected railway elevations and local track sections into streamed GL04 tiles."""
import argparse
from collections import defaultdict
import gzip
import json
import math
from pathlib import Path
from itertools import product
import struct
import subprocess

import numpy as np
from shapely import LineString, Point, STRtree, box, get_parts, points as point_array, union_all
from shapely.affinity import translate

from common import CHUNK, load_dem, load_osm, ll2xz
from features import area, points
from landmarks.world_surface import Surface
from play_region import PlayRegion
from railway_layout import lines
from road_profile import RULES
from service_streets import width
from station_levels import FOOTBRIDGE, PLATFORMS, RAIL, UNDERPASS
from station_approaches import approach_junctions, approach_exceptions

ROOT = Path(__file__).resolve().parents[1]
BRIDGE, TUNNEL, ELECTRIC, FENCE, LEVEL, RESERVED, PAINTED = 1, 2, 4, 8, 16, 32, 64


def parallel_segments(pieces, coords, ways):
    """Compare linear profiles at matching perpendicular chainages on both tracks."""
    surface = {wid for wid,way in ways.items() if way.get('tags',{}).get('railway')=='rail'
               and all(way['tags'].get(k,'no')=='no' for k in ('bridge','tunnel'))}
    rows = [piece for piece in pieces if piece[4] in surface]
    if not rows:
        return None
    indices = np.array([[i, j] for i, j, *_ in rows])
    endpoints = np.asarray(coords)[indices]
    delta = endpoints[:, 1] - endpoints[:, 0]
    lengths = np.linalg.norm(delta, axis=1)
    axes = delta / lengths[:, None]
    lines = [LineString(pair) for pair in endpoints]
    source, target = STRtree(lines).query(lines, predicate='dwithin', distance=8)
    way_ids = np.array([row[4] for row in rows])
    layers = np.array([ways[k]['tags'].get('layer', '0') for k in way_ids])
    cosine = np.sum(axes[source] * axes[target], axis=1)
    keep = ((way_ids[source] != way_ids[target]) & (layers[source] == layers[target])
            & (abs(cosine) >= math.cos(math.radians(10))))
    source, target = source[keep], target[keep]
    # Clip the source segment to both the target chainage interval and its
    # eight-metre strip. Height difference is linear between these endpoints.
    offset = endpoints[source, 0] - endpoints[target, 0]
    along = np.sum(offset * axes[target], axis=1)
    normal = axes[target][:, ::-1].copy()
    normal[:, 0] *= -1
    across = np.sum(offset * normal, axis=1)
    lo, hi = np.zeros(len(source)), np.ones(len(source))
    for start, step, minimum, maximum in (
        (along, np.sum(delta[source] * axes[target], axis=1), 0, lengths[target]),
        (across, np.sum(delta[source] * normal, axis=1), -8, 8),
    ):
        moving = abs(step) > 1e-10
        divisor = np.where(moving, step, 1)
        a, b = (minimum - start) / divisor, (maximum - start) / divisor
        lo = np.maximum(lo, np.where(moving, np.minimum(a, b), 0))
        hi = np.minimum(hi, np.where(moving, np.maximum(a, b),
                                     np.where((start >= minimum) & (start <= maximum), 1, -1)))
    valid = hi >= lo
    source, target = source[valid], target[valid]
    if not len(source):
        return None
    fraction = np.stack((lo[valid], hi[valid]), axis=1)
    xy = endpoints[source, :1] + fraction[:, :, None] * delta[source, None]
    station = np.sum((xy - endpoints[target, :1]) * axes[target, None], axis=2)
    return (indices[source], indices[target], fraction, station / lengths[target, None],
            xy, way_ids[source], way_ids[target])


def parallel_height_audit(pieces, coords, height, ways):
    pairs = parallel_segments(pieces, coords, ways)
    result = dict(directedSegmentPairs=0, over5cm=0, maximumM=0)
    if pairs is None:
        return result
    a, b, along_a, along_b, xy, way_a, way_b = pairs
    result['directedSegmentPairs'] = len(a)
    source_y = height[a[:, :1]] + along_a * np.diff(height[a], axis=1)
    target_y = height[b[:, :1]] + along_b * np.diff(height[b], axis=1)
    diff = abs(source_y - target_y)
    pair, end = np.unravel_index(diff.argmax(), diff.shape)
    result.update(over5cm=int(np.count_nonzero(diff.max(axis=1) > .050001)),
                  maximumM=float(diff[pair, end]), ways=[int(way_a[pair]), int(way_b[pair])],
                  xz=xy[pair, end].tolist(), railheadM=[source_y[pair, end], target_y[pair, end]])
    return result


def station_yards(ways):
    """Group surveyed platforms, then extend each yard 50 m along its long axis."""
    platforms = {key: area(way) for key, way in ways.items()
                 if way.get('tags', {}).get('railway') == 'platform'
                 and way['tags'].get('monorail') != 'yes'}
    # Group neighbouring platforms; use the original footprints for the actual
    # envelope so the grouping distance does not extend the station ends.
    groups = union_all([poly.buffer(20) for poly in platforms.values()])
    for group in get_parts(groups):
        members = {key: poly for key, poly in platforms.items() if group.intersects(poly)}
        platform_hull = union_all(list(members.values())).convex_hull
        corners = np.asarray(platform_hull.minimum_rotated_rectangle.exterior.coords)
        edges = np.diff(corners, axis=0)
        axis = edges[np.linalg.norm(edges, axis=1).argmax()]
        dx, dz = axis * (50 / np.linalg.norm(axis))
        yard = union_all([translate(platform_hull, dx, dz),
                          translate(platform_hull, -dx, -dz)]).convex_hull
        yield sorted(members), yard


def road_radius(tags):
    kind = tags['highway']
    lane_count = tags.get('lanes', '')
    lane_width = int(lane_count)*RULES['laneWidth'] if lane_count.isdecimal() else 0
    carriageway = max(width(tags), lane_width, RULES['defaultWidth'].get(kind, 0))
    return carriageway/2 + (2.5 if kind in RULES['defaultWidth'] else 1)


def stations(line, interval):
    coords = np.asarray(line.coords)
    vertices = np.r_[0., np.cumsum(np.linalg.norm(np.diff(coords, axis=0), axis=1))]
    return set(vertices) | set(np.arange(0., line.length, interval))


def bake(world_dir, manifest, inventory, samples, plan_profile=False, rail_only=False):
    world = None if rail_only else Surface(world_dir, manifest)
    region = PlayRegion()
    ways = {way['id']:way for way in load_osm() if way['type']=='way'}
    by_way = defaultdict(list)
    for row in inventory:
        by_way[row['rail']].append(row)
    road_zones = []
    surface_roads = []
    for way in (() if rail_only else ways.values()):
        tags = way.get('tags', {})
        if 'highway' in tags and tags['highway'] != 'construction' and len(way['geometry'])>=2:
            zone=LineString(points(way)).buffer(road_radius(tags), quad_segs=2)
            road_zones.append(zone)
            if tags.get('bridge','no')=='no':
                surface_roads.append(zone)
    protected = STRtree(road_zones)
    nodes, coords = {}, []
    def vertex(p):
        key = tuple(round(v, 4) for v in p.coords[0])
        if key not in nodes:
            nodes[key] = len(coords)
            coords.append(key)
        return nodes[key]

    crossing_data = []
    portal_nodes = set()
    tunnels = defaultdict(list)
    for tunnel in manifest.get('tunnels', []):
        tunnels[tunnel['way']].append(tunnel)
    review=json.loads((ROOT/'pipeline/railway-review.json').read_bytes())
    absent_structures=set()
    sign_sites = defaultdict(list)
    signed = set()
    used_sites = []
    missing_signs = []
    rail_corridors = STRtree([LineString(points(w)) for w in ways.values() if w.get('tags',{}).get('railway')=='rail'])
    yards = list(station_yards(ways))
    station_area = next(yard for ids,yard in yards if PLATFORMS.intersection(ids))
    station_nodes = set()
    pieces = []
    for way in ways.values():
        tags = way.get('tags', {})
        if tags.get('railway') != 'rail':
            continue
        original = LineString(points(way))
        for line in lines(original.intersection(region.geometry)):
            stops = stations(line, 12)
            surface_track = all(tags.get(k,'no')=='no' for k in ('bridge','tunnel')) and tags.get('layer','0')=='0'
            if surface_track and line.intersects(station_area):
                for part in lines(line.intersection(station_area)):
                    stops.update(line.project(Point(part.coords[k])) for k in (0,-1))
            gaps = []
            base = BRIDGE if tags.get('bridge','no')!='no' else 0
            if tags.get('tunnel','no')!='no': base |= TUNNEL
            if tags.get('electrified') in ('yes','contact_line'): base |= ELECTRIC
            service = tags.get('service')
            if not service: base |= FENCE
            if base&TUNNEL:
                for end in (0,-1):
                    tip = Point(original.coords[end])
                    if line.distance(tip)<.001:
                        portal_nodes.add(vertex(tip))
            for row in by_way[way['id']]:
                p = Point(ll2xz(row['lat'], row['lon']))
                if line.distance(p)>.02 or row['status']=='construction_unverified':
                    continue
                at = line.project(p)
                street = ways[row['road']]
                zone = LineString(points(street)).buffer(road_radius(street['tags'])+1)
                for overlap in lines(line.intersection(zone)):
                    lo, hi = sorted(line.project(Point(c)) for c in (overlap.coords[0],overlap.coords[-1]))
                    if lo-.02<=at<=hi+.02:
                        flag = (RESERVED if row['status']=='pending_road_tunnel' and not tunnels.get(row['road']) else
                                LEVEL if row['type']=='level' else BRIDGE if row['type']=='rail_over' else 0)
                        if flag==LEVEL and not rail_only:
                            surface=samples[str(row['sharedNode'])]
                            if surface['road'] is None and surface['deck'] is None: flag|=PAINTED
                        gaps.append((lo,hi,flag))
                        stops.update((lo,hi))
                stops.add(at)
                is_level = row['type']=='level'
                if rail_only:
                    crossing_data.append((vertex(line.interpolate(at)),row,None,None,None))
                    continue
                key = str(row['sharedNode']) if is_level else (row['rail'],row['road'],row['lat'],row['lon'])
                hit = samples[key]
                surface_source='carriageway'
                road = (hit['lowestRoad'] if row['roadTags'].get('tunnel')=='yes' and not is_level else hit['road'])
                if (row['type']=='road_over' or is_level and road is None) and hit['deck'] is not None:
                    surface_source='deck'
                    road = hit['deck']
                sections=tunnels.get(row['road'], ()) if row['type']=='rail_over' else ()
                for tunnel in sections:
                    ends=np.asarray(tunnel['portals'])[:,[0,2]]
                    direction=(ends[1]-ends[0])/tunnel['length']
                    offset=np.asarray(p.coords[0])-ends[0]
                    along=offset@direction
                    if -.02<=along<=tunnel['length']+.02 and abs(offset@[-direction[1],direction[0]])<=tunnel['halfWidth']:
                        surface_source='tunnel_profile'
                        road=float(np.interp(along,*np.asarray(tunnel['stations']).T))
                        break
                if road is None and row['roadTags']['highway'] in ('footway','cycleway','path','steps','pedestrian') and hit['sidewalk'] is not None:
                    road=hit['sidewalk']
                    surface_source='sidewalk'
                if road is None:
                    surface_source='painted_terrain' if is_level else 'terrain_proxy'
                    road = world.sample(*p.coords[0],include_peaks=False)[0]
                row=dict(row,surfaceSource=surface_source)
                street_line = LineString(points(street))
                station = street_line.project(p)
                before = street_line.interpolate(max(0,station-1))
                after = street_line.interpolate(min(street_line.length,station+1))
                axis = np.subtract(after.coords[0],before.coords[0])
                axis /= np.linalg.norm(axis)
                lateral = np.array([-axis[1],axis[0]])
                if is_level and row['sharedNode'] not in signed and row['sharedNode'] not in review['insideBuilding']:
                    signed.add(row['sharedNode'])
                    for side in (-1,1):
                        for setback,outset,shoulder in product(range(5,76,2),(1,2,3,4,6,8,12,16,20,24),(1,-1)):
                            xy=np.asarray(p.coords[0])+side*(axis*setback+shoulder*lateral*(road_radius(street['tags'])+outset))
                            if not region.geometry.covers(Point(xy)) or protected.query(Point(xy),predicate='dwithin',distance=.65).size:
                                continue
                            if rail_corridors.query(Point(xy),predicate='dwithin',distance=2.4).size: continue
                            if any(np.linalg.norm(xy-other)<1.3 for other in used_sites): continue
                            if world.roof(*xy) is not None: continue
                            used_sites.append(xy)
                            origin=np.floor(xy/CHUNK)*CHUNK
                            sign_sites[tuple(map(int,origin))].append([*np.round((xy-origin)*100).astype(int).tolist(),
                                round(world.sample(*xy,include_peaks=False)[0]*100),round(math.atan2(axis[1]*side,axis[0]*side)*1000)])
                            break
                        else:
                            missing_signs.append(dict(node=row['sharedNode'],approach=side))
                soffit=hit['soffit'] if hit['soffit'] is not None else road-1.2
                crossing_data.append((vertex(line.interpolate(at)),row,road,axis,soffit))
                if not is_level and row['type']=='rail_over' and row['roadTags'].get('tunnel')=='yes' and surface_source=='terrain_proxy':
                    absent_structures.add((row['rail'],row['road']))
            distances = sorted(stops)
            verts = [vertex(line.interpolate(s)) for s in distances]
            if surface_track:
                station_nodes.update(i for i in verts if station_area.distance(Point(coords[i]))<.001)
            for lo,hi,i,j in zip(distances,distances[1:],verts,verts[1:]):
                if i==j: continue
                mid=(lo+hi)/2
                flags = base
                for left,right,flag in gaps:
                    if left<=mid<=right:
                        flags |= flag
                        flags &= ~FENCE
                pieces.append((i,j,lo,flags,way['id']))

    ground = load_dem(*np.asarray(coords).T, paired=True).astype(float)
    from railway_profile import solve
    # Dingjiang is a mapped train depot with yard tracks but no passenger
    # platforms. Its service crossings share a single yard datum.
    depot = ways.get(973038882)
    if depot and depot['tags'].get('landuse') == 'railway':
        yards.append(([depot['id']], area(depot)))
    height, profile = solve(coords,pieces,ways,ground+.35,crossing_data,yards,parallel_segments(pieces,coords,ways))
    if rail_only:
        return [dict(rail=row['rail'], road=row['road'], type=row['type'], railY=float(height[node]),
                     x=coords[node][0], z=coords[node][1])
                for node,row,*_ in crossing_data], profile['panels']
    violations=[]
    dependencies={tuple([rail,road]):int(missing) for missing,records in review['missingTunnelDependencies'].items()
                  for rail,road,witness in records if (witness,int(missing)) in absent_structures}
    measured=[]
    for i,r,road,axis,soffit in crossing_data:
        clearance = (height[i]-1.2-road if r['type']=='rail_over' else
                     soffit-height[i] if r['type']=='road_over' else None)
        missing=dependencies.get((r['rail'],r['road']))
        if (r['rail'],r['road']) in absent_structures:
            clearance=None
        if r['type'] in ('rail_over','road_over') and clearance is not None:
            required = 4.5 if r['type']=='rail_over' else 7.5
            if clearance < required-.001:
                violations.append(dict(rail=r['rail'],road=r['road'],lat=r['lat'],lon=r['lon'],
                                       type=r['type'],shortfallM=round(required-clearance,4)))
        measured.append(dict(originalSoffitM=round(float(soffit),4) if r['type']=='road_over' else None, roadStructureDependency=missing,surfaceSource=r['surfaceSource'],rail=r['rail'],road=r['road'],type=r['type'],sharedNode=r['sharedNode'],
                             x=coords[i][0],z=coords[i][1],east=round(axis[0],6),south=round(axis[1],6),
                             railY=round(height[i],4),roadY=round(road,4),
                             clearanceM=None if clearance is None else round(clearance,4)))
    if plan_profile:
        from railway_road_profiles import road_profile_constraints
        profile['roads'] = road_profile_constraints(ways,measured,profile['panels'])
        profile['crossings'] = measured
        return dict(profile=profile,stationRailheadM=RAIL,stationNodes=len(station_nodes),
                    parallelRailHeight=parallel_height_audit(pieces, coords, height, ways))
    tiles=defaultdict(list)
    maximum_grade=defaultdict(float)
    for i,j,station,flags,way_id in pieces:
        a,b=np.array(coords[i]),np.array(coords[j])
        delta=b-a
        cuts={0.,1.}
        for axis in range(2):
            mn,mx=sorted((a[axis],b[axis]))
            for edge in range((math.floor(mn/CHUNK)+1)*CHUNK,math.ceil(mx/CHUNK)*CHUNK,CHUNK):
                cuts.add((edge-a[axis])/delta[axis])
        cuts=sorted(cuts)
        length=float(np.linalg.norm(delta))
        for s,t in zip(cuts,cuts[1:]):
            if (t-s)*length<.005: continue
            center=a+delta*((s+t)/2)
            origin=np.floor(center/CHUNK)*CHUNK
            key=tuple(map(int,origin))
            p,q=a+delta*s-origin,a+delta*t-origin
            levels=[height[i]+(height[j]-height[i])*f for f in (s,t)]
            # Reserve the entire support footprint, including an offset mast
            # or fence and its half-width, around every active road corridor.
            safe=not len(protected.query(LineString([p+origin,q+origin]), predicate='dwithin',distance=4.5))
            localflags=flags if safe else ((flags & ~FENCE)|RESERVED)
            portal = int(i in portal_nodes and s==0) + 2*int(j in portal_nodes and t==1)
            # Keep sub-centimetre rise on very short pieces at tile and road edges.
            encoded=[round(float(v)*100,6) for v in (*p,levels[0],*q,levels[1])]
            span=math.hypot(encoded[3]-encoded[0],encoded[4]-encoded[1])
            tags=ways[way_id]['tags']
            category='branch' if tags.get('usage')=='branch' else 'service' if tags.get('service') else 'main'
            if span:
                maximum_grade[category]=max(maximum_grade[category],1000*abs(encoded[5]-encoded[2])/span)
            tiles[key].append([*encoded,
                               round((station+s*length)*100),localflags,portal])
    # Cut terrain only where GL04 ground triangles are free to change. The
    # diagonal of an 8 m cell bounds the influence of one moved vertex.
    road_tree=STRtree(surface_roads)
    guide_segments=[(i,j) for i,j,_,flags,_ in pieces if not flags&(BRIDGE|TUNNEL|LEVEL)]
    guide=STRtree([LineString([coords[i],coords[j]]) for i,j in guide_segments])
    track_tree=STRtree([LineString([coords[i],coords[j]]) for i,j,_,flags,_ in pieces if not flags&TUNNEL])
    trees_removed=0
    for tile in manifest['chunks']:
        rows=tiles.get((tile['x'],tile['z']))
        signs=sign_sites.get((tile['x'],tile['z']),[])
        if not rows and not signs:
            bounds=box(tile['x'],tile['z'],tile['x']+CHUNK,tile['z']+CHUNK)
            if not track_tree.query(bounds,predicate='dwithin',distance=20).size: continue
        file=world_dir/tile['file']
        data=gzip.decompress(file.read_bytes())
        v,n,size=struct.unpack_from('<3I',data,4)
        start=24+16900+9*v+4*n
        collision=json.loads(data[start:start+size])
        ground_grid,_,step=world.tile((tile['x'],tile['z']))
        side=len(ground_grid)
        xx,zz=np.meshgrid(np.arange(side)*step+tile['x'], np.arange(side)*step+tile['z'])
        probes=point_array(xx.ravel(),zz.ravel())
        nearby=guide.query(probes,predicate='dwithin',distance=20)
        target=ground_grid.ravel().copy()
        protected_nodes=set(road_tree.query(probes,predicate='dwithin',distance=step*math.sqrt(2))[0])
        for k,edge in nearby.T:
            if k in protected_nodes: continue
            i,j=guide_segments[edge]
            a,b=np.asarray(coords[i]),np.asarray(coords[j])
            delta=b-a
            v=np.array([xx.flat[k],zz.flat[k]])-a
            t=np.clip(np.dot(v,delta)/np.dot(delta,delta),0,1)
            dist=np.linalg.norm(v-t*delta)
            design=(1-t)*height[i]+t*height[j]-.46+max(0,dist-3.1)/1.75
            if design<target[k]: target[k]=design
        cuts=[[int(k),round(target[k]*100)] for k in np.flatnonzero(target<ground_grid.ravel()-.005)]
        treefile=file.with_suffix('.trees')
        trees=np.frombuffer(gzip.decompress(treefile.read_bytes()),dtype='<u2').reshape(-1,6)
        if len(trees):
            locations=point_array(trees[:,0]/100+tile['x'],trees[:,1]/100+tile['z'])
            hits=track_tree.query(locations,predicate='dwithin',distance=4.5)[0]
            if len(hits):
                keep=np.ones(len(trees),dtype=bool)
                keep[hits]=False
                trees_removed+=int(np.sum(~keep))
                treefile.write_bytes(gzip.compress(trees[keep].tobytes(),mtime=0))
        if not rows and not signs and not cuts and len(collision)<7: continue
        while len(collision)<7: collision.append([])
        collision[4]=rows or []
        collision[5]=signs
        collision[6]=cuts
        packed=json.dumps(collision,separators=(',',':')).encode()
        payload=data[:12]+struct.pack('<I',len(packed))+data[16:start]+packed+data[start+size:]
        file.write_bytes(gzip.compress(payload,mtime=0))
        tile['bytes']=file.stat().st_size
    return dict(stationRailheadM=RAIL,stationNodes=len(station_nodes),
                parallelRailHeight=parallel_height_audit(pieces, coords, height, ways),
                crossings=measured,maxEncodedGradePermille=maximum_grade,missingSigns=missing_signs,treesRemoved=trees_removed,signs=sum(map(len,sign_sites.values())),tiles=len(tiles), segments=sum(map(len,tiles.values())), fixedNodes=len(station_nodes),
                maxPinErrorM=max(abs(height[i]-RAIL) for i in station_nodes), clearanceConflicts=violations)


def bake_world(directory,manifest,plan_profile=False):
    inventory_file=ROOT/'docs/railway-crossings.json'
    inventory=json.loads(inventory_file.read_bytes())
    probes=[]
    ways = {w['id']:w for w in load_osm() if w['type']=='way'}
    junctions = approach_junctions(ways)
    probes.extend([[f"station-junction:{item['junctionNode']}",item['x'],item['z']] for item in junctions])
    raw=json.loads(subprocess.check_output([ROOT/'node_modules/.bin/tsx',ROOT/'scripts/railway-road-heights.mjs',
                                            directory,inventory_file,'--branch-deck'],input=json.dumps(probes).encode()))
    samples={}
    for k,v in raw.items():
        if '/' in k:
            a,b,lat,lon=k.split('/')
            samples[int(a),int(b),float(lat),float(lon)]=v
        else: samples[k]=v
    report=bake(directory,manifest,inventory,samples,plan_profile)
    tunnel = next(t for t in manifest['tunnels'] if t['way']==UNDERPASS)
    if 'approachEnds' in tunnel:
        report['stationApproachExceptions'] = approach_exceptions(tunnel,junctions,samples)
    if plan_profile:
        return report
    rail_levels = [point['railY'] for point in report['crossings'] if point['road'] == UNDERPASS]
    for approach in report.get('stationApproachExceptions', []):
        approach['actualRailDifferenceM'] = round(max(rail_levels) - min(rail_levels), 4)
    manifest['stationApproachExceptions'] = report.get('stationApproachExceptions', [])
    manifest.pop('railwayBranchGrade', None)
    return report


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('world',type=Path)
    parser.add_argument('--plan-profile', action='store_true', help='Solve a rail-first profile without writing any world assets')
    args=parser.parse_args()
    path=args.world/'manifest.json'
    manifest=json.loads(path.read_bytes())
    report=bake_world(args.world,manifest,args.plan_profile)
    if not args.plan_profile:
        path.write_text(json.dumps(manifest,separators=(',',':'))+'\n')
    print(json.dumps(report,indent=2))
    if args.plan_profile and (not report['profile']['feasible'] or report['profile']['roads']['conflicts']):
        raise SystemExit(2)

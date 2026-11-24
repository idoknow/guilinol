"""Bake connected railway elevations and local track sections into streamed GL04 tiles."""
import argparse
from collections import defaultdict
import gzip
import heapq
import json
import math
from pathlib import Path
from itertools import product
import struct
import subprocess

import numpy as np
from shapely import LineString, Point, STRtree, box, points as point_array

from common import CHUNK, load_osm, ll2xz
from features import points
from landmarks.world_surface import Surface
from play_region import PlayRegion
from railway_layout import lines
from road_profile import RULES
from service_streets import width

ROOT = Path(__file__).resolve().parents[1]
BRIDGE, TUNNEL, ELECTRIC, FENCE, LEVEL, RESERVED, PAINTED = 1, 2, 4, 8, 16, 32, 64


def envelope(graph, targets):
    """Highest allowed level from all upper anchors, in one graph traversal."""
    levels = np.array(targets, dtype=float)
    queue = [(y, i) for i,y in enumerate(levels) if math.isfinite(y)]
    heapq.heapify(queue)
    while queue:
        level, i = heapq.heappop(queue)
        if level > levels[i]:
            continue
        for j, rise in graph[i]:
            if level + rise < levels[j]:
                levels[j] = level + rise
                heapq.heappush(queue, (levels[j], j))
    return levels


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


def bake(world_dir, manifest, inventory, samples):
    world = Surface(world_dir, manifest)
    region = PlayRegion()
    ways = {way['id']:way for way in load_osm() if way['type']=='way'}
    by_way = defaultdict(list)
    for row in inventory:
        by_way[row['rail']].append(row)
    road_zones = []
    surface_roads = []
    for way in ways.values():
        tags = way.get('tags', {})
        if 'highway' in tags and tags['highway'] != 'construction' and len(way['geometry'])>=2:
            zone=LineString(points(way)).buffer(road_radius(tags), quad_segs=2)
            road_zones.append(zone)
            if tags.get('bridge','no')=='no':
                surface_roads.append(zone)
    protected = STRtree(road_zones)
    nodes, coords, ground, graph = {}, [], [], []
    def vertex(p):
        key = tuple(round(v, 4) for v in p.coords[0])
        if key not in nodes:
            nodes[key] = len(coords)
            coords.append(key)
            ground.append(world.sample(*p.coords[0], include_peaks=False)[0])
            graph.append([])
        return nodes[key]

    anchors = {}
    constraints = []
    crossing_data = []
    portal_nodes = set()
    tunnels = {t['way']:t for t in manifest.get('tunnels', [])}
    sign_sites = defaultdict(list)
    signed = set()
    used_sites = []
    missing_signs = []
    rail_corridors = STRtree([LineString(points(w)) for w in ways.values() if w.get('tags',{}).get('railway')=='rail'])
    pieces = []
    approved = json.loads((ROOT/'docs/railway-grades.json').read_bytes())['gradeConflicts']
    for row in approved:
        assert {row['start'],row['end']} in ({4514289414,6635078447},{4505338292,4514289414})
    for way in ways.values():
        tags = way.get('tags', {})
        if tags.get('railway') != 'rail':
            continue
        original = LineString(points(way))
        for line in lines(original.intersection(region.geometry)):
            stops = stations(line, 12)
            gaps = []
            base = BRIDGE if tags.get('bridge','no')!='no' else 0
            if tags.get('tunnel','no')!='no': base |= TUNNEL
            if tags.get('electrified') in ('yes','contact_line'): base |= ELECTRIC
            service = tags.get('service')
            if not service: base |= FENCE
            anchor_stations = {}
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
                        flag = (RESERVED if row['status']=='pending_road_tunnel' else
                                LEVEL if row['type']=='level' else BRIDGE if row['type']=='rail_over' else 0)
                        if flag==LEVEL:
                            surface=samples[str(row['sharedNode'])]
                            if surface['road'] is None and surface['deck'] is None: flag|=PAINTED
                        gaps.append((lo,hi,flag))
                        stops.update((lo,hi))
                stops.add(at)
                if row['status']!='active':
                    continue
                is_level = row['type']=='level'
                key = str(row['sharedNode']) if is_level else (row['rail'],row['road'],row['lat'],row['lon'])
                hit = samples[key]
                road = hit['road']
                if (row['type']=='road_over' or is_level and road is None) and hit['deck'] is not None:
                    road = hit['deck']
                tunnel=tunnels.get(row['road'])
                if tunnel and row['type']=='rail_over':
                    ends=np.asarray(tunnel['portals'])[:,[0,2]]
                    direction=(ends[1]-ends[0])/tunnel['length']
                    offset=np.asarray(p.coords[0])-ends[0]
                    along=offset@direction
                    if 0<=along<=tunnel['length'] and abs(offset@[-direction[1],direction[0]])<=tunnel['halfWidth']:
                        road=float(np.interp(along,*np.asarray(tunnel['stations']).T))
                if road is None:
                    road = world.sample(*p.coords[0],include_peaks=False)[0]
                street_line = LineString(points(street))
                station = street_line.project(p)
                before = street_line.interpolate(max(0,station-1))
                after = street_line.interpolate(min(street_line.length,station+1))
                axis = np.subtract(after.coords[0],before.coords[0])
                axis /= np.linalg.norm(axis)
                lateral = np.array([-axis[1],axis[0]])
                if is_level and row['sharedNode'] not in signed:
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
                if is_level:
                    anchor_stations[row['sharedNode']] = at
                    anchors[vertex(line.interpolate(at))] = road
                elif row['type']=='rail_over':
                    clearance = 2.5 if row['roadTags']['highway'] in ('footway','cycleway','path','steps','pedestrian') else 4.5
                    constraints.append((vertex(line.interpolate(at)),road+clearance+1.2,'min',row))
                else:
                    clearance = 6.55 if base&ELECTRIC else 5.5
                    constraints.append((vertex(line.interpolate(at)),soffit-clearance,'max',row))
            exceptions = []
            for item in approved:
                if {item['start'],item['end']} <= anchor_stations.keys():
                    left,right=sorted((anchor_stations[item['start']],anchor_stations[item['end']]))
                    exceptions.append((left,right,item['requiredPermille']/1000+.00001))
            distances = sorted(stops)
            verts = [vertex(line.interpolate(s)) for s in distances]
            for lo,hi,i,j in zip(distances,distances[1:],verts,verts[1:]):
                if i==j: continue
                mid=(lo+hi)/2
                grade = .020 if service in ('spur','siding','yard','crossover') else .01198
                for left,right,g in exceptions:
                    if left<=mid<=right: grade=g
                # Bound the rendered chord as well as the source chainage.
                chord=math.dist(coords[i],coords[j])
                rise=max(0,chord*grade-.000004)
                graph[i].append((j,rise))
                graph[j].append((i,rise))
                flags = base
                for left,right,flag in gaps:
                    if left<=mid<=right:
                        flags |= flag
                        flags &= ~FENCE
                pieces.append((i,j,lo,flags,way['id']))

    ground = np.array(ground)
    lows=np.full(len(ground),-np.inf)
    highs=np.full(len(ground),np.inf)
    for i,bound,kind,_ in constraints:
        if kind=='min': lows[i]=max(lows[i],bound)
        else: highs[i]=min(highs[i],bound)
    for i,y in anchors.items(): lows[i]=highs[i]=y
    floor=-envelope(graph,-lows)
    ceiling=envelope(graph,highs)
    target=ground+.35
    smooth=(envelope(graph,target)-envelope(graph,-target))/2
    height=np.maximum(floor,np.minimum(smooth,ceiling))
    # Fixed road anchors always prevail. Propagate them over the same graph
    # to preserve track continuity and enforce the grade outside exceptions.
    pin_upper=np.full(len(ground),np.inf)
    pin_lower=np.full(len(ground),-np.inf)
    for i,y in anchors.items(): pin_upper[i]=pin_lower[i]=y
    height=np.clip(height,-envelope(graph,-pin_lower),envelope(graph,pin_upper))
    violations=[]
    for i,bound,kind,row in constraints:
        miss=bound-height[i] if kind=='min' else height[i]-bound
        if miss>.001:
            violations.append(dict(rail=row['rail'], road=row['road'], type=row['type'],
                                   lat=row['lat'], lon=row['lon'], shortfallM=round(miss,3)))
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
            encoded=[round(float(v)*100,4) for v in (*p,levels[0],*q,levels[1])]
            span=math.hypot(encoded[3]-encoded[0],encoded[4]-encoded[1])
            category='service' if ways[way_id]['tags'].get('service') else 'main'
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
    measured=[]
    for i,r,road,axis,soffit in crossing_data:
        clearance = (height[i]-1.2-road if r['type']=='rail_over' else
                     soffit-height[i] if r['type']=='road_over' else None)
        measured.append(dict(rail=r['rail'],road=r['road'],type=r['type'],sharedNode=r['sharedNode'],
                             x=coords[i][0],z=coords[i][1],east=round(axis[0],6),south=round(axis[1],6),
                             railY=round(height[i],4),roadY=round(road,4),
                             clearanceM=None if clearance is None else round(clearance,4)))
    return dict(crossings=measured,maxEncodedGradePermille=maximum_grade,missingSigns=missing_signs,treesRemoved=trees_removed,signs=sum(map(len,sign_sites.values())),tiles=len(tiles), segments=sum(map(len,tiles.values())), fixedNodes=len(anchors),
                maxPinErrorM=max(abs(height[i]-y) for i,y in anchors.items()), clearanceConflicts=violations)


def bake_world(directory,manifest):
    inventory_file=ROOT/'docs/railway-crossings.json'
    raw=json.loads(subprocess.check_output([ROOT/'node_modules/.bin/tsx',ROOT/'scripts/railway-road-heights.mjs',
                                            directory,inventory_file]))
    samples={}
    for k,v in raw.items():
        if '/' in k:
            a,b,lat,lon=k.split('/')
            samples[int(a),int(b),float(lat),float(lon)]=v
        else: samples[k]=v
    return bake(directory,manifest,json.loads(inventory_file.read_bytes()),samples)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('world',type=Path)
    args=parser.parse_args()
    path=args.world/'manifest.json'
    manifest=json.loads(path.read_bytes())
    report=bake_world(args.world,manifest)
    path.write_text(json.dumps(manifest,separators=(',',':'))+'\n')
    print(json.dumps(report,indent=2))

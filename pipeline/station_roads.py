"""Sample the approved station-road design at two metres or closer."""
import json
import math
from collections import defaultdict
from pathlib import Path

import numpy as np
from shapely import LineString, MultiPoint, Point

from common import load_osm
from features import points
from road_profile import RULES


def samples(knots, transition=2.):
    out = [knots[0]]
    for (s, y), (t, z) in zip(knots, knots[1:]):
        length = t - s
        ease = min(transition, .15 * length)
        tangent = (z - y) / (length - ease)
        # A parabolic vertical curve at each end joins the central tangent.
        for x in np.unique(np.r_[np.linspace(0, length, math.ceil(length / 2) + 1),
                                 ease, length - ease])[1:]:
            if x < ease:
                rise = x*x/(2*ease)
            elif x <= length-ease:
                rise = x-ease/2
            else:
                rise = length-ease-(length-x)**2/(2*ease)
            out.append((s+x, y + tangent*rise))
    return np.array(out)


def road_design(paired_widths=None, elements=None):
    design = json.loads(Path(__file__).with_name('station-road-profiles.json').read_text())
    profiles = {}
    for way in elements if elements is not None else load_osm():
        if way['type'] != 'way' or str(way['id']) not in design:
            continue
        line = LineString(points(way))
        knots = design[str(way['id'])]
        if abs(knots[-1][0] - line.length) > .02:
            raise ValueError(f"Station road alignment changed for {way['id']}")
        if paired_widths and way['id'] in paired_widths:
            way=dict(way, stationWidth=paired_widths[way['id']])
        profiles[way['id']] = (way, line, samples(knots))
    return profiles


def half_width(way):
    if 'profileWidth' in way:
        return way['profileWidth']/2
    if 'stationWidth' in way:
        return way['stationWidth']/2
    tags = way['tags']
    if tags.get('width', '').replace('.', '', 1).isdecimal():
        return float(tags['width'])/2
    if tags.get('lanes', '').isdecimal():
        return RULES['laneWidth']*int(tags['lanes'])/2
    return RULES['defaultWidth'].get(tags['highway'], 4)/2


def tunnel_sections(profiles):
    bores = []
    # IDOK-371: only these opposing Cuizhu carriageways overlap at the portal; keep unrelated road widths unchanged.
    cuizhu = ((265411001, 815082649, 815082646), (815082648, 265411005, 815082645))
    opposite = {way_id: [profiles[other][1] for other in cuizhu[1-side] if other in profiles]
                for side, carriageway in enumerate(cuizhu) for way_id in carriageway}
    for way, line, heights in profiles.values():
        covered = way['tags'].get('tunnel') == 'yes'
        if way['tags']['highway'] in ('footway','pedestrian'):
            continue
        coords = np.array(line.coords)
        chain = np.r_[0, np.cumsum(np.linalg.norm(np.diff(coords, axis=0), axis=1))]
        for i, (start, end) in enumerate(zip(chain, chain[1:])):
            at = heights[:,0]
            distances = np.r_[start, at[(at > start+.001) & (at < end-.001)], end]
            levels = np.interp(distances, at, heights[:,1])
            portals = [[*p[:1], float(y), p[1]] for p,y in zip(coords[i:i+2], levels[[0,-1]])]
            mouths = [False, False] if way.get('surfaceApproach') else [i==0, i==len(chain)-2]
            width = half_width(way)
            if opposite.get(way['id']):
                segment = LineString(coords[i:i+2])
                if segment.distance(Point(-2395, 1935)) < 160:
                    width = min(width, min(segment.distance(other) for other in opposite[way['id']])/2)
            bores.append(dict(way=way['id'], nodes=way['nodes'][i:i+2], portals=portals,
                              length=end-start, halfWidth=width, clearance=4.5,
                              approach=0, openCut=not covered, openEnds=[0,0] if covered else [end-start,0], mouths=mouths,
                              pairedWidth=way.get('stationWidth'),
                              stations=np.column_stack((distances-start, levels)).tolist()))
    ends = defaultdict(list)
    for t in bores:
        for idx,node in enumerate(t["nodes"]):
            ends[node].append((t,idx))
    stitch(ends,ends)
    trim_joint_floors(bores)
    return bores


def bake(directory, manifest, paired_widths):
    """Install profiles after the native rail tie-ins have been evaluated."""
    from dingjiang import road_profiles
    elements = load_osm()
    profiles = road_design(paired_widths, elements)
    profiles.update(road_profiles(elements, paired_widths))
    import dingjiang_structures
    profiles.update(dingjiang_structures.road_profiles(elements, paired_widths))
    from rail_sections import adjust_prior_roads, designs, road_profiles as section_roads
    sections = designs()
    adjust_prior_roads("01", profiles, sections)
    bridge_ways, landings = dingjiang_structures.raise_decks(directory, manifest, elements, profiles)
    from dingjiang import ROAD_IDS
    bake_profiles(directory, manifest, profiles, elements, bridge_ways.values(), landings)
    from dingjiang_paving import finish_paving
    finish_paving(directory, manifest, [profiles[wid] for wid in ROAD_IDS], elements)
    ways = {way['id']: way for way in elements if way['type']=='way'}
    for section in sections:
        parts = section_roads(section, ways, paired_widths)
        adjust_prior_roads(section["name"], parts, sections)
        if not parts:
            continue
        bake_profiles(directory, manifest, parts, elements, additional=True)
        finish_paving(directory, manifest, list(parts.values()), elements)


def bake_profiles(directory, manifest, profiles, elements, bridge_ways=(), landings=None, *, additional=False):
    import gzip
    import struct
    from collections import defaultdict
    from shapely import STRtree

    bores = tunnel_sections(profiles)
    replaced = set() if additional else {t['way'] for t in bores}
    manifest['tunnels'] = [t for t in manifest.get('tunnels', []) if t['way'] not in replaced] + bores
    tiles = defaultdict(list)
    def add(a, b, width, y0, y1):
        lo = np.floor((np.minimum(a,b)-width-6)/256).astype(int)
        hi = np.floor((np.maximum(a,b)+width+6)/256).astype(int)
        for col in range(lo[0],hi[0]+1):
            for row in range(lo[1],hi[1]+1):
                x,z = col*256,row*256
                tiles[x,z].append([round(a[0]-x,4),round(a[1]-z,4),round(b[0]-x,4),
                                   round(b[1]-z,4),round(width,3),y0,y1])
    open_lines = []
    for way, line, heights in profiles.values():
        if way['tags'].get('tunnel')=='yes' and not way.get('gradeShoulders'):
            continue
        open_lines.append(line)
        width = half_width(way)
        pts = [np.array(line.interpolate(float(d)).coords[0]) for d in heights[:,0]]
        for i,(a,b) in enumerate(zip(pts,pts[1:])):
            add(a,b,width,round(heights[i,1]-.045,5),round(heights[i+1,1]-.045,5))
    active = set(tiles)
    near = STRtree(open_lines)
    fixed_pavement=[]
    for way in elements:
        tags = way.get('tags',{})
        if way['type']!='way' or 'highway' not in tags or tags.get('railway')=='platform':
            continue
        coords = points(way)
        if len(coords)<2 or not len(near.query(LineString(coords),predicate='dwithin',distance=40)):
            continue
        profiled = profiles.get(way['id'])
        if profiled and 'nativeRemainders' in profiled[0]:
            fixed = profiled[0]['nativeRemainders']
        elif profiled and 'nativeRemainder' in profiled[0]:
            fixed = [LineString(profiled[0]['nativeRemainder'])]
        elif profiled:
            nodes = profiled[0]['nodes']
            if nodes == way['nodes']:
                continue
            # The native continuation owns the road edge and its supporting
            # terrain past the tie, even when it has the same OSM way ID.
            changed = set(zip(nodes,nodes[1:]))
            fixed = [LineString([a,b]) for a,b,i,j in
                     zip(coords,coords[1:],way['nodes'],way['nodes'][1:]) if (i,j) not in changed]
        else:
            fixed = [LineString(coords)]
        for line in fixed:
            if tags.get('bridge','no')=='no' and tags.get('tunnel','no')=='no':
                fixed_pavement.append(line.buffer(half_width(way)+.1,cap_style='round'))
            for a,b in zip(line.coords,line.coords[1:]):
                add(np.asarray(a),np.asarray(b),half_width(way),None,None)
    from shapely import Polygon, constrained_delaunay_triangles, union_all
    protected_paving = STRtree(fixed_pavement)
    from station_junctions import build as build_junctions
    build_junctions(bores,protected_paving)
    for bore in bores:
        for end,node in enumerate(bore['nodes']):
            if landings and node in landings:
                bore.setdefault('joints',[None,None])[end] = landings[node]
    cuts = defaultdict(list)
    for t in bores:
        a,b=t['portals']
        width=t['halfWidth']
        if not t['openCut'] and profiles[t['way']][0].get('gradeShoulders'):
            # Leave a centimetre for the independently encoded OSM and GL04 edges.
            width += .01
        if t['openCut']:
            strip=LineString([(a[0],a[2]),(b[0],b[2])]).buffer(width,cap_style='flat')
            nearby=protected_paving.query(strip,predicate='intersects')
            if len(nearby):
                outside=strip.difference(union_all([fixed_pavement[i] for i in nearby]))
                t['footprint']=[list(tri.exterior.coords)[:-1] for tri in
                                constrained_delaunay_triangles(outside).geoms if tri.area>1.e-8]
        low=np.floor((np.minimum(a,b)[[0,2]]-width)/256).astype(int)
        high=np.floor((np.maximum(a,b)[[0,2]]+width)/256).astype(int)
        for col in range(low[0],high[0]+1):
            for row in range(low[1],high[1]+1):
                x,z=col*256,row*256
                entry=[a[0]-x,a[2]-z,b[0]-x,b[2]-z,width,a[1],b[1],t['openCut']]
                if 'footprint' not in t:
                    cuts[x,z].append(entry)
                else:
                    for tri in t['footprint']:
                        cuts[x,z].append(entry+[[[px-x,pz-z] for px,pz in tri]])
        # The two adjacent rectangular cuts meet at an angle. Remove the
        # native paving from the turning wedge as well, or a sliver survives
        # across the mouth and becomes a vertical collision edge.
        for end, joint in enumerate(t.get('joints', ())):
            if not joint or not joint.get('draw'):
                continue
            for wedge in joint.get('wedges', ()):
                area = Polygon(wedge)
                nearby = protected_paving.query(area, predicate='intersects')
                if len(nearby):
                    area = area.difference(union_all(protected_paving.geometries[nearby]))
                for face in constrained_delaunay_triangles(area).geoms:
                    left, top, right, bottom = face.bounds
                    if face.area < 1.e-8:
                        continue
                    middle = (top+bottom)/2
                    level = t['portals'][end][1]
                    for col in range(math.floor(left/256),math.floor(right/256)+1):
                        for row in range(math.floor(top/256),math.floor(bottom/256)+1):
                            x,z = col*256,row*256
                            cuts[x,z].append([left-x,middle-z,right-x,middle-z,(bottom-top)/2,
                                              level,level,False,[[u-x,v-z] for u,v in list(face.exterior.coords)[:3]]])
    for chunk in manifest['chunks']:
        origin = chunk['x'],chunk['z']
        if origin not in active:
            continue
        segments = tiles[origin]
        path = directory / chunk['file']
        native_tile = path.read_bytes()
        data = bytearray(gzip.decompress(native_tile))
        v,i,size = struct.unpack_from('<3I',data,4)
        start = 16924+9*v+4*i
        collision = json.loads(data[start:start+size])
        streets = collision[1]
        while len(streets)<14:
            streets.append(None if len(streets) in (5,11,12) else [])
        if additional and len(streets)>14:
            existing = streets[14]
            previous = STRtree([LineString([s[:2],s[2:4]]).buffer(s[4]+6) for s in existing if s[5] is not None])
            if any(len(previous.query(LineString([s[:2],s[2:4]]),predicate='dwithin',distance=s[4]+6))
                   for s in segments if s[5] is not None):
                raise ValueError(f"Overlapping graded sections require a joint design in tile {origin}")
            guards = [s for s in existing if s[5] is not None or
                      len(previous.query(LineString([s[:2],s[2:4]]),predicate='dwithin',distance=s[4]+6))]
            streets[14] = guards + segments
            if len(streets)>15:
                cuts[origin] = streets[15] + cuts[origin]
        elif len(streets)==14:
            streets.append(segments)
        else:
            streets[14]=segments
        if len(streets)==15:
            streets.append(cuts[origin])
        else:
            streets[15]=cuts[origin]
        # Avoid changing any terrain triangle supporting a protected road.
        grid = np.frombuffer(data,dtype='<i2',count=4225,offset=24).reshape(65,65)
        wet = np.frombuffer(data,dtype='<i2',count=4225,offset=8474).reshape(65,65)
        distance = np.full(grid.shape,np.inf)
        protected = np.zeros(grid.shape,bool)
        target = grid.copy()
        zz,xx = np.mgrid[0:257:4,0:257:4]
        for ax,az,bx,bz,width,ay,by in segments:
            dx,dz=bx-ax,bz-az
            length=dx*dx+dz*dz
            if length<1.e-8:
                continue
            u=np.clip(((xx-ax)*dx+(zz-az)*dz)/length,0,1)
            lateral=np.hypot(xx-ax-u*dx,zz-az-u*dz)
            if ay is None:
                protected |= lateral < width+12
                continue
            take=(lateral<distance)&(lateral<=width)
            weight=np.clip((width-lateral)/4,0,1)
            raw=grid+weight*((ay+(by-ay)*u-.06)*10-grid)
            target[take]=np.rint(raw[take]).astype('i2')
            distance[take]=lateral[take]
        ok=~protected & (wet==-32768) & np.isfinite(distance)
        ok[[0,-1],:]=False
        ok[:,[0,-1]]=False
        grid[ok]=target[ok]
        image_size, triangles = struct.unpack_from('<2I',data,16)
        underlay_offset = start+size+image_size+triangles*18
        if len(data)-underlay_offset==8450:
            underlay = np.frombuffer(data,dtype='<i2',count=4225,offset=underlay_offset).reshape(65,65)
            underlay[ok]=target[ok]
        encoded=json.dumps(collision,separators=(',',':')).encode()
        struct.pack_into('<I',data,12,len(encoded))
        payload=data[:start]+encoded+data[start+size:]
        path.write_bytes(gzip.compress(payload,mtime=0))
        chunk['bytes']=path.stat().st_size
        treefile=path.with_suffix('.trees')
        if not treefile.exists():
            continue
        stems=np.frombuffer(gzip.decompress(treefile.read_bytes()),'<u2').reshape(-1,6).copy()
        if len(stems):
            from station_vegetation import stem_support
            native_y,_=stem_support(stems,native_tile)
            new_y,_=stem_support(stems,path.read_bytes())
            moved=abs(new_y-native_y)>.04
            if np.any(moved):
                stems[moved,2]=(stems[moved,2].view('<i2')+np.rint(10*(new_y[moved]-native_y[moved]))).astype('<i2')
                treefile.write_bytes(gzip.compress(stems.tobytes(),mtime=0))
    grade_traffic(directory, manifest, [*(way for way, _, _ in profiles.values()), *bridge_ways])


def trim_joint_floors(tunnels):
    """Fill only the uncovered wedge between graded rectangular road strips."""
    from shapely import LineString, Polygon, union_all

    ends = defaultdict(list)
    for t in tunnels:
        for end,node in enumerate(t.get('nodes', ())):
            ends[node].append((t,end))
    for sections in ends.values():
        joints = [t['joints'][end] for t,end in sections if t.get('joints') and t['joints'][end]]
        if not joints:
            continue
        strips = [LineString([(x,z) for x,_,z in t['portals']]).buffer(t['halfWidth'], cap_style='flat')
                  for t,_ in sections]
        gap = Polygon(joints[0]['ring']).difference(union_all(strips))
        wedges = [list(poly.exterior.coords)[:-1] for poly in getattr(gap,'geoms',[gap])
                  if poly.geom_type=='Polygon' and poly.area>.00001]
        for joint in joints:
            joint['wedges'] = wedges


def stitch(ends,joints):
    for node in joints:
        sections = ends[node]
        if len(sections) < 2:
            continue
        edges = []
        for t,idx in sections:
            xy = np.array(t['portals'])[:,[0,2]]
            dx,dz = (xy[1]-xy[0])/t['length']
            side = np.array([-dz,dx])*t['halfWidth']
            edges.extend([xy[idx]-side,xy[idx]+side])
        hull = MultiPoint(edges).convex_hull
        if hull.area > .001:
            for k,(t,idx) in enumerate(sections):
                t.setdefault('joints',[None,None])[idx] = dict(ring=list(hull.exterior.coords)[:-1],draw=k==0)



def grade_traffic(directory, manifest, ways):
    import gzip
    import subprocess
    from tempfile import NamedTemporaryFile

    graph_path = directory/'roads'/'graph.json.gz'
    graph = json.loads(gzip.decompress(graph_path.read_bytes()))
    owners = {}
    roads = list(ways)
    # The north access road skirts the replaced station building. Its traffic
    # follows the finished native pavement, which can sit above the DEM.
    north_access = next((way for way in load_osm()
                         if way['type'] == 'way' and way['id'] == 1017598913), None)
    if north_access is not None:
        roads.append(north_access)
    for way in roads:
        for nodes in (way['nodes'], way.get('trafficNodes', [])):
            for a,b in zip(nodes,nodes[1:]):
                owners[a,b]=owners[b,a]=way
    lanes = []
    for lane in graph['lanes']:
        way = owners.get((lane['from'],lane['to']))
        if way is not None:
            lanes.append(dict(lane, way=way['id'],halfWidth=half_width(way),structure=next((s for s in ('bridge','tunnel') if way['tags'].get(s)=='yes'),'surface')))
    root=Path(__file__).resolve().parents[1]
    with NamedTemporaryFile(dir=directory,mode='w+') as payload:
        json.dump(dict(manifest=manifest,nodes=graph['nodes'],lanes=lanes),payload)
        payload.flush()
        subprocess.run([root/'node_modules/.bin/tsx',root/'scripts/railway-lane-heights.ts',
                        directory.resolve(),Path(payload.name).resolve()],cwd=root,check=True)
        payload.seek(0)
        changes=json.load(payload)
    for path in [graph_path,*sorted((directory/'roads').glob('*_*.json.gz'))]:
        content=graph if path==graph_path else json.loads(gzip.decompress(path.read_bytes()))
        changed=False
        for lane in content['lanes']:
            data=changes.get(str(lane['id']))
            if data:
                lane.update(data)
                changed=True
        if changed:
            path.write_bytes(gzip.compress(json.dumps(content,separators=(',',':'),ensure_ascii=False).encode(),mtime=0))


def section_sampler(sections):
    """Read the road triangles' station and footprint bounds for strict auditing."""
    from shapely import Polygon, union_all

    joints=defaultdict(list)
    by_way=defaultdict(list)
    for section in sections:
        if 'openCut' not in section:
            continue
        for end,joint in enumerate(section.get('joints', [])):
            if not joint or not joint.get('faces'):
                continue
            patches=[]
            for face in np.array(joint['faces']):
                xy=face[:,[0,2]]
                patches.append((Polygon(xy),xy[0],np.linalg.solve(
                    np.column_stack((xy-xy[0],np.ones(3))),face[:,1])))
            joints[section['way']].append((Polygon(joint['ring']).buffer(1.e-7),patches))
        a,b=section['portals']
        line=LineString([(a[0],a[2]),(b[0],b[2])])
        footprint=(union_all([Polygon(ring) for ring in section['footprint']])
                   if 'footprint' in section else line.buffer(section['halfWidth'],cap_style='flat'))
        by_way[section['way']].append((line,footprint,np.asarray(section['stations'])))
    def sample(way,x,z):
        if way in by_way:
            p=Point(x,z)
            for bounds,patches in joints[way]:
                if bounds.covers(p):
                    for triangle,origin,level in patches:
                        if triangle.distance(p)<1.e-7:
                            return float(np.dot([x-origin[0],z-origin[1],1.],level))
            for line,footprint,profile in by_way[way]:
                if footprint.covers(p):
                    return float(np.interp(line.project(p),profile[:,0],profile[:,1]))
        return None
    return sample

"""Grade the paired departure decks above the arrivals lanes at Liangjiang T2."""
import gzip
import json
import math
import struct
import subprocess
import tempfile
from heapq import heapify, heappop, heappush
from pathlib import Path

import numpy as np
import shapely
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
from shapely import LineString, box
from features import points
from service_streets import width

SPANS = (631243399, 710595378, 710595379)
LANDINGS = (631243400, 631243401, 710595377)


def grade(output, manifest, elements):
    ways={e['id']:e for e in elements if e['type']=='way' and e['id'] in SPANS+LANDINGS}
    if len(ways)!=len(SPANS+LANDINGS):
        return []
    axes={wid:LineString(points(w)) for wid,w in ways.items()}
    left,top,w,h=manifest['extent']
    if not box(left,top,left+w,top+h).covers(shapely.union_all(list(axes.values()))):
        return []
    lower=shapely.union_all([LineString(points(e)).buffer(width(e['tags'])/2)
                             for e in elements if e['type']=='way' and e.get('tags',{}).get('name')=='接客通道'])
    stations,refs,requests,clearance={}, {}, [], []
    for wid,axis in axes.items():
        xy=points(ways[wid])
        at=np.r_[0,np.cumsum(np.linalg.norm(np.diff(xy,axis=0),axis=1))]
        original=dict(zip(at,ways[wid]['nodes'],strict=True))
        ds=stations[wid]=np.unique(np.r_[at,np.arange(2,axis.length,2)])
        refs[wid]=[original.get(d,(wid,i)) for i,d in enumerate(ds)]
        for d in ds:
            c=axis.interpolate(d)
            a,b=(np.array(axis.interpolate(v).coords[0]) for v in (max(0,d-.1),min(axis.length,d+.1)))
            dx,dz=(b-a)/np.linalg.norm(b-a)
            cross=np.array(c.coords[0])+np.arange(-2,3)[:,None]*1.625*np.array([-dz,dx])
            requests.extend(dict(x=x,z=z) for x,z in cross)
            # Include the physical slab thickness as well as motor clearance.
            clearance.extend(np.where(shapely.intersects(lower,shapely.points(cross)),5.72,.055)
                             if wid in SPANS else [.055]*len(cross))
    root=Path(__file__).resolve().parents[1]
    with tempfile.TemporaryDirectory() as tmp:
        req=Path(tmp)/'terminal.json'
        req.write_text(json.dumps(dict(manifest=manifest,positions=requests)))
        subprocess.run([str(root/'node_modules/.bin/tsx'),'scripts/vehicle-grounding.ts','passage-heights',
                        str(output.resolve()),str(req)],cwd=root,check=True)
        minimum=(np.array(json.loads(req.read_text()))+clearance).reshape(-1,5).max(axis=1)
    levels,neighbors={},{}
    native={}
    samples=iter(minimum)
    for wid,ids in refs.items():
        for i,ref in enumerate(ids):
            minimum_level=next(samples)
            levels[ref]=max(levels.get(ref,-math.inf),minimum_level)
            if wid in LANDINGS:
                native[ref]=minimum_level
            neighbors.setdefault(ref,[])
            if i:
                previous=ids[i-1]
                budget=(stations[wid][i]-stations[wid][i-1])*.036
                neighbors[ref].append((previous,budget))
                neighbors[previous].append((ref,budget))
    # The mapped departure branches share junctions. Their deck footprints
    # overlap for several stations before the centerlines meet at a node.
    # Keep both slabs continuous over this part of the merge.
    for i,wid in enumerate(SPANS):
        for other in SPANS[i+1:]:
            if not set(ways[wid]['nodes']).intersection(ways[other]['nodes']):
                continue
            for station,ref in zip(stations[wid],refs[wid],strict=True):
                point=axes[wid].interpolate(station)
                projected=axes[other].project(point)
                if point.distance(axes[other])>7:
                    continue
                j=int(np.abs(stations[other]-projected).argmin())
                adjacent=refs[other][j]
                delta=.036*abs(projected-stations[other][j])
                neighbors[ref].append((adjacent,delta))
                neighbors[adjacent].append((ref,delta))
    # Mixed OSM IDs and synthetic station keys must never be heap tie breakers.
    queue=[(-y,i,ref) for i,(ref,y) in enumerate(levels.items())];heapify(queue)
    sequence=len(queue)
    while queue:
        neg,_,ref=heappop(queue)
        if -neg!=levels[ref]:
            continue
        for other,budget in neighbors[ref]:
            target=-neg-budget
            if target>levels[other]:
                levels[other]=target
                heappush(queue,(-target,sequence,other));sequence+=1
    ys={wid:[levels[ref] for ref in ids] for wid,ids in refs.items()}
    update_slabs(output,manifest['chunks'],axes,stations,ys)
    approaches=[]
    deck_nodes={node for wid in SPANS for node in ways[wid]['nodes']}
    for wid in LANDINGS:
        # The existing ground road already meets an unraised end. Preserve
        # its independently graded tunnel junctions further along the road.
        ends=[node for node in (refs[wid][0],refs[wid][-1]) if node in deck_nodes]
        if all(levels[node]-native[node]<.10 for node in ends):
            continue
        ds=stations[wid]
        for i in range(1,len(ds)):
            segment=LineString([axes[wid].interpolate(v) for v in ds[i-1:i+1]])
            if segment.length>.01:
                approaches.append((segment,3.75,ys[wid][i-1],ys[wid][i],.04,0))
    return approaches


def grade_airport_fork(output, manifest, elements):
    """Keep the branching ramp at the through deck height across their shared fork."""
    from canal_passages import sample_road_heights
    branch_id, through_id = 347655716, 759349526
    ways = {w['id']: w for w in elements if w['type'] == 'way' and w['id'] in (branch_id, through_id)}
    if len(ways) != 2:
        return
    branch = LineString(points(ways[branch_id]))
    through = LineString(points(ways[through_id]))
    x,z,w,h = manifest['extent']
    if not box(x,z,x+w,z+h).covers(branch):
        return
    junction = through.project(branch.interpolate(0))
    probes = [branch.interpolate(0), through.interpolate(junction+30),
              branch.interpolate(80), branch.interpolate(90)]
    heights = [deck for _,deck in sample_road_heights(output, manifest,
               [dict(x=p.x,z=p.y,roofProbe=True) for p in probes])]
    if all(h is None for h in heights):
        return
    if any(h is None for h in heights) or ways[branch_id]['nodes'][0] not in ways[through_id]['nodes']:
        raise ValueError('Check airport ramp survey against the rendered bridge fork')
    start, onward, end, beyond = heights
    # The overlapping decks meet within two centimetres for the first 32 m.
    # Tie back to the unmodified branch with the slope measured at 80–90 m.
    stations = np.arange(0.,81.,2.)
    t = np.clip((stations-32)/48,0,1)
    blend = t*t*(3-2*t)
    upper = np.array([start+(onward-start)*(through.project(branch.interpolate(s))-junction)/30-.02
                      for s in stations])
    lower = end+(beyond-end)*(stations-80)/10
    levels = upper*(1-blend)+lower*blend
    if np.max(np.abs(np.diff(levels)/np.diff(stations))) > .08:
        raise ValueError('Airport bridge fork transition exceeds its grade budget')
    update_slabs(output, manifest['chunks'], {branch_id:branch}, {branch_id:stations},
                 {branch_id:levels}, spans=(branch_id,))


def grade_service_overpass(output, manifest, elements):
    """Carry the tertiary deck over the service road at its mapped layer."""
    from canal_passages import sample_road_heights
    from vehicle_tunnels import grade_limit

    bridge_id, road_id = 815075448, 454950352
    ways = {w['id']: w for w in elements if w['type']=='way' and w['id'] in (bridge_id,road_id)}
    if len(ways)!=2:
        return
    axis, road = (LineString(points(ways[k])) for k in (bridge_id,road_id))
    x,z,w,h = manifest['extent']
    if not box(x,z,x+w,z+h).covers(axis):
        return
    crossing = axis.intersection(road)
    if crossing.geom_type!='Point' or ways[bridge_id]['tags'].get('bridge')!='yes':
        raise ValueError('Recheck the service-road overpass alignment')
    centre = axis.project(crossing)
    # Both ends are on the unmodified slab. Use a flat crest over the
    # lower road and cubic transitions on the two approaches.
    run, crest = 200., 20.
    stations = centre+np.arange(-run,run+1,2)
    if stations[0]<0 or stations[-1]>axis.length:
        raise ValueError('Insufficient deck length for the overpass transitions')
    cross_station = road.project(crossing)
    lower = [road.interpolate(cross_station+d) for d in np.arange(-12,13,2)]
    ends = [axis.interpolate(s) for s in (stations[0],stations[-1])]
    probes = [dict(x=p.x,z=p.y,roofProbe=True) for p in ends+lower]
    measurements = sample_road_heights(output,manifest,probes)
    abutments = [deck for _,deck in measurements[:2]]
    if all(y is None for y in abutments):
        return
    if any(y is None for y in abutments):
        raise ValueError('Missing surveyed overpass deck')
    top = max(native for native,_ in measurements[2:])+5.72
    base = np.interp(stations,stations[[0,-1]],abutments)
    t = np.clip((run-np.abs(stations-centre))/(run-crest),0,1)
    levels = base+(top-base)*t*t*(3-2*t)
    if np.max(np.abs(np.diff(levels)/np.diff(stations)))>grade_limit(ways[bridge_id]['tags']['highway']):
        raise ValueError('Service-road overpass exceeds tertiary grade limit')
    update_slabs(output,manifest['chunks'],{bridge_id:axis},{bridge_id:stations},
                 {bridge_id:levels},spans=(bridge_id,))


def update_slabs(output,chunks,axes,stations,ys,spans=SPANS):
    # GL04 is shared with previously released worlds. Recover each continuous
    # slab across tile seams to avoid moving a nearby lower road or canopy.
    search=shapely.union_all([axes[wid] for wid in spans]).buffer(12)
    records,triangles=[],[]
    for tile in chunks:
        x,z=tile['x'],tile['z']
        if not search.intersects(box(x,z,x+256,z+256)):
            continue
        path=output/tile['file'];data=gzip.decompress(path.read_bytes())
        n,k,size,image,count=struct.unpack_from('<5I',data,4)
        if not count:
            continue
        start=24+16900+9*n+4*k+size+image
        packed=np.frombuffer(data,'<i2',count*9,start).reshape(-1,3,3)
        triangles.append(packed.astype(np.int32)+[100*x,0,100*z])
        records.append((tile,path,data,start,packed))
    if not triangles:
        return
    xyz,indices=np.unique(np.concatenate(triangles).reshape(-1,3),axis=0,return_inverse=True)
    faces=indices.reshape(-1,3);a=faces.ravel();b=np.roll(faces,1,axis=1).ravel()
    _,labels=connected_components(coo_matrix((np.ones(len(a)),(a,b)),shape=(len(xyz),len(xyz))),directed=False)
    matched=set()
    for label in np.unique(labels):
        ids=np.flatnonzero(labels==label)
        if len(ids)<3:
            continue
        pts=shapely.points(xyz[ids][:,[0,2]]/100)
        for wid in spans:
            distances=shapely.distance(axes[wid],pts)
            if distances.max()>8:
                continue
            at=shapely.line_locate_point(axes[wid],pts)
            if at.min()>8 or axes[wid].length-at.max()>8:
                continue
            within = (at >= stations[wid][0]) & (at <= stations[wid][-1])
            xyz[ids[within],1]=np.rint(100*np.interp(at[within],stations[wid],ys[wid]))
            matched.add(wid)
            break
    if matched!=set(spans):
        raise ValueError(f'Cannot identify all T2 departures slabs: {matched}')
    first=0
    for tile,path,data,start,packed in records:
        count=len(packed)
        updated=xyz[faces[first:first+count],1];first+=count
        if np.array_equal(packed[:,:,1],updated):
            continue
        new=packed.copy();new[:,:,1]=updated
        path.write_bytes(gzip.compress(data[:start]+new.tobytes()+data[start+new.nbytes:],mtime=0))
        tile['bytes']=path.stat().st_size


def trim_bridge_endcaps(output, manifest, elements):
    """Clip overlapping legacy asphalt to the existing short bridge deck."""
    from shapely import Polygon, make_valid, union_all
    from shapely.affinity import translate
    from service_streets import rings
    from surveyed_corridors import read_chunk, write_chunk

    road=next((w for w in elements if w['type']=='way' and w['id']==1025751317),None)
    if not road:
        return
    axis=LineString(points(road))
    for tile in manifest['chunks']:
        x,z=tile['x'],tile['z']
        if not axis.intersects(box(x,z,x+256,z+256)):
            continue
        path=output/tile['file']
        raw,start,size,c=read_chunk(path)
        paths=c[1]
        survey=paths[12] if len(paths)>12 else None
        if not survey:
            continue
        image,count=struct.unpack_from('<2I',raw,16)
        triangles=np.frombuffer(raw,'<i2',count*9,start+size+image).reshape(-1,3,3)
        local=translate(axis,-x,-z)
        envelope=local.buffer(7)
        slabs=[]
        for tri in triangles:
            poly=Polygon(tri[:,[0,2]]/100)
            if poly.area and envelope.covers(poly) and poly.intersects(local):
                slabs.append(poly)
        cover=union_all(slabs)
        if cover.is_empty:
            continue
        # Both landings have centimetre-scale deck vertices. Keep the bed,
        # banks, bridge faces and surveyed road triangles byte-for-byte.
        rebuilt=[]
        offsets=[]
        for i,(kind,shell,*holes) in enumerate(paths[0]):
            offsets.append(len(rebuilt))
            if kind not in (0,5) or survey['start']<=i<survey['end']:
                rebuilt.append([kind,shell,*holes])
                continue
            poly=make_valid(Polygon(np.asarray(shell)/100,[np.asarray(h)/100 for h in holes]))
            if poly.intersection(cover).area<.001:
                rebuilt.append([kind,shell,*holes])
            else:
                rebuilt.extend(rings(kind,poly.difference(cover)))
        offsets.append(len(rebuilt))
        if rebuilt==paths[0]:
            continue
        if len(paths)>11 and paths[11]:
            paths[11][0]=offsets[paths[11][0]]
        survey['start'],survey['end']=offsets[survey['start']],offsets[survey['end']]
        paths[0]=rebuilt
        write_chunk(path,raw,start,size,c)
        tile['bytes']=path.stat().st_size

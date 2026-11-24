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
    samples=iter(minimum)
    for wid,ids in refs.items():
        for i,ref in enumerate(ids):
            levels[ref]=max(levels.get(ref,-math.inf),next(samples))
            neighbors.setdefault(ref,[])
            if i:
                previous=ids[i-1]
                budget=(stations[wid][i]-stations[wid][i-1])*.036
                neighbors[ref].append((previous,budget))
                neighbors[previous].append((ref,budget))
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
    for wid in LANDINGS:
        ds=stations[wid]
        for i in range(1,len(ds)):
            segment=LineString([axes[wid].interpolate(v) for v in ds[i-1:i+1]])
            if segment.length>.01:
                approaches.append((segment,3.75,ys[wid][i-1],ys[wid][i],.04,0))
    return approaches


def update_slabs(output,chunks,axes,stations,ys):
    # GL04 is shared with previously released worlds. Recover each continuous
    # slab across tile seams to avoid moving a nearby lower road or canopy.
    search=shapely.union_all([axes[wid] for wid in SPANS]).buffer(12)
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
        for wid in SPANS:
            distances=shapely.distance(axes[wid],pts)
            if distances.max()>8:
                continue
            at=shapely.line_locate_point(axes[wid],pts)
            if at.min()>8 or axes[wid].length-at.max()>8:
                continue
            xyz[ids,1]=np.rint(100*np.interp(at,stations[wid],ys[wid]))
            matched.add(wid)
            break
    if matched!=set(SPANS):
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

"""Generate reproducible across-platform walk probes from the finished passenger slabs."""
import argparse
import json
from pathlib import Path
from common import load_osm
from features import area
import numpy as np
from shapely import Polygon, polygons, union_all, contains_xy, LineString, prepare
from check_rail_platforms import pavement_triangles, pavement

def route(world,p,end,u,v,far):
    faces=pavement_triangles(world.resolve(),[p.bounds],'paving-1')
    walkable=union_all(polygons(faces[:,:,[0,2]])).intersection(p).buffer(.025,join_style='mitre').buffer(-.58,join_style='mitre')
    prepare(walkable)
    length=(far-end)@u
    lateral=np.arange(-11,11.01,.25)
    ss=np.linspace(1.1,length-1.1,int(length)+1)
    coords=end+ss[:,None,None]*u+lateral[None,:,None]*v
    available=contains_xy(walkable,coords[:,:,0],coords[:,:,1])
    cost=np.full(len(lateral),np.inf);cost[(abs(lateral)<.01)&available[0]]=0
    pred=[]
    for i in range(1,len(ss)):
        # Penalise unnecessary turns and prefer the middle of the slab.
        options=np.full((7,len(lateral)),np.inf)
        for j,shift in enumerate(range(-3,4)):
            src=np.arange(len(lateral))-shift
            ok=(src>=0)&(src<len(lateral))&available[i]
            src=np.clip(src,0,len(lateral)-1);ok &= np.isfinite(cost[src])
            for f in (.25,.5,.75):
                q=coords[i-1,src]+f*(coords[i]-coords[i-1,src])
                ok &=contains_xy(walkable,q[:,0],q[:,1])
            options[j,ok]=cost[src[ok]]+.1*lateral[ok]**2+shift**2
        pred.append(options.argmin(axis=0)-3)
        cost=options.min(axis=0)
        if not np.isfinite(cost).any():raise ValueError(f'No path at {ss[i]} m, lip {end}')
    j=int(np.argmin(cost));last=coords[-1,j];out=[last+u*.65]
    for i in range(len(ss)-1,0,-1):
        out.append(coords[i,j]);j-=pred[i-1][j]
    return [end+.55*u,*reversed(out)]

def cases(world):
    manifest = json.loads((world/'manifest.json').read_bytes())
    ways = {w['id']: w for w in load_osm() if w['type']=='way'}
    config = json.loads(Path(__file__).with_name('rail-sections').joinpath('09-guilinbei-yard.json').read_bytes())
    results = []
    for ramp in config['platformAccess']:
        wid = ramp['platform']
        ring = manifest.get('platformOutlines',{}).get(str(wid))
        polygon = Polygon(ring) if ring else area(ways[wid])
        end = np.array(ramp['endXZ'])
        along = np.array(ramp['inward'])
        normal = along[::-1]*[-1,1]
        center = np.array(polygon.centroid.coords[0])
        span = np.linalg.norm(np.subtract(polygon.bounds[2:],polygon.bounds[:2]))
        line = polygon.intersection(LineString([center-along*span,center+along*span]))
        far = max(np.array(line.coords),key=lambda pt: (pt-end)@along)
        probes = route(world,polygon,end,along,normal,far)
        height = pavement(world.resolve(),[polygon.bounds],np.array(probes))
        if not np.isfinite(height).all():
            raise ValueError(f'Missing walkable floor on platform {wid}')
        toe = ramp['length']
        approach = [end-s*along for s in [toe+3,*np.linspace(toe,1,9)]]
        results.append(dict(platform=wid,points=np.round(approach+probes,6).tolist(),
                            levels=[None]*len(approach)+height.tolist()))
    return results


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('world',type=Path)
    print(json.dumps(cases(parser.parse_args().world)))

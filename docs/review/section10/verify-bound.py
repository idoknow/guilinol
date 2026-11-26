"""Run in the product checkout: PYTHONPATH=pipeline python verify-bound.py WORLD frozen-bound.json"""
import json,sys
from collections import Counter
from pathlib import Path
import numpy as np
from shapely import LineString,Point
from check_rail_section_tracks import tile_rails,load_tracks
from station_corridor import parallel_segments,grade_limit
from features import points

world,certificate=map(Path,sys.argv[1:])
data=json.loads(certificate.read_bytes())
vertices={int(k):v for k,v in data['vertices'].items()}
ids=list(vertices)
index={n:i for i,n in enumerate(ids)}
xy=np.array([(vertices[n]['x'],vertices[n]['z']) for n in ids])
heights=np.array([vertices[n]['heightM'] for n in ids])
ways=load_tracks({w for row in data['constraints'] for w in row['ways']})
section = data["fixedSection"]
assert section in {"09-guilinbei-yard"}
scope = json.loads((Path("pipeline/rail-sections") / (section + ".json")).read_bytes())["railTies"]
def node_key(x,z,h):return tuple(np.round([x,z,h],6))
def expected_chord(a,b):return frozenset([node_key(*xy[a],heights[a]),node_key(*xy[b],heights[b])])
encoded=set()
manifest=json.loads((world/'manifest.json').read_bytes())
for t in manifest['chunks']:
 if not np.any((xy[:,0]>=t['x']-.001)&(xy[:,0]<=t['x']+256.001)&(xy[:,1]>=t['z']-.001)&(xy[:,1]<=t['z']+256.001)):continue
 for ax,az,ah,bx,bz,bh,*_ in tile_rails(world,t):
  encoded.add(frozenset([node_key(t['x']+ax/100,t['z']+az/100,ah/100),
                         node_key(t['x']+bx/100,t['z']+bz/100,bh/100)]))
combined=Counter();weighted_grade=parallel_weight=0.
for row in data['constraints']:
 nodes=[index[n] for n,c in row['terms']]
 coeff=np.array([c for n,c in row['terms']])
 legs=[]
 for w,i,j in zip(row['ways'],nodes[::2],nodes[1::2]):
  assert expected_chord(i,j) in encoded
  axis=LineString(points(ways[w]))
  assert all(axis.distance(Point(xy[n]))<.001 for n in [i,j])
  legs.append((i,j,0,0,w))
 weight=row['weight'];assert weight>0
 if row['kind']=='grade':
  limit=np.linalg.norm(xy[nodes[1]]-xy[nodes[0]])*grade_limit(ways[row['ways'][0]]['tags'])
  assert abs(limit-row['limitM'])<1e-6 and set(coeff)=={-1.,1.}
  weighted_grade+=limit*weight
 else:
  a,b,us,vs,*_=parallel_segments(legs,xy,ways,include_structures=True)
  assert any(np.allclose(sign*np.array([1-u,u,v-1,-v]),coeff,atol=1e-9,rtol=0)
             for q,r,pu,pv in zip(a,b,us,vs) if [*q,*r]==nodes
             for u,v in zip(pu,pv) for sign in [-1,1])
  parallel_weight+=weight
 for n,c in zip(nodes,coeff):combined[n]+=c*weight
fixed=0.;anchors=[]
for n,c in combined.items():
 if abs(c)<1e-9:continue
 v=vertices[ids[n]]
 assert any(str(w) in scope and min(scope[str(w)])-.001<=LineString(points(ways[w])).project(Point(xy[n]))<=max(scope[str(w)])+.001 for w in v['ways'] if w in ways)
 anchors.append(v['ways'])
 fixed+=c*heights[n]
bound=(fixed-weighted_grade)/parallel_weight
assert abs(bound-data['minimumM'])<1e-6
print(f'{len(data["constraints"])} inequalities, fixed anchors {anchors}, minimum maximum parallel mismatch {bound:.9f} m')

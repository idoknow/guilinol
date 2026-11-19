"""Audit packed ramp edges in local metres against the source OSM linework."""
import json
import subprocess
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree
from shapely.geometry import LineString, box

from common import ll2xz, load_osm
from features import points
from landmarks.jiefang_layout import OSM, RAMPS, section, widths

root=Path(__file__).resolve().parent.parent
landmark=next(x for x in json.loads((root/'pipeline/landmarks.json').read_text()) if x['id']=='jiefang_bridge')
origin=ll2xz(*landmark['anchor'][::-1])
angle=np.radians(-landmark['rotation'])
inverse=np.array([[np.cos(angle),-np.sin(angle)],[np.sin(angle),np.cos(angle)]])
sources={}
for el in load_osm():
    if el['type']=='way' and el['id'] in OSM:
        coords=(np.array(points(el))-origin)@inverse
        if el['id'] in (258909993,259020569,1531308428,1531308427,675174045,1382486210,1382486212):
            coords=np.asarray(LineString(coords).intersection(box(-265,-120,-65,120)).coords)
        assert np.max(np.linalg.norm(OSM[el['id']]-coords,axis=1))<.001,el['id']
        sources[el['id']]=LineString(coords)
assert sources.keys()==OSM.keys()
raw=subprocess.check_output(['node',root/'pipeline/glb-triangles.mjs',root/'public'/landmark['model']])
vertices=np.frombuffer(raw,'<f4').reshape(-1,3)
tree=cKDTree(vertices)
for way in RAMPS:
    xy,n,station,y=section(way)
    edges=[]
    for offset in widths(way)[:2]:
        p=xy+n*offset[:,None]
        error,index=tree.query(np.column_stack([p[:,0],y,p[:,1]]))
        assert error.max()<.04,(way,error.max())
        edges.append(vertices[index][:,[0,2]])
    center=LineString((edges[0]+edges[1])/2)
    deviation=sources[way].hausdorff_distance(center)
    assert deviation<=2,(way,deviation)
    print(f'{way}  length={station[-1]:.2f} m  max_center_error={deviation:.3f} m  grade={530/station[-1]:.2f}%')

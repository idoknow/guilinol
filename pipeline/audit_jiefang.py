"""Audit packed ramp edges in local metres against the source OSM linework."""
import json
import subprocess
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree
from shapely.geometry import LineString, box

from common import ll2xz, load_osm
from features import points
from landmarks.jiefang_layout import site_limit, OSM, RAMPS, UPPER_ROADS, LOWER_ROADS, FOOTWAYS, SIDE_ROAD, section, widths, libin_levels

root=Path(__file__).resolve().parent.parent
landmark=next(x for x in json.loads((root/'pipeline/landmarks.json').read_text()) if x['id']=='jiefang_bridge')
origin=ll2xz(*landmark['anchor'][::-1])
angle=np.radians(-landmark['rotation'])
inverse=np.array([[np.cos(angle),-np.sin(angle)],[np.sin(angle),np.cos(angle)]])
sources={}
for el in load_osm():
    if el['type']=='way' and el['id'] in OSM:
        if el['id'] in RAMPS:
            assert el['tags']['highway']=='primary_link' and el['tags']['oneway']=='yes',el['id']
        coords=(np.array(points(el))-origin)@inverse
        if el['id'] in (258909993,259020569,1531308428,1531308427,675174045,1382486210,1382486212):
            limit=site_limit(el["id"])
            coords=np.asarray(LineString(coords).intersection(box(-265,-limit,-65,limit)).coords)
        assert np.max(np.linalg.norm(OSM[el['id']]-coords,axis=1))<.001,el['id']
        sources[el['id']]=LineString(coords)
assert sources.keys()==OSM.keys()
raw=subprocess.check_output(['node',root/'pipeline/glb-triangles.mjs',root/'public'/landmark['model']])
vertices=np.frombuffer(raw,'<f4').reshape(-1,3)
tree=cKDTree(vertices)
for way in RAMPS+UPPER_ROADS+LOWER_ROADS+SIDE_ROAD+FOOTWAYS:
    xy,n,station,y=section(way)
    edges=[]
    for offset in widths(way)[:2]:
        p=xy+n*np.broadcast_to(offset,len(xy))[:,None]
        h=libin_levels(p) if way in SIDE_ROAD else y+.12 if way in FOOTWAYS else y
        # West end of the bridge overlaps the approach at the expansion joint.
        if way in UPPER_ROADS:
            p[np.argmax(xy[:,0]),0]+=-139.9-xy[:,0].max()
        error,index=tree.query(np.column_stack([p[:,0],h,p[:,1]]))
        assert error.max()<.04,(way,error.max())
        edges.append(vertices[index][:,[0,2]])
    center=LineString((edges[0]+edges[1])/2)
    deviation=sources[way].hausdorff_distance(center)
    assert deviation<=2,(way,deviation)
    if way in RAMPS:
        print(f'{way}  length={station[-1]:.2f} m  max_center_error={deviation:.3f} m  grade={530/station[-1]:.2f}%')
    else:
        print(f'{way}  max_center_error={deviation:.3f} m')

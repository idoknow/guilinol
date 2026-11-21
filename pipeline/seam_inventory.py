"""Measure LOD0 paving and same-level street contacts from decoded release assets."""
from collections import defaultdict
import json
import math
from pathlib import Path
import subprocess

import numpy as np
import shapely


def atlas_mask(uv, box):
    tolerance=.5/4095  # gltfpack UV quantization, as in lib/atlas-ground.mjs
    box=np.asarray(box)
    return np.all((uv >= box[:2]-tolerance) & (uv <= box[2:]+tolerance), axis=(1, 2))


def street_contacts(faces, triangles, normals, streets):
    """Use a point on the projected triangle nearest the street, including edge-only hits."""
    kinds = np.full(len(faces), -1)
    if not len(faces):
        return kinds
    query = shapely.box(*(shapely.total_bounds(faces) + [-2,-2,2,2]))
    size = streets.world.size
    for origin in streets.world.files:
        tile = shapely.box(*origin, origin[0]+size, origin[1]+size)
        if not tile.intersects(query):
            continue
        tree, roles, _ = streets.tile(origin)
        indices, polygons = tree.query(faces,predicate='dwithin',distance=2.)
        for i,j in zip(indices,polygons):
            if kinds[i]>=0 or roles[j] not in (0,1,2,5,6):
                continue
            link = shapely.shortest_line(faces[i],tree.geometries[j])
            (x,z),(sx,sz) = link.coords
            a,n = triangles[i,0],normals[i]
            y = a[1]-((x-a[0])*n[0]+(z-a[2])*n[2])/n[1]
            # Reject roofs and furniture above the contact plane; include raised paving.
            if abs(y-streets.at(sx,sz)[0])<=.20:
                kinds[i]=roles[j]
    return kinds


def inventory(entry, public, config, streets):
    path=public/entry['file']
    with path.open('rb') as source:
        source.seek(12)
        size=int.from_bytes(source.read(4),'little')
        source.seek(20)
        materials=[m.get('name','') for m in json.loads(source.read(size)).get('materials',[])]
    output=subprocess.check_output(['node',Path(__file__).with_name('glb-triangles.mjs'),path,'--inventory'])
    data=np.frombuffer(output,'<f4').reshape(-1,16)
    vertices=data[:,1:].reshape(-1,3,5)
    angle=math.radians(entry['rotation'])
    c,s=math.cos(angle),math.sin(angle)
    triangles=vertices[:,:,:3] @ [[c,0,-s],[0,1,0],[s,0,c]] + entry['position']
    normals=np.cross(triangles[:,1]-triangles[:,0],triangles[:,2]-triangles[:,0])
    top=normals[:,1]>.7*np.linalg.norm(normals,axis=1)
    triangles,normals,uv,materials_idx=triangles[top],normals[top],vertices[top,:,3:],data[top,0]
    roles=config['surfaces'].get(entry['id'],{})
    atlas=config['atlas'].get(entry['id'],[])
    rules=atlas if isinstance(atlas,list) else [atlas]
    exceptions={r['material'] for r in config['exceptions'] if r['id']==entry['id'] and r.get('kind','material')=='material'}
    groups=defaultdict(list)
    for index in np.unique(materials_idx):
        material=materials[int(index)] if index>=0 else ''
        mask=materials_idx==index
        for rule in rules:
            if material==rule['material'] and material not in exceptions:
                selected=mask & atlas_mask(uv,rule['box'])
                groups[(material,tuple(rule['box']),rule['role'],'bound')].extend(np.flatnonzero(selected))
                mask &= ~selected
        if material in exceptions or material in roles:
            groups[(material,(),roles.get(material,'plaza'),'exception' if material in exceptions else 'bound')].extend(np.flatnonzero(mask))
            continue
        # Dedicated street primitives retain their semantic role even if a
        # landmark author forgets the runtime binding on an elevated deck.
        expected={'road':'road','road_paint':'marking','curb_face':'curb','curb':'curb',
                  'sidewalk':'sidewalk'}
        ids=np.flatnonzero(mask)
        if material in expected:
            groups[(material,(),expected[material],'unbound')].extend(ids)
            continue
        contacts=street_contacts(shapely.polygons(triangles[ids][:,:,::2]),triangles[ids],normals[ids],streets)
        for kind,role in [(0,'road'),(5,'road'),(1,'sidewalk'),(6,'sidewalk'),(2,'marking')]:
            groups[(material,(),role,'unbound')].extend(ids[contacts==kind])
    result=[]
    for (material,box,role,status),ids in sorted(groups.items()):
        if ids:
            area=normals[ids,1]/2
            point=triangles[ids[np.argmax(area)]].mean(axis=0)
            measured_box=box
            if not box and status=='unbound' and np.isfinite(uv[ids]).all():
                extent=uv[ids].reshape(-1,2)
                measured_box=np.r_[extent.min(axis=0),extent.max(axis=0)].round(5).tolist()
            result.append(dict(material=material,box=measured_box,role=role,status=status,faces=len(ids),
                               areaM2=round(sum(area),3),worldXZ=point[::2].round(3).tolist()))
    return result

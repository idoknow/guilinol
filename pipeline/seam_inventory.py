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


def surface_components(triangles):
    """Shared 3D edges connect ramp panels without joining stacked floors."""
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import connected_components
    n = len(triangles)
    vertex = np.unique(np.round(triangles.reshape(-1, 3), 3), axis=0,
                       return_inverse=True)[1].reshape(n, 3)
    edges = np.sort(vertex[:, [[0, 1], [1, 2], [2, 0]]].reshape(-1, 2), axis=1)
    order = np.lexsort(edges.T)
    adjacent = np.all(edges[order[1:]] == edges[order[:-1]], axis=1)
    a, b = order[:-1][adjacent] // 3, order[1:][adjacent] // 3
    graph = coo_matrix((np.ones(len(a)), (a, b)), shape=(n, n))
    return connected_components(graph, directed=False)[1]


class ModelCover:
    def __init__(self, triangles):
        projected = triangles[:, :, ::2]
        a, b = projected[:, 1] - projected[:, 0], projected[:, 2] - projected[:, 0]
        valid = np.abs(a[:, 0]*b[:, 1] - a[:, 1]*b[:, 0]) > 1e-8
        self.triangles = triangles[valid]
        self.tree = shapely.STRtree(shapely.polygons(projected[valid]))

    def hides(self, face, triangle):
        # Keep exposed strips beyond eaves. Use both roof slopes and undersides.
        ids = self.tree.query(face, predicate='intersects')
        above = self.triangles[ids, :, 1].min(axis=1) > triangle[:, 1].max() + .02
        if not np.any(above):
            return False
        roofs = self.tree.geometries[ids[above]]
        return shapely.difference(face, shapely.union_all(roofs)).area < 1e-7


def street_contacts(faces, triangles, normals, streets, connected=None):
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
            if abs(y-streets.at(sx,sz)[0]) <= .05 or (connected is not None and connected[i]):
                kinds[i]=roles[j]
    return kinds


def material_names(path):
    with path.open('rb') as source:
        source.seek(12)
        size=int.from_bytes(source.read(4),'little')
        source.seek(20)
        return [m.get('name','') for m in json.loads(source.read(size)).get('materials',[])]


def inventory(entry, public, config, streets):
    path=public/entry['file']
    materials=material_names(path)
    output=subprocess.check_output(['node',Path(__file__).with_name('glb-triangles.mjs'),path,'--inventory'])
    data=np.frombuffer(output,'<f4').reshape(-1,16)
    vertices=data[:,1:].reshape(-1,3,5)
    angle=math.radians(entry['rotation'])
    c,s=math.cos(angle),math.sin(angle)
    triangles=vertices[:,:,:3] @ [[c,0,-s],[0,1,0],[s,0,c]] + entry['position']
    normals=np.cross(triangles[:,1]-triangles[:,0],triangles[:,2]-triangles[:,0])
    all_triangles = triangles
    cover = None
    top=normals[:,1]>.7*np.linalg.norm(normals,axis=1)
    triangles,normals,uv,materials_idx=triangles[top],normals[top],vertices[top,:,3:],data[top,0]
    roles=config['surfaces'].get(entry['id'],{})
    atlas=config['atlas'].get(entry['id'],[])
    rules=atlas if isinstance(atlas,list) else [atlas]
    exceptions={r['material'] for r in config['exceptions'] if r['id']==entry['id'] and r.get('kind','material')=='material'}
    walkable = normals[:, 1] >= math.cos(math.radians(15))*np.linalg.norm(normals, axis=1)
    component = np.full(len(normals), -1)
    component[walkable] = surface_components(triangles[walkable])
    bound = np.isin(materials_idx, [i for i, m in enumerate(materials) if m in roles])
    for rule in rules:
        if rule['material'] in materials:
            bound |= (materials_idx == materials.index(rule['material'])) & atlas_mask(uv, rule['box'])
    connected = walkable & np.isin(component, component[bound & walkable])
    component_width = {}
    area = np.bincount(component[walkable], weights=normals[walkable, 1]/2)
    groups=defaultdict(list)
    for index in np.unique(materials_idx):
        material=materials[int(index)] if index>=0 else ''
        mask=materials_idx==index
        for rule in rules:
            if material==rule['material'] and material not in exceptions:
                selected=mask & atlas_mask(uv,rule['box'])
                groups[(material,tuple(rule['box']),rule['role'],'bound')].extend(np.flatnonzero(selected))
                mask &= ~selected
        if any(r['id'] == entry['id'] and r['material'] == material for r in config.get('notStreet', [])):
            groups[(material, (), 'fixture', 'notStreet')].extend(np.flatnonzero(mask))
            continue
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
        ids = ids[walkable[ids]]
        faces = shapely.polygons(triangles[ids][:, :, ::2])
        contacts = street_contacts(faces, triangles[ids], normals[ids], streets, connected[ids])
        for i in np.flatnonzero(contacts >= 0):
            if cover is None:
                cover = ModelCover(all_triangles)
            if cover.hides(faces[i], triangles[ids[i]]):
                contacts[i] = -1
            elif area[component[ids[i]]] < .5:
                groups[(material, (), 'fragment', 'fragment')].append(ids[i])
                contacts[i] = -1
            else:
                label = component[ids[i]]
                if label not in component_width:
                    points = triangles[component == label][:, :, ::2].reshape(-1, 2)
                    rect = shapely.MultiPoint(points).minimum_rotated_rectangle
                    component_width[label] = np.min(np.linalg.norm(np.diff(rect.exterior.coords, axis=0), axis=1))
                if component_width[label] < .6:
                    contacts[i] = -1
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

"""Measure packed LOD0 connected components against GL04 and neighbouring surfaces."""
import argparse
import json
from pathlib import Path
import subprocess

import numpy as np
from PIL import Image, ImageDraw
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
import shapely
import trimesh

from grounding_fixtures import CRAFT, ENDS, PIERS
from landmarks.world_surface import LandmarkSurface, Surface, WORLD

ROOT = WORLD.parent.parent
FLOAT, SINK = .15, .30
BEARING_BAND = .50
CONTACT = .035  # Allows GLB quantization and small joints between touching meshes.


def assemblies(vertices, faces, component, count):
    """Join components at physical contacts, including UV/material seams and T joints."""
    tris = vertices[faces].astype(float)
    lo, hi = tris.min(axis=1), tris.max(axis=1)
    tree = shapely.STRtree(shapely.box(lo[:,0]-CONTACT,lo[:,2]-CONTACT,
                                       hi[:,0]+CONTACT,hi[:,2]+CONTACT))
    bonds = []
    for start in range(0, len(vertices), 512):
        v, f = tree.query(shapely.points(vertices[start:start+512,::2]))
        v += start
        a, b = component[v], component[faces[f,0]]
        y = vertices[v,1]
        keep = (a != b) & (lo[f,1]-CONTACT <= y) & (y <= hi[f,1]+CONTACT)
        v,f = v[keep],f[keep]
        if not len(v):
            continue
        points = vertices[v].astype(float)
        nearest = trimesh.triangles.closest_point(tris[f], points)
        touching = np.linalg.norm(nearest-points,axis=1) <= CONTACT
        bonds.extend(zip(component[v[touching]],component[faces[f[touching],0]]))
    i,j = np.asarray(bonds, dtype=int).reshape(-1,2).T
    graph = coo_matrix((np.ones(len(i),dtype=bool),(i,j)),shape=(count,count))
    return connected_components(graph,directed=False)[1]



def bearing_components(vertices,component,assembly,low):
    """Associate detached cladding with the lower assembly that encloses its plan."""
    group = assembly[component]
    n = group.max()+1
    floor = np.full(n,np.inf)
    np.minimum.at(floor,assembly,low)
    indices = np.split(np.argsort(group),np.cumsum(np.bincount(group))[:-1])
    # A hull across the whole scene would combine separate buildings. Use only
    # shells that already meet in 3D, then require full footprint containment.
    shells = np.asarray([shapely.convex_hull(shapely.multipoints(vertices[i,::2])) for i in indices])
    tree = shapely.STRtree(shells)
    outer,inner = tree.query(shells,predicate='covers')
    above = floor[inner] > floor[outer]+BEARING_BAND
    local_floor = floor.copy()
    np.minimum.at(local_floor,inner[above],floor[outer[above]])
    return low <= local_floor[assembly]+BEARING_BAND


def measurements(model, surface):
    raw = subprocess.check_output(['node', ROOT/'pipeline/glb-triangles.mjs', model, '--visible'], timeout=90)
    vertices, index = np.unique(np.frombuffer(raw, '<f4').reshape(-1, 3), axis=0, return_inverse=True)
    faces = index.reshape(-1, 3)
    edges = coo_matrix((np.ones(faces.size, dtype=bool),
                        (faces.ravel(), np.roll(faces, 1, axis=1).ravel())), shape=(len(vertices),)*2)
    count, component = connected_components(edges, directed=False)
    low = np.full(count, np.inf)
    np.minimum.at(low, component, vertices[:, 1])
    assembly = assemblies(vertices, faces, component, count)
    bearing = bearing_components(vertices,component,assembly,low)
    craft = np.full(count,-1)
    centers = np.column_stack([np.bincount(component,weights=vertices[:,axis])/np.bincount(component)
                               for axis in (0,2)])
    boats = CRAFT.get(surface.name, [])
    for number,(x,z,radius,draft,reason) in enumerate(boats):
        inside = np.linalg.norm(centers-[x,z],axis=1)<radius
        if not inside.any():
            raise ValueError(f'Missing craft at {(x,z)}')
        # Boat superstructure belongs to this hull even across packed materials.
        bearing[inside] = low[inside] <= low[inside].min()+BEARING_BAND
        craft[inside] = number
    base = np.flatnonzero(bearing[component] & (vertices[:, 1] <= low[component]+.025))
    pts = vertices[base].astype(float)
    samples = [surface.sample(x, z) for x, _, z in pts]
    terrain = np.array([g for g, _ in samples])
    levels = np.array([np.nan if w is None else w for _, w in samples])
    support = terrain.copy()
    # Intersect vertical rays with other components. Projected areas alone
    # cannot distinguish a railing on a deck from one underneath it.
    triangles = vertices[faces].astype(float)
    normal = np.cross(triangles[:, 1]-triangles[:, 0], triangles[:, 2]-triangles[:, 0])
    ids = np.flatnonzero(normal[:, 1] > 1e-6)
    tree = shapely.STRtree(shapely.polygons(triangles[ids][:, :, ::2]))
    for start in range(0, len(pts), 512):
        p, t = tree.query(shapely.points(pts[start:start+512, ::2]), predicate='intersects')
        p += start
        t = ids[t]
        diff = pts[p]-triangles[t, 0]
        height = triangles[t, 0, 1]-(normal[t, 0]*diff[:, 0]+normal[t, 2]*diff[:, 2])/normal[t, 1]
        usable = (component[faces[t, 0]] != component[base[p]]) & (height <= pts[p, 1]+.015)
        usable &= np.isnan(levels[p]) | (pts[p,1] >= levels[p])
        np.maximum.at(support, p[usable], height[usable])
    for number,(_,_,_,draft,_) in enumerate(boats):
        mask = craft[component[base]]==number
        if not np.isfinite(levels[mask]).all():
            raise ValueError(f'Floating craft leaves water: {surface.name} {number}')
        support[mask] = levels[mask]-draft
    gap = pts[:, 1]-support
    rows = []
    labels, sizes = np.unique(component[base], return_counts=True)
    groups = np.split(np.argsort(component[base]), np.cumsum(sizes)[:-1])
    for group, indices in zip(labels, groups):
        values = gap[indices]
        worst = indices[np.argmax(np.maximum(values-FLOAT, -values-SINK))]
        x, y, z = pts[worst]
        rows.append(dict(component=int(group), assembly=int(assembly[group]), bottomVertices=len(indices), minGap=round(float(min(values)),3),
                         maxGap=round(float(max(values)),3), local=[round(v,3) for v in (x,y,z)],
                         ground=round(terrain[worst],3), support=round(support[worst],3),
                         water=None if np.isnan(levels[worst]) else round(levels[worst],3),
                         status='fail' if max(values)>FLOAT or min(values)<-SINK else 'pass'))
        if craft[group] >= 0:
            rows[-1]['rule'] = boats[craft[group]][4]
    for role,stations in [('bridge-end',ENDS),('pier',PIERS)]:
        for label,x,z in stations.get(surface.name,[]):
            ground,water=surface.sample(x,z)
            # Sample triangles intersected by a vertical line through the station.
            normal = np.cross(triangles[:,1]-triangles[:,0],triangles[:,2]-triangles[:,0])
            flat = triangles[:,:,::2]
            ids = np.flatnonzero((flat.min(axis=1)<=[x,z]).all(axis=1)
                               & (flat.max(axis=1)>=[x,z]).all(axis=1) & (abs(normal[:,1])>1e-6))
            if len(ids):
                ids=ids[shapely.intersects_xy(shapely.polygons(flat[ids]),x,z)]
            hits=triangles[ids,0,1] - ((x-flat[ids,0,0])*normal[ids,0]+(z-flat[ids,0,1])*normal[ids,2])/normal[ids,1]
            reference=ground
            if label=='upper road joint':
                # The upper roadway continues over the west underpass. Intersect
                # its approach just outside the bridge GLB's 281 m span.
                approach_x=x-.20
                nearby=(flat.min(axis=1)<=[approach_x,z]).all(axis=1)&(flat.max(axis=1)>=[approach_x,z]).all(axis=1)
                approach=np.flatnonzero(nearby & (normal[:,1]>.85*np.linalg.norm(normal,axis=1)))
                approach=approach[shapely.intersects_xy(shapely.polygons(flat[approach]),approach_x,z)]
                if len(approach):
                    ref_hits=triangles[approach,0,1]-((approach_x-flat[approach,0,0])*normal[approach,0]+(z-flat[approach,0,1])*normal[approach,2])/normal[approach,1]
                    reference=float(max(ref_hits))
            if label=='nine-bends-island':
                # A neighbouring island cap supplies the landing at this end.
                caps=hits[(normal[ids,1]>0)&(np.ptp(triangles[ids,:,1],axis=1)<.025)
                          & (abs(normal[ids,1])>10)]
                if len(caps): reference=max(caps)
            if role=='bridge-end':
                # Upward, nearly horizontal faces at the landing; road markings add only centimetres.
                walkable=(normal[ids,1] > .85*np.linalg.norm(normal[ids],axis=1))
                deck=hits[walkable]
                height=float(max(deck)) if len(deck) else None
                error=None if height is None else height-reference
                passed=error is not None and abs(error)<=.3
            else:
                height=float(min(hits)) if len(hits) else None
                error=None if height is None else height-ground
                passed=(height is not None and water is not None and height<water
                        and -.30<=error<=.015 and max(hits)>=water)
            rows.append(dict(rule=role,fixture=label,local=[x,height,z],ground=ground,water=water,
                             support=reference,gap=error,status='pass' if passed else 'fail'))
    station_rows=[r for r in rows if 'fixture' in r]
    stations=np.array([[r['local'][0],r['local'][2]] for r in station_rows]).reshape(-1,2)
    errors=np.array([0 if r['status']=='pass' else r['gap'] if r['gap'] is not None else 1
                     for r in station_rows])
    return rows, np.vstack([pts[:,::2],stations]), np.r_[gap,errors], count-len(labels)


def heatmap(path, coords, gap, name, angle):
    c, s = np.cos(angle), np.sin(angle)
    coords = coords @ np.array([[c,-s],[s,c]])
    pixels = (coords-coords.min(axis=0))*680/max(1,np.ptp(coords,axis=0).max())+20
    image = Image.new('RGB',(720,748),'#fafafa')
    draw = ImageDraw.Draw(image)
    for i in np.argsort(np.maximum(gap-FLOAT,-gap-SINK)):
        x,z = pixels[i]
        color = '#c12c20' if gap[i]>FLOAT else '#2162aa' if gap[i]<-SINK else '#808a83'
        draw.ellipse((x-2,z-2,x+2,z+2), fill=color)
    draw.text((16,720), f'{name}   N up   red > +0.15 m   blue < -0.30 m', fill='#232323')
    image.save(path)


def run(directory):
    directory.mkdir(parents=True, exist_ok=True)
    world = Surface()
    report = []
    for name, entry in world.entries.items():
        rows, coords, gap, aboveBand = measurements(ROOT/'public'/entry['file'], LandmarkSurface(world,name))
        heatmap(directory/(name+'.png'), coords, gap, name, np.radians(entry['rotation']))
        report.append(dict(id=name, aboveBearingBand=aboveBand, components=rows, failures=sum(r['status']=='fail' for r in rows)))
    result = dict(failures=sum(r['failures'] for r in report), landmarks=report)
    (directory/'grounding.json').write_text(json.dumps(result, separators=(',',':'))+'\n')
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=ROOT/'captures/grounding')
    result = run(parser.parse_args().output)
    print(json.dumps({'failures':result['failures'], 'landmarks':len(result['landmarks'])}))
    raise SystemExit(bool(result['failures']))

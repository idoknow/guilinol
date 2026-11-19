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
    floor = np.full(count, np.inf)
    np.minimum.at(floor, assembly, low)
    bearing = low <= floor[assembly]+BEARING_BAND
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
    return rows, pts[:, ::2], gap, count-len(rows)


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

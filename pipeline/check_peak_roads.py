"""Report projected mountain/highway overlap, including 2 m beyond sidewalks."""
import gzip
import json
import struct
from pathlib import Path
from functools import lru_cache

import numpy as np
import shapely
from shapely.geometry import LineString, Point, Polygon, box

from common import OUT, load_osm
from features import area, points
from landmark_solids import load_landmark_meshes
from landmarks.world_surface import Surface
from road_grading import eval_bspline_grid
from peak_road_geometry import road_buffers, TrailAreas


def footprint(peak, data):
    if 'model' in peak:
        lm = dict(id=peak['name'], file=peak['model'], position=peak['center'])
        mesh = load_landmark_meshes(Path(__file__).resolve().parents[1], {'landmarks':[lm]})[lm['id']]
        triangles = np.concatenate((mesh['vis_tris'], mesh['coll_tris']))
        return shapely.union_all(shapely.polygons(triangles[:,:,[0,2]]))
    parts = []
    for level, lod in enumerate(peak['lods']):
        verts = np.frombuffer(data,'<i2',lod['vertices']*3,lod['offset']).reshape(-1,3)
        coords = verts[:,[0,2]]/100 + np.array(peak['center'])[::2]
        ring = Polygon(coords[:32 if level else 128])
        indices = np.frombuffer(data,'<u2',lod['indices'],lod['indexOffset']).reshape(-1,3)
        triangles = shapely.polygons(coords[indices])
        shapely.prepare(ring)
        parts.extend(triangles[~shapely.covers(ring,triangles)])
        parts.append(ring)
    return shapely.union_all(parts)


def trail_samples(surface, line):
    """Compare textured trail triangles with the 4 m walk collider and PK02."""
    @lru_cache(maxsize=8)
    def grid(ox,oz):
        blob = gzip.decompress((surface.directory/surface.files[ox,oz]).read_bytes())
        terrain,water = np.frombuffer(blob,'<i2',8450,24).reshape(2,65,65)
        h = np.where(water==-32768,terrain,water)/10
        ground,_,step = surface.tile((ox,oz))
        if step==4:
            return np.maximum(h,ground)
        visible = h.copy()
        visible[::2,::2] = ground
        visible[1::2,::2] = (ground[1:]+ground[:-1])/2
        visible[::2,1::2] = (ground[:,1:]+ground[:,:-1])/2
        visible[1::2,1::2] = (ground[:-1,1:]+ground[1:,:-1])/2
        return np.maximum(h,visible)

    @lru_cache(maxsize=8)
    def paving(ox,oz):
        blob = gzip.decompress((surface.directory/surface.files[ox,oz]).read_bytes())
        vertices,indices,length = struct.unpack_from('<3I',blob,4)
        start = 24+16900+vertices*9+indices*4
        streets = json.loads(blob[start:start+length])[1]
        offsets = {0:.045, 1:.195, 4:.195, 5:.060, 6:.195}
        paths = [(Polygon(ring,holes),offsets[kind]) for kind,ring,*holes in streets[0] if kind in offsets]
        control = None
        if len(streets)>5 and streets[5]:
            base,deltas = streets[5]
            control = (base+np.array(deltas).reshape(35,35))/1000
        return paths,control

    errors = []
    for station in np.r_[np.arange(0,line.length,2),line.length]:
        x,z = line.interpolate(station).coords[0]
        height,_ = surface.sample(x,z,include_peaks=False)
        ox,oz = int(x//256)*256,int(z//256)*256
        u,v = (x-ox)/4,(z-oz)/4
        i,j = int(u),int(v)
        u,v = u-i,v-j
        (a,b),(c,d) = grid(ox,oz)[j:j+2,i:i+2]
        collider = a+(b-a)*u+(c-a)*v if u+v<=1 else d+(c-d)*(1-u)+(b-d)*(1-v)
        # Include any separate spline-graded street surface covering this
        # station. A raised plaza at a stair junction can block the player
        # even where the terrain and the peak collider agree exactly.
        paths,control = paving(ox,oz)
        local = Point((x-ox)*100,(z-oz)*100)
        for polygon,offset in paths:
            if polygon.covers(local):
                base = height if control is None else max(height,eval_bspline_grid(
                    control,ox,oz,np.array([x]),np.array([z]))[0])
                collider = max(collider,base+offset)
        errors.append(surface.peaks.height(x,z,collider)-height)
    return len(errors),min(errors),max(errors)


def verify(output=Path(OUT)):
    manifest = json.loads((output/'manifest.json').read_text())
    x,z,w,h = manifest['extent']
    ways, tree = road_buffers(box(x,z,x+w,z+h))
    peaks = manifest['peaks']
    data = gzip.decompress((output/peaks['file']).read_bytes())
    print('peak\tunion_m2\tOSM way (individual m2)')
    elements = load_osm()
    areas = TrailAreas(elements)
    catalog = json.loads(Path(__file__).with_name('peaks.json').read_text())
    nodes = {peak['name']: peak.get('osm') for peak in catalog}
    river = area(next(e for e in elements if e['type']=='relation' and e['id']==2339020))
    trails = []
    fubo_trails = []
    surface = Surface(output)
    fubo_area = river_area = None
    for peak in peaks['entries']:
        shape = footprint(peak, data)
        hits = sorted(tree.query(shape, predicate='intersects'))
        summit = areas.summits.get(nodes.get(peak['name']), Point(peak['center'][::2]))
        regions = areas.regions(summit)
        overlaps = []
        # Include qualifying trails even when none of their length is on the mesh.
        candidates = set(hits)
        for region in regions:
            candidates.update(tree.query(region))
        for i in sorted(candidates):
            way = ways[i]
            if areas.trail(way, regions):
                line = LineString(points(way))
                trails.append((peak['name'], way['id'], line.length, line.intersection(shape).length))
                if peak['name']=='伏波山':
                    fubo_trails.append((way['id'],*trail_samples(surface,line)))
                overlap = shape.intersection(river).intersection(tree.geometries[i]) if peak['name']=='伏波山' else Polygon()
            elif i in hits:
                overlap = shape.intersection(tree.geometries[i])
            else:
                continue
            if overlap.area:
                overlaps.append((way, overlap))
        total = shapely.union_all([p for _, p in overlaps]).area
        details = ', '.join(f"{e['id']} {e['tags'].get('name',e['tags']['highway'])} ({p.area:.2f})"
                            for e,p in overlaps if p.area)
        print(f"{peak['name']}\t{total:.2f}\t{details}")
        if peak['name'] == '伏波山':
            fubo_area = total
            river_area = shape.intersection(river).area
    if river_area is not None:
        print(f'伏波山 ∩ 漓江 (m²): {river_area:.2f}')
    print('park trail\tway\tlength_m\twithin_peak_m')
    for name, way, length, inside in trails:
        print(f'{name}\t{way}\t{length:.2f}\t{inside:.2f}')
    print('Fubo trail\tsamples (2 m)\tmin support gap (m)\tmax support gap (m)')
    for way,count,low,high in fubo_trails:
        print(f'{way}\t{count}\t{low:.3f}\t{high:.3f}')
    return (fubo_area is None or fubo_area == 0) and all(
        low>=-.3 and high<=.3 for _,_,low,high in fubo_trails)


if __name__ == '__main__':
    raise SystemExit(0 if verify() else 1)

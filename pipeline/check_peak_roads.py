"""Report projected mountain/highway overlap, including 2 m beyond sidewalks."""
import gzip
import json
import struct
from pathlib import Path
from functools import lru_cache

import numpy as np
import shapely
from shapely.affinity import affine_transform
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
        ring = Polygon(coords[:peak.get("outlineVertices",32 if level else 128)])
        indices = np.frombuffer(data,'<u2',lod['indices'],lod['indexOffset']).reshape(-1,3)
        triangles = shapely.polygons(coords[indices])
        shapely.prepare(ring)
        parts.extend(triangles[~shapely.covers(ring,triangles)])
        parts.append(ring)
    return shapely.union_all(parts)


def upper_contours(peak,data):
    lod = peak['lods'][0]
    xyz = np.frombuffer(data,'<i2',lod['vertices']*3,lod['offset']).reshape(-1,3)/100+peak['center']
    faces = np.frombuffer(data,'<u2',lod['indices'],lod['indexOffset']).reshape(-1,3)
    result = []
    for level in (165,180,190,200):
        pieces = []
        for tri in xyz[faces]:
            if tri[:,1].max()<=level:
                continue
            outline = []
            for a,b in zip(tri,np.roll(tri,-1,axis=0)):
                if a[1]>=level:
                    outline.append(a[::2])
                if (a[1]>level>b[1]) or (a[1]<level<b[1]):
                    outline.append((a+(b-a)*(level-a[1])/(b[1]-a[1]))[::2])
            if len(outline)>=3:
                pieces.append(Polygon(outline))
        section = shapely.union_all(pieces,grid_size=.001)
        result.append((level,section.area,sum(p.area>1 for p in shapely.get_parts(section))))
    return result


def support_sampler(surface):
    """Compare textured trail triangles with the 4 m walk collider and PK02."""
    entry = surface.entries['fubo']
    packed = load_landmark_meshes(Path(__file__).resolve().parents[1],{'landmarks':[entry]})['fubo']
    triangles = packed['vis_tris']
    normals = np.cross(triangles[:,1]-triangles[:,0],triangles[:,2]-triangles[:,0])
    upward = normals[:,1] > .001
    caps,normals = triangles[upward],normals[upward]
    stone = shapely.STRtree(shapely.polygons(caps[:,:,[0,2]]))
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

    def sample(x,z):
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
        paved = height
        for polygon,offset in paths:
            if polygon.covers(local):
                base = height if control is None else max(height,eval_bspline_grid(
                    control,ox,oz,np.array([x]),np.array([z]))[0])
                paved = max(paved,base+offset)
        ids = stone.query(Point(x,z),predicate='intersects')
        if len(ids):
            a,n = caps[ids,0],normals[ids]
            levels = a[:,1]-((x-a[:,0])*n[:,0]+(z-a[:,2])*n[:,2])/n[:,1]
            paved = max(paved,float(levels.max()))
        rock = surface.peaks.height(x,z,height-100)
        return height,paved,max(rock,collider,paved),rock
    def paving_coverage(polygon):
        # Include the actual emitted GL04 paving all the way to the OSM
        # outline. Allow the half-centimetre quantization on each axis.
        xmin,zmin,xmax,zmax = polygon.bounds
        patches = []
        for ox in range(int(xmin//256)*256,int(xmax//256)*256+1,256):
            for oz in range(int(zmin//256)*256,int(zmax//256)*256+1,256):
                paths,_ = paving(ox,oz)
                patches.extend(affine_transform(p,[.01,0,0,.01,ox,oz]) for p,_ in paths)
        tiles = shapely.union_all(patches)
        return polygon.intersection(tiles).area,polygon.difference(tiles.buffer(.008)).area
    return sample,paving_coverage


def trail_samples(sample,line):
    points = [line.interpolate(d) for d in np.r_[np.arange(0,line.length,2),line.length]]
    measures = [sample(pt.x,pt.y) for pt in points]
    errors = [support-ground for ground,_,support,_ in measures]
    return len(errors),min(errors),max(errors)


def platform_samples(sample,polygon):
    xmin,zmin,xmax,zmax = polygon.bounds
    grid = [Point(x,z) for x in np.arange(xmin,xmax,2) for z in np.arange(zmin,zmax,2)
            if polygon.covers(Point(x,z))]
    grid.extend(Point(x,z) for x,z in polygon.exterior.coords[:-1])
    gaps,slopes,penetration = [],[],[]
    for pt in grid:
        x,z = pt.coords[0]
        ground,paved,_,rock = sample(x,z)
        gaps.append(paved-ground)
        penetration.append(max(0,rock-paved))
        # Evaluate the terrain triangle just inside the polygon at boundary
        # samples so a step down outside the plaza does not count as its tilt.
        a,b = pt.x,pt.y
        dx = .05 if polygon.covers(Point(a+.05,b)) else -.05
        dz = .05 if polygon.covers(Point(a,b+.05)) else -.05
        slope = np.hypot((sample(a+dx,b)[0]-ground)/dx,(sample(a,b+dz)[0]-ground)/dz)
        slopes.append(np.degrees(np.arctan(slope)))
    return len(grid),min(gaps),max(gaps),max(slopes),max(penetration)


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
    sample,paving_coverage = support_sampler(surface)
    platforms_report = []
    fubo_area = river_area = None
    fubo_valid = False
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
        local = [ways[i] for i in candidates]
        uphill = [w for w in local if areas.trail(w,regions) and (w['tags']['highway']=='steps'
                  or LineString(points(w)).intersection(shape).length>0)]
        platforms = areas.platforms(summit,local,uphill)
        for way,polygon in platforms.items():
            metrics = (*platform_samples(sample,polygon),*paving_coverage(polygon)) if peak['name']=='伏波山' else None
            platforms_report.append((peak['name'],way,polygon.area,metrics))
        for i in sorted(candidates):
            way = ways[i]
            if way['id'] in platforms:
                overlap = shape.intersection(river).intersection(tree.geometries[i]) if peak['name']=='伏波山' else Polygon()
            elif areas.trail(way, regions):
                line = LineString(points(way))
                trails.append((peak['name'], way['id'], line.length, line.intersection(shape).length))
                if peak['name']=='伏波山':
                    fubo_trails.append((way['id'],*trail_samples(sample,line)))
                overlap = shape.intersection(river).intersection(tree.geometries[i]) if peak['name']=='伏波山' else Polygon()
            elif i in hits:
                overlap = shape.intersection(tree.geometries[i])
            else:
                continue
            if overlap.area:
                overlaps.append((way, overlap))
        total = shapely.union_all([p for _, p in overlaps]).area
        details = ', '.join(f"{e['id']} {e['tags'].get('name',e['tags']['highway'])} ({p.area:.2f})"
                            for e,p in overlaps if p.area) or "-"
        print(f"{peak['name']}\t{total:.2f}\t{details}")
        if peak['name'] == '伏波山':
            fubo_area = total
            river_area = shape.intersection(river).area
            hull = np.array(shape.convex_hull.exterior.coords)[:-1]
            edges = np.roll(hull,-1,axis=0)-hull
            normals = np.column_stack((-edges[:,1],edges[:,0]))/np.linalg.norm(edges,axis=1)[:,None]
            width = np.ptp(hull@normals.T,axis=0).min()
            center = Point(peak['center'][::2])
            center_offset = center.distance(Point(-86,-685))
            osm_offset = center.distance(summit)
            span = max(np.linalg.norm(hull-v,axis=1).max() for v in hull)
            width_relief = span/(peak['center'][1]-peak['baseHeight'])
            stair = next(LineString(points(w)) for w in uphill if w['tags']['highway']=='steps')
            landing = shapely.union_all(list(platforms.values()))
            if Point(stair.coords[0]).distance(landing)<Point(stair.coords[-1]).distance(landing):
                stair = stair.reverse()
            rise = sample(*stair.coords[-1])[1]-sample(*stair.coords[0])[1]
            footways = [LineString(points(w)) for w in local if areas.trail(w,regions) and w['tags']['highway']=='footway']
            clearance = min(shape.distance(line) for line in footways)
            solidity = shape.area/shape.convex_hull.area
            inside = shape.intersection(stair).length
            contours = upper_contours(peak,data)
            summary = (shape.area,solidity,width,center_offset,osm_offset,clearance,inside,rise,span,width_relief)
            fubo_valid = (all(n==1 for _,_,n in contours) and len(platforms)>0 and shape.geom_type=='Polygon' and shape.area>=5000 and solidity>=.85
                          and width>=45 and width_relief>=1.6 and max(center_offset,osm_offset)<=40 and clearance>=1 and inside>=stair.length/2
                          and rise>0 and shape.bounds[2]<=-50.9142 and river_area>0)
    if river_area is not None:
        print(f'伏波山 ∩ 漓江 (m²): {river_area:.2f}')
    print('park trail\tway\tlength_m\twithin_peak_m')
    for name, way, length, inside in trails:
        print(f'{name}\t{way}\t{length:.2f}\t{inside:.2f}')
    print('Fubo trail\tsamples (2 m)\tmin support gap (m)\tmax support gap (m)')
    for way,count,low,high in fubo_trails:
        print(f'{way}\t{count}\t{low:.3f}\t{high:.3f}')
    print('山上平台\tway\tarea_m2\t2m samples\tmin gap_m\tmax gap_m\tmax slope_deg\trock penetration_m\tpaved_m2\tuncovered_m2 (quantized)')
    for name,way,area_m2,metrics in platforms_report:
        values = '-' if metrics is None else '\t'.join([str(metrics[0]),*[f'{v:.3f}' for v in metrics[1:]]])
        print(f'{name}\t{way}\t{area_m2:.2f}\t{values}')
    if fubo_area is not None:
        print('伏波山形态\tarea_m2\tsolidity\tmin_width_m\tcenter_offset_m\tOSM_node_offset_m\tfootway_gap_m\tstairs_inside_m\tstairs_rise_m\tmax_span_m\tspan/relief')
        print('伏波山\t'+'\t'.join(f'{v:.3f}' for v in summary))
        print('伏波山等高截面\televation_m\tarea_m2\tcomponents_over_1m2')
        for level,area_m2,count in contours:
            print(f'伏波山\t{level}\t{area_m2:.2f}\t{count}')
    return (fubo_area is None or (fubo_area == 0 and fubo_valid)) and all(
        m is None or (m[1]>=-.3 and m[2]<=.3 and m[3]<=8 and m[4]<=.001 and m[6]<1e-6) for _,_,_,m in platforms_report) and all(
        low>=-.3 and high<=.3 for _,_,low,high in fubo_trails)


if __name__ == '__main__':
    raise SystemExit(0 if verify() else 1)

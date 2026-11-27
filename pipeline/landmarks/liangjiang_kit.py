"""Airport architecture in metres, relative to each mapped footprint centroid."""
from collections import defaultdict
from math import cos, pi, sin
from pathlib import Path
import sys

import numpy as np
import trimesh
from shapely.affinity import translate
from shapely.geometry import box, LineString

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from airport import airfield
from features import polygons
from shop_lettering import letters


COLORS = {'airport_roof_metal':'#e0e3e2', 'airport_glass_lit':'#6994a4',
          'airport_structure':'#b7c0c2', 'airport_concrete':'#ced0cb',
          'airport_red':'#b43537', 'airport_door':'#819197'}


class Batch:
    def __init__(self, level):
        self.parts = defaultdict(list)
        self.level = level
        self.detail = level == 0

    def mesh(self, vertices, faces, material):
        self.parts[material].append(trimesh.Trimesh(vertices, faces, process=False))

    def slab(self, region, bottom, top, material):
        for polygon in polygons(region):
            if polygon.area < .001:
                continue
            vertices, faces = trimesh.creation.triangulate_polygon(polygon, engine='earcut')
            base = np.asarray([(east, bottom(east,south) if callable(bottom) else bottom, south)
                               for east,south in vertices])
            roof = base.copy()
            roof[:,1] = [top(east,south) if callable(top) else top for east,south in vertices]
            count = len(vertices)
            self.mesh(np.vstack((base, roof)), np.vstack((faces, faces[:,::-1]+count)), material)
            for ring in [polygon.exterior,*polygon.interiors]:
                coords = np.asarray(ring.coords)
                low = [(east,bottom(east,south) if callable(bottom) else bottom,south) for east,south in coords]
                high = [(east,top(east,south) if callable(top) else top,south) for east,south in coords]
                ends = len(low)
                sides = [(idx,idx+ends,idx+1) for idx in range(ends-1)]
                sides += [(idx+1,idx+ends,idx+1+ends) for idx in range(ends-1)]
                self.mesh(low+high,sides,material)

    def beam(self, start, end, radius, material, sides=6):
        self.parts[material].append(trimesh.creation.cylinder(radius=radius, sections=sides,
                                                              segment=[start,end]))

    def finish(self, scene, group):
        scene.graph.update(frame_to=group)
        for material, parts in self.parts.items():
            mesh = trimesh.util.concatenate(parts)
            color = bytes.fromhex(COLORS[material][1:])
            mesh.visual = trimesh.visual.TextureVisuals(material=trimesh.visual.material.PBRMaterial(
                name=material,baseColorFactor=[*color,255],roughnessFactor=.65,metallicFactor=.12,
                doubleSided=True,emissiveFactor=[.30,.24,.12] if material.endswith('_lit') else None))
            scene.add_geometry(mesh,node_name=f'{group}_{material}',parent_node_name=group)


def terminal(batch, footprint, solid, t2):
    sill = 11 if t2 else 8
    batch.slab(solid,-.3,7,'airport_concrete')
    batch.slab(footprint,7,sill,'airport_glass_lit')
    west,north,east,south = footprint.bounds
    span = south-north
    bands = (0,.16,.35,.65,.84,1) if t2 else (0,1)
    for idx,(start,end) in enumerate(zip(bands,bands[1:])):
        low,high = north+span*start,north+span*end
        amplitude = [3,8,14,8,3][idx] if t2 else 7
        def arch(easting,southing):
            if not t2:
                phase = (easting-west)/(east-west)
            else:
                phase = (southing-low)/(high-low)
            return sill+2+amplitude*sin(pi*phase)
        pieces = (12,7,4)[batch.level]
        for section in range(pieces):
            if t2:
                bounds = box(west,low+(high-low)*section/pieces,east,low+(high-low)*(section+1)/pieces)
            else:
                bounds = box(west+(east-west)*section/pieces,low,west+(east-west)*(section+1)/pieces,high)
            clipped = footprint.intersection(bounds)
            if t2:
                for depth,(back,front,rise) in enumerate([(-1e3,32,0),(32,76,2),(76,1e3,4)]):
                    shell = clipped.intersection(box(back,north,front,south))
                    batch.slab(shell,sill,lambda x,z:arch(x,z)+rise,'airport_glass_lit')
                    lip = clipped.intersection(box(back-(2 if depth else 0),north,front,south))
                    batch.slab(lip,lambda x,z:arch(x,z)+rise,lambda x,z:arch(x,z)+rise+.65,'airport_roof_metal')
            else:
                batch.slab(clipped,sill,arch,'airport_glass_lit')
                batch.slab(clipped,arch,lambda x,z:arch(x,z)+.65,'airport_roof_metal')
                if batch.detail:
                    rib = footprint.intersection(box(west+(east-west)*section/pieces,low,west+(east-west)*section/pieces+.32,high))
                    batch.slab(rib,lambda x,z:arch(x,z)+.65,lambda x,z:arch(x,z)+.88,'airport_structure')
    if batch.level < 2:
        rim = footprint.difference(footprint.buffer(-.45))
        batch.slab(rim,sill-.6,sill,'airport_structure' if t2 else 'airport_red')
        front = footprint.intersection(box(east-14,north,east,south))
        batch.slab(front,7.05,7.55,'airport_concrete')
        batch.slab(front,sill-.15,sill+.25,'airport_roof_metal')
        inset = footprint.buffer(-.22)
        for polygon in polygons(inset):
            ring = polygon.exterior
            step = 3 if batch.detail else 9
            for station in np.arange(0,ring.length,step):
                point = ring.interpolate(station)
                batch.beam((point.x,7,point.y),(point.x,sill+1.9,point.y),.18,'airport_structure',4)
        front_x=footprint.intersection(LineString([(west-1,0),(east+1,0)])).bounds[2]
        class FrontSign:
            detail = batch.detail
            def mesh(self, vertices, faces, material):
                batch.mesh([(front_x+depth,height,-along) for along,height,depth in vertices],faces,material)
        letters(FrontSign(),'桂林两江国际机场' if t2 else '桂林',(0,sill+2,0),34 if t2 else 12,3.4,'airport_red')


def tower(batch, footprint):
    sections = (32,20,12)[batch.level]
    def tier(radius0,radius1,low,high,mat):
        profile = [(0,low),(radius0,low),(radius1,high),(0,high)]
        mesh = trimesh.creation.revolve(profile,sections=sections)
        mesh.apply_transform(trimesh.transformations.rotation_matrix(-pi/2,[1,0,0]))
        batch.parts[mat].append(mesh)
    batch.slab(footprint,-.25,23,'airport_concrete')
    tier(5.7,7.2,23,26,'airport_structure')
    tier(7.1,8.2,26,30,'airport_glass_lit')
    tier(8.6,8.6,30,30.7,'airport_roof_metal')
    sphere = trimesh.creation.icosphere(subdivisions=2 if batch.detail else 1,radius=2.6)
    sphere.apply_translation((0,33.3,0)); batch.parts['airport_roof_metal'].append(sphere)
    if batch.level < 2:
        batch.beam((3.8,30.7,0),(3.8,39,0),.13,'airport_structure')
        for angle in np.arange(12)*pi/6:
            batch.beam((7.2*cos(angle),26,7.2*sin(angle)),(8.25*cos(angle),30,8.25*sin(angle)),.12,'airport_structure')


def warehouse(batch, footprint, hangar):
    west,north,east,south = footprint.bounds
    height = 13 if hangar else 6
    batch.slab(footprint,-.3,height,'airport_concrete')
    middle = (west+east)/2
    def roof(easting,southing):
        return height+.5+(3 if hangar else 1.4)*(1-abs(easting-middle)/((east-west)/2))
    for low,high in [(west,middle),(middle,east)]:
        batch.slab(footprint.intersection(box(low,north,high,south)),height,roof,'airport_roof_metal')
    if batch.level < 2:
        coords = list(footprint.exterior.coords)
        _,first,last = max((np.linalg.norm(np.subtract(a,b)),a,b) for a,b in zip(coords,coords[1:]))
        delta = np.subtract(last,first); length = np.linalg.norm(delta); tangent = delta/length
        normal = np.array([-tangent[1],tangent[0]])
        if np.dot(normal,(np.array(first)+last)/2) < 0: normal *= -1
        count = 8 if hangar else max(1,int(length//9))
        for idx in range(count):
            start = first+delta*(.08+.84*idx/count)+normal*.12
            end = first+delta*(.08+.84*(idx+1)/count)-tangent*(.2 if hangar else 2)+normal*.12
            top = height-1 if hangar else 4.7
            batch.mesh([(start[0],.8,start[1]),(end[0],.8,end[1]),(end[0],top,end[1]),(start[0],top,start[1])],
                       [(0,1,2),(0,2,3)],'airport_door')
            if not hangar:
                for level,depth in [(1,2.5),(top+.2,3.5)]:
                    outer = normal*depth
                    batch.mesh([(point[0],level,point[1]) for point in (start,end,end+outer,start+outer)],
                               [(0,1,2),(0,2,3)],'airport_structure')
            elif batch.detail:
                lower,upper=height-.9,height+.55
                batch.beam((start[0],lower,start[1]),(end[0],upper,end[1]),.13,'airport_structure')
                batch.beam((start[0],lower,start[1]),(end[0],lower,end[1]),.13,'airport_structure')


def generate(name, way):
    _,foot,solid = next(row for row in airfield()[1] if row[0]['id']==way)
    center = foot.centroid
    foot,solid = (translate(poly,-center.x,-center.y) for poly in (foot,solid))
    scene = trimesh.Scene()
    for level in range(3):
        batch = Batch(level)
        if name in ('t1','t2'): terminal(batch,foot,solid,name=='t2')
        elif name=='tower': tower(batch,foot)
        else: warehouse(batch,foot,name=='hangar')
        batch.finish(scene,f'lod{level}')
    collision = Batch(2)
    collision.slab(solid,-.3,7 if name in ('t1','t2') else {'tower':23,'hangar':13,'cargo':6}[name], 'airport_concrete')
    if name in ('t1','t2'): collision.slab(foot,7,9,'airport_concrete')
    scene.add_geometry(trimesh.util.concatenate(collision.parts['airport_concrete']),node_name='collision_surface')
    scene.export(Path(sys.argv[1])/f'liangjiang_{name}.glb')

"""Airport architecture in metres, relative to each mapped footprint centroid."""
from collections import defaultdict
from math import cos, pi, sin
from pathlib import Path
import sys

import numpy as np
import trimesh
from shapely.affinity import translate
from shapely.geometry import box, LineString, Polygon

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from airport import airfield
from features import polygons
from airport_lettering import outline
from liangjiang_grade import Grade


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

    def finish(self, scene, group, grade):
        scene.graph.update(frame_to=group)
        for material, parts in self.parts.items():
            mesh = grade.fit(trimesh.util.concatenate(parts))
            color = bytes.fromhex(COLORS[material][1:])
            mesh.visual = trimesh.visual.TextureVisuals(material=trimesh.visual.material.PBRMaterial(
                name=material,baseColorFactor=[*color,255],roughnessFactor=.65,metallicFactor=.12,
                doubleSided=True,emissiveFactor=[.30,.24,.12] if material.endswith('_lit') else None))
            scene.add_geometry(mesh,node_name=f'{group}_{material}',parent_node_name=group)


def front_sign(batch,text,easting,base,width,height):
    if batch.level==2: return
    shape=outline(text)
    left,bottom,right,top=shape.bounds
    batch.slab(box(easting-.3,-width/2-.75,easting,width/2+.75),base-.45,base+height+.45,'airport_structure')
    for polygon in polygons(shape):
        vertices,faces=trimesh.creation.triangulate_polygon(polygon,engine='earcut')
        batch.mesh([(easting+.05,base+height*(up-bottom)/(top-bottom),width*(.5-(along-left)/(right-left)))
                    for along,up in vertices],faces,'airport_red')


def terminal_one(batch, footprint, solid):
    west,north,east,south=footprint.bounds
    batch.slab(solid,-.2,6.8,'airport_concrete')
    batch.slab(footprint,6.8,9,'airport_glass_lit')
    def arch(easting,southing):
        phase=(2*easting-west-east)/(east-west)
        return 9+13*np.sqrt(max(0,1-phase**2))
    cuts=np.linspace(west,east,(33,17,9)[batch.level])
    for low,high in zip(cuts,cuts[1:]):
        strip=footprint.intersection(box(low,north,high,south))
        batch.slab(strip,9,arch,'airport_glass_lit')
        batch.slab(strip,arch,lambda x,z:arch(x,z)+.4,'airport_roof_metal')
    for station in np.linspace(north+2,south-2,(18,9,3)[batch.level]):
        for low,high in zip(cuts,cuts[1:]):
            rib=footprint.intersection(box(low,station,high,station+.24))
            batch.slab(rib,lambda x,z:arch(x,z)+.4,lambda x,z:arch(x,z)+.62,'airport_structure')
    span=min(38,(south-north)*.25)
    front=[(east-7.7+6*cos(angle),span*sin(angle)) for angle in np.linspace(-pi/2,pi/2,33)]
    from shapely.geometry import Polygon
    lobby=Polygon([(east-9,-span),*front,(east-9,span)])
    batch.slab(lobby,1.4,9.8,'airport_glass_lit')
    batch.slab(lobby,9.8,10.4,'airport_red')
    for offset in range(6):
        step=translate(lobby,2.5-offset*.42,0)
        batch.slab(step,offset*.24,(offset+1)*.24,'airport_concrete')
    front_sign(batch,'桂林',east+.2,10.8,13,5.3)


def roof_panel(batch, panel, arch, rise, cuts, sill):
    if panel.is_empty or panel.area < .001:
        return
    west,north,east,south=panel.bounds
    grid=np.linspace(west,east,max(2,1+int(np.ceil((east-west)/(12,21,36)[batch.level]))))
    vertices,faces,indices=[],[],{}
    for near,far in zip(cuts,cuts[1:]):
        for left,right in zip(grid,grid[1:]):
            for cell in polygons(panel.intersection(box(left,near,right,far))):
                if cell.area<.001: continue
                coords,triangles=trimesh.creation.triangulate_polygon(cell,engine='earcut')
                lookup=[]
                for east_coord,south_coord in coords:
                    key=(round(east_coord,6),round(south_coord,6))
                    if key not in indices:
                        indices[key]=len(vertices)
                        vertices.append((east_coord,arch(east_coord,south_coord)+rise+.65,south_coord))
                    lookup.append(indices[key])
                faces.extend(np.asarray(lookup)[triangles[:,::-1]])
        for polygon in polygons(panel):
            for ring in [polygon.exterior,*polygon.interiors]:
                edge=ring.intersection(box(west-1,near,east+1,far))
                for line in getattr(edge,'geoms',[edge]):
                    if line.geom_type!='LineString': continue
                    for first,last in zip(line.coords,list(line.coords)[1:]):
                        heights=[arch(*point)+rise for point in (first,last)]
                        for lower,upper,mat in [([sill,sill],heights,'airport_glass_lit'),(heights,np.add(heights,.65),'airport_roof_metal')]:
                            batch.mesh([(point[0],y,point[1]) for point,y in zip([first,last,last,first],[lower[0],lower[1],upper[1],upper[0]])],[(0,1,2),(0,2,3)],mat)
    if faces: batch.mesh(vertices,faces,'airport_roof_metal')


def terminal_two(batch, footprint, solid):
    sill = 11
    batch.slab(solid,-.3,7,'airport_concrete')
    batch.slab(footprint,7,sill,'airport_glass_lit')
    west,north,east,south = footprint.bounds
    span = south-north
    bands = (0,.16,.35,.65,.84,1)
    for idx,(start,end) in enumerate(zip(bands,bands[1:])):
        low,high = north+span*start,north+span*end
        amplitude = [3,8,14,8,3][idx]
        def arch(easting,southing):
            phase = (southing-low)/(high-low)
            return sill+2+amplitude*sin(pi*phase)
        pieces = (12,7,4)[batch.level]
        samples=np.linspace(low,high,129)
        arc=np.r_[0,np.cumsum(np.hypot(np.diff(samples),np.diff([arch(0,z) for z in samples])))]
        cuts=np.interp(np.linspace(0,arc[-1],pieces+1),arc,samples)
        for back,front,rise in [(west,32,0),(32,76,2),(76,east,4)]:
            roof_panel(batch,footprint.intersection(box(back,low,front,high)),arch,rise,cuts,sill)
    if batch.level < 2:
        rim = footprint.difference(footprint.buffer(-.45))
        batch.slab(rim,sill-.6,sill,'airport_structure')
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
        def front_x(south_coord):
            return footprint.intersection(LineString([(west-1,south_coord),(east+1,south_coord)])).bounds[2]
        frontage=front_x(0)
        for lower,upper,depth,material in [(6.5,7,8,'airport_concrete'),(11,11.45,10,'airport_roof_metal')]:
            batch.slab(box(frontage-2,-24,frontage+depth,24),lower,upper,material)
        for station in [-21,-7,7,21]:
            batch.beam((frontage+7,-.04,station),(frontage+7,11.05,station),.32,'airport_structure')
        front_sign(batch,'桂林两江国际机场',frontage+.4,12.4,34,3.6)


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
    middle=(west+east)/2
    def roof(x,z):
        return height+.35+(4 if hangar else 1.4)*(cos(pi*(x-middle)/(east-west)) if hangar else 1-abs(x-middle)/((east-west)/2))
    cuts=np.linspace(west,east,(17,9,5)[batch.level] if hangar else 3)
    for low,high in zip(cuts,cuts[1:]):
        batch.slab(footprint.intersection(box(low,north,high,south)),height,roof,'airport_roof_metal')
    if batch.level==2: return
    coords=np.asarray(footprint.exterior.coords)
    # Present the doors to the apron-facing (western) side rather than a rear wall.
    sides=[]
    for first,last in zip(coords,coords[1:]):
        delta=last-first; length=np.linalg.norm(delta)
        if length<1: continue
        tangent=delta/length; normal=np.array([-tangent[1],tangent[0]])
        if np.dot(normal,(first+last)/2)<0: normal*=-1
        sides.append((-normal[0]*length,length,first,tangent,normal))
    _,length,origin,tangent,normal=max(sides,key=lambda side:side[0])
    def block(along,end,inner,outer,base,top,material):
        rect=Polygon([origin+tangent*u+normal*v for u,v in [(along,inner),(end,inner),(end,outer),(along,outer)]])
        batch.slab(rect,base,top,material)
    if hangar:
        for height_mark in [.22,12.2]:
            block(.04*length,.88*length,.05,.45,height_mark,height_mark+.22,'airport_structure')
        block(.89*length,.99*length,-1,4.5,-.06,4.6,'airport_concrete')
        block(.895*length,.985*length,4.49,4.53,1.7,3.2,'airport_glass_lit')
        block(.885*length,.995*length,-1,4.8,4.6,4.9,'airport_roof_metal')
    else:
        block(.04*length,.96*length,0,3,-.06,1.2,'airport_concrete')
        block(.03*length,.97*length,-.3,4.6,5.05,5.4,'airport_roof_metal')
    count=8 if hangar else max(1,int(length//8))
    for index in range(count):
        step=length*(.84 if hangar else .92)/count
        start=.04*length+index*step; end=start+step-(.18 if hangar else 1.3)
        base,top=(.45,12.2) if hangar else (1.2,4.9)
        block(start,end,.01,.10,base,top,'airport_door')
        if hangar:
            block(start+.15,end-.15,.10,.14,8.8,10,'airport_glass_lit')
        elif batch.detail:
            for slat in np.arange(1.55,4.9,.43):
                block(start,end,.1,.14,slat,slat+.06,'airport_structure')
        if not hangar and index%3==0 and index<9:
            center=(start+end)/2
            block(center-1.1,center+1.1,3.25,7.4,.72,3,'airport_roof_metal')
            block(center-1.04,center+1.04,7.4,9,.62,2.45,'airport_door')
            block(center-.93,center+.93,8.99,9.04,1.55,2.28,'airport_glass_lit')
            for axle in (4.3,8.05):
                wheel=origin+tangent*center+normal*axle
                endpoints=[(p[0],.43,p[1]) for p in (wheel-1.13*tangent,wheel+1.13*tangent)]
                batch.beam(*endpoints,.43,'airport_door',10)


def generate(name, way):
    _,foot,solid = next(row for row in airfield()[1] if row[0]['id']==way)
    center = foot.centroid
    grade=Grade(name,center)
    foot,solid = (translate(poly,-center.x,-center.y) for poly in (foot,solid))
    scene = trimesh.Scene()
    for level in range(3):
        batch = Batch(level)
        if name=='t1': terminal_one(batch,foot,solid)
        elif name=='t2': terminal_two(batch,foot,solid)
        elif name=='tower': tower(batch,foot)
        else: warehouse(batch,foot,name=='hangar')
        batch.finish(scene,f'lod{level}',grade)
    collision = Batch(2)
    collision.slab(solid,-.3,7 if name in ('t1','t2') else {'tower':23,'hangar':13,'cargo':6}[name], 'airport_concrete')
    if name in ('t1','t2'): collision.slab(foot,7,9,'airport_concrete')
    scene.add_geometry(grade.fit(trimesh.util.concatenate(collision.parts['airport_concrete'])),node_name='collision_surface')
    scene.export(Path(sys.argv[1])/f'liangjiang_{name}.glb',include_normals=True)

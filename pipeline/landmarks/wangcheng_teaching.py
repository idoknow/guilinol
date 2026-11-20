"""Teaching blocks 3/4/5: fit axes and spans to their individual footprints."""
import math
import sys
from pathlib import Path
import numpy as np
import trimesh
from shapely.affinity import translate
from shapely.geometry import Point, Polygon
from jingjiang import generate
from c_kit import landmark_surface

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from common import ll2xz,load_osm


def seated_roof(model, y, width, depth, rise, surface, wall=None):
    """A closed soffit and bearing timbers beneath the curved tile eaves."""
    x0, y0, z0, angle = model.pose
    def world_point(x,z):
        return x0+x*math.cos(angle)-z*math.sin(angle), z0+x*math.sin(angle)+z*math.cos(angle)
    # Seat the timbers inside the masonry outline, including on the narrower
    # wings of the U-shaped annexes. All four corners must have the same wall.
    seats = []
    for x in np.linspace(-width*.43,width*.43,max(2,round(width/6))):
        for z in (-depth*.34,depth*.34):
            if wall is not None and not all(
                    wall.covers(Point(world_point(x+dx,z+dz)))
                    for dx in (-.28,.28) for dz in (-.28,.28)):
                continue
            seats.append((x,z))
    if len(seats)<2:
        raise ValueError(f'Missing roof bearings at {model.pose}')
    if wall is not None:
        # The eastern wall backs onto bedrock which rises through part of its
        # GL04 outline. Seat each timber on the exposed surface there.
        wall_top = y
        def base(x,z):
            return max(wall_top,surface.ground(*world_point(x,z))-y0)
        y=max(base(x+dx,z+dz) for x,z in seats for dx in (-.28,.28) for dz in (-.28,.28))
        import trimesh
        cube=trimesh.creation.box([.56,1,.56])
        for x,z in seats:
            vertices=cube.vertices.copy()+[x,0,z]
            for v in vertices:
                v[1]=y+.67 if v[1]>0 else base(v[0],v[2])-.04
            model.mesh(vertices,cube.faces,'wood')
    else:
        for x,z in seats:
            model.box(x,y-.04,z,.56,.71,.56,'wood')
    model.box(0,y+.65,0,width,.055,depth,'wood')
    model.tiled_roof(0,y+.70,0,width,depth,rise,'earth',gable=False)
    for side in (-1,1):
        for u,v in zip(np.linspace(-1,1,13)[:-1],np.linspace(-1,1,13)[1:]):
            points = [(t*width/2,y+.70+(.09*rise+.12)*abs(t)**6,side*depth/2) for t in (u,v)]
            points += [(v*width/2,y+.69,side*depth/2),(u*width/2,y+.69,side*depth/2)]
            model.mesh(points,[[0,1,2],[0,2,3]],'wood')


def footing(model, z, width, depth, top, color, surface, collide=False):
    import trimesh
    cx, cy, cz, angle = model.pose
    box = trimesh.creation.box([width,1,depth])
    vertices = box.vertices.copy()
    for v in vertices:
        v[2] += z
        x, h, south = v
        v[1] = (top if h>0 else surface.ground(cx+x*math.cos(angle)-south*math.sin(angle),
                                              cz+x*math.sin(angle)+south*math.cos(angle))-cy-.04)
    model.mesh(vertices,box.faces,color,collide)


def teaching(model):
    anchor=np.asarray(ll2xz(25.2854676,110.2934274))
    surface=landmark_surface('wangcheng_teaching')
    for way in load_osm():
        if way['type']!='way' or way['id'] not in (674165595,674165596,674165597,679734456,679734455,679734418):continue
        outline=Polygon([ll2xz(vertex['lat'],vertex['lon']) for vertex in way['geometry']])
        rectangle=outline.minimum_rotated_rectangle
        edges=np.diff(np.asarray(rectangle.exterior.coords),axis=0)
        spans=np.linalg.norm(edges,axis=1)
        axis=edges[spans.argmax()]; width,depth=spans.max(),spans.min()
        center=np.array(rectangle.centroid.coords[0])-anchor
        angle=math.atan2(axis[1],axis[0])
        if way['id'] in (679734418,679734455,679734456):
            wall=translate(outline,-anchor[0],-anchor[1])
            floors=3 if way['id']==679734456 else 1
            roof=surface.ground(*wall.representative_point().coords[0])+3.2*floors
            prism=trimesh.creation.extrude_polygon(wall,1,engine='earcut')
            vertices=prism.vertices[:,[0,2,1]].copy()
            for vertex in vertices:
                vertex[1]=roof if vertex[1]>0 else min(roof-.04,surface.ground(*vertex[::2])-.04)
            model.pose=(0,0,0,0)
            model.mesh(vertices,prism.faces[:,::-1],'white',True)
            model.pose=(center[0],roof,center[1],angle)
            if way['id']==679734456:
                seated_roof(model,0,width+1,depth+1,3.3,surface,wall)
            else:
                # Twin transverse wings flank a narrower longitudinal range.
                seated_roof(model,0,width-15,13.4,2.9,surface,wall)
                for side in (-1,1):
                    wing=center+side*(width/2-4.45)*axis/width
                    model.pose=(wing[0],roof,wing[1],angle+math.pi/2)
                    seated_roof(model,0,depth+.8,9.6,2.9,surface,wall)
            continue
        grade=max(surface.ground(*(np.array(point)-anchor)) for point in rectangle.exterior.coords)
        model.pose=(center[0],grade,center[1],angle)
        footing(model,0,width,depth,9.65,'white',surface,True)
        seated_roof(model,9.65,width+1.6,depth+1.2,3.3,surface)
        for side in (-1,1):
            for floor in range(3):
                level=floor*3.2
                if floor:
                    model.box(0,level+.05,side*(depth/2+.1),width,.28,.55,'wood')
                else:
                    footing(model,side*(depth/2+.1),width,.55,.33,'wood',surface)
                for column in np.linspace(-width*.45,width*.45,14 if model.detail else 7):
                    model.box(column,level+.9,side*(depth/2+.02),2.45,1.65,.14,'glass')
                    if model.detail:model.box(column,level+.9,side*(depth/2+.11),.12,1.65,.12,'white')


if __name__=='__main__':generate('wangcheng_teaching',teaching)

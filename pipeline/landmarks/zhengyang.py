"""North entrance paving. The bell tower has its own surveyed anchor."""
import math
from pathlib import Path
import sys
import numpy as np
import shapely
from jingjiang import generate
from c_kit import landmark_surface


def boulevard(model):
    frame = landmark_surface('zhengyang')
    model.ground_offset = frame.ground
    model.pose=(0,0,0,.16)
    sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
    from seam_streets import Streets
    streets = Streets(frame.surface)
    cosine,sine = math.cos(.16),math.sin(.16)
    rotation = np.array([[cosine,sine],[-sine,cosine]])
    origin = np.array([frame.x,frame.z])
    tile = tuple(int(v//frame.surface.size)*frame.surface.size for v in origin)
    tree,kinds,_ = streets.tile(tile)
    mouth = shapely.transform(shapely.box(-9,-13,9,0),lambda coords:coords@rotation+origin)
    roads = shapely.union_all([tree.geometries[i] for i in tree.query(mouth) if kinds[i] in (0,2,5)])
    curb = shapely.transform(roads,lambda coords:(coords-origin)@rotation.T).buffer(.02)
    def panel(points,height,material,collide=False):
        for face in shapely.constrained_delaunay_triangles(shapely.Polygon(points).difference(curb)).geoms:
            coords = list(shapely.orient_polygons(face,exterior_cw=True).exterior.coords)[:3]
            model.mesh([(x,height,z) for x,z in coords],[[0,1,2]],material,collide)
    def entrance_grade(x,z):
        station = -sine*x+cosine*z
        ground = frame.ground(x,z)
        across = cosine*x+sine*z
        if station<0:
            line = shapely.LineString([(across,-30),(across,0)]).intersection(curb)
            end,direction = line.bounds[3],-1
        else: end,direction = 87.5,1
        weight = max(0,1-abs(station-end)/4.5)
        if not weight: return ground
        offset = end-station+direction*.04
        road,_ = streets.at(frame.x+x-sine*offset,frame.z+z+cosine*offset)
        # Fit the native grade while keeping the 14 cm slab within 30 cm of terrain.
        correction=np.clip(road-frame.y-.14-ground,-.29,.155)
        return ground + weight*correction
    for block in range(4):
        center=block*25
        model.ground_offset = entrance_grade
        for station in np.linspace(center-12.5,center+12.5,17)[:-1]:
            if station<0:
                panel([(-9,station),(9,station),(9,station+25/16),(-9,station+25/16)],.14,'pave',True)
                continue
            model.box(0,0,station+25/32,18,.14,25/16,'pave',True)


if __name__=='__main__':generate('zhengyang',boulevard)

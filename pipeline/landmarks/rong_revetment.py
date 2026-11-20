"""Walls and descending stairs at the mapped sidewalk / lower paving interfaces."""
import json
import math
import sys
from pathlib import Path

import numpy as np
from shapely import LineString, Point

from c_kit import landmark_surface, railing, ramp, stairs
from rong_surface import bank_strip

PIPELINE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PIPELINE))
from seam_streets import Streets


def revetment(builder):
    surface = landmark_surface('ronghu')
    streets = Streets(surface.surface)
    rules = json.loads((PIPELINE/'seam-surfaces.json').read_text())['exceptions']
    origin = np.array([surface.x, surface.z])
    rotation = np.array([[surface.cos, surface.sin], [-surface.sin, surface.cos]])
    mesh = builder.parts['atlas']
    for rule in rules:
        if rule['id'] != 'ronghu' or rule.get('kind') != 'retainingWall':
            continue
        path = LineString((np.array(rule['worldXZ']) - origin) @ rotation)
        def point(distance):
            return np.array(path.interpolate(distance).coords[0])

        def normal(distance):
            tangent = point(min(path.length, distance+.01))-point(max(0, distance-.01))
            return np.array([-tangent[1], tangent[0]]) / np.linalg.norm(tangent)

        def sidewalk(distance):
            position = point(distance)-normal(distance)*.03
            height, kinds = streets.at(*(position @ rotation.T + origin))
            if not kinds.intersection({1, 6}):
                raise ValueError(f'Missing upper sidewalk at {position}')
            return height-surface.y

        middle = path.length/2
        for start, end in ((0, middle-1.2), (middle+1.2, path.length)):
            if end-start < .1:
                continue
            stations = np.linspace(start, end, math.ceil((end-start)/1.6)+1)
            for first, last in zip(stations, stations[1:]):
                left, right = point(first), point(last)
                outline = [left, right, right+.38*normal(last), left+.38*normal(first)]
                grades = [sidewalk(first), sidewalk(last)]
                def top(x, z):
                    return np.interp(path.project(Point(x,z)), [first,last], grades)
                bank_strip(mesh, outline, lambda x,z: top(x,z)-.14, 'rubble')
                if builder.collide:
                    bank_strip(builder.hit, outline, top, 'granite')
                upper = [(x,top(x,z),z) for x,z in outline]
                mesh.face(upper,(0,1,0),'limestone')
                for index, corner in enumerate(upper):
                    other = upper[(index+1)%4]
                    dx, dz = other[0]-corner[0], other[2]-corner[2]
                    mesh.face([corner,other,(other[0],other[1]-.15,other[2]),(corner[0],corner[1]-.15,corner[2])],(dz,0,-dx),'limestone')
                railing(mesh, left+.19*normal(first), right+.19*normal(last), np.mean(grades), .88, 'granite', stone=True)
        upper = point(middle)
        high = sidewalk(middle)
        lower = upper + normal(middle)*max(1.5,(high-surface.ground(*upper)) * 2.1)
        low = surface.ground(*lower)+.05
        if high <= low:
            raise ValueError('Upper sidewalk no longer above lower landing')
        bottom, crest = (lower[0],low,lower[1]), (upper[0],high,upper[1])
        stairs(mesh, bottom, crest, 2.4, max(1,round((high-low)/.15)), 'granite')
        if builder.collide:
            ramp(builder.hit, bottom, crest, 2.4)

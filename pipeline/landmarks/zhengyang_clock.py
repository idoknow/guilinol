"""Zhengyang bell tower at the surveyed Esri centre. See .ops-docs/layout/zhengyang.md."""
import json
import math
import sys
from pathlib import Path

import numpy as np

from jingjiang import generate
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from common import ll2xz
from world_surface import LandmarkSurface, Surface


def clock(model):
    # A first build can have the terrain tiles but no instance of this new asset yet.
    terrain = Surface()
    if 'zhengyang_clock' not in terrain.entries:
        specs = json.loads((Path(__file__).resolve().parents[1] / 'landmarks.json').read_text())
        spec = next(s for s in specs if s['id'] == 'zhengyang_clock')
        lon,lat = spec['anchor']
        x,z = ll2xz(lat,lon)
        terrain.entries[spec['id']] = dict(position=[x,terrain.sample(x,z)[0],z],rotation=0)
    ground = LandmarkSurface(terrain,'zhengyang_clock').ground

    model.pose = (0, 0, 0, math.radians(9.6))
    # Sample the foundation under each pier, then keep the clockworks level.
    model.ground_offset = ground
    for east in (-1, 1):
        for south in (-1, 1):
            model.box(2.25*east, -.04, 2.25*south, 1.02, 2.57, 1.02, 'granite', True)
            model.box(2.25*east, 2.48, 2.25*south, 1.12, .14, 1.12, 'stone')
    model.ground_offset = None
    for east in (-1, 1):
        for south in (-1, 1):
            leg = np.array([[east*r, y, south*r] for y,r in
                            [(2.50,2.25),(6.8,2.19),(11.5,1.55),(15.8,.20),(17.42,-.62)]])
            for start,end in zip(leg, leg[1:]):
                for offset in (-.15,.15):
                    shift = np.array([offset,0,0])
                    model.beam(start+shift,end+shift,.092,'red',6)
                if model.detail:
                    steps = max(1,round((end[1]-start[1])/.47))
                    for i in range(steps):
                        shift=np.array([.15*(-1)**i,0,0])
                        model.beam(start+(end-start)*i/steps+shift,
                                   start+(end-start)*(i+1)/steps-shift,.045,'red',5)
            for dx,dz in [(east,-south),(-east,south)]:
                model.beam(leg[1],[dx*1.72,10.6,dz*1.72],.11,'red',6)
    # Four horizontal rails transfer the dials to the corner trusses.
    for sign in (-1,1):
        model.box(0,11.34,sign*1.55,3.42,.32,.28,'red')
        model.box(sign*1.55,11.34,0,.28,.32,3.42,'red')
    up = np.array([0,1,0])
    for index in range(4):
        angle=index*math.pi/2
        normal=np.array([math.cos(angle),0,math.sin(angle)])
        tangent=np.cross(up,normal)
        center=normal*1.55+up*11.5
        model.beam(center,center+normal*.22,1.04,'glass',32)
        face=center+normal*.235
        model.beam(center+normal*.21,face,.88,'white',32)
        for hour in range(12):
            theta=hour*math.pi/6
            direction=tangent*math.sin(theta)+up*math.cos(theta)
            model.beam(face+direction*.70,face+direction*.82,.04,'sign',5)
        model.beam(face,face+up*.58,.045,'sign',6)
        model.beam(face,face+tangent*.44-up*.12,.055,'sign',6)


if __name__ == '__main__':
    generate('zhengyang_clock',clock)

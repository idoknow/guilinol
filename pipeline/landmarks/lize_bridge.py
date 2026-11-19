"""Lize Bridge, local x along the crossing, eastbound. Dimensions in metres."""
import math

import numpy as np

from xiaoyao_tower import generate
from c_kit import landmark_surface


def deck_grade(station):
    return 8.55 + np.minimum(.05*station, 2-.045*(station-40))


def cable_height(station):
    distance = abs(station)
    if distance > 40:
        return 18 - (distance - 40) * 16.5 / 21
    return 3.2 + 14.8 * (math.cosh(distance / 47) - 1) / (math.cosh(40 / 47) - 1)


def towers(model, lateral):
    for station in (-40, 40):
        foot = landmark_surface('lize_bridge').ground(station,lateral)-deck_grade(station)-.12
        for bottom, width, height in [(foot, 2.1, 2-foot), (2, 1.5, 15), (17, 1.8, .4), (17.4, 1.5, .9)]:
            model.box(station, bottom, lateral, width, height, width, 'red', True)
        vertices = [(station + dx, 18.3, lateral + dz) for dx, dz in [(-.95,-.95),(.95,-.95),(.95,.95),(-.95,.95)]]
        # The cap overhangs the tower shaft. Its soffit bears on the capital.
        model.mesh(vertices, [[0,1,2],[0,2,3]], 'red')
        vertices.append((station, 19.8, lateral))
        model.mesh(vertices, [[0,4,1],[1,4,2],[2,4,3],[3,4,0]], 'red')
        model.box(station + .765, 2, lateral, .035, 15, .16, 'lamp')
    samples = np.unique(np.r_[np.linspace(-61, 61, 63 if model.detail else 17), -40, 40])
    for start, end in zip(samples, samples[1:]):
        model.beam([start,cable_height(start),lateral], [end,cable_height(end),lateral], .072, 'red')
        model.beam([start,cable_height(start)+.068,lateral], [end,cable_height(end)+.068,lateral], .022, 'lamp')
    for station in range(-56, 57, 4 if model.detail else 8):
        if abs(station) != 40:
            model.beam([station,.2,lateral],[station,cable_height(station),lateral],.055,'red')
            model.box(station,.16,lateral,.38,.30,.38,'red')
            model.box(station,cable_height(station)-.12,lateral,.28,.22,.22,'red')


def promenade(model, side):
    for direction in (-1,1):
        inner=direction*61.5
        outer=direction*74.5
        corners=[]
        for station in (inner,outer):
            for offset in (-1.9,1.9):
                z = side*9.6+offset
                y = .15 if station==inner else landmark_surface('lize_bridge').ground(station,z)-deck_grade(station)
                corners.append((station,y,z))
        faces=[[0,2,3],[0,3,1]] if direction<0 else [[0,3,2],[0,1,3]]
        model.mesh(corners,faces,'pave',True)
    for start, end in [(-61.5,40),(40,61.5)]:
        center, length = (start+end)/2, end-start
        model.box(center,-.48,side*9.6,length,.63,3.8,'pave',True)
        for rib in range(5):
            model.box(center,.165,side*(10.63+.064*rib),length,.025,.035,'granite')
        model.box(center,.12,side*7.8,length,.22,.3,'yellow',True)
        model.box(center,.71,side*7.8,length,.16,.18,'yellow',True)
    for station in range(-60,61,3 if model.detail else 6):
        model.box(station,.2,side*7.8,.14,.56,.15,'yellow')
    for station in range(-60,61,3):
        model.box(station,.15,side*11.35,2.75,1.03,.26,'green',True)
        model.box(station,1.18,side*11.35,2.86,.13,.39,'green')
        model.box(station+1.42,.15,side*11.35,.25,1.25,.42,'green',True)
    for station in range(-58,60,6):
        for angle in np.linspace(0,math.pi,13)[:-1]:
            points=[(station,.161,side*7.94)]+[(station+2.92*math.cos(theta),.161,side*(7.94+3.16*math.sin(theta))) for theta in (angle,angle+math.pi/12)]
            model.mesh(points,[[0,1,2]],'earth')


def bridge(model):
    for station in (-40,40):
        for height in (12.8,16.8):
            model.box(station,height,0,1.1,.85,16.5,'red')
    for side in (-1,1):
        towers(model,side*8.25)
        promenade(model,side)
        model.box(side*60,.15,side*8.55,.18,4.8,.18,'granite')
        model.box(side*60,4.35,side*8.55,.44,.98,.34,'tile')
        model.box(side*60.0+.23,4.98,side*8.55,.04,.21,.21,'red')


if __name__ == '__main__':
    generate('lize_bridge', bridge, smooth=('red',),colors=dict(red='#d4733a',green='#bc5140',yellow='#d79547',earth='#a76358',granite='#828484'), lift=deck_grade)

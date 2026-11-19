"""Lize Bridge, local x along the crossing, eastbound. Dimensions in metres."""
import math

import numpy as np

from xiaoyao_tower import generate


def cable_height(station):
    distance = abs(station)
    if distance > 40:
        return 18 - (distance - 40) * 16.5 / 21
    return 3.2 + 14.8 * (math.cosh(distance / 47) - 1) / (math.cosh(40 / 47) - 1)


def towers(model, lateral):
    for station in (-40, 40):
        for bottom, width, height in [(-4, 2.1, 6), (2, 1.5, 15), (17, 1.8, .4), (17.4, 1.5, .9)]:
            model.box(station, bottom, lateral, width, height, width, 'red', True)
        vertices = [(station + dx, 18.3, lateral + dz) for dx, dz in [(-.95,-.95),(.95,-.95),(.95,.95),(-.95,.95)]]
        vertices.append((station, 19.8, lateral))
        model.mesh(vertices, [[0,4,1],[1,4,2],[2,4,3],[3,4,0]], 'red')
        model.box(station + .765, 2, lateral, .035, 15, .16, 'lamp')
    samples = np.unique(np.r_[np.linspace(-61, 61, 63 if model.detail else 17), -40, 40])
    for start, end in zip(samples, samples[1:]):
        model.beam([start,cable_height(start),lateral], [end,cable_height(end),lateral], .13, 'red')
        model.beam([start,cable_height(start)+.12,lateral], [end,cable_height(end)+.12,lateral], .055, 'lamp')
    for station in range(-56, 57, 4 if model.detail else 8):
        if abs(station) != 40:
            model.beam([station,.2,lateral],[station,cable_height(station),lateral],.055,'red')


def promenade(model, side):
    for direction, outer_height in [(-1,150.1),(1,154.7)]:
        inner=direction*61.5
        outer=direction*74.5
        height=outer_height-146.6-(8.55+min(.05*outer,2-.045*(outer-40)))
        corners=[(station,y,side*9.6+offset) for station,y in [(inner,.15),(outer,height)] for offset in (-1.9,1.9)]
        faces=[[0,2,3],[0,3,1]] if direction<0 else [[0,3,2],[0,1,3]]
        model.mesh(corners,faces,'pave',True)
    for start, end in [(-61.5,40),(40,61.5)]:
        center, length = (start+end)/2, end-start
        model.box(center,-.48,side*9.6,length,.63,3.8,'pave',True)
        model.box(center,.15,side*9.55,length,.018,.34,'yellow')
        model.box(center,.15,side*11.35,length,1.08,.32,'red',True)
        model.box(center,1.23,side*11.35,length,.12,.42,'earth')
        model.box(center,.12,side*7.8,length,.22,.3,'yellow',True)
        model.box(center,.71,side*7.8,length,.16,.18,'yellow',True)
    for station in range(-60,61,3 if model.detail else 6):
        model.box(station,.2,side*7.8,.14,.56,.15,'yellow')
        if model.detail:
            for angle in np.linspace(0, math.pi, 9)[:-1]:
                strip = [(station+r*math.cos(theta),.155,side*(10.95-r*math.sin(theta)))
                         for theta,r in [(angle,1.18),(angle,1.42),(angle+math.pi/8,1.42),(angle+math.pi/8,1.18)]]
                model.mesh(strip,[[0,1,2],[0,2,3]],'earth')


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
    generate('lize_bridge', bridge, lift=lambda east: 8.55 + np.minimum(.05*east, 2-.045*(east-40)))

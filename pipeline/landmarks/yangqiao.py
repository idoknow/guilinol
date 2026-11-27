"""Three-span masonry face, undercroft and parapets of OSM outline 701820462."""
import json
from pathlib import Path

import numpy as np


def deck_faces():
    profile = json.loads((Path(__file__).resolve().parents[1] / 'data/landmarks/yangqiao-grade.json').read_bytes())
    south, north = map(np.array, (profile['south'], profile['north']))
    grid = []
    for fraction, heights in zip(profile['stations'], profile['levels']):
        west, east = south + fraction * (north - south)
        row = []
        for lateral, height in zip(profile['lateral'], heights):
            x, z = west + lateral * (east - west)
            row.append([x, height, z])
        grid.append(row)
    for left, right in zip(grid, grid[1:]):
        for i in range(len(left)-1):
            yield [left[i], left[i+1], right[i+1]]
            yield [left[i], right[i+1], right[i]]


def pedestrian_wings(builder, anchor):
    profile = json.loads((Path(__file__).resolve().parents[1] / 'data/landmarks/yangqiao-grade.json').read_bytes())
    south, north = (np.array(profile[end]) - anchor for end in ('south', 'north'))

    def station(along, across, offset):
        west, east = south + along * (north - south)
        x, z = west + across * (east - west)
        levels = [np.interp(across, profile['lateral'], row) for row in profile['levels']]
        return [x, np.interp(along, profile['stations'], levels) - builder.surface.y + offset, z]

    def quad(vertices, material, collide=False):
        builder.mesh(vertices, [(0, 1, 2), (0, 2, 3)], material, collide=collide)

    for side, inward in [(.001, .005), (.999, -.005)]:
        for bay in range(14):
            start, end = bay / 14, (bay + 1) / 14
            section = [(side, 0), (side, 1), (side + inward, 1), (side + inward, 0)]
            for (across, height), (other, top) in zip(section, section[1:]):
                panel = [station(start, across, height), station(start, other, top),
                         station(end, other, top), station(end, across, height)]
                quad(panel if inward > 0 else panel[::-1], 'stone', True)
        for along in np.linspace(0, 1, 15):
            x, level, z = station(along, side + inward, 0)
            builder.box(x, level, z, .32, 1.15, .32, 'stone', collide=True)
        for along in (0, .32, .68, 1):
            x, level, z = station(along, side + 3 * inward, 0)
            builder.cluster_lamp(x, level, z, height=4.2, globes=3)

    for start, end in [(0, .30), (.33, .67), (.70, 1)]:
        for step in range(16):
            pair = [step / 16, (step + 1) / 16]
            arch = [(start + phase * (end - start), -.48 - 2.3 * (2 * phase - 1)**2) for phase in pair]
            (left, low), (right, high) = arch
            for side in (0, 1):
                face = [station(left, side, -.45), station(right, side, -.45),
                        station(right, side, high), station(left, side, low)]
                quad(face if side == 0 else face[::-1], 'stone')
            quad([station(left, 0, low), station(right, 0, high),
                  station(right, 1, high), station(left, 1, low)], 'stone')

    for start, end in [(.30, .33), (.67, .70)]:
        ring = [(start, 0), (start, 1), (end, 1), (end, 0)]
        heads = [station(along, across, -.45) for along, across in ring]
        feet = [[x, builder.surface.ground(x, z) - .04, z] for x, _, z in heads]
        for index in range(4):
            other = (index + 1) % 4
            quad([feet[index], feet[other], heads[other], heads[index]], 'stone')

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
            first = len(builder.visible)
            solid_start = len(builder.solid)
            start, end = bay / 14, (bay + 1) / 14
            for base, cap in [(0, .19), (.86, 1)]:
                section = [(side, base), (side, cap), (side + inward, cap), (side + inward, base)]
                for (across, height), (other, top) in zip(section, section[1:] + section[:1]):
                    panel = [station(start, across, height), station(start, other, top),
                             station(end, other, top), station(end, across, height)]
                    quad(panel if inward > 0 else panel[::-1], 'stone', True)
            for middle in np.linspace(start, end, 7)[1:-1]:
                x, base, z = station(middle, side + inward / 2, .18)
                builder.cylinder_y(x, base, .70, z, .065, 'white', sections=8, collide=True)
            for along in ([start, end] if bay == 13 else [start]):
                x, level, z = station(along, side + inward / 2, 0)
                builder.box(x, level, z, .32, 1.15, .32, 'stone', collide=True)
            bank = 'west' if inward > 0 else 'east'
            builder.named_solids.setdefault('yangqiao_rail', []).extend(builder.solid[solid_start:])
            del builder.solid[solid_start:]
            builder.named_parts[f'yangqiao_rail_{bank}_{bay:02d}'] = (builder.visible[first:], 'yangqiao_rail', [211,211,211,255])
            del builder.visible[first:], builder.uv[first:]
        for along in (.025, .32, .68, .975):
            x, level, z = station(along, side + 3 * inward, 0)
            builder.cylinder_y(x, level, .65, z, .27, 'stone')
            builder.cylinder_y(x, level + .65, 2.8, z, .105, 'bronze')
            builder.cylinder_y(x, level + 3.45, .55, z, .24, 'white_lit')

    for along, end in zip(profile['stations'], profile['stations'][1:]):
        if end <= 0:
            continue
        along = max(along, profile['stations'][0]+.002)
        end = min(end, profile['stations'][-1]-.002)
        for across in (.377, .44, .565, .628):
            quad([station(along, across-.0016, .027), station(along, across+.0016, .027),
                  station(end, across+.0016, .027), station(end, across-.0016, .027)], 'white')
        for stripe in (.499, .505):
            quad([station(along,stripe-.0015,.027),station(along,stripe+.0015,.027),
                  station(end,stripe+.0015,.027),station(end,stripe-.0015,.027)], 'yellow_pave')

    first = len(builder.visible)
    for start, end in [(0, .30), (.33, .67), (.70, 1)]:
        for step in range(64):
            pair = [step / 64, (step + 1) / 64]
            arch = [(start + phase * (end - start), -.48 - 2.3 * (2 * phase - 1)**2) for phase in pair]
            (left, low), (right, high) = arch
            for side in (0, 1):
                face = [station(left, side, -.02), station(right, side, -.02),
                        station(right, side, high), station(left, side, low)]
                quad(face if side == 0 else face[::-1], 'stone')
            for outer, inner in zip(profile['lateral'], profile['lateral'][1:]):
                quad([station(left, outer, low), station(right, outer, high),
                      station(right, inner, high), station(left, inner, low)], 'stone')

    for start, end in [(.30, .33), (.67, .70)]:
        ring = [(start, 0), (start, 1), (end, 1), (end, 0)]
        heads = [station(along, across, -.02) for along, across in ring]
        feet = [[x, min(builder.surface.ground(x, z),146.1-builder.surface.y) - .04, z] for x, _, z in heads]
        for index in range(4):
            other = (index + 1) % 4
            quad([feet[index], feet[other], heads[other], heads[index]], 'stone')
    for along in (0, 1):
        for outer, inner in zip(profile['lateral'], profile['lateral'][1:]):
            head = [station(along, across, -.02) for across in (outer, inner)]
            foot = [[x, min(top, builder.surface.ground(x, z)) - .04, z] for x, top, z in head]
            quad([*head, *reversed(foot)], 'stone')
    builder.named_parts['yangqiao_underground_vault'] = (builder.visible[first:], 'yangqiao_vault', [213,202,183,255])
    del builder.visible[first:], builder.uv[first:]

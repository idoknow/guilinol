from functools import cache
from pathlib import Path
import sys

import numpy as np
from shapely.geometry import Point

from c_kit import landmark_surface
from jiefang_layout import bank_paving, deck_level

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from seam_streets import Streets


@cache
def references():
    frame = landmark_surface('jiefang_bridge')
    return frame, Streets(frame.surface), bank_paving(np.zeros(2),0)


def join_bank(outer, normals, walk_width, chainage):
    frame, streets, modeled = references()
    for index,vertex in enumerate(outer):
        if min(chainage[index],chainage[-1]-chainage[index])<4: continue
        position = vertex[[0,2]]
        direction = normals[index]/np.linalg.norm(normals[index])
        levels = []
        for distance in (.04,.35,.75):
            probe = position+distance*direction
            if modeled.covers(Point(probe)) or frame.water(*probe) is not None: break
            east,south = probe
            height,kinds = streets.at(frame.x+frame.cos*east+frame.sin*south,frame.z-frame.sin*east+frame.cos*south)
            if kinds and not kinds.issubset({1,6}): break
            levels.append(height-frame.y)
        if len(levels)!=3 or max(levels)-min(levels)>.06: continue
        delta = levels[0]+.012-(vertex[1]+deck_level(position[0]))
        if abs(delta)<=walk_width*.08: vertex[1]+=delta

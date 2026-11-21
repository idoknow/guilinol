from functools import cache

import numpy as np
from shapely.geometry import LineString, Point, Polygon

from landmarks.jiefang_layout import (LOWER_ROADS, RAMPS, UPPER_ROADS, deck_level,
                                      section, widths)


@cache
def alignments():
    rows = []
    for ways,layer in [(RAMPS,'ramp'),(LOWER_ROADS,'underpass'),(UPPER_ROADS,'upper-road')]:
        for way in ways:
            coords,normals,station,levels = section(way)
            left,right,walk = widths(way)
            inner = coords+normals*np.broadcast_to(left,len(coords))[:,None]
            outer = coords+normals*np.broadcast_to(right+walk,len(coords))[:,None]
            rows.append((layer,Polygon(np.vstack([inner,outer[::-1]])).buffer(.1),LineString(coords),station,levels))
    return rows


def bridge_layer(local, height):
    along, across = local
    if abs(along)<139.5 and abs(across)<21.6 and abs(height-deck_level(along))<.45:
        return 'bridge-deck'
    point = Point(local)
    for layer,shape,axis,stations,levels in alignments():
        if shape.covers(point):
            station = axis.project(point)
            if 1<station<axis.length-1 and abs(height-np.interp(station,stations,levels))<.45:
                return layer
    return 'ground'

"""Guilin station levels in the project vertical datum, all in metres."""
import json
from pathlib import Path

import numpy as np
from shapely import distance, points as point_array, union_all

from common import GRID, load_osm
from features import area
from road_grading import STEP

STYLE = json.loads(Path(__file__).with_name('railway-style.json').read_text())['stationLevels']
PLATFORM = STYLE['hallFloor'] + STYLE['platformRise']
RAIL = PLATFORM - STYLE['platformHeight']
SOFFIT = RAIL + STYLE['overheadClearance']
TUNNEL_FLOOR = RAIL - STYLE['structureDepth'] - STYLE['roadClearance']
PLATFORMS = {376029417, 376029418, 376029419, 376029420}
FOOTBRIDGE = 819178842
UNDERPASS = 690911289


def grade_platforms(terrain, underlay, water, road_ctrl, left, top):
    pads = union_all([area(w) for w in load_osm() if w['type']=='way' and w['id'] in PLATFORMS])
    for grid, step, level, scale, margin in (
        (road_ctrl, STEP, PLATFORM-.195, 1, 2*STEP),
        (terrain, GRID, RAIL-.35, 10, GRID*2),
        (underlay, GRID, RAIL-.35, 10, GRID*2),
    ):
        x0,z0 = (left-STEP,top-STEP) if grid is road_ctrl else (left,top)
        xmin,zmin,xmax,zmax = pads.buffer(margin+24).bounds
        i,j = np.maximum(0,np.floor(np.array([xmin-x0,zmin-z0])/step)).astype(int)
        ii,jj = np.minimum(grid.shape[::-1], np.ceil(np.array([xmax-x0,zmax-z0])/step)+1).astype(int)
        if ii<=i or jj<=j:
            continue
        x,z = np.meshgrid(x0+np.arange(i,ii)*step, z0+np.arange(j,jj)*step)
        t = np.clip((margin+24-distance(point_array(x,z),pads))/24,0,1)
        weight = t*t*(3-2*t)
        patch = grid[j:jj,i:ii]
        if scale==10:
            weight *= water[j:jj,i:ii]==-32768
        values = patch + weight*(level*scale-patch)
        patch[:] = np.rint(values) if scale==10 else values


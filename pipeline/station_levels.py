"""Guilin station levels in the project vertical datum, all in metres."""
import json
from pathlib import Path

import numpy as np
from shapely import LineString, distance, points as point_array, union_all

from common import GRID, load_osm
from features import area, points


STYLE = json.loads(Path(__file__).with_name('railway-style.json').read_text())['stationLevels']
PLATFORM = STYLE['hallFloor'] + STYLE['platformRise']
RAIL = PLATFORM - STYLE['platformHeight']
SOFFIT = RAIL + STYLE['overheadClearance']
TUNNEL_FLOOR = RAIL - STYLE['structureDepth'] - STYLE['roadClearance']
PLATFORMS = {376029417, 376029418, 376029419, 376029420}
FOOTBRIDGE = 819178842
UNDERPASS = 690911289


def grade_platforms(terrain, underlay, water, left, top):
    ways = [w for w in load_osm() if w['type'] == 'way']
    pads = union_all([area(w) for w in ways if w['id'] in PLATFORMS])
    # Keep the terrain supporting roadway wheels at its original grade, even
    # along unmapped underground decks whose terrain proxy is still in use.
    near = pads.buffer(100)
    driveable = {'motorway','trunk','primary','secondary','tertiary','residential',
                 'unclassified','service','living_street','busway','cycleway'}
    roadway = []
    for way in ways:
        kind = way.get('tags', {}).get('highway', '').removesuffix('_link')
        if kind not in driveable or way['id'] == UNDERPASS:
            continue
        coords = points(way)
        if len(coords) < 2:
            continue
        line = LineString(coords)
        if line.intersects(near):
            roadway.append(line)
    roads = union_all(roadway)
    # The ground and underlay share the same 4 m lattice and water mask.
    margin = 2*GRID
    xmin, zmin, xmax, zmax = pads.buffer(margin+24).bounds
    i, j = np.maximum(0, np.floor(np.array([xmin-left, zmin-top])/GRID)).astype(int)
    ii, jj = np.minimum(terrain.shape[::-1], np.ceil(np.array([xmax-left, zmax-top])/GRID)+1).astype(int)
    if ii<=i or jj<=j:
        return
    x, z = np.meshgrid(left+np.arange(i, ii)*GRID, top+np.arange(j, jj)*GRID)
    locations = point_array(x,z)
    t = np.clip((margin+24-distance(locations,pads))/24,0,1)
    weight = t*t*(3-2*t)
    road_blend = np.clip((distance(locations,roads)-32)/12,0,1)
    weight *= road_blend*road_blend*(3-2*road_blend)
    weight *= water[j:jj,i:ii]==-32768
    for grid in (terrain, underlay):
        patch = grid[j:jj,i:ii]
        patch[:] = np.rint(patch + weight*((RAIL-.35)*10-patch))

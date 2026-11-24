"""Query emitted GL04 street polygons and their grade in world metres."""
import gzip
import json
import math
import struct
from functools import lru_cache

import numpy as np
import shapely

from road_grading import eval_bspline_grid

OFFSETS = [.045, .195, .065, 0, .195, .06, .195]


class Streets:
    def __init__(self, world):
        self.world = world
        self.lower = {}
        self.platforms = {}

    @lru_cache(maxsize=80)
    def tile(self, origin):
        world = self.world
        data = gzip.decompress((world.directory / world.files[origin]).read_bytes())
        _, vertices, indices, length, _, _ = struct.unpack_from('<4s5I', data)
        offset = 24 + 4*(world.size//world.grid+1)**2 + 9*vertices + 4*indices
        streets = json.loads(data[offset:offset+length])[1]
        shapes, kinds = [], []
        for kind, *loops in streets[0]:
            rings = [np.asarray(loop)/100+origin for loop in loops]
            shapes.append(shapely.Polygon(rings[0], rings[1:]))
            kinds.append(kind)
        ctrl = streets[5] if len(streets)>5 else None
        grid = (np.reshape(ctrl[1], (35, 35))+ctrl[0])/1000 if ctrl else None
        if len(streets)>12:
            self.platforms[origin] = streets[12]
        if len(streets)>11 and streets[11]:
            first,corners,profile = streets[11]
            axis = shapely.LineString(np.asarray(profile)[:,:2]+origin) if profile else None
            self.lower[origin] = first,shapely.Polygon(np.asarray(corners)+origin),axis,np.asarray(profile)
        return shapely.STRtree(shapes), kinds, grid

    def at(self, x, z):
        world = self.world
        origin = tuple(int(base+world.size*math.floor((v-base)/world.size))
                       for v, base in zip((x,z), (world.left, world.top)))
        tree, kinds, grid = self.tile(origin)
        point = shapely.Point(x,z)
        hits = tree.query(point,predicate='intersects')
        coverage = {kinds[index] for index in hits}
        if origin in self.platforms:
            first, end, level = self.platforms[origin]
            if any(first<=index<end for index in hits):
                return level, coverage
        height, _ = world.sample(x,z)
        if coverage:
            if grid is not None:
                weight = 1
                if origin in self.lower and min(hits)>=self.lower[origin][0]:
                    t = np.clip((self.lower[origin][1].distance(point)-2)/22,0,1)
                    weight = t*t*(3-2*t)
                    start,end=np.asarray(self.lower[origin][1].exterior.coords)[:2]
                    if (np.array([x,z])-(start+end)/2)@(end-start)>0:
                        axis,profile=self.lower[origin][2:]; weight=1
                        if axis is not None:
                            stations=np.r_[0,np.cumsum(np.linalg.norm(np.diff(profile[:,:2],axis=0),axis=1))]
                            pos=axis.project(point); factor=np.interp(pos,stations,profile[:,3]); base=max(height,float(eval_bspline_grid(grid,*origin,np.asarray(x),np.asarray(z))))
                            return base+factor*(np.interp(pos,stations,profile[:,2])-base)+max(OFFSETS[kind] for kind in coverage),coverage
                height += weight*max(0,float(eval_bspline_grid(grid,*origin,np.asarray(x),np.asarray(z)))-height)
            height += max(OFFSETS[kind] for kind in coverage)
        return height, coverage

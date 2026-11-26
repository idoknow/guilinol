"""Vegetation support on the final paved railway approaches."""
import gzip
import json
import struct

import numpy as np


def stem_support(stems,tile):
    from shapely import Polygon, STRtree, points
    from road_grading import eval_bspline_grid
    x,z = stems[:,:2].T.astype(float)/100
    raw = gzip.decompress(tile)
    verts,indices,size,image,decks = struct.unpack_from('<5I',raw,4)
    start = 24+16900+9*verts+4*indices
    tail = start+size+image+18*decks
    field = np.frombuffer(raw,'<i2',4225,tail if len(raw)>tail else 24).reshape(65,65)/10
    water = np.frombuffer(raw,'<i2',4225,8474).reshape(65,65)
    for bed,wet in ((field[0],water[0]),(field[-1],water[-1]),
                    (field[:,0],water[:,0]),(field[:,-1],water[:,-1])):
        if np.all(wet==-32768):
            bed[:] = np.interp(np.arange(65),np.arange(0,65,8),bed[::8])
    stride = 1 if np.any(water!=-32768) else 2
    u,v = x/(4*stride),z/(4*stride)
    i,j = (np.minimum(t.astype(int),64//stride-1) for t in (u,v))
    u,v = u-i,v-j
    g = field[::stride,::stride]
    a,b,c,d = g[j,i],g[j,i+1],g[j+1,i],g[j+1,i+1]
    y = np.where(u+v<=1,a+(b-a)*u+(c-a)*v,d+(c-d)*(1-u)+(b-d)*(1-v))
    paths = json.loads(raw[start:start+size])[1]
    offset = np.zeros(len(stems))
    paved = np.zeros(len(stems),dtype=bool)
    if len(paths)>5 and paths[5]:
        base,values = paths[5]
        ctrl = (base+np.array(values).reshape(35,35))/1000
        surface = eval_bspline_grid(ctrl,0,0,x,z)
        rings = paths[0][:paths[11][0]] if len(paths)>11 and paths[11] else paths[0]
        for kinds,lift in (((0,5),.045),((2,),.06),((1,4,6),.195)):
            shapes = [Polygon(shell,holes) for kind,shell,*holes in rings if kind in kinds and len(shell)>=3]
            hits,_ = STRtree(shapes).query(points(stems[:,:2]),predicate='within')
            y[hits] = np.maximum(surface[hits],y[hits])
            offset[hits] = lift
            if 0 in kinds:
                paved[hits] = True
    return y+offset,paved

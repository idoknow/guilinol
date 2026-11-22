import struct
import zlib

import numpy as np
from scipy.ndimage import (distance_transform_edt, gaussian_filter, label,
                           map_coordinates, maximum_filter, percentile_filter)

from common import GRID, xz2ll


def detect(terrain,wet,left,top,centers):
    stride = 32//GRID
    coarse = terrain[::stride,::stride].astype(float)/10
    dry = ~wet[::stride,::stride]
    if not dry.any():
        return [],None
    nearest = distance_transform_edt(~dry,return_distances=False,return_indices=True)
    axis = np.arange(-15,16)
    distance = np.hypot(axis[:,None],axis)
    annulus = (distance>=10)&(distance<=15)
    ground = gaussian_filter(percentile_filter(coarse[tuple(nearest)],15,footprint=annulus,mode='nearest'),2)
    land = np.where(dry,coarse,-np.inf)
    regions,_ = label(dry & (land-ground>=25),structure=np.ones((3,3)))
    maxima = (regions!=0)&(land==maximum_filter(land,size=3))
    candidates = sorted(zip(*np.nonzero(maxima)),key=lambda cell:(-land[cell],*cell))
    occupied = list(centers)
    peaks = []
    for row,col in candidates:
        east,south = left+int(col)*32,top+int(row)*32
        if any(np.hypot(east-other_x,south-other_z)<60 for other_x,other_z in occupied):
            continue
        occupied.append((east,south))
        lat,lon = xz2ll(east,south)
        # Preserve the published downtown release's 32 m sample numbering.
        # Outside that extent use world coordinates so later expansions are stable.
        if -2304 <= east <= 1280 and -2560 <= south <= 3328:
            seed = ((south + 2560)//32)*113 + (east + 2304)//32
        else:
            seed = zlib.crc32(struct.pack('<ii', east, south))
        rng = np.random.default_rng(seed)
        peaks.append(dict(name=f'auto-{len(peaks)+1:03}',lat=lat,lon=lon,seed=seed,
                          baseHeight=round(float(ground[row,col]),1),target=float(land[row,col]),
                          shoulder=round(rng.uniform(.51,.64),3),taper=round(rng.uniform(.12,.21),3),
                          source='DEM 自动补峰'))
    return peaks,ground


def suppress(terrain,wet,ground):
    if ground is None:
        return
    stride = 32//GRID
    cols = np.arange(terrain.shape[1],dtype=np.float32)/stride
    for start in range(0,terrain.shape[0],128):
        stop = min(start+128,terrain.shape[0])
        rows = np.arange(start,stop,dtype=np.float32)/stride
        coords = np.meshgrid(rows,cols,indexing='ij')
        baseline = map_coordinates(ground,coords,order=1,mode='nearest')
        strip = terrain[start:stop]
        excess = np.maximum(strip/10-baseline,0)
        blend = np.clip((excess-3)/12,0,1)
        lowered = np.rint(strip-10*excess*blend**2*(3-2*blend))
        dry = ~wet[start:stop]
        strip[dry] = lowered[dry]

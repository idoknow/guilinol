import numpy as np


RING = 4
PORTALS = (94, 106)


def mouths(rings):
    return [rings[RING, index].copy() for index in PORTALS]


def cut(data, faces, terrain, left, top, grid):
    rings = data[:-1, :3].reshape(12, 128, 3)
    first, last = mouths(rings)
    segment = (last-first)[[0, 2]]
    endpoints = np.array([first,last])[:,[0,2]]
    lo = np.maximum(0,np.floor((endpoints.min(axis=0)-24-[left,top])/grid).astype(int))
    hi = np.minimum(terrain.shape[::-1],np.ceil((endpoints.max(axis=0)+24-[left,top])/grid).astype(int))
    rows, cols = np.ogrid[lo[1]:hi[1],lo[0]:hi[0]]
    terrain = terrain[lo[1]:hi[1],lo[0]:hi[0]]
    dx, dz = left+cols*grid-first[0], top+rows*grid-first[2]
    fraction = (dx*segment[0]+dz*segment[1]) / (segment @ segment)
    distance = abs(dx*segment[1]-dz*segment[0])/np.linalg.norm(segment)
    corridor = (distance < 7) & (fraction > -.22) & (fraction < 1.22)
    floor = first[1]+fraction*(last[1]-first[1])-.65
    terrain[corridor] = np.minimum(terrain[corridor], np.floor(10*floor[corridor]))
    keep = np.ones(len(faces), dtype=bool)
    for index in PORTALS:
        start = 2*(RING*128+index-1)
        keep[start:start+4] = False
    return faces[keep]

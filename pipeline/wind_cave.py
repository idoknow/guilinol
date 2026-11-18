import math
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


def trail(rings,tip):
    count=rings.shape[1]
    first,last=mouths(rings)
    def point(progress):
        if progress<.32:
            phase=np.interp(progress,[0,.27,.32],[79,94,94]);index=int(phase);weight=phase-index
            base=(1-weight)*rings[1,index]+weight*rings[1,index+1]
            radial=base[[0,2]]-[rings[0,count//4,0],rings[0,0,2]];radial/=np.linalg.norm(radial)
            base[[0,2]]+=radial*np.interp(progress,[0,.2,.27,.32],[16,12,10,0])
            base[1]=np.interp(progress,[0,.015,.27,.32],[first[1]-26.55,first[1]-26.55,first[1]-2,first[1]])
            if progress>.27:base[[0,2]]+=(first-rings[1,94])[[0,2]]*(progress-.27)/.05
            return base
        if .32 <= progress <= .42:
            return first+(last-first)*(progress-.32)/.1
        part=min(1,(progress-.42)/.54);height=RING+(11-RING)*part;phase=PORTALS[1]+part*45
        index=math.floor(phase)%count;fraction=phase%1
        strip=rings[:,index]*(1-fraction)+rings[:,(index+1)%count]*fraction
        layer=min(10,int(height));fraction=height-layer
        position=strip[layer]*(1-fraction)+strip[layer+1]*fraction
        radial=position[[0,2]]-tip[[0,2]];radial/=np.linalg.norm(radial)
        position[[0,2]]+=radial*6*min(1,(progress-.42)*70)
        if progress>.96:
            position+=(tip-position)*((progress-.96)/.04)
        return position
    return point

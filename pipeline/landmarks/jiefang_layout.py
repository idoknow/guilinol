"""West abutment, in metres along the bridge (x) and across it (z)."""
import numpy as np
from shapely.geometry import LineString
from shapely.ops import unary_union

RADIUS = 24
UPPER = 6.45
LOWER = 1.05


def ramp(side, fractions):
    angle = fractions * 1.5 * np.pi
    x = -140 - RADIUS * np.sin(angle)
    z = side * (41 - RADIUS * np.cos(angle))
    return x, UPPER + fractions * (LOWER - UPPER), z


def bank_paving(anchor,angle):
    matrix=np.array([[np.cos(angle),np.sin(angle)],[-np.sin(angle),np.cos(angle)]])
    paths=[]
    for side in (-1,1):
        xs,_,zs=ramp(side,np.linspace(0,1,37))
        paths.append(LineString(np.column_stack((xs,zs))@matrix+anchor).buffer(2.5))
    paths.append(LineString(np.array([[-119.5,-41],[-119.5,41]])@matrix+anchor).buffer(6,cap_style='flat'))
    return unary_union(paths)


def grade_banks(terrain, original, wet, left, top, step, anchor, angle, datum):
    # Cut only the descending ramps. Retain the planted centre of each loop.
    bx, bz = anchor
    rows = slice(max(0,int((bz-225-top)//step)),min(terrain.shape[0],int((bz+225-top)//step)+1))
    cols = slice(max(0,int((bx-225-left)//step)),min(terrain.shape[1],int((bx+225-left)//step)+1))
    yy, xx = np.ogrid[rows, cols]
    east = left + xx*step - bx
    south = top + yy*step - bz
    x = east*np.cos(angle) + south*np.sin(angle)
    z = -east*np.sin(angle) + south*np.cos(angle)
    for side in (-1,1):
        dx, dz = -140-x, 41-side*z
        phase = np.arctan2(dx,dz) % (2*np.pi)
        t = phase / (1.5*np.pi)
        shoulder = np.maximum(0, abs(np.hypot(dx,dz)-RADIUS)-5)
        limit = np.rint(10*(datum + UPPER + t*(LOWER-UPPER) - .35 + shoulder*.5))
        active = (t<=1) & (shoulder<11) & ~wet[rows,cols]
        for field in (terrain,original):
            patch=field[rows,cols]
            patch[active]=np.minimum(patch[active],limit[active])

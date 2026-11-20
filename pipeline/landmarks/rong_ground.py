"""Dry paving outlines in local metres from the Gunanmen and Xizhou Pavilion nodes."""
import numpy as np
from shapely import distance, points
from shapely.geometry import Polygon

# Outer side of the pedestrian loop on ways 221349750 and 684511179.
GATE_PLAZA = [(-26,-9),(-12.3,-32.3),(6,-23),(12.8,-36.5),
              (26.4,-31.1),(21,-16.5),(36,-11),(25,16),(11,20),(-28,7)]
# Stone landing immediately inside the mapped island ring at the bridge end.
ISLAND_COURT = [(110.34,118.02),(121.57,120.07),(129.25,120.5),
                (132,134),(119,139),(102,133)]
# Rill and pavilion forecourt in the channel frame used by ronghu.shore.
RILL_COURT_EDGE = [(-18,-10.6),(-7,-6.2),(3,-4.7),(9,-6.8),(16,-10.3),(25,-11.0)]

def rill_north_path(x):
    return -26.936 + (x+62.146)*2.066/104.458

def rill_local(x,z):
    angle = np.deg2rad(18)
    return (x*np.cos(angle)-(z+17.5)*np.sin(angle),
            -16.25+x*np.sin(angle)+(z+17.5)*np.cos(angle))

RILL_PAVING = [rill_local(x,z) for x,z in
               [(-18,rill_north_path(-18)-1.4),(25,rill_north_path(25)-1.4),*reversed(RILL_COURT_EDGE)]]
# South edge follows outer member 674611984 of water relation 9373836.
BANK_EDGE = [(69.3,43.3),(86.7,37.7),(95.6,29.5),(103.3,28.7)]
BANK = [*BANK_EDGE,(102,19),(90,17),(81,19),(71,24)]
BANK_Y = -4.40
BRIDGE_AXIS = np.array([-.51,.86]) / np.hypot(.51,.86)
BRIDGE_SIDE = np.array([BRIDGE_AXIS[1],-BRIDGE_AXIS[0]])


def bridge_xz(station, offset):
    return np.array([31.4,82.1]) + station*BRIDGE_AXIS + offset*BRIDGE_SIDE


# North landing of mapped pedestrian bridge way/684946199.
FORECOURT = [bridge_xz(d, w) for d,w in ((-44,-11),(-44,10),(-17,10),(-17,-11))]
# Absolute elevation of the north approach on the mapped pedestrian way.
FORECOURT_ELEVATION = 152.70


def grade_landings(terrain, original, wet, west, north, grid, entries):
    paved = []
    for x,z,entry in entries:
        if entry['id'] == 'gunanmen':
            patches = [(GATE_PLAZA,153.77)]
        elif entry['id'] == 'ronghu':
            patches = [(BANK,153.1+BANK_Y), (FORECOURT,FORECOURT_ELEVATION), (ISLAND_COURT,152.14), (RILL_PAVING,152.78)]
        else:
            continue
        for ring, top in patches:
            shape = Polygon(np.array(ring)+[x,z])
            paved.append(shape)
            left,first,right,last = shape.bounds
            # Blend with the surrounding DEM over two cells. Never write water.
            cols = np.arange(max(0,int((left-west)/grid)-3), min(terrain.shape[1],int((right-west)/grid)+4))
            rows = np.arange(max(0,int((first-north)/grid)-3), min(terrain.shape[0],int((last-north)/grid)+4))
            if not len(cols) or not len(rows):
                continue
            ix = np.ix_(rows,cols)
            xx,zz = np.meshgrid(west+cols*grid,north+rows*grid)
            influence = np.clip(1-distance(points(xx,zz),shape)/(2*grid),0,1) * ~wet[ix]
            for field in (terrain,original):
                target = (top-.08)*10
                if ring is ISLAND_COURT or ring is RILL_PAVING:
                    # Cut high terrain under the slabs while preserving the sloping shore.
                    target = np.minimum(field[ix],target)
                field[ix] = np.rint(field[ix]*(1-influence) + target*influence)
    return paved

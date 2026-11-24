"""Vertical design at the two Hengliu tracks and the independent Nanxi road bridge."""
from functools import lru_cache

import numpy as np
from shapely import LineString, Point, get_coordinates, line_interpolate_point, points as probe_points
from shapely.ops import substring

from common import GRID, load_dem
from features import points
from station_levels import STYLE

STREAM = 882767817
BRIDGE = 882767811
ROAD = 882767812
TRACKS = {882767815,991385702}
STREAM_PROXY = 148.91450  # Minimum of the paired DEM along the two 50 m arms.
CHANNEL_DEPTH = .3
BRIDGE_DEPTH = 1.2


def design(ways):
    stream = LineString(points(ways[STREAM]))
    bridge = LineString(points(ways[BRIDGE]))
    center = stream.project(stream.intersection(bridge))
    reach = substring(stream,center-30,center+30)
    water = channel_water(tuple(reach.coords))
    deck = water+1.+BRIDGE_DEPTH
    # A level landing allows the short 6.96 m approach to meet the bridge
    # without a kink. The margin covers the road mesh interpolation.
    rail = deck+STYLE['structureDepth']+STYLE['roadClearance']+.12
    return reach,water,deck,rail


def surface_dm(water, along, length):
    t = np.clip(np.minimum(along,length-along)/18,0,1)
    return np.rint(10*(STREAM_PROXY+(water-STREAM_PROXY)*t*t*(3-2*t))).astype('<i2')


@lru_cache(maxsize=1)
def channel_water(coords):
    reach = LineString(coords)
    chain = np.linspace(0,reach.length,241)
    xy = get_coordinates(line_interpolate_point(reach,chain))
    tangent = np.gradient(xy,axis=0)
    normal = tangent[:,::-1]*[-1.,1.]/np.linalg.norm(tangent,axis=1)[:,None]
    # Check the entire 7 m wide channel including both edges of its cut.
    samples = xy[:,None,:]+normal[:,None,:]*np.linspace(-3.5,3.5,15)[None,:,None]
    bed = load_dem(*samples.reshape(-1,2).T,paired=True).reshape(len(chain),-1).max(axis=1)
    # Water and ground in the shipped terrain use integer decimetres.
    for dm in range(int((STREAM_PROXY-3)*10),int((149.48-1.-BRIDGE_DEPTH)*10)+1):
        water = dm/10
        cut = bed+CHANNEL_DEPTH-surface_dm(water,chain,reach.length)/10
        if max(cut)<=3:
            return water
    raise ValueError('Nanxi crossing exceeds the 3 m channel excavation limit')


def grade_channel(ways,terrain,ground,surface,left,top):
    reach,water,deck,_ = design(ways)
    bank = reach.buffer(3.5,cap_style='flat')
    xmin,zmin,xmax,zmax = bank.bounds
    i,j = np.floor([(xmin-left)/GRID,(zmin-top)/GRID]).astype(int)
    ii,jj = np.ceil([(xmax-left)/GRID,(zmax-top)/GRID]).astype(int)+1
    x,z = np.meshgrid(left+np.arange(i,ii)*GRID,top+np.arange(j,jj)*GRID)
    probes = probe_points(x,z)
    wet = bank.covers(probes)
    along = reach.project(probes)
    top_dm = surface_dm(water,along,reach.length)
    window = np.s_[j:jj,i:ii]
    surface[window][wet] = top_dm[wet]
    for field in (terrain,ground):
        field[window][wet] = top_dm[wet]-round(CHANNEL_DEPTH*10)
    return bank

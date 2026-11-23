"""Bake the approved Wuling alignment. Stations and offsets are in metres."""
import math

import numpy as np

from common import ll2xz, load_osm


def profile(station, length):
    def transition(distance):
        return (np.maximum(distance,0)**2-np.maximum(distance-8,0)**2
                -np.maximum(distance-78,0)**2+np.maximum(distance-86,0)**2)/16
    return 266.3-2.2*station/length-.034*transition(np.minimum(station,length-station))


def bake(bounds, fields, left, top, grid):
    from shapely.geometry import LineString
    way = next((item for item in load_osm() if item['type']=='way' and item['id']==237985762),None)
    if not way:
        return []
    coords = [ll2xz(point['lat'],point['lon']) for point in way['geometry']]
    if not bounds.covers(LineString(coords)):
        return []
    if len(coords)!=2 or way['tags'].get('tunnel')!='yes':
        raise ValueError('Recheck the Wuling alignment and estimated profile')
    start, end = np.array(coords)
    length = float(np.linalg.norm(end-start))
    direction = (end-start)/length
    normal = np.array([-direction[1],direction[0]])
    cols, rows = [np.arange(math.floor((min(start[axis],end[axis])-30-base)/grid),
                            math.ceil((max(start[axis],end[axis])+30-base)/grid)+1)
                  for axis,base in enumerate((left,top))]
    east, south = np.meshgrid(cols*grid+left-start[0],rows*grid+top-start[1])
    station = east*direction[0]+south*direction[1]
    offset = east*normal[0]+south*normal[1]
    def smooth(value):
        unit = np.clip(value,0,1)
        return unit*unit*(3-2*unit)
    lift = np.rint(19*smooth((19-np.abs(offset))/8)*smooth((station-20)/13)*smooth((80-station)/20)).astype('i2')
    for field in fields:
        field[np.ix_(rows,cols)] += lift
    stations = sorted({0.,8.,30.,78.,86.,length-86,length-78,length-30,length-8,length,*np.arange(4.,length,4.)})
    return [dict(way=way['id'],profile_source='estimated',portals=[[float(start[0]),266.3,float(start[1])],
                [float(end[0]),264.1,float(end[1])]],length=length,halfWidth=6.,clearance=5.1,approach=30.,
                stations=[[float(distance),round(float(profile(distance,length)),5)] for distance in stations],
                fill=dict(maxMeters=float(lift.max())/10,gridVertices=int(np.count_nonzero(lift)),
                          maxOffset=float(np.abs(offset[lift>0]).max()),stationRange=[float(station[lift>0].min()),float(station[lift>0].max())]))]

"""Intersect the rendered terrain triangles with every segment of the roof."""
import json
import math
from pathlib import Path

import numpy as np
from shapely.geometry import Polygon

from landmarks.world_surface import Surface


def measure(world, reference=None):
    surface = Surface(world)
    tunnel, = (t for t in json.loads((world/'manifest.json').read_bytes())['tunnels'] if t['way']==237985762)
    assert tunnel['profile_source']=='estimated' and tunnel['way']==237985762
    west, east = np.array(tunnel['portals'])
    assert west[1]==266.3 and east[1]==264.1
    length, width, clearance = tunnel['length'],tunnel['halfWidth'],tunnel['clearance']
    axis = (east-west)[::2]/length
    normal = np.array([-axis[1],axis[0]])
    stations = np.array(tunnel['stations'])
    grade = abs(np.diff(stations[:,1])/np.diff(stations[:,0])).max()
    cover, worst = math.inf,None
    for (start,low),(end,high) in zip(stations,stations[1:]):
        if start<tunnel['approach'] or end>length-tunnel['approach']:
            continue
        roof = Polygon([west[::2]+axis*along+normal*offset for along,offset in
                        ((start,-width),(end,-width),(end,width),(start,width))])
        xmin,zmin,xmax,zmax = roof.bounds
        for tx in range(math.floor(xmin/256)*256,math.floor(xmax/256)*256+1,256):
            for tz in range(math.floor(zmin/256)*256,math.floor(zmax/256)*256+1,256):
                _,_,step = surface.tile((tx,tz))
                for x in range(max(tx,math.floor(xmin/step)*step),min(tx+256,math.ceil(xmax/step)*step),step):
                    for z in range(max(tz,math.floor(zmin/step)*step),min(tz+256,math.ceil(zmax/step)*step),step):
                        for corners in (((x,z),(x+step,z),(x,z+step)),((x+step,z),(x+step,z+step),(x,z+step))):
                            overlap = roof.intersection(Polygon(corners))
                            if overlap.area<=1e-12:
                                continue
                            for point in overlap.exterior.coords:
                                along = float((np.array(point)-west[::2])@axis)
                                floor = low+(high-low)*(along-start)/(end-start)
                                thickness = surface.sample(*point,include_peaks=False)[0]-floor-clearance
                                if thickness<cover:
                                    cover,worst = thickness,along
    result = dict(maxGradePercent=100*grade,minClearance=clearance,minCover=cover,criticalStation=worst,fill=tunnel['fill'])
    if reference:
        before = Surface(reference)
        offsets,chainage = [],[]
        for origin in surface.files:
            if np.linalg.norm(origin-west[::2])>length+400:
                continue
            elevations,_,step = surface.tile(origin)
            difference = elevations-before.tile(origin)[0]
            assert difference.min()>=-1e-8 and difference.max()<=2+1e-8
            for row,col in np.argwhere(difference>1e-8):
                for across,along in ((0,0),(1,0),(-1,0),(0,1),(0,-1),(1,-1),(-1,1)):
                    adjacent_col,adjacent_row = col+across,row+along
                    if not (0<=adjacent_col<elevations.shape[1] and 0<=adjacent_row<elevations.shape[0]):
                        continue
                    relative = np.array(origin)+step*np.array([adjacent_col,adjacent_row])-west[::2]
                    offsets.append(abs(relative@normal));chainage.append(relative@axis)
        result.update(renderedMaxOffset=max(offsets,default=0),renderedStationRange=[min(chainage,default=0),max(chainage,default=0)])
    print(json.dumps(result,indent=2))
    assert grade<=.04 and clearance>=5 and cover>=.5
    assert result['fill']['maxMeters']<=2 and result['fill']['maxOffset']<30
    if reference:
        assert result['renderedMaxOffset']<=30, 'Rendered fill footprint exceeds the 30 m corridor'


if __name__=='__main__':
    import sys
    measure(Path(sys.argv[1]),Path(sys.argv[2]) if len(sys.argv)>2 else None)

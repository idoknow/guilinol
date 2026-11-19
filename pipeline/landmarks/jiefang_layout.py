"""OSM west interchange, in metres along and across the bridge axis."""
import json
from pathlib import Path

import numpy as np
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import unary_union

OSM = {int(key):np.array(points) for key,points in
       json.loads(Path(__file__).with_name('jiefang_osm.json').read_text()).items()}
RAMPS=(258909975,258909976,258909977,258909978)
UPPER_ROADS=(258909993,259020569)
LOWER_ROADS=(1531308427,1531308428)
SIDE_ROAD=(675174045,)
FOOTWAYS=(1382486207,1382486209,1382486210,1382486211,1382486212,1382487357)
UPPER=6.26
LOWER=.96


def section(way):
    """OSM stations, right-hand miter, chainage and deck level in travel order."""
    xy=OSM[way]
    if way in RAMPS+UPPER_ROADS+LOWER_ROADS+SIDE_ROAD:
        xy=np.asarray(LineString(xy).segmentize(6).coords)
    delta=np.diff(xy,axis=0)
    lengths=np.linalg.norm(delta,axis=1)
    tangents=delta/lengths[:,None]
    normals=tangents[:,::-1]*[-1,1]
    mid=normals[:-1]+normals[1:]
    mid/=np.sum(mid*normals[:-1],axis=1)[:,None]
    edges=np.vstack([normals[0],mid,normals[-1]])
    along=np.r_[0,np.cumsum(lengths)]
    # Short level landings merge into the receiving carriageways.
    top_first=way in (RAMPS[0],RAMPS[3])
    lead=19 if top_first else 8
    tail=8 if top_first else 19
    t=np.clip((along-lead)/(along[-1]-lead-tail),0,1)
    if way in (RAMPS[0],RAMPS[3]): t=1-t
    y=LOWER+(UPPER-LOWER)*t if way in RAMPS else np.full(len(xy),UPPER if way in UPPER_ROADS else LOWER)
    if way in SIDE_ROAD:
        y=libin_levels(xy)
    return xy,edges,along,y


def libin_levels(points):
    # Libin meets the outer ramp tangentially. Match its slope throughout the
    # shared mouth, then blend up to the native street beyond the junction.
    xy,_,station,height=section(258909978)
    road=LineString(xy)
    levels=[]
    for coords in points:
        p=Point(coords)
        ramp_height=np.interp(road.project(p),station,height)
        blend=np.clip((road.distance(p)-11)/21,0,1)
        levels.append((1-blend)*ramp_height+blend*7.7)
    return np.asarray(levels)


def widths(way):
    if way in RAMPS:
        opposite=LineString(OSM[RAMPS[RAMPS.index(way)^1]])
        inside=np.array([min(4,opposite.distance(Point(p))/2-.08) for p in section(way)[0]])
        return -inside,8-inside,2.5
    if way in UPPER_ROADS:
        blend=np.clip((section(way)[0][:,0]+265)/23,0,1)
        native=4.7 if way==UPPER_ROADS[0] else 4.9
        return -native-(6-native)*blend,native+(9.85-native)*blend,3.
    if way in SIDE_ROAD:return -3.,3.,0.
    # Binjiang's OSM way runs north: its river-side pavement is on the right.
    if way in LOWER_ROADS:return -3.6,3.6,3.6
    return -1.35,1.35,0.

# River span carriageways and cycleways connect to the modeled west approaches.
SPAN_WAYS = {49322149, 258899702, 1531308751, 1531308752}

def deck_level(local_x):
    return 5.62 - local_x * 1.3 / 281


def world_road_sections(anchor, angle):
    """Modeled road stations and carriageway edges in world coordinates."""
    transform = np.array([[np.cos(angle), np.sin(angle)], [-np.sin(angle), np.cos(angle)]])
    for way in RAMPS + UPPER_ROADS + LOWER_ROADS + SIDE_ROAD:
        xy, normals, station, levels = section(way)
        left, right, _ = widths(way)
        edge = lambda offset: (xy + normals * np.broadcast_to(offset, len(xy))[:, None]) @ transform + anchor
        yield way, LineString(xy @ transform + anchor), station, levels, edge(left), edge(right)


def bank_paving(anchor,angle):
    transform=np.array([[np.cos(angle),np.sin(angle)],[-np.sin(angle),np.cos(angle)]])
    paths=[]
    for way in RAMPS+UPPER_ROADS+LOWER_ROADS+SIDE_ROAD+FOOTWAYS:
        xy,n,_,_=section(way)
        l,r,w=widths(way)
        edge=lambda offset:xy+n*np.broadcast_to(offset,len(xy))[:,None]
        paths.append(Polygon(np.vstack([edge(l),edge(r+w)[::-1]])@transform+anchor).buffer(0))
    return unary_union(paths)


def grade_banks(terrain,original,wet,left,top,step,anchor,angle,datum):
    bx,bz=anchor
    rows=slice(max(0,int((bz-330-top)//step)),min(terrain.shape[0],int((bz+330-top)//step)+1))
    cols=slice(max(0,int((bx-330-left)//step)),min(terrain.shape[1],int((bx+330-left)//step)+1))
    yy,xx=np.ogrid[rows,cols]
    east=left+xx*step-bx
    south=top+yy*step-bz
    x=east*np.cos(angle)+south*np.sin(angle)
    z=-east*np.sin(angle)+south*np.cos(angle)
    limit=np.full(x.shape,np.inf)
    approach_fill=np.full(x.shape,-np.inf)
    shore=(x>-114)&(x<-56)&(abs(z)<76)
    limit[shore]=(datum+LOWER-.17-np.maximum(0,x+90)*.10+np.maximum(0,abs(z)-68)*.3)[shore]
    for way in RAMPS+UPPER_ROADS+LOWER_ROADS+SIDE_ROAD+FOOTWAYS:
        xy,_,_,y=section(way)
        l,r,w=widths(way)
        radius=max(np.max(-l),np.max(r)+w)
        for a,b,h0,h1 in zip(xy,xy[1:],y,y[1:]):
            dx,dz=b-a
            t=np.clip(((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz),0,1)
            dist=np.hypot(x-a[0]-t*dx,z-a[1]-t*dz)
            level=datum+h0+t*(h1-h0)-.20+np.maximum(0,dist-radius-2)*.40
            limit=np.where(dist<radius+18,np.minimum(limit,level),limit)
            if way in UPPER_ROADS:
                # The western approach sits on an embankment until the bridge portal.
                fill=datum+h0+t*(h1-h0)-.07-np.maximum(0,dist-radius)*.6
                approach_fill=np.where((x<-139)&(dist<radius+9),np.maximum(approach_fill,fill),approach_fill)
    mask=np.isfinite(limit)&~wet[rows,cols]
    for field in (terrain,original):
        patch=field[rows,cols]
        patch[mask]=np.minimum(patch[mask],np.rint(10*limit[mask]))
        fill_mask=np.isfinite(approach_fill)&mask
        patch[fill_mask]=np.maximum(patch[fill_mask],np.rint(10*approach_fill[fill_mask]))
    # Blend the ends of the modeled road into the heightfield outside the site.
    for way in UPPER_ROADS+LOWER_ROADS+SIDE_ROAD:
        xy,_,_,levels=section(way)
        for end,neighbor in ((0,1),(-1,-2)):
            p=xy[end]
            if abs(p[0]+265)>.01 and abs(abs(p[1])-120)>.01:continue
            direction=p-xy[neighbor];direction/=np.linalg.norm(direction)
            dx,dz=x-p[0],z-p[1]
            station=dx*direction[0]+dz*direction[1]
            side=abs(dx*direction[1]-dz*direction[0])
            mix=np.clip((30-station)/22,0,1)*np.clip((19-side)/6,0,1)
            mask=(station>=-3)&(mix>0)&~wet[rows,cols]
            level=datum+levels[end]-.04
            for field in (original,terrain):
                patch=field[rows,cols]
                patch[mask]=np.rint(mix[mask]*10*level+(1-mix[mask])*patch[mask])

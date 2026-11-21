"""OSM west interchange, in metres along and across the bridge axis."""
import json
from pathlib import Path

import numpy as np
from shapely.geometry import LineString, Point, Polygon, box
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
NATIVE_APPROACH=120
BANK_LIMIT=140


def dash_intervals(first, last, period=7., painted=2.8):
    for start in np.arange(np.floor(first/period)*period,last,period):
        left, right = max(first,start), min(last,start+painted)
        if right-left>1e-6:
            yield left,right


def site_limit(way):
    return BANK_LIMIT if way in LOWER_ROADS else NATIVE_APPROACH


def promenade_offset(z):
    # Offset of the tactile strip from Binjiang's axis. The four gate groups
    # sit on the wider riverside pavement, which tapers at both native seams.
    return np.interp(z, [-BANK_LIMIT,-133,-108,-75,-53,-41,36,49,72,104,129,BANK_LIMIT],
                     [5.4,10.4,10.1,9.05,8.75,5.4,5.4,7.46,8.14,7.9,7.5,5.4])


def section(way, native_grade=False):
    """OSM stations, right-hand miter, chainage and deck level in travel order."""
    xy=OSM[way]
    if native_grade and way in LOWER_ROADS:
        # Keep the existing Binjiang approach controls in the citywide fit.
        # The widened pavement and its new end joints are graded locally.
        xy=np.asarray(LineString(xy).intersection(box(-265,-NATIVE_APPROACH,-65,NATIVE_APPROACH)).coords).round(3)
    if way in RAMPS+UPPER_ROADS+LOWER_ROADS+SIDE_ROAD:
        xy=np.asarray(LineString(xy).segmentize(6).coords)
    delta=np.diff(xy,axis=0)
    lengths=np.linalg.norm(delta,axis=1)
    tangents=delta/lengths[:,None]
    normals=tangents[:,::-1]*[-1,1]
    mid=normals[:-1]+normals[1:]
    mid/=np.sum(mid*normals[:-1],axis=1)[:,None]
    edges=np.vstack([normals[0],mid,normals[-1]])
    if way in LOWER_ROADS and not native_grade:
        # Both ways must use the same miter at the shared OSM node,
        # including the outer edge of the widened pavement.
        south,north=(OSM[w] for w in LOWER_ROADS)
        legs=np.array([south[-1]-south[-2],north[1]-north[0]])
        legs/=np.linalg.norm(legs,axis=1)[:,None]
        joint=legs[:,::-1]*[-1,1]
        edges[-1 if way==LOWER_ROADS[0] else 0]=joint.sum(axis=0)/(1+joint[0]@joint[1])
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
        axis, normals, _, _ = section(way)
        inside=np.array([min(4,opposite.distance(Point(p))/2-.08) for p in axis])
        outside = 8-inside
        sidewalk = 2.5
        if way == 258909976:
            promenade = LineString(OSM[1008909370])
            curb = axis + normals*outside[:,None]
            clearance = np.array([promenade.distance(Point(point)) for point in curb])
            sidewalk = np.clip(clearance-1., 0., sidewalk)
        return -inside,outside,sidewalk
    if way in UPPER_ROADS:
        blend=np.clip((section(way)[0][:,0]+265)/23,0,1)
        native=4.7 if way==UPPER_ROADS[0] else 4.9
        return -native-(6-native)*blend,native+(9.85-native)*blend,3.
    if way in SIDE_ROAD:return -3.,3.,0.
    # Binjiang's OSM way runs north: its river-side pavement is on the right.
    if way in LOWER_ROADS:
        z=section(way)[0][:,1]
        offset=promenade_offset(z)
        rail_margin=1.8+.55*np.clip((offset-5.4)/2,0,1)
        return -3.6,3.6,offset+rail_margin-3.6
    return -1.35,1.35,0.

# River span carriageways and cycleways connect to the modeled west approaches.
SPAN_WAYS = {49322149, 258899702, 1531308751, 1531308752}

def deck_level(local_x):
    original = 5.62 - local_x * 1.3 / 281
    inner = 134.6286
    head = 151.2322 - 145.6
    distance = np.maximum(0., inner-local_x)
    approach = head + .05*np.where(distance<2, distance**2/4, distance-1)
    start, end = 16., 111.
    length = end-start
    fraction = np.clip((local_x-start)/length, 0, 1)
    left = 5.62-start*1.3/281
    right = head+.05*(inner-end-1)
    curve = (left+(right-left)*(3-2*fraction)*fraction**2
             - length*fraction*(1-fraction)*((1-fraction)*1.3/281-fraction*.05))
    return np.where(local_x<start,original,np.where(local_x<end,curve,approach))


def world_road_sections(anchor, angle, native_grade=False):
    """Modeled road stations and carriageway edges in world coordinates."""
    transform = np.array([[np.cos(angle), np.sin(angle)], [-np.sin(angle), np.cos(angle)]])
    for way in RAMPS + UPPER_ROADS + LOWER_ROADS + SIDE_ROAD:
        xy, normals, station, levels = section(way,native_grade)
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


def bank_offset(x,z):
    axis=np.vstack((OSM[LOWER_ROADS[0]][:-1],OSM[LOWER_ROADS[1]]))[::-1]
    center=np.interp(z,axis[:,1],axis[:,0])
    for p,q,overrun in ((axis[0],axis[1],np.minimum(0,z+BANK_LIMIT)),
                        (axis[-1],axis[-2],np.maximum(0,z-BANK_LIMIT))):
        center+=overrun*(p[0]-q[0])/(p[1]-q[1])
    return x-center


def bank_blend(x,z,padding=0):
    """Blend the promenade grade back to native ground across and along the road."""
    d=bank_offset(x,z)
    across=np.clip((d+12+padding)/6,0,1)*np.clip((promenade_offset(z)+10+padding-d)/6,0,1)
    along=np.clip((BANK_LIMIT+34-abs(z))/26,0,1)
    return across*along**2*(3-2*along)


def grade_banks(terrain,original,wet,left,top,step,anchor,angle,datum,finish=False):
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
        xy,_,_,y=section(way,native_grade=True)
        l,r,w=widths(way)
        radius=7.2 if way in LOWER_ROADS else max(np.max(-l),np.max(r+w))
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
        xy,_,_,levels=section(way,native_grade=True)
        for end,neighbor in ((0,1),(-1,-2)):
            p=xy[end]
            if abs(p[0]+265)>.01 and abs(abs(p[1])-NATIVE_APPROACH)>.01:continue
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
    if finish:
        # Excavate only the modeled road and its riverside shoulder. The
        # native grade around adjacent building foundations remains in place.
        blend=bank_blend(x,z)*(~wet[rows,cols])
        bed=10*(datum+LOWER-.18)
        for field in (original,terrain):
            patch=field[rows,cols]
            patch[:]=np.rint(patch+blend*np.minimum(0,bed-patch))
            weight=lower_junction_weight(x,z)*(~wet[rows,cols])
            patch[:]=np.rint(patch+weight*(10*lower_subgrade(x,z,datum)-patch))


def lower_junction_weight(x,z):
    taper=np.clip((101-abs(z))/23,0,1)
    return bank_blend(x,z,14)*taper*taper*(3-2*taper)


def lower_subgrade(x,z,datum):
    return datum+LOWER-.07+.003*np.clip(bank_offset(x,z),0,18)


def grade_binjiang_streets(control,left,top,step,anchor,angle,datum):
    rows,cols=np.ogrid[:control.shape[0],:control.shape[1]]
    east=left+(cols-1)*step-anchor[0]
    south=top+(rows-1)*step-anchor[1]
    x=east*np.cos(angle)+south*np.sin(angle)
    z=-east*np.sin(angle)+south*np.cos(angle)
    weight=lower_junction_weight(x,z)
    control+=weight*np.minimum(0,lower_subgrade(x,z,datum)-control)

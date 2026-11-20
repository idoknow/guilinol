"""West-bank carriageways and pedestrian surfaces built from the OSM survey."""
import numpy as np
from shapely.geometry import LineString, Point
from jiefang_layout import BANK_LIMIT, OSM, RAMPS, UPPER_ROADS, LOWER_ROADS, SIDE_ROAD, FOOTWAYS, LOWER, UPPER, section, widths, libin_levels


def vertex(p,h):
    return np.array([p[0],h-(5.62-p[0]*1.3/281),p[1]])


def surface(model,left,right,material,collision=True):
    for a,b,c,d in zip(left,right,right[1:],left[1:]):
        model.mesh([a,b,c,d],[[0,1,2],[0,2,3]],material,collision)


def street(model,way):
    xy,n,along,y=section(way)
    l,r,w=widths(way)
    def edge(offset,up=0):
        points=xy+n*np.broadcast_to(offset,len(xy))[:,None]
        levels=libin_levels(points) if way in SIDE_ROAD else y
        return np.array([vertex(p,h) for p,h in zip(points,levels+up)])
    if way in FOOTWAYS+SIDE_ROAD:
        raise_by=.12 if way in FOOTWAYS else 0
        surface(model,edge(l,raise_by),edge(r,raise_by),'pave' if way in FOOTWAYS else 'tile')
        return
    # Extend the upper sidewalk across the bridge expansion joint.
    if way in UPPER_ROADS:
        xy=xy.copy()
        xy[np.argmax(xy[:,0]),0]=-139.9
    # Flush sidewalk ends avoid a kerb across any turning movement.
    curb=.12*np.clip(np.minimum(along,along[-1]-along)/5,0,1)
    if way in LOWER_ROADS:
        # The two OSM ways meet within the continuous sidewalk.
        curb=.12*np.clip((BANK_LIMIT-abs(xy[:,1]))/5,0,1)
    if way in UPPER_ROADS+LOWER_ROADS:
        upper=way in UPPER_ROADS
        axis=0 if upper else 1
        ends=[p[axis] for ramp in RAMPS for p in OSM[ramp][[0,-1]]
              if (abs(p[1])<20)==upper]
        gap=np.min(abs(xy[:,axis,None]-ends),axis=1)
        curb*=np.clip((gap-10)/4,0,1)
    if way in RAMPS:
        # The sidewalk meets the receiving sidewalk at the kerb, not in the
        # middle of the receiving road. Keep the last few metres as asphalt.
        down=way in (RAMPS[0],RAMPS[3])
        curb*=np.clip((along-(15 if down else 4))/3,0,1)
        curb*=np.clip((along[-1]-along-(4 if down else 15))/3,0,1)
        if way==258909978:
            branch=LineString(OSM[SIDE_ROAD[0]])
            distance=np.array([branch.distance(Point(p)) for p in xy+n*(r+w)[:,None]])
            curb*=np.clip((distance-4)/3,0,1)
    left,right=edge(l),edge(r)
    outer=edge(r+w,curb)
    surface(model,left,right,'tile')
    surface(model,right,edge(r,curb),'granite')
    sidewalk=edge(r,curb)
    for i in range(len(xy)-1):
        apron=max(curb[i:i+2])<.01
        surface(model,sidewalk[i:i+2],outer[i:i+2],'tile' if apron else 'pave')
    for top in (left,outer):
        surface(model,top,top-[0,2.5,0],'stone',False)
    for i,(a,b) in enumerate(zip(edge(0,.015),edge(0,.015)[1:])):
        length=along[i+1]-along[i]
        for start in np.arange(np.ceil((along[i]+.01)/7)*7,along[i+1]-1,7):
            u=(start-along[i])/length;v=min(1,u+2.8/length)
            pa=a+(b-a)*u;pb=a+(b-a)*v
            dx,dz=n[i]*.075
            stripe=np.array([dx,0,dz])
            surface(model,[pa-stripe,pb-stripe],[pa+stripe,pb+stripe],'white' if way not in LOWER_ROADS else 'yellow',False)
    if way in LOWER_ROADS:
        # Low stone parapet and white handrail, with openings at the stair
        # landings and at the plaza crossing shown in photos 37 and 43.
        for i,(a,b) in enumerate(zip(outer,outer[1:])):
            z=xy[i:i+2,1].mean()
            if min(abs(z-v) for v in (-94,-45,-27,27,42,45,91,100))<5:continue
            surface(model,[a,b],[a+[0,.50,0],b+[0,.50,0]],'stone',False)
            model.beam(a+[0,.86,0],b+[0,.86,0],.065,'white',6)
            model.box(a[0],a[1]+.49,a[2],.10,.4,.10,'white')
    if way in RAMPS:
        # Two lane arrows point along the original one-way OSM node order.
        i=len(xy)//2
        forward=xy[i+1]-xy[i];forward/=np.linalg.norm(forward)
        for offset in (-1.5,2):
            center=xy[i]+n[i]*offset
            pts=[center+forward*a+n[i]*b for a,b in ((2,0),(.1,-.65),(.1,-.18),(-2,-.18),(-2,.18),(.1,.18),(.1,.65))]
            elev=y[i]+.035
            slope=(y[i+1]-y[i])/np.linalg.norm(xy[i+1]-xy[i])
            model.mesh([vertex(p,elev+np.dot(p-center,forward)*slope) for p in pts],
                       [[0,1,6],[2,3,4],[2,4,5]],'white')
        for i,(a,b) in enumerate(zip(outer,outer[1:])):
            if min(curb[i:i+2])<.10:continue
            model.beam(a+[0,1,0],b+[0,1,0],.075,'white',6)
            for t in np.arange(0,1,3.5/max(1,along[i+1]-along[i])):
                p=a+(b-a)*t
                model.box(p[0],p[1],p[2],.12,1.0,.12,'granite')


def stairs(model,way):
    xy,n,along,_=section(way)
    # Start where the stair exits the bridge pavement; the first metres lie on deck.
    y=UPPER+.18-(UPPER+.18-LOWER-.12)*np.clip((along-4)/(along[-1]-4),0,1)
    for i,(a,b) in enumerate(zip(xy,xy[1:])):
        count=max(1,int(np.ceil(abs(y[i]-y[i+1])/.17)))
        for u,v in zip(np.arange(count)/count,np.arange(1,count+1)/count):
            start=a+(b-a)*u;end=a+(b-a)*v
            na=n[i]*(1-u)+n[i+1]*u;nb=n[i]*(1-v)+n[i+1]*v
            h=y[i]+(y[i+1]-y[i])*u
            left=[vertex(start-na*1.4,h),vertex(end-nb*1.4,h)]
            right=[vertex(start+na*1.4,h),vertex(end+nb*1.4,h)]
            surface(model,left,right,'pave')
            surface(model,[left[1],right[1]],[left[1]-[0,.19,0],right[1]-[0,.19,0]],'granite',False)
        for sign in (-1,1):
            p=vertex(a+n[i]*sign*1.4,y[i]);q=vertex(b+n[i+1]*sign*1.4,y[i+1])
            model.beam(p+[0,1,0],q+[0,1,0],.075,'white',6)
            model.box(p[0],p[1],p[2],.1,1,.1,'white')


def interchange(model):
    for way in RAMPS+UPPER_ROADS+LOWER_ROADS+SIDE_ROAD+FOOTWAYS:street(model,way)
    for way in (1382486206,1382486208):stairs(model,way)

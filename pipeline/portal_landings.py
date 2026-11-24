"""Blend the baked pavement cross-section into the floor at a graded mouth."""
import base64
import math

import numpy as np
from shapely import LineString, Point, STRtree, box
from shapely.ops import substring
from canal_passages import sample_road_heights
from features import points
from vehicle_tunnels import grade_limit

from surveyed_corridors import read_chunk, write_chunk


def bake(output, manifest, tunnels, elements):
    chunks=manifest['chunks']
    mouths=[]
    for tunnel in tunnels:
        if tunnel.get('way') not in (1494508178,1054231782,1103567408,385795252,882310591):continue
        for index,dx,dz,half in tunnel.get('openings',()):
            x,y,z=tunnel['portals'][index]
            # Tie the existing outside pavement across the entire lane, then
            # return to its longitudinal grade. Keep the space over the roof.
            mouths.append((x,z,y,dx,dz,half,tunnel['clearance']))
    index=STRtree([Point(x,z).buffer(14) for x,z,*_ in mouths])
    # These two approaches turn inside the measured 20 m station. Follow
    # their actual centreline past the bend and tie back into the existing road.
    approaches=[];samples=[]
    for way in elements:
        if way['id'] not in (882310595,1488501895) or way['type']!='way':continue
        coords=points(way)
        for k,(px,pz,y,dx,dz,half,_) in enumerate(mouths):
            for oriented in (coords,coords[::-1]):
                if math.dist(oriented[0],(px,pz))>.05:continue
                axis=substring(LineString(oriented),0,42)
                end=axis.interpolate(axis.length)
                samples.append(dict(x=end.x,z=end.y,way=way['id']))
                approaches.append((k,axis,half,y,grade_limit(way['tags']['highway'])))
    heights=sample_road_heights(output,manifest,samples) if samples else []
    ribbons=[(k,np.asarray(axis.coords),axis.length,half,base,target,cap) for (k,axis,half,base,cap),target
             in zip(approaches,heights,strict=True) if abs(target-base)<=cap*axis.length]
    for tile in chunks:
        ox,oz=tile['x'],tile['z']
        near=index.query(box(ox,oz,ox+256,oz+256),predicate='intersects')
        local=[r for r in ribbons if LineString(r[1]).distance(box(ox,oz,ox+256,oz+256))<r[3]+4]
        if not len(near) and not local:continue
        file=output/tile['file'];raw,start,size,c=read_chunk(file)
        survey=c[1][12] if len(c[1])>12 else None
        if not survey or not survey.get('packed'):continue
        changed=False
        def blend(data, scale, offset):
            nonlocal changed
            xyz=np.frombuffer(base64.b64decode(data),'<i4').reshape(-1,3)
            faces=xyz.astype(float).reshape(-1,3,3)
            ready=[]
            while len(faces):
                x,z=ox+faces[:,:,0]/scale,oz+faces[:,:,2]/scale
                refine=np.zeros(len(faces),dtype=bool)
                for k in near:
                    px,pz,*_=mouths[k]
                    refine |= ((x.min(axis=1)<px+20)&(x.max(axis=1)>px-20)&
                               (z.min(axis=1)<pz+20)&(z.max(axis=1)>pz-20))
                for _,coords,_,half,*_ in local:
                    pad=half+4
                    refine |= ((x.min(axis=1)<coords[:,0].max()+pad)&(x.max(axis=1)>coords[:,0].min()-pad)&
                               (z.min(axis=1)<coords[:,1].max()+pad)&(z.max(axis=1)>coords[:,1].min()-pad))
                refine &= (np.ptp(x,axis=1)>.75)|(np.ptp(z,axis=1)>.75)
                ready.append(faces[~refine])
                if not np.any(refine):break
                a,b,c=faces[refine].transpose(1,0,2);ab=(a+b)/2;bc=(b+c)/2;ca=(c+a)/2
                faces=np.concatenate([np.stack(parts,axis=1) for parts in
                                      [(a,ab,ca),(ab,b,bc),(ca,bc,c),(ab,bc,ca)]])
            xyz=np.rint(np.concatenate(ready).reshape(-1,3)).astype('<i4')
            x,z=ox+xyz[:,0]/scale,oz+xyz[:,2]/scale
            height=xyz[:,1]/scale-offset
            new=height.copy()
            for k in near:
                px,pz,y,dx,dz,half,clearance=mouths[k]
                along=(x-px)*dx+(z-pz)*dz
                side=np.abs((x-px)*dz-(z-pz)*dx)
                outside=np.maximum(0,np.maximum(-2-along,along-2))
                distance=np.hypot(outside,np.maximum(0,side-half))
                weight=np.clip(1-distance/12,0,1)
                weight=weight**2*(3-2*weight)
                mask=(height>=y-.9)&(height<y+clearance)&(weight>0)
                # A short level landing makes the bore and approach agree
                # across the wheel tracks, including an oblique entrance.
                target=height+(y-height)*weight
                new[mask]=target[mask]
            for _,coords,length,half,base,target,cap in local:
                nearest=np.full(len(x),np.inf);station=np.zeros(len(x));run=0
                for (ax,az),(bx,bz) in zip(coords,coords[1:]):
                    dx,dz=bx-ax,bz-az;span=math.hypot(dx,dz)
                    along=np.clip(((x-ax)*dx+(z-az)*dz)/span,0,span)
                    dist=np.hypot(x-ax-dx*along/span,z-az-dz*along/span)
                    closer=dist<nearest
                    station[closer]=run+along[closer];nearest=np.minimum(dist,nearest);run+=span
                t=station/length
                ease=max(0.,min(.12,1-abs(target-base)/(cap*length)))
                if ease:
                    t=np.where(t<ease,t*t/(2*ease),np.where(t>1-ease,
                               1-ease-(1-t)**2/(2*ease),t-ease/2))/(1-ease)
                grade=base+(target-base)*t
                fade=np.clip(np.minimum((length-station)/5,1-np.maximum(0,nearest-half)/3),0,1)
                fade=fade*fade*(3-2*fade)
                mask=(np.abs(height-grade)<4.5)&(fade>0)
                new[mask]+=(grade[mask]-new[mask])*fade[mask]
            ys=np.rint((new+offset)*scale).astype('<i4')
            if not np.any(ys!=xyz[:,1]):return data
            xyz=xyz.copy();xyz[:,1]=ys;changed=True
            return base64.b64encode(xyz.tobytes()).decode()
        for part in ('packed','sidewalk','skirt'):
            if survey.get(part):survey[part]=blend(survey[part],1000,0)
        if len(c)>7 and c[7] and c[7].get('packed'):
            c[7]['packed']=blend(c[7]['packed'],10000,-.051)
        if changed:
            write_chunk(file,raw,start,size,c)
            tile['bytes']=file.stat().st_size

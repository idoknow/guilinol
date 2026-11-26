"""Blend the baked pavement cross-section into the floor at a graded mouth."""
import base64
import math
import json
from pathlib import Path

import numpy as np
from shapely import LineString, Point, STRtree, box
from shapely.ops import substring
from canal_passages import sample_road_heights
from features import points
from vehicle_tunnels import grade_limit
from service_streets import width

from surveyed_corridors import read_chunk, write_chunk
from vehicle_roadbed import roadbed


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
    refit(output, chunks, mouths, ribbons, landing=True)


def carriageways(output, manifest, elements, widths):
    intervals = json.loads(Path(__file__).with_name('wheel-track-survey.json').read_text())
    spans, samples = [], []
    for way in elements:
        if way['type'] != 'way' or str(way['id']) not in intervals:
            continue
        line = LineString(points(way))
        half = widths.get(way['id'], width(way['tags'])) / 2
        limit = grade_limit(way['tags']['highway'])
        for start, end in intervals[str(way['id'])]:
            axis = substring(line, start, end)
            if axis.length < 10:
                continue
            for x,z in (axis.coords[0], axis.coords[-1]):
                samples.append(dict(x=x, z=z, way=way['id']))
            spans.append((way['id'], np.asarray(axis.coords), axis.length, half, limit))
    heights = iter(sample_road_heights(output, manifest, samples)) if samples else iter(())
    ribbons = []
    for way, coords, length, half, limit in spans:
        start, end = next(heights), next(heights)
        if abs(end-start) <= limit*length:
            ribbons.append((way, coords, length, half, start, end, limit))
    refit(output, manifest['chunks'], [], ribbons, landing=False)
    # The service-road deck spans lower pavement and terrain that protrude
    # through the middle of the span. Preserve all surfaces below the deck.
    for way in elements:
        if way['type'] != 'way' or way['id'] != 988474372:
            continue
        axis = LineString(points(way))
        samples = [dict(x=p.x, z=p.y, roofProbe=True) for p in
                   (axis.interpolate(.5), axis.interpolate(axis.length-.5))]
        decks = [hit[1] for hit in sample_road_heights(output, manifest, samples)]
        if all(y is not None for y in decks):
            strip = (way['id'], np.asarray(axis.coords), axis.length,
                     widths.get(way['id'], width(way['tags']))/2+.5,
                     decks[0]-.03, decks[1]-.03, grade_limit(way['tags']['highway']))
            refit(output, manifest['chunks'], [], [strip], landing=False, cut_only=True)


def refit(output, chunks, mouths, ribbons, *, landing, cut_only=False):
    index=STRtree([Point(x,z).buffer(14) for x,z,*_ in mouths])
    resolution = .75 if landing else 2.0
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
                refine &= (np.ptp(x,axis=1)>resolution)|(np.ptp(z,axis=1)>resolution)
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
                if landing:
                    end_weight=(length-station)/5
                    shoulder=3
                else:
                    end_weight=np.minimum(station,length-station)/4
                    shoulder=.5
                fade=np.clip(np.minimum(end_weight,1-np.maximum(0,nearest-half)/shoulder),0,1)
                fade=fade*fade*(3-2*fade)
                mask=(np.abs(height-grade)<4.5)&(fade>0)
                if cut_only:
                    mask &= new > grade
                new[mask]+=(grade[mask]-new[mask])*fade[mask]
            ys=np.rint((new+offset)*scale).astype('<i4')
            if not np.any(ys!=xyz[:,1]):return data
            xyz=xyz.copy();xyz[:,1]=ys;changed=True
            return base64.b64encode(xyz.tobytes()).decode()
        for part in ('packed','sidewalk','skirt'):
            if survey.get(part):survey[part]=blend(survey[part],1000,0)
        bed=roadbed(c)
        if bed and bed.get('packed'):
            bed['packed']=blend(bed['packed'],10000,-.051)
        if changed:
            write_chunk(file,raw,start,size,c)
            tile['bytes']=file.stat().st_size


def ground_ties(output, manifest, elements):
    """Continue the roadbed through the village path junction and bridge approach."""
    # Surveyed contacts on the final visible road and terrain meshes.
    ties = [(1013429170, (4923.94, 6477.96)), (923425799, (4923.94, 6477.96)),
            (1084347077, (-2336.10, 9100.28)), (1461975711, (-17030.62, 7577.76))]
    ids = {wid for wid, _ in ties} | {1461975712}
    ways = {w['id']: w for w in elements if w['type'] == 'way' and w['id'] in ids}
    x, z, w, h = manifest['extent']
    bounds = box(x, z, x + w, z + h)
    ribbons = []
    for wid, contact in ties:
        if wid not in ways or not bounds.covers(Point(contact)):
            continue
        way = ways[wid]
        coords = points(way)
        bridge = wid == 1461975711
        if bridge:
            other = ways.get(1461975712)
            if not other or way['nodes'][-1] != other['nodes'][0]:
                raise ValueError('Resurvey the village bridge approach')
            coords = coords + points(other)[1:]
        axis = LineString(coords)
        station = axis.project(Point(contact))
        start, end = max(0, station - 14), min(axis.length, station + 14)
        if wid == 1013429170:
            start, end = 0, min(axis.length, 16)
        section = substring(axis, start, end)
        coords = np.array(section.coords)
        if bridge:
            px, pz = axis.interpolate(station + 2).coords[0]
            _, deck = sample_road_heights(output, manifest, [dict(x=px, z=pz, roofProbe=True)])[0]
            if deck is None:
                raise ValueError('Missing deck at the village bridge approach')
            levels = [deck, deck]
        else:
            levels = sample_road_heights(output, manifest,
                        [dict(x=px, z=pz, way=wid) for px, pz in (coords[0], coords[-1])])
        half = width(way['tags']) / 2 + .5
        ribbons.append((wid, coords, section.length, half, *levels, .08))
    if ribbons:
        refit(output, manifest['chunks'], [], ribbons, landing=False)

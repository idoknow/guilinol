"""Collect 20 m traversals on the mapped access network at each generated portal."""
import math
from collections import defaultdict
from common import ll2xz
from vehicle_tunnels import underground

PEDESTRIAN = {'footway','pedestrian','path','steps'}
RESTRICTED = {'no','private','customers','delivery','agricultural','forestry'}


def permits(tags,mode):
    highway=tags.get('highway')
    defaults={
        'foot':highway not in ('motorway','motorway_link','trunk','trunk_link','cycleway'),
        'bicycle':highway not in PEDESTRIAN|{'motorway','motorway_link','trunk','trunk_link'},
        'bike':highway not in PEDESTRIAN|{'motorway','motorway_link','trunk','trunk_link'},
        'car':highway not in PEDESTRIAN|{'cycleway','bridleway','corridor','construction','proposed'}}
    keys={'foot':['foot'],'bicycle':['bicycle','vehicle'],'bike':['electric_bicycle','bicycle','vehicle'],
          'car':['motorcar','motor_vehicle','vehicle']}[mode]+['access']
    for field in keys:
        if field in tags:
            if tags[field] in RESTRICTED or tags[field]=='dismount':
                return False
            if tags[field] in ('yes','designated','permissive','official'):
                return defaults[mode] if field=='access' else True
    return defaults[mode]


def routes(elements,network,nodes):
    mouths=set(network['portals'])
    centers=[(nodes[n]['x'],nodes[n]['z']) for n in mouths]
    bins=defaultdict(list)
    for x,z in centers:
        for i in range(math.floor((x-64)/256),math.floor((x+64)/256)+1):
            for j in range(math.floor((z-64)/256),math.floor((z+64)/256)+1):
                bins[i,j].append((x,z))
    graph=defaultdict(list)
    coords={}
    for w in elements:
        tags=w.get('tags',{})
        if w['type']!='way' or not tags.get('highway') or not w.get('geometry') or not all(w['geometry']):
            continue
        modes=tuple(m for m in ('car','foot','bicycle','bike') if permits(tags,m))
        points=[ll2xz(p['lat'],p['lon']) for p in w['geometry']]
        for a,b,p,q in zip(w['nodes'],w['nodes'][1:],points,points[1:]):
            if not any((int(x//256),int(z//256)) in bins for x,z in (p,q)):
                continue
            length=math.dist(p,q)
            if length<.01:continue
            coords[a],coords[b]=p,q
            oneway=tags.get('oneway','yes' if tags.get('junction')=='roundabout' else 'no')
            for i,j,reverse in ((a,b,False),(b,a,True)):
                allowed=tuple(m for m in modes if m=='foot' or
                    (tags.get('oneway:bicycle',oneway) if m in ('bike','bicycle') else oneway)
                    not in (('yes','1','true') if reverse else ('-1',)))
                graph[i].append((j,length,underground(tags),w['id'],allowed,modes))

    def trace(root,inside,mode,travel_out,way=None,direction=None):
        def walk(n,path,remaining,heading):
            p=coords[n]
            choices=[]
            for j,length,sub,w,forward,modes in graph[n]:
                if j in path or (len(path)==1 and (sub!=inside or (way and w!=way))):
                    continue
                permitted=forward if travel_out else next(e[4] for e in graph[j] if e[0]==n and e[3]==w)
                if mode not in permitted:continue
                q=coords[j]
                unit=((q[0]-p[0])/length,(q[1]-p[1])/length)
                alignment=sum(x*y for x,y in zip(heading,unit)) if heading else 0
                choices.append((alignment,sub==inside,j,length,w,unit))
            for _,__,j,length,w,unit in sorted(choices,reverse=True):
                if length>=remaining:
                    return [(p[0]+remaining*unit[0],p[1]+remaining*unit[1],w)]
                rest=walk(j,path|{j},remaining-length,unit)
                if rest:return [(*coords[j],w),*rest]
            return None
        return walk(root,{root},20.,direction) if root in coords else None

    result=[]
    for n in sorted(mouths):
        way=next(e['way'] for e in network['edges'] if n in (e['a'],e['b']))
        entry={'id':n,'way':way,'modes':[]}
        for mode in ('car','foot','bicycle','bike'):
            for inbound in (True,False):
                inside=trace(n,True,mode,inbound,way)
                if not inside:continue
                p=coords[n];dx=p[0]-inside[0][0];dz=p[1]-inside[0][1];length=math.hypot(dx,dz)
                outside=trace(n,False,mode,not inbound,direction=(dx/length,dz/length))
                if not outside:continue
                route=[*reversed(outside),(*p,way),*inside]
                if not inbound:route.reverse()
                entry['modes'].append(dict(mode=mode,route=route))
                break
            if mode=='car':
                if entry['modes']:
                    break
                # An access boundary is still approachable from the legal
                # side. Record this separately from a through traversal.
                for inside in (True,False):
                    side=trace(n,inside,'car',False,way if inside else None)
                    if side:
                        entry['modes'].append(dict(mode='car',boundary=True,
                            route=[*reversed(side),(*coords[n],way)]))
                        break
        if not any(not m.get('boundary') for m in entry['modes']):
            entry['links']=[dict(way=w,underground=sub,permitted=modes) for _,_,sub,w,_,modes in graph[n]]
        result.append(entry)
    return result

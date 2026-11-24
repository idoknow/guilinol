"""Continue paired Shanghai Road bores through their open approach cuttings."""
from collections import defaultdict

import numpy as np
from shapely import MultiPoint

from features import points
from road_profile import RULES
from railway_road_profiles import grade_cap


def build_open_approaches(ways, tunnels, side_bores, surface_at):
    ends = defaultdict(list)
    for t in tunnels:
        for end, node in enumerate(t.get('nodes', ())):
            ends[node].append((t, end))
    connections = defaultdict(set)
    for wid, way in ways.items():
        tags = way.get('tags', {})
        if tags.get('highway', '').removesuffix('_link') in (
                'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'service', 'unclassified'):
            for node in way.get('nodes', ()):
                connections[node].add(wid)
    tips = [(node, t, end) for node, sections in ends.items()
            for t, end in sections if t['way'] in side_bores and t['mouths'][end]]
    joints = set()
    for tip, bore, end in tips:
        outgoing = connections[tip] - {bore['way']}
        if len(outgoing) != 1:
            raise ValueError(f'Ambiguous station tunnel continuation at {tip}')
        wid, = outgoing
        way = ways[wid]
        ns, xy = way['nodes'], np.array(points(way))
        reverse = ns[-1] == tip
        if reverse:
            ns, xy = ns[::-1], xy[::-1]
        if ns[0] != tip or way['tags'].get('tunnel', 'no') != 'no':
            raise ValueError(f'Expected an open approach on {wid} at {tip}')
        chain = np.r_[0., np.cumsum(np.linalg.norm(np.diff(xy, axis=0), axis=1))]
        start = bore['portals'][end][1]
        cap = grade_cap(way['tags'])
        tags = way['tags']
        lanes = tags.get('lanes', '')
        count = int(lanes) if lanes.isdecimal() else (1 if tags.get('oneway')=='yes' else 2)
        width = min(bore['halfWidth'], (count*RULES['laneWidth']+1.)/2)
        for i in range(1, len(ns)):
            length = chain[i]
            target = ends.get(ns[i], [])
            finish = target[0][0]['portals'][target[0][1]][1] if target else surface_at(*xy[i])
            ease = min(3., length/8)
            slope = (finish-start)/(length-ease)
            if abs(slope) <= cap and (target or len(connections[ns[i]]) > 1 or i == len(ns)-1):
                break
            if target or len(connections[ns[i]]) > 1 or i == len(ns)-1:
                raise ValueError(f'Open approach {wid} cannot reach {ns[i]} within {cap:.1%}')
        def height(s):
            # Integrate a linear grade transition at both endpoints.
            run = np.where(s < ease, s*s/(2*ease), s-ease/2)
            run = np.where(s > length-ease, length-ease-(length-s)**2/(2*ease), run)
            return start + slope*run
        bore['mouths'][end] = False
        for other, idx in target:
            other['mouths'][idx] = False
        for j in range(i):
            a,b = chain[j:j+2]
            at = np.unique(np.r_[a, np.arange(a+2,b,2), b])
            p,q = xy[j:j+2]
            pair = [ns[j],ns[j+1]]
            mouths = [False, j+1 == i and not target]
            h = height(at)
            if reverse:
                p,q = q,p
                pair.reverse()
                mouths.reverse()
                stations = np.column_stack((b-at[::-1],h[::-1]))
            else:
                stations = np.column_stack((at-a,h))
            t = dict(way=wid,nodes=pair,portals=[[p[0],stations[0,1],p[1]],
                     [q[0],stations[-1,1],q[1]]],length=b-a,stations=stations.tolist(),
                     halfWidth=width,clearance=bore['clearance'],approach=0.,
                     mouths=mouths,openEnds=[b-a,0.],openCut=True)
            tunnels.append(t)
            for idx,node in enumerate(pair):
                ends[node].append((t,idx))
                joints.add(node)
    for node in joints:
        sections = ends[node]
        if len(sections) < 2:
            continue
        edges = []
        for t,idx in sections:
            xy = np.array(t['portals'])[:,[0,2]]
            dx,dz = (xy[1]-xy[0])/t['length']
            side = np.array([-dz,dx])*t['halfWidth']
            edges.extend([xy[idx]-side,xy[idx]+side])
        hull = MultiPoint(edges).convex_hull
        if hull.area > .001:
            for k,(t,idx) in enumerate(sections):
                t.setdefault('joints',[None,None])[idx] = dict(ring=list(hull.exterior.coords)[:-1],draw=k==0)

"""Continue covered road profiles through their open approach cuttings."""
from collections import defaultdict

import numpy as np
from shapely import MultiPoint

from features import points
from road_profile import RULES
from railway_road_profiles import grade_cap


def road_connections(ways):
    connections = defaultdict(set)
    for wid, way in ways.items():
        tags = way.get('tags', {})
        if tags.get('highway', '').removesuffix('_link') in (
                'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'service', 'unclassified', 'cycleway'):
            for node in way.get('nodes', ()):
                connections[node].add(wid)
    return connections


def continuation(ways,connections,tip,bore_way):
    outgoing = connections[tip] - {bore_way}
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
    return wid,way,ns,xy,chain,reverse


def build_open_approaches(ways, tunnels, side_bores, surface_at):
    ends = defaultdict(list)
    for t in tunnels:
        for end, node in enumerate(t.get('nodes', ())):
            ends[node].append((t, end))
    connections = road_connections(ways)
    tips = [(node, t, end) for node, sections in ends.items()
            for t, end in sections if t['way'] in side_bores and t['mouths'][end]]
    joints = set()
    for tip, bore, end in tips:
        wid,way,ns,xy,chain,reverse = continuation(ways,connections,tip,bore['way'])
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
    stitch(ends,joints)


def stitch(ends,joints):
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

def extend_to_junctions(ways,tunnels,bore_ids,surface_at,bridge_levels=None):
    """Propagate the cut through surface junctions until every arm reaches grade."""
    import heapq
    from functools import lru_cache
    if not bore_ids:
        return
    tips = {n:y for t in tunnels if t['way'] in bore_ids for n,(_,y,_),mouth in
            zip(t['nodes'],t['portals'],t['mouths']) if mouth}
    adjacency = road_connections(ways)
    sections = defaultdict(list)
    for t in tunnels:
        for end,node in enumerate(t.get('nodes',())):
            sections[node].append((t,end))
    fixed = dict(bridge_levels or {})
    for node,ends in sections.items():
        for tunnel,end in ends:
            if tunnel['way'] not in bore_ids:
                fixed[node] = tunnel['portals'][end][1]
    coords = {}
    @lru_cache(None)
    def geometry(wid):
        xy = np.array(points(ways[wid]))
        coords.update(zip(ways[wid]['nodes'],xy))
        return xy
    @lru_cache(None)
    def original(node):
        return fixed[node] if node in fixed else surface_at(*coords[node])
    queue = [(y,n) for n,y in tips.items()]
    heapq.heapify(queue)
    levels,edges = {},set()
    while queue:
        upper,node = heapq.heappop(queue)
        if node in levels:
            continue
        if node in tips and upper<tips[node]-.005:
            raise ValueError(f'Approach envelope would depress the fixed bore at {node}')
        y = tips[node] if node in tips else min(upper,original(node))
        levels[node] = y
        if node in fixed and upper<fixed[node]-.005:
            raise ValueError(f'Junction {node} requires {fixed[node]:.3f} m; approach can reach {upper:.3f} m')
        if node not in tips and original(node)-y<.005:
            continue
        for wid in adjacency[node]-bore_ids:
            road = ways[wid]
            if any(road['tags'].get(k,'no')!='no' for k in ('bridge','tunnel')):
                raise ValueError(f'Graded junction {node} reaches structure {wid} at {y:.3f} m')
            xy = geometry(wid)
            ns = road['nodes']
            for j,n in enumerate(ns):
                if n!=node:
                    continue
                for k in (j-1,j):
                    if not 0<=k<len(ns)-1:
                        continue
                    length = np.linalg.norm(xy[k+1]-xy[k])
                    if length<.01:
                        continue
                    # Reserve space for a short parabolic transition at the
                    # junction. A fixed 3 m landing at every OSM vertex can
                    # consume the usable rise on a short bridge approach.
                    gain = .995*grade_cap(road['tags'])*(length-min(.75,length/8))
                    edges.add((wid,k))
                    other = ns[k] if j!=k else ns[k+1]
                    heapq.heappush(queue,(y+gain,other))
    # Check descending as well as ascending approaches before emitting cuts.
    graph = defaultdict(list)
    for wid,k in edges:
        xy = geometry(wid)
        a,b = ways[wid]['nodes'][k:k+2]
        length = np.linalg.norm(xy[k+1]-xy[k])
        gain = grade_cap(ways[wid]['tags'])*(length-min(.75,length/8))
        graph[a].append((b,gain));graph[b].append((a,gain))
    for n,arms in graph.items():
        for v,allowed in arms:
            if abs(levels[n]-levels[v])>allowed+.005:
                raise ValueError(f'Approach {n} to {v} requires {abs(levels[n]-levels[v]):.2f} m over a {allowed:.2f} m envelope')
    for wid,k in sorted(edges):
        way = ways[wid]
        a,b = way['nodes'][k:k+2]
        p,q = geometry(wid)[k:k+2]
        length = np.linalg.norm(q-p)
        ease = min(.75,length/8)
        along = np.unique(np.r_[0.,ease,np.arange(2.,length,2.),length-ease,length])
        run = np.where(along<ease,along**2/(2*ease),along-ease/2)
        run = np.where(along>length-ease,length-ease-(length-along)**2/(2*ease),run)
        ys = levels[a]+(levels[b]-levels[a])*run/(length-ease)
        tags = way['tags']
        count = tags.get('lanes','')
        lanes = int(count) if count.isdecimal() else 1 if tags.get('oneway')=='yes' else 2
        half = 1.5 if tags['highway']=='cycleway' else (lanes*RULES['laneWidth']+1.)/2
        from station_levels import STYLE
        t = dict(way=wid,nodes=[a,b],length=length,halfWidth=half,clearance=STYLE['roadClearance'],
                 approach=0.,mouths=[False,False],openCut=True,openEnds=[length,0.],
                 portals=[[p[0],ys[0],p[1]],[q[0],ys[-1],q[1]]],
                 stations=np.column_stack((along,ys)).tolist())
        tunnels.append(t)
        sections[a].append((t,0));sections[b].append((t,1))
    for n in graph:
        for t,end in sections[n]:
            t['mouths'][end] = len(sections[n])==1
    stitch(sections,graph)

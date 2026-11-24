"""Build the negative-layer lane network from the same OSM ways used by traffic."""
import base64
import struct
from collections import defaultdict
import math

from common import ll2xz
from service_streets import width
from shapely import STRtree
from shapely.geometry import LineString, MultiPoint, Point, Polygon
from heapq import heapify, heappop, heappush


def pack_stations(stations):
    """Interior station offsets are fixed by the easing samples at 0, .06, .94."""
    levels = [round(y * 100000) for _, y in stations]
    return base64.b64encode(struct.pack(f'<{len(levels)}i', *levels)).decode('ascii')


def underground(tags):
    try:
        below = float(tags.get('layer', 0)) < 0
    except ValueError:
        below = False
    return tags.get('tunnel', 'no') != 'no' or below


def sections(lanes, source_ways, existing, nodes):
    saved = {t['way'] for t in existing}
    edges, surface_nodes = {}, set()
    for lane in lanes:
        a, b = lane['from'], lane['to']
        if lane.get('structure') != 'tunnel' or lane['way'] in saved:
            surface_nodes.update((a, b))
            continue
        a, b = sorted((a, b))
        key = lane['way'], a, b
        edge = edges.setdefault(key, dict(way=lane['way'], a=a, b=b, halfWidth=0,
                                          clearance=2.5, cls=lane['cls']))
        edge['halfWidth'] = max(edge['halfWidth'], abs(lane['offset'])+lane['width']/2+.5)
        if lane['kind'] != 'nonmotor':
            edge['clearance'] = 4.5
    # Follow connected private approach ramps to the actual surface junctions.
    # They provide boundary conditions without becoming traffic spawn lanes.
    ramps = defaultdict(list)
    for way in source_ways:
        tags = way.get('tags', {})
        if (way['type'] == 'way' and tags.get('highway') == 'service'
                and tags.get('access') == 'private' and underground(tags)):
            for ref in way['nodes']:
                ramps[ref].append(way)
    pending = [ref for edge in edges.values() for ref in (edge['a'], edge['b']) if ref in ramps]
    visited = set()
    while pending:
        for way in ramps.pop(pending.pop(), []):
            if way['id'] in visited:
                continue
            visited.add(way['id'])
            refs = way['nodes']
            if any(not point for point in way['geometry']):
                continue
            for ref, point in zip(refs, way['geometry'], strict=True):
                x, z = ll2xz(point['lat'], point['lon'])
                nodes.setdefault(ref, dict(id=ref, x=x, z=z))
                if ref in ramps:
                    pending.append(ref)
            for start, end in zip(refs, refs[1:]):
                a, b = sorted((start, end))
                if a != b and math.hypot(nodes[a]['x']-nodes[b]['x'], nodes[a]['z']-nodes[b]['z']) > .01:
                    edges[way['id'], a, b] = dict(way=way['id'], a=a, b=b,
                        halfWidth=width(way['tags'])/2+.5, clearance=4.5, cls='service')
    adjacent = defaultdict(set)
    for edge in edges.values():
        a,b = edge['a'],edge['b']
        adjacent[a].add(b)
        adjacent[b].add(a)
    # Private surface roads also identify mouths although they do not spawn traffic.
    for way in source_ways:
        tags=way.get('tags',{})
        if way['type']=='way' and tags.get('highway') and not underground(tags):
            surface_nodes.update(n for n in way['nodes'] if n in adjacent)
    portals = surface_nodes.intersection(adjacent)
    # The cut may extend into the bore until it reaches a fixed roof. Include
    # the full carriageway width when locating rails, buildings and upper roads.
    obstacles, refs, centerlines = [], [], []
    for way in source_ways:
        tags = way.get('tags', {})
        if way['type'] != 'way' or not any(tags.get(k) for k in ('railway', 'highway', 'building')):
            continue
        if underground(tags) or not way.get('geometry') or not all(way['geometry']):
            continue
        coords = [ll2xz(p['lat'], p['lon']) for p in way['geometry']]
        if len(coords) < 2:
            continue
        if tags.get('building') and str(tags.get('layer','')).lstrip('+').isdigit() and int(tags['layer'])>0:
            continue  # An elevated industrial structure has no ground-level roof here.
        if tags.get('building') and len(coords) >= 4 and coords[0] == coords[-1]:
            shape = Polygon(coords).buffer(0)
        else:
            radius = width(tags)/2 if tags.get('highway') else .75
            shape = LineString(coords).buffer(radius)
        obstacles.append(shape)
        centerlines.append(LineString(coords) if tags.get('highway') else None)
        refs.append(set(way.get('nodes', ())) if tags.get('highway') else set())
    index = STRtree(obstacles)
    # Carry the available open cutting through internal OSM vertices. A
    # polyline bend inside an approach is not a new underground roof.
    clear = {}
    links = defaultdict(list)
    for i, edge in enumerate(edges.values()):
        keys = (edge['a'], edge['b'])
        coords = [(nodes[k]['x'], nodes[k]['z']) for k in keys]
        axis = LineString(coords)
        free = [axis.length, axis.length]
        for hit in index.query(axis.buffer(edge['halfWidth']), predicate='intersects'):
            if portals.intersection(keys).intersection(refs[hit]):
                continue
            if centerlines[hit] is not None and not axis.intersects(centerlines[hit]):
                continue
            contact = axis.intersection(obstacles[hit].buffer(edge['halfWidth']))
            if not contact.is_empty:
                free = [min(extent, Point(pt).distance(contact)) for pt,extent in zip(coords,free)]
        clear[i] = free
        cap = grade_limit(edge['cls'])*.94
        for j,k in enumerate(keys):
            links[k].append((i,j,keys[1-j],axis.length,cap,edge))
    best = {k:0. for k in portals}
    queue = [(0.,k) for k in portals]
    heapify(queue)
    while queue:
        spent,k = heappop(queue)
        if spent != best[k]:
            continue
        for i,j,other,length,cap,edge in links[k]:
            available = (edge['clearance']+.05-spent)/cap
            if available <= 0:
                continue
            extent = min(available,clear[i][j])
            ends = edge.setdefault('openEnds',[0.,0.])
            ends[j] = extent
            if extent >= length-1e-6 and spent+length*cap < best.get(other,math.inf):
                best[other] = spent+length*cap
                heappush(queue,(best[other],other))
    for i,edge in enumerate(edges.values()):
        ends = edge.get('openEnds')
        if not ends:
            continue
        a,b=edge['a'],edge['b']
        length=math.hypot(nodes[a]['x']-nodes[b]['x'],nodes[a]['z']-nodes[b]['z'])
        if ends[0]+ends[1]>=length:
            # A through-cut can continue across bends. Keep the summit of a
            # short two-sided descent enclosed when the rising ramps meet.
            cost=length*grade_limit(edge['cls'])*.94
            if abs(best.get(a,math.inf)-best.get(b,math.inf)) < cost-1e-6:
                meet=max(0.,min(length,(length+(best[b]-best[a])*length/cost)/2))
                edge['openEnds']=[max(0.,meet-1),max(0.,length-meet-1)]
            elif best.get(a,math.inf)<=best.get(b,math.inf):
                edge['openEnds']=[min(length,ends[0]),0.]
            else:
                edge['openEnds']=[0.,min(length,ends[1])]
    # An underground dead end without a surface connection remains an end,
    # rather than an invented interchange with a road above it.
    return dict(edges=list(edges.values()), portals=sorted(surface_nodes.intersection(adjacent)),
                ends=sorted(n for n in adjacent if len(adjacent[n])==1))


def grade_limit(cls):
    return {'motorway':.04, 'trunk':.04, 'primary':.05, 'secondary':.06,
            'tertiary':.07}.get(cls, .08)


def solve(network, nodes, samples):
    """Interpolate across connected ways. Internal OSM vertices are not portals."""
    heights = {int(node): level for node, level in samples['heights'].items()}
    mouths = set(network['portals'])
    adjacency = defaultdict(list)
    limits = {}
    roofs = {}
    alignments = []
    for edge, roof in zip(network['edges'], samples['roofs'], strict=True):
        start, end = nodes[edge['a']], nodes[edge['b']]
        length = math.hypot(end['x']-start['x'], end['z']-start['z'])
        approach = edge.get('openEnds', [0., 0.])
        count = len(roof)-1
        # Distinct integer indices for interior samples; OSM IDs are positive.
        keys = [edge['a']] + [-1-len(alignments)-i*len(network['edges']) for i in range(count-1)] + [edge['b']]
        cap = grade_limit(edge['cls'])
        step = length/count
        for i, (key, ceiling) in enumerate(zip(keys,roof)):
            open_ramp = ((approach[0]>0 and i*step <= approach[0]+1e-8) or
                         (approach[1]>0 and length-i*step <= approach[1]+1e-8))
            bound = ceiling-edge['clearance']-.05 if not open_ramp else math.inf
            roofs[key] = min(roofs.get(key, math.inf), ceiling-edge['clearance']-.05)
            if key in mouths:
                bound = min(bound, heights[key])
            limits[key] = min(limits.get(key,math.inf),bound)
            if i:
                # Reserve slope for the short eased transitions at each knot.
                budget = step*cap*.94
                adjacency[key].append((keys[i-1],budget,step))
                adjacency[keys[i-1]].append((key,budget,step))
        alignments.append((edge,keys,length,approach,step,roof))

    constraints=[]
    seen=set()
    for key in adjacency:
        if key in seen:
            continue
        component=set()
        pending=[key]
        while pending:
            node=pending.pop()
            if node in component:
                continue
            component.add(node)
            pending.extend(neighbor for neighbor,_,_ in adjacency[node])
        seen.update(component)
        portal_levels=[heights[n] for n in component & mouths]
        if not portal_levels:
            constraints.append(dict(reason='missingPortalAnchor',
                                    ways=sorted({edge['way'] for edge,keys,*_ in alignments if keys[0] in component}),
                                    surfaceNodes=[]))
        elif len(portal_levels)==1:
            # Couple consecutive height knots at a blind end. Zero rise on
            # these links enforces the level landing during the roof/grade solve.
            for tip in component.intersection(network['ends'])-mouths:
                previous=None
                current=tip
                distance=0.
                while distance<4.48 and current not in mouths:
                    exits=[entry for entry in adjacency[current] if entry[0]!=previous]
                    if len(exits)!=1:
                        break
                    other,_,step=exits[0]
                    for node,target in ((current,other),(other,current)):
                        limits[node]=min(limits[node],roofs[node])
                        adjacency[node]=[(n,0. if n==target else budget,length)
                                         for n,budget,length in adjacency[node]]
                    previous,current=current,other
                    distance+=step
                if distance<4.48:
                    constraints.append(dict(reason='shortBlindLanding',node=tip,length=distance))
        # In a two-mouth bore inverse distance gives the linear endpoint
        # interpolation. At a junction use all connected mouths, weighted by
        # travel distance along this layer rather than distance through a hill.
        weight=defaultdict(float)
        weighted_level=defaultdict(float)
        for source in sorted(component & mouths):
            distances={source:0.}
            queue=[(0.,source)]
            while queue:
                distance,node=heappop(queue)
                if distance!=distances[node]:
                    continue
                if distance:
                    weight[node]+=1/distance
                    weighted_level[node]+=heights[source]/distance
                for neighbor,_,length in adjacency[node]:
                    d=distance+length
                    if d<distances.get(neighbor,math.inf):
                        distances[neighbor]=d
                        heappush(queue,(d,neighbor))
        for n in component-mouths:
            if weight[n]:
                limits[n]=min(limits[n],weighted_level[n]/weight[n])

    # A multi-source shortest-path envelope respects every roof and the grade
    # of every connecting edge. At a fixed mouth it gives the highest
    # achievable invert, even when two connected ways have different limits.
    queue = [(y,key) for key,y in limits.items() if math.isfinite(y)]
    heapify(queue)
    while queue:
        y,key = heappop(queue)
        if y != limits[key]:
            continue
        for neighbor, budget, _ in adjacency[key]:
            candidate = y+budget
            if candidate < limits[neighbor]:
                limits[neighbor] = candidate
                heappush(queue,(candidate,neighbor))

    generated, conflicts = [], constraints
    for edge,keys,length,approach,step,roof in alignments:
        a,b=keys[0],keys[-1]
        for key in (a,b):
            if key in mouths and heights[key]-limits[key]>.05:
                conflicts.append(dict(way=edge['way'],node=key,road=heights[key],
                                      floor=limits[key],approachCut=heights[key]-limits[key]))
        levels = [limits[key] for key in keys]
        stations = []
        for i in range(len(keys)-1):
            dy = levels[i+1]-levels[i]
            for t in (0.,.06,.94):
                blend = .06
                u = (t*t/(2*blend) if t<=blend else t-blend/2)/(1-blend)
                stations.append([round(step*(i+t),5),round(levels[i]+dy*u,5)])
        stations.append([length,levels[-1]])
        start,end = nodes[a],nodes[b]
        generated.append(dict(way=edge['way'],generated=True,length=length,
                              halfWidth=edge['halfWidth'],clearance=edge['clearance'],
                              portals=[[start['x'],levels[0],start['z']],
                                       [end['x'],levels[-1],end['z']]],
                              mouths=[a in mouths,b in mouths],approach=0,openEnds=approach,knotHeights=pack_stations(stations[::3])))
    # Fill the wedge between the two end sections on the outside of a bend.
    # All incident strips share the node elevation. Only one draws the patch.
    incident=defaultdict(list)
    for tunnel,(edge,*_) in zip(generated,alignments):
        p,q=tunnel['portals']
        dx=(q[0]-p[0])/tunnel['length']
        dz=(q[2]-p[2])/tunnel['length']
        w=tunnel['halfWidth']
        for i,(key,center) in enumerate(zip((edge['a'],edge['b']),(p,q))):
            points=[(center[0]-side*dz*w,center[2]+side*dx*w) for side in (-1,1)]
            incident[key].append((tunnel,i,points))
    for entries in incident.values():
        # Keep a full wheel footprint supported where two carriageway widths
        # meet. Taper the narrow bore towards the shared cross-section.
        junction_width=max(t['halfWidth'] for t,_,_ in entries)
        for t,i,points in entries:
            if junction_width>t['halfWidth']:
                t.setdefault('endWidths',[t['halfWidth'],t['halfWidth']])[i]=junction_width
                center=t['portals'][i]
                points[:]=[(center[0]+(x-center[0])*junction_width/t['halfWidth'],
                            center[2]+(z-center[2])*junction_width/t['halfWidth']) for x,z in points]
        # A wheel can pass the last cross-section while its axle is still
        # inside the circular end cap of the mapped carriageway. Include
        # that surface on curves, at the portal, and at underground dead ends.
        if len(entries)==1:
            tunnel,i,_=entries[0]
            x,_,z=tunnel['portals'][i]
            p,q = tunnel['portals'][i], tunnel['portals'][1-i]
            angle = math.atan2(p[2]-q[2],p[0]-q[0])
            hull=Polygon([(x+tunnel['halfWidth']*math.cos(angle+math.pi*j/12),
                           z+tunnel['halfWidth']*math.sin(angle+math.pi*j/12))
                          for j in range(-6,7)])

        else:
            boundary=[pt for _,_,points in entries for pt in points]
            center=entries[0][0]['portals'][entries[0][1]]
            rad=min(t['halfWidth'] for t,_,_ in entries)
            for j in range(32):
                ux,uz=math.cos(math.tau*j/32),math.sin(math.tau*j/32)
                if all(ux*(t['portals'][1-i][0]-center[0])+uz*(t['portals'][1-i][2]-center[2])<=0
                       for t,i,_ in entries):
                    boundary.append((center[0]+rad*ux,center[2]+rad*uz))
            hull=MultiPoint(boundary).convex_hull
        if hull.area<.001:
            continue
        ring=[[round(x,4),round(z,4)] for x,z in list(hull.exterior.coords)[:-1]]
        for owner,(tunnel,i,_) in enumerate(entries):
            x,_,z=tunnel['portals'][i]
            offsets=[value for u,v in ring for value in (round((u-x)*10000),round((v-z)*10000))]
            packed=base64.b64encode(struct.pack(f'<{len(offsets)}i',*offsets)).decode()
            tunnel.setdefault('joints',[None,None])[i]=dict(offsets=packed,draw=owner==0,cap=len(entries)==1)
    return generated,conflicts

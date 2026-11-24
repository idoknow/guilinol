"""Carry the railway headroom requirement along connected highway approaches."""
from collections import defaultdict
import json
from pathlib import Path

import numpy as np
from shapely import LineString, MultiPoint, Point, STRtree, distance, points as probe_points

from common import GRID, load_osm
from features import points
from railway_road_profiles import envelope, grade_cap
from road_grading import STEP, eval_bspline_grid
from station_levels import FOOTBRIDGE, UNDERPASS, STYLE


def fit_approach(original, low, high):
    """Parabolic tie-in on each side of the original profile, within both bounds."""
    width = .30
    y = np.maximum(original,low) + np.maximum(width-np.abs(original-low),0)**2/(4*width)
    y = np.minimum(y,high) - np.maximum(width-np.abs(y-high),0)**2/(4*width)
    return np.clip(y,low,high)


def smooth_raised_deck(stations, before, minimum, cap):
    """A grade-limited upper envelope with a rounded change of slope."""
    from scipy.ndimage import maximum_filter1d, uniform_filter1d

    # A fixed station spacing makes curvature independent of OSM way nodes.
    count = max(2,int(np.ceil(stations[-1]))+1)
    chain = np.linspace(0,stations[-1],count)
    step = chain[1]
    required = np.maximum(before,minimum)
    # Include sharp extrema between samples in the Lipschitz majorant.
    levels = np.interp(chain,stations,required)
    nearest = np.clip(np.rint(stations/step).astype(int),0,count-1)
    np.maximum.at(levels,nearest,required+cap*abs(stations-chain[nearest]))
    for i in range(1,count):
        levels[i] = max(levels[i],levels[i-1]-cap*step)
    for i in range(count-2,-1,-1):
        levels[i] = max(levels[i],levels[i+1]-cap*step)
    # Each averaged envelope sample covers the original point. This rounds
    # crests without consuming the required headroom at the crossing.
    window = 2*max(1,int(np.ceil(5/step)))+1
    smoothed = uniform_filter1d(maximum_filter1d(levels,window,mode='nearest'),
                                window,mode='nearest')
    return np.interp(stations,chain,smoothed)


def station_interchange_tunnels(ways, plans, control, left, top, ground_at):
    """Include bores below the roads connected to the two regraded station approaches."""
    from station_approaches import approach_junctions
    approaches = [ways[j['approachWay']] for j in approach_junctions(ways)]
    nodes = {n for w in approaches for n in w['nodes']}
    area = LineString(points(ways[UNDERPASS])).buffer(250)
    upper = []
    lower = []
    for wid,w in ways.items():
        tags = w.get('tags',{})
        if tags.get('highway','').removesuffix('_link') not in ('trunk','primary','secondary','tertiary'):
            continue
        if len(w.get('geometry',()))<2:
            continue
        line = LineString(points(w))
        if not line.intersects(area):
            continue
        if tags.get('tunnel','no')!='no':
            if wid!=UNDERPASS:
                lower.append((wid,line))
        elif nodes.intersection(w['nodes']) or any(line.crosses(LineString(points(a))) for a in approaches):
            upper.append((wid,line))
    for wid,bore in lower:
        for deck,line in upper:
            hit = bore.intersection(line)
            if hit.geom_type!='Point' or hit.is_empty or not bore.crosses(line):
                continue
            if deck in plans:
                center,_,stations,levels = plans[deck]
                road_y = np.interp(center.project(hit),stations,levels)
            else:
                road_y = max(ground_at(hit.x,hit.y),float(eval_bspline_grid(
                    control,left,top,np.asarray(hit.x),np.asarray(hit.y))))+.045
            yield wid,dict(type='road_underpass',upperWay=deck,x=hit.x,z=hit.y,
                           ceiling=road_y-STYLE['structureDepth']-STYLE['roadClearance']-.02)


def grade_railway_roads(plans, tunnels, terrain, ground, water, control, left, top, ground_at, protected):
    from railways import bake, road_radius
    inventory = json.loads((Path(__file__).resolve().parents[1]/'docs/railway-crossings.json').read_bytes())
    crossings, panels = bake(None, {}, inventory, {}, rail_only=True)
    by_road = defaultdict(list)
    for row in crossings:
        if row['road'] not in (FOOTBRIDGE, UNDERPASS):
            by_road[row['road']].append(row)
    ways = {w['id']: w for w in load_osm() if w['type']=='way'}
    from nanxi_crossing import BRIDGE, design as stream_design
    _,_,stream_deck,_ = stream_design(ways)
    center,span,at,old = plans[BRIDGE]
    plans[BRIDGE] = center,span,at,np.full_like(old,stream_deck)
    for wid,row in station_interchange_tunnels(ways,plans,control,left,top,ground_at):
        by_road[wid].append(row)
    targets = STRtree([Point(r['x'], r['z']) for rows in by_road.values() for r in rows])
    vertices, graph, floors, ceilings, roads = {}, [], {}, {}, {}
    shoulder_floors,shoulder_ceilings = {},{}
    panels_by_road = defaultdict(list)
    for panel in panels:
        panels_by_road[panel['road']].append(panel)
    existing_tunnels = {t['way'] for t in tunnels}

    def vertex(key):
        if key not in vertices:
            vertices[key] = len(graph)
            graph.append([])
        return vertices[key]

    for wid, way in ways.items():
        tags = way.get('tags', {})
        if not tags.get('highway') or tags['highway'] in ('construction','proposed','steps'):
            continue
        if wid in existing_tunnels or wid == FOOTBRIDGE or len(way.get('geometry', [])) < 2:
            continue
        coords = np.asarray(points(way))
        line = LineString(coords)
        # An 0.04 grade over 600 m accommodates 24 m of rise.
        if not len(targets.query(line, predicate='dwithin', distance=600)):
            continue
        chain = np.r_[0, np.cumsum(np.linalg.norm(np.diff(coords,axis=0),axis=1))]
        knots = dict(zip(chain, map(vertex,way['nodes'])))
        samples = set(knots) | set(np.arange(0,line.length,4.))
        def constrain(k, floor=-np.inf, ceiling=np.inf, shoulder=False):
            if k not in knots:
                knots[k] = vertex((wid,k))
            n = knots[k]
            lower,upper = (shoulder_floors,shoulder_ceilings) if shoulder else (floors,ceilings)
            if floor > -np.inf:
                lower[n] = min(lower.get(n,(np.inf,None))[0], -floor), None
            if ceiling < np.inf:
                upper[n] = min(upper.get(n,(np.inf,None))[0], ceiling), None
            samples.add(k)

        for row in by_road.get(wid, ()):
            at = line.project(Point(row['x'],row['z']))
            if row['type'] == 'level':
                continue
            if row['type']=='road_over':
                bounds = dict(floor=row['railY']+STYLE['structureDepth']+STYLE['overheadClearance']+.04)
            elif row['type']=='road_underpass':
                bounds = dict(ceiling=row['ceiling'])
            else:
                bounds = dict(ceiling=row['railY']-STYLE['structureDepth']-STYLE['roadClearance']-.02)
            for k in (max(0.,at-2),at,min(line.length,at+2)):
                constrain(k,**bounds)
            # The 8 m cubic street field reads four knots. Reserve space for
            # its support where other crossings leave enough approach length.
            pad = 5. if any(tags.get(k,'no')!='no' for k in ('bridge','tunnel')) else 20.
            first,last = max(0.,at-pad),min(line.length,at+pad)
            for k in (first,last,*(s for s in samples if first<s<last)):
                constrain(k,shoulder=True,**bounds)
        if wid==BRIDGE:
            for k in samples.copy():
                constrain(k,floor=stream_deck,ceiling=stream_deck)
        for panel in panels_by_road[wid]:
            start,end,y = panel['fromM'],panel['toM'],panel['railY']
            for k in [start,end,*(s for s in samples if start<s<end)]:
                constrain(k,floor=y,ceiling=y)
            first,last = max(0.,start-18),min(line.length,end+18)
            for k in (first,last,*(s for s in samples if first<s<last)):
                constrain(k,floor=y,ceiling=y,shoulder=True)
        stations = np.array(sorted(samples))
        indices = [knots[k] if k in knots else vertex((wid,k)) for k in stations]
        grade = .9*grade_cap(tags)
        for i,j,length in zip(indices,indices[1:],np.diff(stations)):
            graph[i].append((j,length,grade))
            graph[j].append((i,length,grade))
        roads[wid] = line,stations,indices

    levels = -envelope(graph,floors)[0]
    limits = envelope(graph,ceilings)[0]
    if np.max(levels-limits) > .001:
        raise ValueError(f'Road grade envelopes overlap by {np.max(levels-limits):.4f} m')
    # Give the tessellator flat supporting knots without making two nearby
    # crossings compete for a longer platform than the road can accommodate.
    for n,(negative_floor,_) in shoulder_floors.items():
        floors[n] = min(floors.get(n,(np.inf,None))[0],max(negative_floor,-limits[n])),None
    levels = -envelope(graph,floors)[0]
    for n,(ceiling,_) in shoulder_ceilings.items():
        ceilings[n] = min(ceilings.get(n,(np.inf,None))[0],max(ceiling,levels[n])),None
    limits = envelope(graph,ceilings)[0]
    surface_nodes = {n for wid in roads for n in ways[wid]['nodes']
                     if ways[wid]['tags'].get('tunnel','no')=='no'}
    joints = defaultdict(list)
    fallback_floors = {}
    original_control = control.copy()
    from railway_tunnel_widths import bore_widths, cover_crossing_streets
    from road_profile import RULES
    widths = bore_widths(ways,by_road)
    upper = [(ways[wid],road[0],RULES['defaultWidth'].get(ways[wid]['tags']['highway'],4.))
             for wid,road in roads.items() if ways[wid]['tags'].get('tunnel','no')=='no']
    upper_index = STRtree([line for _,line,_ in upper])
    for wid,(line,stations,indices) in roads.items():
        minimum,maximum = levels[indices],limits[indices]
        if not (np.isfinite(minimum).any() or np.isfinite(maximum).any()):
            continue
        tags = ways[wid]['tags']
        xy = np.array([line.interpolate(at).coords[0] for at in stations])
        if wid in plans:
            center,span,original_at,original = plans[wid]
            extra = np.array([center.project(Point(coord)) for coord in xy])
            along = np.array([line.project(center.interpolate(v)) for v in original_at])
            required = np.interp(along,stations,minimum)
            if wid != BRIDGE and np.any(required>original-.3):
                knots = np.unique(np.r_[original_at,extra])
                before = np.interp(knots,original_at,original)
                # Keep the native bridge plan and width while adding the
                # short clearance plateaus as real transverse deck sections.
                along = np.array([line.project(center.interpolate(v)) for v in knots])
                need = np.interp(along,stations,minimum)
                if np.any(need>before+.001):
                    deck = smooth_raised_deck(knots,before,need,grade_cap(tags)*.98)
                    plans[wid] = center,span,knots,deck
            continue
        ground_levels = np.array([ground_at(*p) for p in xy])
        street_levels = eval_bspline_grid(original_control,left,top,*xy.T)
        baseline = np.maximum(ground_levels,street_levels)+.045
        design = fit_approach(baseline,minimum,maximum)
        if tags.get('tunnel','no')!='no':
            if wid not in by_road:
                continue
            cover = [line.project(Point(r['x'],r['z'])) for r in by_road[wid]]
            bore_width = widths.get(wid,road_radius(tags)-1)
            cover.extend(cover_crossing_streets(ways[wid],bore_width,upper,upper_index))
            first_cover = max(0.,min(cover)-4.)
            last_cover = min(line.length,max(cover)+4.)
            chain = np.r_[0,np.cumsum(np.linalg.norm(np.diff(line.coords,axis=0),axis=1))]
            for node_a,node_b,a,b in zip(ways[wid]['nodes'],ways[wid]['nodes'][1:],chain,chain[1:]):
                if b-a < .01:
                    continue
                subset = (stations>=a)&(stations<=b)
                span = b-a
                mouth = [node_a in surface_nodes,node_b in surface_nodes]
                first,last = xy[subset][[0,-1]]
                low,high = design[subset][[0,-1]]
                tunnels.append(dict(way=wid,length=span,halfWidth=bore_width,
                                    clearance=STYLE['roadClearance'],approach=min(8.,span/3),mouths=mouth,
                                    openEnds=[float(np.clip(first_cover-a,0,span)),
                                              float(np.clip(b-last_cover,0,span))],
                                    nodes=[node_a,node_b],
                                    portals=[[first[0],low,first[1]],[last[0],high,last[1]]],
                                    stations=np.column_stack((stations[subset]-a,design[subset])).tolist()))
                tunnel = tunnels[-1]
                delta = (last-first)/span
                side = np.array([-delta[1],delta[0]])*tunnel['halfWidth']
                for end,(node,center) in enumerate(zip((node_a,node_b),(first,last))):
                    joints[node].append((tunnel,end,[center-side,center+side]))
            continue
        changed = np.flatnonzero(abs(design-baseline)>.001)
        if not len(changed):
            continue
        if tags.get('bridge','no')!='no':
            fallback_floors[wid] = line,stations,minimum
            continue
        for interval in np.split(changed,np.flatnonzero(np.diff(changed)>1)+1):
            first = max(0,interval[0]-1)
            last = min(len(xy)-1,interval[-1]+1)
            if first==last:
                continue
            segment = LineString(xy[first:last+1])
            radius = road_radius(tags)+6
            xmin,zmin,xmax,zmax = segment.buffer(radius+12).bounds
            for grid,step,ox,oz,scale in ((terrain,GRID,left,top,10),(ground,GRID,left,top,10),
                                          (control,STEP,left-STEP,top-STEP,1)):
                i,j = np.maximum(0,np.floor([(xmin-ox)/step,(zmin-oz)/step])).astype(int)
                ii,jj = np.minimum(grid.shape[::-1],np.ceil([(xmax-ox)/step,(zmax-oz)/step])+1).astype(int)
                if i>=ii or j>=jj:
                    continue
                x,z = np.meshgrid(ox+np.arange(i,ii)*step,oz+np.arange(j,jj)*step)
                probes = probe_points(x,z)
                along = segment.project(probes)+stations[first]
                offset = .15 if scale==10 else .045
                low = np.interp(along,stations,minimum)-offset
                high = np.interp(along,stations,maximum)-offset
                weight = np.clip((radius+12-distance(probes,segment))/12,0,1)
                weight *= weight*(3-2*weight)
                if scale==10:
                    weight *= water[j:jj,i:ii]==-32768
                patch = grid[j:jj,i:ii]
                raised = patch + weight*(scale*fit_approach(patch/scale,low,high)-patch)
                patch[:] = np.rint(raised) if scale==10 else raised
    for sections in joints.values():
        if len(sections)<2:
            continue
        hull = MultiPoint([point for _,_,edge in sections for point in edge]).convex_hull
        if hull.area<.001:
            continue
        ring = list(hull.exterior.coords)[:-1]
        for index,(section,end,_) in enumerate(sections):
            section.setdefault('joints',[None,None])[end] = dict(ring=ring,draw=index==0)
    from railway_approach_surface import grade_approach_surfaces
    grade_approach_surfaces(ways,crossings,panels,tunnels,plans,protected,water)
    return fallback_floors, crossings

"""Check the available approach length at the Guilin station underpass."""
import numpy as np
from shapely import LineString, Point

from features import points
from station_levels import UNDERPASS, TUNNEL_FLOOR


def approach_junctions(ways):
    """Nearest branching highway node along each continuation of the tunnel."""
    bore = ways[UNDERPASS]
    highways = [w for w in ways.values() if w.get('tags', {}).get('highway')]
    result = []
    for tip in (bore['nodes'][0], bore['nodes'][-1]):
        road, = [w for w in highways if w['id']!=UNDERPASS and tip in (w['nodes'][0],w['nodes'][-1])]
        nodes = list(zip(road['nodes'], points(road)))
        if nodes[-1][0]==tip:
            nodes.reverse()
        line = LineString([p for _,p in nodes])
        for node,point in nodes[1:]:
            others = [w['id'] for w in highways if w['id']!=road['id'] and node in w['nodes']]
            if others:
                result.append(dict(approachWay=road['id'],junctionNode=node,otherWays=sorted(others),
                                   x=point[0],z=point[1],outsideRunM=line.project(Point(point))))
                break
        else:
            raise ValueError(f"No junction found along station approach {road['id']}")
    return result


def approach_exceptions(tunnel, junctions, samples):
    rows = []
    for j, item in enumerate(junctions):
        at = samples[f"station-junction:{item['junctionNode']}"]['road']
        if at is None:
            raise ValueError(f"Missing station approach road elevation at {item['junctionNode']}")
        run = tunnel['approachEnds'][j]
        available = run + item['outsideRunM']
        required = abs(at-TUNNEL_FLOOR)/.05
        if required > available:
            stations = np.asarray(tunnel['stations'])
            ramp = stations[stations[:,0]<=run] if j==0 else stations[stations[:,0]>=tunnel['length']-run]
            peak = np.max(np.abs(np.diff(ramp[:,1])/np.diff(ramp[:,0])))
            rows.append(dict(way=UNDERPASS, approachWay=item['approachWay'],junctionNode=item['junctionNode'],
                             otherWays=item['otherWays'], reason='approach intersects existing road junction',
                             roadAtJunctionM=round(at,4), floorM=TUNNEL_FLOOR, availableToJunctionM=round(available,3),
                             minimumRunAt5PercentM=round(required,3), retainedRampM=round(run,3),
                             retainedRampPeakPercent=round(float(peak)*100,3)))
    return rows


def grade_station_junctions(terrain, underlay, water, road_ctrl, left, top):
    """Lower the surface road network from both tunnel mouths through its junctions."""
    import json
    from collections import defaultdict
    from pathlib import Path
    from shapely import distance, points as probes, union_all
    from common import GRID, load_osm, ll2xz
    from road_grading import STEP
    from station_levels import TUNNEL_FLOOR

    ways = {w['id']: w for w in load_osm() if w['type']=='way'}
    tunnel = ways[UNDERPASS]
    bore = LineString(points(tunnel))
    inventory = json.loads((Path(__file__).resolve().parents[1]/'docs/railway-crossings.json').read_bytes())
    tracks = [bore.project(Point(ll2xz(r['lat'],r['lon']))) for r in inventory
              if r['road']==UNDERPASS and r['type']=='rail_over']
    # 4% leaves margin for the sampled ground mesh and for rounding to dm.
    grade = .04
    for node, edge, portal in zip((tunnel['nodes'][0],tunnel['nodes'][-1]),
                                  (min(tracks)-2,max(tracks)+2),bore.coords):
        anchor = bore.interpolate(edge)
        # Use the local terrain range to bound the search beyond the tie-in.
        radius = 400
        neighborhood = anchor.buffer(radius)
        attached = defaultdict(list)
        lines = {}
        for wid,w in ways.items():
            tags = w.get('tags',{})
            if tags.get('highway','').removesuffix('_link') not in (
                    'trunk','primary','secondary','tertiary','residential','service','unclassified','living_street'):
                continue
            if tags.get('bridge','no')!='no' or tags.get('tunnel','no')!='no':
                continue
            coords = points(w)
            if len(coords)<2:
                continue
            line = LineString(coords)
            if not line.intersects(neighborhood):
                continue
            lines[wid] = line.intersection(neighborhood)
            for n,p in zip(w['nodes'], coords):
                if anchor.distance(Point(p))<radius:
                    attached[n].append(wid)
        seen = set()
        pending = list(attached[node])
        while pending:
            wid = pending.pop()
            if wid not in seen:
                seen.add(wid)
                for n in ways[wid]['nodes']:
                    pending.extend(k for k in attached[n] if k not in seen)
        corridor = union_all([lines[k] for k in seen])
        if corridor.is_empty:
            continue
        xmin,zmin,xmax,zmax = corridor.buffer(32).bounds
        for grid,step,x0,z0,scale in ((terrain,GRID,left,top,10),(underlay,GRID,left,top,10),
                                      (road_ctrl,STEP,left-STEP,top-STEP,1)):
            i,j = np.maximum(0,np.floor([(xmin-x0)/step,(zmin-z0)/step])).astype(int)
            ii,jj = np.minimum(grid.shape[::-1],np.ceil([(xmax-x0)/step,(zmax-z0)/step])+1).astype(int)
            if ii<=i or jj<=j:
                continue
            x,z = np.meshgrid(x0+np.arange(i,ii)*step,z0+np.arange(j,jj)*step)
            lateral = distance(probes(x,z),corridor)
            blend = np.clip((32-lateral)/12,0,1)
            blend *= blend*(3-2*blend)
            if scale==10:
                blend *= water[j:jj,i:ii]==-32768
            along = np.hypot(x-anchor.x,z-anchor.y)
            cap = TUNNEL_FLOOR + grade*(np.sqrt(along**2+16)-4)
            patch = grid[j:jj,i:ii]
            # Smooth minimum with a 30 cm transition into the original road.
            # The terrain supports the pavement a few centimetres below its top.
            original = patch.astype(float)/scale
            limit = cap-(.12 if scale==10 else .045)
            difference = np.maximum(.3-abs(original-limit),0)
            target = np.minimum(original,limit)-difference**2/1.2
            value = scale*(original+blend*(target-original))
            patch[:] = np.rint(value) if scale==10 else value

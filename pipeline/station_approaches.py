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

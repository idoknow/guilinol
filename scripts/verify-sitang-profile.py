"""Measure the lift needed above the existing inside wheel path at the Sitang River bore."""
import argparse
import csv
import gzip
import json
from pathlib import Path

import numpy as np
from shapely import LineString, Point

from canal_passages import sample_road_heights
from common import load_osm
from features import points
from service_streets import width
from tunnel_clearance import SITANG_ROOF_THICKNESS, clearance as required_clearance


def measure(base, candidate, csv_path=None):
    ids = (1097830334, 842819690, 1494508177, 1494508178, 882310596, 882310597)
    ways = {w['id']: w for w in load_osm() if w['type'] == 'way' and w['id'] in ids}
    bridge, road, tie, tunnel, upper, motorway = (ways[i] for i in ids)
    ref = 10052448934
    coords = []
    inside_lanes = set()
    for way in (bridge, road, tie, tunnel):
        refs = way['nodes']
        # Only the final segment of Y109 returns from the bridge to the bore approach.
        other = 3891277133 if way is road else (refs[-1] if refs[0] == ref else refs[0])
        i, j = refs.index(ref), refs.index(other)
        path = points(way)[min(i, j):max(i, j) + 1]
        if j < i:
            path.reverse()
        coords.extend(path[1:] if coords else path)
        inside_lanes.add((way['id'], other, ref))
        ref = other
    with gzip.open(candidate/'roads/graph.json.gz') as stream:
        lanes = json.load(stream)['lanes']
    offsets = {(l['way'], l['from'], l['to']): l['offset'] for l in lanes if l['kind'] == 'motor'
               and (l.get('way'), l['from'], l['to']) in inside_lanes}
    if offsets.keys() != inside_lanes or len(set(offsets.values())) != 1:
        raise ValueError('Inside lane geometry changed. Survey the new wheel path.')
    graph_offset = next(iter(offsets.values()))
    car_half_track = .795
    track = LineString(coords).offset_curve(-graph_offset-car_half_track, join_style='mitre')
    stations = np.arange(0, min(65, track.length), .01)
    probes = [track.interpolate(s) for s in stations]
    manifests = [json.loads((world/'manifest.json').read_text()) for world in (base, candidate)]

    def samples(world, manifest, pts, flag):
        return sample_road_heights(world, manifest, [dict(x=p.x, z=p.y, **{flag: True}) for p in pts])

    bridge_axis = LineString(points(bridge))
    bridge_zone = bridge_axis.buffer(width(bridge['tags'])/2+1)
    decks = samples(base, manifests[0], probes, 'roofProbe')
    anchor = max(i for i, (_, deck) in enumerate(decks) if deck is not None and bridge_zone.covers(probes[i]))
    surface = samples(base, manifests[0], probes, 'pavementOnly')
    upper_zone = LineString(points(upper)).buffer(width(upper['tags'])/2, cap_style='flat')
    clearance = required_clearance(tunnel['tags'])
    roof_thickness = SITANG_ROOF_THICKNESS
    bridge_y = decks[anchor][1]
    def lift(i):
        return bridge_y - .08*(stations[i]-stations[anchor]) + clearance + roof_thickness - surface[i]
    limit = max((i for i in range(anchor, len(stations)) if surface[i] is not None
                 and upper_zone.covers(probes[i])), key=lift)
    lower = samples(candidate, manifests[1], probes[anchor:limit+1], 'pavementOnly')
    # Continue on the same wheel strip to a point inside the parallel motorway.
    witness = limit + 1200
    point = probes[witness]
    motorway_axis = LineString(points(motorway))
    upper_axis = LineString(points(upper))
    required = bridge_y - .08*(stations[witness]-stations[anchor]) + clearance + roof_thickness
    roof = max(y for y in samples(candidate, manifests[1], [point], 'roofProbe')[0] if y is not None)
    motorway_probe = dict(way=motorway['id'], xz=list(point.coords[0]),
                          wheelPathMetres=stations[witness]-stations[anchor],
                          distanceToMotorwayAxis=point.distance(motorway_axis),
                          outsideServiceCorridor=point.distance(upper_axis)-width(upper['tags'])/2-.5,
                          roofMetres=roof, requiredMetres=required, deficitMetres=required-roof)
    # ground_features paints the unbridged motorway on a 14 m wide strip.
    half_width = 7.
    indices = [i for i in range(limit, len(stations))
               if probes[i].distance(motorway_axis) <= half_width]
    roofs = samples(candidate, manifests[1], [probes[i] for i in indices], 'roofProbe')
    section = []
    for i, hits in zip(indices, roofs, strict=True):
        point = probes[i]
        distance = stations[i]-stations[anchor]
        floor_min = bridge_y-.08*distance
        top = max(y for y in hits if y is not None)
        section.append(dict(wheelPathMetres=distance, xz=list(point.coords[0]),
                            insideRoadEdgeMetres=half_width-point.distance(motorway_axis),
                            floorLowerBound=floor_min, visibleTop=top,
                            minimumLift=floor_min+clearance+roof_thickness-top))
    motorway_probe['section'] = dict(samples=len(section), roadWidth=2*half_width,
        peak=max(section, key=lambda r: r['minimumLift']),
        insideOneMetre=max((r for r in section if r['insideRoadEdgeMetres'] >= 1),
                           key=lambda r: r['minimumLift']),
        overHalfMetreSamples=sum(1 for r in section if r['minimumLift'] > .5))
    # Check the existing visible pavement right up to the inside bend. Its
    # longitudinal section is shorter than the reference car wheel track.
    bore = next(t for t in manifests[1]['tunnels'] if t['way'] == tunnel['id'])
    bore_axis = LineString([(x, z) for x, _, z in bore['portals']])
    pavement = []
    survey_rows = []
    for margin in (.50, .20, .10, .05):
        offset = bore['halfWidth'] - margin
        strip = LineString(coords).offset_curve(-offset, join_style='mitre')
        pts = [strip.interpolate(s) for s in stations]
        deck = samples(base, manifests[0], pts, 'roofProbe')
        lip = max(i for i, (_, hit) in enumerate(deck) if hit is not None and abs(hit-bridge_y)<.01
                  and stations[i] <= bridge_axis.length+1)
        mouth = strip.project(Point(bore_axis.coords[0]))
        before = [i for i in range(lip, len(pts)) if stations[i] < mouth]
        paving = samples(candidate, manifests[1], [pts[i] for i in before], 'pavementOnly')
        over_service = [i for i in range(before[-1]+1,len(pts)) if upper_zone.covers(pts[i])]
        surface_hits = samples(base, manifests[0], [pts[i] for i in over_service], 'pavementOnly')
        service_bounds = [deck[lip][1]-.08*(stations[i]-stations[lip])+clearance+roof_thickness-y
                          for i,y in zip(over_service,surface_hits,strict=True) if y is not None]
        cross = [i for i in range(before[-1]+1, len(pts)) if pts[i].distance(motorway_axis) <= half_width
                 and bore_axis.distance(pts[i]) <= bore['halfWidth']]
        top = samples(candidate, manifests[1], [pts[i] for i in cross], 'roofProbe')
        records = []
        for i, hits in zip(cross, top, strict=True):
            distance = stations[i]-stations[lip]
            floor_min = deck[lip][1]-.08*distance
            visible = max(h for h in hits if h is not None)
            records.append(dict(xz=list(pts[i].coords[0]), distance=distance, floorLowerBound=floor_min,
                                insideMotorway=half_width-pts[i].distance(motorway_axis), visibleTop=visible,
                                lift=floor_min+clearance+roof_thickness-visible))
        survey_rows.extend((offset, margin, *r['xz'], r['distance'], r['insideMotorway'], r['floorLowerBound'],
                            r['visibleTop'], r['lift']) for r in records)
        pavement.append(dict(offset=offset, insideBore=margin, bridgeXZ=list(pts[lip].coords[0]),
                             bridgeY=deck[lip][1], approachSamples=len(paving),
                             hits=sum(h is not None for h in paving), motorwaySamples=len(records),
                             servicePavingSamples=len(service_bounds), serviceLiftLowerBound=max(service_bounds,default=None),
                             overCap=sum(1 for r in records if r['lift'] > .5), peak=max(records,key=lambda r:r['lift'])))
    # The current renderer stores one floor elevation per station across the
    # bore. Propagate the inside pavement bound to the actual 6 m carriageway.
    wall = pavement[-1]['peak']
    lane_edge = pavement[0]['peak']
    axis_delta = bore_axis.project(Point(lane_edge['xz']))-bore_axis.project(Point(wall['xz']))
    lane_min = wall['floorLowerBound']-.08*abs(axis_delta)
    level_section = dict(carriagewayWidth=2*pavement[0]['offset'], xz=lane_edge['xz'],
                         stationDifference=axis_delta, floorLowerBound=lane_min,
                         minimumLift=lane_min+clearance+roof_thickness-lane_edge['visibleTop'])
    if csv_path:
        with csv_path.open('w', newline='') as stream:
            writer = csv.writer(stream)
            writer.writerow(('offset_m', 'distance_inside_bore_m', 'x', 'z', 'distance_from_bridge_m',
                             'distance_inside_motorway_m', 'floor_lower_bound_m', 'visible_motorway_m', 'minimum_lift_m'))
            writer.writerows(survey_rows)
    return dict(levelCrossSection=level_section,pavementSections=pavement,motorwayProbe=motorway_probe, tunnel=tunnel['id'], tags=tunnel['tags'], clearance=clearance, roofThickness=roof_thickness, bridge=bridge['id'],
                bridgeXZ=list(probes[anchor].coords[0]), bridgeY=bridge_y, upper=upper['id'],
                upperXZ=list(probes[limit].coords[0]), upperY=surface[limit],
                laneOffset=graph_offset, halfTrack=car_half_track, spacing=.01, gradeLimit=.08,
                wheelPathMetres=stations[limit]-stations[anchor], pavedSamples=sum(y is not None for y in lower),
                samples=len(lower), minimumLiftMetres=lift(limit))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('base_world', type=Path)
    parser.add_argument('candidate_world', type=Path)
    parser.add_argument('--section-csv', type=Path)
    args = parser.parse_args()
    print(json.dumps(measure(args.base_world, args.candidate_world, args.section_csv), indent=2))

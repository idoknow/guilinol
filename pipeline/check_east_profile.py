"""Evaluate a design profile, not an in-game clearance certificate.

Usage: python pipeline/check_east_profile.py measured-underpass.json output-dir
The first argument is output from check_underpass.py for the same world build.
"""
import csv
import json
import sys
from pathlib import Path

import numpy as np
from scipy.optimize import linprog
from shapely.geometry import LineString, Point

from audit_seams import Streets, Surface
from common import load_osm
from features import points
from landmarks.jiefang_layout import SPAN_WAYS


def run(measured, output):
    world = Surface()
    streets = Streets(world)
    entry = world.entries['jiefang_bridge']
    radians = np.deg2rad(entry['rotation'])
    axis = np.array([np.cos(radians), -np.sin(radians)])
    origin = np.array(entry['position'])[::2]
    ways = {way['id']: way for way in load_osm() if way['type'] == 'way' and 'highway' in way.get('tags', {})}
    lower = LineString(points(ways[682893309]))
    contacts = []
    for key in sorted(SPAN_WAYS):
        span = ways[key]
        contact = max((0, -1), key=lambda index: points(span)[index][0])
        node = span['nodes'][contact]
        land, = [way for way in ways.values() if way['id'] != key and node in (way['nodes'][0], way['nodes'][-1])]
        direction = 1 if land['nodes'][0] == node else -1
        nodes = land['nodes'][::direction]
        coords = points(land)[::direction]
        junction = next(index for index, ident in enumerate(nodes[1:], 1) if any(
            other['id'] != land['id'] and ident in other['nodes'] for other in ways.values()))
        length = LineString(coords[:junction+1]).length
        road_y = streets.at(*coords[junction])[0]
        cross = lower.intersection(LineString(points(span)))
        contacts.append((key, (coords[0]-origin) @ axis, length, road_y, lower.project(cross)))

    shared_cap = min(height + .05*length for _, _, length, height, _ in contacts)
    inner = min(local for _, local, *_ in contacts)
    head = shared_cap - .12
    samples = np.arange(10., 221., .25)
    xy = [lower.interpolate(station) for station in samples]
    existing = np.array([streets.at(point.x, point.y)[0] for point in xy])
    delta = np.eye(len(samples))
    step = samples[1] - samples[0]
    first = np.diff(delta, axis=0) / step
    second = np.diff(first, axis=0) / step
    bounds = list(zip(existing-3, existing))
    for index in (0, 1, -2, -1):
        bounds[index] = (existing[index], existing[index])
    result = linprog(np.ones(len(samples)), A_ub=np.vstack([first, -first, second, -second]),
                     b_ub=np.r_[np.full(2*len(first), .06), np.full(2*len(second), .008)], bounds=bounds)
    if not result.success:
        raise ValueError(result.message)

    packed = json.loads(measured.read_text())['682893309']['centerline']
    readings = [(lower.project(Point(row[:2])), 'slab', *row[:2]) for row in packed]
    for key, _, _, _, station in contacts:
        crossing = lower.interpolate(station)
        readings.append((station, str(key), crossing.x, crossing.y))
    output.mkdir(parents=True, exist_ok=True)
    rows = []
    for station, role, east, south in sorted(readings):
        local = (np.array([east, south])-origin) @ axis
        distance = max(0., inner-local)
        rise = .05*(distance**2/4 if distance <= 2 else distance-1)
        current = streets.at(east, south)[0]
        cut = np.interp(station, samples, result.x)
        upper = shared_cap + .05*min(abs(local-contact[1]) for contact in contacts)
        floor = max(current-3, np.max(existing-3-.06*np.abs(samples-station)))
        rows.append([station, role, east, south, head+rise, current-cut, head+rise-1.22-cut, upper-1.22-floor])
    with (output/'crossings.csv').open('w') as stream:
        writer = csv.writer(stream)
        writer.writerow('station role x z deck_m cut_m candidate_clearance_m optimistic_bound_m'.split())
        writer.writerows(rows)
    np.savetxt(output/'lower-profile.csv', np.c_[samples, existing, result.x], delimiter=',',
               header='chainage_m,current_road_m,candidate_road_m', comments='')
    for item in contacts:
        print('contact', item)
    print('common end cap', shared_cap, 'candidate', head)
    for row in rows:
        if row[1] != 'slab': print('crossing', row)
    print('limiting bound', min(rows, key=lambda row:row[-1]))
    print('limiting candidate', min(rows, key=lambda row:row[-2]))


if __name__ == '__main__':
    run(*map(Path, sys.argv[1:]))

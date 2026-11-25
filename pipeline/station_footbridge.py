"""Deck and platform stair sections for the mapped Guilin station footbridge."""
import json
import math
from pathlib import Path

import numpy as np
from shapely import LineString, Point

BRIDGE = 819178842
STAIRS = {819178843, 819178844, 819178845}
NORTH_FLIGHTS = {376029417: 15.0756, 376029418: 16.5925, 376029419: 14.642, 376029420: 14.6615}
PLATFORM = 155.05
DECK = 162.50


def sections(way, coords, junction_nodes):
    line = LineString(coords)
    if way['id'] == BRIDGE:
        stations = [(line.project(Point(p)), DECK) for p in coords]
    else:
        landing, = [line.project(Point(p)) for n, p in zip(way['nodes'], coords)
                    if n in junction_nodes]
        stations = []

        def flight(start, end, bottom, top):
            length = end - start
            if length < .01:
                return
            # Include horizontal landings at both ends. Duplicate each nosing
            # at its two heights so neighboring triangles are horizontal treads.
            margin = min(1.2, length / 6)
            steps = math.ceil(abs(top - bottom) / .16)
            stations.append((start, bottom))
            for idx in range(steps):
                at = start + margin + idx * (length - 2 * margin) / (steps - 1)
                stations.extend([(at, bottom + (top - bottom) * idx / steps),
                                 (at, bottom + (top - bottom) * (idx + 1) / steps)])
            stations.append((end, top))

        flight(0, landing, PLATFORM, DECK)
        flight(landing, line.length, DECK, PLATFORM)

    result = []
    for at, y in stations:
        center = np.asarray(line.interpolate(at).coords[0])
        before = np.asarray(line.interpolate(max(0, at - .05)).coords[0])
        after = np.asarray(line.interpolate(min(line.length, at + .05)).coords[0])
        dx, dz = after - before
        side = 1.5 * np.array([-dz, dx]) / math.hypot(dx, dz)
        result.append((center + side, center - side, y))
    return result


def north_bridge(ways):
    """Surveyed northern crossing and its platform flights, shared with #297."""
    from shapely import Polygon
    from shapely.geometry.polygon import orient
    from common import ll2xz
    from features import area

    ring = [ll2xz(lat,lon) for lon,lat in [
        (110.27689934,25.26461780),(110.27773082,25.26471078),
        (110.27774423,25.26462588),(110.27690828,25.26453290)]]
    deck=Polygon(ring)
    # GL04 thin spans are 0.60 m deep, leaving 7.50 m above the railhead.
    level=153.80+7.50+.60
    yield deck,level
    for wid,run in NORTH_FLIGHTS.items():
        platform=orient(area(ways[wid]),sign=1)
        top=deck.intersection(platform).centroid
        if top.is_empty:
            continue
        coords=np.asarray(platform.exterior.coords)
        edges=np.diff(coords,axis=0)
        v=edges[np.argmax(np.linalg.norm(edges,axis=1))]
        axis=v/np.linalg.norm(v)
        side=1.1*np.array([-axis[1],axis[0]])
        pos=np.asarray(top.coords[0])
        n=math.ceil((level-PLATFORM)/.16)
        # Begin at the edge of the upper landing. Each complete tread has
        # one elevation across its full width, down to the platform landing.
        strip=LineString([pos,pos+axis*run])
        landing=strip.intersection(deck).length
        for j in range(n):
            a=pos+axis*(landing+(run-landing)*j/n)
            b=pos+axis*(landing+(run-landing)*(j+1)/n)
            yield Polygon([a+side,b+side,b-side,a-side]),level-(level-PLATFORM)*(j+1)/n


def fallback_north_faces(ways):
    entries = json.loads(Path(__file__).with_name('landmarks.json').read_text())
    if any(entry['id'] == 'guilin_station' for entry in entries):
        return
    platforms = {w['id']: w for w in ways if w['type'] == 'way' and w['id'] in NORTH_FLIGHTS}
    if platforms.keys() == NORTH_FLIGHTS.keys():
        yield from north_bridge(platforms)


def building_cutouts(ways, footprints, heights, index):
    """Reserve the modeled deck and stair envelope in intersecting procedural solids."""
    from collections import defaultdict
    from shapely import union_all

    occupied = defaultdict(list)
    platforms = {w['id']: w for w in ways if w['type'] == 'way' and w['id'] in NORTH_FLIGHTS}
    if platforms.keys() != NORTH_FLIGHTS.keys():
        return {}
    for face, level in north_bridge(platforms):
        for key in index.query(face, predicate='intersects'):
            base, roof = heights[key][:2]
            if base < level + 2.2 and roof > level - .6:
                occupied[key].append(face)
    # Keep the source outline outside the modeled structure and retain its
    # original roof height, facade seed and floor count on both sides.
    return {key: footprints[key].difference(union_all(faces).buffer(.02))
            for key, faces in occupied.items()}

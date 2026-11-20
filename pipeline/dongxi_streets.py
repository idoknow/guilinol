"""Asymmetric edges for inferred pedestrian surfaces alongside registered Dongxi roofs."""
import json
from functools import lru_cache
from pathlib import Path

from shapely.geometry import Polygon

from common import ll2xz


FRONTAGES = {1008909364: 'R41', 1554170681: 'R41', 1554170682: 'R41',
             1531321915: 'R11', 221821082: 'R47'}


@lru_cache(maxsize=1)
def frontage_limits():
    path = Path(__file__).resolve().parents[1] / 'docs/layout/dongxi-layout.geojson'
    return {feature['properties']['name']: Polygon([
        ll2xz(lat, lon) for lon, lat in feature['geometry']['coordinates'][0]
    ]).buffer(.15, join_style='mitre') for feature in json.loads(path.read_text())['features']
        if feature['properties']['name'] in FRONTAGES.values()}


def street_surface(road):
    surface = road.pavement
    if road.kind == 'pedestrian' and road.source == 'frontage' and road.way in FRONTAGES:
        limit = frontage_limits()[FRONTAGES[road.way]]
        if road.line.intersects(limit):
            raise ValueError(f'OSM way/{road.way} now crosses its registered frontage; review before clipping')
        return surface.difference(limit)
    return surface

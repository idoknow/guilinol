"""Emit OSM carriageway stations clipped to the approved play boundary."""
import json
import math

import shapely
from shapely import LineString, STRtree

from common import load_osm
from features import points
from play_region import PlayRegion
from road_profile import profile


def stations():
    region = PlayRegion().geometry
    facades = STRtree([])
    for way in load_osm():
        tags = way.get('tags', {})
        if way['type'] != 'way' or tags.get('highway', '').removesuffix('_link') not in {'primary','secondary','trunk'}:
            continue
        line = LineString(points(way))
        width = profile(line, tags, facades, way['id']).width
        structure = next((key for key in ('bridge', 'tunnel') if tags.get(key, 'no') != 'no'),
                         'layer' if tags.get('layer', '0') != '0' else 'ground')
        for piece in shapely.get_parts(line.intersection(region)):
            if piece.geom_type != 'LineString' or not piece.length:
                continue
            count = math.ceil(piece.length / 4)
            interval = piece.length / count
            for index in range(count):
                begin, end = (piece.interpolate((index+offset)*interval) for offset in (0, 1))
                center = piece.interpolate((index+.5)*interval)
                angle = math.atan2(end.y-begin.y, end.x-begin.x)
                yield [way['id'], center.x, center.y, -math.sin(angle), math.cos(angle), width, interval, structure]


if __name__ == '__main__':
    print(json.dumps(list(stations()), separators=(',', ':')))

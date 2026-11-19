"""Choose a schematic plaque site from an addressed street, not an entrance."""
import math

from shapely.geometry import LineString

from features import area, points


def frontage(campus, osm):
    street = campus['tags'].get('addr:street')
    if not street:
        return None
    roads = [(key, LineString(pair)) for key, element in osm.items()
            if element.get('tags', {}).get('name') == street and element['tags'].get('highway')
            for coords in [points(element)] for pair in zip(coords, coords[1:]) if pair[0] != pair[1]]
    candidates = []
    coords = list(area(campus).exterior.coords)
    for first, last in zip(coords, coords[1:]):
        edge = LineString([first, last])
        if edge.length < 6:
            continue
        midpoint = edge.interpolate(.5, normalized=True)
        for key, road in roads:
            distance = midpoint.distance(road)
            if distance > 20:
                continue
            start, end = road.coords
            yaw = math.atan2(start[1]-end[1], end[0]-start[0])
            alignment = abs(((last[0]-first[0])*math.cos(yaw)-(last[1]-first[1])*math.sin(yaw))/edge.length)
            if alignment < math.cos(math.radians(5)):
                continue
            candidates.append((distance, key, midpoint, math.degrees(yaw), road, edge))
    return min(candidates, key=lambda candidate: candidate[0]) if candidates else None

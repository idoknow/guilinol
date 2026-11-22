"""OSM road envelopes and whole-way mountain trail classification."""
import re

import shapely
from shapely.geometry import LineString, Point

from common import ll2xz
from dongxi_streets import street_surface
from features import area, points, raw_overture_footprints
from road_profile import RULES
from scatter import extract_road_network


def road_buffers(bounds):
    elements, roads, *_ = extract_road_network(raw_overture_footprints(bounds))
    profiles = {r.way: r.aligned_section() for r in roads}
    ways, buffers = [], []
    for e in elements:
        tags = e.get('tags', {})
        if e['type'] != 'way' or 'highway' not in tags or len(points(e)) < 2:
            continue
        if tags.get('area') == 'yes':
            surface = area(e)
        elif e['id'] in profiles:
            road = profiles[e['id']]
            parts = [street_surface(road)]
            for side, width in ((-1, road.left), (1, road.right)):
                if width:
                    if str(road.way) in RULES['frontageSections']:
                        width = sum(road.dimensions[k] for k in ('verge','cycle','curb','walk'))
                    parts.append(road.side_line(side).buffer(side*(road.width/2+width),
                                                             single_sided=True, quad_segs=2))
            surface = shapely.union_all(parts)
        else:
            line = LineString(points(e))
            width_tag = re.fullmatch(r'(\d+(?:\.\d+)?)\s*m?',tags.get('width','').strip())
            width = float(width_tag[1]) if width_tag else RULES['defaultWidth'].get(tags['highway'],3)
            surface = line.buffer(width/2, quad_segs=2)
            for side,sign in (('left',-1),('right',1)):
                if tags.get('sidewalk:'+side,tags.get('sidewalk')) in ('yes','both',side):
                    surface = surface.union(line.buffer(sign*(width/2+RULES['sidewalkWidth']),single_sided=True))
        ways.append(e)
        buffers.append(surface.buffer(2))
    return ways, shapely.STRtree(buffers)


class TrailAreas:
    """Only whole walking ways in a peak's containing land polygon are trails."""
    def __init__(self, elements):
        areas, parks = [], []
        self.summits = {}
        for e in elements:
            tags = e.get('tags', {})
            if e['type'] == 'node':
                if tags.get('natural') == 'peak':
                    self.summits[e['id']] = Point(ll2xz(e['lat'], e['lon']))
            elif tags.get('leisure') == 'park' or tags.get('natural') not in (None, 'water', 'coastline'):
                region = area(e)
                if not region.is_empty:
                    areas.append(region)
                    if tags.get("leisure") == "park":
                        parks.append(region)
        self.index = shapely.STRtree(areas)
        self.parks = shapely.STRtree(parks)

    def regions(self, summit):
        return self.index.geometries[self.index.query(summit, predicate='covered_by')]

    @staticmethod
    def trail(way, regions):
        tags = way.get('tags', {})
        kind = tags.get('highway')
        if kind not in ('steps','path','track','footway') or tags.get('footway') == 'sidewalk':
            return False
        return any(region.covers(LineString(points(way))) for region in regions)

    def platforms(self, summit, ways, uphill):
        """Classify mapped highway areas at an uphill route endpoint in its park."""
        parks = self.parks.geometries[self.parks.query(summit,predicate='covered_by')]
        endpoints = [Point(p) for way in uphill for p in (points(way)[0],points(way)[-1])]
        result = {}
        for way in ways:
            if way.get('tags',{}).get('area')!='yes':
                continue
            polygon = area(way)
            if any(park.covers(polygon) for park in parks) and any(polygon.covers(end) for end in endpoints):
                result[way['id']] = polygon
        return result

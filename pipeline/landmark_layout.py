import json
import math
from pathlib import Path

from shapely.geometry import Polygon, Point
from shapely.ops import unary_union

from common import ll2xz, load_osm
from features import area, points
from school_frontage import frontage


def polygon(coords):
    return Polygon([ll2xz(lat,lon) for lon,lat in coords])


class Layout:
    def __init__(self):
        root = Path(__file__).resolve().parent
        self.entries = []
        self.ids = set()
        self.flatten = []
        self.school_grounds = []
        self.allow_unmapped_court = []
        tree_free = []
        areas = []
        tree_clearings = []
        osm = {f"{item['type']}/{item['id']}":item for item in load_osm()}
        peak_models = {peak['model'] for peak in json.loads((root/'peaks.json').read_text()) if peak.get('model')}
        for entry in json.loads((root/'landmarks.json').read_text()):
            anchor = entry['anchor']
            if isinstance(anchor,str):
                element = osm[anchor]
                if element['type']=='node':
                    x,z = ll2xz(element['lat'],element['lon'])
                else:
                    shape=area(element)
                    center = shape.centroid if not shape.is_empty else Point(points(element)[0])
                    x,z=center.coords[0]
            else:
                x,z = ll2xz(anchor[1],anchor[0])
            for ring in entry.get('treeClearingsMeters',[]):
                tree_clearings.append(Polygon([(x+east,z+south) for east,south in ring]))
            replace = entry.get('replace',[])
            if isinstance(replace,dict):
                areas.append(polygon(replace['polygon']))
            else:
                for key in replace:
                    if key in osm:
                        # A bridge way is a line. Skip it here; bridges.py drops the deck.
                        shape = area(osm[key])
                        if not shape.is_empty:
                            areas.append(shape)
                    else:
                        self.ids.add(key)
            # Extra footprints when one OSM way is the whole grounds, not the modeled mass.
            for ring in entry.get('replacePolygons',[]):
                areas.append(polygon(ring))
            if 'flatten' in entry:
                patch = entry['flatten']
                region = polygon(patch['polygon'])
                if entry.get('allowUnmappedCourt'):
                    self.allow_unmapped_court.append(region)
                self.flatten.append((region,patch['elevation']))
                (self.school_grounds if entry.get('schoolGround') else tree_free).append(region)
            model = root.parent/'public'/entry['model']
            if 'schematicCampus' in entry:
                site = frontage(osm[entry['schematicCampus']], osm)
                if site is None:
                    continue
                _, _, midpoint, entry['rotation'], _ = site
                x,z = midpoint.coords[0]
            if entry['model'] in peak_models:
                continue
            if model.exists():
                metadata = json.loads(model.with_suffix('.json').read_text())
                *center, radius = metadata['sphere']
                rounded = [round(value, 3) for value in center]
                metadata['sphere'] = [*rounded, math.ceil((radius+math.dist(center,rounded))*1000)/1000]
                self.entries.append((x,z,dict(id=entry['id'],name=entry['name'],file=entry['model'],
                    rotation=entry.get('rotation',0),collision=entry['collision'],bytes=model.stat().st_size,
                    **metadata)))
        self.exclude = unary_union(areas)
        self.tree_exclude = unary_union([self.exclude,*tree_free,*tree_clearings]).buffer(2)

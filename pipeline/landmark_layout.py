import json
from pathlib import Path

from shapely.geometry import Polygon, Point
from shapely.ops import unary_union

from common import ll2xz, load_osm
from features import area, points


def polygon(coords):
    return Polygon([ll2xz(lat,lon) for lon,lat in coords])


class Layout:
    def __init__(self):
        root = Path(__file__).resolve().parent
        self.entries = []
        self.ids = set()
        self.flatten = []
        self.school_grounds = []
        tree_free = []
        areas = []
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
                self.flatten.append((region,patch['elevation']))
                (self.school_grounds if entry.get('schoolGround') else tree_free).append(region)
            model = root.parent/'public'/entry['model']
            if entry['model'] in peak_models:
                continue
            if model.exists():
                self.entries.append((x,z,dict(id=entry['id'],name=entry['name'],file=entry['model'],
                    rotation=entry.get('rotation',0),collision=entry['collision'],bytes=model.stat().st_size,
                    **json.loads(model.with_suffix('.json').read_text()))))
        self.exclude = unary_union(areas)
        self.tree_exclude = unary_union([self.exclude, *tree_free]).buffer(2)

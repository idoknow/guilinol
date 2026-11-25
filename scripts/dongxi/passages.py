"""Reserve the public walking axis when an inferred roof joins opposite frontages."""
import json
import sys
from pathlib import Path

from shapely.geometry import LineString, Polygon

root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(root/'pipeline'))
from common import ll2xz, xz2ll


def reserve_passages(features):
    corridor = LineString([(-588,-212),(-582,-206),(-548,-202),(-534,-188),
                           (-534,-114),(-520,-100),(-486,-92)]).buffer(2,join_style='round')
    result = []
    for feature in features:
        rings = [[ll2xz(lat,lon) for lon,lat in ring] for ring in feature['geometry']['coordinates']]
        polygon = Polygon(rings[0],rings[1:])
        if not polygon.intersects(corridor):
            result.append(feature)
            continue
        remainder = polygon.difference(corridor)
        crossing = polygon.intersection(corridor)
        for index, cover in enumerate(getattr(crossing,'geoms',[crossing])):
            if cover.geom_type!='Polygon' or cover.area<4:
                continue
            rings = [[list(reversed(xz2ll(*vertex))) for vertex in ring.coords] for ring in [cover.exterior,*cover.interiors]]
            props = feature['properties']
            result.append({**feature,'properties':{**props,'kind':'covered_passage','name':f"{props['name']}-cover{index}"},'geometry':{'type':'Polygon','coordinates':rings}})
        parts = sorted(getattr(remainder,'geoms',[remainder]),key=lambda part:-part.area)
        for index, part in enumerate(parts):
            if part.geom_type!='Polygon' or part.area<4:
                continue
            name = feature['properties']['name'] + (f'-annex{index}' if index else '')
            coords = [[list(reversed(xz2ll(*point))) for point in ring.coords] for ring in [part.exterior,*part.interiors]]
            result.append({**feature,'properties':{**feature['properties'],'name':name},'geometry':{'type':'Polygon','coordinates':coords}})
    return result


if __name__=='__main__':
    path = root/'.ops-docs/layout/dongxi-infill.geojson'
    catalog = json.loads(path.read_text())
    catalog['features'] = reserve_passages(catalog['features'])
    path.write_text(json.dumps(catalog,ensure_ascii=False,separators=(',',':'))+'\n')

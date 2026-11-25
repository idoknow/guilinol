"""Read repository-native Overpass JSON and Overture TSV before going online."""
import csv
import json
import math
import re
import urllib.parse


def location(element):
    point = element.get('center', element)
    if 'lat' in point and 'lon' in point:
        return point['lat'], point['lon']
    bounds = element.get('bounds')
    if bounds:
        return ((bounds['minlat'] + bounds['maxlat']) / 2,
                (bounds['minlon'] + bounds['maxlon']) / 2)
    points = [p for p in element.get('geometry', []) if p]
    if points:
        return tuple((min(p[key] for p in points) + max(p[key] for p in points)) / 2
                     for key in ('lat', 'lon'))


def nearby(point, origin, radius):
    return point and math.hypot((point[0]-origin[0])*111320,
        (point[1]-origin[1])*111320*math.cos(math.radians(origin[0]))) <= radius


def overture(raw, origin, radius):
    count = 0
    with (raw/'overture_buildings.csv').open() as source:
        for row in csv.DictReader(source, delimiter='\t'):
            if any(nearby((float(lat), float(lon)), origin, radius)
                   for lon, lat in re.findall(r'([-\d.]+)\s+([-\d.]+)', row['wkt'])):
                count += 1
    return count


def osm(raw, origin, radius, target, http, endpoints):
    hits, errors = {}, []
    target_point = None
    sources = []
    def ingest(elements):
        nonlocal target_point
        for el in elements:
            key = f"{el['type']}/{el['id']}"
            point = location(el)
            if key == target and point:
                target_point = point
            tags = el.get('tags', {})
            if nearby(point, origin, radius) and (tags.get('name') or tags.get('building')):
                hits[key] = {'wgs84': point, 'tags': tags}

    for path in sorted(raw.glob('osm*.json'), reverse=True):
        try:
            with path.open() as source:
                ingest(json.load(source)['elements'])
            if hits or target_point:
                sources.append(path.name)
            if hits and (not target or target_point):
                break
        except (OSError, ValueError, KeyError) as exc:
            errors.append(f'{path.name}: {exc}')
    query = ''
    if not hits:
        area = f'(around:{radius},{origin[0]},{origin[1]})'
        query = f'node{area}[name];way{area}[building];way{area}[highway][name];'
    if target and not target_point:
        kind, number = target.split('/')
        query += f'{kind}({number});'
    if query:
        payload = urllib.parse.urlencode({'data': f'[out:json][timeout:10];({query});out center;'}).encode()
        for endpoint in endpoints:
            try:
                data = http.get_json(endpoint, timeout=12, data=payload)
                ingest(data['elements'])
                if not hits and not target_point:
                    raise ValueError(data.get('remark', 'no nearby features'))
                sources.append(endpoint)
                break
            except Exception as exc:
                errors.append(f'{endpoint}: {exc}')
    return {'status': 'ok' if hits else 'failed', 'reason': '; '.join(errors) or ('features found' if hits else 'empty'),
            'sources': sources, 'features': hits, 'target_wgs84': target_point}

import gzip
import json
from pathlib import Path

from shapely.geometry import LineString, Point
from common import load_osm
from features import area, points
from landmarks.world_surface import Surface


def main():
    root = Path(__file__).resolve().parents[1]
    schools = {'glmu_dongcheng','glut_primary','tianjiabing','chenshan_primary','lijiang_primary','longyin_primary'}
    elements = {f"{entry['type']}/{entry['id']}":entry for entry in load_osm()}
    roads = [LineString(points(entry)) for entry in elements.values() if entry.get('tags',{}).get('highway') in
             ('residential','tertiary','secondary','primary','living_street','unclassified','pedestrian')
             and entry['tags'].get('access') not in ('no','private') and len(points(entry))>1]
    atlas = json.loads(gzip.decompress((root/'public/world/atlas.bin').read_bytes()))
    surface = Surface()
    shots = {}
    for entry in json.loads((root/'pipeline/landmarks.json').read_text()):
        key = entry['id']
        if key not in schools:
            continue
        site = area(elements[entry['anchor']]); center = site.centroid
        place = next(place for place in atlas['places'] if place['n']==entry['name'])
        hint = Point(place['x'],place['z'])
        road = min((line for line in roads if line.disjoint(site.buffer(1))),key=hint.distance)
        along = road.project(hint)
        shots[key] = []
        for name,offset,height in [('street',0,2),('street-side',12,2),('oblique',0,19)]:
            if key=='lijiang_primary' and name!='street':continue
            station=along+offset if along+offset<=road.length else along-offset
            eye = road.interpolate(max(0,station)); assert site.disjoint(eye)
            ground=surface.sample(eye.x,eye.y)[0]
            shots[key].append([name,[eye.x,ground+height,eye.y],[center.x,ground+6,center.y]])
    output=root/'captures/h4-cameras.json'; output.parent.mkdir(exist_ok=True); output.write_text(json.dumps(shots))


if __name__=='__main__':main()

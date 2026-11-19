"""Inventory packed wall tangents against the nearest OSM road or water edge."""
import argparse
import json
import math
import subprocess
import sys
from pathlib import Path

import numpy as np
from shapely import STRtree
from shapely.geometry import LineString, Point

from common import ll2xz, load_osm
from features import area, points, polygons


ROOT = Path(__file__).resolve().parents[1]
PROBES = {'ronghu': [('library', -26, -50, 15), ('island', 99, 138, 12),
                     ('nine-bends', 90, 55, 15), ('ancient bridge', 31, 82, 12)],
          'gunanmen': [('gate', 0, 0, 13), ('Rong Hotel', 10, -51, 9)]}


def segments(osm):
    lines, names = [], []
    for key, element in osm.items():
        tags = element.get('tags', {})
        if 'highway' in tags:
            rings = [points(element)]
        elif tags.get('natural') == 'water':
            rings = [ring.coords for poly in polygons(area(element)) for ring in [poly.exterior, *poly.interiors]]
        else:
            continue
        for ring in rings:
            for first, last in zip(ring, list(ring)[1:]):
                if first != last:
                    lines.append(LineString([first, last]))
                    names.append(key)
    return lines, names, STRtree(lines)


def wall_axis(triangles, east, south, radius):
    center = triangles.mean(axis=1)
    faces = triangles[np.hypot(center[:,0]-east, center[:,2]-south) <= radius]
    normal = np.cross(faces[:,1]-faces[:,0], faces[:,2]-faces[:,0])
    horizontal = np.hypot(normal[:,0], normal[:,2])
    mask = (horizontal > 0.01) & (abs(normal[:,1]) < horizontal*.1)
    if not mask.any():
        return None
    angles = np.degrees(np.arctan2(normal[mask,2],normal[mask,0])) % 180
    bins = np.rint(angles).astype(int) % 180
    return np.bincount(bins, weights=horizontal[mask], minlength=180).argmax()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--strict', action='store_true')
    parser.add_argument('--baseline', type=Path, help='public directory from the unmodified revision')
    args = parser.parse_args()
    osm = {f"{item['type']}/{item['id']}": item for item in load_osm()}
    lines, names, index = segments(osm)
    failures = []
    print('|id / probe|root Y (°)|packed dominant wall before → after (°)|nearest OSM segment|segment bearing (°)|difference (°)|')
    print('|---|---:|---:|---|---:|---:|')
    for spec in json.loads((ROOT/'pipeline/landmarks.json').read_bytes()):
        anchor = spec['anchor']
        if isinstance(anchor, str):
            element = osm[anchor]
            shape = area(element)
            origin = (ll2xz(element['lat'], element['lon']) if element['type']=='node' else
                      shape.centroid.coords[0] if not shape.is_empty else points(element)[0])
        else:
            origin = ll2xz(anchor[1], anchor[0])
        yaw = spec.get('rotation', 0)
        model = ROOT/'public'/spec['model']
        faces = np.empty((0,3,3))
        if model.exists():
            raw = subprocess.check_output(['node', ROOT/'pipeline/glb-triangles.mjs', model, '--visible'])
            faces = np.frombuffer(raw, '<f4').reshape(-1,3,3)
        prior = None
        if args.baseline and (args.baseline/spec['model']).exists():
            raw = subprocess.check_output(['node', ROOT/'pipeline/glb-triangles.mjs', args.baseline/spec['model'], '--visible'])
            prior = np.frombuffer(raw, '<f4').reshape(-1,3,3)
        for label,east,south,radius in PROBES.get(spec['id'], [('',0,0,float('inf'))]):
            angle = math.radians(yaw)
            pos = Point(origin[0]+east*math.cos(angle)+south*math.sin(angle),
                        origin[1]-east*math.sin(angle)+south*math.cos(angle))
            nearest = index.nearest(pos)
            first, last = lines[nearest].coords
            bearing = math.degrees(math.atan2(last[0]-first[0], first[1]-last[1])) % 180
            axis = wall_axis(faces,east,south,radius)
            actual = (axis-yaw)%180 if axis is not None else None
            error = abs((actual-bearing+90)%180-90) if actual is not None else None
            key = ' '.join(filter(None, (spec['id'], label)))
            old_axis = wall_axis(prior,east,south,radius) if prior is not None else None
            before = round((old_axis-yaw)%180,2) if old_axis is not None else '—'
            if label=='nine-bends':
                sys.path.insert(0,str(ROOT/'pipeline/landmarks'))
                from rong_bridges import NINE_BENDS
                world = np.array(NINE_BENDS) + origin
                reference = np.array(points(osm['way/221475379']))[::-1]
                if world.shape != reference.shape or np.linalg.norm(world-reference,axis=1).max() > .15:
                    raise ValueError('Nine-bend bridge no longer follows its mapped vertices')
                delta = np.diff(world,axis=0); ref_delta = np.diff(reference,axis=0)
                actual = np.degrees(np.arctan2(delta[:,0], -delta[:,1]))%180
                target = np.degrees(np.arctan2(ref_delta[:,0], -ref_delta[:,1]))%180
                error = abs((actual-target+90)%180-90).max()
                if error > 5:
                    failures.append(key)
                print(f'|{key}|{yaw:g}|9 mapped spans|way/221475379|per-span|max {error:.2f}|')
                continue
            if error is None or error > 5:
                failures.append(key)
            print(f'|{key}|{yaw:g}|{before} → {round(actual,2) if actual is not None else "—"}|{names[nearest]}|{bearing:.2f}|{round(error,2) if error is not None else "—"}|')
    if args.strict and failures:
        raise SystemExit('Unresolved frontage or non-facade geometry: '+', '.join(failures))


if __name__ == '__main__':
    main()

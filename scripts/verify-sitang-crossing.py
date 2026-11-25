"""Survey the visible Sitang crossing and write reproducible 60 Hz drive fixtures."""
import argparse
import base64
import json
from pathlib import Path

import numpy as np
from shapely import LineString, Point, Polygon, STRtree

from canal_passages import sample_road_heights
from common import load_osm
from features import points
from surveyed_corridors import read_chunk


def chain(ways, ids):
    coordinates = points(ways[ids[0]])
    for wid in ids[1:]:
        other = points(ways[wid])
        if coordinates[-1] not in (other[0], other[-1]):
            coordinates = coordinates[::-1]
        if coordinates[-1] == other[-1]:
            other = other[::-1]
        assert coordinates[-1] == other[0]
        coordinates += other[1:]
    return LineString(coordinates)


def upper_surveys(world, manifest, native, original, ways, tunnel, routes):
    p, end = np.array(tunnel['portals'])[:, [0, 2]]
    along = (end - p) / tunnel['length']
    side = along[::-1] * [-1, 1]
    ss, levels = np.array(tunnel['stations']).T
    roofs = {}
    for wid, half in ((882310597, 7), (882310596, 2), (882310598, 7), (882310599, 2)):
        zone = LineString(points(ways[wid])).buffer(half, cap_style='flat')
        samples, required = [], []
        # Include the exact changes in the gauge at both carriageway edges.
        for offset in np.arange(-3.5, 3.501, .125):
            intersection = LineString([p+side*offset, end+side*offset]).intersection(zone)
            if not intersection.length:
                continue
            a, b = sorted((np.asarray(v)-p) @ along for v in intersection.coords)
            for d in np.linspace(a+.001, b-.001, int((b-a)/.05)+2):
                x, z = p + along*d + side*offset
                floor = np.interp(d, ss, levels) + offset*np.interp(d, ss, tunnel['crossfall'])
                required.append(floor + .3 + (3.5 if abs(offset) <= 3 else 3.))
                samples.append(dict(x=x, z=z, roofProbe=True))
        def heights(root, desc):
            return np.array([max(h for h in hit if h is not None)
                             for hit in sample_road_heights(root, desc, samples)])
        top = heights(world, manifest)
        roofs[wid] = dict(samples=len(samples), minimumMargin=float(np.min(top-required)),
                          maximumLift=float(np.max(top-heights(native, original))))

    for ids, offsets, extent in (((385795256, 882310597, 882310602), (-3.5, 0, 3.5), 110),
                                 ((385796479, 882310596, 1494503706), (0,), 61)):
        for offset in offsets:
            axis = chain(ways, ids).offset_curve(offset, join_style='mitre')
            center = axis.project(axis.intersection(LineString([p, end])).centroid)
            route = [[pt.x, pt.y, ids[1]] for d in np.linspace(-extent, extent, 13)
                     for pt in [axis.interpolate(center+d)]]
            modes = [dict(mode='car', route=r, direction=name)
                     for r, name in ((route, 'in'), (route[::-1], 'out'))]
            routes.append(dict(id=ids[1]*10+int(2*offset)+8, way=ids[1], modes=modes))
    return roofs


def bank_survey(world, manifest, ways, bore):
    a, b = points(ways[1097830334])[::-1]
    c, d = points(ways[1494508177])[::-1]
    path = np.array([a, b, c, d, points(ways[1494508178])[0]])
    delta = np.diff(path, axis=0)
    lengths = np.linalg.norm(delta, axis=1)
    tangent = delta / lengths[:, None]
    normal = tangent[:, ::-1] * [-1, 1]
    miter = np.vstack([normal[0], (normal[:-1]+normal[1:]) /
                       (1+(normal[:-1]*normal[1:]).sum(axis=1)[:, None]), normal[-1]])
    tile = next(t for t in manifest['chunks'] if t['x'] <= c[0] < t['x']+256
                and t['z'] <= c[1] < t['z']+256)
    collision = read_chunk(world/tile['file'])[3]
    # Match the float32 coordinates emitted by the street worker before
    # restoring the tile origin; gradients are measured in road-normal axes.
    packed = base64.b64decode(collision[1][12]['bank'])
    faces = (np.frombuffer(packed, '<i4').reshape(-1, 3, 3) / 1e6).astype('f4').astype(float)
    faces += [tile['x'], 0, tile['z']]
    xy = faces[:, :, [0, 2]]
    matrix = xy[:, 1:] - xy[:, :1]
    good = abs(np.linalg.det(matrix)) > 1e-9
    faces, xy, matrix = faces[good], xy[good], matrix[good]
    gradients = np.linalg.solve(matrix, (faces[:, 1:, 1]-faces[:, :1, 1])[..., None])[:, :, 0]
    index = STRtree([Polygon(tri) for tri in xy])
    ss, y = np.array(bore['stations']).T
    result = []
    for off in (-3.499, -3, -2.295, -1.5, -.705, 0, .705, 1.5, 2.295, 3, 3.499):
        at, crossfall, heights = [], [], []
        length = 0
        for k, t in enumerate(tangent):
            start = off*(miter[k] @ t)
            end = lengths[k]+off*(miter[k+1] @ t)
            for d in np.arange(start+.001, end, .02):
                p = path[k] + d*t + off*normal[k]
                if k == 0:
                    level, bank = 160.05, 0
                elif k == 3:
                    bank = np.interp(d, ss, bore['crossfall'])
                    level = np.interp(d, ss, y) + off*bank
                else:
                    hits = index.query(Point(p), predicate='intersects')
                    if not len(hits):
                        raise ValueError(f'Missing banked pavement at {p}')
                    levels = faces[hits, 0, 1] + ((p-xy[hits, 0])*gradients[hits]).sum(axis=1)
                    top = np.argmax(levels)
                    level, bank = levels[top], gradients[hits[top]] @ normal[k]
                at.append(length+d-start)
                crossfall.append(bank)
                heights.append(level)
            length += end-start
        at, bank, h = map(np.array, (at, crossfall, heights))
        result.append(dict(offset=off, samples=len(at), maximumBank=float(max(abs(bank))),
                           maximumBankChangePerMetre=float(max(abs(np.interp(at+1, at, bank)-bank))),
                           maximumGrade=float(max(abs(np.interp(at+1, at, h)-h)))))
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('native', type=Path)
    parser.add_argument('candidate', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    world, native = args.candidate.resolve(), args.native.resolve()
    manifest, original = [json.loads((p/'manifest.json').read_text()) for p in (world, native)]
    ways = {w['id']: w for w in load_osm() if w['type'] == 'way'}
    bore = next(t for t in manifest['tunnels'] if t['way'] == 1494508178)
    routes = [s for s in json.loads((world/'vehicle-portal-routes.json').read_text())
              if s['id'] in (13694473829, 13694473830)]
    assert len(routes) == 2
    for site in routes:
        car = [r for r in site['modes'] if r['mode'] == 'car']
        assert {r['direction'] for r in car} == {'in', 'out'}
        site['modes'] = [dict(r, mode=mode) for r in car for mode in ('car', 'bike', 'bicycle')]
    roofs = upper_surveys(world, manifest, native, original, ways, bore, routes)
    rows = [r for site in routes for r in site['modes']]
    probes = [dict(x=r['route'][0][0], z=r['route'][0][1], way=r['route'][0][2]) for r in rows]
    for row, height in zip(rows, sample_road_heights(world, manifest, probes), strict=True):
        row['startHeight'] = height
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output/'routes.json').write_text(json.dumps(routes))
    bank = bank_survey(world, manifest, ways, bore)
    (args.output/'survey.json').write_text(json.dumps(dict(roofs=roofs, bank=bank), indent=2))
    if any(r['minimumMargin'] < 0 for r in roofs.values()) or roofs[882310597]['maximumLift'] > .6 or roofs[882310596]['maximumLift'] > 3:
        raise SystemExit('Sitang roof or lift outside the approved section')
    if any(r['maximumBank'] > .04 or r['maximumBankChangePerMetre'] > .005 or r['maximumGrade'] > .08 for r in bank):
        raise SystemExit('Sitang pavement grade outside the approved section')

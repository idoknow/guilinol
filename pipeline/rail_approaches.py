"""Compare the encoded railhead to the rendered floors, shoulder and curb triangles."""
import json
from pathlib import Path
import subprocess

import numpy as np
from shapely import LineString, Point, Polygon, STRtree, union_all
from shapely.ops import substring

from check_rail_stack import elevation, track_pieces
from common import load_osm
from features import points

ROOT = Path(__file__).resolve().parents[1]


def crossings(sections):
    inventory = json.loads((ROOT / 'docs/railway-crossings.json').read_bytes())
    ways = {w['id']: w for w in load_osm() if w['type'] == 'way' and w.get('geometry')}
    pairs = {}
    for name, design in sections.items():
        # Some crossings sit on unchanged chords beyond the active rail profile.
        ties = {**design['railTies'], **design.get('approachRailTies', {})}
        for key, limits in ties.items():
            rail = int(key)
            line = LineString(points(ways[rail]))
            part = substring(line, *sorted(limits))
            for row in inventory:
                if row['rail'] != rail or row['type'] != 'rail_over' or row['status'] != 'active':
                    continue
                road = row['road']
                axis = LineString(points(ways[road]))
                if part.intersects(axis):
                    pairs[rail, road] = (name, line, axis, ways[road]['tags'])
    return pairs


def measure(world, sections, *, exclude=()):
    manifest = json.loads((world / 'manifest.json').read_bytes())
    rules = json.loads((ROOT / 'pipeline/streets.json').read_bytes())
    probes = []
    for (rail, road), (name, line, axis, tags) in crossings(sections).items():
        if (rail, road) in exclude:
            continue
        p = axis.intersection(line)
        strips = [b for b in manifest['tunnels'] if b['way'] == road]
        near = next((b for b in strips if LineString(
            [(x, z) for x, _, z in b['portals']]
        ).distance(p) < .002), None)
        if near is None and tags.get("tunnel") == "yes":
            raise ValueError(f"Missing covered road at {rail}/{road}")
        if near is None:
            from station_roads import half_width
            width = half_width({"tags": tags})
        else:
            width = near["halfWidth"]
        # Covered bores stop at the inside face of the wall. For surface roads,
        # include the lateral verge, cycle lane and outer curb where present.
        if near is None or near.get('openCut'):
            section = rules['sections'].get(rules['sectionClasses'].get(tags['highway']), {})
            width += max(2., sum(section.get(key, 0.) for key in ('verge','cycle','curb')))
        road_band = axis.buffer(width, cap_style="flat")
        footprint = road_band.intersection(line.buffer(2.05, cap_style="flat"))
        probes.append((name, rail, road, line, footprint, width, road_band))
    out = subprocess.check_output([ROOT/'node_modules/.bin/tsx', ROOT/'scripts/approach-faces.ts', world],
                                  input=json.dumps([list(p[4].buffer(2.06).bounds) for p in probes]).encode())
    faces = [json.loads(l) for l in out.splitlines()]
    polygons = [Polygon([(x,z) for x,_,z in v]) for _,v in faces]
    tree = STRtree(polygons)
    results = []
    for name, rail, road, line, footprint, width, road_band in probes:
        rails = track_pieces(world,manifest,line,footprint.buffer(2.06))
        deck = union_all([piece[0].buffer(2.05,cap_style="flat") for piece in rails])
        spine = union_all([piece[0] for piece in rails])
        if not spine.buffer(.002).covers(line.intersection(road_band)):
            raise ValueError(f"Incomplete encoded railway at {rail}/{road}")
        # The renderer emits one rectangular soffit per encoded chord. A round
        # GIS buffer adds an unbuilt sector on the outside of every bend.
        footprint = road_band.intersection(deck)
        minimum, worst, count = float('inf'), None, 0
        for i in tree.query(footprint, predicate='intersects'):
            poly = polygons[i]
            if poly.area < 1e-9:
                continue  # Horizontal curb tops include the upper edges of their vertical faces.
            role, coords = faces[i]
            a,b,c = np.asarray(coords)
            plane = np.linalg.solve(np.array([(b-a)[[0,2]],(c-a)[[0,2]]]), [b[1]-a[1],c[1]-a[1]])
            lower = poly.intersection(footprint)
            for piece in rails:
                overlap = lower.intersection(piece[0].buffer(2.05,cap_style='flat'))
                if overlap.is_empty or overlap.area < 1e-10: continue
                count += 1
                parts = getattr(overlap, "geoms", (overlap,))
                corners = (xy for part in parts if part.geom_type == "Polygon" for xy in part.exterior.coords)
                for x,z in corners:
                    y = a[1] + plane @ [x-a[0],z-a[2]]
                    gap = elevation(piece,Point(x,z))-y
                    if gap < minimum:
                        minimum, worst = gap, dict(role=role,x=x,z=z,y=y)
        if not count: raise ValueError(f'No rendered road below {rail} at {road}')
        results.append(dict(section=name,upper=rail,lower=road,halfWidthM=width,faces=count,
                            minimumM=minimum,targetM=5.7,worst=worst))
    return results

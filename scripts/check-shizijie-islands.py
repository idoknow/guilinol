"""Verify the four Shizijie refuge islands AND B1 underground passage connectivity."""
import json
import math
import sys
from pathlib import Path

from shapely.affinity import rotate, translate
from shapely.geometry import LineString, Point, Polygon, box
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'pipeline/landmarks'))
from shizijie_layout import KIOSK_CENTER, islands, surfaces


def check_islands():
    road, sidewalk = surfaces()
    curbs = road.union(sidewalk)
    island_list = islands()
    for corner, island in zip(('NW', 'NE', 'SE', 'SW'), island_list, strict=True):
        vertices = list(island.simplify(.04).exterior.coords)
        aligned = []
        for start, end in zip(vertices, vertices[1:]):
            edge = LineString([start, end])
            if edge.length < 1:
                continue
            distances = [curbs.distance(edge.interpolate(fraction, normalized=True)) for fraction in (.1, .5, .9)]
            if max(distances) <= 1:
                aligned.append(round(max(distances), 2))
        assert island.distance(curbs) >= .39 and len(aligned) >= 2, (corner, aligned)
        print(corner, 'area', round(island.area, 2), 'm²; curb distances', aligned)

    kiosk = translate(rotate(box(-1.95, -1.65, 1.95, 1.65), .55, use_radians=True), *KIOSK_CENTER)
    ne_island = island_list[1]
    assert ne_island.contains(Point(KIOSK_CENTER)), 'NE booth center is outside its island'
    overlap_ratio = kiosk.intersection(ne_island).area / kiosk.area
    assert overlap_ratio >= 0.85, f'NE booth roof overlap too low: {overlap_ratio:.3f}'
    if not ne_island.covers(kiosk):
        print(f'NOTE: NE booth roof eaves overhang 0.4m curb inset by {kiosk.difference(ne_island).area:.2f} m² (overlap {overlap_ratio:.1%})')


def _to_world_xz(pt, origin):
    x, z = float(pt[0]), float(pt[1])
    if math.hypot(x, z) < 250.0:
        return (x + origin[0], z + origin[2])
    return (x, z)


def check_underground_connectivity():
    manifest_path = ROOT / 'public/world/manifest.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    ug = manifest.get('shizijieUnderpass')
    cutouts = manifest.get('groundCutouts', [])
    assert ug and isinstance(ug, dict), 'manifest.json missing shizijieUnderpass'
    stairs = ug.get('stairs', [])
    assert len(stairs) >= 2, f'expected >=2 underground stairs, got {len(stairs)}'
    assert len(cutouts) >= len(stairs), f'groundCutouts ({len(cutouts)}) < stairs ({len(stairs)})'

    floor_y = float(ug['floorY'])
    ceil_h = float(ug.get('ceilingHeight', 3.15))
    assert math.isfinite(floor_y) and 2.5 <= ceil_h <= 6.0, (floor_y, ceil_h)

    walk_parts = []
    ring_poly = Polygon(ug['ringPolygon']).buffer(0)
    assert ring_poly.is_valid and ring_poly.area > 50.0, 'invalid shizijie ringPolygon'
    ring_hw = float(ug.get('ringHalfWidth', 2.8))
    walk_parts.append(ring_poly.buffer(ring_hw))

    for seg in [*ug.get('corridors', []), *ug.get('connectors', [])]:
        pts = seg.get('points', [])
        if len(pts) >= 2:
            walk_parts.append(LineString(pts).buffer(float(seg.get('halfWidth', 2.0))))

    for st in stairs:
        depth = float(st['topY']) - float(st['floorY'])
        assert 3.0 <= depth <= 5.5, f"stair {st['id']} depth out of range: {depth}"
        assert float(st['width']) >= 2.5 and float(st['length']) >= 6.0, f"stair {st['id']} too narrow/short"
        deep = st['deep']
        walk_parts.append(Point(deep[0], deep[2]).buffer(float(st['width']) * 0.5))

    walkable_union = unary_union(walk_parts).buffer(0)
    components = list(getattr(walkable_union, 'geoms', [walkable_union]))
    assert len(components) >= 1, 'empty underground walkable union'

    stair_components = {}
    for st in stairs:
        deep_pt = Point(st['deep'][0], st['deep'][2])
        owner = next((idx for idx, comp in enumerate(components) if comp.buffer(0.05).contains(deep_pt)), None)
        assert owner is not None, f"stair {st['id']} deep endpoint not inside walkable underground area"
        stair_components[st['id']] = owner

    unique_components = set(stair_components.values())
    assert len(unique_components) == 1, f'disconnected underground entrances: {stair_components}'
    main_comp = components[next(iter(unique_components))]
    assert main_comp.contains(Point(ug['center'][0], ug['center'][2])), 'underground center not inside connected walkable component'
    print(
        f"Underground manifest connectivity OK: {len(stairs)}/{len(stairs)} stairs in 1 component "
        f"(floorY={floor_y:.2f}m, ceil={ceil_h:.2f}m, walkable={main_comp.area:.1f} m²)"
    )

    # Also validate shizijie.json landmark underground schema when populated
    landmark_json = ROOT / 'public/landmarks/shizijie.json'
    if landmark_json.exists():
        meta = json.loads(landmark_json.read_text(encoding='utf-8'))
        lm_ug = meta.get('underground')
        if isinstance(lm_ug, dict):
            origin = lm_ug.get('origin') or ug['center']
            entrances = lm_ug.get('entrances', [])
            walk_poly_raw = lm_ug.get('walkPolygon') or lm_ug.get('ringPolygon') or []
            assert len(entrances) >= 2, f'shizijie.json underground entrances < 2: {len(entrances)}'
            assert math.isfinite(float(lm_ug['floorY'])), 'shizijie.json underground floorY invalid'
            assert len(walk_poly_raw) >= 3, 'shizijie.json underground walkPolygon < 3 pts'
            lm_poly = Polygon([_to_world_xz(p, origin) for p in walk_poly_raw]).buffer(0)
            assert lm_poly.is_valid and lm_poly.area > 10.0, 'shizijie.json walkPolygon invalid'
            print(f'shizijie.json underground OK: {len(entrances)} entrances, walkPolygon={lm_poly.area:.1f} m²')
        else:
            print('shizijie.json underground: not yet populated (manifest fallback active)')


if __name__ == '__main__':
    check_islands()
    check_underground_connectivity()

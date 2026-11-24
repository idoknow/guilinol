"""Inventory rail/highway way intersections within the published play boundary."""
import json
from pathlib import Path

from shapely import STRtree
from shapely.geometry import LineString

from common import ll2xz, load_osm, xz2ll
from play_region import PlayRegion


def intersections(geometry):
    if geometry.is_empty:
        return
    if geometry.geom_type in ('Point', 'LineString'):
        yield geometry
    else:
        for part in geometry.geoms:
            yield from intersections(part)


def level(tags):
    if 'layer' in tags:
        try:
            return int(tags['layer'])
        except ValueError:
            return None
    bridge = tags.get('bridge', 'no') != 'no'
    tunnel = tags.get('tunnel', 'no') != 'no'
    return int(bridge) - int(tunnel)


def inventory(elements, region, node_evidence):
    roads, tracks = [], []
    for way in elements:
        tags = way.get('tags', {})
        if way['type'] != 'way' or not ('highway' in tags or tags.get('railway') == 'rail'):
            continue
        coords = [ll2xz(p['lat'], p['lon']) for p in way['geometry']]
        line = LineString(coords)
        if not region.intersects(line):
            continue
        item = way, line, dict(zip(coords, way['nodes']))
        if 'highway' in tags:
            roads.append(item)
        if tags.get('railway') == 'rail':
            tracks.append(item)

    tree = STRtree([line for _, line, _ in roads])
    rows = []
    for rail, line, rail_nodes in tracks:
        for index in sorted(tree.query(line, predicate='intersects')):
            road, street, road_nodes = roads[index]
            for hit in intersections(region.intersection(line.intersection(street))):
                p = hit.representative_point()
                coords = (p.x, p.y)
                shared = rail_nodes.get(coords)
                if road_nodes.get(coords) != shared:
                    shared = None
                rt, ht = rail['tags'], road['tags']
                r, h = level(rt), level(ht)
                evidence = node_evidence.get(str(shared))
                kind = None
                if shared:
                    kind = 'level'
                    tag = (evidence or {}).get('railway')
                    reason = f'railway={tag}' if tag else '无标签，按共享节点推定'
                elif None not in (r, h) and r != h:
                    kind = 'rail_over' if r > h else 'road_over'
                    reason = f'层级（铁路 {r}，道路 {h}）'
                elif ht.get('tunnel') == 'yes' and rt.get('tunnel', 'no') == 'no':
                    kind = 'rail_over'
                    reason = '道路 tunnel=yes，铁路无隧道标签'
                else:
                    reason = '未共享节点，缺少上下层证据'
                lat, lon = xz2ll(*coords)
                rows.append(dict(rail=rail['id'], road=road['id'], railTags=rt, roadTags=ht,
                                 lat=round(lat, 7), lon=round(lon, 7), sharedNode=shared,
                                 geometry=hit.geom_type, type=kind, evidence=reason,
                                 nodeEvidence=evidence, measuredClearance=None))
    return sorted(rows, key=lambda row: (row['rail'], row['road'], row['lat'], row['lon']))


if __name__ == '__main__':
    docs = Path(__file__).resolve().parents[1] / 'docs'
    # The source PBF export omitted railway crossing nodes. Supplement only the
    # shared node IDs, using versioned evidence from the OSM nodes API.
    evidence = json.loads(Path(__file__).with_name('railway-crossing-nodes.json').read_text())
    rows = inventory(load_osm(), PlayRegion().geometry, evidence)
    (docs / 'railway-crossings.json').write_text(json.dumps(rows, ensure_ascii=False, indent=2) + '\n')
    lines = ['# 可玩区路铁交点', '', '来源为 raw-expanded-20261124。每行对应一对 way 的一个相交分量。同一地点可能有多条股道或道路分段。JSON 保留双方标签。净空待世界几何生成后实测。', '',
             '| 铁路 way | 道路 way | 纬度 | 经度 | 共享节点及版本 | type | 证据 |',
             '|---:|---:|---:|---:|---:|---|---|']
    for row in rows:
        node = '—'
        if row['sharedNode']:
            node = f"{row['sharedNode']} v{row['nodeEvidence']['version']}"
        lines.append(f"| {row['rail']} | {row['road']} | {row['lat']:.7f} | {row['lon']:.7f} | "
                     f"{node} | {row['type'] or '待裁定'} | {row['evidence']} |")
    (docs / 'railway-crossings.md').write_text('\n'.join(lines) + '\n')

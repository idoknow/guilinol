"""Inventory rail/highway way intersections within the published play boundary."""
import argparse
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
                node_tag = (evidence or {}).get('railway')
                structure = [int(tags.get('bridge', 'no') != 'no') -
                             int(tags.get('tunnel', 'no') != 'no') for tags in (rt, ht)]
                structured = any(tags.get(key, 'no') != 'no' for tags in (rt, ht)
                                 for key in ('bridge', 'tunnel'))
                different_layers = None not in (r, h) and r != h
                if shared and (node_tag in ('level_crossing', 'crossing') or
                               not (structured or different_layers)):
                    kind = 'level'
                    reason = f'railway={node_tag}' if node_tag else '无标签，按共享节点推定'
                elif different_layers:
                    kind = 'rail_over' if r > h else 'road_over'
                    reason = f'层级（铁路 {r}，道路 {h}）'
                elif structure[0] != structure[1]:
                    kind = 'rail_over' if structure[0] > structure[1] else 'road_over'
                    reason = '按桥隧标签确定上下层'
                elif structured and shared:
                    raise ValueError(f'上下层无法确定：节点 {shared}，铁路 {rail["id"]}，道路 {road["id"]}')
                else:
                    reason = '未共享节点，缺少上下层证据'
                if shared and kind in ('rail_over', 'road_over'):
                    reason += '；共享节点无平交标签'
                status = 'active'
                if road['id'] == 727929887 and kind == 'rail_over':
                    status = 'pending_road_tunnel'
                    reason += '；下穿道路尚缺独立结构，净空待验'
                elif road['id'] in (1030067842, 1030067843) and ht['highway'] == 'construction':
                    status = 'construction_unverified'
                    reason = '施工道路，交叉形式待核'
                lat, lon = xz2ll(*coords)
                rows.append(dict(rail=rail['id'], road=road['id'], railTags=rt, roadTags=ht,
                                 lat=round(lat, 7), lon=round(lon, 7), sharedNode=shared,
                                 geometry=hit.geom_type, type=kind, status=status, evidence=reason,
                                 nodeEvidence=evidence, measuredClearance=None))
    return sorted(rows, key=lambda row: (row['rail'], row['road'], row['lat'], row['lon']))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--geometry-report', type=Path, help='Add baked track and road heights at each centerline intersection')
    args = parser.parse_args()
    docs = Path(__file__).resolve().parents[1] / 'docs'
    # The source PBF export omitted railway crossing nodes. Supplement only the
    # shared node IDs, using versioned evidence from the OSM nodes API.
    evidence = json.loads(Path(__file__).with_name('railway-crossing-nodes.json').read_text())
    rows = inventory(load_osm(), PlayRegion().geometry, evidence)
    review=json.loads(Path(__file__).with_name('railway-review.json').read_bytes())
    for row in rows:
        reason=review['baselineLevelFailures'].get(str(row['sharedNode']))
        if reason:
            row['baselineFailure']=reason
            row['evidence']+='；既有穿越失败：'+reason
        if row['sharedNode'] in review['insideBuilding']:
            row['accessoryStatus']='inside_building'
            row['evidence']+='；inside_building，道口附件豁免'
    if args.geometry_report:
        from shapely.geometry import Point
        from collections import defaultdict
        by_pair = defaultdict(list)
        report=json.loads(args.geometry_report.read_bytes())
        conflicts={(c['rail'],c['road'],c['lat'],c['lon']):c for c in report['clearanceConflicts']}
        for point in report['crossings']:
            by_pair[point['rail'], point['road']].append(point)
        for row in rows:
            if row['status'] == 'construction_unverified':
                continue
            position = Point(ll2xz(row['lat'],row['lon']))
            def distance(point):
                return position.distance(Point(point['x'],point['z']))
            point = min(by_pair[row['rail'],row['road']],key=distance)
            if distance(point) > .025:
                raise ValueError(f"Absent geometry for {row['rail']} / {row['road']}")
            row.update(railY=point['railY'], roadY=point['roadY'], designClearanceM=point['clearanceM'])
            row['surfaceSource']=point['surfaceSource']
            if row['status']=='pending_road_tunnel' and point['surfaceSource']=='tunnel_profile':
                row['status']='active'
                row['evidence']=row['evidence'].replace('下穿道路尚缺独立结构，净空待验','下穿路面按生成的隧道纵断面实测')
            if point['roadStructureDependency']:
                row['status']='pending_road_structure'
                row['deferredRoad']=point['roadStructureDependency']
                row['evidence']+=f"；道路 {row['deferredRoad']} 的结构生成后复验"
            conflict=conflicts.get((row['rail'],row['road'],row['lat'],row['lon']))
            if conflict:
                row['clearanceConflict']={k:v for k,v in conflict.items() if k not in ('rail','road','lat','lon','type')}
    (docs / 'railway-crossings.json').write_text(json.dumps(rows, ensure_ascii=False, indent=2) + '\n')
    lines = ['# 可玩区路铁交点', '', '来源为 raw-expanded-20261124。每行对应一对 way 的一个相交分量。同一地点可能有多条股道或道路分段。JSON 保留双方标签。设计净空取中心线交点处的轨面、路面和梁底高程（铁路梁高 1.20 m，道路薄桥 0.60 m），单位 m。JSON 的 clearanceConflict.shortfallM 表示当前模型低于设计净空的米数。terrain_proxy 表示下层路面尚缺独立高程证据。全宽最小净空仍待实测。', '',
             '| 铁路 way | 道路 way | 纬度 | 经度 | 共享节点及版本 | type | 验收状态 | 设计净空 m | 证据 |',
             '|---:|---:|---:|---:|---:|---|---|---:|---|']
    for row in rows:
        node = '—'
        if row['sharedNode']:
            node = f"{row['sharedNode']} v{row['nodeEvidence']['version']}"
        value=row.get('designClearanceM')
        clearance='—' if value is None else f'{value:.3f}'
        if 'clearanceConflict' in row:
            clearance+=f"（缺 {row['clearanceConflict']['shortfallM']:.3f}）"
        lines.append(f"| {row['rail']} | {row['road']} | {row['lat']:.7f} | {row['lon']:.7f} | "
                     f"{node} | {row['type'] or '待裁定'} | {row['status']} | {clearance} | {row['evidence']} |")
    (docs / 'railway-crossings.md').write_text('\n'.join(lines) + '\n')

"""Refresh the processed regional snapshot from an offline OSM extract (optional pyosmium)."""
import argparse
from pathlib import Path

import osmium

from overview_map import BBOX, SNAPSHOT, compile_map


def extract(pbf, node_file):
    south, west, north, east = BBOX
    local = osmium.IdTracker()
    if node_file:
        for line in node_file.read_text().splitlines(): local.add_node(int(line))
    else:
        for node in osmium.FileProcessor(pbf, osmium.osm.NODE):
            if south <= node.location.lat <= north and west <= node.location.lon <= east: local.add_node(node.id)
    ways, relations, ring_ids = {}, [], set()
    needed = osmium.IdTracker()
    def way_record(way):
        needed.add_references(way)
        return dict(type='way',id=way.id,tags=dict(way.tags),refs=[node.ref for node in way.nodes])
    def water(tags):
        return tags.get('natural') == 'water' or 'water' in tags or tags.get('waterway') == 'riverbank'
    touched = osmium.IdTracker()
    for way in osmium.FileProcessor(pbf,osmium.osm.WAY).with_filter(local.contains_filter()):
        touched.add_way(way.id)
        if water(way.tags) or way.tags.get('highway','').removesuffix('_link') in ('motorway','trunk','primary','secondary'):
            ways[way.id] = way_record(way)
    missing = set()
    for relation in osmium.FileProcessor(pbf,osmium.osm.RELATION).with_filter(touched.contains_filter()):
        if relation.tags.get('ref') == 'S2201' and relation.tags.get('route') == 'road':
            ring_ids.update(member.ref for member in relation.members if member.type=='w')
        if water(relation.tags):
            members = [dict(ref=m.ref,role=m.role) for m in relation.members if m.type=='w' and m.role in ('outer','inner')]
            missing.update(m['ref'] for m in members if m['ref'] not in ways)
            relations.append(dict(type='relation',tags=dict(relation.tags),members=members))
    for way in osmium.FileProcessor(pbf,osmium.osm.WAY).with_filter(osmium.filter.IdFilter(missing)):
        ways[way.id] = way_record(way)
    points = {node.id:dict(lat=node.location.lat,lon=node.location.lon) for node in osmium.FileProcessor(pbf,osmium.osm.NODE).with_filter(needed.id_filter())}
    for way in ways.values(): way['geometry'] = [points[ref] for ref in way.pop('refs')]
    for relation in relations:
        for member in relation['members']: member['geometry'] = ways[member['ref']]['geometry']
    nodes = [dict(type='node',tags=dict(node.tags),lat=node.location.lat,lon=node.location.lon) for node in
             osmium.FileProcessor(pbf,osmium.osm.NODE).with_filter(local.id_filter()).with_filter(osmium.filter.KeyFilter('place','tourism','historic','natural'))]
    return compile_map([*ways.values(),*relations,*nodes],ring_ids)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('pbf', type=Path)
    parser.add_argument('--node-ids', type=Path, help='optional prefiltered bbox node IDs, one per line')
    args = parser.parse_args()
    SNAPSHOT.write_bytes(extract(args.pbf,args.node_ids))

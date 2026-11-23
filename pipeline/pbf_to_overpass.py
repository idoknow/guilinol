"""Convert a Geofabrik .osm.pbf into the Overpass `out body geom` JSON that guilinol's
raw/osm-2026-11.json expects, for the handoff query (raw/q.txt + refresh_osm.NODES).
Used on sg for IDOK-114 because public Overpass instances were returning 502/504."""
import json, sys
import osmium

from prepare_expansion import SOUTH as S, WEST as W, NORTH as N, EAST as E
pbf, out = sys.argv[1], sys.argv[2]

WAY_KEYS = ['building', 'highway', 'natural', 'waterway', 'water', 'leisure', 'landuse',
            'railway', 'bridge', 'man_made', 'tourism', 'historic', 'amenity']
REL_KEYS = ['building', 'natural', 'waterway', 'water', 'leisure', 'landuse']
NODE_KEYS = ['tourism', 'historic', 'place', 'amenity', 'shop', 'barrier']
NODE_KV = {('natural', 'peak'), ('railway', 'station'), ('natural', 'tree')}
CROSS = {'crossing', 'traffic_signals', 'bus_stop', 'street_lamp'}

def inside(lat, lon):
    return S <= lat <= N and W <= lon <= E

def node_match(t):
    return any(k in t for k in NODE_KEYS) or any(t.get(k) == v for k, v in NODE_KV) or t.get('highway') in CROSS

def tags(o):
    return {t.k: t.v for t in o.tags}

# pass 1: nodes in bbox + matching tagged nodes
bbox_nodes, out_nodes = set(), {}
for n in osmium.FileProcessor(pbf, osmium.osm.NODE):
    if n.location.valid() and inside(n.location.lat, n.location.lon):
        bbox_nodes.add(n.id)
        if len(n.tags):
            t = tags(n)
            if node_match(t):
                out_nodes[n.id] = {'type': 'node', 'id': n.id, 'lat': round(n.location.lat, 7), 'lon': round(n.location.lon, 7), 'tags': t}
print('nodes in bbox', len(bbox_nodes), 'tagged out', len(out_nodes), file=sys.stderr, flush=True)

# pass 2: ways touching bbox; matching ways; relations
touch_ways, sel_ways, way_nodes, sel_rels = set(), {}, {}, {}
for o in osmium.FileProcessor(pbf, osmium.osm.WAY | osmium.osm.RELATION):
    if isinstance(o, osmium.osm.Way):
        refs = [r.ref for r in o.nodes]
        if any(r in bbox_nodes for r in refs):
            touch_ways.add(o.id)
            t = tags(o)
            if any(k in t for k in WAY_KEYS):
                sel_ways[o.id] = t
                way_nodes[o.id] = refs
    else:
        t = tags(o)
        if not any(k in t for k in REL_KEYS):
            continue
        mem = [(m.type, m.ref, m.role) for m in o.members]
        if any((ty == 'w' and ref in touch_ways) or (ty == 'n' and ref in bbox_nodes) for ty, ref, _ in mem):
            sel_rels[o.id] = (t, mem)
print('ways', len(sel_ways), 'rels', len(sel_rels), file=sys.stderr, flush=True)

# pass 3: node lists for relation member ways not yet loaded
need_w = {ref for _, mem in sel_rels.values() for ty, ref, _ in mem if ty == 'w'} - way_nodes.keys()
for w in osmium.FileProcessor(pbf, osmium.osm.WAY):
    if w.id in need_w:
        way_nodes[w.id] = [r.ref for r in w.nodes]
need_n = {r for refs in way_nodes.values() for r in refs} | {ref for _, mem in sel_rels.values() for ty, ref, _ in mem if ty == 'n'}
loc = {}
for n in osmium.FileProcessor(pbf, osmium.osm.NODE):
    if n.id in need_n and n.location.valid():
        loc[n.id] = {'lat': round(n.location.lat, 7), 'lon': round(n.location.lon, 7)}
print('member ways', len(need_w), 'locations', len(loc), '/', len(need_n), file=sys.stderr, flush=True)

def bounds(pts):
    pts = [p for p in pts if p]
    return {'minlat': min(p['lat'] for p in pts), 'minlon': min(p['lon'] for p in pts),
            'maxlat': max(p['lat'] for p in pts), 'maxlon': max(p['lon'] for p in pts)}

elements = {('node', i): e for i, e in out_nodes.items()}
for i, t in sel_ways.items():
    g = [loc.get(r) for r in way_nodes[i]]
    elements[('way', i)] = {'type': 'way', 'id': i, 'bounds': bounds(g), 'nodes': way_nodes[i], 'geometry': g, 'tags': t}
TY = {'n': 'node', 'w': 'way', 'r': 'relation'}
for i, (t, mem) in sel_rels.items():
    members, pts = [], []
    for ty, ref, role in mem:
        m = {'type': TY[ty], 'ref': ref, 'role': role}
        if ty == 'w' and ref in way_nodes:
            m['geometry'] = [loc.get(r) for r in way_nodes[ref]]
            pts += m['geometry']
        elif ty == 'n' and ref in loc:
            m.update(loc[ref]); pts.append(loc[ref])
        members.append(m)
    e = {'type': 'relation', 'id': i, 'members': members, 'tags': t}
    if pts:
        e['bounds'] = bounds(pts)
    elements[('relation', i)] = e
payload = json.dumps({'elements': [elements[k] for k in sorted(elements)]},
                     ensure_ascii=False, sort_keys=True, separators=(',', ':'))
open(out, 'w').write(payload)
print('elements', len(elements), file=sys.stderr)

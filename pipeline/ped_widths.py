"""Measure walk clearances on GL04 faces. Samples use millimetres; invalid stations use null."""
import argparse
import gzip
import json
import math
from pathlib import Path

import shapely
from shapely import LineString, Point, STRtree

from npc_sidewalks import sidewalk_faces


def widths(tree, point, normal):
    radius = 4
    while True:
        ray = LineString([(point.x + direction * radius * normal[0], point.y + direction * radius * normal[1])
                          for direction in (-1, 1)])
        hits = tree.query(ray, predicate='intersects')
        clipped = shapely.intersection(tree.geometries.take(hits), ray)
        merged = shapely.line_merge(shapely.union_all(clipped))
        for interval in shapely.get_parts(merged):
            if interval.length == 0 or interval.distance(point) > 1e-7:
                continue
            offsets = [(east-point.x)*normal[0] + (south-point.y)*normal[1] for east, south in interval.coords]
            left, right = -min(offsets), max(offsets)
            if max(left, right) < radius-1e-7:
                return [max(0, round(left*1000)), max(0, round(right*1000))]
            break
        else:
            return None
        radius *= 2


def profile(tree, coords):
    east, south, last_east, last_south = coords
    length = math.hypot(last_east-east, last_south-south)
    tangent = ((last_east-east)/length, (last_south-south)/length)
    stations = [min(index*2, length) for index in range(math.ceil(length/2)+1)]
    samples = [widths(tree, Point(east+tangent[0]*dist, south+tangent[1]*dist), (-tangent[1], tangent[0]))
               for dist in stations]
    spans = []
    index = 0
    while index < len(samples):
        if samples[index] is None or sum(samples[index]) >= 1050:
            index += 1
            continue
        first = index
        while index < len(samples) and samples[index] is not None and sum(samples[index]) < 1050:
            index += 1
        last = index-1
        before = first-1 if first and samples[first-1] is not None else None
        after = index if index < len(samples) and samples[index] is not None else None
        spans.append([first,last,before,after])
    return [samples, spans]


def annotate_widths(world, graph, manifest):
    tree = STRtree(list(sidewalk_faces(world, manifest)))
    report = []
    for lane in graph['lanes']:
        if not lane.get('npcWalks'):
            continue
        lane['pedProfiles'] = []
        for index, coords in enumerate(lane['npcWalks']):
            samples, spans = profile(tree, coords)
            lane['pedProfiles'].append([samples,spans])
            for first,last,before,after in spans:
                report.append(dict(lane=lane['id'],track=index,ends=coords,first=first,last=last,
                                   minWidthMm=min(sum(sample) for sample in samples[first:last+1]),wait=[before,after]))
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('world', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('report', type=Path)
    args = parser.parse_args()
    graph = json.loads(gzip.decompress((args.world/'roads/graph.json.gz').read_bytes()))
    report = annotate_widths(args.world, graph, json.loads((args.world/'manifest.json').read_bytes()))
    args.report.write_text(json.dumps(report,separators=(',',':')))
    args.output.write_bytes(gzip.compress(json.dumps(graph,ensure_ascii=False,separators=(',',':')).encode(),mtime=0))

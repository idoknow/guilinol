"""Keep opposing one-way bores inside their respective carriageways."""
from dataclasses import replace

from shapely import LineString, STRtree

from features import points
from road_profile import RULES, pair_carriageways, profile


def bore_widths(ways, road_ids):
    candidates = []
    empty = STRtree([])
    for wid in road_ids:
        way = ways[wid]
        tags = way['tags']
        if tags.get('tunnel','no')=='no' or tags['highway'] not in RULES['defaultWidth']:
            continue
        bore = profile(LineString(points(way)),tags,empty,wid)
        # Unnamed OSM links also occur as pairs of opposite bores. Limit the
        # search to tunnels on the same layer with the same road class.
        key = (tags.get('name',''),tags.get('layer','-1'),tags['highway'])
        candidates.append(replace(bore,name=str(key)))
    return {road.way:road.width/2 for road in pair_carriageways(candidates)}


def cover_crossing_streets(way, width, upper, upper_index):
    """Find the parts of a tagged tunnel that carry an independent surface road."""
    line = LineString(points(way))
    connected = set(way['nodes'])
    stations = []
    for i in upper_index.query(line,predicate='dwithin',distance=width+24):
        road,shape,road_width = upper[i]
        if connected.intersection(road['nodes']):
            continue
        overlap = line.intersection(shape.buffer(road_width/2+width,cap_style='flat'))
        for segment in getattr(overlap,'geoms',[overlap]):
            if segment.geom_type=='LineString' and not segment.is_empty:
                stations.extend([line.project(segment.interpolate(0)),line.project(segment.interpolate(segment.length))])
    return stations

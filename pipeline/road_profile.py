import json
import math
import re
from dataclasses import dataclass, replace
from pathlib import Path
from functools import cached_property
from statistics import median

import numpy as np
from shapely import STRtree
from shapely.geometry import LineString, Polygon
from shapely.ops import unary_union


RULES = json.loads(Path(__file__).with_name('streets.json').read_text())


@dataclass(frozen=True)
class Road:
    line: LineString
    width: float
    kind: str
    name: str
    lanes: int
    left: float
    right: float
    divided: bool
    frontage: float | None
    source: str
    oneway: bool
    way: int
    samples: tuple

    @property
    def section(self):
        return RULES['photoOverrides'].get(str(self.way), {}).get('section', RULES['sectionClasses'].get(self.kind))

    @cached_property
    def dimensions(self):
        section = RULES['sections'].get(self.section)
        override = RULES['photoOverrides'].get(str(self.way), {})
        return {**section, **{key:override[key] for key in ('walk','treeInset') if key in override}} if section else None

    @cached_property
    def widening(self):
        config = RULES['outerWidening'].get(str(self.way))
        if not config:
            return None
        coords = np.asarray(self.line.coords)
        vertices = np.r_[0,np.cumsum(np.linalg.norm(np.diff(coords,axis=0),axis=1))]
        stations = sorted(set(vertices).union(config['stationMetres']))
        outer, original = [], []
        for station in stations:
            center = self.line.interpolate(station)
            tangent = np.subtract(self.line.interpolate(min(self.line.length,station+.1)).coords[0],self.line.interpolate(max(0,station-.1)).coords[0])
            normal = np.array([-tangent[1],tangent[0]])/max(.001,np.linalg.norm(tangent))
            extra = np.interp(station,config['stationMetres'],config['extraMetres'])
            original.append(center.coords[0]);outer.append(center.coords[0]+normal*config['side']*extra)
        guide = LineString(outer)
        ribbon = Polygon([*original,*reversed(outer)]).buffer(0)
        return config['side'],guide,ribbon

    def side_line(self,side):
        return self.widening[1] if self.widening and self.widening[0]==side else self.line

    @cached_property
    def pavement(self):
        core = self.line.buffer(self.width/2,quad_segs=2)
        if not self.widening:
            return core
        side,guide,ribbon = self.widening
        return unary_union([core,ribbon,guide.buffer(side*self.width/2,single_sided=True,quad_segs=2)])


def facade_gap(line, index):
    gaps = []
    step = RULES['sampleStep']
    for distance in np.arange(min(step / 2, line.length / 2), line.length, step):
        center = line.interpolate(distance)
        after = line.interpolate(min(line.length, distance + .25))
        before = line.interpolate(max(0, distance - .25))
        angle = math.atan2(after.y - before.y, after.x - before.x)
        delta = RULES['probeLength'] * np.array([-math.sin(angle), math.cos(angle)])
        hits = []
        for side in (-1, 1):
            ray = LineString([center.coords[0], center.coords[0] + side * delta])
            distances = [center.distance(index.geometries[key].boundary.intersection(ray))
                         for key in index.query(ray, predicate='intersects')]
            distances = [value for value in distances if math.isfinite(value) and value > 0]
            if distances:
                hits.append(min(distances))
        if len(hits) == 2:
            gaps.append((center.x,center.y,sum(hits)))
    return tuple(gaps)


def profile(line, tags, index,way=0):
    override = RULES['photoOverrides'].get(str(way))
    if override:
        tags = {**tags, 'lanes': str(override['lanes']), 'width': str(override['lanes'] * RULES['laneWidth']), 'divider': override['divider']}
    kind = tags['highway']
    is_link = kind.endswith('_link')
    pedestrian = kind == 'pedestrian'
    one_way = is_link or tags.get('oneway', 'yes' if tags.get('junction') == 'roundabout' else 'no') in ('yes','1','true','-1')
    lane = RULES['laneWidth']
    tag_width = re.fullmatch(r'(\d+(?:\.\d+)?)\s*(?:m)?', tags.get('width','').strip())
    width = float(tag_width[1]) if tag_width else None
    count = tags.get('lanes','')
    lanes = int(count) if count.isdecimal() and 0 < int(count) <= 16 else None
    sidewalk = tags.get('sidewalk', 'none' if is_link else 'both')
    def edge(side):
        default = 'yes' if sidewalk in ('both', side, 'yes') else 'no'
        return RULES['sidewalkWidth'] if not pedestrian and tags.get('sidewalk:'+side, default) == 'yes' else 0
    left, right = edge('left'), edge('right')
    samples = facade_gap(line, index) if not width and not is_link and (pedestrian or not lanes) else ()
    gap = median(sample[2] for sample in samples) if samples else None
    if width:
        source = 'width'
    elif lanes and not pedestrian:
        width, source = lanes * lane, 'lanes'
    elif gap is not None:
        width, source = max(2, gap - left - right), 'frontage'
        if pedestrian:
            width = min(width, RULES.get('maxPedestrianWidth', 22))
    else:
        width, source = RULES['defaultWidth'][kind], 'class'
    if pedestrian:
        lanes = 0
    elif lanes is None:
        lanes = min(RULES['maxLanes'][kind], max(1 if one_way else 2, round(width / lane)))
        if source == 'frontage':
            width = min(width, lanes * lane)
    inferred_divider = way != 221349755 and not one_way and lanes >= 4 and kind in ('trunk','primary','secondary')
    divided = not pedestrian and not is_link and tags.get('divider', 'yes' if inferred_divider else 'no') not in ('no','none','line')
    return Road(line, width, kind, tags.get('name',''), lanes, left, right, divided, gap, source, one_way,way,samples)


def pair_carriageways(roads):
    index = STRtree([road.line for road in roads])
    for road in roads:
        if not road.oneway or not road.name or road.source not in ('frontage','class'):
            yield road
            continue
        separations = []
        for distance in np.arange(min(10,road.line.length/2),road.line.length,20):
            here = road.line.interpolate(distance)
            axis = np.subtract(road.line.interpolate(distance+.2).coords[0],road.line.interpolate(max(0,distance-.2)).coords[0])
            axis /= max(np.linalg.norm(axis),.001)
            offsets = []
            for key in index.query(here,predicate='dwithin',distance=24):
                other = roads[key]
                if other is road or other.name!=road.name or not other.oneway:
                    continue
                along = other.line.project(here)
                if not 0<along<other.line.length:
                    continue
                tangent = np.subtract(other.line.interpolate(along+.2).coords[0],other.line.interpolate(max(0,along-.2)).coords[0])
                if np.dot(axis,tangent)>-.85*np.linalg.norm(tangent):
                    continue
                offset = np.subtract(other.line.interpolate(along).coords[0],here.coords[0])
                lateral = axis[0]*offset[1]-axis[1]*offset[0]
                if abs(lateral)>=3:
                    offsets.append(lateral)
            if offsets:
                separations.append(min(offsets,key=abs))
        if not separations:
            yield road
            continue
        offset = median(separations)
        width = min(road.width,abs(offset)-.8)
        yield replace(road,width=width,lanes=max(1,round(width/RULES['laneWidth'])),
            left=0 if offset<0 else road.left,right=0 if offset>0 else road.right,source='paired')

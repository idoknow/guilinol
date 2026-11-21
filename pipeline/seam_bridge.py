import json
import math

import numpy as np
import shapely

from landmarks.jiefang_layout import LOWER_ROADS, RAMPS, UPPER_ROADS, lane_dividers, section, widths


def native_contact(interval, outward, model_height, streets, reference):
    for fraction in (.15,.5,.85):
        center = np.array(interval.interpolate(fraction,normalized=True).coords[0])
        inside = model_height(shapely.Point(center-outward*.035))
        if inside is None or abs(inside-reference)>.15:
            return False
        near,kinds = streets.at(*(center+outward*.035))
        far,peers = streets.at(*(center+outward*.25))
        if kinds!=peers or abs(near-far)>.05 or abs(inside-near)>.05:
            return False
    return True


def has_roles(path, roles=('lod0_road_paint','lod0_curb_face')):
    with path.open('rb') as stream:
        stream.seek(12)
        length = int.from_bytes(stream.read(4),'little')
        stream.seek(20)
        names = {node.get('name') for node in json.loads(stream.read(length))['nodes']}
    return set(roles) <= names


def protected_edge(interval, inward, cap, heights, walkway):
    trace = shapely.LineString(np.asarray(interval.coords) + inward*.4)
    if not cap.covers(trace):
        return False
    for fraction in (0,.5,1):
        foot = interval.interpolate(fraction,normalized=True)
        level = walkway(foot)
        if level is None or not any(1.05 < top-level < 1.15 for top in heights(trace.interpolate(fraction,normalized=True))):
            return False
    return True


class CurbFaces:
    def __init__(self, triangles):
        normals = np.cross(triangles[:,1]-triangles[:,0],triangles[:,2]-triangles[:,0])
        vertical = triangles[np.abs(normals[:,1]) < .1*np.linalg.norm(normals,axis=1)]
        self.lines = shapely.STRtree(shapely.linestrings(vertical[:,:,[0,2]]))
        self.triangles = vertical

    def spans(self, point):
        probe = shapely.Point(point)
        spans = []
        for index in self.lines.query(probe,predicate='dwithin',distance=.03):
            vertices = self.triangles[index]
            coords = vertices[:,[0,2]]
            edges = np.roll(coords,-1,axis=0)-coords
            axis = edges[np.argmax(np.linalg.norm(edges,axis=1))]
            axis /= np.linalg.norm(axis)
            stations = (coords-point)@axis
            levels = []
            for start,end in ((0,1),(1,2),(2,0)):
                if stations[start]*stations[end] <= 0 and abs(stations[start]-stations[end])>1e-8:
                    fraction = -stations[start]/(stations[end]-stations[start])
                    levels.append(vertices[start,1]+fraction*(vertices[end,1]-vertices[start,1]))
            if levels: spans.append((min(levels),max(levels)))
        return spans

    def pairs(self, point, first, second):
        spans = self.spans(point)
        low,high = sorted((first,second))
        reached = low
        for bottom,top in sorted(spans):
            if bottom<=reached+.015 and bottom>=low-.025:
                reached = max(reached,top)
            if abs(reached-high)<.025:
                return True
        return False

    def wall_sections(self, interval, outward, walkway, faces, streets):
        indices = self.lines.query(interval,predicate='dwithin',distance=.015)
        footprint = shapely.union_all(self.lines.geometries[indices]).buffer(.015)
        covered = footprint.covers(interval)
        verified = covered
        sections = []
        for fraction in (.01,.25,.5,.75,.99):
            point = np.array(interval.interpolate(fraction,normalized=True).coords[0])
            top = walkway(shapely.Point(point-outward*.035))
            lower = []
            for distance in (.035,.25):
                probe = point+outward*distance
                lower.append(max(streets.at(*probe)[0],max(faces(shapely.Point(probe)),default=-math.inf)))
            spans = sorted(self.spans(point),reverse=True,key=lambda span:span[1])
            bottom = top
            for low,high in spans:
                if bottom is not None and bottom-.025<=high<=top+.035: bottom = min(bottom,low)
            if top is None or top-max(lower)<.65 or top-bottom<.65: verified = False
            sections.append([*point.round(3),None if top is None else round(top,3),None if bottom is None else round(bottom,3),*np.round(lower,3)])
        return dict(path=list(interval.coords),verticalCoverage=covered,sections=sections,verified=verified)


def check_paint(entry, heights):
    angle = math.radians(entry['rotation'])
    rotation = np.array([[math.cos(angle),-math.sin(angle)],[math.sin(angle),math.cos(angle)]])
    origin = np.array(entry['position'])
    for way in RAMPS+UPPER_ROADS+LOWER_ROADS:
        coords,normals,stations,levels = section(way)
        if way in UPPER_ROADS:
            coords = coords.copy()
            coords[np.argmax(coords[:,0]),0] = -139.9
        for offset in lane_dividers(way,*widths(way)[:2]):
            line=coords+normals*np.broadcast_to(offset,len(coords))[:,None]
            for station in np.arange(.25,stations[-1],.5):
                local = np.array([np.interp(station,stations,column) for column in line.T])
                world = local@rotation + origin[::2]
                expected = origin[1]+np.interp(station,stations,levels)+.035
                found = any(abs(height-expected)<.05 for height in heights(shapely.Point(world)))
                yield [way,*world.round(3),found]

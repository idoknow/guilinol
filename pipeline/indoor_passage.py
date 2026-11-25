"""Carve a mapped, covered pedestrian passage into procedural building volumes."""
import numpy as np
from shapely import LineString, Point, union_all
from shapely.ops import substring

from features import points, polygons


class IndoorPassage:
    def __init__(self, design, ways):
        main, branch = [LineString(points(ways[i])) for i in design["ways"]]
        if main.distance(Point(branch.coords[0])) > .01:
            raise ValueError("Passage branch must start on the main passage")
        width = design["width"]
        self.floor = design["floor"]
        self.ceiling = design["ceiling"]
        if self.ceiling - self.floor < 2.5 or branch.length < 3:
            raise ValueError("Insufficient passage clearance or landing length")
        self.seeds = set(design["buildingSeeds"])
        # Leave a solid end wall just inside the facade. The last three metres
        # of the branch have the same level and width as the turning platform.
        branch = substring(branch, 0, branch.length - design["endWallDepth"])
        self.footprint = union_all([line.buffer(width/2, cap_style="flat", join_style="mitre")
                                    for line in (main, branch)])
        start, end = np.array(main.coords[0]), np.array(main.coords[-1])
        # Carry both cuts just through the outside face despite centimetre rounding.
        mouths = []
        for a, b in ((start, main.coords[1]), (end, main.coords[-2])):
            v = np.array(b)-a
            v /= np.linalg.norm(v)
            mouths.append(LineString([a-v*.5, a+v]).buffer(width/2, cap_style="flat"))
        self.opening = union_all([self.footprint, *mouths])
        ramp = design["entranceLength"]
        center = substring(main, ramp, main.length-ramp)
        self.platform = union_all([line.buffer(width/2, cap_style="flat", join_style="mitre")
                                   for line in (center, branch)])
        self.entrances = {}
        for i, (a, b) in enumerate(((start, main.coords[1]), (end, main.coords[-2]))):
            node = ways[design["ways"][0]]["nodes"][0 if i == 0 else -1]
            direction = np.asarray(b) - a
            direction /= np.linalg.norm(direction)
            level = design["entranceLevels"][i]
            slope = (self.floor-level)/ramp
            if abs(slope) > .08:
                raise ValueError(f"Passage ramp exceeds 8% at node {node}")
            area = LineString([a, a+direction*ramp]).buffer(width/2, cap_style="flat")
            self.entrances[node] = (area, a, slope * direction, level)

    def parts(self, polygon, info):
        if info[4] not in self.seeds or not polygon.intersects(self.opening):
            yield polygon, info
            return
        base, roof, kind, floors, seed, center, rectangle, complex_shape, *_ = info
        if self.ceiling >= roof:
            raise ValueError("Passage ceiling would breach the original roof")
        # Keep the full roof and its original rooftop details. Raised GL04
        # volumes provide both a rendered soffit and a solid collision ceiling.
        yield polygon, (self.ceiling, roof, kind, floors, seed, center, rectangle, complex_shape, True)
        for lower in polygons(polygon.difference(self.opening)):
            if lower.area > .001:
                yield lower, (min(base,self.floor-.15), self.ceiling, kind, floors, seed,
                              Point(-1e6,-1e6), [], complex_shape)

    def tile_parts(self, parts, tile):
        for polygon, info in parts:
            yield from self.parts(polygon, info)
        # Local planes keep the walk surface continuous at the centimetre-coded
        # bridge lips, including where a ramp spans a chunk boundary.
        slabs = [(self.platform, np.zeros(2), np.zeros(2), self.floor),
                 *self.entrances.values()]
        tx, tz = tile.bounds[:2]
        for area, start, gradient, level in slabs:
            intercept = level + np.dot(np.array([tx,tz])-start, gradient)
            plane = [*gradient.tolist(), float(intercept)]
            for floor in polygons(area.intersection(tile)):
                if floor.area > .001:
                    yield floor, (self.floor-.1, self.floor, 3, 1, 0, Point(-1e6,-1e6),
                                  [], True, True, plane)

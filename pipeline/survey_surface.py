"""Height and world-space texture stretch of the rendered surveyed pavement."""
import base64

import numpy as np
from shapely import Point, STRtree, polygons


class SurveySurface:
    def __init__(self, survey):
        parts = [np.frombuffer(base64.b64decode(survey[k]), '<i4').reshape(-1, 3, 3)
                 for k in ('packed', 'sidewalk') if survey.get(k)]
        triangles = np.concatenate(parts) / 1000 if parts else np.empty((0, 3, 3))
        normals = np.cross(triangles[:, 1] - triangles[:, 0], triangles[:, 2] - triangles[:, 0])
        valid = np.abs(normals[:, 1]) > 1e-8
        self.normals = normals[valid]
        self.origins = triangles[valid, 0]
        self.index = STRtree(polygons(triangles[valid][:, :, [0, 2]]))

    def hit(self, x, z):
        hits = self.index.query(Point(x, z), predicate='intersects')
        if not len(hits):
            return None
        normals = self.normals[hits]
        points = self.origins[hits]
        heights = points[:, 1] - ((x - points[:, 0])*normals[:, 0] +
                                  (z - points[:, 2])*normals[:, 2]) / normals[:, 1]
        i = heights.argmax()
        return float(heights[i]), float(np.linalg.norm(normals[i]) / np.max(np.abs(normals[i])))

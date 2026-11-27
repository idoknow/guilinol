import json

import numpy as np
from shapely.geometry import Polygon


def base_faces(root):
    profile = json.loads((root / 'pipeline/data/landmarks/yangqiao-grade.json').read_bytes())
    south, north = (np.array(profile[end]) for end in ('south', 'north'))
    grid = []
    for station, levels in zip(profile['stations'], profile['levels']):
        west, east = south + station * (north - south)
        grid.append([np.array([*(west + (east - west) * across), height])
                     for across, height in zip(profile['lateral'], levels)])
    for near, far in zip(grid, grid[1:]):
        for index, role in enumerate(profile['bands']):
            if role == 'structure':
                yield np.array([near[index], near[index+1], far[index+1]])
                yield np.array([near[index], far[index+1], far[index]])


def foreign_visual(triangles, rail_mask, faces):
    if not len(triangles):
        return None
    for face in faces:
        low, high = face.min(axis=0), face.max(axis=0)
        candidates = (~rail_mask & (triangles[:,:,0].max(axis=1) >= low[0]) & (triangles[:,:,0].min(axis=1) <= high[0])
                      & (triangles[:,:,2].max(axis=1) >= low[1]) & (triangles[:,:,2].min(axis=1) <= high[1])
                      & (triangles[:,:,1].max(axis=1) > low[2]))
        if not candidates.any():
            continue
        patch = Polygon(face[:,:2])
        slope = np.linalg.solve(face[1:,:2]-face[0,:2], face[1:,2]-face[0,2])
        for triangle in triangles[candidates]:
            outline = triangle[:,[0,2]]
            gap = triangle[:,1] - (face[0,2] + (outline-face[0,:2]) @ slope)
            above = []
            for index, value in enumerate(gap):
                prev = index-1
                if (value > 0) != (gap[prev] > 0):
                    above.append(outline[prev] + gap[prev]/(gap[prev]-value)*(outline[index]-outline[prev]))
                if value > 0:
                    above.append(outline[index])
            if len(above) >= 3:
                fragment = Polygon(above).convex_hull.intersection(patch)
                if not fragment.is_empty and fragment.length > 0:
                    return fragment.representative_point()
    return None

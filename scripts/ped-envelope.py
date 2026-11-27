"""Count frames with any 0.25 m disc extending outside the union of walkable faces."""
import json
from pathlib import Path
import sys

import numpy as np
import shapely

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'pipeline'))
from npc_sidewalks import sidewalk_faces


def outside_frames(frames, world, manifest):
    points_flat = [point for frame in frames for point in frame]
    detailed = '--squeeze' in sys.argv
    coords = np.asarray([point[:2] for point in points_flat])
    if not len(coords):
        return [0, 0, 0, 0] if detailed else 0
    radius = .25
    low = coords.min(axis=0) - radius
    high = coords.max(axis=0) + radius
    size = manifest['chunkSize']
    tiles = [tile for tile in manifest['chunks']
             if low[0] - size <= tile['x'] <= high[0] and low[1] - size <= tile['z'] <= high[1]]
    surface = shapely.union_all(list(sidewalk_faces(world, {**manifest, 'chunks': tiles})))
    points = shapely.points(coords)
    center_out = ~shapely.covers(surface, points)
    distance = shapely.distance(surface.boundary, points)
    excess = np.maximum(0, radius - np.where(center_out, -distance, distance))
    outside = excess > 0
    frame_ids = np.repeat(np.arange(len(frames)), [len(frame) for frame in frames])
    count = lambda mask: int(len(np.unique(frame_ids[mask])))
    if detailed:
        squeeze = np.array([bool(point[2]) for point in points_flat])
        return [count(outside & squeeze), float(excess.max()), count(outside & ~squeeze), count(center_out)]
    return count(outside)


if __name__ == '__main__':
    world = Path('public/world')
    manifest = json.loads((world / 'manifest.json').read_bytes())
    print(json.dumps([outside_frames(frames, world, manifest) for frames in json.load(sys.stdin)]))

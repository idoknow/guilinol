"""Count frames with any 0.25 m disc extending outside the union of walkable faces."""
import json
from pathlib import Path
import sys

import numpy as np
import shapely

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'pipeline'))
from npc_sidewalks import sidewalk_faces


def outside_frames(frames, world, manifest):
    coords = np.asarray([point for frame in frames for point in frame])
    if not len(coords):
        return 0
    radius = .25
    low = coords.min(axis=0) - radius
    high = coords.max(axis=0) + radius
    size = manifest['chunkSize']
    tiles = [tile for tile in manifest['chunks']
             if low[0] - size <= tile['x'] <= high[0] and low[1] - size <= tile['z'] <= high[1]]
    surface = shapely.union_all(list(sidewalk_faces(world, {**manifest, 'chunks': tiles})))
    points = shapely.points(coords)
    outside = ~shapely.covers(surface, points) | (shapely.distance(surface.boundary, points) < radius)
    frame_ids = np.repeat(np.arange(len(frames)), [len(frame) for frame in frames])
    return int(len(np.unique(frame_ids[outside])))


if __name__ == '__main__':
    world = Path('public/world')
    manifest = json.loads((world / 'manifest.json').read_bytes())
    print(json.dumps([outside_frames(frames, world, manifest) for frames in json.load(sys.stdin)]))

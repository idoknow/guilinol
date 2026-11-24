"""Count frames with any 0.25 m disc extending outside the union of walkable faces."""
import json
from pathlib import Path
import sys

import numpy as np
import shapely

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'pipeline'))
from npc_sidewalks import sidewalk_faces


def outside_frames(frames, world, manifest):
    coords = np.asarray(frames)
    radius = .25
    low = coords.min(axis=(0, 1)) - radius
    high = coords.max(axis=(0, 1)) + radius
    size = manifest['chunkSize']
    tiles = [tile for tile in manifest['chunks']
             if low[0] - size <= tile['x'] <= high[0] and low[1] - size <= tile['z'] <= high[1]]
    surface = shapely.union_all(list(sidewalk_faces(world, {**manifest, 'chunks': tiles})))
    points = shapely.points(coords)
    outside = ~shapely.covers(surface, points) | (shapely.distance(surface.boundary, points) < radius)
    return int(outside.any(axis=1).sum())


if __name__ == '__main__':
    world = Path('public/world')
    manifest = json.loads((world / 'manifest.json').read_bytes())
    print(json.dumps([outside_frames(frames, world, manifest) for frames in json.load(sys.stdin)]))

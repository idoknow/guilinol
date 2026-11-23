"""The approved local-metre boundary shared by world generation and clients."""
import json
from pathlib import Path

from shapely.geometry import shape

from common import xz2ll


class PlayRegion:
    def __init__(self):
        definition = json.loads(Path(__file__).with_name('region.json').read_bytes())
        self.geometry = shape(definition['finalGeometry'])
        self.tiles = {(x, int(z)) for z, row in definition['chunkOriginsByZ'].items() for x in row}
        west, north, east, south = self.geometry.bounds
        north_lat, west_lon = xz2ll(west, north)
        south_lat, east_lon = xz2ll(east, south)
        self.bbox = [south_lat, west_lon, north_lat, east_lon]

    def manifest(self):
        ring = list(self.geometry.exterior.coords)
        return dict(local=ring, geographic=[xz2ll(x,z)[::-1] for x,z in ring],
                    chunks=sorted(self.tiles))

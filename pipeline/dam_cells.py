"""Export OSM solid dam footprints as 4 m grid runs for world assembly."""
import json
import math
from pathlib import Path

from shapely import intersects_xy

from common import GRID, load_osm
from features import area


def dam_runs():
    output = {}
    for element in load_osm():
        if element.get('tags', {}).get('waterway') != 'dam':
            continue
        footprint = area(element)
        if footprint.is_empty:
            continue
        west, north, east, south = footprint.bounds
        runs = []
        for row in range(math.ceil(north / GRID), math.floor(south / GRID) + 1):
            for col in range(math.ceil(west / GRID), math.floor(east / GRID) + 1):
                if not intersects_xy(footprint, col * GRID, row * GRID):
                    continue
                if runs and runs[-1][0] == row and runs[-1][2] == col - 1:
                    runs[-1][2] = col
                else:
                    runs.append([row, col, col])
        if runs:
            output[f"{element['type']}/{element['id']}"] = runs
    return output


if __name__ == '__main__':
    Path(__file__).with_name('dam-cells.json').write_text(json.dumps(dam_runs(), separators=(',', ':')) + '\n')

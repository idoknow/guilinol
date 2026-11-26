import json
import math
import unittest
from pathlib import Path

from shapely.geometry import LineString, Point, box

from common import GRID, ll2xz, load_osm
from features import area


class DamPassages(unittest.TestCase):
    def test_passages_match_osm_ferry_segments(self):
        definitions = json.loads(Path(__file__).with_name('dam-passages.json').read_bytes())
        elements = {f"{entry['type']}/{entry['id']}": entry for entry in load_osm()
                    if entry.get('tags', {}).get('waterway') == 'dam'}
        for key, passage in definitions.items():
            with self.subTest(dam=key):
                dam = area(elements[key])
                coords = {node: ll2xz(lat,lon) for node,lat,lon in passage['nodes']}
                crossing = LineString(list(coords.values())).intersection(dam)
                self.assertGreater(crossing.length, GRID)
                west,north,east,south = dam.bounds
                cells = []
                for row in range(math.ceil(north/GRID),math.floor(south/GRID)+1):
                    for col in range(math.ceil(west/GRID),math.floor(east/GRID)+1):
                        east_m, south_m = col*GRID, row*GRID
                        cell = box(east_m-GRID/2,south_m-GRID/2,east_m+GRID/2,south_m+GRID/2)
                        if dam.covers(Point(east_m,south_m)) and crossing.intersects(cell):
                            cells.append([col,row])
                self.assertEqual(cells, passage['cells'])
                if 'gate' in passage:
                    self.assertEqual([round(value/GRID) for value in coords[passage['gate']]], passage['gateCell'])

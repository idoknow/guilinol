import unittest

import numpy as np

from common import ll2xz
from play_region import PlayRegion
from road_tunnels import corridor_underpasses
from station_levels import grade_platforms, PLATFORM, RAIL, SOFFIT, STYLE, TUNNEL_FLOOR, UNDERPASS
from pathlib import Path
import json


class GuilinStationTest(unittest.TestCase):
    def test_platform_and_crossing_structures_share_the_hall_datum(self):
        self.assertLessEqual(abs(PLATFORM - STYLE['hallFloor']), .3)
        self.assertAlmostEqual(PLATFORM-RAIL, STYLE['platformHeight'])
        self.assertAlmostEqual(SOFFIT-RAIL, 7.5)
        self.assertAlmostEqual(RAIL-1.2-TUNNEL_FLOOR, 4.5)

    def test_station_grading_preserves_the_existing_tunnel_mouths(self):
        # These global 4 m vertices support the ground mesh at both portals.
        left, top = -2352, 1856
        ground = np.full((33, 50), 1510, dtype=np.int16)
        underlay = ground.copy()
        water = np.full_like(ground, -32768)
        grade_platforms(ground, underlay, water, left, top)
        for x in (-2304, -2208):
            for z in (1920, 1928):
                row, col = (z-top)//4, (x-left)//4
                self.assertEqual(ground[row, col], 1510)
                self.assertEqual(underlay[row, col], 1510)
        self.assertTrue(np.any(underlay != 1510))

    def test_tunnel_floor_and_ceiling_are_level_at_every_rail(self):
        tunnels = corridor_underpasses(PlayRegion().geometry, lambda x,z: 152.5)
        tunnel = next(t for t in tunnels if t['way']==UNDERPASS)
        start,end = np.array(tunnel['portals'])[:,[0,2]]
        axis = (end-start)/tunnel['length']
        distances, heights = np.transpose(tunnel['stations'])
        self.assertAlmostEqual(heights[0], 152.5)
        self.assertAlmostEqual(heights[-1], 152.5)
        records = json.loads((Path(__file__).resolve().parents[1]/'docs/railway-crossings.json').read_bytes())
        for row in records:
            if row['road'] != UNDERPASS or row['type']!='rail_over':
                continue
            at = (np.array(ll2xz(row['lat'],row['lon']))-start) @ axis
            self.assertGreater(at, tunnel['approachEnds'][0])
            self.assertLess(at, tunnel['length']-tunnel['approachEnds'][1])
            self.assertAlmostEqual(np.interp(at, distances, heights), TUNNEL_FLOOR)

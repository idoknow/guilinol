import unittest

import numpy as np

from common import ll2xz
from play_region import PlayRegion
from road_tunnels import corridor_underpasses
from station_levels import PLATFORM, RAIL, SOFFIT, STYLE, TUNNEL_FLOOR, UNDERPASS
from pathlib import Path
import json


class GuilinStationTest(unittest.TestCase):
    def test_platform_and_crossing_structures_share_the_hall_datum(self):
        self.assertLessEqual(abs(PLATFORM - STYLE['hallFloor']), .3)
        self.assertAlmostEqual(PLATFORM-RAIL, STYLE['platformHeight'])
        self.assertAlmostEqual(SOFFIT-RAIL, 7.5)
        self.assertAlmostEqual(RAIL-1.2-TUNNEL_FLOOR, 4.5)

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

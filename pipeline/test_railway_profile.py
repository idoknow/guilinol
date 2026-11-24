import unittest
from unittest.mock import patch

import numpy as np
from shapely import box

from railways import LEVEL, parallel_height_audit, parallel_segments
from railway_profile import solve


class RailProfileTest(unittest.TestCase):
    # The second track runs in the opposite direction and starts 1 m later.
    xy = [(0, 0), (11, 0), (12, 4), (1, 4)]
    pieces = [(0, 1, 0, 0, 1), (2, 3, 0, 0, 2)]
    ways = {i: {'tags': {'railway': 'rail'}} for i in (1, 2)}
    target = np.array([10., 10., 15., 15.])

    def profile(self, records, yards=()):
        crossings = [(node, r, r['roadY'], None, r.get('soffit')) for node, r in zip((0, 3), records)]
        return solve(self.xy, self.pieces, self.ways, self.target, crossings, yards,
                     parallel_segments(self.pieces, self.xy, self.ways))

    def test_opposite_directions_match_at_the_same_chainage(self):
        heights = np.array([150., 151.1, 152.2, 151.1])
        result = parallel_height_audit(self.pieces, self.xy, heights, self.ways)
        self.assertAlmostEqual(result['maximumM'], 1.)
        self.assertEqual(result['over5cm'], 2)

    def test_road_levels_do_not_pin_track(self):
        records = [dict(rail=i, road=4, roadY=y, sharedNode=i, type='level', clearanceM=None)
                   for i, y in [(1, 6.), (2, 20.)]]
        h, result = self.profile(records, [([123], box(-2, -2, 15, 6))])
        self.assertTrue(result['feasible'])
        np.testing.assert_allclose(h, 12.5)

    def test_nanxi_minimum_applies_to_both_tracks(self):
        from nanxi_crossing import ROAD, TRACKS
        ids = sorted(TRACKS)
        records = [dict(type='rail_over',road=ROAD,rail=wid,roadY=90.) for wid in ids]
        with patch('nanxi_crossing.design', return_value=(None,147.1,149.3,155.12)):
            heights, _ = self.profile(records)
        self.assertAlmostEqual(min(heights[[0,3]]),155.12,places=5)
        self.assertLessEqual(abs(heights[0]-heights[3]),.05)

    def test_whole_paved_width_stays_level_on_a_sloping_track(self):
        coords = [(0, 0), (20, 0), (40, 0), (60, 0)]
        pieces = [(i, i+1, 20*i, LEVEL if i==1 else 0, 1) for i in range(3)]
        target = np.array([150., 150.2, 150.4, 150.6])
        heights, _ = solve(coords, pieces, self.ways, target, [], [], None)
        self.assertAlmostEqual(heights[1], heights[2], places=6)
        self.assertGreater(heights[1], heights[0])
        self.assertGreater(heights[3], heights[2])

    def test_bridge_and_underpass_do_not_change_the_rail_profile(self):
        underpass = dict(type='rail_over', roadY=145, railY=151, clearanceM=4.8)
        bridge = dict(type='road_over', soffit=154.5, roadY=156, railY=149, clearanceM=5.8)
        h, _ = self.profile([underpass, bridge])
        reference, _ = self.profile([])
        np.testing.assert_allclose(h, reference)

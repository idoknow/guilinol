import unittest

import numpy as np
from shapely import box

from railways import parallel_height_audit, parallel_segments
from railway_profile import solve


class RailProfileTest(unittest.TestCase):
    # The second track runs in the opposite direction and starts 1 m later.
    xy = [(0, 0), (11, 0), (12, 4), (1, 4)]
    pieces = [(0, 1, 0, 0, 1), (2, 3, 0, 0, 2)]
    ways = {i: {'tags': {'railway': 'rail'}} for i in (1, 2)}
    target = np.array([10., 10., 15., 15.])

    def profile(self, records, yards=()):
        crossings = [(node, r, r['roadY'], None, r.get('soffit')) for node, r in zip((0, 3), records)]
        return solve(self.xy, self.pieces, self.ways, self.target, crossings, records, yards,
                     parallel_segments(self.pieces, self.xy, self.ways))

    def test_opposite_directions_match_at_the_same_chainage(self):
        heights = np.array([150., 151.1, 152.2, 151.1])
        result = parallel_height_audit(self.pieces, self.xy, heights, self.ways)
        self.assertAlmostEqual(result['maximumM'], 1.)
        self.assertEqual(result['over5cm'], 2)

    def test_road_levels_do_not_pin_track(self):
        records = [dict(rail=i, road=4, roadY=y, sharedNode=i, type='level', clearanceM=None)
                   for i, y in [(1, 6.), (2, 20.)]]
        result = self.profile(records, [([123], box(-2, -2, 15, 6))])
        self.assertTrue(result['feasible'])
        first, second = result['crossings']
        self.assertAlmostEqual(first['railY'], second['railY'])
        self.assertLessEqual(result['maxGradePermille'], 12)

    def test_incompatible_fixed_structures_have_no_profile(self):
        underpass = dict(type='rail_over', roadY=145, railY=151, clearanceM=4.8)
        bridge = dict(type='road_over', soffit=154.5, roadY=156, railY=149, clearanceM=5.8)
        result = self.profile([underpass, bridge], [([123], box(-2, -2, 15, 6))])
        self.assertEqual(result['status'], 2)
        self.assertNotIn('crossings', result)

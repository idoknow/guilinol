import unittest
import numpy as np
from unittest.mock import patch

from railway_road_profiles import road_profile_constraints


class ConnectedRoadProfileTest(unittest.TestCase):
    def test_deck_rounding_keeps_clearance_and_grade(self):
        from railway_bridge_grades import smooth_raised_deck
        at = np.array([0.,12.,22.4,23.,24.,31.,52.])
        old = np.full(len(at),149.)
        minimum = np.array([148.,148.,150.,150.,150.,148.,148.])
        deck = smooth_raised_deck(at,old,minimum,.049)
        self.assertTrue(np.all(deck>=np.maximum(old,minimum)-1.e-7))
        self.assertLessEqual(max(abs(np.diff(deck)/np.diff(at))),.049001)

    @staticmethod
    def way(nodes, coords):
        return dict(nodes=nodes, geometry=coords, tags={'highway': 'primary'})

    @patch('railway_road_profiles.points', side_effect=lambda way: way['geometry'])
    def test_slope_budget_propagates_through_intersection(self, _):
        ways = {1: self.way([10, 11], [(0, 0), (4, 0)]),
                2: self.way([11, 12], [(4, 0), (10, 0)])}
        rows = [dict(road=1, rail=101, x=0, z=0, railY=100., roadY=100., type='level'),
                dict(road=2, rail=102, x=10, z=0, railY=104.7, roadY=100., type='rail_over')]
        result = road_profile_constraints(ways, rows, [])
        conflict, = result['conflicts']
        self.assertEqual(conflict['ways'], [1, 2])
        self.assertEqual(conflict['requiredFallM'], 1.)
        self.assertEqual(conflict['permittedFallM'], .5)
        rows[1]['railY'] += .5
        self.assertEqual(road_profile_constraints(ways, rows, [])['conflicts'], [])
        panel = dict(road=1, railY=100., fromM=0., toM=2.)
        conflict, = road_profile_constraints(ways, rows, [panel])['conflicts']
        self.assertAlmostEqual(conflict['deficitM'], .1)

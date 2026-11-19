import unittest

import numpy as np

from clearance import audit_routes


class ClearanceTest(unittest.TestCase):
    def audit(self, kind, levels):
        route = dict(kind=kind, start='A', end='B', path=[[0,100,0],[0,100,8]])
        triangles = [(osm_id,np.array([[.3,level,3],[.6,level,3],[.3,level,5]]))
                     for osm_id,level in levels]
        return audit_routes([route],triangles)

    def test_no_bridge(self):
        self.assertEqual(self.audit('boat',[]),dict(bridges=[],minimum=None))

    def test_raft_passenger_not_raft_top(self):
        with self.assertRaisesRegex(ValueError,'OSM 23'):
            self.audit('raft',[(23,102.8)])

    def test_lower_overlapping_bridge_between_samples(self):
        with self.assertRaisesRegex(ValueError,'OSM 17'):
            self.audit('boat',[(23,104),(17,103.3)])

    def test_inclusive_threshold_and_unique_bridge_count(self):
        result = self.audit('boat',[(17,103.395),(17,103.6)])
        self.assertEqual(result['bridges'],[17])
        self.assertAlmostEqual(result['minimum'],.3)

    def test_landmark_uses_actual_underside_and_boat_design_margin(self):
        passage=dict(start='A',end='B',kind='boat',path=[[0,100,0],[0,100,8]])
        underside=np.array([[-2,102.25,2],[2,102.25,2],[0,102.25,6]])
        self.assertEqual(audit_routes([passage],[(7,underside,0)],select=True),[])
        self.assertEqual(audit_routes([passage],[(7,underside+[0,.1,0],0)],select=True),[passage])

    def test_navigation_uses_height_over_the_swept_hull(self):
        from clearance import navigable_edges
        # The high end of this sloping underside is wide enough for the boat.
        slope = np.array([[-12, 99, 0], [12, 107, 0], [12, 107, 3]])
        first = np.array([[-8, -1], [8, -1]])
        last = first + [0, 4]
        np.testing.assert_array_equal(
            navigable_edges([(17, slope, 0)], first, last, np.array([1000, 1000]), 'boat'),
            [False, True])

    def test_world_writer_rejects_a_blocked_leg(self):
        from vehicles import write_vehicles
        from tempfile import TemporaryDirectory
        from pathlib import Path
        route = dict(kind='boat', start='A', end='B', path=[[0, 100, 0], [0, 100, 8]])
        underside = np.array([[-2, 102.25, 2], [2, 102.25, 2], [0, 102.25, 6]])
        with TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, '航道核查失败'):
                write_vehicles(Path(directory), {'routes': [route]}, [(17, underside, 0)])
            self.assertFalse((Path(directory) / 'vehicles.bin').exists())

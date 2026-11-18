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

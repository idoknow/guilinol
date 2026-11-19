import unittest

import numpy as np

from audit_grounding import assemblies, bearing_components


class BearingTests(unittest.TestCase):
    def test_window_is_supported_but_a_detached_box_above_a_wall_is_checked(self):
        # The first quad is the wall. The second is a decal 14 cm from its
        # face. The tetrahedron is in the same plan, several metres above it.
        vertices = np.array([
            (0,0,0),(6,0,0),(6,4,0),(0,4,0),
            (1,1,.14),(5,1,.14),(5,2,.14),(1,2,.14),
            (2,6,0),(3,6,0),(2,6,1),(2,7,0)
        ], dtype=float)
        faces = np.array([(0,1,2),(0,2,3),(4,5,6),(4,6,7),
                          (8,9,10),(8,9,11),(8,10,11),(9,10,11)])
        components = np.repeat(np.arange(3),4)
        grouped = assemblies(vertices,faces,components,3)
        self.assertEqual(grouped[0],grouped[1])
        self.assertNotEqual(grouped[0],grouped[2])
        np.testing.assert_array_equal(bearing_components(grouped,[0,1,6]),[True,False,True])

    def test_half_metre_band_includes_boundary(self):
        np.testing.assert_array_equal(bearing_components(np.zeros(3,int),[2,2.5,2.51]),
                                      [True,True,False])

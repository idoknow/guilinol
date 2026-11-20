import unittest

import numpy as np
from scipy.sparse import csr_matrix

from road_grading import solve_road_spline


class RoadSplineTests(unittest.TestCase):
    def test_conflicting_gradients_with_dem_anchors(self):
        # The last two rows represent mutually incompatible cross-slope targets.
        a = np.array([[1, 0, 0], [0, 1, 0], [0, 0, 1], [4, -4, 0], [4, -4, 0]], float)
        b = np.array([155., 156., 158., 0., 1.])
        expected = np.linalg.lstsq(a, b, rcond=None)[0]
        actual = solve_road_spline(csr_matrix(a), b, np.full((1, 3), 157.))
        np.testing.assert_allclose(actual[0], expected, rtol=0, atol=1e-7)

    def test_exact_initial_surface(self):
        a = csr_matrix(np.eye(3))
        initial = np.array([155., 156., 157.])
        np.testing.assert_array_equal(solve_road_spline(a, initial, initial), initial)

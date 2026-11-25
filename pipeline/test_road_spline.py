import unittest

import numpy as np
from scipy.sparse import csr_matrix

from road_grading import RoadConstraints, _grid_stencil, _survey_rows, eval_bspline_grid, solve_city_spline, solve_road_spline


class RoadSplineTests(unittest.TestCase):
    def test_scanline_order_across_band_boundary(self):
        mask = np.arange(35 * 4).reshape(35, 4) % 3 == 0
        system = RoadConstraints(mask.sum(), 2 * mask.sum())
        _grid_stencil(system, mask, True, 6, ((0, 1), (1, -1)), 2.2, 0., 1)
        matrix = system.finish(35 * 6)
        row, col = np.where(mask)
        base = row * 6 + col + 1
        np.testing.assert_array_equal(matrix.indices.reshape(-1, 2), np.column_stack((base, base + 1)))

    def test_overlapping_survey_support(self):
        grid = np.arange(120, dtype=np.float64).reshape(10, 12) ** 2
        east = np.array([4., 12., 23.])
        south = np.array([14., 19., 17.])
        system = RoadConstraints(3, 96)
        _survey_rows(system, 12, 10, 0., 0., ((east, south), (east + .25, south)), 0., 520.)
        expected = 520. * (eval_bspline_grid(grid, 0., 0., east, south)
                           - eval_bspline_grid(grid, 0., 0., east + .25, south))
        np.testing.assert_allclose(system.finish(120) @ grid.ravel(), expected, rtol=1e-12)

    def test_city_residual_from_transpose(self):
        design = csr_matrix(np.vstack((np.eye(4), [[3., -1., .2, 0.], [1., 0., 3., -2.]])))
        target = np.arange(6, dtype=np.float64)
        actual = solve_city_spline(design.T.tocsr(), target, np.zeros((2, 2)))
        np.testing.assert_allclose(actual.ravel(), np.linalg.lstsq(design.toarray(), target, rcond=None)[0], atol=1e-12)

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

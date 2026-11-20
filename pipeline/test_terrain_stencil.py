"""The Zhengyang boundary must select the same 4 m nodes in either winding."""
import unittest

import numpy as np
from shapely.geometry import Polygon

from world import GRID, terrain_stencil


class TerrainStencilTests(unittest.TestCase):
    def test_zhengyang_half_columns(self):
        ring = [(4, 0), (14, 2), (10, 26), (0, 24)]
        for points in (ring, ring[::-1], ring[2:] + ring[:2]):
            polygon = Polygon([(x * GRID, y * GRID) for x, y in points])
            mask = terrain_stencil(polygon, 0, 0, 0, 0, (27, 15))
            for row, col in [(15, 1), (21, 0)]:
                self.assertFalse(mask[row, col])
                self.assertTrue(mask[row, col + 1])

    def test_hole_and_offset(self):
        poly = Polygon([(4, 8), (20, 8), (20, 24), (4, 24)],
                       holes=[[(8, 12), (16, 12), (16, 20), (8, 20)]])
        expected = np.ones((5, 5), dtype=bool)
        expected[1:4, 1:4] = False
        np.testing.assert_array_equal(terrain_stencil(poly, 0, 0, 1, 2, expected.shape), expected)

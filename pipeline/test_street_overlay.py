import unittest

from shapely import STRtree
from shapely.geometry import Polygon, box

from streets import clipped


class TileOverlay(unittest.TestCase):
    def test_boundary_contacts_do_not_mix_dimensions(self):
        tile = box(0, 0, 256, 256)
        pavement = box(0, 0, 5, 5)
        tree = STRtree([pavement, box(-1, 10, 0, 11), box(256, 256, 257, 257)])
        self.assertTrue(clipped(tree, tile).equals(pavement))

    def test_repair_self_crossing_band_before_clip(self):
        band = Polygon([(0, 0), (4, 4), (0, 4), (4, 0)])
        result = clipped(STRtree([band]), box(-1, -1, 5, 5))
        self.assertTrue(result.is_valid)
        self.assertEqual(result.area, 8)

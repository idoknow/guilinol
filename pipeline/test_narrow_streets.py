import unittest

from shapely import LineString, Polygon, box, union_all

from narrow_streets import narrow_intervals


class NarrowStreetTests(unittest.TestCase):
    def test_both_limits_are_strict(self):
        axis = LineString([(0, 0), (20, 0)])
        for width, length, expected in [(2.22, 20, []), (2.21, 10, []), (2.21, 10.01, [[0, 10.01]])]:
            with self.subTest(width=width, length=length):
                walls = union_all([box(0, -4, length, -width / 2), box(0, width / 2, length, 4)])
                self.assertEqual(narrow_intervals(axis, walls), expected)

    def test_open_courtyard_interrupts_a_pinch(self):
        axis = LineString([(0, 0), (5, 0), (20, 0)])
        walls = union_all([box(0, -3, 20, -1), box(0, 1, 9, 3), box(11, 1, 20, 3)])
        self.assertEqual(narrow_intervals(axis, walls), [])

    def test_crossing_between_facade_vertices(self):
        axis = LineString([(0, 0), (8, 0), (30, 0)])
        walls = union_all([box(0, -4, 30, -1), Polygon([(0, .5), (30, 2), (30, 4), (0, 4)])])
        (start, end), = narrow_intervals(axis, walls)
        self.assertAlmostEqual(start, 0)
        self.assertAlmostEqual(end, 14.4)


if __name__ == '__main__':
    unittest.main()

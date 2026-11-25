import unittest

from shapely import LineString, Polygon, box, union_all

from narrow_streets import driving_alignment, narrow_intervals


class NarrowStreetTests(unittest.TestCase):
    def test_both_limits_are_strict(self):
        axis = LineString([(0, 0), (20, 0)])
        for width, length, expected in [(2.22, 20, []), (2.21, 10, []), (2.21, 10.01, [[0, 10.01]])]:
            with self.subTest(width=width, length=length):
                walls = union_all([box(0, -4, length, -width / 2), box(0, width / 2, length, 4)])
                self.assertEqual(narrow_intervals(axis, walls), expected)

    def test_rider_finishes_on_the_nearest_clear_adjoining_street(self):
        route = [(0, 0, 1), (10, 0, 2), (20, 0, 3)]
        wall = box(11, .2, 22, 1)
        exits = {3: [LineString([(20, 0), (20, -4)])]}
        result = driving_alignment(route, wall, exits)
        self.assertEqual(result[:-1], [(0, 0), (10, 0)])
        self.assertAlmostEqual(result[-1][0], 20)
        self.assertAlmostEqual(result[-1][1], -.45)

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

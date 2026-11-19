import unittest
from unittest.mock import patch

from shapely import STRtree
from shapely.geometry import LineString, Polygon, box

from road_profile import profile
from sections import clipped, section_layers, shopfronts, speed_paint
from streets import chunks


class SectionTests(unittest.TestCase):
    def setUp(self):
        self.road = profile(LineString([(0,0),(200,0)]), {'highway':'primary','width':'14','sidewalk':'right'},STRtree([]))

    def test_one_sided_bands_and_tile_seam(self):
        walk,verge,cycle,tactile = section_layers([self.road])
        for tree,width in ((walk,3.6),(verge,2.2),(cycle,3),(tactile,.35)):
            left = clipped(tree,box(0,-50,100,50))
            right = clipped(tree,box(100,-50,200,50))
            self.assertAlmostEqual(left.union(right).area,200*width)
            self.assertGreaterEqual(left.bounds[1],7)

    def test_shop_edges_face_the_street(self):
        rows = shopfronts([box(10,18,30,28)],[(100,110,0,3,5)], [self.road])[(0,0)]
        self.assertEqual(len(rows),4)
        self.assertEqual({row[1] for row in rows},{180})
        self.assertEqual({row[5] for row in rows},{0,1,2,3})

    def test_median_between_paired_oneways(self):
        tags={'highway':'primary','width':'12','oneway':'yes','name':'中山中路'}
        ways=[profile(LineString(coords),tags,STRtree([]),way) for way,coords in
              [(101,[(10,50),(190,50)]),(102,[(190,63),(10,63)])]]
        tile=box(0,0,256,256)
        with patch('streets.load_osm',return_value=[]):
            encode,_=chunks(ways,[],tile,[],lambda *_:(150,-32768),Polygon())
            fixtures=encode(tile,(0,0))[9]
        rail=[row for row in fixtures if row[0] in (1,2)]
        self.assertTrue(any(row[0]==2 for row in rail))
        self.assertEqual({row[2] for row in rail},{565})
        self.assertEqual(len(rail),len({row[1] for row in rail}))

    def test_paint_stays_in_carriageway(self):
        digits = list(speed_paint(self.road,'40',160))
        self.assertTrue(digits)
        self.assertTrue(all(self.road.line.buffer(7).contains(shape) for shape in digits))
        self.assertEqual(list(speed_paint(self.road,'signals',160)),[])

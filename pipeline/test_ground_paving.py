import unittest

from shapely import Polygon, box, union_all

from ground_passages import clip_ground_paving
from service_streets import rings


class GroundPavingTest(unittest.TestCase):
    def test_split_wings_keep_passage_lower_layer_and_roadbed_indices(self):
        strip=box(0,0,16,2)
        opening=box(7,0,9,2)
        wings=box(4,-1,12,3).difference(opening)
        road=next(rings(0,strip))
        lower_road=next(rings(0,strip))
        paths=[[road,lower_road],*([None]*10),[1,[],[]],[0,1,158]]
        tile={'roadbeds':[-1,1]}
        clip_ground_paving(tile,paths,wings)
        upper=union_all([Polygon([(east/100,north/100) for east,north in row[1]]) for row in paths[0][:-1]])
        self.assertEqual(upper.intersection(wings).area,0)
        self.assertTrue(upper.covers(opening))
        self.assertEqual(paths[0][-1],lower_road)
        self.assertEqual(paths[11][0],3)
        self.assertEqual(paths[12],[0,3,158])
        self.assertEqual(tile['roadbeds'],[-1,-2,-3,3])

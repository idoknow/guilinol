import unittest

from shapely import box

from railway_crossings import inventory


class SharedNodeClassification(unittest.TestCase):
    def classify(self, road_tags, rail_tags, node_tags=None):
        def way(wid, key, value, tags, nodes, coords):
            return dict(id=wid,type='way',tags={key:value,**tags},nodes=nodes,
                        geometry=[dict(lon=x,lat=y) for x,y in coords])
        point = (110.3,25.28)
        rail = way(1,'railway','rail',rail_tags,[3,4,5],[(110.29,25.28),point,(110.31,25.28)])
        road = way(2,'highway','primary',road_tags,[6,4,7],[(110.3,25.27),point,(110.3,25.29)])
        row, = inventory([rail,road],box(-2000,-2000,2000,2000),{'4':node_tags or {}})
        return row['type']

    def test_shared_without_node_evidence(self):
        self.assertEqual(self.classify({'tunnel':'yes','layer':'-1'},{'layer':'1'}),'rail_over')
        self.assertEqual(self.classify({'layer':'0'},{'bridge':'yes','layer':'0'}),'rail_over')
        self.assertEqual(self.classify({'bridge':'yes'},{}),'road_over')
        self.assertEqual(self.classify({'layer':'2'},{'layer':'1'}),'road_over')
        self.assertEqual(self.classify({'bridge':'no'},{}),'level')

    def test_explicit_crossing_tags_take_precedence(self):
        for tag in ('level_crossing','crossing'):
            with self.subTest(tag=tag):
                self.assertEqual(self.classify({'tunnel':'yes'},{'layer':'1'},{'railway':tag}),'level')

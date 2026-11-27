import unittest
from math import cos, sin

from airport_pavement import pavement_sources
from airport_props import layout
from common import load_osm
from play_region import PlayRegion


class LiangjiangSnapshot(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.elements=load_osm()
        cls.bounds=PlayRegion().geometry

    def test_only_local_surfaces(self):
        _,sources=pavement_sources(self.elements)
        self.assertEqual([row['id'] for row,_ in sources['runway']],[35449799])
        for kind,count in [('taxiway',96),('apron',2),('parking_position',66)]:
            self.assertEqual(len(sources[kind]),count)

    def test_fixture_counts_and_panel_ends(self):
        def grade(east,south): return 170+.08*east+.11*south
        props=layout(self.elements,self.bounds,grade)
        for kind,count in [('bridgePivot',31),('bridgeDock',31),('beacon',3),('standSign',66)]:
            self.assertEqual(len(props[kind]),count)
        for kind in ('airliner','cart','bus','tug','fuel','stairs','fence','mast'):
            self.assertGreater(len(props[kind]),0)
        for east,height,south,yaw,_,_,span,rise in props['fence']:
            for end in [-.5,.5]:
                actual=grade(east+end*span*sin(yaw),south+end*span*cos(yaw))
                self.assertAlmostEqual(height+end*rise,actual,places=3)

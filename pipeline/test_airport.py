import unittest
from math import cos, sin
from shapely.geometry import LineString, Point, box
from shapely.ops import unary_union
import numpy as np

from airport_pavement import pavement_sources
from airport_props import layout, scenery_fence
from common import load_osm
from play_region import PlayRegion


class ScenicFenceTest(unittest.TestCase):
    def test_detour_preserves_ring_except_at_game_route(self):
        field=box(0,0,100,100)
        buildings=box(80,30,105,50).union(box(30,30,40,40))
        ring,=scenery_fence(field,buildings,[],field)
        self.assertTrue(ring.is_ring)
        self.assertAlmostEqual(ring.distance(buildings),3,delta=.02)
        route=LineString([(0,50),(20,50)])
        cut=unary_union(list(scenery_fence(field,buildings,[route],field)))
        self.assertTrue(cut.equals(ring.difference(route.buffer(8))))


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
        _,sources=pavement_sources(self.elements)
        runway=sources['runway'][0][1]
        lamps=[Point(east,south) for east,_,south,*_ in props['approachLight']]
        self.assertGreaterEqual(min(self.bounds.boundary.distance(lamp) for lamp in lamps),5)
        for tip,inner in [(runway.coords[0],runway.coords[1]),(runway.coords[-1],runway.coords[-2])]:
            direction=np.subtract(tip,inner); direction/=np.linalg.norm(direction)
            farthest=max(np.dot(np.subtract(lamp.coords[0],tip),direction) for lamp in lamps)
            expected=900 if tip[1]<runway.centroid.y else 585
            self.assertAlmostEqual(farthest,expected,places=2)
        for east,base,south,*_ in props['approachLight']:
            self.assertAlmostEqual(base,grade(east,south),delta=.001)
        for kind,count in [('bridgePivot',31),('bridgeDock',31),('beacon',3),('standSign',66)]:
            self.assertEqual(len(props[kind]),count)
        for kind in ('airliner','cart','bus','tug','fuel','stairs','fence','mast'):
            self.assertGreater(len(props[kind]),0)
        for east,height,south,yaw,_,_,span,rise in props['fence']:
            for end in [-.5,.5]:
                actual=grade(east+end*span*sin(yaw),south+end*span*cos(yaw))
                self.assertAlmostEqual(height+end*rise,actual,places=3)

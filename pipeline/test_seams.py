import unittest

import numpy as np
import shapely

from audit_seams import probes, declared_mesh, seam_segments, designed_rise
from seam_layers import bridge_layer
from seam_crossings import crossings
from landmarks.jiefang_layout import deck_level, dash_intervals
from seam_bridge import CurbFaces, native_contact, protected_edge


class SeamTests(unittest.TestCase):
    def test_plaza_driveway_edge(self):
        from audit_seams import ROOT, Surface, Streets, projected_faces
        world = Surface(ROOT/'public/world')
        _,heights = projected_faces(world.entries['central_square'],'B_plaza_pave',ROOT/'public')
        road,kinds = Streets(world).at(-790.159,165.347)
        self.assertIn(5,kinds)
        self.assertLess(abs(max(heights(shapely.Point(-790.199,165.347)))-road),.05)

    def test_wall_needs_lower_receiving_surface(self):
        from unittest.mock import Mock
        stone = CurbFaces(np.array([[[0.,0,0],[2,0,0],[2,2,0]],[[0.,0,0],[2,2,0],[0,2,0]]]))
        street = Mock(); street.at.return_value = (0,set())
        interval = shapely.LineString([(0,0),(2,0)])
        def check(height):
            return stone.wall_sections(interval,np.array([0,1]),lambda point:2,lambda point:[height],street)
        self.assertTrue(check(0)['verified'])
        self.assertFalse(check(1.98)['verified'])

    def test_zhengyang_entry_grades(self):
        from audit_seams import ROOT, Surface, Streets, projected_faces
        world = Surface(ROOT/'public/world')
        entry = world.entries['zhengyang']
        streets = Streets(world)
        _, heights = projected_faces(entry,'pave',ROOT/'public')
        cosine,sine = np.cos(.16),np.sin(.16)
        transform = np.array([[cosine,sine],[-sine,cosine]])
        origin = np.array(entry['position'])[::2]
        for end,sign in [(-12.5,-1),(87.5,1)]:
            for across in np.arange(-8.5,9,.5):
                inside = origin+np.array([across,end-sign*.04])@transform
                outside = origin+np.array([across,end+sign*.04])@transform
                self.assertLessEqual(abs(max(heights(shapely.Point(inside)))-streets.at(*outside)[0]),.05)

    def test_balustrade_requires_full_span_and_deck_height(self):
        interval = shapely.LineString([(0,0),(2,0)])
        inward = np.array([0,1])
        cap = shapely.box(-1,.25,3,.55)
        check = lambda footprint,top: protected_edge(interval,inward,footprint,lambda point:[top],lambda point:10)
        self.assertTrue(check(cap,11.1))
        self.assertFalse(check(cap.difference(shapely.box(.3,0,.35,1)),11.1))
        self.assertFalse(check(cap,12.1))

    def test_native_pair_needs_continuous_ground_beyond_edge(self):
        from unittest.mock import Mock
        street = Mock()
        interval = shapely.LineString([(0,0),(2,0)])
        normal = np.array([0,1])
        street.at.return_value = (10.01,set())
        self.assertTrue(native_contact(interval,normal,lambda point:10,street,10))
        street.at.side_effect = lambda x,z: (10 if z<.1 else 8,set())
        self.assertFalse(native_contact(interval,normal,lambda point:10,street,10))

    def test_dash_crosses_station_vertex(self):
        self.assertEqual(list(dash_intervals(6,8)),[(7,8)])
        self.assertEqual(list(dash_intervals(8,12)),[(8,9.8)])

    def test_sloping_curb_requires_vertical_face_at_sample_level(self):
        curb = CurbFaces(np.array([[[0.,0,0],[2,1,0],[2,1.12,0]],[[0.,0,0],[2,1.12,0],[0,.12,0]]]))
        self.assertTrue(curb.pairs((1,0),.5,.62))
        self.assertFalse(curb.pairs((1,0),0,.12))
        self.assertFalse(curb.pairs((1,.5),.5,.62))
    def test_crossings_include_narrow_paint_and_shifted_curb(self):
        region = shapely.box(0,0,5,5)
        paint = shapely.box(-1,1.04,1,1.22)
        curb = shapely.MultiLineString([[(-1,3),(0,3)],[(0,3.4),(1,3.4)]])
        events = list(crossings(region,{'marking':paint,'curb':curb}))
        self.assertEqual(len([row for row in events if row[0]=='marking']),1)
        self.assertLess(events[0][2],.03)
        self.assertTrue(all(row[2]>.3 for row in events if row[0]=='curb'))

    def test_no_continuation_has_no_invented_distance(self):
        rows = list(crossings(shapely.box(0,0,5,5),{'curb':shapely.LineString([(-1,3),(0,3)])}))
        self.assertEqual(len(rows),1)
        self.assertIsNone(rows[0][2])

    def test_disconnected_paint_is_not_matched_by_proximity(self):
        paint = shapely.union_all([shapely.box(-1,2,-.005,2.1),shapely.box(.005,2,1,2.1)])
        events = list(crossings(shapely.box(0,0,5,5),{'marking':paint}))
        self.assertEqual([row[2] for row in events],[None,None])

    def test_wall_only_pairs_lower_paving_with_adjacent_upper_walk(self):
        walls = [('bank',shapely.LineString([(0,0),(3,0)]))]
        self.assertEqual(designed_rise((1,.01),148.75,153.8,{1},148.7,walls),'bank')
        self.assertIsNone(designed_rise((1,.3),148.75,153.8,{1},148.7,walls))
        self.assertIsNone(designed_rise((1,.01),148.75,153.8,{0},148.7,walls))
        self.assertIsNone(designed_rise((1,.01),150,153.8,{1},148.7,walls))

    def test_segments_deduplicate_coincident_masks_but_not_height_layers(self):
        first = shapely.LineString([(0,0),(2,0)])
        second = shapely.LineString([(2,0),(2,1)])
        segments = seam_segments({'ground':[first,second,first.reverse()],'ramp':[first]})
        self.assertEqual([segment['lengthM'] for segment in segments],[3,2])

    def test_vertical_separation_and_bridge_ends(self):
        self.assertEqual(bridge_layer((0,18.8),deck_level(0)+.18),'bridge-deck')
        self.assertEqual(bridge_layer((0,18.8),0),'ground')
        self.assertEqual(bridge_layer((140.5,18.8),deck_level(140.5)+.18),'ground')

    def test_subdivision_includes_short_edges_and_closing_edge(self):
        ring = shapely.box(0,0,5,1).exterior
        samples = list(probes(ring))
        self.assertEqual(len(samples),8)
        for point,normal in samples:
            self.assertLess(ring.distance(shapely.Point(point)),1e-7)
            self.assertAlmostEqual(np.linalg.norm(normal),1)

    def test_filtered_packed_mesh_obeys_runtime_transform(self):
        entry = dict(file='landmarks/central_square.glb',position=[0,0,0],rotation=0)
        geometry,height = declared_mesh(entry,'B_plaza_pave')
        point = geometry.representative_point()
        self.assertIsNotNone(height(point))
        rotated,other = declared_mesh(dict(entry,position=[50,12,120],rotation=90),'B_plaza_pave')
        mapped = shapely.Point(50+point.y,120-point.x)
        self.assertLess(rotated.distance(mapped),.005)
        self.assertAlmostEqual(other(mapped),height(point)+12,places=3)


if __name__=='__main__': unittest.main()

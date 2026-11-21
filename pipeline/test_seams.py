import unittest

import numpy as np
import shapely

from audit_seams import probes, declared_mesh, seam_segments, designed_rise
from seam_layers import bridge_layer
from seam_crossings import crossings
from landmarks.jiefang_layout import deck_level, lane_dividers
from seam_bridge import CurbFaces, native_contact, protected_edge


class SeamTests(unittest.TestCase):
    def test_binjiang_lower_street_and_shoulder_follow_terrain(self):
        from audit_seams import ROOT, Surface, Streets
        world = Surface(ROOT/'public/world')
        streets = Streets(world)
        for east,south,kind in [(-295.76,39.43,0),(-292,37.91,0),(-288.75,43.07,1),(-290.03,47.24,1)]:
            with self.subTest(east=east,south=south):
                street,kinds = streets.at(east,south)
                self.assertIn(kind,kinds)
                from seam_streets import OFFSETS
                self.assertLessEqual(abs(street-world.sample(east,south)[0]-OFFSETS[kind]),.05)
        foreground,_ = streets.at(-277.62,-64.23)
        self.assertGreater(world.entries['jiefang_bridge']['position'][1]+2.75-foreground,1.5)

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
        faces, heights = projected_faces(entry,'pave',ROOT/'public')
        footprint=shapely.union_all(faces,grid_size=.001)
        cosine,sine = np.cos(.16),np.sin(.16)
        transform = np.array([[cosine,sine],[-sine,cosine]])
        origin = np.array(entry['position'])[::2]
        for sign in (-1,1):
            for across in np.arange(-8.5,9,.5):
                # The north edge follows the GL04 road cut across the entrance.
                transect=shapely.LineString(np.array([[across,-15],[across,90]])@transform+origin)
                stations=((shapely.get_coordinates(footprint.intersection(transect))-origin)@transform.T)[:,1]
                end=min(stations) if sign<0 else max(stations)
                inside = origin+np.array([across,end-sign*.04])@transform
                outside = origin+np.array([across,end+sign*.04])@transform
                elevation,kinds=streets.at(*outside)
                if sign<0:self.assertIn(0,kinds)
                self.assertLessEqual(abs(max(heights(shapely.Point(inside)))-elevation),.05)

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

    def test_native_three_lane_dividers(self):
        np.testing.assert_allclose(lane_dividers(259020569,-4.9,4.9),[-4.9/3,4.9/3])
        self.assertEqual(lane_dividers(258909993,-4.7,4.7),[0])

    def test_release_atlas_quantization(self):
        from seam_inventory import atlas_mask
        uv=np.array([[[.87497,.875],[1.0000001,.875],[1.,1.]],
                     [[.4,.9],[1.,.875],[1.,1.]]])
        np.testing.assert_array_equal(atlas_mask(uv,[.875,.875,1.,1.]),[True,False])

    def test_native_pavement_handoff_preserves_uv_and_elevated_deck(self):
        from unittest.mock import Mock
        from landmarks.native_paving import NativePaving
        world=Mock(size=256,files={(0,0):'tile'})
        world.sample.return_value=(0,None)
        paving=NativePaving(world,dict(position=[0,0,0],rotation=0))
        paving.streets.tile=Mock(return_value=(shapely.STRtree([shapely.box(0,0,2,8)]),[1],None))
        paving.streets.at=Mock(return_value=(0,{1}))
        triangle=np.array([[0.,0,0],[0,0,4],[4,0,0]])
        vertices,uv=paving.clip(triangle,triangle[:,::2])
        self.assertAlmostEqual(shapely.polygons(vertices.reshape(-1,3,3)[:,:,::2])[0].area,2.)
        np.testing.assert_allclose(vertices[:,::2],uv)
        deck=triangle+[0,4,0]
        np.testing.assert_array_equal(paving.clip(deck,triangle[:,::2])[0],deck)

    def test_unbound_surface_near_street(self):
        from unittest.mock import Mock
        from seam_inventory import street_contacts
        streets=Mock()
        streets.world.size=256
        streets.world.files={(0,0):'tile'}
        streets.tile.return_value=(shapely.STRtree([shapely.box(0,0,8,8)]),[1],None)
        streets.at.return_value=(.1,{1})
        tris=np.array([[[9.,.1,2],[9.,.1,3],[10.,.1,2]]])
        triangles=np.concatenate([tris,tris+[0,4,0],tris+[2,0,0]])
        normals=np.cross(triangles[:,1]-triangles[:,0],triangles[:,2]-triangles[:,0])
        kinds=street_contacts(shapely.polygons(triangles[:,:,::2]),triangles,normals,streets)
        np.testing.assert_array_equal(kinds,[1,-1,-1])

    def test_raised_connected_ramp_and_unconnected_step(self):
        from unittest.mock import Mock
        from seam_inventory import street_contacts, surface_components
        lower = np.array([[1., .16, 1.], [1., .16, 2.], [2., .16, 1.]])
        ramp = np.array([lower[1], [2., .26, 2.], lower[2]])
        triangles = np.array([lower, ramp, lower+[0., .13, 0.]])
        component = surface_components(triangles)
        self.assertEqual(component[0], component[1])
        self.assertNotEqual(component[0], component[2])
        streets = Mock()
        streets.world.size, streets.world.files = 256, {(0, 0): 'tile'}
        streets.tile.return_value = shapely.STRtree([shapely.box(0, 0, 4, 4)]), [1], None
        streets.at.return_value = 0., {1}
        normals = np.cross(triangles[:,1]-triangles[:,0], triangles[:,2]-triangles[:,0])
        contacts = street_contacts(shapely.polygons(triangles[:,:,::2]), triangles, normals,
                                   streets, component == component[0])
        np.testing.assert_array_equal(contacts, [1, 1, -1])

    def test_overhang_only_excludes_fully_covered_triangle(self):
        from seam_inventory import ModelCover
        floor = np.array([[0., 0., 0.], [0., 0., 2.], [2., 0., 0.]])
        roof = floor + [0., 2., 0.]
        model = ModelCover(np.array([floor, roof]))
        self.assertTrue(model.hides(shapely.Polygon(floor[:, ::2]), floor))
        exposed = floor + [.5, 0., 0.]
        self.assertFalse(model.hides(shapely.Polygon(exposed[:, ::2]), exposed))
        self.assertFalse(model.hides(shapely.Polygon(roof[:, ::2]), roof))

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

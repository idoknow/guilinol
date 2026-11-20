import unittest

import trimesh
from shapely.geometry import Polygon
from audit import structural_footprint

from shapely.affinity import rotate, translate
from shapely.geometry import LineString, box

from audit_landmarks import bridge_axis, metrics, photo_hits, photos_pass, shoreline_axis
from school_frontage import frontage
from common import xz2ll


class LandmarkMetricsTest(unittest.TestCase):
    def test_visible_courtyard_is_not_a_solid_floor(self):
        ring = box(0,0,8,8).difference(box(1,1,7,7))
        walls = trimesh.creation.extrude_polygon(ring,3,engine='earcut')
        walls.apply_transform(trimesh.transformations.rotation_matrix(-1.5707963267948966,[1,0,0]))
        solid = structural_footprint(dict(vis_tris=walls.triangles,vis_normals=walls.face_normals,
                                          coll_tris=[]),lambda east,south:0, Polygon())
        self.assertAlmostEqual(solid.area,ring.area)

    def test_solid_overlap_excludes_crowns_and_paving_but_keeps_visible_walls(self):
        def cuboid(center, size):
            return trimesh.creation.box(size).apply_translation(center)
        wall = cuboid([0, 12, 0], [4, 4, 2])
        crown = cuboid([0, 17, 0], [12, 3, 10])
        paving = cuboid([0, 10.1, 0], [15, .2, 15])
        post = cuboid([5, 11, 0], [1, 2, 1])
        visible = trimesh.util.concatenate([wall,crown,paving])
        data = dict(vis_tris=visible.triangles, vis_normals=visible.face_normals,
                    coll_tris=trimesh.util.concatenate([post,paving]).triangles)
        solid = structural_footprint(data, lambda east,south:10, Polygon())
        self.assertAlmostEqual(solid.intersection(box(-2,-1,2,1)).area,8)
        self.assertAlmostEqual(solid.intersection(box(4,-1,6,1)).area,1)
        self.assertAlmostEqual(solid.area,9)

    def test_schematic_boundary_requires_both_distance_and_parallelism(self):
        def geometry(coords):
            return [dict(zip(('lat','lon'),xz2ll(*point))) for point in coords]
        campus=dict(type='way',tags={'addr:street':'Demo'},geometry=geometry(box(0,0,40,40).exterior.coords))
        def check(start,end):
            road=dict(type='way',tags={'name':'Demo','highway':'residential'},geometry=geometry([start,end]))
            return frontage(campus,{'way/1':road})
        self.assertIsNotNone(check((-10,-19),(50,-19)))
        self.assertIsNone(check((-10,-21),(50,-21)))
        self.assertIsNone(check((-10,-10),(50,-20)))

    def test_suspect_exif_requires_two_independent_views_and_reason(self):
        views = {str(index):dict(inFov=index!=1) for index in (1,2,3)}
        self.assertFalse(photos_pass(views, {'1':' '}))
        self.assertFalse(photos_pass(views, {'4':'compass jump'}))
        self.assertFalse(photos_pass({'1':views['1'],'2':views['2']}, {'1':'compass jump'}))
        self.assertTrue(photos_pass(views, {'1':'compass jump'}))
        self.assertFalse(views['1']['inFov'])

    def test_shore_axis_follows_rotation(self):
        shore=box(0,0,30,8)
        self.assertAlmostEqual((shoreline_axis(rotate(shore,20))-shoreline_axis(shore))%180,20)

    def test_paired_deck_outline_has_centerline(self):
        reference=rotate(box(-14,-4,14,4),23)
        expected=rotate(LineString([(-14,0),(14,0)]),23)
        self.assertLess(bridge_axis(reference).hausdorff_distance(expected),1e-8)

    def test_shift_is_not_a_rotation(self):
        reference = box(0, 0, 10, 2)
        iou, center, angle = metrics(translate(reference, xoff=2), reference)
        self.assertAlmostEqual(iou, 2/3)
        self.assertAlmostEqual(center, 2)
        self.assertAlmostEqual(angle, 0)

    def test_bridge_uses_long_axis(self):
        shape = rotate(box(-12, -2, 12, 2), 36)
        line = rotate(LineString([(-12, 0), (12, 0)]), 36)
        iou, center, angle = metrics(shape, line)
        self.assertIsNone(iou)
        self.assertAlmostEqual(center, 0)
        self.assertAlmostEqual(angle, 0)

    def test_view_edge_is_not_center_hit(self):
        photo = dict(x=0,z=0,heading=0,focal35=36)
        self.assertTrue(photos_pass({'edge':photo_hits(box(2,-11,3,-10),photo)}))
        self.assertFalse(photos_pass({'behind':photo_hits(box(-1,10,1,11),photo)}))
        self.assertEqual(photo_hits(box(2,-11,3,-10), photo), dict(inFov=True,centerHit=False))
        self.assertEqual(photo_hits(box(-1,10,1,11), photo), dict(inFov=False,centerHit=False))
        self.assertEqual(photo_hits(box(-1,-11,1,-10), photo), dict(inFov=True,centerHit=True))

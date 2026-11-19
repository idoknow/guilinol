import unittest

from shapely.affinity import rotate, translate
from shapely.geometry import LineString, box

from audit_landmarks import bridge_axis, metrics, photo_hits, photos_pass, shoreline_axis


class LandmarkMetricsTest(unittest.TestCase):
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

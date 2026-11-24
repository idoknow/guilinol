import unittest
from unittest.mock import Mock

from fetch_city_ref import bearing, channel, mc_to_wgs, output_dir, parse_anchors, panorama, wgs_to_mc


class RefpackTests(unittest.TestCase):
    def test_known_intersection(self):
        east, north = wgs_to_mc(25.28144732, 110.29083564)
        self.assertAlmostEqual(east, 12278879.81, places=1)
        self.assertAlmostEqual(north, 2892355.83, places=1)
        lat, lon = mc_to_wgs(east, north)
        self.assertAlmostEqual(lat, 25.28144732)
        self.assertAlmostEqual(lon, 110.29083564)

    def test_true_bearing(self):
        self.assertEqual(bearing((25, 110), (26, 110)), 0)
        self.assertAlmostEqual(bearing((0, 110), (0, 111)), 90)

    def test_output_and_anchor_guard(self):
        with self.assertRaises(ValueError):
            output_dir('../docs')
        with self.assertRaises(ValueError):
            parse_anchors('../x:10,20')

    def test_independent_baidu_failures(self):
        for stage, responses in [('qsdata', [OSError('offline')]),
                                 ('sdata', [{'content': {'id': 'pano'}}, OSError('offline')])]:
            http = Mock()
            http.get_json.side_effect = responses
            result = channel(panorama, http, None, 'center', '', (0, 0), None)
            self.assertEqual(result['status'], 'failed')
            self.assertIn(stage, result['reason'])

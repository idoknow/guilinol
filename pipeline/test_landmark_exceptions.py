import unittest

from audit import apply_landmark_exceptions


class LandmarkExceptionsTest(unittest.TestCase):
    def test_pair_order_coordinates_area_and_count(self):
        rule = dict(id='a+b', subtype='landmarkOverlap', maxArea=10, maxCount=1, reason='approved')
        match = dict(landmarks=['b', 'a'], subtype='landmarkOverlap', value=10, x=1, z=2)
        failures = [dict(match, value=10.01), dict(match, landmarks=['a', 'c']),
                    dict(match, subtype='landmarkOnSidewalk')]
        issues = [*failures, match, dict(match, x=3)]
        allowed = apply_landmark_exceptions([rule], issues)
        self.assertEqual(allowed, [dict(match, reason='approved')])
        self.assertEqual(issues, [*failures, dict(match, x=3)])

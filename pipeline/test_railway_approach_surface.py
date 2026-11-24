import unittest
from unittest.mock import patch

import numpy as np
from shapely import LineString

from railway_approach_surface import basis, fit_patch
from railway_tunnel_widths import bore_widths
from road_grading import eval_bspline_grid


class RailwayApproachSurfaceTest(unittest.TestCase):
    def test_cross_street_and_flat_panel_share_rendered_field(self):
        knots = np.full((19,19),150.)
        knots[8:11,8:11] -= 2.
        changed = knots<150
        roads = [(LineString([(16,64),(112,64)]),{'highway':'primary'}),
                 (LineString([(64,16),(64,112)]),{'highway':'primary'})]
        anchors = [(64.,64.,148.95,148.955)]
        fit_patch(knots,changed,0.,0.,roads,anchors)
        samples = np.column_stack((np.arange(16.,113.,2.),np.full(49,64.)))
        ys = eval_bspline_grid(knots,0,0,*samples.T)
        np.testing.assert_allclose(basis(knots.shape,0,0,samples)@knots.ravel(),ys)
        self.assertLessEqual(abs(ys[24]-148.9525),.00251)
        self.assertLessEqual(np.max(abs(np.diff(ys)))/2,.0501)

    @patch('railway_tunnel_widths.points',side_effect=lambda way:way['geometry'])
    def test_unnamed_opposite_bores_do_not_cover_each_other(self, _):
        tags = dict(highway='trunk',tunnel='yes',oneway='yes')
        ways = {1:dict(geometry=[(0,0),(80,0)],tags=tags),
                2:dict(geometry=[(80,7),(0,7)],tags=tags)}
        widths = bore_widths(ways,ways)
        self.assertAlmostEqual(widths[1]+widths[2],6.2)

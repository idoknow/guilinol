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

    @patch('station_bore_approaches.points', side_effect=lambda way: way['geometry'])
    def test_open_cut_reaches_daylight_in_reverse_way_order(self, _):
        from station_bore_approaches import build_open_approaches
        tags = {'highway':'trunk','oneway':'yes'}
        ways = {1:dict(nodes=[1,2],tags={**tags,'tunnel':'yes'}),
                2:dict(nodes=[5,4,2],geometry=[[300.,0.],[75.,0.],[0.,0.]],tags=tags)}
        bore = dict(way=1, nodes=[1,2], mouths=[False,True], portals=[[-50.,140.,0.],[0.,140.,0.]],
                    length=50., halfWidth=3.1, clearance=4.5)
        tunnels = [bore]
        build_open_approaches(ways,tunnels,{1},lambda x,z:150.)
        self.assertEqual([s['nodes'] for s in tunnels[1:]],[[4,2],[5,4]])
        self.assertFalse(bore['mouths'][1])
        self.assertTrue(tunnels[-1]['mouths'][0])
        self.assertEqual(tunnels[-1]['portals'][0][1],150.)
        self.assertEqual(tunnels[1]['portals'][-1][1],140.)
        for section in tunnels[1:]:
            s,y = np.array(section['stations']).T
            self.assertTrue(np.all(np.diff(s)>0))
            self.assertLessEqual(max(abs(np.diff(y)/np.diff(s))),.05)
            self.assertLess(section['halfWidth'],bore['halfWidth'])

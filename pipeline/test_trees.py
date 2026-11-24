import unittest
import numpy as np
from shapely import STRtree
from shapely.geometry import LineString

from road_profile import profile
from scatter import CONFIG, _bank_profile, _road_weights
from trees import CROWN_BRANCH_POINT, build_lod_arrays, build_species_specs, crown_start, runtime_species_specs


class TreeGeneratorTests(unittest.TestCase):
    def test_species_alignment_and_variants(self):
        specs = build_species_specs()
        self.assertEqual([s['name'] for s in specs], CONFIG['species'])
        self.assertEqual(len(specs), 11)
        for spec in specs:
            self.assertGreaterEqual(len(spec['variants']), 3)
            for name, weights in CONFIG['weights'].items():
                self.assertEqual(len(weights), len(specs), name)

    def test_three_lods_and_botanical_proportions(self):
        specs = {s['name']: s for s in build_species_specs()}
        for name, spec in specs.items():
            n0, _, c0 = build_lod_arrays(spec, 'near', variant_idx=0)
            n1, _, _ = build_lod_arrays(spec, 'mid', variant_idx=1)
            n2, _, _ = build_lod_arrays(spec, 'far', variant_idx=2)
            t0, t1, t2 = len(n0) // 3, len(n1) // 3, len(n2) // 3
            self.assertGreater(t0, t1, name)
            self.assertGreater(t1, t2, name)
            self.assertLessEqual(t2, 72, name)
            self.assertTrue(((c0 >= 0.0) & (c0 <= 1.0)).all(), name)
            if name != 'shrub':
                self.assertLessEqual(float(n0[:, 1].min()), -1.4, f'{name} trunk must extend underground for slopes')
                h = float(n0[:, 1].max())
                t0_pts = spec['near'][0]['pts']
                core_d = 2.0 * next(pt[3] for pt in t0_pts if abs(pt[1]) < 0.05)
                self.assertGreaterEqual(core_d, h * 0.05, f'{name} trunk baseD={core_d:.2f} < 0.05*H')

        # Quantitative species shape invariants finalized in IDOK-71 review
        def crown_metrics(sp):
            fol = [p for p in sp['near'] if p['op'] in ('blob', 'whorl', 'fronds', 'strands')]
            fp, _, _ = build_lod_arrays(dict(sp, near=fol), 'near', variant_idx=0)
            p_all, _, _ = build_lod_arrays(sp, 'near', variant_idx=0)
            cy0, cy1 = float(fp[:, 1].min()), float(fp[:, 1].max())
            cw = float(max(np.ptp(fp[:, 0]), np.ptp(fp[:, 2])))
            base = p_all[(p_all[:, 1] >= -0.05) & (p_all[:, 1] <= 0.25) & (np.abs(p_all[:, 0]) < 1.2) & (np.abs(p_all[:, 2]) < 1.2)]
            bd = float(max(np.ptp(base[:, 0]), np.ptp(base[:, 2])))
            return float(p_all[:, 1].max()), cy0, cy1 - cy0, cw, bd

        h, cy0, ch, cw, _ = crown_metrics(specs['camphor'])
        self.assertGreaterEqual(cw, ch, 'camphor crown width must be >= crown height')
        self.assertTrue(2.4 <= cy0 <= 3.1, f'camphor crown start={cy0:.2f}')

        h, _, ch, cw, bd = crown_metrics(specs['banyan'])
        self.assertTrue(1.2 <= bd <= 2.0, f'banyan multi-stem baseD={bd:.2f}')
        self.assertTrue(1.3 <= cw / ch <= 1.65, f'banyan cW/cH={cw / ch:.2f}')

        h, cy0, ch, cw, _ = crown_metrics(specs['osmanthus'])
        self.assertLessEqual(cy0, 1.65, f'osmanthus low crown start={cy0:.2f}')
        self.assertGreaterEqual(ch / h, 0.70, f'osmanthus crown height ratio={ch / h:.2f}')

        h, _, _, cw, _ = crown_metrics(specs['conifer'])
        self.assertTrue(0.24 <= cw / h <= 0.34, f'conifer W:H={cw / h:.2f}')

        h, _, _, cw, _ = crown_metrics(specs['elaeocarpus'])
        self.assertTrue(1.8 <= h / cw <= 2.25, f'elaeocarpus H:W={h / cw:.2f}')

        _, cy0, _, _, _ = crown_metrics(specs['willow'])
        self.assertTrue(1.0 <= cy0 <= 2.0, f'willow strand drop={cy0:.2f}')

    def test_runtime_street_crowns_raised_at_least_twice(self):
        # IDOK-227: runtime street trees must clear walking eye height.
        base = {s['name']: s for s in build_species_specs()}
        runtime = {s['name']: s for s in runtime_species_specs()}
        for name, spec in runtime.items():
            for lod in ('near', 'mid', 'far'):
                b0, _, _ = build_lod_arrays(base[name], lod, variant_idx=0)
                r0, _, _ = build_lod_arrays(spec, lod, variant_idx=0)
                self.assertAlmostEqual(float(r0[:, 1].min()), float(b0[:, 1].min()), delta=0.05, msg=f'{name} {lod} root depth')
                if name not in CROWN_BRANCH_POINT:
                    self.assertEqual(spec[lod], base[name][lod], f'{name} {lod} must stay unchanged')
                else:
                    self.assertEqual(len(r0), len(b0), f'{name} {lod} triangle count')
            if name in CROWN_BRANCH_POINT:
                before, after = crown_start(base[name]['near']), crown_start(spec['near'])
                self.assertGreaterEqual(after, 2.0 * before - 1e-3, f'{name} crown start {before:.2f} -> {after:.2f}')
                self.assertGreaterEqual(after, 2.4, name)

    def test_road_and_bank_species_mapping(self):
        line = LineString([(0, 0), (100, 0)])
        yiwu = profile(line, {'highway': 'secondary', 'name': '翊武路'}, STRtree([]), 221349755)
        xinyi = profile(line, {'highway': 'tertiary', 'name': '信义路'}, STRtree([]), 259011686)
        binjiang = profile(line, {'highway': 'secondary', 'name': '滨江路'}, STRtree([]))
        ronghu_n = profile(line, {'highway': 'pedestrian', 'name': '榕湖北路'}, STRtree([]))
        inferred_sec = profile(line, {'highway': 'secondary', 'name': '文明路'}, STRtree([]))
        self.assertEqual(_road_weights(yiwu)[7], 60)      # bischofia/koelreuteria dominant on Yiwu Rd
        self.assertEqual(_road_weights(xinyi)[2], 70)     # osmanthus dominant on Xinyi Rd
        self.assertEqual(_road_weights(binjiang)[0], 72)  # camphor tunnel on Binjiang Rd
        self.assertEqual(_road_weights(ronghu_n)[0], 64)  # camphor dominant along Ronghu North promenade
        self.assertEqual(_road_weights(inferred_sec), CONFIG['classWeights']['collector'])
        self.assertEqual(CONFIG['weights']['mixed'][9], 0)  # no stray yellow ginkgos in generic urban patches
        self.assertEqual(_bank_profile('杉湖', 'lake'), 'shan')
        self.assertEqual(_bank_profile('榕湖', 'lake'), 'ronghu')
        self.assertEqual(_bank_profile('桂湖', 'lake'), 'guihu')
        self.assertEqual(_bank_profile('漓江', 'river'), 'river')


if __name__ == '__main__':
    unittest.main()

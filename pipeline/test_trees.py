import json
import unittest
from pathlib import Path

from shapely import STRtree
from shapely.geometry import LineString

from road_profile import profile
from scatter import CONFIG, _bank_profile, _road_weights
from trees import build_lod_arrays, build_species_specs


class TreeGeneratorTests(unittest.TestCase):
    def test_species_alignment_and_variants(self):
        specs = build_species_specs()
        self.assertEqual([s['name'] for s in specs], CONFIG['species'])
        self.assertEqual(len(specs), 11)
        for spec in specs:
            self.assertGreaterEqual(len(spec['variants']), 3)
            for name, weights in CONFIG['weights'].items():
                self.assertEqual(len(weights), len(specs), name)

    def test_three_lods_and_monotonic_simplification(self):
        for spec in build_species_specs():
            n0, _, c0 = build_lod_arrays(spec, 'near', variant_idx=0)
            n1, _, _ = build_lod_arrays(spec, 'mid', variant_idx=1)
            n2, _, _ = build_lod_arrays(spec, 'far', variant_idx=2)
            t0, t1, t2 = len(n0) // 3, len(n1) // 3, len(n2) // 3
            self.assertGreater(t0, t1, spec['name'])
            self.assertGreater(t1, t2, spec['name'])
            self.assertLessEqual(t2, 20, spec['name'])
            self.assertTrue(((c0 >= 0.0) & (c0 <= 1.0)).all(), spec['name'])
            if spec['name'] != 'shrub':
                self.assertLessEqual(float(n0[:, 1].min()), -1.4, f"{spec['name']} trunk must extend underground for slopes")

    def test_road_and_bank_species_mapping(self):
        line = LineString([(0, 0), (100, 0)])
        yiwu = profile(line, {'highway': 'secondary', 'name': '翊武路'}, STRtree([]), 221349755)
        xinyi = profile(line, {'highway': 'tertiary', 'name': '信义路'}, STRtree([]), 259011686)
        binjiang = profile(line, {'highway': 'secondary', 'name': '滨江路'}, STRtree([]))
        unnamed_art = profile(line, {'highway': 'primary'}, STRtree([]))
        self.assertEqual(_road_weights(yiwu)[7], 60)      # bischofia dominant on Yiwu Rd
        self.assertEqual(_road_weights(xinyi)[2], 70)     # osmanthus dominant on Xinyi Rd
        self.assertEqual(_road_weights(binjiang)[0], 72)  # camphor tunnel on Binjiang Rd
        self.assertEqual(_road_weights(unnamed_art), CONFIG['classWeights']['arterial'])
        self.assertEqual(_bank_profile('杉湖', 'lake'), 'shan')
        self.assertEqual(_bank_profile('榕湖', 'lake'), 'ronghu')
        self.assertEqual(_bank_profile('桂湖', 'lake'), 'guihu')
        self.assertEqual(_bank_profile('漓江', 'river'), 'river')


if __name__ == '__main__':
    unittest.main()

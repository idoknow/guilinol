import json
from pathlib import Path
import shutil
import tempfile
import unittest

from railways import ROOT, bake_world as bake_railways
from vehicle_tunnels import pack_stations, profile_stations


class RailTunnelProfileTests(unittest.TestCase):
    def test_easing_and_exact_portal(self):
        section = dict(length=10, portals=[[0, 1, 0], [10, -0.880001, 0]],
                       knotHeights=pack_stations([(0, 1), (10, -.88)]))
        self.assertEqual(profile_stations(section), [[0, 1], [.6, .94], [9.4, -.82], [10, -.880001]])

    def test_bake_railways_with_knots_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            world = Path(tmp)/'world'
            shutil.copytree(ROOT/'public/world', world)
            path = world/'manifest.json'
            manifest = json.loads(path.read_bytes())
            packed = [section for section in manifest['tunnels'] if 'knotHeights' in section]
            self.assertTrue(packed)
            for section in packed:
                section.pop('stations', None)
            path.write_text(json.dumps(manifest))
            report = bake_railways(world, manifest)
            self.assertGreater(report['segments'], 0)

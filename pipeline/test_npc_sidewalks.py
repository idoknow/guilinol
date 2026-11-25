import unittest
from pathlib import Path
import sys

from shapely.geometry import LineString, box
from shapely.ops import unary_union

sys.path.insert(0, str(Path(__file__).resolve().parent))
import npc_network
import npc_sidewalks


class NpcSidewalksTests(unittest.TestCase):
    def test_derive_excludes_other_carriageways_and_divided_medians(self):
        # Two parallel carriageways at z=-5 and z=+5 (width 4m each).
        # Sidewalk surfaces on outer edges (z in [9, 13] and z in [-13, -9]) PLUS a false median strip at z in [-2, 2].
        center = LineString([(0, 5), (60, 5)])
        other_motor = LineString([(0, -5), (60, -5)])
        outer_pos = box(0, 9, 60, 13)
        outer_neg = box(0, -13, 60, -9)
        median_island = box(0, -2, 60, 2)
        surface = unary_union([outer_pos, outer_neg, median_island])
        motor_excl = unary_union([center.buffer(2.0, cap_style='flat'), other_motor.buffer(2.0, cap_style='flat')])
        motor_lines = [(center, 2.0), (other_motor, 2.0)]

        tracks = list(npc_sidewalks.derive(center, surface, 2.0, motor_excl, motor_lines))
        self.assertTrue(tracks, 'expected outer sidewalk track')
        for track in tracks:
            mid = track.interpolate(0.5, normalized=True)
            self.assertFalse(-7.0 <= mid.y <= 7.0, f'track fell inside roadway/median: y={mid.y}')
            self.assertTrue(9.0 <= mid.y <= 13.0 or -13.0 <= mid.y <= -9.0)

    def test_annotate_preserves_polyline_segments_instead_of_chord_shortcut(self):
        graph = {
            'lanes': [
                {'id': 1, 'from': 10, 'to': 11, 'cls': 'primary', 'kind': 'motor'},
            ],
        }
        elements = [
            {'type': 'way', 'nodes': [10, 11], 'tags': {'highway': 'primary', 'name': '弯道路'}},
        ]
        # L-shaped polyline: naive (coords[0], coords[-1]) would cut diagonally across the road corner.
        report = [{
            'lane': 1,
            'tileSidewalk': True,
            'tracks': [[(0.0, 0.0), (20.0, 0.0), (20.0, 20.0)]],
        }]
        by_id = npc_network.annotate(graph, elements, report)
        walks = by_id[1]['npcWalks']
        self.assertEqual(walks, [
            [0.0, 0.0, 20.0, 0.0],
            [20.0, 0.0, 20.0, 20.0],
        ])


if __name__ == '__main__':
    unittest.main()

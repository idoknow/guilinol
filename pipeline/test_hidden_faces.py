import tempfile
import unittest
from pathlib import Path

import numpy as np
import trimesh

from hidden_faces import GroundFloor, prune


class HiddenFacesTest(unittest.TestCase):
    def test_internal_pair_and_collision_copy(self):
        vertices = [[0,0,0], [1,0,0], [0,0,1], [0,1,0], [0,-1,0]]
        faces = [[0,1,2], [2,1,0], [0,3,1], [1,3,2], [2,3,0],
                 [0,1,4], [1,2,4], [2,0,4]]
        solid = trimesh.Trimesh(vertices, faces, process=False)
        scene = trimesh.Scene()
        scene.add_geometry(solid, node_name='lod0')
        scene.add_geometry(solid.copy(), node_name='collision_solid')
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)/'test.glb'
            scene.export(path)
            self.assertEqual(prune(path, 'test', GroundFloor(Path(tmp))), (8,6))
            result = trimesh.load_scene(path, process=False)
            for node, count in [('lod0',6),('collision_solid',8)]:
                self.assertEqual(len(result.geometry[result.graph[node][1]].faces), count)

    def test_two_sided_card(self):
        scene = trimesh.Scene(trimesh.Trimesh([[0,0,0],[2,0,0],[0,1,0]],
                                              [[0,1,2],[2,1,0]], process=False))
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)/'card.glb'
            scene.export(path)
            original = path.read_bytes()
            self.assertEqual(prune(path, 'card', GroundFloor(Path(tmp))), (2,2))
            self.assertEqual(path.read_bytes(), original)

    def test_ground_uses_lowest_support_across_cell_boundary(self):
        with tempfile.TemporaryDirectory() as tmp:
            ground = GroundFloor(Path(tmp))
        ground.entries = {'site':dict(position=[0,100,0],rotation=0)}
        ground.west = ground.north = 0
        ground.minimum = np.array([[-np.inf]*4,[-np.inf,100,95,-np.inf],[-np.inf]*4])
        pos = np.array([[0.,0,0], [20,0,0], [5,0,5], [33,0,0]])
        np.testing.assert_array_equal(ground.local_floor('site',pos,np.array([[0,1,2],[0,3,2]])),[0,-5])

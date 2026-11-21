"""Pack retained public-facing architecture alongside mapped school geometry."""

import mapbox_earcut
import numpy as np
import trimesh


def prism(model, ring, y0, h, wall_col, cap_col='granite', collide=True):
    pts = np.asarray(ring, dtype=float)
    area2 = 0.5 * np.sum(pts[:, 0] * np.roll(pts[:, 1], -1) - np.roll(pts[:, 0], -1) * pts[:, 1])
    if area2 < 0:
        pts = pts[::-1]
    n = len(pts)
    tris = mapbox_earcut.triangulate_float64(pts, np.array([n], dtype=np.uint32)).reshape(-1, 3)
    top = np.column_stack([pts[:, 0], np.full(n, y0 + h), pts[:, 1]])
    model.mesh(top, tris[:, ::-1], cap_col, collide)
    for i in range(n):
        j = (i + 1) % n
        x0, z0 = pts[i]
        x1, z1 = pts[j]
        quad = [(x0, y0, z0), (x1, y0, z1), (x1, y0 + h, z1), (x0, y0 + h, z0)]
        model.mesh(quad, [[0, 2, 1], [0, 3, 2]], wall_col, collide)


def append_exterior(folder, school):
    path = folder / (school + '.glb')
    campus = trimesh.load_scene(path, process=False)
    historic = trimesh.load_scene(folder / 'exterior.glb', process=False)
    for node in historic.graph.nodes_geometry:
        transform, mesh = historic.graph[node]
        group = historic.graph.transforms.parents[node]
        # Collision geometry belongs outside the switchable render levels.
        parent = campus.graph.base_frame if group == historic.graph.base_frame else group
        campus.add_geometry(historic.geometry[mesh], node_name=node + '_heritage',
                            geom_name=mesh + '_heritage', parent_node_name=parent, transform=transform)
        if group == 'lod1':
            campus.graph.update(frame_from='lod2', frame_to=node + '_distant',
                                matrix=transform, geometry=campus.graph[node + '_heritage'][1])
    campus.export(path)

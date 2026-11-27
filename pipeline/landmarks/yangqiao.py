"""Pedestrian wings of OSM bridge outline 701820462, outside the paired GL04 carriageways."""
import numpy as np

from common import ll2xz


def pedestrian_wings(builder, anchor):
    endpoints = [((25.2768378, 110.2890916), (25.2772516, 110.2894286)),
                 ((25.2765669, 110.2894930), (25.2769751, 110.2898154))]
    edges = np.array([[ll2xz(*point) for point in side] for side in endpoints]) - anchor
    for side, inner_fraction in enumerate((.25, .235)):
        outer = edges[side]
        inward = edges[1-side] - outer
        def station(fraction, lateral, elevation):
            start, end = outer + lateral * inward
            east, south = start + fraction * (end-start)
            level = 151.93 + fraction * (153.84-151.93) - builder.surface.y
            for weight, endpoint in ((max(0,1-10*fraction),start), (max(0,10*fraction-9),end)):
                if weight:
                    shore = builder.surface.ground(*endpoint)
                    target = shore + (.04 if elevation >= 0 else -.04)
                    if elevation >= 0:
                        target += elevation-.12
                    level += weight*(target-elevation-level)
            return [east, level+elevation, south]

        for bay in range(14):
            start, end = bay / 14, (bay+1) / 14
            corners = [(start, 0), (end, 0), (end, inner_fraction), (start, inner_fraction)]
            vertices = [station(*corner, height) for height in (.12, -.46) for corner in corners]
            faces = np.array([(0,1,2),(0,2,3),(4,6,5),(4,7,6),
                              (0,4,5),(0,5,1),(3,2,6),(3,6,7)])
            if bay == 0:
                faces = np.vstack([faces,[(0,3,7),(0,7,4)]])
            if bay == 13:
                faces = np.vstack([faces,[(1,5,6),(1,6,2)]])
            if np.cross(np.subtract(vertices[1],vertices[0]),np.subtract(vertices[2],vertices[0]))[1]<0:
                faces = faces[:, ::-1]
            builder.mesh(vertices, faces[:2], 'pave', collide=True)
            builder.mesh(vertices, faces[2:], 'stone', collide=True)
            panel = [station(fraction,lateral,height) for fraction in (start,end)
                     for lateral,height in ((0,.12),(0,1.12),(.005,1.12),(.005,.12))]
            panels = np.array([(0,1,5),(0,5,4),(1,2,6),(1,6,5),(2,3,7),(2,7,6)])
            if side == 0:
                panels = panels[:, ::-1]
            builder.mesh(panel,panels,'stone',collide=True)
        for fraction in np.linspace(0,1,15):
            east, level, south = station(fraction,.005,.12)
            builder.box(east,level,south,.32,1.15,.32,'stone',collide=True)

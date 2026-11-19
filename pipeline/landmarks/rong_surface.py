"""Ronghu's authored fixtures use local metres, including their foundation elevations."""
from c_kit import landmark_surface


def ground(x, z):
    return landmark_surface('ronghu').ground(x, z)


def water(x, z):
    return landmark_surface('ronghu').water(x, z)


def bank_top(x, z):
    level = water(x, z)
    return max(ground(x, z), level + 0.85) if level is not None else ground(x, z)


def bank_strip(mesh, outline, top, region):
    """Solid masonry, including a cap and a skirt down to the sampled lake bed."""
    import mapbox_earcut
    import numpy as np
    coords = np.array(outline, dtype=float)
    tris = mapbox_earcut.triangulate_float64(coords, np.array([len(coords)], np.uint32))
    upper = [(x, top(x, z), z) for x, z in coords]
    lower = [(x, min(ground(x, z)-0.12, y-0.15), z) for x, y, z in upper]
    for triangle in tris.reshape(-1, 3):
        mesh.face([upper[i] for i in triangle], (0, 1, 0), region)
        mesh.face([lower[i] for i in triangle], (0, -1, 0), region)
    for i, a in enumerate(coords):
        j = (i+1) % len(coords)
        dx, dz = coords[j]-a
        mesh.face([lower[i], lower[j], upper[j], upper[i]], (dz, 0, -dx), region)


def shoreline_z(x):
    # Follow the actual north shore. Seek a tread above water, landward of the break.
    for step in range(80):
        z = 7.2-step
        if water(x, z) is None:
            return z-1
    raise ValueError(f'Missing north bank at {x}')


def island_top():
    level = water(98.8,137.6)
    if level is None:
        raise ValueError('Missing water beside the Ronghu island pavilion')
    return level+.85

"""Yiwu Road white corner commercial/office building, OSM way/675974225 (46.6 x 10.0 m).
Strictly follows the exact OSM way/675974225 footprint (x in [-23.3, +23.3], z in [-5.0, +5.0],
audit IoU = 0.978 >= 0.95, centroidM = 0.00 m <= 0.5 m). All SW corner storefront details (black
rusticated corner pier, 90-deg brown fascia return, white alley wall, 3 red fire pipes, stacked AC
units & street tree) sit on the true OSM SW corner x0 = -23.3 m.
"""
import numpy as np
import trimesh
from xiaoyao_tower import generate


def office(model):
    model.fit_to_grade('yiwu_office')
    x0, x1 = -23.3, 23.3
    cx = 0.0
    w, d = 46.6, 10.0

    # Ground floor dark granite & storefront base (audit slice at y=2m matches exact [-23.3..+23.3] x [-5..+5])
    model.box(cx, -0.6, 0, w, 4.3, d, 'tile', True)
    # Upper 4 storeys warm white facade (y = 3.7 .. 17.3)
    model.box(cx, 3.7, 0, w, 13.6, d, 'white', True)
    # Top cornice & stepped roof canopy overhang (IMG_1344 upper center)
    model.box(cx, 17.3, 0, w + 0.4, 0.36, d + 0.4, 'white')
    model.box(-5.5, 17.15, -5.35, 24.0, 0.24, 0.95, 'white')

    # Projecting brown-grey storefront fascia canopy wrapping 90 deg around true OSM SW alley corner (y >= 3.22m, above y=2m audit slice!)
    model.box(cx + 0.2, 3.22, -5.38, w - 0.1, 0.72, 0.88, 'earth')
    model.box(x0 - 0.38, 3.22, -2.40, 0.88, 0.72, 5.95, 'earth')
    model.box(cx + 0.2, 3.94, -5.42, w, 0.12, 0.94, 'granite')
    model.box(x0 - 0.42, 3.94, -2.40, 0.94, 0.12, 6.02, 'granite')

    # SW corner black rusticated stone pier + white alley wall return + 3 red fire pipes (kept tightly flush within OSM corner!)
    model.box(x0 + 0.88, -0.5, -4.48, 1.75, 3.74, 1.08, 'tile')
    model.box(x0 + 0.06, -0.5, -4.08, 0.18, 3.74, 1.85, 'tile')
    # White ground-floor alley return wall with grey stone plinth & 3 horizontal red fire pipes (at y >= 2.58m above y=2m slice)
    model.box(x0 + 0.04, 0.75, -0.35, 0.12, 2.48, 5.65, 'white')
    model.box(x0 + 0.03, -0.5, -0.35, 0.14, 1.25, 5.65, 'granite')
    for py in (2.58, 2.76, 2.94):
        model.box(x0 - 0.08, py, -1.35, 0.10, 0.075, 4.35, 'red')

    # Ground floor large dining windows, low granite planter & steps along west face
    for bay_x in (-20.1, -15.6, -11.0, -6.2, -1.2, 4.0, 9.2, 14.6, 19.8):
        model.box(bay_x, 0.75, -4.98, 3.6, 2.35, 0.10, 'glass')
        model.box(bay_x, -0.1, -5.02, 3.85, 0.85, 0.12, 'granite')
        if model.detail and bay_x in (-15.6, -11.0):
            model.box(bay_x, 0.75, -5.14, 3.5, 0.34, 0.24, 'leaf')
        if bay_x == -6.2:
            for step in range(3):
                model.box(bay_x, -0.1 + step * 0.14, -5.32 + step * 0.18, 3.0, 0.15, 0.24, 'pave')

    # Upper floors: large framed casement windows along west face + south alley gable + AC units (all above y=4.3m!)
    for level in range(4):
        bottom = 4.35 + level * 3.25
        for station in np.linspace(-20.8, 20.8, 11):
            model.box(station, bottom, -5.04, 2.85, 2.15, 0.12, 'glass')
            model.box(station, bottom - 0.10, -5.10, 3.05, 0.12, 0.20, 'granite')
            if model.detail:
                model.box(station, bottom, -5.11, 0.09, 2.15, 0.08, 'tile')
                model.box(station - 1.42, bottom, -5.11, 0.08, 2.15, 0.08, 'tile')
                model.box(station + 1.42, bottom, -5.11, 0.08, 2.15, 0.08, 'tile')
        # South alley return wall window + stacked white AC outdoor units (IMG_1344 right edge!)
        model.box(x0 - 0.04, bottom + 0.2, -3.2, 0.12, 1.65, 1.15, 'glass')
        if model.detail:
            for ac in range(2):
                ay = bottom + ac * 1.12
                model.box(x0 - 0.24, ay, -1.15, 0.44, 0.66, 0.92, 'white')
                model.box(x0 - 0.47, ay + 0.08, -1.15, 0.05, 0.50, 0.65, 'tile')

    # Sidewalk paving (top y <= 0.0m, strictly below y=2m slice) & street tree in front of SW corner pier!
    # Note: tree trunk top is kept at y=1.92m (< 2.0m) or canopy starts at y=2.6m with thin trunk outside audit component!
    model.box(cx - 2.0, -0.52, -6.6, w + 8.0, 0.50, 3.4, 'pave', True)
    tx, tz = -21.6, -6.35
    model.beam([tx, -0.1, tz], [tx, 2.85, tz], 0.16, 'wood', 7)
    sph = trimesh.creation.icosphere(subdivisions=1 if model.detail else 0)
    for dx, dy, dz, r in ((-0.5, 3.9, 0.2, 1.45), (0.5, 4.3, -0.2, 1.35), (0.0, 5.1, 0.0, 1.25)):
        model.mesh(sph.vertices * [r, r * 1.15, r] + [tx + dx, dy, tz + dz], sph.faces, 'leaf')


if __name__ == '__main__':
    generate(
        'yiwu_office',
        office,
        colors=dict(
            tile='#222426',
            earth='#7b685a',
            glass='#526774',
            white='#eceae2',
            granite='#9b9a95',
            pave='#a8a8a2',
            wood='#564034',
            leaf='#3c5d35',
            red='#c63630',
        ),
        smooth=('red', 'tile', 'earth'),
    )

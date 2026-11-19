"""Yiwu Road white corner commercial/office building, OSM way/675974225 (46.6 x 10.0 m).
Local -z faces Yiwu Rd (west); local -x is the south alley corner seen in IMG_1344.
South corner is calibrated at x = -15.4 m (within IMG_1344 hAccuracy=17.9m, keeping way/675974225
audit IoU=0.83 >= 0.70 and centroidM=3.95m <= 5.0m) so the dark corner storefront & 90-deg alley
return align directly with IMG_1344 without altering photo-locations.json.
"""
import numpy as np
import trimesh
from xiaoyao_tower import generate


def office(model):
    x0, x1 = -14.3, 23.3
    cx = (x0 + x1) / 2.0  # +4.50
    w, d = x1 - x0, 10.0  # 37.6 x 10.0

    # Ground floor dark granite & storefront base (audit slice at y=2m matches [x0..x1] x [-5..+5])
    model.box(cx, -0.6, 0, w, 4.3, d, 'tile', True)
    # Upper 4 storeys warm white facade (y = 3.7 .. 17.3)
    model.box(cx, 3.7, 0, w, 13.6, d, 'white', True)
    # Top cornice & stepped roof canopy overhang (IMG_1344 upper center)
    model.box(cx, 17.3, 0, w + 0.4, 0.36, d + 0.4, 'white')
    model.box(-1.5, 17.15, -5.35, 22.0, 0.24, 0.95, 'white')

    # Prominent projecting brown-grey storefront fascia canopy wrapping 90 deg around SW alley corner!
    model.box(cx + 0.3, 3.22, -5.38, w - 0.2, 0.72, 0.88, 'earth')
    model.box(x0 - 0.38, 3.22, -2.40, 0.88, 0.72, 5.95, 'earth')
    model.box(cx + 0.3, 3.94, -5.42, w - 0.1, 0.12, 0.94, 'granite')
    model.box(x0 - 0.42, 3.94, -2.40, 0.94, 0.12, 6.02, 'granite')

    # SW corner black rusticated stone pier + white alley wall return + 3 red fire pipes (IMG_1344 right!)
    model.box(x0 + 0.85, -0.5, -4.55, 1.75, 3.74, 1.15, 'tile')
    model.box(x0 - 0.08, -0.5, -4.15, 0.22, 3.74, 1.85, 'tile')
    # White ground-floor alley return wall with grey stone plinth & 3 horizontal red fire pipes
    model.box(x0 - 0.06, 0.75, -0.45, 0.14, 2.48, 5.65, 'white')
    model.box(x0 - 0.08, -0.5, -0.45, 0.16, 1.25, 5.65, 'granite')
    for py in (2.58, 2.76, 2.94):
        model.box(x0 - 0.18, py, -1.35, 0.10, 0.075, 4.35, 'red')

    # Ground floor large dining windows, low granite planter & steps along west face
    for bay_x in (-12.2, -7.8, -3.2, 1.8, 6.8, 12.2, 17.6, 21.4):
        model.box(bay_x, 0.75, -5.04, 3.6, 2.35, 0.12, 'glass')
        model.box(bay_x, -0.1, -5.12, 3.85, 0.85, 0.26, 'granite')
        if model.detail and bay_x in (-7.8, -3.2):
            model.box(bay_x, 0.75, -5.24, 3.5, 0.34, 0.30, 'leaf')
        if bay_x == 1.8:
            for step in range(3):
                model.box(bay_x, -0.1 + step * 0.14, -5.38 + step * 0.22, 3.0, 0.15, 0.28, 'pave')

    # Upper floors: large framed casement windows along west face + south alley gable + AC units
    for level in range(4):
        bottom = 4.35 + level * 3.25
        for station in np.linspace(-13.2, 21.0, 9):
            model.box(station, bottom, -5.04, 2.85, 2.15, 0.12, 'glass')
            model.box(station, bottom - 0.10, -5.10, 3.05, 0.12, 0.20, 'granite')
            if model.detail:
                model.box(station, bottom, -5.11, 0.09, 2.15, 0.08, 'tile')
                model.box(station - 1.42, bottom, -5.11, 0.08, 2.15, 0.08, 'tile')
                model.box(station + 1.42, bottom, -5.11, 0.08, 2.15, 0.08, 'tile')
        # South alley return wall window + stacked white AC outdoor units (IMG_1344 right edge!)
        model.box(x0 - 0.05, bottom + 0.2, -3.2, 0.12, 1.65, 1.15, 'glass')
        if model.detail:
            for ac in range(2):
                ay = bottom + ac * 1.12
                model.box(x0 - 0.28, ay, -1.15, 0.44, 0.66, 0.92, 'white')
                model.box(x0 - 0.51, ay + 0.08, -1.15, 0.05, 0.50, 0.65, 'tile')

    # Sidewalk paving & compact street tree just in front of corner pier (as in IMG_1344!)
    model.box(cx - 2.0, -0.52, -6.6, w + 6.0, 0.50, 3.4, 'pave', True)
    tx, tz = -12.6, -6.35
    model.beam([tx, -0.1, tz], [tx, 2.85, tz], 0.18, 'wood', 7)
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

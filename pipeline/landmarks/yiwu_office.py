"""Yiwu Road white corner commercial/office building, OSM way/675974225 (46.6 x 10.0 m).
Local -z faces Yiwu Rd (west); local -x is the south alley corner seen in IMG_1344.
"""
from xiaoyao_tower import generate


def office(model):
    # Exact OSM footprint: x in [-23.3, +23.3], z in [-5.0, +5.0]
    w, d = 46.6, 10.0
    # Ground floor dark granite & storefront base
    model.box(0, -0.6, 0, w, 4.3, d, 'tile', True)
    # Upper 4 storeys warm white facade (y = 3.7 .. 17.3)
    model.box(0, 3.7, 0, w, 13.6, d, 'white', True)
    # Top cornice & stepped roof canopy overhang (IMG_1344 upper center-left)
    model.box(0, 17.3, 0, w + 0.4, 0.36, d + 0.4, 'white')
    model.box(-6.0, 17.15, -5.35, 22.0, 0.24, 0.95, 'white')

    # Prominent projecting brown storefront fascia canopy wrapping south corner (IMG_1344)
    model.box(-1.2, 3.25, -5.35, w - 2.0, 0.68, 0.85, 'earth', True)
    model.box(-22.85, 3.25, -3.55, 1.8, 0.68, 4.45, 'earth')
    model.box(-1.2, 3.93, -5.40, w - 1.9, 0.12, 0.92, 'granite')
    model.box(-22.88, 3.93, -3.55, 1.86, 0.12, 4.52, 'granite')

    # South corner black rusticated stone pier & lower white wall return + 3 red fire pipes
    model.box(-22.45, -0.4, -4.55, 1.85, 3.68, 1.15, 'tile', True)
    model.box(-23.32, -0.4, -1.8, 0.16, 3.68, 4.4, 'white')
    model.box(-23.34, -0.4, -1.8, 0.18, 0.85, 4.4, 'granite')
    for idx, py in enumerate((2.62, 2.80, 2.98)):
        model.box(-23.45, py, -2.55, 0.10, 0.08, 4.15, 'red')

    # Ground floor large dining windows, low granite planter & steps along west face
    for bay_x in (-19.8, -14.8, -9.8, -4.2, 2.0, 8.0, 14.0, 19.6):
        model.box(bay_x, 0.75, -5.04, 3.9, 2.35, 0.12, 'glass')
        model.box(bay_x, 0.0, -5.12, 4.2, 0.75, 0.28, 'granite')
        if model.detail and bay_x in (-14.8, -9.8):
            model.box(bay_x, 0.75, -5.22, 3.8, 0.32, 0.28, 'leaf')
        if bay_x == -4.2:
            # Recessed entrance steps
            for step in range(3):
                model.box(bay_x, -0.1 + step * 0.14, -5.38 + step * 0.22, 3.2, 0.15, 0.28, 'pave', True)

    # Upper floors: large framed casement windows along west & south faces
    for level in range(4):
        bottom = 4.35 + level * 3.25
        for station in np.arange(-20.2, 21.0, 4.04):
            model.box(station, bottom, -5.04, 2.85, 2.15, 0.12, 'glass')
            model.box(station, bottom - 0.10, -5.10, 3.05, 0.12, 0.20, 'granite')
            if model.detail:
                model.box(station, bottom, -5.11, 0.10, 2.15, 0.08, 'tile')
                model.box(station - 1.44, bottom, -5.11, 0.09, 2.15, 0.08, 'tile')
                model.box(station + 1.44, bottom, -5.11, 0.09, 2.15, 0.08, 'tile')
        # South gable narrow window + stacked white AC outdoor units (IMG_1344 right edge)
        model.box(-23.34, bottom + 0.2, -3.5, 0.12, 1.65, 1.15, 'glass')
        if model.detail:
            for ac in range(2):
                ay = bottom + ac * 1.15
                model.box(-23.58, ay, -1.55, 0.46, 0.68, 0.95, 'white')
                model.box(-23.82, ay + 0.08, -1.55, 0.05, 0.52, 0.68, 'tile')


import numpy as np

if __name__ == '__main__':
    generate(
        'yiwu_office',
        office,
        colors=dict(
            tile='#26282a',
            earth='#8b7768',
            glass='#5c717e',
            white='#eceae2',
            granite='#9b9a95',
            red='#c43832',
        ),
        smooth=('red', 'tile', 'earth'),
    )

import numpy as np
from scipy.ndimage import minimum_filter

from common import GRID, load_osm
from features import area, polygons


def report_water(surface, terrain, bounds, stencil):
    dry = surface == -32768
    sentinel = np.iinfo(terrain.dtype).max
    bank = minimum_filter(np.where(dry, terrain, sentinel),
                          footprint=[[0,1,0],[1,0,1],[0,1,0]], mode='constant', cval=sentinel)
    excess = (~dry) & (surface > bank)
    labels = np.zeros(surface.shape, dtype=np.int32)
    names = ['其他/无名水域']
    left, top = bounds.bounds[:2]
    for element in load_osm():
        tags = element.get('tags', {})
        if not tags.get('name') or not (tags.get('natural') == 'water' or 'water' in tags or tags.get('waterway') == 'riverbank'):
            continue
        for polygon in polygons(area(element).intersection(bounds)):
            name = tags['name']
            if name not in names:
                names.append(name)
            mask, (col, row) = stencil(polygon, left, top, GRID)
            patch = labels[row:row+mask.height, col:col+mask.width]
            patch[np.asarray(mask, dtype=bool)[:patch.shape[0], :patch.shape[1]]] = names.index(name)
    for index, name in enumerate(names):
        cells = excess & (labels == index)
        delta = surface[cells] - bank[cells]
        print(f'水位核查 {name}: {delta.size} 格, 最大高差 {delta.max(initial=0)/10:.1f} m')

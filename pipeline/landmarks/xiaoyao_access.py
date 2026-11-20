from shapely.affinity import rotate, translate
from shapely.geometry import box

GALLERY = 1008909368
PROMENADE = 1008909370
FOOT = -27.08
CENTER = -21.8
WIDTH = 4.6
GALLERY_LENGTH = 42.3
GALLERY_WIDTH = 3.85
GALLERY_PAVING_WAYS = (675603501, GALLERY, PROMENADE, 1531321914, 1531321915)


def walkable_surfaces(east, south, rotation):
    climb = box(FOOT, CENTER-WIDTH/2, 0, CENTER+WIDTH/2)
    north_court = box(0, -32, 16.4, -11.3)
    return {way: translate(rotate(surface, -rotation, origin=(0,0)), east, south)
            for way, surface in ((GALLERY, climb.union(north_court)), (PROMENADE, climb))}


def gallery_floor(east, south, rotation):
    slab = box(-GALLERY_LENGTH/2, -GALLERY_WIDTH/2, GALLERY_LENGTH/2, GALLERY_WIDTH/2)
    return translate(rotate(slab, -rotation, origin=(0,0)), east, south)

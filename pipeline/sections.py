from shapely import STRtree
from shapely.ops import unary_union

from road_profile import RULES


def section_layers(roads):
    layers = [[] for _ in range(4)]
    for road in roads:
        name = RULES['sectionClasses'].get(road.kind)
        if not name:
            continue
        section = RULES['sections'][name]
        for side, available in ((-1, road.left), (1, road.right)):
            if not available:
                continue
            def band(inner, width):
                start = road.width / 2 + inner
                def shell(distance):
                    return road.line.buffer(side * distance, single_sided=True, quad_segs=2)
                return shell(start + width).difference(shell(start))

            verge, cycle, curb, walk = (section[key] for key in ('verge','cycle','curb','walk'))
            if verge:
                layers[1].append(band(0, verge))
            if cycle:
                layers[2].append(band(verge, cycle))
            layers[0].append(band(verge + cycle, curb + walk))
            layers[3].append(band(verge + cycle + curb + walk * .52, RULES['tactileWidth']))
    return [STRtree(layer) for layer in layers]


def clipped(tree, tile):
    return unary_union([tree.geometries[index].intersection(tile) for index in sorted(tree.query(tile))])

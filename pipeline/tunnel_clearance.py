"""Required clear height and previously verified motor-bore design heights, in metres."""
import re

SITANG_BORE = 1494508178
SITANG_ROOF_THICKNESS = .30

LOCAL_ROADS = {'unclassified', 'residential', 'service', 'living_street', 'track'}
# These existing local-road bores already passed with 4.5 m of clear height.
ACCEPTED_TALL_BORES = {
    333287379, 385795252, 385796474, 479448412, 678836085, 687025323, 687047951,
    727932616, 882310591, 882310607, 968779972, 985741656, 985741658, 988474358,
    988474363, 1005623436, 1008909376, 1012824530, 1024505824, 1024505826, 1024505832,
    1024505834, 1025797700, 1025797713, 1025797716, 1030049242, 1030049246, 1035107916,
    1054231782, 1103567408, 1382497607, 1476028964, 1497607252, 1573855551, 1574710699,
}


def clearance(tags, motor=True):
    value = str(tags.get('maxheight', '')).strip().lower()
    if value:
        metres = re.fullmatch(r'(\d+(?:\.\d+)?)\s*(?:m)?', value)
        feet = re.fullmatch(r"""(\d+)\s*'\s*(\d+(?:\.\d+)?)?\s*"?""", value)
        if metres and float(metres[1]) > 0:
            return float(metres[1])
        if feet:
            return (int(feet[1])*12 + float(feet[2] or 0))*.0254
        if value not in ('none', 'default', 'unsigned', 'below_default'):
            raise ValueError(f'Unsupported OSM maxheight {value!r}')
    if not motor:
        return 2.5
    return 3.5 if tags.get('highway') in LOCAL_ROADS else 4.5


def design_clearance(way, motor):
    minimum = clearance(way['tags'], motor)
    if motor and way['id'] in ACCEPTED_TALL_BORES and not way['tags'].get('maxheight'):
        return max(minimum, 4.5)
    return minimum

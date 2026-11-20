from common import load_osm
from features import area


WALLS = {
    'way/627526148': None,
    'way/473969804': 0xe4ccaa,
    'way/658142453': 0xe7e6e2,
    'way/671777304': 0xc58269,
    'way/1027048356': 0xe7c591,
}


def exterior_regions():
    regions = []
    for element in load_osm():
        source = f"{element['type']}/{element['id']}"
        if source not in WALLS:
            continue
        shape = area(element)
        regions.append(dict(bounds=list(shape.bounds), wall=WALLS[source],
                            ring=[[round(x, 2), round(z, 2)] for x, z in shape.exterior.coords[:-1]]))
    if len(regions) != len(WALLS):
        raise ValueError('Missing H4 campus boundary in OSM snapshot')
    return regions

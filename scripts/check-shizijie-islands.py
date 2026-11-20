"""Verify the four refuge islands against the rebuilt world, not just the allow-list."""
import sys
from pathlib import Path

from shapely.affinity import rotate, translate
from shapely.geometry import LineString, box

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'pipeline/landmarks'))
from shizijie_layout import KIOSK_CENTER, islands, surfaces


road, sidewalk = surfaces()
curbs = road.union(sidewalk)
for corner, island in zip(('NW', 'NE', 'SE', 'SW'), islands(), strict=True):
    vertices = list(island.simplify(.04).exterior.coords)
    aligned = []
    for start, end in zip(vertices, vertices[1:]):
        edge = LineString([start, end])
        if edge.length < 1:
            continue
        distances = [curbs.distance(edge.interpolate(fraction, normalized=True)) for fraction in (.1, .5, .9)]
        if max(distances) <= 1:
            aligned.append(round(max(distances), 2))
    assert island.distance(curbs) >= .39 and len(aligned) >= 2, (corner, aligned)
    print(corner, 'area', round(island.area, 2), 'm²; curb distances', aligned)

kiosk = translate(rotate(box(-1.95, -1.65, 1.95, 1.65), .55, use_radians=True), *KIOSK_CENTER)
assert islands()[1].covers(kiosk), 'NE booth roof is not entirely over its island'

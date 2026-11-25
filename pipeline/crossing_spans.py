"""Grade the West Ring deck over the traffic lanes below it."""
import numpy as np
from shapely import LineString, Point, box, union_all

from canal_passages import sample_road_heights
from features import points
from road_profile import RULES
from service_streets import width
from terminal_decks import update_slabs
from vehicle_tunnels import grade_limit


def grade_west_ring(output, manifest, elements, widths):
    bridge = 464498761
    roads = (464498744, 575608293, 685161916)
    ids = {bridge, *roads}
    ways = {e['id']: e for e in elements if e['type'] == 'way' and e['id'] in ids}
    if ways.keys() != ids:
        return
    axis = LineString(points(ways[bridge]))
    x, z, w, h = manifest['extent']
    if not box(x, z, x + w, z + h).covers(axis):
        return

    corridors = []
    for road in roads:
        tags = ways[road]['tags']
        default = RULES['defaultWidth'].get(tags['highway'], width(tags))
        half_width = widths.get(road, default) / 2
        corridors.append(LineString(points(ways[road])).buffer(half_width + .5, cap_style='flat'))
    lower = union_all(corridors)
    stations = np.linspace(0, axis.length, int(np.ceil(axis.length)) + 1)
    offsets = np.arange(-5, 5.01, .5)
    probes, inside = [], []
    for station in stations:
        center = np.array(axis.interpolate(station).coords[0])
        tangent = np.subtract(axis.interpolate(min(axis.length, station + .1)).coords[0],
                              axis.interpolate(max(0, station - .1)).coords[0])
        normal = tangent[::-1] * [-1, 1] / np.linalg.norm(tangent)
        for offset in offsets:
            px, pz = center + normal * offset
            probes.append(dict(x=px, z=pz, roofProbe=True))
            inside.append(lower.covers(Point(px, pz)))

    hits = np.array(sample_road_heights(output, manifest, probes), dtype=float)
    hits = hits.reshape(len(stations), len(offsets), 2)
    deck = hits[:, len(offsets) // 2, 1]
    present = np.isfinite(deck)
    if not np.any(present):
        return
    if not np.all(present[2:-2]):
        raise ValueError('Resurvey the West Ring deck')
    deck = np.interp(stations, stations[present], deck[present])
    same_slab = np.abs(hits[:, :, 1] - deck[:, None]) < .3
    underneath = np.reshape(inside, same_slab.shape) & same_slab
    native = np.where(underneath, hits[:, :, 0], -np.inf)
    # Allow 4.5 m below the 1.2 m fascia, plus 4 cm for baking and interpolation.
    height = np.maximum(deck, native.max(axis=1) + 5.74)
    grade = grade_limit(ways[bridge]['tags']['highway']) * .95
    budgets = grade * np.diff(stations)
    for i, budget in enumerate(budgets):
        height[i + 1] = max(height[i + 1], height[i] - budget)
    for i in reversed(range(len(budgets))):
        height[i] = max(height[i], height[i + 1] - budgets[i])
    if np.max(height - deck) < .01:
        return
    if max(height[0] - deck[0], height[-1] - deck[-1]) > .02:
        raise ValueError('Resurvey the West Ring approach heights')
    update_slabs(output, manifest['chunks'], {bridge: axis}, {bridge: stations},
                 {bridge: height}, spans=(bridge,))

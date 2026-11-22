"""Keep street shells and holes valid on the integer centimetre grid stored in GL04."""
import gzip
import json
import struct

from shapely import Polygon, make_valid, remove_repeated_points, set_precision
from features import polygons


def repaired_paths(path):
    kind, shell, *holes = path
    polygon = Polygon(shell, holes)
    if polygon.is_valid:
        return [path]
    # Rounding can cross two edges or collapse a narrow neck. Preserve the
    # shell/hole roles and snap the new intersection vertices back to cm.
    fixed = make_valid(polygon, method='structure', keep_collapsed=False)
    fixed = remove_repeated_points(set_precision(fixed, 1))
    paths = []
    for part in polygons(fixed):
        rings = [[[int(x), int(z)] for x, z in ring.coords[:-1]]
                 for ring in [part.exterior, *part.interiors]]
        paths.append([kind, *rings])
    return paths


def repair_frozen_tile(packed):
    raw = gzip.decompress(packed)
    vertices, indices, size = struct.unpack_from('<3I', raw, 4)
    start = 24 + 2 * 65**2 * 2 + vertices * 9 + indices * 4
    collision = json.loads(raw[start:start + size])
    streets = collision[1]
    paths = []
    lower = streets[11] if len(streets) > 11 else None
    first_lower = lower[0] if lower else None
    for index, path in enumerate(streets[0]):
        if index == first_lower:
            lower[0] = len(paths)
        paths.extend(repaired_paths(path))
    if first_lower == len(streets[0]):
        lower[0] = len(paths)
    if paths == streets[0]:
        return packed
    streets[0] = paths
    data = json.dumps(collision, separators=(',', ':')).encode()
    return gzip.compress(raw[:12] + struct.pack('<I', len(data)) + raw[16:start]
                         + data + raw[start + size:], compresslevel=5, mtime=0)

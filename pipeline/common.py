import math, json, os
import numpy as np
from PIL import Image

LAT0, LON0 = 25.280, 110.300
MLAT = 110574.0 + 0  # metres per degree latitude (approx at 25N)
MLON = 111320.0 * math.cos(math.radians(LAT0))
CHUNK = 256
NX, NZ = 24, 26
X0, Z0 = -NX * CHUNK / 2, -NZ * CHUNK / 2          # world min corner
X1, Z1 = -X0, -Z0
GRID = 4                                            # heightmap spacing (m)
GW, GH = NX * CHUNK // GRID + 1, NZ * CHUNK // GRID + 1
RAW = os.path.join(os.path.dirname(__file__), '..', 'raw')
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'world')

def ll2xz(lat, lon):
    return (lon - LON0) * MLON, -(lat - LAT0) * MLAT

def xz2ll(x, z):
    return LAT0 - z / MLAT, LON0 + x / MLON

def load_dem(gx=None, gz=None, *, paired=False):
    """Return float32 array [GH, GW] of elevation in metres sampled on the world grid."""
    z = 14
    tiles = {}
    for f in os.listdir(os.path.join(RAW, 'dem')):
        _, tx, ty = f[:-4].split('_')
        tiles[(int(tx), int(ty))] = f
    xs = sorted({k[0] for k in tiles}); ys = sorted({k[1] for k in tiles})
    mos = np.full(((ys[-1]-ys[0]+1)*256, (xs[-1]-xs[0]+1)*256), np.nan, np.float32)
    for (tx, ty), f in tiles.items():
        a = np.asarray(Image.open(os.path.join(RAW, 'dem', f)).convert('RGB')).astype(np.float32)
        e = a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768
        mos[(ty - ys[0]) * 256:(ty - ys[0] + 1) * 256, (tx - xs[0]) * 256:(tx - xs[0] + 1) * 256] = e
    n = 2 ** z
    if gx is None: gx = X0 + np.arange(GW) * GRID
    if gz is None: gz = Z0 + np.arange(GH) * GRID
    lon = LON0 + gx / MLON
    lat = LAT0 - gz / MLAT
    px = (lon + 180) / 360 * n * 256 - xs[0] * 256 - 0.5
    py = (1 - np.arcsinh(np.tan(np.radians(lat))) / math.pi) / 2 * n * 256 - ys[0] * 256 - 0.5
    from scipy.ndimage import map_coordinates
    if paired:
        values = map_coordinates(mos, np.stack((py,px)), order=1, mode='constant', cval=np.nan)
        if not np.isfinite(values).all():
            raise ValueError('Track geometry extends outside the supplied DEM')
        return values
    # Limit interpolation coordinates to one strip even on the full city grid.
    result = np.empty((len(py), len(px)), dtype=np.float32)
    for start in range(0, len(py), 128):
        rows = slice(start, start + 128)
        coords = np.meshgrid(py[rows], px, indexing='ij')
        map_coordinates(mos, coords, output=result[rows], order=1, mode='constant', cval=np.nan)
        if not np.isfinite(result[rows]).all():
            raise ValueError('Aligned bbox is outside supplied DEM coverage or has missing tiles')
    return result

def load_osm():
    snapshot = os.path.join(RAW, 'osm-2026-11.json')
    with open(snapshot if os.path.isfile(snapshot) else os.path.join(RAW, 'osm.json')) as source:
        return json.load(source)['elements']

"""Install the surveyed Sitang River crossing, from the fixed Y109 bridge lip."""
import base64
import json
import subprocess
import tempfile
from pathlib import Path

import numpy as np
from shapely import LineString
from shapely.ops import substring

from features import points
from surveyed_corridors import read_chunk, write_chunk

ROOT = Path(__file__).resolve().parents[1]
BORE = 1494508178


def install(output, manifest, elements):
    bore = next((t for t in manifest.get('tunnels', ()) if t['way'] == BORE), None)
    if not bore:
        return [], []
    ways = {w['id']: w for w in elements if w['type'] == 'way'}
    with np.load(Path(__file__).with_name('sitang-crossing.npz'), allow_pickle=False) as design:
        ox, _, oz = design['origin'].tolist()
        tile = next((t for t in manifest['chunks'] if (t['x'], t['z']) == (ox, oz)), None)
        if tile is None:
            return [], []
        # The sculpture, bank and abutment share the surveyed OSM alignment.
        for wid, field in ((BORE, 'bore_axis'), (882310597, 'middle_axis')):
            coordinates = np.asarray(points(ways[wid]))
            if coordinates.shape != design[field].shape or not np.allclose(
                    coordinates, design[field], atol=.02, rtol=0):
                raise ValueError(f'Resurvey the Sitang road alignment of {wid}')
        bore.pop('knotHeights', None)
        bore.pop('stationHeights', None)
        bore['stations'] = design['stations'].tolist()
        bore['crossfall'] = design['crossfall'].tolist()
        bore['portalSign'] = design['sign'].tolist()
        bore['carriagewayHalfWidth'] = 3.
        for portal, station in zip(bore['portals'], (bore['stations'][0], bore['stations'][-1])):
            portal[1] = station[1]

        path = output / tile['file']
        raw, start, size, collision = read_chunk(path)
        survey = collision[1][12]
        # Millimetre pavement encoding cannot represent the change in bank
        # across the short, skewed bridge joint. Store those faces in microns.
        bank = design['bank_v'][design['bank_i']].astype('<i4').tobytes()
        survey['bank'] = base64.b64encode(bank).decode()
        upper = design['upper_v'][design['upper_i']].astype('<i4').tobytes()
        survey['packed'] = base64.b64encode(base64.b64decode(survey['packed']) + upper).decode()
        write_chunk(path, raw, start, size, collision)
    with tempfile.TemporaryDirectory() as temp:
        request = Path(temp) / 'portal.json'
        request.write_text(json.dumps(dict(tile=tile, bore=bore, upper=base64.b64encode(upper).decode())))
        subprocess.run([ROOT/'node_modules/.bin/tsx', ROOT/'scripts/bake-sitang-portal.ts',
                        output.resolve(), request], cwd=ROOT, check=True)
    tile['bytes'] = path.stat().st_size

    raised, adjoining = [], []
    bore_axis = LineString(points(ways[BORE]))
    for chain, half, run, group in (
        ((385795256, 882310597, 882310602), 7, 109, raised),
        ((385796479, 882310596, 1494503706), 2, 60, raised),
        ((882310598,), 7, 109, adjoining),
        ((882310593, 882310599), 2, 60, adjoining),
    ):
        coords = points(ways[chain[0]])
        for wid in chain[1:]:
            other = points(ways[wid])
            if coords[-1] not in (other[0], other[-1]):
                coords = coords[::-1]
            if coords[-1] == other[-1]:
                other = other[::-1]
            if coords[-1] != other[0]:
                raise ValueError(f'Disconnected Sitang approach {wid}')
            coords += other[1:]
        axis = LineString(coords)
        center = axis.project(bore_axis.intersection(axis).centroid)
        group.append(substring(axis, max(0, center-run), min(axis.length, center+run))
                     .buffer(half, cap_style='flat'))
    return raised, adjoining

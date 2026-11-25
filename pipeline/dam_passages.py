"""Apply the same surveyed dam mask before both vessel graph builds."""
import json
from pathlib import Path

from common import GRID


def apply_dams(surface, left, top):
    directory = Path(__file__).parent
    footprints = json.loads((directory/'dam-cells.json').read_bytes())
    passages = json.loads((directory/'dam-passages.json').read_bytes())
    dry = -32768
    height, width = surface.shape
    for dam, runs in footprints.items():
        passage = passages.get(dam, {})
        openings = set(map(tuple, passage.get('cells', [])))
        if 'gateCell' in passage:
            openings.add(tuple(passage['gateCell']))
        for row, start, end in runs:
            for col in range(start, end+1):
                iz, ix = row-top//GRID, col-left//GRID
                if 0 <= iz < height and 0 <= ix < width and (col,row) not in openings:
                    surface[iz,ix] = dry
        missing = []
        for col,row in openings:
            iz, ix = row-top//GRID, col-left//GRID
            if 0 <= iz < height and 0 <= ix < width and surface[iz,ix] == dry:
                missing.append((iz,ix))
        levels = []
        for iz,ix in missing:
            nearby = surface[max(0,iz-2):iz+3, max(0,ix-2):ix+3]
            wet = nearby[nearby != dry]
            if not wet.size:
                raise ValueError(f'{dam}: no water adjacent to ferry passage')
            levels.append(round(wet.mean()))
        for (iz,ix),level in zip(missing, levels):
            surface[iz,ix] = level

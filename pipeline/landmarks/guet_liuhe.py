"""GUET Liuhe Road Campus (桂电六合路校区), IDOK-165.

All 18 buildings of docs/refs/campus/guet_liuhe/catalog.json (OSM way/606220177) on
exact footprints. Only one building has a ground photo (IDOK-166), so the rest follow
the 金鸡岭 teaching-block palette (grey-white with pink tile panels) at catalog floors.
"""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from g3_kit import export_school
import uni_campus as C


def build(b):
    cat = C.catalog('guet_liuhe')
    overrides = {r['source']: dict(style='panel', wall='white', accent='pink_wall')
                 for r in cat['buildings'] if not r.get('facade')}
    C.build_records(b, 'guet_liuhe', overrides=overrides)


if __name__ == '__main__':
    out_dir = Path(sys.argv[1])
    out_dir.mkdir(parents=True, exist_ok=True)
    export_school(out_dir / 'guet_liuhe.glb', build, signs=[])

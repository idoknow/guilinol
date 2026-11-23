"""广西商业技师学校 (IDOK-165): OSM-level campus, minors on site — plain footprint blocks from
docs/refs/campus/gxsy_jishi/catalog.json and one closed street gate with the school name."""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from g3_kit import export_school
import uni_campus as C

SIGNS = [dict(key='voc_name', title='广西商业技师学校', fg=(60, 60, 64), bg=(226, 224, 218), sans=False)]


def build(b):
    C.vocational_campus(b, 'gxsy_jishi', 'voc_name')


if __name__ == '__main__':
    out_dir = Path(sys.argv[1])
    out_dir.mkdir(parents=True, exist_ok=True)
    export_school(out_dir / 'gxsy_jishi.glb', build, signs=SIGNS)

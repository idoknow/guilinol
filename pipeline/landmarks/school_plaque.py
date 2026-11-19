"""A freestanding schematic school label; no entrance or interior geometry."""
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw
from c_kit import ATLAS, Builder, RECTS, _font, box, export_landmark


def generate(entry, output):
    image = Image.new('RGB', (ATLAS, ATLAS), '#e6e5dc')
    title = entry['name'].split('（')[0]
    RECTS['plaque'] = (0, 768, ATLAS, 256)
    ImageDraw.Draw(image).text((512,896),title,anchor='mm',font=_font(min(160,960//len(title)),bold=True),fill='#87342e')
    builders = []
    for level in range(2):
        builder = Builder(level, False)
        mesh = builder.parts['atlas']
        box(mesh,(0,1,0),(6,2,.24),'white',None)
        for side in (-1,1):
            mesh.face([(-3*side,.1,.121*side),(3*side,.1,.121*side),(3*side,1.9,.121*side),(-3*side,1.9,.121*side)],
                      (0,0,side),'plaque',uvs=[(.001,.999),(.999,.999),(.999,.001),(.001,.001)])
        builders.append((f'lod{level}',builder))
    export_landmark(output/f"{entry['id']}.glb",image,builders)


def main(identifier):
    catalog = Path(__file__).resolve().parents[1]/'landmarks.json'
    entry = next(item for item in json.loads(catalog.read_text()) if item['id']==identifier)
    generate(entry, Path(sys.argv[1]))

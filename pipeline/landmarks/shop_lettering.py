"""Cut sign lettering into one batch of coplanar faces, using existing materials."""
from functools import lru_cache
import hashlib
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.request import urlopen

import numpy as np
from PIL import Image, ImageDraw, ImageFont


@lru_cache(maxsize=1)
def sign_font():
    # The sign strokes become GLB triangles. A substitute changes the packed
    # components even when its CJK glyphs look similar.
    name = 'NotoSansCJK-Bold.ttc'
    digest = 'faa5f3656a78b2e2d450d27fe8382c778bc2b6bb5ea29c986664a6a435056ceb'
    cache = Path(__file__).resolve().parents[2]/'.world-cache'/'fonts'
    for path in (Path('/usr/share/fonts/opentype/noto')/name, cache/name):
        if path.is_file() and hashlib.sha256(path.read_bytes()).hexdigest()==digest:
            return ImageFont.truetype(str(path), 24)
    cache.mkdir(parents=True, exist_ok=True)
    url = 'https://raw.githubusercontent.com/notofonts/noto-cjk/Sans2.004/Sans/OTC/'+name
    with TemporaryDirectory(dir=cache) as tmp:
        incoming = Path(tmp)/name
        with urlopen(url, timeout=90) as response:
            incoming.write_bytes(response.read())
        if hashlib.sha256(incoming.read_bytes()).hexdigest()!=digest:
            raise ValueError('Unexpected digest for Noto Sans CJK Bold 2.004')
        incoming.replace(cache/name)
    return ImageFont.truetype(str(cache/name), 24)


def letters(model, text, center, width, height, material, facing=1):
    if not model.detail:
        return
    font = sign_font()
    left,top,right,bottom=font.getbbox(text)
    mask=Image.new('L',(right-left,bottom-top))
    ImageDraw.Draw(mask).text((-left,-top),text,font=font,fill=255)
    pixels=np.asarray(mask)>100
    east,base,south=center
    vertices=[];faces=[]
    for index,line in enumerate(pixels):
        edges=np.where(np.diff(np.r_[False,line,False]))[0]
        for start,end in zip(edges[::2],edges[1::2]):
            low=base+height*(1-(index+1)/mask.height); high=base+height*(1-index/mask.height)
            first=east+facing*width*(start/mask.width-.5);last=east+facing*width*(end/mask.width-.5)
            count=len(vertices);vertices.extend([(first,low,south),(last,low,south),(last,high,south),(first,high,south)])
            faces.extend([(count,count+1,count+2),(count,count+2,count+3)])
    if faces:model.mesh(vertices,faces,material)

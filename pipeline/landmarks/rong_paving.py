"""Coursed stone panels with UVs continuous across clipped boundary tiles."""
import math
import random

from PIL import Image, ImageDraw
from shapely.geometry import Polygon, box
from c_kit import RECTS


def slab_texture(image, left, top):
    size = 128
    tile = Image.new('RGB',(size,size),'#656461')
    brush = ImageDraw.Draw(tile)
    rng = random.Random(1316)
    for row in range(8):
        for col in range(-1,4):
            x = col*32 + row%2*16
            shade = rng.randint(149,165)
            brush.rectangle((x+1,row*16+1,x+31,row*16+15),fill=(shade,shade-1,shade-4))
    RECTS['plaza_stone'] = (left,top,size,size)
    image.paste(tile,(left,top))


def pave(builder, ring, level):
    polygon = Polygon(ring)
    size = 3.2
    left,top,right,bottom = polygon.bounds
    mesh = builder.parts['atlas']
    for col in range(math.floor(left/size),math.ceil(right/size)):
        for row in range(math.floor(top/size),math.ceil(bottom/size)):
            x,z = col*size,row*size
            part = polygon.intersection(box(x,z,x+size,z+size))
            if part.area < .001:
                continue
            coords = list(part.exterior.coords)[:-1]
            vertices = [(a,level(a,b) if callable(level) else level,b) for a,b in coords]
            uv = [(.005+.99*(a-x)/size,.005+.99*(b-z)/size) for a,b in coords]
            mesh.face(vertices,(0,1,0),'plaza_stone',uvs=uv)
            if builder.collide:
                builder.hit.face(vertices,(0,1,0),'granite')

"""Cut sign lettering into one batch of coplanar faces, using existing materials."""
import numpy as np
from PIL import Image, ImageDraw, ImageFont


def letters(model, text, center, width, height, material, facing=1):
    if not model.detail:
        return
    try:
        font = ImageFont.truetype('NotoSansCJK-Bold.ttc', 24)
    except OSError:
        font = ImageFont.truetype('/System/Library/Fonts/STHeiti Medium.ttc', 24)
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

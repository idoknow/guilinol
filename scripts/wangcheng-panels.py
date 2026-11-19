"""Assemble prints from photo-match.mjs. All satellite pixels remain view-only."""
import argparse
from pathlib import Path
import json
from PIL import Image,ImageDraw,ImageFont,ImageOps

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('before',type=Path)
parser.add_argument('satellite',type=Path)
args=parser.parse_args()
capture=Path('captures/wangcheng')
font=ImageFont.truetype('NotoSansCJK-Regular.ttc',21)
pages=[]
for camera in json.loads((capture/'cameras.json').read_text()):
    number=camera['number']
    photo=next(Path('docs/refs/rock/walk-shizijie-wangcheng').glob(number+'_*.jpg'))
    page=Image.new('RGB',(1280,920),'#f8f6ef'); draw=ImageDraw.Draw(page)
    for left,file in [(0,photo),(640,capture/(number+'.jpg'))]:
        picture=ImageOps.contain(Image.open(file),(640,840));page.paste(picture,(left+(640-picture.width)//2,55+(840-picture.height)//2))
    draw.text((12,10),f'{number}  Rock 实拍｜{photo.stem}',fill='black',font=font)
    draw.text((652,10),f"游戏｜朝向 {camera['heading']}° · {camera['focal35']} mm · 俯仰 {camera['pitch']}°",fill='black',font=font)
    pages.append(page)
pages[0].save(capture/'photo-match.pdf',save_all=True,append_images=pages[1:],quality=87)
triptych=Image.new('RGB',(2100,797),'#f8f6ef');draw=ImageDraw.Draw(triptych)
for index,(file,title) in enumerate([(args.before,'改前 · G1 场景'),(capture/'plan.jpg','改后 · 本次模型'),(args.satellite,'卫星 · Esri / Vantor 2024-12-24')]):
    triptych.paste(Image.open(file).resize((700,700)),(700*index,53));draw.text((700*index+10,10),title,fill='black',font=font)
draw.text((12,758),'北向上；游戏两栏同机位。卫星仅核布局，不同比例。© Esri / Vantor',fill='black',font=font)
triptych.save(capture/'triptych.jpg',quality=92)

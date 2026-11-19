"""Usage: uv run python scripts/lize-panels.py REFERENCE_FOLDER output.pdf"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageOps


references=Path(sys.argv[1]); output=Path(sys.argv[2]); pages=[]
font=ImageFont.truetype('NotoSansCJK-Regular.ttc',24)
views=['1345','1346','1347','1350','1354','1355','1356','1357','1358','side','night',*map(str,range(1361,1373))]
for name in (sys.argv[3:] or views):
    game=Image.open(Path('captures/lize')/(name+'.jpg')).convert('RGB')
    page=Image.new('RGB',(1080,780),'white'); draw=ImageDraw.Draw(page)
    if name.isdecimal():
        photo=ImageOps.exif_transpose(Image.open(references/('IMG_'+name+'.jpg')))
        image=ImageOps.contain(photo,(540,720))
        page.paste(image,((540-image.width)//2,60+(720-image.height)//2));page.paste(game,(540,60))
        label=f'Rock 实拍 IMG_{name}                         游戏 · 机位按画面估计'
        if '1367'<=name<='1372':label+='（截图隐藏树冠）'
    else:
        page.paste(game,(270,60));label='补充机位（无实拍对应） · '+('侧面远景' if name=='side' else '夜景')
    draw.text((14,10),label,font=font,fill='black');pages.append(page)
pages[0].save(output,save_all=True,append_images=pages[1:],quality=87)

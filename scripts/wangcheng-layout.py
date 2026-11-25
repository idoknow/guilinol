"""Render the IDOK-44 pre-model layout sheet; source rasters stay outside git."""
import argparse
import json
import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'pipeline'))
from common import ll2xz, load_osm, xz2ll

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('plan', help='700px square, 55° vertical FOV, camera (-676,975,-370) facing straight down, north up')
parser.add_argument('satellite', help='square World Imagery export, bbox=110.290,25.280,110.297,25.287; bboxSR=4326, imageSR=3857')
parser.add_argument('output')
parser.add_argument('--font', default='/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc')
args = parser.parse_args()
photos = {int(Path(key).name[:2]): value for key, value in json.loads(
    (ROOT / '.ops-docs/refs/rock/photo-locations.json').read_text()).items() if key.startswith('walk-shizijie-wangcheng/')}
assert sorted(photos) == list(range(1, 39))
ways = {element['id']: element for element in load_osm() if element['type'] == 'way' and 'geometry' in element}
features = {264901525:'王城商厦', 1008248059:'正阳门', 1008248065:'承运门', 674165595:'四教楼',
            674165596:'三教楼', 674165597:'五教楼', 686154940:'江南巷', 686307032:'仁寿巷', 686307041:'兰井巷'}
out = Image.new('RGB', (1800,1500), '#f5f4ef')
ink = ImageDraw.Draw(out)
fonts = {size: ImageFont.truetype(args.font,size) for size in (16,19,23,30)}


def text(draw, pos, string, size=19, color='#152b39', dark=False):
    draw.text(pos,string,font=fonts[size],fill=color,stroke_width=2 if dark else 0,stroke_fill='#182328')


def camera_point(photo):
    return photo['x'],photo['z']


def bearing(point, angle, distance):
    azimuth = math.radians(angle)
    return point[0]+distance*math.sin(azimuth),point[1]-distance*math.cos(azimuth)


def track(draw, project):
    for start,end,color in [(1,18,'#ffcb56'),(19,35,'#2bf4cd'),(36,38,'#fe80a3')]:
        pts = [project(*camera_point(photos[number])) for number in range(start,end+1)]
        draw.line(pts,fill=color,width=3)
        for px,py in pts:
            draw.ellipse((px-2,py-2,px+2,py+2),fill=color)


def mercator(lat):
    return math.degrees(math.asinh(math.tan(math.radians(lat))))


span = mercator(25.287)-mercator(25.280)


def aerial(east,south):
    lat,lon = xz2ll(east,south)
    return 285+(lon-110.2935)*570/span,(mercator(25.287)-mercator(lat))*570/span


def overview(file, left, project):
    panel = Image.open(file).convert('RGB').resize((570,570))
    draw = ImageDraw.Draw(panel)
    track(draw,project)
    for label,east,south in [('十字街',-880,-170),('商厦',-580,-37),('正阳门',-588,-227),('承运门',-567,-372),
                             ('独秀峰',-513,-679),('师大',-662,-605),('旧江南巷模型',-422,-201)]:
        px,py = project(east,south)
        draw.ellipse((px-3,py-3,px+3,py+3),fill='white',outline='black')
        text(draw,(px+4,py-13),label,16,'white',True)
    out.paste(panel,(left,103))


def detail(left,top,title,box,scale,numbers,labels):
    panel = Image.new('RGB',(570,480),'#e9e8df')
    draw = ImageDraw.Draw(panel)
    def project(east,south):
        return (east-box[0])*scale,(south-box[1])*scale
    for ident,way in ways.items():
        points = [project(*ll2xz(node['lat'],node['lon'])) for node in way['geometry']]
        if len(points)<2 or not any(-150<px<720 and -150<py<630 for px,py in points):
            continue
        tags = way.get('tags',{})
        if 'building' in tags and len(points)>2:
            draw.polygon(points,fill='#a8c2c4' if ident in features else '#d2d4ca',outline='#839691')
        elif 'highway' in tags:
            draw.line(points,fill='#819689' if ident in features else '#c3bbab',width=3)
    for number in numbers:
        photo = photos[number]; point = camera_point(photo); origin = project(*point)
        heading = photo['heading']; half = math.degrees(math.atan(18/photo['focal35']))
        distance = 70 if number in (6,9) else 28
        vertices = [project(*bearing(point,heading-half+half*index/8,distance)) for index in range(17)]
        shade = '#4b87a1' if number<36 else '#af486a'
        draw.line([origin,*vertices,origin],fill=shade,width=1)
        draw.line([origin,project(*bearing(point,heading,distance))],fill=shade,width=2)
        px,py=origin
        draw.ellipse((px-3,py-3,px+3,py+3),fill='#172e36')
    for east,south,label in labels:
        px,py=project(east,south);text(draw,(px,py),label,16,'white',True)
    draw.line([(18,456),(18+20*scale,456)],fill='#132d37',width=3)
    text(draw,(18,430),'20 m',16)
    text(ink,(left,top-40),title,23);out.paste(panel,(left,top))


text(ink,(22,5),'十字街 → 东西巷 → 王城｜建模前布局校正',30)
text(ink,(22,61),'01   改前游戏俯视 · 近似地面投影',23)
text(ink,(612,61),'02   WGS84 机位叠卫星 · Esri / Vantor',23)
overview(args.plan,22,lambda east,south:(285+(east+676)*285/(817.3*math.tan(math.radians(27.5))),285+(south+370)*285/(817.3*math.tan(math.radians(27.5)))))
overview(args.satellite,612,aerial)
text(ink,(1202,95),'读图约定 · 北在上，东在右',23)
notes=['黄：01–18 街面与东西巷；绿：19–35 入城。','粉：36–38 返回；连线只表示拍摄顺序。','下排：OSM 建筑轮廓与道路；蓝扇为镜头水平视角。','扇边由焦距决定；绘图半径不表示可见距离。','扇形没有计算遮挡，不能据此认定立面或门牌。','01 水平误差 20.9 m，36 为 14 m，38 为 35.9 m。','19 朝南，20–22 转向北；33 朝东，34/35 朝北。','东华门、东墙、承运门与峰的位置均不调整。','卫星拍摄：2024-12-24；Esri 版本 2026.R09。','影像仅看布局；下排线划 © OpenStreetMap contributors。']
for idx,line in enumerate(notes):text(ink,(1202,143+idx*42),line,19)
detail(22,752,'A   商厦对街与入口：06–09 / 10–15',(-721,-185),2.45,[6,7,8,9,10,11,12,13,14,15],
       [(-696,-143,'01'),(-646,-119,'06 / 09 ↘↓'),(-630,-161,'10/11 广场'),(-604,-145,'12 牌坊方向'),(-595,-49,'王城商厦')])
detail(612,752,'B   横巷到南门：16–24',(-676,-275),3.08,list(range(16,25)),
       [(-616,-252,'正阳门'),(-589,-215,'22'),(-591,-190,'南门外广场'),(-590,-112,'东西向 16–18'),(-560,-194,'仁寿巷')])
detail(1202,752,'C   王城主轴：25–38',(-675,-408),2.46,list(range(25,39)),
       [(-563,-388,'承运门 / 34、35 ↑峰'),(-561,-348,'29、30 ↗ 打卡装置'),(-577,-293,'25'),(-586,-267,'36、37 返回')])
text(ink,(22,1260),'给建模的约束',23)
for idx,line in enumerate(['01–05 拍摄点在十字街以东，并非路口四角。06、09 镜头包含王城商厦；07 朝西北、08 朝西南，不能据此复制商厦立面。',
    '10–18 东西向段位于旧江南巷模型西侧；保留地图中的江南巷，另建实拍入口、大屏与横巷。12 向北看牌坊，机位不是柱基。',
    '19–23 对准南门外广场与正阳门；25–32 在城内主轴。师大三、四、五教楼以各自地图基座定位，不把打卡装置误作教学楼。',
    '本图是建模约束，不是改后截图。底图：改前 G1 游戏场景、Esri World Imagery；机位：Rock 2026-11-19，统一使用 WGS84。']):
    text(ink,(22,1304+idx*40),line,19)
out.save(args.output)

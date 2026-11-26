#!/usr/bin/env python3
"""
Guilin Online City Upgrade v1+ — Full-City Offline Spatial Shard Pipeline (4,080 chunks / 955 non-empty shards).

Upgrades all non-landmark GL04 buildings across the full open map (4,080 chunks -> 955 non-empty 512m spatial shards) into:
  - public/city-upgrade/index.json (unless --no-index is passed; rebuildable via merge_index.py)
  - public/city-upgrade/shards/<gx>_<gz>.json

Features:
  - Hard guard against dev_bbox (325-chunk dev subset) unless --allow-dev-world is explicitly passed
  - Sector & ring filtering: --sector west | ne | south | edge | all, --ring r1 | r2 | r3 | r4 | all
  - Skips completely empty shards (no empty JSON files written)
  - Fast Shapely STRtree spatial indexing across 40,313 Tsinghua CMAB buildings & full OSM road network
  - Regional Guilin architectural style weighting:
      * Old downtown commercial-residential (中山路/三多路/西城路/南门桥)
      * Station / arterial / Qixing / West Ring commercial (桂林站/七星/解放桥东/漓江路/西二环)
      * Lingui New District modern stone/glass & stucco (临桂大道/世纪东路/西城大道/机场路)
      * Liangjiang Airport & perimeter strict quiet zone (aeroway=* zero signage/AC/poles) + restrained villages
      * Riverside / karst scenic corridor (漓江/两江四湖/穿山/象鼻山/伏波/叠彩/桃花江周边)
      * Compounds / schools / hospitals (quiet zones, zero commercial signage, subtle v1 iron fences only)
  - Automated absolute landmark protection (pipeline/landmarks.json + manifest.json + public/landmarks/*.glb + Tianyuan)
  - Spatial neighbor hue anti-collision & automatic 2-way split for wide fascias (fw > 6.2m)
  - Automatic per-shard gzip size guard (< 25 KB gzip per shard)
"""
from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
import math
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import time
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
from shapely import STRtree, from_wkt, is_valid, make_valid, prepare, union_all
from shapely.affinity import affine_transform
from shapely.geometry import LineString, Point, Polygon, box
from shapely.ops import polygonize, unary_union

from sign_catalog import BLADE_POOLS, FASCIA_META, ZONE_POOLS

REPO_ROOT = Path(__file__).resolve().parents[2]
REF_ROOT = Path("/Users/pan-work/guilinol-sanduo-opt")

LAT0, LON0 = 25.280, 110.300
MLAT = 110574.0
MLON = 111320.0 * math.cos(math.radians(LAT0))

CITY_CENTER = (-850.0, 0.0)
R1_RADIUS = 1000.0
R2_RADIUS = 2000.0
R3_RADIUS = 4500.0
SHARD_SIZE = 512
MAX_SHARD_GZIP_BYTES = 24_500  # strict margin below 25 KB (25,600 bytes)

# Tianyuan Mifen exact oriented footprint (web/src/mifen/shop-mesh.ts)
TIANYUAN_CENTER = (-1139.2, -55.5)
TIANYUAN_ROT = 2.83616 - math.pi

# Full pinyin lookup for all 170 named drivable/walkable roads in open Guilin map
ROAD_PINYIN: dict[str, str] = {
    "七星路": "QIXING LU", "七星路一巷": "QIXING LU YIXIANG", "万寿巷": "WANSHOU XIANG",
    "三多路": "SANDUO LU", "三皇路": "SANHUANG LU", "上关路": "SHANGGUAN LU",
    "上海南路": "SHANGHAI NANLU", "上海路": "SHANGHAI LU", "上海路立交桥": "SHANGHAI LU OVERPASS",
    "东华巷": "DONGHUA XIANG", "东华路": "DONGHUA LU", "东城路": "DONGCHENG LU",
    "东安路": "DONGAN LU", "东江二路": "DONGJIANG ERLU", "东江路": "DONGJIANG LU",
    "东镇路": "DONGZHEN LU", "中华路": "ZHONGHUA LU", "中山中路": "ZHONGSHAN ZHONGLU",
    "中山北路": "ZHONGSHAN BEILU", "中山南路": "ZHONGSHAN NANLU", "临桂路": "LINGUI LU",
    "临江路": "LINJIANG LU", "丽中路": "LIZHONG LU", "丽君路": "LIJUN LU",
    "丽泽桥": "LIZE QIAO", "乐群路": "LEQUN LU", "九华路": "JIUHUA LU",
    "九岗岭路": "JIUGANGLING LU", "九岗岭路一巷": "JIUGANGLING YIXIANG", "九岗岭路二巷": "JIUGANGLING ERXIANG",
    "五美路": "WUMEI LU", "五里店路": "WULIDIAN LU", "交通路": "JIAOTONG LU",
    "人民路": "RENMIN LU", "仁寿巷": "RENSHOU XIANG", "伏和巷": "FUHE XIANG",
    "会仙路": "HUIXIAN LU", "会展道": "HUIZHAN DAO", "依仁路": "YIREN LU",
    "依仁路步行街": "YIREN PEDESTRIAN ST", "信义桥": "XINYI QIAO", "信义路": "XINYI LU",
    "六合路": "LIUHE LU", "六狮路": "LIUSHI LU", "兰井巷": "LANJING XIANG",
    "凤北路": "FENGBEI LU", "华夏之光广场": "HUAXIA SQUARE", "南新二路": "NANXIN ERLU",
    "南溪桥": "NANXI QIAO", "南环路": "NANHUAN LU", "南门桥": "NANMEN QIAO",
    "叠彩路": "DIECAI LU", "和平巷": "HEPING XIANG", "四会路": "SIHUI LU",
    "复兴里": "FUXING LI", "天鹅巷": "TIANE XIANG", "太平路": "TAIPING LU",
    "好吃街": "HAOCHI JIE", "宁远桥": "NINGYUAN QIAO", "宁远路": "NINGYUAN LU",
    "安家路": "ANJIA LU", "安新北路": "ANXIN BEILU", "安新南路": "ANXIN NANLU",
    "宝积桥": "BAOJI QIAO", "宝贤桥": "BAOXIAN QIAO", "寻源桥": "XUNYUAN QIAO",
    "将军桥": "JIANGJUN QIAO", "将军路": "JIANGJUN LU", "尚水美食街": "SHANGSHUI FOOD ST",
    "屏风路": "PINGFENG LU", "崇信路": "CHONGXIN LU", "崇善路": "CHONGSHAN LU",
    "建安路": "JIANAN LU", "建干路": "JIANGAN LU", "惠济桥": "HUIJI QIAO",
    "文化宫路": "WENHUAGONG LU", "文昌桥": "WENCHANG QIAO", "文明路": "WENMING LU",
    "新桥园路": "XINQIAOYUAN LU", "新码路": "XINMA LU", "施家园路": "SHIJIAYUAN LU",
    "木龙桥": "MULONG QIAO", "杉湖北路": "SHANHU BEILU", "栖霞桥": "QIXIA QIAO",
    "栖霞路": "QIXIA LU", "桂香里": "GUIXIANG LI", "桃花江桥": "TAOHUAJIANG QIAO",
    "梨园路": "LIYUAN LU", "榕城路": "RONGCHENG LU", "榕湖北路": "RONGHU BEILU",
    "榕湖南路": "RONGHU NANLU", "榕溪桥": "RONGXI QIAO", "榕荫路": "RONGYIN LU",
    "正阳步行街": "ZHENGYANG WALK", "正阳路": "ZHENGYANG LU", "毅峰南路": "YIFENG NANLU",
    "毅峰路": "YIFENG LU", "民主路": "MINZHU LU", "民族路": "MINZU LU",
    "民族路北巷": "MINZU BEIXIANG", "江东桥": "JIANGDONG QIAO", "江南巷": "JIANGNAN XIANG",
    "济民路": "JIMIN LU", "清秀路": "QINGXIU LU", "湖光路": "HUGUANG LU",
    "滨北路": "BINBEI LU", "滨江路": "BINJIANG LU", "漓江路": "LIJIANG LU",
    "漓滨路": "LIBIN LU", "漓苑巷": "LIYUAN XIANG", "灵剑路": "LINGJIAN LU",
    "环城北一路": "HUANCHENG BEIYILU", "环城北二路": "HUANCHENG BEIERLU",
    "环城南三路": "HUANCHENG NANSANLU", "环城西一路": "HUANCHENG XIYILU",
    "环城西二路": "HUANCHENG XIERLU", "甲山路": "JIASHAN LU", "福棠巷": "FUTANG XIANG",
    "空明西路": "KONGMING XILU", "穿山东路": "CHUANSHAN DONGLU", "穿山北路": "CHUANSHAN BEILU",
    "穿山小街": "CHUANSHAN XIAOJIE", "穿山桥": "CHUANSHAN QIAO", "穿山路": "CHUANSHAN LU",
    "篦子园路": "BIZIYUAN LU", "翊武路": "YIWU LU", "翠竹路": "CUIZHU LU",
    "自由路": "ZIYOU LU", "芙蓉路": "FURONG LU", "芦笛路": "LUDI LU",
    "花桥": "HUA QIAO", "芳香路": "FANGXIANG LU", "苍松路": "CANGSONG LU",
    "苗圃路": "MIAOPU LU", "虞山桥": "YUSHAN QIAO", "虞山路": "YUSHAN LU",
    "螺狮山路": "LUOSHISHAN LU", "西凤路": "XIFENG LU", "西华里": "XIHUA LI",
    "西城步行街": "XICHENG WALK", "西城脚": "XICHENG JIAO", "西城路": "XICHENG LU",
    "西山路": "XISHAN LU", "西山路南巷": "XISHAN NANXIANG", "西清路": "XIQING LU",
    "西门桥": "XIMEN QIAO", "解放东路": "JIEFANG DONGLU", "解放桥": "JIEFANG QIAO",
    "解放西路": "JIEFANG XILU", "象山南路": "XIANGSHAN NANLU", "贡后巷": "GONGHOU XIANG",
    "辅星路": "FUXING LU", "金星路": "JINXING LU", "铁佛路": "TIEFO LU",
    "铁西中路": "TIEXI ZHONGLU", "铁西西巷": "TIEXI XIXIANG", "铁西路": "TIEXI LU",
    "银锭路": "YINDING LU", "阳桥": "YANG QIAO", "雉山路": "ZHISHAN LU",
    "驿前横里": "YIQIAN HENGLI", "骖鸾路": "CANLUAN LU", "骝马山北巷": "LIUMASHAN BEIXIANG",
    "龙珠路": "LONGZHU LU", "龙船坪路": "LONGCHUANPING LU", "龙隐桥": "LONGYIN QIAO",
    "龙隐路": "LONGYIN LU", "府后里": "FUHOU LI", "府东里": "FUDONG LI",
    "小井巷": "XIAOJING XIANG", "棠梓巷": "TANGZI XIANG", "斗姆巷": "DOUMU XIANG",
    "八桂路": "BAGUI LU", "北极广场": "BEIJI GUANGCHANG",
    # West / Lingui / West Ring / Airport-corridor roads
    "万中路": "WANZHONG LU", "万南路": "WANNAN LU", "万和路": "WANHE LU",
    "万平路": "WANPING LU", "万福路": "WANFU LU", "三中路": "SANZHONG LU",
    "三元东路": "SANYUAN DONGLU", "三元路": "SANYUAN LU", "世纪东路": "SHIJI DONGLU",
    "世纪大道": "SHIJI DADAO", "两江大道": "LIANGJIANG DADAO", "中隐路": "ZHONGYIN LU",
    "临政路": "LINZHENG LU", "临桂大道": "LINGUI DADAO", "临江东路": "LINJIANG DONGLU",
    "临苏路": "LINSU LU", "义宁路": "YINING LU", "二塘老街": "ERTANG LAOJIE",
    "人和路": "RENHE LU", "仕通路": "SHITONG LU", "仙湖路": "XIANHU LU",
    "会元路": "HUIYUAN LU", "会展北路": "HUIZHAN BEILU", "侯山隧道": "HOUSHAN TUNNEL",
    "公园北路": "GONGYUAN BEILU", "兰塘东路": "LANTANG DONGLU", "兰塘西路": "LANTANG XILU",
    "兴临路": "XINGLIN LU", "兴桂二路": "XINGGUI ERLU", "军民路": "JUNMIN LU",
    "凤凰路": "FENGHUANG LU", "凤山巷": "FENGSHAN XIANG", "友爱路": "YOUAI LU",
    "友谊路": "YOUYI LU", "和兴路": "HEXING LU", "和艺路": "HEYI LU",
    "大山图公路": "DASHANTU GONGLU", "大律路": "DALV LU", "宏谋北路": "HONGMOU BEILU",
    "宏谋大道": "HONGMOU DADAO", "山水大道": "SHANSHUI DADAO", "崇文路": "CHONGWEN LU",
    "平桂路": "PINGGUI LU", "广福路": "GUANGFU LU", "庙头新街": "MIAOTOU XINJIE",
    "庭江路": "TINGJIANG LU", "康宁中路": "KANGNING ZHONGLU", "康宁路": "KANGNING LU",
    "建设路": "JIANSHE LU", "政通路": "ZHENGTONG LU", "新龙一巷": "XINLONG YIXIANG",
    "新龙二巷": "XINLONG ERXIANG", "新龙路": "XINLONG LU", "机场路": "JICHANG LU",
    "桂康路": "GUIKANG LU", "桃花江北路": "TAOHUAJIANG BEILU", "桃花江路": "TAOHUAJIANG LU",
    "榕山路": "RONGSHAN LU", "永兴路": "YONGXING LU", "沙塘大道": "SHATANG DADAO",
    "泰安路": "TAIAN LU", "洋田北路": "YANGTIAN BEILU", "洋田路": "YANGTIAN LU",
    "海吉星一路": "HAIJIXING YILU", "燕山路": "YANSHAN LU", "环湖路": "HUANHU LU",
    "琴谭道": "QINTAN DAO", "瑞宁路": "RUINING LU", "电子一路": "DIANZI YILU",
    "相人山路": "XIANGRENSHAN LU", "福寿路": "FUSHOU LU", "科创路": "KECHUANG LU",
    "秧十五路": "YANGSHIWU LU", "秧塘路": "YANGTANG LU", "空港路": "KONGGANG LU",
    "红光路": "HONGGUANG LU", "红岭路": "HONGLING LU", "胜利桥": "SHENGLI QIAO",
    "致和路": "ZHIHE LU", "致远路": "ZHIYUAN LU", "莲花路": "LIANHUA LU",
    "虎山路": "HUSHAN LU", "西二环路": "XIERHUAN LU", "西城大道": "XICHENG DADAO",
    "西站东路": "XIZHAN DONGLU", "遇龙路": "YULONG LU", "金山路": "JINSHAN LU",
    "金水路": "JINSHUI LU", "锦绣路": "JINXIU LU", "长丰路": "CHANGFENG LU",
    "长海路": "CHANGHAI LU", "阳江路": "YANGJIANG LU", "青云路": "QINGYUN LU",
    "青莲路": "QINGLIAN LU", "飞虎路": "FEIHU LU", "飞鸾桥": "FEILUAN QIAO",
    "鲁东路": "LUDONG LU", "鲁兴路": "LUXING LU", "鲁安路": "LUAN LU",
    "鲁山路": "LUSHAN LU", "黑山路": "HEISHAN LU", "龙门路": "LONGMEN LU",
    # North / East / South outer-ring roads
    "七里店路": "QILIDIAN LU", "万康路": "WANKANG LU", "万成巷": "WANCHENG XIANG",
    "下梁江路": "XIALIANGJIANG LU", "东二环路": "DONGERHUAN LU", "乌岭隧道": "WULING TUNNEL",
    "信息路": "XINXI LU", "八定路": "BADING LU", "八里一路": "BALI YILU",
    "八里二路": "BALI ERLU", "八里三路": "BALI SANLU", "八里四路": "BALI SILU",
    "八里五路": "BALI WULU", "八里六路": "BALI LIULU", "八里七路": "BALI QILU",
    "八里八路": "BALI BALU", "八里九路": "BALI JIULU", "净瓶山大桥": "JINGPINGSHAN BRIDGE",
    "净瓶路": "JINGPING LU", "凯风路": "KAIFENG LU", "创业三道": "CHUANGYE SANDAO",
    "创业五道": "CHUANGYE WUDAO", "创优路": "CHUANGYOU LU", "创新道": "CHUANGXIN DAO",
    "北仓路": "BEICANG LU", "北和路": "BEIHE LU", "北贸道": "BEIMAO DAO",
    "北辰路": "BEICHEN LU", "合心道": "HEXIN DAO", "圣隆路": "SHENGLONG LU",
    "大雄路": "DAXIONG LU", "奇峰路": "QIFENG LU", "尧山路": "YAOSHAN LU",
    "川东一路": "CHUANDONG YILU", "川东二路": "CHUANDONG ERLU", "川东三路": "CHUANDONG SANLU",
    "川东四路": "CHUANDONG SILU", "川东五路": "CHUANDONG WULU", "川西一路": "CHUANXI YILU",
    "平山北路": "PINGSHAN BEILU", "广达路": "GUANGDA LU", "恒信路": "HENGXIN LU",
    "抗战路": "KANGZHAN LU", "星华路": "XINGHUA LU", "星海路": "XINGHAI LU",
    "春江北路": "CHUNJIANG BEILU", "春江路西一里": "CHUNJIANGLU XIYILI", "普陀路": "PUTUO LU",
    "朝阳路": "CHAOYANG LU", "桂磨路": "GUIMO LU", "横塘路": "HENGTANG LU",
    "毛塘西路": "MAOTANG XILU", "毛塘路": "MAOTANG LU", "水塔路": "SHUITA LU",
    "永和路": "YONGHE LU", "永彩南路": "YONGCAI NANLU", "永彩路": "YONGCAI LU",
    "永贸路": "YONGMAO LU", "湖塘路": "HUTANG LU", "灵川东环路": "LINGCHUAN DONGHUANLU",
    "灵川大道": "LINGCHUAN DADAO", "灵朝线": "LINGCHAO XIAN", "燕山桥": "YANSHAN QIAO",
    "犁头山隧道": "LITOUSHAN TUNNEL", "环城南一路": "HUANCHENG NANYILU", "环城南二路": "HUANCHENG NANERLU",
    "瓦窑东路": "WAYAO DONGLU", "瓦窑西路": "WAYAO XILU", "瓦窑路": "WAYAO LU",
    "社山桥": "SHESHAN QIAO", "福利路": "FULI LU", "空明东路": "KONGMING DONGLU",
    "站前路": "ZHANQIAN LU", "紫杉路": "ZISHAN LU", "群众东路": "QUNZHONG DONGLU",
    "群众路": "QUNZHONG LU", "育才路": "YUCAI LU", "胜利路": "SHENGLI LU",
    "航天路": "HANGTIAN LU", "花卉大道": "HUAHUI DADAO", "花园桥": "HUAYUAN QIAO",
    "芳华路": "FANGHUA LU", "芳香东路": "FANGXIANG DONGLU", "英才西路": "YINGCAI XILU",
    "英才路": "YINGCAI LU", "茶店路": "CHADIAN LU", "蜈蚣山隧道": "WUGONGSHAN TUNNEL",
    "象塘路": "XIANGTANG LU", "辰山路": "CHENSHAN LU", "金桂路": "JINGUI LU",
    "金河路": "JINHE LU", "金鸡路": "JINJI LU", "铁山路": "TIESHAN LU",
    "铁骑大道": "TIEQI DADAO", "银桂路": "YINGUI LU", "锦城巷": "JINCHENG XIANG",
    "长虹东路": "CHANGHONG DONGLU", "长虹中路": "CHANGHONG ZHONGLU", "长虹西路": "CHANGHONG XILU",
    "青岭路": "QINGLING LU", "青柳路": "QINGLIU LU", "靖江路": "JINGJIANG LU",
    "黄桐路": "HUANGTONG LU", "龙门大桥": "LONGMEN BRIDGE",
}

RING_ORDER = {"r1": 1, "r2": 2, "r3": 3, "r4": 4}

# Road names strongly defining Old Downtown vs Station/Qixing/Outer Modern Commercial
OLD_DOWNTOWN_ROADS = {
    "三多路", "中山中路", "解放西路", "解放东路", "西城路", "西城步行街", "南环路",
    "榕荫路", "翊武路", "文明路", "民主路", "正阳路", "正阳步行街", "依仁路",
    "五美路", "乐群路", "中华路", "四会路", "府后里", "府东里", "湖光路", "信义路",
    "西凤路", "丽君路", "太平路", "人民路", "榕湖北路", "榕湖南路", "杉湖北路",
    "凤北路", "伏和巷", "东华路", "东镇路", "崇善路", "铁佛路", "叠彩路",
}
MODERN_ARTERIAL_ROADS = {
    "中山南路", "上海路", "上海南路", "漓江路", "七星路", "穿山东路", "穿山路",
    "环城西二路", "环城西一路", "环城北一路", "环城北二路", "环城南三路",
    "建干路", "自由路", "骖鸾路", "五里店路", "普陀路", "六合路", "屏风路",
    "空明西路", "会展道", "栖霞路", "东江路", "东江二路", "龙隐路", "翠竹路",
    "崇信路", "民族路", "铁西路", "安新南路", "安新北路", "中山北路", "虞山路",
    # Outer-ring modern arterials (Lingui / West Ring / North / East / South)
    "临桂大道", "世纪东路", "世纪大道", "西城大道", "机场路", "公园北路",
    "宏谋大道", "宏谋北路", "金山路", "金水路", "平桂路", "鲁山路", "榕山路",
    "山水大道", "万平路", "万福路", "沙塘大道", "飞虎路", "临政路", "政通路",
    "会元路", "致和路", "致远路", "兴临路", "广福路", "仕通路", "桂康路",
    "凤凰路", "新龙路", "虎山路", "两江大道", "临苏路", "瑞宁路", "兴桂二路",
    "会展北路", "康宁路", "康宁中路", "万中路", "万南路", "万和路",
    "西二环路", "中隐路", "红岭路", "琴谭道", "桃花江路", "桃花江北路",
    "环湖路", "阳江路", "黑山路", "东安路", "鲁东路", "鲁安路", "鲁兴路",
    "三元路", "三元东路", "锦绣路", "长丰路", "长海路",
    "北辰路", "站前路", "福利路", "灵川大道", "灵川东环路", "八里一路", "八里二路",
    "八里三路", "八里四路", "八里五路", "八里六路", "八里七路", "八里八路", "八里九路",
    "东二环路", "桂磨路", "金鸡路", "金河路", "铁山路", "创业三道", "创业五道",
    "创新道", "英才路", "英才西路", "航天路", "花卉大道", "尧山路",
    "凯风路", "瓦窑路", "瓦窑东路", "瓦窑西路", "环城南一路", "环城南二路",
    "净瓶路", "平山北路", "相人山路", "遇龙路", "洋田路", "象塘路",
}
LINGUI_MAIN_ROADS = {
    "临桂大道", "世纪东路", "世纪大道", "西城大道", "机场路", "公园北路",
    "宏谋大道", "宏谋北路", "金山路", "金水路", "平桂路", "鲁山路", "榕山路",
    "山水大道", "人民路", "万平路", "万福路", "沙塘大道", "飞虎路", "临政路",
    "政通路", "会元路", "致和路", "致远路", "兴临路", "广福路", "仕通路",
    "桂康路", "凤凰路", "新龙路", "虎山路", "两江大道", "临苏路", "兴桂二路",
    "会展北路", "康宁路", "康宁中路", "万中路", "万南路", "万和路",
}


def resolve_path(preferred: Path | None, rel: str) -> Path:
    if preferred is not None:
        return preferred
    p_repo = REPO_ROOT / rel
    if p_repo.exists():
        return p_repo
    p_ref = REF_ROOT / rel
    if p_ref.exists():
        return p_ref
    return p_repo


def ll2xz(lat: float, lon: float) -> tuple[float, float]:
    return (lon - LON0) * MLON, -(lat - LAT0) * MLAT


def wm2ll(mx: float, my: float) -> tuple[float, float]:
    lon = mx / 20037508.34 * 180.0
    lat = math.degrees(2.0 * math.atan(math.exp(my / 20037508.34 * math.pi)) - math.pi / 2.0)
    return lat, lon


def xz2wm(x: float, z: float) -> tuple[float, float]:
    lat = LAT0 - z / MLAT
    lon = LON0 + x / MLON
    mx = lon * 20037508.34 / 180.0
    my = math.log(math.tan((90.0 + lat) * math.pi / 360.0)) / (math.pi / 180.0) * 20037508.34 / 180.0
    return mx, my


def chunk_ring(tx: int, tz: int) -> str:
    mx, mz = tx + 128.0, tz + 128.0
    d = math.hypot(mx - CITY_CENTER[0], mz - CITY_CENTER[1])
    if d <= R1_RADIUS:
        return "r1"
    if d <= R2_RADIUS:
        return "r2"
    if d <= R3_RADIUS:
        return "r3"
    return "r4"


def shard_ring(gx: int, gz: int) -> str:
    best = "r4"
    for dx in (0, 256):
        for dz in (0, 256):
            r = chunk_ring(gx * SHARD_SIZE + dx, gz * SHARD_SIZE + dz)
            if RING_ORDER[r] < RING_ORDER[best]:
                best = r
    return best


def shard_in_sector(gx: int, gz: int, sector: str) -> bool:
    if sector == "all":
        return True
    if sector == "west":
        return gx <= -6
    if sector == "north":
        return gx >= -5 and gz <= -6
    if sector == "east":
        return gx >= 3 and gz >= -5
    if sector == "ne":
        return gx >= 3 or (gx >= -5 and gz <= -6)
    if sector == "south":
        return -5 <= gx <= 2 and gz >= 7
    if sector == "es":
        return (gx >= 3 and gz >= -5) or (-5 <= gx <= 2 and gz >= 7)
    if sector == "edge":
        return -5 <= gx <= 2 and -5 <= gz <= 6
    raise ValueError(f"Unknown sector: {sector}")


def shard_of(x: float, z: float) -> tuple[int, int]:
    return math.floor(x / SHARD_SIZE), math.floor(z / SHARD_SIZE)


def osm_element_area(el: dict) -> Polygon:
    if el.get("type") == "way":
        geom = el.get("geometry") or []
        coords = [ll2xz(p["lat"], p["lon"]) for p in geom]
        if len(coords) >= 4 and coords[0] == coords[-1]:
            return make_valid(Polygon(coords))
        return Polygon()
    if el.get("type") == "relation":
        def rings(role: str):
            lines = []
            for m in el.get("members", []):
                if m.get("role") == role and m.get("geometry"):
                    pts = [ll2xz(p["lat"], p["lon"]) for p in m["geometry"]]
                    if len(pts) >= 2:
                        lines.append(LineString(pts))
            return unary_union(list(polygonize(lines))) if lines else Polygon()
        outer = rings("outer")
        inner = rings("inner")
        return outer.difference(inner) if not inner.is_empty else outer
    return Polygon()


def tianyuan_polygon() -> Polygon:
    cx, cz = TIANYUAN_CENTER
    co, si = math.cos(TIANYUAN_ROT), math.sin(TIANYUAN_ROT)
    # Full building + front patio apron (hx=3.5, z in [-7.5, +10.0]) + safety margin
    local_corners = [(-5.5, -9.2), (5.5, -9.2), (5.5, 11.2), (-5.5, 11.2)]
    world_pts = [(cx + lx * co + lz * si, cz - lx * si + lz * co) for lx, lz in local_corners]
    return Polygon(world_pts)


def _glb_footprint_polygon(glb_path: Path, px: float, pz: float, rot_deg: float, cell: float = 1.5) -> Polygon:
    """Fast vectorized 1.5m-grid 2D XZ structural footprint (y > 0.6m) of a hand-crafted landmark GLB."""
    import trimesh

    gltfpack = os.getenv("GLTFPACK") or shutil.which("gltfpack") or "/Users/macbook/.local/bin/gltfpack"
    rot = math.radians(rot_deg)
    cs, sn = math.cos(rot), math.sin(rot)
    T = np.array([[cs, 0.0, sn, px], [0.0, 1.0, 0.0, 0.0], [-sn, 0.0, cs, pz], [0.0, 0.0, 0.0, 1.0]], dtype=float)
    with tempfile.NamedTemporaryFile(suffix=".glb") as tmp:
        subprocess.run([gltfpack, "-i", str(glb_path), "-o", tmp.name, "-kn"], check=True, capture_output=True)
        sc = trimesh.load_scene(tmp.name)
        edges = {child: parent for parent, child, _ in sc.graph.to_edgelist()}
        pts_xz = []
        for node in sc.graph.nodes_geometry:
            cur = node
            skip = False
            while cur and cur != sc.graph.base_frame:
                nm = str(cur).lower()
                if nm.startswith("collision") or nm in ("lod1", "lod2"):
                    skip = True
                    break
                cur = edges.get(cur)
            if skip:
                continue
            mat, gname = sc.graph[node]
            g = sc.geometry[gname]
            v = np.asarray(g.vertices, dtype=np.float64)
            if len(v) == 0:
                continue
            M = T @ mat
            vw = v @ M[:3, :3].T + M[:3, 3]
            faces = np.asarray(g.faces, dtype=np.int64)
            if len(faces) == 0:
                continue
            tri_y_max = vw[faces, 1].max(axis=1)
            keep = faces[tri_y_max > 0.6]
            if len(keep) == 0:
                continue
            # Sample vertices + edge midpoints + centroids in vectorized NumPy
            a = vw[keep[:, 0]][:, [0, 2]]
            b = vw[keep[:, 1]][:, [0, 2]]
            c = vw[keep[:, 2]][:, [0, 2]]
            pts_xz.append(np.vstack([a, b, c, (a + b) * 0.5, (b + c) * 0.5, (c + a) * 0.5, (a + b + c) / 3.0]))
        if not pts_xz:
            return Polygon()
        all_xz = np.vstack(pts_xz)
        gx = np.floor(all_xz[:, 0] / cell).astype(np.int32)
        gz = np.floor(all_xz[:, 1] / cell).astype(np.int32)
        uniq = np.unique(np.stack([gx, gz], axis=1), axis=0)
        # Merge consecutive runs along X for each Z row into horizontal rectangles before union
        rects = []
        order = np.lexsort((uniq[:, 0], uniq[:, 1]))
        uniq = uniq[order]
        i = 0
        n = len(uniq)
        while i < n:
            rz = int(uniq[i, 1])
            rx0 = int(uniq[i, 0])
            rx1 = rx0
            j = i + 1
            while j < n and int(uniq[j, 1]) == rz and int(uniq[j, 0]) == rx1 + 1:
                rx1 = int(uniq[j, 0])
                j += 1
            rects.append(box(rx0 * cell, rz * cell, (rx1 + 1) * cell, (rz + 1) * cell))
            i = j
        return union_all(rects).buffer(0) if rects else Polygon()


def _file_sig_prefix(path: Path) -> str:
    st = path.stat()
    h = hashlib.md5()
    with path.open("rb") as f:
        h.update(f.read(65536))
        if st.st_size > 131072:
            f.seek(st.st_size - 65536)
            h.update(f.read(65536))
    return f"{st.st_size}:{h.hexdigest()[:12]}"


def build_landmark_guard(
    landmarks_path: Path,
    manifest: dict,
    osm_by_key: dict[str, dict],
    overture_csv: Path | None,
    landmarks_glb_dir: Path,
    world_bounds: Polygon,
    cache_path: Path | None = None,
) -> tuple[list[tuple[str, Polygon]], STRtree]:
    """
    Build comprehensive 2D exclusion polygons for ALL hand-crafted landmarks in
    pipeline/landmarks.json + manifest.json + GLB structural footprints + Tianyuan Mifen.
    """
    specs = json.loads(landmarks_path.read_text(encoding="utf-8"))
    mf_lms = {lm["id"]: lm for lm in manifest.get("landmarks", [])}
    wb_x0, wb_z0, wb_x1, wb_z1 = world_bounds.bounds

    # Optional cache for GLB footprints (keyed by filename + size + content hash)
    glb_cache: dict[str, dict] = {}
    if cache_path and cache_path.exists():
        try:
            glb_cache = json.loads(cache_path.read_text(encoding="utf-8"))
        except Exception:
            glb_cache = {}
    cache_dirty = False

    # Collect Overture UUIDs referenced in replace lists
    overture_ids: set[str] = set()
    for entry in specs:
        rep = entry.get("replace", [])
        if isinstance(rep, list):
            for k in rep:
                if isinstance(k, str) and not k.startswith(("way/", "relation/", "node/")):
                    overture_ids.add(k)

    overture_polys: dict[str, Polygon] = {}
    if overture_ids and overture_csv and overture_csv.exists():
        with overture_csv.open(encoding="utf-8") as f:
            for row in csv.DictReader(f, delimiter="\t"):
                rid = row.get("id", "")
                if rid in overture_ids:
                    try:
                        geom = affine_transform(from_wkt(row["wkt"]), [MLON, 0, 0, -MLAT, -LON0 * MLON, LAT0 * MLAT])
                        geom = make_valid(geom)
                        if not geom.is_empty:
                            overture_polys[rid] = geom
                    except Exception:
                        pass

    guard_items: list[tuple[str, Polygon]] = [("tianyuan_mifen", tianyuan_polygon())]
    # Skip natural hill meshes (fubo/diecai/duxiu/elephant_hill) from giant polygon blocking;
    # their explicit replace polygons still protect peak-adjacent structures.
    natural_peak_ids = {"fubo", "diecai", "duxiu", "elephant_hill"}

    def _in_guard_bounds(px: float, pz: float, sr: float = 500.0) -> bool:
        return (wb_x0 - sr <= px <= wb_x1 + sr) and (wb_z0 - sr <= pz <= wb_z1 + sr)

    def _load_glb_fp(lid: str, lm_mf: dict) -> Polygon:
        nonlocal cache_dirty
        glb_path = landmarks_glb_dir / Path(lm_mf["file"]).name
        if not glb_path.exists():
            return Polygon()
        px, _, pz = lm_mf["position"]
        rot = float(lm_mf.get("rotation", 0.0))
        sr = max(400.0, float((lm_mf.get("sphere") or [0, 0, 0, 200.0])[3]) + 200.0)
        if not _in_guard_bounds(px, pz, sr):
            return Polygon()
        sig = f"{_file_sig_prefix(glb_path)}:{px:.2f}:{pz:.2f}:{rot:.3f}"
        cached = glb_cache.get(lid)
        if cached and cached.get("sig") == sig:
            wkt_s = cached.get("wkt", "")
            return from_wkt(wkt_s) if wkt_s else Polygon()
        try:
            fp = _glb_footprint_polygon(glb_path, px, pz, rot)
        except Exception:
            fp = Polygon()
        glb_cache[lid] = {"sig": sig, "wkt": fp.wkt if not fp.is_empty else ""}
        cache_dirty = True
        return fp

    for entry in specs:
        lid = entry["id"]
        polys: list[Polygon] = []

        # 1. replace (dict polygon or list of OSM/Overture keys)
        rep = entry.get("replace", [])
        if isinstance(rep, dict) and rep.get("polygon"):
            p = make_valid(Polygon([ll2xz(lat, lon) for lon, lat in rep["polygon"]]))
            if not p.is_empty:
                polys.append(p)
        elif isinstance(rep, list):
            for key in rep:
                if key in osm_by_key:
                    p = osm_element_area(osm_by_key[key])
                    if not p.is_empty:
                        polys.append(p)
                elif key in overture_polys:
                    polys.append(overture_polys[key])

        # 2. replacePolygons
        for ring in entry.get("replacePolygons", []):
            p = make_valid(Polygon([ll2xz(lat, lon) for lon, lat in ring]))
            if not p.is_empty:
                polys.append(p)

        # 3. schoolGround flatten polygon (protect entire modeled campus)
        if entry.get("schoolGround") and isinstance(entry.get("flatten"), dict) and entry["flatten"].get("polygon"):
            p = make_valid(Polygon([ll2xz(lat, lon) for lon, lat in entry["flatten"]["polygon"]]))
            if not p.is_empty:
                polys.append(p)

        # 4. Exact 2D structural GLB mesh footprint (prevents ANY overhang/collision with hand-crafted GLBs!)
        lm_mf = mf_lms.get(lid)
        if lm_mf and lid not in natural_peak_ids:
            fp = _load_glb_fp(lid, lm_mf)
            if not fp.is_empty:
                polys.append(fp)

        # 5. Fallback sphere protection for small standalone landmarks if no polygons captured
        if not polys and lm_mf and lid not in natural_peak_ids:
            px, _, pz = lm_mf["position"]
            scx, _, scz, sr = lm_mf.get("sphere", [0, 0, 0, 12.0])
            if sr <= 60.0 and _in_guard_bounds(px + scx, pz + scz, sr + 50.0):
                polys.append(Point(px + scx, pz + scz).buffer(sr))

        if polys:
            merged = unary_union(polys)
            if not is_valid(merged):
                merged = merged.buffer(0)
            merged = merged.simplify(0.35, preserve_topology=True)
            if not merged.is_empty and merged.intersects(world_bounds):
                prepare(merged)
                guard_items.append((lid, merged))

    # Also protect any manifest landmarks not listed in pipeline/landmarks.json
    spec_ids = {entry["id"] for entry in specs}
    for lid, lm_mf in mf_lms.items():
        if lid in spec_ids or lid in natural_peak_ids:
            continue
        polys = []
        fp = _load_glb_fp(lid, lm_mf)
        if not fp.is_empty:
            polys.append(fp)
        if not polys:
            px, _, pz = lm_mf["position"]
            scx, _, scz, sr = lm_mf.get("sphere", [0, 0, 0, 12.0])
            if sr <= 60.0 and _in_guard_bounds(px + scx, pz + scz, sr + 50.0):
                polys.append(Point(px + scx, pz + scz).buffer(sr))
        if polys:
            merged = unary_union(polys)
            if not is_valid(merged):
                merged = merged.buffer(0)
            merged = merged.simplify(0.35, preserve_topology=True)
            if not merged.is_empty and merged.intersects(world_bounds):
                prepare(merged)
                guard_items.append((lid, merged))

    if cache_path and cache_dirty:
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile("w", dir=cache_path.parent, suffix=".tmp", delete=False, encoding="utf-8") as tf:
            tf.write(json.dumps(glb_cache))
            tmp_name = tf.name
        os.replace(tmp_name, cache_path)

    # Prepare Tianyuan polygon too
    for _, g in guard_items:
        prepare(g)
    guard_tree = STRtree([g for _, g in guard_items])
    return guard_items, guard_tree


def load_cmab_all(cmab_base: Path, x0: float, x1: float, z0: float, z1: float):
    dbf_path = cmab_base.with_suffix(".dbf")
    shp_path = cmab_base.with_suffix(".shp")
    with dbf_path.open("rb") as fd:
        _, _, _, _, _num_recs, hdr_len, rec_len = struct.unpack("<BBBBIHH", fd.read(12))
        fd.seek(32)
        fields = []
        while fd.tell() < hdr_len - 1:
            b = fd.read(32)
            if not b or b[0] == 0x0D:
                break
            name = b[:11].split(b"\x00", 1)[0].decode("utf-8", errors="ignore")
            fields.append((name, chr(b[11]), b[16], b[17]))
        fd.seek(hdr_len)
        dbf_data = fd.read()

    def parse_rec(idx: int) -> dict:
        pos = idx * rec_len + 1
        out = {}
        for name, ftype, flen, fdec in fields:
            raw = dbf_data[pos : pos + flen].decode("utf-8", errors="ignore").strip()
            pos += flen
            if ftype in ("N", "F"):
                try:
                    out[name] = float(raw) if ("." in raw or fdec > 0) else int(raw)
                except ValueError:
                    out[name] = None
            else:
                out[name] = raw
        return out

    wmx0, wmy1 = xz2wm(x0 - 80, z0 - 80)
    wmx1, wmy0 = xz2wm(x1 + 80, z1 + 80)
    items = []
    with shp_path.open("rb") as fs:
        fs.seek(100)
        idx = 0
        while True:
            rh = fs.read(8)
            if len(rh) < 8:
                break
            _, content_words = struct.unpack(">II", rh)
            content = fs.read(content_words * 2)
            stype = struct.unpack("<I", content[:4])[0]
            if stype in (5, 15, 25):
                bx0, by0, bx1, by1 = struct.unpack("<4d", content[4:36])
                if bx1 >= wmx0 and bx0 <= wmx1 and by1 >= wmy0 and by0 <= wmy1:
                    nparts, npts = struct.unpack("<II", content[36:44])
                    parts = struct.unpack(f"<{nparts}I", content[44 : 44 + 4 * nparts])
                    pts_off = 44 + 4 * nparts
                    end0 = parts[1] if nparts > 1 else npts
                    ring = []
                    for pi in range(parts[0], end0):
                        px, py = struct.unpack("<dd", content[pts_off + pi * 16 : pts_off + (pi + 1) * 16])
                        lat, lon = wm2ll(px, py)
                        ring.append(ll2xz(lat, lon))
                    if len(ring) >= 4:
                        poly = Polygon(ring)
                        if not is_valid(poly):
                            poly = poly.buffer(0)
                        if not poly.is_empty:
                            items.append((poly, parse_rec(idx)))
            idx += 1
    return items


def load_osm_full(osm_path: Path, x0: float, x1: float, z0: float, z1: float):
    osm = json.load(osm_path.open(encoding="utf-8"))
    osm_by_key: dict[str, dict] = {}
    main_roads: list[tuple[str, str, LineString]] = []
    alley_roads: list[tuple[str, str, LineString]] = []
    all_road_geoms: list[tuple[str, LineString]] = []
    roads_by_name: dict[str, list[tuple[str, LineString]]] = defaultdict(list)
    compounds: list[tuple[str, str, Polygon]] = []
    quiet_zones: list[Polygon] = []
    aeroway_zones: list[Polygon] = []
    residential_zones: list[Polygon] = []
    commercial_zones: list[Polygon] = []
    water_polys: list[Polygon] = []
    bridge_lines: list[LineString] = []
    weixiaotang_poly = None
    query_box = box(x0 - 160.0, z0 - 160.0, x1 + 160.0, z1 + 160.0)

    MAIN_HW = {"trunk", "primary", "secondary", "tertiary", "trunk_link", "primary_link", "secondary_link", "tertiary_link"}
    ALLEY_HW = {"residential", "unclassified", "pedestrian", "living_street"}

    for el in osm["elements"]:
        osm_by_key[f"{el['type']}/{el['id']}"] = el
        tags = el.get("tags") or {}
        geom = el.get("geometry") or []
        if len(geom) >= 2:
            pts = [ll2xz(p["lat"], p["lon"]) for p in geom]
            xs = [p[0] for p in pts]
            zs = [p[1] for p in pts]
            if max(xs) < x0 - 160 or min(xs) > x1 + 160 or max(zs) < z0 - 160 or min(zs) > z1 + 160:
                continue

            if el.get("id") == 253743030 and len(pts) >= 4:
                weixiaotang_poly = make_valid(Polygon(pts))

            hw = tags.get("highway")
            if hw:
                ls = LineString(pts)
                all_road_geoms.append((hw, ls))
                is_bridge = tags.get("bridge", "no") not in ("no", "false")
                is_tunnel = tags.get("tunnel", "no") not in ("no", "false")
                if is_bridge:
                    bridge_lines.append(ls)
                nm = tags.get("name", "").strip()
                if not is_tunnel:
                    if hw in MAIN_HW and not is_bridge:
                        main_roads.append((nm, hw, ls))
                    elif hw in ALLEY_HW and not is_bridge:
                        alley_roads.append((nm, hw, ls))
                    if nm and hw in (MAIN_HW | ALLEY_HW):
                        roads_by_name[nm].append((hw, ls))

            aero = tags.get("aeroway")
            if aero or tags.get("landuse") == "aerodrome":
                if len(pts) >= 4 and pts[0] == pts[-1]:
                    apoly = make_valid(Polygon(pts))
                else:
                    buf_r = 35.0 if aero == "runway" else 20.0
                    apoly = make_valid(LineString(pts).buffer(buf_r, cap_style="flat"))
                if not apoly.is_empty:
                    aeroway_zones.append(apoly)
                    quiet_zones.append(apoly)

            am = tags.get("amenity")
            if am in ("school", "hospital", "university", "college", "kindergarten") and len(pts) >= 4:
                poly = make_valid(Polygon(pts))
                if not poly.is_empty and poly.area > 250:
                    quiet_zones.append(poly)
                    if am in ("school", "hospital"):
                        compounds.append((tags.get("name", am), am, poly))

            if (
                tags.get("railway") in ("station", "platform")
                or tags.get("building") == "train_station"
                or tags.get("public_transport") == "station"
            ) and len(pts) >= 4 and pts[0] == pts[-1]:
                rpoly = make_valid(Polygon(pts))
                if not rpoly.is_empty and rpoly.area > 120:
                    quiet_zones.append(rpoly)

            lu = tags.get("landuse")
            if lu == "residential" and len(pts) >= 4:
                poly = make_valid(Polygon(pts))
                if not poly.is_empty and poly.area > 600:
                    residential_zones.append(poly)
            elif lu in ("commercial", "retail") and len(pts) >= 4:
                poly = make_valid(Polygon(pts))
                if not poly.is_empty and poly.area > 400:
                    commercial_zones.append(poly)

            if (tags.get("natural") == "water" or tags.get("waterway") == "riverbank" or "water" in tags) and len(pts) >= 4:
                poly = make_valid(Polygon(pts))
                if not poly.is_empty and poly.area > 1500:
                    water_polys.append(poly)
        elif el.get("type") == "relation":
            if tags.get("aeroway") or tags.get("landuse") == "aerodrome":
                poly = osm_element_area(el)
                if not poly.is_empty and poly.intersects(query_box):
                    aeroway_zones.append(poly)
                    quiet_zones.append(poly)
            elif tags.get("natural") == "water" or tags.get("waterway") == "riverbank" or "water" in tags:
                poly = osm_element_area(el)
                if not poly.is_empty and poly.area > 1500 and poly.intersects(query_box):
                    water_polys.append(poly)
            elif tags.get("amenity") in ("school", "hospital", "university", "college", "kindergarten"):
                poly = osm_element_area(el)
                if not poly.is_empty and poly.area > 400 and poly.intersects(query_box):
                    quiet_zones.append(poly)
                    if tags.get("amenity") in ("school", "hospital"):
                        compounds.append((tags.get("name", tags["amenity"]), tags["amenity"], poly))
            elif (
                tags.get("railway") in ("station", "platform")
                or tags.get("building") == "train_station"
                or tags.get("public_transport") == "station"
            ):
                poly = osm_element_area(el)
                if not poly.is_empty and poly.area > 120 and poly.intersects(query_box):
                    quiet_zones.append(poly)

    return {
        "osm_by_key": osm_by_key,
        "main_roads": main_roads,
        "alley_roads": alley_roads,
        "all_road_geoms": all_road_geoms,
        "roads_by_name": roads_by_name,
        "compounds": compounds,
        "quiet_zones": quiet_zones,
        "aeroway_zones": aeroway_zones,
        "residential_zones": residential_zones,
        "commercial_zones": commercial_zones,
        "water_polys": water_polys,
        "bridge_lines": bridge_lines,
        "weixiaotang_poly": weixiaotang_poly,
    }


def make_terrain_sampler(terrain_grids: dict[tuple[int, int], object]):
    def sample_y(x: float, z: float) -> float:
        tx = int(math.floor(x / 256.0)) * 256
        tz = int(math.floor(z / 256.0)) * 256
        entry = terrain_grids.get((tx, tz))
        if entry is None:
            return 154.0
        grid = entry[1] if isinstance(entry, tuple) else entry
        u = max(0.0, min(64.0, (x - tx) / 4.0))
        v = max(0.0, min(64.0, (z - tz) / 4.0))
        c0 = min(63, int(math.floor(u)))
        r0 = min(63, int(math.floor(v)))
        fu = u - c0
        fv = v - r0
        h00 = int(grid[r0 * 65 + c0]) / 10.0
        h10 = int(grid[r0 * 65 + c0 + 1]) / 10.0
        h01 = int(grid[(r0 + 1) * 65 + c0]) / 10.0
        h11 = int(grid[(r0 + 1) * 65 + c0 + 1]) / 10.0
        valid = [h for h in (h00, h10, h01, h11) if h > 100.0]
        if len(valid) < 4:
            return sum(valid) / len(valid) if valid else 154.0
        return (h00 * (1 - fu) + h10 * fu) * (1 - fv) + (h01 * (1 - fu) + h11 * fu) * fv

    return sample_y


def determine_district(
    cx: float,
    cz: float,
    nearest_main_name: str,
    is_scenic: bool,
    in_commercial: bool,
    in_residential: bool,
    in_quiet: bool,
    in_aeroway: bool = False,
    near_peak: bool = False,
    cmab_h: float = 0.0,
) -> str:
    """Classify world point into Guilin architectural character district."""
    if in_quiet or in_aeroway:
        return "public_quiet"
    # Liangjiang International Airport perimeter & surrounding rural villages (cx < -16000)
    if cx < -16000.0:
        return "airport_village"
    # Lingui New District (-16000 <= cx <= -6500)
    if cx <= -6500.0:
        if near_peak:
            return "riverside_scenic"
        if is_scenic and not in_commercial and nearest_main_name not in LINGUI_MAIN_ROADS and cmab_h < 18.0:
            return "riverside_scenic"
        return "lingui_new_district"
    if is_scenic:
        return "riverside_scenic"
    # Core historic & station/qixing/west-ring districts
    is_station_zone = (-2560 <= cx <= -1620 and 1050 <= cz <= 2450)
    is_qixing_commercial = (cx >= -180 and -500 <= cz <= 2250)
    if is_station_zone or is_qixing_commercial or in_commercial or nearest_main_name in MODERN_ARTERIAL_ROADS:
        return "station_arterial"
    # Old downtown + west-ring transition (Tiexi / Jiashan / Xishan older arterials)
    if (-1950 <= cx <= -180 and -1250 <= cz <= 1250) or nearest_main_name in OLD_DOWNTOWN_ROADS:
        return "old_downtown"
    if -6500.0 < cx <= -2560.0 and -1200.0 <= cz <= 1800.0 and nearest_main_name in {"铁西路", "铁西中路", "西山路", "甲山路"}:
        return "old_downtown"
    if in_residential:
        return "neighborhood_alley"
    return "neighborhood_alley"


def classify_building(
    cx: float,
    cz: float,
    area: float,
    orig_kind: int,
    cmab: dict | None,
    district: str,
    dist_main: float,
    dist_alley: float,
    dist_wxt: float,
    in_residential: bool,
    seed: int,
    in_commercial: bool = False,
) -> tuple[int, int, int, int]:
    """
    Map CMAB attributes + district profile -> (upperStyle 0..7, shopStyle -1|0..3, roofType 0..3, tintHex).
    """
    fn = (cmab or {}).get("Function") or "Other"
    age_s = str((cmab or {}).get("Age") or "1996")
    age = 2019 if "AF2018" in age_s else (int(age_s) if age_s.isdigit() else 1996)
    h = float((cmab or {}).get("Height") or 0.0)

    is_main_front = dist_main < 24.0
    is_alley_front = dist_alley < 15.0
    is_wxt_back = dist_wxt < 105.0
    is_public = orig_kind == 3 or fn == "Public service" or district == "public_quiet"

    # --- Upper facade layer (0..7) & roofType (0..3) ---
    if is_public:
        upper = 6  # Institutional / hospital / school / civic / airport terminal
        roof_type = 2 if (seed % 4 == 0 and h < 19.0) else 0
    elif district == "airport_village":
        # Restrained Guilin white-wall/grey-tile or modern rural housing around Liangjiang Airport
        if orig_kind == 1 or area < 240 or (seed % 10 < 5):
            upper = 5  # 桂北白墙青砖
            roof_type = 1 if h <= 14.0 else 0
        elif seed % 10 < 8:
            upper = 7  # 现代真石漆农居
            roof_type = 3 if h >= 12.0 else 0
        else:
            upper = 3 if (seed % 2 == 0) else 0
            roof_type = 0
    elif district == "lingui_new_district":
        # Lingui New District: modern warm stucco (7), stone/glass curtain (4), commercial podium (3)
        if fn in ("Business", "Office") or (is_main_front and area > 650):
            upper = 4 if (seed % 10 < 6) else 3
            roof_type = 3
        elif age >= 2000 or h >= 15.0 or in_residential or is_main_front:
            r = seed % 10
            if r < 6:
                upper = 7  # 现代真石漆
            elif r < 8:
                upper = 4  # 干挂石材玻璃幕墙
            else:
                upper = 3  # 翻新商业裙房
            roof_type = 3
        else:
            r = seed % 10
            if r < 4:
                upper = 7
                roof_type = 3 if h >= 12.0 else 0
            elif r < 7:
                upper = 3
                roof_type = 0
            elif r < 9:
                upper = 5
                roof_type = 1 if h <= 12.0 else 0
            else:
                upper = 0
                roof_type = 0
    elif district == "riverside_scenic":
        # Elevate Guilin white-wall/grey-brick + pitched grey-tile roofs so karst peaks stay hero!
        r = seed % 10
        if fn in ("Business", "Office") and area > 750 and age >= 2005:
            upper = 3 if (seed % 2 == 0) else 5
            roof_type = 1 if h <= 16.0 else 3
        elif r < 5 or orig_kind == 1 or h <= 12.0:
            upper = 5  # 桂北白墙青砖
            roof_type = 1  # 灰瓦坡顶
        elif r < 7:
            upper = 3  # 翻新米白
            roof_type = 1 if h <= 14.5 else 0
        elif r < 9:
            upper = 0  # 灰白条砖
            roof_type = 0
        else:
            upper = 2  # 水刷石老楼
            roof_type = 1 if h <= 12.5 else 0
    elif district == "station_arterial":
        # Station / arterial / Qixing / West Ring commercial: modern stone/glass + warm stucco + commercial podiums
        if fn in ("Business", "Office") or (is_main_front and area > 650):
            upper = 4 if (seed % 2 == 0) else 3  # 干挂石材幕墙 / 商业裙房
            roof_type = 3
        elif age >= 2004 or h >= 18.0:
            r = seed % 10
            if r < 5:
                upper = 7  # 现代暖米真石漆住宅
            elif r < 8:
                upper = 4  # 干挂石材玻璃幕墙
            else:
                upper = 3  # 米白商业裙房
            roof_type = 3
        else:
            r = seed % 10
            if r < 4:
                upper = 0
            elif r < 6:
                upper = 7
            elif r < 8:
                upper = 3
            else:
                upper = 1
            roof_type = 0 if h < 18.0 else 3
    elif district == "old_downtown":
        # Classic Sanduo / Zhongshan / Xicheng / Nanmen Bridge commercial-residential mix
        if fn in ("Business", "Office") or (is_wxt_back and area > 750):
            upper = 3 if (age >= 2005 or seed % 2 == 0) else 4
            roof_type = 3
        elif is_wxt_back and is_alley_front and age <= 1994:
            upper = 2 if (seed % 3 != 0) else 0
            roof_type = 0
        elif age >= 2008:
            upper = 7 if (seed % 2 == 0) else 4
            roof_type = 3
        elif orig_kind == 1 or (h <= 10.5 and area < 220 and seed % 3 == 0):
            upper = 5
            roof_type = 1
        else:
            r = seed % 10
            if r < 5:
                upper = 0  # 灰白条形小瓷砖 + 防盗笼 + 蓝灰阳台
            elif r < 7:
                upper = 1  # 格子马赛克 + 深酒红腰线
            elif r < 9:
                upper = 2  # 水刷石老步梯楼
            else:
                upper = 3  # 翻新米白
            roof_type = 0
    else:
        # Outer neighborhood residential (Jiashan / Beiji / Tiexi / Anxin / Dongjiang)
        if fn in ("Business", "Office"):
            upper = 3 if (seed % 2 == 0) else 4
            roof_type = 3
        elif age >= 2006 or h >= 19.0:
            upper = 7 if (seed % 3 != 0) else 4
            roof_type = 3
        elif orig_kind == 1 or (h <= 10.0 and area < 200 and seed % 4 == 0):
            upper = 5
            roof_type = 1
        else:
            r = seed % 10
            if r < 4:
                upper = 0
            elif r < 6:
                upper = 7
            elif r < 8:
                upper = 1
            else:
                upper = 2
            roof_type = 0

    # --- Ground-floor shopfront layer (0..3 -> layers 8..11; -1 means no shopfront) ---
    # Deep inside residential compounds (far from main roads), keep clean residential ground floors
    allow_alley_shop = is_alley_front and (not in_residential or dist_main < 38.0 or district == "old_downtown")
    if is_public:
        shop = -1
    elif district == "airport_village":
        shop = 0 if (in_commercial and is_main_front) else -1
    elif district == "lingui_new_district":
        if is_main_front or (in_commercial and is_alley_front):
            shop = 0 if (seed % 3 != 0) else (2 if (seed % 2 == 0) else 1)
        else:
            shop = -1
    elif is_main_front or allow_alley_shop:
        if district == "riverside_scenic":
            shop = 2 if (seed % 3 != 0) else 0
        elif district == "station_arterial":
            shop = 0 if (seed % 3 != 0) else (2 if (seed % 2 == 0) else 1)
        elif is_wxt_back and (seed % 3 == 0):
            shop = 2
        elif district == "old_downtown" and cx < -1300 and cz < 180 and (seed % 2 == 0):
            shop = 1  # 钢灰蓝+镀锌银灰卷帘门
        elif allow_alley_shop and not is_main_front:
            shop = 3 if (seed % 3 != 0) else 1
        else:
            shop = 0 if (seed % 4 != 0) else 1
    else:
        shop = -1

    # Grounded authentic Guilin wall tint (multiplied ONLY onto masonry mask)
    palettes = {
        0: [0xEEF1F4, 0xE7ECF0, 0xE2E6EA, 0xECEEEB],
        1: [0xE8EAEB, 0xE0E3E6, 0xECE8E2],
        2: [0xCFC9BE, 0xC4BEB3, 0xD6D1C7, 0xBEB7AB],
        3: [0xF2EFE6, 0xECE8DD, 0xE8E5DC],
        4: [0xE6E4DE, 0xDCE0E5, 0xEAE6DC],
        5: [0xEDEAE0, 0xE6E2D6, 0xF0ECE2],
        6: [0xEBE8DF, 0xE2DFD6, 0xE6E8E4],
        7: [0xECDCC8, 0xE5D3BC, 0xEAE0D2],
    }
    p = palettes[upper]
    tint = p[(seed >> 4) % len(p)]
    return upper, shop, roof_type, tint


class SpatialHueTracker:
    """Guarantees ZERO adjacent same-hue fascias both along a wall and across neighboring buildings."""

    def __init__(self, cell_size: float = 8.0):
        self.cell = cell_size
        self.grid: dict[tuple[int, int], list[tuple[float, float, float, str]]] = defaultdict(list)

    def _bucket(self, x: float, z: float) -> tuple[int, int]:
        return int(math.floor(x / self.cell)), int(math.floor(z / self.cell))

    def nearby_hues(self, x: float, z: float, yaw: float, radius: float = 6.5) -> set[str]:
        bx, bz = self._bucket(x, z)
        r2 = radius * radius
        nx, nz = math.sin(yaw), math.cos(yaw)
        hues: set[str] = set()
        for dx in (-1, 0, 1):
            for dz in (-1, 0, 1):
                for ox, oz, oyaw, ohue in self.grid.get((bx + dx, bz + dz), ()):
                    ddx, ddz = x - ox, z - oz
                    if ddx * ddx + ddz * ddz <= r2:
                        # Same street side / visible adjacent corner (facing dot > 0.55)
                        if nx * math.sin(oyaw) + nz * math.cos(oyaw) > 0.55:
                            hues.add(ohue)
        return hues

    def add(self, x: float, z: float, yaw: float, hue: str):
        self.grid[self._bucket(x, z)].append((x, z, yaw, hue))


def gzip_size(obj: dict) -> int:
    raw = json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return len(gzip.compress(raw, compresslevel=6))


def trim_shard_to_budget(shard: dict, max_gzip: int = MAX_SHARD_GZIP_BYTES) -> int:
    """Keep shard strictly under gzip budget without dropping building overrides or main fascias."""
    gz = gzip_size(shard)
    if gz <= max_gzip:
        return gz
    # Step 1: thin dense AC units first (keep every 2nd, then 3rd)
    if shard["acUnits"]:
        shard["acUnits"] = shard["acUnits"][::2]
        gz = gzip_size(shard)
    if gz > max_gzip and shard["acUnits"]:
        shard["acUnits"] = shard["acUnits"][::2]
        gz = gzip_size(shard)
    # Step 2: thin secondary blades if still tight
    if gz > max_gzip and shard["blades"]:
        shard["blades"] = shard["blades"][::2]
        gz = gzip_size(shard)
    # Step 3: thin alley awnings (kind==1) while keeping Guilin grey-tile eaves
    if gz > max_gzip and shard["eaves"]:
        shard["eaves"] = [e for idx, e in enumerate(shard["eaves"]) if e[7] == 0 or idx % 2 == 0]
        gz = gzip_size(shard)
    return gz


def main():
    t0 = time.time()
    ap = argparse.ArgumentParser(description="Build full-city Guilin v1+ 512m spatial upgrade shards.")
    ap.add_argument("--ring", choices=("r1", "r2", "r3", "r4", "all"), default="all", help="Target ring(s) to generate")
    ap.add_argument("--sector", choices=("west", "north", "east", "ne", "south", "es", "edge", "all"), default="all", help="Target spatial sector")
    ap.add_argument("--world-dir", type=Path, default=None)
    ap.add_argument("--cmab", type=Path, default=None)
    ap.add_argument("--osm", type=Path, default=None)
    ap.add_argument("--landmarks", type=Path, default=None)
    ap.add_argument("--overture", type=Path, default=None)
    ap.add_argument("--landmarks-glb-dir", type=Path, default=None)
    ap.add_argument("--out-dir", type=Path, default=REPO_ROOT / "public/city-upgrade")
    ap.add_argument("--fascia-grid", choices=("8x8", "8x12"), default="8x12")
    ap.add_argument("--merge-existing", action="store_true", help="Preserve existing shards outside selected --ring/--sector")
    ap.add_argument("--no-index", action="store_true", help="Write shard JSONs only; do not touch index.json")
    ap.add_argument("--allow-dev-world", action="store_true", help="Allow running against 325-chunk dev_bbox world")
    args = ap.parse_args()

    world_dir = resolve_path(args.world_dir, "public/world")
    cmab_base = resolve_path(args.cmab, "raw/cmab_guilin/processed_2209_20220307_all.shp").with_suffix("")
    osm_path = resolve_path(args.osm, "raw/osm-2026-11.json")
    landmarks_path = resolve_path(args.landmarks, "pipeline/landmarks.json")
    overture_csv = resolve_path(args.overture, "raw/overture_buildings.csv")
    landmarks_glb_dir = resolve_path(args.landmarks_glb_dir, "public/landmarks")
    cols, rows = map(int, args.fascia_grid.split("x"))
    max_fascia_idx = cols * rows

    print(f"[city-upgrade] Sector={args.sector} | Ring={args.ring} | Grid={cols}x{rows} ({max_fascia_idx} shops) | no_index={args.no_index}")
    print(f"  world_dir : {world_dir}")
    print(f"  cmab_base : {cmab_base}")
    print(f"  osm_path  : {osm_path}")

    mf = json.load((world_dir / "manifest.json").open(encoding="utf-8"))
    if mf.get("dev_bbox") is not None and not args.allow_dev_world:
        print(
            f"[city-upgrade] ERROR: {world_dir / 'manifest.json'} contains dev_bbox={mf.get('dev_bbox')} "
            f"(325-chunk dev subset, not full 4,080 world).\n"
            f"  Pass --world-dir /Users/pan-work/guilinol/public/world or --allow-dev-world to override.",
            file=sys.stderr,
        )
        raise SystemExit(2)

    all_chunks = mf["chunks"]
    xs = [c["x"] for c in all_chunks]
    zs = [c["z"] for c in all_chunks]
    wx0, wx1 = float(min(xs)), float(max(xs) + 256)
    wz0, wz1 = float(min(zs)), float(max(zs) + 256)
    world_bounds = box(wx0, wz0, wx1, wz1)

    target_rings = {"r1", "r2", "r3", "r4"} if args.ring == "all" else {args.ring}
    selected_chunks = []
    shard_ring_map: dict[tuple[int, int], str] = {}
    ring_chunk_counts = Counter()

    for c in all_chunks:
        r = chunk_ring(c["x"], c["z"])
        ring_chunk_counts[r] += 1
        sg = shard_of(c["x"], c["z"])
        if sg not in shard_ring_map:
            shard_ring_map[sg] = shard_ring(*sg)
        if r in target_rings and shard_in_sector(sg[0], sg[1], args.sector):
            selected_chunks.append((c, r))

    if not selected_chunks:
        print("[city-upgrade] No chunks matched selection.")
        return

    # Bounding box of selected sector (with padding for spatial queries)
    sxs = [c["x"] for c, _ in selected_chunks]
    szs = [c["z"] for c, _ in selected_chunks]
    sel_x0, sel_x1 = float(min(sxs)), float(max(sxs) + 256)
    sel_z0, sel_z1 = float(min(szs)), float(max(szs) + 256)
    selected_chunk_boxes = [box(c["x"], c["z"], c["x"] + 256.0, c["z"] + 256.0) for c, _ in selected_chunks]
    active_chunks_poly = union_all(selected_chunk_boxes).buffer(-4.0)
    prepare(active_chunks_poly)

    print(f"  Total chunks: {len(all_chunks)} ({dict(ring_chunk_counts)}) | Selected: {len(selected_chunks)} chunks")

    # 1. Load CMAB & build STRtree (scoped to selected sector bounds + padding)
    t1 = time.time()
    cmab_items = load_cmab_all(cmab_base, sel_x0 - 200.0, sel_x1 + 200.0, sel_z0 - 200.0, sel_z1 + 200.0)
    cmab_tree = STRtree([p for p, _ in cmab_items])
    print(f"  CMAB polygons in sector: {len(cmab_items)} ({time.time() - t1:.2f}s)")

    # 2. Load OSM full road network, landuse, water, compounds, aeroway
    t1 = time.time()
    osm_data = load_osm_full(osm_path, sel_x0 - 300.0, sel_x1 + 300.0, sel_z0 - 300.0, sel_z1 + 300.0)
    main_roads = osm_data["main_roads"]
    alley_roads = osm_data["alley_roads"]
    main_lines = [ls for _, _, ls in main_roads]
    alley_lines = [ls for _, _, ls in alley_roads]
    drive_roads = main_roads + alley_roads
    drive_lines = [ls for _, _, ls in drive_roads]
    main_tree = STRtree(main_lines) if main_lines else None
    alley_tree = STRtree(alley_lines) if alley_lines else None
    drive_tree = STRtree(drive_lines) if drive_lines else None
    quiet_tree = STRtree(osm_data["quiet_zones"]) if osm_data["quiet_zones"] else None
    aero_tree = STRtree(osm_data["aeroway_zones"]) if osm_data["aeroway_zones"] else None
    res_tree = STRtree(osm_data["residential_zones"]) if osm_data["residential_zones"] else None
    com_tree = STRtree(osm_data["commercial_zones"]) if osm_data["commercial_zones"] else None
    water_tree = STRtree(osm_data["water_polys"]) if osm_data["water_polys"] else None
    bridge_tree = STRtree(osm_data["bridge_lines"]) if osm_data["bridge_lines"] else None

    # Named karst peaks from manifest for scenic corridor weighting
    named_peaks: list[Point] = []
    for pk in mf.get("peaks", {}).get("entries", []):
        pnm = pk.get("name", "")
        if pnm and not pnm.startswith("auto-"):
            c = pk["center"]
            named_peaks.append(Point(c[0], c[2]))
    peak_tree = STRtree(named_peaks) if named_peaks else None

    print(
        f"  OSM loaded: {len(main_roads)} main segs, {len(alley_roads)} alley segs, "
        f"{len(osm_data['water_polys'])} waters, {len(osm_data['quiet_zones'])} quiet zones, "
        f"{len(osm_data['aeroway_zones'])} aeroway zones ({time.time() - t1:.2f}s)"
    )

    # 3. Build comprehensive landmark protection guard (zero intrusion)
    t1 = time.time()
    cache_path = Path("/tmp/city-upgrade-landmark-footprints-v1.json")
    guard_bounds = box(sel_x0 - 500.0, sel_z0 - 500.0, sel_x1 + 500.0, sel_z1 + 500.0) if args.sector != "all" else world_bounds
    guard_items, guard_tree = build_landmark_guard(
        landmarks_path, mf, osm_data["osm_by_key"], overture_csv, landmarks_glb_dir, guard_bounds, cache_path=cache_path
    )
    print(f"  Landmark guard loaded: {len(guard_items)} protected zones ({time.time() - t1:.2f}s)")

    # 4. Lightweight GL04 loading: only selected chunks + 1-ring neighbor terrain_grids (int16 numpy arrays)
    t1 = time.time()
    selected_coords = {(c["x"], c["z"]): r for c, r in selected_chunks}
    terrain_needed: set[tuple[int, int]] = set()
    for tx, tz in selected_coords:
        for dx in (-256, 0, 256):
            for dz in (-256, 0, 256):
                terrain_needed.add((tx + dx, tz + dz))

    terrain_grids: dict[tuple[int, int], np.ndarray] = {}
    selected_tile_metas: list[tuple[int, int, str, list]] = []
    valid_shards: set[tuple[int, int]] = set()
    for c in all_chunks:
        tx, tz = c["x"], c["z"]
        if (tx, tz) not in terrain_needed:
            continue
        raw = gzip.decompress((world_dir / c["file"]).read_bytes())
        terrain_grids[(tx, tz)] = np.frombuffer(raw, dtype="<i2", count=4225, offset=24).copy()
        if (tx, tz) in selected_coords:
            verts, cnt, coll_len, _, _ = struct.unpack("<5I", raw[4:24])
            off = 24 + 8450 + 8450 + verts * 6 + verts * 3 + cnt * 4
            meta = json.loads(raw[off : off + coll_len].decode("utf-8"))
            bldgs = meta[0]
            if bldgs:
                selected_tile_metas.append((tx, tz, selected_coords[(tx, tz)], bldgs))
                valid_shards.add(shard_of(tx, tz))
    sample_y = make_terrain_sampler(terrain_grids)
    print(f"  Parsed {len(terrain_grids)} GL04 terrains / {len(selected_tile_metas)} selected tiles ({len(valid_shards)} non-empty shards) ({time.time() - t1:.2f}s)")

    # Precompute prepared geometries & expanded guard layers for C-speed O(log V) queries
    for poly_list in (osm_data["quiet_zones"], osm_data["aeroway_zones"], osm_data["residential_zones"], osm_data["commercial_zones"], osm_data["water_polys"]):
        for g in poly_list:
            prepare(g)

    guard_geoms_0 = [g for _, g in guard_items]
    guard_geoms_1 = [g.buffer(1.0, quad_segs=4).simplify(0.35, preserve_topology=True) for g in guard_geoms_0]
    guard_geoms_2 = [g.buffer(2.2, quad_segs=4).simplify(0.35, preserve_topology=True) for g in guard_geoms_0]
    for g in guard_geoms_1:
        prepare(g)
    for g in guard_geoms_2:
        prepare(g)
    guard_tree_1 = STRtree(guard_geoms_1)
    guard_tree_2 = STRtree(guard_geoms_2)

    water_geoms_2 = [g.buffer(2.0, quad_segs=4).simplify(0.5, preserve_topology=True) for g in osm_data["water_polys"]]
    for g in water_geoms_2:
        prepare(g)
    water_tree_2 = STRtree(water_geoms_2) if water_geoms_2 else None

    aero_geoms_60 = [g.buffer(60.0, quad_segs=3).simplify(1.0, preserve_topology=True) for g in osm_data["aeroway_zones"]]
    for g in aero_geoms_60:
        prepare(g)
    aero_tree_60 = STRtree(aero_geoms_60) if aero_geoms_60 else None

    # Helper predicates using prepared geometries + C-accelerated STRtree
    def hits_landmark(geom, margin: float = 0.0) -> bool:
        if margin <= 0.0:
            tree = guard_tree
        elif margin <= 1.2:
            tree = guard_tree_1
        else:
            tree = guard_tree_2
        for _ in tree.query(geom, predicate="intersects"):
            return True
        return False

    def hits_water(geom, margin: float = 0.0) -> bool:
        if not water_tree:
            return False
        tree = water_tree_2 if (margin > 0.0 and water_tree_2 is not None) else water_tree
        for _ in tree.query(geom, predicate="intersects"):
            return True
        return False

    def hits_aeroway(geom, margin: float = 0.0) -> bool:
        if not aero_tree:
            return False
        tree = aero_tree_60 if (margin > 0.0 and aero_tree_60 is not None) else aero_tree
        for _ in tree.query(geom, predicate="intersects"):
            return True
        return False

    def nearest_road(geom, tree: STRtree | None, roads_list: list[tuple[str, str, LineString]], max_d: float) -> tuple[float, str, LineString | None]:
        if not tree:
            return 999.0, "", None
        idxs, dists = tree.query_nearest(geom, max_distance=max_d, return_distance=True, all_matches=False)
        if len(idxs) == 0:
            return 999.0, "", None
        hi = int(idxs[0])
        nm, _, ls = roads_list[hi]
        return float(dists[0]), nm, ls

    def in_any_poly(pt: Point, tree: STRtree | None, polys: list[Polygon]) -> bool:
        if not tree:
            return False
        for _ in tree.query(pt, predicate="intersects"):
            return True
        return False

    def near_named_peak(pt: Point) -> bool:
        if not peak_tree:
            return False
        idxs = peak_tree.query_nearest(pt, max_distance=200.0, all_matches=False)
        return len(idxs) > 0

    def is_scenic_location(pt: Point) -> bool:
        if water_tree:
            idxs = water_tree.query_nearest(pt, max_distance=130.0, all_matches=False)
            if len(idxs) > 0:
                return True
        return near_named_peak(pt)

    # Prepare shard containers (only shards that actually have buildings!)
    shards_data: dict[tuple[int, int], dict] = {
        sg: {"overrides": {}, "eaves": [], "acUnits": [], "fascias": [], "blades": [], "streetSigns": [], "walls": []}
        for sg in valid_shards
    }

    # Filter zone pools to active atlas capacity
    active_pools = {k: [i for i in v if i < max_fascia_idx] for k, v in ZONE_POOLS.items()}
    zone_cursors = {k: 0 for k in active_pools}
    hue_tracker = SpatialHueTracker(cell_size=8.0)

    # Pre-seed SpatialHueTracker from existing neighbor shards outside this sector to prevent cross-sector border same-hue
    shards_dir = args.out_dir / "shards"
    if args.sector != "all" and shards_dir.exists():
        neighbor_set: set[tuple[int, int]] = set()
        for gx, gz in valid_shards:
            for dx in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    nsg = (gx + dx, gz + dz)
                    if nsg not in valid_shards:
                        neighbor_set.add(nsg)
        for ngx, ngz in neighbor_set:
            npath = shards_dir / f"{ngx}_{ngz}.json"
            if npath.exists():
                try:
                    ndata = json.loads(npath.read_text(encoding="utf-8"))
                    for f in ndata.get("fascias", ()):
                        hue_tracker.add(f[0], f[2], f[3], FASCIA_META[int(f[7])][0])
                except Exception:
                    pass

    def pick_next_fascia(zkey: str, forbidden: set[str]) -> int:
        pool = active_pools.get(zkey) or active_pools["old_downtown"]
        n = len(pool)
        cur = zone_cursors[zkey]
        for step in range(n):
            cand = pool[(cur + step) % n]
            if FASCIA_META[cand][0] not in forbidden:
                zone_cursors[zkey] = (cur + step + 1) % n
                return cand
        # Fallback: scan full active catalog to guarantee ZERO same-hue neighbor!
        for cand in range(max_fascia_idx):
            if FASCIA_META[cand][0] not in forbidden:
                return cand
        cand = pool[cur % n]
        zone_cursors[zkey] = (cur + 1) % n
        return cand

    wxt_poly = osm_data["weixiaotang_poly"]
    stats = Counter()
    ring_stats: dict[str, Counter] = {r: Counter() for r in ("r1", "r2", "r3", "r4")}
    ring_h_old: dict[str, float] = defaultdict(float)
    ring_h_new: dict[str, float] = defaultdict(float)

    t1 = time.time()
    for tx, tz, ring_name, rings in selected_tile_metas:
        tile_key = f"{tx},{tz}"
        owner_sg = shard_of(tx, tz)
        owner_shard = shards_data[owner_sg]

        for bi, b in enumerate(rings):
            base_y = b[0] / 10.0
            old_top = b[1] / 10.0
            loops = b[2]
            orig_kind = int(b[3])
            orig_floors = int(b[4])
            seed = int(b[5])
            if not loops or len(loops[0]) < 3:
                continue

            wring = [(tx + p[0] / 100.0, tz + p[1] / 100.0) for p in loops[0]]
            bp = Polygon(wring).buffer(0)
            if bp.is_empty or bp.area < 4.0:
                continue
            cx, cz = bp.centroid.x, bp.centroid.y
            cpt = Point(cx, cz)

            # Absolute landmark protection (zero intrusion!)
            if hits_landmark(bp, margin=1.0):
                stats["skipped_landmark"] += 1
                ring_stats[ring_name]["skipped_landmark"] += 1
                continue

            # Match Tsinghua CMAB building (fast bbox query instead of 64-vert buffer!)
            best_rec = None
            best_score = 0.0
            bminx, bminy, bmaxx, bmaxy = bp.bounds
            for hi in cmab_tree.query(box(bminx - 4.0, bminy - 4.0, bmaxx + 4.0, bmaxy + 4.0)):
                cp, crec = cmab_items[hi]
                ov = bp.intersection(cp).area
                if ov > 0:
                    score = ov / max(bp.area, 1.0)
                else:
                    d = bp.distance(cp)
                    score = 0.12 / (1.0 + d) if d < 4.0 else 0.0
                if score > best_score:
                    best_score = score
                    best_rec = crec

            # Spatial context queries
            dist_main, nearest_main_nm, _ = nearest_road(bp, main_tree, main_roads, 38.0)
            dist_alley, _, _ = nearest_road(bp, alley_tree, alley_roads, 20.0)
            in_quiet = in_any_poly(bp, quiet_tree, osm_data["quiet_zones"])
            in_aero = hits_aeroway(bp, margin=0.0)
            in_res = in_any_poly(cpt, res_tree, osm_data["residential_zones"])
            in_com = in_any_poly(cpt, com_tree, osm_data["commercial_zones"])
            is_scenic = is_scenic_location(cpt)
            near_peak = near_named_peak(cpt)
            cmab_h_raw = float(best_rec["Height"]) if (best_rec and best_rec.get("Height")) else 0.0
            dist_wxt = bp.distance(wxt_poly) if wxt_poly else math.hypot(cx - (-976.0), cz - (-118.0))

            district = determine_district(
                cx, cz, nearest_main_nm, is_scenic, in_com, in_res, in_quiet,
                in_aeroway=in_aero, near_peak=near_peak, cmab_h=cmab_h_raw,
            )

            # Height calculation (CMAB real height with district-authentic ceilings)
            old_h = max(3.1, old_top - base_y)
            if district in ("riverside_scenic", "airport_village"):
                max_h, max_fl = 22.0, 7
            elif ring_name == "r1" or district == "old_downtown":
                max_h, max_fl = 25.5, 8
            else:
                max_h, max_fl = 41.0, 13

            if best_rec and best_rec.get("Height"):
                cmab_h = float(best_rec["Height"])
                clamped_h = max(4.5, min(max_h, cmab_h))
                floors = max(2, min(max_fl, round((clamped_h - 0.7) / 3.1))) if clamped_h >= 6.0 else 1
                new_h = round((3.8 + (floors - 1) * 3.1) if floors >= 2 else max(3.8, clamped_h), 1)
                stats["cmab_matched"] += 1
                ring_stats[ring_name]["cmab_matched"] += 1
            else:
                if district in ("riverside_scenic", "airport_village"):
                    floors = max(min(orig_floors, 4), min(4, 2 + int(math.sqrt(bp.area) / 14.0)))
                else:
                    floors = max(orig_floors, min(6, 2 + int(math.sqrt(bp.area) / 10.0) + (seed % 2)))
                new_h = round(3.8 + (floors - 1) * 3.1, 1)
                stats["fallback"] += 1
                ring_stats[ring_name]["fallback"] += 1

            upper, shop, roof_type, tint = classify_building(
                cx, cz, bp.area, orig_kind, best_rec, district, dist_main, dist_alley, dist_wxt, in_res, seed,
                in_commercial=in_com,
            )

            owner_shard["overrides"][f"{tile_key}:{bi}"] = {
                "h": new_h,
                "f": floors,
                "u": upper,
                "s": shop,
                "r": roof_type,
                "c": tint,
            }
            stats["buildings"] += 1
            stats[f"district_{district}"] += 1
            stats[f"upper_{upper}"] += 1
            ring_stats[ring_name]["buildings"] += 1
            ring_h_old[ring_name] += old_h
            ring_h_new[ring_name] += new_h

            # Street-facing 3D relief props (eaves, AC units, wall-to-wall fascias, pier blades)
            if shop >= 0 and (dist_main < 24.0 or dist_alley < 15.0):
                # Map district to signboard pool
                if district == "riverside_scenic":
                    zkey = "riverside_scenic"
                elif district in ("station_arterial", "lingui_new_district"):
                    zkey = "station_arterial"
                elif district == "old_downtown":
                    zkey = "old_downtown"
                else:
                    zkey = "neighborhood_alley"
                # Near campus perimeter (outside quiet zone!) mix in campus_edge signage
                if quiet_tree and not in_quiet:
                    for hi in quiet_tree.query(cpt.buffer(65.0)):
                        if cpt.distance(osm_data["quiet_zones"][hi]) < 65.0:
                            if (seed % 3) == 0:
                                zkey = "campus_edge"
                            break

                ring_pts = list(loops[0])
                npts = len(ring_pts)
                bldg_ac_count = 0
                MAX_AC_PER_BLDG = 8

                for ei in range(npts):
                    p1 = (tx + ring_pts[ei][0] / 100.0, tz + ring_pts[ei][1] / 100.0)
                    p2 = (tx + ring_pts[(ei + 1) % npts][0] / 100.0, tz + ring_pts[(ei + 1) % npts][1] / 100.0)
                    dx, dz = p2[0] - p1[0], p2[1] - p1[1]
                    elen = math.hypot(dx, dz)
                    if elen < 3.6 or elen > 90.0:
                        continue
                    mx, mz = (p1[0] + p2[0]) * 0.5, (p1[1] + p2[1]) * 0.5
                    # Outward normal
                    nx, nz = dz / elen, -dx / elen
                    if bp.contains(Point(mx + nx * 0.5, mz + nz * 0.5)):
                        nx, nz = -nx, -nz

                    edge_mid = Point(mx + nx * 1.2, mz + nz * 1.2)
                    # Find nearest drivable road within 22m
                    d_edge_road, _, nearest_ls = nearest_road(edge_mid, drive_tree, drive_roads, 22.0)
                    if nearest_ls is None or d_edge_road > 22.0:
                        continue
                    # For non-main narrow alleys, tighten to 14m to avoid courtyard-facing walls
                    d_edge_main, _, _ = nearest_road(edge_mid, main_tree, main_roads, 22.5)
                    is_main_edge = d_edge_main <= 22.0
                    if not is_main_edge and d_edge_road > 14.0:
                        continue

                    # Normal must point toward the road (dot > 0.25)
                    proj = nearest_ls.interpolate(nearest_ls.project(edge_mid))
                    rx, rz = proj.x - mx, proj.y - mz
                    rlen = math.hypot(rx, rz) or 1.0
                    if (nx * rx + nz * rz) / rlen < 0.25:
                        continue

                    # Skip edges near bridges, water, landmarks, aeroway, or quiet zones
                    if hits_landmark(edge_mid, margin=2.2) or hits_water(edge_mid, margin=2.0) or hits_aeroway(edge_mid, margin=0.0) or in_any_poly(edge_mid, quiet_tree, osm_data["quiet_zones"]):
                        continue
                    if bridge_tree:
                        bidxs = bridge_tree.query_nearest(edge_mid, max_distance=7.0, all_matches=False)
                        if len(bidxs) > 0:
                            continue

                    prop_sg = shard_of(mx, mz)
                    if prop_sg not in shards_data:
                        prop_sg = owner_sg
                    prop_shard = shards_data[prop_sg]

                    yaw = round(math.atan2(nx, nz), 3)
                    trim = min(0.4, elen * 0.08)
                    ux, uz = dx / elen, dz / elen
                    ax1, az1 = p1[0] + ux * trim, p1[1] + uz * trim
                    ax2, az2 = p2[0] - ux * trim, p2[1] - uz * trim

                    # Eaves / Awnings (v1+ style: 2F grey-tile Guilin eave on main streets, weathered alley awning on old alleys)
                    if is_main_edge:
                        if district == "lingui_new_district":
                            eave_prob = upper in (3, 5) and floors <= 6 and (seed + ei) % 4 == 0
                        else:
                            eave_prob = (seed + ei) % 2 == 0 if district in ("old_downtown", "riverside_scenic") else (seed + ei) % 4 == 0
                        if eave_prob and floors >= 3 and floors <= 8:
                            eave_seg = LineString([(ax1, az1), (ax2, az2)])
                            if not hits_landmark(eave_seg, margin=1.5):
                                prop_shard["eaves"].append([
                                    round(ax1, 2), round(az1, 2), round(ax2, 2), round(az2, 2),
                                    round(base_y + 4.10, 2), round(nx, 3), round(nz, 3), 0,
                                ])
                                stats["eaves"] += 1
                    elif dist_alley < 13.0 and district in ("old_downtown", "neighborhood_alley") and (seed + ei) % 2 == 0:
                        eave_seg = LineString([(ax1, az1), (ax2, az2)])
                        if not hits_landmark(eave_seg, margin=1.5):
                            prop_shard["eaves"].append([
                                round(ax1, 2), round(az1, 2), round(ax2, 2), round(az2, 2),
                                round(base_y + 3.25, 2), round(nx, 3), round(nz, 3), 1,
                            ])
                            stats["eaves"] += 1

                    # AC outdoor units at solid masonry piers (skip curtain-wall towers upper==4)
                    if bldg_ac_count < MAX_AC_PER_BLDG and floors >= 2 and upper != 4:
                        pier_d = 6.5 if is_main_edge else 9.0
                        d_pos = 0.7
                        while d_pos < elen - 0.7 and bldg_ac_count < MAX_AC_PER_BLDG:
                            t_pos = d_pos / elen
                            px = p1[0] + dx * t_pos + nx * 0.20
                            pz = p1[1] + dz * t_pos + nz * 0.20
                            fl_ac = 1 + ((seed + ei + int(d_pos)) % max(1, min(3, floors - 1)))
                            py = round(base_y + 3.8 + (fl_ac - 1) * 3.1 + 0.55, 2)
                            if py < base_y + new_h - 1.2 and not hits_landmark(Point(px, pz), margin=1.5):
                                ac_sg = shard_of(px, pz)
                                if ac_sg not in shards_data:
                                    ac_sg = prop_sg
                                shards_data[ac_sg]["acUnits"].append([round(px, 2), py, round(pz, 2), yaw])
                                stats["acUnits"] += 1
                                bldg_ac_count += 1
                            d_pos += pier_d

                    # Wall-to-wall contiguous diverse-color 3D shopfront fascias (auto 2-split when bay fw > 6.2m)
                    target_bay = 4.65 if district == "old_downtown" else 5.20
                    n_bays = max(1, round(elen / target_bay))
                    bay_span = elen / n_bays
                    if bay_span - 0.18 > 6.2:
                        n_bays *= 2
                        bay_span = elen / n_bays
                    prev_hue: str | None = None
                    for bi_bay in range(n_bays):
                        bt = (bi_bay + 0.5) / n_bays
                        fx = p1[0] + dx * bt + nx * 0.04
                        fz = p1[1] + dz * bt + nz * 0.04
                        fpt = Point(fx, fz)
                        if hits_landmark(fpt, margin=2.2) or hits_aeroway(fpt, margin=0.0) or in_any_poly(fpt, quiet_tree, osm_data["quiet_zones"]):
                            continue
                        forbidden = hue_tracker.nearby_hues(fx, fz, yaw, radius=6.5)
                        if prev_hue is not None:
                            forbidden.add(prev_hue)
                        aidx = pick_next_fascia(zkey, forbidden)
                        hue_fam, pref_h = FASCIA_META[aidx]
                        prev_hue = hue_fam
                        fw = round(max(2.4, min(6.2, bay_span - 0.18)), 2)
                        fh = round(pref_h, 2)
                        fd = round(0.08 + ((aidx * 7 + bi_bay * 3) % 5) * 0.015, 3)
                        fy = round(base_y + 2.58 + fh * 0.5, 2)
                        if fy + fh * 0.5 < base_y + new_h - 0.15:
                            f_sg = shard_of(fx, fz)
                            if f_sg not in shards_data:
                                f_sg = prop_sg
                            shards_data[f_sg]["fascias"].append([round(fx, 2), fy, round(fz, 2), yaw, fw, fh, fd, aidx])
                            hue_tracker.add(fx, fz, yaw, hue_fam)
                            stats["fascias"] += 1
                            ring_stats[ring_name]["fascias"] += 1

                    # Slim vertical pier blade signs on main commercial facades
                    if is_main_edge and elen >= 8.0 and (seed + ei) % 3 == 0:
                        pier_t = min(0.86, max(0.14, 4.8 / elen))
                        sx = p1[0] + dx * pier_t + nx * 0.34
                        sz = p1[1] + dz * pier_t + nz * 0.34
                        sy = round(base_y + 5.05, 2)
                        if sy < base_y + new_h - 1.2 and not hits_landmark(Point(sx, sz), margin=2.0):
                            bpool = BLADE_POOLS.get(zkey, BLADE_POOLS["old_downtown"])
                            b_sg = shard_of(sx, sz)
                            if b_sg not in shards_data:
                                b_sg = prop_sg
                            shards_data[b_sg]["blades"].append([round(sx, 2), sy, round(sz, 2), yaw, bpool[(seed + ei) % len(bpool)]])
                            stats["blades"] += 1

    print(f"  Processed buildings & street facades in {time.time() - t1:.2f}s")

    # Prebuild carriageway buffers for both street-sign setback validation & compound wall clipping
    carriageway_bufs = []
    wall_road_buffers = []
    for hw, ls in osm_data["all_road_geoms"]:
        if hw in ("trunk", "primary", "secondary", "tertiary", "trunk_link", "primary_link", "secondary_link", "tertiary_link", "residential", "unclassified"):
            cw = 7.8 if hw in ("trunk", "primary") else (6.4 if hw == "secondary" else (5.0 if hw == "tertiary" else 3.4))
            g = ls.buffer(cw, quad_segs=3)
            prepare(g)
            carriageway_bufs.append(g)
        w = 8.5 if hw in ("primary", "trunk", "secondary") else (6.5 if hw == "tertiary" else 4.2)
        wall_road_buffers.append(ls.buffer(w, quad_segs=3))
    carriageway_tree = STRtree(carriageway_bufs) if carriageway_bufs else None
    road_buf_tree = STRtree(wall_road_buffers) if wall_road_buffers else None

    def hits_carriageway(pt: Point) -> bool:
        if not carriageway_tree:
            return False
        for _ in carriageway_tree.query(pt, predicate="intersects"):
            return True
        return False

    # 5. Citywide clean v1 blue bilingual Guilin street signs at major named intersections (sidewalk-checked!)
    t1 = time.time()
    named_road_segs: list[tuple[str, str, LineString]] = []
    for nm, segs in osm_data["roads_by_name"].items():
        if nm not in ROAD_PINYIN:
            continue
        for hw, ls in segs:
            if hw in ("trunk", "primary", "secondary", "tertiary") or nm in OLD_DOWNTOWN_ROADS:
                named_road_segs.append((nm, hw, ls))
    if named_road_segs:
        seg_tree = STRtree([ls for _, _, ls in named_road_segs])
        placed_pts: list[tuple[float, float]] = []
        seen_pairs: set[tuple[str, str]] = set()
        for i, (n1, hw1, g1) in enumerate(named_road_segs):
            for j in seg_tree.query(g1):
                if j <= i:
                    continue
                n2, hw2, g2 = named_road_segs[j]
                if n1 == n2:
                    continue
                pair = (n1, n2) if n1 < n2 else (n2, n1)
                if pair in seen_pairs:
                    continue
                if not g1.intersects(g2):
                    continue
                inter = g1.intersection(g2)
                pts = [inter] if inter.geom_type == "Point" else (
                    [g for g in getattr(inter, "geoms", ()) if g.geom_type == "Point"]
                )
                if not pts:
                    continue
                pt = pts[0]
                ix, iz = pt.x, pt.y
                if not (wx0 + 16 <= ix <= wx1 - 16 and wz0 + 16 <= iz <= wz1 - 16):
                    continue
                if any(math.hypot(ix - ox, iz - oz) < 55.0 for ox, oz in placed_pts):
                    continue
                d_along = g1.project(pt)
                p_a = g1.interpolate(max(0.0, d_along - 2.0))
                p_b = g1.interpolate(min(g1.length, d_along + 2.0))
                tdx, tdz = p_b.x - p_a.x, p_b.y - p_a.y
                tlen = math.hypot(tdx, tdz) or 1.0
                tx_u, tz_u = tdx / tlen, tdz / tlen
                # Setback dynamically past carriageway curb based on road class, try both corners if needed
                base_lat = 10.2 if hw1 in ("trunk", "primary") else (8.4 if hw1 == "secondary" else (6.8 if hw1 == "tertiary" else 5.4))
                chosen = None
                for side in (1.0, -1.0):
                    for extra in (0.0, 2.2):
                        lat_d = base_lat + extra
                        along_d = 9.0 if hw2 in ("trunk", "primary", "secondary") else 6.5
                        sx = ix + (-tz_u) * (lat_d * side) + tx_u * along_d
                        sz = iz + tx_u * (lat_d * side) + tz_u * along_d
                        spt = Point(sx, sz)
                        if not active_chunks_poly.contains(spt):
                            continue
                        if hits_landmark(spt, margin=2.5) or hits_water(spt, margin=3.0) or hits_carriageway(spt) or hits_aeroway(spt, margin=60.0) or in_any_poly(spt, quiet_tree, osm_data["quiet_zones"]):
                            continue
                        # Ensure sign doesn't clip inside a building
                        if cmab_tree.query(spt, predicate="intersects").size > 0:
                            continue
                        chosen = (sx, sz)
                        break
                    if chosen:
                        break
                if not chosen:
                    continue
                sx, sz = chosen
                sg = shard_of(sx, sz)
                if sg not in shards_data or not shards_data[sg]["overrides"]:
                    continue
                seen_pairs.add(pair)
                placed_pts.append((ix, iz))
                sy = sample_y(sx, sz)
                if not (120.0 <= sy <= 320.0):
                    continue
                yaw = math.atan2(tx_u, tz_u)
                shards_data[sg]["streetSigns"].append({
                    "x": round(sx, 2), "y": round(sy, 2), "z": round(sz, 2),
                    "yaw": round(yaw, 3), "zh": n1, "en": ROAD_PINYIN[n1], "cross": n2,
                })
                stats["streetSigns"] += 1
    print(f"  Generated {stats['streetSigns']} sidewalk-verified bilingual street signs ({time.time() - t1:.2f}s)")

    # 6. Clean v1 subtle iron perimeter fences ONLY for unmodeled OSM schools/hospitals (zero v2 bloat!)
    t1 = time.time()
    road_buffers = wall_road_buffers

    for _cname, am, poly in osm_data["compounds"]:
        if hits_landmark(poly, margin=0.0):
            # Already modeled as a hand-crafted school/campus landmark GLB -> skip completely!
            continue
        if poly.geom_type == "MultiPolygon":
            exteriors = [list(g.exterior.coords) for g in poly.geoms]
        elif poly.geom_type == "Polygon":
            exteriors = [list(poly.exterior.coords)]
        else:
            continue
        wkind = 0 if am in ("school", "hospital") else 1
        for coords in exteriors:
            for i in range(len(coords) - 1):
                p1, p2 = coords[i], coords[i + 1]
                seg = LineString([p1, p2])
                if seg.length < 5.0:
                    continue
                rem = seg.intersection(active_chunks_poly)
                if rem.is_empty:
                    continue
                if road_buf_tree:
                    for hi in road_buf_tree.query(rem):
                        rem = rem.difference(road_buffers[hi])
                parts = [rem] if rem.geom_type == "LineString" else (list(rem.geoms) if hasattr(rem, "geoms") else [])
                for part in parts:
                    if part.geom_type != "LineString" or part.length < 5.0:
                        continue
                    if hits_landmark(part, margin=2.0) or hits_water(part, margin=2.0):
                        continue
                    c0, c1 = part.coords[0], part.coords[-1]
                    y1, y2 = round(sample_y(c0[0], c0[1]), 2), round(sample_y(c1[0], c1[1]), 2)
                    if not (120.0 <= y1 <= 320.0 and 120.0 <= y2 <= 320.0):
                        continue
                    mx, mz = (c0[0] + c1[0]) * 0.5, (c0[1] + c1[1]) * 0.5
                    sg = shard_of(mx, mz)
                    if sg not in shards_data or not shards_data[sg]["overrides"]:
                        continue
                    shards_data[sg]["walls"].append([
                        round(c0[0], 2), round(c0[1], 2), round(c1[0], 2), round(c1[1], 2),
                        y1, y2, wkind,
                    ])
                    stats["walls"] += 1
    print(f"  Generated {stats['walls']} subtle iron compound wall segs ({time.time() - t1:.2f}s)")

    # 7. Write non-empty shards & optional index.json (enforcing < 25 KB gzip per shard)
    out_dir = args.out_dir
    shards_dir = out_dir / "shards"
    shards_dir.mkdir(parents=True, exist_ok=True)

    index_path = out_dir / "index.json"
    existing_shards_meta: dict[str, dict] = {}
    if args.merge_existing and not args.no_index and index_path.exists():
        try:
            old_idx = json.loads(index_path.read_text(encoding="utf-8"))
            existing_shards_meta = dict(old_idx.get("shards", {}))
        except Exception:
            existing_shards_meta = {}

    shards_meta: dict[str, dict] = dict(existing_shards_meta)
    max_gz_bytes = 0
    max_gz_key = ""
    total_raw_bytes = 0
    total_gz_bytes = 0
    written_shards = 0
    skipped_empty_shards = 0

    for sg in sorted(shards_data.keys()):
        gx, gz = sg
        skey = f"{gx},{gz}"
        payload = shards_data[sg]
        if not any(payload[k] for k in ("overrides", "fascias", "eaves", "acUnits", "blades", "streetSigns", "walls")):
            skipped_empty_shards += 1
            continue
        gz_len = trim_shard_to_budget(payload, MAX_SHARD_GZIP_BYTES)
        raw_str = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        raw_bytes = raw_str.encode("utf-8")
        (shards_dir / f"{gx}_{gz}.json").write_bytes(raw_bytes)
        written_shards += 1

        total_raw_bytes += len(raw_bytes)
        total_gz_bytes += gz_len
        if gz_len > max_gz_bytes:
            max_gz_bytes = gz_len
            max_gz_key = skey

        shards_meta[skey] = {
            "ring": shard_ring_map.get(sg) or shard_ring(gx, gz),
            "buildings": len(payload["overrides"]),
            "fascias": len(payload["fascias"]),
        }

    if not args.no_index:
        # Build ordered rings index
        rings_index: dict[str, list[str]] = {"r1": [], "r2": [], "r3": [], "r4": []}
        for skey in sorted(shards_meta.keys(), key=lambda s: tuple(map(int, s.split(",")))):
            r = shards_meta[skey]["ring"]
            rings_index.setdefault(r, []).append(skey)

        index_payload = {
            "version": 1,
            "shardSize": SHARD_SIZE,
            "fasciaGrid": [cols, rows],
            "rings": {k: v for k, v in rings_index.items() if v or k in ("r1", "r2", "r3")},
            "shards": dict(sorted(shards_meta.items(), key=lambda kv: tuple(map(int, kv[0].split(","))))),
        }
        index_path.write_text(json.dumps(index_payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    # Summary report
    print(f"\n=== City Upgrade v1+ Build Complete ({time.time() - t0:.2f}s) ===")
    print(f"  Shards written : {written_shards} (skipped empty: {skipped_empty_shards}, total raw {total_raw_bytes/1024:.1f} KB, gzip {total_gz_bytes/1024:.1f} KB)")
    print(f"  Max shard gzip : {max_gz_bytes/1024:.2f} KB ({max_gz_key}) [limit < 25.00 KB]")
    print(f"  Totals         : {stats['buildings']} buildings (CMAB {stats['cmab_matched']}, skipped_landmark {stats['skipped_landmark']})")
    print(f"                   {stats['fascias']} fascias, {stats['blades']} blades, {stats['eaves']} eaves, {stats['acUnits']} ACs, {stats['streetSigns']} signs, {stats['walls']} walls")
    for r in ("r1", "r2", "r3", "r4"):
        rs = ring_stats[r]
        nb = rs["buildings"]
        if nb:
            cmab_pct = 100.0 * rs["cmab_matched"] / nb
            print(
                f"  Ring {r.upper()}        : {nb:5d} bldgs | CMAB {cmab_pct:5.1f}% | "
                f"avgH {ring_h_old[r]/nb:4.1f}m -> {ring_h_new[r]/nb:4.1f}m | "
                f"fascias {rs['fascias']:5d} | lm_skip {rs['skipped_landmark']:3d}"
            )


if __name__ == "__main__":
    main()

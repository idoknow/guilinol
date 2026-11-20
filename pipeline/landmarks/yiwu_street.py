"""Yiwu Road streetscape: local +x follows Yiwu Rd northward from Ronghu toward Lize Bridge.
Covers IMG_1344, IMG_1347, IMG_1350, IMG_1351..1353 sightlines, Guihu iron fence & street corner sign.
"""
import math
from pathlib import Path
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from trees import emit_landmark_tree
from xiaoyao_tower import generate


def _cjk_font(size):
    for path in (
        'NotoSansCJK-Regular.ttc',
        '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc',
        '/System/Library/Fonts/STHeiti Medium.ttc',
        '/System/Library/Fonts/Hiragino Sans GB.ttc',
    ):
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def canopy(model, station, side, high_crown=False):
    near_office = side > 0 and -62 <= station <= -6
    lateral = 5.95 if near_office else (-6.05 if side < 0 else 6.35)
    verge_stations = ((-42,-7.35),(-15,-7.65),(2,-7.85)) if side<0 else ((-38,10.05),(-20,9.9),(-4,9.75),(12,8.7))
    if verge_stations[0][0]-5 <= station <= verge_stations[-1][0]+5:
        lateral = float(np.interp(station,*zip(*verge_stations)))
    # Orient +X leaning/arching crown across Yiwu Rd (-z when side > 0, +z when side < 0)
    yaw = (math.pi / 2 if side > 0 else -math.pi / 2) + ((int(abs(station)) % 5) - 2) * 0.08
    # Alternate camphor and bischofia/koelreuteria along the street (foreground -56.5 is a grand leaning camphor!)
    species = 'camphor' if (station == -56.5 or int(abs(station)) % 2 == 0) else 'bischofia'
    # Tall 13.5-15.6 m street trees leaning 10.5-14.3 deg (0.185-0.25 rad) across the 2-lane carriageway!
    lean_rad = 0.23 if station == -56.5 else (0.185 + (int(abs(station) * 3) % 4) * 0.020)
    base_sc = 1.15 if station == -56.5 else (1.06 + (int(abs(station)) % 3) * 0.04)
    y_sc = 1.22 if high_crown else (1.14 + (int(abs(station)) % 3) * 0.04)
    emit_landmark_tree(
        model,
        species,
        station,
        0.06,
        lateral,
        scale=base_sc,
        y_scale=y_sc,
        yaw=yaw,
        variant_idx=int(abs(station)) % 3,
        wood_mat='wood',
        leaf_mat='leaf',
        pod_mat='earth',
        collide_trunk=True,
        lean_override=lean_rad,
        clip_local_z=(-16.0, 8.20) if near_office else None,
    )


def palm(model, station, lateral=-11.2, height=10.2):
    emit_landmark_tree(
        model,
        'palm',
        station,
        0.0,
        lateral,
        scale=0.92,
        y_scale=height / 10.2,
        yaw=station * 0.4,
        variant_idx=int(abs(station)) % 3,
        wood_mat='granite',
        leaf_mat='green',
        collide_trunk=False,
    )


def scooter(model, station, paint, lateral=-6.65):
    # Sweep the joined wheel, floorboard and seat profiles at their actual widths.
    # Interior faces at the wheel/frame joint would split the bearing surface.
    import shapely
    from shapely.geometry import Point, box
    rims = [Point(z,.28).buffer(.21,quad_segs=2) for z in (-.48,.48)]
    body = box(-.56,.32,.56,.56).union(box(.405,.50,.555,.96))
    seat = box(-.53,.56,.05,.74)
    layers = [(0,.09,shapely.union_all([*rims,body,seat])),
              (.09,.18,body.union(seat)),(.18,.19,seat)]
    for index,(inner,outer,profile) in enumerate(layers):
        following = layers[index+1][2] if index+1<len(layers) else None
        cap = profile if following is None else profile.difference(following)
        for sign in (-1,1):
            for tri in shapely.constrained_delaunay_triangles(cap).geoms:
                coords=list(tri.exterior.coords)[:3]
                middle=tri.centroid
                color='sign' if seat.covers(middle) else paint if body.covers(middle) else 'tile'
                model.mesh([(station+sign*outer,y,lateral+z) for z,y in coords],[[0,1,2]],color)
            for (z,y),(zz,yy) in zip(profile.exterior.coords,list(profile.exterior.coords)[1:]):
                color='sign' if min(y,yy)>=.56 and max(z,zz)<.06 else paint if max(y,yy)>=.32 else 'tile'
                model.mesh([(station+sign*x,h,lateral+d) for x,h,d in
                            ((inner,y,z),(outer,y,z),(outer,yy,zz),(inner,yy,zz))],[[0,1,2],[0,2,3]],color)


def directions_and_corner(model):
    # IMG_1350: municipal blue sign & corner shopfront aligned to ~39% frame width from camera (24.21, -4.03)
    sx, sz = 38.4, 6.4
    # Sign faces incoming traffic (-x/-z direction toward camera)
    model.pose = (sx, 0, sz, 0.35)
    model.box(0, -0.3, 0, 0.13, 3.95, 0.13, 'granite', True)
    font = _cjk_font(20)
    for index, text in enumerate(('↑ 解放西路', '← 丽君路', '三多路 →')):
        bottom = 3.12 - index * 0.58
        model.box(-0.08, bottom, 0, 0.10, 0.52, 2.36, 'glass')
        model.box(-0.09, bottom - 0.02, 0, 0.09, 0.56, 2.42, 'white')
        model.box(-0.11, bottom, 0, 0.08, 0.50, 2.32, 'glass')
        if not model.detail:
            continue
        image = Image.new('1', (126, 26))
        draw = ImageDraw.Draw(image)
        draw.text((63, 13), text, font=font, anchor='mm', fill=1)
        for row, pixels in enumerate(np.asarray(image)):
            for left, right in np.flatnonzero(np.diff(np.r_[False, pixels, False])).reshape(-1, 2):
                z0, z1 = (left - 63) * 0.0175, (right - 63) * 0.0175
                top = bottom + 0.49 - row * 0.018
                model.mesh(
                    [(-0.16, top, z0), (-0.16, top, z1), (-0.16, top - 0.018, z1), (-0.16, top - 0.018, z0)],
                    [[0, 1, 2], [0, 2, 3]],
                    'white',
                )
    model.pose = (0, 0, 0, 0)

    # East sidewalk slab & corner shopfront facade + lush corner tree (IMG_1350 right of sign)
    model.box(36.0, -0.25, 9.6, 22.0, 0.36, 4.4, 'pave', True)
    # Corner 4-storey white shop house on right edge of IMG_1350 + 3-storey alley shop behind sign
    model.box(29.0, -0.3, 12.6, 6.8, 13.4, 5.0, 'white', True)
    model.box(43.5, -0.3, 13.8, 9.2, 10.6, 5.2, 'white', True)
    model.box(43.5, 3.35, 10.95, 9.4, 0.24, 1.35, 'glass')
    for wy in (4.5, 7.6):
        model.box(29.0, wy, 10.05, 1.8, 1.5, 0.12, 'tile')
        for wx in (41.2, 45.6):
            model.box(wx, wy, 11.15, 2.2, 1.55, 0.12, 'tile')
    # Lush tree standing immediately right of the blue sign in IMG_1350
    canopy(model, 33.4, 1.08, high_crown=False)


def street(model):
    model.fit_to_grade('yiwu_street')
    # West lakeside stone sidewalk & granite-pillared spearhead iron fence (IMG_1347)
    for station in range(-65, 86, 5):
        # Low natural kerb height (+0.13 m above carriageway, skirt down to -0.35 m)
        model.box(station, -0.35, -7.45, 5.0, 0.48, 4.1, 'pave', True)
        model.box(station, 0.135, -5.48, 5.0, 0.02, 0.18, 'granite')
        model.box(station, 0.138, -8.05, 5.0, 0.015, 0.30, 'yellow')
        # Gap in lakeside fence across yiwu_old_house frontage (station 49..80)
        for left, right in ((station - 2.5, min(station + 2.5, 49.0)), (max(station - 2.5, 80.5), station + 2.5)):
            if right > left:
                # Stone plinth wall under iron fence
                model.box((left + right) / 2, -0.25, -9.45, right - left, 0.72, 0.46, 'granite', True)
        if not 49.0 < station < 80.5:
            # Ashlar stone pier with green glazed tile cap (IMG_1347)
            model.box(station, 0.47, -9.45, 0.56, 1.68, 0.56, 'stone', True)
            model.box(station, 2.15, -9.45, 0.76, 0.12, 0.76, 'white')
            model.roof(station, 2.27, -9.45, 0.82, 0.82, 0.26)
        for height in (0.62, 1.86):
            for left, right in ((station, min(station + 5, 49.0)), (max(station, 80.5), station + 5)):
                if right > left:
                    model.box((left + right) / 2, height, -9.45, right - left, 0.065, 0.065, 'tile')
        if model.detail:
            for offset in np.arange(0.38, 4.75, 0.34):
                if 49.0 < station + offset < 80.5:
                    continue
                # Vertical black iron bar + spearhead finial rising above top rail (IMG_1347)
                model.box(station + offset, 0.52, -9.45, 0.045, 1.52, 0.045, 'tile')
                if abs(station - (-25)) < 22:
                    model.box(station + offset, 1.90, -9.45, 0.10, 0.10, 0.04, 'tile')

    # Paved sidewalk along yiwu_old_house frontage (station 46..84)
    model.box(65.0, -0.25, -10.8, 36.0, 0.39, 3.2, 'pave', True)

    # Tall slender lakeside fan palms outside the iron fence (prominent in IMG_1347!)
    for p_st, p_lat, p_h in (
        (-36.5, -11.4, 10.6),
        (-31.8, -10.8, 9.4),
        (-28.2, -11.6, 11.5),
        (-22.5, -11.0, 10.8),
        (4.0, -11.2, 9.6),
        (34.0, -11.2, 9.8),
    ):
        palm(model, p_st, p_lat, p_h)
        if p_st in (-36.5, 4.0, 34.0):
            model.box(p_st, -0.2, -10.8, 4.8, 0.95, 1.8, 'leaf')

    # Dense overarching street-tree rows closing >=60% over the 2-lane carriageway (IMG_1345) while framing facades
    west_stations = (-56.5, -46.5, -36.5, -26.5, -16.0, -4.5, 7.5, 19.5, 36.0, 48.0, 85.0)
    east_stations = (-52.0, -41.5, -31.0, -20.5, -9.5, 2.5, 13.5, 44.0, 64.0, 82.0)
    for st in west_stations:
        canopy(model, st, -1, high_crown=(st >= 48))
    for st in east_stations:
        canopy(model, st, +1, high_crown=(st >= 44))
    # High overarching camphor boughs in front of yiwu_old_house (trunks across street, high leafy canopy)
    for st in (58, 72):
        emit_landmark_tree(model, 'camphor', st, 0.06, 8.1, scale=1.06, y_scale=1.22, yaw=math.pi / 2, variant_idx=st % 3, wood_mat='wood', leaf_mat='leaf', collide_trunk=True, lean_override=0.20)

    # Roadside scooters (including foreground row near 1350)
    for base_st, lat in ((-50, -6.6), (4, -6.6), (21.5, -2.2)):
        for idx, paint in enumerate(('white', 'green', 'earth', 'tile') if model.detail else ('white',)):
            scooter(model, base_st + idx * 0.92, paint, lat)

    directions_and_corner(model)


if __name__ == '__main__':
    generate(
        'yiwu_street',
        street,
        colors=dict(
            granite='#7a7f84',
            stone='#b8b7b2',
            pave='#8b9096',
            tile='#262a2d',
            glass='#19589c',
            green='#3e6c54',
            leaf='#396031',
        ),
    )

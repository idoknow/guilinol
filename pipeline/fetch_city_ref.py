#!/usr/bin/env python3
from __future__ import annotations

import argparse
import http.cookiejar
import json
import math
import os
import re
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageDraw, ImageFont
import refpack_cache as cache

CHROME_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

CJK_FONTS = [
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
    "/System/Library/Fonts/STHeiti Medium.ttc",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "/Library/Fonts/Arial Unicode.ttf",
]

OVERPASS_ENDPOINTS = [
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://lz4.overpass-api.de/api/interpreter",
]
ROOT = Path(__file__).resolve().parents[1]


class HttpSession:
    """Thin cookie-aware HTTP helper using stdlib urllib."""

    def __init__(self) -> None:
        self.last_commons = 0.0
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self.jar)
        )

    def get_bytes(
        self,
        url: str,
        referer: str | None = None,
        timeout: int = 20,
        data: bytes | None = None,
    ) -> bytes:
        headers = {"User-Agent": CHROME_UA, "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"}
        if referer:
            headers["Referer"] = referer
        req = urllib.request.Request(url, data=data, headers=headers)
        for attempt in range(2):
            if urllib.parse.urlsplit(url).hostname in {'commons.wikimedia.org', 'upload.wikimedia.org'}:
                time.sleep(max(0, 1.5 - (time.monotonic() - self.last_commons)))
                self.last_commons = time.monotonic()
            try:
                with self.opener.open(req, timeout=timeout) as resp:
                    return resp.read()
            except OSError:
                if attempt:
                    raise

    def get_json(
        self,
        url: str,
        referer: str | None = None,
        timeout: int = 20,
        data: bytes | None = None,
    ) -> Any:
        raw = self.get_bytes(url, referer=referer, timeout=timeout, data=data)
        return json.loads(raw.decode("utf-8", errors="ignore"))


def load_font(size: int = 22) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for path in CJK_FONTS:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size=size)
            except OSError:
                continue
    return ImageFont.load_default()


def safe_filename(name: str, max_len: int = 80) -> str:
    cleaned = re.sub(r'[\\/:*?"<>|\s]+', "_", name.strip()).strip("_")
    return (cleaned[:max_len] or "item")


def wgs84_to_gcj02(lat: float, lon: float) -> tuple[float, float]:
    """Convert WGS84 lat/lon to GCJ-02 for China-grid map APIs (Amap)."""
    a, ee = 6378245.0, 0.00669342162296594323

    def _dlat(x: float, y: float) -> float:
        r = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * math.sqrt(abs(x))
        r += (20.0 * math.sin(6.0 * x * math.pi) + 20.0 * math.sin(2.0 * x * math.pi)) * 2.0 / 3.0
        r += (20.0 * math.sin(y * math.pi) + 40.0 * math.sin(y / 3.0 * math.pi)) * 2.0 / 3.0
        r += (160.0 * math.sin(y / 12.0 * math.pi) + 320 * math.sin(y * math.pi / 30.0)) * 2.0 / 3.0
        return r

    def _dlon(x: float, y: float) -> float:
        r = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * math.sqrt(abs(x))
        r += (20.0 * math.sin(6.0 * x * math.pi) + 20.0 * math.sin(2.0 * x * math.pi)) * 2.0 / 3.0
        r += (20.0 * math.sin(x * math.pi) + 40.0 * math.sin(x / 3.0 * math.pi)) * 2.0 / 3.0
        r += (150.0 * math.sin(x / 12.0 * math.pi) + 300.0 * math.sin(x / 30.0 * math.pi)) * 2.0 / 3.0
        return r

    dl = _dlat(lon - 105.0, lat - 35.0)
    dg = _dlon(lon - 105.0, lat - 35.0)
    rad_lat = lat / 180.0 * math.pi
    magic = 1 - ee * math.sin(rad_lat) ** 2
    sqrt_magic = math.sqrt(magic)
    dl = (dl * 180.0) / ((a * (1 - ee)) / (magic * sqrt_magic) * math.pi)
    dg = (dg * 180.0) / (a / sqrt_magic * math.cos(rad_lat) * math.pi)
    return lat + dl, lon + dg


def wgs_to_mc(lat, lon):
    lat, lon = wgs84_to_gcj02(lat, lon)
    frequency = math.pi * 3000 / 180
    radius = math.hypot(lon, lat) + .00002 * math.sin(lat * frequency)
    theta = math.atan2(lat, lon) + .000003 * math.cos(lon * frequency)
    bd_lon = radius * math.cos(theta) + .0065
    bd_lat = radius * math.sin(theta) + .006
    phi = math.radians(bd_lat)
    eccentricity = .08227185422
    es = eccentricity * math.sin(phi)
    return (6378206.4 * math.radians(bd_lon),
            6378206.4 * (math.asinh(math.tan(phi)) - eccentricity * math.atanh(es)))


def mc_to_wgs(x, y):
    lat, lon = math.degrees(math.atan(math.sinh(y / 6378206.4))), x / 111320.7
    for _ in range(10):
        east, north = wgs_to_mc(lat, lon)
        lat += (y - north) * math.cos(math.radians(lat)) / 111320.7
        lon += (x - east) / 111320.7
    return lat, lon


def bearing(origin, target):
    start, end = map(math.radians, (origin[0], target[0]))
    delta = math.radians(target[1] - origin[1])
    return math.degrees(math.atan2(math.sin(delta) * math.cos(end),
        math.cos(start)*math.sin(end) - math.sin(start)*math.cos(end)*math.cos(delta))) % 360


def equirect_to_rectilinear(
    eq_arr: np.ndarray,
    north_dir_deg: float,
    yaw_deg: float,
    pitch_deg: float = 6.0,
    fov_deg: float = 90.0,
    out_w: int = 960,
    out_h: int = 640,
) -> Image.Image:
    """Project Baidu equirectangular panorama to rectilinear view calibrated to true north.

    Verified formula on Baidu z=4 panoramas:
      x_frac(true_azimuth_deg) = ((NorthDir + true_azimuth_deg) % 360) / 360.0
    where true_azimuth_deg is 0=N, 90=E, 180=S, 270=W (increasing clockwise).
    """
    H, W = eq_arr.shape[:2]
    f = (out_w / 2.0) / math.tan(math.radians(fov_deg) / 2.0)
    px = np.arange(out_w, dtype=np.float32) - (out_w - 1) / 2.0
    py = (out_h - 1) / 2.0 - np.arange(out_h, dtype=np.float32)
    x_grid, y_grid = np.meshgrid(px, py)
    z_grid = np.full_like(x_grid, f)

    pr = math.radians(pitch_deg)
    cp, sp = math.cos(pr), math.sin(pr)
    y_world = y_grid * cp + z_grid * sp
    z_horiz = -y_grid * sp + z_grid * cp

    az_world = yaw_deg + np.degrees(np.arctan2(x_grid, z_horiz))
    el_rad = np.arctan2(y_world, np.hypot(x_grid, z_horiz))

    u = (((north_dir_deg + az_world) % 360.0) / 360.0) * W
    v = np.clip((0.5 - el_rad / math.pi) * H, 0.0, H - 1.0001)

    u0 = np.floor(u).astype(np.int32) % W
    u1 = (u0 + 1) % W
    v0 = np.floor(v).astype(np.int32)
    v1 = np.minimum(v0 + 1, H - 1)

    du = (u - np.floor(u))[..., None]
    dv = (v - v0)[..., None]

    c00 = eq_arr[v0, u0].astype(np.float32)
    c10 = eq_arr[v0, u1].astype(np.float32)
    c01 = eq_arr[v1, u0].astype(np.float32)
    c11 = eq_arr[v1, u1].astype(np.float32)

    out = (
        c00 * (1.0 - du) * (1.0 - dv)
        + c10 * du * (1.0 - dv)
        + c01 * (1.0 - du) * dv
        + c11 * du * dv
    )
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))


def download_baidu_equirect(http: HttpSession, sid: str, zoom: int = 4) -> Image.Image:
    """Download and stitch Baidu z=4 (8x4, 4096x2048) or z=3 (4x2) panorama tiles."""
    cols, rows = (8, 4) if zoom == 4 else (4, 2)
    tile_sz = 512
    canvas = Image.new("RGB", (cols * tile_sz, rows * tile_sz))

    def _fetch_tile(rc: tuple[int, int]) -> tuple[int, int, Image.Image | None]:
        r, c = rc
        url = f"https://mapsv0.bdimg.com/?qt=pdata&sid={sid}&pos={r}_{c}&z={zoom}"
        try:
            raw = http.get_bytes(url, referer="https://map.baidu.com/", timeout=20)
            from io import BytesIO
            return r, c, Image.open(BytesIO(raw)).convert("RGB")
        except Exception as exc:
            raise ValueError(f'tile {r},{c}: {exc}') from exc

    coords = [(r, c) for r in range(rows) for c in range(cols)]
    with ThreadPoolExecutor(max_workers=12) as pool:
        for r, c, tile in pool.map(_fetch_tile, coords):
            if tile is not None:
                canvas.paste(tile, (c * tile_sz, r * tile_sz))
    return canvas


def build_labeled_sheet(
    panels: list[tuple[str, Image.Image]],
    cols: int = 2,
    tile_w: int = 780,
    tile_h: int = 520,
    title: str = "",
) -> Image.Image:
    """Arrange images into a cleanly labeled contact sheet."""
    rows = math.ceil(len(panels) / cols)
    pad = 14
    header_h = 46 if title else 12
    caption_h = 34
    W = pad + cols * (tile_w + pad)
    H = header_h + rows * (tile_h + caption_h + pad) + pad
    sheet = Image.new("RGB", (W, H), (22, 24, 28))
    draw = ImageDraw.Draw(sheet)
    title_font = load_font(22)
    cap_font = load_font(17)

    if title:
        draw.text((pad, 10), title, fill=(245, 245, 245), font=title_font)

    for idx, (label, img) in enumerate(panels):
        r, c = divmod(idx, cols)
        x = pad + c * (tile_w + pad)
        y = header_h + r * (tile_h + caption_h + pad)
        resized = img.resize((tile_w, tile_h), Image.Resampling.LANCZOS)
        sheet.paste(resized, (x, y))
        draw.rectangle([x, y + tile_h, x + tile_w, y + tile_h + caption_h], fill=(36, 40, 48))
        draw.text((x + 10, y + tile_h + 7), label, fill=(235, 240, 250), font=cap_font)
    return sheet


def fetch_wikimedia_channel(
    http: HttpSession,
    out_dir: Path,
    lat: float,
    lon: float,
    keywords: list[str],
    limit: int = 5,
) -> dict[str, Any]:
    """Query Wikimedia Commons geosearch + keyword files with license metadata."""
    wiki_dir = out_dir / "wikimedia"
    wiki_dir.mkdir(parents=True, exist_ok=True)
    errors = []

    titles: list[str] = []
    # Geosearch near anchor
    try:
        geo_url = (
            "https://commons.wikimedia.org/w/api.php?action=query&list=geosearch"
            f"&gscoord={lat}|{lon}&gsradius=1200&gsnamespace=6&gslimit=12&format=json"
        )
        gdata = http.get_json(geo_url)
        for p in gdata.get("query", {}).get("geosearch", []):
            if p.get("title") and p["title"] not in titles:
                titles.append(p["title"])
    except Exception as exc:
        errors.append(str(exc))

    # Keyword search supplement
    for kw in keywords:
        try:
            s_url = (
                "https://commons.wikimedia.org/w/api.php?action=query&list=search"
                f"&srsearch={urllib.parse.quote(kw)}&srnamespace=6&srlimit=5&format=json"
            )
            sdata = http.get_json(s_url)
            for p in sdata.get("query", {}).get("search", []):
                if p.get("title") and p["title"] not in titles:
                    titles.append(p["title"])
        except Exception as exc:
            errors.append(str(exc))

    items: list[dict[str, Any]] = []
    if not titles:
        return {"status": "failed", "reason": '; '.join(errors) or 'no matching files', "items": []}

    info_url = (
        "https://commons.wikimedia.org/w/api.php?action=query&prop=imageinfo"
        "&iiprop=url|size|extmetadata&iiurlwidth=1920&format=json&titles="
        + urllib.parse.quote("|".join(titles[:15]))
    )
    idata = http.get_json(info_url)
    by_title = {
        page.get("title"): page
        for page in idata.get("query", {}).get("pages", {}).values()
        if page.get("title")
    }
    for t in titles[:15]:
        page = by_title.get(t)
        if not page:
            continue
        if len(items) >= limit:
            break
        ii = (page.get("imageinfo") or [None])[0]
        if not ii:
            continue
        url = ii.get("thumburl") or ii.get("url")
        url_path = urllib.parse.urlparse(url or "").path.lower()
        if not url or not url_path.endswith((".jpg", ".jpeg", ".png")):
            continue
        ext = ii.get("extmetadata", {})
        lic = (ext.get("LicenseShortName") or {}).get("value", "unknown")
        gps_lat = (ext.get("GPSLatitude") or {}).get("value", "")
        gps_lon = (ext.get("GPSLongitude") or {}).get("value", "")
        base_title = re.sub(r"\.(jpe?g|png)$", "", page["title"].replace("File:", ""), flags=re.I)
        fname = safe_filename(base_title) + ".jpg"
        out_path = wiki_dir / fname
        try:
            raw = http.get_bytes(url, timeout=25)
            out_path.write_bytes(raw)
            with Image.open(out_path) as im:
                sz = list(im.size)
            items.append({
                "title": page["title"],
                "license": lic,
                "gps": [gps_lat, gps_lon],
                "size": sz,
                "url": ii.get("url"),
                "local_file": str(out_path),
            })
        except Exception as exc:
            errors.append(str(exc))

    return {"status": "ok" if items else "failed", "count": len(items), "items": items,
            "reason": '; '.join(errors) or ('downloaded' if items else 'no usable images')}


def fetch_bilibili_channel(
    http: HttpSession,
    out_dir: Path,
    search_query: str,
    fallback_bvid: str | None = None,
) -> dict[str, Any]:
    """Search Bilibili city-walk videos and slice official videoshot storyboard grids."""
    bili_dir = out_dir / "bilibili"
    bili_dir.mkdir(parents=True, exist_ok=True)

    try:
        http.get_bytes("https://www.bilibili.com/", timeout=15)
    except Exception:
        pass

    videos: list[dict[str, Any]] = []
    chosen_bvid = fallback_bvid
    chosen_title = ""
    try:
        surl = (
            "https://api.bilibili.com/x/web-interface/search/type"
            f"?search_type=video&keyword={urllib.parse.quote(search_query)}"
        )
        sdata = http.get_json(surl, referer="https://www.bilibili.com/")
        for v in (sdata.get("data", {}).get("result") or [])[:8]:
            clean_title = re.sub(r"<[^>]+>", "", v.get("title", ""))
            videos.append({
                "bvid": v.get("bvid"),
                "title": clean_title,
                "duration": v.get("duration"),
                "author": v.get("author"),
                "play": v.get("play"),
            })
        if not chosen_bvid and videos:
            chosen_bvid = videos[0]["bvid"]
            chosen_title = videos[0]["title"]
    except Exception:
        if not chosen_bvid:
            raise

    if not chosen_bvid:
        return {"status": "no_video", "videos": videos}
    if not re.fullmatch(r'BV[A-Za-z0-9]+', chosen_bvid):
        raise ValueError('invalid BV id')

    # Resolve cid & full title
    view_url = f"https://api.bilibili.com/x/web-interface/view?bvid={chosen_bvid}"
    vinfo = http.get_json(view_url, referer=f"https://www.bilibili.com/video/{chosen_bvid}")
    vdata = vinfo.get("data", {})
    cid = vdata.get("cid")
    chosen_title = vdata.get("title") or chosen_title
    duration_s = int(vdata.get("duration") or 0)

    vs_url = f"https://api.bilibili.com/x/player/videoshot?bvid={chosen_bvid}&cid={cid}&index=1"
    vs = http.get_json(vs_url, referer=f"https://www.bilibili.com/video/{chosen_bvid}")
    smeta = vs.get("data") or {}
    img_urls = smeta.get("image") or []
    x_len = int(smeta.get("img_x_len") or 10)
    y_len = int(smeta.get("img_y_len") or 10)
    idx_times = smeta.get("index") or []

    sheet_paths: list[str] = []
    cells: list[tuple[int, Image.Image]] = []
    from io import BytesIO

    frame_counter = 0
    for idx_i, u in enumerate(img_urls[:3], start=1):
        full_u = "https:" + u if u.startswith("//") else u
        raw = http.get_bytes(full_u, referer=f"https://www.bilibili.com/video/{chosen_bvid}")
        sp = bili_dir / f"{chosen_bvid}_sheet_{idx_i}.jpg"
        sp.write_bytes(raw)
        sheet_paths.append(str(sp))

        with Image.open(BytesIO(raw)) as sheet_im:
            sheet_rgb = sheet_im.convert("RGB")
            cw = sheet_rgb.width // x_len
            ch = sheet_rgb.height // y_len
            stop_sheet = False
            for r in range(y_len):
                for c in range(x_len):
                    if idx_times and frame_counter >= len(idx_times):
                        stop_sheet = True
                        break
                    t_sec = idx_times[frame_counter] if frame_counter < len(idx_times) else frame_counter * 5
                    crop = sheet_rgb.crop((c * cw, r * ch, (c + 1) * cw, (r + 1) * ch))
                    frame_counter += 1
                    if float(np.asarray(crop).mean()) > 18.0:
                        cells.append((int(t_sec), crop))
                if stop_sheet:
                    break

    keyframe_sheet_path = ""
    if cells:
        lo = 0 if len(cells) <= 8 else max(1, int(len(cells) * 0.06))
        hi = max(lo, len(cells) - 1 if len(cells) <= 8 else int(len(cells) * 0.94))
        picks = np.linspace(lo, min(hi, len(cells) - 1), num=min(6, len(cells)), dtype=int)
        panels = []
        for idx_cell in picks:
            t_s, im = cells[int(idx_cell)]
            mm, ss = divmod(t_s, 60)
            panels.append((f"{mm:02d}:{ss:02d} ({chosen_bvid})", im))
        kf_sheet = build_labeled_sheet(
            panels,
            cols=3,
            tile_w=480,
            tile_h=270,
            title=f"B站街景实录抽帧 · {chosen_bvid}（{duration_s // 60}m{duration_s % 60:02d}s，共 {len(cells)} 帧）",
        )
        keyframe_sheet_path = str(bili_dir / f"{chosen_bvid}_keyframes_sheet.jpg")
        kf_sheet.save(keyframe_sheet_path, quality=92)

    return {
        "status": "ok" if cells else "no_videoshot frames",
        "search_query": search_query,
        "selected_video": {
            "bvid": chosen_bvid,
            "cid": cid,
            "title": chosen_title,
            "duration_sec": duration_s,
            "url": f"https://www.bilibili.com/video/{chosen_bvid}",
            "total_frames_in_sheets": len(cells),
            "raw_sheets": sheet_paths,
            "keyframes_sheet": keyframe_sheet_path,
        },
        "top_search_hits": videos[:5],
    }


def channel(fn, *args):
    try:
        result = fn(*args)
        status = result.get('status', 'ok')
        result['status'] = 'ok' if status == 'ok' else 'failed'
        result.setdefault('reason', 'completed' if status == 'ok' else status)
        return result
    except Exception as exc:
        return {'status': 'failed', 'reason': f'{type(exc).__name__}: {exc}'}


def pois(http, query, city_code):
    params = urllib.parse.urlencode({'qt': 's', 'wd': query, 'c': city_code})
    data = http.get_json(f'https://map.baidu.com/?{params}', referer='https://map.baidu.com/')
    items = [{'name': p['name'], 'x': float(p['x'])/100, 'y': float(p['y'])/100}
             for p in (data.get('content') or [])[:12] if p.get('name') and p.get('x') and p.get('y')]
    return {'status': 'ok' if items else 'empty search', 'items': items}


def panorama(http, folder, tag, query, xy, target):
    endpoint = 'https://mapsv0.bdimg.com/?'
    def get(qt, **params):
        try:
            data = http.get_json(endpoint + urllib.parse.urlencode(dict(qt=qt, **params)),
                                 referer='https://map.baidu.com/')
            if not data.get('content'):
                raise ValueError('empty content')
            return data['content']
        except Exception as exc:
            raise ValueError(f'{qt}: {exc}') from exc

    hit = get('qsdata', x=round(xy[0]), y=round(xy[1]), r=300)
    sid = hit['id']
    meta = get('sdata', sid=sid)[0]
    origin = mc_to_wgs(float(meta['X'])/100, float(meta['Y'])/100)
    road, north = meta.get('Rname') or hit.get('RoadName', ''), float(meta['NorthDir'])
    pixels = np.asarray(download_baidu_equirect(http, sid))
    panels = []
    views = {}
    for index, (code, label) in enumerate(zip('NESW', '北东南西')):
        view = equirect_to_rectilinear(pixels, north, index*90)
        path = folder / f'{tag}_{code}.jpg'
        view.save(path, quality=90)
        views[code] = str(path)
        panels.append((f'{label} {index*90}° · {road}', view))
    path = folder / f'{tag}_4views_sheet.jpg'
    sheet = build_labeled_sheet(panels, title=f'{query} · {tag} · {road} · {meta.get("Date", "")}')
    sheet.save(path, quality=90)
    result = dict(sid=sid, wgs84={'lat': origin[0], 'lon': origin[1]}, north_dir_deg=north,
                  road=road, views=views, sheet_file=str(path))
    if target:
        yaw = bearing(origin, target)
        path = folder / f'{tag}_bearing.jpg'
        equirect_to_rectilinear(pixels, north, yaw).save(path, quality=90)
        result['check'] = dict(bearing_deg=yaw, target_wgs84=target, file=str(path))
    return result


def output_dir(name):
    if not re.fullmatch(r'[\w-]{1,80}', name):
        raise ValueError('name must be a single slug (letters, numbers, _ or -)')
    dest = ROOT/'raw'/'refpack'/name
    if dest.resolve() != dest or dest.is_relative_to('/tmp'):
        raise ValueError('output must be inside the repository raw/ directory, not a symlink or /tmp')
    rel = dest.relative_to(ROOT)
    subprocess.run(['git', 'check-ignore', '-q', str(rel/'index.json')], cwd=ROOT, check=True)
    if subprocess.check_output(['git', 'ls-files', '--', str(rel)], cwd=ROOT):
        raise ValueError('output contains tracked files')
    dest.mkdir(parents=True, exist_ok=True)
    return dest


def parse_anchors(spec):
    result = {}
    for part in spec.split(';'):
        tag, offsets = part.split(':')
        dx, dy = map(float, offsets.split(','))
        if not re.fullmatch(r'[\w-]{1,48}', tag) or tag in result or not all(map(math.isfinite, (dx, dy))):
            raise ValueError('invalid or duplicate anchor')
        result[tag] = (dx, dy)
    return result


def main():
    presets = json.loads(Path(__file__).with_name('refpack-presets.json').read_text())
    parser = argparse.ArgumentParser(description='Collect local-only city references.')
    parser.add_argument('--preset', choices=presets)
    parser.add_argument('--name')
    parser.add_argument('--query')
    parser.add_argument('--lat', type=float)
    parser.add_argument('--lon', type=float)
    parser.add_argument('--city', default='桂林')
    parser.add_argument('--city-code', default='142')
    parser.add_argument('--radius', type=int, default=250)
    parser.add_argument('--anchors', help='tag:dx,dy;... (BD Mercator metres)')
    parser.add_argument('--check-bearing', metavar='way/ID|node/ID')
    parser.add_argument('--bvid')
    parser.add_argument('--amap-key', help='reserved; never transmitted')
    args = parser.parse_args()
    preset = presets.get(args.preset, {})
    if (args.lat is None) != (args.lon is None):
        parser.error('provide both --lat and --lon')
    origin = (args.lat, args.lon) if args.lat is not None else (preset.get('lat'), preset.get('lon'))
    query = args.query or preset.get('query')
    if origin[0] is None and not query:
        parser.error('provide coordinates, query or preset')
    if origin[0] is not None and not (0 < origin[0] < 74 and 0 < origin[1] < 180):
        parser.error('expected China-region coordinates')
    if args.radius <= 0 or (args.check_bearing and not re.fullmatch(r'(way|node)/[1-9]\d*', args.check_bearing)):
        parser.error('invalid radius or OSM feature ID')
    name = args.name or args.preset or (re.sub(r'\W+', '-', query) if query else f'point-{origin[0]:.4f}-{origin[1]:.4f}'.replace('.', '_'))
    try:
        anchors = parse_anchors(args.anchors or preset.get('anchors', 'center:0,0'))
        dest = output_dir(name)
    except (ValueError, subprocess.CalledProcessError) as exc:
        parser.error(str(exc))
    folder = Path(tempfile.mkdtemp(prefix='run-', dir=dest)).relative_to(ROOT)
    os.chdir(ROOT)
    http = HttpSession()
    search = query or name.replace('-', ' ')
    search = search if args.city in search else f'{args.city} {search}'
    channels = {'baidu_poi': channel(pois, http, search, args.city_code)}
    if origin[0] is None:
        items = channels['baidu_poi'].get('items', [])
        origin = mc_to_wgs(items[0]['x'], items[0]['y']) if items else None
    missing = {'status': 'failed', 'reason': 'no coordinate or POI anchor'}
    raw = ROOT/'raw'
    channels['overture'] = channel(lambda: {'buildings': cache.overture(raw, origin, args.radius)}) if origin else missing
    osm = channels['osm'] = channel(cache.osm, raw, origin, args.radius, args.check_bearing, http, OVERPASS_ENDPOINTS) if origin else missing
    panoramas = []
    if origin:
        x, y = wgs_to_mc(*origin)
        for tag, (dx, dy) in anchors.items():
            result = channel(panorama, http, folder, tag, query or name, (x+dx, y+dy), osm.get('target_wgs84'))
            panoramas.append(dict(tag=tag, **result))
    errors = [f"{p['tag']}: {p['reason']}" for p in panoramas if p['status'] != 'ok']
    channels['baidu'] = dict(status='failed' if errors or not panoramas else 'ok', panoramas=panoramas,
                             reason='; '.join(errors) or ('completed' if panoramas else missing['reason']))
    if args.check_bearing:
        checked = bool(panoramas) and all('check' in p for p in panoramas)
        channels['bearing'] = dict(status='ok' if checked else 'failed', target=args.check_bearing,
                                   reason='views generated' if checked else 'missing OSM target or panorama')
    channels['wikimedia'] = channel(fetch_wikimedia_channel, http, folder, *origin,
        [search, *preset.get('keywords', [])]) if origin else missing
    channels['bilibili'] = channel(fetch_bilibili_channel, http, folder, search+' 逛街', args.bvid or preset.get('bvid'))
    manifest = dict(query=search, anchor_wgs84=origin, channels=channels)
    index = folder/'index.json'
    index.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    index.replace(dest/'index.json')
    print(dest.relative_to(ROOT)/'index.json')


if __name__ == '__main__':
    main()

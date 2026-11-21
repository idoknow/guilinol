"""Overlay raw OSM on the four overhead screenshots from perf --expansion."""
import gzip
import io
import json
import struct
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageColor
from scipy.spatial import cKDTree
from shapely import STRtree, points as xy_points, distance, union_all
from shapely.geometry import LineString, Polygon, box

from common import OUT, load_osm
from features import area, points, polygons


def wet_cells(raw,x,z):
    wet = np.frombuffer(raw,'<i2',4225,8474).reshape(65,65)!=-32768
    cells = wet[1:,1:]|wet[:-1,1:]|wet[1:,:-1]|wet[:-1,:-1]
    for row in np.flatnonzero(cells.any(axis=1)):
        ends = np.flatnonzero(np.diff(cells[row],prepend=False,append=False))
        for start,stop in ends.reshape(-1,2):
            yield box(x+4*start,z+4*row,x+4*stop,z+4*row+4)


def rendered_edges(world,manifest,roi):
    roads, wet_strips, road_pixels = [], [], []
    road_rgb = ImageColor.getrgb(json.loads(Path(__file__).with_name('palette.json').read_text())['road'])
    for tile in manifest['chunks']:
        x,z = tile['x'],tile['z']
        if not box(x,z,x+256,z+256).intersects(roi):
            continue
        raw = gzip.decompress((world/tile['file']).read_bytes())
        vertices,indices,length,image,decks = struct.unpack_from('<5I',raw,4)
        offset = 24+16900+vertices*9+indices*4
        streets = json.loads(raw[offset:offset+length])[1][0]
        for kind,*rings in streets:
            if kind in (0,1,4,5,6) and len(rings[0])>=3:
                loops = [np.array(ring)/100+[x,z] for ring in rings if len(ring)>=3]
                roads.append(Polygon(loops[0],loops[1:]).buffer(0))
        # Footpaths and service roads also appear as paint in the delivered
        # one-metre tile texture, independently of the GL04 street polygons.
        pixels = np.asarray(Image.open(io.BytesIO(raw[offset+length:offset+length+image])).convert('RGB'))
        rows, cols = np.where((pixels==road_rgb).all(axis=2) | (pixels==[72,75,77]).all(axis=2))
        if len(rows):
            road_pixels.append(np.column_stack((x+cols+.5,z+rows+.5)))
        triangles = np.frombuffer(raw,'<i2',decks*9,offset+length+image).reshape(-1,3,3)
        for tri in triangles:
            face = Polygon(tri[:,::2]/100+[x,z])
            if face.area>0:
                roads.append(face)
        wet_strips.extend(wet_cells(raw,x,z))
    return STRtree(roads),union_all(wet_strips).boundary,cKDTree(np.vstack(road_pixels)) if road_pixels else None


def overlay(directory, name, manifest, heights, features):
    screenshot = Image.open(directory/f'{name}.png').convert('RGBA')
    ink = Image.new('RGBA', screenshot.size)
    draw = ImageDraw.Draw(ink)
    matrix = np.asarray(json.loads((directory/f'{name}.matrix.json').read_text())).reshape(4,4).T
    left, top, _, _ = manifest['extent']
    step = manifest['overview']['step']
    center = np.linalg.inv(matrix) @ [0,0,0,1]
    x, _, z = center[:3]/center[3]
    roi = box(x-1300,z-1300,x+1300,z+1300)
    roads,shore,paint = rendered_edges(Path(OUT),manifest,roi)
    report = []
    for shape, color, ident, kind in features:
        if not shape.intersects(roi):
            continue
        clipped = shape.intersection(roi)
        for line in getattr(clipped,'geoms',[clipped]):
            if line.geom_type != 'LineString' or line.is_empty:
                continue
            coords = np.array(line.segmentize(4).coords)
            east, south = coords.T
            rows = np.clip(np.rint((south-top)/step).astype(int), 0, heights.shape[0]-1)
            cols = np.clip(np.rint((east-left)/step).astype(int), 0, heights.shape[1]-1)
            projected = matrix @ np.stack((east,heights[rows,cols]/10,south,np.ones(len(east))))
            px = (1+projected[0]/projected[3])*screenshot.width/2
            py = (1-projected[1]/projected[3])*screenshot.height/2
            draw.line(list(zip(px,py)),fill=color,width=2)
            visible = (px>=0)&(px<screenshot.width)&(py>=0)&(py<screenshot.height)&(projected[3]>0)
            samples = xy_points(coords[visible])
            if len(samples):
                distances = distance(samples,shore) if kind=='water' else distance(samples,roads.geometries[roads.nearest(samples)])
                if kind!='water' and paint is not None:
                    coordinates = coords[visible]
                    # Distance to the nearest painted pixel square, by center.
                    far = np.flatnonzero(distances>0)
                    if len(far):
                        _,indices = paint.query(coordinates[far])
                        deltas = np.maximum(np.abs(paint.data[indices]-coordinates[far])-.5,0)
                        distances[far] = np.minimum(distances[far],np.linalg.norm(deltas,axis=1))
                maximum = float(np.max(distances))
                in_world = ((east[visible]>=left)&(east[visible]<=left+manifest['extent'][2])&
                            (south[visible]>=top)&(south[visible]<=top+manifest['extent'][3]))
                inside_distances = distances[in_world]
                report.append(dict(outsideWorld=int((~in_world).sum()),
                                   insideExceed=int((inside_distances>2).sum()),
                                   insideMax=round(float(inside_distances.max()),2) if len(inside_distances) else None,
                                   osm=ident,kind=kind,samples=len(samples),exceed=int((distances>2).sum()),
                                   maxMetres=round(maximum,2) if np.isfinite(maximum) else None))
    draw.rectangle((8,8,305,31),fill=(0,0,0,190))
    draw.text((14,13),'OSM   yellow: road axis   cyan: water edge',fill='white')
    Image.alpha_composite(screenshot,ink).convert('RGB').save(directory/f'{name}-osm.png')
    return report


if __name__ == '__main__':
    directory = Path('captures/expansion')
    world = Path(OUT)
    manifest = json.loads((world/'manifest.json').read_text())
    step = manifest['overview']['step']
    heights = np.fromfile(world/manifest['overview']['heights']['file'],'<i2').reshape(-1,manifest['extent'][2]//step+1)
    features = []
    for feature in load_osm():
        tags = feature.get('tags',{})
        ident = f"{feature['type']}/{feature['id']}"
        if feature['type']=='way' and tags.get('highway') and len(points(feature))>=2:
            features.append((LineString(points(feature)), (255,221,51,185),ident,tags['highway']))
        if tags.get('natural')=='water' or tags.get('waterway')=='riverbank' or 'water' in tags:
            for poly in polygons(area(feature)):
                features.extend((LineString(ring),(30,227,255,220),ident,'water') for ring in [poly.exterior,*poly.interiors])
    reports = {name:overlay(directory,name,manifest,heights,features)
               for name in ['balijie','zengpiyan','guilinta','eastBoundary']}
    (directory/'osm-comparison.json').write_text(json.dumps(reports,indent=2)+'\n')

"""OSM ground footprint, Esri upper roof and glazing visible in Rock 06/09."""
import json
import math
import sys
from pathlib import Path

import mapbox_earcut as earcut
import numpy as np
from shapely.geometry import LineString, Polygon

from c_kit import landmark_surface
from nikoniko import export_landmark
from shop_lettering import letters

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from common import ll2xz,load_osm

# Hy1 #2 Guilin drinks corner shop world XZ envelope (back_l, back_r, front_r, front_l)
_DRINKS_CORNERS_WORLD = np.array([
    (-590.90, -65.05),
    (-602.02, -67.53),
    (-599.89, -77.10),
    (-588.76, -74.61),
])


def _polygon_xz(coords):
    poly = Polygon(coords)
    if not poly.is_valid:
        poly = poly.buffer(0)
    return poly


def _add_soffit(model, poly, y, mat='beige'):
    """Downward-facing underside cap for cantilevered 2F+ podium overhang."""
    for geom in getattr(poly, 'geoms', [poly]):
        if geom.is_empty or geom.area < 0.05:
            continue
        outer = np.asarray(geom.exterior.coords[:-1], dtype=np.float64)
        holes = [np.asarray(r.coords[:-1], dtype=np.float64) for r in geom.interiors]
        rings = [outer, *holes]
        pts = np.vstack(rings)
        ends = np.cumsum([len(r) for r in rings], dtype=np.uint32)
        tris = earcut.triangulate_float64(pts, ends).reshape(-1, 3)
        verts = [[float(x), float(y), float(z)] for x, z in pts]
        # Ensure normal points downward (-Y): reverse any upward-pointing triangle
        faces = []
        for a, b, c in tris:
            pa, pb, pc = pts[a], pts[b], pts[c]
            cross_y = (pb[1] - pa[1]) * (pc[0] - pa[0]) - (pb[0] - pa[0]) * (pc[1] - pa[1])
            faces.append([int(a), int(b), int(c)] if cross_y < 0 else [int(a), int(c), int(b)])
        if faces:
            model.mesh(verts, faces, mat, collide=False)


def mall(model):
    model.surface = landmark_surface('wangcheng_mall')
    way = next((item for item in load_osm() if item['type']=='way' and item['id']==264901525), None)
    if way is not None:
        footprint = np.array([ll2xz(v['lat'],v['lon']) for v in way['geometry'][:-1]])
    else:
        gj = json.loads((Path(__file__).resolve().parents[2] / 'docs/layout/zhengyang.geojson').read_text())
        ring = next(f['geometry']['coordinates'][0] for f in gj['features'] if f.get('id') == 'way/264901525')
        footprint = np.array([ll2xz(lat, lon) for lon, lat in ring[:-1]])
    origin = np.array(Polygon(footprint).centroid.coords[0])
    footprint -= origin
    podium = 7.0
    recess_h = 4.8

    # Recess NW 1F podium (y in [0, 4.8]) to clear guilinol-drinks corner shop while keeping
    # [4.8, 7.0] upper podium intact so audit_landmarks 6m footprint slice keeps IoU ~ 1.0.
    mall_poly = _polygon_xz(footprint)
    recess_clear = Polygon(_DRINKS_CORNERS_WORLD - origin).buffer(0.45, join_style=2)
    lower_poly = mall_poly.difference(recess_clear)
    if lower_poly.geom_type == 'MultiPolygon':
        lower_poly = max(lower_poly.geoms, key=lambda g: g.area)
    lower_footprint = np.asarray(lower_poly.exterior.coords[:-1])
    model.prism(lower_footprint, 0, recess_h, 'beige', True, footing=True)
    model.prism(footprint, recess_h, podium - recess_h, 'beige', True, footing=False)
    _add_soffit(model, mall_poly.intersection(recess_clear), recess_h, 'beige')

    # Register the Esri roof's NE corner to the matching OSM corner at grade.
    # The west and south shop wings stop at the podium (IMG_1398).
    roof_ll = [(110.2941945,25.2806334),(110.2946870,25.2805347),
               (110.2945793,25.2801160),(110.2940854,25.2802227)]
    roof = np.array([ll2xz(lat,lon) for lon,lat in roof_ll])
    roof += footprint[1]-roof[1]
    corner = roof[0]
    start = corner + 4*(roof[-1]-corner)/np.linalg.norm(roof[-1]-corner)
    end = corner + 4*(roof[1]-corner)/np.linalg.norm(roof[1]-corner)
    curve = [(1-t)**2*start+2*t*(1-t)*corner+t*t*end for t in np.linspace(0,1,5)]
    tower = np.array([*curve,*roof[1:]])
    height = 36.9
    model.prism(tower,podium,height-podium,'glass',True,cap_mat='alum')
    for a,b in zip(tower,np.roll(tower,-1,axis=0)):
        dx,dz=b-a
        length=math.hypot(dx,dz)
        center=(a+b)/2
        model.pose=(center[0],0,center[1],math.atan2(-dz,dx))
        model.box(0,height,-.1,length,.45,.65,'alum')
        if model.detail:
            for y in np.arange(podium+3.7,height,3.7):
                model.box(0,y,-.08,length,.16,.22,'alum')
            bays=max(1,round(length/2.3))
            for i in range(bays):
                model.box(((i+.5)/bays-.5)*length,podium,-.08,.12,height-podium,.22,'alum')
    for a,b in zip(footprint,np.roll(footprint,-1,axis=0)):
        dx,dz=b-a
        length=math.hypot(dx,dz)
        center=(a+b)/2
        yaw=math.atan2(-dz,dx)
        edge_line=LineString([(float(a[0]),float(a[1])),(float(b[0]),float(b[1]))])
        out_part=edge_line.difference(recess_clear)
        in_part=edge_line.intersection(recess_clear)
        for seg in (out_part.geoms if hasattr(out_part,'geoms') else [out_part]):
            if seg.is_empty or seg.length<0.05: continue
            p0,p1=np.array(seg.coords[0]),np.array(seg.coords[-1])
            sc=(p0+p1)/2
            model.pose=(sc[0],0,sc[1],math.atan2(-(p1[1]-p0[1]),p1[0]-p0[0]))
            model.box(0,4.4,-.16,seg.length,2.25,.38,'red')
        for seg in (in_part.geoms if hasattr(in_part,'geoms') else [in_part]):
            if seg.is_empty or seg.length<0.05: continue
            p0,p1=np.array(seg.coords[0]),np.array(seg.coords[-1])
            sc=(p0+p1)/2
            model.pose=(sc[0],0,sc[1],math.atan2(-(p1[1]-p0[1]),p1[0]-p0[0]))
            model.box(0,recess_h+.02,-.16,seg.length,6.65-(recess_h+.02),.38,'red')
        model.pose=(center[0],0,center[1],yaw)
        if length>30:
            letters(model,"KING'S PLAZA",(0,4.85,-.38),min(20,length*.6),1.45,'white',-1)
    a,b=end,roof[1]
    center=(a+b)/2
    model.pose=(center[0],0,center[1],math.atan2(a[1]-b[1],b[0]-a[0]))
    letters(model,'王城商厦',(0,height+.20,-.25),19,2.3,'red',-1)
    model.pose=(0,0,0,0)


if __name__=='__main__':export_landmark('wangcheng_mall',mall)

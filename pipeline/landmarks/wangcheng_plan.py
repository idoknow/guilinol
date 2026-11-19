"""Place Wangcheng architecture in the palace GLB's rotated local frame."""
import json
import math
import sys
from pathlib import Path

import numpy as np
import trimesh
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import unary_union

from shop_lettering import letters
from c_kit import landmark_surface

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "pipeline"))
from common import ll2xz


class PalacePlan:
    def __init__(self):
        entry = next(e for e in json.loads((ROOT / "pipeline/landmarks.json").read_text()) if e["id"] == "jingjiang")
        origin = np.asarray(ll2xz(*reversed(entry["anchor"])))
        angle = math.radians(entry["rotation"])
        c, s = math.cos(angle), math.sin(angle)
        inverse = np.array([[c, -s], [s, c]])
        self.surface = landmark_surface('jingjiang')
        features = json.loads((ROOT / "docs/layout/wangcheng.geojson").read_text())["features"]
        self.shapes = {}
        for feature in features:
            if "osm" not in feature["properties"]:
                continue
            geom = feature["geometry"]
            coords = geom["coordinates"]
            if geom["type"] == "Point":
                coords = [coords]
            elif geom["type"] == "Polygon":
                coords = coords[0]
            points = [inverse @ (ll2xz(lat, lon) - origin) for lon, lat in coords]
            construct = {"Point": lambda pts: Point(pts[0]), "Polygon": Polygon, "LineString": LineString}
            key = int(feature["properties"]["osm"].split("/")[-1])
            self.shapes[key] = construct[geom["type"]](points)

    def ground(self,x,z):
        return self.surface.ground(x,z)

    def frame(self, key):
        rect = self.shapes[key].minimum_rotated_rectangle
        x, z = rect.centroid.coords[0]
        edges = np.diff(rect.exterior.coords, axis=0)
        sizes = np.linalg.norm(edges, axis=1)
        axis = edges[sizes.argmax()]
        angle = math.atan2(axis[1], axis[0]) % math.pi
        if angle > math.pi / 2:
            angle -= math.pi
        return x, z, angle, sizes.max(), sizes.min()


def enclosure(m, plan):
    gates = [1008248059, 1008248057, 684987708, 885083143]
    gaps = unary_union([plan.shapes[k].buffer(.25) for k in gates])
    segments = plan.shapes[258909996].difference(gaps)
    for line in segments.geoms:
        for a, b in zip(line.coords, list(line.coords)[1:]):
            dx, dz = np.subtract(b, a)
            width = math.hypot(dx, dz)
            count = math.ceil(width/5)
            for i in range(count):
                t = (i+.5)/count
                x,z = a[0]+t*dx, a[1]+t*dz
                m.pose = (x,plan.ground(x,z),z,math.atan2(dz,dx))
                m.foundation(plan.surface,0,-2,0,width/count+.12,8.5,5,'stone')
                if m.detail:
                    m.box(0,6.5,0,min(2.7,width/count),1.1,1,'stone')
    for key, plaque in zip(gates[1:], ['状元及第','榜眼及第','后贡门']):
        x,z,angle,w,d = plan.frame(key)
        # Inner face looks into the enclosure.
        if (-x)*(-math.sin(angle)) + (-260-z)*math.cos(angle) < 0:
            angle += math.pi
        m.pose = (x,plan.ground(x,z),z,angle)
        m.arcade(0,0,w,d,6.8,[0],min(w*.23,3.2),'stone')
        m.box(0,6.8,0,w,1.1,d,'brick')
        m.box(0,5.6,d/2,5.6,1.1,.4,'granite')
        letters(m,plaque,(0,5.8,d/2+.22),4.4,.65,'wood')
    m.pose = (0,0,0,0)


def inner_court(m, plan):
    for key, base, height in [(679734442,2,7.2),(679734417,.65,7.8)]:
        x,z,angle,width,depth = plan.frame(key)
        m.pose = (x,plan.ground(x,z),z,angle)
        m.box(0,0,0,width+1.8,base,depth+2,'white' if key==679734442 else 'granite',True)
        if key==679734442:
            m.box(0,base,0,width-6,height,depth-6,'red',True)
            m.tiled_roof(0,base+height,0,width+2,depth+2,6.7)
            m.box(0,base+3.4,depth/2-1.8,width-4,.42,2.5,'white')
            for east in np.linspace(-width*.44,width*.44,33):
                m.box(east,base+3.8,depth/2-.7,.14,1,.14,'white')
            m.box(0,base+4.72,depth/2-.7,width*.9,.14,.2,'white')
            for east in np.linspace(-width*.38,width*.38,9):
                m.box(east,base+.75,depth/2-2.92,2.8,4.6,.22,'wood')
                if m.detail:
                    for bar in (-.9,-.3,.3,.9):
                        m.box(east+bar,base+2.7,depth/2-2.75,.10,2.5,.14,'red')
        else:
            m.box(0,base,0,width-4,height,depth-5,'yellow',True)
            m.swept_roof(0,base+height,0,width,depth,3.4)
        for side in (-1,1):
            for col in np.linspace(-width*.44,width*.44,9):
                m.beam([col,base,side*(depth/2-1)],[col,base+height,side*(depth/2-1)],.32,'red',8,True)
        if key==679734442:
            for step in range(10):
                m.box(0,0,depth/2+1+(9-step)*.52,12,(step+1)*base/10,.55,'granite',True)
            foot, head = depth/2+5.9, depth/2+1
            m.mesh([[-1.2,.25,foot],[1.2,.25,foot],[1.2,2.18,head],[-1.2,2.18,head]],
                   [[0,1,2],[0,2,3]],'white',True)
            if m.detail:
                for step in range(8):
                    z0 = foot+(head-foot)*step/8
                    y0 = .29+1.93*step/8
                    m.beam([-.8,y0,z0],[0,y0+.12,z0-.2],.065,'granite')
                    m.beam([0,y0+.12,z0-.2],[.8,y0,z0],.065,'granite')
            for side in (-1,1):
                rail_width=width/2-6
                m.box(side*(6+rail_width/2),base+.85,depth/2+.65,rail_width,.2,.28,'white')
                for east in np.arange(6,width/2,2):
                    m.box(side*east,base,depth/2+.65,.32,1.15,.32,'white')
    # The Gongyuan POI is just east of this roof. The bay divisions are estimated.
    x,z,angle,width,depth = plan.frame(1471532482)
    m.pose = (x,plan.ground(x,z),z,angle)
    m.box(0,-.3,0,width,.6,depth,'stone',True)
    m.box(0,.3,-depth*.43,width,3.1,.5,'white',True)
    m.swept_roof(0,3.45,0,width,depth,1.9)
    for east in np.linspace(-width*.48,width*.48,11):
        m.box(east,.3,-depth*.1,.22,2.65,depth*.7,'wood',True)
        m.beam([east,.3,depth*.4],[east,3.45,depth*.4],.14,'red',8,True)
    m.box(0,2.55,depth*.42,4.4,.85,.22,'sign')
    letters(m,'广西贡院',(0,2.69,depth*.42+.12),3.6,.55,'gold')
    x,z = plan.shapes[5981119756].coords[0]
    m.pose=(x,plan.ground(x,z),z,0)
    for width,base,height in [(4.6,0,.45),(3.8,.45,.45),(2.5,.9,1.2),(1.15,2.1,5.2)]:
        m.box(0,base,0,width,height,width,'granite',True)
    m.pose=(0,0,0,0)
    for key in (5981119755,6364816780):
        x,z = plan.shapes[key].coords[0]
        m.pose = (x,plan.ground(x,z),z,0)
        m.box(0,-.4,0,5,.8,5,'stone',True)
        for east in (-1.8,1.8):
            for south in (-1.8,1.8):
                m.beam([east,.4,south],[east,3.6,south],.18,'red',8,True)
        m.swept_roof(0,3.6,0,5.9,5.9,1.8)
    x,z = plan.shapes[14088892740].coords[0]
    m.pose = (x,plan.ground(x,z),z,0)
    crown = trimesh.creation.icosphere(subdivisions=int(m.detail))
    for side in (-1,1):
        m.beam([side*.8,0,0],[side*1.7,6.2,.5],.68,'wood',8,True)
        m.mesh(crown.vertices*[4.3,3.6,4.5]+[side*2.1,7.8,.5],crown.faces,'leaf')
    m.pose = (0,0,0,0)

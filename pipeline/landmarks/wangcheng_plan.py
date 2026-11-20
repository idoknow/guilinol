"""Place Wangcheng architecture in the palace GLB's rotated local frame."""
import json
import math
import sys
from functools import cached_property
from pathlib import Path

import numpy as np
import trimesh
from shapely.geometry import LineString, Point, Polygon, box
from shapely.ops import substring, unary_union
from shapely.affinity import affine_transform

from shop_lettering import letters
from c_kit import landmark_surface

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "pipeline"))
from common import ll2xz, load_osm


class PalacePlan:
    def __init__(self):
        entry = next(e for e in json.loads((ROOT / "pipeline/landmarks.json").read_text()) if e["id"] == "jingjiang")
        origin = np.asarray(ll2xz(*reversed(entry["anchor"])))
        angle = math.radians(entry["rotation"])
        c, s = math.cos(angle), math.sin(angle)
        inverse = np.array([[c, -s], [s, c]])
        self.world_to_local = [c,-s,s,c,*(-inverse@origin)]
        snapshot = {way['id']:way for way in load_osm() if way['type']=='way'}
        route = snapshot[1008909371]
        assert route['tags']['layer']=='1'
        self.walk = LineString([inverse @ (ll2xz(node['lat'],node['lon'])-origin) for node in route['geometry']])
        peace_lane=snapshot[265415873]
        shared=peace_lane['nodes'].index(route['nodes'][-1])
        approach=peace_lane['geometry'][shared:shared+2]
        self.west_approach=LineString([inverse@(ll2xz(node['lat'],node['lon'])-origin) for node in approach])
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

    @cached_property
    def streets(self):
        from shizijie_layout import surfaces
        pavement, sidewalk = surfaces('jingjiang',650)
        return affine_transform(pavement.union(sidewalk),[*self.world_to_local[:4],0,0]).buffer(.15)

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

    def side_portal(self, x, z, angle, width, depth):
        c, s = math.cos(angle), math.sin(angle)
        road = affine_transform(self.streets, [c,s,-s,c,-c*x-s*z,s*x-c*z])
        initial = min(width*.23,3.2)
        for extra in np.arange(0, 5.01, .25):
            span = width/2+extra
            radius = initial if not extra else span-2
            for length in np.arange(depth, 2.95, -.25):
                for offset in np.linspace(-(depth-length)/2,(depth-length)/2,1+math.ceil((depth-length)/.25)):
                    near, far = offset-length/2, offset+length/2
                    if not any(road.intersects(box(left, near, right, far)) for left,right in [(-span,-radius),(radius,span)]):
                        return offset,2*span,length,radius
        raise ValueError('No supported gate fits the rendered road edges')


def access_frame(plan, station):
    center = np.asarray(plan.walk.interpolate(station).coords[0])
    tangent = np.subtract(plan.walk.interpolate(station+.05).coords[0], plan.walk.interpolate(station-.05).coords[0])
    tangent /= np.linalg.norm(tangent)
    return center, tangent, np.array([-tangent[1],tangent[0]])


def access_flights(plan):
    service = plan.walk.project(Point(plan.walk.coords[3]))
    return [(12., 29.), (service-5., service-22.)]


def wall_access(model, plan):
    first_triangle_group = len(model.solid)
    for foot, head in access_flights(plan):
        center, tangent, outward = access_frame(plan, head)
        sign = np.sign(head-foot)
        length = abs(head-foot)
        foot_center = center + 3.48*outward-sign*length*tangent
        bottom = plan.ground(*foot_center)
        top = plan.ground(*center)+6.5
        count = math.ceil((top-bottom)/.16)
        for index in range(count+1):
            width = length/count if index<count else 2.
            along = (index+.5)*width-length if index<count else 1.
            tread = bottom+(top-bottom)*min(index+1,count)/count
            pos = center+sign*along*tangent+3.48*outward
            model.pose = (pos[0],0,pos[1],math.atan2(tangent[1],tangent[0]))
            model.foundation(plan.surface,0,tread-1,0,width,1,2.,'stone')
    head,tangent,outward=access_frame(plan,plan.walk.length-36.8)
    toe=head+2.6*tangent+11.4*outward
    bottom=plan.ground(*toe)
    top=plan.ground(*head)+6.5
    for flight,(across,start_offset,end_offset) in enumerate([(2.6,11.4,3.8),(1.3,3.8,10.1),(0,10.1,3.8)]):
        start=head+across*tangent+start_offset*outward
        finish=head+across*tangent+end_offset*outward
        low=bottom+(top-bottom)*flight/3
        high=bottom+(top-bottom)*(flight+1)/3
        direction=finish-start
        count=math.ceil((high-low)/.16)
        for index in range(count):
            pos=start+direction*(index+.5)/count
            tread=low+(high-low)*(index+1)/count
            model.pose=(pos[0],0,pos[1],math.atan2(direction[1],direction[0]))
            model.foundation(plan.surface,0,tread-1,0,np.linalg.norm(direction)/count,1,1.3,'stone')
        width=2.6 if flight<2 else 1.3
        pos=finish+(0 if flight==2 else -.65)*tangent+np.sign(end_offset-start_offset)*.66*outward
        model.pose=(pos[0],0,pos[1],math.atan2(tangent[1],tangent[0]))
        model.foundation(plan.surface,0,high-1,0,width,1,1.32,'stone')
    model.pose = (0,0,0,0)
    model.stair_collision = model.solid[first_triangle_group:]
    del model.solid[first_triangle_group:]


def wall_parapets(model, start, end, low, high, station, courtyard, openings):
    template = trimesh.creation.box()
    along, vertical, across = (template.vertices + .5).T
    for side in (0, 1):
        opposite = 1 - side
        exterior = np.dot(courtyard-start[side], start[side]-start[opposite]) < 0
        if exterior and any(left < station < right for left,right in openings):
            continue
        fraction = across if side == 0 else 1-across
        inset = fraction[:, None] * (.48 / 5)
        near = start[side] + inset * (start[opposite]-start[side])
        far = end[side] + inset * (end[opposite]-end[side])
        outline = near + along[:, None] * (far-near)
        height = (1.1 if station % 4 < 2 else .52) if exterior else .72
        altitude = low + along*(high-low) + vertical*height
        model.mesh(np.column_stack((outline[:,0], altitude, outline[:,1])), template.faces, 'stone', True)


def wall_walk(model, plan, gates):
    """Use one ribbon with shared edge stations through the turn, not overlapping boxes."""
    axis = plan.walk
    openings = [sorted((head,head+np.sign(head-foot)*2)) for foot,head in access_flights(plan)]
    openings.append((axis.length-37.45,axis.length-36.15))
    stations = sorted(set([axis.project(Point(vertex)) for vertex in axis.coords]
                          + list(np.arange(0,axis.length,1.0)) + [edge for opening in openings for edge in opening]))
    courtyard = np.asarray(plan.shapes[258909996].centroid.coords[0])
    sections = []
    for station in stations:
        center = np.array(axis.interpolate(station).coords[0])
        delta = np.subtract(axis.interpolate(min(axis.length,station+.05)).coords[0],
                            axis.interpolate(max(0,station-.05)).coords[0])
        normal = np.array([-delta[1],delta[0]])/np.linalg.norm(delta)
        height = plan.ground(*center)+6.5
        if station==0: center-=.10*delta/np.linalg.norm(delta)
        if station==axis.length: center+=.10*delta/np.linalg.norm(delta)
        sides = [center+offset*normal for offset in (-2.5,2.5)]
        sections.append((sides,height))
    for index, ((start,low),(end,high)) in enumerate(zip(sections,sections[1:])):
        center = axis.interpolate((stations[index]+stations[index+1])/2)
        footprint = Polygon([start[0],start[1],end[1],end[0]])
        over_gate = gates.covers(center) or plan.streets.intersects(footprint)
        vertices = []
        for sides,top in ((start,low),(end,high)):
            for east,south in sides:
                vertices.extend([(east,top,south),(east,top-.3 if over_gate else plan.ground(east,south)-.04,south)])
        faces = [[0,2,4],[4,2,6],[1,0,5],[5,0,4],[2,3,6],[6,3,7]]
        if index==0: faces.extend([[0,1,2],[2,1,3]])
        if index==len(sections)-2: faces.extend([[5,4,7],[7,4,6]])
        rise=high-low
        run=stations[index+1]-stations[index]
        wall_parapets(model, start, end, low, high, (stations[index]+stations[index+1])/2, courtyard, openings)
        if abs(rise)>.40*run:
            sections_count=math.ceil(abs(rise)/.16)
            endpoints=np.asarray(vertices).reshape(2,4,3)
            for step in range(sections_count):
                segment=np.array([endpoints[0]+(endpoints[1]-endpoints[0])*fraction/sections_count
                                  for fraction in (step,step+1)])
                segment[:,[0,2],1]=low+rise*(step+.5)/sections_count
                model.mesh(segment.reshape(-1,3),faces[:6]+[[0,1,2],[2,1,3],[5,4,7],[7,4,6]],'stone',True)
        else:
            model.mesh(vertices,faces,'stone',True)
        if over_gate and not gates.covers(center):
            from features import polygons
            for support in polygons(footprint.difference(plan.streets)):
                if support.area<.01:continue
                prism=trimesh.creation.extrude_polygon(support,1,engine='earcut')
                coords=prism.vertices[:,[0,2,1]].copy()
                for vertex in coords:
                    vertex[1]=plan.ground(vertex[0],vertex[2])+(6.25 if vertex[1]>.5 else -.04)
                model.mesh(coords,prism.faces[:,::-1],'stone',True)


def enclosure(m, plan):
    gates = [1008248059, 1008248057, 684987708, 885083143]
    gaps = unary_union([plan.shapes[k].buffer(.25) for k in gates])
    boundary = plan.shapes[258909996]
    first,last = [Point(plan.walk.coords[index]) for index in (0,-1)]
    start,end = boundary.project(first),boundary.project(last)
    assert start < end
    retained = [substring(boundary,0,start),substring(boundary,end,boundary.length)]
    joins = [LineString([boundary.interpolate(distance),point]) for distance,point in ((start,first),(end,last))]
    wall_walk(m,plan,gaps.buffer(2.5))
    wall_access(m,plan)
    segments = unary_union(retained+joins).difference(gaps)
    for line in segments.geoms:
        for a, b in zip(line.coords, list(line.coords)[1:]):
            dx, dz = np.subtract(b, a)
            width = math.hypot(dx, dz)
            count = math.ceil(width/5)
            for i in range(count):
                t = (i+.5)/count
                x,z = a[0]+t*dx, a[1]+t*dz
                direction=np.array([dx,dz])/width
                cross=np.array([-direction[1],direction[0]])
                center=np.array([x,z]); half=(width/count+.12)/2
                outline=Polygon([center+p*direction+q*cross for p,q in ((-half,-2.5),(half,-2.5),(half,2.5),(-half,2.5))])
                if plan.streets.intersects(outline):
                    from features import polygons
                    m.pose=(0,0,0,0)
                    for piece in polygons(outline.difference(plan.streets)):
                        if piece.area<.01:continue
                        prism=trimesh.creation.extrude_polygon(piece,1,engine='earcut')
                        coords=prism.vertices[:,[0,2,1]].copy()
                        for vertex in coords:
                            vertex[1]=plan.ground(x,z)+6.5 if vertex[1]>.5 else plan.ground(vertex[0],vertex[2])-.04
                        m.mesh(coords,prism.faces[:,::-1],'stone',True)
                    continue
                m.pose = (x,plan.ground(x,z),z,math.atan2(dz,dx))
                m.foundation(plan.surface,0,-2,0,width/count+.12,8.5,5,'stone')
                if m.detail:
                    m.box(0,6.5,0,min(2.7,width/count),1.1,1,'stone')
    for key, plaque in zip(gates[1:], ['状元及第','榜眼及第','后贡门']):
        x,z,angle,w,d = plan.frame(key)
        # Inner face looks into the enclosure.
        if (-x)*(-math.sin(angle)) + (-260-z)*math.cos(angle) < 0:
            angle += math.pi
        radius = min(w*.23,3.2)
        if key in (1008248057,684987708):
            offset,w,d,radius = plan.side_portal(x,z,angle,w,d)
            x,z = x-offset*math.sin(angle),z+offset*math.cos(angle)
        m.pose = (x,plan.ground(x,z),z,angle)
        m.arcade(0,0,w,d,6.8,[0],radius,'stone',surface=plan.surface)
        m.box(0,6.8,0,w,1.1,d,'brick')
        m.box(0,5.6,d/2,5.6,1.1,.4,'granite')
        letters(m,plaque,(0,5.8,d/2+.22),4.4,.65,'wood')
    m.pose = (0,0,0,0)


def inner_court(m, plan):
    for key, base, height in [(679734442,2,7.2),(679734417,.65,7.8)]:
        x,z,angle,width,depth = plan.frame(key)
        m.pose = (x,plan.ground(x,z),z,angle)
        m.foundation(plan.surface,0,0,0,width+1.8,base,depth+2,'white' if key==679734442 else 'granite')
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
            m.box(0,base+height-.16,0,width,.35,depth,'wood')
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
    m.foundation(plan.surface,0,-.3,0,width,.6,depth,'stone')
    m.box(0,.3,-depth*.43,width,3.1,.5,'white',True)
    m.box(0,3.31,0,width,.31,depth,'wood')
    m.swept_roof(0,3.45,0,width,depth,1.9)
    for east in np.linspace(-width*.48,width*.48,11):
        m.box(east,.3,-depth*.1,.22,2.65,depth*.7,'wood',True)
        m.beam([east,.3,depth*.4],[east,3.45,depth*.4],.14,'red',8,True)
    m.box(0,2.55,depth*.42,4.4,1.02,.24,'sign')
    for ex in (-1.6,1.6):m.box(ex,3.35,depth*.42,.14,.35,.16,'wood')
    letters(m,'广西贡院',(0,2.69,depth*.42+.12),3.6,.55,'gold')
    x,z = plan.shapes[5981119756].coords[0]
    m.pose=(x,plan.ground(x,z),z,0)
    for width,base,height in [(4.6,0,.45),(3.8,.45,.45),(2.5,.9,1.2),(1.15,2.1,5.2)]:
        m.box(0,base,0,width,height,width,'granite',True)
    m.pose=(0,0,0,0)
    for key in (5981119755,6364816780):
        x,z = plan.shapes[key].coords[0]
        m.pose = (x,plan.ground(x,z),z,0)
        m.foundation(plan.surface,0,-.4,0,5,.8,5,'stone')
        for east in (-1.8,1.8):
            for south in (-1.8,1.8):
                m.beam([east,.4,south],[east,3.6,south],.18,'red',8,True)
        m.box(0,3.48,0,5.9,.25,5.9,'wood')
        m.swept_roof(0,3.6,0,5.9,5.9,1.8)
    x,z = plan.shapes[14088892740].coords[0]
    m.pose = (x,plan.ground(x,z),z,0)
    crown = trimesh.creation.icosphere(subdivisions=int(m.detail))
    for side in (-1,1):
        m.beam([side*.8,0,0],[side*1.7,6.2,.5],.68,'wood',8,True)
        m.mesh(crown.vertices*[4.3,3.6,4.5]+[side*2.1,7.8,.5],crown.faces,'leaf')
    m.pose = (0,0,0,0)

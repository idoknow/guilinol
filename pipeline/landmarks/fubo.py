"""OSM peak 1618571712 (213 m), park 485320268. East face on the Li.
Mount follows the actual PK02 summit and east flank. Shore galleries and
the pearl cave are approximations from visitor-scale references (~3 m clear).
"""
import gzip
import json
import math
import sys
from pathlib import Path

import numpy as np
from shapely.geometry import LineString, Point
from shapely.ops import nearest_points
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from common import load_osm
from features import area, points

from xiaoyao_tower import generate
from c_kit import landmark_surface


def mountain(name):
    root=Path(__file__).resolve().parents[2]/'public/world'
    manifest=json.loads((root/'manifest.json').read_text())
    peak=next(entry for entry in manifest['peaks']['entries'] if entry['name']==name)
    # PK02 vertices are relative to the peak center. The GLB is mounted at
    # its landmark anchor, which can be tens of metres away from the summit.
    surface=landmark_surface({'伏波山':'fubo','明月峰':'diecai'}[name])
    lod=peak['lods'][0];payload=gzip.decompress((root/manifest['peaks']['file']).read_bytes())
    vertices=np.frombuffer(payload,'<i2',lod['vertices']*3,lod['offset']).reshape(-1,3)/100
    vertices += np.subtract(peak['center'],[surface.x,surface.y,surface.z])
    if 'outlineVertices' in peak:
        return vertices[:peak['outlineVertices']],vertices[vertices[:,1].argmax()]
    return vertices[:-1].reshape(12,-1,3),vertices[-1]


def pavilion(model,width,height,surface):
    x,y,z,_ = model.pose
    half = (width+1.5)/2
    corners = [(-half,-half),(half,-half),(half,half),(-half,half)]
    foot = [(dx,surface.ground(x+dx,z+dz)-y-.04,dz) for dx,dz in corners]
    top = [(dx,.1,dz) for dx,dz in corners]
    model.mesh(top, [[0,2,1],[0,3,2]], 'pave', True)
    for i in range(4):
        j = (i+1)%4
        model.mesh([foot[i],top[i],top[j],foot[j]],[[0,1,2],[0,2,3]],'granite',True)
    for side in (-1,1):
        for end in (-1,1):
            east,south=side*width*.38,end*width*.38
            model.beam([east,.1,south],[east,height,south],.21,'red',8 if model.detail else 4,True)
            if model.detail:
                for tier in range(3):model.box(east,height-.65+tier*.21,south,.48+tier*.35,.2,.52+tier*.32,'wood')
        model.box(0,height-.35,side*width*.38,width-.5,.38,.38,'red')
    model.box(0,height-.19,0,width+1.8,.22,width+1.8,'wood')
    model.swept_roof(0,height,0,width+1.8,width+1.8,width*.3)


def grotto(model,half,height,depth):
    sections=32 if model.detail else 8
    for index in range(sections):
        angles=np.pi*np.array([index,index+1])/sections
        points=[]
        for back in (0,depth):
            for radius in (1,1.55):
                for angle in angles:
                    rough=.12*math.sin(7*angle+back*.13)
                    points.append([half*radius*math.cos(angle),height*radius*math.sin(angle)+rough,back])
        model.mesh(points,[[0,1,3],[0,3,2],[4,7,5],[4,6,7],[0,4,5],[0,5,1],[2,3,7],[2,7,6]],'stone',True)
    model.box(0,-.3,depth*.5,half*2+.5,.3,depth+2,'pave',True)


def stair_flight(model,surface):
    """Stone treads on the climbing section, with risers bearing on GL04."""
    from fubo_site import fubo_site
    site = fubo_site(-50.92)
    line = site.steps
    model.pose = (0,0,0,0)
    pairs = []
    # Keep joints at OSM corners and share vertices between neighbouring treads.
    cumulative = 0.
    for a,b in zip(line.coords,list(line.coords)[1:]):
        length = np.linalg.norm(np.subtract(b,a))
        count = int(np.ceil(length/.47))
        for station in cumulative+np.arange(count)*length/count:
            p = line.interpolate(station)
            tangent = np.subtract(line.interpolate(min(line.length,station+.28)).coords[0],
                                  line.interpolate(max(0,station-.28)).coords[0])
            normal = np.array([-tangent[1],tangent[0]])/np.linalg.norm(tangent)
            strip = np.array(p.coords[0])+np.array([-1.,0.,1.])[:,None]*normal
            strip -= [surface.x,surface.z]
            pairs.append([(x,surface.ground(x,z),z) for x,z in strip])
        cumulative += length
    for a,b in zip(pairs,pairs[1:]):
        for side in (0,1):
            ground = np.array([a[side],a[side+1],b[side+1],b[side]])
            top = ground.copy()
            top[:,1] += .035
            for i,j in ((0,3),(1,2)):
                lower,upper = (i,j) if top[i,1]<top[j,1] else (j,i)
                top[lower,1] += min(.10,top[upper,1]-top[lower,1])
            ground[:,1] -= .04
            model.mesh(np.vstack([top,ground]),
                       [[0,1,2],[0,2,3],[0,5,1],[0,4,5],[1,6,2],[1,5,6],
                        [2,7,3],[2,6,7],[3,4,0],[3,7,4]],'granite',False)


def build(model):
    surface=landmark_surface('fubo')
    stair_flight(model,surface)
    rings,tip=mountain('伏波山');model.pose=(*tip,0);pavilion(model,5.2,3.6,surface)
    base=rings[rings[:,0].argmax()] if rings.ndim==2 else rings[1,0]
    elements = load_osm()
    river = area(next(e for e in elements if e['id']==2339020 and e['type']=='relation'))
    park = area(next(e for e in elements if e['id']==485320268))
    shore = park.boundary.intersection(river.boundary)
    mouth = Point(surface.x+base[0],surface.z+base[2])
    bank = nearest_points(mouth,shore)[1]
    # Use a straight run along the bank tangent, set on piles outside the
    # rock and the mapped stairway. A single deck level joins all spans.
    bankline = max((LineString([a,b]) for a,b in zip(park.exterior.coords, list(park.exterior.coords)[1:])
                    if shore.covers(LineString([a,b]))),
                   key=lambda edge: -edge.distance(bank))
    forward = np.diff(np.array(bankline.coords),axis=0)[0]
    forward /= np.linalg.norm(forward)
    if forward[1]<0:
        forward *= -1
    normal = np.array([forward[1],-forward[0]])
    center = np.array(bank.coords[0])+normal*4
    dry_paths = [LineString(points(e)) for e in elements if e['type']=='way'
                 and e.get('tags',{}).get('highway') and len(points(e))>1
                 and park.distance(LineString(points(e)))<5]
    def local(along,across):
        return center+forward*along+normal*across-[surface.x,surface.z]
    # Include both pile lines and the overhanging deck in the clearance.
    for shift in range(25):
        deck = LineString([center-19*forward,center+19*forward]).buffer(2)
        if river.covers(deck) and all(deck.distance(path)>2 for path in dry_paths):
            break
        center += normal
    else:
        raise ValueError('No clear riverside boardwalk alignment')
    def platform(along,across):
        x,z=local(along,across)
        ground,water=surface.sample(x,z)
        return x,max(ground,water if water is not None else ground)+.2,z
    x,y,z=platform(0,-1)
    model.pose=(x,y,z,0)
    model.foundation(surface,0,0,0,1.2,3.5,1.2,'granite')
    x,y,z=platform(14,-7)
    model.pose=(x,y,z,0);pavilion(model,6.4,4,surface)
    x,y,z=platform(30,-8)
    model.pose=(x,y,z,0)
    model.arcade(0,0,14,2.7,4.3,[0],2.3,'brick',surface)
    model.box(0,4.25,0,16,.22,5,'wood');model.swept_roof(0,4.45,0,16,5,2.1)
    model.box(0,3.35,1.45,2.6,.68,.14,'sign')
    level = max(platform(station,edge)[1] for station in range(-19,20) for edge in (-1.7,1.7))+.65
    yaw = math.atan2(-forward[0],forward[1])
    for station in range(-18,19,2):
        x,z=local(station,0)
        model.pose=(x,level,z,yaw)
        model.box(0,-.34,0,3.25,.34,2.01,'wood',True)
        model.box(1.49,0,0,.14,1.08,.14,'red',True)
        model.box(1.49,.98,0,.14,.14,2.05,'wood',True)
        for side in (-1,1):
            model.foundation(surface,side*1.25,-.40,0,.42,.12,.42,'wood')
        if model.detail:
            for offset in np.linspace(-.88,.88,8):
                model.box(0,0,offset,3.25,.06,.22,'wood')
                model.box(1.49,.12,offset,.065,.82,.065,'red')


if __name__=='__main__':generate('fubo',build,'F')

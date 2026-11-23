"""OSM airfield surfaces and buildings in the Liangjiang aerodrome."""
from shapely.geometry import LineString, Point
from shapely.ops import unary_union
from shapely import intersects_xy
import numpy as np

from common import GRID, load_osm
from features import area, points


def airfield():
    elements=load_osm()
    boundary=next((area(e) for e in elements if e['type']=='relation' and e['id']==13846706),None)
    if boundary is None:
        return None, []
    paved=[]
    buildings=[]
    passages=[]
    for element in elements:
        if element['type']!='way':
            continue
        tags=element.get('tags',{})
        kind=tags.get('aeroway')
        if tags.get('highway') and (tags.get('covered')=='yes' or tags.get('tunnel')=='building_passage'):
            coords=points(element)
            if len(coords)>=2:
                line=LineString(coords)
                if boundary.intersects(line):
                    passages.append(line.buffer(6))
        if not tags.get('building') and kind not in ('runway','apron','taxiway'):
            continue
        polygon=area(element)
        if polygon.is_empty and kind in ('runway','taxiway'):
            coords=points(element)
            if len(coords)<2:
                continue
            width=tags.get('width','45' if kind=='runway' else '23').split()[0]
            polygon=LineString(coords).buffer(float(width)/2,cap_style='flat')
        if polygon.is_empty or not boundary.intersects(polygon):
            continue
        if tags.get('building'):
            buildings.append((element,polygon))
        else:
            paved.append(polygon)
    passages=unary_union(passages)
    return unary_union(paved), [(element,polygon,polygon.difference(passages)) for element,polygon in buildings]


def level_pavement(pavement, terrain, original, left, top):
    if pavement is None or pavement.is_empty:
        return
    x0,z0,x1,z1=pavement.bounds
    cols=np.arange(max(0,int((x0-left)//GRID)), min(terrain.shape[1],int((x1-left)//GRID)+2))
    rows=np.arange(max(0,int((z0-top)//GRID)), min(terrain.shape[0],int((z1-top)//GRID)+2))
    if not cols.size or not rows.size:
        return
    mask=intersects_xy(pavement,left+cols[None,:]*GRID,top+rows[:,None]*GRID)
    rr,cc=np.nonzero(mask)
    if rr.size:
        target=int(np.median(original[rows[rr],cols[cc]]))
        terrain[rows[rr],cols[cc]]=original[rows[rr],cols[cc]]=target


def clear_pavement_trees(records, origin, pavement):
    rows = np.frombuffer(records, dtype='<u2').reshape(-1,6)
    keep = ~intersects_xy(pavement,origin[0]+rows[:,0]/100,origin[1]+rows[:,1]/100)
    return bytearray(rows[keep].tobytes())

def toll_canopies(bounds):
    """Map elevated toll roofs separately from the ground-level corner supports."""
    canopies = []
    for el in load_osm():
        tags = el.get('tags', {})
        if el['type']!='way' or tags.get('barrier')!='toll_booth' or tags.get('layer')!='1' or not tags.get('building'):
            continue
        roof = area(el)
        if roof.is_empty or not bounds.covers(roof):
            continue
        # Estimated supports on the perimeter leave the mapped traffic lanes open.
        inset = roof.minimum_rotated_rectangle.buffer(-1,join_style=2)
        posts = unary_union([Point(x,z).buffer(.55,quad_segs=1) for x,z in inset.exterior.coords[:-1]])
        canopies.append((el,roof,posts.intersection(roof)))
    return canopies

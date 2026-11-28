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
    from scipy.ndimage import distance_transform_edt
    from airport_pavement import pavement_sources
    _,sources=pavement_sources(load_osm())
    strips=[]
    for kind,default in [('runway',45),('taxiway',23)]:
        for row,line in sources[kind]:
            strip=area(row)
            if strip.is_empty: strip=line.buffer(float(row['tags'].get('width',default))/2,cap_style='flat')
            strips.append(strip)
    core=unary_union(strips).buffer(15+GRID*2)
    x0,z0,x1,z1=pavement.union(core).buffer(32).bounds
    cols=np.arange(max(0,int((x0-left)//GRID)), min(terrain.shape[1],int((x1-left)//GRID)+2))
    rows=np.arange(max(0,int((z0-top)//GRID)), min(terrain.shape[0],int((z1-top)//GRID)+2))
    if not cols.size or not rows.size:
        return
    mask=intersects_xy(pavement,left+cols[None,:]*GRID,top+rows[:,None]*GRID)
    rr,cc=np.nonzero(mask)
    if rr.size:
        target=int(np.median(original[rows[rr],cols[cc]]))
        terrain[rows[rr],cols[cc]]=original[rows[rr],cols[cc]]=target
        if not core.is_empty:
            shoulder=intersects_xy(core,left+cols[None,:]*GRID,top+rows[:,None]*GRID)
            distance=distance_transform_edt(~shoulder)*GRID
            blend=np.clip(1-distance/32,0,1)
            blend=blend*blend*(3-2*blend)
            selection=np.ix_(rows,cols)
            for heights in (original,terrain):
                heights[selection]=np.rint(heights[selection]*(1-blend)+target*blend)


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


def grade_terminal_lanes(terrain, original, left, top, grid):
    """Interpolate the public covered roads between their two outdoor landings.

    The surface DEM samples parts of the terminal roof above these lanes.
    Use a feathered shoulder so the triangles on either side meet the road.
    """
    import shapely

    elements = load_osm()
    field = next((area(e) for e in elements if e['type']=='relation' and e['id']==13846706),None)
    if field is None:
        return
    lanes = []
    for e in elements:
        tags = e.get('tags',{})
        if e['type']!='way' or tags.get('highway') not in ('primary','secondary','tertiary'):
            continue
        if tags.get('covered')!='yes' and tags.get('tunnel')!='building_passage':
            continue
        coords = points(e)
        if len(coords)<2:
            continue
        line = LineString(coords)
        if not field.covers(line):
            continue
        ends = [original[round((z-top)/grid),round((x-left)/grid)] for x,z in (coords[0],coords[-1])]
        lanes.append((line,ends))
    for line,(first,last) in lanes:
        x0,z0,x1,z1 = line.bounds
        cols = np.arange(max(0,int((x0-left-20)//grid)),min(terrain.shape[1],int((x1-left+20)//grid)+1))
        rows = np.arange(max(0,int((z0-top-20)//grid)),min(terrain.shape[0],int((z1-top+20)//grid)+1))
        xx,zz = np.meshgrid(left+cols*grid,top+rows*grid)
        pts = shapely.points(xx,zz)
        distance = shapely.distance(line,pts)
        blend = np.clip((20-distance)/10,0,1)
        grade = first+(last-first)*shapely.line_locate_point(line,pts,normalized=True)
        index = np.ix_(rows,cols)
        for heights in (terrain,original):
            heights[index] = np.rint(heights[index]*(1-blend)+grade*blend).astype(heights.dtype)


def grade_airport_interchange(plans, road_height):
    """Keep the Baomao interchange decks above both Airport Road carriageways.

    OSM supplies the layer ordering but no surveyed elevation. Extend the
    raised profile onto the mapped approach at each end so it meets the road.
    """
    from collections import defaultdict
    from shapely.ops import substring

    lower_ids = {882310601, 882310602}
    lower = []
    approaches = defaultdict(list)
    spans = {}
    for element in load_osm():
        tags = element.get('tags', {})
        if element['type'] != 'way' or tags.get('highway') not in ('motorway', 'motorway_link'):
            continue
        coords = points(element)
        if len(coords) < 2:
            continue
        line = LineString(coords)
        way = element['id']
        if way in lower_ids:
            lower.append(line)
        if way in plans:
            spans[way] = line
        elif tags.get('bridge', 'no') == 'no':
            approaches[coords[0]].append(line)
            approaches[coords[-1]].append(line.reverse())

    for way, native in spans.items():
        line, width, old_stations, old_levels = plans[way]
        hits = []
        for road in lower:
            if line.crosses(road):
                crossing = line.intersection(road)
                hits.extend(getattr(crossing, "geoms", [crossing]))
        if not hits:
            continue
        coords = list(line.coords)
        for end in (0, -1):
            connected = approaches[native.coords[end]]
            if len(connected) != 1:
                continue
            link = connected[0]
            approach = list(substring(link, 0, min(120, link.length)).coords)[1:]
            if end == 0:
                coords = approach[::-1] + coords
            else:
                coords.extend(approach)
        profile = LineString(coords)
        stations = np.linspace(0, profile.length, int(np.ceil(profile.length/4))+1)
        base = np.array([road_height(*profile.interpolate(s).coords[0]) for s in stations])
        deck = base.copy()
        start = profile.project(Point(line.coords[0]))
        span = (stations >= start) & (stations <= start+line.length)
        deck[span] = np.maximum(deck[span], np.interp(stations[span]-start, old_stations, old_levels))
        for hit in hits:
            station = profile.project(hit)
            # 1.2 m structural slab plus 5 m vehicle clearance. Hold that
            # height over all three lanes, then descend along the link.
            level = road_height(hit.x, hit.y) + 6.2
            deck = np.maximum(deck, level - .065*np.maximum(0, abs(stations-station)-12))
        # Stop the approach slab as soon as it meets existing pavement.
        active = np.flatnonzero(span | (deck > base+.01))
        first = max(0, active[0]-1)
        last = min(len(stations)-1, active[-1]+1)
        section = slice(first, last+1)
        plans[way] = (substring(profile, stations[first], stations[last]), width,
                      stations[section]-stations[first], deck[section])

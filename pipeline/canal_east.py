"""Tie the east canal bridge to the last 20 m of the existing residential passage."""
from shapely import LineString, Point
from shapely.ops import substring

from canal_passages import sample_road_heights
from features import points
from service_streets import width


def plan(output, manifest, elements, widths, western):
    ids=(1025751317,1025751316,454956926,454961708,1025751314,1551968223)
    ways={w['id']:w for w in elements if w['type']=='way' and w['id'] in ids}
    if len(ways)!=len(ids):
        return [],[]
    bridge,south,north,residential,west,extension=[ways[k] for k in ids]
    foot,head=points(bridge)[0],points(bridge)[-1]
    join=points(west)[-1]
    west_grade=next((row for row in western if row[0].distance(Point(join))<.01),None)
    if west_grade is None:
        return [],[]
    line,half,ya,yb,cap,_=west_grade
    if line.length<=20 or line.coords[-1]!=join:
        raise ValueError('Unexpected east end of west canal road')
    arm=substring(line,line.length-20,line.length)
    north_axis=LineString([*points(north),join])
    south_axis=LineString(points(south))
    other=LineString(points(residential)[1:])
    if north_axis.coords[0]!=head or south_axis.coords[-1]!=foot:
        raise ValueError('Changed east bridge tie-in')
    samples=[dict(x=p[0],z=p[1],bridge=[q[0]-p[0],q[1]-p[1]]) for p,q in [(foot,head),(head,foot)]]
    first=LineString(points(extension)[:2])
    samples.extend(dict(x=p[0],z=p[1]) for p in (south_axis.coords[0],other.coords[-1],first.coords[-1]))
    deck_s,deck_n,street_s,street_n,extension_end=sample_road_heights(output,manifest,samples)
    # Reserve 10% of the 8% slope budget for the two vertical curves.
    end=min(yb,deck_n+.08*.90*LineString(points(north)).length)
    blend=max(0,min(.12,1-abs(yb-ya)/(cap*line.length)))
    t=1-20/line.length
    f=t if not blend else (t-.5*blend)/(1-blend)
    existing=ya+(yb-ya)*f
    def section(axis,road,start,finish):
        return (axis,widths.get(road['id'],width(road['tags']))/2+.5,start,finish,.08,0)
    pad=3.
    south_join=min(street_s,deck_s+.08*.88*south_axis.length)
    east=[section(substring(arm,0,arm.length-pad),west,existing,end),
            section(substring(arm,arm.length-pad,arm.length),west,end,end),
            section(LineString(points(north)),north,deck_n,end),
            section(LineString([points(north)[-1],join]),residential,end,end),
            section(substring(other,0,pad),residential,end,end),
            section(substring(other,pad,other.length),residential,end,street_n),
            section(south_axis,south,south_join,deck_s),
            section(first,extension,south_join,extension_end)]
    return east,[west_grade,*east]

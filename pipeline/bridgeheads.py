import numpy as np
from shapely.geometry import LineString, box

from bridges import bridge_tiles
from clearance import audit_routes
from common import CHUNK, GRID, load_osm
from features import points


def raise_approaches(bounds, routes, sample, terrain, original, wet):
    encode, triangles = bridge_tiles(bounds, sample, routes)
    west, north, east, south = map(int, bounds.bounds)
    for row in range(north,south,CHUNK):
        for col in range(west,east,CHUNK):
            encode(box(col,row,col+CHUNK,row+CHUNK),(col,row))
    failed=set()
    audit_routes(routes,triangles,select=True,failed_ids=failed)
    planned={}
    approaches=[]
    for way in load_osm():
        if way['type']!='way' or way['id'] not in failed: continue
        coords=points(way)
        anchors=[]
        for endpoint,near in [(coords[0],coords[1]),(coords[-1],coords[-2])]:
            direction=np.subtract(endpoint,near); direction/=np.linalg.norm(direction)
            for distance in range(0,65,2):
                center=endpoint+distance*direction
                if sample(*center)[1]==-32768: break
            else: continue
            col,row=np.rint((center-[west,north])/GRID).astype(int)
            rows=slice(max(0,row-20),min(terrain.shape[0],row+21))
            cols=slice(max(0,col-20),min(terrain.shape[1],col+21))
            yy,xx=np.ogrid[rows,cols]
            radius=np.hypot((xx-col)*GRID,(yy-row)*GRID)
            limit_radius=np.hypot(xx*GRID+west-endpoint[0],yy*GRID+north-endpoint[1])
            dry=~wet[rows,cols]; base=terrain[rows,cols]
            fall=np.floor(radius*.6).astype(int)
            capacity=np.where(limit_radius<76,25,0)
            maximum=int((base+capacity+fall)[dry].min())
            anchors.append((base[row-rows.start,col-cols.start],maximum,center,rows,cols,fall,dry))
        if len(anchors)!=2: continue
        first,last=anchors
        alignment=[first[2],*coords[1:-1],last[2]]
        line=LineString(alignment); stations=list(line.segmentize(4).coords)
        budget=np.r_[0,np.cumsum(np.floor(np.linalg.norm(np.diff(stations,axis=0),axis=1)*.59).astype(int))]
        profile=np.minimum(first[1]+budget,last[1]+budget[-1]-budget)
        print(f"桥头预算 {way['id']} 原高/满额可达高(dm): {[(int(anchor[0]),anchor[1]) for anchor in anchors]}, 桥面两端 {profile[[0,-1]].tolist()}")
        if profile[0]<first[0] or profile[-1]<last[0]:
            print(f"{way['id']}: 接坡需削低现有干地，保留原桥面")
            continue
        planned[way['id']]=(alignment,profile)
        approaches.extend(zip(anchors,[profile[0],profile[-1]]))
    lift=np.zeros_like(terrain)
    for (ground,maximum,center,rows,cols,fall,dry),level in approaches:
        bump=np.where(dry,np.maximum(0,level-fall-terrain[rows,cols]),0)
        lift[rows,cols]=np.maximum(lift[rows,cols],bump)
    assert lift.max()<=25
    terrain+=lift; original+=lift
    return planned

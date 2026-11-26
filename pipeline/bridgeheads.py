import numpy as np
from shapely.geometry import LineString, box

from clearance import audit_routes
from common import CHUNK, GRID, load_osm
from features import points


def extend_to_dry_bank(coords, sample, max_extend=20.0, step=2.0, end_heights=None):
    """Extend bridge endpoints that terminate over water or a steep riverbank drop onto dry bank.

    Returns (extended_coords, start_ext_m, end_ext_m) while preserving original vertices in-between.
    """
    if len(coords) < 2:
        return list(coords), 0.0, 0.0
    out = [tuple(pt) for pt in coords]
    exts = [0.0, 0.0]
    for end_idx, (ep_i, near_i) in enumerate(((0, 1), (-1, -2))):
        ep = np.asarray(out[ep_i], dtype=float)
        near = np.asarray(out[near_i], dtype=float)
        vec = ep - near
        vlen = float(np.linalg.norm(vec))
        if vlen < 1e-4:
            continue
        direction = vec / vlen
        g0, w0 = sample(float(ep[0]), float(ep[1]))
        h_ref = float(end_heights[end_idx]) if end_heights is not None else g0
        # Only extend if endpoint sits directly on water, hovers >0.45m above a wet-adjacent bank,
        # or sits down in a wet-adjacent riverbank depression (>0.8m below the dry bank plateau ahead).
        near_wet = (w0 != -32768) or any(
            sample(float(ep[0] + ox), float(ep[1] + oz))[1] != -32768
            for ox, oz in ((-6, 0), (6, 0), (0, -6), (0, 6), (-4, -4), (4, 4))
        )
        needs_extend = (w0 != -32768)
        if not needs_extend and near_wet:
            if end_heights is not None and (h_ref - g0) > 0.45:
                needs_extend = True
            else:
                plateau_g = g0
                for probe_d in np.arange(step, min(14.0, max_extend) + 0.01, step):
                    gp, wp = sample(float(ep[0] + direction[0] * probe_d), float(ep[1] + direction[1] * probe_d))
                    if wp == -32768 and gp > plateau_g:
                        plateau_g = gp
                if plateau_g >= g0 + 0.8:
                    needs_extend = True
                    h_ref = max(h_ref, plateau_g)
        if not needs_extend:
            continue
        landed = None
        for dist in np.arange(step, max_extend + 0.01, step):
            cand = ep + direction * float(dist)
            gc, wc = sample(float(cand[0]), float(cand[1]))
            if wc != -32768:
                continue
            if (h_ref - gc) <= 0.20:
                landed = (float(cand[0]), float(cand[1])), float(dist)
                break
        if landed is not None:
            pt_land, dist_land = landed
            if end_idx == 0:
                out.insert(0, pt_land)
            else:
                out.append(pt_land)
            exts[end_idx] = dist_land
    return out, exts[0], exts[1]


def raise_approaches(bounds, routes, sample, terrain, original, wet):
    from bridges import bridge_tiles
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

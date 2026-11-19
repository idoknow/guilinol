import numpy as np
from collections import defaultdict, deque
from PIL import Image, ImageDraw
from scipy.ndimage import label, maximum_filter, minimum_filter, binary_dilation, find_objects
from shapely.geometry import LineString
from shapely import distance, points as grid_points

from common import GRID, load_osm
from features import area, polygons, points


def contour_ronghu(surface, terrain, original, bounds):
    from scipy.ndimage import distance_transform_edt

    lake = next((area(item) for item in load_osm() if item.get('tags', {}).get('name') == '榕湖'
                 and item['tags'].get('natural') == 'water'), None)
    if lake is None or not lake.intersects(bounds):
        return
    west, north = bounds.bounds[:2]
    wet = surface != -32768
    rows, cols = np.nonzero(binary_dilation(wet) != wet)
    locations = grid_points(west + GRID*cols, north + GRID*rows)
    offsets = distance(locations, lake.boundary)
    near = offsets < GRID*1.5
    rows, cols, offsets = rows[near], cols[near], offsets[near]
    wet_indices = distance_transform_edt(~wet, return_distances=False, return_indices=True)
    levels = surface[tuple(wet_indices[:,rows,cols])]
    for field in (original, terrain):
        field[rows,cols] = np.minimum(field[rows,cols], levels + np.maximum(3, np.rint(offsets*8)))
    rows, cols = np.nonzero(wet & binary_dilation(~wet))
    offsets = distance(grid_points(west + GRID*cols, north + GRID*rows), lake.boundary)
    near = offsets < GRID*1.5
    rows, cols = rows[near], cols[near]
    bed = surface[rows,cols] - np.maximum(1, np.rint(offsets[near]*8))
    for field in (original, terrain):
        field[rows,cols] = bed


def correct_water(surface, terrain, original, bounds, stencil):
    dry = surface == -32768
    sentinel = np.iinfo(terrain.dtype).max
    bank_ground = np.minimum(original,terrain)
    bank = minimum_filter(np.where(dry, bank_ground, sentinel),
                          footprint=[[0,1,0],[1,0,1],[0,1,0]], mode='constant', cval=sentinel)
    before = surface.copy()
    labels = np.zeros(surface.shape, dtype=np.int32)
    names = ['其他/无名水域']
    left, top = bounds.bounds[:2]
    cuts = Image.new('L', surface.shape[::-1]); draw = ImageDraw.Draw(cuts)
    elements=load_osm()
    rivers=[(way['tags']['name'],LineString(points(way))) for way in elements if way.get('tags',{}).get('waterway')=='river' and way['tags'].get('name') in ('漓江','桃花江') and len(points(way))>=2]
    for element in elements:
        tags = element.get('tags', {})
        coords = points(element)
        if len(coords) >= 2:
            if (tags.get('bridge','no') != 'no' and coords[0]!=coords[-1]) or tags.get('waterway') in ('lock_gate','dam','weir') or tags.get('tunnel') == 'culvert':
                draw.line([((east-left)/GRID,(south-top)/GRID) for east,south in coords], fill=1,width=3)
        if not (tags.get('natural') == 'water' or 'water' in tags or tags.get('waterway') == 'riverbank'):
            continue
        for polygon in polygons(area(element).intersection(bounds)):
            name = tags.get('name')
            if not name and tags.get('water')=='river':
                length,name=max(((polygon.intersection(line).length,river) for river,line in rivers),default=(0,None))
                if not length: continue
            if not name: continue
            if name not in names:
                names.append(name)
            mask, (col, row) = stencil(polygon, left, top, GRID)
            patch = labels[row:row+mask.height, col:col+mask.width]
            patch[np.asarray(mask, dtype=bool)[:patch.shape[0], :patch.shape[1]]] = names.index(name)
    cross = [[0,1,0],[1,1,1],[0,1,0]]
    components,count = label(~dry & ~np.asarray(cuts,dtype=bool))
    while True:
        missing = ~dry & (components==0)
        if not missing.any(): break
        neighbors = maximum_filter(components,footprint=cross,mode='constant')
        if not neighbors[missing].any():
            extra,number = label(missing); components[missing] = count+extra[missing]; count+=number; break
        components[missing] = neighbors[missing]
    levels = np.full(count+1,sentinel,dtype=terrain.dtype)
    shores = {}
    for segment,region in enumerate(find_objects(components),1):
        if region is None: continue
        window = tuple(slice(max(0,s.start-1),min(n,s.stop+1)) for s,n in zip(region,dry.shape))
        edge = binary_dilation(components[window]==segment) & dry[window]
        rows,cols = np.nonzero(edge)
        shore = (rows+window[0].start,cols+window[1].start)
        shores[segment] = shore
        if len(rows): levels[segment] = np.percentile(bank_ground[shore],15,method='lower')
    levels -= 3
    edges = set()
    for first,second in [(components[1:],components[:-1]),(components[:,1:],components[:,:-1])]:
        both=(first!=second)&(first>0)&(second>0)
        edges.update(map(tuple,np.unique(np.sort(np.column_stack((first[both],second[both])),axis=1),axis=0)))
    graph = defaultdict(set)
    for first,second in edges:
        graph[first].add(second); graph[second].add(first)
    unresolved=set(np.flatnonzero(levels==sentinel-3))-{0}
    while unresolved:
        resolved={segment:min(levels[other] for other in graph[segment]-unresolved) for segment in unresolved if graph[segment]-unresolved}
        if not resolved:
            for segment in unresolved: levels[segment]=before[components==segment].min()
            break
        for segment,level in resolved.items(): levels[segment]=level
        unresolved-=resolved.keys()
    stations = {}
    for name,line in rivers:
        for station in np.arange(0,line.length,GRID):
            point=line.interpolate(station); row,col=round((point.y-top)/GRID),round((point.x-left)/GRID)
            if 0<=row<dry.shape[0] and 0<=col<dry.shape[1] and not dry[row,col]:
                segment=components[row,col]; rank=(int(name=='漓江'),station)
                stations[segment]=max(rank,stations.get(segment,rank))
    distance={segment:0 for segment in stations}; queue=deque(stations)
    while queue:
        segment=queue.popleft()
        for other in graph[segment]-distance.keys():
            distance[other]=distance[segment]+1; queue.append(other)
    def rank(segment):
        return (-distance.get(segment,count),*stations.get(segment,(0,0)), -int(levels[segment]),segment)
    order=sorted(range(1,count+1),key=rank); index={segment:i for i,segment in enumerate(order)}
    for segment in order:
        for other in graph[segment]:
            if index[other]>index[segment]: levels[other]=min(levels[segment],levels[other])
    surface[~dry]=levels[components[~dry]]
    for segment,shore in shores.items():
        terrain[shore] = np.maximum(terrain[shore],levels[segment]+3)
        original[shore] = np.maximum(original[shore],levels[segment]+3)
    corrected = np.minimum(original,terrain)
    lift = corrected-bank_ground
    final_bank = minimum_filter(np.where(dry,corrected,sentinel),footprint=[[0,1,0],[1,0,1],[0,1,0]],mode='constant',cval=sentinel)
    if np.any(surface[~dry] > final_bank[~dry]-3): raise ValueError('岸边余量不足')
    for row,col in zip(*np.nonzero(lift>15)):
        print(f'高驳岸 x={left+col*GRID:g} z={top+row*GRID:g} +{lift[row,col]/10:.1f} m')
    for segment in order:
        cells=components==segment; prior=before[cells]; banks=bank[cells]; level=levels[segment]
        raised=lift[shores[segment]]
        print(f'水段 {segment}: {prior.min()/10:.1f}–{prior.max()/10:.1f} → {level/10:.1f} m, 高水格 {sum(prior>banks)} → {sum(level>final_bank[cells])}, 抬岸 {np.count_nonzero(raised)} 格, 最大 {raised.max(initial=0)/10:.1f} m')
        for other in sorted(graph[segment]):
            if index[other]>index[segment]: print(f'桥闸台阶 {segment} → {other}: {(level-levels[other])/10:.1f} m')
    for index, name in enumerate(names):
        cells = (~dry) & (labels == index)
        if not cells.any():
            continue
        def summary(field,bank):
            values = field[cells]
            return f'{values.min()/10:.1f}–{values.max()/10:.1f} m, 高于岸地 {np.sum(values > bank[cells])} 格'
        print(f'水位核查 {name}: {summary(before,bank)} → {summary(surface,final_bank)}')

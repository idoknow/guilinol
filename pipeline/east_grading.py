"""Bake the approved Linjiang cut into the terrain, underlay and road spline."""
import numpy as np
from shapely.geometry import Point

LEVELS = np.array([150.517,150.457,150.269,150.029,149.789,149.549,149.309,149.069,
    148.829,148.589,148.349,148.109,147.869,147.651,147.548,147.546,147.548,147.536,
    147.512,147.504,147.536,147.445,147.234,146.994,146.771,146.661,146.677,146.683,
    146.773,146.852,147.025,147.262,147.462,147.541,147.549,147.570,147.609,147.764,
    148.001,148.241,148.481,148.721,148.961,149.201,149.441,149.681,149.921,150.161,
    150.401,150.641,150.881,151.120,151.285,151.35])


STATIONS = np.minimum(220,10+4*np.arange(len(LEVELS)))


def cut_weight(station):
    ramp = min(1,max(0,min(station-10,220-station)/36))
    return ramp*ramp*(3-2*ramp)


def profile(line,origin):
    return [[round(point.x-origin[0],4),round(point.y-origin[1],4),level+.025,cut_weight(station)]
            for station,level in zip(STATIONS,LEVELS) for point in [line.interpolate(station)]]


def grade_east(line, field, left, top, step, scale, wet=None):
    xmin,zmin,xmax,zmax = line.bounds
    for row in range(max(0,int((zmin-top-22)//step)), min(len(field),int((zmax-top+22)//step)+1)):
        for col in range(max(0,int((xmin-left-22)//step)), min(field.shape[1],int((xmax-left+22)//step)+1)):
            if wet is not None and wet[row,col]: continue
            point = Point(left+step*col,top+step*row)
            distance = line.distance(point)
            if distance>=12: continue
            station = line.project(point)
            if not 10<station<220: continue
            blend = np.clip((12-distance)/3,0,1)*cut_weight(station)
            target = np.interp(station, STATIONS, LEVELS)+.025
            value = (1-blend)*field[row,col]+blend*scale*target
            field[row,col] = round(value) if scale==10 else value


def grade_landing(line,fields,left,top,step,wet,anchor,angle,datum):
    axes=np.array([[np.cos(angle),np.sin(angle)],[-np.sin(angle),np.cos(angle)]])
    center=np.array([143.,0.])@axes+anchor
    for row in range(int((center[1]-top-34)//step),int((center[1]-top+34)//step)+1):
        for col in range(int((center[0]-left-34)//step),int((center[0]-left+34)//step)+1):
            if not (0<=row<wet.shape[0] and 0<=col<wet.shape[1]) or wet[row,col]:continue
            point=np.array([left+col*step,top+row*step]);along,across=(point-anchor)@axes.T
            if not 140.5<=along<156 or abs(across)>=20:continue
            distance=line.distance(Point(point)); weight=np.clip((distance-8)/4,0,1)*np.clip((20-abs(across))/5,0,1)
            run=np.clip(along-140.5,0,15); drop=.05*(run**2/4 if run<2 else run-1 if run<=13 else 13-(15-run)**2/4)
            target=10*(datum+5.6322-drop-.055)
            for field in fields:
                field[row,col]=round(max(field[row,col],field[row,col]+weight*(target-field[row,col])))

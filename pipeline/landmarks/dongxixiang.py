"""Jiangnan Alley, OSM 686154940. A 4 m passage and 3.2 m storeys are
estimated against doors in the 2019 series. Bend modules follow way nodes.
"""
import math
import numpy as np
from jingjiang import generate


def frontage(model):
    path=[(21.67,-121.76),(13.12,-58.68),(0,0),(37.8,7.3),(47.2,9.8)]
    for first,last in zip(path,path[1:]):
        dx,dz=np.subtract(last,first);length=math.hypot(dx,dz);angle=math.atan2(-dx,dz)
        count=max(1,round(length/10));width=length/count
        for bay in range(count):
            frac=(bay+.5)/count;model.pose=(first[0]+dx*frac,0,first[1]+dz*frac,angle)
            model.box(0,0,0,4.5,.17,width+.12,'pave',True)
            for side in (-1,1):
                east=side*6.4; high=6.1+(bay%3==1)*2.9
                model.box(east,0,0,6.5,high,width-.16,'brick',True)
                model.roof(east,high,0,7.8,width,1.8)
                model.box(side*2.9,3.15,0,1.7,.35,width,'wood')
                if not model.detail:continue
                for end in (-1,1):
                    model.box(east,high,end*(width/2-.16),6.8,.75,.3,'brick')
                    for lift in range(3):model.box(east,high+.7+lift*.43,end*(width/2-.16),6-lift*1.6,.47,.32,'brick')
                for cell in range(3):
                    zz=(cell-1)*width/3
                    model.box(side*3.10,.3,zz,.2,2.45,width/3-.28,'wood')
                    model.box(side*3.10,3.8,zz,.22,1.8,width/3-.38,'glass')
                    for bar in range(4):model.box(side*2.94,3.8,zz+(bar-1.5)*.46,.13,1.85,.10,'wood')
                    model.box(side*2.95,4.6,zz,.14,.12,width/3-.3,'wood')
                    model.box(side*2.22,3.45,zz,.12,.9,.12,'wood')
                    model.box(side*2.22,4.25,zz,.16,.13,width/3,'wood')
                model.box(side*2.95,2.4,0,.24,.64,2.6,'sign')
                for glyph in (-.72,0,.72):model.box(side*2.79,2.54,glyph,.1,.32,.24,'gold')
                if high>8:
                    model.box(side*2.9,6.15,0,1.6,.32,width,'wood')
                    for zz in (-2.8,0,2.8):
                        model.box(side*3.1,6.75,zz,.24,1.6,2.25,'glass')
                        for bar in (-.8,0,.8):model.box(side*2.93,6.75,zz+bar,.12,1.6,.12,'wood')
                for zz in (-2.6,0,2.6):
                    model.beam([side*2.18,2.85,zz],[side*2.18,3.43,zz],.37,'red',8)
                    model.box(side*2.18,2.62,zz,.12,.24,.12,'gold')
    model.pose=(21.67,0,-123,.14)
    for east in (-5.25,-2.35,2.35,5.25):
        model.box(east,0,0,.65,5.8,.72,'white',True);model.box(east,0,0,1.1,.5,1.2,'granite',True)
    for east,width,height in ((-3.8,3.25,3.8),(0,5.5,5.15),(3.8,3.25,3.8)):
        model.box(east,height-.66,0,width,.72,.65,'white');model.box(east,height+.12,0,width+.48,.28,.86,'granite');model.swept_roof(east,height+.45,0,width+.6,1.8,.68)
    model.box(0,4.53,-.39,2.15,.6,.18,'granite')
    for east in (-.56,0,.56):model.box(east,4.62,-.51,.18,.37,.09,'gold')


if __name__=='__main__':generate('dongxixiang',frontage)

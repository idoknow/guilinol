"""榕湖. Anchor is OSM node/6320266329 系舟亭 (25.2788955, 110.2853181), ground DEM 153.1 m.

Fixture and foundation heights use the finished world in local coordinates.

系舟亭, from raw/refs/ronghu/03-2019.jpg: square plan about 5.4 m, columns about
2.8 m (a seated person fixes the 美人靠 at 0.9 m), black tile hip roof with
upturned corners, red upper columns and a dark stone base, white platform and
four steps on the lake side. The night view 04-2017.jpg is the island pavilion:
a taller double eave on a stone pier, with a short covered corridor. Library
01-2019.jpg is a two-storey cream block, four round columns, a pediment and a
red star. Hotel 07-2010.jpg / 02-2019.jpg is a white five-storey block with
dark pitched roofs and a roof pavilion.

Colors: roof #393943, column #9a3832, library wall #adaaa6, column #a7a4a1.
"""
import math
import random
import sys
from rong_bridges import nine_bends, ancient_bridge
from rong_surface import ground, water, bank_top, bank_strip, shoreline_z, island_top
from rong_street import scooter
from rong_solids import oval, torus, banyan as solid_tree
from rong_solids import banyan, align_front
from c_kit import RECTS
from PIL import ImageDraw
from pathlib import Path

from c_kit import (
    Builder, arch_wall, box, cylinder, ensure_textures, export_landmark, solid,
    extrude, grille, hip_roof, railing, ramp, stairs, star, tri_count, tube, ring,
)


def board(mesh, x, y, z, w, h, region, axis='z'):
    uvs = [(0.01, 0.99), (0.99, 0.99), (0.99, 0.01), (0.01, 0.01)]
    if axis == 'z':
        mesh.face([(x - w / 2, y - h / 2, z), (x + w / 2, y - h / 2, z), (x + w / 2, y + h / 2, z), (x - w / 2, y + h / 2, z)], (0, 0, 1), region, uvs=uvs)
    else:
        mesh.face([(x, y - h / 2, z - w / 2), (x, y - h / 2, z + w / 2), (x, y + h / 2, z + w / 2), (x, y + h / 2, z - w / 2)], (1, 0, 0), region, uvs=uvs)


def pavilion(b, x, z, span=5.4, column_h=2.75, roof='blacktile'):
    wall = b.parts['atlas']
    half = span/2
    pad = [(x-half,z-half),(x+half,z-half),(x+half,z+half),(x-half,z+half)]
    deck = max(bank_top(px,pz) for px,pz in pad)+.24
    y = ground(x,z+half+2.4)
    bank_strip(wall, pad, lambda px,pz: deck, 'ashlar')
    stairs(wall, (x, y, z+half+2.4), (x, deck, z+half-.2), 1.8, 5 if b.detail else 3, 'granite')
    inset = span / 2 - 0.55
    for dx, dz in ((-inset, -inset), (inset, -inset), (inset, inset), (-inset, inset)):
        cylinder(wall, (x + dx, deck, z + dz), 0.22, 0.4, 'bark', 6, 0.4)
        cylinder(wall, (x + dx, deck + 0.4, z + dz), 0.2, column_h - 0.4, 'vermilion', 8 if b.detail else 5, 0.6)
    # 美人靠: a wood rail at seat-back height on three sides, open toward the steps.
    for a, c in (((-span / 2 + 0.15, -span / 2 + 0.15), (span / 2 - 0.15, -span / 2 + 0.15)),
                 ((span / 2 - 0.15, -span / 2 + 0.15), (span / 2 - 0.15, span / 2 - 0.9)),
                 ((-span / 2 + 0.15, span / 2 - 0.9), (-span / 2 + 0.15, -span / 2 + 0.15))):
        railing(wall, (x + a[0], z + a[1]), (x + c[0], z + c[1]), deck, 0.9, 'wood', 1.15)
    hip_roof(wall, (x, z), deck + column_h, span - 0.2, span - 0.2, 1.85, 1.05, 0.7, roof, 'vermilion', ceiling=True)
    board(wall, x, deck + column_h - 0.15, z + span / 2 - 0.55, 1.8, 0.55, 'wood')
    if b.collide:
        bank_strip(b.hit, pad, lambda px,pz: deck, 'ashlar')
        ramp(b.hit, (x, y + 0.05, z + span / 2 + 2.4), (x, deck, z + span / 2 - 0.1), 1.6)
        for dx, dz in ((-inset, -inset), (inset, -inset), (inset, inset), (-inset, inset)):
            solid(b.hit, (x + dx, deck + column_h / 2, z + dz), (0.32, column_h, 0.32), 'wood')


def island(b):
    """Double-eave hexagonal pavilion and a glazed corridor, from the 2017 night photograph."""
    wall, lit = b.parts['atlas'], b.parts['lit']
    x, y, z = 98.8, 0.3, 137.6
    deck = y + 0.85
    bank = [(121.57, 120.07), (129.25, 120.5), (133.71, 112.64), (136.39, 108.83), (143.94, 110.85), (150.4, 113.19), (151.31, 117.09), (152.91, 119.96), (155.49, 123.16), (157.69, 127.5), (155.77, 128.08), (154.81, 133.6), (158.65, 136.84), (162.95, 142.03), (166.5, 148.68), (168.34, 154.07), (171.37, 154.24), (170.89, 158.71), (167.96, 159.17), (166.4, 158.39), (164.79, 161.26), (166.24, 164.12), (169.49, 167.52), (172.55, 167.07), (173.69, 171.8), (154.23, 176.66), (153.14, 170.79), (162.11, 168.87), (162.0, 167.63), (155.98, 167.3), (148.82, 166.73), (140.88, 165.72), (136.62, 162.72), (133.61, 165.72), (130.9, 165.83), (129.87, 164.03), (126.42, 164.09), (122.94, 165.15), (121.62, 164.09), (119.13, 160.66), (111.45, 154.95), (107.61, 155.51), (105.5, 153.22), (107.61, 144.27), (101.14, 140.47), (99.67, 142.49), (94.68, 139.1), (98.79, 133.03), (100.9, 134.17), (110.34, 118.02)]
    top = island_top()
    lift = top - .24
    bank_strip(wall, bank, lambda x, z: top, 'rubble')
    if b.collide:
        bank_strip(b.hit, bank, lambda x, z: top, 'ashlar')
    starts = [(m, len(m.pos)) for m in [*b.parts.values(), b.hit]]
    for east in range(117,153,2):
        for south in (141,143,145,147,149,151):
            box(wall,(east,.41,south),(1.98,.24,1.98),'paver',None)
        for south in (138.6,153.1):
            box(wall,(east,.38,south),(2.02,.32,3.5),'foliage',None)
            oval(wall,(east,.65,south),(.97,.48,.85),'foliage',7)
    torus(wall,(123,2.5,136),1.94,.35,.39,'white')
    for offset in (-.7,0,.7):
        torus(wall,(123+offset,2.5,136),.72,.12,.15,'white')
    arch_wall(wall,(130,.24,132),4.2,3.2,.48,2.2,2.75,'garden_brick',tile=None)
    for east in (125.8,134.2):
        box(wall,(east,.82,132),(4.2,1.16,.48),'garden_brick',None)
        box(wall,(east,3.13,132),(4.2,.64,.48),'garden_brick',None)
        for side in (-1,1):
            box(wall,(east+side*1.65,2.09,132),(.92,1.42,.48),'garden_brick',None)
        for offset in (-.9,-.45,0,.45,.9):
            box(wall,(east+offset,2.09,132),(.09,1.42,.16),'ashlar')
        for height in (1.76,2.4):
            box(wall,(east,height,132),(2.5,.1,.18),'ashlar')
    for index,(east,south) in enumerate(((133,149),(135,150),(138,137),(141,138),(144,139),(147,150))):
        for step in range(2+index%2):
            torus(wall,(east+.28*math.sin(index+step),1+step*.98,south+.13*step),
                  .65-.06*step,.24,.45,'limestone',.23,stretch=1.36,phase=index+step)
        oval(wall,(east-.4,.56,south+.24),(.94,.43,.68),'limestone',8)
    for clump in range(5):
        for stem in range(8 if b.detail else 4):
            angle=stem*2.4+clump
            east,south=140+clump*1.5+math.sin(angle)*.6,133+clump%2+math.cos(angle)*.55
            tip=(east+.6*math.sin(angle),4.7+stem%3,south+.6*math.cos(angle))
            tube(wall,(east,.24,south),tip,.065,'foliage',5)
            oval(wall,tip,(.74,.34,.58),'foliage',6)
            if b.detail:
                for node in (2.2,3.5):
                    spray=(east+math.cos(angle),node+.45,south+math.sin(angle))
                    tube(wall,(east,node,south),spray,.035,'foliage',4)
                    for direction in (-1,1):
                        leaf,spray_y,stem_z=spray
                        wall.face([spray,(leaf+.22*direction,spray_y+.16,stem_z+.14),(leaf+.54*direction,spray_y-.05,stem_z+.28),(leaf+.19*direction,spray_y+.01,stem_z+.1)],(0,1,0),'foliage')
    for index in range(5):
        east,south=130+index*2.4,153+index%2
        cylinder(wall,(east,.25,south),.12,.8,'steel',5)
        cylinder(wall,(east,1.05,south),.64,.09,'wood',8)
        for shift in (-.9,.9):
            box(wall,(east+shift,.55,south),(.45,.55,.46),'wood')
    for index in range(10):
        box(wall,(122+index*.32,.43,148),( .30,.30,2),'wood')
    with align_front(b, (x,z), 55.92):
        island_corridor(b, x,y,z,deck)
    banyan(wall, (113,.24,136), 12, 9, 21, b.detail)
    banyan(wall, (117,.24,147), 10, 7.5, 22, b.detail)
    for mesh, start in starts:
        mesh.pos[start:] = [(x, y+lift, z) for x, y, z in mesh.pos[start:]]

    angle = math.radians(55.92)
    toe = [(x+dx*math.cos(angle)+dz*math.sin(angle), z-dx*math.sin(angle)+dz*math.cos(angle))
           for dx,dz in ((-6,-1.55),(3.5,-1.55),(3.5,1.55),(-6,1.55))]
    for mesh in ([wall,b.hit] if b.collide else [wall]):
        bank_strip(mesh,toe,lambda x,z: top+.39,'ashlar')


def island_corridor(b, x,y,z,deck):
    wall, lit = b.parts['atlas'], b.parts['lit']
    for east in (x-4,x-1,x+2):
        cylinder(lit,(east,2.64,z+1.48),.21,.38,'vermilion',8)
    radius = 3.15
    pad = []
    for i in range(6):
        angle = math.pi / 6 + i * math.tau / 6
        pad.append((x + 4.2 + (radius + 1.1) * math.cos(angle), z + (radius + 1.1) * math.sin(angle)))
    extrude(wall, pad, y, deck, 'ashlar', 1.2)
    stairs(wall, (x + 4.2, y, z + radius + 2.6), (x + 4.2, deck, z + radius - 0.2), 1.8, 5 if b.detail else 3, 'granite')
    for i in range(6):
        angle = math.pi / 6 + i * math.tau / 6
        cx, cz = x + 4.2 + radius * math.cos(angle), z + radius * math.sin(angle)
        cylinder(wall, (cx, deck, cz), 0.2, 3.15, 'vermilion', 8 if b.detail else 5, 0.55)
    hip_roof(wall, (x + 4.2, z), deck + 3.15, 6.4, 6.4, 2.15, 0.85, 0.65, 'blacktile', 'vermilion', tiers=2, sides=6)
    # Glazed corridor running west: floor, columns, lattice windows, its own roof.
    box(wall, (x - 1.2, y + 0.42, z), (9.4, 0.16, 3.0), 'ashlar')
    bays = 5 if b.detail else 3
    for i in range(bays):
        cx = x - 4.6 + i * (8.2 / max(bays - 1, 1))
        cylinder(wall, (cx, y + 0.5, z - 1.15), 0.14, 2.55, 'vermilion', 6, 0.4)
        cylinder(wall, (cx, y + 0.5, z + 1.15), 0.14, 2.55, 'vermilion', 6, 0.4)
        box(lit, (cx, y + 1.85, z - 1.15), (1.15, 1.7, 0.06), 'glass', None)
        box(lit, (cx, y + 1.85, z + 1.15), (1.15, 1.7, 0.06), 'glass', None)
    hip_roof(wall, (x - 1.2, z), y + 3.15, 9.6, 3.5, 1.25, 0.55, 0.5, 'graytile', 'vermilion')
    if b.collide:
        solid(b.hit, (x + 4.2, y + 0.42, z), (7.2, 0.85, 7.2), 'ashlar')
        solid(b.hit, (x - 1.2, y + 0.3, z), (9.4, 0.2, 3.0), 'ashlar')
        ramp(b.hit, (x + 4.2, y + 0.05, z + radius + 2.6), (x + 4.2, deck, z + radius - 0.1), 1.6)


def library(b):
    wall, lit = b.parts['atlas'], b.parts['lit']
    x, z = -26.0, -50.0
    y = ground(x,z)
    rear = [(35.06, -26.94), (19.06, -28.04), (17.94, -12.52), (4.99, -13.4), (5.36, -18.43), (-7.89, -19.34), (-8.26, -14.3), (-28.73, -15.7), (-28.11, -24.24), (-16.06, -23.42), (-15.26, -34.35), (-37.94, -35.89), (-39.68, -12.0), (33.96, -12.0)]
    rear = [(x+east,z+south) for east,south in rear]
    extrude(wall,rear,y,y+10.8,'cream')
    if b.collide:extrude(b.hit,rear,y,y+10.8,'cream')
    angle = math.radians(-19.13)
    def grade(east,south):
        dx,dz=east-x,south-z
        return ground(x+dx*math.cos(angle)+dz*math.sin(angle),z-dx*math.sin(angle)+dz*math.cos(angle))
    annex = grade(-66,-61)
    box(wall,(-66,annex+4,-61),(9,8.0,13),'yellow')
    hip_roof(wall,(-66,-61),annex+8.0,9.2,13.4,2.1,.6,.22,'graytile','wood')
    if b.collide:
        solid(b.hit,(-66,annex+4,-61),(9,8,13),'yellow')
    for index in range(9 if b.detail else 3):
        scooter(wall,-73+index*.36,grade(-73+index*.36,-58-index*.94),-58-index*.94,'steel' if index%2 else 'cream')
    banyan(wall,(-71,grade(-71,-56),-56),12,10,123,b.detail)
    for direction in (-1,1):
        wing=x+direction*19
        box(wall,(wing,y+5.4,z-6),(18,10.8,12),'cream',2.1)
        box(wall,(wing,y+10.8,z-6),(18.6,.36,12.5),'white')
        if b.collide:
            solid(b.hit,(wing,y+5.4,z-6),(18,10.8,12),'cream')
        for bay in range(6 if b.detail else 3):
            east=wing-7.1+bay*(2.84 if b.detail else 7.1)
            cylinder(wall,(east,y,z+1),.32,3.4,'white',8)
            for level in (1.8,5.4,9):
                box(wall,(east,y+level,z+.03),(1.48,2.55,.15),'vermilion')
                box(lit,(east,y+level,z+.14),(1.24,2.31,.08),'glass')
        box(wall,(wing,y+3.45,z+.5),(18.5,.28,2.5),'cream')
        box(wall,(x+direction*9,y+.32,z+5.4),(5.5,.64,2.1),'granite')
        box(wall,(x+direction*9,y+.75,z+5.4),(5.2,.32,1.9),'foliage')
        for plant in range(9 if b.detail else 4):
            oval(wall,(x+direction*9+2*math.cos(plant*2.4),y+1,z+5.4+.55*math.sin(plant*2.4)),(.4,.25,.37),'foliage',6)
    solid_tree(wall,(x-14,y,z+9),16,12.6,54,b.detail)
    box(wall,(x+17,y+1.1,z+9),(8.4,2.2,.45),'white')
    for index in range(7):
        east=x+14+index*.95
        front=z+9.29
        oval(wall,(east,y+1.67,front),(.16,.22,.14),'granite',8)
        oval(wall,(east,y+1.22,front),(.27,.37,.17),'cream',8)
        for sign in (-1,1):
            tube(wall,(east+.16*sign,y+1.42,front),(east+.36*sign,y+1.05+index%2*.18,front),.085,'granite',6)
            tube(wall,(east+.1*sign,y+1,front),(east+.2*sign,y+.32,front),.1,'cream',6)
    # South front faces the lake (+Z). Body is 20 m wide, two storeys plus pediment.
    box(wall, (x, y + 4.3, z - 3.2), (20, 8.6, 10), 'cream', 2.2)
    stairs(wall, (x, y, z + 7.2), (x, y + 0.9, z + 2.4), 14.8, 7 if b.detail else 4, 'paver')
    for dx in (-6.3, -2.1, 2.1, 6.3):
        cylinder(wall, (x + dx, y + 0.9, z + 2.65), 0.77, 7.45, 'limestone', 16 if b.detail else 8,None)
        cylinder(wall, (x + dx, y + 8.4, z + 2.15), 0.98, 0.28, 'granite', 8, 0.4)
        box(wall, (x + dx, y + 8.75, z + 2.15), (1.7, 0.28, 1.7), 'granite', 0.4)
    # Pediment proud of the columns, star in front of the triangle.
    wall.face([(x - 8.6, y + 8.9, z + 3.15), (x + 8.6, y + 8.9, z + 3.15), (x, y + 12.4, z + 3.15)], (0, 0, 1), 'cream', None)
    wall.face([(x + 8.6, y + 8.9, z + 2.3), (x - 8.6, y + 8.9, z + 2.3), (x, y + 12.4, z + 2.3)], (0, 0, -1), 'cream', None)
    wall.face([(x - 8.6, y + 8.9, z + 3.15), (x, y + 12.4, z + 3.15), (x, y + 12.4, z + 2.3), (x - 8.6, y + 8.9, z + 2.3)], (-1, 1, 0), 'cream', None)
    wall.face([(x + 8.6, y + 8.9, z + 2.3), (x, y + 12.4, z + 2.3), (x, y + 12.4, z + 3.15), (x + 8.6, y + 8.9, z + 3.15)], (1, 1, 0), 'cream', None)
    center=(x,y+10.45,z+3.55)
    tips=[]
    for index in range(10):
        angle=math.pi/2+index*math.pi/5
        radius=1.43 if index%2==0 else .59
        tips.append((x+radius*math.cos(angle),center[1]+radius*math.sin(angle),center[2]))
    for index in range(10):
        wall.face([center,tips[index],tips[(index+1)%10]],(0,0,1),'star_red')
    board(wall, x, y + 8.35, z + 3.35, 12.5, 0.85, 'sign_lib')
    if b.detail:
        for col, row in ((-3.2, 2.4), (0, 2.4), (3.2, 2.4), (-3.2, 5.2), (0, 5.2), (3.2, 5.2)):
            box(lit, (x + col, y + row, z + 1.85), (1.15, 1.7, 0.08), 'glass', None)
        arch_wall(wall, (x, y + 0.9, z + 1.7), 2.2, 2.6, 0.4, 1.3, 2.3, 'cream', 6)
    if b.collide:
        # Leave a 2 m doorway in the south front. Side masses and the back wall stay solid.
        solid(b.hit, (x - 5.6, y + 4.3, z - 3.2), (8.6, 8.6, 10), 'cream')
        solid(b.hit, (x + 5.6, y + 4.3, z - 3.2), (8.6, 8.6, 10), 'cream')
        solid(b.hit, (x, y + 6.6, z - 3.2), (3.2, 4.0, 10), 'cream')
        # Close the north side so the front door is a room, not a tunnel through the block.
        solid(b.hit, (x, y + 4.3, z - 8.0), (20, 8.6, 0.45), 'cream')
        ramp(b.hit, (x, y + 0.05, z + 7.2), (x, y + 0.95, z + 2.4), 14.8)


def hotel(b):
    wall, lit = b.parts['atlas'], b.parts['lit']
    x, z = -190.0, 55.0
    y = ground(x,z)
    starts = [(mesh,len(mesh.pos)) for mesh in (wall,b.hit)]
    # Five floors, white, south front. Wings step down. Dark roofs, a small roof pavilion.
    box(wall, (x, y + 8.0, z - 4), (46, 16.0, 14), 'cream', 3)
    box(wall, (x - 28, y + 5.6, z - 4), (12, 11.2, 12), 'cream', 2.5)
    box(wall, (x + 28, y + 5.6, z - 4), (12, 11.2, 12), 'cream', 2.5)
    hip_roof(wall, (x, z - 4), y + 16.05, 42, 13, 2.7, 1.3, 0.6, 'graytile', 'vermilion')
    hip_roof(wall, (x - 28, z - 4), y + 11.25, 13, 12, 1.9, 0.75, 0.5, 'graytile', 'vermilion')
    hip_roof(wall, (x + 28, z - 4), y + 11.25, 13, 12, 1.9, 0.75, 0.5, 'graytile', 'vermilion')
    # Stacked pavilion roofs on the main block, each one smaller than the one below.
    hip_roof(wall, (x, z - 4), y + 19.0, 22, 11, 2.8, 0.9, 0.55, 'blacktile', 'vermilion')
    hip_roof(wall, (x, z - 4), y + 22.0, 12, 7, 2.2, 0.6, 0.5, 'blacktile', 'vermilion')
    board(wall, x, y + 17.2, z + 3.4, 6.5, 1.1, 'sign_hotel')
    floors = 5 if b.detail else 2
    cols = 11 if b.detail else 4
    for row in range(floors):
        eave_y = y + 3.05 * (row + 1)
        box(wall, (x, eave_y, z + 3.85), (46.5, 0.32, 1.7), 'cream', 2)
        box(wall, (x, eave_y + 0.22, z + 4.45), (47.2, 0.14, 0.7), 'graytile', 1.2)
        for col in range(cols):
            cx = x - 20 + 40 * col / (cols - 1)
            box(lit, (cx, y + 2.15 + row * 3.05, z + 3.08), (1.45, 1.45, 0.06), 'glass', None)
    banyan(wall, (x - 34, ground(x-34,z-2), z - 2), 13, 10, 31, b.detail)
    banyan(wall, (x + 34, ground(x+34,z-2), z - 2), 12, 9, 32, b.detail)
    if b.collide:
        solid(b.hit, (x, y + 8, z - 4), (46, 16, 14), 'cream')
        solid(b.hit, (x - 28, y + 5.6, z - 4), (12, 11.2, 12), 'cream')
        solid(b.hit, (x + 28, y + 5.6, z - 4), (12, 11.2, 12), 'cream')

    # The three wings share a horizontal floor. Fit their exterior wall feet
    # individually where the lake bed drops away at the east end of the hotel.
    for mesh,start in starts:
        for i in range(start,len(mesh.pos)):
            px,py,pz = mesh.pos[i]
            if abs(py-y)<1e-6:
                mesh.pos[i]=(px,ground(px,pz)-.08,pz)


def steel_bridge(b):
    """North-south footbridge, 44.5 m, the length of way/155148522."""
    steel, wall = b.parts['steel'], b.parts['atlas']
    x, y, z = -604.1, 0.0, 87.2
    starts = [(m,len(m.pos)) for m in [*b.parts.values(), b.hit]]
    length, width = 44.5, 3.3
    box(steel, (x, y + 0.12, z), (width, 0.24, length), 'steel', 2)
    bays = 14 if b.detail else 4
    for side in (-width / 2, width / 2):
        z0, z1 = z - length / 2, z + length / 2
        tube(steel, (x + side, y + 0.3, z0), (x + side, y + 0.3, z1), 0.08, 'steel', 5)
        tube(steel, (x + side, y + 2.15, z0), (x + side, y + 2.15, z1), 0.07, 'steel', 5)
        for i in range(bays + 1):
            zz = z0 + length * i / bays
            tube(steel, (x + side, y + 0.3, zz), (x + side, y + 2.15, zz), 0.05, 'steel', 4)
        if b.detail:
            for i in range(bays):
                za = z0 + length * i / bays
                zb = za + length / bays
                tube(steel, (x + side, y + 0.3, za), (x + side, y + 2.15, zb), 0.04, 'steel', 4)
    if b.detail:
        railing(wall, (x - width / 2 + 0.15, z - length / 2), (x - width / 2 + 0.15, z + length / 2), y + 0.25, 1.05, 'steel', 1.6)
        railing(wall, (x + width / 2 - 0.15, z - length / 2), (x + width / 2 - 0.15, z + length / 2), y + 0.25, 1.05, 'steel', 1.6)
    if b.collide:
        solid(b.hit, (x, y + 0.12, z), (width - 0.3, 0.24, length), 'steel')
        solid(b.hit, (x - width / 2, y + 0.7, z), (0.16, 1.1, length), 'steel')
        solid(b.hit, (x + width / 2, y + 0.7, z), (0.16, 1.1, length), 'steel')

    z0, z1 = z-length/2, z+length/2
    near, far = ground(x,z0), ground(x,z1)
    for mesh, start in starts:
        mesh.pos[start:] = [(px, py+near+(far-near)*(pz-z0)/length-.24, pz)
                            for px,py,pz in mesh.pos[start:]]


def glass_bridge(builder):
    stone=builder.parts['atlas']
    starts = [(m,len(m.pos)) for m in [*builder.parts.values(), builder.hit]]
    box(stone,(304,.48,160),(4.4,.56,29),'white')
    if builder.collide:
        solid(builder.hit,(304,.48,160),(4.4,.56,29),'white')
    for east in (302,306):
        for index in range(9):
            south=146.4+3.4*index
            box(stone,(east,.98,south),(.68,.45,.68),'white')
            cylinder(stone,(east,1.18,south),.22,2.92,'white',8)
            box(stone,(east,4.18,south),(.65,.22,.65),'white')
        box(stone,(east,4.45,160),(.65,.42,29),'white')
        railing(stone,(east,146),(east,174),.76,1.02,'white',1.15,stone=True)
    for south in (146.4,160,173.6):
        box(stone,(304,4.45,south),(4.4,.38,.56),'white')
    near, far = ground(304,145.5), ground(304,174.5)
    for mesh,start in starts:
        mesh.pos[start:] = [(x,y-.76+near+(far-near)*(z-145.5)/29,z) for x,y,z in mesh.pos[start:]]
    east,south=470,196.5
    tower_ground = ground(east,south)-1.8
    box(stone,(east,tower_ground+14.8,south),(23,26,15),'bank_blue',None)
    box(stone,(east,tower_ground+27.5,south),(23.4,1.3,15.4),'white',None)
    for offset in range(-6,7,2):
        box(stone,(east-11.56,tower_ground+14.6,south+offset),(.15,24.8,.13),'steel')
    for level in range(9):
        box(stone,(east,tower_ground+2+3.1*level,south),(23.3,.18,15.3),'steel')
    for offset in range(-10,11,4):
        box(stone,(east+offset,tower_ground+14.8,south-7.55),(.13,26,.18),'white')
    if builder.collide:
        solid(builder.hit,(east,tower_ground+14.8,south),(23,26,15),'glass')


def shore(b):
    wall = b.parts['atlas']
    for south in (-27.4,-20.6):
        box(wall,(-116,.7,south),(2.3,3.8,1.85),'white')
        box(wall,(-116,-.84,south),(2.8,.82,2.36),'ashlar')
        if b.collide:
            solid(b.hit,(-116,.7,south),(2.3,3.8,1.85),'ashlar')
    for index in range(24):
        angles=[step*math.pi/24 for step in (index,index+1)]
        def arc(face,radius):
            return [(face,2.6+radius*math.sin(angle),-24+radius*math.cos(angle)) for angle in angles]
        for face in (-117.15,-114.85):
            wall.face(arc(face,2.48)+arc(face,4.32)[::-1],(face+116,0,0),'white')
        for radius,side in ((2.48,-1),(4.32,1)):
            wall.face(arc(-117.15,radius)+arc(-114.85,radius)[::-1],(0,side*math.sin(angles[0]),side*math.cos(angles[0])),'white')
    for index in range(10):
        east=-82+index*5
        south=min(-16,shoreline_z(east)-3.5)
        level=ground(east,south)+.20
        for side in (-1,1):
            box(wall,(east,level,south+side*1.79),(5,.4,2.18),'granite')
            box(wall,(east,level+.16,south+side*.75),(5,.22,.15),'white')
        box(wall,(east,level+.03,south),(5,.08,1.4),'rill_water')
        for offset in (-1.3,1.3):
            box(wall,(east+offset,level+.17,south),(.63,.32,.6),'ashlar')
        if index in (0,3):
            solid_tree(wall,(east,ground(east,south-5),south-5),9,5,90+index,b.detail,lobed=False)
    px, pz = -46, shoreline_z(-46)-2
    outline = [(px+3*math.cos(i*math.tau/6), pz+3*math.sin(i*math.tau/6)) for i in range(6)]
    level = max(bank_top(x,z) for x,z in outline)
    bank_strip(wall, outline, lambda x,z: level, 'granite')
    if b.collide:
        bank_strip(b.hit, outline, lambda x,z: level, 'granite')
    for i in range(6):
        angle = i*math.tau/6
        cylinder(wall,(px+2.25*math.cos(angle),level,pz+2.25*math.sin(angle)),.19,3,'vermilion',8)
    hip_roof(wall,(px,pz),level+3,5.3,5.3,2,.7,.5,'graytile','vermilion',tiers=2,sides=6)
    for first, last in ((-36,-2.2),(2.2,72)):
        count = math.ceil((last-first)/1.6)
        points = []
        for i in range(count+1):
            x = first+(last-first)*i/count
            z = shoreline_z(x)
            h = ground(x,z)
            points.append((x,h+.85,z))
            start = len(wall.pos)
            box(wall,(x,h+.45,z),(.26,.9,.26),'granite')
            for at in range(start,len(wall.pos)):
                px,y,pz = wall.pos[at]
                if y < h+.45:
                    wall.pos[at] = (px,ground(px,pz)-.08,pz)
        for a,c in zip(points,points[1:]):
            tube(wall,a,c,.14,'granite',4)
    # North of the pavilion, so a camera standing beside the pavilion is not inside a crown.
    banyan(wall, (20, ground(20,-7), -7), 13, 10, 42, b.detail)
    if b.detail:
        banyan(wall, (48, ground(48,-4), -4), 12, 9, 43, True)


def build(b: Builder):
    nine_bends(b)
    ancient_bridge(b)
    glass_bridge(b)
    pavilion(b, 0, 0)
    island(b)
    with align_front(b, (-26, -50), -19.13):
        library(b)
    hotel(b)
    steel_bridge(b)
    shore(b)


def main():
    folder = Path(sys.argv[1])
    image = ensure_textures(folder)
    draw=ImageDraw.Draw(image)
    for index,(name,base) in enumerate([('limestone',(187,190,183)),('garden_brick',(130,133,132)),('paver',(155,158,154)),('bank_blue',(45,133,187)),('star_red',(211,34,36))]):
        left,top=768+48*index,696
        RECTS[name]=(left,top,46,62)
        draw.rectangle((left,top,left+45,top+61),fill=base)
        rng=random.Random(1324+index)
        for dot in range(550):
            shift=rng.randrange(-11,12)
            draw.point((left+rng.randrange(46),top+rng.randrange(62)),fill=tuple(channel+shift for channel in base))
        if name=='garden_brick':
            for row in range(8):
                draw.line((left,top+row*8,left+45,top+row*8),fill='#5b5d5c')
                for offset in range(row%2*8,46,16):
                    draw.line((left+offset,top+row*8,left+offset,min(top+61,top+row*8+8)),fill='#5b5d5c')
    for index,(name,color) in enumerate([('lantern_red','#df4233'),('lantern_gold','#ebbd34'),('lantern_cyan','#53b7cf'),('lantern_pink','#eb81a9'),('lantern_orange','#f68526'),('rill_water','#83acbc')]):
        left=768+index*40
        RECTS[name]=(left,640,36,36)
        draw.rectangle((left,640,left+36,676),fill=color)
    hi, lo = Builder(0, True), Builder(1, False)
    build(hi)
    build(lo)
    export_landmark(folder / 'ronghu.glb', image, (('lod0', hi), ('lod1', lo)))
    near, far = tri_count(hi), tri_count(lo)
    print(f'ronghu triangles lod0={near} lod1={far} ratio={far / near:.3f} collision={len(hi.hit)}')


if __name__ == '__main__':
    main()

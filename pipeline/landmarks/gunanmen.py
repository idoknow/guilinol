"""古南门. Dimensions and evidence in docs/layout/gunanmen.md."""
import math
import random
import sys
from PIL import Image, ImageDraw
from c_kit import RECTS, ATLAS, _font, landmark_surface
from rong_paving import slab_texture
from rong_street import shops, signs, approach
from rong_solids import oval, banyan as solid_tree, align_front
from pathlib import Path

from c_kit import (
    Builder, arch_wall, box, cylinder, ensure_textures, export_landmark, solid,
    grille, garden_gate_roof, hip_roof, railing, ramp, tri_count, segment_wall, tube, extrude,
)


def board(mesh, x, y, z, w, h, region):
    # local v=0 is the top of the atlas cell, so the top edge of the board gets v=0.
    mesh.face(
        [(x - w / 2, y - h / 2, z), (x + w / 2, y - h / 2, z), (x + w / 2, y + h / 2, z), (x - w / 2, y + h / 2, z)],
        (0, 0, 1), region, uvs=[(0.01, 0.99), (0.99, 0.99), (0.99, 0.01), (0.01, 0.01)],
    )


def stone_cells(image):
    rng = random.Random(1315)
    for index, name in enumerate(('coursed', 'ivywall')):
        left, top = index * 320, 896
        RECTS[name] = (left, top, 320, 128)
        tile = Image.new('RGB', (320, 128), '#424440')
        brush = ImageDraw.Draw(tile)
        row = 0
        while row < 128:
            height = rng.randint(3, 6) if index else rng.randint(5, 9)
            edge = -rng.randint(0, 38)
            while edge < 320:
                width = rng.randint(4, 10) if index else rng.randint(10, 25)
                tone = rng.randint(120, 168) - index * 34
                brush.polygon([(edge+1,row+1),(edge+width-2,row),(edge+width-1,row+height-2),(edge+width-4,row+height-1),(edge,row+height-2)], fill=(tone,tone+1,tone-2))
                edge += width
            row += height
        if index:
            for column in range(320):
                reach = int(39+24*math.sin(column*.033)+14*math.cos(column*.091)+rng.randrange(8))
                for leaf in range(0,reach,2):
                    green=rng.randrange(44,84)
                    brush.ellipse((column-2,leaf,column+2,leaf+3), fill=(green//2,green,green//2-2))
        image.paste(tile,(left,top))


    # Large irregular blocks across the lake facade. Paint fine joints at
    # triple resolution before filtering into the existing atlas cell.
    stone = Image.new('RGB',(960,384),'#77766e')
    brush = ImageDraw.Draw(stone)
    row = 0
    while row<384:
        height=rng.randrange(15,26)
        x=-rng.randrange(38)
        while x<960:
            width=rng.randrange(15,34)
            tone=rng.randrange(113,174)
            brush.polygon([(x+2,row+1),(x+width-3,row+1),
                           (x+width-1,row+height-3),(x+width-5,row+height-1),
                           (x+2,row+height-2)],fill=(tone,tone-1,tone-7))
            for _ in range(width*height//8):
                px,py=x+rng.randrange(2,width-2),row+rng.randrange(2,height-2)
                grain=tone+rng.randrange(-30,20)
                brush.ellipse((px,py,px+2,py+2),fill=(grain,grain-1,grain-6))
            x+=width
        row+=height
    image.paste(stone.resize((320,128),Image.Resampling.LANCZOS),(0,896))


def ancient_banyan(builder, east, south):
    wood = builder.parts['atlas']
    iron = builder.parts['steel']
    solid_tree(wood,(east,0,south),14.8,16.7,4,builder.detail)
    count = 32 if builder.detail else 16
    for index in range(count):
        ends = [(east+11.6*math.cos(math.tau*t/count),south+10.6*math.sin(math.tau*t/count)) for t in (index,index+1)]
        segment_wall(wood,*ends,-.04,.43,.8,'rubble')
        segment_wall(wood,*ends,-.04,.72,.64,'foliage')
        railing(iron,*ends,.42,.74,'steel',1.25)


def courtyard(builder, deck):
    wall = builder.parts['atlas']
    solid_tree(wall, (7.2, deck, 6.7), 5.6, 3.2, 82, builder.detail,lobed=False)
    for offset in (-4.5, -1.5, 1.5, 4.5):
        cylinder(wall, (offset, deck + 2.66, 7.6), .24, .45, 'vermilion', 8)
        cylinder(wall, (offset, deck + 2.52, 7.6), .045, .14, 'yellow', 5)
    # North-facing gate and the west return of the garden enclosure (IMG_1306).
    # The 1308 and 1309 sightlines meet the west return at z=0.33 and 8.06.
    # The north entrance in 1306 is open; the west entrance has closed doors.
    for start,end,finish in ((-2.5,6.7,'gate_plaster'),(9.4,14,'coursed')):
        segment_wall(wall,(-31,start),(-31,end),0,2.8,.60,finish)
        segment_wall(wall,(-31,start),(-31,end),2.8,3.07,.82,'graytile')
        if builder.collide:
            segment_wall(builder.hit,(-31,start),(-31,end),0,3.07,.60,'ashlar')
    with align_front(builder,(0,0),90,shift=(-31,8.05)):
        for side in (-1,1):
            box(wall,(side*1.23,1.70,0),(.48,3.40,.79),'wood')
            x = side*.50
            box(wall,(x,1.79,0),(.99,2.40,.20),'wood',None)
            for plank in range(1,5):
                box(wall,(x-.5+plank*.20,1.79,-.115),(.018,2.40,.03),'wood')
            box(wall,(x,.68,-.14),(.99,.12,.08),'yellow')
            oval(wall,(side*.18,1.85,-.17),(.08,.09,.05),'yellow',8)
            oval(wall,(side*.88,2.99,-.33),(.12,.18,.12),'vermilion',8)
            box(wall,(side*1.28,.49,-.94),(.32,.98,1.68),'ashlar')
        box(wall,(0,3.27,0),(3.52,.47,.91),'wood')
        box(wall,(0,3.49,0),(3.92,.28,1.76),'wood')
        garden_gate_roof(wall,(0,0),3.63,3.92,1.76,.40)
        for i in range(4):
            h = (i+1)*.15
            box(wall,(0,h/2,-1.8+(i+.5)*.45),(2.32,h,.46),'ashlar')
        # From the west, the stele is to the right (south) of the doorway.
        for y,w,h,d in ((.20,1.54,.40,.95),(.55,1.36,.30,.80),
                        (1.16,1.21,.96,.51),(1.71,1.40,.14,.72)):
            box(wall,(-2.46,y,-.68),(w,h,d),'coursed',None)
        box(wall,(2.34,.145,-.57),(1.46,.29,.56),'coursed',None)
        for x in (2.02,2.66):
            box(wall,(x,.90,-.58),(.59,1.27,.28),'ivywall',None)
        if builder.collide:
            solid(builder.hit,(0,1.7,0),(2.86,3.40,.66),'wood')
            ramp(builder.hit,(0,0,-1.8),(0,.6,0),2.32)
            solid(builder.hit,(-2.46,.84,-.68),(1.4,1.68,.75),'ashlar')
    # Masonry jambs bond into the two returns; the woodwork lines the opening.
    for left,right in ((-33.2,-29.58),(-27.42,-22.3)):
        segment_wall(wall,(left,-2.5),(right,-2.5),0,2.92,.60,'gate_plaster')
        segment_wall(wall,(left,-2.5),(right,-2.5),2.92,3.13,.80,'graytile')
        if builder.collide:
            segment_wall(builder.hit,(left,-2.5),(right,-2.5),0,3.13,.60,'ashlar')
    for jamb in (-30.04,-26.96):
        box(wall,(jamb,1.78,-2.5),(.92,3.56,.76),'gate_plaster')
    for post in (-29.52,-27.48):
        box(wall,(post,1.76,-2.87),(.20,3.52,.32),'wood')
    box(wall,(-28.5,3.36,-2.53),(3.98,.40,.78),'gate_plaster')
    box(wall,(-28.5,3.13,-2.87),(2.30,.22,.32),'wood')
    box(wall,(-28.5,3.52,-2.5),(4.52,.24,1.68),'wood')
    garden_gate_roof(wall,(-28.5,-2.5),3.59,4.52,1.68,.48)
    for step in range(4):
        height = .13 + .55*(step+1)/4
        box(wall,(-28.5,height/2,-6.2+(step+.5)*.875),(3.35,height,.875),'ashlar')
    if builder.collide:
        ramp(builder.hit,(-28.5,.13,-6.2),(-28.5,.68,-2.7),3.35)
    box(wall,(-24.55,.20,-3.25),(3.8,.40,1.7),'coursed',None)
    for x in (-25.4,-23.7):
        oval(wall,(x,1.10,-3.25),(1.1,.72,.82),'hedge',9)



def build(b: Builder):
    shops(b)
    approach(b)
    meshes = [*b.parts.values(), b.hit]
    starts = [len(mesh.pos) for mesh in meshes]
    ground = landmark_surface('gunanmen').ground
    # The eastern hall sits on way/684946200, the western hall on way/521248472.
    # Keep the plaza banyan on the west side of pedestrian way/684511179.
    ancient_banyan(b, -25.4, 5.1)
    # Trail map at the south edge of the gate plaza, facing its pedestrian path.
    with align_front(b, (-6, 12), 164):
        mesh = b.parts['atlas']
        for x in (-7.62, -4.38):
            box(mesh, (x, 1.28, 12), (.16, 2.56, .22), 'wood')
        box(mesh, (-6, 1.55, 12), (3.42, 1.96, .19), 'wood')
        board(mesh, -6, 1.55, 12.11, 3.12, 1.68, 'park_map')
        if b.collide:
            solid(b.hit, (-6, 1.55, 12), (3.42, 1.96, .19), 'wood')
    with align_front(b, (0, 0), -26.8, shift=(15, -7.2)):
        west_hall(b)
        # Centre the passage on the eastern hall inside the continuous terrace.
        with align_front(b, (0,0), 0, shift=(-1.45,-1.35)):
            gate(b)
    # Sample feet after rotating into landmark space. Keep the terrace and
    # gatehouse level, tapering the change up the battered masonry walls.
    terrace_datum = ground(15,-7.2)
    for mesh, start in zip(meshes, starts):
        for i in range(start, len(mesh.pos)):
            x, y, z = mesh.pos[i]
            blend = max(0, 1 - max(0, y) / 6.7)
            datum = terrace_datum
            if blend:
                datum += blend * (ground(x, z) - terrace_datum)
            mesh.pos[i] = (x, y + datum, z)


def west_hall(b):
    wall, deck = b.parts['atlas'], 6.7
    # The west hall occupies way/521248472. IMG_1304 and IMG_1313 show both
    # yellow halls above the same stone terrace, with the western roof lower.
    height = 3.5
    box(wall, (-16.3,deck+height/2,2.8), (12.5,height,8.2), 'yellow')
    box(wall,(-16.3,deck+height,2.8),(13.8,.26,9.45),'wood')
    # IMG_1304 shows a long low tiled ridge above the western hall.
    y = deck+height+.13
    eaves = [(x,y,z) for x,z in [(-23.2,-1.94),(-9.4,-1.94),(-9.4,7.54),(-23.2,7.54)]]
    ridge = [(-21.8,y+1.5,2.8),(-10.8,y+1.5,2.8)]
    for points, normal in [(eaves[:2]+ridge[::-1], (0,1,-1)),
                           (eaves[1:3]+[ridge[1]], (1,1,0)),
                           (eaves[2:]+ridge, (0,1,1)),
                           ([eaves[3],eaves[0],ridge[0]], (-1,1,0))]:
        wall.face(points,normal,'graytile',None)
    if b.detail:
        for x in (-20.5,-17.7,-14.9,-12.1):
            for z in (-1.32,6.92):
                grille(wall,x,deck+1.55,z,1.4,2.15,'lattice',3,depth=.13)


def south_stair(b, deck):
    wall = b.parts['atlas']
    start, end, z, width = -21.4, -6.0, 10.7, 2.9
    count = 40 if b.detail else 20
    first = len(wall.pos)
    for i in range(count):
        x = start + (end-start)*(i+.5)/count
        height = deck*(i+1)/count
        box(wall,(x,height/2,z),((end-start)/count,height,width),'coursed',None)
    # The upper landing returns north onto the terrace through a break in its rail.
    for mesh in ([wall,b.hit] if b.collide else [wall]):
        box(mesh,(end+1.3,deck/2,10.40),(2.6,deck,3.5),'coursed',None)
    left,top,w,h = RECTS['coursed']
    for i in range(first,len(wall.pos)):
        x,y,zp = wall.pos[i]
        if abs(wall.nrm[i][2])>.9:
            wall.uv[i]=((left+1+(w-2)*(x-start)/33)/ATLAS,
                        1-(top+1+(h-2)*(1-y/deck))/ATLAS)
    if b.collide:
        ramp(b.hit,(start,0,z),(end,deck,z),width)
    outside = z+width/2-.13
    for i in range(11):
        x = start + (end-start)*i/10
        y = deck*i/10
        box(wall,(x,y+.45,outside),(.24,.90,.24),'ashlar',None)
    for rise in (.36,.86):
        tube(wall,(start,rise,outside),(end,deck+rise,outside),.10,'ashlar',8)
    railing(wall,(end,outside),(end+2.45,outside),deck,.89,'ashlar',1.2,stone=True)
    railing(wall,(end+2.45,outside),(end+2.45,8.6),deck,.89,'ashlar',1.2,stone=True)
    # IMG_1313: the green coping obscures the bottom half of the flight.
    for mesh in ([wall,b.hit] if b.collide else [wall]):
        box(mesh,(-17,1.65,12.55),(15.6,3.3,.46),'courtstone',None)
    box(wall,(-17,3.35,12.55),(15.8,.16,.76),'glaze',None)
    if b.detail:
        for i in range(65):
            x=-24.85+i*.245
            for sign in (-1,1):
                tube(wall,(x,3.52,12.55),(x,3.39,12.55+sign*.39),.057,'glaze',6)
    tube(wall,(-24.9,3.47,12.55),(-9.1,3.47,12.55),.12,'glaze',8)


def north_planter(b, north):
    wall = b.parts['atlas']
    center = north-2.1
    # Capsule-shaped plan with a long straight crown and two semicircular ends.
    def ring(radius):
        outline = []
        for x,angle in ((-21.6,math.pi/2),(-2.95,-math.pi/2)):
            for i in range(13):
                theta = angle+math.pi*i/12
                outline.append((x+radius*math.cos(theta),center+radius*math.sin(theta)))
            # Subdivide the straight shoulder at the same leaf-texture scale as the ends.
            first = outline[-1]
            other = -2.95 if x==-21.6 else -21.6
            outline.extend((first[0]+(other-first[0])*j/24,first[1]) for j in range(1,24))
        return outline
    extrude(wall,ring(1.32)[::-1],0,.50,'granite',None)
    extrude(wall,ring(1.20)[::-1],.50,.93,'groundcover',None)
    if b.collide:
        extrude(b.hit,ring(1.30)[::-1],0,1.20,'granite',None)
    # Shrub crown rises from its broad shoulders to a narrow rounded top.
    def crown_point(x,z,y):
        ripple=.035*math.sin(1.7*x)+.024*math.cos(3*x+2*z)
        return (x,y+ripple,z)
    profiles = [(.88,1.00),(1.15,1.08),(1.38,.93),(1.54,.65),(1.61,.18)]
    for (y0,r0),(y1,r1) in zip(profiles,profiles[1:]):
        lower,upper = ring(r0),ring(r1)
        for i,a in enumerate(lower):
            j=(i+1)%len(lower)
            c=lower[j]
            wall.face([crown_point(*a,y0),crown_point(*c,y0),crown_point(*upper[j],y1),
                       crown_point(*upper[i],y1)],(c[1]-a[1],.1,a[0]-c[0]),'hedge',None)
    # Close the narrow crest in short strips, following the clipped foliage.
    crown=ring(.18)
    for i in range(12):
        for idx in (i,36+i):
            a,c=crown[idx],crown[idx+1]
            x=-21.6 if idx<12 else -2.95
            wall.face([crown_point(*a,1.61),crown_point(*c,1.61),crown_point(x,center,1.63)],(0,1,0),'hedge')
    for i in range(24):
        a,c=crown[12+i],crown[13+i]
        wall.face([crown_point(*a,1.61),crown_point(*c,1.61),
                   crown_point(c[0],center+.18,1.61),crown_point(a[0],center+.18,1.61)],
                  (0,1,0),'hedge')


def gate(b: Builder):
    wall = b.parts['atlas']
    detail = b.detail
    deck = 6.7
    courtyard(b, deck)
    # The northern portal narrows at the plaza. Both openings lead into
    # the same vaulted passage. Duplicate the profile in the collision mesh.
    north, south, west, east = -4.2, 11.85, -23.0, 8.4
    stair_back = 8.7
    portal_half = 3.4
    wall_start = len(wall.pos)
    radius = 3.6
    tangent = east-radius
    curve = [(tangent+radius*math.sin(math.pi*i/24),
              south-radius+radius*math.cos(math.pi*i/24)) for i in range(13)]
    for mesh in ([wall, b.hit] if b.collide else [wall]):
        start = len(mesh.pos)
        for low, high, opening, crown in ((north, north+.8, 2.6, 3.4),
                                          (north+.8, south, 3.6, 4.6)):
            arch_wall(mesh, (0, 0, (low+high)/2), 2*portal_half, deck, high-low,
                      opening, crown, 'coursed', 12 if detail else 6, tile=None)
        box(mesh, ((west-portal_half)/2,deck/2,(north+stair_back)/2),
            (-portal_half-west,deck,stair_back-north),'coursed',None)
        # Slice the east return into strips so the stone UVs and the top
        # remain continuous around the single quarter-round corner.
        for (x0,z0),(x1,z1) in zip([(portal_half,south),*curve],curve):
            extrude(mesh,[(x0,z0),(x1,z1),(x1,north),(x0,north)],0,deck,'coursed',None)
        left,top,w,h = RECTS['coursed']
        for i in range(start,len(mesh.pos)):
            x,y,z = mesh.pos[i]
            if mesh is wall and (z>=south-radius-.01 or x>=east-.01) and abs(mesh.nrm[i][1])<.01:
                run = x-west+max(0,south-z)
                mesh.uv[i]=((left+1+(w-2)*run/(east-west+south-north))/ATLAS,
                            1-(top+1+(h-2)*(1-y/deck))/ATLAS)
            # Batter the southern face 0.75 m over its height, leaving the
            # northern facade fixed. The arch and its jambs follow that plane.
            mesh.pos[i]=(x,y,z+.75*(1-y/deck)*(z-north)/(south-north))
    # Project the north-facing stone courses through the arch spandrel.
    # Faces in the vault retain the clean masonry texture.
    left, top, width, height = RECTS['ivywall']
    for i in range(wall_start,len(wall.pos)):
        x,y,z = wall.pos[i]
        if abs(z-north)<.001 and wall.nrm[i][2]<-.99:
            u = (x-west)/(east-west)
            wall.uv[i] = ((left+1+(width-2)*u)/ATLAS,
                          1-(top+1+(height-2)*(1-y/deck))/ATLAS)
    north_planter(b,north)
    south_stair(b,deck)
    # Gatehouse: yellow hall, vermilion colonnade, gray xieshan, stone rail on the terrace.
    box(wall, (0, deck + 1.55, 1.65), (11.8, 3.1, 7.25), 'yellow', 1.6)
    box(wall, (-6.05, deck + 1.55, 4.5), (0.42, 3.1, 4.6), 'yellow', 1.4)
    box(wall, (6.05, deck + 1.55, 4.5), (0.42, 3.1, 4.6), 'yellow', 1.4)
    if detail:
        for x in (-3.6, -1.2, 1.2, 3.6):
            grille(wall, x, deck + 1.9, 5.285, 1.2, 1.7, 'lattice', 3)
    columns = 6 if detail else 4
    for i in range(columns):
        x = -4.4 + 8.8 * i / (columns - 1)
        cylinder(wall, (x, deck, 6.35), 0.28, 3.05, 'vermilion', 10 if detail else 6, 0.7)
        box(wall, (x, deck + 3.1, 6.35), (0.62, 0.16, 0.62), 'vermilion', 0.3)
    box(wall,(0,deck+3.09,2.6),(14.7,.32,11.9),'wood')
    hip_roof(wall, (0, 2.6), deck + 3.15, 13.4, 10.2, 2.55, 1.15, 0.65, 'graytile', 'vermilion',ceiling=True)
    # Open door leaves rest against the interior returns of the southern portal.
    for side in (-1, 1):
        box(wall, (side*1.72,1.72,south-.9), (.12,3.44,1.65), 'door', None)
    # Follow the wall batter at both edges of the lintel plaque.
    wall.face([(x,y,south+.75*(1-y/deck)+.025) for x,y in
               [(-1.65,4.84),(1.65,4.84),(1.65,5.91),(-1.65,5.91)]],
              (0,.11,1),'sign_gate',uvs=[(.01,.99),(.99,.99),(.99,.01),(.01,.01)])
    if detail:
        for x in (-4.5,-1.5,1.5,4.5):
            grille(wall,x,deck+1.45,-1.99,1.18,2.20,'lattice',3,depth=.11)
    spacing = 1.45 if detail else 2.9
    perimeter = [(-6.0,stair_back-.25),(west+.3,stair_back-.25),(west+.3,north+.25),
                 (east-.3,north+.25)]
    perimeter += [(tangent+(radius-.3)*math.sin(math.pi*i/6),
                   south-radius+(radius-.3)*math.cos(math.pi*i/6)) for i in range(3,-1,-1)]
    perimeter.append((-3.4,south-.3))
    for a,c in zip(perimeter,perimeter[1:]):
        railing(wall,a,c,deck,.88,'white',spacing,stone=True)


def main():
    folder = Path(sys.argv[1])
    image = ensure_textures(folder)
    signs(image)
    slab_texture(image,896,896)
    stone_cells(image)
    RECTS['gate_plaster'] = (768,640,62,126)
    patch = ImageDraw.Draw(image)
    patch.rectangle((768,640,829,765),fill='#b57563')
    noise = random.Random(1306)
    for _ in range(1900):
        shade = noise.randint(-10,9)
        patch.point((noise.randrange(768,830),noise.randrange(640,766)),
                    fill=tuple(value+shade for value in (181,117,99)))
    RECTS['courtstone'] = (896,768,128,128)
    patch.rectangle((896,768,1023,895),fill='#b4b1a4')
    for row in range(18):
        for col in range(-1,19):
            x,y=896+col*8+(row%2)*4,768+row*7
            shade=noise.randrange(156,188)
            if x+6>=896 and x<=1023:
                patch.rectangle((max(896,x),y,min(1023,x+6),min(895,y+5)),
                                fill=(shade,shade-2,shade-10))
    for name,top,base in [('hedge',768,(164,195,55)),('groundcover',832,(82,116,48))]:
        RECTS[name] = (834,top+2,60,60)
        patch.rectangle((832,top,895,top+63),fill=base)
        for _ in range(2300):
            x,z = noise.randrange(833,893),noise.randrange(top+1,top+61)
            tone = noise.randrange(-31,31)
            patch.ellipse((x,z,x+2,z+2),fill=tuple(value+tone for value in base))
    RECTS['park_map'] = (640, 896, 256, 128)
    panel = Image.new('RGB', (256,128), '#efe8d4')
    draw = ImageDraw.Draw(panel)
    draw.polygon([(9,74),(40,54),(77,66),(100,89),(147,81),(170,105),
                  (153,118),(94,111),(53,88)], fill='#89bbb8')
    draw.ellipse((82,81,112,97), fill='#96a66b')
    draw.line([(32,49),(56,57),(76,63),(93,88)], fill='#b49972', width=3)
    draw.text((60,4),'榕湖游览图',font=_font(16),fill='#584537')
    for index, label in enumerate(('古南门','九曲桥','湖心岛')):
        draw.text((187,36+index*22),label,font=_font(11),fill='#514c41')
    image.paste(panel,(640,896))
    hi, lo = Builder(0, True), Builder(1, False)
    build(hi)
    build(lo)
    export_landmark(folder / 'gunanmen.glb', image, (('lod0', hi), ('lod1', lo)))
    near, far = tri_count(hi), tri_count(lo)
    print(f'gunanmen triangles lod0={near} lod1={far} ratio={far / near:.3f} collision={len(hi.hit)}')


if __name__ == '__main__':
    main()

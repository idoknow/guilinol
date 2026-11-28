"""Tiled roofs and curved eave profiles shared by the tower and gallery."""
import numpy as np
import trimesh


def tiled_roof(model, x, y, z, width, depth, rise, wing, ridge_fraction=.63, porch_recess=0, lit_edge=False, gable_material='wood', frame_gable=False, ornate=False, finial=False):
    # ornate: softer corner sweep, heavier ridges, curled corner rafters, wind
    # bells, rafter ends and gable louvres/xuanyu. finial: gourd crown and
    # chiwen on the main ridge (top eave only). Defaults leave output unchanged.
    # Cross-sections from the drip edge to the ridge. The last two have the
    # same span along the ridge, giving each end a vertical triangular gable.
    rings = [(1,1,0,wing),(.91,.84,.06*rise,.52*wing),
             (.78,.67,.23*rise,.19*wing),(ridge_fraction,.47,.48*rise,.065*wing),
             (ridge_fraction,.23,.72*rise,.055*wing),(ridge_fraction,.012,rise,.12*wing)]
    def point(side, u, ring):
        w,d,h,k=rings[ring]
        east,south=((u,-1),(1,u),(-u,1),(-1,-u))[side]
        # The main lower eave returns behind the projecting entrance gable.
        if porch_recess and side%2==0:
            inset=porch_recess*max(0,1-abs(u)*2.8)*max(0,1-ring/3)
            south*=1-inset/(d*depth/2)
        if ornate:
            # A gentle upturn over a deep overhang rather than a hooked horn.
            lift=k*.85*(.35*abs(u)**2+.65*abs(u)**3.2)
        else:
            lift=k*(.20*abs(u)**2+.80*abs(u)**5)
        return np.array([x+east*w*width/2,
                         y+h+lift,
                         z+south*d*depth/2])

    def rafters(side, span):
        # Square rafter ends under the fascia: an outward end face plus an
        # underside strip, four triangles per rafter in one mesh per slope.
        vertices,faces=[],[]
        for u in np.linspace(-1,1,max(4,round(span/.5))):
            if abs(u)>.88:
                continue
            a=point(side,u,0)-[0,.21,0]
            b=point(side,u,1)-[0,.17,0]
            c=a+(b-a)*.42
            along=point(side,u+.02,0)-point(side,u-.02,0)
            along/=np.linalg.norm(along)
            up=np.cross(a-c,along)
            if up[1]<0:
                along,up=-along,-up
            up/=np.linalg.norm(up)
            s,v=along*.055,up*.055
            n=len(vertices)
            vertices.extend([a-s-v,a+s-v,a+s+v,a-s+v,c-s-v,c+s-v])
            faces.extend([[n,n+1,n+2],[n,n+2,n+3],[n,n+4,n+5],[n,n+5,n+1]])
        if faces:
            model.mesh(np.array(vertices),faces,'wood')

    for side in range(4):
        span=width if side%2==0 else depth
        # One continuous sheet per slope with a rounded crest on each tile run.
        n=max(4,round(span/(.59 if model.detail else 2.8)))
        us=np.linspace(-1,1,2*n+1)
        for ring in range(len(rings)-1):
            gable=side%2==1 and ring>=3
            rows=[]
            for layer in (ring,ring+1):
                row=np.array([point(side,u,layer) for u in us])
                if model.detail and not gable:
                    row[1::2,1]+=.055
                rows.append(row)
            count=len(us)
            faces=[[i,i+1,i+count+1] for i in range(count-1)]
            faces.extend([[i,i+count+1,i+count] for i in range(count-1)])
            surface=np.concatenate(rows)
            model.mesh(surface,faces,gable_material if gable else 'tile')
            if not gable:
                # A smooth dark soffit needs only enough segments to follow the sweep.
                profile=np.linspace(-1,1,11 if model.detail else 7)
                underside=np.array([point(side,u,k) for k in (ring,ring+1) for u in profile])
                m=len(profile)
                quads=[[i,i+1,i+m+1] for i in range(m-1)]+[[i,i+m+1,i+m] for i in range(m-1)]
                model.mesh(underside-[0,.17,0],quads,'roof_soffit')
            if ring==0:
                edge=rows[0]
                model.mesh(np.concatenate([edge,edge-[0,.19,0]]),faces,'roof_soffit')
                if lit_edge and model.detail:
                    # Inset luminaires follow the eave, including the porch return.
                    lip=edge.copy()
                    lip[:,0]=x+.996*(lip[:,0]-x)
                    lip[:,2]=z+.996*(lip[:,2]-z)
                    model.mesh(np.concatenate([lip-[0,.18,0],lip-[0,.22,0]]),faces,'lamp')
                if ornate and model.detail:
                    rafters(side,span)
        # Raised diagonal hip ridges follow the same swept corner profile.
        for ring in range(3):
            a=point(side,-1,ring); b=point(side,-1,ring+1)
            model.beam(a+[0,.055,0],b+[0,.055,0],.12 if ornate else .094,'tile',6)
        tip=point(side,-1,0)
        direction=tip-np.array([x,tip[1],z])
        direction/=np.linalg.norm(direction)
        if ornate:
            # The corner rafter curls up in two short runs; a bell hangs below.
            p1=tip+direction*.25+[0,.18,0]
            p2=p1+direction*.12+[0,.22,0]
            model.beam(tip,p1,.09,'tile',6)
            model.beam(p1,p2,.065,'tile',6)
            if model.detail:
                model.beam(tip-[0,.05,0],tip-[0,.40,0],.012,'wood',3)
                model.beam(tip-[0,.40,0],tip-[0,.62,0],.075,'gold',8)
                model.beam(tip-[0,.62,0],tip-[0,.72,0],.025,'gold',4)
        else:
            model.beam(tip,tip+direction*.13+[0,.23,0],.085,'tile',6)
    if frame_gable:
        # Bargeboards outline the triangular upper gable above the hipped skirt.
        for side in (1,3):
            e=np.sign(point(side,0,3)[0]-x)
            offset=np.array([e*.06,0,0])
            for u in (-1,1):
                for k in (3,4):
                    model.beam(point(side,u,k)+offset,point(side,u,k+1)+offset,.10,'tile',6)
            base=point(side,0,3)+offset
            half=depth*.47/2
            for t in (-.58,0,.58):
                foot=base+[0,.04,half*t]
                head=foot+[0,(1-abs(t))*.48*rise,0]
                model.beam(foot,head,.068,'wood',4)
            if ornate and model.detail:
                # Horizontal louvres across the gable, behind the battens.
                rim=[point(side,1,k) for k in (3,4,5)]
                bottom,top=point(side,0,3)[1],point(side,0,5)[1]
                for t in (.2,.4,.6,.8):
                    level=bottom+(top-bottom)*t
                    reach=.85*np.interp(level,[p[1] for p in rim],[abs(p[2]-z) for p in rim])
                    model.beam([base[0],level,z-reach],[base[0],level,z+reach],.035,'wood',4)
                # Xuanyu hangs flat on the gable face from the apex, in front of
                # the central batten and bargeboards; shortened on low gables.
                apex=point(side,0,5)+[e*.18,0,0]
                scale=min(1,.8*(top-bottom)/1.3)
                bracket=apex-[0,.10*scale,0]
                model.beam(bracket-[e*.21,0,0],bracket,.045,'wood',6)
                model.beam(bracket,apex-[0,1.14*scale,0],.035,'gold',6)
                fish=[(0,-.05),(.28,-.45),(0,-1.05),(-.28,-.45),(0,-1.0),(.22,-1.3),(-.22,-1.3)]
                model.mesh([apex+[0,dy*scale,lateral*scale] for lateral,dy in fish],
                           [[0,1,2],[0,2,3],[4,5,6]],'gold')
    # Close the crown beneath the ridge; its raised ends leave the seam visible from above.
    profile=np.linspace(-1,1,11)
    crown=np.array([point(side,u if side==0 else -u,5) for side in (0,2) for u in profile])
    count=len(profile)
    model.mesh(crown,[[i,i+1,i+count+1] for i in range(count-1)]+
               [[i,i+count+1,i+count] for i in range(count-1)],'tile')
    # Bowed ridge and finials stand distinctly above the gable end.
    span=width*ridge_fraction/2
    nodes=[[x+span*u,y+rise+.14+.50*abs(u)**4,z] for u in np.linspace(-1,1,11)]
    ridge=.17 if ornate else .14
    for a,b in zip(nodes,nodes[1:]):
        model.beam(a,b,ridge,'tile',8)
    if finial:
        # Gourd crown (hulu) at the centre of the ridge.
        foot=np.array([x,y+rise+.14+ridge,z])
        seat=foot+[0,.30,0]
        model.beam(foot,seat,.34,'tile',10)
        gourd=trimesh.creation.icosphere(subdivisions=1 if model.detail else 0,radius=.36)
        model.mesh(gourd.vertices+seat+[0,.30,0],gourd.faces,'tile')
        if model.detail:
            neck=seat+[0,.63,0]
            model.beam(neck,neck+[0,.14,0],.11,'tile',8)
            crown=neck+[0,.34,0]
            gourd=trimesh.creation.icosphere(subdivisions=1,radius=.24)
            model.mesh(gourd.vertices+crown,gourd.faces,'tile')
            model.beam(crown+[0,.20,0],crown+[0,.70,0],.045,'tile',6)
    for sign in (-1,1):
        if finial and model.detail:
            # Chiwen: an upturned hook curling back over the ridge, with a dorsal fin.
            root=np.array([x+sign*span,y+rise+.60,z])
            hook=[root+[sign*s,h,0] for s,h in ((0,0),(.18,.32),(.12,.70),(-.10,.92),(-.28,.80))]
            for a,b,r in zip(hook,hook[1:],(.16,.14,.11,.08)):
                model.beam(a,b,r,'tile',6)
            model.mesh([root+[sign*s,h,0] for s,h in ((.10,.25),(.30,.60),(.05,.55))],[[0,1,2]],'tile')
        else:
            model.beam([x+sign*span,y+rise+.60,z],[x+sign*(span+.10),y+rise+.77,z],.09,'tile',6)

"""Tiled roofs and curved eave profiles shared by the tower and gallery."""
import numpy as np


def tiled_roof(model, x, y, z, width, depth, rise, wing, ridge_fraction=.63, porch_recess=0, lit_edge=False, gable_material='wood', frame_gable=False):
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
        return np.array([x+east*w*width/2,
                         y+h+k*(.20*abs(u)**2+.80*abs(u)**5),
                         z+south*d*depth/2])

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
                model.mesh(underside-[0,.17,0],quads,'wood')
            if ring==0:
                edge=rows[0]
                model.mesh(np.concatenate([edge,edge-[0,.19,0]]),faces,'wood')
                if lit_edge and model.detail:
                    # Inset luminaires follow the eave, including the porch return.
                    lip=edge.copy()
                    lip[:,0]=x+.996*(lip[:,0]-x)
                    lip[:,2]=z+.996*(lip[:,2]-z)
                    model.mesh(np.concatenate([lip-[0,.18,0],lip-[0,.22,0]]),faces,'lamp')
        # Raised diagonal hip ridges follow the same swept corner profile.
        for ring in range(3):
            a=point(side,-1,ring); b=point(side,-1,ring+1)
            model.beam(a+[0,.055,0],b+[0,.055,0],.094,'tile',6)
        tip=point(side,-1,0)
        direction=tip-np.array([x,tip[1],z])
        direction/=np.linalg.norm(direction)
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
    # Bowed ridge and finials stand distinctly above the gable end.
    span=width*ridge_fraction/2
    nodes=[[x+span*u,y+rise+.14+.50*abs(u)**4,z] for u in np.linspace(-1,1,11)]
    for a,b in zip(nodes,nodes[1:]):
        model.beam(a,b,.14,'tile',8)
    for sign in (-1,1):
        model.beam([x+sign*span,y+rise+.60,z],[x+sign*(span+.10),y+rise+.77,z],.09,'tile',6)

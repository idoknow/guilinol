"""Tiled roofs and curved eave profiles shared by the tower and gallery."""
import numpy as np


def tiled_roof(model, x, y, z, width, depth, rise, wing, ridge_fraction=.63, porch_recess=0):
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
        n=max(7,round(span/(.40 if model.detail else 1.15)))
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
            model.mesh(surface,faces,'wood' if gable else 'tile')
            if not gable:
                model.mesh(surface-[0,.17,0],faces,'wood')
            if ring==0:
                edge=rows[0]
                model.mesh(np.concatenate([edge,edge-[0,.19,0]]),faces,'wood')
        # Raised diagonal hip ridges follow the same swept corner profile.
        for ring in range(3):
            a=point(side,-1,ring); b=point(side,-1,ring+1)
            model.beam(a+[0,.055,0],b+[0,.055,0],.094,'tile',6)
        tip=point(side,-1,0)
        direction=tip-np.array([x,tip[1],z])
        direction/=np.linalg.norm(direction)
        model.beam(tip,tip+direction*.13+[0,.23,0],.085,'tile',6)
    # Bowed ridge and finials stand distinctly above the gable end.
    span=width*ridge_fraction/2
    nodes=[[x+span*u,y+rise+.14+.50*abs(u)**4,z] for u in np.linspace(-1,1,11)]
    for a,b in zip(nodes,nodes[1:]):
        model.beam(a,b,.14,'tile',8)
    for sign in (-1,1):
        model.beam([x+sign*span,y+rise+.60,z],[x+sign*(span+.10),y+rise+.77,z],.09,'tile',6)

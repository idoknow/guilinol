"""IMG_1344: street-facing ribbon windows and red corner awning, west facade."""
from xiaoyao_tower import generate


def office(model):
    model.box(0,-.45,0,43,4.35,7.4,'tile',True)
    model.box(0,3.9,0,43,12,7.4,'white',True)
    for level in range(4):
        bottom=4.55+3*level
        model.box(0,bottom,-3.76,40.7,1.7,.12,'glass')
        model.box(0,bottom-.13,-3.84,41,.13,.2,'granite')
        if model.detail:
            for station in range(-20,21,2):
                model.box(station,bottom,-3.86,.11,1.7,.11,'white')
        for end in (-21.53,21.53):
            model.box(end,bottom,0,.13,1.7,5.7,'glass')
    for station in range(-18,20,4):
        model.box(station,.48,-3.73,2.7,2.49,.13,'glass')
    model.box(-18.3,.03,-3.82,2.4,2.88,.12,'sign')
    model.box(-18.5,2.98,-4.17,6.6,.42,1.08,'red')
    model.box(-21.64,2.98,-2.61,.42,.42,3.9,'red')
    model.box(0,15.90,0,43.35,.32,7.65,'white')


if __name__=='__main__':
    generate('yiwu_office',office,colors=dict(tile='#292b2c',glass='#647681',white='#e3e2dc',red='#b53c38'),smooth=('red','tile'))

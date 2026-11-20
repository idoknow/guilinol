"""IMG_1344: street-facing ribbon windows and red corner awning, west facade."""
from xiaoyao_tower import generate
from c_kit import landmark_surface


def office(model):
    surface = landmark_surface('yiwu_office')
    model.pose=(0,0,-1.3,0)
    model.foundation(surface,0,-.45,1.3,43,4.35,10,'glass')
    model.box(0,3.32,1.3,43.12,.58,10.12,'earth')
    model.box(0,3.9,1.3,43,15,10,'white',True)
    for level in range(5):
        bottom=4.55+3*level
        model.box(0,bottom,-3.76,40.7,1.7,.12,'glass')
        model.box(0,bottom-.13,-3.84,41,.13,.2,'granite')
        if model.detail:
            for station in range(-20,21,2):
                model.box(station,bottom,-3.86,.11,1.7,.11,'white')
        for end in (-21.53,21.53):
            model.box(end,bottom,0,.13,1.7,5.7,'glass')
            for lateral in (-1.8,0,1.8):model.box(end*1.004,bottom,lateral,.10,1.7,.10,'white')
        model.box(-21.76,bottom-.59,1.8,.5,.54,1.06,'granite')
        for slat in range(4):model.box(-22.02,bottom-.54+.11*slat,1.8,.04,.045,.79,'sign')
    for station in range(-20,22,3):model.foundation(surface,station,0,-3.74,.13,3.32,.10,'tile')
    for lateral in (-2.2,0,2.2):model.foundation(surface,-21.54,0,lateral,.10,3.32,.13,'tile')
    model.foundation(surface,-20.95,0,-3.52,1.18,3.32,.52,'tile')
    for x in (-21.4,-18.4):
        model.box(x,3.05,-4.08,.09,.08,.94,'red')
    for z in (-3.65,-1.65):
        model.box(-21.77,3.05,z,1.0,.08,.09,'red')
    for offset in (.13,.41,.69):
        model.box(-19.9,3.02,-3.76-offset,3.65,.15,.12,'red')
        model.box(-21.5-offset,3.02,-2.65,.12,.15,2.5,'red')
    model.box(0,18.90,1.3,43.35,.32,10.25,'white')


if __name__=='__main__':
    generate('yiwu_office',office,colors=dict(tile='#292b2c',earth='#867b70',glass='#647681',white='#e3e2dc',red='#b53c38'),smooth=('red','tile'))

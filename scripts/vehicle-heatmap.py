"""North-up 32 m bins, colored by the worst wheel-contact error."""
import json
import sys
from PIL import Image, ImageDraw

data = json.load(sys.stdin)
left, top, width, depth = (n // 32 for n in data['extent'])
image = Image.new('RGB', (width, depth + 32), '#192027')
for key, delta in data['cells']:
    x, z = map(int, key.split(','))
    image.putpixel((x-left, z-top), (70, 182, 145) if delta <= .10 else
                   (255, 189, 73) if delta <= .25 else (245, 77, 78))
ImageDraw.Draw(image).text((8, depth + 8), 'Wheel error | green <=0.10m   amber <=0.25m   red >0.25m | 32m/pixel   N up', fill='white')
image.save(sys.argv[1])

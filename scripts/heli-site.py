"""Render a review overlay from an untracked OSM map extract (bbox in docs/helicopter-site.md)."""
import math
import sys
from pathlib import Path
from xml.etree import ElementTree as ET

root = ET.parse(sys.argv[1])
nodes = {node.get('id'): ((float(node.get('lon'))-110.3)*111320*math.cos(math.radians(25.28)),
                          -(float(node.get('lat'))-25.28)*110574) for node in root.findall('node')}
svg = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="-990 95 355 300" width="710" height="600">',
       '<rect x="-990" y="95" width="355" height="300" fill="#f8f7ee"/>']
for way in root.findall('way'):
    tags = {tag.get('k'): tag.get('v') for tag in way.findall('tag')}
    points = [nodes[ref.get('ref')] for ref in way.findall('nd')]
    if not any(-990 <= east <= -635 and 95 <= south <= 395 for east, south in points):
        continue
    coords = ' '.join(f'{east:.1f},{south:.1f}' for east, south in points)
    if way.get('id') == '1521982963':
        svg.append(f'<polygon points="{coords}" fill="none" stroke="#916eb6" stroke-width="1" stroke-dasharray="3 2"/>')
    elif 'building' in tags:
        svg.append(f'<polygon points="{coords}" fill="#b4b0a7" stroke="#746d60" stroke-width=".7"/>')
    elif 'highway' in tags:
        width = 1 if tags['highway'] in ('footway', 'path') else 4
        svg.append(f'<polyline points="{coords}" fill="none" stroke="#aa865b" stroke-width="{width}"/>')
svg += ['<circle cx="-824.4" cy="239.6" r="39.5" fill="none" stroke="#9cafa5"/>',
        '<circle cx="-824.4" cy="239.6" r="12.5" fill="#8dbac4"/>',
        '<circle cx="-808" cy="258" r="7.5" fill="#f3a536" stroke="#5b460d"/>',
        '<circle cx="-844" cy="208" r="2" fill="#1947a1"/>',
        '<g font-family="sans-serif" font-size="7"><text x="-842" y="204">Spawn</text><text x="-800" y="262">Helipad</text>',
        '<text x="-985" y="366">Brown: OSM roads / footpaths · Grey: buildings</text>',
        '<text x="-985" y="376">Violet: underground mall · Blue: authored fountain</text>',
        '<text x="-985" y="387">© OpenStreetMap contributors · north up · metres</text></g></svg>']
Path('docs/helicopter-site.svg').write_text('\n'.join(svg)+'\n')

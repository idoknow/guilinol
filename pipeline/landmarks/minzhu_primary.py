from pathlib import Path

from school_schematic import generate


if __name__ == '__main__':
    generate(Path(__file__).stem, Path(__file__).resolve().parents[1] / 'schools-g2.json')

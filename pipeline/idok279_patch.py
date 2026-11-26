"""Apply the final streetscape passes and pack a deterministic derived world."""
import argparse
from collections import Counter
import gzip
import hashlib
import json
from pathlib import Path
import tarfile

from audit_paved_trunks import audit
from check_campus_release import check_paving_delta, check_tree_delta
from paving_coverage import coverage
from lawn_grass import bake_grass


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def inventory(world):
    return {path.relative_to(world).as_posix(): digest(path) for path in sorted(world.rglob('*')) if path.is_file()}


def patch(world, reports):
    reports.mkdir(parents=True, exist_ok=True)
    paving, additions = coverage(world, apply=True)
    summary, removed = audit(world, apply=True)
    grass = bake_grass(world)
    for name, data in [('trunks', summary), ('deletions', removed), ('paving', paving), ('additions', additions)]:
        (reports / f'{name}.json').write_text(json.dumps(data, separators=(',', ':')))
    (reports/'grass.json').write_text(json.dumps(grass, separators=(',', ':')))
    return removed, additions, grass


def pack(world, archive):
    with archive.open('xb') as output, gzip.GzipFile(filename='', fileobj=output, mode='wb', mtime=0,
                                                      compresslevel=6) as compressed:
        with tarfile.open(fileobj=compressed, mode='w|', format=tarfile.USTAR_FORMAT) as tar:
            for path in sorted(world.rglob('*')):
                if path.is_file():
                    info = tarfile.TarInfo('world/' + path.relative_to(world).as_posix())
                    info.size = path.stat().st_size
                    with path.open('rb') as source:
                        tar.addfile(info, source)


def build(archive, expected, directory):
    if digest(archive) != expected:
        raise ValueError('Input world checksum mismatch')
    directory.mkdir(parents=True, exist_ok=True)
    if any(directory.iterdir()):
        raise ValueError('Output directory must be empty')
    with tarfile.open(archive, 'r:gz') as tar:
        for member in tar:
            if (not member.name.startswith('world/') or not (member.isfile() or member.isdir())
                    or '..' in Path(member.name).parts):
                raise ValueError(f'Unexpected archive entry: {member.name}')
            tar.extract(member, directory, filter='data')
    world = directory / 'world'
    before = inventory(world)
    original_manifest = json.loads((world/'manifest.json').read_bytes())
    removed, additions, grass = patch(world, directory / 'checks')
    after = inventory(world)
    changed = sorted(name for name in before.keys() | after.keys() if before.get(name) != after.get(name))
    allowed = set()
    deltas = {}
    for tile in original_manifest['chunks']:
        key = f"{tile['x']},{tile['z']}"
        grass_file = tile['file'].removesuffix('.glc')+'.grass'
        if grass_file in grass:
            tile['grass'] = grass_file
            allowed.add(grass_file)
        if key in additions:
            name = tile['file']
            deltas[name] = check_paving_delta, additions[key]
            tile['bytes'] = (world/name).stat().st_size
        if key in removed:
            name = str(Path(tile['file']).with_suffix('.trees'))
            deltas[name] = check_tree_delta, removed[key]
    if original_manifest != json.loads((world/'manifest.json').read_bytes()):
        raise ValueError('Unexpected manifest change')
    if additions or grass:
        allowed.add('manifest.json')
    allowed.update(deltas)
    if set(changed) != allowed:
        raise ValueError(f'Unapproved world changes: {sorted(set(changed)^allowed)}')
    with tarfile.open(archive, 'r|gz') as tar:
        for member in tar:
            name = member.name.removeprefix('world/')
            if name in deltas:
                check, rows = deltas[name]
                if not check(tar.extractfile(member).read(), (world/name).read_bytes(), rows):
                    raise ValueError(f'Unexpected delta: {name}')
    report = dict(input=expected, unchanged=len(before)-len(changed), byType=Counter(Path(name).suffix for name in changed),
                  files=[dict(file=name, before=before.get(name), after=after.get(name)) for name in changed])
    (directory/'checks/file-diff.json').write_text(json.dumps(report, separators=(',', ':')))
    output = directory / 'world.tar.gz'
    pack(world, output)
    print(digest(output), output.name)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=Path)
    parser.add_argument('sha256')
    parser.add_argument('directory', type=Path)
    args = parser.parse_args()
    build(args.archive, args.sha256, args.directory)

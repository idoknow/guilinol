"""Compare the serialized track, sign and cut layers, not unrelated street payloads."""
import argparse
import gzip
import json
from pathlib import Path
import struct


def layers(file):
    raw = gzip.decompress(file.read_bytes())
    magic, vertices, indices, size = struct.unpack_from('<4s3I', raw)
    if magic != b'GL04':
        raise ValueError(file)
    offset = 16924 + vertices * 9 + indices * 4
    text = raw[offset:offset+size].decode()
    decoder = json.JSONDecoder()
    fields = []
    start = 1
    while start < len(text)-1:
        _, end = decoder.raw_decode(text, start)
        fields.append(text[start:end])
        start = end+1
    return fields[4:7]


def compare(left, right):
    manifests = [json.loads((world/'manifest.json').read_bytes()) for world in (left, right)]
    files = [{row['file'] for row in manifest['chunks']} for manifest in manifests]
    differences = {}
    common = files[0] & files[1]
    for file in sorted(files[0] | files[1]):
        if file not in common:
            differences[file] = ['missing chunk']
            continue
        before, after = (layers(world/file) for world in (left, right))
        changed = [name for index, name in enumerate(('track', 'signs', 'cuts'))
                   if before[index:index+1] != after[index:index+1]]
        if changed:
            differences[file] = changed
    for key in ('railwayBranchGrade', 'stationCorridor'):
        if manifests[0][key] != manifests[1][key]:
            differences[key] = ['manifest']
    return dict(chunks=[len(group) for group in files], differences=differences)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('main', type=Path)
    parser.add_argument('candidate', type=Path)
    args = parser.parse_args()
    result = compare(args.main, args.candidate)
    print(json.dumps(result, indent=2))
    raise SystemExit(bool(result['differences']))

"""Render the four original G5 sketches. Requires Python 3 and ffmpeg."""
from array import array
from math import exp, pi, sin
from pathlib import Path
from subprocess import run
import sys

OUTPUT = Path(__file__).resolve().parents[1] / 'public/audio/radio'
RATE = 24000
SCORES = [
    ('bridge-wind', 84, 62, [0, 7, 9, 4, 2, 12, 7, 4], [0, -5, -3, -7]),
    ('boat-lights', 76, 65, [9, 4, 0, 7, 2, 4, 12, 9], [0, -3, -7, -5]),
    ('scooter-bell', 114, 57, [0, 3, 10, 7, 5, 3, 7, 12], [0, 5, 3, -2]),
    ('morning-stall', 106, 60, [7, 0, 5, 10, 3, 7, 2, 5], [0, -2, 3, 5]),
]


def note_time(pitch, seconds):
    return 2 * pi * 440 * 2 ** ((pitch - 69) / 12) * seconds


def render(name, bpm, root, motif, bass):
    beat = 60 / bpm
    duration = 32 * beat
    samples = array('h')
    for index in range(int(duration * RATE)):
        time = index / RATE
        step = int(time * 2 / beat)
        bar = step // 8
        offset = time - step * beat / 2
        bass_time = time % beat
        chord = bass[bar % 4]
        phase = note_time(root + chord + motif[(step + bar // 2) % 8], offset)
        pluck = (sin(phase) + .28 * sin(2 * phase)) * exp(-offset * 8) * min(1, offset * 160)
        low = sin(note_time(root - 12 + chord, bass_time)) * exp(-bass_time * 5) * min(1, bass_time * 80)
        pulse = sin(2 * pi * (47 * bass_time + 1.6 * (1 - exp(-30 * bass_time)))) * exp(-bass_time * 20)
        level = .29 * pluck + .23 * low + (.2 if bpm > 100 else .08) * pulse
        samples.append(round(30000 * level * min(1, time * 10, (duration - time) * 3)))
    if sys.byteorder != 'little':
        samples.byteswap()
    run(['ffmpeg', '-loglevel', 'error', '-y', '-f', 's16le', '-ar', str(RATE), '-ac', '1', '-i', '-',
         '-map_metadata', '-1', '-c:a', 'libmp3lame', '-b:a', '48k', str(OUTPUT / f'{name}.mp3')],
        input=samples.tobytes(), check=True)


if __name__ == '__main__':
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for score in SCORES:
        render(*score)

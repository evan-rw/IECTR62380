#!/usr/bin/env python3
"""Draw the page's small pixel-art accents and write them to assets/art/*.svg.

Each piece is original art: hand-drawn grids (one character per pixel) or a
swirl computed from polar coordinates. Pixels are written as SVG rectangles,
merged along each row, with crisp edges so they stay sharp at any zoom.

Run from the repository root: python3 tools/pixel_art.py
"""

import math
import os

OUT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'art')

# Hand-drawn 16×16 pieces. '.' is transparent.
FLAME = {
    'grid': [
        '................',
        '......K.........',
        '.....KRK........',
        '.....KRRK...K...',
        '....KROORK.KRK..',
        '....KROOORKRORK.',
        '...KRROYOORROOK.',
        '...KROOYYOOOOOK.',
        '..KRROYYYYOOORK.',
        '..KROOYYWYYOORK.',
        '..KROYYWWWYYORK.',
        '..KROYWWWWWYORK.',
        '..KROYYWWWYYORK.',
        '...KROYYYYYORK..',
        '....KRROOORRK...',
        '.....KKKKKKK....',
    ],
    'colours': {'K': '#3a0800', 'R': '#c41e00', 'O': '#ff7a00', 'Y': '#ffd83a', 'W': '#fff6c8'},
}

KEY = {
    'grid': [
        '................',
        '................',
        '................',
        '..KKKK..........',
        '.KYYYGK.........',
        'KYGKKGDK........',
        'KGK..KGKKKKKKKKK',
        'KGK..KGYYYYYYYGK',
        'KGK..KDGGGGGGGDK',
        'KDGKKGDKKKKGDKDK',
        '.KDDDDK....KDKDK',
        '..KKKK.....KKKKK',
        '................',
        '................',
        '................',
        '................',
    ],
    'colours': {'K': '#3a2600', 'Y': '#fff07a', 'G': '#e8b000', 'D': '#a86a00'},
}


def swirl(size, cx, cy, radius, period, colours, pixel):
    """Write a swirl disc into pixel[y][x]: three spiral bands and a bright core, with a
    one-pixel outline traced around the disc's edge."""
    inside = [[math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= radius for x in range(size)] for y in range(size)]
    for y in range(size):
        for x in range(size):
            dx, dy = x + 0.5 - cx, y + 0.5 - cy
            r = math.hypot(dx, dy)
            if inside[y][x]:
                if r < radius * 0.22:
                    pixel[y][x] = colours['core']
                else:
                    turn = (math.atan2(dy, dx) / (2 * math.pi) + r / period) % 1
                    pixel[y][x] = colours['bands'][int(turn * 3)]
            elif any(0 <= y + j < size and 0 <= x + i < size and inside[y + j][x + i]
                     for i, j in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                pixel[y][x] = colours['outline']


PORTALS = {
    'blue': {'outline': '#0a0a46', 'bands': ['#1a2ea8', '#3c6cf4', '#94bcff'], 'core': '#ffffff'},
    'cyan': {'outline': '#00363c', 'bands': ['#007e8a', '#12c6d6', '#a0f6ff'], 'core': '#ffffff'},
}


def from_grid(piece):
    return [[piece['colours'].get(ch) for ch in row] for row in piece['grid']]


def portal(name):
    pixel = [[None] * 16 for _ in range(16)]
    swirl(16, 8, 8, 6.9, 4.5, PORTALS[name], pixel)
    return pixel


def portal_on_floor():
    """64×64: a cyan portal over four gray floor tiles."""
    size, tile = 64, 32
    face, light, dark, line = '#c4c0b8', '#eceae4', '#86827a', '#5c5850'
    pixel = [[face] * size for _ in range(size)]
    for y in range(size):
        for x in range(size):
            tx, ty = x % tile, y % tile
            if tx == tile - 1 or ty == tile - 1:
                pixel[y][x] = line
            elif tx >= tile - 3 or ty >= tile - 3:
                pixel[y][x] = dark
            elif tx < 2 or ty < 2:
                pixel[y][x] = light
    swirl(size, 32, 32, 22, 13, PORTALS['cyan'], pixel)
    return pixel


def svg(pixel):
    h, w = len(pixel), len(pixel[0])
    rects = []
    for y, row in enumerate(pixel):
        x = 0
        while x < w:
            colour = row[x]
            run = 1
            while x + run < w and row[x + run] == colour:
                run += 1
            if colour:
                rects.append(f'<rect x="{x}" y="{y}" width="{run}" height="1" fill="{colour}"/>')
            x += run
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" '
            f'shape-rendering="crispEdges">' + ''.join(rects) + '</svg>\n')


def main():
    os.makedirs(OUT, exist_ok=True)
    pieces = {
        'flame': from_grid(FLAME),
        'key': from_grid(KEY),
        'portal-blue': portal('blue'),
        'portal-cyan': portal('cyan'),
        'portal-floor': portal_on_floor(),
    }
    for name, pixel in pieces.items():
        assert all(len(row) == len(pixel[0]) for row in pixel), name
        with open(os.path.join(OUT, f'{name}.svg'), 'w', encoding='utf-8') as f:
            f.write(svg(pixel))
    return pieces


if __name__ == '__main__':
    main()

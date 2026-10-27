#!/usr/bin/env python3
"""Draw the page's small pixel-art accents and write them to assets/art/*.svg.

Each piece is original art: hand-drawn grids (one character per pixel), or
the portal's concentric squares computed by ring depth. Pixels are written as SVG rectangles,
merged along each row, with crisp edges so they stay sharp at any zoom.

Run from the repository root: python3 tools/pixel_art.py
"""

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


# Portal: concentric square rings, blue outside, then cyan, alternating to the centre.
PORTAL_COLOURS = ('#0a3cff', '#00e4ff')


def portal_square(size, ring, pixel, x0=0, y0=0):
    """Write a size×size portal of rings `ring` pixels wide into pixel[y][x] at (x0, y0)."""
    for y in range(size):
        for x in range(size):
            depth = min(x, y, size - 1 - x, size - 1 - y) // ring
            pixel[y0 + y][x0 + x] = PORTAL_COLOURS[depth % 2]


def from_grid(piece):
    return [[piece['colours'].get(ch) for ch in row] for row in piece['grid']]


def portal():
    """16×16, one-pixel rings."""
    pixel = [[None] * 16 for _ in range(16)]
    portal_square(16, 1, pixel)
    return pixel


def portal_on_floor():
    """64×64: the portal at three times the size, on four gray floor tiles."""
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
    portal_square(48, 3, pixel, 8, 8)
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
        'portal': portal(),
        'portal-floor': portal_on_floor(),
    }
    for name, pixel in pieces.items():
        assert all(len(row) == len(pixel[0]) for row in pixel), name
        with open(os.path.join(OUT, f'{name}.svg'), 'w', encoding='utf-8') as f:
            f.write(svg(pixel))
    return pieces


if __name__ == '__main__':
    main()

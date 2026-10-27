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


# One boot in a three-quarter view: the shaft rises at the back right, the toe
# comes towards the viewer at about seven o'clock. Lit from the upper left; the
# ankle opening is a gray hole, darker at the back.
BOOT = {
    'grid': [
        '................',
        '.......KKKKKKK..',
        '......KLGGGGGLK.',
        '......KLgggggBK.',
        '......KHLLLBBDK.',
        '......KHHHHBDDK.',
        '......KHHHHBDDK.',
        '......KHHHHBDDK.',
        '.....KHHHHHBDDK.',
        '....KLHHHHHBDDK.',
        '...KLLHHHHBBDSK.',
        '..KLLHHHHBBBSK..',
        '.KLLHHHHBBBSSK..',
        '.KLHHHHBBSSKK...',
        '.KHHHBSSSKK.....',
        '..KSSSKKK.......',
    ],
    'colours': {'K': '#241000', 'G': '#4e4e4e', 'g': '#8a8a8a', 'L': '#f6d29a', 'H': '#e09a48', 'B': '#9a5418', 'D': '#6a3a10', 'S': '#4a2a10'},
}


# A DIP-8 chip from above: dark gray body with the pin-1 notch and dot at the
# top, four silver legs on each side.
CHIP = {
    'grid': [
        '................',
        '....KKKKKKKK....',
        '....KHHNNHHK....',
        '.PPPKHoBBBBKPPP.',
        '.pppKHBBBBBKppp.',
        '....KHBBBBBK....',
        '.PPPKHBBBBBKPPP.',
        '.pppKHBBBBBKppp.',
        '....KHBBBBBK....',
        '.PPPKHBBBBBKPPP.',
        '.pppKHBBBBBKppp.',
        '....KHBBBBBK....',
        '.PPPKHBBBBBKPPP.',
        '.pppKHBBBBBKppp.',
        '....KKKKKKKK....',
        '................',
    ],
    'colours': {'K': '#141414', 'H': '#6a6a6a', 'B': '#3c3c3c', 'N': '#1c1c1c', 'o': '#8c8c8c', 'P': '#dcdcdc', 'p': '#8c8c8c'},
}


# An inspector in a fedora, dark glasses and a trench coat with the collar up,
# all in cyan: he traces how failures travel through the structure.
DETECTIVE = {
    'grid': [
        '.....KKKKKK.....',
        '....KTTTTTTK....',
        '....KTDTTDTK....',
        '...KTTTTTTTTK...',
        '...KBBBBBBBBK...',
        '.KKTTTTTTTTTTKK.',
        '..KKssssssssKK..',
        '...KSGGSSGGSK...',
        '...KSSSSSSSSK...',
        '...KsSSSsSSsK...',
        '....KSsmmsSK....',
        '..KLLKSSSSKLLK..',
        'KLCCLKwkkwKLCCLK',
        'KCCCCLKkkKLCCCCK',
        'KCCCCcLKKLcCCCCK',
        'KCCCCcCCCCcCCCCK',
    ],
    'colours': {
        'K': '#0b2a2c', 'T': '#7fd8d8', 'D': '#3e9a9c', 'B': '#1c5a5c', 'S': '#eef4f2', 's': '#b8cccc',
        'G': '#0e1616', 'L': '#bff4f4', 'C': '#5cc4c6', 'c': '#2c8a8c', 'w': '#e8f0f0', 'k': '#183c3e', 'm': '#6c8686',
    },
}


# A circuit board: bright green traces on dark green, with a darker edge.
# Each trace is a polyline of horizontal, vertical and 45° segments.
BOARD_COLOURS = {'edge': '#1d4a14', 'board': '#2f6a22', 'trace': '#7cf25c'}
BOARD_TRACES = [
    [(1, 7), (5, 7)],                                # bus from the left
    [(2, 8), (2, 14)], [(4, 8), (4, 14)],            # a comb of tracks off the bottom
    [(5, 7), (10, 2), (14, 2)],                      # upper arm, up and off to the right
    [(5, 7), (7, 9), (9, 9), (14, 4)],               # lower arm, down, along, then up
    [(7, 14), (14, 7)],                              # a parallel run from the bottom edge
]


def circuit_board():
    """16×16 circuit-board tile."""
    size = 16
    pixel = [[BOARD_COLOURS['board']] * size for _ in range(size)]
    for i in range(size):
        for x, y in ((i, 0), (i, size - 1), (0, i), (size - 1, i)):
            pixel[y][x] = BOARD_COLOURS['edge']
    for line in BOARD_TRACES:
        for (x0, y0), (x1, y1) in zip(line, line[1:]):
            steps = max(abs(x1 - x0), abs(y1 - y0))
            dx, dy = (x1 > x0) - (x1 < x0), (y1 > y0) - (y1 < y0)
            for k in range(steps + 1):
                pixel[y0 + k * dy][x0 + k * dx] = BOARD_COLOURS['trace']
    return pixel


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
        'boot': from_grid(BOOT),
        'chip': from_grid(CHIP),
        'board': circuit_board(),
        'detective': from_grid(DETECTIVE),
        'portal-floor': portal_on_floor(),
    }
    for name, pixel in pieces.items():
        assert all(len(row) == len(pixel[0]) for row in pixel), name
        with open(os.path.join(OUT, f'{name}.svg'), 'w', encoding='utf-8') as f:
            f.write(svg(pixel))
    return pieces


if __name__ == '__main__':
    main()

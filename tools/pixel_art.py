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


# Right-pointing chevrons in repeating bands: black, dark green, bright green, white.
ARROW_BANDS = ('#101010', '#2f8a1e', '#7cf25c', '#f4f4f4')


def arrows(size=16, band=4):
    """16×16 tile of '>' chevrons, with a dark gray frame top and bottom."""
    pixel = [[None] * size for _ in range(size)]
    mid = (size - 1) / 2
    for y in range(size):
        for x in range(size):
            if y in (0, size - 1):
                pixel[y][x] = '#5a5a5a'
                continue
            s = x + abs(y - mid)
            pixel[y][x] = ARROW_BANDS[int(s // band) % len(ARROW_BANDS)]
    return pixel


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


# A beetle seen from above, head to the right: a yellow striped body, a white
# head, and red legs that run in over the body towards the middle.
def bug(size=16):
    import math
    pixel = [[None] * size for _ in range(size)]
    body = lambda x, y: ((x + 0.5 - 6.5) / 5.6) ** 2 + ((y + 0.5 - 8) / 4.1) ** 2 <= 1
    head = lambda x, y: math.hypot(x + 0.5 - 12.6, y + 0.5 - 8) <= 2.3
    for y in range(size):
        for x in range(size):
            if body(x, y):
                pixel[y][x] = '#a68c12' if x in (3, 5, 7) else '#f2d832'
            elif head(x, y):
                pixel[y][x] = '#f4f4f4'
    # A one-pixel dark outline around body and head.
    for y in range(size):
        for x in range(size):
            if pixel[y][x] is None and any(0 <= y + j < size and 0 <= x + i < size and pixel[y + j][x + i] not in (None, '#2a1a00')
                                           for i, j in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                pixel[y][x] = '#2a1a00'
    # A dark collar between body and head.
    for y in range(6, 10):
        pixel[y][11] = '#2a1a00'
    # Three legs a side, from the edge of the tile in towards the thorax.
    legs = [[(2, 1), (5, 4), (6, 5)], [(8, 0), (8, 3)], [(13, 1), (10, 4), (9, 5)]]
    for leg in legs:
        for mirror in (False, True):
            pts = [(x, size - 1 - y) if mirror else (x, y) for x, y in leg]
            for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
                steps = max(abs(x1 - x0), abs(y1 - y0))
                for k in range(steps + 1):
                    pixel[y0 + round(k * (y1 - y0) / steps)][x0 + round(k * (x1 - x0) / steps)] = '#d42412'
    return pixel


# A round bomb with a lit fuse, for the capacitors that wear out on a timer:
# a dark body with a gray highlight, a metal cap at the top right, and a spark.
def bomb(size=16):
    import math
    pixel = [[None] * size for _ in range(size)]
    cx, cy, r = 7.0, 9.4, 5.4
    for y in range(size):
        for x in range(size):
            d = math.hypot(x + 0.5 - cx, y + 0.5 - cy)
            if d <= r:
                pixel[y][x] = '#2c2c34'
                if math.hypot(x + 0.5 - 5.0, y + 0.5 - 7.2) <= 1.9:
                    pixel[y][x] = '#8c8c98'
    pixel[6][4] = '#e4e4ec'
    # The cap the fuse comes out of.
    for x, y in ((10, 3), (11, 3), (10, 4), (11, 4), (12, 4), (11, 5)):
        pixel[y][x] = '#9a9aa4'
    pixel[3][10] = '#d0d0d8'
    # A one-pixel black outline around body and cap.
    for y in range(size):
        for x in range(size):
            if pixel[y][x] is None and any(0 <= y + j < size and 0 <= x + i < size and pixel[y + j][x + i] not in (None, '#000000')
                                           for i, j in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                pixel[y][x] = '#000000'
    # The fuse, and its spark.
    for x, y in ((12, 2), (13, 1)):
        pixel[y][x] = '#d8a860'
    for x, y in ((14, 0), (15, 1), (13, 0), (15, 0)):
        pixel[y][x] = '#ff7a00'
    pixel[0][14] = '#ffd83a'
    pixel[1][14] = '#fff6c8'
    return pixel


def flame_square(size=16):
    """A square of fire, twisted so its corners curl: red-orange outside, a yellow ring, a dark red heart."""
    import math
    pixel = [[None] * size for _ in range(size)]
    mid = size / 2
    for y in range(size):
        for x in range(size):
            px, py = x + 0.5 - mid, y + 0.5 - mid
            r = math.hypot(px, py)
            turn = 0.45 + 0.09 * r
            u = px * math.cos(turn) + py * math.sin(turn)
            v = -px * math.sin(turn) + py * math.cos(turn)
            m = max(abs(u), abs(v))
            if m < 1.6:
                pixel[y][x] = '#a81800'
            elif m < 3.4:
                pixel[y][x] = '#ffd82a'
            elif m < 5.2:
                pixel[y][x] = '#e8461a'
            elif m < 6.1:
                pixel[y][x] = '#7a1000'
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
        'arrows': arrows(),
        'bug': bug(),
        'fire-square': flame_square(),
        'bomb': bomb(),
        'portal-floor': portal_on_floor(),
    }
    for name, pixel in pieces.items():
        assert all(len(row) == len(pixel[0]) for row in pixel), name
        with open(os.path.join(OUT, f'{name}.svg'), 'w', encoding='utf-8') as f:
            f.write(svg(pixel))
    return pieces


if __name__ == '__main__':
    main()

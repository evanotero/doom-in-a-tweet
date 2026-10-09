"""Render the card poster (twitter:image) from the shareware WAD's TITLEPIC.

    python scripts/make_poster.py wad/doom1.wad site/poster.png

Stdlib only. Output is 1280x960: 320x200 scaled 4x wide and 4.8x tall, which
corrects for Doom's non-square pixels (4:3 on a CRT).
"""

import struct
import sys
import zlib

OUT_W, OUT_H = 1280, 960


def read_lumps(path):
    data = open(path, "rb").read()
    ident, numlumps, diroff = struct.unpack_from("<4sii", data, 0)
    assert ident in (b"IWAD", b"PWAD"), ident
    lumps = {}
    for i in range(numlumps):
        off, size, name = struct.unpack_from("<ii8s", data, diroff + i * 16)
        lumps[name.rstrip(b"\0").decode()] = data[off : off + size]
    return lumps


def decode_patch(lump, palette):
    width, height, _, _ = struct.unpack_from("<hhhh", lump, 0)
    pixels = [[(0, 0, 0)] * width for _ in range(height)]
    for x in range(width):
        (col_off,) = struct.unpack_from("<i", lump, 8 + x * 4)
        p = col_off
        while lump[p] != 0xFF:
            top, length = lump[p], lump[p + 1]
            for i in range(length):
                pixels[top + i][x] = palette[lump[p + 3 + i]]
            p += length + 4
    return width, height, pixels


def write_png(path, w, h, rows):
    raw = b"".join(b"\0" + bytes(c for px in row for c in px) for row in rows)

    def chunk(tag, body):
        return struct.pack(">I", len(body)) + tag + body + struct.pack(">I", zlib.crc32(tag + body))

    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)))
        f.write(chunk(b"IDAT", zlib.compress(raw, 9)))
        f.write(chunk(b"IEND", b""))


def main(wad_path, out_path):
    lumps = read_lumps(wad_path)
    pal = lumps["PLAYPAL"]
    palette = [tuple(pal[i * 3 : i * 3 + 3]) for i in range(256)]
    w, h, pixels = decode_patch(lumps["TITLEPIC"], palette)
    rows = [[pixels[y * h // OUT_H][x * w // OUT_W] for x in range(OUT_W)] for y in range(OUT_H)]
    write_png(out_path, OUT_W, OUT_H, rows)
    print(f"wrote {out_path} ({OUT_W}x{OUT_H}) from TITLEPIC {w}x{h}")


if __name__ == "__main__":
    main(*sys.argv[1:3])

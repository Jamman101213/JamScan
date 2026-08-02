# JamScan format

JamScan uses two related formats:

- The `.jscan` package stores metadata and the original payload.
- The visual protocol sends that package through changing optical mosaics.

## `.jscan` package

```text
6 bytes   Magic and package version
4 bytes   Metadata length, little endian
N bytes   UTF-8 JSON metadata
N bytes   Original payload
```

The magic bytes are:

```text
4A 53 43 41 4E 01
```

## Stable 64-tile mosaic

The default visual frame is a 252 by 252 logical-module square:

```text
11 modules   Corner marker size
14 modules   Outer marker and tile margin
28 modules   Tile width and height
8 by 8       Tile count
64           Total tiles
```

The tiles touch directly. No divider modules are inserted between them.

Each stable tile contains a complete 36-byte optical header and a 40-byte fountain repair payload. Header and payload CRC-32 values allow damaged tiles to be skipped.

## Experimental dense mosaic container

Both dense formats use a 640 by 640 logical-module outer square.

The container includes:

- Four corner locator markers.
- One 32-byte stream header repeated at the top, right, bottom, and left.
- One seamless central data grid with no internal divider lines.

The repeated header stores:

```text
Bytes 0-1    Dense magic D5 3A
Byte 2       Dense protocol version 05
Byte 3       Density profile ID
Byte 4       Header side ID
Byte 5       Reserved
Bytes 6-9    Base sequence number, little endian
Bytes 10-13  Source block count, little endian
Bytes 14-15  Source block size, little endian
Bytes 16-19  Complete package length, little endian
Bytes 20-23  Stream ID, little endian
Bytes 24-27  Complete package CRC-32, little endian
Bytes 28-31  Header CRC-32, little endian
```

Repeating the header on all four sides allows the scanner to determine rotation before reading the compact tile grid.

## 1024 experimental profile

```text
Profile ID       1
Grid             32 by 32
Data tiles       1024
Tile size        15 by 15 modules
Fountain block   24 bytes
Tile checksum    CRC-16/CCITT
```

Each tile stores 24 payload bytes followed by a 2-byte CRC-16 value. Remaining cells are deterministic filler.

## 4028 experimental profile

```text
Profile ID       2
Grid             64 by 63
Grid positions   4032
Reserved corners 4
Data tiles       4028
Tile size        9 by 9 modules
Fountain block   8 bytes
Tile checksum    CRC-16/CCITT
```

The four data-grid corner positions are reserved, producing exactly 4028 compact data tiles. Each tile stores 8 payload bytes followed by a 2-byte CRC-16 value. One remaining cell is deterministic filler.

## Scanner steps

1. Read one camera image.
2. Try the previously locked mosaic corners.
3. If needed, search for the four outer locator markers.
4. Correct perspective for the complete mosaic.
5. Look for a valid repeated dense header.
6. If a dense header is found, select its 1024 or 4028 profile and rotation.
7. Sample every known compact tile position.
8. Accept compact tiles whose CRC-16 values pass.
9. If no dense header is found, try the stable 64-tile format.
10. Continue until the fountain decoder solves all source blocks.
11. Verify package length, package CRC-32, and payload SHA-256.

A camera image does not need to decode every tile. Partial mosaics remain useful because later mosaics provide new fountain repair data.

## Repair stream

The optical protocol is continuous and has no required first frame. Every displayed mosaic uses a new base sequence number. The receiver can begin at any point and continue until enough fountain equations have been collected.

The fountain implementation in `assets/js/fountain.js` is adapted from Decimen Optical Transfer under its MIT License.

JamScan's optical formats and `.jscan` package are not wire-compatible with Decimen Optical Transfer.

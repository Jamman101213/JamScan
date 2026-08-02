# JamScan format

JamScan uses two related formats:

- The `.jscan` package stores metadata and the original payload.
- The visual protocol sends that package through changing 64-tile mosaics.

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

## Mosaic layout

The default visual frame is a 252 by 252 logical-module square:

```text
11 modules   Corner marker size
14 modules   Outer marker and tile margin
28 modules   Tile width and height
8 by 8       Tile count
64           Total tiles
```

The 64 tiles touch directly. No divider modules are inserted between them.

Four 11 by 11 corner markers are placed at the outer corners. Each marker has a two-module black outer ring and a three-by-three black center. White space between the markers and tile area prevents the markers from connecting to tile data.

## Tile packet

Each tile stores one complete fountain frame packet:

```text
36 bytes   Frame header
40 bytes   Fountain repair payload
76 bytes   Total meaningful tile data
```

The remaining tile cells contain deterministic filler bits. Filler makes the black-and-white balance stable but is not part of the payload.

## Visual header version 4

```text
Bytes 0-1    Magic A5 5A
Byte 2       Protocol version 04
Byte 3       Frame type 03
Bytes 4-7    Sequence number, little endian
Bytes 8-11   Source block count, little endian
Bytes 12-13  Source block size, little endian
Bytes 14-15  Reserved
Bytes 16-19  Complete package length, little endian
Bytes 20-23  Stream ID, little endian
Bytes 24-27  Complete package CRC-32, little endian
Bytes 28-31  Repair payload CRC-32, little endian
Bytes 32-35  Header CRC-32, little endian
```

The source block size is 40 bytes in the 64-tile mosaic release.

## Scanner steps

1. Read one camera image.
2. Try the previously locked mosaic corners.
3. If needed, search for the four large corner markers.
4. Estimate the complete mosaic quadrilateral.
5. Correct perspective for the whole mosaic.
6. Sample the 64 fixed tile positions.
7. Try rotation and mirroring for each tile.
8. Validate tile magic, header CRC, and payload CRC.
9. Accept every clean new sequence number.
10. Skip damaged or duplicate tiles.
11. Continue until the fountain decoder solves all source blocks.
12. Verify package length, package CRC-32, and payload SHA-256.

A camera image does not need to decode all 64 tiles. Partial mosaics are useful and later mosaics provide new repair data.

## Repair stream

The visual protocol is continuous and has no required start marker or fixed ending. Every tile is self-describing and can create or join a session using its stream ID and package metadata.

JamScan uses an LT fountain encoder with a robust-soliton degree distribution. The fountain implementation in `assets/js/fountain.js` is adapted from Decimen Optical Transfer under its MIT License.

JamScan's visual mosaic and `.jscan` package are not wire-compatible with Decimen Optical Transfer.

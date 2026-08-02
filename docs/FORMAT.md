# JamScan format

JamScan uses two related formats:

- The `.jscan` package stores metadata and the original payload.
- The visual frame protocol sends that package through animated dot frames.

## `.jscan` package

The package uses this order:

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

The metadata contains:

- `app`
- `version`
- `name`
- `type`
- `kind`
- `size`
- `created`
- `sha256`

## Visual grid

Protocol version 3 uses a 72 by 72 displayed grid:

```text
4 cells   White quiet zone
2 cells   Black locator border
2 cells   White separator
56 cells  Data grid
2 cells   White separator
2 cells   Black locator border
4 cells   White quiet zone
```

The four 8 by 8 corners of the 56 by 56 data grid are reserved for finder markers. The remaining cells store the frame header and payload bits.

The black locator border is separated from the data by white cells. This lets the scanner find the square as a connected shape, estimate its four corners, and correct rotation and perspective before reading data.

## Visual header version 3

```text
Byte 0      Magic A5
Byte 1      Magic 5A
Byte 2      Protocol version 03
Byte 3      Frame type
Bytes 4-6   Data index, little endian
Bytes 7-9   Total data frame count, little endian
Bytes 10-11 Payload length, little endian
Bytes 12-15 Stream ID, little endian
Bytes 16-19 Cycle number, little endian
Bytes 20-23 Sequence number, little endian
Bytes 24-27 Payload CRC-32, little endian
Bytes 28-31 Header CRC-32, little endian
```

Frame types:

```text
0 Start marker
1 Data frame
2 End marker
```

Start and end markers carry a 12-byte marker payload:

```text
Bytes 0-3   Package length, little endian
Bytes 4-7   Complete package CRC-32, little endian
Bytes 8-9   Data block size, little endian
Byte 10     Protocol version
Byte 11     Flags
```

Data frames carry up to 320 package bytes.

## Loop rules

Each loop contains:

1. A visible start-marker period
2. Every data frame
3. An end-marker period

The Make page calculates the marker repeat count from the selected frame rate. The start marker remains visible for about 0.7 seconds so a camera that begins in the middle can reliably lock onto the next loop.

The scanner does not accept data until it reads a valid start marker. It stores data by its data index, so duplicate frames are ignored and later loops can fill missing indexes.

Sequence gaps are counted as missed flashes. A cycle change without a start marker makes the scanner wait for the next valid start marker.

Small streams repeat their data frames within the same cycle. This improves short transfers where missing one of only a few frames would otherwise force another full loop.

## Scanner rules

The scanner:

1. Finds the separate black locator border.
2. Estimates the four corners of the square.
3. Corrects scale, rotation, and perspective.
4. Samples the 56 by 56 data grid.
5. Tries normal, rotated, and mirrored directions.
6. Checks the finder pattern.
7. Checks the header CRC-32.
8. Checks the payload CRC-32.
9. Applies the start, data, and end sequence rules.

After a successful lock, the previous corner positions are tried first on the next camera frame. A full image search is only needed again when the lock is lost.

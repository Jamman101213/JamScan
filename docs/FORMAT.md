# JamScan format

This document describes the `.jscan` package and visual protocol used by this version of JamScan.

## `.jscan` package

A `.jscan` file contains:

1. Six magic bytes: `JSCAN` followed by version byte `1`
2. A four-byte little-endian JSON metadata length
3. UTF-8 JSON metadata
4. Raw payload bytes

Metadata fields include:

- `app`
- `version`
- `name`
- `type`
- `kind`
- `size`
- `created`
- `sha256`

The payload SHA-256 value is checked when a package is opened or reconstructed.

## Visual protocol version 3

Visual frames use a 48 by 48 data grid inside a 58 by 58 displayed module area.

The displayed area contains:

- A white outer margin
- A solid black locator border
- A white separator
- The 48 by 48 data grid

Four 8 by 8 finder markers occupy the corners of the data grid. The finder cells are reserved and are not part of the byte payload.

The remaining data area stores 256 bytes. Each frame uses:

- 28 bytes for the frame header
- Up to 224 bytes for the frame payload

## Frame header

| Offset | Size | Field |
|---|---:|---|
| 0 | 2 | Magic bytes `A5 5A` |
| 2 | 1 | Visual protocol version `3` |
| 3 | 1 | Frame type |
| 4 | 3 | Data index |
| 7 | 3 | Total data-frame count |
| 10 | 2 | Payload length |
| 12 | 4 | Stream ID |
| 16 | 4 | Cycle number |
| 20 | 4 | Sequence number |
| 24 | 4 | Payload CRC-32 |

Frame types are:

- `0` - Start marker
- `1` - Data frame
- `2` - End marker

Start and end markers carry an eight-byte payload:

- Four-byte complete package length
- Four-byte complete package CRC-32

## Loop order

Each loop contains:

1. Three start markers
2. Every data frame, each displayed twice
3. Two end markers

Later loops begin at a different data index. This changes the order and helps recover frames missed because of display and camera timing.

## Scanner rules

- Data frames are ignored until a valid start marker is received.
- A repeated start marker may begin a session even if the first start marker was missed.
- Sequence gaps count missed displayed frames.
- Duplicate data indexes are ignored.
- Missing data remains stored across later loops.
- A new cycle is not accepted until its start marker is received.
- Every frame payload must pass CRC-32.
- The reconstructed package must match its expected length and package CRC-32.
- The final `.jscan` payload must pass SHA-256.

## Image decoding

The scanner:

- Searches several centered crop sizes and offsets
- Remembers the last successful crop
- Uses the locator border for contrast and alignment checks
- Tries four rotations
- Tries mirrored and non-mirrored orientations
- Uses a global threshold based on sampled dark and light modules

The current decoder does not perform full perspective correction. The camera and source display should remain roughly parallel.

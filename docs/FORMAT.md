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

Each visual frame uses a 64 by 64 black-and-white grid.

The four 8 by 8 corners are reserved for finder markers. The remaining cells store the frame header and payload bits.

## Visual header version 2

```text
Byte 0      Magic A5
Byte 1      Magic 5A
Byte 2      Protocol version 02
Byte 3      Frame type
Bytes 4-6   Data index, little endian
Bytes 7-9   Total data frame count, little endian
Bytes 10-11 Payload length, little endian
Bytes 12-15 Stream ID, little endian
Bytes 16-19 Cycle number, little endian
Bytes 20-23 Sequence number, little endian
Bytes 24-27 Payload CRC-32, little endian
```

Frame types:

```text
0 Start marker
1 Data frame
2 End marker
```

Start and end markers carry an 8-byte marker payload:

```text
Bytes 0-3 Package length, little endian
Bytes 4-7 Complete package CRC-32, little endian
```

Data frames carry up to 448 package bytes.

## Loop rules

Each loop contains:

1. Repeated start markers
2. Every data frame
3. Repeated end markers

The scanner does not accept data until it reads a valid start marker. It stores data by its data index, so repeated frames are ignored and later loops can fill missing indexes.

Sequence gaps are counted as missed flashes. A cycle change without a start marker makes the scanner wait for the next valid start marker.

The data starting offset changes between cycles. Start and end marker repeat counts also change slightly to reduce refresh-rate lockstep.

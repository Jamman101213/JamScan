# JamScan format

JamScan uses two related formats:

- The `.jscan` package stores metadata and the original payload.
- The visual protocol sends that package through changing dot codes.

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

## Visual flash

A visual flash can contain:

- 1 code
- 2 codes
- 4 codes

Every code is independent. A camera image can therefore add several useful repair frames at once.

Four-code mode uses a two-by-two layout. Two-code mode uses two columns. White space separates the locator borders so the scanner can find each code as a separate connected shape.

## Visual grid

Protocol version 4 uses a 72 by 72 displayed grid for each code:

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

The locator border is separated from the data by white cells. This lets the scanner find the square, estimate its corners, and correct rotation and perspective.

## Visual header version 4

Every visual code carries a 36-byte header:

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

The payload is one 320-byte fountain block. The final source block is padded before fountain encoding. The package length in the header removes the padding after recovery.

## Repair stream

The visual protocol is continuous and does not have a required start marker or fixed ending.

Every frame is self-describing. The first valid frame seen by the scanner creates or joins a session using:

- Stream ID
- Source block count
- Source block size
- Complete package length
- Complete package CRC-32

JamScan uses an LT fountain encoder with a robust-soliton degree distribution:

- Each sequence number deterministically selects a degree and a set of source blocks.
- The transmitted repair payload is the XOR of those selected source blocks.
- The same stream ID and sequence number always select the same source blocks.
- The sender can continue producing new repair codes without a fixed ending.

The decoder removes already solved blocks from each XOR equation. When an equation has one unknown block left, that block is solved and applied to other pending equations. The fountain implementation in `assets/js/fountain.js` is adapted from Decimen Optical Transfer under its MIT License.

The stream continues without a fixed frame count. This lets later frames repair information lost when the camera misses earlier display updates.

JamScan wraps the adapted fountain logic in its own dot-grid frame and package protocol. The resulting visual stream is not wire-compatible with Decimen Optical Transfer.

## Sequence gaps

The scanner records gaps between observed sequence numbers. A gap means one or more displayed codes were not decoded.

A sequence gap does not make the transfer fail. The receiver continues collecting direct and repair codes until all source blocks are solved.

Duplicate sequence numbers are ignored.

## Scanner rules

The scanner:

1. Reads one camera image.
2. Tries recently locked code positions first.
3. Searches the full image for additional locator borders.
4. Finds up to four codes.
5. Estimates the four corners of each code.
6. Corrects scale, rotation, mirroring, and perspective.
7. Samples each 56 by 56 data grid.
8. Checks the finder patterns.
9. Checks each header CRC-32.
10. Checks each repair payload CRC-32.
11. Adds every new sequence to the fountain decoder.
12. Verifies the recovered package length and CRC-32.
13. Verifies the original payload SHA-256 value.

After a successful lock, the previous corner positions are tried first on the next camera frame. A full search is still used to find other codes or recover from movement.

## Content warning

Package recovery does not immediately show the content. JamScan displays the claimed content type, file name, size, and integrity result before the user chooses whether to continue.

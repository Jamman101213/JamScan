# JamScan format

## `.jscan` package

A `.jscan` file contains:

1. Six-byte magic value: `JSCAN2`
2. Unsigned little-endian 32-bit metadata length
3. UTF-8 JSON metadata
4. Stored payload bytes

The metadata records the original name, MIME type, byte size, SHA-256 digest,
and whether the stored payload uses gzip compression.

## Optical frame

Each QR packet contains a 21-byte little-endian header followed by one fountain
block:

- 2 bytes protocol magic, `J3`
- 2 bytes session ID
- 4 bytes sequence number
- 2 bytes source-block count
- 2 bytes block length
- 4 bytes total package length
- 4 bytes FNV-1a checksum of the complete `.jscan` package
- 1 byte sender channel count: 1, 2, or 4

Every QR shown at the same time has the same session settings but a different
sequence number. The receiver may use the packets in any order and may recover
the file even when only some codes from each camera image are readable.

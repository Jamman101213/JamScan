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

Each QR frame contains a 20-byte little-endian header followed by one fountain
repair block:

- 2 bytes magic
- 2 bytes session ID
- 4 bytes sequence number
- 2 bytes source-block count
- 2 bytes block length
- 4 bytes total package length
- 4 bytes FNV-1a checksum of the complete `.jscan` package

Each sequence number deterministically chooses the source blocks XORed into its
repair block. The receiver can use frames in any order.

# JamScan experimental dense mosaic release

## Main changes

- Kept the stable 64-tile seamless mosaic as the default mode.
- Added a 1024-tile experimental mode using a 32 by 32 compact mosaic.
- Added a 4028-tile experimental mode using a 64 by 63 grid with the four data-grid corners reserved.
- Kept every mosaic seamless with no internal divider lines.
- Added a shared stream header around dense mosaics so compact tiles do not repeat the full 36-byte frame header.
- Changed 1024 mode to 24-byte fountain blocks inside 15 by 15 tiles.
- Changed 4028 mode to 8-byte fountain blocks inside 9 by 9 tiles.
- Added CRC-16 checks to compact tiles and CRC-32 checks to the repeated dense stream header.
- Repeated the dense stream header on all four sides for rotation handling.
- Increased the requested rear-camera resolution to 3840 by 2160 when available.
- Increased the internal camera sampling limit to 2560 pixels.
- Added automatic detection for stable 64, experimental 1024, and experimental 4028 mosaics.
- Added density warnings explaining the screen and camera requirements for experimental modes.

## Ideal optical rates

At 10 complete mosaics per second:

- Stable 64 mode carries up to 25.6 KB of repair payload per second before camera loss.
- Experimental 1024 mode carries up to 245.8 KB of repair payload per second before camera loss.
- Experimental 4028 mode carries up to 322.2 KB of repair payload per second before camera loss.

These are payload-rate ceilings, not guaranteed real-world speeds. Display refresh rate, rolling shutter, focus, motion, screen resolution, camera resolution, glare, and decoder losses reduce actual throughput.

## Test results

The automated protocol test verifies:

- Legacy single-code rotation handling.
- Stable 64-tile decoding at 0, 2, and -2 degrees.
- Partial stable decoding at a deliberately low camera resolution.
- Exact decoding of all 1024 compact tiles from a generated mosaic.
- Exact decoding of all 4028 compact tiles from a generated mosaic.
- Fountain recovery after 35 percent simulated code loss.
- Complete package CRC-32 and SHA-256 verification.

## Compatibility

Saved `.jscan` files remain package version 1.

The 1024 and 4028 optical formats require this scanner release or a later compatible release. The stable 64-tile and legacy single-code decoders remain available.

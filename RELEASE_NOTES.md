# JamScan 64-tile mosaic release

## Main changes

- Replaced the unreliable multiple separate-code layout with one seamless 8 by 8 mosaic.
- Made 64 repair tiles the default on every supported device.
- Removed internal divider lines and per-tile locator borders.
- Added four larger corner markers around the complete mosaic.
- Changed the scanner to locate the mosaic once and sample 64 fixed tile positions.
- Reduced fountain block size to 40 bytes so every tile remains readable at mobile camera resolution.
- Added per-tile rotation, mirror, header CRC, and payload CRC checks.
- Changed the recommended speed to 10 mosaics per second to reduce rolling-shutter and exposure mixing.
- Batched scan-page UI updates so reading 64 tiles does not trigger 64 separate layout updates.
- Increased the internal camera sampling limit to 1280 pixels.
- Kept legacy single-code decoding as a fallback.

## Test results

The automated test decodes all 64 tiles at normal camera resolution at 0, 2, and -2 degrees. It also verifies fountain recovery after 35 percent simulated code loss.

At a deliberately small 640 by 480 capture, the scanner can still recover a partial set of tiles. Fountain repair lets later mosaics supply the missing information.

## Compatibility

This release changes the visual transfer format. Older animated JamScan streams are not compatible with this scanner. Saved `.jscan` package files remain package version 1.

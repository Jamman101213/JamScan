# JamScan 2.0 release notes

## Scanner replacement

- Removed custom 64, 1024, and 4028 tile mosaics.
- Replaced them with standard QR version 27 and version 40 frames.
- Added ZXing-C++ WebAssembly decoding in parallel workers.
- Added exact-first 60 FPS camera requests with fallbacks.
- Added `requestVideoFrameCallback` capture.
- Removed rejection counting for ordinary blurry camera images.
- Added self-describing frames, so scanning can start mid-transfer.
- Added fountain recovery, so exact missed frames are not required.
- Added integer module scaling to prevent browser resize blur.
- Added a four-module white QR quiet zone.

## File handling

- Preserved `.jscan` save and open support.
- Added optional gzip compression.
- Added SHA-256 verification.
- Preserved the warning before previewing received content.

## Performance profiles

- Reliable: 1465-byte QR frames at 20 FPS.
- Fast: 2953-byte QR frames at 24 FPS.
- Turbo: 2953-byte QR frames at 30 FPS.

Turbo requires a sharp close-range camera view and a display that can present
each frame cleanly. The site shows a best-case time before streaming.

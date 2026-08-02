# Release notes

## JamScan 2.2

- Keeps Standard one-QR mode as the default.
- Adds Double mode with two different QR packets per update.
- Adds Quad mode with four different QR packets per update.
- Makes the receiver request and process up to four QR symbols per camera image.
- Changes the default camera request from 1280 to 1920 pixels for multi-QR use.
- Updates time and raw-rate estimates to include the selected QR channel count.
- Keeps tiny static messages in one QR for reliability.
- Adds automated four-channel fountain recovery tests.

## 2.2.1 scanner recovery fix

- Restored the known-working single-QR full-image decode path.
- Removed protocol filtering from the QR worker.
- Replaced the unreliable multi-symbol call with normal one-QR crop scans.
- Added overlapping half and quadrant searches for Double and Quad.
- Changed mobile-friendly defaults to 1280 capture, 30 FPS, and two workers.
- Added worker error reporting and old-generation protection.

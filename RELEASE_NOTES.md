# JamScan 2.1 release notes

## Tiny transfer repair

- Removed full-block padding for tiny packages.
- Added a static one-QR mode for packages up to 700 bytes.
- Added medium-strength QR error correction for static and small modes.
- Added 512-byte blocks at 6 FPS for packages up to 4 KB.
- Added 896-byte blocks at 10 FPS for packages up to 16 KB.
- Kept large-file Reliable, Fast, and Turbo profiles.
- Changed the estimate to show `One valid scan` for a static transfer.

## Fountain improvements

- Source blocks are sent directly at the start of each cycle.
- Repair frames follow the source blocks.
- Small transfers can complete in exactly their source-block count when the
  camera reads each direct frame.
- Direct source blocks repeat in later cycles when scanning starts late.

## Receiver startup

- QR decoder workers warm up when the Receive page loads.
- Stale worker results from an older camera session are ignored.
- Ordinary blurry camera images remain silently discarded.

## Test result

The included `hi` test creates:

- 254-byte `.jscan` package
- 274-byte optical frame
- One source block

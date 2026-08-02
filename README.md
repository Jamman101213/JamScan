# JamScan

JamScan is an open source browser project for sharing text and files through animated black-and-white optical mosaics or portable `.jscan` files.

JamScan runs locally in the browser. It does not require an account, upload server, paid API, external framework, or build step.

## Main features

- A stable seamless 8 by 8 mosaic containing 64 independently useful repair tiles
- Experimental seamless 1024-tile and 4028-tile high-density modes
- No internal divider lines between tiles
- Four strong corner markers used to find the complete mosaic
- Rateless repair frames that recover from missed camera images
- Mid-stream joining with no required first frame
- Rotation, mirroring, and perspective correction
- `.jscan` save and open support
- SHA-256 package verification with CRC-32 and CRC-16 optical checks
- Mobile, desktop, tablet, and supported VR layouts
- A warning before recovered content is shown

## Pages

- `/` - Start page and navigation
- `/make/` - Create a `.jscan` file and animated mosaic
- `/scan/` - Scan a mosaic with a camera
- `/open/` - Open and verify a saved `.jscan` file

## Project structure

```text
JamScan_Open_Source_Experimental_Dense/
  index.html
  make/index.html
  scan/index.html
  open/index.html
  assets/css/styles.css
  assets/js/common.js
  assets/js/core.js
  assets/js/device.js
  assets/js/fountain.js
  assets/js/home.js
  assets/js/make.js
  assets/js/open.js
  assets/js/scan.js
  assets/js/viewer.js
  docs/ATTRIBUTION.md
  docs/FORMAT.md
  docs/LEGAL_NOTES.md
  licenses/DECIMEN-MIT.txt
  tests/optical-roundtrip.html
  tests/protocol-roundtrip.cjs
  CONTRIBUTING.md
  CREDITS.md
  LICENSE
  README.md
  RELEASE_NOTES.md
  THIRD_PARTY_NOTICES.md
```

## Run locally

Camera access normally requires HTTPS or localhost.

From the project folder, run:

```bash
python -m http.server 8000
```

Then open:

```text
http://localhost:8000/
```

Another option is:

```bash
npx serve .
```

## Device support

JamScan automatically selects mobile or desktop layout. Supported VR browsers use desktop layout. Unsupported televisions, consoles, casting devices, bots, and unknown platforms show `JSCAN-DEVICE-001`. Browsers missing required APIs show `JSCAN-CAPABILITY-002`.

The stable 64-tile mosaic is the default on phones, tablets, computers, and supported VR headsets. The 1024-tile and 4028-tile modes must be selected manually because they need more screen and camera resolution.


## Experimental high-density modes

JamScan includes two optional dense formats for larger photos, audio, and video files:

- **1024 experimental** uses a 32 by 32 data grid, 15 by 15 cells per compact tile, and 24-byte fountain blocks. One clean mosaic can carry up to 24 KB of repair payload.
- **4028 experimental** uses a 64 by 63 data grid with four corner positions reserved, 9 by 9 cells per compact tile, and 8-byte fountain blocks. One clean mosaic can carry up to 31.5 KB of repair payload.

The compact modes use one shared stream header repeated on all four outside edges. Individual tiles only store a fountain payload and CRC-16. This avoids repeating the normal 36-byte header thousands of times.

These modes are experimental. Use full screen, maximum brightness, a high-resolution sender display, the rear camera, close focus, and steady devices. The 4028 mode is most useful with a 4K or higher sender. On lower-resolution screens or cameras, only part of each mosaic may decode.

The scanner accepts every clean tile it can read. A partially decoded dense mosaic still helps the fountain decoder, and later mosaics provide different repair data.

## How the stable 64-tile mosaic works

Each display update contains an 8 by 8 group of data tiles. The tiles touch directly, so there are no white or black divider lines between them. Four separate corner markers surround the tile area and let the scanner find the full square once.

After the scanner locks onto the four corner markers, it corrects the complete mosaic as one surface. It then samples the 64 known tile positions instead of searching the camera image for 64 separate QR-style borders.

Every tile contains its own sequence number, stream metadata, CRC-protected header, repair payload, and repair-payload CRC. A damaged tile can be skipped while clean tiles from the same camera image are still accepted.

## Speed and reliability

The default setting displays 64 repair tiles per mosaic at 10 mosaics per second. This targets up to 640 useful repair codes per second before camera losses. The experimental selectors raise the theoretical payload rate by using many compact tiles with a shared header.

Ten mosaics per second is intentionally slower than the old flashing mode. Phone cameras need enough exposure time to capture one complete mosaic without mixing two display updates. The larger number of tiles makes the total transfer faster even with the slower visual update rate.

For best results:

- Use Full-screen display on the sending device.
- Keep all four corner markers visible.
- Make the mosaic fill most of the receiving camera view.
- Increase sender brightness and avoid glare.
- Hold both devices still until the scanner locks.
- Use the 8 mosaics per second setting in difficult lighting.

At low camera resolution, only part of a stable or experimental mosaic may decode. This is expected and does not stop the transfer. Later mosaics provide additional repair tiles.

## Repair stream

JamScan uses a continuous LT fountain stream. Every sequence number deterministically selects source blocks and combines them into a repair payload. The receiver can begin on any mosaic and continue until all source blocks are solved.

A missed camera image does not require waiting for that exact image to repeat. Later repair tiles can replace the missing information.

The fountain implementation is adapted from Decimen Optical Transfer under the MIT License. JamScan uses its own `.jscan` package, visual tile format, mosaic layout, scanner, interface, and safety flow. The visual formats are not compatible.

## Safety model

Before recovered content is shown, JamScan displays a warning covering inappropriate content, scams, misleading links, impersonation, malware, and unsafe downloads.

The warning is not a guarantee that a file is safe. JamScan checks integrity, not trustworthiness.

## Integrity checks

- Every package stores a SHA-256 hash of its original payload.
- Stable tiles store CRC-32 values for their repair payload and full header.
- Compact experimental tiles use CRC-16, while their repeated shared stream header uses CRC-32.
- The complete `.jscan` package has a CRC-32 value in the optical stream.
- Duplicate sequence numbers are ignored.
- Recovered packages must pass length, CRC-32, and SHA-256 checks.

## Tests

Run the dependency-free Node test:

```bash
node tests/protocol-roundtrip.cjs
```

The test checks:

- Legacy single-code rotation handling
- All 64 stable mosaic tiles at normal camera resolution
- All 1024 compact experimental tiles in a generated mosaic
- All 4028 compact experimental tiles in a generated mosaic
- Rotated mosaic decoding
- A fully white outside edge
- Fountain recovery after 35 percent simulated code loss
- `.jscan` package integrity

A browser test is available at:

```text
/tests/optical-roundtrip.html
```

## Inspiration and credit

JamScan's fountain-transfer design and dense optical-transfer direction are inspired by [Decimen Optical Transfer](https://github.com/bashalarmistalt/decimen-optical-transfer/) by BashAlarmist.

Decimen is released under the MIT License. Its required notice is preserved in `licenses/DECIMEN-MIT.txt` and `THIRD_PARTY_NOTICES.md`.

See `CREDITS.md` and `docs/ATTRIBUTION.md` for more information.

## Development note

This release was created and revised with assistance from ChatGPT GPT-5.6 Thinking, which the project author refers to as "5.6 Sol." Claude was not used to generate this release.

Project direction, physical phone testing, and product decisions were provided by the JamScan project author.

## Large files

The visual mosaic can transfer large packages, but sending the generated `.jscan` file directly remains much faster for large videos.

The default source limit is 256 MB. It is defined in `assets/js/core.js` as `MAX_SOURCE_SIZE`.

## License

JamScan is released under the MIT License. See `LICENSE`.

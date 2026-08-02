# JamScan

JamScan is an open source browser project for sharing text and files through animated black-and-white optical mosaics or portable `.jscan` files.

JamScan runs locally in the browser. It does not require an account, upload server, paid API, external framework, or build step.

## Main features

- A seamless 8 by 8 mosaic containing 64 independently useful repair tiles
- No internal divider lines between tiles
- Four strong corner markers used to find the complete mosaic
- Rateless repair frames that recover from missed camera images
- Mid-stream joining with no required first frame
- Rotation, mirroring, and perspective correction
- `.jscan` save and open support
- SHA-256 package verification and CRC-32 tile checks
- Mobile, desktop, tablet, and supported VR layouts
- A warning before recovered content is shown

## Pages

- `/` - Start page and navigation
- `/make/` - Create a `.jscan` file and animated mosaic
- `/scan/` - Scan a mosaic with a camera
- `/open/` - Open and verify a saved `.jscan` file

## Project structure

```text
JamScan_Open_Source_64_Mosaic/
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

The 64-tile mosaic is the default on phones, tablets, computers, and supported VR headsets.

## How the 64-tile mosaic works

Each display update contains an 8 by 8 group of data tiles. The tiles touch directly, so there are no white or black divider lines between them. Four separate corner markers surround the tile area and let the scanner find the full square once.

After the scanner locks onto the four corner markers, it corrects the complete mosaic as one surface. It then samples the 64 known tile positions instead of searching the camera image for 64 separate QR-style borders.

Every tile contains its own sequence number, stream metadata, CRC-protected header, repair payload, and repair-payload CRC. A damaged tile can be skipped while clean tiles from the same camera image are still accepted.

## Speed and reliability

The default setting displays 64 repair tiles per mosaic at 10 mosaics per second. This targets up to 640 useful repair codes per second before camera losses.

Ten mosaics per second is intentionally slower than the old flashing mode. Phone cameras need enough exposure time to capture one complete mosaic without mixing two display updates. The larger number of tiles makes the total transfer faster even with the slower visual update rate.

For best results:

- Use Full-screen display on the sending device.
- Keep all four corner markers visible.
- Make the mosaic fill most of the receiving camera view.
- Increase sender brightness and avoid glare.
- Hold both devices still until the scanner locks.
- Use the 8 mosaics per second setting in difficult lighting.

At very low camera resolution, only some of the 64 tiles may decode. This is expected and does not stop the transfer. Later mosaics provide additional repair tiles.

## Repair stream

JamScan uses a continuous LT fountain stream. Every sequence number deterministically selects source blocks and combines them into a repair payload. The receiver can begin on any mosaic and continue until all source blocks are solved.

A missed camera image does not require waiting for that exact image to repeat. Later repair tiles can replace the missing information.

The fountain implementation is adapted from Decimen Optical Transfer under the MIT License. JamScan uses its own `.jscan` package, visual tile format, mosaic layout, scanner, interface, and safety flow. The visual formats are not compatible.

## Safety model

Before recovered content is shown, JamScan displays a warning covering inappropriate content, scams, misleading links, impersonation, malware, and unsafe downloads.

The warning is not a guarantee that a file is safe. JamScan checks integrity, not trustworthiness.

## Integrity checks

- Every package stores a SHA-256 hash of its original payload.
- Every tile stores a CRC-32 value for its repair payload.
- Every tile includes a CRC-32-protected header.
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
- All 64 mosaic tiles at normal camera resolution
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

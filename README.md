# JamScan

JamScan is an open source browser project for sharing text and files as animated black-and-white dot streams or portable `.jscan` files.

JamScan runs locally in the browser. It does not require an account, upload server, paid API, external framework, or build step.

## Pages

- `/` - Start page and navigation
- `/make/` - Create a `.jscan` file and animated dot stream
- `/scan/` - Scan an animated stream with a camera
- `/open/` - Open and verify a saved `.jscan` file
- `/tests/optical-roundtrip.html` - Browser optical round-trip test

## Project structure

```text
JamScan_Open_Source/
  index.html
  make/
    index.html
  scan/
    index.html
  open/
    index.html
  assets/
    css/
      styles.css
    js/
      common.js
      core.js
      device.js
      home.js
      make.js
      open.js
      scan.js
      viewer.js
  docs/
    FORMAT.md
    INDEPENDENT_IMPLEMENTATION.md
    LEGAL_NOTES.md
  tests/
    optical-roundtrip.html
    protocol-roundtrip.cjs
  .gitignore
  CONTRIBUTING.md
  LICENSE
  README.md
  THIRD_PARTY_NOTICES.md
```

## Run locally

Camera access normally needs HTTPS or localhost. Opening the HTML files directly still supports making and opening `.jscan` files, but camera access may be blocked.

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

JamScan automatically chooses a layout:

- Phones use mobile mode.
- Tablets use mobile mode.
- Windows, macOS, Linux, and ChromeOS use desktop mode.
- Meta Quest, Oculus Browser, PICO, and similar VR browsers use desktop mode.
- TVs, consoles, casting devices, bots, and unknown platforms show `JSCAN-DEVICE-001`.
- Browsers missing required APIs show `JSCAN-CAPABILITY-002`.

Responsive CSS still adjusts the page when the window size changes.

## Supported content

JamScan can package:

- Plain text
- Photos
- GIF files
- Video files
- Audio files
- Other file types

Unknown files are not executed or embedded as active content. They can only be downloaded after the warning is accepted.

## Scanner improvements

Protocol version 3 fixes the earlier scanner that required a perfectly centered square.

The new scanner:

- Adds a white quiet zone around every code.
- Adds a separate black locator border.
- Searches the complete camera image instead of one fixed center crop.
- Finds the four corners of the square automatically.
- Corrects rotation and perspective before reading dots.
- Supports rotated and mirrored grid directions.
- Uses a header CRC and a payload CRC for every frame.
- Reuses the last detected corner positions for faster later frames.
- Requests a high camera frame rate and falls back when the device refuses it.
- Requests continuous focus when the camera supports it.
- Uses `requestVideoFrameCallback` when available.

Keep the complete white margin and black border visible. Maximum screen brightness and a steady camera improve results.

## Visual stream behavior

The visual protocol uses three frame types:

1. Start markers identify the stream and package.
2. Data frames carry numbered pieces of the package.
3. End markers close the current loop.

The scanner waits for a valid start marker before accepting data. If scanning begins in the middle, it recognizes the stream but waits for the next start period.

The Make page holds the start marker for about 0.7 seconds at every speed. Small transfers repeat their data frames in the same cycle. Later cycles keep any data already received and fill the missing indexes.

Each frame has a stream ID, cycle number, sequence number, data index, header CRC, and payload CRC. Sequence gaps are counted as missed flashes. Duplicate frames are ignored.

## Speed limits

The Make page includes Reliable, Fast, Very fast, and Display maximum modes.

Display maximum advances once per browser animation frame. A browser cannot display a separate image faster than the physical display refresh rate. A 60 Hz display can normally show about 60 unique frames per second and a 120 Hz display can normally show about 120.

The camera also has its own exposure and frame-rate limit. A requested one-millisecond interval does not create one thousand visible camera-readable flashes per second.

Reliable or Fast mode is recommended for real transfers. Display maximum is mainly for testing high-refresh screens and fast cameras.

## Safety model

Before recovered content is shown, JamScan displays a warning that covers:

- Inappropriate or disturbing content
- Scams and fake offers
- Misleading links and impersonation
- Malware and unsafe downloads

The warning is not a guarantee that the file is safe. JamScan only checks package integrity.

## Integrity checks

- Every package stores a SHA-256 hash of its payload.
- Every visual frame stores a header CRC-32 value.
- Every visual frame stores a payload CRC-32 value.
- The complete visual package stores a CRC-32 value.
- Duplicate frames are ignored during scanning.
- Missing frames remain listed until a later loop supplies them.
- Incomplete or corrupted packages fail verification.

## Large files

The visual stream uses many frames. Large videos can take a long time to scan through a camera. Sharing the generated `.jscan` file is much faster for large content.

The default source limit is 256 MB. It is defined in `assets/js/core.js` as `MAX_SOURCE_SIZE`.

## Independent implementation

JamScan is independently written and does not include another optical-transfer project's source code.

Read:

- `docs/INDEPENDENT_IMPLEMENTATION.md`
- `docs/LEGAL_NOTES.md`
- `THIRD_PARTY_NOTICES.md`

These records reduce confusion about code origin but do not guarantee that a legal claim can never be made.

## Development

The project uses plain HTML, CSS, and JavaScript. Java is not required.

No dependency installation is needed.

When changing the visual format, update both frame creation and frame scanning in `assets/js/core.js`. Format details are in `docs/FORMAT.md`.

## Contributing

Read `CONTRIBUTING.md` before submitting changes.

## License

JamScan is released under the MIT License. See `LICENSE`.

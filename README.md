# JamScan

JamScan is an open source browser project for sharing text and files as animated black-and-white dot streams or portable `.jscan` files.

JamScan runs locally in the browser. It does not require an account, upload server, paid API, external framework, or build step.

## Pages

- `/` - Start page and navigation
- `/make/` - Create a `.jscan` file and animated dot stream
- `/scan/` - Scan an animated stream with a camera
- `/open/` - Open and verify a saved `.jscan` file

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
  .gitignore
  LICENSE
  README.md
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

## Visual stream behavior

The visual protocol uses three frame types:

1. Start markers identify the stream and package.
2. Data frames carry numbered pieces of the package.
3. End markers close the current loop.

The scanner waits for a start marker before accepting data. This means scanning can begin while a stream is already in the middle of a loop. Data seen before the next start marker is ignored.

Each frame has a stream ID, cycle number, sequence number, data index, and CRC-32 value. The scanner can detect sequence gaps, count missed flashes, ignore duplicates, and keep missing data from earlier loops. Later loops fill any data frames that were missed.

The order begins at a different data offset on later cycles. The number of repeated start and end markers also changes slightly. This helps devices with different refresh rates collect frames that were missed in an earlier loop.

## Speed limits

The Make page includes Reliable, Fast, Very fast, and Display maximum modes.

Display maximum requests a 1 millisecond update interval, but a browser cannot show a separate visible image faster than the display refresh rate. A 60 Hz screen can show about 60 different flashes per second, a 120 Hz screen can show about 120, and the camera also has its own frame-rate limit.

The Scan page uses `requestVideoFrameCallback` when the browser supports it, so decoding begins as soon as each new camera frame arrives. The decoder reads the canvas pixels once per camera frame and displays the measured decode time. A result below 1 millisecond may happen on fast hardware, but it cannot be guaranteed on every phone, computer, browser, or camera.

Reliable or Fast mode is recommended for real camera transfers. Display maximum is mainly useful for testing high-refresh screens and fast cameras.

## Safety model

Before recovered content is shown, JamScan displays a warning that covers:

- Inappropriate or disturbing content
- Scams and fake offers
- Misleading links and impersonation
- Malware and unsafe downloads

The warning is not a guarantee that the file is safe. JamScan only checks package integrity.

## Integrity checks

- Every package stores a SHA-256 hash of its payload.
- Every visual frame stores a CRC-32 value.
- The complete visual package also has a CRC-32 value.
- Duplicate frames are ignored during scanning.
- Missing frames remain listed until a later loop supplies them.
- Incomplete or corrupted packages fail verification.

## Large files

The visual stream uses many frames. Large videos can take a long time to scan through a camera. Sharing the generated `.jscan` file is much faster for large content.

The default source limit is 256 MB. It is defined in `assets/js/core.js` as `MAX_SOURCE_SIZE`.

## Development

The project uses plain HTML, CSS, and JavaScript. Java is not required.

No dependency installation is needed.

When changing the visual format, update both frame creation and frame scanning in `assets/js/core.js`. Format details are in `docs/FORMAT.md`.

## Contributing

1. Fork the project.
2. Create a branch for the change.
3. Keep comments short and related to the code.
4. Test the Home, Make, Scan, and Open pages.
5. Submit a pull request with a clear description.

## License

JamScan is released under the MIT License. See `LICENSE`.

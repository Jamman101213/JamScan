# JamScan

JamScan is an open source browser project for sharing text and files as camera-readable black-and-white dot streams or portable `.jscan` files.

Everything runs locally in the browser. JamScan does not require an account, upload server, paid API, external framework, package installation, or build step.

## Pages

- `/` - Start page and navigation
- `/make/` - Create a `.jscan` file and visual stream
- `/scan/` - Scan a visual stream with a camera
- `/open/` - Open and verify a saved `.jscan` file
- `/accessibility/` - Accessibility statement and testing guidance

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
  accessibility/
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
  tests/
    index.html
    protocol.js
    protocol-node.js
  ACCESSIBILITY.md
  LEGAL.md
  LICENSE
  package.json
  README.md
```

## Run locally

Camera access normally requires HTTPS or localhost. From the project folder, run:

```bash
python -m http.server 8000
```

Then open:

```text
http://localhost:8000/
```

You can also use:

```bash
npx serve .
```

Or use the included script:

```bash
npm run serve
```

Opening the HTML files directly still supports making and opening `.jscan` files, but camera access may be blocked by the browser.

## Scanner improvements

Visual protocol version 3 was designed for real phone cameras rather than perfect screenshots.

- The code grid was reduced from 64 by 64 to 48 by 48 modules.
- Every frame has a white margin and solid locator border.
- The scanner searches several centered crop sizes instead of requiring one exact crop.
- The decoder tries rotated and mirrored versions automatically.
- The scanner remembers a successful crop and tries it first on later camera frames.
- Every data frame is displayed twice.
- Start and end markers are repeated.
- A scan started in the middle waits for the next start marker.
- Sequence gaps are counted as missed flashes.
- Missing data is preserved and filled during later loops.
- Duplicate data frames are ignored.
- CRC-32 checks reject damaged visual frames.
- SHA-256 verifies the recovered payload.

For the best result, keep both devices parallel, keep the full border and white margin visible, increase the source display brightness, and avoid glare.

## Stream rate and motion safety

JamScan does not promise one-millisecond visible flashes. Browsers, displays, and cameras cannot reliably show and capture separate frames at that rate.

The Make page includes these rates:

- Reduced motion: 1 frame per second
- Reliable: 2 frames per second
- Quick: 3 frames per second

The stream does not autoplay. A photosensitivity warning appears before it starts, playback stops when the tab becomes hidden, and users who request reduced motion receive the 1 fps default.

The `.jscan` file route is the nonvisual and nonflashing alternative.

## Accessibility

JamScan aims for WCAG 2.2 Level AA where the project can reasonably apply it. Included work covers:

- Semantic headings and landmarks
- Skip links
- Keyboard-accessible controls and drop areas
- Visible keyboard focus
- Form labels and dialog labels
- Polite status announcements
- Reduced-motion support
- High-contrast and forced-colors support
- No autoplaying visual stream
- A nonvisual `.jscan` transfer route
- An accessibility statement and manual test routine

Read `ACCESSIBILITY.md` for the known limitation and test checklist.

Accessibility work does not guarantee legal compliance. Automated testing is not enough. Production use should include manual keyboard testing, screen-reader testing, zoom and contrast checks, testing with disabled users, and legal advice when needed.

Official references used for the project review:

- WCAG 2.2 overview: https://www.w3.org/WAI/standards-guidelines/wcag/
- W3C accessibility checks: https://www.w3.org/WAI/test-evaluate/easy-checks/
- W3C evaluation overview: https://www.w3.org/WAI/test-evaluate/
- W3C keyboard guidance: https://www.w3.org/WAI/WCAG21/Understanding/keyboard.html
- W3C flashing guidance: https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html
- United States DOJ web accessibility guidance: https://www.ada.gov/resources/web-guidance/

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

## Safety model

Before recovered content is shown, JamScan displays a warning covering:

- Inappropriate or disturbing content
- Scams and fake offers
- Misleading links and impersonation
- Malware and unsafe downloads

The warning is not proof that a file is safe. JamScan checks package integrity, not truth, legality, moderation, or malware.

## Large files

A visual stream requires many frames. Large videos may take a long time to scan. Sending the generated `.jscan` file is much faster and more reliable for large content.

The default source limit is 256 MB. It is defined in `assets/js/core.js` as `MAX_SOURCE_SIZE`.

## Development

The project uses plain HTML, CSS, and JavaScript. Java is not required.

No dependency installation is needed.

Run the protocol tests with:

```bash
npm test
```

The Node test uses a small built-in pixel canvas and checks package round trips, rotation, mirroring, camera-style crops, and later-loop recovery.

When changing the visual protocol, update both frame creation and frame scanning in `assets/js/core.js`. Format details are in `docs/FORMAT.md`.

## Contributing

1. Fork the project.
2. Create a branch for the change.
3. Keep comments short and related to the code.
4. Test Home, Make, Scan, Open, and Accessibility.
5. Test keyboard navigation and reduced motion.
6. Submit a pull request with a clear description.

## License

JamScan is released under the MIT License. See `LICENSE`.

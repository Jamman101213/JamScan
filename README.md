# JamScan

JamScan is an open source browser project for sharing text and files as animated black-and-white dot streams or portable `.jscan` files.

JamScan runs locally in the browser. It does not require an account, upload server, paid API, external framework, or build step.

## Main features

- One, two, or four independently changing codes in each visual flash
- Rateless repair frames that recover from missed camera frames
- Mid-stream joining with no start-marker wait
- Automatic code finding, rotation correction, and perspective correction
- Camera decoding through `requestVideoFrameCallback` when supported
- `.jscan` save and open support
- SHA-256 package verification and CRC-32 visual-frame checks
- Mobile, desktop, tablet, and supported VR layouts
- A warning before recovered content is shown

## Pages

- `/` - Start page and navigation
- `/make/` - Create a `.jscan` file and animated stream
- `/scan/` - Scan a stream with a camera
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
      fountain.js
      home.js
      make.js
      open.js
      scan.js
      viewer.js
  docs/
    ATTRIBUTION.md
    FORMAT.md
    LEGAL_NOTES.md
  licenses/
    DECIMEN-MIT.txt
  tests/
    optical-roundtrip.html
    protocol-roundtrip.cjs
  CONTRIBUTING.md
  CREDITS.md
  LICENSE
  README.md
  RELEASE_NOTES.md
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

- Phones use mobile mode and default to two codes per flash.
- Tablets use mobile mode and default to two codes per flash.
- Windows, macOS, Linux, and ChromeOS use desktop mode and default to four codes per flash.
- Meta Quest, Oculus Browser, PICO, and similar VR browsers use desktop mode.
- TVs, consoles, casting devices, bots, and unknown platforms show `JSCAN-DEVICE-001`.
- Browsers missing required APIs show `JSCAN-CAPABILITY-002`.

Responsive CSS still adjusts the page when the window size changes.

## Supported content

JamScan can package plain text, photos, GIF files, video files, audio files, and other file types.

Unknown files are not executed or embedded as active content. They can only be downloaded after the warning is accepted.

## Faster visual transfer

Each display update can contain up to four separate JamScan codes. Each code has its own sequence number and repair payload, so one camera image can contribute as many as four useful frames.

The visual protocol uses a continuous rateless stream instead of a fixed numbered loop. Every code contains enough metadata to identify the stream, so the scanner can join at any point. Some codes carry a direct source block. Other codes carry an XOR combination of source blocks. The decoder uses robust-soliton LT repair codes until every source block is recovered.

A missed camera frame is reported as a sequence gap, but the transfer does not wait for that exact code to return. Later repair codes can replace the lost information.

The Make page supports:

- 1 code per flash for maximum camera readability
- 2 codes per flash for small screens and phones
- 4 codes per flash for the highest throughput on larger screens

## Speed limits

The Recommended setting targets about 24 visual flashes per second. With four codes per flash, that is a target of about 96 code frames per second before camera losses and decoding limits.

Display maximum advances once per browser display refresh. It cannot create a separately visible one-millisecond flash when the screen, browser, or camera does not support that rate. A 60 Hz screen normally presents at most about 60 unique display updates per second.

Transfer speed depends on:

- Sender screen refresh rate
- Receiver camera frame rate
- Screen brightness and glare
- Code size in the camera view
- Autofocus movement
- Browser and phone processing speed
- Selected codes per flash

For four-code mode, use fullscreen and keep the complete grid visible. If the camera struggles, switch to two codes or one code.

## Safety model

Before recovered content is shown, JamScan displays a warning covering inappropriate content, scams, misleading links, impersonation, malware, and unsafe downloads.

The warning is not a guarantee that the file is safe. JamScan only checks package integrity.

## Integrity checks

- Every package stores a SHA-256 hash of its original payload.
- Every visual code stores a CRC-32 value for its repair payload.
- Every visual code includes a CRC-32-protected header.
- The full `.jscan` package has a CRC-32 value in the visual stream.
- Duplicate sequence numbers are ignored.
- Recovered packages must pass length, CRC-32, and SHA-256 checks.

## Tests

Run the dependency-free Node test:

```bash
node tests/protocol-roundtrip.cjs
```

It checks:

- Rotation handling
- Four codes decoded from one image
- Fountain recovery after simulated code loss
- `.jscan` package integrity

A browser test is available at:

```text
/tests/optical-roundtrip.html
```

## Inspiration and credit

JamScan's faster optical mode is inspired by [Decimen Optical Transfer](https://github.com/bashalarmistalt/decimen-optical-transfer/) by BashAlarmist. Decimen demonstrates fountain-coded optical transfer and documents experiments using denser frames and multi-code grids.

JamScan keeps its own `.jscan` package, custom dot-grid format, frame wrapper, interface, and safety flow. Its fountain implementation is adapted from Decimen under the MIT License, while the complete JamScan visual stream remains incompatible with Decimen.

Decimen is released under the MIT License. Its required copyright and permission notice are preserved in `licenses/DECIMEN-MIT.txt` and `THIRD_PARTY_NOTICES.md`.

See `CREDITS.md` and `docs/ATTRIBUTION.md` for more information.

## Development note

This release was created and revised with assistance from ChatGPT GPT-5.6 Thinking, which the project author refers to as "5.6 Sol." Claude was not used to generate this release.

Project direction, testing, and product decisions were provided by the JamScan project author.

## Large files

The visual stream can transfer large packages, but videos may still take time because the channel is limited by the display and camera. Sending the generated `.jscan` file directly is much faster for large content.

The default source limit is 256 MB. It is defined in `assets/js/core.js` as `MAX_SOURCE_SIZE`.

## Contributing

1. Fork the project.
2. Create a branch for the change.
3. Keep comments short and related to the code.
4. Preserve required third-party notices.
5. Test the Home, Make, Scan, and Open pages.
6. Run the protocol test.
7. Submit a pull request with a clear description.

## License

JamScan is released under the MIT License. See `LICENSE`.

# JamScan 2.1

JamScan transfers files and text from a screen to a camera using QR frames. It
also supports saving and opening the same content as a `.jscan` file.

## Tiny-message fix

JamScan no longer pads every transfer to a full 1,445-byte QR payload.

- Packages up to 700 bytes use one smaller static QR.
- Packages up to 4 KB use 512-byte source blocks at 6 FPS.
- Packages up to 16 KB use 896-byte source blocks at 10 FPS.
- Larger packages use the selected Reliable, Fast, or Turbo profile.

A message containing `hi` produces a 254-byte `.jscan` package and a 274-byte
optical frame in the included test. The receiver needs one successful scan,
not an hour of animation.

## How the optical transfer works

- Every QR frame contains its own session and file settings.
- The receiver can begin in the middle of a transfer.
- Blurry or transition frames are silently dropped.
- Source blocks are sent directly at the start of each cycle.
- Repair frames recover blocks missed by the camera.
- SHA-256 is checked before recovered content is shown.

## Transfer profiles

The large-file profiles set the maximum QR payload and display rate. JamScan
may automatically choose a smaller QR and slower display rate for short data.

| Profile | Maximum frame | Maximum display rate | Use |
| --- | ---: | ---: | --- |
| Reliable | 1,465 bytes | 20 FPS | Most phones and monitors |
| Fast | 2,953 bytes | 24 FPS | Close range and sharp cameras |
| Turbo | 2,953 bytes | 30 FPS | 60 Hz or faster displays, propped phone |

## Run locally

```bash
npm install
npm run dev
```

Desktop browsers may use camera access on `localhost`. For phone testing, use
an HTTPS deployment such as GitHub Pages.

## Build

```bash
npm run build
```

The finished static site is written to `dist/`.

## Test

```bash
npm test
```

The tests cover:

- Fountain recovery with dropped positions
- Direct source-block recovery
- Tiny static QR planning
- Frame packing and checksums
- `.jscan` parsing and SHA-256

Camera performance still requires testing with a real phone and display.

## Credit

JamScan adapts ideas and MIT-licensed implementation details from Decimen
Optical Transfer by BashAlarmist. JamScan keeps the Decimen copyright and
license notice for adapted portions. See `THIRD_PARTY_NOTICES.md` and
`licenses/DECIMEN-MIT.txt`.

## Development note

This JamScan release was created and revised with assistance from OpenAI's
GPT-5.6 Thinking model, referred to by the project author as "5.6 Sol". Claude
was not used to generate this release.

## Safety

Recovered content is not automatically opened. JamScan shows the claimed file
type, name, size, and integrity result before previewing or downloading it.
Treat unknown files, links, and media as untrusted.

## License

JamScan is released under the MIT License. Adapted Decimen portions remain
covered by Decimen's included MIT notice.

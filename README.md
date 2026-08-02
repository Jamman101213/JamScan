# JamScan 2.2

JamScan transfers files and text from a screen to a camera using fountain-coded
QR packets. It also saves and opens the same content as a `.jscan` file.

## QR channel modes

Standard is the default and is the easiest mode for phone cameras. Double and
Quad place more than one independently useful QR packet on each display update.
The receiver automatically reads up to four QR codes from one camera image.

| Mode | QR codes per update | Raw target | Use |
| --- | ---: | ---: | --- |
| Standard | 1 | 1x | Default and most reliable |
| Double | 2 | Up to 2x | Larger displays and steady cameras |
| Quad | 4 | Up to 4x | Sharp 1080p or higher camera view |

Every QR in Double and Quad contains a different fountain sequence. A blurry or
missed QR does not invalidate the other codes in the same camera image. Tiny
packages up to 700 bytes still use one static QR because splitting them would
only make scanning harder.

## Transfer profiles

| Profile | Maximum frame | Display updates | Use |
| --- | ---: | ---: | --- |
| Reliable | 1,465 bytes per QR | 20 per second | Most phones and monitors |
| Fast | 2,953 bytes per QR | 24 per second | Close range and sharp cameras |
| Turbo | 2,953 bytes per QR | 30 per second | 60 Hz displays and a steady receiver |

The estimate shown on the Send page includes the selected channel count. For
example, Fast plus Quad has a theoretical raw target near 277 KB/s before
fountain overhead and camera losses. Real speed depends on focus, display size,
refresh timing, exposure, motion, and how many codes the decoder reads from each
image.

## Small content handling

- Packages up to 700 bytes use one static QR.
- Packages up to 4 KB use 512-byte blocks at up to 6 updates per second.
- Packages up to 16 KB use 896-byte blocks at up to 10 updates per second.
- Larger packages use the selected Reliable, Fast, or Turbo profile.

## Receiver

The receiver uses ZXing-C++ WebAssembly workers and requests up to four QR
symbols from each camera image. It starts at any point in the stream, ignores
unreadable camera images, removes duplicate sequence numbers, and reconstructs
missing blocks with fountain repair packets. A 1920-pixel camera width is the
default because Double and Quad need more detail than Standard.

## Run locally

```bash
npm install
npm run dev
```

Camera access on a phone requires an HTTPS deployment.

## Build

```bash
npm run build
```

## Test

```bash
npm test
```

The tests cover fountain recovery, systematic source frames, four-channel
sequence batches, tiny static messages, frame checksums, and `.jscan` integrity.
Real camera performance still needs testing on the target phones and displays.

## Credit

JamScan adapts ideas and MIT-licensed implementation details from Decimen
Optical Transfer by BashAlarmist. See `THIRD_PARTY_NOTICES.md` and
`licenses/DECIMEN-MIT.txt`.

## Development note

This release was created and revised with assistance from OpenAI's GPT-5.6
Thinking model, referred to by the project author as "5.6 Sol". Claude was not
used to generate this release.

## Safety

Recovered content is not opened automatically. JamScan shows the claimed type,
name, size, and integrity result before previewing or downloading it.

## License

JamScan is released under the MIT License. Adapted Decimen portions remain
covered by the included Decimen MIT notice.

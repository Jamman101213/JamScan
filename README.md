# JamScan 2.0

JamScan transfers files and text from a screen to a camera using an endless
stream of fountain-coded QR frames. It also supports saving and opening the
same content as a `.jscan` file.

## Important change

The 64, 1024, and 4028 custom tile modes were removed. They packed more logical
cells onto the screen than a normal phone camera could resolve reliably.
JamScan 2.0 uses standard QR codes and a WebAssembly decoder instead.

## How the optical transfer works

- Every QR frame contains its own session and file settings.
- The receiver can begin in the middle of a transfer.
- Blurry or transition frames are silently dropped.
- A Luby Transform fountain code means no exact frame is required.
- The receiver reconstructs the payload after enough different valid frames.
- SHA-256 is checked before the recovered content is shown.

## Transfer profiles

| Profile | QR payload | Display rate | Use |
| --- | ---: | ---: | --- |
| Reliable | 1465 bytes per QR | 20 FPS | Most phones and monitors |
| Fast | 2953 bytes per QR | 24 FPS | Close range and sharp cameras |
| Turbo | 2953 bytes per QR | 30 FPS | 60 Hz or faster displays, propped phone |

The displayed time is an estimate, not a guarantee. A two-second transfer is
only realistic for a small clip. Typical multi-megabyte videos require more
time because the screen refresh rate and camera frame rate are physical limits.

## Run locally

```bash
npm install
npm run dev
```

Open the HTTPS address printed by Vite. HTTPS is required for a phone browser
to access its camera. Accept the local certificate warning when testing on a
home network.

## Build

```bash
npm run build
```

The finished static site is written to `dist/`.

## Test

```bash
npm test
```

The protocol test checks frame packing, fountain recovery with dropped frames,
and `.jscan` package verification. Camera scanning requires a real browser and
camera, so it cannot be fully tested by the Node test.

## Credit

JamScan 2.0 is based on ideas and MIT-licensed implementation details from
Decimen Optical Transfer by BashAlarmist. JamScan keeps the Decimen copyright
and license notice for adapted portions. See `THIRD_PARTY_NOTICES.md` and
`licenses/DECIMEN-MIT.txt`.

## Development note

This JamScan release was created and revised with assistance from OpenAI's
GPT-5.6 Thinking model, referred to by the project author as "5.6 Sol". Claude
was not used to generate this release.

## Safety

Recovered content is not automatically opened. JamScan shows the claimed file
type, name, size, and integrity result before previewing or downloading it.
The sender can still lie about a filename or content type. Treat unknown files,
links, and media as untrusted.

## License

JamScan is released under the MIT License. Adapted Decimen portions remain
covered by Decimen's included MIT notice.

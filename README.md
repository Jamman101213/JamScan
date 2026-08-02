# JamScan

JamScan is an open-source browser project for sharing text, photos, audio, videos, and other files.

## Recommended mode: Quick Transfer

Quick Transfer displays one static QR code containing a temporary pairing link. After the receiver opens it, the actual file moves through an encrypted WebRTC data channel rather than through QR animation.

This changes the limiting factor from camera frame rate to network speed. A file that would take many minutes through optical frames can often transfer in seconds over a good local network. Exact speed depends on the devices, browser, Wi-Fi, and whether WebRTC connects directly or uses a TURN relay.

Quick Transfer includes:

- One static, high-error-correction pairing QR
- A random secret stored in the URL fragment
- Temporary ten-minute signaling sessions
- Ordered binary WebRTC transfer
- 32 KiB chunks
- Browser backpressure handling
- Live speed, progress, route, and remaining-time display
- `.jscan` packaging and optional gzip compression
- SHA-256 verification
- The JamScan safety warning before previewing received content
- Optional TURN configuration for restricted networks

The signaling server relays connection information only. It does not receive the file bytes.

## Offline Optical mode

The older animated-QR transfer remains available as a network-free fallback. It is useful when no network route is available, but it is much slower than Quick Transfer.

The optical engine contains MIT-licensed adaptations inspired by Decimen Optical Transfer by BashAlarmist. Its required license notice is included in `licenses/DECIMEN-MIT.txt` and `THIRD_PARTY_NOTICES.md`.

## Run locally

Install Node.js 20 or newer, then run:

```bash
npm install
npm run dev
```

Open:

```text
http://localhost:3000
```

JamScan will suggest a LAN address for the pairing QR. The receiving phone must be able to open that address.

## Production

Build and start:

```bash
npm install
npm run build
npm start
```

Set the public address:

```text
PUBLIC_ORIGIN=https://your-jamscan-domain.example
```

Optional TURN settings are shown in `.env.example`.

A `Dockerfile` is included. Quick Transfer needs the Node server and cannot work as a GitHub Pages-only static deployment. GitHub can still host the source repository.

## Project pages

- `/quick/send/` creates a pairing QR and sends the file through WebRTC.
- `/q/` is the compact receiver route encoded in pairing QR codes.
- `/quick/receive/` is the readable receiver page URL.
- `/send/` runs the offline optical sender.
- `/receive/` runs the offline optical receiver.
- `/open/` opens a `.jscan` file.

## Tests

```bash
npm test
npm run check
```

## Development note

This JamScan release was created and revised with assistance from ChatGPT GPT-5.6 Thinking, which the project author refers to as "5.6 Sol." Claude was not used to generate this release.

## License

JamScan is released under the MIT License. Third-party notices remain under their respective licenses.

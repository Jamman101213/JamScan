# JamScan Quick Transfer

Quick Transfer uses a QR code only for pairing. The QR uses the compact `/q/?s=...#k=...` route and contains a temporary session identifier and a random secret. The secret is placed in the URL fragment so it is not included in the normal HTTP request for the receiver page.

After pairing, WebRTC negotiates an encrypted `RTCDataChannel`. JamScan sends the `.jscan` package in ordered 32 KiB binary messages. Browser backpressure is handled through `bufferedAmount`, `bufferedAmountLowThreshold`, and the `bufferedamountlow` event.

## Connection flow

1. The sender creates a temporary signaling session.
2. JamScan displays one static, high-error-correction QR.
3. The receiver opens the pairing URL.
4. The signaling server relays only SDP and ICE messages.
5. WebRTC establishes a direct connection when the networks allow it.
6. The sender transmits the file package through the data channel.
7. The receiver checks package length and SHA-256 before presenting the safety warning.

## Signaling server

The signaling server never receives file chunks. It stores temporary in-memory pairing sessions for ten minutes. Restarting the server removes all sessions.

## TURN

Some carrier, school, guest, or highly restricted networks cannot form a direct peer connection. Set `TURN_URL`, `TURN_USERNAME`, and `TURN_CREDENTIAL` to provide a relay for those cases. Production deployments should prefer short-lived TURN credentials rather than publishing one permanent password. TURN relays encrypted WebRTC traffic but may use significant bandwidth.

## Local testing

Run:

```bash
npm install
npm run dev
```

Open `http://localhost:3000` on the sender. JamScan suggests LAN addresses such as `http://192.168.1.20:3000` for the receiver QR. Both devices must be able to reach that address.

For internet deployment, use HTTPS and set `PUBLIC_ORIGIN` to the public JamScan URL.

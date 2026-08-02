# Contributing to JamScan

Thank you for helping improve JamScan.

## Before changing code

- Keep the project usable without a build step.
- Keep HTML, CSS, and JavaScript in separate files.
- Keep code comments short and practical.
- Do not add emojis to the interface or source comments.
- Preserve the JamScan and Decimen license notices.
- Clearly list any new third-party code and its license.

## Testing

Before submitting a change:

1. Open the Home page.
2. Build a text package on the Make page.
3. Test the stable 64-tile mosaic, both experimental dense mosaics, and the legacy one-code fallback.
4. Test the Scan page with a real phone camera.
5. Open a saved `.jscan` file.
6. Run:

```bash
node tests/protocol-roundtrip.cjs
```

## Visual protocol changes

When changing the visual protocol:

- Update both the sender and scanner.
- Update `docs/FORMAT.md`.
- Add or update a protocol test.
- Keep older `.jscan` package support unless the package version changes.
- Do not remove integrity checks just to increase speed.

## Pull requests

Explain:

- What changed
- Why it changed
- Which devices were tested
- Whether the visual format changed
- Whether a third-party project or source influenced the change

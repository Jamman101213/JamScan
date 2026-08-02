# Contributing to JamScan

## Before changing code

- Read `docs/FORMAT.md`.
- Read `docs/INDEPENDENT_IMPLEMENTATION.md`.
- Do not paste code from another optical-transfer project.
- Keep comments short and related to the code.

## Testing

Test these pages:

- Home
- Make
- Scan
- Open

Test the scanner with:

- A phone scanning a computer screen
- A computer scanning a phone screen
- Portrait and landscape orientation
- Starting the camera in the middle of a cycle
- A missed data frame followed by another cycle
- Low and high screen brightness
- A rotated square inside the camera view

Run the browser test page at:

```text
/tests/optical-roundtrip.html
```

Run the Node protocol test:

```bash
node tests/protocol-roundtrip.cjs
```

## Pull requests

Explain:

- What changed
- Why it changed
- Which devices were tested
- Whether any third-party code or assets were added

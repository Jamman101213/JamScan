# Performance notes

JamScan changes QR density based on package size and can display one, two, or
four independently useful QR packets at the same time.

## Automatic package modes

| Package size | Block size | Display behavior |
| --- | ---: | --- |
| Up to 700 bytes | Exact package size | One static QR |
| Up to 4 KB | 512 bytes | Up to 6 updates per second |
| Up to 16 KB | 896 bytes | Up to 10 updates per second |
| Larger | Selected profile maximum | 20 to 30 updates per second |

## Channel modes

- Standard displays one QR and is the default.
- Double displays two different QR packets per update.
- Quad displays four different QR packets per update.
- The receiver requests up to four symbols from each camera image.
- If only part of a multi-QR image is found, the worker retries overlapping
  halves and quadrants.

## Approximate raw targets

These values do not include fountain overhead or camera losses.

| Profile and mode | Raw target |
| --- | ---: |
| Reliable Standard | About 28 KB/s |
| Reliable Double | About 56 KB/s |
| Reliable Quad | About 113 KB/s |
| Fast Standard | About 69 KB/s |
| Fast Double | About 138 KB/s |
| Fast Quad | About 277 KB/s |

## Best results

- Use full-screen sender mode.
- Use Standard first to confirm the camera works.
- Use a 1920-pixel or higher camera width for Double and Quad.
- Keep every QR and every white quiet zone visible.
- Set the sender brightness high.
- Prop the receiving phone instead of holding it.
- Avoid glare and screen reflections.
- Use Fast or Turbo only at close range with sharp focus.

Unreadable camera images are ignored. Only fully decoded, protocol-valid QR
packets enter the fountain decoder.

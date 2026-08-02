# Performance notes

JamScan changes QR density based on package size. This is important because a
small message should not be placed inside the same dense QR used for a video.

## Automatic modes

| Package size | Block size | Display behavior |
| --- | ---: | --- |
| Up to 700 bytes | Exact package size | One static QR |
| Up to 4 KB | 512 bytes | 6 FPS |
| Up to 16 KB | 896 bytes | 10 FPS |
| Larger | Selected profile maximum | 20 to 30 FPS |

## Best results

- Use full-screen sender mode.
- Set sender brightness high.
- Keep the entire QR and white quiet zone visible.
- Prop the receiving phone instead of holding it.
- Avoid glare and screen reflections.
- Use Reliable first, then try Fast at closer range.
- Use Turbo only when the sender is at least 60 Hz.

The receiver does not count failed camera images as rejected packets. Only
fully decoded and protocol-valid QR frames enter the transfer decoder.

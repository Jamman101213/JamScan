# Performance notes

JamScan uses standard QR codes because the camera must resolve every QR module.
Increasing the number of logical cells does not increase real speed once those
cells become smaller than camera pixels or are blurred by focus and exposure.

For best results:

- Use full-screen sender mode.
- Set sender brightness high.
- Keep the entire QR and white quiet zone visible.
- Prop the receiving phone instead of holding it.
- Avoid glare and screen reflections.
- Use Reliable first, then try Fast at closer range.
- Use Turbo only when the sender is at least 60 Hz and the camera reports a
  stable high frame rate.

The receiver intentionally does not count failed camera images as rejected
packets. Only fully decoded and protocol-valid QR frames enter the fountain
decoder.

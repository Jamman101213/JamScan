# JamScan fast multi-code release

## Changes

- Added one, two, and four codes per displayed flash.
- Added a continuous LT fountain stream that can be joined at any point.
- Added recovery from dropped camera frames without waiting for an exact frame to repeat.
- Added fast locked-code scanning that skips a full image search when all known codes decode.
- Added camera-frame processing through `requestVideoFrameCallback` where available.
- Added linear collected-code progress while keeping solved-block and integrity checks.
- Added Decimen Optical Transfer attribution and its MIT License notice.
- Added the ChatGPT GPT-5.6 Thinking development note requested by the project author.

## Compatibility

This release uses JamScan visual protocol version 4. Older JamScan visual streams are not compatible with this scanner. Saved `.jscan` package files keep package version 1.

## Recommended settings

- Desktop or VR: four codes and Recommended speed.
- Modern phone sender: two codes and Recommended speed.
- Difficult lighting or an older receiving phone: one or two codes and Fast or Reliable speed.

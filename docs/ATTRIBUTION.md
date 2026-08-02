# Attribution

JamScan's faster transfer mode was developed after reviewing the public Decimen Optical Transfer repository and documentation.

Decimen Optical Transfer is an MIT-licensed project by BashAlarmist:

https://github.com/bashalarmistalt/decimen-optical-transfer/

The Decimen project demonstrates several important optical-transfer ideas:

- Self-describing frames that can be joined in the middle
- Fountain coding for recovery from dropped camera frames
- Camera-frame processing without requiring sender and receiver rates to match
- Experiments using multiple codes in one display update

JamScan credits those ideas and preserves the Decimen MIT notice. The LT fountain encoder and peeling decoder in `assets/js/fountain.js` are adapted from Decimen's MIT-licensed fountain implementation.

JamScan remains a separate project with:

- A custom black-and-white dot code
- A separate `.jscan` package format
- Different frame headers and visual protocol wrapping
- A different scanner and interface
- A content warning and safe preview flow

JamScan is not compatible with the Decimen wire format and is not an official Decimen release.

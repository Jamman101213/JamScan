# Independent implementation record

This document records how JamScan is intended to remain an independently written project.

It is not legal advice and it cannot prevent someone from filing a claim. It is a development record that can help show where the code came from.

## Current implementation

- JamScan source code was written for this repository.
- No source file from another optical-transfer project was copied, translated, adapted, or pasted into JamScan.
- Public descriptions of screen-to-camera transfer behavior were used only to identify general functional goals.
- General techniques such as CRC checks, SHA-256, connected-component detection, projective correction, sequence numbers, and repeated transfer cycles were implemented independently.
- JamScan has its own name, interface, package signature, frame header, visual grid, locator design, scanner, and warning flow.
- JamScan does not claim format compatibility with another project.

## Clean-room-style process

A strict clean-room process normally separates observation from implementation. Use this process for future compatibility work:

1. An observer tests the other program only through its public interface.
2. The observer writes a functional specification without source code, copied text, screenshots, artwork, or creative implementation details.
3. A different implementer who has not reviewed the other source code writes new code from that specification.
4. Test results compare behavior, not source structure.
5. Commits, issue notes, test records, and authorship dates are preserved.
6. A lawyer reviews the process before high-risk commercial use.

JamScan currently follows an independent, black-box-style approach, but it is not represented as a formal two-team legal clean room.

## Contribution rules

Contributors should:

- Write original code or clearly identify third-party code.
- Record the license for every third-party dependency.
- Never remove a required copyright or license notice.
- Avoid copying another product's text, artwork, layout, names, or source organization.
- Describe behavior in neutral functional terms.
- Keep tests that show independent behavior and protocol decisions.

## Third-party code

The current browser runtime contains no third-party JavaScript library. If a library is added later, its license and required notices must be included before release.

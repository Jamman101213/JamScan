# JamScan accessibility

JamScan aims for WCAG 2.2 Level AA where the project can reasonably apply it.

## Included accessibility work

- A skip link on every page
- Semantic header, navigation, main, section, article, dialog, and footer elements
- One clear page heading
- Keyboard-accessible buttons, links, file drop areas, dialogs, and form fields
- Visible focus indicators
- Text labels for controls and status information
- `aria-live` status regions for important updates
- High-contrast colors and forced-colors support
- Responsive layouts at narrow widths and browser zoom
- Reduced-motion support
- No autoplaying visual stream
- A maximum stream rate of 3 frames per second
- A photosensitivity warning before stream playback
- A direct `.jscan` file route that does not require camera scanning

## Known limitation

The camera stream is visual by nature. A person who cannot see the source screen or camera framing may not be able to independently use that transfer method.

The equivalent route is:

1. The sender selects Save `.jscan`.
2. The file is transferred through a normal file-sharing method.
3. The recipient opens the file on the Open page.

## Manual test checklist

### Keyboard

- Reach every interactive control using Tab and Shift+Tab.
- Activate buttons and drop areas with Enter or Space.
- Close menus and dialogs with Escape.
- Confirm focus is always visible.
- Confirm focus returns to a useful location after dialogs close.

### Screen readers

Test current versions of at least two combinations when possible:

- NVDA with Firefox or Chrome on Windows
- VoiceOver with Safari on macOS or iOS
- TalkBack with Chrome on Android

Check that:

- Page titles and headings make sense.
- Navigation identifies the current page.
- Form fields have useful labels.
- Status messages are understandable without looking at the screen.
- Dialog names and descriptions are announced.
- The Open page can be completed without using the visual stream.

### Visual checks

- Test at 200 percent browser zoom.
- Test at 320 CSS pixels wide.
- Test light sensitivity with reduced motion enabled.
- Test Windows High Contrast or browser forced-colors mode.
- Check text and non-text contrast.
- Confirm instructions do not rely on color alone.

### User testing

Automated tools and developer checks cannot replace testing with disabled users. Invite blind, low-vision, keyboard-only, motor-disabled, cognitively disabled, deaf, and photosensitive users when the project reaches production use.

## Reporting barriers

Open a repository issue and include:

- Page and action
- Browser and version
- Device and operating system
- Assistive technology and version
- Expected result
- Actual result
- Reproduction steps

Do not attach private `.jscan` content.

## No compliance guarantee

This document describes project goals and current features. It is not a certification, legal opinion, or guarantee of ADA, Section 508, EN 301 549, or WCAG conformance. Requirements depend on how and where the software is used. Obtain a professional accessibility audit and legal advice for production or commercial deployment.

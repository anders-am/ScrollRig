# Chrome Web Store — listing copy

Everything below is written to be pasted straight into the Developer Dashboard fields. Character limits are noted where Google enforces them.

---

## Store listing tab

### Name
_(45 char limit)_

```
ScrollRig
```

### Summary / short description
_(132 char limit — the text below is 114)_

```
Drive smooth, precisely-timed scrolling on any page, so you can screen-record a website without scrolling by hand.
```

### Detailed description
_(16,000 char limit)_

```
ScrollRig is a scroll rig for screen recordings. It drives smooth, precisely-timed scrolling on a page you choose, so you can capture a website on video without the jitter and stutter of scrolling by hand.

It does not record anything itself. You keep using whatever screen recorder you already have — QuickTime, ScreenFlow, Loom, OBS. ScrollRig only moves the page, and it does it far more steadily than a trackpad can.

The controls live in their own floating window, separate from the browser, so they never appear in your recording and can be parked on a second monitor.

WORKS WITH SMOOTH-SCROLL SITES
Many modern sites take over scrolling with libraries like Lenis or Locomotive. Tools that jump the page directly tend to fight those libraries and produce broken motion. ScrollRig drives the page with real wheel input instead, so the site's own scroll animation runs exactly as it was designed to.

THREE WAYS TO DRIVE A SHOT

Quick — scroll a set distance over a set duration, with a choice of easing curves and direction. Good for a fast pass down a page.

From to — capture an exact start and end position, then scroll smoothly between them. Click the crosshair to grab the page's current position, or type a number. This is the one to use when a shot needs to begin and end at specific points. Save positions you reuse under a name; they are kept per site.

Sequence — build a shot out of steps: scroll to a position, scroll by a distance, or wait. Drag to reorder. A stagger generator builds a stepped scroll in one action. Loop a sequence to tune timing without re-triggering it, preview at 0.5x or 2x, and save sequences as presets you can export and share.

PRECISION
A live scroll position readout updates with no lag, so you always know exactly where the page is. Keyboard shortcuts work globally, so you can set marks and trigger a run while your cursor is in the page rather than in the panel.

PRIVACY
ScrollRig has no servers, no analytics and no telemetry, and it makes no network requests. Your saved positions and sequences are stored locally in your own browser and never leave your computer.
```

### Category

```
Developer Tools
```

### Language

```
English (United States)
```

---

## Privacy practices tab

### Single purpose description

```
ScrollRig performs a single function: it scrolls a web page the user selects, smoothly and at a precisely controlled speed, distance and easing curve, so that the page can be captured cleanly with external screen-recording software.
```

### Permission justifications

Paste each into the matching field. Reviewers read these closely, so they're written to be specific rather than generic.

**`storage`**
```
Stores the user's own saved scroll positions and scroll sequences, plus the size and screen position of the control panel window, using chrome.storage.local. This data stays on the user's device and is never transmitted.
```

**`tabs`**
```
The control panel is a separate window, so the extension must identify which tab it is driving. This permission is used to read the bound tab's id, title and hostname in order to display which page is bound, to group the user's saved scroll positions by site, and to detect when the bound tab is closed or navigates away so the panel can show that it is no longer connected.
```

**`scripting`**
```
Inserts the scrolling engine into the tab the user has bound, in cases where the declarative content script is not already present — specifically tabs that were already open before the extension was installed or updated. Without this, the extension silently fails on existing tabs until each one is manually reloaded.
```

**`windows`**
```
Creates the control panel as a standalone popup window rather than a browser popup, so that the controls do not appear inside the user's screen recording and can be positioned on a second monitor. Also used to remember the panel's size and position between sessions.
```

**Host permission — `<all_urls>`**
```
The user decides at recording time which page they want to scroll, so the extension cannot know the addresses in advance; a user may record their own site, a client's site, or any page they are documenting. Access is used only to read the scroll position of, and apply scrolling to, the single tab the user has explicitly bound in the panel, and only when the user triggers a scroll. No page content is read, collected or transmitted.
```

> **Note on `activeTab`:** reviewers sometimes ask whether `activeTab` would suffice. It would not. ScrollRig's controls live in a separate window, which means the tab being scrolled is by definition **not** the active tab while the user is operating the panel. `activeTab` only grants access to the tab in focus at the moment of a user gesture, so it cannot support this interaction model. Include this if a reviewer pushes back.

### Remote code

```
No, I am not using remote code
```

All logic ships inside the package. There are no remotely hosted scripts, no `eval`, and no external resources — the panel uses a local system font stack specifically to avoid a webfont request.

### Data usage

Tick **nothing** in the data collection list. ScrollRig collects none of the following: personally identifiable information, health information, financial and payment information, authentication information, personal communications, location, web history, user activity, website content.

Then certify all three:
- ✅ I do not sell or transfer user data to third parties, outside of the approved use cases
- ✅ I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- ✅ I do not use or transfer user data to determine creditworthiness or for lending purposes

### Privacy policy URL

Must be a publicly reachable URL. Once the repo is pushed, use the rendered file:

```
https://github.com/YOUR_USERNAME/ScrollRig/blob/main/PRIVACY.md
```

---

## Account tab

A verified contact email address is required before you can publish. Set it under **Account → Contact email** and click verify.

# ScrollRig

A scroll rig for case videos. It drives smooth, precisely-timed scrolling on a page you pick, so you can screen-record a website without the jitter of scrolling by hand.

It doesn't record anything itself — you keep using QuickTime, ScreenFlow, Loom, whatever you already use. ScrollRig just moves the page. The controls live in their own floating window, so they never appear in the recording and can sit on a second monitor.

It works on sites built with Lenis, Locomotive and other smooth-scroll libraries, because it drives the page with real wheel input rather than fighting the site's own scroll engine.

---

## Install

ScrollRig isn't in the Chrome Web Store yet, so you install it manually. Takes about a minute.

1. **Download the code.** Either clone it:
   ```bash
   git clone https://github.com/anders-am/ScrollRig.git
   ```
   or click **Code → Download ZIP** on GitHub and unzip it somewhere you won't accidentally delete. Chrome loads the extension from this folder every time it starts, so don't put it in Downloads.

2. Open **`chrome://extensions`** in Chrome.

3. Turn on **Developer mode** (top-right toggle).

4. Click **Load unpacked** and select the `ScrollRig` folder.

5. Click the ScrollRig icon in your toolbar. The control panel opens in its own window.

**If you move or rename the folder**, Chrome loses track of it — remove the extension and load it again from the new location.

---

## Use

Open the page you want to record, then click the ScrollRig icon.

The panel binds to whatever tab you're on. The big number at the top is the page's live scroll position; **Follow** (on by default) keeps it pointed at whichever tab you switch to. Click **Bind** to lock it to the current tab manually.

Position the panel on a second monitor, or anywhere outside the area you're capturing. Start your screen recorder, then drive the scroll from the panel.

### Quick — scroll by a set distance

Pick a **Distance**, a **Duration**, an **Easing** curve, and a **Direction**, then hit **Run scroll**. Each row of options is the value itself: click a preset, or type your own into the dashed slot at the end.

### From → To — scroll between two exact points

The one you'll use most for a clean shot of a specific section.

1. Scroll the page to where the shot should begin, then click the crosshair next to **Start** to capture that position. (Or type a number.)
2. Scroll to where it should end, click the crosshair next to **End**.
3. Set a **Duration** and **Easing**, then **Run start → end**.

It jumps to the start, waits a beat for the page to settle, then performs the scroll.

Give positions you reuse a name under **Marks** — they're saved per site, so your marks for one client's page don't show up on another's.

### Sequence — multi-step moves

Build a shot out of steps: **+ To** (scroll to a position), **+ Scroll** (scroll by a distance), **+ Wait** (pause). Drag steps to reorder them — a white line shows where the step will land.

**Stagger** generates a staggered scroll in one go: total distance, how many steps, duration of each, pause between.

**Loop** repeats the sequence so you can tune the timing without re-triggering it. The speed dropdown (0.5× / 1× / 2×) previews fast and records at real speed. Save a sequence under **Presets**, and use **Export** / **Import** to move presets between machines or share them.

### Keyboard shortcuts

Because the panel sits behind the browser window when you click into the page, the shortcuts work globally:

| Shortcut | Action |
|---|---|
| `⌘⇧1` / `Ctrl+Shift+1` | Set start |
| `⌘⇧2` / `Ctrl+Shift+2` | Set end |
| `⌘⇧Space` / `Ctrl+Shift+Space` | Run |
| `⌘⇧0` / `Ctrl+Shift+0` | Stop |

`Esc` also stops, when the panel has focus. There's a **Reset / Stop** link at the bottom of the panel too.

---

## Good to know

- **Tabs open before you installed it need a refresh.** Chrome only injects into pages that load after the extension does. ScrollRig seeds already-open tabs on install, but if a tab misbehaves, reload it.
- **It can't touch `chrome://` pages, the Chrome Web Store, or the PDF viewer.** No extension can.
- **Saved marks and presets are stored per site**, in local browser storage. Nothing is sent anywhere. See [PRIVACY.md](PRIVACY.md).
- **If wheel events are blocked** by a site, ScrollRig detects it and silently falls back to direct scrolling. Motion is still smooth, though a site's own scroll animation may not respond identically.

---

## License

[MIT](LICENSE)

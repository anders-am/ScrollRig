# Chrome Web Store — submission checklist

Work top to bottom. [LISTING.md](LISTING.md) has the copy for every text field.

---

## 1. One-time setup

- [ ] Register a developer account at [chrome.google.com/webstore/devconsole](https://chrome.google.com/webstore/devconsole) — **$5 one-time fee**, paid by card.
- [ ] Set and **verify a contact email** under Account settings. Publishing is blocked until this is verified.

Use whichever Google account you want to own this long-term — transferring an item between accounts later is awkward.

---

## 2. Build the package

```bash
./build.sh
```

This produces `dist/scrollrig-1.1.1.zip` containing only what the extension needs — `manifest.json`, the three scripts, the panel, and the icons. The README, store docs and design files are deliberately excluded; shipping them would only enlarge the package and give reviewers more surface to question.

To check what's in the zip before uploading:

```bash
unzip -l dist/scrollrig-1.1.1.zip
```

---

## 3. Assets to produce

The only hard requirement is one screenshot. The rest improve the listing.

| Asset | Size | Required | Notes |
|---|---|---|---|
| Store icon | 128×128 PNG | ✅ | Already in the package (`icons/icon128.png`). |
| Screenshot | **1280×800** or 640×400 PNG/JPEG | ✅ (1–5) | No alpha channel. See below. |
| Small promo tile | 440×280 PNG/JPEG | Optional | Shown in Web Store listings and search results. Worth doing. |
| Marquee promo tile | 1400×560 PNG/JPEG | Optional | Only used if you're ever featured. Skip for now. |

### Screenshot suggestions

Chrome shows these at the top of the listing, so they carry most of the persuasion. Four that would tell the story well:

1. **The panel beside a real page mid-scroll** — shows what the product actually is: a control surface next to a site.
2. **The From → To tab** with start and end captured and a travel distance showing — the core workflow.
3. **The Sequence tab** with a few steps built up — shows it's more than a one-click auto-scroller.
4. **The panel on a second monitor next to a recording app** — communicates "stays out of your recording" better than words can.

Take them at 1280×800 exactly. A macOS trick: `⌘⇧4`, press Space, click the window — then crop or pad to 1280×800. Padding onto a solid near-black canvas (`#090909`) matches the panel and looks deliberate.

> Screenshots must not contain client work you don't have permission to publish. The mockups in this project used a real client URL as sample data — use your own site, or a placeholder, for anything you upload publicly.

---

## 4. Fill in the dashboard

- [ ] **Upload** `dist/scrollrig-1.1.1.zip`
- [ ] **Store listing** — name, summary, detailed description, category, language, screenshots, promo tile ([LISTING.md](LISTING.md))
- [ ] **Privacy practices** — single purpose, a justification for each of the four permissions plus host permissions, "not using remote code", data-usage disclosures (tick nothing), all three certifications ([LISTING.md](LISTING.md))
- [ ] **Privacy policy URL** — `https://github.com/anders-am/ScrollRig/blob/main/PRIVACY.md`
- [ ] **Distribution** — pick a visibility (below)

---

## 5. Choose visibility

| Option | Who can install | Review | Best if |
|---|---|---|---|
| **Public** | Anyone; appears in search | Full review, strictest on `<all_urls>` | You want this to be a product other people find |
| **Unlisted** | Anyone with the direct link; not searchable | Still reviewed, usually less friction | You want to share it with colleagues and clients without maintaining a public product |
| **Private** | Only accounts you nominate, or your Workspace org | Lightest | It's an internal team tool |

**Unlisted is probably the right call** for a tool like this. You still get one-click installs and automatic updates for anyone you send the link to, without public-facing support expectations or SEO concerns — and broad host permissions attract less scrutiny than they do on a public listing.

---

## 6. Submit and wait

- [ ] Click **Submit for review**

Typical wait is a few days, though anything requesting `<all_urls>` can take longer and is the most common reason for a follow-up question. If it's rejected, the email names the specific policy — usually it's the host permission justification, which is why the one in [LISTING.md](LISTING.md) is written the way it is.

---

## Releasing an update later

1. Bump `"version"` in `manifest.json` — Chrome refuses an upload that isn't higher than the published one.
2. `./build.sh`
3. Upload the new zip to the existing item and submit again.

Updates are reviewed too, but usually go through faster than the initial submission.

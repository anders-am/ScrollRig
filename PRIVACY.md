# ScrollRig — Privacy Policy

_Last updated: 18 September 2026_

## Summary

ScrollRig does not collect, transmit, store remotely, or sell any data. It has no servers, no analytics, no telemetry, and no network requests of any kind.

## What the extension accesses

To do its job — scrolling a page you choose — ScrollRig reads the following, entirely within your browser:

- **The scroll position and page height of the tab you bind to.** Used to show the live position readout and to calculate scroll distances.
- **The address and title of the tab you bind to.** Used to show which page is bound, and to group your saved positions by site so marks from one site don't appear on another.

This information is read on demand, used immediately, and never leaves your computer.

## What is stored, and where

ScrollRig saves the following using `chrome.storage.local`, which is local browser storage on your own machine:

- Named scroll positions ("marks") you choose to save, grouped by website hostname
- Scroll sequences you save as presets
- The start and end positions you capture, per site
- The size and screen position of the control panel window

This data stays on your device. It is not synced, backed up to any service, or transmitted. Uninstalling ScrollRig removes it.

## What is never collected

ScrollRig does not collect or transmit any of the following: personally identifiable information, health information, financial or payment information, authentication information, personal communications, location, web browsing history, user activity, or website content.

## Third parties

There are none. No data is shared with, sold to, or transferred to any third party, because no data is ever sent off your device.

## Permissions, and why each is needed

| Permission | Why |
|---|---|
| `storage` | Save your marks, presets, and panel window position locally. |
| `tabs` | Identify which tab to drive, show its name in the panel, group saved positions by site, and notice when that tab closes or navigates away. |
| `scripting` | Insert the scrolling engine into the tab you bind to, when it isn't already present (for tabs that were open before ScrollRig was installed). |
| `windows` | Open the control panel as its own floating window, so it stays out of your screen recording, and remember where you put it. |
| Access to all websites | You decide at record time which page to scroll, so the extension cannot know the address in advance. It only ever acts on the single tab you explicitly bind it to, and only when you trigger a scroll. |

## Changes

Any change to this policy will be published in this file in the project repository, with an updated date above.

## Contact

Please open an issue on the project's GitHub repository.

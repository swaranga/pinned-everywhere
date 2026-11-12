# Pinned Everywhere

A small Chrome extension that keeps a configured set of pinned tabs (by default
Gmail, Google Calendar and Slack) open in every Chrome window: the first window
at startup, every new window you open, and windows restored from your last
session, without duplicating tabs that are already there.

It uses no third-party code and makes no network requests of its own.

## Install

Branded Google Chrome ignores the `--load-extension` flag since v137, so load it
once by hand. Chrome remembers it across restarts.

1. Clone this repo somewhere permanent. Chrome loads it from that path.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and pick the repo directory.

After pulling changes, click the reload icon on the extension's card.

Optional: set **Settings → On startup → Continue where you left off** so your
other tabs come back too. The extension recognises restored pinned tabs and
doesn't open them twice.

## Configure

Right-click the toolbar icon → **Options** (or **Details → Extension options**).

- **Pinned tabs**: one per line, in order, as `<url> [match-prefix]`. A window
  already has an entry when one of its pinned tabs' URL starts with the match
  prefix. The prefix defaults to the URL's origin (e.g. `https://mail.google.com/`).
  Use a longer prefix, such as `https://mail.google.com/mail/u/1/`, to tell
  accounts apart.
- **Windows**: *Every window*, or *One window*, where a new window gets the tabs
  only when no other window already has them.

## Behaviour

- Missing tabs open in the background, pinned, in the configured order. Existing
  pinned tabs are never moved, closed or reloaded.
- Only pinned tabs count as matches. An ordinary Gmail tab doesn't stop a pinned
  one from being added.
- Unpinning or closing a pinned tab only affects that window. It comes back the
  next time that window is checked: when you click the toolbar button, which
  restores missing pinned tabs in the current window, or when you save the options.
- Incognito windows, app windows (`--app=...`, Omarchy web apps), popups and
  floating picture-in-picture windows (like the one Google Meet pops out when
  you switch tabs during a call) are left alone.
- A new window gets its tabs about 1.5 seconds after it opens. The delay lets
  session restore finish attaching tabs before the extension checks the window.

## Permissions

- `tabs`: read tab URLs to see which pinned tabs a window already has, and open
  the missing ones.
- `storage`: save your settings locally (`chrome.storage.local`).

## Test

```sh
node test/smoke.mjs
```

This loads the extension into a throwaway headless Chromium profile and checks
startup, new windows, idempotency, single-window mode, session restore and
picture-in-picture windows. It
needs Node 22+ and Chromium (`CHROME_BIN` overrides the binary), not Google
Chrome, because Chrome no longer accepts `--load-extension`.

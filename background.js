import { loadSettings } from "./config.js";

// Session restore creates a window before attaching its tabs, so give a new
// window a moment to fill in before checking which pinned tabs it already has.
const SETTLE_MS = 1500;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const tabUrl = (tab) => tab.pendingUrl || tab.url || "";
const matches = (tab, entry) => tabUrl(tab).startsWith(entry.match);

// Run reconciles one at a time so overlapping events (browser startup plus
// window creation, say) can't both decide a tab is missing and open it twice.
let queue = Promise.resolve();
function enqueue(task) {
  queue = queue.then(task).catch((error) => console.error("[pinned-everywhere]", error));
  return queue;
}

// Document Picture-in-Picture windows, such as the floating window Google Meet
// pops out when you switch away from a call, report type "normal" but can't
// hold tabs. Their only tab is a blank page opened from a tab in another window.
function isPictureInPicture({ tabs = [] }) {
  const [tab] = tabs;
  return tabs.length === 1 && tabUrl(tab) === "about:blank" && tab.openerTabId !== undefined;
}

async function hasPinsElsewhere(windowId, entries) {
  const tabs = await chrome.tabs.query({ pinned: true, windowType: "normal" });
  return tabs.some((tab) => tab.windowId !== windowId && entries.some((entry) => matches(tab, entry)));
}

// Open whichever configured tabs this window lacks as pinned background tabs,
// in configured order. Pinned tabs that already match are left where they are.
async function reconcileWindow(windowId, { ignoreMode = false } = {}) {
  const { mode, entries } = await loadSettings();
  const win = await chrome.windows.get(windowId, { populate: true }).catch(() => null);
  if (!win || win.type !== "normal" || win.incognito || isPictureInPicture(win) || !entries.length) return;
  if (mode === "single" && !ignoreMode && (await hasPinsElsewhere(windowId, entries))) return;

  let index = 0;
  for (const entry of entries) {
    const pinned = await chrome.tabs.query({ windowId, pinned: true });
    let tab = pinned.find((t) => matches(t, entry));
    if (!tab) {
      tab = await chrome.tabs.create({ windowId, url: entry.url, pinned: true, active: false, index });
      // A window that can't hold tabs makes Chrome open the tab in another
      // window instead. Undo that rather than duplicating that window's tabs.
      if (tab.windowId !== windowId) {
        await chrome.tabs.remove(tab.id);
        return;
      }
    }
    index = tab.index + 1;
  }
}

async function reconcileAll() {
  const windows = await chrome.windows.getAll({ windowTypes: ["normal"] });
  // Focused window first, so in single mode that is the one that gets the tabs.
  windows.sort((a, b) => Number(b.focused) - Number(a.focused));
  for (const win of windows) await reconcileWindow(win.id);
}

chrome.runtime.onInstalled.addListener(() => enqueue(reconcileAll));

chrome.runtime.onStartup.addListener(() => delay(SETTLE_MS).then(() => enqueue(reconcileAll)));

chrome.windows.onCreated.addListener(
  (win) => delay(SETTLE_MS).then(() => enqueue(() => reconcileWindow(win.id))),
  { windowTypes: ["normal"] },
);

chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === "local") enqueue(reconcileAll);
});

// Toolbar button: put back any missing pinned tabs in this window, whatever the mode.
chrome.action.onClicked.addListener((tab) =>
  enqueue(() => reconcileWindow(tab.windowId, { ignoreMode: true })),
);

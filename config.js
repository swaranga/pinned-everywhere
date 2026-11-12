// Settings shared by the service worker and the options page.

export const DEFAULT_SETTINGS = {
  // "all": every window gets the pinned tabs.
  // "single": a new window gets them only when no other window already has them.
  mode: "all",
  entries: [
    { url: "https://mail.google.com/", match: "https://mail.google.com/" },
    { url: "https://calendar.google.com/", match: "https://calendar.google.com/" },
    { url: "https://app.slack.com/client", match: "https://app.slack.com/" },
  ],
};

export function loadSettings() {
  return chrome.storage.local.get(DEFAULT_SETTINGS);
}

function isHttpUrl(value) {
  try {
    const { protocol } = new URL(value);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

function defaultMatch(url) {
  return `${new URL(url).origin}/`;
}

// One entry per line: "<url>" or "<url> <match-prefix>". Lines starting with # are comments.
export function parseEntries(text) {
  const entries = [];
  const errors = [];
  text.split("\n").forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const [url, match, ...extra] = line.split(/\s+/);
    if (extra.length) {
      errors.push(`Line ${i + 1}: expected "<url> [match-prefix]"`);
    } else if (!isHttpUrl(url)) {
      errors.push(`Line ${i + 1}: not an http(s) URL: ${url}`);
    } else if (match !== undefined && !isHttpUrl(match)) {
      errors.push(`Line ${i + 1}: match prefix must be an http(s) URL: ${match}`);
    } else {
      entries.push({ url, match: match ?? defaultMatch(url) });
    }
  });
  return { entries, errors };
}

export function formatEntries(entries) {
  return entries
    .map(({ url, match }) => (match === defaultMatch(url) ? url : `${url} ${match}`))
    .join("\n");
}

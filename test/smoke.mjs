// Smoke test: loads the extension into a throwaway headless Chromium profile and
// checks that windows get the configured pinned tabs exactly once, including
// after a session restore, and that picture-in-picture windows are left alone.
//
// Usage: node test/smoke.mjs        (set CHROME_BIN to override the browser)
// Needs Chromium: branded Google Chrome ignores --load-extension since v137.
// All DNS lookups are failed on purpose, so no network access is needed and
// tabs keep their configured URLs instead of redirecting to a login page.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const extensionDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const profileDir = mkdtempSync(join(tmpdir(), "pinned-everywhere-test-"));
const chromeBin = process.env.CHROME_BIN ?? "chromium";
const EXPECTED = ["mail.google.com", "calendar.google.com", "app.slack.com"];
const WAIT_MS = 3000; // comfortably longer than the extension's settle delay

async function launch(extraArgs = []) {
  rmSync(join(profileDir, "DevToolsActivePort"), { force: true });
  const proc = spawn(
    chromeBin,
    [
      "--headless=new",
      `--user-data-dir=${profileDir}`,
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
      "--host-resolver-rules=MAP * ~NOTFOUND",
      "--remote-debugging-port=0",
      "--no-first-run",
      "--no-default-browser-check",
      ...extraArgs,
    ],
    { stdio: "ignore" },
  );
  const exited = new Promise((resolve) => proc.once("exit", resolve));

  let lines;
  for (let i = 0; i < 100 && !lines; i++) {
    try {
      lines = readFileSync(join(profileDir, "DevToolsActivePort"), "utf8").trim().split("\n");
    } catch {
      await sleep(100);
    }
  }
  if (!lines) throw new Error(`${chromeBin} did not start`);

  const ws = new WebSocket(`ws://127.0.0.1:${lines[0]}${lines[1]}`);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  let nextId = 0;
  const pending = new Map();
  ws.onmessage = ({ data }) => {
    const { id, result, error } = JSON.parse(data);
    const call = pending.get(id);
    if (!call) return;
    pending.delete(id);
    error ? call.reject(new Error(error.message)) : call.resolve(result);
  };
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params, sessionId }));
    });

  // Attach to the extension's service worker to drive and inspect chrome.* APIs.
  let worker;
  for (let i = 0; i < 50 && !worker; i++) {
    const { targetInfos } = await send("Target.getTargets");
    worker = targetInfos.find((t) => t.type === "service_worker" && t.url.endsWith("/background.js"));
    if (!worker) await sleep(100);
  }
  if (!worker) throw new Error("extension service worker not found");
  const { sessionId } = await send("Target.attachToTarget", { targetId: worker.targetId, flatten: true });

  const evaluate = async (fn, arg) => {
    const { result, exceptionDetails } = await send(
      "Runtime.evaluate",
      { expression: `(${fn})(${JSON.stringify(arg)})`, awaitPromise: true, returnByValue: true },
      sessionId,
    );
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
  };

  const close = async () => {
    await send("Browser.close").catch(() => {});
    await exited;
  };

  return { send, evaluate, close, kill: () => proc.kill() };
}

// Pinned tab hostnames per normal window, ordered by window id.
const pinnedPerWindow = (browser) =>
  browser.evaluate(async () => {
    const windows = await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] });
    return windows
      .sort((a, b) => a.id - b.id)
      .map((w) => w.tabs.filter((t) => t.pinned).map((t) => new URL(t.pendingUrl || t.url).hostname));
  });

const setSettings = (browser, settings) => browser.evaluate((s) => chrome.storage.local.set(s), settings);
const openWindow = (browser) => browser.evaluate(() => chrome.windows.create({ url: "about:blank" }).then((w) => w.id));

// Opens a Document Picture-in-Picture window, like the floating window Google
// Meet pops out when you switch away from a call. That needs a user gesture in
// a secure page, so request it from the extension's own options page.
async function openPictureInPicture(browser) {
  const url = await browser.evaluate(() => chrome.runtime.getURL("options.html"));
  await browser.evaluate((u) => chrome.tabs.create({ url: u }), url);
  let page;
  for (let i = 0; i < 50 && !page; i++) {
    const { targetInfos } = await browser.send("Target.getTargets");
    page = targetInfos.find((t) => t.type === "page" && t.url === url);
    if (!page) await sleep(100);
  }
  if (!page) throw new Error("options page not found");
  const { sessionId } = await browser.send("Target.attachToTarget", { targetId: page.targetId, flatten: true });
  const { exceptionDetails } = await browser.send(
    "Runtime.evaluate",
    { expression: "documentPictureInPicture.requestWindow()", awaitPromise: true, userGesture: true },
    sessionId,
  );
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
}

let browser;
try {
  browser = await launch(["about:blank"]);
  await sleep(WAIT_MS);
  assert.deepEqual(await pinnedPerWindow(browser), [EXPECTED], "first window gets the pinned tabs");
  console.log("ok - first window gets the pinned tabs");

  await openWindow(browser);
  await sleep(WAIT_MS);
  assert.deepEqual(await pinnedPerWindow(browser), [EXPECTED, EXPECTED], "new window gets them too");
  console.log("ok - new window gets the pinned tabs");

  await setSettings(browser, { mode: "single" });
  await setSettings(browser, { mode: "all" });
  await sleep(WAIT_MS);
  assert.deepEqual(await pinnedPerWindow(browser), [EXPECTED, EXPECTED], "re-running adds no duplicates");
  console.log("ok - re-running adds no duplicates");

  await setSettings(browser, { mode: "single" });
  const singleId = await openWindow(browser);
  await sleep(WAIT_MS);
  assert.deepEqual(await pinnedPerWindow(browser), [EXPECTED, EXPECTED, []], "single mode skips new windows");
  console.log("ok - single mode leaves new windows alone");

  await browser.evaluate((id) => chrome.windows.remove(id), singleId);
  await setSettings(browser, { mode: "all" });
  await sleep(WAIT_MS);
  await browser.close();

  browser = await launch(["--restore-last-session"]);
  await sleep(WAIT_MS);
  assert.deepEqual(await pinnedPerWindow(browser), [EXPECTED, EXPECTED], "session restore adds no duplicates");
  console.log("ok - session restore adds no duplicates");

  // Chrome reports these windows as "normal" but opens tabs aimed at them in another window.
  await openPictureInPicture(browser);
  await sleep(WAIT_MS);
  assert.deepEqual(await pinnedPerWindow(browser), [EXPECTED, EXPECTED, []], "picture-in-picture adds no duplicates");
  console.log("ok - picture-in-picture windows are left alone");

  await browser.close();
  browser = undefined;
} finally {
  browser?.kill();
  rmSync(profileDir, { recursive: true, force: true });
}

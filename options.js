import { DEFAULT_SETTINGS, formatEntries, loadSettings, parseEntries } from "./config.js";

const form = document.querySelector("form");
const { entries: entriesField, mode: modeField } = form.elements;
const status = document.getElementById("status");

function show({ mode, entries }) {
  entriesField.value = formatEntries(entries);
  modeField.value = mode;
}

function report(message, isError = false) {
  status.textContent = message;
  status.classList.toggle("error", isError);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const { entries, errors } = parseEntries(entriesField.value);
  if (errors.length) {
    report(errors.join("\n"), true);
    return;
  }
  await chrome.storage.local.set({ entries, mode: modeField.value });
  report("Saved.");
});

document.getElementById("defaults").addEventListener("click", () => {
  show(DEFAULT_SETTINGS);
  report("Defaults restored. Save to apply.");
});

show(await loadSettings());

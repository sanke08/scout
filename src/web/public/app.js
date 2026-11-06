/* global document, window, location */
/**
 * Starts the page: wires the three views (Digest, Profile, Settings) to the address hash
 * (#digest, #profile, #settings), shows the status line and the error banner, and passes
 * keystrokes to the Digest.
 */
import { api } from "./api-client.js";
import { clearChildren, h } from "./dom.js";
import { createDigestView } from "./digest-view.js";
import { createProfileView } from "./profile-view.js";
import { createSettingsView } from "./settings-view.js";

/** The names of the three views, in navigation order. */
const VIEW_NAMES = ["digest", "profile", "settings"];

/** Plain-words label for each apply mode shown in the status line. */
const MODE_LABELS = {
  approve: "Wait for approval",
  auto: "Automatic on trusted boards",
  prepare: "Prepare only",
};

/** What the status line shows; filled in as the Digest and Settings report facts. */
const status = { generatedAt: null, mode: null, paused: false };

const errorBanner = document.getElementById("errorBanner");
const statusLine = document.getElementById("statusLine");

/** Shows a full-sentence error above the views. */
function showError(message) {
  errorBanner.textContent = message;
  errorBanner.hidden = false;
}

/** Hides the error banner. */
function clearError() {
  errorBanner.textContent = "";
  errorBanner.hidden = true;
}

/** Redraws the status line from `status`: date, apply mode and the paused warning. */
function renderStatus() {
  clearChildren(statusLine);
  if (status.generatedAt) {
    const date = new Date(status.generatedAt).toLocaleDateString(undefined, {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
    statusLine.appendChild(h("li", {}, date));
  }
  if (status.mode) {
    statusLine.appendChild(
      h("li", {}, "Mode ", h("b", {}, MODE_LABELS[status.mode] ?? status.mode)),
    );
  }
  if (status.paused) statusLine.appendChild(h("li", {}, h("b", {}, "Automation paused")));
}

/** Called by the Digest when it has fresh facts for the status line. */
function onDigestFacts(facts) {
  status.generatedAt = facts.generatedAt;
  status.mode = facts.mode;
  status.paused = facts.automationPaused;
  renderStatus();
}

/** Called by Settings after a save, so the status line follows the new mode and pause state. */
function onSettingsChanged(settings) {
  status.mode = settings.applyMode;
  status.paused = settings.automationPaused;
  renderStatus();
}

const context = { api, showError, clearError };
const views = {
  digest: createDigestView(document.getElementById("viewDigest"), context, onDigestFacts),
  profile: createProfileView(document.getElementById("viewProfile"), context),
  settings: createSettingsView(document.getElementById("viewSettings"), context, onSettingsChanged),
};

/** The view named by the address hash; anything unknown means the Digest. */
function currentViewName() {
  const name = location.hash.replace("#", "");
  return VIEW_NAMES.includes(name) ? name : "digest";
}

/** Shows the view for the current hash, marks it in the navigation, and loads its data. */
function route() {
  const active = currentViewName();
  clearError();
  for (const name of VIEW_NAMES) {
    const label = name.charAt(0).toUpperCase() + name.slice(1);
    document.getElementById(`view${label}`).hidden = name !== active;
    const link = document.getElementById(`nav${label}`);
    if (name === active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  void views[active].load();
}

document.addEventListener("keydown", (event) => {
  const tag = event.target.tagName;
  if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  if (currentViewName() !== "digest") return;
  views.digest.handleKey(event);
});
window.addEventListener("hashchange", route);
route();

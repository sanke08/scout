/**
 * The Pause / Resume button in the page header: the kill switch, always in reach. Pausing is one
 * click. Resuming asks once, in the page, because it lets Scout fill forms and submit again. The
 * change goes through the same settings route as the Settings tab, and always starts from the
 * newest saved settings so it never overwrites another change.
 */
import { clearChildren, h } from "./dom.js";

/**
 * Creates the control inside `root`; returns `{ load, sync }`. `sync(paused)` shows a pause state
 * learned elsewhere (the Digest or the Settings tab). `onChanged` gets the saved settings.
 */
export function createPauseControl(root, context, onChanged) {
  const state = { paused: null, confirming: false, busy: false };

  /** Saves the new pause state through the settings route, then redraws. */
  async function setPaused(paused) {
    state.busy = true;
    state.confirming = false;
    render();
    try {
      const latest = (await context.api.getSettings()).settings;
      const saved = (await context.api.putSettings({ ...latest, automationPaused: paused }))
        .settings;
      state.paused = saved.automationPaused;
      context.clearError();
      onChanged(saved);
    } catch (error) {
      context.showError(error.message);
    }
    state.busy = false;
    render();
  }

  /** Redraws the button, or the one-step confirmation when resuming. */
  function render() {
    clearChildren(root);
    if (state.paused === null) return;
    if (state.confirming) {
      root.appendChild(
        h(
          "span",
          { class: "pause-confirm", role: "group", "aria-label": "Confirm resume" },
          h("span", { class: "small" }, "Let Scout fill forms and submit again?"),
          h(
            "button",
            {
              class: "btn primary",
              type: "button",
              id: "resumeConfirm",
              on: { click: () => void setPaused(false) },
            },
            "Yes, resume",
          ),
          h(
            "button",
            {
              class: "btn",
              type: "button",
              on: {
                click: () => {
                  state.confirming = false;
                  render();
                },
              },
            },
            "Cancel",
          ),
        ),
      );
      return;
    }
    root.appendChild(
      h(
        "button",
        {
          class: state.paused ? "btn primary" : "btn",
          type: "button",
          id: "pauseToggle",
          disabled: state.busy,
          on: {
            click: () => {
              if (state.paused) {
                state.confirming = true;
                render();
              } else void setPaused(true);
            },
          },
        },
        state.paused ? "Resume automation" : "Pause automation",
      ),
    );
  }

  /** Reads the saved pause state and draws the button. */
  async function load() {
    try {
      state.paused = (await context.api.getSettings()).settings.automationPaused;
    } catch (error) {
      context.showError(error.message);
    }
    render();
  }

  /** Shows a pause state learned elsewhere. */
  function sync(paused) {
    if (state.busy || state.paused === paused) return;
    state.paused = paused;
    state.confirming = false;
    render();
  }

  return { load, sync };
}

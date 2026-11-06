/* global document, URL */
/**
 * Tiny helpers for building page elements safely. Every piece of text that comes from the server
 * (job titles, profile points, error messages) goes into the page through `textContent` or a text
 * node, never through `innerHTML`, so text such as `<img onerror=...>` is shown as plain text and
 * can never run. This file is the only place that creates elements.
 */

/**
 * Builds an element. `attributes` may hold plain attributes, `class`, `text` (a string shown as
 * text), and `on` (an object of event name to listener). `children` are strings, elements, arrays
 * of those, or null/false (skipped).
 * Example: `h("p", { class: "small" }, "Saved.")` is `<p class="small">Saved.</p>`.
 */
export function h(tag, attributes, ...children) {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (name === "class") element.className = value;
    else if (name === "text") element.textContent = value;
    else if (name === "on") {
      for (const [eventName, listener] of Object.entries(value)) {
        element.addEventListener(eventName, listener);
      }
    } else if (name === "value") element.value = value;
    else if (name === "checked") element.checked = Boolean(value);
    else if (name === "selected") element.selected = Boolean(value);
    else element.setAttribute(name, value === true ? "" : String(value));
  }
  appendChildren(element, children);
  return element;
}

/** Adds strings (as text nodes), elements and nested arrays to `parent`; skips null and false. */
export function appendChildren(parent, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) appendChildren(parent, child);
    else if (typeof child === "string") parent.appendChild(document.createTextNode(child));
    else parent.appendChild(child);
  }
}

/** Removes everything inside `parent`. */
export function clearChildren(parent) {
  while (parent.firstChild) parent.removeChild(parent.firstChild);
}

/**
 * Returns `value` when it is an http or https address, otherwise null. A link whose address came
 * from the server is only made clickable when this returns something, so `javascript:` addresses
 * never become links.
 * Example: `safeHttpUrl("https://example.com/job")` is that string; `safeHttpUrl("javascript:x")` is null.
 */
export function safeHttpUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

/** Splits a comma or line separated list into trimmed, non-empty terms. "a, b\nc" gives a, b, c. */
export function splitTerms(text) {
  return String(text ?? "")
    .split(/[,\n]+/)
    .map((term) => term.trim())
    .filter(Boolean);
}

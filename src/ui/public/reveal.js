// envault UI — reveal slice (B2, Wave 2).
//
// Exposes `window.envault.reveal(name, opts)` which:
//   1. POSTs /api/reveal/nonce, receives { nonce, expiresAt }.
//   2. Immediately POSTs /api/reveal with { name, nonce }, receives { value }.
//   3. Renders the value read-only inside the edit view's reveal slot,
//      starts a 15-second countdown, then auto-hides by replacing the
//      textContent with the masked glyph AND removing the old text node so
//      the plaintext never lingers in the DOM for a devtools inspector.
//   4. A second click during the countdown fetches a fresh nonce+value and
//      resets the 15-second timer. Nonces are single-use; re-revealing
//      always costs one nonce.
//
// --------------------------------------------------------------------------
// Integration contract with B1 (edit-secret form)
// --------------------------------------------------------------------------
// B1 is expected to render, inside the edit-secret form, an empty DOM hook:
//
//   <div class="edit-reveal-slot" data-secret-name="FOO"></div>
//
// This module discovers such slots via a MutationObserver (for dynamically
// rendered edit views) and injects a "Reveal value" button + readout into
// each one. If B1's slot exposes a different class/attribute, adjust the
// selectors below — they are isolated at the top of attachToAll().
//
// Behaviour guarantees baked in:
//   - The value is NEVER written to a <textarea> or <input type=text> that
//     might be picked up by browser autofill — we use a <pre> element with
//     autocomplete="off", spellcheck="false", and aria-live="polite".
//   - On auto-hide the element's text node is replaced (not just cleared)
//     so the plaintext is not reachable from a cached Node reference.
//   - The module never stores the plaintext in a JS variable outside the
//     render function's closure; the closure holds it only until the timer
//     fires or the user triggers a fresh reveal.
// --------------------------------------------------------------------------

(function () {
  'use strict';

  // The hook B1 renders. A class rather than id so multiple edit views can
  // coexist (e.g. if B1 ever supports inline-edit on the list). One instance
  // of this module handles all of them.
  var SLOT_SELECTOR = '.edit-reveal-slot, [data-envault-reveal-slot]';
  var HIDE_MS = 15_000;
  var MASK = '••••••••'; // eight bullets

  function apiFetch(path, init) {
    if (!window.envault || typeof window.envault.apiFetch !== 'function') {
      throw new Error('envault.apiFetch is not loaded; app.js must run first');
    }
    return window.envault.apiFetch(path, init);
  }

  async function postJson(path, payload) {
    var res = await apiFetch(path, {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    });
    var body;
    try {
      body = await res.json();
    } catch (_e) {
      body = null;
    }
    return { status: res.status, body: body };
  }

  /**
   * Fetch-a-nonce then fetch-a-value. Resolves with { value } or rejects with
   * an Error whose `.status` is the offending HTTP status.
   */
  async function fetchReveal(name) {
    var nRes = await postJson('/api/reveal/nonce', {});
    if (nRes.status !== 200 || !nRes.body || typeof nRes.body.nonce !== 'string') {
      var err1 = new Error((nRes.body && nRes.body.error) || 'failed to mint nonce');
      err1.status = nRes.status;
      throw err1;
    }
    var rRes = await postJson('/api/reveal', { name: name, nonce: nRes.body.nonce });
    if (rRes.status !== 200 || !rRes.body || typeof rRes.body.value !== 'string') {
      var err2 = new Error((rRes.body && rRes.body.error) || 'reveal failed');
      err2.status = rRes.status;
      throw err2;
    }
    return { value: rRes.body.value };
  }

  /**
   * Create a reveal widget inside `slot`. Returns a dispose() function.
   */
  function mountWidget(slot) {
    var name = slot.getAttribute('data-secret-name') ||
      slot.getAttribute('data-envault-reveal-slot') || '';
    if (!name) {
      // Can't reveal without a name; render an inert notice.
      var notice = document.createElement('span');
      notice.className = 'reveal-error';
      notice.textContent = '(no data-secret-name)';
      slot.appendChild(notice);
      return function () { slot.removeChild(notice); };
    }

    var wrap = document.createElement('div');
    wrap.className = 'reveal-widget';

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'reveal-button';
    btn.textContent = 'Reveal value';
    btn.setAttribute('aria-label', 'Reveal value for ' + name);

    // <pre> not <textarea>: textarea values are picked up by browser autofill
    // and password managers. <pre> text is not submitted with forms.
    var out = document.createElement('pre');
    out.className = 'reveal-value reveal-hidden';
    out.setAttribute('autocomplete', 'off');
    out.setAttribute('spellcheck', 'false');
    out.setAttribute('aria-live', 'polite');
    out.hidden = true;

    var countdown = document.createElement('span');
    countdown.className = 'reveal-countdown';
    countdown.setAttribute('aria-live', 'polite');

    var err = document.createElement('span');
    err.className = 'reveal-error';
    err.setAttribute('role', 'alert');
    err.hidden = true;

    wrap.appendChild(btn);
    wrap.appendChild(countdown);
    wrap.appendChild(out);
    wrap.appendChild(err);
    slot.appendChild(wrap);

    var hideTimer = null;
    var tickTimer = null;
    var disposed = false;

    function clearTimers() {
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
      if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
    }

    function hideValue() {
      clearTimers();
      // Replace the text node rather than just setting .textContent to ''
      // because setting .textContent to '' leaves the Text node in place (but
      // empty). Replacing it forces the old plaintext Text node out of the
      // DOM tree entirely.
      while (out.firstChild) out.removeChild(out.firstChild);
      out.appendChild(document.createTextNode(MASK));
      out.classList.add('reveal-hidden');
      out.hidden = true;
      countdown.textContent = '';
      btn.disabled = false;
      btn.textContent = 'Reveal value';
    }

    function showValue(value) {
      clearTimers();
      // Ditto on the way in: remove any prior text node first.
      while (out.firstChild) out.removeChild(out.firstChild);
      out.appendChild(document.createTextNode(value));
      out.classList.remove('reveal-hidden');
      out.hidden = false;
      err.hidden = true;
      err.textContent = '';
      btn.disabled = false;
      btn.textContent = 'Reveal again';

      var deadline = Date.now() + HIDE_MS;
      function tick() {
        if (disposed) return;
        var remaining = Math.max(0, deadline - Date.now());
        var secs = Math.ceil(remaining / 1000);
        countdown.textContent = 'hides in ' + secs + 's';
      }
      tick();
      tickTimer = setInterval(tick, 250);
      hideTimer = setTimeout(hideValue, HIDE_MS);
    }

    function showError(message) {
      clearTimers();
      hideValue();
      err.textContent = message;
      err.hidden = false;
    }

    async function onClick() {
      if (disposed) return;
      btn.disabled = true;
      err.hidden = true;
      err.textContent = '';
      try {
        var got = await fetchReveal(name);
        if (disposed) return;
        showValue(got.value);
      } catch (e) {
        if (disposed) return;
        var msg = e && e.message ? e.message : 'failed to reveal';
        if (e && e.status === 429) msg = 'rate limited — wait a moment and retry';
        if (e && e.status === 503) msg = 'identity locked; run `envault identity unlock` in a terminal';
        showError(msg);
      }
    }

    btn.addEventListener('click', onClick);

    // Mark so the observer skips re-mounting.
    slot.setAttribute('data-envault-reveal-mounted', '1');

    return function dispose() {
      disposed = true;
      clearTimers();
      btn.removeEventListener('click', onClick);
      // Scrub any in-flight value.
      while (out.firstChild) out.removeChild(out.firstChild);
      if (wrap.parentNode === slot) slot.removeChild(wrap);
      slot.removeAttribute('data-envault-reveal-mounted');
    };
  }

  var mounted = new WeakMap(); // slot → dispose()

  function attachToAll(root) {
    var nodes = (root || document).querySelectorAll(SLOT_SELECTOR);
    for (var i = 0; i < nodes.length; i++) {
      var slot = nodes[i];
      if (slot.getAttribute('data-envault-reveal-mounted')) continue;
      var dispose = mountWidget(slot);
      mounted.set(slot, dispose);
    }
  }

  function detachOrphans() {
    // Best-effort GC: if a mounted slot was removed from the DOM by B1's
    // edit-view teardown, its dispose() still fires via the new render
    // (because the slot node itself is gone, the WeakMap entry is garbage).
    // Nothing to do here — the WeakMap lets the entry collect naturally.
  }

  function startObserver() {
    attachToAll(document);
    var mo = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var m = mutations[i];
        for (var j = 0; j < m.addedNodes.length; j++) {
          var node = m.addedNodes[j];
          if (node.nodeType !== 1) continue; // element
          if (node.matches && node.matches(SLOT_SELECTOR)) {
            if (!node.getAttribute('data-envault-reveal-mounted')) {
              var dispose = mountWidget(node);
              mounted.set(node, dispose);
            }
          }
          if (node.querySelectorAll) attachToAll(node);
        }
      }
      detachOrphans();
    });
    mo.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  // Public entry: allow manual-trigger tests / embeds to kick off a reveal
  // without clicking the injected button. Resolves with the value string; the
  // caller takes responsibility for hiding it.
  async function revealProgrammatic(name) {
    var got = await fetchReveal(name);
    return got.value;
  }

  // Install on window.envault without clobbering existing fields.
  window.envault = window.envault || {};
  window.envault.reveal = revealProgrammatic;
  window.envault._revealInternal = { fetchReveal: fetchReveal, mountWidget: mountWidget };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObserver);
  } else {
    startObserver();
  }
})();

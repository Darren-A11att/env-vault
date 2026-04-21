// envault UI — wave 1 skeleton.
// Reads the token from the URL fragment (`#t=<token>`), strips the fragment
// from the address bar, then calls /api/identity with the token in the
// `x-envault-token` header.

(function () {
  'use strict';

  function parseToken() {
    const hash = window.location.hash || '';
    const m = hash.match(/(?:^#|[#&])t=([a-f0-9]+)/i);
    return m ? m[1] : '';
  }

  function stripFragment() {
    try {
      const url = window.location.pathname + window.location.search;
      window.history.replaceState(null, '', url);
    } catch (_e) {
      // Non-fatal: some environments disallow replaceState.
    }
  }

  function showError(msg) {
    const el = document.getElementById('error');
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
  }

  function renderIdentity(data) {
    const fp = document.getElementById('fp');
    const cache = document.getElementById('cache');
    if (fp) fp.textContent = data.fingerprint || 'unknown';
    if (cache) {
      cache.textContent = data.cache || 'unknown';
      cache.className = data.cache === 'present' ? 'cache-present' : 'cache-absent';
    }
  }

  // Expose for wave-2 modules. This is the canonical way to call the API.
  window.envault = window.envault || {};
  window.envault.token = parseToken();
  window.envault.apiFetch = function (path, init) {
    init = init || {};
    const headers = new Headers(init.headers || {});
    headers.set('x-envault-token', window.envault.token);
    if (init.body && !headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }
    return fetch(path, Object.assign({}, init, { headers: headers }));
  };

  stripFragment();

  if (!window.envault.token) {
    showError('No token found in URL. Launch via `envault ui`.');
    return;
  }

  window.envault
    .apiFetch('/api/identity')
    .then(function (res) {
      if (!res.ok) {
        throw new Error('HTTP ' + res.status);
      }
      return res.json();
    })
    .then(renderIdentity)
    .catch(function (err) {
      showError('Failed to load identity: ' + (err && err.message ? err.message : err));
    });
})();

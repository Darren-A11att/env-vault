// envault UI — import slice (B3).
// Drag-and-drop a .env file onto the window, preview parsed entries with
// masked values, confirm, POST to /api/import, render returned pseudokeys.
//
// Client-side rules:
//   - Parse the file locally FIRST and show a preview before uploading.
//   - Show only first 4 + last 4 chars of each value (dots for the middle).
//   - Cap envText at 512 KiB (matches the server limit).
//   - Only accept the first file if multiple are dropped.
//   - Upload only the checked rows, re-stitched into an envText payload.

(function () {
  'use strict';

  const MAX_ENV_BYTES = 512 * 1024;
  // Match src/lib/importEnv.ts and the CRUD handler.
  const NAME_RE = /^[A-Z_][A-Z0-9_]*$/i;
  // Match src/pseudokey.ts SINGLE regex.
  const PSEUDOKEY_RE = /^envault-[0-9a-f]{8,12}$/;

  // ---- tiny DOM helpers ----

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'onclick') node.addEventListener('click', attrs[k]);
        else if (k === 'onchange') node.addEventListener('change', attrs[k]);
        else node.setAttribute(k, attrs[k]);
      }
    }
    if (children) {
      for (const child of children) {
        if (child == null) continue;
        node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
      }
    }
    return node;
  }

  function maskValue(v) {
    if (typeof v !== 'string') return '';
    if (v.length <= 8) {
      // Too short to meaningfully reveal edges — fully mask.
      return '•'.repeat(Math.max(v.length, 4));
    }
    const head = v.slice(0, 4);
    const tail = v.slice(-4);
    return head + '•'.repeat(6) + tail;
  }

  // ---- .env parser (client-side, conservative) ----
  //
  // Mirrors dotenv's common cases without pulling a dependency:
  //   - Lines starting with `#` or blank are ignored.
  //   - `export ` prefix is stripped.
  //   - Values may be single- or double-quoted; inner \n escapes in double
  //     quotes become real newlines. Unquoted values are trimmed.
  // Real parse happens server-side; this is for the preview only.

  function parseEnv(text) {
    const entries = [];
    const lines = String(text).split(/\r?\n/);
    const lineRe = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/;
    for (const raw of lines) {
      const line = raw;
      const trimmed = line.trimStart();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const m = line.match(lineRe);
      if (!m) continue;
      const name = m[1];
      let value = m[2];
      if (value.length >= 2) {
        const q = value[0];
        if ((q === '"' || q === "'") && value[value.length - 1] === q) {
          value = value.slice(1, -1);
          if (q === '"') {
            value = value.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t');
          }
        }
      }
      entries.push({ name: name, value: value });
    }
    return entries;
  }

  // ---- preview rendering ----

  let currentEntries = [];
  let currentCheckState = [];
  let currentPseudokeys = {};

  function renderPreview(entries) {
    const root = document.getElementById('import-panel');
    if (!root) return;
    root.hidden = false;
    root.innerHTML = '';
    currentEntries = entries;
    currentCheckState = entries.map((e) => ({
      checked: true,
      valid: NAME_RE.test(e.name),
      alreadyPseudokey: PSEUDOKEY_RE.test(e.value),
    }));
    currentPseudokeys = {};

    const invalidCount = currentCheckState.filter((c) => !c.valid).length;

    const header = el('div', { class: 'import-header' }, [
      el('span', { class: 'import-title' }, ['Drop detected — review before import']),
      el(
        'button',
        { class: 'import-close', onclick: closePreview, type: 'button' },
        ['Close'],
      ),
    ]);
    root.appendChild(header);

    if (invalidCount > 0) {
      root.appendChild(
        el('div', { class: 'import-warning' }, [
          `${invalidCount} entr${invalidCount === 1 ? 'y has' : 'ies have'} an invalid name and will be rejected by the server.`,
        ]),
      );
    }

    const table = el('table', { class: 'import-table' }, [
      el('thead', null, [
        el('tr', null, [
          el('th', null, ['✓']),
          el('th', null, ['Name']),
          el('th', null, ['Value preview']),
          el('th', null, ['Pseudokey']),
        ]),
      ]),
    ]);
    const tbody = el('tbody', null, []);
    entries.forEach((entry, idx) => {
      const state = currentCheckState[idx];
      const checkbox = el('input', {
        type: 'checkbox',
        class: 'import-check',
        'data-idx': String(idx),
      });
      checkbox.checked = true;
      if (!state.valid) checkbox.disabled = true;
      checkbox.addEventListener('change', (ev) => {
        const i = Number(ev.target.getAttribute('data-idx'));
        currentCheckState[i].checked = ev.target.checked;
        updateImportButton();
      });
      const row = el(
        'tr',
        { class: 'import-row' + (!state.valid ? ' import-row-invalid' : '') },
        [
          el('td', null, [checkbox]),
          el('td', { class: 'import-name' }, [entry.name]),
          el('td', { class: 'import-value' }, [
            state.alreadyPseudokey ? entry.value : maskValue(entry.value),
          ]),
          el(
            'td',
            { class: 'import-pk', 'data-idx-pk': String(idx) },
            [state.alreadyPseudokey ? entry.value + ' (existing)' : ''],
          ),
        ],
      );
      tbody.appendChild(row);
    });
    table.appendChild(tbody);
    root.appendChild(table);

    const actions = el('div', { class: 'import-actions' }, [
      el('button', {
        id: 'import-submit',
        class: 'import-submit',
        type: 'button',
        onclick: submitImport,
      }, ['Import 0 selected']),
      el('span', { id: 'import-status', class: 'import-status' }, ['']),
    ]);
    root.appendChild(actions);
    updateImportButton();
  }

  function updateImportButton() {
    const btn = document.getElementById('import-submit');
    if (!btn) return;
    const selected = selectedIndices();
    btn.textContent = 'Import ' + selected.length + ' selected';
    btn.disabled = selected.length === 0;
  }

  function selectedIndices() {
    const out = [];
    for (let i = 0; i < currentCheckState.length; i++) {
      if (currentCheckState[i].checked && currentCheckState[i].valid) out.push(i);
    }
    return out;
  }

  function closePreview() {
    const root = document.getElementById('import-panel');
    if (!root) return;
    root.hidden = true;
    root.innerHTML = '';
    currentEntries = [];
    currentCheckState = [];
    currentPseudokeys = {};
  }

  function setStatus(text, isError) {
    const s = document.getElementById('import-status');
    if (!s) return;
    s.textContent = text || '';
    s.classList.toggle('import-status-error', !!isError);
  }

  // ---- upload ----

  async function submitImport() {
    const selected = selectedIndices();
    if (selected.length === 0) return;
    const lines = selected.map((i) => {
      const e = currentEntries[i];
      // Re-quote the value with double quotes; escape backslashes and inner
      // double quotes. This produces something the server's dotenv.parse can
      // round-trip to the original string.
      const escaped = e.value
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r');
      return `${e.name}="${escaped}"`;
    });
    const envText = lines.join('\n') + '\n';
    if (new Blob([envText]).size > MAX_ENV_BYTES) {
      setStatus('Selected entries exceed 512 KiB — deselect some rows.', true);
      return;
    }

    setStatus('Importing…', false);
    const btn = document.getElementById('import-submit');
    if (btn) btn.disabled = true;
    try {
      const res = await window.envault.apiFetch('/api/import', {
        method: 'POST',
        body: JSON.stringify({ envText: envText }),
      });
      if (!res.ok) {
        let msg = 'HTTP ' + res.status;
        try {
          const body = await res.json();
          if (body && body.error) msg = body.error;
        } catch (_e) {}
        setStatus('Import failed: ' + msg, true);
        if (btn) btn.disabled = false;
        return;
      }
      const body = await res.json();
      currentPseudokeys = body.pseudokeys || {};
      applyPseudokeys(currentPseudokeys);
      const parts = [];
      parts.push(`Imported ${body.imported}`);
      if (body.skipped) parts.push(`${body.skipped} already pseudokeys`);
      if (body.rejected && body.rejected.length) {
        parts.push(`${body.rejected.length} rejected`);
      }
      setStatus(parts.join(', ') + '.', false);
      // Leave button disabled after success — pseudokeys are now visible.
    } catch (err) {
      setStatus('Import failed: ' + (err && err.message ? err.message : err), true);
      if (btn) btn.disabled = false;
    }
  }

  function applyPseudokeys(pseudokeys) {
    const cells = document.querySelectorAll('[data-idx-pk]');
    for (const cell of cells) {
      const i = Number(cell.getAttribute('data-idx-pk'));
      const entry = currentEntries[i];
      if (!entry) continue;
      const pk = pseudokeys[entry.name];
      if (!pk) continue;
      cell.textContent = '';
      const codeEl = el('code', { class: 'import-pk-value' }, [pk]);
      const copyBtn = el(
        'button',
        {
          type: 'button',
          class: 'import-copy',
          onclick: () => copyToClipboard(pk, copyBtn),
        },
        ['Copy'],
      );
      cell.appendChild(codeEl);
      cell.appendChild(copyBtn);
    }
  }

  async function copyToClipboard(text, btn) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback: no-op — user can still select the text.
        throw new Error('clipboard unavailable');
      }
      if (btn) {
        const original = btn.textContent;
        btn.textContent = 'Copied';
        setTimeout(() => {
          btn.textContent = original;
        }, 1200);
      }
    } catch (_e) {
      if (btn) {
        btn.textContent = 'Copy failed';
      }
    }
  }

  // ---- drag-and-drop wiring ----

  function init() {
    // Create the overlay + panel containers if they don't already exist.
    let overlay = document.getElementById('import-overlay');
    if (!overlay) {
      overlay = el('div', { id: 'import-overlay', class: 'import-overlay', hidden: '' }, [
        el('div', { class: 'import-overlay-inner' }, ['Drop .env file to preview']),
      ]);
      overlay.hidden = true;
      document.body.appendChild(overlay);
    }
    let panel = document.getElementById('import-panel');
    if (!panel) {
      panel = el('section', { id: 'import-panel', class: 'import-panel', hidden: '' }, []);
      panel.hidden = true;
      // Inject after header topbar if present, else at start of body.
      const main = document.querySelector('main') || document.body;
      main.insertBefore(panel, main.firstChild);
    }

    let dragDepth = 0;
    function showOverlay() {
      overlay.hidden = false;
    }
    function hideOverlay() {
      overlay.hidden = true;
    }

    window.addEventListener('dragenter', (ev) => {
      if (!ev.dataTransfer || !hasFiles(ev.dataTransfer)) return;
      dragDepth++;
      showOverlay();
      ev.preventDefault();
    });
    window.addEventListener('dragover', (ev) => {
      if (!ev.dataTransfer || !hasFiles(ev.dataTransfer)) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = 'copy';
    });
    window.addEventListener('dragleave', (ev) => {
      if (!ev.dataTransfer) return;
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) hideOverlay();
    });
    window.addEventListener('drop', (ev) => {
      ev.preventDefault();
      dragDepth = 0;
      hideOverlay();
      const files = ev.dataTransfer ? ev.dataTransfer.files : null;
      if (!files || files.length === 0) return;
      handleFile(files[0]);
    });
  }

  function hasFiles(dt) {
    if (!dt || !dt.types) return false;
    for (const t of dt.types) {
      if (t === 'Files') return true;
    }
    return false;
  }

  function handleFile(file) {
    if (!file) return;
    const name = file.name || '';
    if (!/\.env(\.|$)/i.test(name) && !/^\.env$/i.test(name) && !/\.env$/i.test(name)) {
      alertReject(`Not a .env file: ${name || '(unnamed)'}`);
      return;
    }
    if (file.size > MAX_ENV_BYTES) {
      alertReject(`File too large: ${file.size} bytes (max ${MAX_ENV_BYTES}).`);
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => alertReject('Could not read file.');
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      if (!text) {
        alertReject('File is empty or not text.');
        return;
      }
      const entries = parseEnv(text);
      if (entries.length === 0) {
        alertReject('No key=value pairs found in file.');
        return;
      }
      renderPreview(entries);
    };
    reader.readAsText(file);
  }

  function alertReject(msg) {
    // Surface to the panel as a transient banner. Avoid native alert() — it's
    // modal and interrupts the UI thread.
    const root = document.getElementById('import-panel');
    if (!root) {
      console.warn('[envault import]', msg);
      return;
    }
    root.hidden = false;
    root.innerHTML = '';
    root.appendChild(
      el('div', { class: 'import-warning' }, [
        msg,
        ' ',
        el(
          'button',
          { type: 'button', class: 'import-close', onclick: closePreview },
          ['Dismiss'],
        ),
      ]),
    );
  }

  // Expose a tiny surface for future modules / testing.
  window.envault = window.envault || {};
  window.envault.importSlice = {
    parseEnv: parseEnv,
    maskValue: maskValue,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

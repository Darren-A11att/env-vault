// B1 CRUD UI — vanilla JS, no framework. Reuses window.envault.apiFetch from app.js.
//
// Renders into #crud-root (injected into <main>): a sidebar list + detail pane.
// Add / Edit / Delete only. Reveal UI is B2; Import UI is B3.

(function () {
  'use strict';

  // --- State ---------------------------------------------------------------

  /** @type {Array<{name:string,pseudokey:string,created_at:number,updated_at:number}>} */
  let secrets = [];
  /** @type {'list' | 'add' | 'edit'} */
  let view = 'list';
  /** @type {string | null} */
  let selectedName = null;

  // --- DOM helpers ---------------------------------------------------------

  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k.startsWith('on') && typeof v === 'function') {
          node.addEventListener(k.slice(2), v);
        } else if (v === true) {
          node.setAttribute(k, '');
        } else if (v !== false && v != null) {
          node.setAttribute(k, String(v));
        }
      }
    }
    for (const child of children) {
      if (child == null || child === false) continue;
      if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function showToast(msg, kind) {
    const toast = document.getElementById('crud-toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.className = 'crud-toast ' + (kind === 'error' ? 'crud-toast-error' : 'crud-toast-ok');
    toast.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () {
      toast.hidden = true;
    }, 3000);
  }

  // --- API -----------------------------------------------------------------

  function api(path, init) {
    if (!window.envault || typeof window.envault.apiFetch !== 'function') {
      return Promise.reject(new Error('envault.apiFetch not ready'));
    }
    return window.envault.apiFetch(path, init).then(async function (res) {
      const ct = res.headers.get('content-type') || '';
      const body = ct.includes('application/json') ? await res.json() : await res.text();
      if (!res.ok) {
        const err = new Error((body && body.error) || ('HTTP ' + res.status));
        err.status = res.status;
        err.body = body;
        throw err;
      }
      return body;
    });
  }

  async function loadList() {
    try {
      secrets = await api('/api/secrets');
      secrets.sort(function (a, b) {
        return a.name.localeCompare(b.name);
      });
      render();
    } catch (err) {
      showToast('Failed to load secrets: ' + err.message, 'error');
    }
  }

  async function saveNew(name, value) {
    try {
      const body = await api('/api/secrets', {
        method: 'POST',
        body: JSON.stringify({ name: name, value: value }),
      });
      showToast(body.created ? ('Added ' + body.name) : ('Updated ' + body.name), 'ok');
      selectedName = body.name;
      view = 'edit';
      await loadList();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function saveUpdate(name, value) {
    try {
      await api('/api/secrets/' + encodeURIComponent(name), {
        method: 'PUT',
        body: JSON.stringify({ value: value }),
      });
      showToast('Updated ' + name, 'ok');
      await loadList();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function doDelete(name) {
    try {
      await api('/api/secrets/' + encodeURIComponent(name), { method: 'DELETE' });
      showToast('Deleted ' + name, 'ok');
      selectedName = null;
      view = 'list';
      await loadList();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // --- Views ---------------------------------------------------------------

  function viewSidebar() {
    const items = secrets.map(function (s) {
      const active = s.name === selectedName && view === 'edit';
      return el(
        'li',
        {
          class: 'crud-row' + (active ? ' crud-row-active' : ''),
        },
        el(
          'button',
          {
            class: 'crud-row-main',
            type: 'button',
            onclick: function () {
              selectedName = s.name;
              view = 'edit';
              render();
            },
          },
          el('div', { class: 'crud-row-name', text: s.name }),
          el('div', { class: 'crud-row-pk', text: s.pseudokey }),
        ),
        el(
          'button',
          {
            class: 'crud-copy',
            type: 'button',
            title: 'Copy pseudokey',
            onclick: function (ev) {
              ev.stopPropagation();
              if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(s.pseudokey).then(
                  function () {
                    showToast('Copied ' + s.pseudokey, 'ok');
                  },
                  function () {
                    showToast('Clipboard blocked', 'error');
                  },
                );
              } else {
                showToast('Clipboard not available', 'error');
              }
            },
          },
          'copy',
        ),
      );
    });

    return el(
      'aside',
      { class: 'crud-sidebar' },
      el(
        'div',
        { class: 'crud-sidebar-head' },
        el('span', { class: 'crud-sidebar-title', text: 'Secrets' }),
        el(
          'button',
          {
            class: 'crud-btn crud-btn-accent',
            type: 'button',
            onclick: function () {
              selectedName = null;
              view = 'add';
              render();
            },
          },
          '+ Add',
        ),
      ),
      secrets.length === 0
        ? el('p', { class: 'crud-empty', text: 'No secrets yet.' })
        : el('ul', { class: 'crud-list' }, ...items),
    );
  }

  function viewDetail() {
    if (view === 'add') return viewAdd();
    if (view === 'edit' && selectedName) return viewEdit(selectedName);
    return el(
      'div',
      { class: 'crud-placeholder' },
      el('p', { text: 'Select a secret on the left, or add a new one.' }),
    );
  }

  function viewAdd() {
    const nameInput = el('input', {
      id: 'crud-add-name',
      class: 'crud-input',
      type: 'text',
      autocomplete: 'off',
      spellcheck: 'false',
      placeholder: 'API_KEY',
    });
    const valueInput = el('textarea', {
      id: 'crud-add-value',
      class: 'crud-textarea',
      rows: '6',
      autocomplete: 'off',
      spellcheck: 'false',
      placeholder: 'secret value',
    });
    function onSave() {
      const name = nameInput.value.trim();
      const value = valueInput.value;
      if (!name) {
        showToast('Name is required', 'error');
        return;
      }
      if (!value) {
        showToast('Value is required', 'error');
        return;
      }
      saveNew(name, value);
    }
    return el(
      'section',
      { class: 'crud-detail' },
      el('h2', { class: 'crud-detail-title', text: 'Add secret' }),
      el(
        'label',
        { class: 'crud-label' },
        el('span', { text: 'Name' }),
        nameInput,
      ),
      el(
        'label',
        { class: 'crud-label' },
        el('span', { text: 'Value' }),
        valueInput,
      ),
      el(
        'div',
        { class: 'crud-actions' },
        el(
          'button',
          { class: 'crud-btn crud-btn-accent', type: 'button', onclick: onSave },
          'Save',
        ),
        el(
          'button',
          {
            class: 'crud-btn',
            type: 'button',
            onclick: function () {
              view = 'list';
              selectedName = null;
              render();
            },
          },
          'Cancel',
        ),
      ),
    );
  }

  function viewEdit(name) {
    const rec = secrets.find(function (s) {
      return s.name === name;
    });
    if (!rec) {
      return el('div', { class: 'crud-placeholder' }, el('p', { text: 'Secret no longer exists.' }));
    }
    const valueInput = el('textarea', {
      id: 'crud-edit-value',
      class: 'crud-textarea',
      rows: '6',
      autocomplete: 'off',
      spellcheck: 'false',
      placeholder: 'Enter a new value to replace the stored secret',
    });

    function onSave() {
      const value = valueInput.value;
      if (!value) {
        showToast('Value is required', 'error');
        return;
      }
      saveUpdate(rec.name, value);
    }

    function onDelete() {
      openDeleteDialog(rec);
    }

    return el(
      'section',
      { class: 'crud-detail' },
      el(
        'div',
        { class: 'crud-detail-head' },
        el('h2', { class: 'crud-detail-title', text: rec.name }),
        el('code', { class: 'crud-pk', text: rec.pseudokey }),
      ),
      el(
        'p',
        { class: 'crud-hint' },
        'Value is encrypted at rest. It is never fetched or displayed here — enter a new value to replace it, or click Reveal below to view the current value briefly.',
      ),
      el('div', {
        class: 'edit-reveal-slot',
        'data-secret-name': rec.name,
      }),
      el(
        'label',
        { class: 'crud-label' },
        el('span', { text: 'New value' }),
        valueInput,
      ),
      el(
        'div',
        { class: 'crud-actions' },
        el(
          'button',
          { class: 'crud-btn crud-btn-accent', type: 'button', onclick: onSave },
          'Save',
        ),
        el(
          'button',
          { class: 'crud-btn crud-btn-danger', type: 'button', onclick: onDelete },
          'Delete',
        ),
      ),
    );
  }

  function openDeleteDialog(rec) {
    const existing = document.getElementById('crud-delete-overlay');
    if (existing) existing.remove();

    const confirmInput = el('input', {
      class: 'crud-input',
      type: 'text',
      autocomplete: 'off',
      spellcheck: 'false',
      placeholder: rec.name,
    });
    const deleteBtn = el(
      'button',
      {
        class: 'crud-btn crud-btn-danger',
        type: 'button',
        disabled: true,
        onclick: function () {
          if (confirmInput.value !== rec.name) return;
          overlay.remove();
          doDelete(rec.name);
        },
      },
      'Delete',
    );
    confirmInput.addEventListener('input', function () {
      deleteBtn.disabled = confirmInput.value !== rec.name;
    });

    const overlay = el(
      'div',
      { id: 'crud-delete-overlay', class: 'crud-overlay' },
      el(
        'div',
        { class: 'crud-dialog' },
        el('h3', { class: 'crud-dialog-title', text: 'Delete ' + rec.name + '?' }),
        el(
          'p',
          { class: 'crud-hint' },
          'This permanently removes the secret from the vault. ' +
            'Any .env file still referencing ' +
            rec.pseudokey +
            ' will fail to resolve.',
        ),
        el(
          'label',
          { class: 'crud-label' },
          el('span', { text: 'Type the secret name to confirm' }),
          confirmInput,
        ),
        el(
          'div',
          { class: 'crud-actions' },
          deleteBtn,
          el(
            'button',
            {
              class: 'crud-btn',
              type: 'button',
              onclick: function () {
                overlay.remove();
              },
            },
            'Cancel',
          ),
        ),
      ),
    );
    document.body.appendChild(overlay);
    confirmInput.focus();
  }

  // --- Root render ---------------------------------------------------------

  function render() {
    const root = document.getElementById('crud-root');
    if (!root) return;
    root.replaceChildren(viewSidebar(), viewDetail());
  }

  function mount() {
    let main = document.querySelector('main');
    if (!main) {
      main = document.createElement('main');
      document.body.appendChild(main);
    }
    // Replace any Wave-1 placeholder copy inside <main>.
    main.replaceChildren();
    const root = el('div', { id: 'crud-root', class: 'crud-root' });
    main.appendChild(root);
    const toast = el('div', { id: 'crud-toast', class: 'crud-toast', hidden: true });
    document.body.appendChild(toast);
    render();
    loadList();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();

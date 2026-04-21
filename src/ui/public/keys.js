// envault UI — keyboard shortcuts + sidebar filter (Wave 3 polish).
//
// Shortcuts (only fire when focus is not on a form field):
//   n       focus / activate the "+ Add" button
//   /       focus the sidebar search filter
//   Escape  dismiss open dialog / leave add-or-edit view back to list
//
// Also installs a case-insensitive substring filter <input> at the top of
// the sidebar that filters the secret rows by name.

(function () {
  'use strict';

  var SIDEBAR_SELECTOR = '.crud-sidebar';
  var SIDEBAR_HEAD_SELECTOR = '.crud-sidebar-head';
  var LIST_SELECTOR = '.crud-list';
  var ROW_SELECTOR = '.crud-row';
  var ROW_NAME_SELECTOR = '.crud-row-name';
  var ADD_BUTTON_TEXT_RE = /^\s*\+\s*Add\s*$/;
  var FILTER_INPUT_ID = 'crud-filter-input';
  var OVERLAY_SELECTOR = '.crud-overlay, #crud-delete-overlay';

  function isTypingTarget(el) {
    if (!el) return false;
    var tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (el.isContentEditable) return true;
    return false;
  }

  function findAddButton() {
    var head = document.querySelector(SIDEBAR_HEAD_SELECTOR);
    if (!head) return null;
    var buttons = head.querySelectorAll('button');
    for (var i = 0; i < buttons.length; i++) {
      if (ADD_BUTTON_TEXT_RE.test(buttons[i].textContent || '')) {
        return buttons[i];
      }
    }
    return null;
  }

  function findCancelButton() {
    // First: dialog cancel buttons (delete-confirm overlay).
    var overlays = document.querySelectorAll(OVERLAY_SELECTOR);
    for (var i = 0; i < overlays.length; i++) {
      var btns = overlays[i].querySelectorAll('button');
      for (var j = 0; j < btns.length; j++) {
        if (/^\s*Cancel\s*$/.test(btns[j].textContent || '')) return btns[j];
      }
    }
    // Next: detail-pane Cancel (on the Add form).
    var detailBtns = document.querySelectorAll('.crud-detail button');
    for (var k = 0; k < detailBtns.length; k++) {
      if (/^\s*Cancel\s*$/.test(detailBtns[k].textContent || '')) return detailBtns[k];
    }
    return null;
  }

  function installFilterInput() {
    var head = document.querySelector(SIDEBAR_HEAD_SELECTOR);
    if (!head) return null;
    var existing = document.getElementById(FILTER_INPUT_ID);
    if (existing) return existing;

    var input = document.createElement('input');
    input.id = FILTER_INPUT_ID;
    input.type = 'search';
    input.placeholder = 'Filter (/)';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('aria-label', 'Filter secrets');
    input.style.marginLeft = '0.5rem';
    input.style.flex = '1 1 8rem';
    input.style.minWidth = '0';
    input.style.padding = '0.3rem 0.5rem';
    input.style.font = 'inherit';
    input.style.fontSize = '12px';
    input.style.background = 'var(--bg)';
    input.style.color = 'var(--fg)';
    input.style.border = '1px solid var(--border)';
    input.style.borderRadius = '4px';

    input.addEventListener('input', applyFilter);
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') {
        input.value = '';
        applyFilter();
        input.blur();
      }
    });

    // Insert before the + Add button so the button stays on the right.
    var addBtn = findAddButton();
    if (addBtn && addBtn.parentNode === head) {
      head.insertBefore(input, addBtn);
    } else {
      head.appendChild(input);
    }
    return input;
  }

  function applyFilter() {
    var input = document.getElementById(FILTER_INPUT_ID);
    var q = ((input && input.value) || '').trim().toLowerCase();
    var rows = document.querySelectorAll(SIDEBAR_SELECTOR + ' ' + ROW_SELECTOR);
    for (var i = 0; i < rows.length; i++) {
      var nameEl = rows[i].querySelector(ROW_NAME_SELECTOR);
      var name = nameEl ? (nameEl.textContent || '').toLowerCase() : '';
      rows[i].style.display = !q || name.indexOf(q) !== -1 ? '' : 'none';
    }
  }

  function focusFilterInput() {
    var input = installFilterInput();
    if (!input) return;
    input.focus();
    input.select();
  }

  function activateAddButton() {
    var btn = findAddButton();
    if (!btn) return;
    btn.focus();
    btn.click();
  }

  function cancelDialogOrView() {
    var btn = findCancelButton();
    if (!btn) return false;
    btn.click();
    return true;
  }

  function onKeyDown(ev) {
    if (ev.defaultPrevented) return;
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    var typing = isTypingTarget(document.activeElement);

    // Escape: always fire, even from inputs (so the dialog is dismissable).
    if (ev.key === 'Escape') {
      if (cancelDialogOrView()) {
        ev.preventDefault();
      }
      return;
    }

    if (typing) return;

    if (ev.key === 'n' || ev.key === 'N') {
      ev.preventDefault();
      activateAddButton();
      return;
    }
    if (ev.key === '/') {
      ev.preventDefault();
      focusFilterInput();
      return;
    }
  }

  function init() {
    // Install filter input now and on every re-render of the sidebar.
    installFilterInput();
    var mo = new MutationObserver(function () {
      installFilterInput();
      applyFilter();
    });
    var root = document.getElementById('crud-root') || document.body;
    mo.observe(root, { childList: true, subtree: true });
    document.addEventListener('keydown', onKeyDown);
  }

  // Export the trigger helpers for tests / ad-hoc use.
  window.envault = window.envault || {};
  window.envault.keys = {
    focusFilter: focusFilterInput,
    activateAdd: activateAddButton,
    cancel: cancelDialogOrView,
    applyFilter: applyFilter,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

// Flat control panel: sliders/toggles for every param + preset save/load.

import {
  GROUPS, DEFAULTS, BG_BUILTINS, BG_IMAGE,
  listPresets, savePreset, deletePreset, loadPreset,
} from './params.js';
import { listImages, fileToEntry, addImage, removeImage } from './images.js';

// Background row: built-in patterns + the user's own photos, with add/remove.
// Returns { el, sync } and exposes cycling for the arrow keys.
function buildBgControl(params, emit) {
  const cell = document.createElement('div');
  cell.className = 'bg-cell';

  const sel = document.createElement('select');
  sel.setAttribute('data-testid', 'bg-select');

  const addBtn = document.createElement('button');
  addBtn.textContent = 'add photo';
  addBtn.setAttribute('data-testid', 'bg-add');

  const delBtn = document.createElement('button');
  delBtn.textContent = 'remove';
  delBtn.setAttribute('data-testid', 'bg-remove');

  const file = document.createElement('input');
  file.type = 'file';
  file.accept = 'image/*';
  file.multiple = true;
  file.hidden = true;

  const row2 = document.createElement('div');
  row2.className = 'bg-btns';
  row2.append(addBtn, delBtn);
  cell.append(sel, row2, file);

  // option value encodes the choice: "b:<type>" or "i:<imageIndex>"
  const currentValue = () =>
    params.bgType === BG_IMAGE ? `i:${params.bgImageIndex}` : `b:${params.bgType}`;

  function refresh() {
    const images = listImages();
    sel.innerHTML = '';
    for (const o of BG_BUILTINS) {
      const opt = document.createElement('option');
      opt.value = `b:${o.value}`;
      opt.textContent = o.label;
      sel.append(opt);
    }
    images.forEach((img, i) => {
      const opt = document.createElement('option');
      opt.value = `i:${i}`;
      opt.textContent = img.name;
      sel.append(opt);
    });
    if (params.bgType === BG_IMAGE && params.bgImageIndex >= images.length) {
      params.bgType = images.length ? BG_IMAGE : 0;
      params.bgImageIndex = Math.max(0, images.length - 1);
    }
    sel.value = currentValue();
    delBtn.disabled = params.bgType !== BG_IMAGE;
  }

  function choose(value) {
    const [kind, n] = value.split(':');
    if (kind === 'b') {
      params.bgType = Number(n);
    } else {
      params.bgType = BG_IMAGE;
      params.bgImageIndex = Number(n);
    }
    refresh();
    emit();
  }

  sel.addEventListener('change', () => choose(sel.value));

  addBtn.addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    const files = [...(file.files || [])];
    file.value = '';
    for (const f of files) {
      try {
        const idx = addImage(await fileToEntry(f));
        params.bgType = BG_IMAGE;
        params.bgImageIndex = idx;
      } catch (err) {
        console.warn('[glass-lab] image add failed:', err.message);
      }
    }
    refresh();
    emit();
  });

  delBtn.addEventListener('click', () => {
    if (params.bgType !== BG_IMAGE) return;
    removeImage(params.bgImageIndex);
    const images = listImages();
    if (!images.length) {
      params.bgType = 0;
      params.bgImageIndex = 0;
    } else {
      params.bgImageIndex = Math.min(params.bgImageIndex, images.length - 1);
    }
    refresh();
    emit();
  });

  // step through every background in order — bound to the arrow keys
  function cycle(dir) {
    const opts = [...sel.options].map((o) => o.value);
    const at = Math.max(0, opts.indexOf(currentValue()));
    choose(opts[(at + dir + opts.length) % opts.length]);
  }

  return { el: cell, sync: refresh, cycle };
}

function fmt(item, v) {
  if (item.type === 'bool') return '';
  if (item.type === 'color') return '';
  return item.step >= 1 ? String(Math.round(v)) : Number(v).toFixed(2);
}

export function buildUI(container, params, onChange) {
  const inputs = new Map(); // key -> { el, valEl, item }

  const h1 = document.createElement('h1');
  h1.textContent = 'parameters';
  const sub = document.createElement('div');
  sub.className = 'sub';
  sub.textContent = 'drag the glass · ← → backgrounds';
  container.append(h1, sub);

  // ---- presets ----
  const block = document.createElement('div');
  block.className = 'preset-block';

  const sel = document.createElement('select');
  sel.setAttribute('data-testid', 'preset-select');

  const rowName = document.createElement('div');
  rowName.className = 'preset-row';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.placeholder = 'preset name';
  nameInput.setAttribute('data-testid', 'preset-name');
  const saveBtn = document.createElement('button');
  saveBtn.textContent = 'save';
  saveBtn.setAttribute('data-testid', 'preset-save');
  saveBtn.style.flex = '0 0 auto';
  rowName.append(nameInput, saveBtn);

  const rowActs = document.createElement('div');
  rowActs.className = 'preset-row';
  const delBtn = document.createElement('button');
  delBtn.textContent = 'delete';
  delBtn.className = 'danger';
  const resetBtn = document.createElement('button');
  resetBtn.textContent = 'reset';
  rowActs.append(delBtn, resetBtn);

  const msg = document.createElement('div');
  msg.className = 'saved-msg';

  block.append(sel, rowName, rowActs, msg);
  container.append(block);

  let msgTimer = 0;
  function flash(text) {
    msg.textContent = text;
    clearTimeout(msgTimer);
    msgTimer = setTimeout(() => { msg.textContent = ''; }, 2200);
  }

  function refreshPresetList(selected) {
    const names = Object.keys(listPresets()).sort();
    sel.innerHTML = '';
    const ph = document.createElement('option');
    ph.value = '';
    ph.textContent = names.length ? 'load preset…' : 'no saved presets';
    sel.append(ph);
    for (const n of names) {
      const o = document.createElement('option');
      o.value = n;
      o.textContent = n;
      sel.append(o);
    }
    sel.value = selected && names.includes(selected) ? selected : '';
  }

  function setAll(next) {
    Object.assign(params, next);
    for (const [key, entry] of inputs) {
      const v = params[key];
      if (entry.item.type === 'bool') entry.el.checked = !!v;
      else if (entry.item.type === 'color') entry.el.value = v;
      else {
        entry.el.value = v;
        entry.valEl.textContent = fmt(entry.item, v);
      }
    }
    bgControl.sync();
    onChange();
  }

  saveBtn.addEventListener('click', () => {
    const name = (nameInput.value.trim() || sel.value || '').toLowerCase();
    if (!name) { flash('name it first'); return; }
    savePreset(name, params);
    refreshPresetList(name);
    nameInput.value = '';
    flash(`saved "${name}"`);
  });

  sel.addEventListener('change', () => {
    if (!sel.value) return;
    const p = loadPreset(sel.value);
    if (p) { setAll(p); flash(`loaded "${sel.value}"`); }
  });

  delBtn.addEventListener('click', () => {
    if (!sel.value) { flash('pick a preset to delete'); return; }
    const name = sel.value;
    deletePreset(name);
    refreshPresetList('');
    flash(`deleted "${name}"`);
  });

  resetBtn.addEventListener('click', () => {
    setAll({ ...DEFAULTS });
    sel.value = '';
    flash('reset to defaults');
  });

  refreshPresetList('');

  const bgControl = buildBgControl(params, onChange);

  // ---- parameter groups ----
  for (const group of GROUPS) {
    const det = document.createElement('details');
    if (group.open) det.open = true;
    const summary = document.createElement('summary');
    summary.textContent = group.label;
    det.append(summary);

    for (const item of group.items) {
      const row = document.createElement('div');
      row.className = 'ctl';
      const label = document.createElement('label');
      label.textContent = item.label;
      row.append(label);

      if (item.type === 'bg') {
        row.append(bgControl.el);
        bgControl.el.classList.add('span2');
      } else if (item.type === 'bool') {
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = !!params[item.key];
        cb.setAttribute('data-testid', `ctl-${item.key}`);
        cb.addEventListener('change', () => {
          params[item.key] = cb.checked;
          onChange();
        });
        row.append(cb, document.createElement('span'));
        inputs.set(item.key, { el: cb, valEl: null, item });
      } else if (item.type === 'color') {
        const col = document.createElement('input');
        col.type = 'color';
        col.value = params[item.key];
        col.setAttribute('data-testid', `ctl-${item.key}`);
        col.addEventListener('input', () => {
          params[item.key] = col.value;
          onChange();
        });
        row.append(col, document.createElement('span'));
        inputs.set(item.key, { el: col, valEl: null, item });
      } else {
        const range = document.createElement('input');
        range.type = 'range';
        range.min = item.min;
        range.max = item.max;
        range.step = item.step;
        range.value = params[item.key];
        range.setAttribute('data-testid', `ctl-${item.key}`);
        const val = document.createElement('span');
        val.className = 'val';
        val.textContent = fmt(item, params[item.key]);
        range.addEventListener('input', () => {
          params[item.key] = Number(range.value);
          val.textContent = fmt(item, params[item.key]);
          onChange();
        });
        row.append(range, val);
        inputs.set(item.key, { el: range, valEl: val, item });
      }
      det.append(row);
    }
    container.append(det);
  }

  bgControl.sync();

  // arrow keys flick through backgrounds (unless a field has focus)
  window.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    if (e.key === 'ArrowRight') bgControl.cycle(1);
    else if (e.key === 'ArrowLeft') bgControl.cycle(-1);
  });

  return { setAll };
}

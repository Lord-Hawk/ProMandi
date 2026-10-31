/* reusable form parts: search dropdown, product rows, payment rows, counter details */
(function () {
  const { h, norm, sval, clean } = U;
  const PAYMENT_MODES = ['Cash', 'UPI', 'Cheque', 'Card'];

  /* ------------------------------------------------------------------ search dropdown */
  class Combo {
    /* o: values() -> [strings], strict (only listed values), placeholder, onInput(text), onPick(value), onChange(value) */
    constructor(o) {
      this.values = o.values || (() => []); this.strict = !!o.strict;
      this.onInput = o.onInput; this.onPick = o.onPick; this.onChange = o.onChange;
      this.input = h('input', { type: 'text', class: 'inp', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: '---- Select ----' });
      this.list = h('div', { class: 'combo-list', hidden: true });
      this.btn = h('button', { type: 'button', class: 'combo-arrow', tabindex: '-1', 'aria-label': 'Show the list' }, '▾');
      this.el = h('div', { class: 'combo' }, this.input, this.btn, this.list);
      this.value = ''; this.sel = -1; this.shown = [];
      this.input.addEventListener('input', () => { this.value = this.input.value; if (this.onInput) this.onInput(this.value); this.show(true); });
      this.input.addEventListener('focus', () => { Combo.closeOthers(this); this.show(false); });
      this.input.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== this.input) { this.commit(); if (Date.now() - this.btnAt > 700) this.close(); } }, 140));
      this.input.addEventListener('click', () => { if (this.list.hidden && !this.input.disabled) { Combo.closeOthers(this); this.show(false); } });
      this.input.addEventListener('keydown', e => this.key(e));
      /* the square ▼ button: opens / closes the list WITHOUT the keyboard (tapping the text area opens the keyboard) */
      this.btnAt = 0;
      this.btn.addEventListener('pointerdown', () => { this.btnAt = Date.now(); if (document.activeElement === this.input) this.input.blur(); });
      this.btn.addEventListener('mousedown', e => e.preventDefault());
      this.btn.addEventListener('click', () => { if (this.input.disabled) return; this.btnAt = Date.now(); if (!this.list.hidden) this.close(); else { Combo.closeOthers(this); this.show(false); } });
      this.list.addEventListener('mousedown', e => e.preventDefault());               // keeps the keyboard / focus while tapping
      this.list.addEventListener('click', e => { e.preventDefault(); const li = e.target.closest('[data-i]'); if (li) this.pick(this.shown[+li.dataset.i]); });
      Combo.all.add(this);
    }
    get() { return this.value; }
    set(v) { this.value = v || ''; this.input.value = this.value; this.last = this.value; this.close(); }
    disable(b) { this.input.disabled = !!b; this.btn.disabled = !!b; if (b) this.close(); }
    focus() { this.input.focus(); }
    show(typed) {
      const items = this.values(), q = this.input.value;
      const exact = items.some(x => x.toLowerCase() === q.toLowerCase());
      this.shown = (typed && clean(q) && !exact) ? U.rank(q, items) : items.slice(0, 300);
      this.list.replaceChildren(...(this.shown.length ? this.shown.map((x, i) => h('div', { class: 'combo-item', 'data-i': i }, x))
                                                       : [h('div', { class: 'combo-none' }, this.strict ? 'No match – pick from the list' : 'No match')]));
      this.sel = -1; this.list.hidden = false; this.el.classList.add('open');
      const r = this.el.getBoundingClientRect(), below = window.innerHeight - r.bottom;      // open upwards when there is no room below
      this.list.classList.toggle('up', below < 190 && r.top > below);
    }
    close() { this.list.hidden = true; this.el.classList.remove('open'); this.sel = -1; }
    pick(v) {
      if (v === undefined) return;
      this.input.value = v; this.value = v; this.close();
      if (this.onInput) this.onInput(v);
      if (this.onPick) this.onPick(v);
      this.fireChange();
    }
    fireChange() { if (this.value !== this.last) { this.last = this.value; if (this.onChange) this.onChange(this.value); } }
    commit() {                                                  // typed text -> final value
      let t = clean(this.input.value); const m = this.values().find(x => x.toLowerCase() === t.toLowerCase());
      if (m) t = m; else if (this.strict) { if (t) { this.input.classList.add('bad'); setTimeout(() => this.input.classList.remove('bad'), 900); } t = ''; }
      if (this.input.value !== t) this.input.value = t;
      if (t !== this.value) { this.value = t; if (this.onInput) this.onInput(t); }
      this.fireChange();
    }
    key(e) {
      const open = !this.list.hidden;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault(); if (!open) return this.show(false);
        const n = this.shown.length; if (!n) return;
        this.sel = (this.sel + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
        [...this.list.children].forEach((c, i) => c.classList.toggle('sel', i === this.sel));
        const c = this.list.children[this.sel]; if (c && c.scrollIntoView) c.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') {
        if (open && this.sel >= 0) { e.preventDefault(); this.pick(this.shown[this.sel]); }
        else if (open && this.shown.length === 1) { e.preventDefault(); this.pick(this.shown[0]); }
        else { this.commit(); this.close(); }
      } else if (e.key === 'Escape') this.close();
    }
    static closeOthers(me) { Combo.all.forEach(c => { if (c !== me && !c.list.hidden) c.close(); }); }
    static closeAll() { Combo.all.forEach(c => { if (!c.list.hidden) c.close(); }); }
    static forget(list) { list.forEach(c => Combo.all.delete(c)); }
  }
  Combo.all = new Set();
  document.addEventListener('click', e => { if (!e.target.closest('.combo')) Combo.closeAll(); });

  const field = (label, el, cls) => h('label', { class: 'field ' + (cls || '') }, h('span', { class: 'lbl' }, label), el);

  /* ------------------------------------------------------------------ product rows */
  class ProductRow {
    constructor(area) {
      this.area = area; this.v = { type: '', item: '', sub: '', colour: '' }; this.default = null;
      const titles = ['Type', 'Item', 'Sub-Item', 'Colour'];
      this.combos = LEVELS.map((k, i) => new Combo({
        placeholder: titles[i],
        values: () => area.model.options(LEVELS.slice(0, i).map(x => this.v[x])),
        onInput: t => { this.v[k] = t; area.changed(); },
        onPick: () => this.chosen(i),
        onChange: () => this.refreshRate(false),
      }));
      this.qty = h('input', { type: 'text', inputmode: 'numeric', class: 'inp', placeholder: 'No.', autocomplete: 'off' });
      this.rate = h('input', { type: 'text', inputmode: 'decimal', class: 'inp', placeholder: 'Rate ₹', autocomplete: 'off' });
      this.amount = h('span', { class: 'amount' }, '');
      this.hint = h('div', { class: 'hint' });
      this.title = h('b', { class: 'ptitle' }, 'Product');
      const del = h('button', { type: 'button', class: 'x', 'aria-label': 'Remove this product', onclick: () => area.removeRow(this) }, '✕');
      const resetBtn = area.showReset ? h('button', { type: 'button', class: 'btn small gray', onclick: () => this.resetRate() }, 'Reset') : null;
      this.el = h('div', { class: 'prow' },
        h('div', { class: 'row-between' }, this.title, del),
        h('div', { class: 'grid2' }, ...this.combos.map((c, i) => field(titles[i], c.el))),
        h('div', { class: 'grid3' },
          field('No. of products', this.qty),
          field('Rate (₹)', h('div', { class: 'ratebox' }, this.rate, resetBtn)),
          field('Amount', this.amount)),
        this.hint);
      this.qty.addEventListener('input', () => area.changed());
      this.rate.addEventListener('input', () => area.changed());
    }
    isFilled() {
      if (!LEVELS.every(k => this.v[k].trim())) return false;
      const q = this.qty.value.trim(), r = Number(this.rate.value.trim().replace(/,/g, ''));
      return /^\d+$/.test(q) && +q > 0 && isFinite(r) && r > 0 && this.rate.value.trim() !== '';
    }
    key() { return LEVELS.every(k => this.v[k]) ? keyOf(this.v.type, this.v.item, this.v.sub, this.v.colour) : null; }
    chosen(i) {
      for (let j = i + 1; j < 4; j++) { this.v[LEVELS[j]] = ''; this.combos[j].set(''); }
      for (let j = i + 1; j < 4; j++) {
        const opts = this.area.model.options(LEVELS.slice(0, j).map(x => this.v[x]));
        if (opts.length === 1) { this.v[LEVELS[j]] = opts[0]; this.combos[j].set(opts[0]); } else break;
      }
      this.refreshRate(true);
    }
    setRate(v) { this.rate.value = v; this.area.changed(); }
    refreshRate(force) {
      const key = this.key(), old = this.default;
      if (!key) { this.default = null; if (force) this.setRate(''); this.hint.textContent = ''; return; }
      const [rate, source] = this.area.rateFn(this.area.codeFn(), key);
      this.default = rate;
      if (force || this.rate.value.trim() === '' || this.rate.value.trim() === (old != null ? U.fmtNum(old) : '~')) this.setRate(rate != null ? U.fmtNum(rate) : '');
      if (!this.area.showReset) this.hint.textContent = '';
      else if (rate != null) this.hint.textContent = 'Rate source: ' + source;
      else if (!this.area.model.hasProduct(this.v.type, this.v.item, this.v.sub, this.v.colour)) this.hint.textContent = 'New product – type its rate. It joins the dropdowns after the next sync.';
      else this.hint.textContent = 'No previous rate – type it in';
    }
    resetRate() { if (this.default != null) this.setRate(U.fmtNum(this.default)); }
    setValues(t, i, s, c, qty, rate) {
      [t, i, s, c].forEach((x, n) => { this.v[LEVELS[n]] = x; this.combos[n].set(x); });
      this.qty.value = String(qty); this.rate.value = U.fmtNum(rate);
      this.refreshRate(false); this.area.changed();
    }
    lineAmount() { const q = +this.qty.value.trim(), r = Number(this.rate.value.trim().replace(/,/g, '')); return this.qty.value.trim() && this.rate.value.trim() && isFinite(q) && isFinite(r) ? U.mul(q, r) : null; }
    getLine(n) {
      const vals = LEVELS.map(k => clean(this.v[k])), q = this.qty.value.trim(), rs = this.rate.value.trim().replace(/,/g, '');
      if (!vals.some(Boolean) && !q && !rs) return null;
      if (!vals.every(Boolean)) throw new Error(`Product ${n}: choose Type, Item, Sub-Item and Colour.`);
      if (!/^\d+$/.test(q) || +q <= 0) throw new Error(`Product ${n}: No. of products must be a whole number above 0.`);
      const rate = Number(rs);
      if (!isFinite(rate) || rate <= 0 || rs === '') throw new Error(`Product ${n}: enter a valid rate.`);
      const [t, i, s, c] = this.area.model.canonProduct(...vals);
      return { type: t, item: i, sub: s, colour: c, qty: +q, rate };
    }
    destroy() { Combo.forget(this.combos); this.el.remove(); }
  }

  class ProductRows {
    /* o: model, rateFn(code, key)->[rate, source], codeFn(), showReset, emptyText, totalLabel, onChange() */
    constructor(o) {
      this.model = o.model; this.rateFn = o.rateFn; this.codeFn = o.codeFn || (() => ''); this.showReset = o.showReset !== false;
      this.onChange = o.onChange; this.rows = []; this.cancelled = false;
      this.host = h('div'); this.empty = h('p', { class: 'hint' }, o.emptyText || 'No product added. Tap “＋ Add Product”.');
      this.addBtn = h('button', { type: 'button', class: 'btn ghost', onclick: () => this.addRow(true) }, '＋ Add Product');
      this.totalEl = h('b', { class: 'total' }, '₹ 0');
      this.bar = h('div', { class: 'row-between wrap' }, this.addBtn, h('div', { class: 'totalbox' }, (o.totalLabel || 'Total') + ': ', this.totalEl));
      this.el = h('div', {}, this.host, this.empty, this.bar);
      this.update();
    }
    addRow(focus, v) {
      if (this.cancelled || (!v && this.rows.length && !this.rows[this.rows.length - 1].isFilled())) return null;
      const r = new ProductRow(this); this.rows.push(r); this.host.append(r.el);
      if (v) r.setValues(v.type, v.item, v.sub, v.colour, v.qty, v.price);
      this.update();
      if (focus) { r.combos[0].focus(); r.el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
      return r;
    }
    removeRow(r) { Combo.closeAll(); r.destroy(); this.rows.splice(this.rows.indexOf(r), 1); this.update(); }
    clear() { Combo.closeAll(); this.rows.forEach(r => r.destroy()); this.rows = []; this.update(); }
    setCancelled(b) { this.cancelled = !!b; Combo.closeAll(); this.host.hidden = this.cancelled; this.update(); }
    changed() { this.update(); }
    update() {
      this.rows.forEach((r, i) => { r.title.textContent = 'Product ' + (i + 1); });
      this.empty.hidden = this.rows.length > 0 || this.cancelled;
      this.addBtn.disabled = this.cancelled || (this.rows.length > 0 && !this.rows[this.rows.length - 1].isFilled());
      let t = 0;
      this.rows.forEach(r => { const a = r.lineAmount(); r.amount.textContent = a != null ? U.inr2(a) : ''; if (a != null) t += a; });
      this.totalEl.textContent = this.cancelled ? '₹ 0' : U.inr(t);
      if (this.onChange) this.onChange();
    }
    commitAll() { this.rows.forEach(r => r.combos.forEach(c => c.commit())); }
    refreshRates() { this.rows.forEach(r => r.refreshRate(false)); }
    lines() {                                                 // ValueError-style Error with what is wrong; [] while Cancelled
      if (this.cancelled) return [];
      const out = [];
      this.rows.forEach((r, i) => { const l = r.getLine(i + 1); if (l) out.push(l); });
      return out;
    }
  }

  /* ------------------------------------------------------------------ payment rows (amount + mode) */
  class PaymentRows {
    constructor(o) {
      this.rows = []; this.onChange = o && o.onChange;
      this.host = h('div'); this.empty = h('p', { class: 'hint' }, 'No payment added. Tap “＋ Payment” if money was received.');
      this.addBtn = h('button', { type: 'button', class: 'btn ghost', onclick: () => this.addRow(true) }, '＋ Payment');
      this.totalEl = h('b', { class: 'total' }, '₹ 0');
      this.el = h('div', {}, this.host, this.empty, h('div', { class: 'row-between wrap' }, this.addBtn, h('div', { class: 'totalbox' }, 'Total Payment Received: ', this.totalEl)));
      this.update();
    }
    rowFilled(r) { const a = Number(r.amt.value.trim().replace(/,/g, '')); return r.amt.value.trim() !== '' && isFinite(a) && a > 0 && PAYMENT_MODES.includes(r.mode.value); }
    addRow(focus) {
      if (this.addBtn.disabled) return;
      const amt = h('input', { type: 'text', inputmode: 'decimal', class: 'inp', placeholder: 'Amount ₹', autocomplete: 'off' });
      const mode = h('select', { class: 'inp' });
      const r = { amt, mode };
      const fill = () => {
        const used = new Set(); for (const x of this.rows) { if (x === r) break; if (x.mode.value) used.add(x.mode.value); }
        const keep = mode.value; mode.replaceChildren(h('option', { value: '' }, '---- Select ----'), ...PAYMENT_MODES.filter(m => !used.has(m) || m === keep).map(m => h('option', { value: m }, m)));
        mode.value = keep;
      };
      r.fill = fill;
      r.el = h('div', { class: 'prow pay' }, h('div', { class: 'grid2' }, field('Payment received (₹)', amt), field('Payment mode', mode)),
        h('button', { type: 'button', class: 'x', 'aria-label': 'Remove this payment', onclick: () => { r.el.remove(); this.rows.splice(this.rows.indexOf(r), 1); this.update(); } }, '✕'));
      amt.addEventListener('input', () => this.update());
      mode.addEventListener('change', () => this.update());
      this.rows.push(r); this.host.append(r.el); fill(); this.update();
      if (focus) { amt.focus(); r.el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    }
    update() {
      const seen = new Set();                                  // a mode picked in an earlier row is cleared in the rows below it
      this.rows.forEach(r => { if (r.mode.value && seen.has(r.mode.value)) r.mode.value = ''; if (r.mode.value) seen.add(r.mode.value); });
      this.rows.forEach(r => r.fill());
      this.empty.hidden = this.rows.length > 0;
      const used = new Set(this.rows.map(r => r.mode.value).filter(Boolean));
      this.addBtn.disabled = !((!this.rows.length || this.rowFilled(this.rows[this.rows.length - 1])) && used.size < PAYMENT_MODES.length);
      let t = 0; this.rows.forEach(r => { const a = Number(r.amt.value.trim().replace(/,/g, '')); if (isFinite(a) && a > 0) t += a; });
      this.totalEl.textContent = U.inr(t);
      if (this.onChange) this.onChange();
    }
    reset() { this.rows.forEach(r => r.el.remove()); this.rows = []; this.update(); }
    payments() {                                              // [{mode, amount}] ; Error for a half-filled row
      const out = [], seen = new Set();
      this.rows.forEach((r, n) => {
        const txt = r.amt.value.trim().replace(/,/g, ''), mode = r.mode.value, pre = this.rows.length > 1 ? `Payment ${n + 1}: ` : '';
        if (!txt && !mode) return;
        if (!txt) throw new Error(pre + 'Enter the payment amount or clear the payment mode.');
        const a = Number(txt);
        if (!isFinite(a) || a <= 0) throw new Error(pre + 'Enter a valid payment amount (or leave it empty).');
        if (!mode) throw new Error(pre + 'Select the Payment mode (Cash/UPI/Cheque/Card).');
        if (seen.has(mode)) throw new Error(`${mode} is used more than once. Put the whole ${mode} amount in one row.`);
        seen.add(mode); out.push({ mode, amount: a });
      });
      return out;
    }
  }

  /* ------------------------------------------------------------------ counter details */
  class CounterDetails {
    /* Shows what is on file for the chosen counter and boxes for what is missing. A detail kept on SOME rows of the sheets and
       blank on others ('partial') gets a box + the existing value: empty box / same value = the blank cells are filled with it;
       a different value fills them AND replaces the old value of that counter code everywhere. */
    constructor(model, withType) {
      this.model = model; this.withType = withType; this.key = null;
      this.info = h('div', { class: 'hint' });
      this.mobile = h('input', { type: 'text', inputmode: 'tel', class: 'inp', placeholder: 'Mobile No.', autocomplete: 'off' });
      this.gstin = h('input', { type: 'text', class: 'inp', placeholder: 'GSTIN / PAN', autocomplete: 'off', autocapitalize: 'characters' });
      this.typeCombo = new Combo({ placeholder: 'Counter type', values: () => [...this.model.counterTypes].sort() });
      this.fm = field('Mobile No.', this.mobile); this.ft = field('Counter type', this.typeCombo.el); this.fg = field('GSTIN / PAN', this.gstin);
      this.title = h('div', { class: 'hint strong' });
      this.notes = h('div', { class: 'note' });
      this.box = h('div', { class: 'cdbox', hidden: true }, this.title, h('div', {}, this.ft, this.fm, this.fg), this.notes);        // type, mobile, GSTIN/PAN - one under the other
      this.el = h('div', {}, this.info, this.box);
      this.update('', '');
    }
    update(market, name) {
      const c = this.model.findCounter(market, name); name = clean(name);
      const key = norm(market) + '|' + norm(name);
      if (key !== this.key) { this.key = key; this.mobile.value = ''; this.gstin.value = ''; this.typeCombo.set(''); }
      let show = {}, title = '', notes = [];
      if (c) {
        const na = 'not on file', partial = this.model.partialFields(c.code);
        this.info.textContent = this.withType
          ? [`Counter type: ${c.type || na}`, `Mobile No.: ${c.mobile || na}`, `GSTIN / PAN: ${c.gstin || na}`].join('\n')            // visits: one detail per line, no code
          : [`Mobile No.: ${c.mobile || na}`, `GSTIN / PAN: ${c.gstin || na}`].join('\n');
        show = { mobile: !c.mobile || partial.has('mobile'), gstin: !c.gstin || partial.has('gstin'), type: this.withType && !c.type };
        [['mobile', 'Mobile No.'], ['gstin', 'GSTIN/PAN']].forEach(([k, lbl]) => {
          if (partial.has(k) && c[k]) notes.push(`There is an existing ${lbl}: ${c[k]}, but some fields are empty. Leave the box empty (or type the same one) to fill them with it; a different ${lbl} fills them and replaces the old one.`);
        });
        title = 'Add the missing details – optional:';
      } else if (name && (this.withType || clean(market))) {
        this.info.textContent = ''; show = { mobile: true, gstin: true, type: this.withType }; title = 'New counter – optional details:';
      } else this.info.textContent = '';
      this.fm.hidden = !show.mobile; this.fg.hidden = !show.gstin; this.ft.hidden = !show.type;
      this.box.hidden = !(show.mobile || show.gstin || show.type);
      this.title.textContent = title; this.notes.textContent = notes.join('\n');
    }
    reset() { this.key = null; this.mobile.value = ''; this.gstin.value = ''; this.typeCombo.set(''); this.update('', ''); }
    commit() { this.typeCombo.commit(); }
    /* -> {mobile, ctype, gstin, fill, replace}: values for the new row, details to fill into the counter's older rows, and which of those REPLACE */
    resolve(existing) {
      const cur = existing || {}, partial = existing ? this.model.partialFields(cur.code) : new Set();
      const tm = U.fmtMobile(this.mobile.value);
      if (tm === null) throw new Error('Mobile No. must be a 10-digit number (e.g. 98765 43210). Fix it or leave it empty.');
      const tg = U.cleanGstin(this.gstin.value);
      if (tg && !U.validGstin(tg)) throw new Error('GSTIN must be 15 characters or PAN 10 characters (e.g. ABCDE1234F). Fix it or leave it empty.');
      let tt = this.withType && !cur.type ? clean(this.typeCombo.get()) : '';
      if (tt) tt = [...this.model.counterTypes].find(x => x.toLowerCase() === tt.toLowerCase()) || tt;
      const fill = {}, replace = [];
      const digits = x => x.replace(/\D/g, '').slice(-10);
      const pick = (k, typed, same) => {
        const old = cur[k] || '';
        if (!old) { if (typed && existing) fill[k] = typed; return typed; }
        if (partial.has(k)) {
          if (typed && !same(typed, old)) { fill[k] = typed; replace.push(k); return typed; }
          fill[k] = old; return old;
        }
        return old;
      };
      const mobile = pick('mobile', tm, (a, b) => digits(a) === digits(b));
      const gstin = pick('gstin', tg, (a, b) => a.toUpperCase() === U.cleanGstin(b));
      if (existing && tt) fill.type = tt;
      return { mobile, ctype: cur.type || tt, gstin, fill, replace: replace.sort() };
    }
  }

  window.Combo = Combo; window.ProductRows = ProductRows; window.PaymentRows = PaymentRows; window.CounterDetails = CounterDetails;
  window.field = field; window.PAYMENT_MODES = PAYMENT_MODES;
})();

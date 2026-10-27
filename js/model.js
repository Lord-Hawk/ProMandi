/* In-memory lists built from the snapshot the backend sends (products, counters, markets, beats, invoices ...). */
(function () {
  const { norm, sval, clean } = U;
  const LEVELS = ['type', 'item', 'sub', 'colour'];
  const keyOf = (t, i, s, c) => [t, i, s, c].map(norm).join('|');

  class Model {
    constructor() { this.reset(); }
    reset() {
      this.tree = {}; this.listPrice = {}; this.buyPrice = {}; this.counters = {}; this.marketCounters = {};
      this.counterTypes = new Set(); this.partial = {}; this.calendar = {}; this.markets = new Set();
      this.dsoMarkets = {}; this.everyMarketSet = new Set(); this.invoices = {}; this.inwardInvoices = {}; this.outOfBeatSet = new Set();
    }
    load(d) {
      this.reset();
      (d.products || []).forEach(p => this.addProduct(...p));
      (d.listPrice || []).forEach(p => { this.addProduct(p[0], p[1], p[2], p[3]); this.listPrice[keyOf(...p.slice(0, 4))] = p[4]; });
      (d.buyPrice || []).forEach(p => { this.buyPrice[keyOf(...p.slice(0, 4))] = p[4]; });
      (d.counters || []).forEach(c => this.ingestCounter(c));
      (d.counterTypes || []).forEach(t => this.counterTypes.add(t));
      (d.markets || []).forEach(m => this.markets.add(m));
      Object.entries(d.partial || {}).forEach(([code, f]) => { this.partial[code] = new Set(f); });
      this.calendar = d.calendar || {};
      this.dsoMarkets = d.dsoMarkets ? JSON.parse(JSON.stringify(d.dsoMarkets)) : {};
      this.dsoMarketsAll = d.dsoMarketsAll || {};             // Head of Operations: every DSO's beats -> markets
      (d.everyMarket || []).forEach(m => this.everyMarketSet.add(m));
      (d.outOfBeat || []).forEach(m => this.outOfBeatSet.add(m));
      Object.entries(d.invoices || {}).forEach(([no, v]) => { this.invoices[no] = v; });
      Object.entries(d.inwardInvoices || {}).forEach(([no, v]) => { this.inwardInvoices[no] = v; });
    }
    addProduct(t, i, s, c) {
      [t, i, s, c] = [t, i, s, c].map(clean);
      if (!(t && i && s && c)) return;
      let node = this.tree;
      for (const part of [t, i, s]) {
        const k = Object.keys(node).find(x => x.toLowerCase() === part.toLowerCase()) ?? part;
        node = (node[k] = node[k] || {});
      }
      if (!Object.keys(node).some(x => x.toLowerCase() === c.toLowerCase())) node[c] = {};
    }
    ingestCounter(c) {
      const market = sval(c.market).toUpperCase(), name = clean(c.name);
      if (!name) return;
      const code = sval(c.code) || U.counterCode(market, name), old = this.counters[code] || {};
      this.counters[code] = { market, name, code, mobile: sval(c.mobile) || old.mobile || '', type: sval(c.type) || old.type || '', gstin: sval(c.gstin) || old.gstin || '' };
      (this.marketCounters[market] = this.marketCounters[market] || {})[name.toLowerCase()] = code;
      if (market) this.markets.add(market);
      if (sval(c.type)) this.counterTypes.add(sval(c.type));
    }
    /* ---- queries */
    options(prefix) {
      let node = this.tree;
      for (const p of prefix) {
        const k = Object.keys(node).find(x => x.toLowerCase() === sval(p).toLowerCase());
        if (k === undefined) return [];
        node = node[k];
      }
      return Object.keys(node).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    }
    canonProduct(t, i, s, c) {
      let node = this.tree; const out = [];
      for (let part of [t, i, s, c]) {
        part = clean(part);
        if (part.toLowerCase() === 'n/a') part = 'N/A';
        else if (part === part.toLowerCase()) part = part.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        const k = Object.keys(node).find(x => x.toLowerCase() === part.toLowerCase()) ?? part;
        out.push(k); node = node[k] || {};
      }
      return out;
    }
    hasProduct(t, i, s, c) {
      let node = this.tree;
      for (const part of [t, i, s, c]) {
        const k = Object.keys(node).find(x => x.toLowerCase() === sval(part).toLowerCase());
        if (k === undefined) return false;
        node = node[k];
      }
      return true;
    }
    beatForDate(iso) { return this.calendar[iso] || ''; }
    marketsOf(person, beat) {                              // Head of Operations: the markets of the "Logged by" person's beat
      const m = this.dsoMarketsAll[sval(person).replace(/\s+/g, ' ').trim().toLowerCase()] || {};
      return [...(m[sval(beat).toLowerCase()] || [])].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    }
    marketsFor(beat) { return [...((this.dsoMarkets || {})[sval(beat).toLowerCase()] || [])].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())); }
    sheetMarkets() {                                      // 'Out of Beat': the markets of ALL DSOs' markets sheets together
      const s = new Set(this.outOfBeatSet); Object.values(this.dsoMarkets || {}).forEach(l => l.forEach(m => s.add(m)));
      return [...s].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    }
    allMarkets() {                                        // payments form: every known market
      const s = new Set(this.markets); this.sheetMarkets().forEach(m => s.add(m));
      return [...s].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    }
    everyMarket() {                                       // Accountant's market list
      const s = new Set(this.markets); this.everyMarketSet.forEach(m => s.add(m));
      return [...s].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    }
    countersFor(market) {
      const m = this.marketCounters[sval(market).toUpperCase()] || {};
      return Object.values(m).map(code => this.counters[code].name).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    }
    findCounter(market, name) {
      const code = (this.marketCounters[sval(market).toUpperCase()] || {})[clean(name).toLowerCase()];
      return code ? this.counters[code] : null;
    }
    rateFor(code, key) { const p = this.listPrice[key]; return p ? [p, 'highest rate in Orders'] : [null, '']; }
    buyRateFor(code, key) { const p = this.buyPrice[key]; return p ? [p, 'latest Buy Price in Inwards'] : [null, '']; }
    partialFields(code) { return new Set(this.partial[code] || []); }

    /* ---- a not-yet-uploaded entry shows up in the lists at once */
    applyOverlay(o) {
      if (!o) return;
      if (o.visit && o.visit.market) this.markets.add(o.visit.market);
      if (o.newCounter) this.ingestCounter(o.newCounter);
      if (o.newMarket) {
        const l = (this.dsoMarkets || {})[sval(o.newMarket.beat).toLowerCase()];
        if (l && !l.some(m => m.toUpperCase() === o.newMarket.market.toUpperCase())) l.push(o.newMarket.market);
      }
      if (o.fill) {
        const f = o.fill, c = this.counters[f.code];
        if (c) {
          ['mobile', 'type', 'gstin'].forEach(k => { if (f[k] && !c[k]) c[k] = f[k]; });
          (f.replace || []).forEach(k => { if (f[k]) c[k] = f[k]; });
          if (this.partial[f.code]) ['mobile', 'gstin'].forEach(k => { if (f[k]) this.partial[f.code].delete(k); });
        }
      }
      (o.orders || []).forEach(r => {
        this.addProduct(r.type, r.item, r['sub item'], r.colour);
        const k = keyOf(r.type, r.item, r['sub item'], r.colour);
        if (r.price > (this.listPrice[k] || 0)) this.listPrice[k] = r.price;
      });
      (o.inwards || []).forEach(r => {
        this.addProduct(r.type, r.item, r['sub-item'], r.colour);
        if (r['buy price']) this.buyPrice[keyOf(r.type, r.item, r['sub-item'], r.colour)] = r['buy price'];
      });
      if (o.inwardInvoice) this.inwardInvoices[o.inwardInvoice.no] = o.inwardInvoice.data;
      if (o.invoice) {
        this.invoices[o.invoice.no] = o.invoice.data;
        (o.invoice.data.lines || []).forEach(l => this.addProduct(l.type, l.item, l.sub, l.colour));
      }
    }
  }
  window.Model = Model; window.LEVELS = LEVELS; window.keyOf = keyOf;
})();

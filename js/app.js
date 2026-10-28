/* ProMandi mobile - server link, offline queue, registration and the role screens */
(function () {
  const { h, norm, sval, clean } = U;
  const CFG = window.PROMANDI_CONFIG;
  const REMARKS = ['Next Week Visit', 'Next Month Visit'], REMARK_DAYS = { 'next week visit': 14, 'next month visit': 28 };
  const TERMS = ['COD', '15 Days', '30 Days', '45 Days'], TERM_DAYS = { 'COD': 0, '15 Days': 14, '30 Days': 28, '45 Days': 42 };
  const POSITIONS = ['Head of Operations', 'Manager', 'Accountant', 'DSO'];
  const NO_BEAT = '(no beat)';
  const BEATS = []; ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach(d => [1, 2, 3, 4].forEach(w => BEATS.push(d + '_' + w)));   // Mon_1 … Mon_4, Tue_1 … Sat_4
  const root = document.getElementById('app');

  /* ------------------------------------------------------------------ storage (every access guarded) */
  const store = {
    get(k, d) { try { const v = localStorage.getItem('pa_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('pa_' + k, JSON.stringify(v)); } catch (e) {} },
    del(k) { try { localStorage.removeItem('pa_' + k); } catch (e) {} },
  };
  const mem = {};                                                          // fallback when storage is blocked
  const S = {
    get token() { return store.get('token', null) || mem.token || null; },
    profile: store.get('profile', null), snapshot: store.get('snapshot', null), verifiedAt: store.get('verifiedAt', 0),
    outbox: store.get('outbox', []), failed: store.get('failed', []),
  };
  const save = k => store.set(k, S[k]);
  /* Device Type for the Users sheet: Mobile Phone / Tablet / Laptop / PC.
     Phones and tablets are told apart from the browser's description. For a computer the battery decides: a laptop has one,
     a desktop PC reports "always plugged in and full" (or no battery at all). */
  function osName() {
    const u = navigator.userAgent, p = (navigator.userAgentData && navigator.userAgentData.platform) || '';
    if (/Android/i.test(u) || /Android/i.test(p)) return 'Android';
    if (/iPhone|iPad|iPod/.test(u) || (/Macintosh/.test(u) && (navigator.maxTouchPoints || 0) > 1)) return 'iOS';
    if (/CrOS/.test(u) || /Chrome OS/i.test(p)) return 'Chrome OS';
    if (/Windows/i.test(u) || /Windows/i.test(p)) return 'Windows';
    if (/Macintosh|Mac OS X/.test(u) || /macOS/i.test(p)) return 'macOS';
    if (/Linux|X11/i.test(u) || /Linux/i.test(p)) return 'Linux';
    return 'Unknown OS';
  }
  async function deviceType() { return (await deviceKind()) + ' (' + osName() + ')'; }     // e.g. "Laptop (Windows)"
  async function deviceKind() {
    const u = navigator.userAgent, uad = navigator.userAgentData;
    const touch = navigator.maxTouchPoints || 0;
    if (/iPhone|iPod/.test(u) || (uad && uad.mobile)) return 'Mobile Phone';
    if (/iPad/.test(u) || (/Macintosh/.test(u) && touch > 1)) return 'Tablet';
    if (/Android/.test(u)) return /Mobile/.test(u) ? 'Mobile Phone' : 'Tablet';
    if (/Windows Phone|BlackBerry|Opera Mini|IEMobile/.test(u)) return 'Mobile Phone';
    if (/Tablet|Silk|Kindle|PlayBook/.test(u)) return 'Tablet';
    if (/CrOS/.test(u)) return 'Laptop';                                   // Chromebooks are laptops
    // a computer (Windows / Mac / Linux)
    if (navigator.getBattery) {
      try {
        const b = await Promise.race([navigator.getBattery(), new Promise((_, rej) => setTimeout(() => rej(new Error('t')), 1500))]);
        const desktopLike = b.charging && b.level === 1 && b.chargingTime === 0 && b.dischargingTime === Infinity;
        if (!desktopLike) return 'Laptop';                                 // running on battery, or charging: a laptop
        return /Macintosh/.test(u) ? 'Laptop' : 'PC';                      // full & plugged in looks like a desktop
      } catch (e) {}
    }
    return /Macintosh/.test(u) ? 'Laptop' : 'PC';                          // no battery information (Safari / Firefox)
  }
  /* Location: the device's GPS ("lat, lon") when the user allows it, else an approximate position from the IP address */
  const Loc = {
    value: '', updated: 0, busy: false,
    refresh() {
      if (this.busy) return; this.busy = true;
      const done = v => { if (v) this.value = v; this.updated = Date.now(); this.busy = false; };
      const ip = async () => {
        for (const [url, get] of [['https://ipwho.is/', j => (j.success === false ? null : [j.latitude, j.longitude])], ['https://ipapi.co/json/', j => [j.latitude, j.longitude]]]) {
          try { const c = new AbortController(); setTimeout(() => c.abort(), 6000); const p = get(await (await fetch(url, { signal: c.signal })).json()); if (p && isFinite(p[0]) && isFinite(p[1])) return Number(p[0]).toFixed(6) + ', ' + Number(p[1]).toFixed(6) + ' (IP approx)'; } catch (e) {}
        }
        return '';
      };
      if (navigator.geolocation) navigator.geolocation.getCurrentPosition(
        pos => done(pos.coords.latitude.toFixed(6) + ', ' + pos.coords.longitude.toFixed(6)),
        () => ip().then(done), { enableHighAccuracy: true, timeout: 15000, maximumAge: 120000 });
      else ip().then(done);
    },
    get() { if (Date.now() - this.updated > 120000) this.refresh(); return this.value; },
  };
  const deviceId = () => { let d = store.get('device', null); if (!d) { d = U.uuid(); store.set('device', d); } return d; };

  /* ------------------------------------------------------------------ API */
  async function api(action, body, timeoutMs) {
    if (!CFG.API_URL || CFG.API_URL.indexOf('PASTE') === 0) throw new ApiError('The app is not set up yet (API_URL in js/config.js).', false, true);   // not the entry's fault: it keeps waiting
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), timeoutMs || 45000);
    let res;
    try {
      res = await fetch(CFG.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ action }, body)), signal: ctl.signal, redirect: 'follow' });
    } catch (e) { throw new ApiError('No connection to the server.', false, true); } finally { clearTimeout(t); }
    let j; try { j = await res.json(); } catch (e) { throw new ApiError('The server sent an unexpected answer. Try again.', false, true); }
    if (!j.ok) throw new ApiError(j.error || 'Server error', !!j.permanent, false, j.code);
    return j;
  }
  class ApiError extends Error { constructor(m, permanent, offline, code) { super(m); this.permanent = !!permanent; this.offline = !!offline; this.code = code; } }
  const authed = (action, body, to) => api(action, Object.assign({ deviceId: deviceId(), token: S.token }, body), to);

  /* ------------------------------------------------------------------ model + overlay of not-yet-uploaded entries */
  const model = new Model();
  function rebuildModel() {
    model.load(S.snapshot || {});
    S.outbox.forEach(j => model.applyOverlay(j.overlay));
  }

  /* ------------------------------------------------------------------ sync */
  let syncing = false, lastRefresh = 0, online = navigator.onLine, statusEl = null, currentView = null;
  const pending = () => S.outbox.length;
  function setStatus() {
    if (!statusEl) return;
    const bits = [];
    if (pending()) bits.push(pending() + ' waiting to upload');
    if (S.failed.length) bits.push(S.failed.length + ' need attention');
    statusEl.textContent = bits.length ? bits.join(' · ') : (online ? 'Synced' : 'Offline');
    statusEl.className = 'status ' + (S.failed.length ? 'bad' : pending() || !online ? 'warn' : 'ok');
  }
  async function flush() {
    while (S.outbox.length) {
      const job = S.outbox[0];
      try { await authed('submit', { job: { id: job.id, parts: job.parts } }); S.outbox.shift(); save('outbox'); }
      catch (e) {
        if (e.offline) return false;
        if (e.code === 'removed' || e.code === 'blocked') throw e;
        if (e.permanent) { S.outbox.shift(); S.failed.push({ label: job.label, error: e.message, id: job.id, at: Date.now(), job }); save('outbox'); save('failed'); }
        else return false;                               // temporary server trouble: keep it, try later
      }
    }
    return true;
  }
  let blocked = false;
  function profileChanged(a, b) { return !a || !b || a.position !== b.position || a.name !== b.name || (a.title || '') !== (b.title || ''); }
  async function bootstrapNow() {
    const before = S.profile;
    const r = await authed('bootstrap', {});
    S.snapshot = r.data; S.profile = r.profile; S.verifiedAt = Date.now(); lastRefresh = Date.now();
    save('snapshot'); save('profile'); save('verifiedAt'); rebuildModel();
    if (profileChanged(before, r.profile)) { U.toast('Your role is now ' + (r.profile.title || r.profile.position)); home(); }       // new role -> new screens
    else if (currentView && currentView.onData) currentView.onData();
    refreshReports().catch(() => {});                                     // report data: in the background, only if it changed
  }
  async function sync(force) {
    if (syncing || !S.token) return;
    syncing = true; setStatus();
    try {
      if (blocked) { await authed('whoami', {}); blocked = false; start(); return; }     // throws while still blocked
      const had = S.outbox.length;
      const ok = await flush();
      if (ok && had) refreshReports(true).catch(() => {});               // something was uploaded: the report data changed
      if (ok) {
        if (force || Date.now() - lastRefresh > CFG.REFRESH_SECS * 1000 - 2000 || !S.snapshot) await bootstrapNow();
        else {                                                            // quick check: blocked / removed / role changed by the owner?
          const r = await authed('whoami', {});
          if (profileChanged(S.profile, r.profile)) await bootstrapNow();
        }
      }
      online = true;
    } catch (e) {
      if (e.code === 'removed') { deregister('Your registration was removed by the owner. Register again to continue.'); return; }
      if (e.code === 'blocked') { blocked = true; blockedView(); return; }
      if (e.offline) online = false;
    } finally { syncing = false; setStatus(); }
  }
  function blockedView() {
    currentView = null; statusEl = null;
    root.replaceChildren(h('header', { class: 'top' }, h('img', { class: 'logo', src: 'icons/logo-bar.png', alt: 'ProMandi' })),
      h('main', { class: 'page narrow' }, h('div', { class: 'card' }, h('h2', {}, 'Access stopped'),
        h('p', {}, 'The owner has blocked this device, so ProMandi cannot be used on it. The app starts working again by itself if the owner sets the Status back to Active.'),
        h('button', { class: 'btn big', onclick: () => sync(true) }, 'Check again'))));
  }
  function deregister(msg) {
    ['token', 'profile', 'snapshot', 'verifiedAt', 'outbox', 'failed', 'rdata', 'rep', 'day', 'ord'].forEach(k => store.del(k)); S.day = null; S.ord = null; RD.data = null;
    S.profile = null; S.snapshot = null; S.outbox = []; S.failed = []; delete mem.token;
    start(msg);
  }
  const submitJob = job => { S.outbox.push(job); save('outbox'); model.applyOverlay(job.overlay); setStatus(); sync(false); };
  window.addEventListener('online', () => { online = true; sync(true); });
  window.addEventListener('offline', () => { online = false; setStatus(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(true); });
  setInterval(() => { if (!document.hidden) { sync(false); if (currentView && currentView.tick) currentView.tick(); } }, 20000);

  /* ------------------------------------------------------------------ shell (top bar + view) */
  function shell(title, onBack, extra) {
    statusEl = h('span', { class: 'status' });
    const bar = h('header', { class: 'top' },
      onBack ? h('button', { class: 'back', onclick: onBack, 'aria-label': 'Home' }, '←') : h('img', { class: 'logo', src: 'icons/logo-bar.png', alt: 'ProMandi' }),
      h('div', { class: 'who' }, h('b', {}, title || ''), h('small', {}, `${S.profile.name} · ${S.profile.title || S.profile.position}`)),
      statusEl, extra || null, h('button', { class: 'sync', onclick: () => { sync(true); U.toast('Syncing…'); }, 'aria-label': 'Sync now' }, '↻'));
    const main = h('main', { class: 'page' });
    root.replaceChildren(bar, main);
    setStatus();
    return main;
  }
  const msgBox = () => h('div', { class: 'msg', role: 'status' });
  const say = (el, text, bad) => { el.textContent = text; el.className = 'msg ' + (bad ? 'bad' : 'ok'); if (text) el.scrollIntoView({ block: 'nearest' }); };
  const submitBar = (label, onSubmit, onClear, msg) => h('div', { class: 'submitbar' }, h('button', { class: 'btn big', onclick: onSubmit }, label), h('button', { class: 'btn gray', onclick: onClear }, 'Clear form'), msg);

  /* ------------------------------------------------------------------ registration */
  function registerView(notice) {
    currentView = null;
    const st = { step: 1, requestId: null, sentTo: '' };
    const v = { position: '', mgmtRole: '', name: '', mobile: '', email: '', headName: '', headEmail: '', recordsLink: '' };
    const box = h('div', { class: 'card' });
    root.replaceChildren(h('header', { class: 'top' }, h('img', { class: 'logo', src: 'icons/logo-bar.png', alt: 'ProMandi' })), h('main', { class: 'page narrow' }, notice ? h('div', { class: 'msg bad' }, notice) : null, box));
    const err = msgBox();
    const inp = (label, key, attrs) => { const i = h('input', Object.assign({ class: 'inp', value: v[key], autocomplete: 'off' }, attrs || {})); i.addEventListener('input', () => { v[key] = i.value; }); return field(label, i); };
    function step1() {
      Loc.refresh();
      const sel = h('select', { class: 'inp' }, h('option', { value: '' }, '---- Select ----'), ...POSITIONS.map(p => h('option', { value: p }, p)));
      sel.value = v.position;
      const headBox = h('div');
      const roleBox = h('div');                                       // Manager: "Management Role (One word only)"
      const drawRole = () => roleBox.replaceChildren(...(v.position === 'Manager' ? [inp('Management Role (One word only)', 'mgmtRole', { autocapitalize: 'words', placeholder: 'e.g. Sales' })] : []));
      const draw = () => { headBox.replaceChildren(...(!v.position ? [] : v.position === 'Head of Operations' ? [h('p', { class: 'hint' }, 'Open your records Google Sheet, share it (as Editor) with verify.proaxis@gmail.com, then paste its link here. Everyone who registers under you will use this sheet.'), inp('Records Google Sheet link', 'recordsLink', { type: 'url', inputmode: 'url', autocapitalize: 'off' })] : [h('p', { class: 'hint' }, 'Your Head of Operations must be registered already. The OTP goes to them.'), inp('Head of Operations – First Name', 'headName'), inp('Head of Operations – email', 'headEmail', { type: 'email', inputmode: 'email', autocapitalize: 'off' })])); };
      const emailF = inp('Email ID (Optional)', 'email', { type: 'email', inputmode: 'email', autocapitalize: 'off' });
      const emailLbl = () => { emailF.querySelector('.lbl').textContent = v.position === 'Head of Operations' ? 'Email ID' : 'Email ID (Optional)'; };
      sel.addEventListener('change', () => { v.position = sel.value; draw(); emailLbl(); drawRole(); });
      draw(); emailLbl(); drawRole();
      const go = h('button', { class: 'btn big', onclick: async () => {
        if (!v.position) { say(err, 'Select the Position first.', true); return; }
        if (v.position === 'Manager' && !/^[A-Za-z][A-Za-z&.\-]{0,29}$/.test(v.mgmtRole.trim())) { say(err, 'Enter your Management Role as ONE word, e.g. Sales.', true); return; }
        v.mgmtRole = v.mgmtRole.trim();
        go.disabled = true; say(err, '');
        try {
          const r = await api('register_request', Object.assign({ deviceType: await deviceType(), location: Loc.get() }, v));
          st.requestId = r.requestId; st.sentTo = r.sentTo; step2();
        } catch (e) { say(err, e.message, true); } finally { go.disabled = false; }
      } }, 'Send OTP');
      box.replaceChildren(h('h2', {}, 'Register this device'), field('Position', sel), roleBox, inp('First Name', 'name'), inp('Mobile No.', 'mobile', { type: 'tel', inputmode: 'tel' }),
        emailF, headBox, go, err);
    }
    function step2() {
      const otp = h('input', { class: 'inp otp', inputmode: 'numeric', maxlength: '6', placeholder: '6-digit OTP', autocomplete: 'one-time-code' });
      const go = h('button', { class: 'btn big', onclick: async () => {
        go.disabled = true; say(err, '');
        try {
          const r = await api('register_verify', Object.assign({ requestId: st.requestId, otp: otp.value, deviceId: deviceId(), deviceType: await deviceType(), location: Loc.get() }, v));
          store.set('token', r.token); mem.token = r.token; S.profile = r.profile; save('profile');
          box.replaceChildren(h('h2', {}, 'This device has been registered'), h('button', { class: 'btn big', onclick: () => start() }, 'Next'));
        } catch (e) { say(err, e.message, true); } finally { go.disabled = false; }
      } }, 'Verify');
      box.replaceChildren(h('h2', {}, 'Enter the OTP'), h('p', { class: 'hint' }, 'The OTP was emailed to ' + st.sentTo + '. Ask them for it.'), otp, go,
        h('button', { class: 'btn gray', onclick: step1 }, 'Back'), err);
      otp.focus();
    }
    step1();
  }

  /* ------------------------------------------------------------------ homes */
  const roundBtn = (title, caption, cls, fn) => h('div', { class: 'roundwrap ' + cls }, h('button', { type: 'button', class: 'roundbtn ' + cls, onclick: fn }, h('b', {}, title), h('small', {}, caption)));
  const card = (title, caption, cls, fn) => h('button', { class: 'homecard ' + cls, onclick: fn }, h('b', {}, title), h('span', {}, caption));
  function failedList() {
    if (!S.failed.length) return null;
    return h('div', { class: 'card warnbox' }, h('b', {}, 'These entries could not be saved:'),
      ...S.failed.map((f, i) => h('div', { class: 'failed' }, h('div', {}, f.label), h('small', {}, f.error), h('div', { class: 'row-between' },
        f.job ? h('button', { class: 'btn small', onclick: () => { S.failed.splice(i, 1); save('failed'); S.outbox.push(f.job); save('outbox'); home(); sync(false); } }, 'Try again') : null,
        h('button', { class: 'btn small gray', onclick: () => { S.failed.splice(i, 1); save('failed'); home(); } }, 'Discard')))));
  }
  /* Head of Operations: the main home has "As DSO", "As Manager", "As Accountant" – each opens that position's home page.
     asRole remembers which one is open, so the ← on its screens comes back to it (and from it, to the Head's main home). */
  let asRole = '';
  function home() {
    const own = S.profile.position, isHead = own === 'Head of Operations';
    if (!isHead) asRole = '';
    if (isHead && !asRole) {
      const main = shell('Home');
      main.append(
        card('AS DSO', 'Log visits and payments (“Logged by”), beat details and counter search', 'blue', () => { asRole = 'DSO'; home(); }),
        card('AS MANAGER', 'The Manager’s home page – log visits and payments, beat details and counter search', 'violet', () => { asRole = 'Manager'; home(); }),
        card('AS ACCOUNTANT', 'Inward and outward invoices, edit a previous invoice, counter search', 'green', () => { asRole = 'Accountant'; home(); }),
        card('GENERATE SUMMARY', 'A DSO’s work between two dates, day by day, as a PDF', 'indigo', () => rangeSummaryView()));
      const fl = failedList(); if (fl) main.append(fl);
      currentView = { onData() {} };
      return;
    }
    const pos = isHead ? asRole : own;
    const main = isHead ? shell('As ' + asRole, () => { asRole = ''; home(); }) : shell('Home');
    currentView = { onData() {} };
    const logCards = () => [card('LOG VISITS', 'Log the visits to the counters of each day', 'blue', () => visitView()), card('LOG PAYMENTS', 'Payments received outside of visits', 'green', () => payView())];
    if (isFieldRole()) {                                          // DSO / Manager: Attendance -> work -> Check Out -> day ended
      const d = day();
      if (!d.in) main.append(roundBtn('CHECK IN', 'Start your day', 'in', () => attendanceView()));
      else if (!d.out) main.append(...logCards(), card('PREVIOUS ENTRIES', 'Today’s visits and payments – view or edit them', 'slate', () => entriesView()));
      else main.append(card('DAY ENDED', 'You checked out at ' + d.out + '. Tap to see and share today’s summary', 'slate', () => daySummaryView()));
    } else if (isHead && pos !== 'Accountant') main.append(...logCards(), card('PREVIOUS ENTRIES', pos === 'Manager' ? 'See and change any Manager’s entries, any day' : 'See and change any DSO’s entries, any day', 'slate', () => headEntriesView(pos)));          // the Head as DSO / Manager: no attendance, "Logged by" instead
    if (pos !== 'Accountant') main.append(card('BEAT DETAILS', 'View markets of any beat, targets achieved and payments pending', 'gold', () => beatView()));
    else main.append(card('LOG INWARD INVOICES', 'Log the products that came in', 'green', () => inwardView()), card('LOG OUTWARD INVOICES', 'Log the invoices raised to the counters', 'blue', () => outwardView()), card('EDIT PREVIOUS INVOICE', 'Change, add or remove products of an outward invoice, or cancel it', 'slate', () => editView()));
    main.append(card('COUNTER SEARCH', "View any counter's visits, orders, invoices and more", 'teal', () => counterView()));
    if (isFieldRole() && day().in && !day().out) main.append(roundBtn('CHECK OUT', 'End your day', 'out', () => checkoutView()));
    const fl = failedList(); if (fl) main.append(fl);
    const key = dayKey();
    currentView = { onData() { if (dayKey() !== key) home(); }, tick() { if (dayKey() !== key) home(); } };   // a new day / attendance changed elsewhere
  }

  /* ------------------------------------------------------------------ shared pieces */
  const dateBox = (iso, onChange) => { const i = h('input', { type: 'date', class: 'inp', value: iso }); i.addEventListener('change', () => { onChange && onChange(i.value); }); i.get = () => i.value; return i; };
  const roundRupee = x => Math.round(x + 1e-9);
  const plain = x => (Number.isInteger(x) ? x : +x.toFixed(2));
  const marketCodeOf = U.marketCode;
  const needIso = s => { if (!U.parseIso(s)) throw new Error('Enter a valid date.'); return s; };
  function tryRun(fn, msg) { try { return fn(); } catch (e) { say(msg, e.message, true); return undefined; } }

  /* ------------------------------------------------------------------ Counter Search: one counter's visits, orders, invoices, payments, pending */
  function counterView() {
    const main = shell('Counter Search', home);
    const out = h('div');
    const rs = x => '₹' + Number(x || 0).toLocaleString('en-IN', Number.isInteger(+x) ? {} : { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const longDate = iso => { const d = U.parseIso(iso); return d ? d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : ''; };
    const shortDate = iso => { const d = U.parseIso(iso); return d ? d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' }) : ''; };
    const markets = () => Object.keys(model.marketCounters).filter(m => Object.keys(model.marketCounters[m]).length).sort((a, b) => a.localeCompare(b));
    const market = new Combo({ placeholder: 'Market', strict: true, values: markets, onChange: () => { counter.set(''); out.replaceChildren(); } });
    const counter = new Combo({ placeholder: 'Counter', strict: true, values: () => model.countersFor(market.get()), onChange: v => { if (v) load(); else out.replaceChildren(); } });
    let tab = 'visits', seq = 0, shownCounter = null;
    const again = () => { if (!document.body.contains(out)) return RD.subs.delete(again); if (shownCounter && counter.get()) draw(counterReport(shownCounter.code), shownCounter); };
    RD.subs.add(again);                                                     // newer data arrived: redraw what is on screen
    const pill = (txt, kind) => h('span', { class: 'pill ' + kind }, txt);
    const prodLine = l => prodName(l) + ' × ' + l.qty + ' @ ' + rs(l.price);
    const box = (title, ...rows) => h('div', { class: 'cs-box' }, h('h4', {}, title), ...rows);
    const row = (left, right) => h('div', { class: 'cs-row' }, h('div', { class: 'cs-l' }, ...left), h('div', { class: 'cs-r' }, ...right));
    const sub = t => h('div', { class: 'cs-sub' }, t);
    const big = t => h('div', { class: 'cs-main' }, t);
    const empty = t => h('p', { class: 'hint' }, t);
    async function load() {
      const c = model.findCounter(market.get(), counter.get()); if (!c) return;
      const my = ++seq; shownCounter = c;
      if (!RD.data) {
        out.replaceChildren(waitNote());
        try { await reportData(); } catch (e) { if (my === seq) out.replaceChildren(noData(e)); return; }
      }
      if (my !== seq) return;
      draw(counterReport(c.code), c);
    }
    function draw(r, c) {
      const head = h('div', { class: 'cs-head' }, h('b', {}, r.name || c.name),
        h('span', {}, [r.market || c.market, r.beat ? 'Beat ' + r.beat : '', r.dso ? 'DSO ' + r.dso : ''].filter(Boolean).join(' · ')));
      const stat = (k, v, cls) => h('div', { class: 'cs-stat' }, h('span', {}, k), h('b', { class: cls || '' }, rs(v)));
      const stats = h('div', { class: 'cs-stats' }, stat('Order Value', r.orderValue), stat('Billed', r.billed), stat('Received', r.received, 'good'), stat('Pending', r.pending, r.pending > 0 ? 'bad' : 'good'));
      const TABS = [['visits', 'Visits'], ['orders', 'Orders'], ['invoices', 'Invoices'], ['payments', 'Payments'], ['pending', 'Pending']];
      const body = h('div', { class: 'cs-body' });
      const tabs = h('div', { class: 'cs-tabs', role: 'tablist' }, ...TABS.map(([k, t]) => h('button', { type: 'button', class: k === tab ? 'on' : '', onclick: () => { tab = k; [...tabs.children].forEach((b, i) => b.classList.toggle('on', TABS[i][0] === k)); fill(); } }, t)));
      function fill() {
        let parts = [];
        if (tab === 'visits') {
          const month = r.today.slice(0, 7), thisMonth = r.visits.filter(v => v.date.slice(0, 7) === month).length;
          const last = r.visits[0] ? Math.round((U.parseIso(r.today) - U.parseIso(r.visits[0].date)) / 864e5) : null;
          parts = [box('Visit history (all time)', ...(r.visits.length ? r.visits.map(v => row([big(longDate(v.date)), sub([v.dso, v.beat ? 'Beat ' + v.beat : 'Out of Beat'].filter(Boolean).join(' · '))],
                   [h('div', { class: 'pills' }, ...(v.order && v.payment ? [pill('Order taken', 'green'), pill('Payment', 'blue')] : v.order ? [pill('Order taken', 'green')] : v.payment ? [pill('Payment only', 'blue')] : [pill('No order', 'yellow')]))])) : [empty('No visits yet.')])),
                   box('This month', h('div', { class: 'cs-line' }, 'Visits: ', h('b', {}, String(thisMonth)), '   Last visit: ', h('b', {}, last == null ? '–' : last === 0 ? 'today' : last === 1 ? '1 day ago' : last + ' days ago')))];
        } else if (tab === 'orders') {
          parts = [box('Orders', ...(r.orders.length ? r.orders.map(o => row([big(o.no), ...o.lines.map(l => sub(prodLine(l)))], [h('div', { class: 'cs-amt' }, rs(o.total)), o.terms ? pill(o.terms, o.terms === 'COD' ? 'green' : 'blue') : null])) : [empty('No orders yet.')])),
                   box('Total orders (all time)', h('div', { class: 'cs-total' }, rs(r.orderValue)))];
        } else if (tab === 'invoices') {
          const kind = { 'Paid': 'green', 'Part paid': 'yellow', 'Unpaid': 'red', 'Cancelled': 'grey' };
          parts = [box('Invoices', ...(r.invoices.length ? r.invoices.map(i => row([big(i.no), sub((i.orderNo ? 'Order ' + i.orderNo + ' · ' : '') + shortDate(i.date)), ...i.lines.map(l => sub(prodLine(l)))], [h('div', { class: 'cs-amt' }, rs(i.total)), pill(i.status, kind[i.status])])) : [empty('No invoices yet.')])),
                   box('Total billed (all time)', h('div', { class: 'cs-total' }, rs(r.billed)))];
        } else if (tab === 'payments') {
          parts = [box('Payments received', ...(r.payments.length ? r.payments.map(p => row([big(shortDate(p.date)), ...p.modes.map(m => sub(m.mode + ': ' + rs(m.amount)))], [h('div', { class: 'cs-amt' }, rs(p.total))])) : [empty('No payments yet.')])),
                   box('Total payment (all time)', h('div', { class: 'cs-total good' }, rs(r.received)))];
        } else {
          const due = r.invoices.filter(i => !i.cancelled && i.pending > 0).sort((a, b) => (a.due < b.due ? -1 : 1));
          const left = iso => { const d = Math.round((U.parseIso(iso) - U.parseIso(r.today)) / 864e5); return d > 0 ? pill(d + (d === 1 ? ' day left' : ' days left'), 'green') : d === 0 ? pill('Due today', 'yellow') : pill(-d + (d === -1 ? ' day overdue' : ' days overdue'), 'red'); };
          parts = [box('Due dates', ...(due.length ? due.map(i => row([big(i.no), sub('Billed ' + rs(i.total) + (i.paid > 0 ? ' · paid ' + rs(i.paid) : '') + (i.terms ? ' · ' + i.terms : ''))], [h('div', { class: 'cs-amt' }, longDate(i.due)), left(i.due)])) : [empty('Nothing pending.')])),
                   box('Total pending', h('div', { class: 'cs-total ' + (r.pending > 0 ? 'bad' : 'good') }, rs(r.pending)))];
        }
        body.replaceChildren(...parts);
      }
      fill();
      out.replaceChildren(h('div', { class: 'cs-card' }, head, stats, tabs, body));
    }
    main.append(h('section', { class: 'card' }, h('h3', {}, 'Counter Search'), field('Market', market.el), field('Counter', counter.el)), out);
    currentView = { onData() {} };
  }

  /* ------------------------------------------------------------------ summary popup after a DSO submit (copy / share as plain text) */
  const dmyShort = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? (+m[3]) + '/' + (+m[2]) + '/' + m[1].slice(2) : ''; };
  const money = x => '₹' + Number(x).toLocaleString('en-IN', Number.isInteger(+x) ? {} : { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const payText = pays => [...pays].sort((a, b) => PAYMENT_MODES.indexOf(a.mode) - PAYMENT_MODES.indexOf(b.mode)).map(p => p.mode + ': ' + money(p.amount));
  const ICON_COPY = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>';
  const ICON_SHARE = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4"/><path d="m15.4 6.5-6.8 4"/></svg>';
  function iconBtn(cls, svg, text, onclick) { const b = h('button', { type: 'button', class: 'btn ' + cls + ' iconbtn', onclick }); b.innerHTML = svg; b.append(h('span', {}, text)); return b; }
  /* "Submitted successfully": a green box in the middle of the screen with OK – after every entry is submitted */
  function submitted(after) {
    document.querySelectorAll('.modal.okpop').forEach(x => x.remove());
    const ok = h('button', { type: 'button', class: 'btn okbtn', onclick: () => { ov.remove(); after && after(); } }, 'OK');
    const ov = h('div', { class: 'modal okpop' },
      h('div', { class: 'okbox', role: 'alertdialog', 'aria-label': 'Submitted successfully' },
        h('p', { class: 'oktext' }, 'Submitted successfully'), h('div', { class: 'okrow' }, ok)));
    document.body.append(ov); ok.focus();
  }
  function showSummary(text) {
    const box = h('textarea', { class: 'inp summary', readonly: true, rows: Math.min(18, text.split('\n').length + 1) }); box.value = text;
    const close = () => ov.remove();
    async function copy(quiet) {
      try { await navigator.clipboard.writeText(text); }
      catch (e) { box.removeAttribute('readonly'); box.select(); try { document.execCommand('copy'); } catch (e2) {} box.setAttribute('readonly', ''); box.blur(); }
      if (!quiet) U.toast('Copied');
    }
    async function share() {
      if (navigator.share) { try { await navigator.share({ text }); } catch (e) {} }
      else { await copy(true); U.toast('Sharing is not available here – the text was copied instead.'); }
    }
    const ov = h('div', { class: 'modal', onclick: e => { if (e.target === ov) close(); } },
      h('div', { class: 'modal-box', role: 'dialog', 'aria-label': 'Entry summary' },
        h('div', { class: 'row-between modal-head' }, h('h2', {}, 'Entry summary'), h('button', { class: 'x', onclick: close, 'aria-label': 'Close' }, '✕')),
        h('div', { class: 'modal-body' }, box,
          h('div', { class: 'summary-actions' }, iconBtn('', ICON_COPY, 'Copy', () => copy(false)), iconBtn('green', ICON_SHARE, 'Share', share)),
          h('button', { type: 'button', class: 'btn gray done', onclick: close }, 'Done'))));
    document.body.append(ov);
  }

  /* ------------------------------------------------------------------ report data ON THE DEVICE
     Everything Counter Search / Today's Beat / Beat Targets need is downloaded in ONE request in the background (at start-up, after
     every upload and with every list refresh - only when it changed), kept on the device, and the screens are worked out locally. */
  const RD = { data: store.get('rdata', null), busy: null, subs: new Set() };
  function refreshReports(force) {
    if (!S.token) return Promise.resolve(RD.data);
    if (RD.busy) return RD.busy;
    const have = force ? '' : ((RD.data && RD.data.sig) || '');
    RD.busy = authed('report_data', { have }, 90000).then(r => {
      if (!r.same) {
        RD.data = { sig: r.sig, cols: r.cols, t: r.t, cal: r.cal, markets: r.markets, at: Date.now() };
        store.set('rdata', RD.data);
        RD.subs.forEach(f => { try { f(); } catch (e) {} });
      }
      return RD.data;
    }).finally(() => { RD.busy = null; });
    return RD.busy;
  }
  async function reportData() {                         // the data now (download first only if the device has none yet)
    if (RD.data) return RD.data;
    return refreshReports(true);
  }
  function RT(name) {
    const d = RD.data, keep = (d.cols || {})[name] || [], idx = {}; keep.forEach((k, i) => { idx[k] = i; });
    return { rows: (d.t || {})[name] || [], get: (r, ...keys) => { for (const k of keys) { const v = r[idx[k]]; if (v !== '' && v != null) return v; } return ''; } };
  }
  const TERM_DAYS_R = { 'cod': 0, '15 days': 14, '30 days': 28, '45 days': 42 };
  /* a product as one name: <Item> <Sub-Item> <Colour> (Colour left out when it is N/A) */
  const prodName = l => [l.item, l.sub, l.colour && l.colour.toUpperCase() !== 'N/A' ? l.colour : ''].map(x => sval(x)).filter(Boolean).join(' ');
  const isoOf = v => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : '');
  function counterReport(code) {
    const want = norm(code), today = U.todayIso();
    const n = v => { const x = Number(v); return isFinite(x) ? x : 0; }, r2 = x => Math.round(x * 100) / 100;
    const mob = v => (typeof v === 'number' ? String(v) : sval(v));
    const line = (T, r) => ({ item: sval(T.get(r, 'item')), sub: sval(T.get(r, 'sub item', 'sub-item')), colour: sval(T.get(r, 'colour')), qty: n(T.get(r, 'qty')), price: n(T.get(r, 'price')) });
    const out = { today, name: '', market: '', code, mobile: '', gstin: '', beat: '', dso: '' };
    let T = RT('Payments Received'); const payments = [];
    T.rows.forEach(r => {
      if (norm(T.get(r, 'counter code')) !== want) return;
      const modes = [];
      ['Cash', 'UPI', 'Cheque', 'Card'].forEach(m => { const a = n(T.get(r, m.toLowerCase())); if (a) modes.push({ mode: m, amount: a }); });
      const tot = modes.reduce((a, x) => a + x.amount, 0) || n(T.get(r, 'total'));
      if (!tot) return;
      payments.push({ date: isoOf(T.get(r, 'date')), by: sval(T.get(r, 'received by')), modes, total: r2(tot) });
      if (!out.name) { out.name = sval(T.get(r, 'counter name')); out.market = sval(T.get(r, 'market')).toUpperCase(); }
    });
    const payDates = {}; payments.forEach(p => { payDates[p.date] = 1; });
    T = RT('Visits'); const visits = [];
    T.rows.forEach(r => {
      if (norm(T.get(r, 'counter code')) !== want) return;
      const d = isoOf(T.get(r, 'date'));
      visits.push({ date: d, dso: sval(T.get(r, 'dso')), beat: sval(T.get(r, 'beat')), order: norm(T.get(r, 'productive')) === 'yes' || n(T.get(r, 'orders')) > 0, payment: !!payDates[d] });
      out.name = sval(T.get(r, 'counter name')) || out.name; out.market = sval(T.get(r, 'market')).toUpperCase() || out.market;
      out.mobile = mob(T.get(r, 'mobile')) || out.mobile; out.gstin = sval(T.get(r, 'gstin/pan', 'gstin/uin')) || out.gstin;
    });
    visits.sort((a, b) => (a.date < b.date ? 1 : -1));
    if (visits.length) { out.beat = visits[0].beat; out.dso = visits[0].dso; }
    T = RT('Orders'); const ord = {}, terms = {};
    T.rows.forEach(r => {
      if (norm(T.get(r, 'counter code')) !== want) return;
      const no = sval(T.get(r, 'order no.')) || ('(no number) ' + isoOf(T.get(r, 'date')));
      const o = ord[no] || (ord[no] = { no, date: isoOf(T.get(r, 'date')), terms: sval(T.get(r, 'payment terms')), lines: [], total: 0 });
      const l = line(T, r);
      if (l.sub || l.qty) { o.lines.push(l); const v = T.get(r, 'price x qty'); o.total += v === '' ? l.qty * l.price : n(v); }
      if (!o.terms) o.terms = sval(T.get(r, 'payment terms'));
      if (!out.name) out.name = sval(T.get(r, 'counter name'));
    });
    const orders = Object.values(ord).map(o => { o.total = r2(o.total); terms[norm(o.no)] = o.terms; return o; }).sort((a, b) => (a.date < b.date ? 1 : -1));
    T = RT('Invoice Record'); const inv = {};
    T.rows.forEach(r => {
      if (norm(T.get(r, 'counter code')) !== want) return;
      const no = sval(T.get(r, 'invoice no.')); if (!no) return;
      const i = inv[no] || (inv[no] = { no, date: isoOf(T.get(r, 'date')), orderNo: sval(T.get(r, 'order no.')), lines: [], billing: 0, sum: 0 });
      const l = line(T, r);
      if (l.sub && l.qty) { i.lines.push(l); const v = T.get(r, 'price x qty (for sum ref)', 'price x qty'); i.sum += v === '' ? l.qty * l.price : n(v); }
      if (n(T.get(r, 'billing value'))) i.billing = n(T.get(r, 'billing value'));
      if (!out.name) { out.name = sval(T.get(r, 'counter name')); out.market = sval(T.get(r, 'market')).toUpperCase(); }
    });
    const invoices = Object.values(inv).map(i => {
      i.cancelled = !i.lines.length;
      i.total = i.cancelled ? 0 : r2(i.billing || Math.round(i.sum));
      i.terms = terms[norm(i.orderNo)] || '';
      i.due = i.date ? U.addDays(i.date, TERM_DAYS_R[norm(i.terms)] || 0) : '';
      return i;
    });
    const received = r2(payments.reduce((a, p) => a + p.total, 0));
    let left = received;
    invoices.filter(i => !i.cancelled).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.no < b.no ? -1 : 1))).forEach(i => {
      const paid = Math.min(left, i.total); left = r2(left - paid);
      i.paid = r2(paid); i.pending = r2(i.total - paid);
      i.status = i.pending <= 0 ? 'Paid' : paid > 0 ? 'Part paid' : 'Unpaid';
    });
    invoices.forEach(i => { if (i.cancelled) { i.paid = 0; i.pending = 0; i.status = 'Cancelled'; } });
    invoices.sort((a, b) => (a.date < b.date ? 1 : -1)); payments.sort((a, b) => (a.date < b.date ? 1 : -1));
    Object.assign(out, { visits, orders, invoices, payments, received,
      orderValue: r2(orders.reduce((a, o) => a + o.total, 0)), billed: r2(invoices.reduce((a, i) => a + i.total, 0)) });
    out.pending = r2(out.billed - received);
    return out;
  }
  function beatTargetsOf(rows, beat) {
    const want = norm(beat), width = rows.reduce((m, r) => Math.max(m, r.length), 0), out = [], seen = {};
    const cell = (r, c) => (c < r.length ? clean(r[c]) : '');
    const num = v => (typeof v === 'number' ? v : (/^[\d,.\s₹]+$/.test(sval(v)) && /\d/.test(sval(v)) ? Number(sval(v).replace(/[^\d.]/g, '')) : null));
    for (let c = 0; c < width; c++) {
      if (!rows.slice(0, 2).some(r => norm(cell(r, c)) === want)) continue;
      rows.slice(2).forEach(r => {
        const m = cell(r, c).toUpperCase();
        if (!m || seen[m] || num(r[c]) !== null) return;
        seen[m] = 1; out.push({ market: m, target: c + 1 < r.length ? num(r[c + 1]) : null });
      });
    }
    return out;
  }
  function beatReport(dso, pickBeat) {
    const d = RD.data, today = U.todayIso(), month = today.slice(0, 7), pos = S.profile.position;
    const sheets = d.markets || [];
    const who = pos === 'DSO' ? S.profile.name : dso;
    const out = { dsos: pos === 'DSO' ? [] : sheets.map(x => x.name), date: today, beat: (d.cal || {})[today] || model.beatForDate(today) || '' };
    if (pickBeat) out.beat = pickBeat;                                    // the beat chosen in the Beat dropdown
    if (!who) return out;
    const ms = sheets.find(x => norm(x.name) === norm(who));
    out.dso = ms ? ms.name : who;
    if (!ms) { out.error = "There is no '" + who + " Markets' tab in the records sheet."; return out; }
    if (!out.beat) { out.error = 'No beat is set for today in the Year Calendar.'; return out; }
    const T = RT('Orders'), byCode = {};
    T.rows.forEach(r => {
      if (isoOf(T.get(r, 'date')).slice(0, 7) !== month) return;
      const code = norm(T.get(r, 'market code')).toUpperCase(); if (!code) return;
      let v = Number(T.get(r, 'price x qty'));
      if (!isFinite(v) || T.get(r, 'price x qty') === '') v = (Number(T.get(r, 'qty')) || 0) * (Number(T.get(r, 'price')) || 0);
      byCode[code] = (byCode[code] || 0) + (isFinite(v) ? v : 0);
    });
    out.rows = beatTargetsOf(ms.rows, out.beat).map(x => ({ market: x.market, target: x.target, orderValue: Math.round((byCode[U.marketCode(x.market).toUpperCase()] || 0) * 100) / 100 }));
    return out;
  }
  let balCache = null;
  function counterBalances() {
    if (balCache && balCache.sig === RD.data.sig) return balCache.acc;
    const n = v => { const x = Number(v); return isFinite(x) ? x : 0; }, acc = {};
    const get = (code, name, market) => {
      const k = norm(code); if (!k) return null;
      const known = model.counters[sval(code)] || null;
      return acc[k] || (acc[k] = { code: sval(code), name: (known && known.name) || sval(name), market: ((known && known.market) || sval(market)).toUpperCase(), billed: 0, received: 0 });
    };
    let T = RT('Invoice Record'); const inv = {};
    T.rows.forEach(r => {
      const no = sval(T.get(r, 'invoice no.')), code = T.get(r, 'counter code'); if (!no || !norm(code)) return;
      const i = inv[no] || (inv[no] = { code, name: T.get(r, 'counter name'), market: T.get(r, 'market'), lines: 0, billing: 0, sum: 0 });
      const q = n(T.get(r, 'qty')), pr = n(T.get(r, 'price'));
      if (sval(T.get(r, 'sub item', 'sub-item')) && q) { i.lines++; const v = T.get(r, 'price x qty (for sum ref)', 'price x qty'); i.sum += v === '' ? q * pr : n(v); }
      if (n(T.get(r, 'billing value'))) i.billing = n(T.get(r, 'billing value'));
    });
    Object.values(inv).forEach(i => { const c = get(i.code, i.name, i.market); if (c && i.lines) c.billed += i.billing || Math.round(i.sum); });
    T = RT('Payments Received');
    T.rows.forEach(r => {
      const c = get(T.get(r, 'counter code'), T.get(r, 'counter name'), T.get(r, 'market')); if (!c) return;
      const t = ['cash', 'upi', 'cheque', 'card'].reduce((a, m) => a + n(T.get(r, m)), 0) || n(T.get(r, 'total'));
      c.received += t;
    });
    Object.values(acc).forEach(c => { c.billed = Math.round(c.billed * 100) / 100; c.received = Math.round(c.received * 100) / 100; });
    balCache = { sig: RD.data.sig, acc };
    return acc;
  }
  const waitNote = () => h('p', { class: 'hint' }, 'Getting the data for the first time…');
  const noData = e => h('div', { class: 'msg bad' }, e && e.offline ? 'No internet – this screen needs a connection the first time.' : 'Could not get the data: ' + (e && e.message || ''));

  /* ------------------------------------------------------------------ Today's Beat: markets, monthly target, this month's orders, achieved % */
  function beatView() {
    const title = 'Beat Details';
    const main = shell(title, home);
    const pos = S.profile.position, picks = pos !== 'DSO';
    const out = h('div');
    const inr0 = x => '₹' + Math.round(x).toLocaleString('en-IN');
    const sel = picks ? h('select', { class: 'inp' }, h('option', { value: '' }, '---- Select ----')) : null;
    /* Beat dropdown for everyone: all the beats, today's beat chosen at the start and shown as "Today (<beat>)" */
    const beatSel = h('select', { class: 'inp' });
    let beatDay = '';
    function fillBeats() {
      const day = U.todayIso(), tb = beatFor(day);
      const keep = beatDay === day ? beatSel.value : tb;                    // a new day: today's beat again
      beatDay = day;
      const list = BEATS.slice(); if (tb && !list.includes(tb)) list.unshift(tb);
      beatSel.replaceChildren(h('option', { value: '' }, '---- Select ----'), ...list.map(b => h('option', { value: b }, b === tb ? 'Today (' + b + ')' : b)));
      beatSel.value = list.includes(keep) ? keep : '';
    }
    fillBeats();
    const detSel = h('select', { class: 'inp' }, h('option', { value: '' }, '---- Select ----'), h('option', { value: 'targets' }, 'Beat Targets'), h('option', { value: 'pending' }, 'Payments Pending'));
    let lastDso = '';
    const monthOf = iso => { const d = U.parseIso(iso); return d ? d.toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : ''; };
    async function load(dso) {
      if (!RD.data) {
        out.replaceChildren(waitNote());
        try { await reportData(); } catch (e) { out.replaceChildren(noData(e)); return null; }
      }
      return render(beatReport(dso, beatSel ? beatSel.value : ''), dso);
    }
    const again = () => { if (!document.body.contains(out)) return RD.subs.delete(again); if (!beatSel.value) fillBeats(); load(lastDso); };   // newer data arrived
    RD.subs.add(again);
    function render(r, dso) {
      if (sel && sel.options.length === 1) (r.dsos || []).forEach(n => sel.append(h('option', { value: n }, n)));
      if (picks && !dso) { out.replaceChildren(h('p', { class: 'hint' }, 'Select a DSO to see the markets.')); return r; }
      if (!beatSel.value) { out.replaceChildren(h('p', { class: 'hint' }, 'Select a Beat to see its markets.')); return r; }
      if (!detSel.value) { out.replaceChildren(h('p', { class: 'hint' }, 'Select what to see under Details.')); return r; }
      const item = (k, v) => h('div', {}, h('span', {}, k), h('b', {}, v));
      const who = r.dso || dso || S.profile.name;
      if (detSel.value === 'pending') return renderPending(r, who, item);
      const info = h('div', { class: 'beatinfo' }, item('DSO', who), item('Month', monthOf(r.date)), item('Beat', beatLabel(r.beat)));
      if (r.error) { out.replaceChildren(info, h('div', { class: 'msg bad' }, r.error)); return r; }
      const rows = r.rows || [];
      if (!rows.length) { out.replaceChildren(info, h('p', { class: 'hint' }, 'No markets are listed for this beat in the markets sheet.')); return r; }
      let tT = 0, tO = 0;
      const tr = (x, total) => {
        const has = x.target > 0, ach = has ? x.orderValue / x.target * 100 : null, pend = has ? 100 - ach : null;
        const pc = v => (Math.round(v * 10) / 10).toLocaleString('en-IN') + '%';
        const cls = pend == null ? '' : pend <= 0 ? 'p-green' : pend >= 100 ? 'p-red' : 'p-yellow';
        return h('tr', { class: total ? 'sumrow' : '' }, h('td', {}, x.market), h('td', { class: 'c' }, has ? inr0(x.target) : '–'), h('td', { class: 'c' }, inr0(x.orderValue)),
          h('td', { class: 'ach' }, ach == null ? '–' : [h('div', { class: 'bar' }, h('i', { style: 'width:' + Math.max(0, Math.min(100, ach)) + '%' })), h('span', {}, pc(ach))]),
          h('td', { class: 'num ' + cls }, pend == null ? '–' : pc(pend)));
      };
      const body = rows.map(x => { if (x.target > 0) tT += x.target; tO += x.orderValue; return tr(x); });
      out.replaceChildren(info, h('div', { class: 'tablewrap' }, h('table', { class: 'beat' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Market'), h('th', { class: 'c' }, 'Monthly Target'), h('th', { class: 'c' }, 'Order Value'), h('th', {}, 'Achieved %'), h('th', {}, 'Pending %'))),
        h('tbody', {}, ...body))));
      return r;
    }
    /* Payments Pending: the counters of the beat's markets whose bills (all time) are not fully paid */
    function renderPending(r, who, item) {
      const info = h('div', { class: 'beatinfo' }, item('DSO', who), item('Beat', beatLabel(r.beat)));
      if (r.error) { out.replaceChildren(info, h('div', { class: 'msg bad' }, r.error)); return r; }
      const acc = counterBalances(), byMarket = {};
      Object.values(acc).forEach(c => { if (c.billed - c.received > 0.005) (byMarket[c.market] = byMarket[c.market] || []).push(c); });
      const list = [];
      (r.rows || []).forEach(x => (byMarket[x.market] || []).sort((a, b) => a.name.localeCompare(b.name)).forEach(c => list.push(c)));
      if (!list.length) { out.replaceChildren(info, h('p', { class: 'hint' }, 'No counter in this beat has a payment pending.')); return r; }
      out.replaceChildren(info, h('div', { class: 'tablewrap' }, h('table', { class: 'beat' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Market'), h('th', {}, 'Counter'), h('th', { class: 'c' }, 'Bill Value'), h('th', { class: 'c' }, 'Payment Received'), h('th', { class: 'c' }, 'Payment Pending'))),
        h('tbody', {}, ...list.map(c => h('tr', {}, h('td', {}, c.market), h('td', { class: 'wrap' }, c.name), h('td', { class: 'c' }, inr0(c.billed)), h('td', { class: 'c' }, inr0(c.received)),
          h('td', { class: 'c p-red' }, inr0(c.billed - c.received))))))));
      return r;
    }
    if (sel) sel.addEventListener('change', () => { lastDso = sel.value; load(lastDso); });
    const beatLabel = b => { const o = [...beatSel.options].find(x => x.value === b); return o && b ? o.textContent : (b || '–'); };
    beatSel.addEventListener('change', () => load(lastDso));
    detSel.addEventListener('change', () => load(lastDso));
    main.append(h('section', { class: 'card' }, h('h3', {}, title), sel ? field('DSO', sel) : null, beatSel ? field('Beat', beatSel) : null, field('Details', detSel), out));
    load('');
    currentView = { onData() { if (beatDay !== U.todayIso() || !beatSel.value) { fillBeats(); load(lastDso); } },
                    tick() { if (beatDay !== U.todayIso()) { fillBeats(); load(lastDso); } } };     // after midnight: the new day's beat
  }


  /* ------------------------------------------------------------------ Attendance ("Working Today"), Check Out ("End Day") and the day's PDF (DSO / Manager) */
  const isFieldRole = () => !!S.profile && (S.profile.position === 'DSO' || S.profile.position === 'Manager');
  S.day = store.get('day', null);
  function day() {                                               // today's attendance + the summaries of today's entries, in order
    const t = U.todayIso();
    if (!S.day || S.day.date !== t || S.day.who !== S.profile.name) { S.day = { date: t, who: S.profile.name, in: '', out: '', entries: [], serverText: '' }; save('day'); }
    const a = S.snapshot && S.snapshot.attendance;               // what the server knows (e.g. after a reinstall, or another phone)
    if (a && a.date === t) {
      let ch = false;
      if (a.in && !S.day.in) { S.day.in = a.in; ch = true; }
      if (a.beat && !S.day.beat) { S.day.beat = a.beat; ch = true; }
      if (a.out && !S.day.out) { S.day.out = a.out; ch = true; }
      if (a.summary && !S.day.serverText) { S.day.serverText = a.summary; S.day.serverTimes = a.times || ''; S.day.serverLocs = a.locs || ''; ch = true; }
      if (a.inLoc && !S.day.inLoc) { S.day.inLoc = a.inLoc; ch = true; }
      if (a.outLoc && !S.day.outLoc) { S.day.outLoc = a.outLoc; ch = true; }
      if (ch) save('day');
    }
    return S.day;
  }
  const calBeat = iso => ((RD.data && RD.data.cal) || {})[iso] || model.beatForDate(iso) || '';
  function beatFor(iso) { if (isFieldRole()) { const d = day(); if (d.date === iso && d.beat) return d.beat; } return calBeat(iso); }
  const dayKey = () => (isFieldRole() ? [day().date, !!day().in, !!day().out].join('|') : '');
  const canWork = () => !isFieldRole() || (!!day().in && !day().out);
  const nowTime = () => new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase();
  const dmyFull = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? m[3] + '/' + m[2] + '/' + m[1] : ''; };
  /* today's orders per person – what the server knew at the last sync + what this phone made since – for "Order No." and "Daily Cumulative" */
  S.ord = store.get('ord', null);
  function ordersOf(who, iso) {
    const k = norm(who), out = {};
    const sv = S.snapshot && S.snapshot.ordersToday;
    if (sv && sv.date === iso) Object.assign(out, (sv.byName || {})[k] || {});
    if (S.ord && S.ord.date === iso) Object.assign(out, (S.ord.byName || {})[k] || {});
    return out;
  }
  function nextOrderNo(who, iso) {                               // same rule as the server: d/m/yy-Name-N, N = next free
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso), pre = (+m[3]) + '/' + (+m[2]) + '/' + m[1].slice(2) + '-' + who + '-';
    const used = Object.keys(ordersOf(who, iso)).filter(n => n.toLowerCase().indexOf(pre.toLowerCase()) === 0);
    const top = used.reduce((a, n) => Math.max(a, +n.slice(pre.length) || 0), 0);
    return pre + (Math.max(top, used.length) + 1);
  }
  function noteOrder(who, no, value) {
    const iso = U.todayIso();
    if (!S.ord || S.ord.date !== iso) S.ord = { date: iso, byName: {} };
    const k = norm(who); (S.ord.byName[k] || (S.ord.byName[k] = {}))[no] = value; save('ord');
  }
  function noteDayOrder(types) { if (!isFieldRole()) return; const d = day(); (d.orders || (d.orders = [])).push(types); save('day'); }
  function noteDayPay(pays) { if (!isFieldRole()) return; const d = day(); (d.pays || (d.pays = [])).push(pays.map(p => ({ mode: p.mode, amount: p.amount }))); save('day'); }
  /* "Day End Order Report" – the exact figures come from the server (they include anything the Head logged for this person);
     without internet: this phone's own entries today + the month so far as of the last sync */
  const WEEKDAYS = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
  const beatDay = b => { const m = /^([A-Za-z]{3})_(\d+)$/.exec(sval(b)); return m ? (WEEKDAYS[m[1].toLowerCase()] || m[1]) + ' ' + m[2] : (sval(b) || '-'); };
  function localTotals(d) {
    const types = {}, pay = {}; let orderToday = 0, payToday = 0;
    const ents = d.entries.filter(e => e.form);
    const ordersL = ents.length ? ents.map(e => e.types || {}) : (d.orders || []), paysL = ents.length ? ents.map(e => e.pays || []) : (d.pays || []);
    ordersL.forEach(t => Object.keys(t).forEach(k => { types[k] = (types[k] || 0) + t[k]; orderToday += t[k]; }));
    paysL.forEach(list => list.forEach(p => { pay[p.mode] = (pay[p.mode] || 0) + p.amount; payToday += p.amount; }));
    const mb = S.snapshot && S.snapshot.monthBefore && S.snapshot.monthBefore.date === d.date ? S.snapshot.monthBefore : { orders: 0, payments: 0 };
    return { types, orderToday, orderMonthBefore: mb.orders || 0, pay, payToday, payMonthBefore: mb.payments || 0, beat: model.beatForDate(d.date) };
  }
  function dayReportText(name, d, t) {
    const r0 = x => Math.round(x), types = Object.keys(t.types || {}).filter(k => t.types[k]).sort((a, b) => a.localeCompare(b));
    const modes = ['Cash', 'UPI', 'Cheque', 'Card'].filter(m => t.pay && t.pay[m]);
    return ['***** *_DAY END_* *****', '',
      '** _*ORDER REPORT*_ **',
      'Name: ' + name, 'Beat day: ' + beatDay(d.beat || t.beat || calBeat(d.date)), 'Date: ' + dmyFull(d.date),
      ...types.map(k => '_' + k + ' Value_: ' + money(r0(t.types[k]))),
      '*Total Value*: ' + money(r0(t.orderToday)), '*_Cumulative Value_*: ' + money(r0(t.orderMonthBefore + t.orderToday)),
      '', '** *_PAYMENT REPORT_* **',
      ...modes.map(m => '_' + m + '_: ' + money(t.pay[m])),
      '*Total Value*: ' + money(t.payToday), '_*Cumulative Value*_: ' + money(t.payMonthBefore + t.payToday)].join('\n');
  }
  /* the Head's own list of today's entries (As DSO / As Manager), for "Previous Entries" – no attendance, kept per day */
  const isHeadUser = () => !!S.profile && S.profile.position === 'Head of Operations';
  S.hday = store.get('hday', null);
  function headDay() {
    const t = U.todayIso();
    if (!S.hday || S.hday.date !== t || S.hday.who !== S.profile.name) { S.hday = { date: t, who: S.profile.name, entries: [] }; save('hday'); }
    return S.hday;
  }
  const entryDay = () => (isFieldRole() ? day() : headDay());
  const entryList = () => (isFieldRole() ? day().entries : headDay().entries.filter(e => e.as === asRole));   // the Head: only the page he is on
  function addEntry(kind, text, loc, extra) {
    const head = isHeadUser() && (asRole === 'DSO' || asRole === 'Manager');
    if (!isFieldRole() && !head) return;
    const d = entryDay(); d.entries.push(Object.assign({ kind, time: nowTime(), text, loc: loc || Loc.value || '' }, head ? { as: asRole } : {}, extra || {})); save(head ? 'hday' : 'day');
  }
  function updateEntry(ent, job) {                                 // an edited entry keeps its place, time and location
    const d = entryDay(), i = d.entries.findIndex(e => e.id === ent.id); if (i < 0) return;
    d.entries[i] = Object.assign({}, d.entries[i], job.entry, { text: job.summary, edited: nowTime() }); save(isFieldRole() ? 'day' : 'hday');
  }
  const entryNo = ent => { const i = entryList().findIndex(e => e.id === ent.id); return i < 0 ? '' : String(i + 1); };
  function dayEntries(d) {                                       // [{kind, time, text, loc}] – this phone's list, else the copy saved on the server
    if (d.entries.length) return d.entries;
    return parseDayText(d.serverText, d.serverTimes, d.serverLocs);
  }
  function parseDayText(text, times, locs) {                     // 'Entry 1:\n…\n\nEntry 2:\n…' + 'Visit · 10:15 AM, …' + 'lat, lon | lat, lon' -> [{kind, time, text, loc}]
    if (!text) return [];
    const tl = String(times || '').split(/,\s*(?=[A-Za-z])/).filter(Boolean), ll = String(locs || '').split(/\s*\|\s*/);
    return text.split(/^Entry \d+:\s*$/m).map(x => x.trim()).filter(Boolean).map((t, i) => {
      const m = (tl[i] || '').split(/\s*·\s*/);
      return { kind: m[0] || (/^_?\*?Visit/.test(t) ? 'Visit' : 'Payment'), time: m[1] || '', text: t, loc: ll[i] && ll[i] !== '-' ? ll[i] : '' };
    });
  }
  const dayText = d => dayEntries(d).map((e, i) => 'Entry ' + (i + 1) + ':\n' + e.text).join('\n\n');
  const locText = l => (l ? String(l).trim() : 'not recorded');
  function locNow(ms) {                                          // the freshest location we can get within ms
    Loc.refresh();
    return new Promise(res => { const t0 = Date.now(), iv = setInterval(() => { if (!Loc.busy || Date.now() - t0 > ms) { clearInterval(iv); res(Loc.value || ''); } }, 250); });
  }

  function attendanceView() {
    if (!isFieldRole() || day().in) return home();
    const main = shell('Check In', home);
    Loc.refresh();
    const msg = msgBox();
    const btn = h('button', { class: 'btn big', onclick: mark }, 'Working Today');
    const dayLine = h('p', { class: 'dayline' });
    const drawLine = () => { const b = beatFor(day().date); dayLine.textContent = dmyFull(day().date) + ' · ' + (b || 'no beat in the Year Calendar'); };
    drawLine();
    main.append(h('section', { class: 'card' }, h('h3', {}, 'Check In'),
      h('div', { class: 'row-between beatrow' }, dayLine, h('button', { type: 'button', class: 'btn small gray', onclick: () => changeBeat(drawLine) }, 'Change Beat')),
      h('p', { class: 'hint' }, 'Tap “Working Today” to start your day. The time and your location are recorded, and Log Visits and Log Payments open.'),
      h('div', { class: 'submitbar' }, btn), msg));
    async function mark() {
      if (day().in) return home();
      btn.disabled = true; say(msg, 'Getting your location…');
      const loc = await locNow(6000);
      const d = day(), t = nowTime();
      d.in = t; d.inLoc = loc; save('day');
      submitJob({ id: U.uuid(), label: 'Attendance – Check In (' + t + ')', parts: [{ kind: 'attend', date: d.date, time: t, location: loc, beat: beatFor(d.date) }], overlay: null });
      U.toast('Check In: ' + t); home();
    }
    currentView = { onData() { if (day().in) home(); }, tick() { if (day().in || day().date !== U.todayIso()) home(); } };
  }

  /* "Previous Entries": today's entries on this phone – Entry n: Market - Counter, its kind, 👁 view (read only) and ✏ edit */
  const ICON_EYE = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  const ICON_PEN = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
  function iconOnly(svg, label, onclick, cls) { const b = h('button', { type: 'button', class: 'iconsq ' + (cls || ''), 'aria-label': label, title: label, onclick }); b.innerHTML = svg; return b; }
  const pencilBtn = onclick => iconOnly(ICON_PEN, 'Edit this entry', onclick, 'topedit');
  const editBar = (onSave, msg, onReset, onCancel) => h('div', { class: 'submitbar editbar' }, h('button', { class: 'btn big', onclick: onSave }, 'SAVE CHANGES'),
    h('button', { class: 'btn gray', onclick: () => { onReset(); window.scrollTo({ top: 0 }); U.toast('Back to how the entry was'); } }, 'Reset'), h('button', { class: 'btn gray', onclick: onCancel }, 'Cancel'), msg);
  function entriesView() {
    if (!canWork()) return home();
    const main = shell('Previous Entries', home);
    const list = entryList(), head = !isFieldRole();
    const pick = (t, k) => { const m = new RegExp('^' + k + ':\\s*(.+)$', 'm').exec(t || ''); return m ? m[1].trim() : ''; };
    if (!list.length) main.append(h('section', { class: 'card' }, h('p', { class: 'hint' }, head ? 'No entries yet today. Visits and payments you log on this page today appear here.' : 'No entries yet today. Visits and payments you submit today appear here.')));
    list.forEach((e, i) => {
      const open = m => (e.kind === 'Payment' ? payView : visitView)({ entry: e, mode: m });
      const title = 'Entry ' + (i + 1) + ': ' + (e.market || pick(e.text, 'Market')) + ' - ' + (e.counter || pick(e.text, 'Counter')) + (head && e.by ? ' (' + e.by + ')' : '');
      const cap = (e.cat || (e.kind === 'Payment' ? 'Payment without Visit' : 'Visit')) + (e.time ? ' · ' + e.time : '') + (e.edited ? ' · edited ' + e.edited : '');
      const eye = iconOnly(ICON_EYE, 'View', () => open('view')), pen = iconOnly(ICON_PEN, 'Edit', () => open('edit'));
      if (!e.form) eye.disabled = pen.disabled = true;               // entries brought back from the server after a reinstall
      main.append(h('div', { class: 'entrybox' }, h('div', { class: 'eb-text' }, h('b', {}, title), h('span', {}, cap)), h('div', { class: 'eb-acts' }, eye, pen)));
    });
    currentView = { onData() { if (!canWork()) home(); }, tick() { if (!canWork()) home(); } };
  }

  /* "Change Beat": pick a beat and see its markets; the chosen beat is used for the whole of TODAY only */
  function changeBeat(after) {
    const d = day(), cur = beatFor(d.date), cal = calBeat(d.date);
    const list = BEATS.slice(); if (cur && !list.includes(cur)) list.unshift(cur);
    const sel = h('select', { class: 'inp' }, h('option', { value: '' }, '---- Select ----'), ...list.map(b => h('option', { value: b }, b + (b === cal ? '  (Year Calendar)' : ''))));
    sel.value = cur;
    const mk = h('div', { class: 'beatmarkets' });
    const drawMk = () => {
      const ms = sel.value ? model.marketsFor(sel.value) : [];
      mk.replaceChildren(h('div', { class: 'lbl' }, sel.value ? 'Markets of ' + sel.value + (ms.length ? ' (' + ms.length + ')' : '') : 'Markets'),
        ms.length ? h('ol', { class: 'mklist' }, ...ms.map(m => h('li', {}, m))) : h('p', { class: 'hint' }, sel.value ? 'No markets are listed for this beat in your markets sheet.' : 'Select a beat to see its markets.'));
    };
    sel.addEventListener('change', drawMk); drawMk();
    const close = () => ov.remove();
    const save = () => {
      if (!sel.value) { U.toast('Select a beat.'); return; }
      const dd = day(); dd.beat = sel.value; store.set('day', dd); close(); after && after();
      U.toast('Today’s beat: ' + sel.value);
    };
    const ov = h('div', { class: 'modal', onclick: e => { if (e.target === ov) close(); } },
      h('div', { class: 'modal-box', role: 'dialog', 'aria-label': 'Change Beat' },
        h('div', { class: 'row-between modal-head' }, h('h2', {}, 'Change Beat'), h('button', { class: 'x', onclick: close, 'aria-label': 'Close' }, '✕')),
        h('div', { class: 'modal-body' }, field('Beat', sel), mk,
          h('p', { class: 'hint' }, 'The beat you choose is used for the whole of today only. Tomorrow goes back to the Year Calendar.'),
          h('div', { class: 'submitbar' }, h('button', { type: 'button', class: 'btn big', onclick: save }, 'Set as today’s beat'), h('button', { type: 'button', class: 'btn gray', onclick: close }, 'Cancel')))));
    document.body.append(ov);
  }

  function checkoutView() {
    if (!isFieldRole() || !day().in || day().out) return home();
    const main = shell('Check Out', home);
    Loc.refresh();
    const msg = msgBox(), d = day(), n = dayEntries(d).length;
    const endBtn = h('button', { class: 'btn big red', onclick: () => { endBtn.hidden = true; ask.hidden = false; } }, 'End Day');
    const ask = h('div', { class: 'confirm', hidden: true },
      h('p', {}, h('b', {}, 'Are you sure?'), ' After ending the day you cannot log any more visits or payments today.'),
      h('div', { class: 'submitbar' }, h('button', { class: 'btn big red', onclick: end }, 'Yes, End Day'), h('button', { class: 'btn gray', onclick: () => { ask.hidden = true; endBtn.hidden = false; } }, 'Cancel')));
    main.append(h('section', { class: 'card' }, h('h3', {}, 'Check Out'),
      h('div', { class: 'daystats' }, h('div', {}, h('small', {}, 'Check In'), h('b', {}, d.in)), h('div', {}, h('small', {}, 'Entries today'), h('b', {}, String(n)))),
      h('p', { class: 'hint' }, 'Tap “End Day” when your work is over. A PDF of all today’s entries is made, ready to share.'),
      h('div', { class: 'submitbar' }, endBtn), ask, msg));
    async function end() {
      const d = day(); if (d.out) return daySummaryView();
      ask.querySelectorAll('button').forEach(b => { b.disabled = true; }); say(msg, 'Ending the day…');
      const loc = await locNow(6000), t = nowTime();
      d.out = t; d.outLoc = loc; save('day');
      const list = dayEntries(d);
      submitJob({ id: U.uuid(), label: 'Check Out (' + t + ')', parts: [{ kind: 'checkout', date: d.date, time: t, location: loc, entries: list.length, summary: dayText(d),
        times: list.map(e => [e.kind, e.time].filter(Boolean).join(' · ')), locs: list.map(e => e.loc || '') }], overlay: null });
      daySummaryView();
    }
    currentView = { onData() { if (day().out) home(); }, tick() { if (day().date !== U.todayIso()) home(); } };
  }

  /* the day's points for the map: Check In, Entry 1 … n, Check Out (only those with a usable "lat, lon") */
  function parseLatLon(l) { const m = /(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/.exec(String(l || '')); if (!m) return null; const la = +m[1], lo = +m[2]; return Math.abs(la) <= 90 && Math.abs(lo) <= 180 && (la || lo) ? { lat: la, lon: lo, approx: /approx/i.test(l) } : null; }
  function dayPoints(dy) {
    const pts = [];
    const add = (label, l, kind) => { const p = parseLatLon(l); if (p) pts.push(Object.assign({ label, kind }, p)); };
    add('Check In', dy.inLoc, 'in');
    dy.list.forEach((e, i) => add('Entry ' + (i + 1), e.loc, 'entry'));
    add('Check Out', dy.outLoc, 'out');
    return pts;
  }
  /* lays the points out in a w x h box (equal scale on both axes, like a map) -> {pins:[{x,y,…}], ticksX, ticksY} – used for the PDF and the screen */
  function mapLayout(pts, w, h, pad) {
    if (!pts.length) return null;
    const lat0 = pts.reduce((a, p) => a + p.lat, 0) / pts.length, k = Math.cos(lat0 * Math.PI / 180);
    let x0 = Math.min(...pts.map(p => p.lon * k)), x1 = Math.max(...pts.map(p => p.lon * k)), y0 = Math.min(...pts.map(p => p.lat)), y1 = Math.max(...pts.map(p => p.lat));
    const min = 0.002;                                            // at least ~200 m across, so one spot does not fill the page
    if (x1 - x0 < min) { const c = (x0 + x1) / 2; x0 = c - min / 2; x1 = c + min / 2; }
    if (y1 - y0 < min) { const c = (y0 + y1) / 2; y0 = c - min / 2; y1 = c + min / 2; }
    const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b, inset = 26, sc = Math.min((iw - 2 * inset) / (x1 - x0), (ih - 2 * inset) / (y1 - y0));   // pins stay off the frame
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const X = lonk => pad.l + iw / 2 + (lonk - cx) * sc, Y = lat => pad.t + ih / 2 - (lat - cy) * sc;   // y grows downwards (screen)
    const pins = pts.map(p => Object.assign({}, p, { x: X(p.lon * k), y: Y(p.lat) }));
    // labels: to the right of the pin (left near the right edge), pushed down when they would overlap an earlier label
    const placed = [];
    pins.forEach(p => {
      const lw = 112, lh = 24; let lx = p.x + 9 + lw > pad.l + iw - 2 ? p.x - 9 - lw : p.x + 9, ly = p.y - lh / 2;
      for (let t = 0; t < 40 && placed.some(q => lx < q.x + q.w && lx + lw > q.x && ly < q.y + q.h && ly + lh > q.y); t++) ly += lh + 2;
      ly = Math.max(pad.t + 2, Math.min(pad.t + ih - lh - 2, ly));
      lx = Math.max(pad.l + 2, lx);
      placed.push({ x: lx, y: ly, w: lw, h: lh }); p.lx = lx; p.ly = ly; p.lw = lw; p.lh = lh;
    });
    const ticks = (a, b, n) => Array.from({ length: n + 1 }, (_, i) => a + (b - a) * i / n);
    const lonL = (pad.l - pad.l - iw / 2) / sc + cx, lonR = (iw / 2) / sc + cx, latT = cy + (ih / 2) / sc, latB = cy - (ih / 2) / sc;
    return { pins, pad, iw, ih, ticksX: ticks(lonL, lonR, 4).map(v => ({ x: X(v), v: v / k })), ticksY: ticks(latB, latT, 4).map(v => ({ y: Y(v), v })) };
  }
  const PIN = { in: '#0F7A55', entry: '#16306F', out: '#B42318' };
  const fmtLL = p => p.lat.toFixed(5) + ', ' + p.lon.toFixed(5) + (p.approx ? ' (approx)' : '');
  function mapSvg(dy) {                                          // the same picture on the screen
    const pts = dayPoints(dy), W = 400, H = 380, L = mapLayout(pts, W, H, { l: 70, r: 22, t: 10, b: 34 });
    const box = h('div', { class: 'daymap' });
    if (!L) { box.append(h('p', { class: 'hint' }, 'No locations were recorded today, so there is no map.')); return box; }
    const e = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    let svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Map of today's points"><rect x="${L.pad.l}" y="${L.pad.t}" width="${L.iw}" height="${L.ih}" fill="#F4F7FC" stroke="#CBD5E1"/>`;
    L.ticksX.forEach(t => { svg += `<line x1="${t.x}" y1="${L.pad.t}" x2="${t.x}" y2="${L.pad.t + L.ih}" stroke="#E2E8F0"/><text x="${t.x}" y="${H - 14}" font-size="11" text-anchor="middle" fill="#64748B">${t.v.toFixed(4)}</text>`; });
    L.ticksY.forEach(t => { svg += `<line x1="${L.pad.l}" y1="${t.y}" x2="${L.pad.l + L.iw}" y2="${t.y}" stroke="#E2E8F0"/><text x="${L.pad.l - 6}" y="${t.y + 4}" font-size="11" text-anchor="end" fill="#64748B">${t.v.toFixed(4)}</text>`; });
    svg += `<text x="${L.pad.l + L.iw / 2}" y="${H - 2}" font-size="11" text-anchor="middle" fill="#64748B">Longitude</text><text x="9" y="${L.pad.t + L.ih / 2}" font-size="11" text-anchor="middle" fill="#64748B" transform="rotate(-90 9 ${L.pad.t + L.ih / 2})">Latitude</text>`;
    if (L.pins.length > 1) svg += `<polyline points="${L.pins.map(p => p.x + ',' + p.y).join(' ')}" fill="none" stroke="#94A3B8" stroke-width="1.5" stroke-dasharray="5 4"/>`;
    L.pins.forEach(p => { svg += `<line x1="${p.x}" y1="${p.y}" x2="${p.lx < p.x ? p.lx + p.lw : p.lx}" y2="${p.ly + p.lh / 2}" stroke="#CBD5E1"/>`; });
    L.pins.forEach(p => { svg += `<circle cx="${p.x}" cy="${p.y}" r="6" fill="${PIN[p.kind]}" stroke="#fff" stroke-width="2"/>`; });
    L.pins.forEach(p => { svg += `<rect x="${p.lx}" y="${p.ly}" width="${p.lw}" height="${p.lh}" rx="4" fill="#fff" fill-opacity=".92" stroke="${PIN[p.kind]}" stroke-width=".8"/><text x="${p.lx + 5}" y="${p.ly + 10}" font-size="10" font-weight="700" fill="${PIN[p.kind]}">${e(p.label)}</text><text x="${p.lx + 5}" y="${p.ly + 20}" font-size="9" fill="#334155">${e(fmtLL(p))}</text>`; });
    box.innerHTML = svg + '</svg>';
    return box;
  }

  function daySummaryView() {
    if (!isFieldRole() || !day().out) return home();
    const main = shell('Today’s Summary', home);
    const d = day(), list = dayEntries(d), title = S.profile.name + '’s work on ' + dmyFull(d.date);
    const dy = { date: d.date, in: d.in, out: d.out, inLoc: d.inLoc || '', outLoc: d.outLoc || '', list, role: S.profile.title || S.profile.position };
    const fname = S.profile.name + "'s work on " + dmyFull(d.date).replace(/\//g, '-') + '.pdf';
    const shareBtn = iconBtn('green', ICON_SHARE, 'Share PDF', share), dlBtn = h('button', { type: 'button', class: 'btn gray', onclick: download }, 'Download PDF');
    const status = h('p', { class: 'hint' }, 'Making the PDF…');
    shareBtn.disabled = dlBtn.disabled = true;
    main.append(h('section', { class: 'card' }, h('h3', {}, title),
        h('div', { class: 'daystats' }, h('div', {}, h('small', {}, 'Check In'), h('b', {}, d.in || '–')), h('div', {}, h('small', {}, 'Check Out'), h('b', {}, d.out)), h('div', {}, h('small', {}, 'Entries'), h('b', {}, String(list.length)))),
        h('p', { class: 'locline' }, 'Check In – Location: ' + locText(dy.inLoc)), h('p', { class: 'locline' }, 'Check Out – Location: ' + locText(dy.outLoc)),
        h('div', { class: 'summary-actions' }, shareBtn, dlBtn), status),
      h('section', { class: 'card' }, h('h3', {}, 'Today on the map'), mapSvg(dy)),
      ...(list.length ? list.map((e, i) => h('section', { class: 'card entry' }, h('div', { class: 'row-between' }, h('h3', {}, 'Entry ' + (i + 1) + ':'), h('small', { class: 'hint' }, [e.kind, e.time].filter(Boolean).join(' · '))),
                        h('p', { class: 'locline' }, 'Location: ' + locText(e.loc)), h('div', { class: 'entrytext' }, e.text.replace(/[_*]/g, ''))))
                  : [h('section', { class: 'card' }, h('p', { class: 'hint' }, 'No visits or payments were logged today.'))]));
    let blob = null;
    (async () => {                                               // the Day End report goes into the PDF, right after the map
      let note = '';
      if (d.report) dy.report = d.report;
      else {
        status.textContent = 'Preparing the Day End report…';
        const t0 = Date.now();
        while (S.outbox.length && Date.now() - t0 < 10000) { await sync(false); await new Promise(r => setTimeout(r, 600)); }   // today's entries go up first
        try {
          if (S.outbox.length) throw new Error('waiting');
          const r = await authed('day_report', { date: d.date });
          d.report = dy.report = dayReportText(S.profile.name, d, r); save('day');
        } catch (e) { dy.report = dayReportText(S.profile.name, d, localTotals(d)); note = '  (no connection – the Day End figures are from this phone; open this page again when online for the exact ones)'; }
      }
      status.textContent = 'Making the PDF…';
      blob = await makeWorkPdf(S.profile.name, title, null, [dy], true);
      shareBtn.disabled = dlBtn.disabled = false; status.textContent = 'PDF ready: ' + fname + note;
    })().catch(e => { status.textContent = e.message; status.className = 'hint bad'; });
    function share() { if (blob) sharePdf(blob, fname, title); }
    function download() { if (blob) downloadBlob(blob, fname); }
    currentView = { tick() { if (day().date !== U.todayIso()) home(); } };
  }

  function reportCard(d) {
    const box = h('textarea', { class: 'inp summary', readonly: true, rows: 16 }), note = h('p', { class: 'hint' }, 'Preparing the report…');
    let text = '';
    const copyBtn = iconBtn('', ICON_COPY, 'Copy', async () => { try { await navigator.clipboard.writeText(text); } catch (e) { box.select(); try { document.execCommand('copy'); } catch (e2) {} } U.toast('Copied'); });
    const shareBtn = iconBtn('green', ICON_SHARE, 'Share', async () => { if (navigator.share) { try { await navigator.share({ text }); } catch (e) {} } else { try { await navigator.clipboard.writeText(text); } catch (e) {} U.toast('Sharing is not available here – the text was copied instead.'); } });
    copyBtn.disabled = shareBtn.disabled = true;
    const show = (t, how) => { text = t; box.value = t; box.rows = Math.min(22, t.split('\n').length + 1); copyBtn.disabled = shareBtn.disabled = false; note.textContent = how; };
    if (d.report) show(d.report, '');
    else (async () => {
      const t0 = Date.now();
      while (S.outbox.length && Date.now() - t0 < 10000) { await sync(false); await new Promise(r => setTimeout(r, 600)); }   // today's entries go up first
      try {
        if (S.outbox.length) throw new Error('waiting');
        const r = await authed('day_report', { date: d.date });
        const t = dayReportText(S.profile.name, d, r); d.report = t; save('day'); show(t, '');
      } catch (e) { show(dayReportText(S.profile.name, d, localTotals(d)), 'No connection – these figures are from this phone. Open this page again when you are online for the exact report.'); }
    })();
    return h('section', { class: 'card' }, h('h3', {}, 'Day End Order Report'), box, h('div', { class: 'summary-actions' }, copyBtn, shareBtn), note);
  }

  /* "Generate Summary" (Head of Operations): one DSO's saved days between two dates, as one PDF (each date on its own page) */
  function rangeSummaryView() {
    if (!S.profile || S.profile.position !== 'Head of Operations') return home();
    const main = shell('Generate Summary', home);
    const msg = msgBox(), today = U.todayIso();
    const who = h('select', { class: 'inp' }, h('option', { value: '' }, 'Loading…'));
    const from = dateBox(today.slice(0, 8) + '01'), to = dateBox(today);
    from.max = to.max = today;
    const genBtn = h('button', { class: 'btn big', onclick: () => (kind.value === 'end' ? endDay() : generate()) }, 'Generate Summary');
    const result = h('div');
    const kind = h('select', { class: 'inp' }, h('option', { value: 'general' }, 'General Summary'), h('option', { value: 'end' }, 'End Day Summary'));
    const day1 = dateBox(today); day1.max = today;
    const rangeBox = h('div', {}, h('div', { class: 'grid2' }, field('Start date', from), field('End date', to)),
      h('p', { class: 'hint' }, 'Every day the DSO ended with Check Out is included, each on its own page, exactly like the day’s PDF.'));
    const dayBox = h('div', { hidden: true }, field('Date', day1),
      h('p', { class: 'hint' }, 'The Day End report of that day: the DSO’s orders and payments, and everyone’s month so far.'));
    kind.addEventListener('change', () => { const e = kind.value === 'end'; rangeBox.hidden = e; dayBox.hidden = !e; result.replaceChildren(); say(msg, ''); });
    main.append(h('section', { class: 'card' }, h('h3', {}, 'Generate Summary'),
      field('Summary', kind), field('DSO', who), rangeBox, dayBox,
      h('div', { class: 'submitbar' }, genBtn), msg), result);
    async function endDay() {
      if (busy) return;
      const name = who.value, iso = day1.get();
      result.replaceChildren();
      if (!name) return say(msg, 'Select the DSO.', true);
      if (!U.parseIso(iso)) return say(msg, 'Choose the date.', true);
      busy = true; genBtn.disabled = true; say(msg, 'Getting ' + name + '’s day…');
      try {
        let r;
        try { r = await authed('day_report', { dso: name, date: iso }); }
        catch (e) { throw new Error(e.offline ? 'No internet – the End Day Summary needs a connection.' : e.message); }
        say(msg, '');
        const card = reportCard({ date: iso, beat: r.beat, report: dayReportText(r.name || name, { date: iso, beat: r.beat }, r) });
        card.querySelector('h3').textContent = 'End Day Summary – ' + (r.name || name) + ', ' + dmyFull(iso);
        result.append(card);
      } catch (e) { say(msg, e.message, true); }
      finally { busy = false; genBtn.disabled = false; }
    }
    authed('day_summaries', {}).then(r => {
      const team = r.team || [];
      who.replaceChildren(h('option', { value: '' }, '---- Select ----'), ...team.map(n => h('option', { value: n }, n)));
      if (!team.length) say(msg, 'No DSO or Manager is registered under you yet.', true);
    }).catch(e => { who.replaceChildren(h('option', { value: '' }, '---- Select ----')); say(msg, e.offline ? 'No internet – the DSO list needs a connection.' : e.message, true); });
    let busy = false;
    async function generate() {
      if (busy) return;
      const name = who.value, a = from.get(), b = to.get();
      result.replaceChildren();
      if (!name) return say(msg, 'Select the DSO.', true);
      if (!U.parseIso(a) || !U.parseIso(b)) return say(msg, 'Choose the Start date and the End date.', true);
      if (a > b) return say(msg, 'The Start date is after the End date.', true);
      if (b > today) return say(msg, 'The End date cannot be in the future.', true);
      busy = true; genBtn.disabled = true; say(msg, 'Getting ' + name + '’s saved days…');
      try {
        let r;
        try { r = await authed('day_summaries', { dso: name, from: a, to: b }); }
        catch (e) { throw new Error(e.offline ? 'No internet – the summary needs a connection to read the saved days.' : e.message); }
        const nm = r.name || name;
        const list = (r.days || []).map(x => ({ date: x.date, role: x.position, in: x.in, out: x.out, inLoc: x.inLoc, outLoc: x.outLoc, list: parseDayText(x.summary, x.times, x.locs), noEnd: !x.out }));
        if (!list.length) { say(msg, nm + ' marked no attendance between ' + dmyFull(a) + ' and ' + dmyFull(b) + '.', true); return; }
        say(msg, 'Making the PDF…');
        const title = nm + '’s work from ' + dmyFull(a) + ' to ' + dmyFull(b);
        const fname = nm + "'s work from " + dmyFull(a).replace(/\//g, '-') + ' to ' + dmyFull(b).replace(/\//g, '-') + '.pdf';
        const blob = await makeWorkPdf(nm, title, { from: a, to: b }, list, false);
        const total = list.reduce((n, x) => n + x.list.length, 0);
        say(msg, '');
        result.append(h('section', { class: 'card' }, h('h3', {}, title),
          h('div', { class: 'daystats' }, h('div', {}, h('small', {}, 'Days'), h('b', {}, String(list.length))), h('div', {}, h('small', {}, 'Entries'), h('b', {}, String(total)))),
          h('div', { class: 'summary-actions' }, iconBtn('green', ICON_SHARE, 'Share PDF', () => sharePdf(blob, fname, title)), h('button', { type: 'button', class: 'btn gray', onclick: () => downloadBlob(blob, fname) }, 'Download PDF')),
          h('p', { class: 'hint' }, 'PDF ready: ' + fname),
          h('ul', { class: 'daylist' }, ...list.map(x => h('li', {}, h('b', {}, dmyFull(x.date)), ' – ' + x.list.length + (x.list.length === 1 ? ' entry' : ' entries') + (x.noEnd ? ' (day not ended)' : ''))))));
        result.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (e) { say(msg, e.message, true); }
      finally { busy = false; genBtn.disabled = false; }
    }
  }
  async function sharePdf(blob, fname, title) {
    const file = new File([blob], fname, { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title }); } catch (e) {} }
    else { downloadBlob(blob, fname); U.toast('Sharing is not available here – the PDF was downloaded instead.'); }
  }
  function downloadBlob(blob, fname) {
    const url = URL.createObjectURL(blob), a = h('a', { href: url, download: fname });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  /* PDF: made on the phone with pdf-lib (js/pdf-lib.min.js, loaded only when needed). The built-in PDF fonts have no ₹ sign, so amounts read "Rs." */
  let pdfLibP = null;
  function loadPdfLib() {
    if (window.PDFLib) return Promise.resolve(window.PDFLib);
    if (!pdfLibP) pdfLibP = new Promise((res, rej) => {
      const sc = h('script', { src: 'js/pdf-lib.min.js', 'data-quiet': '1' });
      sc.onload = () => (window.PDFLib ? res(window.PDFLib) : rej(new Error('The PDF maker did not load.')));
      sc.onerror = () => { pdfLibP = null; sc.remove(); rej(new Error('Could not load the PDF maker. Connect to the internet once and open this page again.')); };
      document.head.append(sc);
    });
    return pdfLibP;
  }
  const WINANSI = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
  const pdfSafe = t => String(t).replace(/₹\s?/g, 'Rs. ').replace(/[^\x20-\x7E\xA0-\xFF]/g, c => (WINANSI.indexOf(c) >= 0 ? c : c === '\t' ? ' ' : '?'));
  /* name: whose work. days: [{date, role, in, out, inLoc, outLoc, list:[{kind, time, text, loc}], noEnd}].
     range: null for one day's PDF, {from, to} for "Generate Summary". withMap: the day-end PDF gets the map of the day's points.
     Every day is laid out the same way: "<Name>'s work on <date>", Check In / Check Out (+ Location), Entries, the map (day-end only), then Entry 1:, Entry 2: … */
  async function makeWorkPdf(name, title, range, days, withMap) {
    const { PDFDocument, StandardFonts, rgb } = await loadPdfLib();
    const doc = await PDFDocument.create();
    doc.setTitle(pdfSafe(title)); doc.setAuthor(pdfSafe(name)); doc.setCreator('ProMandi'); doc.setProducer('ProMandi');
    const reg = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold), boldIt = await doc.embedFont(StandardFonts.HelveticaBoldOblique);
    const green = rgb(0.0, 0.42, 0.18);                            // deep green: the "Daily Cumulative" amount
    const W = 595.28, H = 841.89, M = 50, FS = 11, LH = 15.5, navy = rgb(0.086, 0.188, 0.435), ink = rgb(0.1, 0.12, 0.18), muted = rgb(0.38, 0.42, 0.5), line = rgb(0.85, 0.88, 0.93), gold = rgb(0.66, 0.46, 0.03);
    const hex = c => rgb(parseInt(c.slice(1, 3), 16) / 255, parseInt(c.slice(3, 5), 16) / 255, parseInt(c.slice(5, 7), 16) / 255);
    let page, y;
    const newPage = () => { page = doc.addPage([W, H]); y = H - M; };
    const need = hgt => { if (y - hgt < M + 20) newPage(); };
    function runs(raw) {                                           // WhatsApp *bold* / _*bold*_ -> [{t, b}]
      const dc = /^_\*(Daily Cumulative:)\*_\s*(.*)$/.exec(raw);    // "Daily Cumulative:" bold + its amount deep green, bold, italic
      if (dc) return [{ t: pdfSafe(dc[1]), b: true }, { t: ' ', b: false }, { t: pdfSafe(dc[2]), b: true, g: true }];
      const l = raw.replace(/^_(\*[^*]+\*)_$/, '$1');
      const out = []; let b = false;
      l.split('*').forEach((part, i) => { if (i) b = !b; if (part) out.push({ t: pdfSafe(part.replace(/^_|_$/g, '')), b }); });
      return out.length ? out : [{ t: '', b: false }];
    }
    function drawRich(raw, x, size, color) {                       // word-wrapped, keeps bold parts
      const words = []; runs(raw).forEach(r => r.t.split(/(\s+)/).forEach(w => { if (w) words.push({ t: w, b: r.b, g: r.g }); }));
      const maxW = W - M - x; let lineW = 0, cur = [];
      const fontOf = w => (w.g ? boldIt : w.b ? bold : reg);
      const flush = () => { need(LH); let cx = x; cur.forEach(w => { const f = fontOf(w); page.drawText(w.t, { x: cx, y: y - size, size, font: f, color: w.g ? green : w.b ? navy : color }); cx += f.widthOfTextAtSize(w.t, size); }); y -= LH; cur = []; lineW = 0; };
      words.forEach(w => {
        const f = fontOf(w), ww = f.widthOfTextAtSize(w.t, size);
        if (lineW + ww > maxW && cur.length && w.t.trim()) flush();
        if (!cur.length && !w.t.trim()) return;
        cur.push(w); lineW += ww;
      });
      if (cur.length) flush();
    }
    const txt = (t, x, size, font, color) => page.drawText(pdfSafe(t), { x, y: y - size, size, font, color });
    function drawMap(dy) {                                         // the day's points as a graph: pins + "Check In", "Entry 1" … + lat, lon
      const pts = dayPoints(dy), MW = W - 2 * M, MH = 290;
      need(MH + 30);
      txt('Today on the map', M, 12, bold, navy); y -= 18;
      const top = y, L = mapLayout(pts, MW, MH, { l: 58, r: 10, t: 10, b: 30 });
      const P = (x, yy) => ({ x: M + x, y: top - yy });            // layout (y down) -> PDF (y up)
      page.drawRectangle({ x: M, y: top - MH, width: MW, height: MH, borderColor: line, borderWidth: 0.8 });
      if (!L) { txt('No locations were recorded on this day.', M + 12, 10, reg, muted); y = top - MH - 14; return; }
      const a = P(L.pad.l, L.pad.t);
      page.drawRectangle({ x: a.x, y: a.y - L.ih, width: L.iw, height: L.ih, color: rgb(0.957, 0.969, 0.988), borderColor: rgb(0.8, 0.84, 0.88), borderWidth: 0.6 });
      L.ticksX.forEach(t => { const p = P(t.x, 0); page.drawLine({ start: { x: p.x, y: a.y }, end: { x: p.x, y: a.y - L.ih }, thickness: 0.4, color: line }); const s = t.v.toFixed(4); page.drawText(s, { x: p.x - reg.widthOfTextAtSize(s, 7) / 2, y: a.y - L.ih - 10, size: 7, font: reg, color: muted }); });
      L.ticksY.forEach(t => { const p = P(0, t.y); page.drawLine({ start: { x: a.x, y: p.y }, end: { x: a.x + L.iw, y: p.y }, thickness: 0.4, color: line }); const s = t.v.toFixed(4); page.drawText(s, { x: a.x - 4 - reg.widthOfTextAtSize(s, 7), y: p.y - 2.5, size: 7, font: reg, color: muted }); });
      page.drawText('Longitude', { x: a.x + L.iw / 2 - 18, y: top - MH + 4, size: 7.5, font: reg, color: muted });
      page.drawText('Latitude', { x: M + 9, y: a.y - L.ih / 2 - 14, size: 7.5, font: reg, color: muted, rotate: { type: 'degrees', angle: 90 } });
      for (let i = 1; i < L.pins.length; i++) { const p0 = P(L.pins[i - 1].x, L.pins[i - 1].y), p1 = P(L.pins[i].x, L.pins[i].y); page.drawLine({ start: p0, end: p1, thickness: 1, color: rgb(0.58, 0.64, 0.72), dashArray: [4, 3] }); }
      L.pins.forEach(p => { const c = P(p.x, p.y), q = P(p.lx < p.x ? p.lx + p.lw : p.lx, p.ly + p.lh / 2); page.drawLine({ start: c, end: q, thickness: 0.5, color: rgb(0.8, 0.84, 0.88) }); });
      L.pins.forEach(p => { const c = P(p.x, p.y); page.drawCircle({ x: c.x, y: c.y, size: 4.5, color: hex(PIN[p.kind]), borderColor: rgb(1, 1, 1), borderWidth: 1.5 }); });
      L.pins.forEach(p => {
        const b = P(p.lx, p.ly);
        page.drawRectangle({ x: b.x, y: b.y - p.lh, width: p.lw, height: p.lh, color: rgb(1, 1, 1), opacity: 0.92, borderColor: hex(PIN[p.kind]), borderWidth: 0.6 });
        page.drawText(pdfSafe(p.label), { x: b.x + 4, y: b.y - 9.5, size: 8, font: bold, color: hex(PIN[p.kind]) });
        page.drawText(pdfSafe(fmtLL(p)), { x: b.x + 4, y: b.y - 19.5, size: 7, font: reg, color: ink });
      });
      y = top - MH - 16;
    }
    function drawReport(text) {                                   // the Day End report (the WhatsApp text, set out for print)
      const rows = text.split('\n');
      need(LH * 6);
      page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: line }); y -= 14;
      rows.forEach(raw => {
        const c = raw.replace(/[*_]/g, '').replace(/\s+/g, ' ').trim();
        if (!c) { y -= LH * 0.5; return; }
        if (/^(DAY END|ORDER REPORT|PAYMENT REPORT)$/i.test(c)) { need(LH * 2); txt(c === 'DAY END' ? 'Day End Report' : c.charAt(0) + c.slice(1).toLowerCase().replace(/report$/, 'Report'), M, c === 'DAY END' ? 14 : 12, bold, navy); y -= c === 'DAY END' ? 22 : 18; return; }
        const i = c.indexOf(':'), label = i < 0 ? c : c.slice(0, i + 1), val = i < 0 ? '' : c.slice(i + 1).trim();
        need(LH);
        const strong = /\*/.test(raw), cum = /cumulative/i.test(label);
        const lf = strong ? bold : reg; txt(label, M + 12, FS, lf, strong ? navy : ink);
        const vx = M + 12 + lf.widthOfTextAtSize(pdfSafe(label), FS) + 5;
        if (val) txt(val, vx, FS, cum ? boldIt : strong ? bold : reg, cum ? green : ink);
        y -= LH;
      });
      y -= 6; need(14); page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1.2, color: navy }); y -= 16;
    }
    const heading = (text, size) => { txt(text, M, size, bold, navy); y -= size + 10; };
    function drawDay(dy, size, map) {
      heading(name + '’s work on ' + dmyFull(dy.date), size);
      txt([dy.role || S.profile.title || S.profile.position, 'Entries: ' + dy.list.length].join('   |   '), M, 10, reg, muted); y -= 15;
      txt('Check In: ' + (dy.in || '-'), M, 10, bold, ink); txt('Location: ' + locText(dy.inLoc), M + 150, 10, reg, ink); y -= 14;
      txt('Check Out: ' + (dy.out || '-'), M, 10, bold, ink); txt('Location: ' + locText(dy.outLoc), M + 150, 10, reg, ink); y -= 12;
      page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1.2, color: navy }); y -= 16;
      if (dy.noEnd) { txt('This day was not ended with Check Out.', M, 10, bold, gold); y -= 20; }
      if (map) drawMap(dy);
      if (dy.report) drawReport(dy.report);
      if (!dy.list.length) { txt('No visits or payments were logged on this day.', M, FS, reg, ink); y -= LH; }
      dy.list.forEach((e, i) => {
        need(LH * 5);
        txt('Entry ' + (i + 1) + ':', M, 13, bold, navy);
        const tag = pdfSafe([e.kind, e.time].filter(Boolean).join('  -  '));
        if (tag) page.drawText(tag, { x: W - M - reg.widthOfTextAtSize(tag, 9.5), y: y - 12, size: 9.5, font: reg, color: muted });
        y -= 21;
        drawRich('*Location:* ' + locText(e.loc), M + 12, FS, ink);
        e.text.split('\n').forEach(l => { if (!l.trim()) { y -= LH * 0.5; return; } drawRich(l, M + 12, FS, ink); });
        y -= 6;
        if (i < dy.list.length - 1) { need(14); page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: line }); y -= 14; }
      });
    }
    newPage();
    if (!range) drawDay(days[0], 20, !!withMap);
    else {
      const total = days.reduce((n, x) => n + x.list.length, 0);
      heading(title, 20);
      txt([days[0].role || '', 'Days: ' + days.length, 'Entries: ' + total].filter(Boolean).join('   |   '), M, 10, reg, muted); y -= 14;
      page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1.2, color: navy }); y -= 16;
      days.forEach(dy => {                                       // contents: one line per day
        need(LH);
        txt(dmyFull(dy.date) + '   -   Check In: ' + (dy.in || '-') + '   Check Out: ' + (dy.out || '-') + '   Entries: ' + dy.list.length + (dy.noEnd ? '   (not ended)' : ''), M, FS, reg, ink); y -= LH;
      });
      days.forEach(dy => { newPage(); drawDay(dy, 18, false); });   // every date on its own page(s)
    }
    const pages = doc.getPages(), foot = pdfSafe('ProMandi  -  ' + title);
    pages.forEach((p, i) => {
      const pn = 'Page ' + (i + 1) + ' of ' + pages.length;
      p.drawText(foot, { x: M, y: 28, size: 8.5, font: reg, color: muted });
      p.drawText(pn, { x: W - M - reg.widthOfTextAtSize(pn, 8.5), y: 28, size: 8.5, font: reg, color: muted });
    });
    return new Blob([await doc.save()], { type: 'application/pdf' });
  }

  /* ------------------------------------------------------------------ "Logged by" (Head of Operations only): whose name the entry is stored under */
  function loggedByBox(onChange) {
    let last = ''; try { last = localStorage.getItem('pa_loggedby') || ''; } catch (e) {}
    const inp = h('input', { class: 'inp', type: 'text', value: last, placeholder: 'Name of the person', autocapitalize: 'words', autocomplete: 'off', maxlength: 40 });
    const get = () => inp.value.replace(/\s+/g, ' ').trim();
    inp.addEventListener('change', () => { try { localStorage.setItem('pa_loggedby', get()); } catch (e) {} onChange && onChange(); });
    return { field: field('Logged by', inp, 'bigl'), get, set: v => { inp.value = v || ''; } };
  }

  /* ------------------------------------------------------------------ DSO: visit */
  function visitView(opts) {
    const ent = (opts && opts.entry) || null, mode = ent ? (opts.mode || 'view') : 'new';   // 'new' | 'view' (read only) | 'edit'
    const remote = !!(ent && ent.remote);                          // the Head opening anyone's entry from "Previous Entries"
    if (!canWork() || (ent && !ent.form)) return home();
    const main = shell(mode === 'new' ? 'Log Visits' : (mode === 'view' ? 'Entry ' : 'Edit Entry ') + (remote ? ent.no : entryNo(ent)), remote ? () => headEntriesView() : ent ? entriesView : home,
      mode === 'view' ? pencilBtn(() => visitView({ entry: ent, mode: 'edit' })) : null);
    Loc.refresh();
    const msg = msgBox(), isHead = S.profile.position === 'Head of Operations';
    const by = isHead ? loggedByBox(() => { market.set(''); counter.set(''); counterChanged(); }) : null;
    if (isHead) sync(true);                                       // fresh "today's orders" of everyone: right Order No. and Daily Cumulative for the "Logged by" person
    const dsoName = () => (isHead ? by.get() : (S.profile.dso || S.profile.name));
    let outBeat = false, calBeat = '';
    const date = { get: () => (remote ? ent.date : U.todayIso()) };   // no Date box: today's (an entry opened by the Head: its own day)
    const beatEl = h('input', { class: 'inp', readonly: true, placeholder: 'Beat' });
    const outTick = h('input', { type: 'checkbox' });
    const market = new Combo({ placeholder: 'Market', values: () => (outBeat ? model.sheetMarkets() : isHead ? model.marketsOf(by.get(), beatEl.value || calBeat) : model.marketsFor(beatEl.value || calBeat)), onInput: () => counterChanged(), onChange: () => { counter.set(''); counterChanged(); } });
    const counter = new Combo({ placeholder: 'Counter', values: () => model.countersFor(market.get()), onInput: () => counterChanged(), onChange: () => counterChanged() });
    const cd = new CounterDetails(model, true);
    const remarks = new Combo({ placeholder: 'Remarks (type or pick)', values: () => REMARKS, onInput: () => prio() });
    remarks.el.classList.add('dark');                                // black box, white text
    const prioEl = h('div', { class: 'hint' });
    const cooler = h('select', { class: 'inp' }, h('option', { value: '' }, '---- Select ----'), h('option', { value: 'Yes' }, 'Yes'), h('option', { value: 'No' }, 'No'));
    const counterCode = () => { const c = model.findCounter(market.get(), counter.get()); return c ? c.code : (clean(counter.get()) && clean(market.get()) ? U.counterCode(clean(market.get()), clean(counter.get())) : ''); };
    let terms, termsField;
    const area = new ProductRows({ model, rateFn: (code, key) => model.rateFor(code, key), codeFn: counterCode, emptyText: 'No product added. Tap “＋ Add Product” to start the order (leave it empty for a visit without an order).', totalLabel: 'Total Order Amount', onChange: () => termsUpdate() });
    terms = h('select', { class: 'inp dark' }, h('option', { value: '' }, '---- Select ----'), ...TERMS.map(t => h('option', { value: t }, t)));
    termsField = field('Payment Terms', terms, 'bigl');
    const pay = new PaymentRows();
    const counterChanged = () => { cd.update(market.get(), counter.get()); area.refreshRates(); if (counter.get()) Loc.get(); };
    function termsUpdate() { if (!termsField) return; termsField.hidden = !area.rows.length || area.cancelled; if (termsField.hidden) terms.value = ''; }
    function syncBeat() {
      const d = date.get(), b = remote && ent.form.beat ? ent.form.beat : U.parseIso(d) ? beatFor(d) : '';
      if (b !== calBeat) { calBeat = b; outBeat = false; outTick.checked = false; beatEl.value = b; market.set(''); counter.set(''); counterChanged(); }
      prio();
    }
    function prio() {
      const days = REMARK_DAYS[norm(remarks.get())], d = date.get();
      prioEl.textContent = days && U.parseIso(d) ? '→ Priority Visit Date: ' + U.dmy(U.addDays(d, days)) : '';
    }
    outTick.addEventListener('change', () => { outBeat = outTick.checked; beatEl.value = outBeat ? '' : calBeat; market.set(''); counter.set(''); counterChanged(); });
    const sections = [
      h('section', { class: 'card' }, h('h3', {}, 'Visit'), by ? by.field : null,
        field("Beat (today's)", h('div', { class: 'beatbox' }, beatEl, h('label', { class: 'tick' }, outTick, ' Out of Beat'))),
        field('Market', market.el), field('Counter', counter.el), cd.el,
        field('Remarks', remarks.el), prioEl, field('Interest in Cooler', cooler, 'bigl')),
      h('section', { class: 'card' }, h('h3', {}, 'Order – products, quantity and rate'), area.el, termsField),
      h('section', { class: 'card' }, h('h3', {}, 'Payment received'), pay.el)];
    if (mode === 'view') { const fs = h('fieldset', { class: 'ro' }, ...sections); fs.disabled = true; main.append(fs); }
    else main.append(...sections, mode === 'edit' ? editBar(submit, msg, () => visitView({ entry: ent, mode: 'edit' }), remote ? () => headEntriesView() : () => entriesView()) : submitBar('SUBMIT VISIT', submit, () => clearForm(true), msg));
    termsUpdate(); syncBeat();
    if (ent) {                                                     // reopen the entry as it was saved
      const f = ent.form;
      if (by && f.by) by.set(f.by);
      if (f.outBeat) { outTick.checked = true; outBeat = true; beatEl.value = ''; }
      market.set(f.market); counter.set(f.counter); counterChanged(); remarks.set(f.remarks || ''); prio(); cooler.value = f.cooler || '';
      (f.lines || []).forEach(l => area.addRow(false, { type: l.type, item: l.item, sub: l.sub, colour: l.colour, qty: l.qty, price: l.rate }));
      termsUpdate(); terms.value = f.terms || '';
      (f.pays || []).forEach(p => { pay.addRow(false); const r = pay.rows[pay.rows.length - 1]; r.amt.value = String(p.amount); r.fill(); r.mode.value = p.mode; });
      pay.update();
    }
    currentView = { onData() { syncBeat(); area.refreshRates(); counterChanged(); }, tick: syncBeat };     // tick: a new day starts -> its beat

    function clearForm() {
      market.set(''); counter.set(''); remarks.set(''); cooler.value = ''; cd.reset(); area.clear(); terms.value = ''; pay.reset(); counterChanged(); prio(); termsUpdate();
    }
    function submit() {
      if (!canWork()) { say(msg, day().out ? 'You have ended your day – no more visits can be logged today.' : 'Check In first.', true); return; }
      [market, counter, remarks, cd.typeCombo].forEach(c => c.commit()); area.commitAll();
      const job = tryRun(build, msg); if (!job) return;
      submitJob(job);
      if (job.order && !remote) noteOrder(job.order.who, job.order.no, job.order.value);
      if (ent && !remote && ent.orderNo && (!job.order || job.order.no !== ent.orderNo)) noteOrder(dsoName(), ent.orderNo, 0);   // the order was removed in the edit
      if (remote) { remoteSaved(ent, job); return; }
      if (ent) { updateEntry(ent, job); entriesView(); submitted(() => showSummary(job.summary)); return; }
      addEntry('Visit', job.summary, job.loc, job.entry);
      say(msg, '');
      submitted(() => showSummary(job.summary));
      clearForm(); window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    function build() {
      const ds = needIso(date.get());
      if (isHead && !by.get()) throw new Error('Enter “Logged by” – the name of the person who made this visit.');
      const dso = dsoName();
      const beat = outBeat ? '' : clean(beatEl.value);
      if (!beat && !outBeat) throw new Error('No beat found for this date (the Year Calendar has not loaded, or the date is outside it).\nCheck the date, or connect to the internet, wait for the sync and try again.');
      const mk = clean(market.get()).toUpperCase(), cname = clean(counter.get());
      if (!mk) throw new Error('Enter the Market.'); if (!cname) throw new Error('Enter the Counter.');
      const lines = area.lines();
      const tm = lines.length ? terms.value : '';
      if (lines.length && !tm) throw new Error('This order has products but no Payment terms.\nSelect the Payment terms (COD, 15, 30 or 45 Days).');
      if (!cooler.value) throw new Error('Select Interest in Cooler (Yes or No).');
      let rem = clean(remarks.get()); rem = REMARKS.find(x => x.toLowerCase() === rem.toLowerCase()) || rem;
      const pdays = REMARK_DAYS[norm(rem)] || 0;
      const pays = pay.payments();
      const existing = model.findCounter(mk, cname);
      const code = existing ? existing.code : U.counterCode(mk, cname), name = existing ? existing.name : cname;
      const { mobile, ctype, gstin, fill, replace } = cd.resolve(existing);
      const newMarket = !isHead && beat && !model.marketsFor(beat).some(m => m.toUpperCase() === mk) && (model.dsoMarkets || {})[beat.toLowerCase()] ? { beat, market: mk } : null;
      const orders = [];
      let ono = '', orderTotal = 0, cumulative = 0;
      const entryId = ent ? ent.id : U.uuid();
      if (lines.length) {
        const total = lines.reduce((a, l) => a + l.qty * l.rate, 0);
        const keep = ent && ent.orderNo && (!remote || ent.orderNo.toLowerCase().indexOf('-' + dso.toLowerCase() + '-') > 0);
        ono = keep ? ent.orderNo : remote ? nextNo(dso, ds, ent.dayOrders) : nextOrderNo(dso, ds); orderTotal = roundRupee(total);      // an edited order keeps its Order No.
        const others = remote ? (norm(dso) === norm(ent.form.by) ? Object.assign({}, ent.dayOrders || {}) : {}) : ordersOf(dso, ds); delete others[ono];
        cumulative = Object.values(others).reduce((a, v) => a + (+v || 0), 0) + orderTotal;
        const nd = TERM_DAYS[tm] ? U.addDays(ds, TERM_DAYS[tm]) : '';
        const wk = nd ? (model.beatForDate(nd) || U.weekday(nd)) : '';
        lines.forEach(l => orders.push({ dso, 'entry id': entryId, 'order no.': ono, 'orders taken': lines.length, 'order value': roundRupee(total), 'counter name': name, 'market code': marketCodeOf(mk), 'counter code': code, date: ds, 'payment terms': tm, 'next payment date': nd, weekday: wk, type: l.type, item: l.item, 'sub item': l.sub, colour: l.colour, qty: l.qty, price: plain(l.rate), 'price x qty': plain(U.mul(l.qty, l.rate)) }));
      }
      const visit = { dso, 'entry id': entryId, 'logged by': isHead ? dso : '', date: ds, beat, market: mk, 'counter name': name, 'counter code': code, mobile, 'counter type': ctype, 'gstin/pan': gstin, orders: lines.length, productive: lines.length ? 'YES' : 'NO', remarks: rem, 'interest in cooler': cooler.value, 'priority visit date': pdays ? U.addDays(ds, pdays) : '', location: ent ? (ent.loc || '') : Loc.get() };
      const parts = [];
      if (ent) parts.push({ kind: 'replace_entry', id: entryId, date: ds });       // the server swaps the old rows for these
      if (fill && Object.keys(fill).length) parts.push({ kind: 'fill', code, values: fill, replace });
      parts.push({ sheet: 'Visits', rows: [visit] });
      if (newMarket) parts.push({ kind: 'market', beat: newMarket.beat, market: newMarket.market });
      if (orders.length) parts.push({ sheet: 'Orders', rows: orders });
      if (pays.length) {
        const row = { date: ds, 'entry id': entryId, market: mk, 'counter name': name, 'counter code': code, total: plain(pays.reduce((a, p) => a + p.amount, 0)) };
        if (isHead) { row['received by'] = dso; row['logged by'] = dso; }
        pays.forEach(p => { row[p.mode.toLowerCase()] = plain(p.amount); });
        parts.push({ sheet: 'Payments Received', rows: [row] });
      }
      const label = name + (orders.length ? '  |  order ₹' + roundRupee(orders[0]['order value']).toLocaleString('en-IN') : '');
      const sum = ['_*Visit:*_', 'Date: ' + dmyShort(ds), 'Beat: ' + (outBeat ? 'Out of Beat' : beat), 'Market: ' + mk, 'Counter: ' + name,
                   'Mobile No.: ' + (mobile || 'None'), 'GSTIN/PAN: ' + (gstin || 'None'), 'Remarks: ' + (rem || 'None'), 'Interest in Cooler: ' + cooler.value];
      if (lines.length) {
        sum.push('', '_*Orders:*_', 'Order No.: ' + ono);
        lines.forEach(l => {
          sum.push([l.item, l.sub].map(x => sval(x)).filter(Boolean).join(' '));
          if (sval(l.colour) && sval(l.colour).toUpperCase() !== 'N/A') sum.push(sval(l.colour));
          sum.push(l.qty + ' pc. @ ' + money(l.rate));
        });
        sum.push('*Order Value:* ' + money(orderTotal), '_*Daily Cumulative:*_ ' + money(cumulative), 'Payment Terms: ' + tm);
      }
      if (pays.length) sum.push('', '_*Payments:*_', ...payText(pays));
      const types = {}; lines.forEach(l => { const t = sval(l.type) || 'Other'; types[t] = (types[t] || 0) + l.qty * l.rate; });
      const cat = lines.length && pays.length ? 'Order and Payment' : lines.length ? 'Order on Visit' : pays.length ? 'Payment on Visit' : 'Visit only';
      const entry = { id: entryId, cat, market: mk, counter: name, orderNo: ono, types, pays, by: isHead ? dso : '',
        form: { by: isHead ? dso : '', outBeat, market: mk, counter: name, remarks: rem, cooler: cooler.value, lines: lines.map(l => ({ type: l.type, item: l.item, sub: l.sub, colour: l.colour, qty: l.qty, rate: l.rate })), terms: tm, pays } };
      return { id: U.uuid(), label, summary: sum.join('\n'), parts, entry, loc: visit.location || '', pays: pays.length ? pays : null, order: ono ? { who: dso, no: ono, value: orderTotal, types } : null,
        overlay: { visit, orders, newCounter: existing ? null : { market: mk, name, code, mobile, type: ctype, gstin }, newMarket: newMarket ? { beat, market: mk } : null, fill: fill && Object.keys(fill).length ? Object.assign({ code, replace }, fill) : null } };
    }
  }

  /* ------------------------------------------------------------------ DSO: payment */
  function payView(opts) {
    const ent = (opts && opts.entry) || null, mode = ent ? (opts.mode || 'view') : 'new';
    const remote = !!(ent && ent.remote);
    if (!canWork() || (ent && !ent.form)) return home();
    const main = shell(mode === 'new' ? 'Log Payments' : (mode === 'view' ? 'Entry ' : 'Edit Entry ') + (remote ? ent.no : entryNo(ent)), remote ? () => headEntriesView() : ent ? entriesView : home,
      mode === 'view' ? pencilBtn(() => payView({ entry: ent, mode: 'edit' })) : null);
    Loc.refresh();
    const msg = msgBox(), isHead = S.profile.position === 'Head of Operations';
    const by = isHead ? loggedByBox() : null;
    const date = { get: () => (remote ? ent.date : U.todayIso()) };
    const info = h('div', { class: 'hint' });
    const market = new Combo({ placeholder: 'Market', strict: true, values: () => model.allMarkets(), onChange: () => { counter.set(''); upd(); } });
    const counter = new Combo({ placeholder: 'Counter', strict: true, values: () => model.countersFor(market.get()), onChange: upd });
    const pay = new PaymentRows();
    function upd() {
      const c = model.findCounter(market.get(), counter.get());
      info.textContent = c ? `Code ${c.code}   |   Mobile No.: ${c.mobile || 'not on file'}   |   Counter type: ${c.type || 'not on file'}` : '';
    }
    function clearForm() { market.set(''); counter.set(''); pay.reset(); upd(); }
    const sections = [h('section', { class: 'card' }, h('h3', {}, 'Counter'), by ? by.field : null, field('Market', market.el), field('Counter', counter.el), info),
      h('section', { class: 'card' }, h('h3', {}, 'Payment received'), pay.el)];
    if (mode === 'view') { const fs = h('fieldset', { class: 'ro' }, ...sections); fs.disabled = true; main.append(fs); }
    else main.append(...sections);
    if (ent) {
      if (by && ent.form.by) by.set(ent.form.by);
      market.set(ent.form.market); counter.set(ent.form.counter); upd();
      (ent.form.pays || []).forEach(p => { pay.addRow(false); const r = pay.rows[pay.rows.length - 1]; r.amt.value = String(p.amount); r.fill(); r.mode.value = p.mode; });
      pay.update();
    }
    currentView = { onData: upd };
    if (mode === 'view') return;
    const submitPay = () => {
        if (!canWork()) { say(msg, day().out ? 'You have ended your day – no more payments can be logged today.' : 'Check In first.', true); return; }
        [market, counter].forEach(c => c.commit());
        const job = tryRun(() => {
          const ds = needIso(date.get()), mk = clean(market.get()).toUpperCase();
          if (isHead && !by.get()) throw new Error('Enter “Logged by” – the name of the person who received this payment.');
          if (!mk) throw new Error('Select the Market.');
          if (!clean(counter.get())) throw new Error('Select the Counter.');
          const c = model.findCounter(mk, counter.get());
          if (!c) throw new Error('Pick the Counter from the list (a payment can only be logged for an existing counter).');
          const pays = pay.payments();
          if (!pays.length) throw new Error('No payment added.\nTap “＋ Payment”, enter the amount and select the payment mode.');
          const total = pays.reduce((a, p) => a + p.amount, 0);
          const entryId = ent ? ent.id : U.uuid();
          const row = { date: ds, 'entry id': entryId, market: mk, 'counter name': c.name, 'counter code': c.code, total: plain(total) };
          if (isHead) { row['received by'] = by.get(); row['logged by'] = by.get(); }
          pays.forEach(p => { row[p.mode.toLowerCase()] = plain(p.amount); });
          const summary = ['_*Details:*_', 'Date: ' + dmyShort(ds), 'Market: ' + mk, 'Counter: ' + c.name, '', '_*Payments:*_', ...payText(pays), '*Total:* ' + money(total)].join('\n');
          const parts = ent ? [{ kind: 'replace_entry', id: entryId, date: ds }] : [];
          parts.push({ sheet: 'Payments Received', rows: [row] });
          const pb = isHead ? by.get() : '';
          const entry = { id: entryId, cat: 'Payment without Visit', market: mk, counter: c.name, pays, types: {}, by: pb, form: { by: pb, market: mk, counter: c.name, pays } };
          return { id: U.uuid(), label: c.name + '  |  payment ₹' + roundRupee(total).toLocaleString('en-IN'), summary, parts, entry, overlay: null, pays };
        }, msg);
        if (!job) return;
        submitJob(job);
        if (remote) { remoteSaved(ent, job); return; }
        if (ent) { updateEntry(ent, job); entriesView(); submitted(() => showSummary(job.summary)); return; }
        addEntry('Payment', job.summary, Loc.get(), job.entry);
        say(msg, '');
        submitted(() => showSummary(job.summary)); clearForm();
    };
    main.append(mode === 'edit' ? editBar(submitPay, msg, () => payView({ entry: ent, mode: 'edit' }), remote ? () => headEntriesView() : () => entriesView()) : submitBar('SUBMIT PAYMENT', submitPay, clearForm, msg));
  }

  /* ------------------------------------------------------------------ Accountant */
  function inwardView() {
    const main = shell('Log Inward Invoices', home), msg = msgBox();
    const date = dateBox(U.todayIso());
    const invNo = h('input', { class: 'inp', placeholder: 'Invoice No.', autocomplete: 'off', autocapitalize: 'characters' });
    const disc = discountBox();
    const area = new ProductRows({ model, rateFn: (c, k) => model.buyRateFor(c, k), emptyText: 'No product added. Tap “＋ Add Product” to start the inward invoice.', totalLabel: 'Total Inward Amount' });
    const clear = () => { area.clear(); invNo.value = ''; disc.value = ''; };
    main.append(h('section', { class: 'card' }, h('h3', {}, 'Inward invoice'), h('div', { class: 'grid2' }, field('Date', date), field('Invoice Number', invNo))),
      h('section', { class: 'card' }, h('h3', {}, 'Products – quantity and buy price'), area.el),
      h('section', { class: 'card' }, h('h3', {}, 'Cash discount %'), field('Cash discount % (numbers only, e.g. 2.5)', disc)),
      submitBar('SUBMIT INWARD INVOICE', () => {
        area.commitAll();
        const job = tryRun(() => {
          const ds = needIso(date.get()), no = clean(invNo.value);
          if (!no) throw new Error('Enter the Invoice Number.');
          if (Object.keys(model.inwardInvoices).some(k => norm(k) === norm(no))) throw new Error('Inward invoice ' + no + ' already exists.\nUse Edit Previous Invoice → Inward to change it.');
          const d = discountOf(disc), lines = area.lines();
          if (!lines.length) throw new Error('Add at least one product.');
          const rows = inwardRows(ds, no, d, lines);
          const total = lines.reduce((a, l) => a + l.qty * l.rate, 0);
          return { id: U.uuid(), label: 'inward invoice ' + no + '  |  ₹' + roundRupee(total).toLocaleString('en-IN'), parts: [{ sheet: 'Inwards', rows }],
                   overlay: { inwards: rows, inwardInvoice: { no, data: inwardData(ds, d, lines) } } };
        }, msg);
        if (!job) return;
        submitJob(job); say(msg, ''); submitted(); clear();
      }, clear, msg));
    currentView = { onData() { area.refreshRates(); } };
  }

  const invoiceRow = (ds, ino, orderNo, mk, cname, code, mobile, gstin, billing, ln) => {
    const r = { date: ds, 'invoice no.': ino, 'order no.': orderNo, market: mk, 'counter name': cname, 'counter code': code, mobile, 'gstin/pan': gstin };
    if (ln) Object.assign(r, { 'billing value': billing, type: ln.type, item: ln.item, 'sub item': ln.sub, colour: ln.colour, qty: ln.qty, price: plain(ln.rate), 'price x qty (for sum ref)': plain(U.mul(ln.qty, ln.rate)) });
    return r;
  };

  function outwardView() {
    const main = shell('Log Outward Invoices', home), msg = msgBox();
    const date = dateBox(U.todayIso(), () => invChanged());
    const serial = h('input', { class: 'inp', inputmode: 'numeric', placeholder: 'Serial No.', autocomplete: 'off' });
    const invNo = h('input', { class: 'inp', readonly: true, placeholder: 'Invoice Number' });
    const market = new Combo({ placeholder: 'Market', strict: true, values: () => model.everyMarket(), onChange: () => { counter.set(''); counterChanged(); } });
    const counter = new Combo({ placeholder: 'Counter', strict: true, values: () => model.countersFor(market.get()), onChange: () => counterChanged() });
    const cd = new CounterDetails(model, false);
    const code = () => { const c = model.findCounter(market.get(), counter.get()); return c ? c.code : ''; };
    const area = new ProductRows({ model, rateFn: (c, k) => model.rateFor(c, k), codeFn: code, emptyText: 'No product added. Tap “＋ Add Product” to start the invoice.', totalLabel: 'Total Invoice Amount' });
    function invChanged() { const sr = serial.value.trim(), d = date.get(); invNo.value = /^\d+$/.test(sr) && +sr > 0 && U.parseIso(d) ? U.invoiceNo(sr, d) : ''; }
    function counterChanged() { cd.update(market.get(), counter.get()); area.refreshRates(); }
    serial.addEventListener('input', invChanged);
    const clear = () => { serial.value = ''; market.set(''); counter.set(''); cd.reset(); area.clear(); invChanged(); };
    main.append(h('section', { class: 'card' }, h('h3', {}, 'Outward invoice'),
      h('div', { class: 'grid2' }, field('Date', date), field('Serial Number', serial)), field('Invoice Number', invNo), field('Market', market.el), field('Counter', counter.el), cd.el),
      h('section', { class: 'card' }, h('h3', {}, 'Invoice – products, quantity and rate'), area.el),
      submitBar('SUBMIT INVOICE', () => {
        [market, counter].forEach(c => c.commit()); area.commitAll();
        const job = tryRun(() => {
          const ds = needIso(date.get()), sr = serial.value.trim();
          if (!/^\d+$/.test(sr) || +sr === 0) throw new Error('Enter the Serial Number (digits only).');
          const ino = U.invoiceNo(sr, ds);
          if (Object.keys(model.invoices).some(k => k.toLowerCase() === ino.toLowerCase())) throw new Error(`Invoice ${ino} already exists in the Invoice Record.\nCheck the Serial Number (use Edit Previous Invoice to change an existing invoice).`);
          const mk = clean(market.get()).toUpperCase();
          if (!mk) throw new Error('Select the Market.');
          const c = model.findCounter(mk, counter.get());
          if (!c) throw new Error('Select the Counter from the list (it must be a counter of this market).');
          const lines = area.lines();
          if (!lines.length) throw new Error('Add at least one product.');
          const { mobile, gstin, fill, replace } = cd.resolve(c);
          const billing = roundRupee(lines.reduce((a, l) => a + l.qty * l.rate, 0));
          const rows = lines.map(l => invoiceRow(ds, ino, '', mk, c.name, c.code, mobile, gstin, billing, l));
          const data = { date: ds, orderNo: '', market: mk, counterName: c.name, counterCode: c.code, mobile, gstin, lines: lines.map(l => ({ type: l.type, item: l.item, sub: l.sub, colour: l.colour, qty: l.qty, price: plain(l.rate) })) };
          const parts = []; const hasFill = fill && Object.keys(fill).length;
          if (hasFill) parts.push({ kind: 'fill', code: c.code, values: fill, replace });
          parts.push({ sheet: 'Invoice Record', rows });
          return { id: U.uuid(), label: `${ino}  |  ${c.name}  |  ₹${billing.toLocaleString('en-IN')}`, parts, overlay: { invoice: { no: ino, data }, fill: hasFill ? Object.assign({ code: c.code, replace }, fill) : null } };
        }, msg);
        if (!job) return;
        submitJob(job); say(msg, ''); submitted(); clear();
      }, clear, msg));
    invChanged();
    currentView = { onData() { counterChanged(); } };
  }

  /* Cash discount %: numbers only (a typed % sign is removed); empty = 0 */
  function discountBox() {
    const i = h('input', { class: 'inp', inputmode: 'decimal', placeholder: '0', autocomplete: 'off' });
    i.addEventListener('input', () => { let v = i.value.replace(/[^\d.]/g, ''); const k = v.indexOf('.'); if (k >= 0) v = v.slice(0, k + 1) + v.slice(k + 1).replace(/\./g, ''); if (v !== i.value) i.value = v; });
    return i;
  }
  function discountOf(i) {
    const t = i.value.trim(); if (!t) return 0;
    const v = Number(t);
    if (!isFinite(v) || v < 0 || v >= 100) throw new Error('Cash discount % must be a number from 0 to 99.99 (e.g. 2.5).');
    return Math.round(v * 100) / 100;
  }
  const inwardRows = (ds, no, d, lines) => lines.map(l => ({ date: ds, 'invoice no.': no, type: l.type, item: l.item, 'sub-item': l.sub, colour: l.colour, 'inwards qty': l.qty,
    'buy price': plain(l.rate), 'qty x price': plain(U.mul(l.qty, l.rate)), 'discount %': d,
    'after discount': plain(Math.round(l.qty * l.rate * (100 - d)) / 100) }));        // qty x price with the cash discount taken off
  const inwardData = (ds, d, lines) => ({ date: ds, discount: d, lines: lines.map(l => ({ type: l.type, item: l.item, sub: l.sub, colour: l.colour, qty: l.qty, price: plain(l.rate) })) });

  function editView(opts) {                                      // opts (the Head's "Previous Entries"): {type: 'outward'|'inward', no, mode: 'view'|'edit', n}
    const o = opts || null;
    const main = o ? shell((o.mode === 'view' ? 'Entry ' : 'Edit Entry ') + o.n, () => headEntriesView(), o.mode === 'view' ? pencilBtn(() => editView(Object.assign({}, o, { mode: 'edit' }))) : null)
                   : shell('Edit Previous Invoice', home), msg = msgBox();
    const typeSel = h('select', { class: 'inp' }, h('option', { value: '' }, '---- Select ----'), h('option', { value: 'inward' }, 'Inward'), h('option', { value: 'outward' }, 'Outward'));
    const outBox = h('div', { hidden: true }), inBox = h('div', { hidden: true });
    const after = o ? () => headEntriesView() : null;
    if (o && o.mode === 'view') { const fs = h('fieldset', { class: 'ro' }, h('section', { class: 'card' }, field('Choose Type', typeSel)), outBox, inBox); fs.disabled = true; main.append(fs, msg); }
    else main.append(h('section', { class: 'card' }, field('Choose Type', typeSel)), msg, outBox, inBox);
    typeSel.addEventListener('change', () => { outBox.hidden = typeSel.value !== 'outward'; inBox.hidden = typeSel.value !== 'inward'; say(msg, ''); });
    const views = [outwardEdit(outBox, msg, after), inwardEdit(inBox, msg, after)];
    if (o) { typeSel.value = o.type; typeSel.disabled = true; outBox.hidden = o.type !== 'outward'; inBox.hidden = o.type !== 'inward'; views[o.type === 'outward' ? 0 : 1].open(o.no); if (o.mode === 'view') main.querySelectorAll('.submitbar').forEach(x => x.remove()); }
    currentView = { onData() { views.forEach(v => v && v.onData && v.onData()); } };
  }

  /* EDIT an INWARD invoice: type its Invoice Number -> date (read only), products and cash discount can be changed */
  function inwardEdit(box, msg, after) {
    const invNo = h('input', { class: 'inp', placeholder: 'Invoice No.', autocomplete: 'off', autocapitalize: 'characters' });
    const note = h('div', { class: 'hint' }, 'Type the Invoice Number of the inward invoice.');
    const dateRo = h('input', { class: 'inp', readonly: true });
    const disc = discountBox();
    const area = new ProductRows({ model, rateFn: () => [null, ''], showReset: false, emptyText: 'No product on this invoice.', totalLabel: 'Total Inward Amount' });
    let current = null;
    const resetBtn = h('button', { class: 'btn small gray', onclick: () => { if (current) load(current); } }, 'Reset');
    const detail = h('div', { hidden: true },
      h('section', { class: 'card' }, h('h3', {}, 'Invoice Date (read only)'), dateRo),
      h('section', { class: 'card' }, h('div', { class: 'row-between' }, h('h3', {}, 'Products – change, add or remove'), resetBtn), area.el),
      h('section', { class: 'card' }, h('h3', {}, 'Cash discount %'), field('Cash discount % (numbers only, e.g. 2.5)', disc)),
      submitBar('SUBMIT CHANGES', submit, () => { invNo.value = ''; lookup(); }, h('span')));
    box.append(h('section', { class: 'card' }, h('h3', {}, 'Find the inward invoice'), field('Invoice Number', invNo), note), detail);
    function lookup() {
      const t = norm(invNo.value);
      if (!t) { current = null; detail.hidden = true; note.textContent = 'Type the Invoice Number of the inward invoice.'; note.className = 'hint'; return; }
      const no = Object.keys(model.inwardInvoices).find(k => norm(k) === t);
      if (!no) { current = null; detail.hidden = true; note.textContent = 'No inward invoice with this number was found.'; note.className = 'hint bad'; return; }
      if (no !== current) load(no);
    }
    function load(no) {
      const w = model.inwardInvoices[no]; current = no;
      dateRo.value = U.dmy(w.date); disc.value = w.discount ? String(w.discount) : '';
      area.clear(); (w.lines || []).forEach(l => area.addRow(false, l));
      note.textContent = 'Invoice found. Change the products or the cash discount below.'; note.className = 'hint ok'; say(msg, '');
      detail.hidden = false;
    }
    function submit() {
      area.commitAll();
      const job = tryRun(() => {
        if (!current) throw new Error('Type the Invoice Number of an existing inward invoice first.');
        const w = model.inwardInvoices[current], d = discountOf(disc), lines = area.lines();
        if (!lines.length) throw new Error('Add at least one product.');
        const total = lines.reduce((a, l) => a + l.qty * l.rate, 0);
        return { id: U.uuid(), label: 'edited inward ' + current + '  |  ₹' + roundRupee(total).toLocaleString('en-IN'),
          parts: [{ kind: 'inward_edit', invoice: current, rows: inwardRows(w.date, current, d, lines) }],
          overlay: { inwards: inwardRows(w.date, current, d, lines), inwardInvoice: { no: current, data: inwardData(w.date, d, lines) } } };
      }, msg);
      if (!job) return;
      submitJob(job); say(msg, ''); submitted(after);
      if (after) return;
      invNo.value = ''; lookup();
    }
    invNo.addEventListener('input', lookup);
    return { onData() { if (!current) lookup(); }, open(no) { invNo.value = no; invNo.readOnly = true; lookup(); } };
  }

  /* EDIT an OUTWARD invoice (Invoice Record) */
  function outwardEdit(box, msg, after) {
    const serial = h('input', { class: 'inp', inputmode: 'numeric', placeholder: 'Serial No.', autocomplete: 'off' });
    const invNo = h('input', { class: 'inp', readonly: true, placeholder: 'Invoice Number' });
    const note = h('div', { class: 'hint' }, 'Type the Serial Number of the invoice.');
    const detail = h('div', { hidden: true });
    const ro = {}; const detailGrid = h('div', { class: 'grid2' });
    [['date', 'Date'], ['market', 'Market'], ['counter', 'Counter'], ['mobile', 'Mobile No.'], ['gstin', 'GSTIN/PAN']].forEach(([k, t]) => { ro[k] = h('input', { class: 'inp', readonly: true }); detailGrid.append(field(t, ro[k])); });
    const cancelBox = h('input', { type: 'checkbox' });
    let current = null, hdr = null;
    const area = new ProductRows({ model, rateFn: () => [null, ''], showReset: false, emptyText: 'No product on this invoice.', totalLabel: 'Total Invoice Amount' });
    const resetBtn = h('button', { class: 'btn small gray', onclick: () => { if (current) load(current); } }, 'Reset');
    cancelBox.addEventListener('change', () => area.setCancelled(cancelBox.checked));
    detail.append(h('section', { class: 'card' }, h('h3', {}, 'Invoice details (read only)'), detailGrid, h('label', { class: 'tick' }, cancelBox, ' Cancelled')),
      h('section', { class: 'card' }, h('div', { class: 'row-between' }, h('h3', {}, 'Products – change, add or remove'), resetBtn), area.el),
      submitBar('SUBMIT CHANGES', submit, () => { serial.value = ''; lookup(); }, h('span')));
    function unload() { current = hdr = null; detail.hidden = true; }
    function lookup() {
      const raw = serial.value.trim();
      if (!/^\d+$/.test(raw) || +raw === 0) { unload(); invNo.value = ''; note.textContent = raw ? 'The Serial Number is digits only.' : 'Type the Serial Number of the invoice.'; note.className = 'hint'; return; }
      const n = +raw, today = U.invoiceNo(n, U.todayIso());
      const cands = Object.keys(model.invoices).filter(k => new RegExp(`^IS/${n}/\\d\\d-\\d\\d$`, 'i').test(k));
      const no = cands.find(k => k.toLowerCase() === today.toLowerCase()) || cands.sort().pop();
      invNo.value = no || today;
      if (!no) { unload(); note.textContent = 'No outward invoice with this number was found.'; note.className = 'hint bad'; }
      else if (no !== current) load(no);
    }
    function load(no) {
      const inv = model.invoices[no]; current = no; hdr = inv;
      ro.date.value = U.dmy(inv.date); ro.market.value = inv.market; ro.counter.value = inv.counterName; ro.mobile.value = inv.mobile; ro.gstin.value = inv.gstin;
      cancelBox.checked = false; area.setCancelled(false); area.clear();
      inv.lines.forEach(l => area.addRow(false, l));
      cancelBox.checked = !inv.lines.length; area.setCancelled(cancelBox.checked);
      note.textContent = 'Invoice found. Change the products below, or tick Cancelled.'; note.className = 'hint ok'; say(msg, '');
      detail.hidden = false;
    }
    function submit() {
      area.commitAll();
      const job = tryRun(() => {
        if (!current) throw new Error('Type the Serial Number of an existing outward invoice first.');
        const lines = area.lines(), inv = hdr;
        const mk = [inv.date, current, inv.orderNo, inv.market, inv.counterName, inv.counterCode, inv.mobile, inv.gstin];
        let rows, billing = 0;
        if (lines.length) { billing = roundRupee(lines.reduce((a, l) => a + l.qty * l.rate, 0)); rows = lines.map(l => invoiceRow(...mk, billing, l)); }
        else rows = [invoiceRow(...mk)];
        const data = Object.assign({}, inv, { lines: lines.map(l => ({ type: l.type, item: l.item, sub: l.sub, colour: l.colour, qty: l.qty, price: plain(l.rate) })) });
        return { id: U.uuid(), label: `edited ${current}  |  ${inv.counterName}  |  ` + (lines.length ? '₹' + billing.toLocaleString('en-IN') : 'cancelled / no products'),
          parts: [{ kind: 'invoice_edit', invoice: current, rows }], overlay: { invoice: { no: current, data } } };
      }, msg);
      if (!job) return;
      submitJob(job); say(msg, ''); submitted(after);
      if (after) return;
      serial.value = ''; lookup();
    }
    serial.addEventListener('input', lookup);
    box.append(h('section', { class: 'card' }, h('h3', {}, 'Find the invoice'), h('div', { class: 'grid2' }, field('Serial Number', serial), field('Invoice Number', invNo)), note), detail);
    return { onData() { if (!current) lookup(); }, open(no) { serial.value = String(no).split('/')[1] || ''; serial.readOnly = true; invNo.value = no; if (model.invoices[no]) load(no); } };
  }

  /* ------------------------------------------------------------------ the Head's "Previous Entries": anyone's entries (DSO, Manager, Accountant) on any day */
  const HE = { team: null, role: 'DSO', name: '', date: '', list: null, err: '' };
  function nextNo(who, iso, have) {                              // the next free Order No. of 'who' on 'iso', given that day's orders
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso), pre = (+m[3]) + '/' + (+m[2]) + '/' + m[1].slice(2) + '-' + who + '-';
    const used = Object.keys(have || {}).filter(n => n.toLowerCase().indexOf(pre.toLowerCase()) === 0);
    return pre + (used.reduce((a, n) => Math.max(a, +n.slice(pre.length) || 0), 0) + 1);
  }
  function remoteSaved(ent, job) {                               // the Head edited someone's entry: update the list shown, back to it
    if (HE.list) {
      const i = HE.list.findIndex(e => e.id === ent.id);
      if (i >= 0) {
        const e = Object.assign({}, HE.list[i], job.entry, { remote: true, edited: nowTime() });
        if (job.order) { e.dayOrders = Object.assign({}, e.dayOrders || {}); if (ent.orderNo) delete e.dayOrders[ent.orderNo]; e.dayOrders[job.order.no] = job.order.value; }
        HE.list[i] = e;
        HE.list.forEach(x => { if (x.kind !== 'Invoice') x.dayOrders = HE.list[i].dayOrders || x.dayOrders; });
      }
    }
    headEntriesView(); submitted(() => showSummary(job.summary));
  }
  function headEntriesView(role) {                               // role: 'DSO' (from As DSO) or 'Manager' (from As Manager)
    if (!isHeadUser()) return home();
    if (role && role !== HE.role) { HE.role = role; HE.name = ''; HE.list = null; }
    const main = shell('Previous Entries', home), msg = msgBox();
    if (!HE.date) HE.date = U.todayIso();
    const who = h('select', { class: 'inp' }, h('option', { value: '' }, HE.team ? '---- Select ----' : 'Loading…'));
    const dateIn = dateBox(HE.date);
    const showBtn = h('button', { class: 'btn big', onclick: () => load() }, 'Show Entries');
    const listBox = h('div');
    main.append(h('section', { class: 'card' }, h('h3', {}, 'Whose entries?'), field(HE.role === 'Manager' ? 'Manager' : 'DSO', who), field('Date', dateIn),
      h('div', { class: 'submitbar' }, showBtn), msg), listBox);
    const posOf = n => ((HE.team || []).find(x => norm(x.name) === norm(n)) || {}).position || '';
    function fillTeam() {
      const ps = (HE.team || []).filter(x => x.position === HE.role);
      who.replaceChildren(h('option', { value: '' }, '---- Select ----'), ...ps.map(x => h('option', { value: x.name }, x.name)));
      who.value = HE.name;
      if (HE.team && !ps.length) say(msg, HE.role === 'Manager' ? 'No Manager is registered under you yet.' : 'No DSO is registered under you yet.', true);
    }
    if (HE.team) fillTeam();
    else authed('entries_of', {}).then(r => { HE.team = r.team || []; fillTeam(); if (!HE.team.length) say(msg, 'Nobody is registered under you yet.', true); })
      .catch(e => { who.replaceChildren(h('option', { value: '' }, '---- Select ----')); say(msg, e.offline ? 'No internet – the list of people needs a connection.' : e.message, true); });
    function draw() {
      listBox.replaceChildren();
      if (!HE.list) return;
      if (posOf(HE.name) === 'Accountant') HE.list = invoicesOf(HE.name, HE.date);   // the invoice lists on the phone already carry any edit
      const head = h('div', { class: 'row-between entries-head' }, h('b', {}, HE.name + ' · ' + dmyFull(HE.date)), h('span', { class: 'hint' }, HE.list.length + (HE.list.length === 1 ? ' entry' : ' entries')));
      listBox.append(head);
      if (!HE.list.length) { listBox.append(h('section', { class: 'card' }, h('p', { class: 'hint' }, 'No entries on this day.'))); return; }
      HE.list.forEach((e, i) => {
        e.no = String(i + 1);
        let open;
        if (e.kind === 'Invoice') open = m => editView({ type: e.type, no: e.invNo, mode: m, n: e.no });
        else open = m => (e.kind === 'Payment' ? payView : visitView)({ entry: e, mode: m });
        const title = 'Entry ' + (i + 1) + ': ' + e.market + ' - ' + e.counter;
        const cap = e.cat + (e.edited ? ' · edited ' + e.edited : '');
        const eye = iconOnly(ICON_EYE, 'View', () => open('view')), pen = iconOnly(ICON_PEN, 'Edit', () => open('edit'));
        if (e.kind !== 'Invoice' && !e.form) eye.disabled = pen.disabled = true;
        listBox.append(h('div', { class: 'entrybox' }, h('div', { class: 'eb-text' }, h('b', {}, title), h('span', {}, cap)), h('div', { class: 'eb-acts' }, eye, pen)));
      });
    }
    function invoicesOf(name, iso) {                           // an Accountant's outward and inward invoices of the day (from the lists on the phone)
      const mine = x => x.date === iso && (!x.by || norm(x.by) === norm(name));
      const out = Object.keys(model.invoices).filter(k => mine(model.invoices[k])).map(k => {
        const v = model.invoices[k], tot = (v.lines || []).reduce((a, l) => a + l.qty * l.price, 0);
        return { kind: 'Invoice', type: 'outward', invNo: k, id: 'o:' + k, market: 'Outward Invoice ' + k, counter: v.counterName || '', cat: 'Outward Invoice · ' + (tot ? money(roundRupee(tot)) : 'cancelled') };
      });
      const inw = Object.keys(model.inwardInvoices).filter(k => mine(model.inwardInvoices[k])).map(k => {
        const v = model.inwardInvoices[k], tot = (v.lines || []).reduce((a, l) => a + l.qty * l.price, 0);
        return { kind: 'Invoice', type: 'inward', invNo: k, id: 'i:' + k, market: 'Inward Invoice', counter: k, cat: 'Inward Invoice · ' + money(roundRupee(tot)) };
      });
      const serialOf = k => +(String(k).split('/')[1]) || 0;
      out.sort((a, b) => serialOf(a.invNo) - serialOf(b.invNo));
      return out.concat(inw);
    }
    let busy = false;
    async function load() {
      if (busy) return;
      const name = who.value, iso = dateIn.get();
      if (!name) return say(msg, HE.role === 'Manager' ? 'Select the Manager.' : 'Select the DSO.', true);
      if (!U.parseIso(iso)) return say(msg, 'Choose the date.', true);
      HE.name = name; HE.date = iso; HE.list = null; draw();
      if (posOf(name) === 'Accountant') { HE.list = invoicesOf(name, iso); say(msg, ''); draw(); return; }
      busy = true; showBtn.disabled = true; say(msg, 'Getting ' + name + '’s entries…');
      try {
        let r;
        try { r = await authed('entries_of', { name, date: iso }); }
        catch (e) { throw new Error(e.offline ? 'No internet – the entries need a connection.' : e.message); }
        HE.list = (r.entries || []).map(e => Object.assign(e, { remote: true, date: iso, dayOrders: r.dayOrders || {} }));
        say(msg, ''); draw();
      } catch (e) { say(msg, e.message, true); }
      finally { busy = false; showBtn.disabled = false; }
    }
    draw();
    currentView = { onData() {} };
  }

  /* ------------------------------------------------------------------ start */
  /* the phone's Back button: goes back like the ← on the screen (closes a popup first); on a home page: "Press back again to close" */
  const Back = (function () {
    let armed = false, lastHome = 0;
    function arm() { if (armed) return; try { history.pushState({ pm: Date.now() }, ''); armed = true; } catch (e) {} }
    window.addEventListener('popstate', () => {
      armed = false;
      const pops = document.querySelectorAll('.modal');
      if (pops.length) {
        const m = pops[pops.length - 1], ok = m.querySelector('.okbtn'), x = m.querySelector('.x, .done');
        if (ok) ok.click(); else if (x) x.click(); else m.remove();
        arm(); return;
      }
      const back = document.querySelector('header.top .back');
      if (back) { back.click(); arm(); return; }
      if (Date.now() - lastHome < 2500) { try { history.back(); } catch (e) {} return; }   // second press: close
      lastHome = Date.now(); U.toast('Press back again to close the app'); arm();
    });
    ['pointerdown', 'keydown'].forEach(n => document.addEventListener(n, arm, true));
    return { arm };
  })();
  function start(notice) {
    Back.arm();
    if (typeof Combo === 'undefined' || typeof ProductRows === 'undefined') { if (window.__paShow) window.__paShow('js/ui.js did not load. Upload it into the js folder of the site.'); }
    if (!S.token || !S.profile) return registerView(notice);
    const grace = CFG.OFFLINE_GRACE_DAYS * 864e5;
    if (!S.snapshot && !navigator.onLine) {
      root.replaceChildren(h('main', { class: 'page narrow' }, h('div', { class: 'card' }, h('h2', {}, 'No internet'), h('p', {}, 'Connect to the internet once so the app can load the lists.'), h('button', { class: 'btn big', onclick: () => start() }, 'Try again'))));
      return;
    }
    if (S.verifiedAt && Date.now() - S.verifiedAt > grace && !navigator.onLine) {
      root.replaceChildren(h('main', { class: 'page narrow' }, h('div', { class: 'card' }, h('h2', {}, 'Please connect to the internet'), h('p', {}, 'This device has to be verified every ' + CFG.OFFLINE_GRACE_DAYS + ' days.'), h('button', { class: 'btn big', onclick: () => start() }, 'Try again'))));
      return;
    }
    rebuildModel(); home(); sync(true);
  }
  /* ------------------------------------------------------------------ "Install as Mobile App" (mobile BROWSER only) */
  const Install = (function () {
    const standalone = () => (window.matchMedia && (matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches || matchMedia('(display-mode: minimal-ui)').matches)) || navigator.standalone === true;
    const ua = navigator.userAgent;
    const isIOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    const isMobile = isIOS || /Android|Mobile/.test(ua);
    let deferred = null, bar = null;
    const dl = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="M6.5 10.5 12 16l5.5-5.5"/><path d="M4 20h16"/></svg>';
    function hide() { if (bar) { bar.remove(); bar = null; } document.body.classList.remove('has-install'); }
    function help() {
      const close = () => ov.remove();
      const sec = (t, ...kids) => h('section', {}, h('h3', {}, t), ...kids);
      const ol = (...items) => h('ol', {}, ...items.map(x => h('li', {}, x)));
      const ov = h('div', { class: 'modal', onclick: e => { if (e.target === ov) close(); } },
        h('div', { class: 'modal-box', role: 'dialog', 'aria-label': 'How to install and register' },
          h('div', { class: 'row-between modal-head' }, h('h2', {}, 'Install & register ProMandi'), h('button', { class: 'x', onclick: close, 'aria-label': 'Close' }, '✕')),
          h('div', { class: 'modal-body' },
            sec('1. Install the app – Android (Chrome)',
              ol('Open this page in Google Chrome.', 'Tap the gold “Install as Mobile App” button at the bottom.', 'Tap “Install” in the box that appears.',
                 'Wait a few seconds: “ProMandi” appears on your home screen and in your app list like any other app.',
                 'If no box appears: tap ⋮ (top right in Chrome) → “Install app” (or “Add to Home screen” → “Install”).')),
            sec('1. Install the app – iPhone / iPad (Safari)',
              ol('Open this page in Safari (installing does not work from Chrome on iPhone).', 'Tap the Share button (the square with an arrow, at the bottom).',
                 'Scroll down and tap “Add to Home Screen”.', 'Tap “Add” (top right). “ProMandi” appears on your home screen.')),
            sec('2. Open it from the home screen',
              h('p', {}, 'Always open ProMandi from its home-screen icon, not from the browser. Allow location when it asks – visits record where they were logged.')),
            sec('3. Register this device (one time)',
              h('p', {}, 'Choose your Position, then fill in your Name, Mobile No. and Email ID. Then, depending on the Position:'),
              h('p', {}, h('b', {}, 'Head of Operations')),
              ol('Open your records Google Sheet → Share → add verify.proaxis@gmail.com as Editor.', 'Copy the sheet’s link (Share → Copy link) and paste it in “Records Google Sheet link”.',
                 'Tap “Send OTP”. The OTP goes to the owner (owner.proaxis@gmail.com) – ask the owner for it.'),
              h('p', {}, h('b', {}, 'Manager, Accountant or DSO')),
              ol('Enter your Head of Operations’ First Name and email EXACTLY as they are registered (ask your Head). Your own Email ID is optional; your Mobile No. is required.', 'Tap “Send OTP”. The OTP goes to your Head of Operations – ask them for it.',
                 'Your Head must already be registered, otherwise you will see “Please enter valid Head of Operative details”.'),
              h('p', {}, h('b', {}, 'Then (everyone)')),
              ol('Type the 6-digit OTP and tap “Verify”. The OTP is valid for 10 minutes; 3 wrong tries need a new OTP.', '“This device has been registered” → tap “Next”. You see the home page of your Position.')),
            sec('Good to know',
              ol('Entries are saved on the device first and uploaded automatically; without internet they wait and go up later.',
                 'Connect to the internet at least every 3 days.', 'If your Position or access is changed by the owner, the app changes by itself.')))));
      document.body.append(ov);
    }
    async function install() {
      if (deferred) {
        const ev = deferred; deferred = null;
        ev.prompt();
        try { const r = await ev.userChoice; if (r && r.outcome === 'accepted') { hide(); U.toast('Installing ProMandi – it will appear on your home screen.'); } } catch (e) {}
      } else help();                                       // iPhone, or the browser cannot install directly: show the steps
    }
    function show() {
      if (bar || standalone() || !isMobile) return;
      const btn = h('button', { class: 'install-main', type: 'button', onclick: install });
      btn.innerHTML = dl; btn.append(h('span', {}, 'Install as Mobile App'));
      bar = h('div', { class: 'install-bar' }, btn, h('button', { class: 'install-help', type: 'button', onclick: help, 'aria-label': 'How to install and register' }, '?'));
      document.body.append(bar); document.body.classList.add('has-install');
    }
    window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; show(); });
    window.addEventListener('appinstalled', () => { deferred = null; hide(); });
    if (window.matchMedia) try { matchMedia('(display-mode: standalone)').addEventListener('change', e => { if (e.matches) hide(); }); } catch (e) {}
    return { show, hide, help };
  })();
  Install.show();

  window.ProMandi = { start, model, S, sync, Loc };
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  start();
})();

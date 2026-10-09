/* Review / comment layer — Mora Gili, section 1 (Hero).
   Vanilla JS, no libraries. Adds only overlay UI (classes "mgr-*"), never touches the Hero markup or styles. */
(function () {
  'use strict';

  var KEY = 'moragili-review-section1';
  var NAME_KEY = KEY + ':reviewer';
  var PIN_HALF_W = 17;   // keep pins inside the document width (no horizontal scroll)
  var PIN_H = 41;

  var state = {
    mode: false,
    comments: [],
    draft: null,          // unsaved new comment
    editingId: null       // id of comment open in the editor (or draft id)
  };

  /* ---------------- storage ---------------- */
  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return [];
      var data = JSON.parse(raw);
      var list = Array.isArray(data) ? data : (data && data.comments) || [];
      return list.filter(function (c) { return c && c.id && typeof c.n === 'number'; });
    } catch (e) { return []; }
  }
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ version: 1, comments: state.comments }));
    } catch (e) {
      toast('שמירה מקומית נכשלה — מומלץ לייצא JSON עכשיו');
    }
  }
  function loadName() { try { return localStorage.getItem(NAME_KEY) || ''; } catch (e) { return ''; } }
  function saveName(v) { try { localStorage.setItem(NAME_KEY, v); } catch (e) { /* ignore */ } }

  /* ---------------- helpers ---------------- */
  function el(tag, cls, attrs, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (attrs) Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (text != null) n.textContent = text;
    return n;
  }
  function isUi(node) {
    return !!(node && node.nodeType === 1 && node.closest && node.closest('.mgr-ui'));
  }
  function uid() { return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function nextN() {
    return state.comments.reduce(function (m, c) { return Math.max(m, c.n); }, 0) + 1;
  }
  function round2(v) { return Math.round(v * 100) / 100; }
  function esc(s) { return (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/[^\w-]/g, '\\$&'); }
  function docWidth() { return document.documentElement.clientWidth; }

  // Stable selector: unique id if available, otherwise tag:nth-of-type path up to an id / body.
  function cssPath(node) {
    if (!node || node.nodeType !== 1) return 'body';
    if (node === document.documentElement) return 'html';
    var parts = [];
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      if (node.id && document.querySelectorAll('#' + esc(node.id)).length === 1) {
        parts.unshift('#' + esc(node.id));
        break;
      }
      if (node === document.body) { parts.unshift('body'); break; }
      var tag = node.localName, i = 1, sib = node;
      while ((sib = sib.previousElementSibling)) { if (sib.localName === tag) i++; }
      parts.unshift(tag + ':nth-of-type(' + i + ')');
      node = node.parentElement;
    }
    return parts.join(' > ');
  }

  function snippetOf(node) {
    if (!node || node.nodeType !== 1) return '';
    var t = '';
    if (node.localName === 'img') t = node.getAttribute('alt') || '';
    if (!t) t = node.innerText || node.textContent || '';
    if (!t) { var img = node.querySelector && node.querySelector('img[alt]'); if (img) t = img.getAttribute('alt'); }
    t = t.replace(/\s+/g, ' ').trim();
    if (!t) t = '<' + node.localName + '>';
    return t.length > 60 ? t.slice(0, 60) + '…' : t;
  }

  function guessDevice() {
    var w = window.innerWidth;
    var coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    if (/Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || w < 768 || (coarse && w < 1024)) return 'mobile';
    return 'desktop';
  }
  function deviceHe(d) { return d === 'mobile' ? 'נייד' : 'מחשב'; }

  function fmtDate(iso) {
    try {
      var d = new Date(iso);
      function p(n) { return (n < 10 ? '0' : '') + n; }
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    } catch (e) { return iso; }
  }

  function resolveEl(c) {
    var node = null;
    try { node = document.querySelector(c.selector); } catch (e) { node = null; }
    return node && !isUi(node) ? node : null;
  }

  // Re-anchor to the element (relative % of its box); fall back to stored page coords.
  function anchorPoint(c) {
    var node = resolveEl(c);
    var x = c.pageX, y = c.pageY, attached = false;
    if (node) {
      var r = node.getBoundingClientRect();
      if (r.width > 0 || r.height > 0) {
        x = r.left + window.pageXOffset + (c.relX / 100) * r.width;
        y = r.top + window.pageYOffset + (c.relY / 100) * r.height;
        attached = true;
      }
    }
    x = Math.min(Math.max(x, PIN_HALF_W), Math.max(PIN_HALF_W, docWidth() - PIN_HALF_W));
    y = Math.max(y, PIN_H);
    return { x: x, y: y, attached: attached };
  }

  function locationSummary(c) {
    return 'על: «' + c.snippet + '» · ' + deviceHe(c.device) + ' ' + c.viewport.w + '×' + c.viewport.h;
  }

  /* ---------------- UI scaffold ---------------- */
  var layer = el('div', 'mgr-ui mgr-layer');

  var toolbar = el('div', 'mgr-ui mgr-toolbar', { role: 'toolbar', 'aria-label': 'כלי הערות' });
  var modeBtn = el('button', 'mgr-btn mgr-btn--mode', { type: 'button', 'aria-pressed': 'false' }, 'מצב הערות: כבוי');
  var listBtn = el('button', 'mgr-btn', { type: 'button', 'aria-expanded': 'false', 'aria-controls': 'mgr-panel' }, 'הערות (0)');
  var sendBtn = el('button', 'mgr-btn mgr-btn--send', { type: 'button' }, 'שליחת ההערות');
  toolbar.appendChild(modeBtn);
  toolbar.appendChild(listBtn);
  toolbar.appendChild(sendBtn);

  var hint = el('div', 'mgr-ui mgr-hint', { role: 'status' }, 'מצב הערות פעיל — לחצו/הקישו על כל מקום בעמוד כדי להוסיף הערה');
  hint.hidden = true;
  var hintTimer = null;

  // panel
  var panel = el('aside', 'mgr-ui mgr-panel', { id: 'mgr-panel', 'aria-label': 'רשימת הערות' });
  panel.hidden = true;
  var head = el('div', 'mgr-panel__head');
  var title = el('h2', 'mgr-panel__title', null, 'הערות על אזור 1');
  var closeBtn = el('button', 'mgr-btn mgr-btn--small', { type: 'button', 'aria-label': 'סגירת הרשימה' }, '✕');
  head.appendChild(title); head.appendChild(closeBtn);
  var nameWrap = el('label', 'mgr-panel__name', null, 'שם המעיר/ה (לא חובה)');
  var nameInput = el('input', 'mgr-input', { type: 'text', autocomplete: 'name', placeholder: 'למשל: גילי' });
  nameInput.value = loadName();
  nameWrap.appendChild(nameInput);
  var list = el('ul', 'mgr-list');
  var foot = el('div', 'mgr-panel__foot');
  var exportBtn = el('button', 'mgr-btn mgr-btn--small', { type: 'button' }, 'ייצוא JSON');
  var copyBtn = el('button', 'mgr-btn mgr-btn--small', { type: 'button' }, 'העתקת טקסט');
  var clearBtn = el('button', 'mgr-btn mgr-btn--small mgr-btn--danger', { type: 'button' }, 'ניקוי הכל');
  var sendBtn2 = el('button', 'mgr-btn mgr-btn--small mgr-btn--send', { type: 'button' }, 'שליחת ההערות בוואטסאפ');
  foot.appendChild(sendBtn2); foot.appendChild(exportBtn); foot.appendChild(copyBtn); foot.appendChild(clearBtn);

  // first-open instructions banner (dismissible)
  var INTRO_KEY = KEY + ':intro-dismissed';
  var intro = el('div', 'mgr-ui mgr-intro', { role: 'dialog', 'aria-label': 'הוראות' });
  intro.innerHTML = '<p class="mgr-intro__title">שלום! כאן אפשר להעיר על מסך הפתיחה של האתר</p>' +
    '<ol class="mgr-intro__list">' +
    '<li>לוחצים למטה על <b>«מצב הערות»</b> כדי להפעיל.</li>' +
    '<li>נוגעים בכל מקום בעמוד, נפתחת סיכה ממוספרת. כותבים הערה ולוחצים <b>«שמירה»</b>. המיקום נשמר אוטומטית.</li>' +
    '<li>בסוף לוחצים <b>«שליחת ההערות»</b>, ייפתח וואטסאפ עם כל ההערות. לוחצים שליחה.</li>' +
    '</ol>' +
    '<p class="mgr-intro__note">תוויות «לאישור» בעמוד הן שאלות פתוחות שלנו, לא חלק מהעיצוב.</p>';
  var introClose = el('button', 'mgr-btn mgr-btn--primary', { type: 'button' }, 'הבנתי, מתחילים');
  intro.appendChild(introClose);
  intro.hidden = true;
  panel.appendChild(head); panel.appendChild(nameWrap); panel.appendChild(list); panel.appendChild(foot);

  // editor
  var editor = el('div', 'mgr-ui mgr-editor', { role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'mgr-editor-title' });
  editor.hidden = true;
  var edTitle = el('p', 'mgr-editor__title', { id: 'mgr-editor-title' });
  var edWhere = el('p', 'mgr-editor__where');
  var edText = el('textarea', 'mgr-textarea', { 'aria-label': 'תוכן ההערה', placeholder: 'מה לשנות כאן?' });
  var edRow = el('div', 'mgr-editor__row');
  var edSave = el('button', 'mgr-btn mgr-btn--small mgr-btn--primary', { type: 'button' }, 'שמירה');
  var edCancel = el('button', 'mgr-btn mgr-btn--small', { type: 'button' }, 'ביטול');
  var edDelete = el('button', 'mgr-btn mgr-btn--small mgr-btn--danger', { type: 'button' }, 'מחיקה');
  edRow.appendChild(edSave); edRow.appendChild(edCancel); edRow.appendChild(edDelete);
  editor.appendChild(edTitle); editor.appendChild(edWhere); editor.appendChild(edText); editor.appendChild(edRow);

  // fallback copy modal
  var modal = el('div', 'mgr-ui mgr-modal', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'העתקה ידנית' });
  modal.hidden = true;
  var modalBox = el('div', 'mgr-modal__box');
  var modalMsg = el('p', null, null, 'ההעתקה האוטומטית לא הצליחה. סמנו את הטקסט והעתיקו ידנית (Ctrl/Cmd + C):');
  var modalText = el('textarea', 'mgr-textarea', { readonly: 'readonly', 'aria-label': 'טקסט ההערות' });
  var modalRow = el('div', 'mgr-editor__row');
  var modalClose = el('button', 'mgr-btn mgr-btn--small', { type: 'button' }, 'סגירה');
  modalRow.appendChild(modalClose);
  modalBox.appendChild(modalMsg); modalBox.appendChild(modalText); modalBox.appendChild(modalRow);
  modal.appendChild(modalBox);

  var toastEl = el('div', 'mgr-ui mgr-toast', { role: 'status', 'aria-live': 'polite' });
  toastEl.hidden = true;
  var toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.hidden = true; }, 2600);
  }

  /* ---------------- rendering ---------------- */
  var pinEls = {};

  function makePin(c, isDraft) {
    var b = el('button', 'mgr-pin' + (isDraft ? ' mgr-pin--draft' : ''), {
      type: 'button',
      'aria-label': 'הערה ' + c.n + (c.text ? ': ' + c.text.slice(0, 40) : ''),
      'data-id': c.id
    });
    b.appendChild(el('span', 'mgr-pin__n', null, String(c.n)));
    b.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (!isDraft) openEditor(c.id);
    });
    return b;
  }

  function renderPins() {
    layer.textContent = '';
    pinEls = {};
    var all = state.comments.slice();
    if (state.draft) all.push(state.draft);
    all.forEach(function (c) {
      var pin = makePin(c, c === state.draft);
      pinEls[c.id] = pin;
      layer.appendChild(pin);
    });
    positionPins();
  }

  function positionPins() {
    var all = state.comments.slice();
    if (state.draft) all.push(state.draft);
    all.forEach(function (c) {
      var pin = pinEls[c.id];
      if (!pin) return;
      var p = anchorPoint(c);
      pin.style.left = p.x + 'px';
      pin.style.top = p.y + 'px';
      pin.classList.toggle('mgr-pin--detached', !p.attached && c !== state.draft);
    });
    if (!editor.hidden) placeEditor();
  }

  function renderList() {
    listBtn.textContent = 'הערות (' + state.comments.length + ')';
    list.textContent = '';
    if (!state.comments.length) {
      list.appendChild(el('li', 'mgr-empty', null, 'עדיין אין הערות. הפעילו «מצב הערות» ולחצו על מקום בעמוד.'));
      return;
    }
    state.comments.slice().sort(function (a, b) { return a.n - b.n; }).forEach(function (c) {
      var li = el('li');
      var item = el('button', 'mgr-item', { type: 'button' });
      item.appendChild(el('span', 'mgr-item__n', null, String(c.n)));
      item.appendChild(el('span', 'mgr-item__text', null, c.text));
      var meta = locationSummary(c) + (c.author ? ' · ' + c.author : '') + ' · ' + fmtDate(c.ts);
      item.appendChild(el('span', 'mgr-item__meta', null, meta));
      item.addEventListener('click', function () { goTo(c.id); });
      li.appendChild(item);
      list.appendChild(li);
    });
  }

  function renderAll() { renderPins(); renderList(); }

  /* ---------------- comment mode ---------------- */
  function setMode(on) {
    state.mode = !!on;
    modeBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    modeBtn.textContent = on ? 'מצב הערות: פעיל' : 'מצב הערות: כבוי';
    document.documentElement.classList.toggle('mgr-commenting', state.mode);
    hint.hidden = !state.mode;
    clearTimeout(hintTimer);
    if (state.mode) hintTimer = setTimeout(function () { hint.hidden = true; }, 4000);
    if (!state.mode && state.draft) closeEditor();
  }

  // Capture phase: in comment mode, swallow the interaction before links/buttons see it.
  function swallow(e) {
    if (!state.mode || isUi(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    if (e.type === 'click') createDraft(e);
  }

  function createDraft(e) {
    var target = e.target && e.target.nodeType === 1 ? e.target : document.body;
    if (state.draft || state.editingId) closeEditor();
    var r = target.getBoundingClientRect();
    var cx = e.clientX, cy = e.clientY;
    if (e.detail === 0 && cx === 0 && cy === 0) {          // keyboard-triggered click → element centre
      cx = r.left + r.width / 2;
      cy = r.top + r.height / 2;
    }
    var relX = r.width ? ((cx - r.left) / r.width) * 100 : 0;
    var relY = r.height ? ((cy - r.top) / r.height) * 100 : 0;
    state.draft = {
      id: uid(),
      n: nextN(),
      text: '',
      author: '',
      selector: cssPath(target),
      tag: target.localName,
      snippet: snippetOf(target),
      pageX: Math.round(cx + window.pageXOffset),
      pageY: Math.round(cy + window.pageYOffset),
      relX: round2(relX),
      relY: round2(relY),
      viewport: { w: window.innerWidth, h: window.innerHeight },
      device: guessDevice(),
      ts: new Date().toISOString(),
      updated: null,
      url: location.href
    };
    renderPins();
    openEditor(state.draft.id);
  }

  /* ---------------- editor ---------------- */
  function findComment(id) {
    if (state.draft && state.draft.id === id) return state.draft;
    for (var i = 0; i < state.comments.length; i++) if (state.comments[i].id === id) return state.comments[i];
    return null;
  }

  function openEditor(id) {
    var c = findComment(id);
    if (!c) return;
    if (state.draft && state.draft.id !== id) { state.draft = null; renderPins(); }
    state.editingId = id;
    var isDraft = c === state.draft;
    edTitle.textContent = (isDraft ? 'הערה חדשה #' : 'הערה #') + c.n;
    edWhere.textContent = locationSummary(c) + (c.author ? ' · ' + c.author : '');
    edText.value = c.text || '';
    edDelete.hidden = isDraft;
    editor.hidden = false;
    placeEditor();
    try { edText.focus({ preventScroll: true }); } catch (e) { edText.focus(); }
  }

  function placeEditor() {
    var pin = state.editingId && pinEls[state.editingId];
    if (!pin) return;
    var pr = pin.getBoundingClientRect();
    var w = editor.offsetWidth || 320, h = editor.offsetHeight || 220;
    var vw = window.innerWidth, vh = window.innerHeight;
    var left = pr.left - w - 12;                       // prefer left of the pin
    if (left < 8) left = pr.right + 12;
    left = Math.min(Math.max(8, left), Math.max(8, vw - w - 8));
    var top = Math.min(Math.max(8, pr.top - 20), Math.max(8, vh - h - 8));
    editor.style.left = left + 'px';
    editor.style.top = top + 'px';
  }

  function closeEditor() {
    editor.hidden = true;
    state.editingId = null;
    if (state.draft) { state.draft = null; renderPins(); }
  }

  function saveEditor() {
    var c = findComment(state.editingId);
    if (!c) return closeEditor();
    var text = edText.value.trim();
    if (!text) { edText.focus(); toast('כתבו את ההערה לפני שמירה'); return; }
    var name = nameInput.value.trim();
    c.text = text;
    if (name) c.author = name;
    if (c === state.draft) {
      state.comments.push(c);
      state.draft = null;
    } else {
      c.updated = new Date().toISOString();
    }
    save();
    editor.hidden = true;
    state.editingId = null;
    renderAll();
    toast('ההערה נשמרה');
  }

  function deleteEditor() {
    var id = state.editingId;
    var c = findComment(id);
    if (!c || c === state.draft) return closeEditor();
    if (!window.confirm('למחוק את הערה #' + c.n + '?')) return;
    state.comments = state.comments.filter(function (x) { return x.id !== id; });
    save();
    editor.hidden = true;
    state.editingId = null;
    renderAll();
    toast('ההערה נמחקה');
  }

  /* ---------------- list → pin ---------------- */
  function goTo(id) {
    var c = findComment(id);
    if (!c) return;
    var p = anchorPoint(c);
    var narrow = window.innerWidth <= 700;
    var top = p.y - (narrow ? window.innerHeight * 0.22 : window.innerHeight / 2);
    window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    var pin = pinEls[id];
    if (pin) {
      pin.classList.remove('mgr-pin--flash');
      void pin.offsetWidth;
      pin.classList.add('mgr-pin--flash');
    }
    var node = resolveEl(c);
    if (node) {
      var r = node.getBoundingClientRect();
      var box = el('div', 'mgr-target-outline');
      box.style.left = (r.left + window.pageXOffset - 4) + 'px';
      box.style.top = (r.top + window.pageYOffset - 4) + 'px';
      box.style.width = Math.min(r.width + 8, docWidth() - (r.left + window.pageXOffset - 4)) + 'px';
      box.style.height = (r.height + 8) + 'px';
      layer.appendChild(box);
      setTimeout(function () { if (box.parentNode) box.parentNode.removeChild(box); }, 1600);
    }
  }

  /* ---------------- export / copy / clear ---------------- */
  function sorted() { return state.comments.slice().sort(function (a, b) { return a.n - b.n; }); }

  function exportJson() {
    var data = {
      project: 'Mora Gili — אזור 1 (Hero)',
      page: location.href,
      exportedAt: new Date().toISOString(),
      storageKey: KEY,
      count: state.comments.length,
      comments: sorted()
    };
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = el('a', 'mgr-ui', { href: url, download: 'moragili-review-section1-' + fmtDate(data.exportedAt).replace(/[: ]/g, '-') + '.json' });
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.parentNode && a.parentNode.removeChild(a); }, 1500);
    toast('קובץ JSON הורד');
  }

  function asText() {
    var lines = [
      'הערות על אתר Mora Gili — אזור 1 (מסך פתיחה)',
      'עמוד: ' + location.href,
      'יוצא בתאריך: ' + fmtDate(new Date().toISOString()),
      'סה״כ הערות: ' + state.comments.length,
      ''
    ];
    sorted().forEach(function (c) {
      lines.push('#' + c.n + ' — ' + c.text);
      if (c.author) lines.push('   מאת: ' + c.author);
      lines.push('   מיקום: על «' + c.snippet + '» (' + c.selector + '), נקודה ' + Math.round(c.relX) + '% / ' + Math.round(c.relY) + '% בתוך האלמנט');
      lines.push('   מסך: ' + deviceHe(c.device) + ' ' + c.viewport.w + '×' + c.viewport.h + ' · נקודה בעמוד ' + c.pageX + ',' + c.pageY + ' · ' + fmtDate(c.ts) + (c.updated ? ' (עודכן ' + fmtDate(c.updated) + ')' : ''));
      lines.push('');
    });
    return lines.join('\n');
  }

  var WA_NUMBER = '972559189249';
  var LABELS = [
    ['.site-header', 'ראש העמוד / הלוגו'],
    ['.hero__eyebrow', 'התווית מעל הכותרת («בית ספר לאנגלית לילדים»)'],
    ['.hero__title', 'הכותרת הראשית'],
    ['.hero__subtitle', 'תת־הכותרת'],
    ['.btn--primary', 'הכפתור «לקביעת שיעור ניסיון»'],
    ['.btn--secondary', 'הכפתור «הכירו את שיטת הלימוד»'],
    ['.hero__actions', 'אזור הכפתורים'],
    ['.trust__item', 'נתוני האמון'],
    ['.trust', 'נתוני האמון'],
    ['.hero__img', 'התמונה המרכזית'],
    ['.hero__media', 'התמונה המרכזית (המסגרת)'],
    ['.hero', 'הרקע של מסך הפתיחה']
  ];
  function placeLabel(c) {
    var node = null;
    try { node = document.querySelector(c.selector); } catch (e) { node = null; }
    if (!node) return 'אזור 1 (מסך פתיחה)';
    for (var i = 0; i < LABELS.length; i++) {
      var hit = node.closest ? node.closest(LABELS[i][0]) : null;
      if (hit) {
        var lab = LABELS[i][1];
        if (LABELS[i][0] === '.trust__item') lab += ' («' + hit.textContent.replace(/\s+/g, ' ').trim() + '»)';
        return lab;
      }
    }
    return 'אזור 1 (מסך פתיחה)';
  }
  function waText() {
    var list = sorted();
    var name = (nameInput.value || '').trim();
    var lines = ['הערות על האתר — Mora Gili, אזור 1 (מסך פתיחה)' + (name ? ' — מאת ' + name : '')];
    lines.push('מכשיר: ' + (list[0] ? deviceHe(list[0].device) + ' ' + list[0].viewport.w + '×' + list[0].viewport.h : ''));
    lines.push('');
    list.forEach(function (c) {
      var w = Math.max(document.documentElement.scrollWidth, 1);
      var docX = c.viewport && c.viewport.w ? Math.round(c.pageX / c.viewport.w * 100) : Math.round(c.pageX / w * 100);
      lines.push('📍 ' + c.n + ') ' + c.text);
      var lab = placeLabel(c);
      var snip = (c.tag !== 'img' && c.snippet && lab.indexOf(c.snippet) === -1) ? ' — «' + c.snippet + '»' : '';
      lines.push('   מיקום: ' + lab + snip);
      lines.push('   נקודה בתוך האלמנט: ' + Math.round(c.relX) + '% משמאל, ' + Math.round(c.relY) + '% מלמעלה · בעמוד: x=' + c.pageX + ', y=' + c.pageY + ' (' + docX + '% מרוחב המסך)');
      lines.push('');
    });
    lines.push('קוד מיקום: ' + list.map(function (c) { return c.n + ':' + c.selector; }).join(' | '));
    return lines.join('\n');
  }
  function sendWhatsApp() {
    if (!state.comments.length) { toast('עדיין אין הערות. הפעילו «מצב הערות» ולחצו על העמוד.'); return; }
    var url = 'https://wa.me/' + WA_NUMBER + '?text=' + encodeURIComponent(waText());
    var w = window.open(url, '_blank');
    if (!w) location.href = url;
  }

  function showFallback(text) {
    modalText.value = text;
    modal.hidden = false;
    modalText.focus();
    modalText.select();
  }

  function copyText() {
    var text = asText();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        toast('הטקסט הועתק ללוח');
      }, function () { legacyCopy(text); });
    } else {
      legacyCopy(text);
    }
  }
  function legacyCopy(text) {
    var ok = false;
    var ta = el('textarea', 'mgr-ui');
    ta.value = text;
    ta.setAttribute('readonly', 'readonly');
    ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;';
    document.body.appendChild(ta);
    ta.select();
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    if (ok) toast('הטקסט הועתק ללוח');
    else showFallback(text);
  }

  function clearAll() {
    if (!state.comments.length) { toast('אין הערות למחיקה'); return; }
    if (!window.confirm('למחוק את כל ' + state.comments.length + ' ההערות? לא ניתן לבטל (מומלץ לייצא קודם).')) return;
    state.comments = [];
    closeEditor();
    save();
    renderAll();
    toast('כל ההערות נמחקו');
  }

  /* ---------------- panel ---------------- */
  function setPanel(open) {
    panel.hidden = !open;
    listBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  /* ---------------- wiring ---------------- */
  ['click', 'mousedown', 'dblclick', 'auxclick', 'submit'].forEach(function (type) {
    window.addEventListener(type, swallow, true);
  });

  modeBtn.addEventListener('click', function () { setMode(!state.mode); });
  listBtn.addEventListener('click', function () { setPanel(panel.hidden); });
  closeBtn.addEventListener('click', function () { setPanel(false); });
  nameInput.addEventListener('input', function () { saveName(nameInput.value.trim()); });
  exportBtn.addEventListener('click', exportJson);
  copyBtn.addEventListener('click', copyText);
  clearBtn.addEventListener('click', clearAll);
  sendBtn.addEventListener('click', sendWhatsApp);
  sendBtn2.addEventListener('click', sendWhatsApp);
  introClose.addEventListener('click', function () {
    intro.hidden = true;
    try { localStorage.setItem(INTRO_KEY, '1'); } catch (e) { /* ignore */ }
  });
  edSave.addEventListener('click', saveEditor);
  edCancel.addEventListener('click', closeEditor);
  edDelete.addEventListener('click', deleteEditor);
  modalClose.addEventListener('click', function () { modal.hidden = true; });

  edText.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveEditor(); }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (!intro.hidden) { intro.hidden = true; return; }
    if (!modal.hidden) { modal.hidden = true; return; }
    if (!editor.hidden) { closeEditor(); return; }
    if (state.mode) setMode(false);
  });

  // Re-anchor pins whenever layout may have changed.
  // (setTimeout rather than requestAnimationFrame: rAF is paused in hidden tabs/off-screen frames.)
  var pending = 0;
  function schedule() {
    if (pending) return;
    pending = setTimeout(function () { pending = 0; positionPins(); }, 30);
  }
  window.addEventListener('resize', schedule);
  window.addEventListener('orientationchange', schedule);
  window.addEventListener('load', schedule);
  window.addEventListener('scroll', function () { if (!editor.hidden) placeEditor(); }, { passive: true });
  if (window.ResizeObserver) new ResizeObserver(schedule).observe(document.body);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(schedule);

  // Sync between tabs.
  window.addEventListener('storage', function (e) {
    if (e.key === KEY) { state.comments = load(); renderAll(); }
  });

  function mount() {
    [layer, toolbar, hint, panel, editor, modal, toastEl, intro].forEach(function (n) { document.body.appendChild(n); });
    var seen = false;
    try { seen = localStorage.getItem(INTRO_KEY) === '1'; } catch (e) { seen = false; }
    intro.hidden = seen;
    state.comments = load();
    renderAll();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();

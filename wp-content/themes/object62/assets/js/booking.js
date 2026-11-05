// Блок брони: слот-бар, схема зала, шаги мастера, отправка заявки
import { getConfig, getAvailability, createBooking } from './api.js';

const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];
const fmt = (tpl, vars) => String(tpl == null ? '' : tpl).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
const pad = n => (n < 10 ? '0' : '') + n;

// текст элемента без потери вложенных иконок
function setText(el, text, mode) {
  if (mode === 'first' || mode === 'last') {
    const nodes = [...el.childNodes].filter(n => n.nodeType === Node.TEXT_NODE && n.nodeValue.trim());
    const node = mode === 'first' ? nodes[0] : nodes[nodes.length - 1];
    if (node) { node.nodeValue = text; return; }
  }
  el.textContent = text;
}

function init() {
  const section = document.getElementById('bron');
  if (!section) return;
  start(section).catch(e => console.warn('[b62] блок брони не поднялся:', e));
}

async function start(section) {
  let config;
  try {
    config = await getConfig();
  } catch (e) {
    console.warn('[b62] конфиг не загружен, блок работает на статике:', e.message);
    return;
  }
  window.B62 = { config };

  const S = config.strings || {};
  const RM = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)').matches : false;
  const TABLES = config.tables || [];
  const byId = {}; TABLES.forEach(t => byId[t.id] = t);
  const inv = countByZone(TABLES);
  const RO = config.businessDayRolloverHour || 8;
  // HH:MM → минуты бизнес-даты с ролловером
  const toBizMin = hhmm => {
    const [h, m] = String(hhmm).split(':').map(Number);
    const v = h * 60 + m;
    return h < RO ? v + 1440 : v;
  };
  const C = {
    step: config.slotStepMin || 30,
    lead: config.minLeadMin || 90,
    prime: toBizMin(config.primeTime || '20:00'),
    lastOffset: config.lastSlotOffsetMin || 30,
    duration: config.defaultDurationMin || 90,
    maxDuration: config.maxDurationMin || 360,
    buffer: config.bufferMin || 15,
    rollover: RO,
    cancelHours: config.cancelFreeHours || 24
  };

  // «сейчас» по Москве, независимо от часов устройства гостя
  function mskNow() {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Moscow', hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).formatToParts(new Date());
    const v = {};
    for (const p of parts) v[p.type] = p.value;
    return new Date(+v.year, +v.month - 1, +v.day, +v.hour % 24, +v.minute, +v.second);
  }

  // текущее время, в debug подменяется ?debug_now
  let NOW = mskNow();
  const dbg = new URLSearchParams(location.search).get('debug_now');
  if (dbg && config.debug) {
    const d = new Date(dbg);
    if (!isNaN(d)) NOW = d;
  }

  /* ---------- время в координатах бизнес-даты ---------- */
  // до 08:00 утра относимся к предыдущему дню
  function businessDate(date) {
    const bd = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    if (date.getHours() < C.rollover) bd.setDate(bd.getDate() - 1);
    return bd;
  }
  const iso = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  // минуты бизнес-даты → HH:MM
  const minLabel = m => pad(Math.floor((m % 1440) / 60)) + ':' + pad(m % 60);
  // день недели бизнес-даты определяет часы работы
  function hoursPair(bd) {
    const dow = bd.getDay(); // 5 - пятница, 6 - суббота: сидим до 03:00
    return dow === 5 || dow === 6 ? config.hours['fri-sat'] : config.hours['default'];
  }
  // открытие и закрытие из конфига
  function openMin(bd) { return toBizMin(hoursPair(bd)[0]); }
  function closeMin(bd) { return toBizMin(hoursPair(bd)[1]); }
  function slotsOf(bd) {
    const open = openMin(bd), last = closeMin(bd) - C.lastOffset, out = [];
    for (let m = open; m <= last; m += C.step) out.push(m);
    return out;
  }
  const roundUp = (v, s) => Math.ceil(v / s) * s;
  const dayKey = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const monthKey = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  /* ---------- состояние выбора ---------- */
  const BD0 = businessDate(NOW); // текущая бизнес-дата
  const B = {
    bd: null,          // Date-полночь бизнес-даты
    slot: null,        // минуты бизнес-даты
    guests: 1,
    duration: null,
    tableId: null,
    name: '', phone: '', comment: '',
    agree: false,
    idemKey: null,
    pendingSubmit: false
  };

  // дефолтный слот в координатах бизнес-даты
  function defaultSlot(bd) {
    const nowMin = Math.round((NOW - bd.getTime()) / 60000);
    const slots = slotsOf(bd);
    const last = slots[slots.length - 1];
    const cand = roundUp(nowMin + C.lead, C.step);
    // день закончился: прайм-тайм завтра
    if (cand > last) return { bd: addDays(bd, 1), slot: C.prime };
    // день не начался: прайм-тайм
    if (cand <= openMin(bd)) return { bd, slot: C.prime };
    // день идёт: ближайший доступный слот
    return { bd, slot: cand };
  }
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

  /* ---------- availability: только через api.js ---------- */
  let AVAIL = { source: 'fallback', tables: {} };
  async function loadAvailability(bd) {
    AVAIL = await getAvailability(iso(bd));
    const fb = $('#sbFallback');
    if (fb) fb.classList.toggle('show', AVAIL.source === 'fallback');
  }
  // длительность по умолчанию
  const defDurOf = id => (byId[id] || {}).durationMin || C.duration;
  // фактическая длительность: выбор гостя или умолчание места
  const durOf = id => B.duration || defDurOf(id);
  const bufOf = id => (byId[id] || {}).bufferMin || C.buffer;
  // занят ли стол на слоте T с учётом посадки и буфера уборки
  function busyIntervalAt(tableId, T) {
    const busy = (AVAIL.tables[tableId] || {}).busy || [];
    let hit = null;
    for (const b of busy) {
      const from = toBizMin(b.from), to = toBizMin(b.to) + bufOf(tableId);
      if (T < to && T + durOf(tableId) + bufOf(tableId) > from) {
        if (!hit || toBizMin(b.to) > toBizMin(hit.to)) hit = b;
      }
    }
    return hit;
  }
  // ближайшее время после занятости и уборки, по сетке слотов
  // null, если позже последнего слота дня
  function nextOffer(tableId, iv) {
    const slots = slotsOf(B.bd);
    const last = slots[slots.length - 1];
    let t = roundUp(toBizMin(iv.to) + bufOf(tableId), C.step);
    for (let i = 0; i < 48; i++) {
      if (t > last) return null;
      const nx = busyIntervalAt(tableId, t);
      if (!nx) break;
      t = roundUp(toBizMin(nx.to) + bufOf(tableId), C.step);
    }
    return t;
  }
  function statusOf(t) {
    if (busyIntervalAt(t.id, B.slot)) return 'busy';
    if (t.capacityMax < B.guests) return 'dimmed';
    return 'free';
  }
  // свободно: не занято на слот и вмещает компанию
  const freeAt = (list, T) => list.filter(t => !busyIntervalAt(t.id, T) && (t.capacityMax || 1) >= B.guests).length;
  // статус мобильной карточки: свободно, мало мест или занято
  function mstatus(t) {
    const st = statusOf(t);
    if (st === 'busy') return { cls: 'busy', txt: sget('busy.word') };
    if (st === 'dimmed') return { cls: 'dimmed', txt: fmt(sget('dimmed.tip'), { n: t.capacityMax, word: guestsGen(t.capacityMax) }) };
    return { cls: 'free', txt: sget('free.word') };
  }

  /* ---------- строки и тексты ---------- */
  const plural = (n, one, few, many) => {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  };
  const sget = k => S[k] != null ? S[k] : k;
  const guestsWord = n => plural(n, sget('guests.word1'), sget('guests.word2'), sget('guests.word5'));
  // родительный падеж с фолбэком
  const guestsGen = n => plural(n, S['guests.gen1'] || 'гостя', S['guests.gen2'] || 'гостей', S['guests.gen5'] || 'гостей');
  const durUnit = h => plural(h, S['duration.unit1'] || 'час', S['duration.unit2'] || 'часа', S['duration.unit5'] || 'часов');
  // склонение часов
  const durLabel = m => Number.isInteger(m / 60)
    ? (m / 60) + ' ' + durUnit(m / 60)
    : String(m / 60).replace('.', ',') + ' ' + (S['duration.unit2'] || 'часа');
  const cancelText = tpl => fmt(tpl, { n: C.cancelHours, unit: plural(C.cancelHours, sget('cancel.unit.one'), sget('cancel.unit.few'), sget('cancel.unit.many')) });
  const money = v => v.toLocaleString('ru-RU').replace(/\u00a0/g, ' ') + ' ₽';
  function dateHuman(bd) {
    if (bd.getTime() === BD0.getTime()) return sget('day.today');
    if (bd.getTime() === addDays(BD0, 1).getTime()) return sget('day.tomorrow');
    return sget('day.' + dayKey[bd.getDay()]) + ' ' + bd.getDate() + ' ' + sget('month.' + monthKey[bd.getMonth()]);
  }
  // краткая дата: день недели и дд.мм
  const dateShort = bd => sget('day.' + dayKey[bd.getDay()]) + ' ' + pad(bd.getDate()) + '.' + pad(bd.getMonth() + 1);

  // вид места из схемы, фолбэк по зоне из config.json
  // карта строится лениво из-за TDZ
  function tableKind(t) {
    if (!tableKind.map) {
      const m = {};
      document.querySelectorAll('.plan .spot[data-table-id]').forEach(g => {
        const c = g.classList;
        m[g.dataset.tableId] = c.contains('cab') ? 'cab' : c.contains('seat') ? 'seat' : c.contains('big') ? 'big' : 'table';
      });
      tableKind.map = m;
    }
    if (tableKind.map[t.id]) return tableKind.map[t.id];
    if (t.zone === 'vip') return 'cab';
    if (t.zone === 'bar') return 'seat';
    return 'table';
  }
  function countByZone(tables) {
    const z = { tables: 0, big: 0, vip: 0, bar: 0 };
    tables.forEach(t => {
      const k = tableKind(t);
      if (k === 'cab') z.vip++;
      else if (k === 'seat') z.bar++;
      else if (k === 'big') z.big++;
      else z.tables++;
    });
    // tablesAll: столы зала вместе с большими, без кабинетов
    return { tables: z.tables, big: z.big, vip: z.vip, bar: z.bar, tablesAll: z.tables + z.big };
  }
  function depositLine(t) {
    if (t.depositText) return t.depositText;
    const rub = t.depositRub || 0;
    return rub ? fmt(sget('deposit.line'), { sum: money(rub) }) : sget('deposit.none');
  }
  // в значении только сумма депозита
  function depSum(t) {
    if (!t.depositRub) return sget('deposit.none');
    const unit = t.durationMin || C.duration;
    return money(Math.round(t.depositRub * durOf(t.id) / unit / 100) * 100);
  }

  /* ---------- желаемое время брони ---------- */
  // умолчание места, дальше целые часы
  function durationOptions() {
    const base = defDurOf(B.tableId);
    const room = closeMin(B.bd) - B.slot;
    const out = [base];
    for (let m = (Math.floor(base / 60) + 1) * 60; m <= C.maxDuration; m += 60) {
      if (m > room) break;
      out.push(m);
    }
    return out;
  }
  function renderDurationUI() {
    const opts = durationOptions();
    if (!opts.includes(B.duration)) B.duration = opts[0];
    const key = opts.join(',');
    [$('#bkDuration'), $('#bkwDuration')].forEach(sel => {
      if (!sel) return;
      if (sel.dataset.opts !== key) {
        sel.innerHTML = '';
        opts.forEach(m => {
          const o = document.createElement('option');
          o.value = String(m);
          o.textContent = durLabel(m);
          sel.appendChild(o);
        });
        sel.dataset.opts = key;
      }
      sel.value = String(B.duration);
    });
  }
  function setDuration(m) {
    B.duration = m;
    renderDurationUI();   // второй интерфейс показывает тот же выбор
    applyStatuses();      // занятость считается от новой длительности
    refreshWizardList();
    updateCounters();
    fillSummary();
  }
  ['#bkDuration', '#bkwDuration'].forEach(sel => $(sel)?.addEventListener('change', e => setDuration(Number(e.target.value))));

  /* ---------- гидратация статических текстов из config.strings ---------- */
  // строки ищем по всему документу
  document.querySelectorAll('[data-str]').forEach(el => {
    const tpl = S[el.dataset.str];
    if (tpl == null) { console.warn('[b62] в config.strings нет ключа:', el.dataset.str); return; }
    let out = tpl;
    if (el.dataset.vars === 'inv') out = fmt(out, inv);
    if (el.dataset.vars === 'cancel') out = cancelText(out);
    setText(el, out, el.dataset.strMode);
  });
  document.querySelectorAll('[data-str-ph]').forEach(el => {
    const tpl = S[el.dataset.strPh];
    if (tpl != null) el.setAttribute('placeholder', tpl);
  });
  // aria-атрибуты из конфига
  document.querySelectorAll('[data-str-aria]').forEach(el => {
    const tpl = S[el.dataset.strAria];
    if (tpl != null) el.setAttribute('aria-label', tpl);
  });
  // title-атрибуты из конфига
  document.querySelectorAll('[data-str-title]').forEach(el => {
    const tpl = S[el.dataset.strTitle];
    if (tpl != null) el.setAttribute('title', tpl);
  });

  /* ---------- слот-бар ---------- */
  const sb = $('#slotbar');
  function renderDates(box, chipCls) {
    box.innerHTML = '';
    for (let i = 0; i < 14; i++) {
      const bd = addDays(BD0, i);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = chipCls + (bd.getTime() === B.bd.getTime() ? ' on' : '');
      b.dataset.days = String(i);
      b.setAttribute('aria-pressed', bd.getTime() === B.bd.getTime() ? 'true' : 'false');
      if (i === 0) b.textContent = sget('day.today');
      else if (i === 1) b.textContent = sget('day.tomorrow');
      else b.textContent = sget('day.' + dayKey[bd.getDay()]) + ' ' + bd.getDate() + ' ' + sget('month.' + monthKey[bd.getMonth()]);
      b.addEventListener('click', () => setDate(addDays(BD0, i)));
      box.appendChild(b);
    }
  }
  let timeAnchor = null;
  function renderTimes(box, chipCls) {
    box.innerHTML = '';
    const isToday = B.bd.getTime() === BD0.getTime();
    const nowMin = Math.round((NOW - BD0.getTime()) / 60000);
    let firstFreeMarked = false; // ближайший доступный слот
    let nightMarked = false;     // разделитель после полуночи ставится один раз
    let anchor = null;           // позиция начальной прокрутки ленты
    for (const m of slotsOf(B.bd)) {
      const b = document.createElement('button');
      b.type = 'button';
      const night = m >= 1440 && !nightMarked;
      if (m >= 1440) nightMarked = true;
      const past = isToday && m < nowMin + C.lead;
      b.className = chipCls + (m === B.slot ? ' on' : '') + (night ? ' night' : '');
      if (!past && !firstFreeMarked && m !== B.slot) { b.classList.add('near'); firstFreeMarked = true; }
      if (!past && !firstFreeMarked && m === B.slot) firstFreeMarked = true;
      b.textContent = minLabel(m);
      b.dataset.m = String(m);
      b.setAttribute('aria-pressed', m === B.slot ? 'true' : 'false');
      // минимальное время до визита только для сегодняшней даты
      b.disabled = past;
      b.addEventListener('click', () => setSlot(Number(b.dataset.m)));
      if (!past && !anchor) anchor = b;
      if (!past && m === B.slot) anchor = b;
      box.appendChild(b);
    }
    // лента открывается на актуальном времени
    timeAnchor = anchor;
    scrollToAnchor(box);
  }
  function scrollToAnchor(box) {
    if (!box || !timeAnchor || !box.clientWidth) return;
    box.scrollLeft = Math.max(0, timeAnchor.offsetLeft - box.offsetLeft - 4);
  }
  // текст выбранного слота во всех [data-sum]
  function renderSummaryEls() {
    const text = fmt(sget('slotbar.summary'), { date: dateHuman(B.bd), slot: minLabel(B.slot), guests: B.guests, guestsWord: guestsWord(B.guests) });
    document.querySelectorAll('[data-sum]').forEach(el => { el.textContent = text; });
    // подпись под кнопкой мастера
    updateWizardGo();
  }
  function renderSlotbar() {
    if (!sb) return;
    renderDates($('#sbDates'), 'bk-chip');
    renderTimes($('#sbTimes'), 'bk-chip');
    renderGuestUI();
    renderSummaryEls();
    refreshLanes();
  }
  function renderGuestUI() {
    [['#sbGval', '#sbGminus', '#sbGplus'], ['#bkwGval', '#bkwGminus', '#bkwGplus']].forEach(([v, mi, pl]) => {
      const val = $(v); if (val) val.textContent = String(B.guests);
      const minus = $(mi); if (minus) minus.disabled = B.guests <= 1;
      const plus = $(pl); if (plus) plus.disabled = B.guests >= 12;
    });
  }
  function setGuests(n) {
    B.guests = Math.max(1, Math.min(12, n));
    renderGuestUI();
    renderSummaryEls();
    applyStatuses();          // dimmed зависит от числа гостей
    renderWizardList(wizFilter);
    updateCounters();
    syncStepVals();
  }
  async function setDate(bd, keepSlot) {
    B.bd = bd;
    if (!keepSlot) {
      // слот держим в сетке новой даты
      const slots = slotsOf(bd);
      if (!slots.includes(B.slot)) {
        const d = defaultSlot(bd);
        B.slot = d.slot;
      }
    }
    await loadAvailability(bd);
    renderSlotbar();
    renderWizLanes(); // мастер тоже пересобирает сетку слотов
    applyStatuses();
    renderWizardList(wizFilter);
    updateCounters();
    syncStepVals();
  }
  // лёгкое обновление лент без пересоздания чипов
  // подсветка двигается сразу в пульте и в мастере
  function refreshSlotbar() {
    $$('#sbTimes .bk-chip, #bkwTimes .bkw-time').forEach(b => {
      const on = Number(b.dataset.m) === B.slot;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    $$('#sbDates .bk-chip, #bkwDates .bkw-date').forEach(b => {
      const on = addDays(BD0, Number(b.dataset.days)).getTime() === B.bd.getTime();
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    renderSummaryEls();
    refreshLanes();
  }
  /* доматать ленту до выбранного чипа, если он за краем */
  function laneToChip(box) {
    const on = box && box.querySelector('.on');
    if (!on || !box.clientWidth) return;
    const l = on.offsetLeft - box.offsetLeft; // общий offsetParent с лентой
    if (l >= box.scrollLeft && l + on.offsetWidth <= box.scrollLeft + box.clientWidth) return; // уже виден
    box.scrollLeft = Math.max(0, l - (box.clientWidth - on.offsetWidth) / 2);
  }
  function setSlot(m) {
    B.slot = m;
    refreshSlotbar();
    applyStatuses();
    refreshWizardList();
    updateCounters();
    syncStepVals();
    ['#sbTimes', '#bkwTimes'].forEach(s => laneToChip($(s)));
  }

  /* ---------- пульт: свёртка на мобиле и смена времени из шага стола ---------- */
  const csToggle = $('#csToggle');
  if (csToggle && sb) csToggle.addEventListener('click', () => {
    const open = sb.classList.toggle('open');
    csToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) { scrollToAnchor($('#sbTimes')); laneToChip($('#sbTimes')); } // до раскрытия лента нулевой ширины
  });
  // проскроллить к пульту и сфокусировать активный чип
  $$('[data-focus-slot]').forEach(btn => btn.addEventListener('click', () => {
    if (!sb) return;
    sb.scrollIntoView({ behavior: RM ? 'auto' : 'smooth', block: 'center' });
    const on = sb.querySelector('.bk-chip.on') || sb.querySelector('.bk-chip:not(:disabled)');
    if (on) on.focus();
  }));

  /* ---------- клавиатура в лентах чипов: roving tabindex + стрелки ---------- */
  function laneKeys(lane) {
    if (lane.dataset.keys) return;
    lane.dataset.keys = '1';
    lane.addEventListener('keydown', e => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      const chips = [...lane.querySelectorAll('.bk-chip:not(:disabled)')];
      if (!chips.length) return;
      const idx = chips.indexOf(document.activeElement);
      let ni = 0;
      if (e.key === 'ArrowLeft') ni = idx > 0 ? idx - 1 : chips.length - 1;
      else if (e.key === 'ArrowRight') ni = idx < chips.length - 1 ? idx + 1 : 0;
      else if (e.key === 'Home') ni = 0;
      else ni = chips.length - 1;
      chips.forEach(c => c.setAttribute('tabindex', c === chips[ni] ? '0' : '-1'));
      chips[ni].focus();
      e.preventDefault();
    });
  }
  function initLane(lane) {
    laneKeys(lane);
    const chips = [...lane.querySelectorAll('.bk-chip')];
    if (!chips.length) return;
    const on = lane.querySelector('.bk-chip.on') || lane.querySelector('.bk-chip:not(:disabled)');
    chips.forEach(c => c.setAttribute('tabindex', c === on ? '0' : '-1'));
  }
  function refreshLanes() { $$('.bk-chips').forEach(initLane); }
  // колесо мыши крутит ленту чипов горизонтально
  function initWheel() {
    $$('.bk-chips').forEach(lane => {
      if (lane.dataset.wheel) return;
      lane.dataset.wheel = '1';
      const field = lane.closest('.bk-lane') || lane;
      field.addEventListener('wheel', e => {
        if (e.ctrlKey) return; // масштабирование страницы остаётся доступно
        // горизонтальный жест тачпада обрабатывает браузер
        if (Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
        if (!e.deltaY) return;
        e.preventDefault();
        const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? lane.clientWidth : 1;
        lane.scrollLeft += e.deltaY * unit;
      }, { passive: false });
    });
  }
  // статусы карточек мастера без пересоздания DOM
  function refreshWizardList() {
    $$('#bkwList .bkw-card').forEach(card => {
      const t = byId[card.dataset.tableId];
      if (!t) return;
      const st = statusOf(t);
      card.classList.toggle('busy', st === 'busy');
      card.classList.toggle('dimmed', st === 'dimmed');
      card.classList.toggle('sel', B.tableId === t.id && st !== 'busy');
      const mark = card.querySelector('.bkw-card-mark');
      if (mark) {
        mark.className = 'bkw-card-mark ' + (st === 'busy' ? 'busy' : 'free');
        mark.textContent = st === 'busy' ? sget('busy.word') : sget('free.word');
      }
    });
    updateWizardGo();
  }

  /* ---------- счётчики от выбранного слота ---------- */
  function updateCounters() {
    const at = $('#cntAt');
    if (at) at.textContent = fmt(sget('count.atSlot'), { slot: minLabel(B.slot) });
    const tables = TABLES.filter(t => t.zone !== 'bar');
    const cabs = TABLES.filter(t => t.zone === 'vip');
    const bar = TABLES.filter(t => t.zone === 'bar');
    const set = (id, free, total) => {
      const el = document.getElementById(id);
      if (el) el.textContent = fmt(sget('count.of'), { free, total });
    };
    set('cntTables', freeAt(tables, B.slot), tables.length);
    set('cntCabs', freeAt(cabs, B.slot), cabs.length);
    set('cntBar', freeAt(bar, B.slot), bar.length);
  }

  // дисплей пульта: столы и закрытые объекты, без мест у бара
  function fitCount() {
    let n = 0;
    for (const t of TABLES) {
      if (t.zone === 'bar') continue;
      if (busyIntervalAt(t.id, B.slot)) continue; // занят на текущий слот
      if ((t.capacityMax || 1) < B.guests) continue; // не вмещает компанию
      n++;
    }
    return n;
  }

  /* ---------- статусы столов: схема, витрина, список мастера ---------- */
  let selMark = null; // галка выбранного места (доступность без цвета)
  function makeSelMark() {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.innerHTML = '<circle class="sel-mark-bg" r="11"/><text class="sel-mark" y="4.5" text-anchor="middle">✓</text>';
    g.style.display = 'none';
    g.style.pointerEvents = 'none'; // галка не перехватывает тапы
    return g;
  }
  // прозрачные hit-подложки мест не меньше 44px без наложений
  function addHitAreas() {
    const svg = document.querySelector('svg.plan');
    if (!svg) return;
    const wpx = svg.getBoundingClientRect().width;
    if (!wpx) return;
    const perPx = svg.viewBox.baseVal.width / wpx;   // SVG-юнитов в 1 CSS px
    const minUnit = 44 * perPx;                     // 44px в юнитах
    const minGap = Math.max(2, 4 * perPx);          // зазор между соседями ~4px
    $$('.plan .spot').forEach(g => {
      const shape = g.querySelector('.shape');
      if (!shape) return;
      g.querySelector('.hit')?.remove();
      const bb = shape.getBBox();
      const cx = bb.x + bb.width / 2, cy = bb.y + bb.height / 2;
      let hit;
      if (g.classList.contains('seat')) {
        hit = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        hit.setAttribute('cx', String(cx));
        hit.setAttribute('cy', String(cy));
        hit.setAttribute('r', String(Math.min(Math.max(bb.width / 2 + 7, minUnit / 2), (74 - minGap) / 2)));
      } else {
        const isCab = g.classList.contains('cab'), isBig = g.classList.contains('big');
        // высота подложки ограничена шагом столиков в колонке
        const maxH = isCab || isBig ? Infinity : 96 - minGap;
        const w = Math.max(bb.width, Math.min(minUnit, 96 - minGap));
        const h = Math.max(bb.height, Math.min(minUnit, maxH));
        hit = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        hit.setAttribute('x', String(cx - w / 2));
        hit.setAttribute('y', String(cy - h / 2));
        hit.setAttribute('width', String(w));
        hit.setAttribute('height', String(h));
        hit.setAttribute('rx', '4');
      }
      hit.setAttribute('class', 'hit');
      hit.setAttribute('aria-hidden', 'true');
      g.insertBefore(hit, g.firstChild);
    });
  }
  function applyStatuses() {
    const sel = B.tableId ? TABLES.find(t => t.id === B.tableId) : null;
    $$('.plan .spot').forEach(el => {
      const t = byId[el.dataset.tableId];
      if (!t) return;
      const st = statusOf(t);
      el.classList.toggle('busy', st === 'busy');
      el.classList.toggle('dimmed', st === 'dimmed');
      el.classList.toggle('sel', !!sel && t.id === sel.id && st !== 'busy');
      el.setAttribute('tabindex', '0');
      el.setAttribute('aria-label',
        (el.dataset.title || t.label) + ', ' + (el.dataset.cap || '') + ', ' +
        (st === 'busy' ? sget('busy.word') : st === 'dimmed' ? fmt(sget('dimmed.tip'), { n: t.capacityMax, word: guestsGen(t.capacityMax) }) : sget('free.word')));
    });
    // галка выбранного места рисуется после обхода
    if (!selMark) { selMark = makeSelMark(); $('svg.plan').appendChild(selMark); }
    const selEl = sel ? $('.plan .spot.sel') : null;
    if (selEl) {
      const bb = selEl.querySelector('.shape').getBBox();
      selMark.setAttribute('transform', 'translate(' + (bb.x + bb.width - 4) + ',' + (bb.y + 8) + ')');
      selMark.style.display = '';
    } else {
      selMark.style.display = 'none';
    }
    $$('#bkMgrid .bk-mcard').forEach(card => {
      const t = byId[card.dataset.tableId];
      if (!t) return;
      const st = statusOf(t);
      card.classList.toggle('busy', st === 'busy');
      card.classList.toggle('dimmed', st === 'dimmed');
      card.classList.toggle('sel', !!sel && t.id === sel.id && st !== 'busy');
      const mark = card.querySelector('.bk-mstatus');
      if (mark) {
        const m = mstatus(t);
        mark.className = 'bk-mstatus ' + m.cls;
        mark.textContent = m.txt;
      }
    });
    // дисплей пульта: крупное число подходящих свободных мест
    $$('[data-fit-num]').forEach(el => { el.textContent = String(fitCount()); });
    // сброс выбора, если место перестало подходить
    if (B.tableId) {
      const selT = byId[B.tableId];
      if (selT && statusOf(selT) !== 'free') {
        B.tableId = null;
        clearPick();
        syncGridSel(null);
        renderWizardList(wizFilter);
        syncStepVals();
        // возврат к выбору места
        const cur = wiz && wiz.querySelector('.bk-step.on');
        if (cur && Number(cur.dataset.bk) > 1) { maxReached = 1; goto(1); }
      }
    }
  }

  /* ---------- тултип занятого или неподходящего стола ---------- */
  const tip = $('#bkTip');
  const veil = $('.bk-tip-veil');
  let tipTarget = null;
  function openTip(el, t) {
    if (!tip) return;
    tipTarget = el;
    const st = statusOf(t);
    const txt = tip.querySelector('.bk-tip-txt');
    const act = tip.querySelector('.btn');
    // место не вмещает компанию: бронь не предлагаем
    const fits = (t.capacityMax || 1) >= B.guests;
    if (st === 'busy' && fits) {
      const iv = busyIntervalAt(t.id, B.slot);
      const offer = nextOffer(t.id, iv);
      if (offer === null) {
        // занят до закрытия: бронь не предлагаем
        txt.textContent = sget('busy.tillClose');
        act.hidden = true;
      } else {
        txt.textContent = fmt(sget('busy.tip'), { until: minLabel(toBizMin(iv.to)), from: minLabel(offer) });
        act.hidden = false;
        act.textContent = fmt(sget('busy.action'), { time: minLabel(offer) });
        act.dataset.m = String(offer);
        act.dataset.table = t.id;
      }
    } else if (!fits) {
      txt.textContent = fmt(sget('dimmed.tip'), { n: t.capacityMax, word: guestsGen(t.capacityMax) });
      act.hidden = true;
    } else {
      closeTip();
      return;
    }
    const mobile = matchMedia('(max-width: 900px)').matches;
    tip.hidden = false;
    if (!mobile) {
      // тултип в body: позиция от места на схеме в пределах вьюпорта
      const rb = el.getBoundingClientRect();
      const tw = tip.offsetWidth || 262;
      const want = rb.left + scrollX + rb.width / 2 - tw / 2;
      const left = Math.max(scrollX + 10, Math.min(want, scrollX + innerWidth - tw - 10));
      let top = rb.top + scrollY - tip.offsetHeight - 10;
      if (top < scrollY + 8) top = rb.bottom + scrollY + 10;
      tip.style.left = left + 'px';
      tip.style.top = top + 'px';
    } else {
      tip.removeAttribute('style');
      if (veil) veil.classList.add('show');
    }
  }
  function closeTip() {
    if (tip) tip.hidden = true;
    if (veil) veil.classList.remove('show');
    tipTarget = null;
  }
  if (tip) {
    tip.querySelector('.bk-tip-x')?.addEventListener('click', closeTip);
    tip.querySelector('.btn')?.addEventListener('click', () => {
      const m = Number(tip.querySelector('.btn').dataset.m);
      const tableId = tip.querySelector('.btn').dataset.table;
      closeTip();
      // переключить слот на предложенное время и выбрать стол
      selectTable(tableId, () => setSlot(m));
    });
    veil?.addEventListener('click', closeTip);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeTip(); });
  }

  /* ---------- выбор стола ---------- */
  function selectTable(tableId, after) {
    const t = byId[tableId];
    if (!t) return;
    B.tableId = tableId;
    $('#bkE1')?.classList.remove('show'); // подсказка выбора стола больше не нужна
    if (typeof after === 'function') after();
    applyStatuses();
    renderWizardList(wizFilter);
    fillPick(t);
    syncGridSel(tableId);
    syncStepVals();
  }
  function syncGridSel(id) {
    $$('#bkMgrid .bk-mcard').forEach(c => c.classList.toggle('sel', !!id && c.dataset.tableId === id));
    $$('#bkwList .bkw-card').forEach(c => c.classList.toggle('sel', !!id && c.dataset.tableId === id));
  }

  const plan = $('svg.plan');
  if (plan) {
    plan.addEventListener('click', e => {
      const g = e.target.closest('.spot');
      if (!g) return;
      const t = byId[g.dataset.tableId];
      if (!t) return;
      const st = statusOf(t);
      if (st === 'busy' || st === 'dimmed') { openTip(g, t); return; }
      if (B.tableId === t.id) { // повторный клик: снять выбор
        B.tableId = null;
        clearPick();
        applyStatuses(); renderWizardList(wizFilter); syncGridSel(null); syncStepVals();
        maxReached = 1; goto(1); // без выбора дальше шага 01 нельзя
        return;
      }
      selectTable(t.id, () => { if (wiz) goto(1); });
    });
    plan.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const g = e.target.closest('.spot');
      if (!g) return;
      e.preventDefault();
      g.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
  }

  /* ---------- карточка выбранного места (шаг 02 · Стол) ---------- */
  function fillPick(t) {
    const pickBox = $('#bkPick');
    if (!pickBox) return;
    const el = $('.plan .spot[data-table-id="' + t.id + '"]');
    const ph = el ? (el.dataset.photo || '') : '';
    const img = $('#bkPickPh');
    if (img) {
      if (ph) { img.src = ph; img.alt = el.dataset.title || t.label; img.hidden = false; }
      else { img.removeAttribute('src'); img.hidden = true; }
    }
    setText($('#bkPickTtl'), el ? (el.dataset.title || t.label) : t.label);
    setText($('#bkPickCap'), el ? (el.dataset.cap || '') : '');
    setText($('#bkPickNote'), el ? (el.dataset.note || '') : '');
    setText($('#bkPickDep'), depositLine(t));
    pickBox.hidden = false;
    pickBox.classList.remove('is-empty');
  }
  function clearPick() {
    const pickBox = $('#bkPick');
    if (!pickBox) return;
    pickBox.classList.add('is-empty');
    const img = $('#bkPickPh');
    if (img) { img.removeAttribute('src'); img.hidden = true; }
  }
  $('#bkPickX')?.addEventListener('click', () => {
    B.tableId = null;
    clearPick();
    applyStatuses(); renderWizardList(wizFilter); syncGridSel(null); syncStepVals();
    maxReached = 1; goto(1);
    if (!matchMedia('(max-width: 900px)').matches)
      $('.plan-card')?.scrollIntoView({ behavior: RM ? 'auto' : 'smooth', block: 'center' });
  });
  // зум фото выбранного места через window.openShots
  $('#bkPickPh')?.addEventListener('click', function () {
    if (!B.tableId || this.hidden) return;
    openSpotShots(B.tableId, this.currentSrc || this.src);
  });
  // единая точка входа в галерею места
  function openSpotShots(tableId, cover) {
    if (!window.openShots) return;
    const t = byId[tableId];
    if (!t) return;
    const el = $('.plan .spot[data-table-id="' + tableId + '"]');
    const ttl = el ? (el.dataset.title || t.label) : t.label;
    window.openShots(spotShots(el, cover || (el ? el.dataset.photo || '' : ''), ttl), 0);
  }

  // галерея места, без неё лайтбокс показывает обложку
  function spotShots(el, cover, ttl) {
    let list = [];
    if (el && el.dataset.shots) {
      try { list = JSON.parse(el.dataset.shots) || []; } catch (e) { list = []; }
    }
    if (!list.length) return [{ dataset: { full: cover, cap: ttl } }];
    return list.map(s => ({ dataset: { full: s.url, cap: s.cap || ttl } }));
  }

  /* ---------- витрина мест на мобильном (карточки из схемы) ---------- */
  (function buildMobileGrid() {
    const grid = $('#bkMgrid');
    if (!grid) return;
    $$('.plan .spot').forEach(el => {
      const t = byId[el.dataset.tableId];
      if (!t) return;
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'bk-mcard';
      card.dataset.tableId = t.id;
      card.dataset.id = el.dataset.id;
      card.setAttribute('aria-label', el.getAttribute('aria-label') || '');
      card.innerHTML =
        '<span class="bk-mstatus ' + mstatus(t).cls + '">' + mstatus(t).txt + '</span>' +
        '<img src="' + (el.dataset.photo || '') + '" alt="" loading="lazy" decoding="async">' +
        '<span class="bk-mzoom" aria-hidden="true">⤢</span>' +
        '<span class="bk-mbody">' +
          '<span class="bk-mttl">' + (el.dataset.title || t.label) + '</span>' +
          '<span class="bk-mcap">' + (el.dataset.cap || '') + '</span>' +
          '<span class="bk-mdep">' + depositLine(t) + '</span>' +
        '</span>';
      card.addEventListener('click', e => {
        // тап по снимку открывает галерею, по карточке выбирает место
        if (e.target.tagName === 'IMG' || e.target.closest('.bk-mzoom')) { openSpotShots(t.id); return; }
        const st = statusOf(t);
        if (st === 'busy' || st === 'dimmed') { openTip(card, t); return; }
        if (matchMedia('(max-width: 900px)').matches) openWizard(t.id);
        else selectTable(t.id, () => { maxReached = Math.max(maxReached, 2); goto(2); });
      });
      grid.appendChild(card);
    });
  })();

  /* ---------- десктопный аккордеон: шаги ---------- */
  const wiz = $('#bkWizard');
  let maxReached = 1; // сразу доступен только шаг 01
  let steps = wiz ? [...wiz.querySelectorAll('.bk-step')] : [];
  // silent: без прокрутки к блоку брони
  function goto(n, silent) {
    if (!wiz || n > maxReached) return;
    steps.forEach(s => {
      const k = Number(s.dataset.bk);
      s.classList.toggle('on', k === n);
      s.classList.toggle('done', k !== n && k <= maxReached);
      // пройденные шаги доступны с клавиатуры
      const h = s.querySelector('.bk-head');
      if (h) h.tabIndex = (k !== n && k <= maxReached) ? 0 : -1;
    });
    const cur = wiz.querySelector('.bk-step.on');
    if (cur && !silent) cur.scrollIntoView({ behavior: RM ? 'auto' : 'smooth', block: 'nearest' });
  }
  wiz?.addEventListener('click', e => {
    const t = e.target.closest('[data-goto]');
    if (t) goto(Number(t.dataset.goto));
  });
  // Enter/Space на пройденном шаге возвращает к нему
  wiz?.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const h = e.target.closest('[data-goto]');
    if (!h) return;
    e.preventDefault();
    goto(Number(h.dataset.goto));
  });
  function syncStepVals() {
    renderDurationUI(); // список зависит от места (умолчание) и от слота (до закрытия)
    // bkV1: выбранное место, bkV2: гость
    const v1 = $('#bkV1');
    if (v1) {
      const t = B.tableId ? byId[B.tableId] : null;
      const el = t ? $('.plan .spot[data-table-id="' + t.id + '"]') : null;
      v1.textContent = t ? (el ? (el.dataset.title || t.label) : t.label) : sget('step2.valueEmpty');
    }
    const v2 = $('#bkV2');
    if (v2 && B.name) v2.textContent = B.name + ' · ' + B.phone;
  }
  // три шага: стол, гость, подтверждение
  $('#bkTo2')?.addEventListener('click', () => {
    if (!B.tableId) { $('#bkE1')?.classList.add('show'); return; } // без места дальше не идём
    $('#bkE1')?.classList.remove('show');
    maxReached = Math.max(maxReached, 2); goto(2);
  });
  $('#bkTo3')?.addEventListener('click', () => {
    if (!validateWho()) { $('#bkE3')?.classList.add('show'); return; }
    $('#bkE3')?.classList.remove('show');
    maxReached = Math.max(maxReached, 3);
    fillSummary();
    if (!B.idemKey) B.idemKey = uuid();
    goto(3);
  });

  /* ---------- шаг 03: контакты (маска +7, 10 цифр) ---------- */
  function phoneMask(inp) {
    inp.addEventListener('input', () => {
      let d = inp.value.replace(/\D/g, '');
      if (d.startsWith('8')) d = '7' + d.slice(1);
      if (!d.startsWith('7')) d = d ? '7' + d : '';
      d = d.slice(0, 11);
      let out = '';
      if (d.length) out = '+7';
      if (d.length > 1) out += ' ' + d.slice(1, 4);
      if (d.length > 4) out += ' ' + d.slice(4, 7);
      if (d.length > 7) out += '-' + d.slice(7, 9);
      if (d.length > 9) out += '-' + d.slice(9, 11);
      inp.value = out;
    });
  }
  phoneMask($('#bkPhone'));
  phoneMask($('#bkwPhone'));
  const phoneOk = v => /^\+7 ?\d{3} ?\d{3}-\d{2}-\d{2}$/.test(v.trim());

  function validateWho() {
    readWho();
    const nameOk = B.name.length >= 2;
    $('#bkName')?.classList.toggle('err', !nameOk);
    $('#bkwName')?.classList.toggle('err', !nameOk);
    const okPhone = phoneOk(B.phone);
    $('#bkPhone')?.classList.toggle('err', !okPhone);
    $('#bkwPhone')?.classList.toggle('err', !okPhone);
    return nameOk && okPhone;
  }
  function readWho() {
    const name = $('#bkwName')?.value.trim() || $('#bkName')?.value.trim() || '';
    const phone = $('#bkwPhone')?.value.trim() || $('#bkPhone')?.value.trim() || '';
    const comment = $('#bkwComment')?.value.trim() || $('#bkComment')?.value.trim() || '';
    B.name = name; B.phone = phone; B.comment = comment;
  }
  // синхронизация аккордеона и мастера
  [['bkName', 'bkwName'], ['bkPhone', 'bkwPhone'], ['bkComment', 'bkwComment']].forEach(([a, b]) => {
    const ea = $('#' + a), eb = $('#' + b);
    if (!ea || !eb) return;
    ea.addEventListener('input', () => { if (eb.value !== ea.value) eb.value = ea.value; });
    eb.addEventListener('input', () => { if (ea.value !== eb.value) ea.value = eb.value; });
  });

  /* ---------- шаг 04: подтверждение и заявка ---------- */
  function fillSummary() {
    const t = B.tableId ? byId[B.tableId] : null;
    const el = t ? $('.plan .spot[data-table-id="' + t.id + '"]') : null;
    const spotLabel = t ? (el ? (el.dataset.title || t.label) : t.label) : sget('summary.noSpot');
    const rows = {
      1: spotLabel + (el && el.dataset.cap ? ' (' + el.dataset.cap + ')' : ''),
      2: dateShort(B.bd) + ', ' + minLabel(B.slot) + ' · ' + durLabel(durOf(B.tableId)),
      3: B.name + ' · ' + B.phone,
      4: String(B.guests),
      5: t ? depSum(t) : ''
    };
    ['bkS1', 'bkS2', 'bkS3', 'bkS4', 'bkS5'].forEach((id, i) => setText($('#' + id), rows[i + 1]));
    ['bkwS1', 'bkwS2', 'bkwS3', 'bkwS4', 'bkwS5'].forEach((id, i) => setText($('#' + id), rows[i + 1]));
  }
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() :
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    }));
  async function submit() {
    if (B.pendingSubmit || !B.tableId) return;
    const agree = $('#bkAgree')?.checked || $('#bkwAgree')?.checked;
    if (!agree) {
      $('#bkE4')?.classList.add('show');
      $('#bkwE4')?.classList.add('show');
      return;
    }
    $('#bkE4')?.classList.remove('show');
    $('#bkwE4')?.classList.remove('show');
    if (!B.idemKey) B.idemKey = uuid();
    B.pendingSubmit = true;
    setSubmitUI(true);
    const payload = {
      businessDate: iso(B.bd),
      slot: minLabel(B.slot),
      tableId: B.tableId,
      guests: B.guests,
      durationMinutes: durOf(B.tableId),
      name: B.name,
      phone: '+7' + B.phone.replace(/\D/g, '').slice(1),
      comment: B.comment,
      source: 'site'
    };
    if (window.O62_CAPTCHA) {
      try { payload.captchaToken = await window.O62_CAPTCHA.token(); } catch (e) {}
    }
    let bookingId = null, paymentUrl = null;
    try {
      const res = await createBooking(payload, B.idemKey);
      bookingId = res.bookingId;
      paymentUrl = res.paymentUrl || null;
    } catch (e) {
      setSubmitUI(false);
      B.pendingSubmit = false;
      if (e.status === 409) { handleTaken(e.body || {}); return; }
      if (e.status === 429) { showError(sget('error.429')); return; }
      if (e.status === 403) { showError((e.body && e.body.message) || sget('error.generic')); return; }
      if (e.status === 422) { showError(sget('error.422')); goto(2); return; }
      // иначе ошибка, повтор с тем же Idempotency-Key
      showError(sget('error.generic'));
      return;
    }
    if (paymentUrl) { location.href = paymentUrl; return; } // задел под оплату
    const t = byId[B.tableId];
    const spotLabel = $('.plan .spot[data-table-id="' + t.id + '"]')?.dataset.title || t.label;
    const summary = {
      id: bookingId,
      spot: spotLabel,
      date: dateShort(B.bd),
      time: minLabel(B.slot),
      guests: B.guests,
      ts: Date.now()
    };
    try { localStorage.setItem('o62booking', JSON.stringify(summary)); } catch (e) {}
    B.pendingSubmit = false;
    setSubmitUI(false); // сброс кнопки и спиннера
    showSuccess(summary);
  }
  function setSubmitUI(wait) {
    [['#bkSubmit', '#bkWait'], ['#bkwGo', null]].forEach(([btnSel]) => {
      const btn = $(btnSel);
      if (!btn) return;
      btn.disabled = wait;
    });
    $('#bkWait')?.classList.toggle('show', wait);
  }
  function showError(text) {
    const box = $('#bkErrBox');
    if (box) { box.textContent = text; box.classList.add('show'); }
    const wbox = $('#bkwErrBox');
    if (wbox) { wbox.textContent = text; wbox.classList.add('show'); }
  }
  function hideErrors() {
    $('#bkErrBox')?.classList.remove('show');
    $('#bkwErrBox')?.classList.remove('show');
  }
  // 409 table_taken: подставить свободный стол из alternatives
  // слот вне сетки дня не применяем
  function handleTaken(body) {
    const alt = (body.alternatives || [])
      .map(id => byId[id])
      .find(t => t && t.id !== B.tableId && statusOf(t) === 'free');
    if (alt) {
      const old = byId[B.tableId];
      const oldEl = old ? $('.plan .spot[data-table-id="' + old.id + '"]') : null;
      const altEl = $('.plan .spot[data-table-id="' + alt.id + '"]');
      selectTable(alt.id);
      fillSummary(); // пересобрать сводку с новым столом
      showError(fmt(sget('taken.alt'), {
        from: old ? (oldEl ? (oldEl.dataset.title || old.label) : old.label) : '',
        to: altEl ? (altEl.dataset.title || alt.label) : alt.label
      }));
      return;
    }
    const nf = body.nearestFreeAt;
    const m = nf ? toBizMin(nf) : null;
    const ok = m !== null && slotsOf(B.bd).includes(m);
    if (ok) setSlot(m);
    alertTableTaken(ok ? nf : null);
  }
  function alertTableTaken(nearestFreeAt) {
    showError(sget('tableTaken') + (nearestFreeAt ? ' · ' + fmt(sget('busy.action'), { time: nearestFreeAt }) : ''));
  }
  ['#bkSubmit', '#bkwGo'].forEach(sel => $(sel)?.addEventListener('click', () => {
    // шаг 04 отправляет заявку, остальные листают
    if (sel === '#bkwGo' && wstep !== 4) { wizardGo(); return; }
    if (sel === '#bkwGo' && wstep === 4) { submit(); return; }
    submit();
  }));

  /* ---------- success-экран и плашка активной заявки ---------- */
  const successBox = $('#bkSuccess');
  function showSuccess(s) {
    if (!successBox) return;
    setText($('#bkSuccessTitle'), sget('success.title'));
    setText($('#bkSuccessLine'), fmt(sget('success.line'), { spot: s.spot, date: s.date, time: s.time }));
    setText($('#bkSuccessBtn'), sget('success.close'));
    if (wiz) wiz.hidden = true;
    if (sb) sb.hidden = true;
    closeTip();
    if (bkw && !bkw.hidden) closeWizard();
    successBox.hidden = false;
    successBox.scrollIntoView({ behavior: RM ? 'auto' : 'smooth', block: 'center' });
    B.idemKey = null;
  }
  $('#bkSuccessBtn')?.addEventListener('click', () => {
    successBox.hidden = true;
    if (wiz) wiz.hidden = false;
    if (sb) sb.hidden = false;
  });
  function renderPending() {
    const box = $('#bkPending');
    if (!box) return;
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem('o62booking') || 'null'); } catch (e) {}
    if (!saved || !saved.spot) { box.classList.remove('show'); box.hidden = true; return; }
    setText($('#bkPendingLabel'), sget('pending.exists'));
    setText($('#bkPendingLine'), fmt(sget('pending.line'), { spot: saved.spot, date: saved.date, time: saved.time }));
    setText($('#bkPendingReset'), sget('pending.reset'));
    box.hidden = false;
    requestAnimationFrame(() => box.classList.add('show'));
  }
  $('#bkPendingReset')?.addEventListener('click', () => {
    try { localStorage.removeItem('o62booking'); } catch (e) {}
    renderPending();
  });

  /* ---------- мобильный полноэкранный мастер ---------- */
  const bkw = $('#bkw');
  let wstep = 1;
  let wLastFocus = null;
  let wizFilter = 'all';
  const wizMeta = {
    1: { name: sget('wizard.stepName1'), title: sget('wizard.step1Title'), go: sget('wizard.go') },
    2: { name: sget('wizard.stepName2'), title: sget('wizard.step2Title'), go: sget('wizard.go') },
    3: { name: sget('wizard.stepName3'), title: sget('wizard.step3Title'), go: sget('wizard.go') },
    4: { name: sget('wizard.stepName4'), title: sget('wizard.step4Title'), go: sget('phase0.submit') }
  };
  let bkwListBuilt = false;
  function renderWizardList(filter) {
    wizFilter = filter || wizFilter;
    const list = $('#bkwList');
    if (!list || !bkwListBuilt) return;
    list.innerHTML = '';
    TABLES.forEach(t => {
      const kind = tableKind(t);
      if (wizFilter !== 'all' && kind !== wizFilter) return;
      const el = $('.plan .spot[data-table-id="' + t.id + '"]');
      const st = statusOf(t);
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'bkw-card' + (st !== 'free' ? ' ' + st : '') + (B.tableId === t.id ? ' sel' : '');
      card.dataset.tableId = t.id;
      card.setAttribute('aria-label', (el ? el.getAttribute('aria-label') : t.label) || '');
      card.innerHTML =
        '<span class="bkw-card-ph">' +
          '<img src="' + (el ? el.dataset.photo || '' : '') + '" alt="" loading="lazy" decoding="async">' +
          '<span class="bkw-card-zoom" aria-hidden="true">⤢</span>' +
        '</span>' +
        '<span class="bkw-card-txt">' +
          '<b>' + (el ? el.dataset.title || t.label : t.label) + '</b>' +
          '<span class="bkw-card-cap">' + (el ? el.dataset.cap || '' : '') + '</span>' +
          '<span class="bkw-card-dep">' + depositLine(t) + '</span>' +
        '</span>' +
        '<span class="bkw-card-mark ' + (st === 'busy' ? 'busy' : 'free') + '">' + (st === 'busy' ? sget('busy.word') : sget('free.word')) + '</span>';
      card.addEventListener('click', e => {
        // левая сторона карточки открывает галерею
        if (e.target.closest('.bkw-card-ph')) { openSpotShots(t.id); return; }
        if (st === 'busy' || st === 'dimmed') { openTip(card, t); return; }
        selectTable(t.id);
        setTimeout(() => gotoWizardStep(3), 220);
      });
      list.appendChild(card);
    });
    updateWizardGo();
  }
  $('#bkwFilters')?.addEventListener('click', e => {
    const f = e.target.closest('.bkw-filter');
    if (!f) return;
    $$('.bkw-filter').forEach(x => x.classList.toggle('on', x === f));
    renderWizardList(f.dataset.f);
    // фильтр по вместимости учитывает число гостей через статусы
    void B.guests;
  });
  $('#bkwGminus')?.addEventListener('click', () => setGuests(B.guests - 1));
  $('#bkwGplus')?.addEventListener('click', () => setGuests(B.guests + 1));
  $('#sbGminus')?.addEventListener('click', () => setGuests(B.guests - 1));
  $('#sbGplus')?.addEventListener('click', () => setGuests(B.guests + 1));

  function fillSelchips() {
    const t = B.tableId ? byId[B.tableId] : null;
    const el = t ? $('.plan .spot[data-table-id="' + t.id + '"]') : null;
    [['bkwSelchip3', 'bkwSelPh3', 'bkwSelTtl3', 'bkwSelSub3']].forEach(ids => {
      const chip = $('#' + ids[0]);
      if (!chip) return;
      if (!t) { chip.hidden = true; return; }
      chip.hidden = false;
      $('#' + ids[1]).src = el ? el.dataset.photo || '' : '';
      $('#' + ids[2]).textContent = el ? el.dataset.title || t.label : t.label;
      $('#' + ids[3]).textContent = (el ? el.dataset.cap || '' : '') + ' · ' + depositLine(t);
    });
  }
  $('#bkwSelPh3')?.addEventListener('click', () => { if (B.tableId) openSpotShots(B.tableId); });
  $('#bkwSelX3')?.addEventListener('click', () => gotoWizardStep(2));
  $('#bkwChangeWhen')?.addEventListener('click', () => gotoWizardStep(1));

  function updateWizardGo() {
    const go = $('#bkwGo');
    const hint = $('#bkwFootHint');
    if (!go) return;
    let disabled = false, label = wizMeta[wstep].go, hintText = '';
    if (wstep === 1) {
      hintText = dateHuman(B.bd) + ' · ' + minLabel(B.slot) + ' · ' + B.guests + ' ' + guestsWord(B.guests);
    } else if (wstep === 2) {
      disabled = !B.tableId;
      hintText = disabled ? sget('wizard.hintSelectSpot') : fmt(sget('wizard.hintSelected'), { spot: byId[B.tableId]?.label });
    } else if (wstep === 3) {
      hintText = sget('wizard.hintContacts');
    } else if (wstep === 4) {
      hintText = sget('phase0.note');
    }
    if (B.pendingSubmit) { go.disabled = true; return; }
    go.disabled = disabled;
    go.textContent = label;
    if (hint) { hint.hidden = !hintText; hint.textContent = hintText; }
  }
  function wizardGo() {
    if (wstep === 1) { gotoWizardStep(2); return; }
    if (wstep === 2) {
      if (!B.tableId) return;
      gotoWizardStep(3); return;
    }
    if (wstep === 3) {
      if (!validateWho()) { $('#bkwE3')?.classList.add('show'); return; }
      $('#bkwE3')?.classList.remove('show');
      if (!B.idemKey) B.idemKey = uuid();
      fillSummary();
      gotoWizardStep(4); return;
    }
  }
  function gotoWizardStep(n) {
    if (!bkw) return;
    wstep = Math.max(1, Math.min(4, n));
    $$('#bkw .bkw-step').forEach(s => s.classList.toggle('on', Number(s.dataset.bkw) === wstep));
    $$('#bkw .bkw-prog i').forEach((seg, i) => seg.classList.toggle('on', i < wstep));
    setText($('#bkwKicker'), fmt(sget('wizard.kicker'), { n: pad(wstep), name: wizMeta[wstep].name }));
    setText($('#bkwTitle'), wizMeta[wstep].title);
    if (wstep === 1) renderWizLanes();
    if (wstep === 2) {
      if (!bkwListBuilt) { bkwListBuilt = true; }
      const line = $('#bkwSlotLineText');
      if (line) line.textContent = dateHuman(B.bd) + ' · ' + minLabel(B.slot) + ' · ' + B.guests + ' ' + guestsWord(B.guests);
      renderWizardList(wizFilter);
    }
    if (wstep === 3) { fillSelchips(); renderGuestUI(); }
    if (wstep === 4) { fillSummary(); }
    const body = $('#bkwBody');
    if (body) body.scrollTop = 0;
    updateWizardGo();
  }
  function renderWizLanes() {
    if (!bkw || bkw.hidden || wstep !== 1) return;
    renderDates($('#bkwDates'), 'bkw-date');
    renderTimes($('#bkwTimes'), 'bkw-time');
  }
  function openWizard(preSlotTableId) {
    if (!bkw) return;
    wLastFocus = document.activeElement;
    bkw.hidden = false;
    requestAnimationFrame(() => bkw.classList.add('open'));
    document.body.classList.add('bkw-open');
    const t = preSlotTableId ? byId[preSlotTableId] : null;
    if (t && statusOf(t) === 'free') {
      selectTable(t.id);
      gotoWizardStep(3);
    } else {
      gotoWizardStep(1);
    }
  }
  function closeWizard() {
    if (!bkw || bkw.hidden) return;
    bkw.classList.remove('open');
    document.body.classList.remove('bkw-open');
    setTimeout(() => { bkw.hidden = true; }, 300);
    if (wLastFocus && wLastFocus.focus) wLastFocus.focus();
  }
  $('#bkwBack')?.addEventListener('click', () => { if (wstep === 1) closeWizard(); else gotoWizardStep(wstep - 1); });
  $('#bkwX')?.addEventListener('click', closeWizard);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && bkw && !bkw.hidden) closeWizard(); });
  $('#bkOpen')?.addEventListener('click', () => openWizard(B.tableId || null));
  $$('a[href="#bron"]').forEach(a => {
    a.addEventListener('click', e => {
      const holder = a.closest('[data-spot]');
      const spot = holder ? holder.dataset.spot : null;
      // десктоп: заранее выбрать стол, якорь ведёт к брони
      if (!matchMedia('(max-width: 900px)').matches) {
        const t = spot ? byId[spot] : null;
        if (t && statusOf(t) === 'free') selectTable(t.id);
        return;
      }
      e.preventDefault();
      openWizard(spot || B.tableId || null);
    });
  });

  /* ---------- контракт data-table-id: сверка схемы и конфига ---------- */
  TABLES.forEach(t => {
    if (!$('.plan .spot[data-table-id="' + t.id + '"]'))
      console.warn('[b62] на схеме нет стола из конфига:', t.id);
  });

  /* ---------- старт: дефолтный слот подставлен сразу ---------- */
  const def = defaultSlot(BD0);
  B.bd = def.bd;
  B.slot = def.slot;
  // слот-бар рисуется до загрузки занятости
  renderSlotbar();
  initWheel();
  syncStepVals();
  await loadAvailability(B.bd);
  applyStatuses();
  updateCounters();
  syncStepVals();
  renderPending();
  addHitAreas();
  // пересчёт hit-подложек при смене масштаба схемы
  let hitT;
  addEventListener('resize', () => { clearTimeout(hitT); hitT = setTimeout(addHitAreas, 180); }, { passive: true });
  if (wiz) goto(1, true);
  window.B62.api = { getConfig, getAvailability, createBooking };
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

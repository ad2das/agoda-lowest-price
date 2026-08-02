// ==UserScript==
// @name         Agoda Always Lowest Price (아고다 최저가 도우미)
// @namespace    nyx.agoda.lowest
// @version      1.8.0
// @description  전 세계 아고다 숙소 최저가 도우미 — 전 범위 적응형 CID 탐색/재검증, 2인 유효 최저가 자동 선택, 세금포함 총액, 쿠폰 자동시도
// @author       Nyx
// @match        https://www.agoda.com/*
// @match        https://agoda.com/*
// @match        https://m.agoda.com/*
// @updateURL    https://raw.githubusercontent.com/ad2das/agoda-lowest-price/main/agoda-userscript.user.js
// @downloadURL  https://raw.githubusercontent.com/ad2das/agoda-lowest-price/main/agoda-userscript.user.js
// @homepageURL  https://github.com/ad2das/agoda-lowest-price
// @supportURL   https://github.com/ad2das/agoda-lowest-price/issues
// @run-at       document-start
// @inject-into  page
// @noframes
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const NAME = 'AGODA_MIN_PRICE';
  const store = {
    get(key, def) {
      try {
        const raw = localStorage.getItem(NAME + ':' + key);
        return raw ? JSON.parse(raw) : def;
      } catch (e) { return def; }
    },
    set(key, val) {
      try { localStorage.setItem(NAME + ':' + key, JSON.stringify(val)); } catch (e) {}
    }
  };

  const DEFAULTS = {
    highlight: true,
    autoSelect: true,
    promoHunt: true,
    currencyAuto: true,
    watchPrice: true,
    cidFix: true,
    taxFactor: 1.265,
    promoList: [
      'OAWAGODA', 'OAWACTIVITY', 'AWESAMAGODA', 'AGODA2026', 'NEWUSER8',
      'JPKR88', 'JOSHDELACRUZ', 'ROLDAGODA', 'THELUDOVICES', 'ENZOAGODA',
      'JOSHAGODA', 'ROLDFAGODA', 'HELLOAGODA5', 'AGODADEAL8', 'AGODAENZO',
      'AL5', 'ACTFORYOU', 'SORALAGODA', 'INATOTRAVEL', 'SINGTEL6OFF',
      'TEAMLUDOVICE', 'HELLOCAMZ'
    ],
    favoriteCurrencies: ['KRW', 'JPY', 'USD', 'EUR', 'THB', 'IDR', 'VND', 'PHP', 'MYR', 'SGD']
  };
  const settings = Object.assign({}, DEFAULTS, store.get('settings', {}));
  const saveSettings = () => store.set('settings', settings);
  const nativeFetch = typeof window.fetch === 'function' ? window.fetch : null;
  hookCidCapture();

  const CURRENCY_SYMBOLS = {
    'US$': 'USD', 'S$': 'SGD', 'HK$': 'HKD', 'A$': 'AUD', 'C$': 'CAD',
    'NZ$': 'NZD', 'CN¥': 'CNY', 'R$': 'BRL', 'RM': 'MYR', 'Rp': 'IDR',
    '$': 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY', '₩': 'KRW', '￦': 'KRW',
    '฿': 'THB', '₹': 'INR', '₫': 'VND', '₱': 'PHP', '₺': 'TRY',
    '₴': 'UAH', 'zł': 'PLN', 'CHF': 'CHF', '원': 'KRW', '엔': 'JPY'
  };
  const PRICE_RE = /(?:US\$|S\$|HK\$|A\$|C\$|NZ\$|CN¥|R\$|RM|Rp|zł|CHF|\$|€|£|¥|₩|￦|฿|₹|₫|₱|₺|₴)\s?([\d][\d,.]*)/;
  const CURRENCY_CODE_RE = /\b(?:KRW|USD|JPY|EUR|GBP|CNY|HKD|SGD|THB|IDR|MYR|PHP|VND|TWD|AUD|CAD|CHF|NZD|INR|AED|BRL|TRY|MXN|ZAR|PLN|SEK|NOK|DKK|CZK|UAH)\b/i;
  const HAS_CURRENCY_RE = /^(?:[₩$¥€£฿₹₫₱₺₴]+|(?:US|S|HK|A|C|NZ)\$|CN¥|Rp|RM|zł|CHF|원|엔|[A-Z]{3}\b)/i;
  const PURE_PRICE_RE = /^(?:[₩$¥€£฿₹₫₱₺₴]+|(?:US|S|HK|A|C|NZ)\$|CN¥|Rp|RM|zł|CHF)?\s*[\d][\d,.]*\s*(?:원|엔|[A-Z]{3})?$/i;

  const SEL = {
    offerCell: '[data-selenium="ChildRoomsList-roomCell"]',
    priceDisplay: '[data-selenium="PriceDisplay"]',
    bookButton: '[data-selenium="ChildRoomsList-bookButtonInput"]',
    masterRoom: '[data-selenium="MasterRoom"]',
    roomGrid: '[data-selenium="roomgrid-container"], [data-selenium="RoomGridFilter-container"]',
    promoInput: 'input[placeholder*="promo" i], input[placeholder*="coupon" i], input[placeholder*="쿠폰" i], input[placeholder*="코드" i], input[id*="promo" i], input[name*="promo" i], [data-selenium*="promo" i] input, [data-selenium*="Promo" i] input, [data-selenium*="Coupon" i] input'
  };

  const OCC_1ADULT_RE = /성인\s*1\s*명|1\s*adult|大人\s*1\s*名|1名|1人|for\s*1\s*person|1인\s*기준|\(1인|1인\s*(?:기준|이용)|1\s*person\b/i;
  const OCC_EXCEEDED_RE = /인원\s*초과|인원.{0,6}(불가|제한)|초과.{0,4}(불가|제한)|선택\s*불가|매진|exceed|maximum\s*(?:occupancy|guest)|max\s*guest|定員|超過|満室|sold\s*out/i;
  const PER_NIGHT_RE = /1박당\s*요금|per\s*night|1泊(?:あたり)?/i;
  const TOTAL_RE = /(?:\d+\s*(?:nights?|박(?!당)|泊(?!あ))|(?:총액|total))/i;
  const NOISE_RE = /UserEngagement|Review|breadcrumb|ScreenReaderOnly|StickyNav|이용후기|리뷰|レビュー|후기/i;
  const CELL_FP_RE = /1박당|per\s*night|1泊|총액|total/i;

  const DEFAULT_CID = -1;
  const CID_FIXED_FLAG = 'nyx-cid-fixed-from';
  const CID_CACHE_TTL = 30 * 60 * 1000;
  const CID_CONCURRENCY = 4;
  const CID_REQUEST_TIMEOUT = 12000;
  const CID_REQUEST_INTERVAL = 200;
  const CID_RANGE_MAX = 9999999;
  const CID_RANGE_SAMPLE_COUNT = 48;
  const CID_MAX_CANDIDATES = 150;
  const CID_VERIFY_ROUNDS = 2;

  const PROBE_POOL = (() => {
    const pool = new Set([
      -1, 2, 101, 501, 1000, 5000, 9900, 10000, 10400, 11500, 11600,
      16001, 16100, 16300, 16500, 17200, 17500,
      23100, 25200, 25400, 25600, 26000, 27000, 28300, 29300, 31200, 31900,
      33200, 36400, 38000, 40400, 41100, 44800, 46300, 47999, 48000, 48400,
      63700, 65000, 66800, 68300, 75000, 78800, 79600, 80400, 82100, 120000,
      150000, 190838, 210000, 255000, 285000, 500000, 750000, 1000000,
      1100000, 1234567, 1500000, 1800000, 1844103, 1844104, 1844105,
      2000000, 2500000, 3000000, 5000000, 7500000, 9000000, 9999999
    ]);
    return [...pool];
  })();

  let capturedLegacyTemplate = null;
  let capturedRoomGridTemplate = null;
  let cidSweepPromise = null;
  let cidStatus = { phase: 'idle', done: 0, total: 0, source: null };
  let cidNextRequestAt = 0;

  function normalizeCid(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isInteger(n) && n >= -1 && n <= CID_RANGE_MAX ? n : null;
  }

  function currentCid() {
    try { return normalizeCid(new URL(location.href).searchParams.get('cid')); }
    catch (e) { return null; }
  }

  function isPropertyPage() {
    return /\/hotel\/|\/property\//.test(location.pathname);
  }

  function requestUrl(input) {
    if (typeof input === 'string' || input instanceof URL) return String(input);
    return input && typeof input.url === 'string' ? input.url : '';
  }

  function pickedHeaders(source) {
    const out = {};
    try {
      const headers = new Headers(source || {});
      ['ag-cid', 'ag-initiator-api-key', 'ag-initiator-version', 'ag-language-locale',
        'ag-request-attempt', 'ag-retry-attempt', 'ag-user-id', 'x-gate-meta']
        .forEach(k => { const v = headers.get(k); if (v) out[k] = v; });
    } catch (e) {}
    return out;
  }

  function captureCidParamsFrom(urlStr) {
    if (!urlStr || !urlStr.includes('GetSecondaryData')) return;
    try {
      const u = new URL(urlStr, location.href);
      const params = u.searchParams;
      if (!params.get('hotel_id')) return;
      capturedLegacyTemplate = {
        url: u.pathname + u.search,
        hotelId: params.get('hotel_id'),
        cid: normalizeCid(params.get('cid')),
        capturedAt: Date.now()
      };
    } catch (e) {}
  }

  function saveRoomGridTemplate(urlStr, headers, bodyText) {
    try {
      const body = typeof bodyText === 'string' ? JSON.parse(bodyText) : bodyText;
      if (!body || !body.propertyId || !body.searchCriteria) return;
      const u = new URL(urlStr, location.href);
      capturedRoomGridTemplate = {
        url: u.pathname + u.search,
        body: JSON.parse(JSON.stringify(body)),
        headers: pickedHeaders(headers),
        hotelId: String(body.propertyId),
        cid: normalizeCid(new Headers(headers || {}).get('ag-cid')),
        capturedAt: Date.now()
      };
    } catch (e) {}
  }

  function captureCidRequest(input, init) {
    const url = requestUrl(input);
    if (!url) return;
    captureCidParamsFrom(url);
    if (!url.includes('/api/v1/property/room-grid')) return;
    try {
      const request = typeof Request !== 'undefined' && input instanceof Request ? input : null;
      const headers = (init && init.headers) || (request && request.headers) || {};
      const directBody = init && init.body;
      if (typeof directBody === 'string') saveRoomGridTemplate(url, headers, directBody);
      else if (request) request.clone().text().then(t => saveRoomGridTemplate(url, headers, t)).catch(() => {});
    } catch (e) {}
  }

  function hookCidCapture() {
    try {
      if (nativeFetch) {
        window.fetch = function (...args) {
          captureCidRequest(args[0], args[1]);
          return nativeFetch.apply(this, args);
        };
      }
    } catch (e) {}
    try {
      const xhrMeta = new WeakMap();
      const origOpen = XMLHttpRequest.prototype.open;
      const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;
      const origSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function (method, url) {
        xhrMeta.set(this, { url: String(url || ''), headers: {} });
        captureCidParamsFrom(url);
        return origOpen.apply(this, arguments);
      };
      XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
        const meta = xhrMeta.get(this);
        if (meta) meta.headers[name] = value;
        return origSetHeader.apply(this, arguments);
      };
      XMLHttpRequest.prototype.send = function (body) {
        const meta = xhrMeta.get(this);
        if (meta && meta.url.includes('/api/v1/property/room-grid') && typeof body === 'string') {
          saveRoomGridTemplate(meta.url, meta.headers, body);
        }
        return origSend.apply(this, arguments);
      };
    } catch (e) {}
  }

  function hotelIdFromDom() {
    try {
      const html = document.documentElement.innerHTML;
      const m = html.match(/"(?:hotelId|propertyId)"\s*:\s*"?(\d+)"?/) || html.match(/hotel_id=(\d+)/);
      if (m) return m[1];
    } catch (e) {}
    return null;
  }

  function urlCriteria() {
    const q = new URL(location.href).searchParams;
    return {
      checkIn: q.get('checkIn') || q.get('checkin') || '',
      checkOut: q.get('checkOut') || q.get('checkout') || '',
      los: q.get('los') || '1',
      rooms: q.get('rooms') || '1',
      adults: q.get('adults') || '2',
      children: q.get('children') || '0',
      curr: (q.get('curr') || '').toUpperCase()
    };
  }

  function pageCurrencyKey() {
    const fromUrl = urlCriteria().curr;
    if (fromUrl) return fromUrl;
    try {
      const m = document.cookie.match(/(?:^|;\s*)agoda\.version\.03=([^;]+)/);
      const label = m && decodeURIComponent(m[1]).match(/(?:^|&)CurLabel=([^&]+)/i);
      if (label) return label[1].toUpperCase();
    } catch (e) {}
    return '';
  }

  function probeContext() {
    const fromUrl = urlCriteria();
    if (capturedRoomGridTemplate) {
      const b = capturedRoomGridTemplate.body;
      const sc = b.searchCriteria || {};
      const ages = sc.childrenAges || sc.childAges || [];
      return {
        source: 'room-grid', hotelId: String(b.propertyId),
        checkIn: sc.checkIn || fromUrl.checkIn,
        checkOut: sc.checkOut || fromUrl.checkOut,
        los: fromUrl.los, rooms: String(sc.rooms || fromUrl.rooms),
        adults: String(sc.adults || fromUrl.adults),
        children: String(Array.isArray(ages) ? ages.length : (sc.children || fromUrl.children)),
        curr: pageCurrencyKey() || String((b.userContext && b.userContext.currencyId) || ''),
        activeCid: capturedRoomGridTemplate.cid ?? currentCid() ?? DEFAULT_CID
      };
    }
    if (capturedLegacyTemplate) {
      const q = new URL(capturedLegacyTemplate.url, location.href).searchParams;
      return {
        source: 'secondary', hotelId: capturedLegacyTemplate.hotelId,
        checkIn: q.get('checkIn') || fromUrl.checkIn,
        checkOut: q.get('checkOut') || fromUrl.checkOut,
        los: q.get('los') || fromUrl.los, rooms: q.get('rooms') || fromUrl.rooms,
        adults: q.get('adults') || fromUrl.adults,
        children: q.get('children') || fromUrl.children,
        curr: (q.get('curr') || pageCurrencyKey() || '').toUpperCase(),
        activeCid: capturedLegacyTemplate.cid ?? currentCid() ?? DEFAULT_CID
      };
    }
    const hid = hotelIdFromDom();
    if (!hid) return null;
    return Object.assign({ source: 'secondary', hotelId: hid, activeCid: currentCid() ?? DEFAULT_CID }, fromUrl);
  }

  function criteriaSignature(ctx = probeContext()) {
    if (!ctx || !ctx.hotelId) return null;
    let stayLength = Number(ctx.los) || 1;
    if (ctx.checkIn && ctx.checkOut) {
      const start = Date.parse(ctx.checkIn), end = Date.parse(ctx.checkOut);
      if (Number.isFinite(start) && Number.isFinite(end) && end > start) stayLength = Math.round((end - start) / 86400000);
    }
    return [ctx.hotelId, ctx.checkIn, stayLength, ctx.rooms, ctx.adults, ctx.children, ctx.curr]
      .map(v => encodeURIComponent(String(v || ''))).join('|');
  }

  function cidCacheKey(ctx = probeContext()) {
    const sig = criteriaSignature(ctx);
    return sig ? 'cid:v2:' + sig : null;
  }

  function getCidCache(ctx = probeContext()) {
    const key = cidCacheKey(ctx);
    if (!key) return null;
    const c = store.get(key, null);
    if (!c || c.cacheVersion !== 3 || !c.ts || !c.verifiedAt || Date.now() - c.ts > CID_CACHE_TTL) return null;
    return c;
  }

  function setCidCache(data, ctx = probeContext()) {
    const key = cidCacheKey(ctx);
    if (key) store.set(key, Object.assign({ ts: Date.now(), criteria: criteriaSignature(ctx) }, data));
  }

  function clearCidCache(ctx = probeContext()) {
    const key = cidCacheKey(ctx);
    if (!key) return;
    try { localStorage.removeItem(NAME + ':' + key); } catch (e) {}
  }

  function rememberedCids() {
    const list = store.get('cid:winners', []);
    return Array.isArray(list) ? list.map(normalizeCid).filter(v => v !== null) : [];
  }

  function rememberCid(cid) {
    cid = normalizeCid(cid);
    if (cid === null) return;
    const list = [cid, ...rememberedCids().filter(v => v !== cid)].slice(0, 30);
    store.set('cid:winners', list);
  }

  function visiblePageCids() {
    const found = [];
    try {
      document.querySelectorAll('a[href*="cid="]').forEach(a => {
        if (found.length >= 50) return;
        const cid = normalizeCid(new URL(a.href, location.href).searchParams.get('cid'));
        if (cid !== null) found.push(cid);
      });
    } catch (e) {}
    return found;
  }

  function hashString(value) {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i++) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function seededRandom(seed) {
    return () => {
      seed |= 0;
      seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function stratifiedRangeCids(ctx, salt, count = CID_RANGE_SAMPLE_COUNT) {
    const random = seededRandom(hashString((criteriaSignature(ctx) || location.pathname) + '|' + salt));
    const out = [];
    for (let i = 0; i < count; i++) {
      const start = Math.max(1, Math.floor(i * CID_RANGE_MAX / count));
      const end = Math.max(start, Math.floor((i + 1) * CID_RANGE_MAX / count) - 1);
      out.push(start + Math.floor(random() * (end - start + 1)));
    }
    return out;
  }

  function neighboringCids(cid) {
    cid = normalizeCid(cid);
    if (cid === null || cid < 0) return [];
    return [-1000, -100, -10, -2, -1, 1, 2, 10, 100, 1000]
      .map(offset => normalizeCid(cid + offset)).filter(v => v !== null);
  }

  function buildProbeList(ctx, salt = Math.floor(Date.now() / CID_CACHE_TTL)) {
    const cids = new Set();
    const add = value => { value = normalizeCid(value); if (value !== null) cids.add(value); };
    [ctx && ctx.activeCid, currentCid(), capturedLegacyTemplate && capturedLegacyTemplate.cid,
      capturedRoomGridTemplate && capturedRoomGridTemplate.cid].forEach(add);
    const remembered = rememberedCids().slice(0, 10);
    remembered.forEach(add);
    visiblePageCids().forEach(add);
    PROBE_POOL.forEach(add);
    stratifiedRangeCids(ctx, salt).forEach(add);
    [1844104, ...remembered.slice(0, 2)].flatMap(neighboringCids).forEach(add);
    return [...cids].slice(0, CID_MAX_CANDIDATES);
  }

  async function fetchJson(url, init = {}, attempts = 2) {
    const fetcher = nativeFetch || window.fetch;
    if (!fetcher) throw new Error('fetch unavailable');
    let lastError = null;
    for (let attempt = 0; attempt < attempts; attempt++) {
      const slot = Math.max(Date.now(), cidNextRequestAt);
      cidNextRequestAt = slot + CID_REQUEST_INTERVAL + Math.floor(Math.random() * 50);
      if (slot > Date.now()) await sleep(slot - Date.now());
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), CID_REQUEST_TIMEOUT);
      try {
        const r = await fetcher.call(window, url, Object.assign({ credentials: 'same-origin', cache: 'no-store' }, init, { signal: controller.signal }));
        if (!r.ok) {
          const error = new Error('HTTP ' + r.status);
          error.status = r.status;
          throw error;
        }
        return await r.json();
      } catch (e) {
        lastError = e;
        if (attempt + 1 < attempts) await sleep(500 * (attempt + 1) + Math.random() * 300);
      } finally { clearTimeout(timer); }
    }
    throw lastError || new Error('request failed');
  }

  function numericAmount(value) {
    if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
    if (typeof value !== 'string') return null;
    let s = value.replace(/[^\d.,-]/g, '');
    if (!s) return null;
    const lastDot = s.lastIndexOf('.'), lastComma = s.lastIndexOf(',');
    const decimalAt = Math.max(lastDot, lastComma);
    if (decimalAt >= 0 && s.length - decimalAt - 1 <= 2) {
      const whole = s.slice(0, decimalAt).replace(/[.,]/g, '');
      const fraction = s.slice(decimalAt + 1).replace(/[.,]/g, '');
      s = whole + '.' + fraction;
    } else s = s.replace(/[.,]/g, '');
    const n = Number(s);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  function extractModernTotal(j) {
    const values = [];
    for (const room of (j && j.rooms || [])) {
      if (room.isOccupancyExceeded === true) continue;
      for (const offer of (room.offers || [])) {
        const v = numericAmount(offer.analyticsContext && offer.analyticsContext.hotel_price_per_book);
        if (v !== null) values.push(v);
      }
    }
    const cheapest = numericAmount(j && j.cheapestPrice && j.cheapestPrice.analyticsContext && j.cheapestPrice.analyticsContext.hotel_price_per_book);
    if (cheapest !== null) values.push(cheapest);
    return values.length ? Math.min(...values) : null;
  }

  function extractLegacyTotal(j, ctx) {
    const values = [];
    const adults = Number(ctx.adults) || 2;
    for (const master of (j && j.roomGridData && j.roomGridData.masterRooms || [])) {
      for (const room of (master.rooms || [])) {
        const occupancy = Number(room.occupancy || room.adults || 0);
        if (room.isFit === false || (occupancy && occupancy < adults) || Number(room.availability) === 0) continue;
        const candidates = [
          room.pricing && room.pricing.displaySummary && room.pricing.displaySummary.perBook && room.pricing.displaySummary.perBook.displayTotal && room.pricing.displaySummary.perBook.displayTotal.allInclusive,
          room.paymentOption && room.paymentOption.amountPayNow,
          room.totalPrice && room.totalPrice.display,
          room.inclusivePrice
        ];
        const v = candidates.map(numericAmount).find(x => x !== null);
        if (v !== undefined) values.push(v);
      }
    }
    return values.length ? Math.min(...values) : null;
  }

  function modernProbeHeaders(template, cid) {
    const headers = Object.assign({}, template.headers, { 'ag-cid': String(cid), 'content-type': 'application/json' });
    const uid = headers['ag-user-id'];
    try { if (uid) headers['x-gate-meta'] = btoa(`${Date.now()}|${uid}|${new URL(template.url, location.href).pathname}`); }
    catch (e) {}
    return headers;
  }

  async function probeModernCid(cid, ctx) {
    const t = capturedRoomGridTemplate;
    if (!t || String(t.hotelId) !== String(ctx.hotelId)) return { total: null, ok: false, status: 0 };
    try {
      const j = await fetchJson(t.url, {
        method: 'POST', headers: modernProbeHeaders(t, cid),
        body: JSON.stringify(t.body)
      });
      return { total: extractModernTotal(j), ok: true, status: 200 };
    } catch (e) { return { total: null, ok: false, status: e.status || 0 }; }
  }

  function legacyProbeUrl(cid, ctx) {
    let u;
    if (capturedLegacyTemplate && String(capturedLegacyTemplate.hotelId) === String(ctx.hotelId)) {
      u = new URL(capturedLegacyTemplate.url, location.href);
    } else {
      u = new URL('/api/cronos/property/BelowFoldParams/GetSecondaryData', location.href);
      const q = u.searchParams;
      if (ctx.checkIn) q.set('checkIn', ctx.checkIn);
      if (ctx.checkOut) q.set('checkOut', ctx.checkOut);
      q.set('los', ctx.los || '1'); q.set('rooms', ctx.rooms || '1');
      q.set('adults', ctx.adults || '2'); q.set('children', ctx.children || '0');
      if (ctx.curr && !/^\d+$/.test(ctx.curr)) q.set('curr', ctx.curr);
      q.set('hotel_id', ctx.hotelId); q.set('all', 'false');
      q.set('isHostPropertiesEnabled', 'true'); q.set('price_view', '0');
      q.set('sessionid', 'x'); q.set('pagetypeid', '7'); q.set('attributionInfos', '32|-1');
    }
    u.searchParams.set('cid', String(cid));
    return u.pathname + u.search;
  }

  async function probeLegacyCid(cid, ctx) {
    try {
      const j = await fetchJson(legacyProbeUrl(cid, ctx), { headers: { accept: 'application/json' } });
      return { total: extractLegacyTotal(j, ctx), ok: true, status: 200 };
    } catch (e) { return { total: null, ok: false, status: e.status || 0 }; }
  }

  async function runCidSweep(list, source, ctx, onProgress) {
    const results = new Map();
    const stats = { attempted: 0, ok: 0, noPrice: 0, httpErrors: 0, stopped: false };
    let next = 0, done = 0, consecutiveErrors = 0;
    const worker = async () => {
      while (true) {
        if (stats.stopped) return;
        const index = next++;
        if (index >= list.length) return;
        const cid = list[index];
        const outcome = source === 'room-grid' ? await probeModernCid(cid, ctx) : await probeLegacyCid(cid, ctx);
        const total = outcome.total;
        stats.attempted++;
        if (outcome.ok) {
          stats.ok++;
          consecutiveErrors = 0;
          if (total === null) stats.noPrice++;
        } else {
          stats.httpErrors++;
          consecutiveErrors++;
          if (consecutiveErrors >= 8) stats.stopped = true;
        }
        if (total !== null) results.set(cid, total);
        done++;
        cidStatus = { phase: 'scanning', done, total: list.length, source };
        if (onProgress) onProgress(done, list.length, cid, total);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CID_CONCURRENCY, list.length) }, () => worker()));
    return { results, stats };
  }

  async function verifyCidCandidates(results, source, ctx, activeCid) {
    const ranked = [...results.entries()].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    const candidates = [];
    [activeCid, ...ranked.slice(0, 3).map(x => x[0])].forEach(cid => {
      if (!candidates.includes(cid)) candidates.push(cid);
    });
    const samples = new Map(candidates.map(cid => [cid, []]));
    const total = candidates.length * CID_VERIFY_ROUNDS;
    let done = 0;
    cidStatus = { phase: 'verifying', done: 0, total, source };
    notify(`최저 후보 재검증 — ${candidates.length}개 × ${CID_VERIFY_ROUNDS}회`);
    for (let round = 0; round < CID_VERIFY_ROUNDS; round++) {
      for (const cid of candidates) {
        const outcome = source === 'room-grid' ? await probeModernCid(cid, ctx) : await probeLegacyCid(cid, ctx);
        done++;
        cidStatus = { phase: 'verifying', done, total, source };
        if (!outcome.ok || outcome.total === null) return null;
        samples.get(cid).push(outcome.total);
      }
    }
    const verified = new Map();
    for (const [cid, values] of samples) {
      if (values.length !== CID_VERIFY_ROUNDS) return null;
      verified.set(cid, values.reduce((sum, value) => sum + value, 0) / values.length);
    }
    return verified;
  }

  async function waitForProbeContext() {
    for (let i = 0; i < 30; i++) {
      const ctx = probeContext();
      if (ctx && ctx.hotelId && ctx.checkIn) return ctx;
      await sleep(400);
    }
    return probeContext();
  }

  async function ensureCheapCid(options = {}) {
    if (!settings.cidFix || !isPropertyPage()) return;
    if (cidSweepPromise) return cidSweepPromise;
    cidSweepPromise = (async () => {
      const ctx = await waitForProbeContext();
      if (!ctx || !ctx.hotelId || !ctx.checkIn) {
        notify('cid 검색 실패 — 호텔/날짜 정보를 불러오지 못했어');
        return;
      }
      const startSignature = criteriaSignature(ctx);
      if (options.force) {
        clearCidCache(ctx);
        try { sessionStorage.removeItem(CID_FIXED_FLAG); } catch (e) {}
      }
      const cached = options.force ? null : getCidCache(ctx);
      const activeCid = normalizeCid(ctx.activeCid) ?? DEFAULT_CID;
      if (cached && cached.bestCid !== undefined) {
        cidStatus = { phase: 'cached', done: cached.validCount || 0, total: cached.candidateCount || 0, source: cached.source };
        if (cached.bestCid === null || cached.bestCid === activeCid) return;
        notify(`저장된 최저 cid ${cached.bestCid} 적용`);
        redirectToCid(cached.bestCid, activeCid, ctx);
        return;
      }

      const list = buildProbeList(ctx, options.force ? Date.now() : undefined);
      let source = capturedRoomGridTemplate && String(capturedRoomGridTemplate.hotelId) === String(ctx.hotelId) ? 'room-grid' : 'secondary';
      notify(`저가 채널(cid) 검색 시작 — ${list.length}개, ${source === 'room-grid' ? '최신 API' : '호환 API'}`);
      let sweep = await runCidSweep(list, source, ctx, (done, total) => {
        if (done % 20 === 0 || done === total) notify(`cid 검색 ${done}/${total}...`);
      });
      let results = sweep.results;
      let completed = sweep.stats.attempted === list.length && !sweep.stats.stopped;

      const minimumValid = Math.max(3, Math.ceil(list.length * 0.15));
      if (source === 'room-grid' && (!completed || results.size < minimumValid || !results.has(activeCid))) {
        notify('최신 API 응답이 부족해 호환 API를 소수 표본으로 확인 중...');
        const sampleList = [...new Set([activeCid, DEFAULT_CID, 2, 10000, 16100, 48000, ...rememberedCids()])]
          .filter(cid => normalizeCid(cid) !== null).slice(0, 8);
        source = 'secondary';
        const sampleSweep = await runCidSweep(sampleList, source, ctx, (done, total) => {
          if (done === total) notify(`호환 표본 ${done}/${total} 확인`);
        });
        if (sampleSweep.results.size >= 2 && sampleSweep.results.has(activeCid) && !sampleSweep.stats.stopped) {
          const sampled = new Set(sampleList);
          const remaining = list.filter(cid => !sampled.has(cid));
          notify('호환 API 표본 정상 — 전체 후보 확인 중...');
          const restSweep = await runCidSweep(remaining, source, ctx, (done, total) => {
            if (done % 20 === 0 || done === total) notify(`호환 검색 ${done}/${total}...`);
          });
          results = new Map([...sampleSweep.results, ...restSweep.results]);
          completed = sampleSweep.stats.attempted === sampleList.length &&
            restSweep.stats.attempted === remaining.length && !restSweep.stats.stopped;
        } else {
          results = sampleSweep.results;
          completed = false;
        }
      }

      const scannedBaselineTotal = results.get(activeCid);
      if (!completed || results.size < 2 || scannedBaselineTotal === undefined) {
        cidStatus = { phase: 'error', done: results.size, total: list.length, source };
        notify(`cid 검색 중단 — 서버 제한 또는 유효 응답 부족 (${results.size}/${list.length}), 잠시 후 다시 검색해줘`);
        return;
      }
      if (criteriaSignature() !== startSignature) {
        notify('검색 조건이 바뀌어 이전 cid 결과를 폐기했어');
        return;
      }

      const verified = await verifyCidCandidates(results, source, ctx, activeCid);
      if (!verified || !verified.has(activeCid)) {
        cidStatus = { phase: 'error', done: results.size, total: list.length, source };
        notify('최저 후보 재검증 실패 — 가격이 안정된 뒤 다시 검색해줘');
        return;
      }
      if (criteriaSignature() !== startSignature) {
        notify('재검증 중 검색 조건이 바뀌어 결과를 폐기했어');
        return;
      }

      const baselineTotal = verified.get(activeCid);
      let bestCid = activeCid, bestTotal = baselineTotal;
      for (const [cid, total] of verified) {
        if (total < bestTotal) { bestCid = cid; bestTotal = total; }
      }
      const priceKeys = new Set([...verified.values()].map(v => Number(v).toFixed(4)));
      const epsilon = Math.max(0.01, baselineTotal * 0.0001);
      const isBetter = bestTotal < baselineTotal - epsilon;
      const noDifference = priceKeys.size === 1;
      const cacheData = {
        cacheVersion: 3,
        bestCid: noDifference ? null : bestCid, bestTotal, baselineCid: activeCid,
        baselineTotal, noCheap: !isBetter, source,
        validCount: results.size, candidateCount: list.length,
        verifiedCount: verified.size, verifiedAt: Date.now()
      };
      setCidCache(cacheData, ctx);
      cidStatus = { phase: 'done', done: results.size, total: list.length, source };

      if (noDifference) {
        notify(`cid별 가격 차이 없음 — ${formatNum(bestTotal)} (${results.size}개 확인)`);
        return;
      }
      if (!isBetter) {
        rememberCid(activeCid);
        notify(`현재 cid ${activeCid}가 최저 — ${formatNum(baselineTotal)}`);
        return;
      }
      rememberCid(bestCid);
      const saved = baselineTotal - bestTotal;
      const percent = baselineTotal > 0 ? saved / baselineTotal * 100 : 0;
      notify(`검증 최저 cid ${bestCid} 발견 — ${formatNum(bestTotal)} (${formatNum(saved)}, ${percent.toFixed(1)}% 절약)`);
      redirectToCid(bestCid, activeCid, ctx);
    })().finally(() => { cidSweepPromise = null; });
    return cidSweepPromise;
  }

  function redirectToCid(cid, fromCid, ctx = probeContext()) {
    try {
      const sig = criteriaSignature(ctx) || location.pathname;
      const token = { sig, cid, ts: Date.now() };
      const oldRaw = sessionStorage.getItem(CID_FIXED_FLAG);
      const old = oldRaw ? JSON.parse(oldRaw) : null;
      if (old && old.sig === sig && old.cid === cid && Date.now() - old.ts < 3 * 60 * 1000) {
        notify('반복 이동을 막았어 — [CID 다시 검색]으로 재시도 가능');
        return;
      }
      const url = new URL(location.href);
      url.searchParams.set('cid', String(cid));
      sessionStorage.setItem(CID_FIXED_FLAG, JSON.stringify(token));
      location.replace(url.toString());
    } catch (e) { notify('cid URL 적용 실패: ' + e.message); }
  }

  function nightsFromUrl() {
    const m = location.search.match(/[?&]los=(\d+)/);
    return m ? parseInt(m[1], 10) || 1 : 1;
  }

  function localeCode() {
    const m = location.pathname.match(/^\/([a-z]{2})-([a-z]{2})\//);
    return m ? m[1] : 'ko';
  }

  function taxFactorForLocale() {
    const map = {
      ja: 1.265, ko: 1.1, th: 1.177, in: 1.18, id: 1.11, ph: 1.12, vn: 1.15,
      my: 1.06, sg: 1.097, tw: 1.05, hk: 1.0, cn: 1.0, us: 1.0, gb: 1.2,
      de: 1.19, fr: 1.2, es: 1.21, it: 1.22, au: 1.1, nz: 1.15, ca: 1.13
    };
    return map[localeCode()] || 1.1;
  }

  function isVisible(el) {
    if (!el || el.closest('script,style,head,noscript')) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function findPriceElsGeneric(root) {
    const out = [];
    const containers = [
      '[data-selenium*="roomgrid" i]', '[data-selenium*="RoomGrid" i]',
      '[data-selenium*="ChildRoomsList" i]', '#room-grid', '[class*="room-grid" i]',
      '[data-selenium="MasterRoom"]'
    ];
    let scope = null;
    for (const c of containers) {
      try { scope = root.querySelector(c); } catch (e) {}
      if (scope) break;
    }
    if (!scope) scope = root;
    const leaves = [];
    try { leaves.push(...scope.querySelectorAll('*')); } catch (e) {}
    const cellPicked = new Map();
    const cellOf = el => {
      const c = el.closest(SEL.offerCell);
      if (c) return c;
      let p = el.parentElement, depth = 0;
      while (p && depth < 4) { if (p.children.length >= 3 || (p.textContent || '').length > 400) return p; p = p.parentElement; depth++; }
      return el.parentElement || el;
    };
    const tryLeaf = (el, allowBare) => {
      if (el.children.length > 0) return;
      const t = (el.textContent || '').trim();
      if (!t || t.length > 40 || !/[\d]/.test(t) || !isVisible(el)) return;
      const hasCurrency = HAS_CURRENCY_RE.test(t);
      if (!hasCurrency && !allowBare) return;
      const p = parsePrice(t);
      if (!p) return;
      const cell = cellOf(el);
      if (!cell) return;
      let n = el, noise = false;
      for (let d = 0; d < 5 && n; d++) {
        if (NOISE_RE.test(n.className || '')) { noise = true; break; }
        n = n.parentElement;
      }
      if (noise || NOISE_RE.test(cell.className || '')) return;
      const cellTxt = (cell.innerText || '').replace(/\s+/g, ' ');
      if (!CELL_FP_RE.test(cellTxt)) return;
      const score = PURE_PRICE_RE.test(t) ? 2 : 1;
      const existing = cellPicked.get(cell);
      if (existing && existing.score >= score) return;
      if (existing) {
        const idx = out.indexOf(existing.el);
        if (idx >= 0) out.splice(idx, 1);
      }
      cellPicked.set(cell, { el, score });
      out.push({ el, cell });
    };
    for (const el of leaves) tryLeaf(el, false);
    for (const el of leaves) tryLeaf(el, true);
    return out;
  }

  function parsePrice(text) {
    const t = text.trim();
    if (!t || t.length > 40) return null;
    let numStr = null;
    let currency = '?';
    const symPrefix = t.match(/^((?:US|S|HK|A|C|NZ)\$|CN¥|Rp|RM|zł|CHF|[₩$¥€£฿₹₫₱₺₴])\s*([\d][\d,.]*)/i);
    const codePrefix = t.match(CURRENCY_CODE_RE);
    const symSuffix = t.match(/^([\d][\d,.]*)\s*(원|엔|(?:US|S|HK|A|C|NZ)\$|CN¥|Rp|RM|zł|CHF|[₩$¥€£฿₹₫₱₺₴]|[A-Z]{3})?$/i);
    if (symPrefix) {
      numStr = symPrefix[2];
      currency = CURRENCY_SYMBOLS[symPrefix[1]] || CURRENCY_SYMBOLS[symPrefix[1].toUpperCase()] || '?';
    } else if (symSuffix && symSuffix[1]) {
      numStr = symSuffix[1];
      if (symSuffix[2]) currency = CURRENCY_SYMBOLS[symSuffix[2].toUpperCase()] || (symSuffix[2].length === 3 ? symSuffix[2].toUpperCase() : '?');
    } else if (codePrefix) {
      const rest = t.slice(codePrefix.index + codePrefix[0].length).trim();
      const n = rest.match(/^([\d][\d,.]*)/);
      if (n) { numStr = n[1]; currency = codePrefix[0].toUpperCase(); }
    }
    if (!numStr) {
      const bare = t.match(/^[\d][\d,.]*$/);
      if (bare) numStr = bare[0];
    }
    if (!numStr) return null;
    if ((numStr.match(/\./g) || []).length > 1) numStr = numStr.replace(/\./g, ',');
    const num = parseFloat(numStr.replace(/,/g, ''));
    if (isNaN(num) || num <= 0 || num > 1000000000) return null;
    if (currency === '?' && num < 100) return null;
    return { value: num, raw: t, currency };
  }

  function collectPrices(root) {
    const found = [];
    const seen = new Set();
    let pds = [];
    let genericCells = null;
    try { pds = [...root.querySelectorAll(SEL.priceDisplay)]; } catch (e) {}
    if (pds.length === 0) {
      const g = findPriceElsGeneric(root);
      if (g.length > 0) {
        pds = g.map(x => x.el);
        genericCells = g;
      }
    }
    if (pds.length === 0) return found;

    for (let i = 0; i < pds.length; i++) {
      const pd = pds[i];
      if (!isVisible(pd)) continue;
      const text = (pd.textContent || '').trim();
      const price = parsePrice(text);
      if (!price) continue;
      const cell = genericCells ? genericCells[i].cell : (pd.closest(SEL.offerCell) || null);
      if (!cell || seen.has(cell)) continue;
      const cellText = (cell.innerText || '').replace(/\s+/g, ' ');
      if (OCC_1ADULT_RE.test(cellText) || OCC_EXCEEDED_RE.test(cellText)) continue;
      const room = cell.closest(SEL.masterRoom);
      const roomNameEl = room ? room.querySelector('[data-selenium="masterroom-title-name"], [data-selenium="MasterRoom-headerTitle"]') : null;
      const roomName = roomNameEl ? roomNameEl.textContent.trim() : '';
      if (OCC_1ADULT_RE.test(roomName)) continue;
      const perNightTaxM = cellText.match(new RegExp('(?:' + PER_NIGHT_RE.source + ')\\s*[^\\d]*([\\d][\\d,.]*)', 'i'));
      const totalM = cellText.match(new RegExp('(?:' + TOTAL_RE.source + ')[^\\d]*([\\d][\\d,.]*)(?!\\s*(?:nights?|박|泊))', 'i'));
      found.push({
        cell, el: pd, price, text, roomName,
        perNightTax: perNightTaxM ? parseFloat(perNightTaxM[1].replace(/,/g, '')) : null,
        explicitTotal: totalM ? parseFloat(totalM[1].replace(/,/g, '')) : null
      });
    }
    if (found.length === 0) {
      try {
        const sticky = root.querySelector('div.StickyNavPrice__priceDetail, [class*="StickyNavPrice" i] [class*="price" i]');
        if (sticky && isVisible(sticky)) {
          const price = parsePrice((sticky.textContent || '').trim());
          if (price) found.push({ cell: null, el: sticky, price, text: price.raw, roomName: '', perNightTax: null, explicitTotal: null });
        }
      } catch (e) {}
    }
    return found;
  }

  function highlightLowest(prices) {
    document.querySelectorAll('.nyx-agoda-lowest-badge').forEach(b => b.remove());
    document.querySelectorAll('.nyx-agoda-lowest-outline').forEach(el => el.classList.remove('nyx-agoda-lowest-outline'));
    if (prices.length === 0) return;
    const min = Math.min(...prices.map(p => p.price.value));
    prices.forEach(p => {
      if (p.price.value !== min || !p.cell) return;
      p.cell.classList.add('nyx-agoda-lowest-outline');
      p.cell.style.outline = '2px solid #22c55e';
      p.cell.style.outlineOffset = '2px';
      p.cell.style.borderRadius = '8px';
      const badge = document.createElement('div');
      badge.className = 'nyx-agoda-lowest-badge';
      badge.textContent = '⬇ 최저가';
      Object.assign(badge.style, {
        position: 'absolute', top: '8px', right: '8px', zIndex: '9999',
        background: '#22c55e', color: '#fff', padding: '3px 10px',
        borderRadius: '999px', fontSize: '12px', fontWeight: '700',
        boxShadow: '0 2px 8px rgba(34,197,94,.5)', pointerEvents: 'none'
      });
      if (getComputedStyle(p.cell).position === 'static') p.cell.style.position = 'relative';
      p.cell.appendChild(badge);
    });
  }

  function autoSelectLowest(prices) {
    if (prices.length < 2) return;
    const isPropertyPage = /\/hotel\/|\/property\//.test(location.pathname);
    if (!isPropertyPage) return;
    const min = Math.min(...prices.map(p => p.price.value));
    const target = prices.find(p => p.price.value === min);
    if (!target) return;
    if (!target.cell) return;
    const btn = target.cell.querySelector(SEL.bookButton);
    if (btn && isVisible(btn) && btn.disabled !== true) {
      try { target.cell.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
      setTimeout(() => btn.click(), 400);
      notify(`최저가 방 선택됨: ${target.price.raw} ${target.roomName}`);
    }
  }

  function bookLowestNow(prices, retries = 0) {
    if (prices.length === 0) {
      if (retries < 4) {
        notify(`최저가 셀 탐색 중... (${retries + 1}/4)`);
        setTimeout(() => bookLowestNow(collectPrices(document), retries + 1), 3000);
      } else {
        notify('최저가 셀을 못 찾았어 — 스크린샷과 [진단] 로그를 알려줘');
      }
      return;
    }
    const min = Math.min(...prices.map(p => p.price.value));
    const target = prices.find(p => p.price.value === min);
    if (!target) { notify('최저가 셀 없음'); return; }
    if (!target.cell) { notify(`최저가 확인: ${target.price.raw} — 객실 카드 로드 대기 중. 스크롤하면 재탐색해`); return; }
    const btn = target.cell.querySelector(SEL.bookButton) || target.cell.querySelector('button, a[href*="book"], [role="button"]');
    if (btn) {
      try { target.cell.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
      setTimeout(() => btn.click(), 400);
      notify(`🎯 최저가 예약 진행: ${target.price.raw} (1박) — ${target.roomName}`);
    } else {
      notify('예약 버튼을 못 찾았어 — 직접 클릭해줘');
    }
  }

  function setNativeValue(el, value) {
    const proto = Object.getPrototypeOf(el);
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  async function tryPromoCode(code) {
    const input = findPromoInput();
    if (!input) return { code, ok: false, reason: 'no-input' };
    const applyBtn = findApplyButton();
    setNativeValue(input, code);
    await sleep(400);
    if (applyBtn) applyBtn.click();
    else input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    await sleep(3000);
    const discountText = readDiscount();
    return { code, ok: discountText !== null, reason: discountText !== null ? discountText : 'no-discount' };
  }

  function findPromoInput() {
    try {
      const el = document.querySelector(SEL.promoInput);
      if (el && isVisible(el)) return el;
    } catch (e) {}
    return null;
  }

  function findApplyButton() {
    const btns = document.querySelectorAll('button, [role="button"], a.btn');
    for (const b of btns) {
      if (!isVisible(b)) continue;
      const t = (b.textContent || '').trim().toLowerCase();
      if (/^apply|적용|使用|redeem/.test(t) && t.length < 12) return b;
    }
    return null;
  }

  function readDiscount() {
    const candidates = document.querySelectorAll('[class*="discount" i], [class*="promo" i], [class*="coupon" i], [data-selenium*="discount" i]');
    for (const c of candidates) {
      if (!isVisible(c)) continue;
      const t = (c.textContent || '').trim();
      if (PRICE_RE.test(t) && /discount|할인|saved|savings|-|−/i.test(t) && t.length < 200) {
        return t.replace(/\s+/g, ' ').slice(0, 120);
      }
    }
    return null;
  }

  async function promoHunt() {
    const codes = settings.promoList.filter(Boolean);
    if (codes.length === 0 || findPromoInput() === null) {
      notify('결제/예약 페이지에서만 쿠폰 시도 가능해');
      return;
    }
    const results = [];
    for (const code of codes) {
      const r = await tryPromoCode(code);
      results.push(r);
      if (r.ok) notify(`쿠폰 유효: ${code} → ${r.reason}`);
    }
    const valid = results.filter(r => r.ok);
    notify(`쿠폰 검색 완료 — ${valid.length}개 유효`);
    if (valid.length > 0) {
      const best = valid[valid.length - 1];
      await tryPromoCode(best.code);
      notify(`최종 적용: ${best.code}`);
    }
  }

  function currentCurrencyFromUrl() {
    const m = location.search.match(/[?&]curr=([A-Z]{3})/i);
    return m ? m[1].toUpperCase() : null;
  }

  function switchCurrency(code) {
    const url = new URL(location.href);
    url.searchParams.set('curr', code);
    location.href = url.toString();
  }

  const CC_MAP = { 'th': 'THB', 'jp': 'JPY', 'id': 'IDR', 'vn': 'VND', 'kr': 'KRW',
    'my': 'MYR', 'sg': 'SGD', 'ph': 'PHP', 'tw': 'TWD', 'cn': 'CNY', 'hk': 'HKD',
    'in': 'INR', 'ae': 'AED', 'us': 'USD', 'gb': 'GBP', 'de': 'EUR', 'fr': 'EUR',
    'es': 'EUR', 'it': 'EUR', 'au': 'AUD', 'nz': 'NZD', 'ca': 'CAD', 'ch': 'CHF' };

  function suggestHotelCurrency() {
    const m = location.pathname.match(/\/([a-z]{2})-([a-z]{2})\//) || location.pathname.match(/\.([a-z]{2})\.html/);
    if (!m) return null;
    const cc = m[1] || m[2];
    return CC_MAP[cc] || null;
  }

  function priceHistoryKey() {
    const m = location.pathname.match(/^\/(?:[a-z]{2}-[a-z]{2}\/)?([^/]+)\/hotel\//) || location.pathname.match(/^\/(?:[a-z]{2}-[a-z]{2}\/)?([^/]+)\/property\//);
    return m ? m[1] : location.pathname.split('/').filter(Boolean).pop() || 'home';
  }

  function recordPrice(minVal) {
    if (!settings.watchPrice) return;
    const key = priceHistoryKey();
    const h = store.get('history:' + key, { min: null, max: null, seen: 0, last: null });
    const now = Date.now();
    if (h.min === null || minVal < h.min) {
      const drop = h.min !== null && minVal < h.min;
      h.min = minVal;
      if (drop) notify(`가격 하락 감지! 최저: ${formatNum(minVal)}`);
      h.updatedAt = now;
    }
    if (h.max === null || minVal > h.max) h.max = minVal;
    h.seen++;
    h.last = minVal;
    store.set('history:' + key, h);
    return h;
  }

  function formatNum(n) {
    return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }

  let scanTimer = null;
  function scheduleScan() {
    if (scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      scan();
    }, 600);
  }

  function logDiagnostics() {
    let pd = 0, cells = 0, grid = false, priceTexts = 0;
    let samples = [];
    try {
      pd = document.querySelectorAll(SEL.priceDisplay).length;
      cells = document.querySelectorAll(SEL.offerCell).length;
      grid = !!document.querySelector('[data-selenium*="roomgrid" i], [data-selenium*="RoomGrid" i], #room-grid');
      const scope = document.querySelector('[data-selenium*="roomgrid" i], [data-selenium*="RoomGrid" i], #room-grid') || document;
      const els = [...scope.querySelectorAll('*')].filter(el => el.children.length === 0 && /[\d]/.test((el.textContent || '').trim()) && (el.textContent || '').trim().length < 40 && isVisible(el));
      priceTexts = els.length;
      samples = els.slice(0, 6).map(el => (el.textContent || '').trim().slice(0, 25));
    } catch (e) {}
    notify(`[진단] PriceDisplay:${pd} 셀:${cells} 그리드:${grid} 가격텍스트:${priceTexts} 예:${samples.join('|')} URL:${location.pathname.slice(0, 50)}`);
  }

  let lastScan = null;
  function scan() {
    if (!settings.highlight && !settings.autoSelect && !settings.watchPrice) return;
    const prices = collectPrices(document);
    if (prices.length === 0) {
      if (settings.watchPrice) logDiagnostics();
      return;
    }
    if (settings.highlight) highlightLowest(prices);
    if (settings.autoSelect) autoSelectLowest(prices);
    if (settings.watchPrice) recordPrice(Math.min(...prices.map(p => p.price.value)));
    const sig = prices.map(p => p.price.value).join('|');
    if (sig !== lastScan) {
      lastScan = sig;
      updatePanel(prices);
    }
  }

  function buildPanel() {
    const panel = document.createElement('div');
    panel.id = 'nyx-agoda-panel';
    panel.innerHTML = `
      <div id="nyx-agoda-panel-head">
        <span>🏷 아고다 최저가</span>
        <button id="nyx-agoda-collapse" title="접기">—</button>
      </div>
      <div id="nyx-agoda-panel-body">
        <div id="nyx-agoda-info">로딩 중...</div>
        <div id="nyx-agoda-controls">
          <label><input type="checkbox" id="nyx-agoda-cfg-highlight" ${settings.highlight ? 'checked' : ''}> 최저가 하이라이트</label>
          <label><input type="checkbox" id="nyx-agoda-cfg-autoselect" ${settings.autoSelect ? 'checked' : ''}> 최저가 방 자동선택</label>
          <label><input type="checkbox" id="nyx-agoda-cfg-promo" ${settings.promoHunt ? 'checked' : ''}> 쿠폰 자동시도</label>
          <label><input type="checkbox" id="nyx-agoda-cfg-watch" ${settings.watchPrice ? 'checked' : ''}> 가격변동 감지</label>
          <label><input type="checkbox" id="nyx-agoda-cfg-cid" ${settings.cidFix ? 'checked' : ''}> 저가 채널(cid) 자동적용</label>
        </div>
        <div id="nyx-agoda-currency">
          <select id="nyx-agoda-curr-sel">
            <option value="">통화 선택...</option>
            ${settings.favoriteCurrencies.map(c => `<option value="${c}">${c}</option>`).join('')}
          </select>
          <button id="nyx-agoda-curr-hotel" title="호텔 현지통화로 전환 (5% 수수료 방지)">🏨 현지통화</button>
        </div>
        <div id="nyx-agoda-actions">
          <button id="nyx-agoda-book-now">🎯 최저가 바로 예약</button>
          <button id="nyx-agoda-cid-rescan">🔎 CID 새 범위 검색</button>
          <button id="nyx-agoda-promo-run">🎟 쿠폰 지금 시도</button>
          <button id="nyx-agoda-promo-edit">쿠폰 목록 편집</button>
        </div>
        <textarea id="nyx-agoda-promo-list" style="display:none" rows="4" placeholder="쿠폰 코드 한 줄에 하나"></textarea>
        <div id="nyx-agoda-log"></div>
      </div>`;
    Object.assign(panel.style, {
      position: 'fixed', top: '80px', right: '16px', zIndex: '99999',
      width: '280px', background: '#fff', border: '1px solid #e2e8f0',
      borderRadius: '12px', boxShadow: '0 8px 30px rgba(0,0,0,.18)',
      fontFamily: 'system-ui, sans-serif', fontSize: '13px', color: '#0f172a'
    });
    panel.querySelector('#nyx-agoda-panel-head').style.cssText =
      'display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:#0f172a;color:#fff;border-radius:12px 12px 0 0;font-weight:700;cursor:move';
    panel.querySelector('#nyx-agoda-panel-body').style.cssText = 'padding:12px;display:block';
    panel.querySelectorAll('label').forEach(l => l.style.cssText = 'display:block;margin:4px 0;cursor:pointer');
    panel.querySelectorAll('button').forEach(b => b.style.cssText =
      'margin:4px 4px 4px 0;padding:6px 10px;background:#0f172a;color:#fff;border:0;border-radius:8px;cursor:pointer;font-size:12px');
    panel.querySelector('#nyx-agoda-curr-sel').style.cssText = 'padding:5px;border-radius:6px;border:1px solid #cbd5e1';
    panel.querySelector('#nyx-agoda-log').style.cssText = 'margin-top:8px;max-height:120px;overflow-y:auto;font-size:11px;color:#64748b;white-space:pre-wrap';
    document.body.appendChild(panel);

    panel.querySelector('#nyx-agoda-collapse').addEventListener('click', () => {
      const body = panel.querySelector('#nyx-agoda-panel-body');
      body.style.display = body.style.display === 'none' ? 'block' : 'none';
    });

    panel.querySelector('#nyx-agoda-cfg-highlight').addEventListener('change', e => {
      settings.highlight = e.target.checked; saveSettings(); scan();
    });
    panel.querySelector('#nyx-agoda-cfg-autoselect').addEventListener('change', e => {
      settings.autoSelect = e.target.checked; saveSettings();
    });
    panel.querySelector('#nyx-agoda-cfg-promo').addEventListener('change', e => {
      settings.promoHunt = e.target.checked; saveSettings();
    });
    panel.querySelector('#nyx-agoda-cfg-watch').addEventListener('change', e => {
      settings.watchPrice = e.target.checked; saveSettings();
    });
    panel.querySelector('#nyx-agoda-cfg-cid').addEventListener('change', e => {
      settings.cidFix = e.target.checked; saveSettings();
      notify(settings.cidFix ? '저가 채널 자동적용 켜짐' : '저가 채널 자동적용 꺼짐');
      if (settings.cidFix) ensureCheapCid();
    });
    panel.querySelector('#nyx-agoda-curr-sel').addEventListener('change', e => {
      if (e.target.value) switchCurrency(e.target.value);
    });
    panel.querySelector('#nyx-agoda-curr-hotel').addEventListener('click', () => {
      const cc = suggestHotelCurrency();
      if (cc) { switchCurrency(cc); notify(`현지통화 ${cc}로 전환`); }
      else notify('현지통화 감지 실패 — 수동 선택해줘');
    });
    panel.querySelector('#nyx-agoda-promo-run').addEventListener('click', () => {
      if (findPromoInput() === null) notify('결제/예약 페이지에서만 실행 가능해');
      else promoHunt();
    });
    panel.querySelector('#nyx-agoda-book-now').addEventListener('click', () => {
      bookLowestNow(collectPrices(document));
    });
    panel.querySelector('#nyx-agoda-cid-rescan').addEventListener('click', () => {
      if (cidSweepPromise) { notify(`cid 검색 진행 중 ${cidStatus.done}/${cidStatus.total}`); return; }
      clearCidCache();
      ensureCheapCid({ force: true });
    });
    panel.querySelector('#nyx-agoda-promo-edit').addEventListener('click', () => {
      const ta = panel.querySelector('#nyx-agoda-promo-list');
      ta.style.display = ta.style.display === 'none' ? 'block' : 'none';
      ta.value = settings.promoList.join('\n');
    });
    panel.querySelector('#nyx-agoda-promo-list').addEventListener('change', e => {
      settings.promoList = e.target.value.split(/\n/).map(s => s.trim()).filter(Boolean);
      saveSettings();
      notify('쿠폰 목록 저장됨');
    });

    let drag = null;
    panel.querySelector('#nyx-agoda-panel-head').addEventListener('mousedown', e => {
      drag = { dx: e.clientX - panel.offsetLeft, dy: e.clientY - panel.offsetTop };
    });
    document.addEventListener('mousemove', e => {
      if (!drag) return;
      panel.style.left = (e.clientX - drag.dx) + 'px';
      panel.style.right = 'auto';
      panel.style.top = (e.clientY - drag.dy) + 'px';
    });
    document.addEventListener('mouseup', () => { drag = null; });

    return panel;
  }

  function updatePanel(prices) {
    const info = document.getElementById('nyx-agoda-info');
    if (!info) return;
    const cur = currentCurrencyFromUrl() || '자동';
    const hotelCur = suggestHotelCurrency();
    const min = prices.length ? Math.min(...prices.map(p => p.price.value)) : null;
    const minP = prices.length ? prices.find(p => p.price.value === min) : null;
    const h = prices.length ? store.get('history:' + priceHistoryKey(), null) : null;
    const cidCtx = probeContext();
    const cid = currentCid() ?? (cidCtx && cidCtx.activeCid);
    const cidCache = getCidCache(cidCtx);
    let html = `통화: <b>${cur}</b>`;
    if (cid !== null) {
      let state = '<span style="color:#94a3b8">미확인</span>';
      if (cidCache) {
        state = cidCache.bestCid === null
          ? '<span style="color:#94a3b8">차이없음</span>'
          : (cidCache.bestCid === cid ? '<span style="color:#22c55e">저가 ✓</span>' : `<span style="color:#dc2626">고가 → ${cidCache.bestCid} 적용</span>`);
      }
      html += `<br>채널: cid <b>${cid}</b> ${state}`;
    }
    if (cidStatus.phase === 'scanning') {
      html += `<br><span style="color:#2563eb">CID 검색: ${cidStatus.done}/${cidStatus.total} (${cidStatus.source === 'room-grid' ? '최신 API' : '호환 API'})</span>`;
    } else if (cidStatus.phase === 'verifying') {
      html += `<br><span style="color:#7c3aed">최저 후보 재검증: ${cidStatus.done}/${cidStatus.total}</span>`;
    } else if (cidStatus.phase === 'error') {
      html += `<br><span style="color:#dc2626">CID 검색 실패 (${cidStatus.done}/${cidStatus.total})</span>`;
    }
    if (hotelCur && cur && cur !== hotelCur) {
      html += ` <span style="color:#dc2626">⚠ 현지통화 ${hotelCur} 아님 → 5% 수수료 위험</span>`;
    }
    if (min !== null && minP) {
      const nights = nightsFromUrl();
      html += `<br>최저(1박, 세전): <b>${formatNum(min)}</b> ${minP.roomName ? '· ' + minP.roomName.slice(0, 26) : ''}`;
      let taxTotal = null;
      if (minP.explicitTotal !== null) taxTotal = minP.explicitTotal;
      else if (minP.perNightTax !== null) taxTotal = minP.perNightTax * nights;
      else taxTotal = Math.round(min * nights * (settings.taxFactor || taxFactorForLocale()));
      html += `<br>${nights}박 세금포함: <b style="color:#22c55e">≈ ${formatNum(taxTotal)}</b>`;
    } else {
      html += `<br>현재 최저(1박): <b>—</b>`;
    }
    if (h && h.min !== null) html += ` · 관찰 최저: <b>${formatNum(h.min)}</b> (${h.seen}회)`;
    info.innerHTML = html;
  }

  function notify(msg) {
    const log = document.getElementById('nyx-agoda-log');
    if (log) {
      const t = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
      log.textContent = `[${t}] ${msg}\n` + log.textContent;
    }
    const info = document.getElementById('nyx-agoda-info');
    if (info) updatePanel(collectPrices(document));
  }

  function init() {
    buildPanel();
    scan();
    const obs = new MutationObserver(() => scheduleScan());
    obs.observe(document.body, { childList: true, subtree: true });
    const cidLocationKey = () => {
      const c = urlCriteria();
      return [location.pathname, c.checkIn, c.checkOut || c.los, c.rooms, c.adults, c.children, c.curr, currentCid() ?? ''].join('|');
    };
    let lastCidNavKey = cidLocationKey();
    setInterval(() => {
      scheduleScan();
      const nextCidNavKey = cidLocationKey();
      if (nextCidNavKey !== lastCidNavKey) {
        lastCidNavKey = nextCidNavKey;
        capturedLegacyTemplate = null;
        capturedRoomGridTemplate = null;
        setTimeout(() => ensureCheapCid(), 3000);
      }
    }, 3000);
    notify('로드됨 — 최저가 스캔 시작');
    if (settings.promoHunt && /payment|checkout|book/.test(location.pathname)) {
      setTimeout(() => { if (findPromoInput()) promoHunt(); }, 3000);
    }
    if (settings.cidFix && isPropertyPage()) {
      setTimeout(() => { ensureCheapCid(); }, 4000);
    }
  }

  try {
    Object.defineProperty(window, '__NYX_AGODA__', {
      configurable: true,
      value: Object.freeze({
        version: '1.8.0',
        getState: () => ({
          criteria: probeContext(), status: Object.assign({}, cidStatus),
          cache: getCidCache(), candidateCount: buildProbeList(probeContext()).length,
          captured: { roomGrid: !!capturedRoomGridTemplate, secondary: !!capturedLegacyTemplate }
        }),
        rescanCid: () => ensureCheapCid({ force: true }),
        clearCidCache: () => clearCidCache()
      })
    });
  } catch (e) {}

  if (document.body) init();
  else document.addEventListener('DOMContentLoaded', init);
})();

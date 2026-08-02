// ==UserScript==
// @name         Agoda Always Lowest Price (아고다 최저가 도우미)
// @namespace    nyx.agoda.lowest
// @version      1.6.0
// @description  전 세계 아고다 숙소 최저가 도우미 — 2인 유효 최저가 자동 선택(다국어), 저가 채널(cid) 자동 적용, 1클릭 예약, 세금포함 총액, 쿠폰 자동시도, 가격 변동 감지
// @author       Nyx
// @match        https://www.agoda.com/*
// @match        https://agoda.com/*
// @match        https://m.agoda.com/*
// @updateURL    https://raw.githubusercontent.com/ad2das/agoda-lowest-price/main/agoda-userscript.user.js
// @downloadURL  https://raw.githubusercontent.com/ad2das/agoda-lowest-price/main/agoda-userscript.user.js
// @homepageURL  https://github.com/ad2das/agoda-lowest-price
// @supportURL   https://github.com/ad2das/agoda-lowest-price/issues
// @run-at       document-start
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

  const DEFAULT_CID = 10000;
  const CID_FIXED_FLAG = 'nyx-cid-fixed-from';
  const CID_CACHE_TTL = 6 * 60 * 60 * 1000;

  const PROBE_POOL = (() => {
    const pool = new Set();
    [101, 501, 1000, 5000, 9900].forEach(c => pool.add(c));
    for (let c = 10000; c <= 98000; c += 2000) pool.add(c);
    for (let c = 100000; c <= 285000; c += 25000) pool.add(c);
    [10000, 10400, 11500, 11600, 16100, 16300, 16500, 17200, 17500, 23100, 25200, 25400, 25600, 26000, 27000, 28300, 29300, 31200, 31900, 33200, 36400, 38000, 40400, 41100, 44800, 46300, 48400, 63700, 65000, 66800, 68300, 75000, 78800, 79600, 80400, 82100, 120000, 150000, 190838, 210000, 255000, 285000].forEach(c => pool.add(c));
    return [...pool];
  })();

  function currentCid() {
    const m = location.search.match(/[?&]cid=(\d+)/);
    return m ? parseInt(m[1], 10) : null;
  }

  function isPropertyPage() {
    return /\/hotel\/|\/property\//.test(location.pathname);
  }

  function cidCacheKey() {
    const m = location.pathname.match(/^\/(?:[a-z]{2}-[a-z]{2}\/)?([^/]+)\/hotel\//) || location.pathname.match(/^\/(?:[a-z]{2}-[a-z]{2}\/)?([^/]+)\/property\//);
    return m ? 'cid:' + m[1] : null;
  }

  function getCidCache() {
    const key = cidCacheKey();
    if (!key) return null;
    const c = store.get(key, null);
    if (!c || !c.ts || Date.now() - c.ts > CID_CACHE_TTL) return null;
    return c;
  }

  function setCidCache(data) {
    const key = cidCacheKey();
    if (!key) return;
    store.set(key, Object.assign({ ts: Date.now() }, data));
  }

  let capturedCidParams = null;

  function captureCidParamsFrom(urlStr) {
    if (!urlStr || !urlStr.includes('GetSecondaryData')) return;
    try {
      const u = new URL(urlStr, location.href);
      const params = u.searchParams;
      if (!params.get('hotel_id')) return;
      capturedCidParams = {
        checkIn: params.get('checkIn') || '',
        los: params.get('los') || '1',
        rooms: params.get('rooms') || '1',
        adults: params.get('adults') || '2',
        children: params.get('children') || '0',
        curr: params.get('curr') || '',
        hotel_id: params.get('hotel_id')
      };
    } catch (e) {}
  }

  function hookCidCapture() {
    try {
      const origFetch = window.fetch;
      if (origFetch) {
        window.fetch = function (...args) {
          captureCidParamsFrom(typeof args[0] === 'string' ? args[0] : args[0] && args[0].url);
          return origFetch.apply(this, args);
        };
      }
    } catch (e) {}
    try {
      const origOpen = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function (method, url) {
        captureCidParamsFrom(url);
        return origOpen.apply(this, arguments);
      };
    } catch (e) {}
  }

  function hotelIdFromDom() {
    try {
      const m = document.documentElement.innerHTML.match(/"hotelId"\s*:\s*(\d+)/) || document.documentElement.innerHTML.match(/hotel_id=(\d+)/);
      if (m) return m[1];
    } catch (e) {}
    return null;
  }

  function probeParams() {
    if (capturedCidParams && capturedCidParams.hotel_id) return capturedCidParams;
    const hid = hotelIdFromDom();
    if (hid) {
      return { checkIn: '', los: '1', rooms: '1', adults: '2', children: '0', curr: '', hotel_id: hid };
    }
    return null;
  }

  async function probeCidTotal(cid) {
    const p = probeParams();
    if (!p) return null;
    const q = [
      p.checkIn ? 'checkIn=' + p.checkIn : '',
      'los=' + p.los, 'rooms=' + p.rooms, 'adults=' + p.adults,
      p.children ? 'children=' + p.children : '',
      p.curr ? 'curr=' + p.curr : '',
      'hotel_id=' + p.hotel_id,
      'all=false&isHostPropertiesEnabled=false&price_view=1&sessionid=x&pagetypeid=7&attributionInfos=32%7C-1&cid=' + cid
    ].filter(Boolean).join('&');
    const u = '/api/cronos/property/BelowFoldParams/GetSecondaryData?' + q;
    for (let t = 0; t < 3; t++) {
      try {
        const r = await fetch(u, { headers: { accept: 'application/json' } });
        if (r.status !== 200) { await sleep(600); continue; }
        const j = await r.json();
        let best = null;
        for (const mr of (j.roomGridData.masterRooms || [])) for (const rm of (mr.rooms || [])) {
          if (rm.occupancy !== 2) continue;
          const v = rm.totalPrice && rm.totalPrice.display;
          if (typeof v === 'number' && (best === null || v < best)) best = v;
        }
        return best;
      } catch (e) { await sleep(600); }
    }
    return null;
  }

  async function runCidSweep(onProgress) {
    const cids = new Set(PROBE_POOL);
    const cur = currentCid();
    if (cur !== null) cids.add(cur);
    cids.add(2);
    const list = [...cids];
    const results = new Map();
    let done = 0;
    const worker = async (items) => {
      for (const cid of items) {
        const total = await probeCidTotal(cid);
        if (total !== null) results.set(cid, total);
        done++;
        if (onProgress) onProgress(done, list.length, cid, total);
      }
    };
    const chunks = [];
    for (let i = 0; i < list.length; i += 8) chunks.push(list.slice(i, i + 8));
    await Promise.all(chunks.map(worker));
    return results;
  }

  async function ensureCheapCid() {
    if (!settings.cidFix) return;
    if (!isPropertyPage()) return;
    const cache = getCidCache();
    if (cache && cache.bestCid !== undefined) {
      const cur = currentCid();
      if (cache.bestCid === null || cur === cache.bestCid) return;
      redirectToCid(cache.bestCid, cur);
      return;
    }
    notify('저가 채널(cid) 스캔 시작...');
    const results = await runCidSweep((done, total) => {
      if (done % 25 === 0 || done === total) notify(`cid 스캔 ${done}/${total}...`);
    });
    if (results.size === 0) { notify('cid 스캔 실패 — 잠시 후 다시 시도해줘'); return; }
    let bestCid = null, bestTotal = Infinity;
    for (const [cid, total] of results) {
      if (total < bestTotal) { bestTotal = total; bestCid = cid; }
    }
    const cur = currentCid();
    const curTotal = results.get(cur !== null ? cur : 2);
    const prices = [...new Set(results.values())];
    if (prices.length === 1) {
      setCidCache({ bestCid: null, bestTotal: bestTotal, noCheap: true });
      notify(`이 호텔은 cid 별 가격 차이 없음 (${bestTotal})`);
      return;
    }
    setCidCache({ bestCid, bestTotal, noCheap: false });
    if (curTotal !== undefined && bestTotal >= curTotal) {
      notify(`이미 최저 채널 (${curTotal})`);
      return;
    }
    notify(`저가 채널 발견: cid ${bestCid} → ${bestTotal} (기존 ${curTotal !== undefined ? curTotal : '?'})`);
    if (bestCid !== cur) redirectToCid(bestCid, cur);
  }

  function redirectToCid(cid, fromCid) {
    try {
      const url = new URL(location.href);
      url.searchParams.set('cid', String(cid));
      if (fromCid !== null && fromCid !== undefined) {
        try { sessionStorage.setItem(CID_FIXED_FLAG, String(fromCid)); } catch (e) {}
      }
      location.replace(url.toString());
    } catch (e) {}
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
      notify(settings.cidFix ? '저가 채널 자동적용 켜짐 — 다음 방문부터 적용' : '저가 채널 자동적용 꺼짐');
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
    const cid = currentCid();
    const cidCache = getCidCache();
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
  }

  function init() {
    buildPanel();
    scan();
    const obs = new MutationObserver(() => scheduleScan());
    obs.observe(document.body, { childList: true, subtree: true });
    setInterval(() => scheduleScan(), 3000);
    notify('로드됨 — 최저가 스캔 시작');
    if (settings.promoHunt && /payment|checkout|book/.test(location.pathname)) {
      setTimeout(() => { if (findPromoInput()) promoHunt(); }, 3000);
    }
    if (settings.cidFix && isPropertyPage()) {
      setTimeout(() => { ensureCheapCid(); }, 4000);
    }
  }

  if (document.body) init();
  else document.addEventListener('DOMContentLoaded', init);
})();

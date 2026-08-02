// ==UserScript==
// @name         Agoda Always Lowest Price (아고다 최저가 도우미)
// @namespace    nyx.agoda.lowest
// @version      1.9.7
// @description  전 세계 아고다 숙소 최저가 도우미 — 안전한 CID 비교/재검증, 2인 유효 최저가, 세금포함 총액, 수동 1클릭 예약
// @author       Nyx
// @match        https://www.agoda.com/*
// @match        https://agoda.com/*
// @match        https://m.agoda.com/*
// @exclude      https://www.agoda.com/*/search*
// @exclude      https://agoda.com/*/search*
// @exclude      https://m.agoda.com/*/search*
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
    highlight: false,
    autoSelect: false,
    promoHunt: false,
    currencyAuto: false,
    watchPrice: false,
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
  const SAFE_SETTINGS_VERSION = '1.9.5';
  if (store.get('safe-settings-version', null) !== SAFE_SETTINGS_VERSION) {
    // Older releases enabled DOM mutation, coupon attempts and booking clicks by
    // default. Disable those persisted switches once; CID price comparison stays on.
    settings.highlight = false;
    settings.autoSelect = false;
    settings.promoHunt = false;
    settings.currencyAuto = false;
    settings.watchPrice = false;
    saveSettings();
    store.set('safe-settings-version', SAFE_SETTINGS_VERSION);
  }
  const nativeFetch = typeof window.fetch === 'function' ? window.fetch : null;
  let cidCaptureHooked = false;
  if (isPropertyPage()) hookCidCapture();

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
  const CID_CONCURRENCY = 2;
  const CID_REQUEST_TIMEOUT = 12000;
  const CID_REQUEST_INTERVAL = 300;
  const CID_RANGE_MAX = 9999999;
  const CID_VERIFY_ROUNDS = 2;
  const CID_VERIFY_TOP = 5;
  const CID_VERIFY_MAX_CANDIDATES = 20;
  const CID_CACHE_VERSION = 4;
  const CID_REGISTRY_VERSION = '2026-08-02-228k';
  const CID_REDIRECT_MAX_HOPS = 3;
  const CID_NATURAL_RESPONSE_TIMEOUT = 14000;
  const CID_REJECT_TTL = 10 * 60 * 1000;

  // Verified 2026-08-02 via room-grid API (currencyId 26/KRW) on APA Namba
  // Ekimae Tower: these 230 partner CIDs returned the lowest tier
  // (228,499 KRW / 2 nights, Oct 7-9 2026) versus 241,941 KRW baseline.
  // Partner/channel IDs, not a numeric discount range.
  const ACTIVE_HIGH_CIDS = Object.freeze([
    1429945, 1442771, 1444054, 1449508, 1450161, 1451793, 1460862, 1464882,
    1484583, 1497421, 1550300, 1555727, 1558948, 1563295, 1585118, 1595807,
    1597408, 1597784, 1598713, 1602582, 1602809, 1604220, 1606074, 1606297,
    1607169, 1607177, 1607809, 1608701, 1609787, 1616199, 1618060, 1618814,
    1619447, 1619927, 1623435, 1641444, 1641446, 1643939, 1644618, 1647692,
    1648084, 1649895, 1649959, 1652904, 1654104, 1654994, 1657643, 1716737,
    1722624, 1723497, 1724129, 1725465, 1729471, 1729890, 1730176, 1730560,
    1732276, 1739609, 1741590, 1742016, 1744635, 1748498, 1753807, 1754413,
    1755750, 1760133, 1762758, 1762810, 1765710, 1770737, 1771063, 1775627,
    1776034, 1776688, 1779080, 1779118, 1781052, 1783115, 1788894, 1792737,
    1795682, 1795691, 1797169, 1798666, 1799922, 1800982, 1801110, 1806212,
    1806428, 1807881, 1807978, 1810992, 1811661, 1812489, 1813297, 1813352,
    1813444, 1813866, 1814715, 1815158, 1816167, 1819819, 1822934, 1823759,
    1826290, 1827482, 1827579, 1829511, 1830110, 1830447, 1830773, 1832015,
    1833101, 1833982, 1836036, 1837758, 1840309, 1841941, 1841944, 1843082,
    1845109, 1845157, 1845995, 1880000, 1889283, 1889284, 1889308, 1889309,
    1889316, 1889319, 1889328, 1889478, 1889487, 1889493, 1889572, 1889575,
    1889576, 1889577, 1889578, 1889579, 1889580, 1889877, 1891357, 1894892,
    1895406, 1895693, 1897057, 1897427, 1897955, 1898889, 1899122, 1899665,
    1899694, 1899785, 1902785, 1903104, 1903131, 1903441, 1904510, 1904827,
    1905113, 1906692, 1907349, 1907611, 1911618, 1912284, 1912836, 1913564,
    1913631, 1913632, 1914262, 1915205, 1915558, 1917158, 1917257, 1917334,
    1917349, 1917464, 1917477, 1917809, 1918541, 1920392, 1920395, 1922343,
    1922502, 1922847, 1922935, 1923393, 1925339, 1926014, 1926018, 1926071,
    1928772, 1929418, 1929419, 1929798, 1930783, 1931173, 1931194, 1931211,
    1931228, 1931349, 1931426, 1931451, 1931467, 1931512, 1931531, 1931585,
    1931695, 1931705, 1931714, 1931927, 1932324, 1932391, 1932561, 1932749,
    1932810, 1933756, 1933886, 1934255, 1935943, 1936086, 1936997, 1937284,
    1937285, 1937288, 1937289, 1937290, 1937291, 1937292, 1937293, 1937294,
    1937295, 1937708, 1937712, 1939923, 1940376, 1942636, 1942726, 1943282,
    1943294, 1943398, 1944090, 1944254, 1945987, 1945988, 1945989, 1945990,
    1945991, 1945992, 1946331, 1946333, 1946392, 1947165, 1949417, 1951235,
    1952304, 1953064, 1957119, 1958938, 1959939, 1960466, 1960725, 1961233,
    1961347, 1961498, 1961634, 1962043, 1962262, 1963209, 1963210, 1963211
  ]);
  const ACTIVE_LOW_CIDS = Object.freeze([
    1439847, 1555740, 1568156, 1587480, 1587497, 1606301, 1646650, 1648249,
    1656583, 1716632, 1719676, 1720055, 1720706, 1723698, 1729675, 1731197,
    1731353, 1731641, 1732639, 1732641, 1733908, 1733999, 1735414, 1752828,
    1755877, 1756163, 1763313, 1763347, 1766357, 1770664, 1772896, 1784497,
    1786151, 1797640, 1800120, 1807747, 1825778, 1828703, 1829968, 1833981,
    1841704, 1841706, 1841724, 1844104, 1844160, 1856692, 1881766, 1881887,
    1888052, 1891440, 1891446, 1891460, 1891461, 1891463, 1891467, 1891504,
    1892424, 1895423, 1897699, 1901150, 1901202, 1901260, 1901276, 1901283,
    1904253, 1906661, 1908612, 1908617, 1913764, 1914395, 1914396, 1914474,
    1914475, 1914935, 1914936, 1914940, 1915013, 1917400, 1917614, 1918349,
    1918750, 1922865, 1922868, 1922872, 1922884, 1922886, 1922887, 1924244,
    1925109, 1925201, 1925673, 1932236, 1940113, 1945153, 1955468, 1957693
  ]);
  const ACTIVE_CIDS = Object.freeze([...ACTIVE_HIGH_CIDS, ...ACTIVE_LOW_CIDS]);
  // Fast automatic pass: top 47 verified winner CIDs (lowest tier) so the
  // default sweep reaches the best price immediately. Full verified registry
  // (230 winners + 83 runners) remains available from the explicit panel action.
  const FAST_CIDS = Object.freeze([
    1563295, 1641446, 1654104, 1716632, 1729471, 1729890, 1741590, 1748498,
    1760133, 1770664, 1776688, 1783115, 1800120, 1801110, 1806212, 1827579,
    1829968, 1830447, 1833981, 1833982, 1837758, 1844104, 1844160, 1845109,
    1845157, 1889319, 1889572, 1891504, 1892424, 1895693, 1904827, 1908612,
    1908617, 1913764, 1917257, 1917334, 1917349, 1917400, 1917614, 1922847,
    1922868, 1922887, 1932810, 1937708, 1942636, 1945988, 1959939
  ]);
  const CID_TAGS = Object.freeze({
    1895693: 'A100692912', 1937708: 'A100692912', 1942636: 'A100692912'
  });

  // 560 URLScan captures (2018-2026), public repositories, official docs and
  // public affiliate links yielded these 241 real-link candidates. They are
  // retained for the explicit deep audit, but are not all presumed current or
  // discounted and therefore do not slow every automatic scan.
  const PUBLIC_OBSERVED_CIDS = Object.freeze([
    1439847, 1450161, 1451793, 1497421, 1550300, 1555740, 1558948, 1563295,
    1568156, 1587480, 1587497, 1595807, 1597408, 1597784, 1598713, 1602582,
    1602809, 1604220, 1606297, 1607169, 1607177, 1607809, 1608701, 1616199,
    1618060, 1618814, 1623435, 1641446, 1643939, 1646650, 1647692, 1648249,
    1649895, 1649959, 1654104, 1654994, 1656583, 1657643, 1716632, 1716737,
    1719676, 1720055, 1720706, 1723497, 1723698, 1724129, 1725465, 1729471,
    1729675, 1729890, 1730176, 1730560, 1731197, 1731353, 1731641, 1732276,
    1732639, 1732641, 1733908, 1733999, 1735414, 1741590, 1742016, 1748498,
    1752828, 1753807, 1754413, 1755750, 1755877, 1756163, 1760133, 1762810,
    1763313, 1763347, 1765710, 1766357, 1770664, 1770737, 1771063, 1772896,
    1775627, 1776034, 1776688, 1779080, 1779118, 1781052, 1783115, 1784497,
    1786151, 1792737, 1797169, 1797640, 1798666, 1799922, 1800120, 1801110,
    1806212, 1807747,
    1807881, 1811661, 1812489, 1813352, 1813866, 1815158, 1816167, 1819819,
    1823759, 1825778, 1826290, 1827482, 1827579, 1828703, 1829511, 1829968,
    1830110,
    1830447, 1832015, 1833101, 1833981, 1833982, 1836036, 1837758, 1841704,
    1841706, 1841724, 1841941, 1841944, 1844104, 1844160, 1845109, 1845157,
    1845995, 1856692, 1880000, 1881766, 1888052, 1889319, 1889572, 1891440,
    1891446, 1891460, 1891461, 1891463, 1891467, 1891504, 1892424, 1894892,
    1895406, 1895423, 1895693, 1897057, 1897699, 1898889, 1899785, 1901283,
    1904510, 1904827, 1905113, 1907349, 1907611, 1908612, 1908617, 1911618,
    1912284, 1913632, 1913764, 1914935,
    1914936, 1914940, 1915013, 1915558, 1917158, 1917257, 1917334, 1917349,
    1917464, 1917477, 1917614, 1917809, 1918349, 1918541, 1918750, 1922343,
    1922502,
    1922847, 1922865, 1922868, 1922872, 1922884, 1922886, 1922887, 1922935,
    1923393, 1924244, 1925339, 1925673, 1926018, 1926071, 1929798, 1931173,
    1931194,
    1931211, 1931228, 1931349, 1931426, 1931451, 1931467, 1931512, 1931531,
    1931585, 1931695, 1931705, 1931714, 1931927, 1932236, 1932324, 1932391,
    1932561, 1932749, 1932810, 1933886, 1936997, 1937708, 1937712, 1940113,
    1940376, 1942636, 1942726, 1943282, 1944090, 1945988, 1946392, 1947165,
    1951235, 1955468, 1957119, 1959939, 1961347, 1961634,
    1962043, 1962262
  ]);

  let capturedLegacyTemplate = null;
  let capturedRoomGridTemplate = null;
  let cidSweepPromise = null;
  let cidSweepSignature = null;
  let cidSweepQueued = null;
  let cidStatus = { phase: 'idle', done: 0, total: 0, source: null };
  let cidNextRequestAt = 0;
  let cidBackoffUntil = 0;
  const runtimeDiscoveredCids = new Map();
  const naturalPriceObservations = [];

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
    if (!urlStr || !urlStr.includes('GetSecondaryData')) return null;
    try {
      const u = new URL(urlStr, location.href);
      const params = u.searchParams;
      if (!params.get('hotel_id')) return null;
      capturedLegacyTemplate = {
        url: u.pathname + u.search,
        hotelId: params.get('hotel_id'),
        cid: normalizeCid(params.get('cid')),
        capturedAt: Date.now()
      };
      return capturedLegacyTemplate;
    } catch (e) { return null; }
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
      return capturedRoomGridTemplate;
    } catch (e) { return null; }
  }

  function cidFromHeaders(headers) {
    try { return normalizeCid(new Headers(headers || {}).get('ag-cid')); }
    catch (e) { return null; }
  }

  function textFingerprint(value) {
    let hash = 2166136261;
    const text = String(value || '');
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function templateFingerprint(kind, template, ctx) {
    if (!template || !template.url || !ctx) return null;
    try {
      const u = new URL(template.url, location.href);
      ['cid', 'tag', 'ds', 'searchrequestid'].forEach(key => u.searchParams.delete(key));
      const query = [...u.searchParams.entries()].sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
      const body = kind === 'room-grid' ? JSON.stringify(template.body || {}) : '';
      return `${kind}|${u.pathname}|${criteriaSignature(ctx)}|${textFingerprint(JSON.stringify(query) + '|' + body)}`;
    } catch (e) { return null; }
  }

  function requestMetaFromTemplate(kind, template, cid) {
    const ctx = kind === 'room-grid'
      ? roomGridContextFromTemplate(template)
      : legacyContextFromTemplate(template);
    return {
      kind, cid: normalizeCid(cid), ctx: ctx ? Object.assign({}, ctx) : null,
      signature: criteriaSignature(ctx), hotelId: ctx && ctx.hotelId ? String(ctx.hotelId) : null,
      fingerprint: templateFingerprint(kind, template, ctx)
    };
  }

  function captureCidRequest(input, init) {
    const url = requestUrl(input);
    if (!url) return null;
    const legacyTemplate = captureCidParamsFrom(url);
    if (url.includes('GetSecondaryData')) {
      try {
        const u = new URL(url, location.href);
        return requestMetaFromTemplate('secondary', legacyTemplate, u.searchParams.get('cid'));
      } catch (e) { return requestMetaFromTemplate('secondary', legacyTemplate, null); }
    }
    if (!url.includes('/api/v1/property/room-grid')) return null;
    try {
      const request = typeof Request !== 'undefined' && input instanceof Request ? input : null;
      const headers = (init && init.headers) || (request && request.headers) || {};
      const directBody = init && init.body;
      const cid = cidFromHeaders(headers);
      if (typeof directBody === 'string') {
        return requestMetaFromTemplate('room-grid', saveRoomGridTemplate(url, headers, directBody), cid);
      }
      const meta = { kind: 'room-grid', cid, ctx: null, signature: null, hotelId: null, fingerprint: null };
      if (request) request.clone().text().then(t => {
        Object.assign(meta, requestMetaFromTemplate('room-grid', saveRoomGridTemplate(url, headers, t), cid));
      }).catch(() => {});
      return meta;
    } catch (e) { return { kind: 'room-grid', cid: null, ctx: null, signature: null, hotelId: null, fingerprint: null }; }
  }

  function addRuntimeCid(value, signature) {
    const cid = normalizeCid(value);
    if (cid === null || cid < 1000000 || !signature) return;
    if (!runtimeDiscoveredCids.has(signature)) runtimeDiscoveredCids.set(signature, new Set());
    const bucket = runtimeDiscoveredCids.get(signature);
    if (bucket.size < 100) bucket.add(cid);
  }

  function collectCampaignCids(node, out, parentKey = '') {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(value => collectCampaignCids(value, out, parentKey));
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      const lower = key.toLowerCase();
      if (lower === 'campaigncid' || lower === 'activecid' ||
          (lower === 'cid' && /campaign/.test(parentKey.toLowerCase()))) {
        const cid = normalizeCid(value);
        if (cid !== null && cid >= 1000000) out.add(cid);
      }
      collectCampaignCids(value, out, key);
    }
  }

  function captureCidResponse(response, url, requestMeta = null) {
    if (!response || !url || (!url.includes('/api/v1/property/room-grid') && !url.includes('GetSecondaryData'))) return;
    if (response.ok === false) return;
    try {
      response.clone().text().then(text => {
        let payload;
        try { payload = JSON.parse(text); } catch (e) { return; }
        const ctx = requestMeta && requestMeta.ctx ? requestMeta.ctx : probeContext();
        const signature = requestMeta && requestMeta.signature ? requestMeta.signature : criteriaSignature(ctx);
        const found = new Set();
        collectCampaignCids(payload, found);
        found.forEach(cid => addRuntimeCid(cid, signature));

        let requestCid = normalizeCid(requestMeta && requestMeta.cid);
        if (requestCid === null && url.includes('GetSecondaryData')) {
          try { requestCid = normalizeCid(new URL(url, location.href).searchParams.get('cid')); } catch (e) {}
        }
        const total = url.includes('/api/v1/property/room-grid')
          ? extractModernTotal(payload, ctx || urlCriteria())
          : extractLegacyTotal(payload, ctx || urlCriteria());
        const hotelId = requestMeta && requestMeta.hotelId || (ctx && ctx.hotelId);
        const correlated = requestMeta && requestMeta.signature && requestMeta.fingerprint && requestMeta.kind;
        if (requestCid !== null && total !== null && correlated && hotelId) {
          naturalPriceObservations.push({
            cid: requestCid, total, signature, hotelId: String(hotelId), kind: requestMeta.kind,
            fingerprint: requestMeta.fingerprint, observedAt: Date.now()
          });
          if (naturalPriceObservations.length > 30) naturalPriceObservations.splice(0, naturalPriceObservations.length - 30);
        }
      }).catch(() => {});
    } catch (e) {}
  }

  function hookCidCapture() {
    if (cidCaptureHooked || !isPropertyPage()) return;
    cidCaptureHooked = true;
    try {
      if (nativeFetch) {
        window.fetch = function (...args) {
          const requestMeta = captureCidRequest(args[0], args[1]);
          const url = requestUrl(args[0]);
          const pending = nativeFetch.apply(this, args);
          Promise.resolve(pending).then(response => captureCidResponse(response, url, requestMeta)).catch(() => {});
          return pending;
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
        let requestMeta = null;
        if (meta && meta.url.includes('/api/v1/property/room-grid') && typeof body === 'string') {
          const cid = cidFromHeaders(meta.headers);
          requestMeta = requestMetaFromTemplate('room-grid', saveRoomGridTemplate(meta.url, meta.headers, body), cid);
        } else if (meta && meta.url.includes('GetSecondaryData')) {
          try {
            const cid = normalizeCid(new URL(meta.url, location.href).searchParams.get('cid'));
            requestMeta = requestMetaFromTemplate('secondary', captureCidParamsFrom(meta.url), cid);
          } catch (e) { requestMeta = requestMetaFromTemplate('secondary', null, null); }
        }
        if (meta && (meta.url.includes('/api/v1/property/room-grid') || meta.url.includes('GetSecondaryData'))) {
          this.addEventListener('load', () => {
            try {
              const fakeResponse = { clone: () => ({ text: () => Promise.resolve(this.responseText || '') }) };
              captureCidResponse(fakeResponse, meta.url, requestMeta);
            } catch (e) {}
          }, { once: true });
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
      childrenAges: q.get('childrenAges') || q.get('childAges') || q.get('childages') || '',
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

  function roomGridContextFromTemplate(template) {
    if (!template || !template.body) return null;
    const fromUrl = urlCriteria();
    const b = template.body;
    const sc = b.searchCriteria || {};
    const ages = sc.childrenAges || sc.childAges || [];
    return {
      source: 'room-grid', hotelId: String(b.propertyId),
      checkIn: sc.checkIn || fromUrl.checkIn,
      checkOut: sc.checkOut || fromUrl.checkOut,
      los: fromUrl.los, rooms: String(sc.rooms || fromUrl.rooms),
      adults: String(sc.adults || fromUrl.adults),
      children: String(Array.isArray(ages) ? ages.length : (sc.children || fromUrl.children)),
      childrenAges: Array.isArray(ages) ? ages.map(age => Number(age)).filter(Number.isFinite).join(',') : fromUrl.childrenAges,
      curr: pageCurrencyKey() || String((b.userContext && b.userContext.currencyId) || ''),
      activeCid: template.cid ?? currentCid() ?? DEFAULT_CID
    };
  }

  function legacyContextFromTemplate(template) {
    if (!template || !template.url) return null;
    const fromUrl = urlCriteria();
    const q = new URL(template.url, location.href).searchParams;
    return {
      source: 'secondary', hotelId: template.hotelId,
      checkIn: q.get('checkIn') || fromUrl.checkIn,
      checkOut: q.get('checkOut') || fromUrl.checkOut,
      los: q.get('los') || fromUrl.los, rooms: q.get('rooms') || fromUrl.rooms,
      adults: q.get('adults') || fromUrl.adults,
      children: q.get('children') || fromUrl.children,
      childrenAges: q.get('childrenAges') || q.get('childAges') || q.get('childages') || fromUrl.childrenAges,
      curr: (q.get('curr') || pageCurrencyKey() || '').toUpperCase(),
      activeCid: template.cid ?? currentCid() ?? DEFAULT_CID
    };
  }

  function probeContext() {
    const fromUrl = urlCriteria();
    if (capturedRoomGridTemplate) {
      return roomGridContextFromTemplate(capturedRoomGridTemplate);
    }
    if (capturedLegacyTemplate) {
      return legacyContextFromTemplate(capturedLegacyTemplate);
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
    return [ctx.hotelId, ctx.checkIn, stayLength, ctx.rooms, ctx.adults, ctx.children, ctx.childrenAges || '', ctx.curr]
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
    const ttl = Number.isFinite(c && c.ttlMs) ? Math.min(CID_CACHE_TTL, Math.max(1000, c.ttlMs)) : CID_CACHE_TTL;
    if (!c || c.cacheVersion !== CID_CACHE_VERSION || c.registryVersion !== CID_REGISTRY_VERSION ||
        !c.ts || !c.verifiedAt || Date.now() - c.ts > ttl) return null;
    if (normalizeCid(c.baselineCid) === null || !Number.isFinite(c.baselineTotal) || c.baselineTotal <= 0) return null;
    if (c.bestCid !== null && normalizeCid(c.bestCid) === null) return null;
    if (!Number.isFinite(c.bestTotal) || c.bestTotal <= 0) return null;
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
      const html = document.documentElement && document.documentElement.innerHTML || '';
      const campaignRe = /["'](?:campaignCid|activeCid)["']\s*:\s*["']?(\d{6,8})/gi;
      let match;
      while ((match = campaignRe.exec(html)) && found.length < 100) {
        const cid = normalizeCid(match[1]);
        if (cid !== null) found.push(cid);
      }
    } catch (e) {}
    return found;
  }

  function rejectedCidKey(ctx) {
    const sig = criteriaSignature(ctx);
    return sig ? NAME + ':cid-rejected:' + sig : null;
  }

  function rejectedCidEntries(ctx) {
    const key = rejectedCidKey(ctx);
    if (!key) return [];
    try {
      const parsed = JSON.parse(sessionStorage.getItem(key) || '[]');
      if (!Array.isArray(parsed)) return [];
      const now = Date.now();
      return parsed.map(item => typeof item === 'object' && item !== null
        ? { cid: normalizeCid(item.cid), ts: Number(item.ts) }
        : { cid: normalizeCid(item), ts: 0 })
        .filter(item => item.cid !== null && Number.isFinite(item.ts) && now - item.ts < CID_REJECT_TTL);
    } catch (e) { return []; }
  }

  function rejectedCids(ctx) {
    return new Set(rejectedCidEntries(ctx).map(item => item.cid));
  }

  function rejectCid(cid, ctx) {
    cid = normalizeCid(cid);
    const key = rejectedCidKey(ctx);
    if (cid === null || !key) return;
    const entries = rejectedCidEntries(ctx).filter(item => item.cid !== cid);
    entries.push({ cid, ts: Date.now() });
    try { sessionStorage.setItem(key, JSON.stringify(entries)); } catch (e) {}
  }

  function clearRejectedCids(ctx) {
    const key = rejectedCidKey(ctx);
    try { if (key) sessionStorage.removeItem(key); } catch (e) {}
  }

  function redirectHistoryKey(ctx) {
    const sig = criteriaSignature(ctx);
    return sig ? NAME + ':cid-redirects:' + sig : null;
  }

  function redirectHistory(ctx) {
    const key = redirectHistoryKey(ctx);
    if (!key) return [];
    try {
      const parsed = JSON.parse(sessionStorage.getItem(key) || '[]');
      return Array.isArray(parsed) ? parsed.map(normalizeCid).filter(cid => cid !== null) : [];
    } catch (e) { return []; }
  }

  function clearRedirectHistory(ctx) {
    const key = redirectHistoryKey(ctx);
    try { if (key) sessionStorage.removeItem(key); } catch (e) {}
  }

  function runtimeCidsFor(ctx) {
    const sig = criteriaSignature(ctx);
    return sig && runtimeDiscoveredCids.has(sig) ? [...runtimeDiscoveredCids.get(sig)] : [];
  }

  function buildProbeList(ctx, options = {}) {
    const cids = new Set();
    const add = value => { value = normalizeCid(value); if (value !== null) cids.add(value); };
    [ctx && ctx.activeCid, currentCid(), capturedLegacyTemplate && capturedLegacyTemplate.cid,
      capturedRoomGridTemplate && capturedRoomGridTemplate.cid].forEach(add);
    rememberedCids().slice(0, 10).forEach(add);
    visiblePageCids().forEach(add);
    runtimeCidsFor(ctx).forEach(add);
    FAST_CIDS.forEach(add);
    if (options.full || options.deep) ACTIVE_CIDS.forEach(add);
    if (options.deep) PUBLIC_OBSERVED_CIDS.forEach(add);
    const rejected = rejectedCids(ctx);
    const baseline = normalizeCid(ctx && ctx.activeCid);
    return [...cids].filter(cid => cid === baseline || !rejected.has(cid));
  }

  async function waitForCidRequestSlot() {
    while (true) {
      const now = Date.now();
      const slot = Math.max(now, cidNextRequestAt, cidBackoffUntil);
      cidNextRequestAt = slot + CID_REQUEST_INTERVAL + Math.floor(Math.random() * 50);
      if (slot > now) await sleep(slot - now);
      if (cidBackoffUntil > slot) continue;
      return;
    }
  }

  async function fetchJson(url, init = {}, attempts = 2) {
    const fetcher = nativeFetch || window.fetch;
    if (!fetcher) throw new Error('fetch unavailable');
    let lastError = null;
    for (let attempt = 0; attempt < attempts; attempt++) {
      await waitForCidRequestSlot();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), CID_REQUEST_TIMEOUT);
      try {
        const r = await fetcher.call(window, url, Object.assign({ credentials: 'same-origin', cache: 'no-store' }, init, { signal: controller.signal }));
        if (!r.ok) {
          const error = new Error('HTTP ' + r.status);
          error.status = r.status;
          if (r.status === 429 || (r.status >= 500 && r.status <= 599)) {
            const retryHeader = r.headers && r.headers.get('Retry-After');
            const retrySeconds = typeof retryHeader === 'string' && /^\d+(?:\.\d+)?$/.test(retryHeader.trim())
              ? Number(retryHeader) : NaN;
            const retryDate = retryHeader && !Number.isFinite(retrySeconds) ? Date.parse(retryHeader) : NaN;
            const waitMs = Number.isFinite(retrySeconds) ? retrySeconds * 1000
              : (Number.isFinite(retryDate) ? Math.max(0, retryDate - Date.now()) : 1200 * (2 ** attempt));
            error.retryAfter = Math.min(30000, Math.max(750, waitMs));
            cidBackoffUntil = Math.max(cidBackoffUntil, Date.now() + error.retryAfter);
            cidStatus = Object.assign({}, cidStatus, { backoffUntil: cidBackoffUntil, lastHttpStatus: r.status });
          }
          throw error;
        }
        return await r.json();
      } catch (e) {
        lastError = e;
        if (e && e.status === 429) break;
        if (attempt + 1 < attempts) {
          const waitMs = e.retryAfter || (500 * (attempt + 1) + Math.random() * 300);
          await sleep(waitMs);
        }
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

  function inspectOccupancyMetadata(node, options = {}) {
    const adultCounts = [];
    const maxAdultCounts = [];
    const maxOccupancies = [];
    const guestsWithoutRoom = [];
    const seen = new Set();
    let visited = 0;

    const addNumber = (bucket, value) => {
      const match = String(value ?? '').match(/\d+/);
      const amount = match ? Number(match[0]) : NaN;
      if (Number.isInteger(amount) && amount >= 0) bucket.push(amount);
    };
    const scanText = text => {
      const patterns = [
        [/data-adults\s*=\s*["']?(\d+)/ig, adultCounts],
        [/\bfor\s+(\d+)\s+(?:person|people|adults?|guests?)\b/ig, adultCounts],
        [/\bMAX[_\s-]*OCCUPANCY\b[^\d]{0,24}(\d+)/ig, maxOccupancies],
        [/(\d+)[^\d]{0,24}\bMAX[_\s-]*OCCUPANCY\b/ig, maxOccupancies]
      ];
      for (const [pattern, bucket] of patterns) {
        let match;
        while ((match = pattern.exec(text))) addNumber(bucket, match[1]);
      }
    };
    const visit = (value, key = '', depth = 0) => {
      if (value === null || value === undefined || depth > 6 || visited++ > 500) return;
      const compactKey = String(key).replace(/[^a-z]/gi, '').toLowerCase();
      if (options.skipOffers && compactKey === 'offers') return;
      if (typeof value !== 'object') {
        const text = String(value);
        scanText(String(key));
        scanText(text);
        if (compactKey === 'dataadults') {
          addNumber(adultCounts, value);
        }
        if (['maxadults', 'maxallowedadults'].includes(compactKey)) {
          addNumber(maxAdultCounts, value);
        }
        if (['maxoccupancy', 'maximumoccupancy', 'maxguests', 'maxguest', 'capacity'].includes(compactKey)) {
          addNumber(maxOccupancies, value);
        }
        if (compactKey === 'numberofguestswithoutroom') addNumber(guestsWithoutRoom, value);
        return;
      }
      if (seen.has(value)) return;
      seen.add(value);
      if (Array.isArray(value)) value.forEach(item => visit(item, key, depth + 1));
      else Object.entries(value).forEach(([childKey, child]) => visit(child, childKey, depth + 1));
    };

    visit(node);
    return { adultCounts, maxAdultCounts, maxOccupancies, guestsWithoutRoom };
  }

  function occupancyAllows(node, requiredAdults, options = {}) {
    if (!node || typeof node !== 'object') return true;
    if (node.isOccupancyExceeded === true || node.isSoldOut === true) return false;
    const metadata = inspectOccupancyMetadata(node, options);
    if (metadata.guestsWithoutRoom.some(value => value > 0)) return false;
    if (metadata.adultCounts.length && Math.max(...metadata.adultCounts) < requiredAdults) return false;
    if (metadata.maxAdultCounts.length && Math.max(...metadata.maxAdultCounts) < requiredAdults) return false;
    if (metadata.maxOccupancies.length && Math.max(...metadata.maxOccupancies) < requiredAdults) return false;
    return true;
  }

  function extractModernTotal(j, ctx = {}) {
    const values = [];
    const roomCount = Math.max(1, Number(ctx.rooms) || 1);
    const requiredAdults = Math.max(1, Math.ceil((Number(ctx.adults) || 2) / roomCount));
    const rooms = Array.isArray(j && j.rooms) ? j.rooms : null;
    if (rooms) for (const room of rooms) {
      const offers = Array.isArray(room && room.offers) ? room.offers : [];
      if (!occupancyAllows(room, requiredAdults, { skipOffers: true })) continue;
      for (const offer of offers) {
        if (!occupancyAllows(offer, requiredAdults)) continue;
        const v = numericAmount(offer.analyticsContext && offer.analyticsContext.hotel_price_per_book);
        if (v !== null) values.push(v);
      }
    }
    if (rooms) return values.length ? Math.min(...values) : null;
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
          room.totalPrice && room.totalPrice.display,
          room.inclusivePrice
        ];
        const v = candidates.map(numericAmount).find(x => x !== null);
        if (v !== undefined) values.push(v);
      }
    }
    return values.length ? Math.min(...values) : null;
  }

  function probeUrlForCid(rawUrl, cid) {
    const u = new URL(rawUrl, location.href);
    u.searchParams.delete('tag');
    u.searchParams.delete('ds');
    u.searchParams.set('cid', String(cid));
    if (CID_TAGS[cid]) u.searchParams.set('tag', CID_TAGS[cid]);
    return u.pathname + u.search;
  }

  function modernProbeUrlForCid(rawUrl, cid) {
    const u = new URL(rawUrl, location.href);
    u.searchParams.delete('cid');
    u.searchParams.delete('tag');
    u.searchParams.delete('ds');
    if (CID_TAGS[cid]) u.searchParams.set('tag', CID_TAGS[cid]);
    return u.pathname + u.search;
  }

  function modernProbeHeaders(template, cid, probeUrl = template.url) {
    const headers = Object.assign({}, template.headers, { 'ag-cid': String(cid), 'content-type': 'application/json' });
    const uid = headers['ag-user-id'];
    try { if (uid) headers['x-gate-meta'] = btoa(`${Date.now()}|${uid}|${new URL(probeUrl, location.href).pathname}`); }
    catch (e) {}
    return headers;
  }

  function createProbeSession(source, ctx) {
    const modern = capturedRoomGridTemplate && String(capturedRoomGridTemplate.hotelId) === String(ctx.hotelId)
      ? {
          url: capturedRoomGridTemplate.url,
          body: JSON.parse(JSON.stringify(capturedRoomGridTemplate.body)),
          headers: Object.assign({}, capturedRoomGridTemplate.headers),
          hotelId: String(capturedRoomGridTemplate.hotelId)
        }
      : null;
    const legacy = capturedLegacyTemplate && String(capturedLegacyTemplate.hotelId) === String(ctx.hotelId)
      ? Object.assign({}, capturedLegacyTemplate)
      : null;
    const selected = source === 'room-grid' ? modern : legacy;
    return Object.freeze({
      source, ctx: Object.freeze(Object.assign({}, ctx)), modernTemplate: modern, legacyTemplate: legacy,
      fingerprint: templateFingerprint(source, selected, ctx)
    });
  }

  async function probeModernCid(cid, ctx, session) {
    const t = session && session.modernTemplate;
    if (!t || String(t.hotelId) !== String(ctx.hotelId)) return { total: null, ok: false, status: 0 };
    try {
      const probeUrl = modernProbeUrlForCid(t.url, cid);
      const j = await fetchJson(probeUrl, {
        method: 'POST', headers: modernProbeHeaders(t, cid, probeUrl),
        body: JSON.stringify(t.body)
      });
      return { total: extractModernTotal(j, ctx), ok: true, status: 200 };
    } catch (e) { return { total: null, ok: false, status: e.status || 0 }; }
  }

  function legacyProbeUrl(cid, ctx, session) {
    let u;
    const legacy = session && session.legacyTemplate;
    if (legacy && String(legacy.hotelId) === String(ctx.hotelId)) {
      u = new URL(legacy.url, location.href);
    } else {
      u = new URL('/api/cronos/property/BelowFoldParams/GetSecondaryData', location.href);
      const q = u.searchParams;
      if (ctx.checkIn) q.set('checkIn', ctx.checkIn);
      if (ctx.checkOut) q.set('checkOut', ctx.checkOut);
      q.set('los', ctx.los || '1'); q.set('rooms', ctx.rooms || '1');
      q.set('adults', ctx.adults || '2'); q.set('children', ctx.children || '0');
      if (ctx.childrenAges) q.set('childages', ctx.childrenAges);
      if (ctx.curr && !/^\d+$/.test(ctx.curr)) q.set('curr', ctx.curr);
      q.set('hotel_id', ctx.hotelId); q.set('all', 'false');
      q.set('isHostPropertiesEnabled', 'true'); q.set('price_view', '0');
      q.set('sessionid', 'x'); q.set('pagetypeid', '7'); q.set('attributionInfos', '32|-1');
    }
    return probeUrlForCid(u.pathname + u.search, cid);
  }

  async function probeLegacyCid(cid, ctx, session) {
    try {
      const j = await fetchJson(legacyProbeUrl(cid, ctx, session), { headers: { accept: 'application/json' } });
      return { total: extractLegacyTotal(j, ctx), ok: true, status: 200 };
    } catch (e) { return { total: null, ok: false, status: e.status || 0 }; }
  }

  function probeCid(cid, source, ctx, session) {
    return source === 'room-grid' ? probeModernCid(cid, ctx, session) : probeLegacyCid(cid, ctx, session);
  }

  async function runCidSweep(list, source, ctx, session, onProgress) {
    const results = new Map();
    const unresolved = new Set(list);
    const stats = { attempted: 0, ok: 0, noPrice: 0, httpErrors: 0, rateLimited: false, stopped: false, unresolvedCids: [] };
    let next = 0, done = 0, consecutiveErrors = 0;
    const worker = async () => {
      while (true) {
        if (stats.stopped) return;
        const index = next++;
        if (index >= list.length) return;
        const cid = list[index];
        const outcome = await probeCid(cid, source, ctx, session);
        const total = outcome.total;
        stats.attempted++;
        if (outcome.ok) {
          stats.ok++;
          consecutiveErrors = 0;
          unresolved.delete(cid);
          if (total === null) stats.noPrice++;
        } else {
          stats.httpErrors++;
          consecutiveErrors++;
          if (outcome.status === 429) {
            stats.rateLimited = true;
            stats.stopped = true;
          } else if (consecutiveErrors >= 8) stats.stopped = true;
        }
        if (total !== null) results.set(cid, total);
        done++;
        cidStatus = { phase: 'scanning', done, total: list.length, source };
        if (onProgress) onProgress(done, list.length, cid, total);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CID_CONCURRENCY, list.length) }, () => worker()));
    stats.unresolvedCids = [...unresolved];
    return { results, stats };
  }

  async function runCidSweepWithRetries(list, source, ctx, session, onProgress, maxPasses = 3) {
    const results = new Map();
    let pending = list.slice();
    let totalHttpErrors = 0;
    let rateLimited = false;
    for (let pass = 0; pass < maxPasses && pending.length; pass++) {
      if (pass > 0) {
        notify(`응답 누락 CID ${pending.length}개만 재시도 (${pass + 1}/${maxPasses})`);
        await sleep(Math.min(4000, 750 * pass));
      }
      const sweep = await runCidSweep(pending, source, ctx, session, onProgress);
      sweep.results.forEach((total, cid) => results.set(cid, total));
      totalHttpErrors += sweep.stats.httpErrors;
      pending = sweep.stats.unresolvedCids;
      rateLimited = rateLimited || sweep.stats.rateLimited;
      if (rateLimited) break;
    }
    return {
      results,
      stats: {
        complete: pending.length === 0,
        resolvedCount: list.length - pending.length,
        unresolvedCids: pending,
        httpErrors: totalHttpErrors,
        rateLimited,
        stopped: pending.length > 0
      }
    };
  }

  function stableMedianTotal(values) {
    const sorted = (Array.isArray(values) ? values : [])
      .filter(value => Number.isFinite(value) && value > 0).slice().sort((a, b) => a - b);
    if (sorted.length < 2) return null;
    const median = sorted[Math.floor(sorted.length / 2)];
    const tolerance = Math.max(0.01, median * 0.005);
    const stable = sorted.filter(value => Math.abs(value - median) <= tolerance);
    return stable.length >= 2 ? stable[Math.floor(stable.length / 2)] : null;
  }

  function verificationBlockerCids(results, verified, rejected, bestTotal, epsilon) {
    return [...results.entries()]
      .filter(([cid, total]) => !rejected.has(cid) && !verified.has(cid) && total < bestTotal - epsilon)
      .map(([cid]) => cid);
  }

  function verificationCandidateCids(results, activeCid) {
    const ranked = [...results.entries()]
      .sort((a, b) => a[1] - b[1] || a[0] - b[0])
      .map(([cid]) => cid);
    const prioritized = [...new Set([activeCid, ...ranked])];
    return [prioritized[0], ...prioritized.slice(1, CID_VERIFY_MAX_CANDIDATES + 1)];
  }

  async function verifyCidCandidates(results, source, ctx, activeCid, session) {
    const candidates = verificationCandidateCids(results, activeCid);
    const verified = new Map();
    const attempted = new Set();
    let done = 0;
    const total = candidates.length * CID_VERIFY_ROUNDS;

    const verifyOne = async cid => {
      if (attempted.has(cid)) return;
      attempted.add(cid);
      cidStatus = { phase: 'verifying', done, total, source };
      const values = results.has(cid) ? [results.get(cid)] : [];
      for (let round = 0; round < CID_VERIFY_ROUNDS; round++) {
        const outcome = await probeCid(cid, source, ctx, session);
        done++;
        cidStatus = { phase: 'verifying', done, total, source };
        if (outcome.ok && outcome.total !== null) values.push(outcome.total);
      }
      const stable = stableMedianTotal(values);
      if (stable !== null) verified.set(cid, stable);
    };

    notify(`현재 CID와 최저 후보 교차검증 — 최대 ${CID_VERIFY_MAX_CANDIDATES}개`);
    for (let index = 0; index < candidates.length; index += CID_VERIFY_TOP) {
      const batch = candidates.slice(index, index + CID_VERIFY_TOP);
      await Promise.all(batch.map(cid => verifyOne(cid)));
    }
    return {
      verified,
      attempted: [...attempted],
      failedCids: [...attempted].filter(cid => !verified.has(cid)),
      exhausted: candidates.length >= new Set([activeCid, ...results.keys()]).size
    };
  }

  function pendingCidToken(ctx) {
    try {
      const token = JSON.parse(sessionStorage.getItem(CID_FIXED_FLAG) || 'null');
      if (!token || token.pending !== true || !token.ts || Date.now() - token.ts > 5 * 60 * 1000) return null;
      if (ctx && token.sig !== criteriaSignature(ctx)) return null;
      return token;
    } catch (e) { return null; }
  }

  async function waitForNaturalObservation(ctx, cid, since, session, timeout = CID_NATURAL_RESPONSE_TIMEOUT) {
    const signature = criteriaSignature(ctx);
    const deadline = Date.now() + timeout;
    while (Date.now() <= deadline) {
      for (let i = naturalPriceObservations.length - 1; i >= 0; i--) {
        const item = naturalPriceObservations[i];
        if (item.signature === signature && item.cid === cid && item.observedAt >= since &&
            item.kind === session.source && item.fingerprint === session.fingerprint) return item;
      }
      await sleep(250);
    }
    return null;
  }

  function failPendingCid(token, ctx, message) {
    rejectCid(token.cid, ctx);
    clearCidCache(ctx);
    try { sessionStorage.removeItem(CID_FIXED_FLAG); } catch (e) {}
    notify(message);
    const rollbackCid = normalizeCid(token.fromCid);
    if (!token.rollback && rollbackCid !== null && rollbackCid !== normalizeCid(token.cid)) {
      if (redirectToCid(rollbackCid, token.cid, ctx, null, { rollback: true })) return 'redirected';
    }
    return 'rescan';
  }

  async function confirmPendingCid(ctx, source, session) {
    const token = pendingCidToken(ctx);
    if (!token) return null;
    const naturalCid = normalizeCid(ctx.activeCid);
    if (naturalCid !== normalizeCid(token.cid)) {
      return failPendingCid(token, ctx,
        `적용 확인 실패 — 요청 CID가 ${naturalCid ?? '없음'}으로 응답해 ${token.cid} 제외`);
    }
    const natural = await waitForNaturalObservation(ctx, token.cid, token.ts, session);
    const values = natural && natural.total !== null ? [natural.total] : [];
    for (let round = 0; round < CID_VERIFY_ROUNDS; round++) {
      const outcome = await probeCid(token.cid, source, ctx, session);
      if (outcome.ok && outcome.total !== null) values.push(outcome.total);
    }
    const appliedTotal = stableMedianTotal(values);
    const expected = Number.isFinite(token.expectedTotal) && token.expectedTotal > 0 ? token.expectedTotal : null;
    const tolerance = expected !== null ? Math.max(0.01, expected * 0.01) : Infinity;
    const naturalTolerance = appliedTotal !== null ? Math.max(0.01, appliedTotal * 0.005) : 0;
    if (!natural || appliedTotal === null || natural.total > appliedTotal + naturalTolerance || (expected !== null &&
        (natural.total > expected + tolerance || appliedTotal > expected + tolerance))) {
      return failPendingCid(token, ctx,
        `적용 후 실제 가격 확인 실패 — cid ${token.cid}를 이번 검색에서 제외하고 원래 채널로 복귀해`);
    }
    const cached = getCidCache(ctx);
    if (cached && cached.bestCid === token.cid) {
      setCidCache(Object.assign({}, cached, {
        confirmedCid: token.cid, appliedAt: Date.now(), appliedTotal,
        verifiedAt: Date.now()
      }), ctx);
    }
    try { sessionStorage.removeItem(CID_FIXED_FLAG); } catch (e) {}
    clearRedirectHistory(ctx);
    if (token.rollback) {
      cidStatus = { phase: 'rollback', done: 1, total: 1, source };
      notify(`원래 cid ${token.cid} 복귀 확인 — 실패 채널을 제외하고 다시 비교해`);
      return 'rollback-confirmed';
    }
    rememberCid(token.cid);
    cidStatus = { phase: 'applied', done: 1, total: 1, source };
    notify(`cid ${token.cid} 실제 페이지 적용 확인 — ${formatNum(appliedTotal)}`);
    return 'confirmed';
  }

  async function waitForProbeContext(requireCaptured = false) {
    for (let i = 0; i < 30; i++) {
      const ctx = probeContext();
      const captured = !!(capturedRoomGridTemplate || capturedLegacyTemplate);
      if (ctx && ctx.hotelId && ctx.checkIn && (!requireCaptured || captured)) return ctx;
      await sleep(400);
    }
    if (requireCaptured && !(capturedRoomGridTemplate || capturedLegacyTemplate)) return null;
    return probeContext();
  }

  async function ensureCheapCid(options = {}) {
    if (!settings.cidFix || !isPropertyPage()) return;
    if (cidSweepPromise) {
      const nextSignature = criteriaSignature();
      if (options.force || (nextSignature && nextSignature !== cidSweepSignature)) {
        cidSweepQueued = {
          force: !!(options.force || cidSweepQueued && cidSweepQueued.force),
          full: !!(options.full || cidSweepQueued && cidSweepQueued.full),
          deep: !!(options.deep || cidSweepQueued && cidSweepQueued.deep)
        };
      }
      return cidSweepPromise;
    }
    cidSweepPromise = (async () => {
      const hadPending = !!pendingCidToken();
      const ctx = await waitForProbeContext(true);
      if (!ctx || !ctx.hotelId || !ctx.checkIn) {
        cidStatus = { phase: 'error', done: 0, total: 0, source: null };
        notify(`cid 검색 실패 — 객실 가격 API가 아직 없어. 객실 목록이 보인 뒤 [실사용 CID ${ACTIVE_CIDS.length}개 검사]를 눌러줘`);
        return;
      }
      const startSignature = criteriaSignature(ctx);
      cidSweepSignature = startSignature;
      if (options.force) {
        clearCidCache(ctx);
        clearRejectedCids(ctx);
        clearRedirectHistory(ctx);
        try { sessionStorage.removeItem(CID_FIXED_FLAG); } catch (e) {}
      }
      let source = capturedRoomGridTemplate && String(capturedRoomGridTemplate.hotelId) === String(ctx.hotelId) ? 'room-grid' : 'secondary';
      let session = createProbeSession(source, ctx);
      if (!options.force && hadPending) {
        const pendingResult = await confirmPendingCid(ctx, source, session);
        if (pendingResult === 'confirmed' || pendingResult === 'redirected') return;
      }
      const activeCid = normalizeCid(ctx.activeCid) ?? DEFAULT_CID;
      let cached = options.force ? null : getCidCache(ctx);
      if (cached) {
        const knownCids = [cached.baselineCid, cached.bestCid, cached.confirmedCid]
          .map(normalizeCid).filter(cid => cid !== null);
        if (!knownCids.includes(activeCid)) {
          clearCidCache(ctx);
          cached = null;
          notify(`새 유입 cid ${activeCid}는 기존 캐시 기준 밖이라 전체 가격을 다시 비교해`);
        }
      }
      if (cached && cached.bestCid !== undefined) {
        cidStatus = { phase: 'cached', done: cached.validCount || 0, total: cached.candidateCount || 0, source: cached.source };
        if (cached.bestCid === null && cached.baselineCid === activeCid) return;
        if (cached.confirmedCid === activeCid) return;
        if (cached.bestCid === activeCid) {
          clearCidCache(ctx);
          cached = null;
          notify(`cid ${activeCid}의 적용 확인 기록이 없어 다시 검증해`);
        }
      }
      if (cached && cached.bestCid !== undefined) {
        if (cached.baselineCid !== activeCid) {
          clearCidCache(ctx);
          cached = null;
        }
      }
      if (cached && cached.bestCid !== null) {
        notify(`저장된 최저 cid ${cached.bestCid} 적용`);
        if (!redirectToCid(cached.bestCid, activeCid, ctx, cached.bestTotal)) {
          clearCidCache(ctx);
          cidStatus = { phase: 'loop-blocked', done: 0, total: 0, source: cached.source };
        }
        return;
      }

      const list = buildProbeList(ctx, { full: !!options.full, deep: !!options.deep });
      const modeLabel = options.deep ? '공개 CID 전체 감사' : (options.full ? '실사용 CID 전체 비교' : '빠른 CID 비교');
      const sampleList = [...new Set([activeCid, DEFAULT_CID, ...rememberedCids(), ...list])]
        .filter(cid => normalizeCid(cid) !== null && (cid === activeCid || !rejectedCids(ctx).has(cid))).slice(0, 10);
      const sampleIsUsable = sample => sample.results.has(activeCid) && sample.results.size >= 2 &&
        sample.results.size / Math.max(1, sampleList.length) >= 0.7;
      notify(`${modeLabel} 사전 점검 — ${sampleList.length}개, ${source === 'room-grid' ? '최신 API' : '호환 API'}`);
      let sampleSweep = await runCidSweepWithRetries(sampleList, source, ctx, session, (done, total) => {
        if (done === total) notify(`${source === 'room-grid' ? '최신' : '호환'} 표본 ${done}/${total} 확인`);
      }, 1);

      if (sampleSweep.stats.rateLimited) {
        cidStatus = { phase: 'rate-limited', done: sampleSweep.results.size, total: list.length, source };
        notify('Agoda 요청 제한이 감지돼 CID 검색을 즉시 멈췄어. 페이지 요청은 더 보내지 않고 다음 방문에서 다시 시도해');
        return;
      }

      if (!sampleIsUsable(sampleSweep) && source === 'room-grid') {
        notify('최신 API에 유효한 기준 가격이 없어 호환 API로 즉시 전환해');
        for (let i = 0; i < 10 && !capturedLegacyTemplate; i++) await sleep(300);
        source = 'secondary';
        session = createProbeSession(source, ctx);
        sampleSweep = await runCidSweepWithRetries(sampleList, source, ctx, session, (done, total) => {
          if (done === total) notify(`호환 표본 ${done}/${total} 확인`);
        }, 1);
        if (sampleSweep.stats.rateLimited) {
          cidStatus = { phase: 'rate-limited', done: sampleSweep.results.size, total: list.length, source };
          notify('Agoda 요청 제한이 감지돼 CID 검색을 즉시 멈췄어. 페이지 요청은 더 보내지 않고 다음 방문에서 다시 시도해');
          return;
        }
      }

      let results = sampleSweep.results;
      let completed = false;
      let unresolvedCids = sampleSweep.stats.unresolvedCids.slice();
      const sampled = new Set(sampleList);
      const remaining = list.filter(cid => !sampled.has(cid));
      if (sampleIsUsable(sampleSweep)) {
        notify(`${source === 'room-grid' ? '최신' : '호환'} API 표본 정상 — 나머지 ${remaining.length}개 확인 중...`);
        const restSweep = await runCidSweepWithRetries(remaining, source, ctx, session, (done, total) => {
          if (done % 20 === 0 || done === total) notify(`cid 검색 ${done}/${total}...`);
        }, 2);
        if (restSweep.stats.rateLimited) {
          cidStatus = { phase: 'rate-limited', done: sampleSweep.results.size + restSweep.results.size, total: list.length, source };
          notify('Agoda 요청 제한이 감지돼 CID 검색을 즉시 멈췄어. 페이지 요청은 더 보내지 않고 다음 방문에서 다시 시도해');
          return;
        }
        results = new Map([...sampleSweep.results, ...restSweep.results]);
        completed = sampleSweep.stats.complete && restSweep.stats.complete;
        unresolvedCids = [...sampleSweep.stats.unresolvedCids, ...restSweep.stats.unresolvedCids];
      } else {
        unresolvedCids = [...sampleSweep.stats.unresolvedCids, ...remaining];
      }

      const scannedBaselineTotal = results.get(activeCid);
      const coverage = list.length ? (list.length - unresolvedCids.length) / list.length : 0;
      if (results.size < 2 || scannedBaselineTotal === undefined || coverage < 0.8) {
        cidStatus = { phase: 'error', done: results.size, total: list.length, source };
        notify(`cid 검색 중단 — ${unresolvedCids.length}개 응답 누락 또는 유효 가격 부족 (${results.size}/${list.length}), 잠시 후 다시 검색해줘`);
        return;
      }
      if (criteriaSignature() !== startSignature) {
        notify('검색 조건이 바뀌어 이전 cid 결과를 폐기했어');
        return;
      }

      const verification = await verifyCidCandidates(results, source, ctx, activeCid, session);
      const verified = verification.verified;
      if (!verified.has(activeCid) || verified.size < 1) {
        cidStatus = { phase: 'error', done: results.size, total: list.length, source };
        notify('기준 CID 교차검증 실패 — 성공한 다른 후보 결과는 폐기하고 잠시 뒤 재시도해');
        return;
      }
      if (criteriaSignature() !== startSignature) {
        notify('재검증 중 검색 조건이 바뀌어 결과를 폐기했어');
        return;
      }

      const baselineTotal = verified.get(activeCid);
      const rejected = rejectedCids(ctx);
      const activeRejected = rejected.has(activeCid);
      let bestCid = activeRejected ? null : activeCid;
      let bestTotal = activeRejected ? Infinity : baselineTotal;
      for (const [cid, total] of verified) {
        if (rejected.has(cid)) continue;
        if (total < bestTotal) { bestCid = cid; bestTotal = total; }
      }
      if (bestCid === null) {
        cidStatus = { phase: 'error', done: results.size, total: list.length, source };
        notify('적용 확인에 실패한 현재 CID 외에 안정적인 대체 후보를 찾지 못했어');
        return;
      }
      const epsilon = Math.max(0.01, baselineTotal * 0.0001);
      const verificationBlockers = verificationBlockerCids(results, verified, rejected, bestTotal, epsilon);
      if (verificationBlockers.length) {
        cidStatus = { phase: 'verification-blocked', done: verified.size, total: results.size, source };
        notify(`더 싸게 보인 CID ${verificationBlockers.length}개의 재검증이 불안정해 자동 적용·캐시를 보류해`);
        return;
      }
      const isBetter = activeRejected ? bestCid !== activeCid : bestTotal < baselineTotal - epsilon;
      const cacheData = {
        cacheVersion: CID_CACHE_VERSION, registryVersion: CID_REGISTRY_VERSION,
        bestCid: isBetter ? bestCid : null, bestTotal, baselineCid: activeCid,
        baselineTotal, noCheap: !isBetter, source,
        scanMode: options.deep ? 'public-deep' : (options.full ? 'active-full' : 'fast'),
        validCount: results.size, candidateCount: list.length,
        verifiedCount: verified.size, verificationFailedCount: verification.failedCids.length,
        verifiedAt: Date.now(),
        confirmedCid: isBetter ? null : activeCid,
        complete: completed, unresolvedCount: unresolvedCids.length,
        unresolvedCids: unresolvedCids.slice(0, 50),
        ttlMs: completed ? CID_CACHE_TTL : 5 * 60 * 1000
      };
      cidStatus = { phase: 'done', done: results.size, total: list.length, source };

      if (!isBetter) {
        if (!completed) {
          clearCidCache(ctx);
          notify(`응답된 ${results.size}개에서는 현재 cid가 최저지만 ${unresolvedCids.length}개 누락 때문에 음성 결과를 저장하지 않아`);
          return;
        }
        setCidCache(cacheData, ctx);
        rememberCid(activeCid);
        notify(`확인한 ${results.size}개 중 현재 cid ${activeCid}가 최저 — ${formatNum(baselineTotal)}`);
        return;
      }
      setCidCache(cacheData, ctx);
      if (activeRejected) {
        notify(`실패 CID를 제외한 안전 대체 cid ${bestCid} 발견 — ${formatNum(bestTotal)}`);
      } else {
        const saved = baselineTotal - bestTotal;
        const percent = baselineTotal > 0 ? saved / baselineTotal * 100 : 0;
        notify(`${completed ? '검증 최저' : '응답 누락 제외 검증 최저'} cid ${bestCid} 발견 — ${formatNum(bestTotal)} (${formatNum(saved)}, ${percent.toFixed(1)}% 절약)`);
      }
      if (!redirectToCid(bestCid, activeCid, ctx, bestTotal)) {
        clearCidCache(ctx);
        cidStatus = { phase: 'loop-blocked', done: results.size, total: list.length, source };
      }
    })().finally(() => {
      cidSweepPromise = null;
      cidSweepSignature = null;
      const queued = cidSweepQueued;
      cidSweepQueued = null;
      if (queued) setTimeout(() => ensureCheapCid(queued), 0);
    });
    return cidSweepPromise;
  }

  function cidDestinationUrl(rawUrl, cid) {
    const url = new URL(rawUrl, location.href);
    ['tag', 'ds', 'searchrequestid', 'pcs', 'pslc'].forEach(key => url.searchParams.delete(key));
    url.searchParams.set('cid', String(cid));
    if (CID_TAGS[cid]) url.searchParams.set('tag', CID_TAGS[cid]);
    return url.toString();
  }

  function redirectToCid(cid, fromCid, ctx = probeContext(), expectedTotal = null, options = {}) {
    try {
      const sig = criteriaSignature(ctx) || location.pathname;
      const token = { sig, cid, fromCid, expectedTotal, pending: true, rollback: !!options.rollback, ts: Date.now() };
      const oldRaw = sessionStorage.getItem(CID_FIXED_FLAG);
      const old = oldRaw ? JSON.parse(oldRaw) : null;
      if (old && old.pending && old.sig === sig && old.cid === cid && Date.now() - old.ts < 3 * 60 * 1000) {
        notify('반복 이동을 막았어 — [CID 다시 검색]으로 재시도 가능');
        return false;
      }
      const history = redirectHistory(ctx);
      if (history.includes(cid) || history.length >= CID_REDIRECT_MAX_HOPS) {
        notify(`CID 반복 이동 차단 — 이번 조건에서 최대 ${CID_REDIRECT_MAX_HOPS}회까지만 적용해`);
        return false;
      }
      const historyKey = redirectHistoryKey(ctx);
      if (historyKey) sessionStorage.setItem(historyKey, JSON.stringify([...history, cid]));
      sessionStorage.setItem(CID_FIXED_FLAG, JSON.stringify(token));
      location.replace(cidDestinationUrl(location.href, cid));
      return true;
    } catch (e) {
      notify('cid URL 적용 실패: ' + e.message);
      return false;
    }
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
    const prices = collectPrices(document);
    if (prices.length === 0) {
      if (settings.watchPrice) logDiagnostics();
      if (lastScan !== '') {
        lastScan = '';
        updatePanel([]);
      }
      return;
    }
    if (settings.highlight) highlightLowest(prices);
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
        <span>🏷 아고다 최저가 v1.9.7</span>
        <button id="nyx-agoda-collapse" title="접기">—</button>
      </div>
      <div id="nyx-agoda-panel-body">
        <div id="nyx-agoda-info">로딩 중...</div>
        <div id="nyx-agoda-controls">
          <label><input type="checkbox" id="nyx-agoda-cfg-highlight" ${settings.highlight ? 'checked' : ''}> 최저가 하이라이트</label>
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
          <button id="nyx-agoda-cid-rescan">🔎 실사용 CID ${ACTIVE_CIDS.length}개 검사</button>
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
      ensureCheapCid({ force: true, full: true });
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
    } else if (cidStatus.phase === 'applied') {
      html += '<br><span style="color:#22c55e">CID 적용·가격 확인 완료 ✓</span>';
    } else if (cidStatus.phase === 'rollback') {
      html += '<br><span style="color:#f59e0b">실패 CID 제외 후 원래 채널 복귀 ✓</span>';
    } else if (cidStatus.phase === 'verification-blocked') {
      html += '<br><span style="color:#dc2626">더 싼 미검증 후보가 있어 자동 적용 보류</span>';
    } else if (cidStatus.phase === 'rate-limited') {
      html += '<br><span style="color:#dc2626">Agoda 요청 제한 감지 — CID 검색 중지</span>';
    } else if (cidStatus.phase === 'loop-blocked') {
      html += '<br><span style="color:#dc2626">반복 CID 이동 차단</span>';
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
    const obs = new MutationObserver(() => {
      if (settings.highlight || settings.watchPrice) scheduleScan();
    });
    obs.observe(document.body, { childList: true, subtree: true });
    const cidLocationKey = () => {
      const c = urlCriteria();
      return [location.pathname, c.checkIn, c.checkOut || c.los, c.rooms, c.adults, c.children, c.childrenAges, c.curr, currentCid() ?? ''].join('|');
    };
    let lastCidNavKey = cidLocationKey();
    setInterval(() => {
      const panel = document.getElementById('nyx-agoda-panel');
      if (!isPropertyPage()) {
        if (panel) panel.style.display = 'none';
        return;
      }
      if (panel) panel.style.display = '';
      scheduleScan();
      const nextCidNavKey = cidLocationKey();
      if (nextCidNavKey !== lastCidNavKey) {
        lastCidNavKey = nextCidNavKey;
        capturedLegacyTemplate = null;
        capturedRoomGridTemplate = null;
        if (isPropertyPage()) hookCidCapture();
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
        version: '1.9.7',
        getState: () => ({
          criteria: probeContext(), status: Object.assign({}, cidStatus),
          cache: getCidCache(), registryVersion: CID_REGISTRY_VERSION,
          safeSettingsVersion: SAFE_SETTINGS_VERSION, fastCidCount: FAST_CIDS.length,
          activeCidCount: ACTIVE_CIDS.length, publicObservedCidCount: PUBLIC_OBSERVED_CIDS.length,
          candidateCount: buildProbeList(probeContext()).length,
          captured: { roomGrid: !!capturedRoomGridTemplate, secondary: !!capturedLegacyTemplate }
        }),
        rescanCid: (mode = 'fast') => ensureCheapCid({
          force: true,
          full: mode === 'full',
          deep: mode === 'deep' || mode === true
        }),
        clearCidCache: () => clearCidCache(),
        test: Object.freeze({
          stableMedianTotal,
          extractModernTotal,
          verificationCandidateCids: (results, activeCid) => verificationCandidateCids(new Map(results), activeCid),
          cidDestinationUrl,
          probeUrlForCid,
          modernProbeUrlForCid,
          criteriaSignature,
          verificationBlockers: (results, verified, rejected, bestTotal, epsilon = 0.01) =>
            verificationBlockerCids(new Map(results), new Map(verified), new Set(rejected), bestTotal, epsilon),
          campaignCidsFrom: payload => {
            const found = new Set();
            collectCampaignCids(payload, found);
            return [...found];
          },
          fastCids: () => FAST_CIDS.slice(),
          activeCids: () => ACTIVE_CIDS.slice(),
          publicObservedCids: () => PUBLIC_OBSERVED_CIDS.slice()
        })
      })
    });
  } catch (e) {}

  let initialized = false;
  let propertyBootScheduled = false;
  function bootOnPropertyPage() {
    if (initialized || propertyBootScheduled || !isPropertyPage()) return;
    propertyBootScheduled = true;
    hookCidCapture();
    const finishBoot = () => setTimeout(() => {
      propertyBootScheduled = false;
      if (initialized || !isPropertyPage() || !document.body) return;
      initialized = true;
      init();
    }, 1500);
    if (document.readyState === 'complete') finishBoot();
    else window.addEventListener('load', finishBoot, { once: true });
  }

  function startPropertyWatcher() {
    bootOnPropertyPage();
    const timer = setInterval(() => {
      bootOnPropertyPage();
      if (initialized) clearInterval(timer);
    }, 250);
  }

  if (document.body) startPropertyWatcher();
  else document.addEventListener('DOMContentLoaded', startPropertyWatcher, { once: true });
})();

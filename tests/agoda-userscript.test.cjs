const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'agoda-userscript.user.js'), 'utf8');
const registry = JSON.parse(fs.readFileSync(path.join(root, 'agoda-cids.json'), 'utf8'));

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.has(String(key)) ? values.get(String(key)) : null,
    setItem: (key, value) => values.set(String(key), String(value)),
    removeItem: key => values.delete(String(key))
  };
}

class FakeXhr {
  open() {}
  setRequestHeader() {}
  send() {}
  addEventListener() {}
}

const pageUrl = new URL('https://www.agoda.com/ko-kr/example/hotel/osaka-jp.html?checkIn=2026-10-07&los=2&rooms=1&adults=2&cid=2');
const context = {
  AbortController,
  Headers,
  Request,
  URL,
  XMLHttpRequest: FakeXhr,
  btoa: value => Buffer.from(String(value), 'utf8').toString('base64'),
  clearTimeout,
  console,
  document: {
    body: null,
    cookie: '',
    documentElement: { innerHTML: '' },
    addEventListener() {},
    querySelectorAll() { return []; }
  },
  localStorage: memoryStorage(),
  location: {
    href: pageUrl.href,
    pathname: pageUrl.pathname,
    search: pageUrl.search,
    replace() {}
  },
  sessionStorage: memoryStorage(),
  setTimeout
};
context.window = context;
vm.createContext(context);
vm.runInContext(source, context, { filename: 'agoda-userscript.user.js' });

const api = context.__NYX_AGODA__;
assert(api, 'debug/test API should be exposed');
assert.equal(api.version, '1.9.7');
assert.equal(api.getState().safeSettingsVersion, '1.9.5');
assert(source.includes('// @exclude      https://www.agoda.com/*/search*'), 'search pages must never receive the panel');
assert(source.includes("if (initialized || propertyBootScheduled || !isPropertyPage()) return;"));
assert(api.getState().candidateCount < 60, 'automatic scan must stay on the safe shortlist');
assert(!source.includes('function autoSelectLowest('), 'the script must never auto-click a booking button');
assert(!source.includes('if (settings.autoSelect) autoSelectLowest(prices);'));

const active = api.test.activeCids();
const observed = api.test.publicObservedCids();
assert(active.length > 100, 'active registry must not regress to the original 46-CID seed');
assert.equal(new Set(active).size, active.length, 'active registry must be unique');
const invalidActive = Array.from(active).filter(cid => !Number.isInteger(cid) || cid < 1_000_000 || cid > 9_999_999);
assert.equal(invalidActive.length, 0, `invalid active CIDs: ${JSON.stringify(invalidActive)}`);
assert(active.includes(1917400), 'official Android app CID must be retained');
assert.deepEqual(Array.from(active), [...registry.activeHigh, ...registry.activeLow.map(item => item.cid)]);
assert.equal(registry.counts.activeHigh, registry.activeHigh.length);
assert.equal(registry.counts.activeLow, registry.activeLow.length);
assert.equal(registry.counts.activeTotal, active.length);

const toolRegistry = registry.sources.publicTools;
const finderCids = [...toolRegistry.agodaFinder.searchable, ...toolRegistry.agodaFinder.noSearch];
const toolUnion = new Set([
  ...toolRegistry.agodaPrice.cids,
  ...toolRegistry.agodaHunter.cids,
  ...finderCids
]);
assert.equal(toolRegistry.agodaPrice.cids.length, 41);
assert.equal(toolRegistry.agodaHunter.cids.length, 25);
assert.equal(finderCids.length, 21);
assert.equal(toolRegistry.agodaFinder.searchable.length, 19);
assert.equal(toolUnion.size, 46, 'the original 46 are exactly the three public-tool union');
assert.deepEqual([...toolUnion].sort((a, b) => a - b), toolRegistry.union);
assert.equal(registry.counts.publicToolUnion, toolUnion.size);
assert.equal(registry.counts.agodaPrice, toolRegistry.agodaPrice.cids.length);
assert.equal(registry.counts.agodaHunter, toolRegistry.agodaHunter.cids.length);
assert.equal(registry.counts.agodaFinder, finderCids.length);
assert.equal(registry.counts.agodaFinderSearchable, toolRegistry.agodaFinder.searchable.length);

const fast = api.test.fastCids();
const expectedFast = [...new Set([...toolRegistry.union, registry.sources.officialAndroidApp.cid])]
  .sort((a, b) => a - b);
assert.equal(fast.length, 47, 'fast automatic pass is the public-tool union plus official app CID');
assert.deepEqual(Array.from(fast), expectedFast);
assert.equal(api.getState().fastCidCount, fast.length);

const sourceCoverage = new Set([
  ...Object.keys(registry.sources.officialAgodaPaths).map(Number),
  ...registry.sources.publicToolHigh.cids,
  registry.sources.officialAndroidApp.cid
]);
assert.equal(Object.keys(registry.sources.officialAgodaPaths).length, 133);
assert.equal(registry.sources.publicToolHigh.cids.length, 39);
assert.equal(sourceCoverage.size, 173, 'historical evidence union stays at 173 public paths');
assert.equal(registry.counts.activeHigh, 272, 'verified room-grid winners are the apply target');
assert.equal(registry.counts.activeLow, 96);
assert.equal(registry.counts.activeTotal, 368);
assert.deepEqual([...sourceCoverage].filter(cid => !active.includes(cid)),
  [1776095, 1934182, 1934184, 1934186],
  'only the 4 rate-limited evidence CIDs may remain outside the verified registry');

const allActiveSources = new Set([
  ...Object.keys(registry.sources.officialAgodaPaths).map(Number),
  ...toolRegistry.union,
  registry.sources.officialAndroidApp.cid
]);
assert.equal(allActiveSources.size, 180, 'evidence sources are still 180 public paths');

assert.equal(observed.length, 241);
assert.equal(new Set(observed).size, 241);
assert(observed.every(cid => Number.isInteger(cid) && cid >= 1_000_000 && cid <= 9_999_999));
assert(!observed.includes(1234567), 'placeholder CID must never enter the registry');
assert.deepEqual(Array.from(observed), registry.publicObserved);
assert.equal(new Set([...active, ...observed]).size, 368);
assert.equal(registry.counts.publicDeepUnique, 368);
assert.equal(registry.sources.noCidBaseline.cid, 1733380);
assert(!active.includes(1733380), 'the no-CID default attribution must not become an apply target');

assert.equal(api.test.stableMedianTotal([800, 800]), 800);
assert.equal(api.test.stableMedianTotal([100, 1300, 1300]), 1300, 'one transient fake-low sample must lose');
assert.equal(api.test.stableMedianTotal([800, 600, 600]), 600, 'one transient fake-high sample must lose');
assert.equal(api.test.stableMedianTotal([800]), null, 'a single response is not a quorum');
assert.equal(api.test.stableMedianTotal([700, 900, 1100]), null, 'unstable samples must not be applied');

const twoAdultTotal = api.test.extractModernTotal({
  rooms: [
    {
      name: 'Single room · MAX_OCCUPANCY 1 · for 1 person',
      roomCapacity: { maxAllowedAdults: 1, actualNumberOfAdults: 2, numberOfGuestsWithoutRoom: 1 },
      offers: [{
        'data-adults': '1',
        occupancyItems: [{ type: 'AMENITIES_ERROR' }],
        analyticsContext: { hotel_price_per_book: 220727 }
      }]
    },
    {
      offers: [{ analyticsContext: { hotel_price_per_book: 264251 } }]
    }
  ],
  cheapestPrice: { analyticsContext: { hotel_price_per_book: 220727 } }
}, { adults: '2', rooms: '1' });
assert.equal(twoAdultTotal, 264251, 'one-person offer and global cheapest must not pollute a two-adult search');
assert.equal(api.test.extractModernTotal({
  rooms: [{ offers: [{ analyticsContext: { hotel_price_per_book: 700 } }] }],
  cheapestPrice: { analyticsContext: { hotel_price_per_book: 700 } }
}, { adults: '2', rooms: '1' }), 700, 'offers without occupancy metadata remain valid');
assert.equal(api.test.extractModernTotal({
  rooms: [{ offers: [{
    occupancyItems: [{ type: 'AMENITIES_ERROR' }],
    analyticsContext: { hotel_price_per_book: 700 }
  }] }],
  cheapestPrice: { analyticsContext: { hotel_price_per_book: 600 } }
}, { adults: '2', rooms: '1' }), 700, 'AMENITIES_ERROR alone is not an occupancy rejection signal');
assert.equal(api.test.extractModernTotal({
  rooms: [
    { roomCapacity: { maxAllowedAdults: 1 }, maxOccupancy: 2, offers: [{ analyticsContext: { hotel_price_per_book: 600 } }] },
    { roomCapacity: { maxAllowedAdults: 2 }, offers: [{ analyticsContext: { hotel_price_per_book: 700 } }] }
  ],
  cheapestPrice: { analyticsContext: { hotel_price_per_book: 600 } }
}, { adults: '2', rooms: '1' }), 700, 'adult capacity is enforced independently from total room occupancy');
assert.equal(api.test.extractModernTotal({
  rooms: [{ isSoldOut: true, offers: [{ analyticsContext: { hotel_price_per_book: 600 } }] }],
  cheapestPrice: { analyticsContext: { hotel_price_per_book: 600 } }
}, { adults: '2', rooms: '1' }), null, 'no eligible structured offer must trigger the legacy fallback');

const verificationPlan = Array.from(api.test.verificationCandidateCids([
  [101, 700], [102, 710], [103, 720], [104, 730], [105, 740], [106, 800]
], 999));
assert.deepEqual(
  verificationPlan,
  [999, 101, 102, 103, 104, 105, 106],
  'the bounded verification plan must include more than one five-CID UI batch'
);
const boundedVerificationPlan = Array.from(api.test.verificationCandidateCids(
  Array.from({ length: 30 }, (_, index) => [1000 + index, 700 + index]),
  999
));
assert.equal(boundedVerificationPlan.length, 21, 'the active CID plus at most 20 lowest candidates are rechecked');
assert.deepEqual(boundedVerificationPlan.slice(0, 3), [999, 1000, 1001]);

const baseCriteria = {
  hotelId: '33494376', checkIn: '2026-10-07', checkOut: '2026-10-09',
  los: '2', rooms: '1', adults: '2', children: '1', curr: 'KRW'
};
assert.notEqual(
  api.test.criteriaSignature({ ...baseCriteria, childrenAges: '3' }),
  api.test.criteriaSignature({ ...baseCriteria, childrenAges: '12' }),
  'child ages must have separate price/cache fingerprints'
);

assert.deepEqual(
  Array.from(api.test.verificationBlockers([[11, 600], [22, 700]], [[22, 700]], [], 700)),
  [11],
  'an unverified candidate initially below the selected total must block application'
);
assert.deepEqual(
  Array.from(api.test.verificationBlockers([[11, 600], [22, 700]], [[22, 700]], [11], 700)),
  [],
  'a quarantined failed CID is not a verification blocker'
);

const tagged = new URL(api.test.cidDestinationUrl(
  'https://www.agoda.com/example?cid=2&tag=stale&ds=abc&searchrequestid=old&pcs=1&pslc=1&los=2',
  1937708
));
assert.equal(tagged.searchParams.get('cid'), '1937708');
assert.equal(tagged.searchParams.get('tag'), 'A100692912');
for (const stale of ['ds', 'searchrequestid', 'pcs', 'pslc']) assert.equal(tagged.searchParams.has(stale), false);
assert.equal(tagged.searchParams.get('los'), '2');

const untagged = new URL(api.test.cidDestinationUrl(
  'https://www.agoda.com/example?cid=2&tag=stale&ds=abc',
  1917400
));
assert.equal(untagged.searchParams.get('cid'), '1917400');
assert.equal(untagged.searchParams.has('tag'), false);
assert.equal(untagged.searchParams.has('ds'), false);

const taggedProbe = new URL(api.test.probeUrlForCid('/api/v1/property/room-grid?ds=stale', 1937708), pageUrl);
assert.equal(taggedProbe.searchParams.get('cid'), '1937708');
assert.equal(taggedProbe.searchParams.get('tag'), 'A100692912');
assert.equal(taggedProbe.searchParams.has('ds'), false);

const modernProbe = new URL(api.test.modernProbeUrlForCid('/api/v1/property/room-grid?cid=2&ds=stale', 1917400), pageUrl);
assert.equal(modernProbe.searchParams.has('cid'), false, 'modern API carries CID only in ag-cid header');
assert.equal(modernProbe.searchParams.has('ds'), false);

const campaignCids = Array.from(api.test.campaignCidsFrom({
  siteId: 1999999,
  cid: 1888888,
  activeCid: 1917400,
  roomContext: { campaignInfo: { cid: 1937712 } },
  nested: [{ campaignCid: '1945153' }]
})).sort((a, b) => a - b);
assert.deepEqual(campaignCids, [1917400, 1937712, 1945153]);

assert(!source.includes('stratifiedRangeCids'));
assert(!source.includes('neighboringCids'));
assert(!source.includes('CID_RANGE_SAMPLE_COUNT'));

console.log(`ok - ${active.length} active, ${observed.length} public-observed CIDs; quorum and URL tests passed`);

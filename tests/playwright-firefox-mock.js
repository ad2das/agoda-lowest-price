async page => {
  const calls = new Map();
  const mainPattern = 'https://www.agoda.com/ko-kr/mock-property/**';
  const apiPattern = '**/api/v1/property/room-grid*';

  await page.route(apiPattern, async route => {
    const request = route.request();
    const queryCid = (request.url().match(/[?&]cid=(-?\d+)/) || [])[1];
    const cid = Number(request.headers()['ag-cid'] || queryCid || -1);
    const count = (calls.get(cid) || 0) + 1;
    calls.set(cid, count);

    // A permanently missing candidate must not erase the stable positive winner.
    if (cid === 1959939) {
      await route.abort('failed');
      return;
    }

    let total = 1200;
    if (cid === 2) total = 1000;
    if (cid === 1917400) total = 700;
    if (cid === 1937712) total = 800;
    // First sweep looks impossibly cheap, then both verification calls agree on 1300.
    if (cid === 1641446) total = count === 1 ? 100 : 1300;

    const analyticsContext = { hotel_price_per_book: total };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        rooms: [{ offers: [{ analyticsContext }] }],
        cheapestPrice: { analyticsContext },
        roomContext: { campaignInfo: { cid } }
      })
    });
  });

  await page.route(mainPattern, async route => {
    const html = `<!doctype html>
      <html><head><meta charset="utf-8"><title>Agoda CID mock</title></head>
      <body data-booking-clicks="0"><main id="mock-status">loading</main>
      <button data-selenium="ChildRoomsList-bookButtonInput"
        onclick="document.body.dataset.bookingClicks = String(Number(document.body.dataset.bookingClicks) + 1)">book</button>
      <script>
        (async () => {
          const q = new URL(location.href).searchParams;
          const cid = q.get('cid') || '-1';
          const body = {
            propertyId: 33494376,
            searchCriteria: {
              checkIn: '2026-10-07', checkOut: '2026-10-09',
              rooms: 1, adults: 2, childrenAges: []
            },
            userContext: { currencyId: 'KRW' }
          };
          try {
            const response = await fetch('/api/v1/property/room-grid', {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                'ag-cid': cid,
                'ag-user-id': 'firefox-mock-user'
              },
              body: JSON.stringify(body)
            });
            const json = await response.json();
            const total = json.cheapestPrice.analyticsContext.hotel_price_per_book;
            document.body.dataset.naturalCid = cid;
            document.body.dataset.naturalTotal = String(total);
            document.querySelector('#mock-status').textContent = cid + ':' + total;
          } catch (error) {
            document.querySelector('#mock-status').textContent = 'error:' + error.message;
          }
        })();
      </script></body></html>`;
    await route.fulfill({ status: 200, contentType: 'text/html', body: html });
  });

  await page.addInitScript({ path: 'agoda-userscript.user.js' });
  await page.goto('https://www.agoda.com/ko-kr/mock-property/hotel/osaka-jp.html?checkIn=2026-10-07&checkOut=2026-10-09&los=2&rooms=1&adults=2&children=0&curr=KRW&cid=2');

  let result = null;
  for (let i = 0; i < 110; i++) {
    await page.waitForTimeout(1000);
    try {
      result = await page.evaluate(() => {
        const state = window.__NYX_AGODA__ && window.__NYX_AGODA__.getState();
        return state ? {
          href: location.href,
          naturalCid: document.body && document.body.dataset.naturalCid,
          naturalTotal: document.body && document.body.dataset.naturalTotal,
          bookingClicks: document.body && document.body.dataset.bookingClicks,
          state
        } : null;
      });
      if (result && result.state.status.phase === 'applied') break;
    } catch (error) {}
  }

  if (!result || result.state.status.phase !== 'applied') {
    throw new Error('CID flow did not reach applied state: ' + JSON.stringify(result));
  }
  if (!/[?&]cid=1917400(?:&|$)/.test(result.href)) throw new Error('wrong CID: ' + result.href);
  if (result.naturalCid !== '1917400' || result.naturalTotal !== '700') throw new Error('natural response not confirmed');
  if (result.bookingClicks !== '0') throw new Error('booking button was clicked automatically');
  if (result.state.cache.confirmedCid !== 1917400 || result.state.cache.appliedTotal !== 700) {
    throw new Error('winner cache not confirmed: ' + JSON.stringify(result.state.cache));
  }
  if (result.state.cache.complete !== false || result.state.cache.unresolvedCount !== 1) {
    throw new Error('partial coverage metadata missing: ' + JSON.stringify(result.state.cache));
  }
  if ((calls.get(1641446) || 0) < 3) throw new Error('transient-low candidate was not quorum checked');
  if ((calls.get(1959939) || 0) < 3) throw new Error('missing candidate was not retried');

  return {
    browser: 'firefox',
    finalCid: 1917400,
    naturalTotal: 700,
    bookingClicks: Number(result.bookingClicks),
    phase: result.state.status.phase,
    complete: result.state.cache.complete,
    unresolvedCount: result.state.cache.unresolvedCount,
    transientLowCalls: calls.get(1641446),
    missingCidCalls: calls.get(1959939)
  };
}

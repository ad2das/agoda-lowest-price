async page => {
  const target = 'https://www.agoda.com/ko-kr/apa-hotel-resort-osaka-umeda-eki-tower/hotel/osaka-jp.html?cid=2&checkIn=2026-10-07&checkOut=2026-10-09&los=2&rooms=1&adults=2&children=0&curr=KRW';
  const seed = 'https://www.agoda.com/__codex_agoda_seed__';
  let roomGridRequests = 0;
  page.on('request', request => {
    if (request.url().includes('/api/v1/property/room-grid')) roomGridRequests++;
  });

  await page.route(seed, route => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: '<!doctype html><title>seed</title>'
  }));
  await page.goto(seed);
  await page.evaluate(() => {
    localStorage.setItem('AGODA_MIN_PRICE:settings', JSON.stringify({
      autoSelect: false,
      promoHunt: false,
      highlight: false,
      watchPrice: false,
      cidFix: true
    }));
  });
  await page.unroute(seed);
  await page.addInitScript({ path: 'agoda-userscript.user.js' });
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 90000 });

  const phases = [];
  let lastPhase = '';
  let result = null;
  for (let i = 0; i < 220; i++) {
    await page.waitForTimeout(1000);
    try {
      result = await page.evaluate(() => {
        const state = window.__NYX_AGODA__ && window.__NYX_AGODA__.getState();
        return state ? {
          url: location.href,
          title: document.title,
          state,
          priceTexts: [...document.querySelectorAll('[data-selenium="PriceDisplay"]')]
            .slice(0, 5).map(node => (node.textContent || '').trim()).filter(Boolean)
        } : null;
      });
      const phase = result && result.state.status.phase;
      if (phase && phase !== lastPhase) {
        phases.push({ phase, done: result.state.status.done, total: result.state.status.total });
        lastPhase = phase;
      }
      if (result && (phase === 'applied' || phase === 'done' || phase === 'error' ||
          phase === 'verification-blocked' || phase === 'loop-blocked')) break;
    } catch (error) {}
  }

  return {
    target,
    roomGridRequests,
    phases,
    result
  };
}

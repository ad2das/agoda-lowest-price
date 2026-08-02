async page => {
  const target = 'https://www.agoda.com/book/payment/__codex_coupon_test__';
  await page.evaluate(() => {
    localStorage.setItem('AGODA_MIN_PRICE:safe-settings-version', JSON.stringify('1.10.1'));
    localStorage.setItem('AGODA_MIN_PRICE:settings', JSON.stringify({
      promoHunt: true,
      autoRedeem: false,
      cidFix: false,
      promoList: ['BAD', 'SAVE5', 'SAVE8']
    }));
  });
  await page.addInitScript({ path: 'agoda-userscript.user.js' });
  await page.route(target, route => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: `<!doctype html>
      <html><body><main>
        <section class="coupon-box">
          <input id="coupon" placeholder="coupon code">
          <button id="apply">Apply</button>
          <button id="remove" style="display:none">Remove</button>
          <div id="status"></div>
        </section>
        <section id="summary"><h3>Total</h3><span id="total">KRW 1,000</span></section>
        <script>
          const prices = { SAVE5: 950, SAVE8: 920 };
          apply.onclick = () => {
            const code = coupon.value.toUpperCase();
            if (prices[code]) {
              total.textContent = 'KRW ' + prices[code].toLocaleString();
              status.textContent = code + ' discount applied successfully';
              remove.style.display = 'inline-block';
            } else {
              status.textContent = 'Invalid coupon';
              remove.style.display = 'none';
            }
          };
          remove.onclick = () => {
            coupon.value = '';
            total.textContent = 'KRW 1,000';
            status.textContent = '';
            remove.style.display = 'none';
          };
        <\/script>
      </main></body></html>`
  }));
  await page.goto(target);
  await page.waitForFunction(() => document.querySelector('#nyx-agoda-log')?.textContent.includes('최저 쿠폰 실제 적용 완료'), null, { timeout: 20000 });
  return page.evaluate(() => ({
    version: window.__NYX_AGODA__?.version,
    total: document.querySelector('#total')?.textContent,
    code: document.querySelector('#coupon')?.value,
    status: document.querySelector('#status')?.textContent,
    log: document.querySelector('#nyx-agoda-log')?.textContent
  }));
}

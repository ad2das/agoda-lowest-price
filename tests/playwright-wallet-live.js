async page => {
  const target = 'https://www.agoda.com/ko-kr/apa-hotel-resort-osaka-namba-ekimae-tower/hotel/osaka-jp.html?checkin=2026-10-07&checkout=2026-10-09&los=2&rooms=1&adults=2&children=0&cid=1776688';
  await page.goto('https://www.agoda.com/ko-kr/');
  await page.evaluate(() => {
    localStorage.setItem('AGODA_MIN_PRICE:safe-settings-version', JSON.stringify('1.10.1'));
    localStorage.setItem('AGODA_MIN_PRICE:settings', JSON.stringify({
      promoHunt: false,
      autoRedeem: false,
      cidFix: false,
      highlight: false,
      watchPrice: false
    }));
  });
  await page.addInitScript({ path: 'agoda-userscript.user.js' });
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => window.__NYX_AGODA__?.version === '1.10.1', null, { timeout: 20000 });
  return page.evaluate(async () => {
    const result = await window.__NYX_AGODA__.test.redeemAllCampaigns({ force: true });
    return {
      ok: result.ok,
      added: result.added.map(entry => entry.promotionCode || entry.campaignId),
      verified: result.verified.map(campaign => campaign.code),
      wallet: result.wallet
        .filter(entry => entry.promotionCode)
        .map(entry => ({
          campaignId: entry.campaignId,
          promotionCode: entry.promotionCode,
          discountType: entry.discountType,
          discountValue: entry.discountValue,
          validTill: entry.dateValidTill
        }))
    };
  });
}

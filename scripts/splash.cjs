// Renders the iOS launch images in apps/web/public/splash and prints the
// <link> tags for index.html. iOS shows these while an installed PWA starts;
// without them it shows a blank white screen. Run: node scripts/splash.cjs
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// Portrait iPhone screens: CSS width, height, pixel ratio.
const DEVICES = [
  [440, 956, 3], // 16 Pro Max, 17 Pro Max
  [402, 874, 3], // 16 Pro, 17, 17 Pro
  [430, 932, 3], // 14 Pro Max, 15 Plus, 15 Pro Max, 16 Plus
  [393, 852, 3], // 14 Pro, 15, 15 Pro, 16
  [428, 926, 3], // 12 Pro Max, 13 Pro Max, 14 Plus
  [390, 844, 3], // 12, 13, 14, 16e
  [375, 812, 3], // X, XS, 11 Pro, 12 mini, 13 mini
  [414, 896, 3], // XS Max, 11 Pro Max
  [414, 896, 2], // XR, 11
  [375, 667, 2], // SE (2nd, 3rd), 8
];
const SCHEMES = { light: '#fff5ee', dark: '#16121f' };
const logo = fs.readFileSync(path.join(__dirname, '../apps/web/public/icon.svg'), 'utf8');
const out = path.join(__dirname, '../apps/web/public/splash');

(async () => {
  const browser = await chromium.launch();
  const links = [];
  for (const [w, h, dpr] of DEVICES) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
    for (const [scheme, bg] of Object.entries(SCHEMES)) {
      // Same size and place as the in-page splash in index.html, so the hand-over is seamless.
      await page.setContent(`<body style="margin:0;height:100vh;display:grid;place-items:center;background:${bg}">
        <div style="width:112px;height:112px">${logo.replace('<svg', '<svg width="112" height="112"')}</div></body>`);
      const file = `${scheme}-${w}x${h}@${dpr}.png`;
      await page.screenshot({ path: path.join(out, file) });
      links.push(`    <link rel="apple-touch-startup-image" href="/splash/${file}" media="(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${dpr}) and (orientation: portrait) and (prefers-color-scheme: ${scheme})" />`);
    }
    await page.close();
  }
  await browser.close();
  console.log(links.join('\n'));
})();

import { readFile } from "node:fs/promises";
import { dependencyRequire } from "../server/deps.mjs";
const { chromium } = dependencyRequire("playwright");
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });
  const font = (
    await readFile(
      new URL("../src/assets/dm-sans-latin.woff2", import.meta.url),
    )
  ).toString("base64");
  const logo = (
    await readFile(new URL("../public/favicon.svg", import.meta.url))
  ).toString("base64");
  const wheelSource = await readFile(
    new URL("../src/components/Wheel.tsx", import.meta.url),
    "utf8",
  );
  const wheel = wheelSource
    .match(/<svg[\s\S]*?<\/svg>/)[0]
    .replace('className="wheel-art"', 'class="wheel"');
  await page.setContent(
    `<html><head><style>@font-face{font-family:DM;src:url(data:font/woff2;base64,${font})}*{box-sizing:border-box}body{margin:0;font-family:DM,sans-serif;background:#f7f8f2;color:#28342a}.frame{padding:60px 64px;height:630px;border-bottom:14px solid #254d38}.brand{display:flex;gap:14px;align-items:center;font-size:26px;font-weight:600}.brand small{font-size:18px;font-weight:400;display:block}.body{display:flex;align-items:center;margin-top:48px;gap:20px}h1{font-weight:600;font-size:68px;line-height:1.06;letter-spacing:-3px;margin:0 0 22px;max-width:600px}p{font-size:23px;line-height:1.5;max-width:550px;color:#626b5d;margin:0}.wheel{width:460px;flex:none;background:#eaf0df;border-radius:32px;padding:20px}.tag{display:inline-flex;padding:12px 20px;background:#254d38;color:#fffefa;border-radius:9px;font-size:18px;margin-top:28px}</style></head><body><div class="frame"><div class="brand"><img width="54" height="54" src="data:image/svg+xml;base64,${logo}"/><div>SPM<small>Squeek Prediction Market</small></div></div><div class="body"><div><h1>Small paws.<br>Big predictions.</h1><p>Predict Squeektoshi’s next 24-hour run.<br>Get it right, earn a point.</p><div class="tag">No tokens. No fees. Just points.</div></div>${wheel}</div></div></body></html>`,
  );
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: new URL("../public/share.png", import.meta.url).pathname,
  });
  console.log("Created public/share.png (1200 × 630).");
} finally {
  await browser.close();
}

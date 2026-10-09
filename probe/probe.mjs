// 云端连通性体检：以「游客身份」用无头浏览器逐个访问 6 个 AI 平台并提问。
// 结果写入 probe/out/results.json，截图写入 probe/out/<key>.png。
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const QUESTION = process.env.QUESTION || "幼猫猫粮有哪些推荐？";
const BRAND = process.env.BRAND || "比乐";
const ONLY = (process.env.ONLY || "").split(",").map((s) => s.trim()).filter(Boolean);
const PER_PLATFORM_MS = Math.max(30000, Number(process.env.PER_PLATFORM_MS || 150000));
const OUT_DIR = path.resolve("probe/out");

const PLATFORMS = [
  { key: "qianwen", name: "千问", url: "https://www.qianwen.com/chat" },
  { key: "doubao", name: "豆包", url: "https://www.doubao.com/chat/" },
  { key: "kimi", name: "Kimi", url: "https://kimi.moonshot.cn/" },
  { key: "yuanbao", name: "元宝", url: "https://yuanbao.tencent.com/chat" },
  { key: "deepseek", name: "DeepSeek", url: "https://chat.deepseek.com/" },
  { key: "wenxin", name: "文心", url: "https://yiyan.baidu.com/" },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function snapshot(page) {
  return page.evaluate(() => {
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      return r.width > 60 && r.height > 16 && st.visibility !== "hidden" && st.display !== "none";
    };
    const composers = [...document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]')].filter(visible);
    const body = document.body ? document.body.innerText : "";
    return { composerCount: composers.length, len: body.length, text: body.slice(-12000) };
  });
}

async function probeOne(browser, p) {
  const t0 = Date.now();
  const r = { key: p.key, name: p.name, url: p.url, status: "error", note: "", brandHit: null, answerTail: "", pageUrlAfter: "", title: "", shot: "", ms: 0 };
  const ctx = await browser.newContext({
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    viewport: { width: 1366, height: 900 },
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(10000);
  try {
    await page.goto(p.url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await sleep(5000);
    const s = await snapshot(page);
    const urlNow = page.url();
    if (s.composerCount === 0) {
      if (/安全验证|人机验证|滑动验证|challenge|请稍候|验证中心/i.test(s.text)) r.status = "captcha";
      else if (/扫码登录|密码登录|发送验证码|立即登录|请先登录|注册登录|登录\/注册|sign in|log in/i.test(s.text) || /sign_in|login|passport/i.test(urlNow)) r.status = "login";
      else r.status = "no-composer";
      r.note = s.text.replace(/\s+/g, " ").slice(0, 200);
    } else {
      const composer = page.locator('textarea:visible, [contenteditable="true"]:visible, [role="textbox"]:visible').first();
      await composer.click({ timeout: 8000 }).catch(() => {});
      await page.keyboard.type(QUESTION, { delay: 15 });
      await sleep(800);
      const before = (await snapshot(page)).len;
      await page.keyboard.press("Enter").catch(() => {});
      await sleep(3000);
      if ((await snapshot(page)).len <= before + 20) {
        const btn = page.locator('button:has-text("发送"), [aria-label*="发送"], [aria-label*="send" i], [data-testid*="send" i]').first();
        await btn.click({ timeout: 5000 }).catch(() => {});
        await sleep(2000);
      }
      let last = -1;
      let stable = 0;
      let grew = false;
      const deadline = Math.min(t0 + PER_PLATFORM_MS, Date.now() + Math.round(PER_PLATFORM_MS * 0.8));
      while (Date.now() < deadline) {
        await sleep(2500);
        const cur = await snapshot(page);
        if (cur.len > before + 150) grew = true;
        if (cur.len === last) { stable += 1; if (stable >= 3 && grew) break; }
        else { stable = 0; last = cur.len; }
      }
      const fin = await snapshot(page);
      r.answerTail = fin.text.slice(-1200);
      const strong = fin.text.match(/扫码登录|手机号码登录|发送验证码|短信验证码|密码登录|微信登录|微信扫码|二维码登录|扫描二维码登录/);
      const loginModal = !!strong;
      const iq = fin.text.lastIndexOf(QUESTION);
      const afterQ = iq >= 0 ? fin.text.length - (iq + QUESTION.length) : 0;
      if (grew && fin.len > before + 150 && (!loginModal || afterQ > 900)) {
        r.status = "ok";
        r.brandHit = fin.text.slice(-4000).includes(BRAND);
      } else if (loginModal) {
        r.status = "login";
        r.note = "弹出登录框（" + strong[0] + "）";
      } else {
        r.status = "timeout";
        r.note = "提问后未检测到回答";
      }
    }
  } catch (e) {
    r.status = "error";
    r.note = String((e && e.message) || e).slice(0, 300);
  }
  try { r.pageUrlAfter = page.url(); r.title = await page.title(); } catch {}
  try {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    r.shot = `probe/out/${p.key}.png`;
    await page.screenshot({ path: path.join(OUT_DIR, `${p.key}.png`) });
  } catch {}
  r.ms = Date.now() - t0;
  await ctx.close().catch(() => {});
  return r;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    channel: process.env.PW_CHANNEL || undefined,
    args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"],
  });
  let egress = "";
  try {
    const j = await (await fetch("https://ipinfo.io/json")).json();
    egress = `${j.ip || "?"} · ${j.country || "?"} ${j.city || ""}`;
  } catch {}
  const list = PLATFORMS.filter((p) => !ONLY.length || ONLY.includes(p.key));
  const results = [];
  for (const p of list) {
    process.stdout.write(`▶ ${p.name} … `);
    const r = await probeOne(browser, p);
    console.log(`${r.status}${r.brandHit === true ? " ★提到品牌" : ""} (${Math.round(r.ms / 1000)}s)`);
    results.push(r);
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT_DIR, "results.json"), JSON.stringify({
    ranAt: new Date().toISOString(),
    question: QUESTION,
    brand: BRAND,
    runner: process.env.GITHUB_ACTIONS ? "GitHub Actions（云端）" : "本地",
    egress,
    results,
  }, null, 2));
  console.log("完成 → probe/out/results.json");
}

main().catch((e) => { console.error(e); process.exit(1); });

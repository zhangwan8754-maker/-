// 把 icons/icon.svg 渲染成 PNG 图标（供 PWA / 添加到主屏使用）。
// 用法：先安装 playwright（npm i -D playwright），再运行 node scripts/gen-icons.mjs
// 图标已经生成好放在 icons/ 里，只有你改了 icon.svg 时才需要重新跑。
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const svg = readFileSync(join(__dir, "../icons/icon.svg"), "utf8");
const out = join(__dir, "../icons");
const sizes = [
  ["icon-192.png", 192],
  ["icon-512.png", 512],
  ["apple-touch-icon.png", 180],
];

const browser = await chromium.launch();
for (const [name, size] of sizes) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  const html = `<!doctype html><meta charset=utf8>
    <style>html,body{margin:0;padding:0}svg{width:${size}px;height:${size}px;display:block}</style>${svg}`;
  await page.setContent(html, { waitUntil: "networkidle" });
  await page.screenshot({ path: join(out, name), omitBackground: true });
  await page.close();
  console.log("生成", name, size + "x" + size);
}
await browser.close();
console.log("图标全部生成完毕 ✅");

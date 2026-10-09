# GEO 监测台（云端版）

以「游客身份」在浏览器里向 6 个 AI 平台（千问 / 豆包 / Kimi / 元宝 / DeepSeek / 文心）提问，
检测回答里是否出现指定品牌，截图留证，并把结果汇总成网页报告。

当前阶段：**云端连通性体检**（第一步）。正式版将包含：品牌与问题自定义、一键开始检测、
整条回答截图（品牌蓝框标注）、会话链接、报告下载、公开总开关。

## 怎么跑

1. 打开仓库的 Actions 页 → 选择「云端连通性体检」→ Run workflow（可改提问和品牌）
2. 跑完后本仓库的 GitHub Pages 页面会自动更新结果

## 目录

- `probe/probe.mjs` — 体检脚本（Playwright 无头 Chromium）
- `.github/workflows/probe.yml` — 云端运行配置
- `index.html` — 报告页

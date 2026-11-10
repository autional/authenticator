# Autional 身份验证器

> 🚨 **2026-11-10 托管变更**：`*.autional.cn` **已迁出 Vercel** —— 改为 mf01 构建（node:24-alpine + 钉版 pnpm）→ 香港自建托管。
> `.cn` 的构建 env 由 workspace `shared/infra-ops/sites/sites.manifest.json` 注入；push 后由 mf01 cron（约 10 分钟）构建发布，不经 Vercel。
> `*.autional.com` 仍在 Vercel —— 本文中涉及 Vercel 的构建/部署描述对 `.com` 仍然成立。
> 现行口径：workspace `docs/AUTIONAL-CN-SITES-SELF-HOST.md`。

**域名**：[authenticator.autional.cn](https://authenticator.autional.cn)（cn）· [authenticator.autional.com](https://authenticator.autional.com)（com）
**技术栈**：Vite + React 19 + TypeScript + Tailwind CSS
**仓库**：[github.com/autional/authenticator](https://github.com/autional/authenticator)

基于 TOTP 与通行密钥的两步验证。

## 开发

```bash
pnpm install
pnpm dev      # http://localhost:13108（构建前自动生成 env.js/robots.txt）
pnpm build    # 构建产物：apps/authenticator-app/dist/
pnpm test     # Vitest 单元测试
```

## 部署（单源双区）

`main` → `authenticator`（com）自动部署（Vercel）；`main` → `cn-authenticator`（cn）由 mf01 cron 构建发布（约 10 分钟，不经 Vercel）。两区**同一份源码**，
区域差异全部由**构建期环境变量**注入（`.com` 来自 Vercel 项目 env；`.cn` 来自 `shared/infra-ops/sites/sites.manifest.json`）（见 `docs/positioning/24`）：

| 变量 | com | cn |
| --- | --- | --- |
| `REGION` | `com` | `cn` |
| `SITE_URL` | `https://authenticator.autional.com` | `https://authenticator.autional.cn` |
| `DEFAULT_LANG` / `FALLBACK_LANG` | `en` | `zh` |
| `API_ORIGIN` | `https://api.autional.com` | `https://api.autional.cn` |
| `CDN_HOST` | `https://cdn.autional.com` | `https://cdn.autional.cn` |

- 路由/重写：`vercel.ts`（fail-closed：`API_ORIGIN` 缺失即构建失败）。
- 生成物（勿手改、勿入库）：`apps/authenticator-app/public/{env.js,robots.txt}` ← `scripts/gen-env.mjs`；区域文案在 `scripts/region-copy.mjs`。
- 本地无 env 时兜底 cn 值（与迁移前基线一致）。

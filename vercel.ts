import { routes, type Rewrite, type VercelConfig } from '@vercel/config/v1';

/**
 * 身份验证器（authenticator.autional.com / authenticator.autional.cn）的**唯一源站**（B3 单源双区）。
 *
 * 上游 API origin 值 **不写入本仓**，取自 Vercel 项目环境变量 `API_ORIGIN`
 * （cn 项目 = https://api.autional.cn，com 项目 = https://api.autional.com）。
 * 未设置时 **故意抛错**（fail-closed），避免静默产出坏路由。
 *
 * rewrites 承接原 vercel.json 全集（/bff、/api/v1、/oauth/callback 直通、/oauth）；
 * SPA 兜底只在 Accept 含 text/html 时生效——缺失的 /assets/*.js 返回 404，
 * 不会被兜底成 200 的 index.html。
 */
const rawOrigin = process.env.API_ORIGIN;

if (!rawOrigin) {
  throw new Error(
    '[authenticator] 缺少环境变量 API_ORIGIN（Vercel 项目设置里配置后重新部署）',
  );
}

const ORIGIN = rawOrigin.replace(/\/+$/, '');

const NO_CACHE = 'public, max-age=0, must-revalidate';
const IMMUTABLE = 'public, max-age=31536000, immutable';

/**
 * 基础安全响应头（与 auth / secret 等门户同款最小集）。
 *
 * 与 auth 的唯一差异：`camera=(self)`。本应用要扫码绑定（QrScanner），
 * 照抄 auth 的 `camera=()` 会直接让摄像头被权限策略禁用。
 *
 * 暂不加 CSP：vite 的 inlineEnvPlugin 会把 env.js 内联成内联 <script>，
 * 严格 script-src 'self' 会打挂首屏；要加 CSP 需先改 nonce/hash 或外链，单独排期。
 */
const SECURITY_HEADERS = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'geolocation=(), microphone=(), camera=(self)' },
];

const spaFallback: Rewrite = {
  source: '/(.*)',
  destination: '/index.html',
  has: [{ type: 'header', key: 'accept', value: { re: 'text/html' } }],
};

export const config: VercelConfig = {
  framework: 'vite',
  installCommand: 'pnpm install --frozen-lockfile',
  buildCommand: 'pnpm --filter @autional/authenticator-app... build',
  outputDirectory: 'apps/authenticator-app/dist',
  headers: [
    routes.header('/(.*)', SECURITY_HEADERS),
    routes.header('/assets/(.*)', [{ key: 'Cache-Control', value: IMMUTABLE }]),
    routes.header('/workbox-(.*).js', [{ key: 'Cache-Control', value: IMMUTABLE }]),
    routes.header('/', [{ key: 'Cache-Control', value: NO_CACHE }]),
    routes.header('/index.html', [{ key: 'Cache-Control', value: NO_CACHE }]),
    routes.header('/sw.js', [{ key: 'Cache-Control', value: NO_CACHE }]),
    routes.header('/registerSW.js', [{ key: 'Cache-Control', value: NO_CACHE }]),
    routes.header('/manifest.webmanifest', [{ key: 'Cache-Control', value: NO_CACHE }]),
    routes.header('/env.js', [{ key: 'Cache-Control', value: NO_CACHE }]),
  ],
  rewrites: [
    routes.rewrite('/bff/:path*', `${ORIGIN}/bff/:path*`),
    routes.rewrite('/api/v1/:path*', `${ORIGIN}/api/v1/:path*`),
    routes.rewrite('/oauth/callback', '/index.html'),
    routes.rewrite('/oauth/:path*', `${ORIGIN}/oauth/:path*`),
    spaFallback,
  ],
};

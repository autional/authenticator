// ESLint 配置只有一个来源：@autional/eslint-config（规则与理由都写在那个包里）。
// 站点侧只留这三行，与 @autional/tsconfig、其余七个门户（status / admin / auth / brand /
// platform / security / trust / user）同一形状，避免各仓各抄一份规则。
//
// 与 `eslint.a11y.config.mjs` 的关系：a11y 闸门用 `-c` 显式覆盖本文件，独立回答
// 「这次有没有新增无障碍回归」，两者互不干扰（`pnpm lint:a11y` 不受本文件影响）。
import config from '@autional/eslint-config';

export default config;

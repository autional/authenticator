/**
 * 区域静态文案单点（index.html 元信息 / robots 注释）。
 * zh = cn 基线原文（逐字节不变）；en = com 面文案（B3 起 com 默认 en）。
 * robotsComment 为行数组（cn 基线两行注释，勿并成一行）。
 */
export const REGION_COPY = {
  zh: {
    locale: 'zh-CN',
    title: 'Autional 身份验证器',
    description: 'Autional 身份验证器 —— 基于 TOTP 与通行密钥的两步验证。',
    robotsComment: [
      '身份验证器（TOTP/通行密钥）：不收录。',
      '不用 Disallow：保持可抓取，搜索引擎才能读到 index.html 里的 robots noindex。',
    ],
  },
  en: {
    locale: 'en-US',
    title: 'Autional Authenticator',
    description: 'Autional Authenticator — two-step verification with TOTP and passkeys.',
    robotsComment: [
      'authenticator (TOTP / passkeys): not indexed.',
      'No Disallow: stay crawlable so search engines can read the robots noindex meta in index.html.',
    ],
  },
};

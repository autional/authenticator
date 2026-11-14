import type { Config } from 'tailwindcss';
import preset from '@autional/tailwind-preset';

const config: Config = {
  darkMode: 'class',
  presets: [preset],
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx,mdx}',
    './node_modules/@autional/ui/src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      /**
       * ── 移动端字号档位（本应用专属覆盖）────────────────────────────────
       * 为什么覆盖：这是一个 max-w-md + 底部导航的手机优先 PWA，但此前它原样继承了
       * 设计系统（@autional/tailwind-preset）的**桌面文档密度**：xs=12 / sm=14 / base=16。
       * 实测（iPhone 13，390pt）全仓 87% 的字号声明落在 ≤14px，比 iOS 原生正文（17pt）
       * 小约 18%，中文在 12px 下笔画更糊 —— 用户的感受是「界面很干净但字和图标都很小」。
       *
       * 做法是把**整条档位**上移一格（xs 12→14、sm 14→16 …），而不是逐处改类名：
       * `text-sm` 依然叫 `text-sm`，含义变成「本应用的正文档 = 16px」。于是 300+ 处
       * 调用点、以及 @autional/ui 的组件（Input 的 sm|md 档、Button 的 md 档都消费
       * text-sm）一次性到位。
       *
       * ⛔ 红线：`sm` 不得低于 16px。本仓所有 input/textarea 走 text-sm，一旦掉回 14px，
       * iOS Safari 会在聚焦时自动放大整页且不还原。目前 index.html 用
       * `maximum-scale=1.0, user-scalable=no` 把缩放整个锁死了 —— 那是拿无障碍换来的，
       * 16px 这条底线在，才有机会撤掉那把锁（见 tech-debt）。
       *
       * 注意：`spacing` 不动（4px 基）——它承载布局节奏，动它会全局错位。
       * 图标尺寸（h-4/h-5）不属于字号体系，逐处按密度上调。
       * 若要把这套推广到全舰队，正确做法是回 @autional/tokens 增一档 mobile type scale
       * 并重新生成 preset，而不是各站各改。
       */
      fontSize: {
        xs: ['14px', { lineHeight: '20px' }],
        sm: ['16px', { lineHeight: '24px' }],
        base: ['17px', { lineHeight: '26px' }],
        lg: ['20px', { lineHeight: '28px', fontWeight: '500' }],
        xl: ['22px', { lineHeight: '30px', fontWeight: '600' }],
        '2xl': ['26px', { lineHeight: '34px', fontWeight: '700' }],
        '3xl': ['34px', { lineHeight: '40px', fontWeight: '700' }],
        '4xl': ['38px', { lineHeight: '44px' }],
      },
      colors: {
        auth: {
          bg: 'var(--color-bg-primary)',
          surface: 'var(--color-bg-surface)',
          elevated: 'var(--color-bg-elevated)',
          border: 'var(--color-border)',
        },
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
  },
  plugins: [],
};

export default config;

/**
 * 本 App 登录时申请的 scope —— 单一真源（登录入口 use-sign-in / sign-in 共用）。
 *
 * 基础项（openid profile email offline_access read）之外必须再加 `write`：
 * 推送登记 `POST /notification/api/v1/push/subscriptions` 与 SSE 票据
 * `POST /notification/api/v1/notifications/stream-ticket` 都是写方法，
 * notification 服务对写方法强制 `RequireScopes("write")`；本 App 带 client_id
 * 的令牌拿不到首方通配 `*`，不申请就 403（required_missing:"write"）。
 *
 * 只加 `write`：登录审批（identity approve/deny）在 protected 组，只要求 `read`，
 * 不需要 `mfa:write`（2026-11-14 实测：带 write 的令牌 stream-ticket 200）。
 */
import { withOAuthScopes } from '@autional/shared';

export const APP_LOGIN_SCOPES = withOAuthScopes('write');

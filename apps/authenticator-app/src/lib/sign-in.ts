/**
 * 统一登录入口：优先 OAuth PKCE（跨域可取回 token）；未配置 client_id 才回落同源 redirect。
 * 同源 redirect 在跨域站点上无法传递凭据，仅作兜底。
 *
 * scope 见 `login-scope.ts#APP_LOGIN_SCOPES`：本 App 必须申请 `write`，
 * 否则推送登记 / SSE 票据这些写方法接口会 403。
 */
import { buildLoginUrl, initiateOAuthLogin, isOAuthEnabled } from '@autional/shared';
import { APP_LOGIN_SCOPES } from './login-scope';

export function signIn(returnUrl?: string): void {
	const target = returnUrl || (typeof window !== 'undefined' ? window.location.href : '/');
	if (isOAuthEnabled()) {
		void initiateOAuthLogin(undefined, target, { scope: APP_LOGIN_SCOPES });
		return;
	}
	window.location.href = buildLoginUrl(target);
}

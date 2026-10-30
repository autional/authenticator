/**
 * 统一登录入口：优先 OAuth PKCE（跨域可取回 token）；未配置 client_id 才回落同源 redirect。
 * 同源 redirect 在跨域站点上无法传递凭据，仅作兜底。
 */
import { buildLoginUrl, initiateOAuthLogin, isOAuthEnabled } from '@autional/shared';

export function signIn(returnUrl?: string): void {
	const target = returnUrl || (typeof window !== 'undefined' ? window.location.href : '/');
	if (isOAuthEnabled()) {
		void initiateOAuthLogin(undefined, target);
		return;
	}
	window.location.href = buildLoginUrl(target);
}

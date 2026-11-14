import { useCallback } from 'react';
import { initiateOAuthLogin, useAuth } from '@autional/shared';
import { useMfaSsoAutoSignIn } from '@/lib/use-mfa-sso';
import { APP_LOGIN_SCOPES } from '@/lib/login-scope';

/**
 * 「用本机验证器登录」回跳后的**全局**静默续跑（渲染 null，不占布局）。
 *
 * 为什么必须挂在 Routes 之外：回跳目标就是用户点登录时所在的那一页，而设置页 /
 * 首页空态 / 保险库首页都**不在** `ServerOnly` 里 —— 之前 hook 只在 ServerOnly 里跑，
 * 于是这些页面回跳后根本没人用 auth 会话换 App 令牌，用户看到登录按钮还在（看似没登进去）。
 *
 * 为什么必须用 OAuth（`initiateOAuthLogin`）而不是页面里的 `signIn`：`signIn` 会先用本机
 * TOTP 再换一张票据重新跳 auth 登录页 —— 此时票据早已消费、auth 域已有会话，会形成
 * 「换票 → 跳登录 → 回跳 → 再换票」的循环。这里只借 auth 域的会话走 OAuth 授权码流程。
 *
 * 回跳地址 = 当前地址（标记已在上游 hook 里摘掉），所以登录完成后用户回到同一页。
 * scope 与页面内登录同源（`APP_LOGIN_SCOPES`）：漏了 `write` 会让登录「成功但接口 403」。
 */
export default function MfaSsoAutoSignIn() {
	const { isAuthenticated } = useAuth();
	// 稳定引用：hook 的 effect 依赖 signIn，内联箭头会让 effect 每次渲染都重跑。
	// 返回 Promise（不 void 掉）：hook 需要感知发起失败并留痕，否则「自动续跑没跑起来」
	// 在控制台里毫无痕迹，只能靠用户描述现象猜。
	const continueWithOAuth = useCallback(
		() => initiateOAuthLogin(undefined, window.location.href, { scope: APP_LOGIN_SCOPES }),
		[],
	);
	useMfaSsoAutoSignIn(continueWithOAuth, isAuthenticated);
	return null;
}

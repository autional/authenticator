import { useEffect, useRef } from 'react';
import { openNotificationStream, type StreamNotification } from './notifications-stream';

/**
 * 登录态下订阅「本人」通知流（SSE）。
 * - enabled=false（未登录/已登出）即不建连，登出时自动关闭。
 * - 回调放 ref，避免每次渲染重连。
 */
export function useNotificationStream(
	enabled: boolean,
	onNotification: (n: StreamNotification) => void,
): void {
	const cb = useRef(onNotification);
	cb.current = onNotification;

	useEffect(() => {
		if (!enabled) return;
		const handle = openNotificationStream({ onNotification: (n) => cb.current(n) });
		return () => handle.close();
	}, [enabled]);
}

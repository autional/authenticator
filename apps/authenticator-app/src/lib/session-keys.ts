/**
 * 会话级密钥清理：登出 / 页面卸载 / 手动锁定。
 *
 * 只清内存，不删 localStorage 中的密文；下次解锁重新派生/导入。
 */

import { clearDeviceKeyCache } from './storage';
import { clearBackupSession } from './backup-key';

export function clearSessionKeys(): void {
	clearDeviceKeyCache();
	clearBackupSession();
}

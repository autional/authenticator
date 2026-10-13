import type { TFunction } from 'i18next';

// i18n-exempt-file: 本文件的中文字面量 = 分组存储契约值（跨设备/跨语言恒定，写入数据后不随显示语言变化）。
// 显示层一律经 groupLabel() + group.* 键翻译（消费点：account/page.tsx、app/page.tsx）。
export const PRESET_GROUPS = ['工作', '个人', '金融', '社交', '开发', '其他'];

const PRESET_GROUP_KEYS: Record<string, string> = {
	工作: 'group.work',
	个人: 'group.personal',
	金融: 'group.finance',
	社交: 'group.social',
	开发: 'group.dev',
	其他: 'group.other',
};

// 显示层翻译：预设分组值恒为中文原值（存储不随语言变化），自定义分组原样透传
export function groupLabel(t: TFunction, group: string): string {
	const key = PRESET_GROUP_KEYS[group];
	return key ? t(key) : group;
}

const KNOWN_GROUPS_KEY = 'authenticator-known-groups';

export function loadKnownGroups(): string[] {
	try {
		const raw = localStorage.getItem(KNOWN_GROUPS_KEY);
		if (!raw) return [];
		const parsed: unknown = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.filter((g): g is string => typeof g === 'string') : [];
	} catch {
		return [];
	}
}

export function rememberGroups(groups: string[]): void {
	try {
		localStorage.setItem(KNOWN_GROUPS_KEY, JSON.stringify(groups));
	} catch {
		// localStorage 不可用时静默降级（仅影响空组 chip 保留）
	}
}

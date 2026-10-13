import { describe, it, expect, beforeEach } from 'vitest';
import type { TFunction } from 'i18next';
import i18n from '@/i18n';
import { PRESET_GROUPS, groupLabel } from '@/lib/groups';

// 分组存储契约：预设分组值恒为中文原值（跨设备/跨语言）；显示层经 group.* 键翻译。
describe('分组存储契约与显示翻译', () => {
	const t = i18n.t as unknown as TFunction;

	beforeEach(async () => {
		await i18n.changeLanguage('zh-CN');
	});

	it('预设分组存储值恒为中文原值', () => {
		expect(PRESET_GROUPS).toEqual(['工作', '个人', '金融', '社交', '开发', '其他']);
	});

	it('en-US 显示层翻译预设分组', async () => {
		await i18n.changeLanguage('en-US');
		expect(groupLabel(t, '工作')).toBe('Work');
		expect(groupLabel(t, '个人')).toBe('Personal');
		expect(groupLabel(t, '金融')).toBe('Finance');
		expect(groupLabel(t, '社交')).toBe('Social');
		expect(groupLabel(t, '开发')).toBe('Development');
		expect(groupLabel(t, '其他')).toBe('Other');
	});

	it('zh-CN 显示层回显原值', () => {
		expect(groupLabel(t, '工作')).toBe('工作');
	});

	it('自定义分组原样透传（不翻译）', async () => {
		await i18n.changeLanguage('en-US');
		expect(groupLabel(t, '自建分组')).toBe('自建分组');
	});
});

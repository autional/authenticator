import { describe, it, expect, beforeEach } from 'vitest';
import { render, within } from '@testing-library/react';
import i18n from '@/i18n';
import BrandIcon from '@/components/BrandIcon';

// 品牌 tooltip 本地化契约：中文服务品牌名经 nameKey → brand.* 键按语言解析；
// 字形（initial）为品牌徽标不翻译；未收录服务回退原名。
describe('BrandIcon 品牌名本地化', () => {
	beforeEach(async () => {
		await i18n.changeLanguage('zh-CN');
	});

	it('zh-CN 下命中的中文服务品牌显示中文名', () => {
		const { container } = render(<BrandIcon name="Alipay" />);
		expect(within(container).getByTitle('支付宝')).toBeInTheDocument();
	});

	it('en-US 下同一品牌切换为英文名（nameKey 解析）', async () => {
		await i18n.changeLanguage('en-US');
		const { container } = render(<BrandIcon name="Alipay" />);
		expect(within(container).getByTitle('Alipay')).toBeInTheDocument();
	});

	it('同实例随语言切换逐语言正确（WeChat Pay / 微信支付）', async () => {
		const { container } = render(<BrandIcon name="WeChat Pay" />);
		expect(within(container).getByTitle('微信支付')).toBeInTheDocument();
		await i18n.changeLanguage('en-US');
		expect(within(container).getByTitle('WeChat Pay')).toBeInTheDocument();
	});

	it('无 nameKey 的品牌（Latin 原名）不受语言切换影响', async () => {
		await i18n.changeLanguage('en-US');
		const { container } = render(<BrandIcon name="GitHub" />);
		expect(within(container).getByTitle('GitHub')).toBeInTheDocument();
	});

	it('未收录服务回退为账户原名', async () => {
		await i18n.changeLanguage('en-US');
		const { container } = render(<BrandIcon name="Acme Internal" />);
		expect(within(container).getByTitle('Acme Internal')).toBeInTheDocument();
	});

	it('品牌徽标字形不随语言变化（Alipay 恒为「支」）', async () => {
		const { container } = render(<BrandIcon name="Alipay" />);
		expect(within(container).getByTitle('支付宝').textContent).toBe('支');
		await i18n.changeLanguage('en-US');
		expect(within(container).getByTitle('Alipay').textContent).toBe('支');
	});
});

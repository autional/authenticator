/**
 * Autional Authenticator — Service Brand Icon Mapping
 *
 * Maps common service names/issuers to brand colors and initials
 * for visual identification without external image assets.
 */

export interface BrandInfo {
	name: string;
	nameKey?: string; // 显示名 i18n 键（brand.*）；缺省时直接用 name，name 兼作 t() 回退值
	initial: string;
	color: string;
	bgColor: string;
}

const BRAND_MAP: Record<string, BrandInfo> = {
	// Dev / Cloud
	github: { name: 'GitHub', initial: 'G', color: '#ffffff', bgColor: '#24292f' },
	gitlab: { name: 'GitLab', initial: 'G', color: '#ffffff', bgColor: '#fc6d26' },
	bitbucket: { name: 'Bitbucket', initial: 'B', color: '#ffffff', bgColor: '#0052cc' },
	aws: { name: 'AWS', initial: 'A', color: '#ffffff', bgColor: '#ff9900' },
	amazon: { name: 'Amazon', initial: 'A', color: '#ffffff', bgColor: '#ff9900' },
	azure: { name: 'Azure', initial: 'A', color: '#ffffff', bgColor: '#0078d4' },
	gcp: { name: 'GCP', initial: 'G', color: '#ffffff', bgColor: '#4285f4' },
	googlecloud: { name: 'GCP', initial: 'G', color: '#ffffff', bgColor: '#4285f4' },
	cloudflare: { name: 'Cloudflare', initial: 'C', color: '#ffffff', bgColor: '#f48120' },
	vercel: { name: 'Vercel', initial: 'V', color: '#ffffff', bgColor: '#000000' },
	heroku: { name: 'Heroku', initial: 'H', color: '#ffffff', bgColor: '#430098' },
	digitalocean: { name: 'DigitalOcean', initial: 'D', color: '#ffffff', bgColor: '#0061ff' },
	docker: { name: 'Docker', initial: 'D', color: '#ffffff', bgColor: '#2496ed' },
	kubernetes: { name: 'K8s', initial: 'K', color: '#ffffff', bgColor: '#326ce5' },

	// Google services
	google: { name: 'Google', initial: 'G', color: '#ffffff', bgColor: '#4285f4' },
	gmail: { name: 'Gmail', initial: 'M', color: '#ffffff', bgColor: '#ea4335' },
	googleworkspace: { name: 'Workspace', initial: 'W', color: '#ffffff', bgColor: '#4285f4' },
	youtube: { name: 'YouTube', initial: 'Y', color: '#ffffff', bgColor: '#ff0000' },
	drive: { name: 'Drive', initial: 'D', color: '#ffffff', bgColor: '#4285f4' },

	// Microsoft
	microsoft: { name: 'Microsoft', initial: 'M', color: '#ffffff', bgColor: '#00a4ef' },
	outlook: { name: 'Outlook', initial: 'O', color: '#ffffff', bgColor: '#0078d4' },
	office365: { name: 'Office 365', initial: 'O', color: '#ffffff', bgColor: '#d83b01' },
	teams: { name: 'Teams', initial: 'T', color: '#ffffff', bgColor: '#6264a7' },
	onedrive: { name: 'OneDrive', initial: 'O', color: '#ffffff', bgColor: '#0078d4' },
	xbox: { name: 'Xbox', initial: 'X', color: '#ffffff', bgColor: '#107c10' },

	// Social
	twitter: { name: 'Twitter', initial: 'X', color: '#ffffff', bgColor: '#000000' },
	x: { name: 'X', initial: 'X', color: '#ffffff', bgColor: '#000000' },
	facebook: { name: 'Facebook', initial: 'F', color: '#ffffff', bgColor: '#1877f2' },
	instagram: { name: 'Instagram', initial: 'I', color: '#ffffff', bgColor: '#e4405f' },
	linkedin: { name: 'LinkedIn', initial: 'L', color: '#ffffff', bgColor: '#0a66c2' },
	discord: { name: 'Discord', initial: 'D', color: '#ffffff', bgColor: '#5865f2' },
	slack: { name: 'Slack', initial: 'S', color: '#ffffff', bgColor: '#4a154b' },
	telegram: { name: 'Telegram', initial: 'T', color: '#ffffff', bgColor: '#26a5e4' },
	whatsapp: { name: 'WhatsApp', initial: 'W', color: '#ffffff', bgColor: '#25d366' },
	reddit: { name: 'Reddit', initial: 'R', color: '#ffffff', bgColor: '#ff4500' },
	tiktok: { name: 'TikTok', initial: 'T', color: '#ffffff', bgColor: '#000000' },
	snapchat: { name: 'Snapchat', initial: 'S', color: '#000000', bgColor: '#fffc00' },

	// Finance
	paypal: { name: 'PayPal', initial: 'P', color: '#ffffff', bgColor: '#003087' },
	stripe: { name: 'Stripe', initial: 'S', color: '#ffffff', bgColor: '#635bff' },
	alipay: { name: '支付宝', nameKey: 'brand.alipay', initial: '支', color: '#ffffff', bgColor: '#1677ff' }, // i18n-exempt: 品牌徽标字形与中文回退名（显示名经 brand.* 键翻译）
	wechatpay: { name: '微信支付', nameKey: 'brand.wechatpay', initial: '微', color: '#ffffff', bgColor: '#07c160' }, // i18n-exempt: 品牌徽标字形与中文回退名（显示名经 brand.* 键翻译）
	binance: { name: 'Binance', initial: 'B', color: '#ffffff', bgColor: '#f0b90b' },
	coinbase: { name: 'Coinbase', initial: 'C', color: '#ffffff', bgColor: '#0052ff' },

	// Chinese services
	wechat: { name: '微信', nameKey: 'brand.wechat', initial: '微', color: '#ffffff', bgColor: '#07c160' }, // i18n-exempt: 品牌徽标字形与中文回退名（显示名经 brand.* 键翻译）
	qq: { name: 'QQ', initial: 'Q', color: '#ffffff', bgColor: '#12b7f5' },
	weibo: { name: '微博', nameKey: 'brand.weibo', initial: '微', color: '#ffffff', bgColor: '#e6162d' }, // i18n-exempt: 品牌徽标字形与中文回退名（显示名经 brand.* 键翻译）
	baidu: { name: '百度', nameKey: 'brand.baidu', initial: '百', color: '#ffffff', bgColor: '#2932e1' }, // i18n-exempt: 品牌徽标字形与中文回退名（显示名经 brand.* 键翻译）
	taobao: { name: '淘宝', nameKey: 'brand.taobao', initial: '淘', color: '#ffffff', bgColor: '#ff5000' }, // i18n-exempt: 品牌徽标字形与中文回退名（显示名经 brand.* 键翻译）
	tmall: { name: '天猫', nameKey: 'brand.tmall', initial: '猫', color: '#ffffff', bgColor: '#ff0036' }, // i18n-exempt: 品牌徽标字形与中文回退名（显示名经 brand.* 键翻译）
	jd: { name: '京东', nameKey: 'brand.jd', initial: '京', color: '#ffffff', bgColor: '#e4393c' }, // i18n-exempt: 品牌徽标字形与中文回退名（显示名经 brand.* 键翻译）
	dingtalk: { name: '钉钉', nameKey: 'brand.dingtalk', initial: '钉', color: '#ffffff', bgColor: '#3370ff' }, // i18n-exempt: 品牌徽标字形与中文回退名（显示名经 brand.* 键翻译）
	feishu: { name: '飞书', nameKey: 'brand.feishu', initial: '飞', color: '#ffffff', bgColor: '#3370ff' }, // i18n-exempt: 品牌徽标字形与中文回退名（显示名经 brand.* 键翻译）
	lark: { name: 'Lark', initial: 'L', color: '#ffffff', bgColor: '#00d6b9' },

	// Security / Auth
	autional: { name: 'Autional', initial: 'A', color: '#ffffff', bgColor: '#6366f1' },
	auth0: { name: 'Auth0', initial: 'A', color: '#ffffff', bgColor: '#eb5424' },
	okta: { name: 'Okta', initial: 'O', color: '#ffffff', bgColor: '#007dc1' },
	onelogin: { name: 'OneLogin', initial: 'O', color: '#ffffff', bgColor: '#1b75bb' },
	duo: { name: 'Duo', initial: 'D', color: '#ffffff', bgColor: '#4e9bf7' },
	lastpass: { name: 'LastPass', initial: 'L', color: '#ffffff', bgColor: '#d32d27' },
	'1password': { name: '1Password', initial: '1', color: '#ffffff', bgColor: '#1a1a1a' },
	bitwarden: { name: 'Bitwarden', initial: 'B', color: '#ffffff', bgColor: '#175ddc' },
	keycloak: { name: 'Keycloak', initial: 'K', color: '#ffffff', bgColor: '#4d4d4d' },

	// Others
	apple: { name: 'Apple', initial: 'A', color: '#ffffff', bgColor: '#000000' },
	icloud: { name: 'iCloud', initial: 'i', color: '#ffffff', bgColor: '#007aff' },
	dropbox: { name: 'Dropbox', initial: 'D', color: '#ffffff', bgColor: '#0061ff' },
	notion: { name: 'Notion', initial: 'N', color: '#ffffff', bgColor: '#000000' },
	figma: { name: 'Figma', initial: 'F', color: '#ffffff', bgColor: '#f24e1e' },
	shopify: { name: 'Shopify', initial: 'S', color: '#ffffff', bgColor: '#95bf47' },
	wordpress: { name: 'WordPress', initial: 'W', color: '#ffffff', bgColor: '#21759b' },
	npm: { name: 'npm', initial: 'N', color: '#ffffff', bgColor: '#cb3837' },
	rubygems: { name: 'RubyGems', initial: 'R', color: '#ffffff', bgColor: '#e9573f' },
	pypi: { name: 'PyPI', initial: 'P', color: '#ffffff', bgColor: '#3775a9' },
};

const FALLBACK_COLORS = [
	{ color: '#ffffff', bgColor: '#ef4444' },
	{ color: '#ffffff', bgColor: '#f97316' },
	{ color: '#ffffff', bgColor: '#eab308' },
	{ color: '#ffffff', bgColor: '#22c55e' },
	{ color: '#ffffff', bgColor: '#06b6d4' },
	{ color: '#ffffff', bgColor: 'var(--color-primary-700)' },
	{ color: '#ffffff', bgColor: '#8b5cf6' },
	{ color: '#ffffff', bgColor: '#d946ef' },
	{ color: '#ffffff', bgColor: '#f43f5e' },
	{ color: '#ffffff', bgColor: '#14b8a6' },
];

function normalizeKey(input: string): string {
	return input
		.toLowerCase()
		.replace(/[^a-z0-9\u4e00-\u9fa5]/g, '')
		.trim();
}

export function getBrandInfo(name: string, username?: string): BrandInfo {
	const key = normalizeKey(name);

	// Direct match
	if (BRAND_MAP[key]) {
		return BRAND_MAP[key];
	}

	// Try username as fallback (e.g. "user@gmail.com" → google)
	if (username) {
		const domain = username.split('@')[1];
		if (domain) {
			const domainKey = normalizeKey(domain.split('.')[0]);
			if (BRAND_MAP[domainKey]) {
				return BRAND_MAP[domainKey];
			}
		}
	}

	// Partial match (starts with)
	for (const [k, v] of Object.entries(BRAND_MAP)) {
		if (key.startsWith(k) || k.startsWith(key)) {
			return v;
		}
	}

	// Substring match
	for (const [k, v] of Object.entries(BRAND_MAP)) {
		if (key.includes(k) || k.includes(key)) {
			return v;
		}
	}

	// Fallback: generate deterministic color from name
	let hash = 0;
	for (let i = 0; i < name.length; i++) {
		hash = name.charCodeAt(i) + ((hash << 5) - hash);
	}
	const colorSet = FALLBACK_COLORS[Math.abs(hash) % FALLBACK_COLORS.length];
	const firstChar = name.trim().charAt(0).toUpperCase() || '?';

	return {
		name: name.trim(),
		initial: firstChar,
		color: colorSet.color,
		bgColor: colorSet.bgColor,
	};
}

/**
 * Get icon style object for inline CSS
 */
export function getIconStyle(brand: BrandInfo): React.CSSProperties {
	return {
		backgroundColor: brand.bgColor,
		color: brand.color,
	};
}

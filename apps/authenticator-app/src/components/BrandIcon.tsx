import { useTranslation } from 'react-i18next';
import { getBrandInfo } from '@/lib/icons';

interface BrandIconProps {
	name: string;
	username?: string;
	size?: number;
	className?: string;
}

export default function BrandIcon({ name, username, size = 32, className = '' }: BrandIconProps) {
	const { t } = useTranslation();
	const brand = getBrandInfo(name, username);
	const title = brand.nameKey ? t(brand.nameKey, { defaultValue: brand.name }) : brand.name;

	return (
		<div
			className={`flex shrink-0 items-center justify-center rounded-lg font-bold ${className}`}
			style={{
				width: size,
				height: size,
				backgroundColor: brand.bgColor,
				color: brand.color,
				fontSize: size * 0.45,
				lineHeight: 1,
			}}
			title={title}
		>
			{brand.initial}
		</div>
	);
}

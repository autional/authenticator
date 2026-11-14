import { useEffect, useState } from 'react';

interface CountdownRingProps {
	progress: number; // 0.0 ~ 1.0
	size?: number;
	strokeWidth?: number;
}

export default function CountdownRing({
	progress,
	size = 40,
	strokeWidth = 3,
}: CountdownRingProps) {
	const [displayProgress, setDisplayProgress] = useState(progress);

	useEffect(() => {
		setDisplayProgress(progress);
	}, [progress]);

	const radius = (size - strokeWidth) / 2;
	const circumference = 2 * Math.PI * radius;
	const offset = circumference * (1 - displayProgress);
	const isUrgent = displayProgress < 0.15;

	return (
		<div
			className="relative inline-flex items-center justify-center"
			style={{ width: size, height: size }}
		>
			<svg width={size} height={size} className="-rotate-90 transform">
				{/* Background ring */}
				<circle
					cx={size / 2}
					cy={size / 2}
					r={radius}
					fill="none"
					stroke="#2a2a2a"
					strokeWidth={strokeWidth}
				/>
				{/* Progress ring */}
				<circle
					cx={size / 2}
					cy={size / 2}
					r={radius}
					fill="none"
					stroke={isUrgent ? 'var(--color-danger)' : 'var(--color-brand)'}
					strokeWidth={strokeWidth}
					strokeLinecap="round"
					strokeDasharray={circumference}
					strokeDashoffset={offset}
					style={{
						transition: 'stroke-dashoffset 1s linear, stroke 0.3s ease',
					}}
				/>
			</svg>
			<span
				className={`absolute text-[11px] font-mono font-bold ${
					isUrgent ? 'text-[var(--color-danger-text)]' : 'text-[var(--color-text-secondary)]'
				}`}
			>
				{Math.ceil(displayProgress * 30)}
			</span>
		</div>
	);
}

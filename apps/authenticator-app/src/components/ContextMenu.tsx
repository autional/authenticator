import { useEffect, useRef, useState } from 'react';

interface MenuItem {
	label: string;
	icon?: React.ReactNode;
	danger?: boolean;
	onClick: () => void;
}

interface ContextMenuProps {
	items: MenuItem[];
	children: React.ReactNode;
	disabled?: boolean;
}

export default function ContextMenu({ items, children, disabled }: ContextMenuProps) {
	const [open, setOpen] = useState(false);
	const [pos, setPos] = useState({ x: 0, y: 0 });
	const containerRef = useRef<HTMLDivElement>(null);
	const menuRef = useRef<HTMLDivElement>(null);
	const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	const handleContextMenu = (e: React.MouseEvent) => {
		if (disabled) return;
		e.preventDefault();
		setPos({ x: e.clientX, y: e.clientY });
		setOpen(true);
	};

	const handleTouchStart = (e: React.TouchEvent) => {
		if (disabled) return;
		longPressTimer.current = setTimeout(() => {
			const touch = e.touches[0];
			setPos({ x: touch.clientX, y: touch.clientY });
			setOpen(true);
		}, 600);
	};

	const handleTouchEnd = () => {
		if (longPressTimer.current) {
			clearTimeout(longPressTimer.current);
			longPressTimer.current = null;
		}
	};

	useEffect(() => {
		const handleClickOutside = (e: MouseEvent) => {
			if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
				setOpen(false);
			}
		};
		const handleEscape = (e: KeyboardEvent) => {
			if (e.key === 'Escape') setOpen(false);
		};
		if (open) {
			document.addEventListener('click', handleClickOutside, true);
			document.addEventListener('keydown', handleEscape);
		}
		return () => {
			document.removeEventListener('click', handleClickOutside, true);
			document.removeEventListener('keydown', handleEscape);
		};
	}, [open]);

	// Adjust position to stay within viewport
	const adjustedPos = { ...pos };
	if (typeof window !== 'undefined') {
		const menuHeight = items.length * 40 + 8;
		const menuWidth = 160;
		if (pos.y + menuHeight > window.innerHeight) adjustedPos.y = window.innerHeight - menuHeight;
		if (pos.x + menuWidth > window.innerWidth) adjustedPos.x = window.innerWidth - menuWidth;
	}

	return (
		<div
			ref={containerRef}
			onContextMenu={handleContextMenu}
			onTouchStart={handleTouchStart}
			onTouchEnd={handleTouchEnd}
			onTouchMove={handleTouchEnd}
			className="relative"
		>
			{children}
			{open && (
				<div
					ref={menuRef}
					className="fixed z-[100] min-w-[140px] rounded-xl border border-auth-border bg-auth-surface shadow-brand py-1"
					style={{ left: adjustedPos.x, top: adjustedPos.y }}
				>
					{items.map((item, i) => (
						<button
							key={i}
							onClick={() => {
								item.onClick();
								setOpen(false);
							}}
							className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors ${
								item.danger
									? 'text-[var(--color-danger-text)] hover:bg-danger/10'
									: 'text-[var(--color-text-primary)] hover:bg-auth-elevated'
							}`}
						>
							{item.icon}
							{item.label}
						</button>
					))}
				</div>
			)}
		</div>
	);
}

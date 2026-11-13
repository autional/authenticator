#!/usr/bin/env node
/**
 * 焦点可见性守卫（focus-visible guard）。
 *
 * 背景：设计系统 tokens（@autional/tokens/tokens.css，@layer base）已提供全局焦点环：
 *   :focus-visible{outline:var(--focus-ring-width) solid var(--focus-ring-color);outline-offset:...}
 * 但 Tailwind 的 `.outline-none` 落在 **utilities 层**（层序在设计系统 base 之后），
 * 一旦某个元素挂了 `outline-none`，就会把 base 层的 2px 焦点环整条压掉 —— 键盘用户看不到焦点
 * （WCAG 2.4.7 / 2.4.11）。2026-11 实测线上产物：12 个输入类元素集体用 outline-none 压掉焦点环，
 * 开关与底部导航各自另生一套（或干脆没有），故加本守卫防复发。
 *
 * 判定（扫 src/**\/*.{tsx,ts}，跳过 src/harness/** 与 *.test.*）：
 *   - className 里出现 `outline-none`（含 `focus:outline-none` / `focus-visible:outline-none` …）
 *     → 违规（exit 1），唯一白名单：同一 className 里同时画了自己的环（含 `ring-`），标 OK(ring)。
 *   - 其余情况（无 outline-none）一律放过。
 *
 * 运行：`npm run lint:focus`（每个 app 逐字同源，与本仓其它 scripts/*.mjs 同风格）。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const cwd = process.cwd();
const srcDir = join(cwd, 'src');
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage']);
const EXT = /\.(tsx|ts)$/;
/** 每个 `outline-none` 变体（可带任意前缀，如 focus- / focus-visible- / hover-） */
const OUTLINE_NONE = /(?:[a-zA-Z-]+:)*outline-none/g;
/** 自己画了环的实现（ring-2 / ring-[var(--x)] …）；ring-offset-* / ring-inset / ring-opacity-* 只是修饰符，不算画了环 */
const HAS_RING = /(?:[a-zA-Z-]+:)*ring-(?!offset-|inset\b|opacity-)(?:\[|\d|\w)/;

/** 递归收集 src 下的 ts/tsx（跳过 harness 与测试文件） */
function collect(dir, out = []) {
	for (const name of readdirSync(dir)) {
		const full = join(dir, name);
		if (statSync(full).isDirectory()) {
			if (SKIP_DIRS.has(name)) continue;
			// dev-only 语料页只是展示用片段的对照表，不参与运行时焦点环
			if (relative(srcDir, full).split(sep)[0] === 'harness') continue;
			collect(full, out);
			continue;
		}
		if (!EXT.test(name)) continue;
		if (/\.test\./.test(name)) continue;
		out.push(full);
	}
	return out;
}

/**
 * 从 `className` 之后的值中取出「类名文本块」。
 * 支持 "…" / '…' / `…` / {…}（花括号按深度配平，忽略字符串里的括号）。
 * 返回 [{ text, start }]；start 为该块在文件中的起始下标（用于算行号）。
 */
function classBlocks(source) {
	const blocks = [];
	const re = /className\s*=\s*/g;
	let m;
	while ((m = re.exec(source))) {
		let i = m.index + m[0].length;
		const ch = source[i];
		if (ch === '"' || ch === "'") {
			const end = source.indexOf(ch, i + 1);
			if (end === -1) continue;
			blocks.push({ text: source.slice(i + 1, end), start: i + 1 });
		} else if (ch === '`') {
			const end = source.indexOf('`', i + 1);
			if (end === -1) continue;
			blocks.push({ text: source.slice(i + 1, end), start: i + 1 });
		} else if (ch === '{') {
			let depth = 0;
			let quote = null;
			let j = i;
			for (; j < source.length; j++) {
				const c = source[j];
				if (quote) {
					if (c === '\\') j++;
					else if (c === quote) quote = null;
					continue;
				}
				if (c === '"' || c === "'" || c === '`') {
					quote = c;
					continue;
				}
				if (c === '{') depth++;
				else if (c === '}') {
					depth--;
					if (depth === 0) break;
				}
			}
			blocks.push({ text: source.slice(i, j), start: i });
		}
	}
	return blocks;
}

function lineOf(source, index) {
	let line = 1;
	for (let i = 0; i < index && i < source.length; i++) if (source[i] === '\n') line++;
	return line;
}

if (!statSync(srcDir, { throwIfNoEntry: false })) {
	console.error(`[focus-guard] 未找到 ${srcDir}（本脚本需在 apps/<app>/ 目录下运行）`);
	process.exit(1);
}

const files = collect(srcDir);
const violations = [];
const allowed = [];
let scanned = 0;

for (const file of files) {
	const source = readFileSync(file, 'utf8');
	if (!source.includes('outline-none')) continue;
	scanned++;
	const rel = relative(cwd, file).split(sep).join('/');
	for (const block of classBlocks(source)) {
		if (!block.text.includes('outline-none')) continue;
		const okRing = HAS_RING.test(block.text);
		OUTLINE_NONE.lastIndex = 0;
		let hit;
		while ((hit = OUTLINE_NONE.exec(block.text))) {
			const line = lineOf(source, block.start + hit.index);
			const snippet = source.split('\n')[line - 1].trim().slice(0, 160);
			if (okRing) allowed.push(`${rel}:${line}  OK(ring)  ${hit[0]}`);
			else violations.push(`${rel}:${line}  ${snippet}`);
		}
	}
}

for (const line of allowed) console.log(line);
for (const line of violations) console.error(line);
console.log(
	`focus-visible guard: ${violations.length} violation(s)` +
		(allowed.length ? ` / ${allowed.length} OK(ring)` : '') +
		` / ${files.length} file(s) scanned, ${scanned} touched className`,
);
process.exit(violations.length === 0 ? 0 : 1);

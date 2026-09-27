import { visibleWidth } from "@oh-my-pi/pi-tui";
import { beforeAll, describe, expect, it } from "vitest";
import { initThemeSync } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import { getEditorTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/tui-adapters";
import { AtelierEditor, EDITOR_FRAME_MIN_WIDTH, frameEditorLines, isEditorRuleText } from "../src/editor.js";

const stripTerminalSequences = (line: string) => line.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");

const paint = (text: string) => `\u001b[38;2;102;102;102m${text}\u001b[39m`;
beforeAll(() => initThemeSync());

describe("editor frame helpers", () => {
	it("recognizes plain and scroll editor rules", () => {
		expect(isEditorRuleText("─".repeat(20))).toBe(true);
		expect(isEditorRuleText(`─── ↑ 3 more ${"─".repeat(8)}`)).toBe(true);
		expect(isEditorRuleText(`─── ↓ 12 more ${"─".repeat(6)}`)).toBe(true);
		expect(isEditorRuleText("prompt text")).toBe(false);
		expect(isEditorRuleText("")).toBe(false);
	});

	it("frames content with rounded corners, side rails, and inner padding", () => {
		const innerWidth = 12;
		const inner = ["─".repeat(innerWidth), "hello", "─".repeat(innerWidth)];
		const framed = frameEditorLines(inner, innerWidth + 4, paint);

		const top = stripTerminalSequences(framed[0] ?? "");
		const content = stripTerminalSequences(framed[1] ?? "");
		const bottom = stripTerminalSequences(framed[2] ?? "");
		expect(top).toBe(`╭${"─".repeat(innerWidth + 2)}╮`);
		expect(content.startsWith("│ ")).toBe(true);
		expect(content.endsWith(" │")).toBe(true);
		expect(content).toContain("hello");
		expect(visibleWidth(content)).toBe(innerWidth + 4);
		expect(bottom).toBe(`╰${"─".repeat(innerWidth + 2)}╯`);
		expect(framed).toHaveLength(3);
		for (const line of framed) expect(visibleWidth(line)).toBe(innerWidth + 4);
		expect(framed[0]).toContain("\u001b[38;2;102;102;102m╭");
		expect(framed[1]).toContain("\u001b[38;2;102;102;102m│\u001b[39m");
	});

	it("insets ANSI status content in the top border without adding a row", () => {
		const width = 48;
		const inner = ["─".repeat(width - 4), "draft", "─".repeat(width - 4)];
		const status = "\u001b[34m● READY\u001b[39m \u001b[35mgpt-5.6-sol\u001b[39m";
		const framed = frameEditorLines(inner, width, paint, () => status);

		expect(framed[0]).toContain(status);
		expect(stripTerminalSequences(framed[0] ?? "")).toMatch(/^╭─ ● READY gpt-5\.6-sol ─+╮$/);
		expect(framed.slice(1)).toEqual(frameEditorLines(inner, width, paint).slice(1));
		expect(framed).toHaveLength(inner.length);
		for (const line of framed) expect(visibleWidth(line)).toBe(width);
	});

	it("keeps autocomplete and both scroll indicators when a status line is present", () => {
		const innerWidth = 44;
		const inner = [
			`─── ↑ 2 more ${"─".repeat(innerWidth - 13)}`,
			"draft",
			`─── ↓ 4 more ${"─".repeat(innerWidth - 13)}`,
			"/atelier",
		];
		const framed = frameEditorLines(
			inner,
			innerWidth + 4,
			(text) => text,
			() => "● READY",
		);

		expect(framed[0]).toContain("╭─ ● READY");
		expect(framed[0]).toContain("↑ 2 more");
		expect(framed[0]?.endsWith("╮")).toBe(true);
		expect(framed[1]?.startsWith("│ ")).toBe(true);
		expect(framed[1]).toContain("draft");
		expect(framed[2]).toContain("/atelier");
		expect(framed[3]).toContain("╰─── ↓ 4 more");
		expect(framed[3]?.endsWith("╯")).toBe(true);
		expect(framed).toHaveLength(4);
		for (const line of framed) expect(visibleWidth(line)).toBe(innerWidth + 4);
	});

	it("uses the original frame when status content is empty, oversized, or too narrow", () => {
		for (const { width, status } of [
			{ width: 40, status: "\u001b[34m \u001b[39m" },
			{ width: 40, status: "model-name".repeat(8) },
			{ width: 17, status: "READY" },
		]) {
			const inner = ["─".repeat(width - 4), "draft", "─".repeat(width - 4)];
			const framed = frameEditorLines(inner, width, paint, () => status);

			expect(framed).toEqual(frameEditorLines(inner, width, paint));
			for (const line of framed) expect(visibleWidth(line)).toBe(width);
		}
	});

	it("does not frame below the minimum width", () => {
		const inner = ["────────", "text", "────────"];
		const framed = frameEditorLines(inner, EDITOR_FRAME_MIN_WIDTH - 1, paint);
		expect(framed.some((line) => line.includes("╭") || line.includes("╰"))).toBe(false);
		expect(framed[1]).toBe("text");
		for (const line of framed) expect(visibleWidth(line)).toBeLessThanOrEqual(EDITOR_FRAME_MIN_WIDTH - 1);
	});
});

describe("AtelierEditor", () => {
	it("renders an empty composer inside a rounded frame", () => {
		const editor = new AtelierEditor(getEditorTheme());

		const lines = editor.render(40);
		expect(stripTerminalSequences(lines[0] ?? "")).toMatch(/^╭─+╮$/);
		expect(stripTerminalSequences(lines.at(-1) ?? "")).toMatch(/^╰─+╯$/);
		for (const line of lines) expect(visibleWidth(line)).toBe(40);
	});

	it("reports only the status line visible in the most recent render", () => {
		const editor = new AtelierEditor(getEditorTheme());

		expect(editor.statusLineVisible).toBe(false);
		editor.renderStatusLine = () => "● READY";
		expect(editor.render(40)[0]).toContain("● READY");
		expect(editor.statusLineVisible).toBe(true);

		expect(editor.render(17)[0]).not.toContain("● READY");
		expect(editor.statusLineVisible).toBe(false);

		editor.render(40);
		expect(editor.statusLineVisible).toBe(true);
		delete editor.renderStatusLine;
		expect(stripTerminalSequences(editor.render(40)[0] ?? "")).toMatch(/^╭─+╮$/);
		expect(editor.statusLineVisible).toBe(false);
	});
});

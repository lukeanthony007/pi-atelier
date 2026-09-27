import type { TUI } from "@oh-my-pi/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { createSplitPaneController, parseSgrMouseEvent } from "../src/split-pane.js";

function harness(columns = 140) {
	const write = vi.fn();
	const requestRender = vi.fn();
	const widths: number[] = [];
	let input: ((data: string) => { consume?: boolean; data?: string } | undefined) | undefined;
	const unsubscribe = vi.fn();
	const split = createSplitPaneController({
		subscribeInput(handler) {
			input = handler;
			return unsubscribe;
		},
		onWidthChange: (width) => widths.push(width),
	});
	const tui = { terminal: { columns, rows: 30, write }, requestRender } as unknown as TUI;
	split.attach(tui);
	split.show();
	return { split, tui, write, requestRender, widths, unsubscribe, input: (data: string) => input?.(data) };
}

describe("native sidebar resize", () => {
	it("reserves minimum main width and retains the requested width across narrow terminal sizes", () => {
		const h = harness();
		h.split.setSidebarWidth(72);
		expect(h.split.getSidebarWidth()).toBe(72);
		expect(h.split.isVisibleAtWidth(136)).toBe(true);
		expect(h.split.isVisibleAtWidth(135)).toBe(false);
		(h.tui.terminal as { columns: number }).columns = 100;
		expect(h.split.isVisibleAtWidth(100)).toBe(false);
		(h.tui.terminal as { columns: number }).columns = 140;
		expect(h.split.isVisibleAtWidth(140)).toBe(true);
		expect(h.widths).toEqual([72]);
		h.split.dispose();
	});

	it("applies keyboard changes, commits on Enter, and restores width on Escape", () => {
		const h = harness();
		expect(h.split.beginResize()).toBe(true);
		expect(h.input("\u001b[1;2D")).toEqual({ consume: true });
		expect(h.split.getSidebarWidth()).toBe(48);
		h.input("\u001b");
		expect(h.split.getSidebarWidth()).toBe(44);
		expect(h.unsubscribe).toHaveBeenCalledTimes(1);
		expect(h.write).toHaveBeenCalledWith("\u001b[?1006l\u001b[?1002l");
		h.split.beginResize();
		h.input("\u001b[1;2D");
		h.input("\r");
		expect(h.split.getSidebarWidth()).toBe(48);
		h.split.dispose();
	});

	it("drags only from the divider and releases mouse tracking on hide", () => {
		const h = harness();
		h.split.beginResize();
		h.input("\u001b[<0;10;4M");
		h.input("\u001b[<32;80;4M");
		expect(h.split.getSidebarWidth()).toBe(44);
		h.input("\u001b[<0;97;4M");
		h.input("\u001b[<32;83;4M");
		expect(h.split.getSidebarWidth()).toBe(58);
		h.split.hide();
		expect(h.unsubscribe).toHaveBeenCalledTimes(1);
		h.split.dispose();
	});

	it("parses SGR events and rejects malformed coordinates", () => {
		expect(parseSgrMouseEvent("\u001b[<32;80;4M")).toMatchObject({ x: 80, motion: true });
		expect(parseSgrMouseEvent("\u001b[<0;80;4m")).toMatchObject({ release: true });
		expect(parseSgrMouseEvent("\u001b[<0;0;4M")).toBeUndefined();
	});
});

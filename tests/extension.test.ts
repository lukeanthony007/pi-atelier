import { describe, expect, it, vi } from "vitest";

import { SIDEBAR_PANEL_EVENT_CHANNEL } from "../extensions/index.js";

import { settleMicrotasks } from "./helpers/async.js";
import {
	harness,
	replacementContext,
	start,
	command,
	renderOverlayText,
	renderSidebarText,
	withPersistedUserConfig,
} from "./helpers/extension.js";

describe("extension registration", () => {
	it("discovers and renders a structured contributed panel through pi.events", async () => {
		const h = harness();
		await withPersistedUserConfig(
			{
				sidebarPanelLayout: [
					{ id: "vendor:queue", visible: true },
					...Array.from({ length: 8 }, (_, index) => ({
						id: ["agent", "activity", "alerts", "todos", "context", "workspace", "usage", "tools"][index],
						visible: false,
					})),
				],
			},
			async () => {
				await start(h);
				h.pi.events.emit(SIDEBAR_PANEL_EVENT_CHANNEL, {
					version: 1,
					type: "register",
					source: "vendor",
					revision: 1,
					panel: { id: "vendor:queue", title: "Queue", rows: ["queued 2"] },
				});
				await command(h, "sidebar on");
				const rendered = renderSidebarText(h);
				expect(rendered).toContain("QUEUE");
				expect(rendered).toContain("queued 2");
			},
		);
	});

	it("does not let a built-in panel event spoof the Display settings", async () => {
		const h = harness("tui", "linux", true);
		await start(h);
		h.pi.events.emit(SIDEBAR_PANEL_EVENT_CHANNEL, {
			version: 1,
			type: "register",
			source: "vendor",
			revision: 1,
			panel: { id: "agent", title: "Spoofed Agent", rows: ["attacker"] },
		});
		const opening = command(h, "display");
		await h.mounted(0);
		expect(renderOverlayText(h, h.overlays.length - 1, 120)).not.toContain("Spoofed Agent");
		h.overlays[0]!.component.handleInput("\u001b");
		await opening;
	});

	it("routes f6 to the Control Center", async () => {
		const h = harness("tui", "linux", true);
		await start(h);
		const before = h.custom.mock.calls.length;

		const opening = h.shortcutHandlers.get("f6")?.(h.ctx);
		await h.mounted(0);
		expect(h.overlays).toHaveLength(1);

		expect(h.custom.mock.calls.length).toBe(before + 1);
		expect(renderOverlayText(h, h.overlays.length - 1, 80)).toContain("Atelier Control Center");
		h.overlays.at(-1)?.component.handleInput("\u001b");
		await opening;
	});

	it("does not install terminal UI outside TUI mode", async () => {
		const h = harness("print");
		await start(h);
		expect(h.setFooter).not.toHaveBeenCalled();
		expect(h.setEditorComponent).not.toHaveBeenCalled();
	});

	it("starts with the Sidebar hidden when the global preference is off", async () => {
		await withPersistedUserConfig({ showSidebarOnStartup: false }, async () => {
			const h = harness();

			await start(h);

			expect(h.activeSidebar).toBeUndefined();
			expect(h.setFooter).toHaveBeenCalledOnce();
			await command(h, "sidebar on");
			expect(renderSidebarText(h)).toContain("AGENT");
		});
	});

	it("starts enabled and toggles the persistent sidebar on -> off -> on", async () => {
		const h = harness();
		await start(h);
		expect(renderSidebarText(h)).toContain("AGENT");
		expect(h.setSidebar).toHaveBeenLastCalledWith(expect.any(Function), { width: 44, minMainWidth: 64 });
		await command(h, "sidebar");
		expect(h.activeSidebar).toBeUndefined();
		expect(h.setSidebar).toHaveBeenLastCalledWith(undefined);
		await command(h, "sidebar");
		expect(renderSidebarText(h)).toContain("AGENT");
	});

	it("supports idempotent sidebar on and off commands", async () => {
		const h = harness();
		await start(h);
		await command(h, "sidebar on");
		await command(h, "sidebar on");
		expect(h.setSidebar).toHaveBeenCalledTimes(1);
		await command(h, "sidebar off");
		await command(h, "sidebar off");
		expect(h.setSidebar).toHaveBeenCalledTimes(2);
		expect(h.activeSidebar).toBeUndefined();
	});

	it("toggles and persists sidebar tool-name details", async () => {
		const h = harness();
		await start(h);
		await command(h, "sidebar on");
		expect(renderSidebarText(h)).not.toContain("\n│ read");

		await command(h, "sidebar tools on");

		expect(h.saveConfigPatch).toHaveBeenLastCalledWith(expect.stringContaining("pi-atelier.json"), {
			showSidebarToolNames: true,
		});
		expect(renderSidebarText(h)).toContain("read");
		expect(h.ctx.ui.notify).toHaveBeenLastCalledWith("Sidebar tool list expanded", "info");

		await command(h, "sidebar tools off");
		expect(h.saveConfigPatch).toHaveBeenLastCalledWith(expect.stringContaining("pi-atelier.json"), {
			showSidebarToolNames: false,
		});
		expect(h.ctx.ui.notify).toHaveBeenLastCalledWith("Sidebar tool list collapsed", "info");
	});

	it.each(["sidebar maybe", "sidebar on extra"])("warns for invalid syntax: %s", async (args) => {
		const h = harness();
		await start(h);
		await command(h, args);
		expect(h.ctx.ui.notify).toHaveBeenCalledWith("Usage: /atelier sidebar [on|off]", "warning");
		expect(h.setSidebar).toHaveBeenCalledOnce();
	});

	it("warns for invalid sidebar tool-list syntax", async () => {
		const h = harness();
		await start(h);
		await command(h, "sidebar tools maybe");
		expect(h.ctx.ui.notify).toHaveBeenCalledWith("Usage: /atelier sidebar tools [on|off]", "warning");
		expect(h.saveConfigPatch).not.toHaveBeenCalled();
	});

	it("mounts the sidebar through the native host slot and removes it on hide", async () => {
		const h = harness();
		await start(h);
		expect(h.activeSidebar?.options).toEqual({ width: 44, minMainWidth: 64 });
		expect(renderSidebarText(h)).toContain("AGENT");
		await command(h, "sidebar off");
		expect(h.activeSidebar).toBeUndefined();
		expect(h.setSidebar).toHaveBeenLastCalledWith(undefined);
	});

	it("enters Resize mode with Ctrl+Shift+R only for the active visible sidebar", async () => {
		const h = harness();
		await start(h);
		await h.shortcutHandlers.get("ctrl+shift+r")?.(h.ctx);
		expect(h.terminalWrite).toHaveBeenCalledWith("\u001b[?1002h\u001b[?1006h");

		await command(h, "sidebar off");
		h.terminalWrite.mockClear();
		await h.shortcutHandlers.get("ctrl+shift+r")?.(h.ctx);
		expect(h.terminalWrite).not.toHaveBeenCalled();
		expect(h.ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("sidebar"), "warning");

		const staleCtx = h.ctx;
		const currentCtx = replacementContext(h.ctx, "Replacement session");
		await start(h, currentCtx);
		const writeCount = h.terminalWrite.mock.calls.length;
		await h.shortcutHandlers.get("ctrl+shift+r")?.(staleCtx);
		expect(h.terminalWrite).toHaveBeenCalledTimes(writeCount);
		expect(staleCtx.ui.notify).toHaveBeenLastCalledWith(
			"Show the Pi Atelier sidebar before resizing it",
			"warning",
		);
	});

	it("disable closes the sidebar and restores render and mouse state", async () => {
		const h = harness();
		await start(h);
		await command(h, "sidebar on");
		await h.shortcutHandlers.get("ctrl+shift+r")?.(h.ctx);

		await command(h, "disable");

		expect(h.setSidebar).toHaveBeenLastCalledWith(undefined);
		expect(h.terminalWrite).toHaveBeenLastCalledWith("\u001b[?1006l\u001b[?1002l");
	});

	it("passes command state to the menu controller", async () => {
		const h = harness("tui", "linux", true);
		await start(h);
		await command(h, "sidebar on");
		const opening = command(h, "");
		await h.mounted(0);
		expect(h.overlays).toHaveLength(1);
		const menu = renderOverlayText(h, 0, 80);
		expect(menu).toContain("Sidebar: On");
		h.overlays[0]?.component.handleInput("\u001b");
		await opening;
	});

	it("passes contributed titles through the public Display seam and persists enabling them", async () => {
		await withPersistedUserConfig(
			{
				sidebarPanelLayout: [{ id: "vendor:missing", visible: true }],
			},
			async () => {
				const h = harness("tui", "linux", true);
				await start(h);
				h.pi.events.emit(SIDEBAR_PANEL_EVENT_CHANNEL, {
					version: 1,
					type: "register",
					source: "vendor",
					revision: 1,
					panel: { id: "vendor:queue", title: "Queue title", rows: ["queued"] },
				});
				const opening = command(h, "display");
				await h.mounted(0);
				expect(h.overlays).toHaveLength(1);
				const workspace = h.overlays.at(-1)!.component;
				const rendered = workspace?.render(120).join("\n") ?? "";
				expect(rendered).toContain("vendor:missing");

				// Two display rows, nine segments, and three actions precede configured panels.
				for (let index = 0; index < 14 + 10; index += 1) workspace?.handleInput("\u001b[B");
				const focusedRendered = workspace?.render(120).join("\n") ?? "";
				expect(focusedRendered).toContain("Queue title");
				expect(focusedRendered).toContain("unavailable");
				workspace?.handleInput(" ");
				workspace?.handleInput("s");
				expect(h.saveConfigPatch).toHaveBeenCalled();
				await settleMicrotasks();
				const patch = h.saveConfigPatch.mock.calls.at(-1)?.[1] as {
					sidebarPanelLayout?: Array<{ id: string; visible: boolean }>;
				};
				expect(patch.sidebarPanelLayout).toEqual(
					expect.arrayContaining([
						{ id: "vendor:missing", visible: true },
						{ id: "vendor:queue", visible: true },
					]),
				);
				expect(patch.sidebarPanelLayout?.map((entry) => entry.id)).toEqual([
					"vendor:missing",
					"agent",
					"activity",
					"alerts",
					"todos",
					"context",
					"workspace",
					"usage",
					"subagents",
					"tools",
					"vendor:queue",
				]);
				workspace?.handleInput("\u001b");
				await opening;
			},
		);
	});

	it("passes NO_COLOR through to sidebar rendering", async () => {
		const h = harness();
		vi.stubEnv("NO_COLOR", "1");
		try {
			await start(h);
			await command(h, "sidebar on");
			expect(renderSidebarText(h)).not.toContain("\u001b[38;2;");
		} finally {
			vi.unstubAllEnvs();
		}
	});

	it("opens the Display workspace directly and rejects it outside TUI mode", async () => {
		const h = harness("tui", "linux", true);
		await start(h);
		const before = h.custom.mock.calls.length;
		const opening = command(h, "display");
		await h.mounted(0);
		expect(h.overlays).toHaveLength(1);
		expect(h.custom.mock.calls.length).toBe(before + 1);
		expect(renderOverlayText(h, h.overlays.length - 1, 80)).toContain("DISPLAY SETTINGS");
		h.overlays.at(-1)?.component.handleInput("\u001b");
		await opening;

		const printed = harness("print");
		await command(printed, "display");
		expect(printed.custom).not.toHaveBeenCalled();
		expect(printed.ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("TUI mode"), "warning");
	});

	it("warns instead of opening the sidebar outside TUI mode", async () => {
		const h = harness("print");
		await command(h, "sidebar");
		expect(h.setSidebar).not.toHaveBeenCalled();
		expect(h.ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("TUI mode"), "warning");
	});

	it("collapses activated tool names at narrow sidebar widths", async () => {
		const h = harness();
		h.pi.getActiveTools.mockReturnValue(["write", "read", "bash", "edit"]);
		h.pi.getAllTools.mockReturnValue([
			{ name: "write" },
			{ name: "read" },
			{ name: "bash" },
			{ name: "edit" },
			{ name: "grep" },
		]);
		await start(h);
		await command(h, "sidebar on");

		const text = renderSidebarText(h, 39);
		expect(text).toMatch(/Enabled\s+4 \/ 5/);
		expect(text).not.toContain("▸");
		expect(text).not.toContain("bash");
		expect(text).not.toContain("edit");
		expect(text).not.toContain("read");
		expect(text).not.toContain("write");
		expect(text).not.toContain("grep");
	});
});

import { describe, expect, it, vi } from "vitest";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import { SIDEBAR_PANEL_EVENT_CHANNEL } from "../extensions/index.js";

import { loadConfig as loadAtelierConfig, saveUserConfigPatch as persistConfigPatch } from "../src/config.js";
import { deferred, settleMicrotasks } from "./helpers/async.js";
import {
	loadTestConfig,
	loadConfigAfter,
	harness,
	replacementContext,
	start,
	todoBranchEntry,
	command,
	renderSidebarText,
	renderFooter,
	queueWorkspacePulseInspection,
	execResult,
} from "./helpers/extension.js";

describe("extension session", () => {
	it("registers the resize shortcut exactly once across session replacement", async () => {
		const h = harness();
		await start(h);
		await start(h, replacementContext(h.ctx, "Replacement session"));

		expect(h.pi.registerShortcut.mock.calls.filter(([key]) => key === "ctrl+shift+r")).toHaveLength(1);
	});

	it("retires active TUI state when a non-TUI session starts", async () => {
		const h = harness("tui", "darwin");
		await start(h);
		expect(h.getEventBusHandlerCount(SIDEBAR_PANEL_EVENT_CHANNEL)).toBe(1);
		expect(h.getEventBusHandlerCount("rpiv:ask-user:blocked")).toBe(1);
		h.pi.events.emit("rpiv:ask-user:blocked", { active: true });
		expect(h.spawnNotificationProcess).toHaveBeenCalledOnce();

		const printContext = { ...replacementContext(h.ctx, "Print session"), mode: "print" as const };
		await start(h, printContext);

		expect(h.getEventBusHandlerCount(SIDEBAR_PANEL_EVENT_CHANNEL)).toBe(0);
		expect(h.getEventBusHandlerCount("rpiv:ask-user:blocked")).toBe(0);
		expect(h.notificationProcess.kill).toHaveBeenCalledOnce();
		expect(h.activeSidebar).toBeUndefined();
		expect(h.setFooter).toHaveBeenLastCalledWith(undefined);
		expect(h.setEditorComponent).toHaveBeenLastCalledWith(undefined);
		h.pi.events.emit("rpiv:ask-user:blocked", { active: false });
		h.pi.events.emit("rpiv:ask-user:blocked", { active: true });
		expect(h.spawnNotificationProcess).toHaveBeenCalledOnce();
		await command(h, "sidebar on", h.ctx);
		expect(h.ctx.ui.notify).toHaveBeenLastCalledWith("Pi Atelier is not active in this session", "warning");
	});

	it("does not publish an in-flight TUI initializer after a newer non-TUI session starts", async () => {
		const load = deferred<void>();
		const deferredLoadConfig = vi
			.fn<typeof loadAtelierConfig>()
			.mockImplementationOnce(loadConfigAfter(load));
		const h = harness("tui", "linux", false, { loadConfig: deferredLoadConfig });

		const starting = start(h);
		expect(deferredLoadConfig).toHaveBeenCalledOnce();
		const printContext = { ...replacementContext(h.ctx, "Newer print session"), mode: "print" as const };
		await start(h, printContext);
		load.resolve(undefined);
		await starting;

		expect(h.setFooter).not.toHaveBeenCalled();
		expect(h.setSidebar).not.toHaveBeenCalled();
		expect(h.getEventBusHandlerCount("rpiv:ask-user:blocked")).toBe(0);
	});

	it("clears the retired footer when a TUI session with a distinct UI replaces it", async () => {
		const h = harness();
		await start(h);
		const replacementSetFooter = vi.fn();
		const replacementNotify = vi.fn();
		const replacementCtx = {
			...replacementContext(h.ctx, "Distinct UI replacement"),
			ui: {
				...h.ctx.ui,
				setFooter: replacementSetFooter,
				notify: replacementNotify,
			},
		};

		await start(h, replacementCtx);

		expect(h.setFooter).toHaveBeenLastCalledWith(undefined);
		expect(replacementSetFooter).toHaveBeenCalledOnce();
		expect(replacementSetFooter).toHaveBeenLastCalledWith(expect.any(Function));
		expect(replacementSetFooter).not.toHaveBeenCalledWith(undefined);
		expect(h.setSidebar).toHaveBeenCalledWith(undefined);
		expect(renderSidebarText(h)).toContain("Distinct UI replacement");
	});

	it.each([
		["Control Center", ""],
		["Display Settings", "display"],
	])("closes a session-owned %s overlay during replacement", async (_label, args) => {
		const h = harness("tui", "linux", true);
		await start(h);

		const opening = command(h, args);
		await h.mounted(0);
		expect(h.overlays).toHaveLength(1);
		const overlay = h.overlays[0]!;

		await start(h, replacementContext(h.ctx, "Replacement session"));
		await opening;

		expect(overlay.done).toHaveBeenCalledOnce();
		expect(overlay.closed).toBe(true);
		expect(renderSidebarText(h)).toContain("Replacement session");
	});

	it.each([
		["Display", "display"],
		["Control Center", ""],
	])("settles a retired %s command when host done throws", async (_label, args) => {
		const h = harness("tui", "linux", true);
		await start(h);
		const opening = command(h, args);
		await h.mounted(0);
		expect(h.overlays).toHaveLength(1);
		const overlay = h.overlays[0]!;
		overlay.done.mockImplementation(() => {
			throw new Error("overlay close failed");
		});

		await start(h, replacementContext(h.ctx, "Replacement session"));

		expect(overlay.closed).toBe(false);
		expect(() => overlay.component.render(80)).not.toThrow();
		expect(overlay.component.render(80)).toEqual([]);
		overlay.requestRender.mockClear();
		expect(() => overlay.component.handleInput(" ")).not.toThrow();
		expect(overlay.requestRender).not.toHaveBeenCalled();
		expect(renderSidebarText(h)).toContain("Replacement session");
		await expect(opening).resolves.toBeUndefined();
	});

	it("renders an inert retired Control Center tool overlay", async () => {
		await initTheme();
		const h = harness("tui", "linux", true);
		const setActiveTools = vi.fn();
		(h.pi as any).setActiveTools = setActiveTools;
		await start(h);
		void command(h, "");
		await h.mounted(0);
		expect(h.overlays).toHaveLength(1);
		const root = h.overlays[0]!;
		root.component.handleInput("\u001b[B");
		root.component.handleInput("\r");
		await h.mounted(1);
		expect(h.overlays).toHaveLength(2);
		const controls = h.overlays[1]!;
		controls.component.handleInput("\u001b[B");
		controls.component.handleInput("\u001b[B");
		controls.component.handleInput("\r");
		await h.mounted(2);
		expect(h.overlays).toHaveLength(3);
		const toolSettings = h.overlays[2]!;
		toolSettings.done.mockImplementation(() => {
			throw new Error("tool overlay close failed");
		});

		await start(h, replacementContext(h.ctx, "Replacement session"));

		expect(toolSettings.closed).toBe(false);
		expect(() => toolSettings.component.render(80)).not.toThrow();
		expect(toolSettings.component.render(80)).toEqual([]);
		setActiveTools.mockClear();
		expect(() => toolSettings.component.handleInput(" ")).not.toThrow();
		expect(setActiveTools).not.toHaveBeenCalled();
		expect(renderSidebarText(h)).toContain("Replacement session");
	});

	it("keeps cleanup exception-safe when independent disposers throw", async () => {
		const h = harness(
			"tui",
			"darwin",
			false,
			{},
			{
				throwOnEventUnsubscribe: [SIDEBAR_PANEL_EVENT_CHANNEL],
			},
		);
		await start(h);
		h.pi.events.emit("rpiv:ask-user:blocked", { active: true });
		expect(h.spawnNotificationProcess).toHaveBeenCalledOnce();
		h.setFooter.mockImplementation((value) => {
			if (value === undefined) throw new Error("footer cleanup failed");
		});

		await h.dispatch("session_shutdown", { reason: "quit" });

		expect(h.activeSidebar).toBeUndefined();
		expect(h.notificationProcess.kill).toHaveBeenCalledOnce();
		expect(h.getEventBusHandlerCount("rpiv:ask-user:blocked")).toBe(0);
		await command(h, "sidebar on");
		expect(h.ctx.ui.notify).toHaveBeenLastCalledWith("Pi Atelier is not active in this session", "warning");
	});

	it("keeps a candidate-local failure from replacing the current session", async () => {
		const throwOnSubscribe: string[] = [];
		const h = harness("tui", "darwin", false, {}, { throwOnEventSubscribe: throwOnSubscribe });
		await start(h);
		await h.dispatch("agent_start", { type: "agent_start" });
		await h.dispatch("tool_execution_start", {
			type: "tool_execution_start",
			toolCallId: "active-tool",
			toolName: "read",
			args: { path: "/tmp/project/current.ts" },
		});
		h.pi.events.emit("rpiv:ask-user:blocked", { active: true });
		expect(h.spawnNotificationProcess).toHaveBeenCalledOnce();
		const currentBeforeFailure = renderSidebarText(h);
		expect(currentBeforeFailure).toContain("Test session");
		expect(currentBeforeFailure).toContain("current.ts");
		throwOnSubscribe.push("rpiv:ask-user:blocked");
		const failingCtx = replacementContext(h.ctx, "Failing candidate");
		failingCtx.sessionManager.getBranch.mockReturnValue([
			todoBranchEntry({ todos: [{ id: 1, text: "Candidate TODO", done: false }], nextId: 2 }),
		]);

		await start(h, failingCtx);

		expect(h.ctx.ui.notify).toHaveBeenCalledWith(
			"Pi Atelier could not start: subscribe failed: rpiv:ask-user:blocked",
			"error",
		);
		expect(h.activeSidebar).toBeDefined();
		expect(h.setSidebar).not.toHaveBeenCalledWith(undefined);
		expect(h.getEventBusHandlerCount(SIDEBAR_PANEL_EVENT_CHANNEL)).toBe(1);
		expect(h.getEventBusHandlerCount("rpiv:ask-user:blocked")).toBe(1);

		h.pi.events.emit(SIDEBAR_PANEL_EVENT_CHANNEL, {
			version: 1,
			type: "register",
			source: "vendor",
			revision: 1,
			panel: { id: "vendor:candidate", title: "Candidate Panel", rows: ["candidate row"] },
		});
		await h.dispatch("agent_start", { type: "agent_start" }, failingCtx);
		await h.dispatch(
			"tool_execution_start",
			{
				type: "tool_execution_start",
				toolCallId: "candidate-tool",
				toolName: "read",
				args: { path: "/tmp/project/candidate.ts" },
			},
			failingCtx,
		);

		const currentAfterFailure = renderSidebarText(h);
		expect(currentAfterFailure).toContain("Test session");
		expect(currentAfterFailure).toContain("current.ts");
		expect(currentAfterFailure).not.toContain("Failing candidate");
		expect(currentAfterFailure).not.toContain("Candidate TODO");
		expect(currentAfterFailure).not.toContain("Candidate Panel");
		expect(currentAfterFailure).not.toContain("candidate.ts");
		expect(h.spawnNotificationProcess).toHaveBeenCalledOnce();
	});

	it("keeps active Sidebar snapshot failures visible", async () => {
		const h = harness();
		await start(h);
		h.ctx.sessionManager.getBranch.mockImplementation(() => {
			throw new Error("snapshot read failed");
		});

		const sidebar = renderSidebarText(h);
		expect(sidebar).toContain("Sidebar unavailable");
		expect(sidebar).toContain("snapshot read failed");
	});

	it("does not publish deferred Display saves after replacement", async () => {
		const saved = deferred<void>();
		const saving = deferred<void>();
		const saveConfigPatch = vi.fn<typeof persistConfigPatch>().mockImplementation(async () => {
			saving.resolve();
			await saved.promise;
		});
		const h = harness("tui", "linux", true, { saveConfigPatch });
		await start(h);
		const opening = command(h, "display");
		await h.mounted(0);
		expect(h.overlays).toHaveLength(1);
		const displaySettings = h.overlays[0]!;

		displaySettings.component.handleInput(" ");
		displaySettings.component.handleInput("s");
		await saving.promise;
		expect(saveConfigPatch).toHaveBeenCalledOnce();

		await start(h, replacementContext(h.ctx, "Replacement session"));
		await opening;
		displaySettings.requestRender.mockClear();
		saved.resolve(undefined);
		await settleMicrotasks();

		expect(displaySettings.requestRender).not.toHaveBeenCalled();
		expect(renderSidebarText(h)).toContain("Replacement session");
	});

	it("suppresses deferred Control Center save notifications after replacement", async () => {
		const saved = deferred<void>();
		const saving = deferred<void>();
		const saveConfigPatch = vi.fn<typeof persistConfigPatch>().mockImplementation(async () => {
			saving.resolve();
			await saved.promise;
		});
		const h = harness("tui", "linux", true, { saveConfigPatch });
		await start(h);
		const opening = command(h, "");
		await h.mounted(0);
		expect(h.overlays).toHaveLength(1);
		h.overlays[0]!.component.handleInput("\r");
		await h.mounted(1);
		expect(h.overlays).toHaveLength(2);
		h.overlays[1]!.component.handleInput("\u001b[B");
		h.overlays[1]!.component.handleInput("\r");
		await saving.promise;
		expect(saveConfigPatch).toHaveBeenCalledOnce();

		await start(h, replacementContext(h.ctx, "Replacement session"));
		saved.resolve(undefined);
		await opening;

		expect(h.ctx.ui.notify).not.toHaveBeenCalledWith(expect.stringContaining("Sidebar will start"), "info");
		expect(h.ctx.ui.notify).not.toHaveBeenCalledWith(
			expect.stringContaining("Sidebar startup preference could not be saved"),
			"warning",
		);
		expect(renderSidebarText(h)).toContain("Replacement session");
	});

	it("closes nested Control Center model prompts during replacement", async () => {
		const h = harness("tui", "linux", true);
		(h.ctx.modelRegistry as any).getAvailable = vi.fn().mockReturnValue([{ provider: "test", id: "model" }]);
		await start(h);
		const opening = command(h, "");
		await h.mounted(0);
		expect(h.overlays).toHaveLength(1);
		h.overlays[0]!.component.handleInput("\u001b[B");
		h.overlays[0]!.component.handleInput("\r");
		await h.mounted(1);
		expect(h.overlays).toHaveLength(2);
		h.overlays[1]!.component.handleInput("\u001b[B");
		h.overlays[1]!.component.handleInput("\r");
		await h.mounted(2);
		expect(h.overlays).toHaveLength(3);
		const modelPrompt = h.overlays[2]!;

		await start(h, replacementContext(h.ctx, "Replacement session"));
		await opening;

		expect(modelPrompt.done).toHaveBeenCalledOnce();
		expect(modelPrompt.closed).toBe(true);
		expect(renderSidebarText(h)).toContain("Replacement session");
	});

	it("closes an enabled sidebar and resize input during shutdown", async () => {
		const h = harness();
		await start(h);
		await command(h, "sidebar on");
		await h.shortcutHandlers.get("ctrl+shift+r")?.(h.ctx);
		expect(h.terminalWrite).toHaveBeenLastCalledWith("\u001b[?1002h\u001b[?1006h");
		expect(h.terminalInput).toEqual(expect.any(Function));

		await h.dispatch("session_shutdown", { reason: "quit" });

		expect(h.activeSidebar).toBeUndefined();
		expect(h.setFooter).toHaveBeenLastCalledWith(undefined);
		expect(h.setEditorComponent).toHaveBeenLastCalledWith(undefined);
		expect(h.terminalWrite).toHaveBeenLastCalledWith("\u001b[?1006l\u001b[?1002l");
		expect(h.terminalInputUnsubscribe).toHaveBeenCalledOnce();
		expect(h.terminalInput).toBeUndefined();
	});

	it("clears session-owned sidebar state during shutdown", async () => {
		const h = harness();
		h.ctx.sessionManager.getBranch.mockReturnValue([
			todoBranchEntry({
				tasks: [{ id: 1, subject: "Shutdown stale TODO", status: "in_progress" }],
				nextId: 2,
			}),
		]);
		await start(h);
		await h.dispatch("agent_start", { type: "agent_start" });
		await h.dispatch("turn_start", { type: "turn_start", turnIndex: 1, timestamp: 1_000 });
		await h.dispatch("tool_execution_start", {
			type: "tool_execution_start",
			toolCallId: "shutdown-tool",
			toolName: "read",
			args: { path: "/tmp/project/shutdown-stale.ts" },
		});
		const beforeShutdown = renderSidebarText(h);
		expect(beforeShutdown).toContain("Shutdown stale TODO");
		expect(beforeShutdown).toContain("shutdown-stale.ts");

		await h.dispatch("session_shutdown", { reason: "quit" });
		const replacementCtx = replacementContext(h.ctx, "Post-shutdown session");
		replacementCtx.sessionManager.getBranch.mockReturnValue([]);
		await start(h, replacementCtx);

		expect(h.setSidebar).toHaveBeenCalledWith(undefined);
		const replacementSidebar = renderSidebarText(h);
		expect(replacementSidebar).toContain("Post-shutdown session");
		expect(replacementSidebar).not.toContain("Shutdown stale TODO");
		expect(replacementSidebar).not.toContain("shutdown-stale.ts");
		expect(replacementSidebar).not.toContain("TODOS");
	});

	it("does not retain published state when initialization fails", async () => {
		const h = harness("tui", "darwin");
		await start(h);
		h.pi.events.emit("rpiv:ask-user:blocked", { active: true });
		expect(h.spawnNotificationProcess).toHaveBeenCalledOnce();

		const failingCtx = replacementContext(h.ctx, "Failing session");
		failingCtx.sessionManager.getBranch.mockReturnValue([
			todoBranchEntry({ todos: [{ id: 1, text: "Failure stale TODO", done: false }], nextId: 2 }),
		]);
		const failedFooterRender = vi.fn();
		h.setFooter.mockImplementation((footer) => {
			if (typeof footer !== "function") return;
			renderFooter(footer, failedFooterRender);
			throw new Error("footer install failed");
		});

		await start(h, failingCtx);

		expect(h.notificationProcess.kill).toHaveBeenCalledOnce();
		expect(h.activeSidebar).toBeUndefined();
		expect(h.setFooter).toHaveBeenLastCalledWith(undefined);
		expect(h.getEventBusHandlerCount("rpiv:ask-user:blocked")).toBe(0);
		expect(h.ctx.ui.notify).toHaveBeenCalledWith(
			"Pi Atelier could not start: footer install failed",
			"error",
		);
		expect(h.activeSidebar).toBeUndefined();

		failedFooterRender.mockClear();
		failingCtx.sessionManager.getBranch.mockReturnValue([
			todoBranchEntry({ todos: [{ id: 2, text: "Resurrected TODO", done: false }], nextId: 3 }),
		]);
		await h.dispatch("session_tree", { type: "session_tree" }, failingCtx);
		expect(failedFooterRender).not.toHaveBeenCalled();

		h.pi.events.emit("rpiv:ask-user:blocked", { active: false });
		h.pi.events.emit("rpiv:ask-user:blocked", { active: true });
		expect(h.spawnNotificationProcess).toHaveBeenCalledOnce();

		await command(h, "sidebar on", failingCtx);
		expect(h.activeSidebar).toBeUndefined();
		expect(h.ctx.ui.notify).toHaveBeenLastCalledWith("Pi Atelier is not active in this session", "warning");
	});

	it("does not leak TODOs from a failed initialization into the next session", async () => {
		const h = harness();
		await start(h);

		const failingCtx = replacementContext(h.ctx, "Failing session");
		failingCtx.sessionManager.getBranch.mockReturnValue([
			todoBranchEntry({ todos: [{ id: 1, text: "Failure stale TODO", done: false }], nextId: 2 }),
		]);
		let failNextFooterInstall = true;
		h.setFooter.mockImplementation((footer) => {
			if (!failNextFooterInstall || typeof footer !== "function") return;
			failNextFooterInstall = false;
			throw new Error("footer install failed");
		});
		await start(h, failingCtx);

		expect(h.ctx.ui.notify).toHaveBeenCalledWith(
			"Pi Atelier could not start: footer install failed",
			"error",
		);
		expect(h.setFooter).toHaveBeenLastCalledWith(undefined);
		expect(h.activeSidebar).toBeUndefined();
		await command(h, "sidebar on", failingCtx);
		expect(h.ctx.ui.notify).toHaveBeenLastCalledWith("Pi Atelier is not active in this session", "warning");

		const recoveredCtx = replacementContext(h.ctx, "Recovered session");
		recoveredCtx.sessionManager.getBranch.mockReturnValue([]);
		await start(h, recoveredCtx);
		expect(h.getEventBusHandlerCount("rpiv:ask-user:blocked")).toBe(1);

		const recoveredSidebar = renderSidebarText(h);
		expect(recoveredSidebar).toContain("Recovered session");
		expect(recoveredSidebar).not.toContain("Failure stale TODO");
		expect(recoveredSidebar).not.toContain("TODOS");
	});

	it("cancels pending system notifications during shutdown", async () => {
		const h = harness("tui", "darwin");
		await start(h);
		h.pi.events.emit("rpiv:ask-user:blocked", { active: true });
		expect(h.spawnNotificationProcess).toHaveBeenCalledOnce();
		expect(h.notificationProcess.kill).not.toHaveBeenCalled();

		await h.dispatch("session_shutdown", { reason: "quit" });

		expect(h.notificationProcess.kill).toHaveBeenCalled();
	});

	it("stops a scheduled workspace pulse refresh after shutdown", async () => {
		vi.useFakeTimers();
		try {
			const h = harness();
			h.ctx.isProjectTrusted.mockReturnValue(true);
			await start(h);
			const timersBeforeSchedule = vi.getTimerCount();
			await h.dispatch("tool_execution_end", {
				type: "tool_execution_end",
				toolCallId: "pulse-tool",
				toolName: "write",
				result: { output: "" },
			});
			expect(vi.getTimerCount()).toBeGreaterThan(timersBeforeSchedule);
			const execCallsBeforeShutdown = h.pi.exec.mock.calls.length;

			await h.dispatch("session_shutdown", { reason: "quit" });
			expect(vi.getTimerCount()).toBe(timersBeforeSchedule);
			await vi.advanceTimersByTimeAsync(1_000);

			expect(h.pi.exec.mock.calls.length).toBe(execCallsBeforeShutdown);
		} finally {
			vi.useRealTimers();
		}
	});

	it("does not publish an in-flight workspace pulse refresh after shutdown", async () => {
		const active = harness();
		const inspected = queueWorkspacePulseInspection(active);
		await start(active);
		await inspected;
		await settleMicrotasks();
		// Positive control: a published pulse does reach the sidebar.
		expect(renderSidebarText(active)).toContain("stale-branch");
		expect(renderSidebarText(active)).toContain("1 tracked");
		await active.dispatch("session_shutdown", { reason: "quit" }, active.ctx);
		expect(active.activeSidebar).toBeUndefined();

		const discovery = deferred<ReturnType<typeof execResult>>();
		const h = harness();
		queueWorkspacePulseInspection(h, discovery.promise);
		await start(h);
		expect(h.pi.exec).toHaveBeenCalledOnce();

		await h.dispatch("session_shutdown", { reason: "quit" });
		h.sidebarRequestRender.mockClear();
		discovery.resolve(execResult("true\n/tmp/project\n"));
		await settleMicrotasks();

		expect(h.pi.exec).toHaveBeenCalledOnce();
		expect(h.sidebarRequestRender).not.toHaveBeenCalled();
	});

	it("does not publish an initializer that completes after shutdown", async () => {
		const load = deferred<void>();
		const deferredLoadConfig = vi
			.fn<typeof loadAtelierConfig>()
			.mockImplementationOnce(loadConfigAfter(load));
		const h = harness("tui", "linux", false, { loadConfig: deferredLoadConfig });

		const starting = start(h);
		expect(deferredLoadConfig).toHaveBeenCalledOnce();
		await h.dispatch("session_shutdown", { reason: "quit" });
		load.resolve(undefined);
		await starting;

		expect(h.setFooter).not.toHaveBeenCalled();
		expect(h.setSidebar).not.toHaveBeenCalled();
		expect(h.overlays).toHaveLength(0);
		await command(h, "sidebar on");
		expect(h.setSidebar).not.toHaveBeenCalled();
		expect(h.ctx.ui.notify).toHaveBeenLastCalledWith("Pi Atelier is not active in this session", "warning");
	});

	it("keeps the newer initializer authoritative when an older one completes last", async () => {
		const firstLoad = deferred<void>();
		const secondLoad = deferred<void>();
		const deferredLoadConfig = vi
			.fn<typeof loadAtelierConfig>()
			.mockImplementationOnce(loadConfigAfter(firstLoad))
			.mockImplementationOnce(loadConfigAfter(secondLoad));
		const h = harness("tui", "linux", false, { loadConfig: deferredLoadConfig });

		const firstStart = start(h);
		expect(deferredLoadConfig).toHaveBeenCalledTimes(1);
		const newerContext = replacementContext(h.ctx, "Newer");
		const secondStart = start(h, newerContext);
		expect(deferredLoadConfig).toHaveBeenCalledTimes(2);
		secondLoad.resolve(undefined);
		await secondStart;
		expect(h.activeSidebar).toBeDefined();
		expect(renderSidebarText(h, 44)).toContain("Newer");

		firstLoad.resolve(undefined);
		await firstStart;

		expect(h.activeSidebar).toBeDefined();
		expect(h.setSidebar).toHaveBeenCalledTimes(1);
		expect(renderSidebarText(h, 44)).toContain("Newer");
		expect(h.setFooter).toHaveBeenCalledTimes(1);
	});

	it("ignores stale shutdown while a newer initializer is still loading", async () => {
		const firstLoad = deferred<void>();
		const secondLoad = deferred<void>();
		const deferredLoadConfig = vi
			.fn<typeof loadAtelierConfig>()
			.mockImplementationOnce(loadConfigAfter(firstLoad))
			.mockImplementationOnce(loadConfigAfter(secondLoad));
		const h = harness("tui", "linux", false, { loadConfig: deferredLoadConfig });

		const firstStart = start(h);
		expect(deferredLoadConfig).toHaveBeenCalledTimes(1);
		const newerContext = replacementContext(h.ctx, "Newer");
		const secondStart = start(h, newerContext);
		expect(deferredLoadConfig).toHaveBeenCalledTimes(2);

		await h.dispatch("session_shutdown", { reason: "quit" });
		secondLoad.resolve(undefined);
		await secondStart;
		firstLoad.resolve(undefined);
		await firstStart;

		expect(h.activeSidebar).toBeDefined();
		expect(renderSidebarText(h)).toContain("Newer");
		expect(h.setSidebar).toHaveBeenCalledTimes(1);
	});

	it("cancels the matching in-flight initializer without tearing down the active session", async () => {
		const replacementLoad = deferred<void>();
		const deferredLoadConfig = vi
			.fn<typeof loadAtelierConfig>()
			.mockImplementationOnce(loadTestConfig)
			.mockImplementationOnce(loadConfigAfter(replacementLoad));
		const h = harness("tui", "linux", false, { loadConfig: deferredLoadConfig });
		await start(h);
		const activeFooterRender = vi.fn();
		const activeFooterFactory = h.setFooter.mock.calls[0]?.[0];
		expect(activeFooterFactory).toEqual(expect.any(Function));
		renderFooter(activeFooterFactory, activeFooterRender);
		activeFooterRender.mockClear();
		const replacementContextValue = replacementContext(h.ctx, "Cancelled replacement");
		const replacementStart = start(h, replacementContextValue);
		expect(deferredLoadConfig).toHaveBeenCalledTimes(2);

		await h.dispatch("session_shutdown", { reason: "quit" }, replacementContextValue);
		replacementLoad.resolve(undefined);
		await replacementStart;

		expect(h.activeSidebar).toBeDefined();
		expect(h.setSidebar).not.toHaveBeenCalledWith(undefined);
		expect(renderSidebarText(h)).toContain("Test session");
		await h.dispatch("session_tree", { type: "session_tree" });
		expect(activeFooterRender).toHaveBeenCalled();
	});

	it("closes the old sidebar and starts the replacement visible on session reload", async () => {
		const h = harness();
		await start(h);

		await start(h);

		expect(h.setSidebar).toHaveBeenCalledWith(undefined);
		expect(renderSidebarText(h)).toContain("Test session");
		expect(h.activeSidebar).toBeDefined();
	});

	it.each(["sidebar off", "disable", "enable"])("ignores stale session command: %s", async (args) => {
		const h = harness();
		const staleContext = h.ctx;
		await start(h, staleContext);
		const currentContext = replacementContext(h.ctx, "Replacement session");
		await start(h, currentContext);
		h.setFooter.mockClear();

		await command(h, args, staleContext);

		expect(h.activeSidebar).toBeDefined();
		expect(renderSidebarText(h)).toContain("Replacement session");
		expect(h.setFooter).not.toHaveBeenCalled();
		expect(staleContext.ui.notify).toHaveBeenLastCalledWith(
			"Pi Atelier is not active in this session",
			"warning",
		);
	});

	it("reopens by default on reload after an explicit session-scoped close", async () => {
		const h = harness();
		await start(h);
		await command(h, "sidebar off");
		expect(h.activeSidebar).toBeUndefined();

		await start(h);

		expect(renderSidebarText(h)).toContain("Test session");
		expect(h.activeSidebar).toBeDefined();
	});

	it("replaces and removes the ask-user blocked listener with the session lifecycle", async () => {
		const h = harness("tui", "darwin");
		await start(h);
		expect(h.getEventBusHandlerCount("rpiv:ask-user:blocked")).toBe(1);

		const currentCtx = replacementContext(h.ctx, "Replacement session");
		await start(h, currentCtx);
		expect(h.getEventBusHandlerCount("rpiv:ask-user:blocked")).toBe(1);
		await h.dispatch("agent_start", { type: "agent_start" }, currentCtx);

		h.pi.events.emit("rpiv:ask-user:blocked", { active: true });
		expect(h.spawnNotificationProcess).toHaveBeenCalledTimes(1);

		await h.dispatch("session_shutdown", { reason: "quit" }, currentCtx);
		expect(h.getEventBusHandlerCount("rpiv:ask-user:blocked")).toBe(0);
		h.pi.events.emit("rpiv:ask-user:blocked", { active: false });
		h.pi.events.emit("rpiv:ask-user:blocked", { active: true });
		expect(h.spawnNotificationProcess).toHaveBeenCalledTimes(1);
	});

	it("clears run activity across session reload and shutdown", async () => {
		const h = harness();
		await start(h);
		await command(h, "sidebar on");
		await h.dispatch("agent_start", { type: "agent_start" });
		await h.dispatch("turn_start", { type: "turn_start", turnIndex: 5, timestamp: 1_000 });
		await h.dispatch("tool_execution_start", {
			type: "tool_execution_start",
			toolCallId: "old-tool",
			toolName: "read",
			args: { path: "/tmp/project/old.ts" },
		});
		expect(renderSidebarText(h, 44)).toContain("old.ts");

		await start(h);
		expect(h.setSidebar).toHaveBeenCalledWith(undefined);
		await command(h, "sidebar on");
		const replacementText = renderSidebarText(h, 44);
		expect(replacementText).toContain("ACTIVITY");
		expect(replacementText).toMatch(/First token\s+—/);
		expect(replacementText).not.toContain("old.ts");

		const replacementRenderCount = h.sidebarRequestRender.mock.calls.length;
		await h.dispatch("tool_execution_end", {
			type: "tool_execution_end",
			toolCallId: "old-tool",
			toolName: "read",
			result: { content: [] },
			isError: false,
		});
		expect(h.sidebarRequestRender.mock.calls.length).toBe(replacementRenderCount);
		expect(renderSidebarText(h, 44)).not.toContain("old.ts");

		await h.dispatch("session_shutdown", { reason: "quit" });
		expect(h.activeSidebar).toBeUndefined();
		const shutdownRenderCount = h.sidebarRequestRender.mock.calls.length;
		await h.dispatch("agent_start", { type: "agent_start" });
		expect(h.sidebarRequestRender.mock.calls.length).toBe(shutdownRenderCount);
	});

	it("ignores stale activity events after a replacement session becomes active", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(1_000);
		try {
			const h = harness();
			const oldCtx = h.ctx;
			const currentCtx = replacementContext(h.ctx, "Replacement session");
			await start(h, oldCtx);
			await command(h, "sidebar on", oldCtx);

			await start(h, currentCtx);
			expect(h.setSidebar).toHaveBeenCalledWith(undefined);
			await command(h, "sidebar on", currentCtx);

			await h.dispatch("agent_start", { type: "agent_start" }, currentCtx);
			await h.dispatch("turn_start", { type: "turn_start", turnIndex: 6, timestamp: 1_000 }, currentCtx);
			await h.dispatch(
				"tool_execution_start",
				{
					type: "tool_execution_start",
					toolCallId: "current-tool",
					toolName: "bash",
					args: { command: "npm run current" },
				},
				currentCtx,
			);

			const activeRenderCount = h.sidebarRequestRender.mock.calls.length;
			const activeText = renderSidebarText(h, 44);
			expect(activeText).toContain("Replacement session");
			expect(activeText).toContain("ACTIVITY");
			expect(activeText).toContain("Turn 7");
			expect(activeText).toContain("running");
			expect(activeText).toContain("bash");
			expect(activeText).toContain("npm run current");
			expect(activeText).toContain("Working");

			await h.dispatch("agent_start", { type: "agent_start" }, oldCtx);
			await h.dispatch(
				"tool_execution_start",
				{
					type: "tool_execution_start",
					toolCallId: "stale-tool",
					toolName: "read",
					args: { path: "/tmp/project/stale.ts" },
				},
				oldCtx,
			);
			await h.dispatch("agent_end", { type: "agent_end", messages: [] }, oldCtx);

			expect(h.sidebarRequestRender.mock.calls.length).toBe(activeRenderCount);
			expect(renderSidebarText(h, 44)).toBe(activeText);
			expect(renderSidebarText(h, 44)).not.toContain("stale.ts");

			await h.dispatch(
				"tool_execution_end",
				{
					type: "tool_execution_end",
					toolCallId: "current-tool",
					toolName: "bash",
					result: { stdout: "" },
					isError: false,
				},
				currentCtx,
			);
			await h.dispatch("agent_end", { type: "agent_end", messages: [] }, currentCtx);

			expect(h.sidebarRequestRender.mock.calls.length).toBeGreaterThan(activeRenderCount);
			const settledText = renderSidebarText(h, 44);
			expect(settledText).toContain("Last run · <1s");
			expect(settledText).not.toContain("Turn 7");
			expect(settledText).not.toContain("settled");
			expect(settledText).toContain("done");
			expect(settledText).toContain("Ready");
			expect(settledText).not.toContain("stale.ts");
		} finally {
			vi.useRealTimers();
		}
	});
});

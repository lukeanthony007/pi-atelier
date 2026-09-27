import { describe, expect, it } from "vitest";
import type {
	ContributedSidebarPanelId,
	SidebarPanelContribution,
	SidebarPanelDiscoveryEvent,
	SidebarPanelEvent,
	SidebarPanelLayout,
	SidebarPanelRegisterEvent,
	SidebarPanelRole,
	SidebarPanelRow,
	SidebarPanelUnregisterEvent,
} from "../extensions/index.js";
import {
	BUILTIN_SIDEBAR_PANEL_IDS,
	isSidebarPanelContributionId,
	isSidebarPanelId,
	isSidebarPanelRequestId,
	SIDEBAR_PANEL_MAX_RAW_REQUEST_ID_CODE_UNITS,
} from "../extensions/index.js";

describe("structured sidebar contributions", () => {
	it("exports the deliberate structured contribution contract from the package entrypoint", () => {
		const contributedId: ContributedSidebarPanelId = "vendor:queue";
		const row: SidebarPanelRow = { text: "Ready", role: "ready" };
		const role: SidebarPanelRole = row.role ?? "primary";
		const contribution: SidebarPanelContribution = { id: contributedId, title: "Queue", rows: [row] };
		const register: SidebarPanelRegisterEvent = {
			version: 1,
			type: "register",
			source: "vendor",
			revision: 1,
			panel: contribution,
		};
		const unregister: SidebarPanelUnregisterEvent = {
			version: 1,
			type: "unregister",
			source: "vendor",
			revision: 2,
			id: contributedId,
		};
		const discovery: SidebarPanelDiscoveryEvent = { version: 1, type: "discover", requestId: "vendor-1" };
		const event: SidebarPanelEvent = register;
		const layout: SidebarPanelLayout = [
			{ id: "agent", visible: true },
			{ id: contributedId, visible: false },
		];
		// @ts-expect-error Built-ins are valid config IDs but not contributed IDs.
		const invalidContribution: SidebarPanelContribution = { id: "agent", title: "Agent", rows: [] };
		expect(BUILTIN_SIDEBAR_PANEL_IDS).toContain("agent");
		expect(isSidebarPanelContributionId(contributedId)).toBe(true);
		expect(isSidebarPanelContributionId("agent")).toBe(false);
		expect(isSidebarPanelId("agent")).toBe(true);
		expect(isSidebarPanelRequestId("vendor-1")).toBe(true);
		expect(SIDEBAR_PANEL_MAX_RAW_REQUEST_ID_CODE_UNITS).toBeGreaterThan(0);
	});
});

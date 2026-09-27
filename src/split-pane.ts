import { matchesKey, type TUI } from "@oh-my-pi/pi-tui";

const ENABLE_MOUSE = "\u001b[?1002h\u001b[?1006h";
const DISABLE_MOUSE = "\u001b[?1006l\u001b[?1002l";
const SGR_MOUSE = /^\u001b\[<(\d+);(\d+);(\d+)([Mm])$/;

export interface SgrMouseEvent {
	button: number;
	x: number;
	y: number;
	release: boolean;
	motion: boolean;
}

export function parseSgrMouseEvent(data: string): SgrMouseEvent | undefined {
	const match = data.match(SGR_MOUSE);
	if (!match) return undefined;
	const button = Number(match[1]);
	const x = Number(match[2]);
	const y = Number(match[3]);
	if (![button, x, y].every(Number.isFinite) || x < 1 || y < 1) return undefined;
	return { button, x, y, release: match[4] === "m", motion: (button & 32) !== 0 };
}

export const DEFAULT_SIDEBAR_WIDTH = 44;
export const MIN_SIDEBAR_WIDTH = 28;
export const MAX_SIDEBAR_WIDTH = 72;
export const MIN_MAIN_WIDTH = 64;

export interface SplitPaneControllerOptions {
	subscribeInput(handler: (data: string) => { consume?: boolean; data?: string } | undefined): () => void;
	onWidthChange(width: number): void;
	onResizeChange?(resizing: boolean): void;
	onWarning?(message: string): void;
	onError?(error: unknown): void;
}

export interface SplitPaneController {
	attach(tui: TUI): void;
	show(): void;
	hide(): void;
	setSidebarWidth(width: number): void;
	getSidebarWidth(): number;
	isEnabled(): boolean;
	isVisibleAtWidth(terminalWidth: number): boolean;
	beginResize(): boolean;
	finishResize(): void;
	cancelResize(): void;
	isResizing(): boolean;
	requestRender(): void;
	dispose(): void;
}

const clamp = (width: number): number =>
	Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, Math.trunc(width)));

export function createSplitPaneController(options: SplitPaneControllerOptions): SplitPaneController {
	let tui: TUI | undefined;
	let enabled = false;
	let disposed = false;
	let resizing = false;
	let dragging = false;
	let startWidth = DEFAULT_SIDEBAR_WIDTH;
	let sidebarWidth = DEFAULT_SIDEBAR_WIDTH;
	let unsubscribe: (() => void) | undefined;
	let mouseTerminal: TUI["terminal"] | undefined;
	const visibleAt = (columns: number) => columns >= sidebarWidth + MIN_MAIN_WIDTH;
	const requestRender = () => tui?.requestRender();
	const setWidth = (width: number) => {
		if (!Number.isFinite(width)) return;
		const next = clamp(width);
		if (next === sidebarWidth) return;
		sidebarWidth = next;
		if (enabled) options.onWidthChange(next);
		requestRender();
	};
	const stopResize = (restore: boolean) => {
		if (!resizing) return;
		resizing = false;
		dragging = false;
		const stop = unsubscribe;
		unsubscribe = undefined;
		const terminal = mouseTerminal;
		mouseTerminal = undefined;
		try {
			stop?.();
		} catch (error) {
			options.onError?.(error);
		}
		try {
			terminal?.write(DISABLE_MOUSE);
		} catch (error) {
			options.onError?.(error);
		}
		if (restore) setWidth(startWidth);
		options.onResizeChange?.(false);
		requestRender();
	};
	const input = (data: string): { consume: boolean } | undefined => {
		const mouse = parseSgrMouseEvent(data);
		if (mouse) {
			if (mouse.release) {
				if (dragging) stopResize(false);
			} else if (!mouse.motion && (mouse.button & 3) === 0 && (mouse.button & 64) === 0) {
				const dividerX = (tui?.terminal.columns ?? 0) - sidebarWidth + 1;
				if (Math.abs(mouse.x - dividerX) <= 1) dragging = true;
			} else if (mouse.motion && dragging && tui) {
				setWidth(Math.min(tui.terminal.columns - MIN_MAIN_WIDTH, tui.terminal.columns - mouse.x + 1));
			}
			return { consume: true };
		}
		if (matchesKey(data, "shift+left")) setWidth(sidebarWidth + 4);
		else if (matchesKey(data, "shift+right")) setWidth(sidebarWidth - 4);
		else if (matchesKey(data, "left")) setWidth(sidebarWidth + 1);
		else if (matchesKey(data, "right")) setWidth(sidebarWidth - 1);
		else if (matchesKey(data, "enter")) stopResize(false);
		else if (matchesKey(data, "escape")) stopResize(true);
		else return undefined;
		return { consume: true };
	};
	return {
		attach(nextTui) {
			if (!disposed) tui = nextTui;
		},
		show() {
			if (!disposed) enabled = true;
		},
		hide() {
			stopResize(true);
			enabled = false;
		},
		setSidebarWidth: setWidth,
		getSidebarWidth: () => sidebarWidth,
		isEnabled: () => enabled,
		isVisibleAtWidth: visibleAt,
		beginResize() {
			if (resizing) return true;
			if (!enabled || !tui) {
				options.onWarning?.("Atelier sidebar is not ready to resize");
				return false;
			}
			if (!visibleAt(tui.terminal.columns)) {
				options.onWarning?.("Terminal is too narrow to resize the Atelier sidebar");
				return false;
			}
			startWidth = sidebarWidth;
			resizing = true;
			try {
				unsubscribe = options.subscribeInput(input);
				mouseTerminal = tui.terminal;
				mouseTerminal.write(ENABLE_MOUSE);
				options.onResizeChange?.(true);
				requestRender();
				return true;
			} catch (error) {
				stopResize(true);
				options.onError?.(error);
				return false;
			}
		},
		finishResize: () => stopResize(false),
		cancelResize: () => stopResize(true),
		isResizing: () => resizing,
		requestRender,
		dispose() {
			if (disposed) return;
			stopResize(true);
			disposed = true;
			enabled = false;
			tui = undefined;
		},
	};
}

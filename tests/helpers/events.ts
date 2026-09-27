import { EventBus } from "@oh-my-pi/pi-coding-agent/utils/event-bus";
import { vi } from "vitest";

export function eventTransport(
	options: { throwOnEventSubscribe?: readonly string[]; throwOnEventUnsubscribe?: readonly string[] } = {},
) {
	const listeners = new Map<string, Set<(data: unknown) => void>>();
	const emitted: unknown[] = [];
	const events = new EventBus();
	const subscribe = events.on.bind(events);
	const emit = events.emit.bind(events);
	vi.spyOn(events, "on").mockImplementation((channel, handler) => {
		if (options.throwOnEventSubscribe?.includes(channel)) throw new Error(`subscribe failed: ${channel}`);
		const handlers = listeners.get(channel) ?? new Set();
		handlers.add(handler);
		listeners.set(channel, handlers);
		const unsubscribe = subscribe(channel, handler);
		return () => {
			if (options.throwOnEventUnsubscribe?.includes(channel))
				throw new Error(`unsubscribe failed: ${channel}`);
			handlers.delete(handler);
			unsubscribe();
		};
	});
	vi.spyOn(events, "emit").mockImplementation((channel, data) => {
		emitted.push(data);
		emit(channel, data);
	});
	return { events, emitted, listenerCount: (channel: string) => listeners.get(channel)?.size ?? 0 };
}

// The real OMP settings module starts the full provider and HTML export graph.
// Extension behavior tests need only its compaction setting; TUI smoke uses the real module.
export const settings = {
	get: (key: string) => key === "compaction.enabled",
};

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { defineConfig } from "vitest/config";

const agentDir = mkdtempSync(join(tmpdir(), "pi-atelier-vitest-"));
process.once("exit", () => rmSync(agentDir, { recursive: true, force: true }));

export default defineConfig({
	resolve: {
		alias: [
			{
				find: /^@oh-my-pi\/pi-coding-agent\/config\/settings$/,
				replacement: join(import.meta.dirname, "tests/helpers/omp-settings.ts"),
			},
		],
	},
	plugins: [
		{
			name: "omp-bun-assets",
			enforce: "pre",
			load(id) {
				if (!/\.(?:md|html|txt|sh)$/.test(id) || !id.includes("/node_modules/@oh-my-pi/")) return null;
				return `export default ${JSON.stringify(readFileSync(id, "utf8"))};`;
			},
			transform(source, id) {
				if (!id.includes("/node_modules/@oh-my-pi/") || !source.includes("import.meta.dir")) return null;
				return source.replaceAll("import.meta.dir", JSON.stringify(dirname(id)));
			},
		},
	],
	test: {
		// Keep each run off the developer's real ~/.pi/agent configuration and away
		// from state left by earlier runs.
		env: {
			PI_CODING_AGENT_DIR: agentDir,
		},
	},
});

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";

function repoRoot(cwd: string): string {
	try {
		return realpathSync(execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8" }).trim());
	} catch {
		return realpathSync(cwd);
	}
}

function expandHome(inputPath: string): string {
	if (inputPath === "~") return os.homedir();
	if (inputPath.startsWith("~/")) return path.join(os.homedir(), inputPath.slice(2));
	return inputPath;
}

function resolvePossiblyMissingPath(inputPath: string, cwd: string): string {
	const absolute = path.resolve(cwd, expandHome(inputPath));
	const parsed = path.parse(absolute);
	let current = absolute;
	const missingParts: string[] = [];

	while (!existsSync(current) && current !== parsed.root) {
		missingParts.unshift(path.basename(current));
		current = path.dirname(current);
	}

	const base = existsSync(current) ? realpathSync(current) : parsed.root;
	return path.normalize(path.join(base, ...missingParts));
}

function isInside(root: string, candidate: string): boolean {
	const relative = path.relative(root, candidate);
	return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function toolPaths(toolName: string, input: Record<string, unknown>): string[] {
	if (["read", "write", "edit", "grep", "find", "ls"].includes(toolName) && typeof input.path === "string") {
		return [input.path];
	}
	return [];
}

// Best-effort bash path extraction. Exact shell effect detection is not possible without sandboxing,
// but this catches common absolute paths and relative paths that escape via ../.
function bashPaths(command: string): string[] {
	const paths = new Set<string>();
	const ignoredPaths = new Set(["/dev/null"]);
	const tokenPattern = /(?:"([^"]+)"|'([^']+)'|([^\s;&|<>]+))/g;
	let match: RegExpExecArray | null;
	while ((match = tokenPattern.exec(command)) !== null) {
		let token = match[1] ?? match[2] ?? match[3] ?? "";
		if (/^[a-z]+:\/\//i.test(token)) continue;
		if (ignoredPaths.has(token)) continue;
		if (
			path.isAbsolute(token) ||
			token === "~" ||
			token.startsWith("~/") ||
			token.startsWith("../") ||
			token === ".." ||
			token.includes("/../")
		) {
			paths.add(token);
		}
	}
	return [...paths];
}

function outsidePaths(root: string, cwd: string, paths: string[]) {
	return paths
		.map((p) => ({ original: p, resolved: resolvePossiblyMissingPath(p, cwd) }))
		.filter(({ resolved }) => !isInside(root, resolved));
}

async function approveOutsidePaths(
	ctx: any,
	root: string,
	cwd: string,
	paths: string[],
	label: string,
	details?: string,
) {
	const outside = outsidePaths(root, cwd, paths);
	if (outside.length === 0) return undefined;

	const message = outside.map(({ original, resolved }) => `- ${original} -> ${resolved}`).join("\n");
	const detailsBlock = details ? `\n\n${details}` : "";
	if (!ctx.hasUI) {
		return { block: true, reason: `${label} outside repo blocked (no UI for approval):${detailsBlock}\n\n${message}` };
	}

	const ok = await ctx.ui.confirm(
		"Outside repo access",
		`${label} wants to access path(s) outside the repo root:${detailsBlock}\n\nRepo: ${root}\n\n${message}\n\nAllow this tool call?`,
	);

	if (!ok) return { block: true, reason: `Blocked outside repo access:${detailsBlock}\n\n${message}` };
	return undefined;
}

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event, ctx) => {
		const root = repoRoot(ctx.cwd);

		if (event.toolName === "bash") {
			const command = String((event.input as Record<string, unknown>).command ?? "");
			return approveOutsidePaths(ctx, root, ctx.cwd, bashPaths(command), "bash", `Command:\n${command}`);
		}

		return approveOutsidePaths(
			ctx,
			root,
			ctx.cwd,
			toolPaths(event.toolName, event.input as Record<string, unknown>),
			event.toolName,
		);
	});

	pi.on("user_bash", async (event, ctx) => {
		const root = repoRoot(event.cwd);
		const outside = outsidePaths(root, event.cwd, bashPaths(event.command));
		if (outside.length === 0) return undefined;

		const message = outside.map(({ original, resolved }) => `- ${original} -> ${resolved}`).join("\n");
		const commandBlock = `Command:\n${event.command}`;
		if (!ctx.hasUI) {
			return {
				result: {
					output: `user bash outside repo blocked (no UI for approval):\n\n${commandBlock}\n\n${message}`,
					exitCode: 1,
					cancelled: false,
					truncated: false,
				},
			};
		}

		const ok = await ctx.ui.confirm(
			"Outside repo access",
			`user bash wants to access path(s) outside the repo root:\n\n${commandBlock}\n\nRepo: ${root}\n\n${message}\n\nAllow this command?`,
		);
		if (ok) return undefined;

		return {
			result: {
				output: `Blocked outside repo access:\n\n${commandBlock}\n\n${message}`,
				exitCode: 1,
				cancelled: false,
				truncated: false,
			},
		};
	});
}

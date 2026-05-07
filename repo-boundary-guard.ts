import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
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

function approvalLogPath(): string {
	return path.join(os.homedir(), ".pi", "agent", "repo-boundary-guard-approvals.jsonl");
}

function approvalKey(toolName: string, resolvedPath: string): string {
	return `${toolName}\0${path.normalize(resolvedPath)}`;
}

function readRememberedApprovals(): Set<string> {
	try {
		const approvals = new Set<string>();
		const log = readFileSync(approvalLogPath(), "utf8");
		for (const line of log.split("\n")) {
			if (!line.trim()) continue;
			try {
				const entry = JSON.parse(line) as { toolName?: unknown; label?: unknown; resolved?: unknown };
				const toolName = typeof entry.toolName === "string" ? entry.toolName : entry.label;
				if (typeof toolName === "string" && typeof entry.resolved === "string") {
					approvals.add(approvalKey(toolName, entry.resolved));
				}
			} catch {
				// Ignore malformed log entries so a bad line does not disable the guard.
			}
		}
		return approvals;
	} catch {
		return new Set();
	}
}

function rememberApprovals(root: string, toolName: string, outside: Array<{ original: string; resolved: string }>, details?: string) {
	const logPath = approvalLogPath();
	mkdirSync(path.dirname(logPath), { recursive: true });
	const timestamp = new Date().toISOString();
	const lines = outside.map(({ original, resolved }) =>
		JSON.stringify({ timestamp, repoRoot: root, toolName, original, resolved: path.normalize(resolved), details })
	);
	appendFileSync(logPath, `${lines.join("\n")}\n`, "utf8");
}

function filterRememberedOutsidePaths(toolName: string, outside: Array<{ original: string; resolved: string }>) {
	const remembered = readRememberedApprovals();
	return outside.filter(({ resolved }) => !remembered.has(approvalKey(toolName, resolved)));
}

function formatOutsideAccess(toolName: string, root: string, outside: Array<{ original: string; resolved: string }>, details?: string) {
	const files = outside
		.map(({ original, resolved }) => `- File: ${original}\n  Resolved: ${resolved}`)
		.join("\n");
	const detailsBlock = details ? `\n\n${details}` : "";
	return `Tool: ${toolName}${detailsBlock}\n\nRepo: ${root}\n\nOutside repo file(s):\n${files}`;
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
	const outside = filterRememberedOutsidePaths(label, outsidePaths(root, cwd, paths));
	if (outside.length === 0) return undefined;

	const message = formatOutsideAccess(label, root, outside, details);
	if (!ctx.hasUI) {
		return { block: true, reason: `Outside repo access blocked (no UI for approval):\n\n${message}` };
	}

	const choice = await ctx.ui.select(
		`Outside repo access requested:\n\n${message}`,
		[
			"Allow and remember globally",
			"Allow once",
			"Block",
		],
	);

	if (choice === "Allow and remember globally") {
		rememberApprovals(root, label, outside, details);
		return undefined;
	}
	if (choice === "Allow once") return undefined;
	return { block: true, reason: `Blocked outside repo access:\n\n${message}` };
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
		const outside = filterRememberedOutsidePaths("user_bash", outsidePaths(root, event.cwd, bashPaths(event.command)));
		if (outside.length === 0) return undefined;

		const commandBlock = `Command:\n${event.command}`;
		const message = formatOutsideAccess("user_bash", root, outside, commandBlock);
		if (!ctx.hasUI) {
			return {
				result: {
					output: `Outside repo access blocked (no UI for approval):\n\n${message}`,
					exitCode: 1,
					cancelled: false,
					truncated: false,
				},
			};
		}

		const choice = await ctx.ui.select(
			`Outside repo access requested:\n\n${message}`,
			[
				"Allow and remember globally",
				"Allow once",
				"Block",
			],
		);
		if (choice === "Allow and remember globally") {
			rememberApprovals(root, "user_bash", outside, commandBlock);
			return undefined;
		}
		if (choice === "Allow once") return undefined;

		return {
			result: {
				output: `Blocked outside repo access:\n\n${message}`,
				exitCode: 1,
				cancelled: false,
				truncated: false,
			},
		};
	});
}

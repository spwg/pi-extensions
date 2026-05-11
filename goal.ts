import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, TextContent } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

const COMPLETION_TOKEN = "</objective_complete>";
const STATE_ENTRY_TYPE = "goal-state";

type GoalState = {
	active: boolean;
	objective: string;
	turns: number;
	startedAt: number;
	completedAt?: number;
};

function isAssistantMessage(message: AgentMessage): message is AssistantMessage {
	return message.role === "assistant" && Array.isArray(message.content);
}

function getTextContent(message: AssistantMessage): string {
	return message.content
		.filter((block): block is TextContent => block.type === "text")
		.map((block) => block.text)
		.join("\n");
}

function sendUserMessage(pi: ExtensionAPI, ctx: ExtensionContext, text: string): void {
	if (ctx.isIdle()) {
		pi.sendUserMessage(text);
	} else {
		pi.sendUserMessage(text, { deliverAs: "followUp" });
	}
}

export default function goalExtension(pi: ExtensionAPI): void {
	let state: GoalState = {
		active: false,
		objective: "",
		turns: 0,
		startedAt: 0,
	};

	function persistState(): void {
		pi.appendEntry(STATE_ENTRY_TYPE, { ...state });
	}

	function setStatus(ctx: ExtensionContext): void {
		if (!ctx.hasUI) return;

		if (!state.active) {
			ctx.ui.setStatus("goal", undefined);
			ctx.ui.setWidget("goal", undefined);
			return;
		}

		ctx.ui.setStatus("goal", ctx.ui.theme.fg("accent", `🎯 goal:${state.turns}`));
		ctx.ui.setWidget("goal", [
			ctx.ui.theme.fg("accent", "🎯 Objective active"),
			ctx.ui.theme.fg("muted", state.objective),
			ctx.ui.theme.fg("dim", `Agent will continue until it emits ${COMPLETION_TOKEN}`),
		]);
	}

	function startGoal(objective: string, ctx: ExtensionContext): void {
		state = {
			active: true,
			objective,
			turns: 0,
			startedAt: Date.now(),
		};
		persistState();
		pi.setSessionName(`Goal: ${objective.slice(0, 80)}`);
		setStatus(ctx);
		sendUserMessage(
			pi,
			ctx,
			`Objective mode is active. Your objective is:\n\n${objective}\n\nWork autonomously until the objective is complete. Only when the objective is fully complete, include the exact token ${COMPLETION_TOKEN} in your final response.`,
		);
	}

	function stopGoal(ctx: ExtensionContext, reason = "Goal stopped."): void {
		state = { active: false, objective: "", turns: 0, startedAt: 0 };
		persistState();
		setStatus(ctx);
		ctx.ui.notify(reason, "info");
	}

	pi.registerCommand("goal", {
		description: `Set an objective and keep the agent working until it emits ${COMPLETION_TOKEN}`,
		handler: async (args, ctx) => {
			const trimmed = args.trim();

			if (trimmed === "status") {
				if (!state.active) {
					ctx.ui.notify("No active goal.", "info");
					return;
				}
				ctx.ui.notify(`Active goal (${state.turns} turn(s)):\n${state.objective}`, "info");
				return;
			}

			if (["stop", "clear", "cancel", "done"].includes(trimmed)) {
				stopGoal(ctx);
				return;
			}

			if (!trimmed) {
				ctx.ui.notify(
					`Usage: /goal <objective>\n       /goal status\n       /goal stop\n\nCompletion token: ${COMPLETION_TOKEN}`,
					"info",
				);
				return;
			}

			startGoal(trimmed, ctx);
		},
	});

	pi.on("before_agent_start", async (event) => {
		if (!state.active) return undefined;

		return {
			systemPrompt:
				event.systemPrompt +
				`\n\nOBJECTIVE MODE IS ACTIVE.\nCurrent objective:\n${state.objective}\n\nRules:\n- Keep working autonomously toward the objective.\n- Do not stop just because you made partial progress.\n- If blocked, diagnose, inspect files, run commands, fix issues, and verify.\n- Do not ask the user to continue unless you genuinely need missing information.\n- Only when the objective is fully complete, include the exact token ${COMPLETION_TOKEN} in your final assistant message.\n- Never include ${COMPLETION_TOKEN} unless the objective is complete.`,
			message: {
				customType: "goal-context",
				content: `[OBJECTIVE MODE]\nObjective: ${state.objective}\nTurns attempted: ${state.turns}\nCompletion token: ${COMPLETION_TOKEN}`,
				display: false,
			},
		};
	});

	pi.on("agent_end", async (event, ctx) => {
		if (!state.active) return;

		const lastAssistant = [...event.messages].reverse().find((message): message is AssistantMessage =>
			isAssistantMessage(message as AgentMessage),
		);
		const text = lastAssistant ? getTextContent(lastAssistant) : "";

		if (text.includes(COMPLETION_TOKEN)) {
			state = {
				...state,
				active: false,
				completedAt: Date.now(),
			};
			persistState();
			setStatus(ctx);
			ctx.ui.notify("Objective complete.", "info");
			return;
		}

		state = { ...state, turns: state.turns + 1 };
		persistState();
		setStatus(ctx);

		sendUserMessage(
			pi,
			ctx,
			`Continue working on the active objective until complete.\n\nObjective:\n${state.objective}\n\nYou did not emit ${COMPLETION_TOKEN}, so the objective is not complete yet. Take the next concrete action now.`,
		);
	});

	pi.on("session_start", async (_event, ctx) => {
		const latest = ctx.sessionManager
			.getBranch()
			.filter((entry: { type: string; customType?: string }) => entry.type === "custom" && entry.customType === STATE_ENTRY_TYPE)
			.pop() as { data?: GoalState } | undefined;

		if (latest?.data) {
			state = latest.data;
		}

		setStatus(ctx);
	});
}

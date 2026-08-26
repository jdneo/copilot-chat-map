import assert from "node:assert/strict";
import test from "node:test";

import { groupTurns } from "../extensions/chat-fork-map/transcript.mjs";

test("groups a completed user and Copilot exchange into one Turn Node", () => {
    const events = [
        {
            id: "11111111-1111-4111-8111-111111111111",
            type: "user.message",
            data: { content: "请解释这个错误", source: "user" },
        },
        {
            id: "22222222-2222-4222-8222-222222222222",
            type: "assistant.turn_start",
            data: { turnId: "turn-1" },
        },
        {
            id: "33333333-3333-4333-8333-333333333333",
            type: "assistant.message",
            data: { content: "这是类型不匹配。", messageId: "message-1" },
        },
        {
            id: "44444444-4444-4444-8444-444444444444",
            type: "assistant.turn_end",
            data: { turnId: "turn-1" },
        },
    ];

    assert.deepEqual(groupTurns(events), [
        {
            id: "11111111-1111-4111-8111-111111111111",
            userEventId: "11111111-1111-4111-8111-111111111111",
            assistantEventId: "33333333-3333-4333-8333-333333333333",
            toEventId: null,
            userContent: "请解释这个错误",
            assistantContent: "这是类型不匹配。",
            status: "completed",
            executionDetails: [],
        },
    ]);
});

test("keeps ephemeral, subagent, and injected events out of top-level turns", () => {
    const events = [
        {
            id: "11111111-1111-4111-8111-111111111111",
            type: "user.message",
            data: { content: "Visible prompt", delivery: "idle" },
        },
        {
            id: "22222222-2222-4222-8222-222222222222",
            type: "user.message",
            ephemeral: true,
            data: { content: "Transient prompt" },
        },
        {
            id: "33333333-3333-4333-8333-333333333333",
            type: "user.message",
            agentId: "research-agent",
            data: { content: "Subagent prompt" },
        },
        {
            id: "44444444-4444-4444-8444-444444444444",
            type: "user.message",
            data: { content: "Injected skill context", source: "skill-tdd" },
        },
        {
            id: "55555555-5555-4555-8555-555555555555",
            type: "assistant.message",
            agentId: "research-agent",
            data: { content: "Subagent response", messageId: "message-1" },
        },
        {
            id: "66666666-6666-4666-8666-666666666666",
            type: "assistant.message",
            data: { content: "Visible response", messageId: "message-2" },
        },
        {
            id: "77777777-7777-4777-8777-777777777777",
            type: "assistant.turn_end",
            data: { turnId: "turn-1" },
        },
    ];

    const turns = groupTurns(events);

    assert.equal(turns.length, 1);
    assert.equal(turns[0].userContent, "Visible prompt");
    assert.equal(turns[0].assistantContent, "Visible response");
});

test("keeps an attachment-only host context in the active Turn Node", () => {
    const events = [
        {
            id: "11111111-1111-4111-8111-111111111111",
            type: "user.message",
            data: {
                content:
                    "Fit all shrinks this map even though there is room.",
                source: "user",
            },
        },
        {
            id: "22222222-2222-4222-8222-222222222222",
            type: "abort",
            data: { reason: "Waiting for user input" },
        },
        {
            id: "33333333-3333-4333-8333-333333333333",
            type: "user.message",
            data: {
                content: [
                    "<canvas-context>",
                    '- name="extension:chat-fork-map-current"',
                    "</canvas-context>",
                    "<system_notification>",
                    "Host-only instructions",
                    "</system_notification>",
                ].join("\n"),
                attachments: [{ displayName: "Screenshot", type: "file" }],
            },
        },
        {
            id: "44444444-4444-4444-8444-444444444444",
            type: "assistant.message",
            data: { content: "Fixed the Fit all measurement." },
        },
        {
            id: "55555555-5555-4555-8555-555555555555",
            type: "assistant.turn_end",
            data: { turnId: "turn-1" },
        },
    ];

    assert.deepEqual(groupTurns(events), [
        {
            id: "11111111-1111-4111-8111-111111111111",
            userEventId: "11111111-1111-4111-8111-111111111111",
            assistantEventId: "44444444-4444-4444-8444-444444444444",
            toEventId: null,
            userContent:
                "Fit all shrinks this map even though there is room.",
            assistantContent: "Fixed the Fit all measurement.",
            status: "completed",
            executionDetails: [],
        },
    ]);
});

test("owns tool, permission, and subagent activity as execution details of the visible turn", () => {
    const events = [
        {
            id: "11111111-1111-4111-8111-111111111111",
            type: "user.message",
            data: { content: "Inspect the project", source: "user" },
        },
        {
            id: "22222222-2222-4222-8222-222222222222",
            type: "assistant.message",
            data: {
                content: "I am checking the files.",
                toolRequests: [{ toolCallId: "tool-1", name: "view" }],
            },
        },
        {
            id: "33333333-3333-4333-8333-333333333333",
            type: "tool.execution_start",
            data: { toolCallId: "tool-1", name: "view" },
        },
        {
            id: "44444444-4444-4444-8444-444444444444",
            type: "permission.requested",
            data: { toolCallId: "tool-1", permission: "read" },
        },
        {
            id: "55555555-5555-4555-8555-555555555555",
            type: "tool.execution_complete",
            data: { toolCallId: "tool-1", result: "renderer.mjs" },
        },
        {
            id: "66666666-6666-4666-8666-666666666666",
            type: "assistant.message",
            agentId: "research-agent",
            data: { content: "Subagent finding" },
        },
        {
            id: "77777777-7777-4777-8777-777777777777",
            type: "assistant.message",
            data: { content: "The project is ready." },
        },
        {
            id: "88888888-8888-4888-8888-888888888888",
            type: "assistant.turn_end",
            data: { turnId: "turn-1" },
        },
    ];

    const [turn] = groupTurns(events);

    assert.equal(turn.assistantContent, "The project is ready.");
    assert.deepEqual(
        turn.executionDetails.map(({ id, type }) => ({ id, type })),
        [
            {
                id: "22222222-2222-4222-8222-222222222222",
                type: "assistant.message",
            },
            {
                id: "33333333-3333-4333-8333-333333333333",
                type: "tool.execution_start",
            },
            {
                id: "44444444-4444-4444-8444-444444444444",
                type: "permission.requested",
            },
            {
                id: "55555555-5555-4555-8555-555555555555",
                type: "tool.execution_complete",
            },
            {
                id: "66666666-6666-4666-8666-666666666666",
                type: "assistant.message",
            },
        ],
    );
});

test("keeps delayed tool results with the turn that requested the tool", () => {
    const events = [
        {
            id: "11111111-1111-4111-8111-111111111111",
            type: "user.message",
            data: { content: "Inspect the project", source: "user" },
        },
        {
            id: "22222222-2222-4222-8222-222222222222",
            type: "assistant.message",
            data: {
                content: "Checking.",
                toolRequests: [{ toolCallId: "tool-1", name: "view" }],
            },
        },
        {
            id: "33333333-3333-4333-8333-333333333333",
            type: "assistant.message",
            data: { content: "Inspection started." },
        },
        {
            id: "44444444-4444-4444-8444-444444444444",
            type: "assistant.turn_end",
            data: { turnId: "turn-1" },
        },
        {
            id: "55555555-5555-4555-8555-555555555555",
            type: "user.message",
            data: { content: "Continue", source: "user" },
        },
        {
            id: "66666666-6666-4666-8666-666666666666",
            type: "tool.execution_complete",
            data: { toolCallId: "tool-1", result: "renderer.mjs" },
        },
    ];

    const turns = groupTurns(events);

    assert.deepEqual(
        turns[0].executionDetails.map(({ id }) => id),
        [
            "22222222-2222-4222-8222-222222222222",
            "66666666-6666-4666-8666-666666666666",
        ],
    );
    assert.deepEqual(turns[1].executionDetails, []);
});

test("marks a turn without a final Copilot response as incomplete", () => {
    const events = [
        {
            id: "11111111-1111-4111-8111-111111111111",
            type: "user.message",
            data: { content: "Run the check", delivery: "idle" },
        },
        {
            id: "22222222-2222-4222-8222-222222222222",
            type: "assistant.message",
            data: {
                content: "",
                messageId: "tool-request",
                toolRequests: [{ toolCallId: "tool-1", name: "shell" }],
            },
        },
        {
            id: "33333333-3333-4333-8333-333333333333",
            type: "assistant.turn_end",
            data: { turnId: "turn-1" },
        },
    ];

    assert.deepEqual(groupTurns(events), [
        {
            id: "11111111-1111-4111-8111-111111111111",
            userEventId: "11111111-1111-4111-8111-111111111111",
            assistantEventId: null,
            toEventId: null,
            userContent: "Run the check",
            assistantContent: "",
            status: "incomplete",
            executionDetails: [
                {
                    id: "22222222-2222-4222-8222-222222222222",
                    type: "assistant.message",
                    data: {
                        content: "",
                        messageId: "tool-request",
                        toolRequests: [
                            { toolCallId: "tool-1", name: "shell" },
                        ],
                    },
                },
            ],
        },
    ]);
});

test("does not treat a tool-request preamble as the final Copilot response", () => {
    const events = [
        {
            id: "11111111-1111-4111-8111-111111111111",
            type: "user.message",
            data: { content: "Inspect the project", delivery: "idle" },
        },
        {
            id: "22222222-2222-4222-8222-222222222222",
            type: "assistant.message",
            data: {
                content: "I'm inspecting the relevant files now.",
                messageId: "preamble",
                toolRequests: [{ toolCallId: "tool-1", name: "view" }],
            },
        },
        {
            id: "33333333-3333-4333-8333-333333333333",
            type: "assistant.turn_end",
            data: { turnId: "turn-1" },
        },
    ];

    const [turn] = groupTurns(events);

    assert.equal(turn.assistantEventId, null);
    assert.equal(turn.assistantContent, "");
    assert.equal(turn.status, "incomplete");
});

test("keeps the latest Turn Node incomplete while the session is processing", () => {
    const events = [
        {
            id: "11111111-1111-4111-8111-111111111111",
            type: "user.message",
            data: { content: "Keep working", delivery: "idle" },
        },
        {
            id: "22222222-2222-4222-8222-222222222222",
            type: "assistant.message",
            data: { content: "Interim response", messageId: "message-1" },
        },
        {
            id: "33333333-3333-4333-8333-333333333333",
            type: "assistant.turn_end",
            data: { turnId: "turn-1" },
        },
    ];

    const [turn] = groupTurns(events, { isProcessing: true });

    assert.equal(turn.status, "incomplete");
});

test("uses the next visible user event as the exclusive fork boundary", () => {
    const events = [
        {
            id: "11111111-1111-4111-8111-111111111111",
            type: "user.message",
            data: { content: "First", source: "user" },
        },
        {
            id: "22222222-2222-4222-8222-222222222222",
            type: "assistant.message",
            data: { content: "First response" },
        },
        {
            id: "33333333-3333-4333-8333-333333333333",
            type: "assistant.turn_end",
            data: { turnId: "turn-1" },
        },
        {
            id: "44444444-4444-4444-8444-444444444444",
            type: "user.message",
            data: { content: "Injected", source: "skill-context" },
        },
        {
            id: "55555555-5555-4555-8555-555555555555",
            type: "user.message",
            data: { content: "Second", source: "user" },
        },
    ];

    const turns = groupTurns(events);

    assert.equal(
        turns[0].toEventId,
        "55555555-5555-4555-8555-555555555555",
    );
    assert.equal(turns[1].toEventId, null);
});

test("keeps an aborted turn unavailable as a Fork Checkpoint", () => {
    const events = [
        {
            id: "11111111-1111-4111-8111-111111111111",
            type: "user.message",
            data: { content: "Stop if this takes too long", source: "user" },
        },
        {
            id: "22222222-2222-4222-8222-222222222222",
            type: "assistant.message",
            data: { content: "Partial final-looking response" },
        },
        {
            id: "33333333-3333-4333-8333-333333333333",
            type: "abort",
            data: { reason: "user_initiated" },
        },
        {
            id: "44444444-4444-4444-8444-444444444444",
            type: "assistant.turn_end",
            data: { turnId: "turn-1" },
        },
    ];

    const [turn] = groupTurns(events);

    assert.equal(turn.status, "incomplete");
});

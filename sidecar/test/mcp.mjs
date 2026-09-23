#!/usr/bin/env node
/*
 * VesktopClaudeBridge
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Exercises the MCP boundary for scheduled events without a live Discord
 * account: the tool must be discoverable, read-only, correctly formatted, and
 * still subject to the configured guild allowlist.
 */

import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createMcpServer } from "../dist/mcp.js";

const event = {
    id: "7001",
    guildId: "1000",
    name: "Weekly meeting",
    description: "Agenda",
    startTime: "2026-10-01T20:00:00.000Z",
    endTime: "2026-10-01T21:00:00.000Z",
    status: "SCHEDULED",
    statusCode: 1,
    entityType: 3,
    channelId: null,
    channelName: null,
    location: "Voice room",
    recurrenceRule: {
        start: "2026-10-01T20:00:00.000Z",
        end: null,
        frequency: 2,
        interval: 1,
        byWeekday: [2],
        byNWeekday: null,
        byMonth: null,
        byMonthDay: null,
        byYearDay: null,
        count: null
    },
    url: "https://discord.com/events/1000/7001"
};

let calls = 0;
const bridge = {
    async call(method, params) {
        assert.equal(method, "scheduledEvents");
        calls++;
        if (params.guildId !== event.guildId) return { events: [] };
        return { events: [event] };
    }
};
const cfg = {
    allowGuilds: [],
    allowDms: [],
    denyDms: true,
    pseudonymize: false,
    defaultLimit: 50,
    maxLimit: 200,
    truncateAt: 4000,
    timezone: "UTC"
};

const server = createMcpServer(bridge, cfg, "test");
const client = new Client({ name: "vencord-mcp-test", version: "1.0.0" }, { capabilities: {} });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const { tools } = await client.listTools();
    const tool = tools.find(item => item.name === "discord_scheduled_events");
    assert.ok(tool, "scheduled event tool is discoverable");
    assert.equal(tool.annotations?.readOnlyHint, true, "scheduled event tool is marked read-only");
    console.log("ok   MCP discovery marks discord_scheduled_events read-only");

    const result = await client.callTool({
        name: "discord_scheduled_events",
        arguments: { guildId: event.guildId }
    });
    const rendered = result.content[0].text;
    assert.match(rendered, /Weekly meeting/);
    assert.match(rendered, /Start: Oct 1, 2026, 8:00 p\.m\. \(UTC\)/);
    assert.match(rendered, /Status: SCHEDULED/);
    assert.match(rendered, /Location\/channel: Voice room/);
    assert.match(rendered, /Recurrence: .*"byWeekday":\[2\]/);
    assert.match(rendered, /https:\/\/discord\.com\/events\/1000\/7001/);
    assert.match(rendered, /Description: Agenda/);
    console.log("ok   MCP scheduled event output includes time, status, location, recurrence, link, and description");

    cfg.allowGuilds = [event.guildId];
    const callsBeforeDeniedRead = calls;
    const denied = await client.callTool({
        name: "discord_scheduled_events",
        arguments: { guildId: "2000" }
    });
    assert.equal(denied.isError, true);
    assert.match(denied.content[0].text, /allowlisted/);
    assert.equal(calls, callsBeforeDeniedRead, "disallowed guild is refused before reaching the bridge");
    console.log("ok   guild allowlist refuses an event read before it reaches the plugin");
} finally {
    await client.close();
    await server.close();
}

import { describe, expect, test } from "vitest";

import { FakeGateway } from "./fake-gateway.ts";
import { defined } from "./payloads.ts";

const opts = { color: 0, mentionable: false };

async function stack(gw: FakeGateway) {
  // member5, tpl4, zelda3, other2, apex1
  const ids: Record<string, string> = {};
  for (const name of ["member", "tpl", "zelda", "other", "apex"]) {
    ids[name] = (await gw.createRole({ name, ...opts }, "t")).id;
  }
  const pos = () =>
    Object.fromEntries(Object.entries(ids).map(([k, id]) => [k, gw.role(id)?.position]));
  return { ids, pos };
}

describe("FakeGateway", () => {
  test("createRole puts the new role at position 1 and shifts others up", async () => {
    const gw = new FakeGateway({});
    const a = await gw.createRole({ name: "a", ...opts }, "t");
    expect(a.position).toBe(1);
    const b = await gw.createRole({ name: "b", ...opts }, "t");
    expect(b.position).toBe(1);
    expect(gw.role(a.id)?.position).toBe(2);
    expect(gw.role(gw.guildId)?.position).toBe(0);
    expect(gw.calls.map((c) => c.method)).toEqual(["createRole", "createRole"]);
  });

  test("createRole shifts the bot's own top role up with the others", async () => {
    const gw = new FakeGateway({});
    gw.setBotTopPosition(5);
    await gw.createRole({ name: "a", ...opts }, "t");
    await gw.createRole({ name: "b", ...opts }, "t");
    expect(gw.botTopRolePosition()).toBe(7);
  });

  test("deleteRole of a role below the bot moves the bot's top role down", async () => {
    const gw = new FakeGateway({});
    gw.setBotTopPosition(5);
    const a = await gw.createRole({ name: "a", ...opts }, "t");
    expect(gw.botTopRolePosition()).toBe(6);
    await gw.deleteRole(a.id, "t");
    expect(gw.botTopRolePosition()).toBe(5);
  });

  test("deleteRole shifts roles above it down and keeps the bot gap", async () => {
    const gw = new FakeGateway({});
    gw.addRole({ id: "t", name: "template", position: 10, color: 0, mentionable: false });
    gw.setBotTopPosition(15);
    const a = await gw.createRole({ name: "a", ...opts }, "t");
    const b = await gw.createRole({ name: "b", ...opts }, "t");
    const tBefore = defined(gw.role("t")).position;
    const aBefore = defined(gw.role(a.id)).position;
    const gap = gw.botTopRolePosition() - tBefore;
    await gw.deleteRole(b.id, "t");
    expect(defined(gw.role("t")).position).toBe(tBefore - 1);
    expect(defined(gw.role(a.id)).position).toBe(aBefore - 1);
    expect(gw.botTopRolePosition() - defined(gw.role("t")).position).toBe(gap);
    expect(defined(gw.role(gw.guildId)).position).toBe(0);
  });

  test("deleteRole leaves roles below it unchanged", async () => {
    const gw = new FakeGateway({});
    const a = await gw.createRole({ name: "a", ...opts }, "t");
    const b = await gw.createRole({ name: "b", ...opts }, "t");
    const aPos = defined(gw.role(a.id)).position;
    await gw.deleteRole(a.id, "t");
    expect(defined(gw.role(b.id)).position).toBe(1);
    expect(aPos).toBe(2);
  });

  test("deleteRole removes it from every member", async () => {
    const gw = new FakeGateway({});
    const r = await gw.createRole({ name: "r", ...opts }, "t");
    gw.addMember("100000000000000001", [r.id]);
    gw.addMember("100000000000000002", [r.id]);
    await gw.deleteRole(r.id, "t");
    expect(gw.role(r.id)).toBeUndefined();
    expect(gw.memberRoleIds("100000000000000001").has(r.id)).toBe(false);
    expect(gw.memberRoleIds("100000000000000002").has(r.id)).toBe(false);
    expect(gw.roleMemberIds(r.id)).toEqual([]);
  });

  test("setRolePositions up move places the mover exactly", async () => {
    const gw = new FakeGateway({});
    const { ids, pos } = await stack(gw);
    await gw.setRolePositions([{ id: defined(ids.apex), position: 4 }], "t");
    expect(pos()).toEqual({ member: 5, tpl: 3, zelda: 2, other: 1, apex: 4 });
    expect(gw.role(gw.guildId)?.position).toBe(0);
  });

  test("setRolePositions down move places the mover exactly", async () => {
    const gw = new FakeGateway({});
    const { ids, pos } = await stack(gw);
    await gw.setRolePositions([{ id: defined(ids.member), position: 2 }], "t");
    expect(pos()).toEqual({ member: 2, tpl: 5, zelda: 4, other: 3, apex: 1 });
  });

  test("setRolePositions batch places every mover exactly", async () => {
    const gw = new FakeGateway({});
    const { ids, pos } = await stack(gw);
    await gw.setRolePositions(
      [
        { id: defined(ids.apex), position: 3 },
        { id: defined(ids.zelda), position: 2 },
      ],
      "t",
    );
    expect(pos()).toEqual({ member: 5, tpl: 4, apex: 3, zelda: 2, other: 1 });
    const positions = gw.roles().map((r) => r.position);
    expect(new Set(positions).size).toBe(positions.length);
  });

  test("send rejects for an unknown channel without recording it, and records attachments", async () => {
    const gw = new FakeGateway({});
    await expect(gw.send("100000000000000404", { content: "x" })).rejects.toThrow(
      "Unknown channel",
    );
    expect(gw.calls).toEqual([]);
    gw.addChannel("100000000000000010");
    await gw.send("100000000000000010", { files: [{ attachment: Buffer.from("x"), name: "a" }] });
    expect(gw.messages.get("100000000000000010")?.[0]?.hasAttachment).toBe(true);
  });
});

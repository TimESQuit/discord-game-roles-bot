import { describe, expect, test } from "vitest";
import { FakeGateway } from "./fake-gateway.ts";

const opts = { color: 0, mentionable: false };

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

  test("edit of a deleted message returns false", async () => {
    const gw = new FakeGateway({});
    gw.addChannel("100000000000000010");
    const id = await gw.send("100000000000000010", { content: "hi" });
    expect(await gw.edit("100000000000000010", id, { content: "yo" })).toBe(true);
    expect(gw.messages.get("100000000000000010")?.[0]?.payload.content).toBe("yo");
    gw.deleteMessageBehindBotsBack("100000000000000010", id);
    expect(await gw.edit("100000000000000010", id, { content: "again" })).toBe(false);
  });

  test("failNext makes the next call to that method reject once", async () => {
    const gw = new FakeGateway({});
    gw.failNext("createRole", new Error("boom"));
    await expect(gw.createRole({ name: "x", ...opts }, "t")).rejects.toThrow("boom");
    expect(gw.roles()).toHaveLength(1);
    const r = await gw.createRole({ name: "x", ...opts }, "t");
    expect(r.name).toBe("x");
  });

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

  test("setRolePositions up move places the mover exactly", async () => {
    const gw = new FakeGateway({});
    const { ids, pos } = await stack(gw);
    await gw.setRolePositions([{ id: ids.apex!, position: 4 }], "t");
    expect(pos()).toEqual({ member: 5, tpl: 3, zelda: 2, other: 1, apex: 4 });
    expect(gw.role(gw.guildId)?.position).toBe(0);
  });

  test("setRolePositions down move places the mover exactly", async () => {
    const gw = new FakeGateway({});
    const { ids, pos } = await stack(gw);
    await gw.setRolePositions([{ id: ids.member!, position: 2 }], "t");
    expect(pos()).toEqual({ member: 2, tpl: 5, zelda: 4, other: 3, apex: 1 });
  });

  test("setRolePositions batch places every mover exactly", async () => {
    const gw = new FakeGateway({});
    const { ids, pos } = await stack(gw);
    await gw.setRolePositions(
      [
        { id: ids.apex!, position: 3 },
        { id: ids.zelda!, position: 2 },
      ],
      "t",
    );
    expect(pos()).toEqual({ member: 5, tpl: 4, apex: 3, zelda: 2, other: 1 });
    const positions = gw.roles().map((r) => r.position);
    expect(new Set(positions).size).toBe(positions.length);
  });

  test("missingBotPermissions filters the configured list to required", () => {
    const gw = new FakeGateway({});
    gw.setMissingPermissions(["ManageRoles", "ManageChannels"]);
    expect(gw.missingBotPermissions(["ManageRoles", "SendMessages"])).toEqual(["ManageRoles"]);
  });

  test("created categories and channels exist and accept messages", async () => {
    const gw = new FakeGateway({});
    const cat = await gw.createCategory("c", []);
    const ch = await gw.createTextChannel("t", cat, []);
    expect(gw.channelExists(cat)).toBe(true);
    expect(gw.channelExists(ch)).toBe(true);
    await gw.send(ch, { content: "x" });
    expect(gw.messages.get(ch)).toHaveLength(1);
  });

  test("ownMessages returns newest first and respects the limit", async () => {
    const gw = new FakeGateway({});
    const ch = "100000000000000010";
    const old = gw.addOwnMessage(ch, { createdAt: new Date(1000), hasAttachment: false });
    const mid = gw.addOwnMessage(ch, { createdAt: new Date(2000), hasAttachment: true });
    const recent = gw.addOwnMessage(ch, { createdAt: new Date(3000), hasAttachment: false });
    expect((await gw.ownMessages(ch, 10)).map((m) => m.id)).toEqual([recent, mid, old]);
    expect((await gw.ownMessages(ch, 2)).map((m) => m.id)).toEqual([recent, mid]);
  });

  test("a send to a missing channel is not recorded", async () => {
    const gw = new FakeGateway({});
    await expect(gw.send("100000000000000404", {})).rejects.toThrow("Unknown channel");
    expect(gw.calls).toEqual([]);
  });

  test("send rejects for an unknown channel and records attachments", async () => {
    const gw = new FakeGateway({});
    await expect(gw.send("100000000000000404", { content: "x" })).rejects.toThrow(
      "Unknown channel",
    );
    gw.addChannel("100000000000000010");
    await gw.send("100000000000000010", { files: [{ attachment: Buffer.from("x"), name: "a" }] });
    expect(gw.messages.get("100000000000000010")?.[0]?.hasAttachment).toBe(true);
  });
});

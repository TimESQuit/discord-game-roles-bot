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

  test("setRolePositions keeps positions unique", async () => {
    const gw = new FakeGateway({});
    const a = await gw.createRole({ name: "a", ...opts }, "t");
    const b = await gw.createRole({ name: "b", ...opts }, "t");
    const c = await gw.createRole({ name: "c", ...opts }, "t");
    await gw.setRolePositions([{ id: c.id, position: 3 }], "t");
    await gw.setRolePositions([{ id: a.id, position: 3 }], "t");
    const positions = gw.roles().map((r) => r.position);
    expect(new Set(positions).size).toBe(positions.length);
    expect(gw.role(gw.guildId)?.position).toBe(0);
    expect(gw.role(a.id)?.position).toBeGreaterThan(gw.role(b.id)?.position ?? 99);
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

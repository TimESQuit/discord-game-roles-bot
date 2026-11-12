import type { PermissionsString } from "discord.js";
import type { Gateway, Overwrite, OwnMessage, Payload, RoleSnapshot } from "../discord/index.ts";

export interface FakeMessage {
  id: string;
  channelId: string;
  payload: Payload;
  createdAt: Date;
  hasAttachment: boolean;
}

type RecordedMethod =
  | "createRole"
  | "editRole"
  | "deleteRole"
  | "setRolePositions"
  | "addMemberRole"
  | "removeMemberRole"
  | "createCategory"
  | "createTextChannel"
  | "deleteChannel"
  | "setChannelParent"
  | "messageExists"
  | "send"
  | "edit"
  | "deleteMessage"
  | "clearCommands"
  | "leave";

/** A recorded call, keyed by method so each one's arguments keep the Gateway's types. */
export type GatewayCall = {
  [M in RecordedMethod]: { method: M; args: Parameters<Gateway[M]> };
}[RecordedMethod];

export class FakeGateway implements Gateway {
  readonly guildId: string;
  readonly botUserId: string;
  calls: GatewayCall[] = [];
  messages = new Map<string, FakeMessage[]>();

  #roles = new Map<string, RoleSnapshot>();
  #members = new Map<string, Set<string>>();
  #channels = new Set<string>();
  #botTop = 100;
  #missing: PermissionsString[] = [];
  #failures = new Map<string, Error[]>();
  #nextId = 200000000000000000n;
  #clock = 1_700_000_000_000;

  constructor(o: { guildId?: string; botUserId?: string }) {
    this.guildId = o.guildId ?? "100000000000000000";
    this.botUserId = o.botUserId ?? "100000000000000099";
    this.#roles.set(this.guildId, {
      id: this.guildId,
      name: "@everyone",
      position: 0,
      color: 0,
      mentionable: false,
    });
  }

  // ---- test helpers ----
  addRole(snapshot: RoleSnapshot): void {
    this.#roles.set(snapshot.id, { ...snapshot });
  }
  addMember(userId: string, roleIds: string[]): void {
    this.#members.set(userId, new Set(roleIds));
  }
  addChannel(id: string): void {
    this.#channels.add(id);
  }
  addOwnMessage(channelId: string, o: { createdAt: Date; hasAttachment: boolean }): string {
    this.#channels.add(channelId);
    const id = this.#newId();
    this.#list(channelId).push({
      id,
      channelId,
      payload: {},
      createdAt: o.createdAt,
      hasAttachment: o.hasAttachment,
    });
    return id;
  }
  setBotTopPosition(n: number): void {
    this.#botTop = n;
  }
  setMissingPermissions(perms: PermissionsString[]): void {
    this.#missing = [...perms];
  }
  removeRoleBehindBotsBack(id: string): void {
    this.#roles.delete(id);
    for (const roles of this.#members.values()) roles.delete(id);
  }
  deleteChannelBehindBotsBack(id: string): void {
    this.#channels.delete(id);
    this.messages.delete(id);
  }
  deleteMessageBehindBotsBack(channelId: string, messageId: string): void {
    const list = this.messages.get(channelId);
    if (!list) return;
    this.messages.set(
      channelId,
      list.filter((m) => m.id !== messageId),
    );
  }
  failNext(method: string, error: Error): void {
    const queue = this.#failures.get(method) ?? [];
    queue.push(error);
    this.#failures.set(method, queue);
  }

  // ---- reads ----
  role(id: string): RoleSnapshot | undefined {
    const r = this.#roles.get(id);
    return r ? { ...r } : undefined;
  }
  roles(): RoleSnapshot[] {
    return [...this.#roles.values()].map((r) => ({ ...r }));
  }
  botTopRolePosition(): number {
    return this.#botTop;
  }
  missingBotPermissions(required: readonly PermissionsString[]): PermissionsString[] {
    return this.#missing.filter((p) => required.includes(p));
  }
  memberRoleIds(userId: string): ReadonlySet<string> {
    return new Set(this.#members.get(userId) ?? []);
  }
  async fetchMemberRoleIds(userId: string): Promise<ReadonlySet<string>> {
    return new Set(this.#members.get(userId) ?? []);
  }
  roleMemberIds(roleId: string): string[] {
    return [...this.#members].filter(([, roles]) => roles.has(roleId)).map(([id]) => id);
  }
  channelExists(id: string): boolean {
    return this.#channels.has(id);
  }
  async ownMessages(channelId: string, limit: number): Promise<OwnMessage[]> {
    return [...(this.messages.get(channelId) ?? [])]
      .toSorted((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit)
      .map((m) => ({ id: m.id, createdAt: m.createdAt, hasAttachment: m.hasAttachment }));
  }

  // ---- mutations ----
  async createRole(
    o: { name: string; color: number; mentionable: boolean },
    reason: string,
  ): Promise<RoleSnapshot> {
    this.#begin({ method: "createRole", args: [o, reason] });
    for (const r of this.#roles.values()) if (r.position >= 1) r.position += 1;
    // The bot's own role sits in the same list, so it shifts up too.
    if (this.#botTop >= 1) this.#botTop += 1;
    const role: RoleSnapshot = { id: this.#newId(), position: 1, ...o };
    this.#roles.set(role.id, role);
    return { ...role };
  }
  async editRole(
    id: string,
    patch: Partial<Pick<RoleSnapshot, "name" | "color" | "mentionable">>,
    reason: string,
  ): Promise<void> {
    this.#begin({ method: "editRole", args: [id, patch, reason] });
    const r = this.#roles.get(id);
    if (!r) throw new Error(`Unknown role ${id}`);
    Object.assign(r, patch);
  }
  async deleteRole(id: string, reason: string): Promise<void> {
    this.#begin({ method: "deleteRole", args: [id, reason] });
    const gone = this.#roles.get(id);
    this.#roles.delete(id);
    if (gone && gone.position >= 1) {
      // Roles above the deleted one drop by one, the bot's own role included.
      for (const r of this.#roles.values()) if (r.position > gone.position) r.position -= 1;
      if (this.#botTop > gone.position) this.#botTop -= 1;
    }
    for (const roles of this.#members.values()) roles.delete(id);
  }
  async setRolePositions(
    changes: readonly { id: string; position: number }[],
    reason: string,
  ): Promise<void> {
    this.#begin({ method: "setRolePositions", args: [changes, reason] });
    const others = [...this.#roles.values()].filter((r) => r.id !== this.guildId);
    const n = others.length;
    const pinned = new Map<number, string>();
    for (const c of changes) {
      if (!this.#roles.has(c.id) || c.id === this.guildId) continue;
      for (const [pos, id] of pinned) if (id === c.id) pinned.delete(pos);
      pinned.set(Math.min(Math.max(c.position, 1), n), c.id);
    }
    const pinnedIds = new Set(pinned.values());
    const rest = others
      .filter((r) => !pinnedIds.has(r.id))
      .toSorted((x, y) => x.position - y.position);
    for (let pos = 1; pos <= n; pos++) {
      const id = pinned.get(pos);
      const role = id ? this.#roles.get(id) : rest.shift();
      if (role) role.position = pos;
    }
    const everyone = this.#roles.get(this.guildId);
    if (everyone) everyone.position = 0;
  }
  async addMemberRole(userId: string, roleId: string, reason: string): Promise<void> {
    this.#begin({ method: "addMemberRole", args: [userId, roleId, reason] });
    const roles = this.#members.get(userId) ?? new Set<string>();
    roles.add(roleId);
    this.#members.set(userId, roles);
  }
  async removeMemberRole(userId: string, roleId: string, reason: string): Promise<void> {
    this.#begin({ method: "removeMemberRole", args: [userId, roleId, reason] });
    this.#members.get(userId)?.delete(roleId);
  }
  async createCategory(name: string, overwrites: readonly Overwrite[]): Promise<string> {
    this.#begin({ method: "createCategory", args: [name, overwrites] });
    const id = this.#newId();
    this.#channels.add(id);
    return id;
  }
  async createTextChannel(
    name: string,
    parentId: string | null,
    overwrites: readonly Overwrite[],
  ): Promise<string> {
    this.#begin({ method: "createTextChannel", args: [name, parentId, overwrites] });
    const id = this.#newId();
    this.#channels.add(id);
    return id;
  }
  async deleteChannel(id: string, reason: string): Promise<void> {
    this.#begin({ method: "deleteChannel", args: [id, reason] });
    if (!this.#channels.has(id)) throw new Error(`Unknown channel ${id}`);
    this.deleteChannelBehindBotsBack(id);
  }
  async setChannelParent(channelId: string, parentId: string): Promise<void> {
    this.#begin({ method: "setChannelParent", args: [channelId, parentId] });
  }
  async messageExists(channelId: string, messageId: string): Promise<boolean> {
    this.#begin({ method: "messageExists", args: [channelId, messageId] });
    return (this.messages.get(channelId) ?? []).some((m) => m.id === messageId);
  }
  async send(channelId: string, payload: Payload): Promise<string> {
    if (!this.#channels.has(channelId)) throw new Error(`Unknown channel ${channelId}`);
    this.#begin({ method: "send", args: [channelId, payload] });
    const id = this.#newId();
    this.#list(channelId).push({
      id,
      channelId,
      payload,
      createdAt: new Date((this.#clock += 1000)),
      hasAttachment: (payload.files?.length ?? 0) > 0,
    });
    return id;
  }
  async edit(channelId: string, messageId: string, payload: Payload): Promise<boolean> {
    this.#begin({ method: "edit", args: [channelId, messageId, payload] });
    const m = this.messages.get(channelId)?.find((x) => x.id === messageId);
    if (!m) return false;
    m.payload = payload;
    return true;
  }
  async deleteMessage(channelId: string, messageId: string): Promise<void> {
    this.#begin({ method: "deleteMessage", args: [channelId, messageId] });
    this.deleteMessageBehindBotsBack(channelId, messageId);
  }
  async clearCommands(): Promise<void> {
    this.#begin({ method: "clearCommands", args: [] });
  }
  async leave(): Promise<void> {
    this.#begin({ method: "leave", args: [] });
  }

  // ---- internals ----
  #begin(call: GatewayCall): void {
    const err = this.#failures.get(call.method)?.shift();
    if (err) throw err;
    this.calls.push(call);
  }
  #newId(): string {
    this.#nextId += 1n;
    return this.#nextId.toString();
  }
  #list(channelId: string): FakeMessage[] {
    let list = this.messages.get(channelId);
    if (!list) {
      list = [];
      this.messages.set(channelId, list);
    }
    return list;
  }
}

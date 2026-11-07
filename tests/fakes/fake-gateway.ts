import type { PermissionsString } from "discord.js";
import type {
  Gateway,
  Overwrite,
  OwnMessage,
  Payload,
  RoleSnapshot,
} from "../../src/discord/gateway.ts";

export interface FakeMessage {
  id: string;
  channelId: string;
  payload: Payload;
  createdAt: Date;
  hasAttachment: boolean;
}

export class FakeGateway implements Gateway {
  readonly guildId: string;
  readonly botUserId: string;
  calls: { method: string; args: unknown[] }[] = [];
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
  roleMemberIds(roleId: string): string[] {
    return [...this.#members].filter(([, roles]) => roles.has(roleId)).map(([id]) => id);
  }
  channelExists(id: string): boolean {
    return this.#channels.has(id);
  }
  async ownMessages(channelId: string, limit: number): Promise<OwnMessage[]> {
    return [...(this.messages.get(channelId) ?? [])]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit)
      .map((m) => ({ id: m.id, createdAt: m.createdAt, hasAttachment: m.hasAttachment }));
  }

  // ---- mutations ----
  async createRole(
    o: { name: string; color: number; mentionable: boolean },
    reason: string,
  ): Promise<RoleSnapshot> {
    this.#begin("createRole", [o, reason]);
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
    this.#begin("editRole", [id, patch, reason]);
    const r = this.#roles.get(id);
    if (!r) throw new Error(`Unknown role ${id}`);
    Object.assign(r, patch);
  }
  async deleteRole(id: string, reason: string): Promise<void> {
    this.#begin("deleteRole", [id, reason]);
    const gone = this.#roles.get(id);
    if (gone && gone.position >= 1 && gone.position < this.#botTop) this.#botTop -= 1;
    this.#roles.delete(id);
    for (const roles of this.#members.values()) roles.delete(id);
  }
  async setRolePositions(
    changes: readonly { id: string; position: number }[],
    reason: string,
  ): Promise<void> {
    this.#begin("setRolePositions", [changes, reason]);
    const others = [...this.#roles.values()].filter((r) => r.id !== this.guildId);
    const n = others.length;
    const pinned = new Map<number, string>();
    for (const c of changes) {
      if (!this.#roles.has(c.id) || c.id === this.guildId) continue;
      for (const [pos, id] of pinned) if (id === c.id) pinned.delete(pos);
      pinned.set(Math.min(Math.max(c.position, 1), n), c.id);
    }
    const pinnedIds = new Set(pinned.values());
    const rest = others.filter((r) => !pinnedIds.has(r.id)).sort((x, y) => x.position - y.position);
    for (let pos = 1; pos <= n; pos++) {
      const id = pinned.get(pos);
      const role = id ? this.#roles.get(id) : rest.shift();
      if (role) role.position = pos;
    }
    const everyone = this.#roles.get(this.guildId);
    if (everyone) everyone.position = 0;
  }
  async addMemberRole(userId: string, roleId: string, reason: string): Promise<void> {
    this.#begin("addMemberRole", [userId, roleId, reason]);
    const roles = this.#members.get(userId) ?? new Set<string>();
    roles.add(roleId);
    this.#members.set(userId, roles);
  }
  async removeMemberRole(userId: string, roleId: string, reason: string): Promise<void> {
    this.#begin("removeMemberRole", [userId, roleId, reason]);
    this.#members.get(userId)?.delete(roleId);
  }
  async createCategory(name: string, overwrites: readonly Overwrite[]): Promise<string> {
    this.#begin("createCategory", [name, overwrites]);
    const id = this.#newId();
    this.#channels.add(id);
    return id;
  }
  async createTextChannel(
    name: string,
    parentId: string | null,
    overwrites: readonly Overwrite[],
  ): Promise<string> {
    this.#begin("createTextChannel", [name, parentId, overwrites]);
    const id = this.#newId();
    this.#channels.add(id);
    return id;
  }
  async send(channelId: string, payload: Payload): Promise<string> {
    if (!this.#channels.has(channelId)) throw new Error(`Unknown channel ${channelId}`);
    this.#begin("send", [channelId, payload]);
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
    this.#begin("edit", [channelId, messageId, payload]);
    const m = this.messages.get(channelId)?.find((x) => x.id === messageId);
    if (!m) return false;
    m.payload = payload;
    return true;
  }
  async deleteMessage(channelId: string, messageId: string): Promise<void> {
    this.#begin("deleteMessage", [channelId, messageId]);
    this.deleteMessageBehindBotsBack(channelId, messageId);
  }

  // ---- internals ----
  #begin(method: string, args: unknown[]): void {
    const err = this.#failures.get(method)?.shift();
    if (err) throw err;
    this.calls.push({ method, args });
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

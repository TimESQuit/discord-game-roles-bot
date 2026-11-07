import {
  ComponentType,
  isJSONEncodable,
  MessageFlagsBitField,
  type APIButtonComponentWithCustomId,
  type APIMessageComponent,
  type APIModalComponent,
  type APITextDisplayComponent,
} from "discord.js";
import type { Payload } from "../discord/index.ts";

/** Any component a message or a modal can hold, as the API sends it. */
export type AnyComponent = APIMessageComponent | APIModalComponent;

/** A payload or modal, or just its list of top-level components (API objects or builders). */
export type ComponentSource = { components?: readonly unknown[] } | readonly unknown[];

const COMPONENT_TYPES: ReadonlySet<unknown> = new Set(
  Object.values(ComponentType).filter((v) => typeof v === "number"),
);

function isComponent(value: unknown): value is AnyComponent {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    COMPONENT_TYPES.has(value.type)
  );
}

/** Builders expose their API form through toJSON(); API objects are used as they are. */
function toComponent(value: unknown): AnyComponent | undefined {
  const json: unknown = isJSONEncodable(value) ? value.toJSON() : value;
  return isComponent(json) ? json : undefined;
}

function childrenOf(component: AnyComponent): readonly unknown[] {
  if ("components" in component) return component.components;
  if ("component" in component) return [component.component];
  return [];
}

function flatten(items: readonly unknown[]): AnyComponent[] {
  return items.flatMap((item) => {
    const component = toComponent(item);
    return component ? [component, ...flatten(childrenOf(component))] : [];
  });
}

const isList = (source: ComponentSource): source is readonly unknown[] => Array.isArray(source);

/** Every component under the source, parents before children, nested ones included. */
export function allComponents(source: ComponentSource): AnyComponent[] {
  return flatten(isList(source) ? source : (source.components ?? []));
}

/** Every component of one type, typed by it: `findComponents(view, ComponentType.Button)`. */
export function findComponents<T extends ComponentType>(
  source: ComponentSource,
  type: T,
): Extract<AnyComponent, { type: T }>[] {
  return allComponents(source).filter(
    (c): c is Extract<AnyComponent, { type: T }> => c.type === type,
  );
}

/** The buttons that carry a custom ID (all of the bot's own buttons do). */
export function customIdButtons(source: ComponentSource): APIButtonComponentWithCustomId[] {
  return findComponents(source, ComponentType.Button).filter((b) => "custom_id" in b);
}

/** All text-display content, joined with newlines. */
export function textOf(source: ComponentSource): string {
  return findComponents(source, ComponentType.TextDisplay)
    .map((t: APITextDisplayComponent) => t.content)
    .join("\n");
}

/** The numeric message flags of a payload, whether it lists them or holds one. */
export function flagBits(payload: Pick<Payload, "flags">): number {
  return payload.flags === undefined ? 0 : new MessageFlagsBitField(payload.flags).bitfield;
}

/** Narrows away `undefined` and `null`, failing the test with a message when it is missing. */
export function defined<T>(value: T | null | undefined, what = "value"): T {
  if (value === undefined || value === null) throw new Error(`Expected ${what} to be defined`);
  return value;
}

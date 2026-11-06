/**
 * A plain-text description of a reply schema.
 *
 * Why it exists: the prompt shows the model the shape it must reply with, and the cache key
 * includes the shape so a changed schema never returns an old reply.
 */
import { z } from "zod";

/** The text of a schema and whether the reply is an object or an array. */
export interface SchemaDescription {
  /** JSON Schema as compact text. Example: `{"type":"object","properties":{"score":{"type":"number"}}}`. */
  description: string;
  /** What the top level of a valid reply looks like. */
  replyKind: "object" | "array";
}

/**
 * Describes `schema` as JSON Schema text.
 * Example: `describeSchema(z.object({ score: z.number() })).replyKind` is "object".
 * Parts that JSON Schema cannot express (such as custom checks) are left out of the description;
 * the real validation still runs on every reply.
 */
export function describeSchema(schema: z.ZodType<unknown>): SchemaDescription {
  const jsonSchema = z.toJSONSchema(schema, { unrepresentable: "any", io: "input" });
  const replyKind = jsonSchema.type === "array" ? "array" : "object";
  return { description: JSON.stringify(jsonSchema), replyKind };
}

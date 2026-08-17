/**
 * Shared runtime config.
 *
 * The model id is read from AI_MODEL at startup and defaults to eve's own
 * default: zai/glm-5.2. Switch to a vision-capable model (any gateway id, e.g.
 * "google/gemini-2.5-flash") to enable observe()'s real screen pixels.
 */
export const MODEL = process.env.AI_MODEL ?? "zai/glm-5.2";

/** zai/glm-* does not support image input. Everything else is treated as vision-capable. */
export const VISION_CAPABLE = !MODEL.toLowerCase().startsWith("zai/glm");
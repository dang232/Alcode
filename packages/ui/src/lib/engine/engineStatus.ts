import { z } from "zod";

import { runtimeFetch } from "@/lib/runtime-fetch";

const engineStatusSchema = z.object({
  entry: z.string().nullable(),
  builtin: z.boolean(),
  available: z.boolean(),
  compatible: z.boolean(),
  version: z.string().nullable(),
  runFlags: z.array(z.string()),
  missingRunFlags: z.array(z.string()),
  message: z.string().nullable(),
  binding: z.object({
    alcoreModels: z.array(z.string()),
    defaultRole: z.string(),
  }),
});

export type EngineStatus = z.infer<typeof engineStatusSchema>;

export type EngineStatusResult =
  | { ok: true; status: EngineStatus }
  | { ok: false; error: "unreachable" | "malformed" };

export async function fetchEngineStatus(): Promise<EngineStatusResult> {
  let response: Response;
  try {
    response = await runtimeFetch("/api/engine/status");
  } catch {
    return { ok: false, error: "unreachable" };
  }
  if (!response.ok) return { ok: false, error: "unreachable" };
  // Parsed at this boundary: anything off-shape reads as malformed, never
  // as trusted state (ui-api-decoupling: failure is distinct from empty).
  const parsed = engineStatusSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) return { ok: false, error: "malformed" };
  return { ok: true, status: parsed.data };
}

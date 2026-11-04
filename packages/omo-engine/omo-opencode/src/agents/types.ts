
import {
} from "../../../model-core/src/index.ts";

function extractModelName(model: string): string {
  return model.includes("/") ? (model.split("/").pop() ?? model) : model;
}

export function isGpt5_5Model(model: string): boolean {
  const modelName = extractModelName(model).toLowerCase();
  return modelName.includes("gpt-5.5") || modelName.includes("gpt-5-5");
}

/** Matches the GPT-5.6 family: gpt-5.6, gpt-5.6-sol, gpt-5.6-terra, gpt-5.6-luna. */
export function isGpt5_6Model(model: string): boolean {
  const modelName = extractModelName(model).toLowerCase();
  return modelName.includes("gpt-5.6") || modelName.includes("gpt-5-6");
}

/** Matches GPT-6 models, including provider-prefixed and fast-tier IDs. */
export function isGpt6Model(model: string): boolean {
  const modelName = extractModelName(model).toLowerCase();
  return modelName.includes("gpt-6");
}


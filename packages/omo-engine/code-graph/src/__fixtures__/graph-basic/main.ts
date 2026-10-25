import { add } from "./math";

export function run(): number {
  return add(1, 2);
}

export function runDynamic(handlers: Record<string, () => number>, name: string): number {
  const handler = handlers[name];
  return handler();
}

export function runEval(): unknown {
  return eval("1 + 1");
}

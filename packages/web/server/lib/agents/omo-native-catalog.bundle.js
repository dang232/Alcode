/**
 * Generated from omo-native-catalog.js — DO NOT EDIT BY HAND.
 *
 * Regen with `bun ./omo-native-catalog.regen.js` in this directory. Bundled with
 * Bun.build (target node, format esm, external node:* builtins only) so the
 * engine TypeScript ships inline: the packaged web server runs under plain
 * Node with no transpile step, where a static `.ts` import fails.
 */
// ../../../../omo-engine/omo-opencode/src/shared/agent-display-names.ts
var AGENT_DISPLAY_NAMES = {
  sisyphus: "Sisyphus - ultraworker",
  hephaestus: "Hephaestus - Deep Agent",
  prometheus: "Prometheus - Plan Builder",
  atlas: "Atlas - Plan Executor",
  "sisyphus-junior": "Sisyphus-Junior",
  metis: "Metis - Plan Consultant",
  momus: "Momus - Plan Critic",
  athena: "Athena - Council",
  "athena-junior": "Athena-Junior - Council",
  oracle: "oracle",
  librarian: "librarian",
  explore: "explore",
  "multimodal-looker": "multimodal-looker",
  "plan-consultant": "Plan Consultant",
  "plan-reviewer": "Plan Reviewer",
  "omo-native-code-reviewer": "Code Reviewer - Final Gate",
  "omo-native-qa-executor": "QA Executor - Final Gate",
  "omo-native-gate-reviewer": "Gate Reviewer - Final",
  "council-member": "council-member"
};
var INVISIBLE_AGENT_CHARACTERS_REGEX = /[\u200B\u200C\u200D\uFEFF]/g;
var VISIBLE_AGENT_LIST_SORT_PREFIX_REGEX = /^\d+\|/;
var AGENT_WRAPPER_CHARS_REGEX = /^[\\/"']+|[\\/"']+$/g;
function stripInvisibleAgentCharacters(agentName) {
  return agentName.replace(INVISIBLE_AGENT_CHARACTERS_REGEX, "");
}
function stripAgentListSortPrefix(agentName) {
  return stripInvisibleAgentCharacters(agentName).replace(VISIBLE_AGENT_LIST_SORT_PREFIX_REGEX, "").replace(AGENT_WRAPPER_CHARS_REGEX, "");
}
function getAgentDisplayName(configKey, overrides) {
  if (overrides) {
    const override = overrides[configKey] ?? Object.entries(overrides).find(([k]) => k.toLowerCase() === configKey.toLowerCase())?.[1];
    if (override?.displayName)
      return override.displayName;
  }
  const exactMatch = AGENT_DISPLAY_NAMES[configKey];
  if (exactMatch !== undefined)
    return exactMatch;
  const lowerKey = configKey.toLowerCase();
  for (const [k, v] of Object.entries(AGENT_DISPLAY_NAMES)) {
    if (k.toLowerCase() === lowerKey)
      return v;
  }
  return configKey;
}
var REVERSE_DISPLAY_NAMES = Object.fromEntries(Object.entries(AGENT_DISPLAY_NAMES).map(([key, displayName]) => [displayName.toLowerCase(), key]));
var LEGACY_DISPLAY_NAMES = {
  "sisyphus (ultraworker)": "sisyphus",
  "hephaestus (deep agent)": "hephaestus",
  "prometheus (plan builder)": "prometheus",
  "atlas (plan executor)": "atlas",
  "metis (plan consultant)": "metis",
  "momus (plan critic)": "momus",
  "athena (council)": "athena",
  "athena-junior (council)": "athena-junior"
};
function resolveKnownAgentConfigKey(agentName) {
  const lower = stripAgentListSortPrefix(agentName).trim().toLowerCase();
  const reversed = REVERSE_DISPLAY_NAMES[lower];
  if (reversed !== undefined)
    return reversed;
  const legacy = LEGACY_DISPLAY_NAMES[lower];
  if (legacy !== undefined)
    return legacy;
  if (AGENT_DISPLAY_NAMES[lower] !== undefined)
    return lower;
  return;
}
function getAgentConfigKey(agentName) {
  const lower = stripAgentListSortPrefix(agentName).trim().toLowerCase();
  return resolveKnownAgentConfigKey(agentName) ?? lower;
}

// ../../../../../node_modules/.bun/zod@4.3.6/node_modules/zod/v4/core/core.js
var NEVER = Object.freeze({
  status: "aborted"
});
function $constructor(name, initializer, params) {
  function init(inst, def) {
    if (!inst._zod) {
      Object.defineProperty(inst, "_zod", {
        value: {
          def,
          constr: _,
          traits: new Set
        },
        enumerable: false
      });
    }
    if (inst._zod.traits.has(name)) {
      return;
    }
    inst._zod.traits.add(name);
    initializer(inst, def);
    const proto = _.prototype;
    const keys = Object.keys(proto);
    for (let i = 0;i < keys.length; i++) {
      const k = keys[i];
      if (!(k in inst)) {
        inst[k] = proto[k].bind(inst);
      }
    }
  }
  const Parent = params?.Parent ?? Object;

  class Definition extends Parent {
  }
  Object.defineProperty(Definition, "name", { value: name });
  function _(def) {
    var _a;
    const inst = params?.Parent ? new Definition : this;
    init(inst, def);
    (_a = inst._zod).deferred ?? (_a.deferred = []);
    for (const fn of inst._zod.deferred) {
      fn();
    }
    return inst;
  }
  Object.defineProperty(_, "init", { value: init });
  Object.defineProperty(_, Symbol.hasInstance, {
    value: (inst) => {
      if (params?.Parent && inst instanceof params.Parent)
        return true;
      return inst?._zod?.traits?.has(name);
    }
  });
  Object.defineProperty(_, "name", { value: name });
  return _;
}
var $brand = Symbol("zod_brand");

class $ZodAsyncError extends Error {
  constructor() {
    super(`Encountered Promise during synchronous parse. Use .parseAsync() instead.`);
  }
}

class $ZodEncodeError extends Error {
  constructor(name) {
    super(`Encountered unidirectional transform during encode: ${name}`);
    this.name = "ZodEncodeError";
  }
}
var globalConfig = {};
function config(newConfig) {
  if (newConfig)
    Object.assign(globalConfig, newConfig);
  return globalConfig;
}
// ../../../../../node_modules/.bun/zod@4.3.6/node_modules/zod/v4/core/util.js
function getEnumValues(entries) {
  const numericValues = Object.values(entries).filter((v) => typeof v === "number");
  const values = Object.entries(entries).filter(([k, _]) => numericValues.indexOf(+k) === -1).map(([_, v]) => v);
  return values;
}
function jsonStringifyReplacer(_, value) {
  if (typeof value === "bigint")
    return value.toString();
  return value;
}
function cached(getter) {
  const set = false;
  return {
    get value() {
      if (!set) {
        const value = getter();
        Object.defineProperty(this, "value", { value });
        return value;
      }
      throw new Error("cached value already set");
    }
  };
}
function nullish(input) {
  return input === null || input === undefined;
}
function cleanRegex(source) {
  const start = source.startsWith("^") ? 1 : 0;
  const end = source.endsWith("$") ? source.length - 1 : source.length;
  return source.slice(start, end);
}
var EVALUATING = Symbol("evaluating");
function defineLazy(object, key, getter) {
  let value = undefined;
  Object.defineProperty(object, key, {
    get() {
      if (value === EVALUATING) {
        return;
      }
      if (value === undefined) {
        value = EVALUATING;
        value = getter();
      }
      return value;
    },
    set(v) {
      Object.defineProperty(object, key, {
        value: v
      });
    },
    configurable: true
  });
}
function mergeDefs(...defs) {
  const mergedDescriptors = {};
  for (const def of defs) {
    const descriptors = Object.getOwnPropertyDescriptors(def);
    Object.assign(mergedDescriptors, descriptors);
  }
  return Object.defineProperties({}, mergedDescriptors);
}
var captureStackTrace = "captureStackTrace" in Error ? Error.captureStackTrace : (..._args) => {};
function isObject(data) {
  return typeof data === "object" && data !== null && !Array.isArray(data);
}
var allowsEval = cached(() => {
  if (typeof navigator !== "undefined" && navigator?.userAgent?.includes("Cloudflare")) {
    return false;
  }
  try {
    const F = Function;
    new F("");
    return true;
  } catch (_) {
    return false;
  }
});
function isPlainObject(o) {
  if (isObject(o) === false)
    return false;
  const ctor = o.constructor;
  if (ctor === undefined)
    return true;
  if (typeof ctor !== "function")
    return true;
  const prot = ctor.prototype;
  if (isObject(prot) === false)
    return false;
  if (Object.prototype.hasOwnProperty.call(prot, "isPrototypeOf") === false) {
    return false;
  }
  return true;
}
function shallowClone(o) {
  if (isPlainObject(o))
    return { ...o };
  if (Array.isArray(o))
    return [...o];
  return o;
}
var propertyKeyTypes = new Set(["string", "number", "symbol"]);
var primitiveTypes = new Set(["string", "number", "bigint", "boolean", "symbol", "undefined"]);
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function clone(inst, def, params) {
  const cl = new inst._zod.constr(def ?? inst._zod.def);
  if (!def || params?.parent)
    cl._zod.parent = inst;
  return cl;
}
function normalizeParams(_params) {
  const params = _params;
  if (!params)
    return {};
  if (typeof params === "string")
    return { error: () => params };
  if (params?.message !== undefined) {
    if (params?.error !== undefined)
      throw new Error("Cannot specify both `message` and `error` params");
    params.error = params.message;
  }
  delete params.message;
  if (typeof params.error === "string")
    return { ...params, error: () => params.error };
  return params;
}
var NUMBER_FORMAT_RANGES = {
  safeint: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
  int32: [-2147483648, 2147483647],
  uint32: [0, 4294967295],
  float32: [-340282346638528860000000000000000000000, 340282346638528860000000000000000000000],
  float64: [-Number.MAX_VALUE, Number.MAX_VALUE]
};
function aborted(x, startIndex = 0) {
  if (x.aborted === true)
    return true;
  for (let i = startIndex;i < x.issues.length; i++) {
    if (x.issues[i]?.continue !== true) {
      return true;
    }
  }
  return false;
}
function prefixIssues(path, issues) {
  return issues.map((iss) => {
    var _a;
    (_a = iss).path ?? (_a.path = []);
    iss.path.unshift(path);
    return iss;
  });
}
function unwrapMessage(message) {
  return typeof message === "string" ? message : message?.message;
}
function finalizeIssue(iss, ctx, config) {
  const full = { ...iss, path: iss.path ?? [] };
  if (!iss.message) {
    const message = unwrapMessage(iss.inst?._zod.def?.error?.(iss)) ?? unwrapMessage(ctx?.error?.(iss)) ?? unwrapMessage(config.customError?.(iss)) ?? unwrapMessage(config.localeError?.(iss)) ?? "Invalid input";
    full.message = message;
  }
  delete full.inst;
  delete full.continue;
  if (!ctx?.reportInput) {
    delete full.input;
  }
  return full;
}
function getLengthableOrigin(input) {
  if (Array.isArray(input))
    return "array";
  if (typeof input === "string")
    return "string";
  return "unknown";
}
function issue(...args) {
  const [iss, input, inst] = args;
  if (typeof iss === "string") {
    return {
      message: iss,
      code: "custom",
      input,
      inst
    };
  }
  return { ...iss };
}

// ../../../../../node_modules/.bun/zod@4.3.6/node_modules/zod/v4/core/errors.js
var initializer = (inst, def) => {
  inst.name = "$ZodError";
  Object.defineProperty(inst, "_zod", {
    value: inst._zod,
    enumerable: false
  });
  Object.defineProperty(inst, "issues", {
    value: def,
    enumerable: false
  });
  inst.message = JSON.stringify(def, jsonStringifyReplacer, 2);
  Object.defineProperty(inst, "toString", {
    value: () => inst.message,
    enumerable: false
  });
};
var $ZodError = $constructor("$ZodError", initializer);
var $ZodRealError = $constructor("$ZodError", initializer, { Parent: Error });
function flattenError(error, mapper = (issue) => issue.message) {
  const fieldErrors = {};
  const formErrors = [];
  for (const sub of error.issues) {
    if (sub.path.length > 0) {
      fieldErrors[sub.path[0]] = fieldErrors[sub.path[0]] || [];
      fieldErrors[sub.path[0]].push(mapper(sub));
    } else {
      formErrors.push(mapper(sub));
    }
  }
  return { formErrors, fieldErrors };
}
function formatError(error, mapper = (issue) => issue.message) {
  const fieldErrors = { _errors: [] };
  const processError = (error) => {
    for (const issue of error.issues) {
      if (issue.code === "invalid_union" && issue.errors.length) {
        issue.errors.map((issues) => processError({ issues }));
      } else if (issue.code === "invalid_key") {
        processError({ issues: issue.issues });
      } else if (issue.code === "invalid_element") {
        processError({ issues: issue.issues });
      } else if (issue.path.length === 0) {
        fieldErrors._errors.push(mapper(issue));
      } else {
        let curr = fieldErrors;
        let i = 0;
        while (i < issue.path.length) {
          const el = issue.path[i];
          const terminal = i === issue.path.length - 1;
          if (!terminal) {
            curr[el] = curr[el] || { _errors: [] };
          } else {
            curr[el] = curr[el] || { _errors: [] };
            curr[el]._errors.push(mapper(issue));
          }
          curr = curr[el];
          i++;
        }
      }
    }
  };
  processError(error);
  return fieldErrors;
}

// ../../../../../node_modules/.bun/zod@4.3.6/node_modules/zod/v4/core/parse.js
var _parse = (_Err) => (schema, value, _ctx, _params) => {
  const ctx = _ctx ? Object.assign(_ctx, { async: false }) : { async: false };
  const result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise) {
    throw new $ZodAsyncError;
  }
  if (result.issues.length) {
    const e = new (_params?.Err ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
    captureStackTrace(e, _params?.callee);
    throw e;
  }
  return result.value;
};
var _parseAsync = (_Err) => async (schema, value, _ctx, params) => {
  const ctx = _ctx ? Object.assign(_ctx, { async: true }) : { async: true };
  let result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise)
    result = await result;
  if (result.issues.length) {
    const e = new (params?.Err ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
    captureStackTrace(e, params?.callee);
    throw e;
  }
  return result.value;
};
var _safeParse = (_Err) => (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, async: false } : { async: false };
  const result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise) {
    throw new $ZodAsyncError;
  }
  return result.issues.length ? {
    success: false,
    error: new (_Err ?? $ZodError)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
  } : { success: true, data: result.value };
};
var safeParse = /* @__PURE__ */ _safeParse($ZodRealError);
var _safeParseAsync = (_Err) => async (schema, value, _ctx) => {
  const ctx = _ctx ? Object.assign(_ctx, { async: true }) : { async: true };
  let result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise)
    result = await result;
  return result.issues.length ? {
    success: false,
    error: new _Err(result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
  } : { success: true, data: result.value };
};
var safeParseAsync = /* @__PURE__ */ _safeParseAsync($ZodRealError);
var _encode = (_Err) => (schema, value, _ctx) => {
  const ctx = _ctx ? Object.assign(_ctx, { direction: "backward" }) : { direction: "backward" };
  return _parse(_Err)(schema, value, ctx);
};
var _decode = (_Err) => (schema, value, _ctx) => {
  return _parse(_Err)(schema, value, _ctx);
};
var _encodeAsync = (_Err) => async (schema, value, _ctx) => {
  const ctx = _ctx ? Object.assign(_ctx, { direction: "backward" }) : { direction: "backward" };
  return _parseAsync(_Err)(schema, value, ctx);
};
var _decodeAsync = (_Err) => async (schema, value, _ctx) => {
  return _parseAsync(_Err)(schema, value, _ctx);
};
var _safeEncode = (_Err) => (schema, value, _ctx) => {
  const ctx = _ctx ? Object.assign(_ctx, { direction: "backward" }) : { direction: "backward" };
  return _safeParse(_Err)(schema, value, ctx);
};
var _safeDecode = (_Err) => (schema, value, _ctx) => {
  return _safeParse(_Err)(schema, value, _ctx);
};
var _safeEncodeAsync = (_Err) => async (schema, value, _ctx) => {
  const ctx = _ctx ? Object.assign(_ctx, { direction: "backward" }) : { direction: "backward" };
  return _safeParseAsync(_Err)(schema, value, ctx);
};
var _safeDecodeAsync = (_Err) => async (schema, value, _ctx) => {
  return _safeParseAsync(_Err)(schema, value, _ctx);
};
// ../../../../../node_modules/.bun/zod@4.3.6/node_modules/zod/v4/core/checks.js
var $ZodCheck = /* @__PURE__ */ $constructor("$ZodCheck", (inst, def) => {
  var _a;
  inst._zod ?? (inst._zod = {});
  inst._zod.def = def;
  (_a = inst._zod).onattach ?? (_a.onattach = []);
});
var $ZodCheckMaxLength = /* @__PURE__ */ $constructor("$ZodCheckMaxLength", (inst, def) => {
  var _a;
  $ZodCheck.init(inst, def);
  (_a = inst._zod.def).when ?? (_a.when = (payload) => {
    const val = payload.value;
    return !nullish(val) && val.length !== undefined;
  });
  inst._zod.onattach.push((inst) => {
    const curr = inst._zod.bag.maximum ?? Number.POSITIVE_INFINITY;
    if (def.maximum < curr)
      inst._zod.bag.maximum = def.maximum;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    const length = input.length;
    if (length <= def.maximum)
      return;
    const origin = getLengthableOrigin(input);
    payload.issues.push({
      origin,
      code: "too_big",
      maximum: def.maximum,
      inclusive: true,
      input,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckMinLength = /* @__PURE__ */ $constructor("$ZodCheckMinLength", (inst, def) => {
  var _a;
  $ZodCheck.init(inst, def);
  (_a = inst._zod.def).when ?? (_a.when = (payload) => {
    const val = payload.value;
    return !nullish(val) && val.length !== undefined;
  });
  inst._zod.onattach.push((inst) => {
    const curr = inst._zod.bag.minimum ?? Number.NEGATIVE_INFINITY;
    if (def.minimum > curr)
      inst._zod.bag.minimum = def.minimum;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    const length = input.length;
    if (length >= def.minimum)
      return;
    const origin = getLengthableOrigin(input);
    payload.issues.push({
      origin,
      code: "too_small",
      minimum: def.minimum,
      inclusive: true,
      input,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckLengthEquals = /* @__PURE__ */ $constructor("$ZodCheckLengthEquals", (inst, def) => {
  var _a;
  $ZodCheck.init(inst, def);
  (_a = inst._zod.def).when ?? (_a.when = (payload) => {
    const val = payload.value;
    return !nullish(val) && val.length !== undefined;
  });
  inst._zod.onattach.push((inst) => {
    const bag = inst._zod.bag;
    bag.minimum = def.length;
    bag.maximum = def.length;
    bag.length = def.length;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    const length = input.length;
    if (length === def.length)
      return;
    const origin = getLengthableOrigin(input);
    const tooBig = length > def.length;
    payload.issues.push({
      origin,
      ...tooBig ? { code: "too_big", maximum: def.length } : { code: "too_small", minimum: def.length },
      inclusive: true,
      exact: true,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckOverwrite = /* @__PURE__ */ $constructor("$ZodCheckOverwrite", (inst, def) => {
  $ZodCheck.init(inst, def);
  inst._zod.check = (payload) => {
    payload.value = def.tx(payload.value);
  };
});

// ../../../../../node_modules/.bun/zod@4.3.6/node_modules/zod/v4/core/versions.js
var version = {
  major: 4,
  minor: 3,
  patch: 6
};

// ../../../../../node_modules/.bun/zod@4.3.6/node_modules/zod/v4/core/schemas.js
var $ZodType = /* @__PURE__ */ $constructor("$ZodType", (inst, def) => {
  var _a;
  inst ?? (inst = {});
  inst._zod.def = def;
  inst._zod.bag = inst._zod.bag || {};
  inst._zod.version = version;
  const checks = [...inst._zod.def.checks ?? []];
  if (inst._zod.traits.has("$ZodCheck")) {
    checks.unshift(inst);
  }
  for (const ch of checks) {
    for (const fn of ch._zod.onattach) {
      fn(inst);
    }
  }
  if (checks.length === 0) {
    (_a = inst._zod).deferred ?? (_a.deferred = []);
    inst._zod.deferred?.push(() => {
      inst._zod.run = inst._zod.parse;
    });
  } else {
    const runChecks = (payload, checks, ctx) => {
      let isAborted = aborted(payload);
      let asyncResult;
      for (const ch of checks) {
        if (ch._zod.def.when) {
          const shouldRun = ch._zod.def.when(payload);
          if (!shouldRun)
            continue;
        } else if (isAborted) {
          continue;
        }
        const currLen = payload.issues.length;
        const _ = ch._zod.check(payload);
        if (_ instanceof Promise && ctx?.async === false) {
          throw new $ZodAsyncError;
        }
        if (asyncResult || _ instanceof Promise) {
          asyncResult = (asyncResult ?? Promise.resolve()).then(async () => {
            await _;
            const nextLen = payload.issues.length;
            if (nextLen === currLen)
              return;
            if (!isAborted)
              isAborted = aborted(payload, currLen);
          });
        } else {
          const nextLen = payload.issues.length;
          if (nextLen === currLen)
            continue;
          if (!isAborted)
            isAborted = aborted(payload, currLen);
        }
      }
      if (asyncResult) {
        return asyncResult.then(() => {
          return payload;
        });
      }
      return payload;
    };
    const handleCanaryResult = (canary, payload, ctx) => {
      if (aborted(canary)) {
        canary.aborted = true;
        return canary;
      }
      const checkResult = runChecks(payload, checks, ctx);
      if (checkResult instanceof Promise) {
        if (ctx.async === false)
          throw new $ZodAsyncError;
        return checkResult.then((checkResult) => inst._zod.parse(checkResult, ctx));
      }
      return inst._zod.parse(checkResult, ctx);
    };
    inst._zod.run = (payload, ctx) => {
      if (ctx.skipChecks) {
        return inst._zod.parse(payload, ctx);
      }
      if (ctx.direction === "backward") {
        const canary = inst._zod.parse({ value: payload.value, issues: [] }, { ...ctx, skipChecks: true });
        if (canary instanceof Promise) {
          return canary.then((canary) => {
            return handleCanaryResult(canary, payload, ctx);
          });
        }
        return handleCanaryResult(canary, payload, ctx);
      }
      const result = inst._zod.parse(payload, ctx);
      if (result instanceof Promise) {
        if (ctx.async === false)
          throw new $ZodAsyncError;
        return result.then((result) => runChecks(result, checks, ctx));
      }
      return runChecks(result, checks, ctx);
    };
  }
  defineLazy(inst, "~standard", () => ({
    validate: (value) => {
      try {
        const r = safeParse(inst, value);
        return r.success ? { value: r.data } : { issues: r.error?.issues };
      } catch (_) {
        return safeParseAsync(inst, value).then((r) => r.success ? { value: r.data } : { issues: r.error?.issues });
      }
    },
    vendor: "zod",
    version: 1
  }));
});
function handleArrayResult(result, final, index) {
  if (result.issues.length) {
    final.issues.push(...prefixIssues(index, result.issues));
  }
  final.value[index] = result.value;
}
var $ZodArray = /* @__PURE__ */ $constructor("$ZodArray", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    if (!Array.isArray(input)) {
      payload.issues.push({
        expected: "array",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    payload.value = Array(input.length);
    const proms = [];
    for (let i = 0;i < input.length; i++) {
      const item = input[i];
      const result = def.element._zod.run({
        value: item,
        issues: []
      }, ctx);
      if (result instanceof Promise) {
        proms.push(result.then((result) => handleArrayResult(result, payload, i)));
      } else {
        handleArrayResult(result, payload, i);
      }
    }
    if (proms.length) {
      return Promise.all(proms).then(() => payload);
    }
    return payload;
  };
});
function handleUnionResults(results, final, inst, ctx) {
  for (const result of results) {
    if (result.issues.length === 0) {
      final.value = result.value;
      return final;
    }
  }
  const nonaborted = results.filter((r) => !aborted(r));
  if (nonaborted.length === 1) {
    final.value = nonaborted[0].value;
    return nonaborted[0];
  }
  final.issues.push({
    code: "invalid_union",
    input: final.value,
    inst,
    errors: results.map((result) => result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
  });
  return final;
}
var $ZodUnion = /* @__PURE__ */ $constructor("$ZodUnion", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "optin", () => def.options.some((o) => o._zod.optin === "optional") ? "optional" : undefined);
  defineLazy(inst._zod, "optout", () => def.options.some((o) => o._zod.optout === "optional") ? "optional" : undefined);
  defineLazy(inst._zod, "values", () => {
    if (def.options.every((o) => o._zod.values)) {
      return new Set(def.options.flatMap((option) => Array.from(option._zod.values)));
    }
    return;
  });
  defineLazy(inst._zod, "pattern", () => {
    if (def.options.every((o) => o._zod.pattern)) {
      const patterns = def.options.map((o) => o._zod.pattern);
      return new RegExp(`^(${patterns.map((p) => cleanRegex(p.source)).join("|")})$`);
    }
    return;
  });
  const single = def.options.length === 1;
  const first = def.options[0]._zod.run;
  inst._zod.parse = (payload, ctx) => {
    if (single) {
      return first(payload, ctx);
    }
    let async = false;
    const results = [];
    for (const option of def.options) {
      const result = option._zod.run({
        value: payload.value,
        issues: []
      }, ctx);
      if (result instanceof Promise) {
        results.push(result);
        async = true;
      } else {
        if (result.issues.length === 0)
          return result;
        results.push(result);
      }
    }
    if (!async)
      return handleUnionResults(results, payload, inst, ctx);
    return Promise.all(results).then((results) => {
      return handleUnionResults(results, payload, inst, ctx);
    });
  };
});
var $ZodIntersection = /* @__PURE__ */ $constructor("$ZodIntersection", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    const left = def.left._zod.run({ value: input, issues: [] }, ctx);
    const right = def.right._zod.run({ value: input, issues: [] }, ctx);
    const async = left instanceof Promise || right instanceof Promise;
    if (async) {
      return Promise.all([left, right]).then(([left, right]) => {
        return handleIntersectionResults(payload, left, right);
      });
    }
    return handleIntersectionResults(payload, left, right);
  };
});
function mergeValues(a, b) {
  if (a === b) {
    return { valid: true, data: a };
  }
  if (a instanceof Date && b instanceof Date && +a === +b) {
    return { valid: true, data: a };
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const bKeys = Object.keys(b);
    const sharedKeys = Object.keys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a, ...b };
    for (const key of sharedKeys) {
      const sharedValue = mergeValues(a[key], b[key]);
      if (!sharedValue.valid) {
        return {
          valid: false,
          mergeErrorPath: [key, ...sharedValue.mergeErrorPath]
        };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return { valid: false, mergeErrorPath: [] };
    }
    const newArray = [];
    for (let index = 0;index < a.length; index++) {
      const itemA = a[index];
      const itemB = b[index];
      const sharedValue = mergeValues(itemA, itemB);
      if (!sharedValue.valid) {
        return {
          valid: false,
          mergeErrorPath: [index, ...sharedValue.mergeErrorPath]
        };
      }
      newArray.push(sharedValue.data);
    }
    return { valid: true, data: newArray };
  }
  return { valid: false, mergeErrorPath: [] };
}
function handleIntersectionResults(result, left, right) {
  const unrecKeys = new Map;
  let unrecIssue;
  for (const iss of left.issues) {
    if (iss.code === "unrecognized_keys") {
      unrecIssue ?? (unrecIssue = iss);
      for (const k of iss.keys) {
        if (!unrecKeys.has(k))
          unrecKeys.set(k, {});
        unrecKeys.get(k).l = true;
      }
    } else {
      result.issues.push(iss);
    }
  }
  for (const iss of right.issues) {
    if (iss.code === "unrecognized_keys") {
      for (const k of iss.keys) {
        if (!unrecKeys.has(k))
          unrecKeys.set(k, {});
        unrecKeys.get(k).r = true;
      }
    } else {
      result.issues.push(iss);
    }
  }
  const bothKeys = [...unrecKeys].filter(([, f]) => f.l && f.r).map(([k]) => k);
  if (bothKeys.length && unrecIssue) {
    result.issues.push({ ...unrecIssue, keys: bothKeys });
  }
  if (aborted(result))
    return result;
  const merged = mergeValues(left.value, right.value);
  if (!merged.valid) {
    throw new Error(`Unmergable intersection. Error path: ` + `${JSON.stringify(merged.mergeErrorPath)}`);
  }
  result.value = merged.data;
  return result;
}
var $ZodEnum = /* @__PURE__ */ $constructor("$ZodEnum", (inst, def) => {
  $ZodType.init(inst, def);
  const values = getEnumValues(def.entries);
  const valuesSet = new Set(values);
  inst._zod.values = valuesSet;
  inst._zod.pattern = new RegExp(`^(${values.filter((k) => propertyKeyTypes.has(typeof k)).map((o) => typeof o === "string" ? escapeRegex(o) : o.toString()).join("|")})$`);
  inst._zod.parse = (payload, _ctx) => {
    const input = payload.value;
    if (valuesSet.has(input)) {
      return payload;
    }
    payload.issues.push({
      code: "invalid_value",
      values,
      input,
      inst
    });
    return payload;
  };
});
var $ZodTransform = /* @__PURE__ */ $constructor("$ZodTransform", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      throw new $ZodEncodeError(inst.constructor.name);
    }
    const _out = def.transform(payload.value, payload);
    if (ctx.async) {
      const output = _out instanceof Promise ? _out : Promise.resolve(_out);
      return output.then((output) => {
        payload.value = output;
        return payload;
      });
    }
    if (_out instanceof Promise) {
      throw new $ZodAsyncError;
    }
    payload.value = _out;
    return payload;
  };
});
function handleOptionalResult(result, input) {
  if (result.issues.length && input === undefined) {
    return { issues: [], value: undefined };
  }
  return result;
}
var $ZodOptional = /* @__PURE__ */ $constructor("$ZodOptional", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  inst._zod.optout = "optional";
  defineLazy(inst._zod, "values", () => {
    return def.innerType._zod.values ? new Set([...def.innerType._zod.values, undefined]) : undefined;
  });
  defineLazy(inst._zod, "pattern", () => {
    const pattern = def.innerType._zod.pattern;
    return pattern ? new RegExp(`^(${cleanRegex(pattern.source)})?$`) : undefined;
  });
  inst._zod.parse = (payload, ctx) => {
    if (def.innerType._zod.optin === "optional") {
      const result = def.innerType._zod.run(payload, ctx);
      if (result instanceof Promise)
        return result.then((r) => handleOptionalResult(r, payload.value));
      return handleOptionalResult(result, payload.value);
    }
    if (payload.value === undefined) {
      return payload;
    }
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodExactOptional = /* @__PURE__ */ $constructor("$ZodExactOptional", (inst, def) => {
  $ZodOptional.init(inst, def);
  defineLazy(inst._zod, "values", () => def.innerType._zod.values);
  defineLazy(inst._zod, "pattern", () => def.innerType._zod.pattern);
  inst._zod.parse = (payload, ctx) => {
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodNullable = /* @__PURE__ */ $constructor("$ZodNullable", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "optin", () => def.innerType._zod.optin);
  defineLazy(inst._zod, "optout", () => def.innerType._zod.optout);
  defineLazy(inst._zod, "pattern", () => {
    const pattern = def.innerType._zod.pattern;
    return pattern ? new RegExp(`^(${cleanRegex(pattern.source)}|null)$`) : undefined;
  });
  defineLazy(inst._zod, "values", () => {
    return def.innerType._zod.values ? new Set([...def.innerType._zod.values, null]) : undefined;
  });
  inst._zod.parse = (payload, ctx) => {
    if (payload.value === null)
      return payload;
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodDefault = /* @__PURE__ */ $constructor("$ZodDefault", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  defineLazy(inst._zod, "values", () => def.innerType._zod.values);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    if (payload.value === undefined) {
      payload.value = def.defaultValue;
      return payload;
    }
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then((result) => handleDefaultResult(result, def));
    }
    return handleDefaultResult(result, def);
  };
});
function handleDefaultResult(payload, def) {
  if (payload.value === undefined) {
    payload.value = def.defaultValue;
  }
  return payload;
}
var $ZodPrefault = /* @__PURE__ */ $constructor("$ZodPrefault", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  defineLazy(inst._zod, "values", () => def.innerType._zod.values);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    if (payload.value === undefined) {
      payload.value = def.defaultValue;
    }
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodNonOptional = /* @__PURE__ */ $constructor("$ZodNonOptional", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "values", () => {
    const v = def.innerType._zod.values;
    return v ? new Set([...v].filter((x) => x !== undefined)) : undefined;
  });
  inst._zod.parse = (payload, ctx) => {
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then((result) => handleNonOptionalResult(result, inst));
    }
    return handleNonOptionalResult(result, inst);
  };
});
function handleNonOptionalResult(payload, inst) {
  if (!payload.issues.length && payload.value === undefined) {
    payload.issues.push({
      code: "invalid_type",
      expected: "nonoptional",
      input: payload.value,
      inst
    });
  }
  return payload;
}
var $ZodCatch = /* @__PURE__ */ $constructor("$ZodCatch", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "optin", () => def.innerType._zod.optin);
  defineLazy(inst._zod, "optout", () => def.innerType._zod.optout);
  defineLazy(inst._zod, "values", () => def.innerType._zod.values);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then((result) => {
        payload.value = result.value;
        if (result.issues.length) {
          payload.value = def.catchValue({
            ...payload,
            error: {
              issues: result.issues.map((iss) => finalizeIssue(iss, ctx, config()))
            },
            input: payload.value
          });
          payload.issues = [];
        }
        return payload;
      });
    }
    payload.value = result.value;
    if (result.issues.length) {
      payload.value = def.catchValue({
        ...payload,
        error: {
          issues: result.issues.map((iss) => finalizeIssue(iss, ctx, config()))
        },
        input: payload.value
      });
      payload.issues = [];
    }
    return payload;
  };
});
var $ZodPipe = /* @__PURE__ */ $constructor("$ZodPipe", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "values", () => def.in._zod.values);
  defineLazy(inst._zod, "optin", () => def.in._zod.optin);
  defineLazy(inst._zod, "optout", () => def.out._zod.optout);
  defineLazy(inst._zod, "propValues", () => def.in._zod.propValues);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      const right = def.out._zod.run(payload, ctx);
      if (right instanceof Promise) {
        return right.then((right) => handlePipeResult(right, def.in, ctx));
      }
      return handlePipeResult(right, def.in, ctx);
    }
    const left = def.in._zod.run(payload, ctx);
    if (left instanceof Promise) {
      return left.then((left) => handlePipeResult(left, def.out, ctx));
    }
    return handlePipeResult(left, def.out, ctx);
  };
});
function handlePipeResult(left, next, ctx) {
  if (left.issues.length) {
    left.aborted = true;
    return left;
  }
  return next._zod.run({ value: left.value, issues: left.issues }, ctx);
}
var $ZodReadonly = /* @__PURE__ */ $constructor("$ZodReadonly", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "propValues", () => def.innerType._zod.propValues);
  defineLazy(inst._zod, "values", () => def.innerType._zod.values);
  defineLazy(inst._zod, "optin", () => def.innerType?._zod?.optin);
  defineLazy(inst._zod, "optout", () => def.innerType?._zod?.optout);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then(handleReadonlyResult);
    }
    return handleReadonlyResult(result);
  };
});
function handleReadonlyResult(payload) {
  payload.value = Object.freeze(payload.value);
  return payload;
}
var $ZodCustom = /* @__PURE__ */ $constructor("$ZodCustom", (inst, def) => {
  $ZodCheck.init(inst, def);
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, _) => {
    return payload;
  };
  inst._zod.check = (payload) => {
    const input = payload.value;
    const r = def.fn(input);
    if (r instanceof Promise) {
      return r.then((r) => handleRefineResult(r, payload, input, inst));
    }
    handleRefineResult(r, payload, input, inst);
    return;
  };
});
function handleRefineResult(result, payload, input, inst) {
  if (!result) {
    const _iss = {
      code: "custom",
      input,
      inst,
      path: [...inst._zod.def.path ?? []],
      continue: !inst._zod.def.abort
    };
    if (inst._zod.def.params)
      _iss.params = inst._zod.def.params;
    payload.issues.push(issue(_iss));
  }
}
// ../../../../../node_modules/.bun/zod@4.3.6/node_modules/zod/v4/core/registries.js
var _a;
var $output = Symbol("ZodOutput");
var $input = Symbol("ZodInput");

class $ZodRegistry {
  constructor() {
    this._map = new WeakMap;
    this._idmap = new Map;
  }
  add(schema, ..._meta) {
    const meta = _meta[0];
    this._map.set(schema, meta);
    if (meta && typeof meta === "object" && "id" in meta) {
      this._idmap.set(meta.id, schema);
    }
    return this;
  }
  clear() {
    this._map = new WeakMap;
    this._idmap = new Map;
    return this;
  }
  remove(schema) {
    const meta = this._map.get(schema);
    if (meta && typeof meta === "object" && "id" in meta) {
      this._idmap.delete(meta.id);
    }
    this._map.delete(schema);
    return this;
  }
  get(schema) {
    const p = schema._zod.parent;
    if (p) {
      const pm = { ...this.get(p) ?? {} };
      delete pm.id;
      const f = { ...pm, ...this._map.get(schema) };
      return Object.keys(f).length ? f : undefined;
    }
    return this._map.get(schema);
  }
  has(schema) {
    return this._map.has(schema);
  }
}
function registry() {
  return new $ZodRegistry;
}
(_a = globalThis).__zod_globalRegistry ?? (_a.__zod_globalRegistry = registry());
var globalRegistry = globalThis.__zod_globalRegistry;
// ../../../../../node_modules/.bun/zod@4.3.6/node_modules/zod/v4/core/api.js
function _maxLength(maximum, params) {
  const ch = new $ZodCheckMaxLength({
    check: "max_length",
    ...normalizeParams(params),
    maximum
  });
  return ch;
}
function _minLength(minimum, params) {
  return new $ZodCheckMinLength({
    check: "min_length",
    ...normalizeParams(params),
    minimum
  });
}
function _length(length, params) {
  return new $ZodCheckLengthEquals({
    check: "length_equals",
    ...normalizeParams(params),
    length
  });
}
function _overwrite(tx) {
  return new $ZodCheckOverwrite({
    check: "overwrite",
    tx
  });
}
function _array(Class, element, params) {
  return new Class({
    type: "array",
    element,
    ...normalizeParams(params)
  });
}
function _refine(Class, fn, _params) {
  const schema = new Class({
    type: "custom",
    check: "custom",
    fn,
    ...normalizeParams(_params)
  });
  return schema;
}
function _superRefine(fn) {
  const ch = _check((payload) => {
    payload.addIssue = (issue2) => {
      if (typeof issue2 === "string") {
        payload.issues.push(issue(issue2, payload.value, ch._zod.def));
      } else {
        const _issue = issue2;
        if (_issue.fatal)
          _issue.continue = false;
        _issue.code ?? (_issue.code = "custom");
        _issue.input ?? (_issue.input = payload.value);
        _issue.inst ?? (_issue.inst = ch);
        _issue.continue ?? (_issue.continue = !ch._zod.def.abort);
        payload.issues.push(issue(_issue));
      }
    };
    return fn(payload.value, payload);
  });
  return ch;
}
function _check(fn, params) {
  const ch = new $ZodCheck({
    check: "custom",
    ...normalizeParams(params)
  });
  ch._zod.check = fn;
  return ch;
}
// ../../../../../node_modules/.bun/zod@4.3.6/node_modules/zod/v4/core/to-json-schema.js
function initializeContext(params) {
  let target = params?.target ?? "draft-2020-12";
  if (target === "draft-4")
    target = "draft-04";
  if (target === "draft-7")
    target = "draft-07";
  return {
    processors: params.processors ?? {},
    metadataRegistry: params?.metadata ?? globalRegistry,
    target,
    unrepresentable: params?.unrepresentable ?? "throw",
    override: params?.override ?? (() => {}),
    io: params?.io ?? "output",
    counter: 0,
    seen: new Map,
    cycles: params?.cycles ?? "ref",
    reused: params?.reused ?? "inline",
    external: params?.external ?? undefined
  };
}
function process2(schema, ctx, _params = { path: [], schemaPath: [] }) {
  var _a;
  const def = schema._zod.def;
  const seen = ctx.seen.get(schema);
  if (seen) {
    seen.count++;
    const isCycle = _params.schemaPath.includes(schema);
    if (isCycle) {
      seen.cycle = _params.path;
    }
    return seen.schema;
  }
  const result = { schema: {}, count: 1, cycle: undefined, path: _params.path };
  ctx.seen.set(schema, result);
  const overrideSchema = schema._zod.toJSONSchema?.();
  if (overrideSchema) {
    result.schema = overrideSchema;
  } else {
    const params = {
      ..._params,
      schemaPath: [..._params.schemaPath, schema],
      path: _params.path
    };
    if (schema._zod.processJSONSchema) {
      schema._zod.processJSONSchema(ctx, result.schema, params);
    } else {
      const _json = result.schema;
      const processor = ctx.processors[def.type];
      if (!processor) {
        throw new Error(`[toJSONSchema]: Non-representable type encountered: ${def.type}`);
      }
      processor(schema, ctx, _json, params);
    }
    const parent = schema._zod.parent;
    if (parent) {
      if (!result.ref)
        result.ref = parent;
      process2(parent, ctx, params);
      ctx.seen.get(parent).isParent = true;
    }
  }
  const meta = ctx.metadataRegistry.get(schema);
  if (meta)
    Object.assign(result.schema, meta);
  if (ctx.io === "input" && isTransforming(schema)) {
    delete result.schema.examples;
    delete result.schema.default;
  }
  if (ctx.io === "input" && result.schema._prefault)
    (_a = result.schema).default ?? (_a.default = result.schema._prefault);
  delete result.schema._prefault;
  const _result = ctx.seen.get(schema);
  return _result.schema;
}
function extractDefs(ctx, schema) {
  const root = ctx.seen.get(schema);
  if (!root)
    throw new Error("Unprocessed schema. This is a bug in Zod.");
  const idToSchema = new Map;
  for (const entry of ctx.seen.entries()) {
    const id = ctx.metadataRegistry.get(entry[0])?.id;
    if (id) {
      const existing = idToSchema.get(id);
      if (existing && existing !== entry[0]) {
        throw new Error(`Duplicate schema id "${id}" detected during JSON Schema conversion. Two different schemas cannot share the same id when converted together.`);
      }
      idToSchema.set(id, entry[0]);
    }
  }
  const makeURI = (entry) => {
    const defsSegment = ctx.target === "draft-2020-12" ? "$defs" : "definitions";
    if (ctx.external) {
      const externalId = ctx.external.registry.get(entry[0])?.id;
      const uriGenerator = ctx.external.uri ?? ((id) => id);
      if (externalId) {
        return { ref: uriGenerator(externalId) };
      }
      const id = entry[1].defId ?? entry[1].schema.id ?? `schema${ctx.counter++}`;
      entry[1].defId = id;
      return { defId: id, ref: `${uriGenerator("__shared")}#/${defsSegment}/${id}` };
    }
    if (entry[1] === root) {
      return { ref: "#" };
    }
    const uriPrefix = `#`;
    const defUriPrefix = `${uriPrefix}/${defsSegment}/`;
    const defId = entry[1].schema.id ?? `__schema${ctx.counter++}`;
    return { defId, ref: defUriPrefix + defId };
  };
  const extractToDef = (entry) => {
    if (entry[1].schema.$ref) {
      return;
    }
    const seen = entry[1];
    const { ref, defId } = makeURI(entry);
    seen.def = { ...seen.schema };
    if (defId)
      seen.defId = defId;
    const schema = seen.schema;
    for (const key in schema) {
      delete schema[key];
    }
    schema.$ref = ref;
  };
  if (ctx.cycles === "throw") {
    for (const entry of ctx.seen.entries()) {
      const seen = entry[1];
      if (seen.cycle) {
        throw new Error("Cycle detected: " + `#/${seen.cycle?.join("/")}/<root>` + '\n\nSet the `cycles` parameter to `"ref"` to resolve cyclical schemas with defs.');
      }
    }
  }
  for (const entry of ctx.seen.entries()) {
    const seen = entry[1];
    if (schema === entry[0]) {
      extractToDef(entry);
      continue;
    }
    if (ctx.external) {
      const ext = ctx.external.registry.get(entry[0])?.id;
      if (schema !== entry[0] && ext) {
        extractToDef(entry);
        continue;
      }
    }
    const id = ctx.metadataRegistry.get(entry[0])?.id;
    if (id) {
      extractToDef(entry);
      continue;
    }
    if (seen.cycle) {
      extractToDef(entry);
      continue;
    }
    if (seen.count > 1) {
      if (ctx.reused === "ref") {
        extractToDef(entry);
        continue;
      }
    }
  }
}
function finalize(ctx, schema) {
  const root = ctx.seen.get(schema);
  if (!root)
    throw new Error("Unprocessed schema. This is a bug in Zod.");
  const flattenRef = (zodSchema) => {
    const seen = ctx.seen.get(zodSchema);
    if (seen.ref === null)
      return;
    const schema = seen.def ?? seen.schema;
    const _cached = { ...schema };
    const ref = seen.ref;
    seen.ref = null;
    if (ref) {
      flattenRef(ref);
      const refSeen = ctx.seen.get(ref);
      const refSchema = refSeen.schema;
      if (refSchema.$ref && (ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0")) {
        schema.allOf = schema.allOf ?? [];
        schema.allOf.push(refSchema);
      } else {
        Object.assign(schema, refSchema);
      }
      Object.assign(schema, _cached);
      const isParentRef = zodSchema._zod.parent === ref;
      if (isParentRef) {
        for (const key in schema) {
          if (key === "$ref" || key === "allOf")
            continue;
          if (!(key in _cached)) {
            delete schema[key];
          }
        }
      }
      if (refSchema.$ref && refSeen.def) {
        for (const key in schema) {
          if (key === "$ref" || key === "allOf")
            continue;
          if (key in refSeen.def && JSON.stringify(schema[key]) === JSON.stringify(refSeen.def[key])) {
            delete schema[key];
          }
        }
      }
    }
    const parent = zodSchema._zod.parent;
    if (parent && parent !== ref) {
      flattenRef(parent);
      const parentSeen = ctx.seen.get(parent);
      if (parentSeen?.schema.$ref) {
        schema.$ref = parentSeen.schema.$ref;
        if (parentSeen.def) {
          for (const key in schema) {
            if (key === "$ref" || key === "allOf")
              continue;
            if (key in parentSeen.def && JSON.stringify(schema[key]) === JSON.stringify(parentSeen.def[key])) {
              delete schema[key];
            }
          }
        }
      }
    }
    ctx.override({
      zodSchema,
      jsonSchema: schema,
      path: seen.path ?? []
    });
  };
  for (const entry of [...ctx.seen.entries()].reverse()) {
    flattenRef(entry[0]);
  }
  const result = {};
  if (ctx.target === "draft-2020-12") {
    result.$schema = "https://json-schema.org/draft/2020-12/schema";
  } else if (ctx.target === "draft-07") {
    result.$schema = "http://json-schema.org/draft-07/schema#";
  } else if (ctx.target === "draft-04") {
    result.$schema = "http://json-schema.org/draft-04/schema#";
  } else if (ctx.target === "openapi-3.0") {}
  if (ctx.external?.uri) {
    const id = ctx.external.registry.get(schema)?.id;
    if (!id)
      throw new Error("Schema is missing an `id` property");
    result.$id = ctx.external.uri(id);
  }
  Object.assign(result, root.def ?? root.schema);
  const defs = ctx.external?.defs ?? {};
  for (const entry of ctx.seen.entries()) {
    const seen = entry[1];
    if (seen.def && seen.defId) {
      defs[seen.defId] = seen.def;
    }
  }
  if (ctx.external) {} else {
    if (Object.keys(defs).length > 0) {
      if (ctx.target === "draft-2020-12") {
        result.$defs = defs;
      } else {
        result.definitions = defs;
      }
    }
  }
  try {
    const finalized = JSON.parse(JSON.stringify(result));
    Object.defineProperty(finalized, "~standard", {
      value: {
        ...schema["~standard"],
        jsonSchema: {
          input: createStandardJSONSchemaMethod(schema, "input", ctx.processors),
          output: createStandardJSONSchemaMethod(schema, "output", ctx.processors)
        }
      },
      enumerable: false,
      writable: false
    });
    return finalized;
  } catch (_err) {
    throw new Error("Error converting schema to JSON.");
  }
}
function isTransforming(_schema, _ctx) {
  const ctx = _ctx ?? { seen: new Set };
  if (ctx.seen.has(_schema))
    return false;
  ctx.seen.add(_schema);
  const def = _schema._zod.def;
  if (def.type === "transform")
    return true;
  if (def.type === "array")
    return isTransforming(def.element, ctx);
  if (def.type === "set")
    return isTransforming(def.valueType, ctx);
  if (def.type === "lazy")
    return isTransforming(def.getter(), ctx);
  if (def.type === "promise" || def.type === "optional" || def.type === "nonoptional" || def.type === "nullable" || def.type === "readonly" || def.type === "default" || def.type === "prefault") {
    return isTransforming(def.innerType, ctx);
  }
  if (def.type === "intersection") {
    return isTransforming(def.left, ctx) || isTransforming(def.right, ctx);
  }
  if (def.type === "record" || def.type === "map") {
    return isTransforming(def.keyType, ctx) || isTransforming(def.valueType, ctx);
  }
  if (def.type === "pipe") {
    return isTransforming(def.in, ctx) || isTransforming(def.out, ctx);
  }
  if (def.type === "object") {
    for (const key in def.shape) {
      if (isTransforming(def.shape[key], ctx))
        return true;
    }
    return false;
  }
  if (def.type === "union") {
    for (const option of def.options) {
      if (isTransforming(option, ctx))
        return true;
    }
    return false;
  }
  if (def.type === "tuple") {
    for (const item of def.items) {
      if (isTransforming(item, ctx))
        return true;
    }
    if (def.rest && isTransforming(def.rest, ctx))
      return true;
    return false;
  }
  return false;
}
var createToJSONSchemaMethod = (schema, processors = {}) => (params) => {
  const ctx = initializeContext({ ...params, processors });
  process2(schema, ctx);
  extractDefs(ctx, schema);
  return finalize(ctx, schema);
};
var createStandardJSONSchemaMethod = (schema, io, processors = {}) => (params) => {
  const { libraryOptions, target } = params ?? {};
  const ctx = initializeContext({ ...libraryOptions ?? {}, target, io, processors });
  process2(schema, ctx);
  extractDefs(ctx, schema);
  return finalize(ctx, schema);
};
// ../../../../../node_modules/.bun/zod@4.3.6/node_modules/zod/v4/core/json-schema-processors.js
var enumProcessor = (schema, _ctx, json, _params) => {
  const def = schema._zod.def;
  const values = getEnumValues(def.entries);
  if (values.every((v) => typeof v === "number"))
    json.type = "number";
  if (values.every((v) => typeof v === "string"))
    json.type = "string";
  json.enum = values;
};
var customProcessor = (_schema, ctx, _json, _params) => {
  if (ctx.unrepresentable === "throw") {
    throw new Error("Custom types cannot be represented in JSON Schema");
  }
};
var transformProcessor = (_schema, ctx, _json, _params) => {
  if (ctx.unrepresentable === "throw") {
    throw new Error("Transforms cannot be represented in JSON Schema");
  }
};
var arrayProcessor = (schema, ctx, _json, params) => {
  const json = _json;
  const def = schema._zod.def;
  const { minimum, maximum } = schema._zod.bag;
  if (typeof minimum === "number")
    json.minItems = minimum;
  if (typeof maximum === "number")
    json.maxItems = maximum;
  json.type = "array";
  json.items = process2(def.element, ctx, { ...params, path: [...params.path, "items"] });
};
var unionProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  const isExclusive = def.inclusive === false;
  const options = def.options.map((x, i) => process2(x, ctx, {
    ...params,
    path: [...params.path, isExclusive ? "oneOf" : "anyOf", i]
  }));
  if (isExclusive) {
    json.oneOf = options;
  } else {
    json.anyOf = options;
  }
};
var intersectionProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  const a = process2(def.left, ctx, {
    ...params,
    path: [...params.path, "allOf", 0]
  });
  const b = process2(def.right, ctx, {
    ...params,
    path: [...params.path, "allOf", 1]
  });
  const isSimpleIntersection = (val) => ("allOf" in val) && Object.keys(val).length === 1;
  const allOf = [
    ...isSimpleIntersection(a) ? a.allOf : [a],
    ...isSimpleIntersection(b) ? b.allOf : [b]
  ];
  json.allOf = allOf;
};
var nullableProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  const inner = process2(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  if (ctx.target === "openapi-3.0") {
    seen.ref = def.innerType;
    json.nullable = true;
  } else {
    json.anyOf = [inner, { type: "null" }];
  }
};
var nonoptionalProcessor = (schema, ctx, _json, params) => {
  const def = schema._zod.def;
  process2(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
};
var defaultProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  process2(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  json.default = JSON.parse(JSON.stringify(def.defaultValue));
};
var prefaultProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  process2(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  if (ctx.io === "input")
    json._prefault = JSON.parse(JSON.stringify(def.defaultValue));
};
var catchProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  process2(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  let catchValue;
  try {
    catchValue = def.catchValue(undefined);
  } catch {
    throw new Error("Dynamic catch values are not supported in JSON Schema");
  }
  json.default = catchValue;
};
var pipeProcessor = (schema, ctx, _json, params) => {
  const def = schema._zod.def;
  const innerType = ctx.io === "input" ? def.in._zod.def.type === "transform" ? def.out : def.in : def.out;
  process2(innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = innerType;
};
var readonlyProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  process2(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  json.readOnly = true;
};
var optionalProcessor = (schema, ctx, _json, params) => {
  const def = schema._zod.def;
  process2(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
};
// ../../../../../node_modules/.bun/zod@4.3.6/node_modules/zod/v4/classic/errors.js
var initializer2 = (inst, issues) => {
  $ZodError.init(inst, issues);
  inst.name = "ZodError";
  Object.defineProperties(inst, {
    format: {
      value: (mapper) => formatError(inst, mapper)
    },
    flatten: {
      value: (mapper) => flattenError(inst, mapper)
    },
    addIssue: {
      value: (issue) => {
        inst.issues.push(issue);
        inst.message = JSON.stringify(inst.issues, jsonStringifyReplacer, 2);
      }
    },
    addIssues: {
      value: (issues) => {
        inst.issues.push(...issues);
        inst.message = JSON.stringify(inst.issues, jsonStringifyReplacer, 2);
      }
    },
    isEmpty: {
      get() {
        return inst.issues.length === 0;
      }
    }
  });
};
var ZodError = $constructor("ZodError", initializer2);
var ZodRealError = $constructor("ZodError", initializer2, {
  Parent: Error
});

// ../../../../../node_modules/.bun/zod@4.3.6/node_modules/zod/v4/classic/parse.js
var parse3 = /* @__PURE__ */ _parse(ZodRealError);
var parseAsync2 = /* @__PURE__ */ _parseAsync(ZodRealError);
var safeParse2 = /* @__PURE__ */ _safeParse(ZodRealError);
var safeParseAsync2 = /* @__PURE__ */ _safeParseAsync(ZodRealError);
var encode = /* @__PURE__ */ _encode(ZodRealError);
var decode = /* @__PURE__ */ _decode(ZodRealError);
var encodeAsync = /* @__PURE__ */ _encodeAsync(ZodRealError);
var decodeAsync = /* @__PURE__ */ _decodeAsync(ZodRealError);
var safeEncode = /* @__PURE__ */ _safeEncode(ZodRealError);
var safeDecode = /* @__PURE__ */ _safeDecode(ZodRealError);
var safeEncodeAsync = /* @__PURE__ */ _safeEncodeAsync(ZodRealError);
var safeDecodeAsync = /* @__PURE__ */ _safeDecodeAsync(ZodRealError);

// ../../../../../node_modules/.bun/zod@4.3.6/node_modules/zod/v4/classic/schemas.js
var ZodType = /* @__PURE__ */ $constructor("ZodType", (inst, def) => {
  $ZodType.init(inst, def);
  Object.assign(inst["~standard"], {
    jsonSchema: {
      input: createStandardJSONSchemaMethod(inst, "input"),
      output: createStandardJSONSchemaMethod(inst, "output")
    }
  });
  inst.toJSONSchema = createToJSONSchemaMethod(inst, {});
  inst.def = def;
  inst.type = def.type;
  Object.defineProperty(inst, "_def", { value: def });
  inst.check = (...checks) => {
    return inst.clone(mergeDefs(def, {
      checks: [
        ...def.checks ?? [],
        ...checks.map((ch) => typeof ch === "function" ? { _zod: { check: ch, def: { check: "custom" }, onattach: [] } } : ch)
      ]
    }), {
      parent: true
    });
  };
  inst.with = inst.check;
  inst.clone = (def, params) => clone(inst, def, params);
  inst.brand = () => inst;
  inst.register = (reg, meta) => {
    reg.add(inst, meta);
    return inst;
  };
  inst.parse = (data, params) => parse3(inst, data, params, { callee: inst.parse });
  inst.safeParse = (data, params) => safeParse2(inst, data, params);
  inst.parseAsync = async (data, params) => parseAsync2(inst, data, params, { callee: inst.parseAsync });
  inst.safeParseAsync = async (data, params) => safeParseAsync2(inst, data, params);
  inst.spa = inst.safeParseAsync;
  inst.encode = (data, params) => encode(inst, data, params);
  inst.decode = (data, params) => decode(inst, data, params);
  inst.encodeAsync = async (data, params) => encodeAsync(inst, data, params);
  inst.decodeAsync = async (data, params) => decodeAsync(inst, data, params);
  inst.safeEncode = (data, params) => safeEncode(inst, data, params);
  inst.safeDecode = (data, params) => safeDecode(inst, data, params);
  inst.safeEncodeAsync = async (data, params) => safeEncodeAsync(inst, data, params);
  inst.safeDecodeAsync = async (data, params) => safeDecodeAsync(inst, data, params);
  inst.refine = (check, params) => inst.check(refine(check, params));
  inst.superRefine = (refinement) => inst.check(superRefine(refinement));
  inst.overwrite = (fn) => inst.check(_overwrite(fn));
  inst.optional = () => optional(inst);
  inst.exactOptional = () => exactOptional(inst);
  inst.nullable = () => nullable(inst);
  inst.nullish = () => optional(nullable(inst));
  inst.nonoptional = (params) => nonoptional(inst, params);
  inst.array = () => array(inst);
  inst.or = (arg) => union([inst, arg]);
  inst.and = (arg) => intersection(inst, arg);
  inst.transform = (tx) => pipe(inst, transform(tx));
  inst.default = (def) => _default(inst, def);
  inst.prefault = (def) => prefault(inst, def);
  inst.catch = (params) => _catch(inst, params);
  inst.pipe = (target) => pipe(inst, target);
  inst.readonly = () => readonly(inst);
  inst.describe = (description) => {
    const cl = inst.clone();
    globalRegistry.add(cl, { description });
    return cl;
  };
  Object.defineProperty(inst, "description", {
    get() {
      return globalRegistry.get(inst)?.description;
    },
    configurable: true
  });
  inst.meta = (...args) => {
    if (args.length === 0) {
      return globalRegistry.get(inst);
    }
    const cl = inst.clone();
    globalRegistry.add(cl, args[0]);
    return cl;
  };
  inst.isOptional = () => inst.safeParse(undefined).success;
  inst.isNullable = () => inst.safeParse(null).success;
  inst.apply = (fn) => fn(inst);
  return inst;
});
var ZodArray = /* @__PURE__ */ $constructor("ZodArray", (inst, def) => {
  $ZodArray.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => arrayProcessor(inst, ctx, json, params);
  inst.element = def.element;
  inst.min = (minLength, params) => inst.check(_minLength(minLength, params));
  inst.nonempty = (params) => inst.check(_minLength(1, params));
  inst.max = (maxLength, params) => inst.check(_maxLength(maxLength, params));
  inst.length = (len, params) => inst.check(_length(len, params));
  inst.unwrap = () => inst.element;
});
function array(element, params) {
  return _array(ZodArray, element, params);
}
var ZodUnion = /* @__PURE__ */ $constructor("ZodUnion", (inst, def) => {
  $ZodUnion.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => unionProcessor(inst, ctx, json, params);
  inst.options = def.options;
});
function union(options, params) {
  return new ZodUnion({
    type: "union",
    options,
    ...normalizeParams(params)
  });
}
var ZodIntersection = /* @__PURE__ */ $constructor("ZodIntersection", (inst, def) => {
  $ZodIntersection.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => intersectionProcessor(inst, ctx, json, params);
});
function intersection(left, right) {
  return new ZodIntersection({
    type: "intersection",
    left,
    right
  });
}
var ZodEnum = /* @__PURE__ */ $constructor("ZodEnum", (inst, def) => {
  $ZodEnum.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => enumProcessor(inst, ctx, json, params);
  inst.enum = def.entries;
  inst.options = Object.values(def.entries);
  const keys = new Set(Object.keys(def.entries));
  inst.extract = (values, params) => {
    const newEntries = {};
    for (const value of values) {
      if (keys.has(value)) {
        newEntries[value] = def.entries[value];
      } else
        throw new Error(`Key ${value} not found in enum`);
    }
    return new ZodEnum({
      ...def,
      checks: [],
      ...normalizeParams(params),
      entries: newEntries
    });
  };
  inst.exclude = (values, params) => {
    const newEntries = { ...def.entries };
    for (const value of values) {
      if (keys.has(value)) {
        delete newEntries[value];
      } else
        throw new Error(`Key ${value} not found in enum`);
    }
    return new ZodEnum({
      ...def,
      checks: [],
      ...normalizeParams(params),
      entries: newEntries
    });
  };
});
function _enum(values, params) {
  const entries = Array.isArray(values) ? Object.fromEntries(values.map((v) => [v, v])) : values;
  return new ZodEnum({
    type: "enum",
    entries,
    ...normalizeParams(params)
  });
}
var ZodTransform = /* @__PURE__ */ $constructor("ZodTransform", (inst, def) => {
  $ZodTransform.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => transformProcessor(inst, ctx, json, params);
  inst._zod.parse = (payload, _ctx) => {
    if (_ctx.direction === "backward") {
      throw new $ZodEncodeError(inst.constructor.name);
    }
    payload.addIssue = (issue2) => {
      if (typeof issue2 === "string") {
        payload.issues.push(issue(issue2, payload.value, def));
      } else {
        const _issue = issue2;
        if (_issue.fatal)
          _issue.continue = false;
        _issue.code ?? (_issue.code = "custom");
        _issue.input ?? (_issue.input = payload.value);
        _issue.inst ?? (_issue.inst = inst);
        payload.issues.push(issue(_issue));
      }
    };
    const output = def.transform(payload.value, payload);
    if (output instanceof Promise) {
      return output.then((output) => {
        payload.value = output;
        return payload;
      });
    }
    payload.value = output;
    return payload;
  };
});
function transform(fn) {
  return new ZodTransform({
    type: "transform",
    transform: fn
  });
}
var ZodOptional = /* @__PURE__ */ $constructor("ZodOptional", (inst, def) => {
  $ZodOptional.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function optional(innerType) {
  return new ZodOptional({
    type: "optional",
    innerType
  });
}
var ZodExactOptional = /* @__PURE__ */ $constructor("ZodExactOptional", (inst, def) => {
  $ZodExactOptional.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function exactOptional(innerType) {
  return new ZodExactOptional({
    type: "optional",
    innerType
  });
}
var ZodNullable = /* @__PURE__ */ $constructor("ZodNullable", (inst, def) => {
  $ZodNullable.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => nullableProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function nullable(innerType) {
  return new ZodNullable({
    type: "nullable",
    innerType
  });
}
var ZodDefault = /* @__PURE__ */ $constructor("ZodDefault", (inst, def) => {
  $ZodDefault.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => defaultProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
  inst.removeDefault = inst.unwrap;
});
function _default(innerType, defaultValue) {
  return new ZodDefault({
    type: "default",
    innerType,
    get defaultValue() {
      return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
    }
  });
}
var ZodPrefault = /* @__PURE__ */ $constructor("ZodPrefault", (inst, def) => {
  $ZodPrefault.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => prefaultProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function prefault(innerType, defaultValue) {
  return new ZodPrefault({
    type: "prefault",
    innerType,
    get defaultValue() {
      return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
    }
  });
}
var ZodNonOptional = /* @__PURE__ */ $constructor("ZodNonOptional", (inst, def) => {
  $ZodNonOptional.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => nonoptionalProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function nonoptional(innerType, params) {
  return new ZodNonOptional({
    type: "nonoptional",
    innerType,
    ...normalizeParams(params)
  });
}
var ZodCatch = /* @__PURE__ */ $constructor("ZodCatch", (inst, def) => {
  $ZodCatch.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => catchProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
  inst.removeCatch = inst.unwrap;
});
function _catch(innerType, catchValue) {
  return new ZodCatch({
    type: "catch",
    innerType,
    catchValue: typeof catchValue === "function" ? catchValue : () => catchValue
  });
}
var ZodPipe = /* @__PURE__ */ $constructor("ZodPipe", (inst, def) => {
  $ZodPipe.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => pipeProcessor(inst, ctx, json, params);
  inst.in = def.in;
  inst.out = def.out;
});
function pipe(in_, out) {
  return new ZodPipe({
    type: "pipe",
    in: in_,
    out
  });
}
var ZodReadonly = /* @__PURE__ */ $constructor("ZodReadonly", (inst, def) => {
  $ZodReadonly.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => readonlyProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function readonly(innerType) {
  return new ZodReadonly({
    type: "readonly",
    innerType
  });
}
var ZodCustom = /* @__PURE__ */ $constructor("ZodCustom", (inst, def) => {
  $ZodCustom.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => customProcessor(inst, ctx, json, params);
});
function refine(fn, _params = {}) {
  return _refine(ZodCustom, fn, _params);
}
function superRefine(fn) {
  return _superRefine(fn);
}
// ../../../../omo-engine/omo-opencode/src/config/schema/agent-names.ts
var BuiltinAgentNameSchema = _enum([
  "sisyphus",
  "hephaestus",
  "prometheus",
  "oracle",
  "librarian",
  "explore",
  "multimodal-looker",
  "metis",
  "momus",
  "atlas",
  "sisyphus-junior",
  "plan-consultant",
  "plan-reviewer",
  "omo-native-code-reviewer",
  "omo-native-qa-executor",
  "omo-native-gate-reviewer"
]);
var BuiltinSkillNameSchema = _enum([
  "playwright",
  "dev-browser",
  "frontend",
  "git-master",
  "review-work",
  "remove-ai-slops",
  "init-deep",
  "debugging",
  "security-research",
  "security-review",
  "visual-qa",
  "team-mode"
]);
var OverridableAgentNameSchema = _enum([
  "build",
  "plan",
  "sisyphus",
  "hephaestus",
  "sisyphus-junior",
  "OpenCode-Builder",
  "prometheus",
  "metis",
  "momus",
  "oracle",
  "librarian",
  "explore",
  "multimodal-looker",
  "atlas",
  "plan-consultant",
  "plan-reviewer",
  "omo-native-code-reviewer",
  "omo-native-qa-executor",
  "omo-native-gate-reviewer"
]);

// ../../../../omo-engine/model-core/src/agent-model-requirements.ts
var AGENT_MODEL_REQUIREMENTS = {
  sisyphus: {
    fallbackChain: [
      {
        providers: ["anthropic", "github-copilot", "opencode"],
        model: "claude-opus-5-5",
        variant: "max"
      },
      {
        providers: ["opencode-go", "kimi-for-coding", "moonshotai", "opencode", "bailian-coding-plan", "moonshotai-cn", "firmware", "ollama-cloud", "aihubmix"],
        model: "kimi-k3"
      },
      {
        providers: ["openai", "chatgpt-subscription", "github-copilot", "opencode"],
        model: "gpt-5.6-sol",
        variant: "medium"
      },
      { providers: ["zai-coding-plan", "opencode", "bailian-coding-plan"], model: "glm-5.2" },
      { providers: ["opencode"], model: "big-pickle" }
    ],
    requiresAnyModel: true
  },
  hephaestus: {
    fallbackChain: [
      {
        providers: ["openai", "chatgpt-subscription", "github-copilot", "opencode"],
        model: "gpt-6-sol",
        variant: "medium"
      },
      {
        providers: ["openai", "chatgpt-subscription", "github-copilot", "opencode"],
        model: "gpt-5.6-sol",
        variant: "medium"
      }
    ],
    requiresProvider: ["openai", "chatgpt-subscription", "github-copilot", "opencode"],
    requiresAnyModel: true
  },
  oracle: {
    fallbackChain: [
      { providers: ["openai", "chatgpt-subscription", "opencode"], model: "gpt-5.6-sol", variant: "xhigh" },
      { providers: ["github-copilot"], model: "gpt-5.6-sol", variant: "high" },
      {
        providers: ["google", "github-copilot", "opencode"],
        model: "gemini-3.1-pro",
        variant: "high"
      },
      {
        providers: ["anthropic", "github-copilot", "opencode"],
        model: "claude-opus-5-5",
        variant: "max"
      },
      { providers: ["opencode-go"], model: "glm-5.2" }
    ]
  },
  librarian: {
    fallbackChain: [
      { providers: ["kimi-for-coding"], model: "kimi-for-coding-highspeed", variant: "off" },
      { providers: ["openai", "chatgpt-subscription"], model: "gpt-6-luna-fast", variant: "low" },
      { providers: ["deepseek"], model: "deepseek-flash", variant: "max" },
      { providers: ["opencode-go", "bailian-coding-plan"], model: "qwen3.7-plus" },
      { providers: ["opencode-go"], model: "minimax-m2.7" },
      { providers: ["anthropic", "github-copilot"], model: "claude-haiku-4-5" }
    ]
  },
  explore: {
    fallbackChain: [
      { providers: ["kimi-for-coding"], model: "kimi-for-coding-highspeed", variant: "off" },
      { providers: ["openai", "chatgpt-subscription"], model: "gpt-6-luna-fast", variant: "low" },
      { providers: ["deepseek"], model: "deepseek-flash", variant: "max" },
      { providers: ["opencode-go", "bailian-coding-plan"], model: "qwen3.7-plus" },
      { providers: ["opencode-go"], model: "minimax-m2.7" },
      { providers: ["anthropic", "github-copilot"], model: "claude-haiku-4-5" }
    ]
  },
  "multimodal-looker": {
    fallbackChain: [
      { providers: ["openai", "chatgpt-subscription", "opencode"], model: "gpt-5.6-sol", variant: "low" },
      { providers: ["opencode-go"], model: "kimi-k3" },
      { providers: ["zai-coding-plan"], model: "glm-4.6v" },
      { providers: ["openai", "chatgpt-subscription", "github-copilot", "opencode"], model: "gpt-5-nano" }
    ]
  },
  prometheus: {
    fallbackChain: [
      {
        providers: ["anthropic", "github-copilot", "opencode"],
        model: "claude-fable-5-1",
        variant: "xhigh"
      },
      {
        providers: ["anthropic", "github-copilot", "opencode"],
        model: "claude-opus-5-5",
        variant: "max"
      },
      {
        providers: ["opencode-go", "kimi-for-coding", "moonshotai", "opencode"],
        model: "kimi-k3",
        variant: "max"
      }
    ]
  },
  metis: {
    fallbackChain: [
      {
        providers: ["anthropic", "github-copilot", "opencode"],
        model: "claude-fable-5-1",
        variant: "max"
      },
      {
        providers: ["anthropic", "github-copilot", "opencode"],
        model: "claude-opus-5-5",
        variant: "max"
      },
      {
        providers: ["opencode-go", "kimi-for-coding", "moonshotai", "opencode"],
        model: "kimi-k3",
        variant: "max"
      }
    ]
  },
  momus: {
    fallbackChain: [
      { providers: ["openai", "chatgpt-subscription"], model: "gpt-6-astra", variant: "xhigh" },
      { providers: ["github-copilot"], model: "gpt-6-astra", variant: "high" },
      { providers: ["openai", "chatgpt-subscription", "opencode"], model: "gpt-6-astra", variant: "high" },
      {
        providers: ["anthropic", "github-copilot", "opencode"],
        model: "claude-opus-5-5",
        variant: "max"
      },
      {
        providers: ["google", "github-copilot", "opencode"],
        model: "gemini-3.1-pro",
        variant: "high"
      },
      { providers: ["opencode-go"], model: "glm-5.2" }
    ]
  },
  atlas: {
    fallbackChain: [
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-sonnet-5" },
      { providers: ["opencode-go"], model: "kimi-k3" },
      {
        providers: ["openai", "chatgpt-subscription", "github-copilot", "opencode"],
        model: "gpt-5.6-sol",
        variant: "medium"
      },
      { providers: ["opencode-go"], model: "minimax-m3" },
      { providers: ["minimax-coding-plan", "minimax-cn-coding-plan"], model: "MiniMax-M3" },
      { providers: ["opencode-go"], model: "minimax-m2.7" }
    ]
  },
  "sisyphus-junior": {
    fallbackChain: [
      { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-sonnet-5" },
      { providers: ["opencode-go"], model: "kimi-k3" },
      {
        providers: ["openai", "chatgpt-subscription", "github-copilot", "opencode"],
        model: "gpt-5.6-sol",
        variant: "medium"
      },
      { providers: ["opencode-go"], model: "minimax-m3" },
      { providers: ["minimax-coding-plan", "minimax-cn-coding-plan"], model: "MiniMax-M3" },
      { providers: ["opencode-go"], model: "minimax-m2.7" },
      { providers: ["opencode"], model: "big-pickle" }
    ]
  }
};

// ../../../../omo-engine/model-core/src/model-availability.ts
function normalizeModelName(name) {
  return name.toLowerCase().replace(/claude-(opus|sonnet|haiku)-(\d+)[.-](\d+)/g, "claude-$1-$2.$3").replace(/kimi-k2[.-](\d+)/g, "kimi-k2.$1").replace(/\b(glm|gpt)-(\d+)[.-](\d+)/g, "$1-$2.$3");
}
function modelIdOf(model) {
  return model.split("/").slice(1).join("/");
}
function closestMatch(matches, providers) {
  const providerRank = (model) => providers === undefined || providers.length === 0 ? 0 : providers.indexOf(model.split("/")[0] ?? "");
  return matches.reduce((best, current) => {
    const rankDelta = providerRank(current) - providerRank(best);
    if (rankDelta !== 0)
      return rankDelta < 0 ? current : best;
    return modelIdOf(current).length < modelIdOf(best).length ? current : best;
  });
}
function fuzzyMatchModel(target, available, providers) {
  if (available.size === 0) {
    return null;
  }
  const targetNormalized = normalizeModelName(target);
  let candidates = Array.from(available);
  if (providers && providers.length > 0) {
    const providerSet = new Set(providers);
    candidates = candidates.filter((model) => {
      const [provider] = model.split("/");
      return providerSet.has(provider);
    });
  }
  if (candidates.length === 0) {
    return null;
  }
  const matches = candidates.filter((model) => normalizeModelName(model).includes(targetNormalized));
  if (matches.length === 0) {
    return null;
  }
  const exactMatch = matches.find((model) => normalizeModelName(model) === targetNormalized);
  if (exactMatch) {
    return exactMatch;
  }
  const exactModelIdMatches = matches.filter((model) => normalizeModelName(modelIdOf(model)) === targetNormalized);
  if (exactModelIdMatches.length > 0) {
    return closestMatch(exactModelIdMatches, providers);
  }
  return closestMatch(matches, providers);
}

// ../../../../omo-engine/model-core/src/provider-model-id-transform.ts
function inferSubProvider(model) {
  if (model.startsWith("claude-"))
    return "anthropic";
  if (model.startsWith("gpt-"))
    return "openai";
  if (model.startsWith("gemini-"))
    return "google";
  if (model.startsWith("grok-"))
    return "xai";
  if (model.startsWith("minimax-"))
    return "minimax";
  if (model.startsWith("kimi-"))
    return "moonshotai";
  if (model.startsWith("k3"))
    return "moonshotai";
  if (model.startsWith("glm-"))
    return "zai";
  return;
}
var CLAUDE_VERSION_DOT = /claude-(\w+)-(\d+)-(\d+)/g;
var GEMINI_31_PRO_PREVIEW = /gemini-3\.1-pro(?!-)/g;
var GEMINI_3_FLASH_PREVIEW = /(?<!antigravity-)gemini-3-flash(?!-)/g;
function claudeVersionDot(model) {
  return model.replace(CLAUDE_VERSION_DOT, "claude-$1-$2.$3");
}
function applyGatewayTransforms(model) {
  return claudeVersionDot(model).replace(GEMINI_31_PRO_PREVIEW, "gemini-3.1-pro-preview");
}
function transformModelForProviderUsingAnthropicBehavior(provider, model) {
  if (provider === "vercel") {
    const slashIndex = model.indexOf("/");
    if (slashIndex !== -1) {
      const subProvider = model.substring(0, slashIndex);
      const subModel = model.substring(slashIndex + 1);
      return `${subProvider}/${applyGatewayTransforms(subModel)}`;
    }
    const subProvider = inferSubProvider(model);
    if (subProvider) {
      return `${subProvider}/${applyGatewayTransforms(model)}`;
    }
    return model;
  }
  if (provider === "github-copilot") {
    return claudeVersionDot(model).replace(GEMINI_31_PRO_PREVIEW, "gemini-3.1-pro-preview").replace(GEMINI_3_FLASH_PREVIEW, "gemini-3-flash-preview");
  }
  if (provider === "google") {
    return model.replace(GEMINI_31_PRO_PREVIEW, "gemini-3.1-pro-preview").replace(GEMINI_3_FLASH_PREVIEW, "gemini-3-flash-preview");
  }
  if (provider === "anthropic") {
    return model;
  }
  if (provider === "kimi-coding" || provider === "kimi-for-coding") {
    if (model === "kimi-k3")
      return "k3";
    if (model === "kimi-k3-256k")
      return "k3-256k";
  }
  return model;
}
function transformModelForProvider(provider, model) {
  return transformModelForProviderUsingAnthropicBehavior(provider, model);
}

// ../../../../omo-engine/model-core/src/model-normalization.ts
function normalizeModel(model) {
  const trimmed = model?.trim();
  return trimmed || undefined;
}

// ../../../../omo-engine/model-core/src/model-resolution-pipeline.ts
var logImplementationForTesting;
function log(message, data) {
  const logImplementation = logImplementationForTesting;
  if (!logImplementation) {
    return;
  }
  if (arguments.length === 1) {
    logImplementation(message);
    return;
  }
  logImplementation(message, data);
}
var DEFAULT_MODEL_RESOLUTION_DEPS = {
  fuzzyMatchModel,
  transformModelForProvider
};
function modelIDForProvider(provider, model) {
  const prefix = `${provider}/`;
  return model.startsWith(prefix) ? model.slice(prefix.length) : model;
}
function findFallbackVariantForModel(model, fallbackChain, transformModelForProvider) {
  const [provider, ...modelParts] = model.split("/");
  if (!provider || modelParts.length === 0) {
    return;
  }
  const modelID = modelParts.join("/");
  return fallbackChain?.find((entry) => entry.providers.includes(provider) && transformModelForProvider(provider, modelIDForProvider(provider, entry.model)) === modelID && entry.variant)?.variant;
}
function resolveModelPipeline(request, providerCache = {
  readConnectedProvidersCache: () => null,
  findProviderModelMetadata: () => {
    return;
  }
}, deps = DEFAULT_MODEL_RESOLUTION_DEPS) {
  const attempted = [];
  const { intent, constraints, policy } = request;
  const availableModels = constraints.availableModels;
  const fallbackChain = policy?.fallbackChain;
  const systemDefaultModel = policy?.systemDefaultModel;
  const normalizedUiModel = normalizeModel(intent?.uiSelectedModel);
  if (normalizedUiModel) {
    log("Model resolved via UI selection", { model: normalizedUiModel });
    return { model: normalizedUiModel, provenance: "override" };
  }
  const normalizedUserModel = normalizeModel(intent?.userModel);
  if (normalizedUserModel) {
    const inheritedVariant = findFallbackVariantForModel(normalizedUserModel, fallbackChain, deps.transformModelForProvider);
    log("Model resolved via config override", { model: normalizedUserModel });
    return inheritedVariant ? { model: normalizedUserModel, provenance: "override", variant: inheritedVariant } : { model: normalizedUserModel, provenance: "override" };
  }
  const normalizedCategoryDefault = normalizeModel(intent?.categoryDefaultModel);
  if (normalizedCategoryDefault) {
    attempted.push(normalizedCategoryDefault);
    if (availableModels.size > 0) {
      const parts = normalizedCategoryDefault.split("/");
      const providerHint = parts.length >= 2 ? [parts[0]] : undefined;
      const match = deps.fuzzyMatchModel(normalizedCategoryDefault, availableModels, providerHint);
      if (match) {
        log("Model resolved via category default (fuzzy matched)", {
          original: normalizedCategoryDefault,
          matched: match
        });
        return { model: match, provenance: "category-default", attempted };
      }
    } else {
      const connectedProviders = constraints.connectedProviders ?? providerCache.readConnectedProvidersCache();
      if (connectedProviders === null) {
        log("Model resolved via category default (no cache, first run)", {
          model: normalizedCategoryDefault
        });
        return { model: normalizedCategoryDefault, provenance: "category-default", attempted };
      }
      const parts = normalizedCategoryDefault.split("/");
      if (parts.length >= 2) {
        const provider = parts[0];
        if (connectedProviders.includes(provider)) {
          const modelName = parts.slice(1).join("/");
          const transformedModel = `${provider}/${deps.transformModelForProvider(provider, modelName)}`;
          log("Model resolved via category default (connected provider)", {
            model: transformedModel,
            original: normalizedCategoryDefault
          });
          return { model: transformedModel, provenance: "category-default", attempted };
        }
      }
    }
    log("Category default model not available, falling through to fallback chain", {
      model: normalizedCategoryDefault
    });
  }
  const userFallbackModels = intent?.userFallbackModels;
  if (userFallbackModels && userFallbackModels.length > 0) {
    if (availableModels.size === 0) {
      const connectedProviders = constraints.connectedProviders ?? providerCache.readConnectedProvidersCache();
      const connectedSet = connectedProviders ? new Set(connectedProviders) : null;
      if (connectedSet !== null) {
        for (const model of userFallbackModels) {
          attempted.push(model);
          const parts = model.split("/");
          if (parts.length >= 2) {
            const provider = parts[0];
            if (connectedSet.has(provider)) {
              const modelName = parts.slice(1).join("/");
              const transformedModel = `${provider}/${deps.transformModelForProvider(provider, modelName)}`;
              log("Model resolved via user fallback_models (connected provider)", { model: transformedModel, original: model });
              return { model: transformedModel, provenance: "provider-fallback", attempted };
            }
          }
        }
        log("No connected provider found in user fallback_models, falling through to hardcoded chain");
      }
    } else {
      for (const model of userFallbackModels) {
        attempted.push(model);
        const parts = model.split("/");
        const providerHint = parts.length >= 2 ? [parts[0]] : undefined;
        const match = deps.fuzzyMatchModel(model, availableModels, providerHint);
        if (match) {
          log("Model resolved via user fallback_models (availability confirmed)", { model, match });
          return { model: match, provenance: "provider-fallback", attempted };
        }
      }
      log("No available model found in user fallback_models, falling through to hardcoded chain");
    }
  }
  if (fallbackChain && fallbackChain.length > 0) {
    if (availableModels.size === 0) {
      const connectedProviders = constraints.connectedProviders ?? providerCache.readConnectedProvidersCache();
      const connectedSet = connectedProviders ? new Set(connectedProviders) : null;
      if (connectedSet === null) {
        log("Model fallback chain skipped (no connected providers cache) - falling through to system default");
      } else {
        for (const entry of fallbackChain) {
          for (const provider of entry.providers) {
            if (connectedSet.has(provider)) {
              const entryModelID = modelIDForProvider(provider, entry.model);
              const transformedModelId = deps.transformModelForProvider(provider, entryModelID);
              const model = `${provider}/${transformedModelId}`;
              log("Model resolved via fallback chain (connected provider)", {
                provider,
                model: transformedModelId,
                variant: entry.variant
              });
              return {
                model,
                provenance: "provider-fallback",
                variant: entry.variant,
                attempted
              };
            }
          }
        }
        log("No connected provider found in fallback chain, falling through to system default");
      }
    } else {
      for (const entry of fallbackChain) {
        for (const provider of entry.providers) {
          const entryModelID = modelIDForProvider(provider, entry.model);
          const transformedModelId = deps.transformModelForProvider(provider, entryModelID);
          const candidateModelIds = transformedModelId === entryModelID ? [entryModelID] : [entryModelID, transformedModelId];
          for (const modelID of candidateModelIds) {
            const fullModel = `${provider}/${modelID}`;
            const match = deps.fuzzyMatchModel(fullModel, availableModels, [provider]);
            if (match) {
              log("Model resolved via fallback chain (availability confirmed)", {
                provider,
                model: entry.model,
                match,
                variant: entry.variant
              });
              return {
                model: match,
                provenance: "provider-fallback",
                variant: entry.variant,
                attempted
              };
            }
          }
        }
      }
      log("No available model found in fallback chain, falling through to system default");
    }
  }
  if (systemDefaultModel === undefined) {
    log("No model resolved - systemDefaultModel not configured");
    return;
  }
  log("Model resolved via system default", { model: systemDefaultModel });
  return { model: systemDefaultModel, provenance: "system-default", attempted };
}

// ../../../../omo-engine/model-core/src/category-model-requirements.ts
var CATEGORY_MODEL_REQUIREMENTS = {
  "visual-engineering": {
    fallbackChain: [
      {
        providers: ["anthropic", "anthropic-api", "github-copilot", "opencode"],
        model: "claude-fable-5-1",
        variant: "max"
      },
      {
        providers: ["anthropic", "anthropic-api", "github-copilot", "opencode"],
        model: "claude-opus-5-5",
        variant: "max"
      },
      {
        providers: ["kimi-for-coding", "moonshotai", "opencode-go", "opencode"],
        model: "kimi-k3",
        variant: "max"
      }
    ]
  },
  ultrabrain: {
    fallbackChain: [
      { providers: ["openai", "chatgpt-subscription"], model: "gpt-6-astra", variant: "max" },
      { providers: ["github-copilot"], model: "gpt-6-astra", variant: "max" },
      { providers: ["openai", "chatgpt-subscription", "opencode"], model: "gpt-6-astra", variant: "max" },
      { providers: ["openai", "chatgpt-subscription"], model: "gpt-5.6-sol", variant: "max" },
      { providers: ["github-copilot"], model: "gpt-5.6-sol", variant: "max" },
      { providers: ["openai", "chatgpt-subscription", "opencode"], model: "gpt-5.6-sol", variant: "max" }
    ]
  },
  "deep-low": {
    fallbackChain: [
      { providers: ["openai", "chatgpt-subscription"], model: "gpt-6.1-sol", variant: "medium" },
      { providers: ["openai", "chatgpt-subscription"], model: "gpt-6.1-sol-fast", variant: "medium" },
      {
        providers: ["openai", "chatgpt-subscription", "github-copilot", "opencode"],
        model: "gpt-5.6-sol",
        variant: "medium"
      },
      { providers: ["openai", "chatgpt-subscription"], model: "gpt-5.6-sol-fast", variant: "medium" }
    ]
  },
  "deep-high": {
    fallbackChain: [
      {
        providers: ["openai", "chatgpt-subscription", "github-copilot", "opencode"],
        model: "gpt-6-astra",
        variant: "high"
      }
    ]
  },
  artistry: {
    fallbackChain: [
      {
        providers: ["anthropic", "anthropic-api", "github-copilot", "opencode"],
        model: "claude-fable-5-1",
        variant: "max"
      },
      {
        providers: ["anthropic", "anthropic-api", "github-copilot", "opencode"],
        model: "claude-opus-5-5",
        variant: "max"
      },
      {
        providers: ["kimi-for-coding", "moonshotai", "opencode-go", "opencode"],
        model: "kimi-k3",
        variant: "max"
      }
    ]
  },
  quick: {
    fallbackChain: [
      { providers: ["openai", "chatgpt-subscription"], model: "gpt-6-luna-fast", variant: "low" },
      { providers: ["deepseek"], model: "deepseek-flash", variant: "off" },
      {
        providers: ["qwen-token-plan", "alibaba-token-plan", "bailian-coding-plan"],
        model: "qwen3.6-flash",
        variant: "low"
      },
      { providers: ["opencode-go"], model: "minimax-m3", variant: "max" },
      { providers: ["opencode-go"], model: "minimax-m2.7", variant: "max" },
      { providers: ["xai"], model: "grok-4.20-0309-non-reasoning" },
      {
        providers: ["anthropic", "anthropic-api", "github-copilot"],
        model: "claude-haiku-4-5",
        variant: "off"
      },
      { providers: ["zai-coding-plan"], model: "glm-5.3-flash", variant: "low" },
      { providers: ["xiaomi"], model: "mimo-v2.6-flash", variant: "low" }
    ]
  },
  "unspecified-low": {
    fallbackChain: [
      {
        providers: ["anthropic", "anthropic-api", "github-copilot", "opencode"],
        model: "claude-sonnet-5-5",
        variant: "medium"
      },
      { providers: ["xiaomi", "opencode-go"], model: "mimo-v2.6-pro", variant: "max" },
      { providers: ["xai", "github-copilot", "opencode-go"], model: "grok-4.7", variant: "xhigh" },
      {
        providers: ["openai", "chatgpt-subscription", "github-copilot", "opencode"],
        model: "gpt-5.6-terra",
        variant: "high"
      },
      {
        providers: ["anthropic", "anthropic-api", "github-copilot", "opencode"],
        model: "claude-sonnet-5",
        variant: "low"
      },
      {
        providers: ["qwen-token-plan", "alibaba-token-plan", "qwen-token-plan-cn", "alibaba-token-plan-cn"],
        model: "qwen3.8-max-preview",
        variant: "max"
      },
      { providers: ["deepseek", "opencode-go"], model: "deepseek-v4-pro", variant: "max" },
      { providers: ["xiaomi", "opencode-go"], model: "mimo-v2.5-pro", variant: "max" }
    ]
  },
  "unspecified-high": {
    fallbackChain: [
      {
        providers: ["anthropic", "anthropic-api", "github-copilot", "opencode"],
        model: "claude-opus-5-5",
        variant: "medium"
      },
      { providers: ["zai-coding-plan", "opencode-go"], model: "glm-5.3", variant: "max" },
      {
        providers: ["kimi-for-coding", "moonshotai", "opencode-go", "opencode"],
        model: "kimi-k3",
        variant: "max"
      }
    ]
  },
  writing: {
    requiresAnyModel: true,
    fallbackChain: [
      {
        providers: ["anthropic", "anthropic-api", "github-copilot", "opencode"],
        model: "claude-opus-5-5",
        variant: "low"
      },
      {
        providers: ["anthropic", "anthropic-api", "github-copilot", "opencode"],
        model: "claude-opus-4-6",
        variant: "max"
      }
    ]
  }
};

// ../../../../omo-engine/omo-opencode/src/tools/delegate-task/google-categories.ts
var VISUAL_CATEGORY_PROMPT_APPEND = `<Category_Context>
You are working on VISUAL/UI tasks.

<DESIGN_SYSTEM_WORKFLOW_MANDATE>
## YOU ARE A VISUAL ENGINEER. FOLLOW THIS WORKFLOW OR YOUR OUTPUT IS REJECTED.

**YOUR FAILURE MODE**: You skip design system analysis and jump straight to writing components with hardcoded colors, arbitrary spacing, and ad-hoc font sizes. The result is INCONSISTENT GARBAGE that looks like 5 different people built it. THIS STOPS NOW.

**EVERY visual task follows this EXACT workflow. VIOLATION = BROKEN OUTPUT.**

### PHASE 1: ANALYZE THE DESIGN SYSTEM (MANDATORY FIRST ACTION)

**BEFORE writing a SINGLE line of CSS, HTML, JSX, Svelte, or component code - you MUST:**

1. **SEARCH for the design system.** Use Grep, Glob, Read - actually LOOK:
   - Design tokens: colors, spacing, typography, shadows, border-radii
   - Theme files: CSS variables, Tailwind config, \`theme.ts\`, styled-components theme, design tokens file
   - Shared/base components: Button, Card, Input, Layout primitives
   - Existing UI patterns: How are pages structured? What spacing grid? What color usage?

2. **READ at minimum 5-10 existing UI components.** Understand:
   - Naming conventions (BEM? Atomic? Utility-first? Component-scoped?)
   - Spacing system (4px grid? 8px? Tailwind scale? CSS variables?)
   - Color usage (semantic tokens? Direct hex? Theme references?)
   - Typography scale (heading levels, body, caption - how many? What font stack?)
   - Component composition patterns (slots? children? compound components?)

**DO NOT proceed to Phase 2 until you can answer ALL of these. If you cannot, you have not explored enough. EXPLORE MORE.**

### PHASE 2: NO DESIGN SYSTEM? BUILD ONE. NOW.

If Phase 1 reveals NO coherent design system (or scattered, inconsistent patterns):

1. **STOP. Do NOT build the requested UI yet.**
2. **Extract what exists** - even inconsistent patterns have salvageable decisions.
3. **Create a minimal design system FIRST:**
   - Color palette: primary, secondary, neutral, semantic (success/warning/error/info)
   - Typography scale: heading levels (h1-h4 minimum), body, small, caption
   - Spacing scale: consistent increments (4px or 8px base)
   - Border radii, shadows, transitions - systematic, not random
   - Component primitives: the reusable building blocks
4. **Commit/save the design system, THEN proceed to Phase 3.**

A design system is NOT optional overhead. It is the FOUNDATION. Building UI without one is like building a house on sand. It WILL collapse into inconsistency.

### PHASE 3: BUILD WITH THE SYSTEM. NEVER AROUND IT.

**NOW and ONLY NOW** - implement the requested visual work:

| Element | CORRECT | WRONG (WILL BE REJECTED) |
|---------|---------|--------------------------|
| Color | Design token / CSS variable | Hardcoded \`#3b82f6\`, \`rgb(59,130,246)\` |
| Spacing | System value (\`space-4\`, \`gap-md\`, \`var(--spacing-4)\`) | Arbitrary \`margin: 13px\`, \`padding: 7px\` |
| Typography | Scale value (\`text-lg\`, \`heading-2\`, token) | Ad-hoc \`font-size: 17px\` |
| Component | Extend/compose from existing primitives | One-off div soup with inline styles |
| Border radius | System token | Random \`border-radius: 6px\` |

**IF the design requires something OUTSIDE the current system:**
- **Extend the system FIRST** - add the new token/primitive
- **THEN use the new token** in your component
- **NEVER one-off override.** That is how design systems die.

### PHASE 4: VERIFY BEFORE CLAIMING DONE

BEFORE reporting visual work as complete, answer these:

- [ ] Does EVERY color reference a design token or CSS variable?
- [ ] Does EVERY spacing use the system scale?
- [ ] Does EVERY component follow the existing composition pattern?
- [ ] Would a designer see CONSISTENCY across old and new components?
- [ ] Are there ZERO hardcoded magic numbers for visual properties?

**If ANY answer is NO - FIX IT. You are NOT done.**

</DESIGN_SYSTEM_WORKFLOW_MANDATE>

<DESIGN_QUALITY>
Design-first mindset (AFTER design system is established):
- Bold aesthetic choices over safe defaults
- Unexpected layouts, asymmetry, grid-breaking elements
- Distinctive typography (avoid: Arial, Inter, Roboto, Space Grotesk)
- Cohesive color palettes with sharp accents
- High-impact animations with staggered reveals
- Atmosphere: gradient meshes, noise textures, layered transparencies

AVOID: Generic fonts, purple gradients on white, predictable layouts, cookie-cutter patterns.
</DESIGN_QUALITY>

<OBSERVE_EACH_CHANGE>
Visual state is not text: after each change, render or screenshot the affected surface and look at it before making the next change. Check desktop and mobile widths for blank, misframed, or overlapping output; check a 3D scene from several angles. Compare what you see with the reference or the stated intent, and ask only where two readings of that intent diverge. A change you have not looked at is not done.
</OBSERVE_EACH_CHANGE>
</Category_Context>`;
var ARTISTRY_CATEGORY_PROMPT_APPEND = `<Category_Context>
You are working on HIGHLY CREATIVE / ARTISTIC tasks.

Artistic genius mindset:
- Push far beyond conventional boundaries
- Explore radical, unconventional directions
- Surprise and delight: unexpected twists, novel combinations
- Rich detail and vivid expression
- Break patterns deliberately when it serves the creative vision

Approach:
- Generate diverse, bold options first
- Embrace ambiguity and wild experimentation
- Balance novelty with coherence
- This is for tasks requiring exceptional creativity
</Category_Context>`;
var ARCHITECT_CATEGORY_PROMPT_APPEND = `<Category_Context>
You are working on SYSTEM DESIGN / ARCHITECTURE tasks.

Architecture mindset:
- Requirements and constraints first: state what the system must do and what bounds it
- Decompose into components with explicit ownership and interfaces between them
- Name failure modes and trade-offs for each significant decision
- Keep the design at the smallest scope that meets the requirements

Approach:
- Read the existing structure before proposing a new one
- Weigh at most three viable options with concrete selection criteria
- Define module boundaries, data flow, and dependency direction
- State what is deliberately out of scope

Completion bar: every component has an owner, every interface is named, every
trade-off records what was chosen and what was given up.
</Category_Context>`;
var GOOGLE_CATEGORIES = [
  {
    name: "visual-engineering",
    config: { model: "anthropic/claude-fable-5-1", variant: "max" },
    description: "Visual design, UI/UX, frontend, styling, animation, and design systems",
    promptAppend: VISUAL_CATEGORY_PROMPT_APPEND
  },
  {
    name: "artistry",
    config: { model: "anthropic/claude-fable-5-1", variant: "max" },
    description: "Complex problem-solving with unconventional, creative approaches - beyond standard patterns",
    promptAppend: ARTISTRY_CATEGORY_PROMPT_APPEND
  },
  {
    name: "architect",
    config: { model: "anthropic/claude-fable-5-1", variant: "max" },
    description: "System design and architecture: requirements, decomposition, interfaces, trade-offs",
    promptAppend: ARCHITECT_CATEGORY_PROMPT_APPEND
  }
];

// ../../../../omo-engine/omo-opencode/src/agents/types.ts
function extractModelName(model) {
  return model.includes("/") ? model.split("/").pop() ?? model : model;
}
function isGpt5_5Model(model) {
  const modelName = extractModelName(model).toLowerCase();
  return modelName.includes("gpt-5.5") || modelName.includes("gpt-5-5");
}
function isGpt5_6Model(model) {
  const modelName = extractModelName(model).toLowerCase();
  return modelName.includes("gpt-5.6") || modelName.includes("gpt-5-6");
}
function isGpt6Model(model) {
  const modelName = extractModelName(model).toLowerCase();
  return modelName.includes("gpt-6");
}

// ../../../../omo-engine/omo-opencode/src/tools/delegate-task/openai-categories.ts
var ULTRABRAIN_CATEGORY_PROMPT_APPEND_GPT_6_ASTRA = `<Category_Context name="ultrabrain">
The orchestrator routed this task here because it is the one genuinely hard, logic-heavy problem in its plan, and it sent a goal rather than steps: choose the approach yourself, and let correctness outrank speed, brevity, and token cost.

Success means:
- every load-bearing claim cites evidence from this turn: a file and line read, a command run, a test executed;
- every executable claim was executed: a proposed fix runs, an algorithm passes the boundary cases you enumerated, a verdict on a diff names the failing line;
- the conclusion survived your own attempt to break it, and the answer names the strongest counter-case you looked for;
- rejected alternatives carry the reason that decided against them, and open assumptions are stated so the orchestrator can overturn them;
- one decision-complete recommendation, actionable without a follow-up question.

Whatever that check leaves unsettled goes in the answer as an open question with what would settle it. When the goal bundles independent problems, solve the one the others depend on and return the rest as separately delegable items.
</Category_Context>`;
var DEEP_HIGH_CATEGORY_PROMPT_APPEND_GPT = `<Category_Context name="deep-high">
The orchestrator routed this task here because a decision in it cannot be settled from evidence alone: a trade-off, a contract other code depends on, a mechanism with no pattern to copy, or correctness that has to be argued. One goal, one deliverable, and the time to earn it. The exploration budget is generous: read every file involved, trace callers and dependencies in both directions, and fan out explore and librarian subagents in parallel for the questions a single read wave cannot answer, until you can explain the full mechanism you are about to change; an edit made before that point is the failure this category exists to prevent.

The goal is the authorization. Choose how to reach it yourself, and when it lists numbered steps or phases, deliver all of them in this turn as one task; a proposal, a plan awaiting approval, a simplified version, or a proof of concept is unfinished work. When the steps turn out to be independent problems sharing no reasoning, do the one the goal centers on and return the others as separately delegable items with what you learned. A question ends your turn and hands the task back unfinished, so decide from context, record each assumption in the final message, and stop early only for a blocker you cannot route around: a missing secret, a decision only the user can make, or three materially different attempts that all failed.

Fix the cause: trace at least two levels above the symptom before settling, and prefer the change that makes the failure impossible over the guard that hides it. Depth means understanding the mechanism, so the diff stays as small as the fix allows; on greenfield work choose strong defaults and finish something you would hand to a senior engineer. Close with the delivered change, the evidence that it works, the decision you settled with the alternative you rejected, and the assumptions you made.
</Category_Context>`;
var DEEP_LOW_CATEGORY_PROMPT_APPEND_GPT = `<Category_Context name="deep-low">
The orchestrator routed this task here as the default deep lane: one goal, one deliverable, decisions that the code, tests, and history can settle. Read until you can explain the mechanism you are about to change, including its callers, then act; fan out explore and librarian subagents when one read wave cannot answer a question.

Success means:
- every step or phase the goal lists is delivered in this turn as one task; a plan awaiting approval, a simplified version, or a proof of concept is unfinished work;
- the change removes the cause you traced, at least two levels above the symptom, with the diff as small as that fix allows;
- the final message reports the change, the evidence that it works, and each assumption you decided from context, because a question ends your turn and returns the task unfinished.

Escalation is a complete result. When the correct choice turns out to depend on a trade-off the brief does not settle, on a contract other packages rely on, or on an argument about invariants you cannot verify by running something, stop before editing and return \`ESCALATE: deep-high\` as the first line, followed by what you read, the decision you could not settle, and the options you saw. A confident guess through that decision costs more than the escalation.

Stop the moment the success criteria hold; work past them is a defect. Stop early only for a blocker you cannot route around: a missing secret, a decision only the user can make, or three materially different attempts that all failed.
</Category_Context>`;
var UNSPECIFIED_HIGH_CATEGORY_PROMPT_APPEND_GPT_6_ASTRA = `<Category_Context name="unspecified-high">
The orchestrator routed this task here because it spans systems or modules and fits no specialist category, so breadth of consideration is what this category buys. Before committing to an approach, survey the whole surface the change touches: every caller and consumer of what you will modify, sibling modules that implement the same pattern, the tests, docs, schemas, config, scripts, and CI that encode the current behavior, and the history of the area (git log and blame) for the reasons it is shaped this way. Fan out explore and librarian subagents in parallel when that surface is wider than one read wave covers.

Weigh at least two ways to do it against what you found, choose one, and say in the final message why it won. Then deliver it across every surface you identified, so behavior stays consistent everywhere the change is observable and no caller, test, doc, schema, or config still describes the old state. A question ends your turn and hands the task back unfinished, so decide from context, record each assumption in the final message, and finish.
</Category_Context>`;
var ULTRABRAIN_CATEGORY_PROMPT_APPEND = `<Category_Context>
You are working on DEEP LOGICAL REASONING / COMPLEX ARCHITECTURE tasks.

**CRITICAL - CODE STYLE REQUIREMENTS (NON-NEGOTIABLE)**:
1. BEFORE writing ANY code, SEARCH the existing codebase to find similar patterns/styles
2. Your code MUST match the project's existing conventions - blend in seamlessly
3. Write READABLE code that humans can easily understand - no clever tricks
4. If unsure about style, explore more files until you find the pattern

Strategic advisor mindset:
- Bias toward simplicity: least complex solution that fulfills requirements
- Leverage existing code/patterns over new components
- Prioritize developer experience and maintainability
- One clear recommendation with effort estimate (Quick/Short/Medium/Large)
- Signal when advanced approach warranted

Response format:
- Bottom line (2-3 sentences)
- Action plan (numbered steps)
- Risks and mitigations (if relevant)
</Category_Context>`;
var DEEP_LOW_CATEGORY_PROMPT_APPEND = `<Category_Context name="deep-low">
You are working on a GOAL-ORIENTED AUTONOMOUS task: one goal, one deliverable, decisions the codebase can settle.

Before any change, read the files involved and trace their dependencies until you can explain the mechanism you are about to modify. The goal is already defined: do not ask clarifying questions; make reasonable assumptions, record them in the final message, and proceed.

When the goal lists numbered steps or phases, execute all of them in this turn as one atomic task. Genuinely independent tasks bundled into one goal: flag them and do only the one the goal centers on.

Escalation is a complete result. When the correct choice depends on a trade-off the brief does not settle, a contract other packages rely on, or an argument about invariants you cannot verify by running something, stop before editing and return \`ESCALATE: deep-high\` as the first line, followed by what you read, the decision you could not settle, and the options you saw.

Prefer the fix that removes the cause over the patch that hides the symptom. Report completion with the changes made and the evidence they work.
</Category_Context>`;
var DEEP_HIGH_CATEGORY_PROMPT_APPEND = `<Category_Context name="deep-high">
You are working on a GOAL-ORIENTED AUTONOMOUS task that was escalated here because a decision in it cannot be settled from evidence alone: a trade-off, a contract other code depends on, a mechanism with no pattern to copy, or correctness that has to be argued.

Before any change, read the files involved and trace their dependencies until you can explain the mechanism you are about to modify. The goal is already defined: do not ask clarifying questions; make reasonable assumptions, record them in the final message, and proceed.

When the goal lists numbered steps or phases, execute all of them in this turn as one atomic task. Genuinely independent tasks bundled into one goal: flag them and do only the one the goal centers on.

Prefer the fix that removes the cause over the patch that hides the symptom. Report completion with the changes made, the evidence they work, and the decision you settled with the alternative you rejected.
</Category_Context>`;
function isGptDeepLaneModel(model) {
  return model !== undefined && (isGpt6Model(model) || isGpt5_5Model(model) || isGpt5_6Model(model));
}
function resolveUltrabrainCategoryPromptAppend(model) {
  if (model && isGpt6Model(model)) {
    return ULTRABRAIN_CATEGORY_PROMPT_APPEND_GPT_6_ASTRA;
  }
  return ULTRABRAIN_CATEGORY_PROMPT_APPEND;
}
function resolveDeepLowCategoryPromptAppend(model) {
  return isGptDeepLaneModel(model) ? DEEP_LOW_CATEGORY_PROMPT_APPEND_GPT : DEEP_LOW_CATEGORY_PROMPT_APPEND;
}
function resolveDeepHighCategoryPromptAppend(model) {
  return isGptDeepLaneModel(model) ? DEEP_HIGH_CATEGORY_PROMPT_APPEND_GPT : DEEP_HIGH_CATEGORY_PROMPT_APPEND;
}
function resolveUnspecifiedHighCategoryPromptAppend(model) {
  if (model && isGpt6Model(model)) {
    return UNSPECIFIED_HIGH_CATEGORY_PROMPT_APPEND_GPT_6_ASTRA;
  }
  return UNSPECIFIED_HIGH_CATEGORY_PROMPT_APPEND;
}
var QUICK_CATEGORY_PROMPT_APPEND = `<Category_Context>
You are working on SMALL / QUICK tasks.

Efficient execution mindset:
- Fast, focused, minimal overhead
- Get to the point immediately
- No over-engineering
- Simple solutions for simple problems

Approach:
- Minimal viable implementation
- Skip unnecessary abstractions
- Direct and concise
</Category_Context>`;
var QUICK_CATEGORY_CALLER_GUIDANCE = `<Caller_Warning>Small/fast model: before delegating, write an explicit prompt with numbered must-do steps, forbidden deviations, and concrete success criteria.</Caller_Warning>`;
var UNSPECIFIED_LOW_CATEGORY_PROMPT_APPEND = `<Category_Context>
You are working on tasks that don't fit specific categories but require moderate effort.
</Category_Context>`;
var UNSPECIFIED_LOW_CATEGORY_CALLER_GUIDANCE = `<Selection_Gate>Use only when no specialist category fits, effort is moderate, and scope stays within a few files/modules. Prefer any matching specialist category.</Selection_Gate>
<Caller_Warning>Provide explicit must-do steps, forbidden scope, and concrete success criteria.</Caller_Warning>`;
var UNSPECIFIED_HIGH_CATEGORY_PROMPT_APPEND = `<Category_Context>
You are working on tasks that don't fit specific categories but require substantial effort.
</Category_Context>`;
var UNSPECIFIED_HIGH_CATEGORY_CALLER_GUIDANCE = `<Selection_Gate>Use only when no specialist category fits and substantial effort spans systems/modules with broad impact. Use unspecified-low for contained moderate work.</Selection_Gate>`;
var DEEP_LOW_CATEGORY_CALLER_GUIDANCE = `<Selection_Gate>Of the two deep lanes this is the default: the child settles its decisions from what it reads. When unsure, choose deep-low; a misrouted child returns \`ESCALATE: deep-high\` after one cheap attempt, and you re-spawn the same brief as deep-high with its findings.</Selection_Gate>`;
var DEEP_HIGH_CATEGORY_CALLER_GUIDANCE = `<Selection_Gate>Route here only when you can name the decision evidence cannot settle: a trade-off with no single right answer, a contract change crossing a package or process boundary, a mechanism with no in-repo pattern to copy, or correctness argued from invariants rather than observed in a test. Wide scope with easy decisions is deep-low or unspecified-high; reasoning as the deliverable is ultrabrain.</Selection_Gate>`;
var OPENAI_CATEGORIES = [
  {
    name: "ultrabrain",
    config: { model: "openai/gpt-6-astra", variant: "max" },
    description: "Use ONLY for genuinely hard, logic-heavy tasks. Give clear goals only, not step-by-step instructions.",
    promptAppend: ULTRABRAIN_CATEGORY_PROMPT_APPEND,
    resolvePromptAppend: resolveUltrabrainCategoryPromptAppend
  },
  {
    name: "deep-low",
    config: { model: "openai/gpt-6.1-sol", variant: "medium" },
    description: "Default deep lane: one goal, one deliverable, decisions the child can settle from what it reads; preferred over deep-high for 3D graphics, computer/browser use, CAPTCHA, multimodal, backend, logic, and algorithm work. Multiple goals fan out as parallel calls.",
    callerGuidance: DEEP_LOW_CATEGORY_CALLER_GUIDANCE,
    promptAppend: DEEP_LOW_CATEGORY_PROMPT_APPEND,
    resolvePromptAppend: resolveDeepLowCategoryPromptAppend
  },
  {
    name: "deep-high",
    config: { model: "openai/gpt-6-astra", variant: "high" },
    description: "Escalation deep lane: a goal whose central decision cannot be settled from evidence alone. Same one-goal, one-deliverable contract as deep-low.",
    callerGuidance: DEEP_HIGH_CATEGORY_CALLER_GUIDANCE,
    promptAppend: DEEP_HIGH_CATEGORY_PROMPT_APPEND,
    resolvePromptAppend: resolveDeepHighCategoryPromptAppend
  },
  {
    name: "quick",
    config: { model: "openai/gpt-6-luna-fast", variant: "low" },
    description: "Trivial tasks - single file changes, typo fixes, simple modifications",
    callerGuidance: QUICK_CATEGORY_CALLER_GUIDANCE,
    promptAppend: QUICK_CATEGORY_PROMPT_APPEND
  },
  {
    name: "unspecified-low",
    config: { model: "anthropic/claude-sonnet-5-5", variant: "medium" },
    description: "Tasks that don't fit other categories, low effort required",
    callerGuidance: UNSPECIFIED_LOW_CATEGORY_CALLER_GUIDANCE,
    promptAppend: UNSPECIFIED_LOW_CATEGORY_PROMPT_APPEND
  },
  {
    name: "unspecified-high",
    config: { model: "anthropic/claude-opus-5-5", variant: "medium" },
    description: "Tasks that don't fit other categories, high effort required",
    callerGuidance: UNSPECIFIED_HIGH_CATEGORY_CALLER_GUIDANCE,
    promptAppend: UNSPECIFIED_HIGH_CATEGORY_PROMPT_APPEND,
    resolvePromptAppend: resolveUnspecifiedHighCategoryPromptAppend
  }
];

// ../../../../omo-engine/omo-opencode/src/tools/delegate-task/kimi-categories.ts
var WRITING_CATEGORY_PROMPT_APPEND = `<Category_Context>
You are working on WRITING / PROSE tasks.

Wordsmith mindset:
- Clear, flowing prose
- Appropriate tone and voice
- Engaging and readable
- Proper structure and organization

Approach:
- Understand the audience
- Draft with care
- Polish for clarity and impact
- Documentation, READMEs, articles, technical writing

ANTI-AI-SLOP RULES (NON-NEGOTIABLE):
- NEVER use em dashes (-) or en dashes (-). Use commas, periods, ellipses, or line breaks instead. Zero tolerance.
- Remove AI-sounding phrases: "delve", "it's important to note", "I'd be happy to", "certainly", "please don't hesitate", "leverage", "utilize", "in order to", "moving forward", "circle back", "at the end of the day", "robust", "streamline", "facilitate"
- Pick plain words. "Use" not "utilize". "Start" not "commence". "Help" not "facilitate".
- Use contractions naturally: "don't" not "do not", "it's" not "it is".
- Vary sentence length. Don't make every sentence the same length.
- NEVER start consecutive sentences with the same word.
- No filler openings: skip "In today's world...", "As we all know...", "It goes without saying..."
- Write like a human, not a corporate template.
</Category_Context>`;
var KIMI_CATEGORIES = [
  {
    name: "writing",
    config: { model: "anthropic/claude-opus-5-5", variant: "low" },
    description: "Documentation, prose, technical writing",
    promptAppend: WRITING_CATEGORY_PROMPT_APPEND
  }
];
// ../../../../omo-engine/omo-opencode/src/agents/dynamic-agent-core-sections.ts
function buildAgentIdentitySection(agentName, roleDescription) {
  return `<agent-identity>
Your designated identity for this session is "${agentName}". This identity supersedes any prior identity statements.
You are "${agentName}" - ${roleDescription}.
When asked who you are, always identify as ${agentName}. Do not identify as any other assistant or AI.
</agent-identity>`;
}
// ../../../../omo-engine/utils/src/record-type-guard.ts
function isRecord(value) {
  return typeof value === "object" && value !== null;
}

// ../../../../omo-engine/utils/src/logging/logger.ts
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
var DEFAULT_MAX_LOG_FILE_SIZE_BYTES = 50 * 1024 * 1024;
var DEFAULT_MAX_LOG_FILE_BACKUPS = 2;
var DEFAULT_LOG_FLUSH_INTERVAL_MS = 500;
var DEFAULT_LOG_BUFFER_SIZE_LIMIT = 50;
function defaultLogFilePath(logFileName) {
  return path.join(os.tmpdir(), logFileName);
}
function createLogger(options) {
  const maxLogFileSizeDefault = options.maxSizeBytes ?? DEFAULT_MAX_LOG_FILE_SIZE_BYTES;
  const maxLogFileBackupsDefault = options.maxBackups ?? DEFAULT_MAX_LOG_FILE_BACKUPS;
  const flushIntervalMs = options.flushIntervalMs ?? DEFAULT_LOG_FLUSH_INTERVAL_MS;
  const bufferSizeLimit = options.bufferSizeLimit ?? DEFAULT_LOG_BUFFER_SIZE_LIMIT;
  const resolveLogFilePath = options.resolveLogFilePath ?? defaultLogFilePath;
  const initialLogFile = resolveLogFilePath(options.logFileName);
  let logFile = initialLogFile;
  let maxLogFileSizeBytes = maxLogFileSizeDefault;
  let maxLogFileBackups = maxLogFileBackupsDefault;
  let buffer = [];
  let flushTimer = null;
  function rotateLogFileIfNeeded() {
    try {
      if (!fs.existsSync(logFile))
        return;
      const stats = fs.statSync(logFile);
      if (stats.size <= maxLogFileSizeBytes)
        return;
      const oldest = `${logFile}.${maxLogFileBackups}`;
      if (fs.existsSync(oldest)) {
        fs.unlinkSync(oldest);
      }
      for (let i = maxLogFileBackups - 1;i >= 1; i -= 1) {
        const src = `${logFile}.${i}`;
        const dst = `${logFile}.${i + 1}`;
        if (fs.existsSync(src)) {
          fs.renameSync(src, dst);
        }
      }
      fs.renameSync(logFile, `${logFile}.1`);
    } catch (error) {
      if (error instanceof Error)
        return;
    }
  }
  function flush() {
    if (buffer.length === 0)
      return;
    const data = buffer.join("");
    buffer = [];
    try {
      fs.appendFileSync(logFile, data);
      rotateLogFileIfNeeded();
    } catch (error) {
      if (error instanceof Error)
        return;
    }
  }
  function scheduleFlush() {
    if (flushTimer)
      return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flush();
    }, flushIntervalMs);
  }
  function log(message, data) {
    try {
      const timestamp = new Date().toISOString();
      const logEntry = `[${timestamp}] ${message} ${data ? JSON.stringify(data) : ""}
`;
      buffer.push(logEntry);
      if (buffer.length >= bufferSizeLimit) {
        flush();
      } else {
        scheduleFlush();
      }
    } catch (error) {
      if (error instanceof Error)
        return;
    }
  }
  function getLogFilePath() {
    return logFile;
  }
  function _setLoggerForTesting(overrides) {
    buffer = [];
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (overrides.filePath !== undefined)
      logFile = overrides.filePath;
    if (overrides.maxSizeBytes !== undefined)
      maxLogFileSizeBytes = overrides.maxSizeBytes;
    if (overrides.maxBackups !== undefined)
      maxLogFileBackups = overrides.maxBackups;
  }
  function _resetLoggerForTesting() {
    logFile = initialLogFile;
    maxLogFileSizeBytes = maxLogFileSizeDefault;
    maxLogFileBackups = maxLogFileBackupsDefault;
    buffer = [];
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
  }
  function _flushForTesting() {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    flush();
  }
  return {
    log,
    getLogFilePath,
    _setLoggerForTesting,
    _resetLoggerForTesting,
    _flushForTesting
  };
}

// ../../../../omo-engine/utils/src/logger.ts
var sharedSubunitLogger = () => {};
function configureSharedSubunitLogger(logger) {
  sharedSubunitLogger = logger ?? (() => {});
}

// ../../../../omo-engine/omo-opencode/src/shared/plugin-identity.ts
var LOG_FILENAME = "oh-my-opencode.log";
var CACHE_DIR_NAME = "oh-my-opencode";

// ../../../../omo-engine/omo-opencode/src/shared/logger.ts
var logger = createLogger({ logFileName: LOG_FILENAME });
var log2 = logger.log;
var getLogFilePath = logger.getLogFilePath;
configureSharedSubunitLogger(log2);

// ../../../../omo-engine/omo-opencode/src/tools/delegate-task/metis-agent.ts
var METIS_CORE_AGENT = {
  key: "metis",
  config: { model: "anthropic/claude-fable-5-1", variant: "max" },
  description: "Pre-planning consultant that clarifies intent and hands the planner questions, risks, and directives. Read-only.",
  role: "pre-planning consultant. Clarify what the user really wants before planning starts, and hand the planner questions, risks, and directives.",
  promptAppend: `<Metis_Consultation>
You are metis, a pre-planning consultant. You question and direct; you never implement.

Phase 0 - classify the intent before anything else:
- Refactoring (existing code changes): safety first, regression prevention
- Build from scratch (greenfield): discover patterns first, then ask
- Mid-sized change (bounded deliverable): exact boundaries, explicit exclusions
- Collaborative (user wants dialogue): build understanding incrementally
- Architecture (system design): long-term impact, recommend oracle-depth review
- Research (goal clear, path unknown): define exit criteria, probe in parallel

Phase 1 - reconnoitre with your own tools, in parallel, BEFORE asking:
- Find similar implementations already in the codebase
- Note the conventions the new work should follow (or deliberately break)
- Only then ask the user what the code could not answer

Deliverables for the planner:
- Questions: each answerable from the codebase or by the user, none rhetorical
- Risks: each paired with its mitigation, each gap naming who is affected
- Directives: MUST do and MUST NOT do, per task where it matters
- QA directives: each with its tool, concrete steps, and expected result

Discipline:
- Advise only. Never implement, never modify files, never spawn subagents.
- Flag scope inflation, premature abstraction, and over-validation by name.
- No placeholder scenarios and no user-manual verification steps.
</Metis_Consultation>`
};

// ../../../../omo-engine/omo-opencode/src/tools/delegate-task/momus-agent.ts
var MOMUS_CORE_AGENT = {
  key: "momus",
  config: { model: "openai/gpt-6-astra", variant: "xhigh" },
  description: "Independent plan critic that verdicts whether a plan is executable and its references are real. Approves by default, rejects only true blockers.",
  role: "independent plan critic. Verify a plan is executable and its references are real, then verdict OKAY or REJECT.",
  promptAppend: `<Momus_Review>
You are momus, a plan critic. You verdict; you never rewrite the plan.

Process:
1. Re-read the plan from disk. On-disk content is the only source of truth;
   never trust a previous verdict or a quoted excerpt without re-reading.
2. Verify every cited file and line exists and contains what the plan claims.
   A reference to a real file with roughly the claimed content passes.
3. Check each task is startable: a capable developer knows where to begin.
4. Check each task carries an executable QA scenario: a specific tool,
   concrete steps, and an expected result. Missing or unexecutable scenarios
   ("verify it works", "check the page") are blockers.

Verdict rules:
- Approve by default. A plan that is 80 percent clear is good enough.
- Reject only true blockers: a missing file, an unstartable task, an
  unexecutable scenario, or a contradiction that makes the plan impossible.
- At most three specific actionable issues per rejection.
- Never reject on taste, style, alternative approaches, missing edge cases,
  or documentation polish. You find blockers, not perfection.

The verdict names the plan path, lists each verified reference, and cites
the exact blocker for every rejection.
</Momus_Review>`
};

// ../../../../omo-engine/omo-opencode/src/tools/delegate-task/multimodal-looker-agent.ts
var MULTIMODAL_LOOKER_CORE_AGENT = {
  key: "multimodal-looker",
  config: { model: "openai/gpt-5.6-sol", variant: "low" },
  description: "Read-only visual analyst that extracts requested information from attached images and documents. No tools, no edits.",
  role: "read-only visual analyst. Extract exactly what was requested from attached media and report it as text.",
  promptAppend: `<Multimodal_Analysis>
You interpret attached media. The file or image arrives with the request.

Hard rules:
- Analyze the attachment directly. Never call tools, never spawn subagents,
  never try to load the file by path, never fetch anything external.
- Extract ONLY what the goal asked for. The caller never sees the raw file,
  so your text is the whole result: make it complete on the goal.
- When several files are attached, cover each one; when the goal compares,
  compare and contrast explicitly.

Per medium:
- PDFs and documents: pull text, structure, tables, and data from the
  relevant sections only.
- Images: describe layout, UI elements, visible text, charts, and diagrams.
- Diagrams: explain the relationships, flows, and architecture depicted.

Not your work:
- Source code or plain text needing exact contents (send back for direct read)
- Anything that needs editing afterward
- Simple reads where no interpretation is needed

Response rules:
- Return the extracted information directly, no preamble.
- When the information is absent, say exactly what is missing.
- Match the language of the request.
- Thorough on the goal, terse on everything else.
</Multimodal_Analysis>`
};

// ../../../../omo-engine/omo-opencode/src/tools/delegate-task/oracle-agent.ts
var ORACLE_CORE_AGENT = {
  key: "oracle",
  config: { model: "openai/gpt-5.6-sol", variant: "xhigh" },
  description: "Read-only debugging and architecture consultant for hard failures and design trade-offs. Consultation only, never edits.",
  role: "read-only debugging and architecture consultant. Diagnose hard failures and advise on design trade-offs without changing code.",
  promptAppend: `<Oracle_Consultation>
You are oracle, a read-only consultant. You advise; the caller implements.

Consultation triggers (the caller sends you these):
- A failure that survived at least two fix attempts by the caller
- An unfamiliar pattern where the caller cannot tell good from bad
- A trade-off spanning systems, or a security/performance concern
- A completed piece of work the caller wants reviewed before shipping

Not your work (decline and say what the caller should do instead):
- Single-file operations the caller can do with direct tools
- A first fix attempt the caller has not tried yet
- Questions the caller could answer from code it already read
- Trivial choices (names, formatting, small local defaults)

Working rules:
- Read before concluding. Anchor every claim in files you actually opened.
- Recommend one primary path with an effort tag (Quick/Short/Medium/Large).
  Name alternatives only when the trade-off is genuinely different.
- Match depth to the question: quick questions get quick answers.
- State assumptions explicitly. Never invent file paths, line numbers, or figures.

Result discipline:
- The caller is blocked on your answer: be decisive and self-contained.
- Bottom line first (2-3 sentences), then the action plan, then risks.
- Your text goes back unfiltered, so write the final recommendation, not notes.
</Oracle_Consultation>`
};

// ../../../../omo-engine/omo-opencode/src/shared/data-path.ts
import * as path2 from "node:path";
import * as os2 from "node:os";
import { accessSync, constants, mkdirSync } from "node:fs";
function resolveWritableDirectory(preferredDir, fallbackSuffix) {
  try {
    mkdirSync(preferredDir, { recursive: true });
    accessSync(preferredDir, constants.W_OK);
    return preferredDir;
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error;
    }
    const fallbackDir = path2.join(os2.tmpdir(), fallbackSuffix);
    mkdirSync(fallbackDir, { recursive: true });
    return fallbackDir;
  }
}
function getCacheDir() {
  const preferredDir = process.env.XDG_CACHE_HOME ?? path2.join(os2.homedir(), ".cache");
  return resolveWritableDirectory(preferredDir, "opencode-cache");
}
function getOmoOpenCodeCacheDir() {
  return path2.join(getCacheDir(), CACHE_DIR_NAME);
}

// ../../../../omo-engine/omo-opencode/src/shared/json-file-cache-store.ts
import { existsSync as existsSync2, mkdirSync as mkdirSync2, readFileSync, writeFileSync } from "node:fs";
import { join as join3 } from "node:path";
function toLogLabel(cacheLabel) {
  return cacheLabel.toLowerCase();
}
function createJsonFileCacheStore(options) {
  let memoryValue;
  let writtenInCurrentProcess = false;
  function getCacheFilePath() {
    return join3(options.getCacheDir(), options.filename);
  }
  function ensureCacheDir() {
    const cacheDir = options.getCacheDir();
    if (!existsSync2(cacheDir)) {
      mkdirSync2(cacheDir, { recursive: true });
    }
  }
  function read() {
    if (memoryValue !== undefined) {
      return memoryValue;
    }
    const cacheFile = getCacheFilePath();
    if (!existsSync2(cacheFile)) {
      memoryValue = null;
      log2(`[${options.logPrefix}] ${options.cacheLabel} file not found`, { cacheFile });
      return null;
    }
    try {
      const content = readFileSync(cacheFile, "utf-8");
      const value = JSON.parse(content);
      memoryValue = value;
      log2(`[${options.logPrefix}] Read ${toLogLabel(options.cacheLabel)}`, options.describe(value));
      return value;
    } catch (error) {
      memoryValue = null;
      log2(`[${options.logPrefix}] Error reading ${toLogLabel(options.cacheLabel)}`, {
        error: String(error)
      });
      return null;
    }
  }
  function has() {
    if (memoryValue !== undefined && memoryValue !== null) {
      return true;
    }
    if (writtenInCurrentProcess) {
      return true;
    }
    return existsSync2(getCacheFilePath());
  }
  function write(value) {
    ensureCacheDir();
    const cacheFile = getCacheFilePath();
    try {
      writeFileSync(cacheFile, options.serialize?.(value) ?? JSON.stringify(value, null, 2));
      memoryValue = value;
      writtenInCurrentProcess = true;
      log2(`[${options.logPrefix}] ${options.cacheLabel} written`, options.describe(value));
    } catch (error) {
      log2(`[${options.logPrefix}] Error writing ${toLogLabel(options.cacheLabel)}`, {
        error: String(error)
      });
    }
  }
  function resetMemory() {
    memoryValue = undefined;
    writtenInCurrentProcess = false;
  }
  return {
    read,
    has,
    write,
    resetMemory
  };
}

// ../../../../omo-engine/omo-opencode/src/shared/connected-providers-cache.ts
var providerModelsCacheWrittenInCurrentProcess = false;
var CONNECTED_PROVIDERS_CACHE_FILE = "connected-providers.json";
var PROVIDER_MODELS_CACHE_FILE = "provider-models.json";
function mergeConnectedProviders(previous, fetched, reportedProviderIDs) {
  if (!previous || previous.length === 0) {
    return fetched;
  }
  if (fetched.length === 0 && reportedProviderIDs.size === 0) {
    return previous;
  }
  const fetchedSet = new Set(fetched);
  const droppedPreviousProvider = previous.some((provider) => !fetchedSet.has(provider));
  if (!droppedPreviousProvider) {
    return fetched;
  }
  const fetchedSetWithConfirmedDisconnects = new Set(fetched);
  for (const provider of previous) {
    if (!reportedProviderIDs.has(provider)) {
      fetchedSetWithConfirmedDisconnects.add(provider);
    }
  }
  return Array.from(fetchedSetWithConfirmedDisconnects);
}
function mergeProviderModels(previous, fetched, connected, reportedModelProviderIDs) {
  const merged = {};
  for (const provider of connected) {
    if (fetched[provider]) {
      merged[provider] = fetched[provider];
    } else if (reportedModelProviderIDs.has(provider) && previous?.[provider]) {
      merged[provider] = [];
    } else if (previous?.[provider]) {
      merged[provider] = previous[provider];
    }
  }
  return merged;
}
function createConnectedProvidersCacheStore(getCacheDir = getOmoOpenCodeCacheDir) {
  const connectedProvidersCacheStore = createJsonFileCacheStore({
    getCacheDir,
    filename: CONNECTED_PROVIDERS_CACHE_FILE,
    logPrefix: "connected-providers-cache",
    cacheLabel: "Cache",
    describe: (value) => ({ count: value.connected.length, updatedAt: value.updatedAt })
  });
  const providerModelsCacheStore = createJsonFileCacheStore({
    getCacheDir,
    filename: PROVIDER_MODELS_CACHE_FILE,
    logPrefix: "connected-providers-cache",
    cacheLabel: "Provider-models cache",
    describe: (value) => ({
      providerCount: Object.keys(value.models).length,
      updatedAt: value.updatedAt
    })
  });
  function readConnectedProvidersCache() {
    return connectedProvidersCacheStore.read()?.connected ?? null;
  }
  function hasConnectedProvidersCache() {
    return connectedProvidersCacheStore.has();
  }
  function writeConnectedProvidersCache(connected) {
    connectedProvidersCacheStore.write({
      connected,
      updatedAt: new Date().toISOString()
    });
  }
  function readProviderModelsCache() {
    return providerModelsCacheStore.read();
  }
  function hasProviderModelsCache() {
    if (providerModelsCacheWrittenInCurrentProcess) {
      return true;
    }
    return providerModelsCacheStore.has();
  }
  function writeProviderModelsCache(data) {
    providerModelsCacheStore.write({
      ...data,
      updatedAt: new Date().toISOString()
    });
    providerModelsCacheWrittenInCurrentProcess = true;
  }
  async function updateConnectedProvidersCache(client) {
    if (!client?.provider?.list) {
      log2("[connected-providers-cache] client.provider.list not available");
      return;
    }
    try {
      const previousConnected = readConnectedProvidersCache();
      const previousProviderModels = readProviderModelsCache();
      const result = await client.provider.list();
      const fetchedConnected = result.data?.connected ?? [];
      const allProviders = result.data?.all ?? [];
      const reportedProviderIDs = new Set(allProviders.map((provider) => provider.id));
      const connected = mergeConnectedProviders(previousConnected ?? previousProviderModels?.connected, fetchedConnected, reportedProviderIDs);
      log2("[connected-providers-cache] Fetched connected providers", {
        count: fetchedConnected.length,
        providers: fetchedConnected
      });
      writeConnectedProvidersCache(connected);
      const modelsByProvider = {};
      const reportedModelProviderIDs = new Set;
      for (const provider of allProviders) {
        if (provider.models) {
          reportedModelProviderIDs.add(provider.id);
          const modelMetadata = Object.entries(provider.models).map(([modelID, rawMetadata]) => {
            if (!isRecord(rawMetadata)) {
              return { id: modelID };
            }
            const normalizedID = typeof rawMetadata.id === "string" ? rawMetadata.id : modelID;
            return {
              ...rawMetadata,
              id: normalizedID
            };
          });
          if (modelMetadata.length > 0) {
            modelsByProvider[provider.id] = modelMetadata;
          }
        }
      }
      const mergedModelsByProvider = mergeProviderModels(previousProviderModels?.models, modelsByProvider, connected, reportedModelProviderIDs);
      log2("[connected-providers-cache] Extracted models from provider list", {
        providerCount: Object.keys(mergedModelsByProvider).length,
        totalModels: Object.values(mergedModelsByProvider).reduce((sum, ids) => sum + ids.length, 0)
      });
      writeProviderModelsCache({
        models: mergedModelsByProvider,
        connected
      });
    } catch (err) {
      log2("[connected-providers-cache] Error updating cache", { error: String(err) });
    }
  }
  function _resetMemCacheForTesting() {
    connectedProvidersCacheStore.resetMemory();
    providerModelsCacheStore.resetMemory();
    providerModelsCacheWrittenInCurrentProcess = false;
  }
  return {
    readConnectedProvidersCache,
    hasConnectedProvidersCache,
    readProviderModelsCache,
    hasProviderModelsCache,
    writeProviderModelsCache,
    updateConnectedProvidersCache,
    _resetMemCacheForTesting
  };
}
var defaultConnectedProvidersCacheStore = createConnectedProvidersCacheStore(() => getOmoOpenCodeCacheDir());
var {
  readConnectedProvidersCache,
  hasConnectedProvidersCache,
  readProviderModelsCache,
  hasProviderModelsCache,
  writeProviderModelsCache,
  updateConnectedProvidersCache,
  _resetMemCacheForTesting
} = defaultConnectedProvidersCacheStore;
// ../../../../omo-engine/omo-opencode/src/tools/delegate-task/builtin-categories.ts
var BUILTIN_CATEGORIES = [
  ...GOOGLE_CATEGORIES,
  ...OPENAI_CATEGORIES,
  ...KIMI_CATEGORIES
];
function buildCategoryRecord(selector) {
  return Object.fromEntries(BUILTIN_CATEGORIES.map((definition) => [definition.name, selector(definition)]));
}
var DEFAULT_CATEGORIES = buildCategoryRecord((definition) => definition.config);
var CATEGORY_PROMPT_APPENDS = buildCategoryRecord((definition) => definition.promptAppend);
var CATEGORY_DESCRIPTIONS = buildCategoryRecord((definition) => definition.description);
var CATEGORY_CALLER_GUIDANCE = buildCategoryRecord((definition) => definition.callerGuidance);
var CATEGORY_PROMPT_APPEND_RESOLVERS = Object.fromEntries(BUILTIN_CATEGORIES.filter((definition) => definition.resolvePromptAppend !== undefined).map((definition) => [definition.name, definition.resolvePromptAppend]));

// ../../../../omo-engine/omo-opencode/src/plugin-handlers/agent-config-assembly.ts
var CORE_AGENT_KEYS = [
  "sisyphus",
  "hephaestus",
  "prometheus",
  "atlas",
  "sisyphus-junior",
  "oracle",
  "metis",
  "momus",
  "multimodal-looker"
];
var MODELISH_KEYS = ["model", "temperature"];
function normalizeProtectedAgentName(name) {
  return stripInvisibleAgentCharacters(name).trim().toLowerCase().replace(/\s*\([^)]*\)\s*/g, "").replace(/\s+-\s+.+$/g, "").replace(/[-_]/g, "").trim();
}
function createProtectedAgentNameSet(names) {
  const protectedNames = new Set;
  for (const name of names) {
    const normalized = normalizeProtectedAgentName(name);
    if (normalized)
      protectedNames.add(normalized);
  }
  return protectedNames;
}
function isProtectedAgentName(name, protectedNames) {
  return protectedNames.has(normalizeProtectedAgentName(name));
}
function firstModelString(value) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstModelString(typeof item === "object" && item !== null ? item.model : item);
      if (found)
        return found;
    }
    return;
  }
  return;
}
function resolveCategorySettings(categoryName, userCategories) {
  if (!categoryName)
    return;
  const builtin = DEFAULT_CATEGORIES[categoryName];
  const user = userCategories?.[categoryName];
  if (!builtin && !user)
    return;
  return { ...builtin, ...user };
}
function resolveCategoryPromptAppend(categoryName, category, model) {
  if (!categoryName || !category)
    return;
  const resolver = CATEGORY_PROMPT_APPEND_RESOLVERS[categoryName];
  if (resolver) {
    try {
      return resolver(model);
    } catch {
      return category.prompt_append;
    }
  }
  return category.prompt_append;
}
function mergeToolsPolicy(...sources) {
  const merged = {};
  for (const source of sources) {
    if (source)
      Object.assign(merged, source);
  }
  if (Object.keys(merged).length === 0)
    return;
  return merged;
}
function buildSkillsAppendix(skills) {
  if (skills.length === 0)
    return "";
  const lines = skills.map((skill) => skill.definition.description ? `- ${skill.name}: ${skill.definition.description}` : `- ${skill.name}`);
  return ["## Available skills", ...lines].join(`
`);
}
var CORE_ROLE_SPECS = [
  {
    key: "sisyphus",
    role: "ultrawork orchestrator. Break complex goals into delegated work, verify every result, and drive the task to done.",
    description: "Ultrawork orchestrator: plans, delegates, and verifies complex work end to end."
  },
  {
    key: "hephaestus",
    role: "deep implementation agent. Write and modify code carefully, run the relevant checks, and report exactly what changed.",
    description: "Deep implementation agent: writes code, runs checks, reports changes."
  },
  {
    key: "prometheus",
    role: "plan builder. Research the codebase and produce a concrete, step-by-step implementation plan without editing code.",
    description: "Plan builder: researches and writes implementation plans."
  },
  {
    key: "atlas",
    role: "plan executor. Carry out an approved plan step by step, verifying each step before moving on.",
    description: "Plan executor: carries out approved plans step by step."
  },
  {
    key: "sisyphus-junior",
    role: "lightweight helper. Handle small, well-scoped follow-ups quickly and report back briefly.",
    description: "Lightweight helper for small, well-scoped follow-up tasks."
  },
  {
    key: ORACLE_CORE_AGENT.key,
    role: ORACLE_CORE_AGENT.role,
    description: ORACLE_CORE_AGENT.description,
    promptAppend: ORACLE_CORE_AGENT.promptAppend
  },
  {
    key: METIS_CORE_AGENT.key,
    role: METIS_CORE_AGENT.role,
    description: METIS_CORE_AGENT.description,
    promptAppend: METIS_CORE_AGENT.promptAppend
  },
  {
    key: MOMUS_CORE_AGENT.key,
    role: MOMUS_CORE_AGENT.role,
    description: MOMUS_CORE_AGENT.description,
    promptAppend: MOMUS_CORE_AGENT.promptAppend
  },
  {
    key: MULTIMODAL_LOOKER_CORE_AGENT.key,
    role: MULTIMODAL_LOOKER_CORE_AGENT.role,
    description: MULTIMODAL_LOOKER_CORE_AGENT.description,
    promptAppend: MULTIMODAL_LOOKER_CORE_AGENT.promptAppend
  }
];
function buildCoreAgentEntry(spec, input, atlasModel) {
  const overrides = input.pluginConfig.agents;
  const override = overrides?.[spec.key];
  const userCategories = input.pluginConfig.categories;
  const category = resolveCategorySettings(override?.category, userCategories);
  const model = firstModelString(override?.models) ?? firstModelString(override?.model) ?? firstModelString(category?.models) ?? firstModelString(category?.model) ?? firstModelString(category?.fallback_models) ?? (spec.key === "sisyphus-junior" ? atlasModel : undefined);
  const skillsAppendix = buildSkillsAppendix(input.skills);
  const categoryAppend = resolveCategoryPromptAppend(override?.category, category, model);
  const promptAppend = [spec.promptAppend, skillsAppendix, categoryAppend, override?.prompt_append].filter((part) => typeof part === "string" && part.length > 0).join(`

`);
  const toolsPolicy = mergeToolsPolicy(category?.tools, override?.tools);
  const temperature = override?.temperature ?? category?.temperature;
  return {
    description: override?.description ?? spec.description,
    mode: override?.mode ?? "subagent",
    ...model ? { model } : {},
    ...override?.color ? { color: override.color } : {},
    ...temperature !== undefined ? { temperature } : {},
    prompt: override?.prompt ?? [buildAgentIdentitySection(spec.key, spec.role), spec.role].join(`

`),
    ...promptAppend ? { promptAppend } : {},
    ...toolsPolicy ? { tools: toolsPolicy } : {}
  };
}
function buildCoreAgentEntries(input) {
  const familyDisabled = input.pluginConfig.sisyphus_agent?.disabled === true;
  const plannerEnabled = input.pluginConfig.sisyphus_agent?.planner_enabled ?? true;
  const entries = {};
  let atlasModel;
  for (const spec of CORE_ROLE_SPECS) {
    if (spec.key === "sisyphus" && familyDisabled)
      continue;
    if (spec.key === "prometheus" && !plannerEnabled)
      continue;
    const entry = buildCoreAgentEntry(spec, input, atlasModel);
    entries[spec.key] = entry;
    if (spec.key === "atlas" && entry.model)
      atlasModel = entry.model;
  }
  return entries;
}
function customRecordToEntry(record) {
  const toolsPolicy = mergeToolsPolicy(record.tools);
  return {
    ...record.description ? { description: record.description } : {},
    mode: record.mode ?? "subagent",
    ...record.model ? { model: record.model } : {},
    ...record.prompt ? { prompt: record.prompt } : {},
    ...toolsPolicy ? { tools: toolsPolicy } : {}
  };
}
function selectCustomAgents(tiers, protectedNames, disabledAgentNames) {
  const merged = {};
  const bundled = {};
  tiers.forEach((tier, index) => {
    if (index === 0)
      Object.assign(bundled, tier);
    else
      Object.assign(merged, tier);
  });
  const selected = {};
  for (const [name, record] of Object.entries(bundled)) {
    if (disabledAgentNames.has(stripInvisibleAgentCharacters(name).toLowerCase()))
      continue;
    selected[name] = customRecordToEntry(record);
  }
  for (const [name, record] of Object.entries(merged)) {
    if (isProtectedAgentName(name, protectedNames))
      continue;
    if (disabledAgentNames.has(stripInvisibleAgentCharacters(name).toLowerCase()))
      continue;
    selected[name] = customRecordToEntry(record);
  }
  return selected;
}
function buildPlanEntry(prometheusEntry, planOverride) {
  const inherited = {};
  for (const key of MODELISH_KEYS) {
    const overrideValue = planOverride?.[key];
    const baseValue = prometheusEntry?.[key];
    const value = overrideValue ?? baseValue;
    if (value !== undefined)
      inherited[key] = value;
  }
  const toolsPolicy = mergeToolsPolicy(prometheusEntry?.tools, planOverride?.tools);
  return {
    description: planOverride?.description ?? "Plan subagent: drafts implementation plans.",
    mode: "subagent",
    ...inherited,
    ...planOverride?.prompt ? { prompt: planOverride.prompt } : {},
    ...planOverride?.prompt_append ? { promptAppend: planOverride.prompt_append } : {},
    ...toolsPolicy ? { tools: toolsPolicy } : {}
  };
}
function assembleAgentEntries(input) {
  const core = buildCoreAgentEntries(input);
  const customs = selectCustomAgents(input.customTiers, input.protectedNames, input.disabledAgentNames);
  const plannerEnabled = input.pluginConfig.sisyphus_agent?.planner_enabled ?? true;
  const replacePlan = input.pluginConfig.sisyphus_agent?.replace_plan ?? true;
  const overrides = input.pluginConfig.agents;
  const entries = { ...core, ...customs };
  if (plannerEnabled && replacePlan && core.prometheus) {
    entries.plan = buildPlanEntry(core.prometheus, overrides?.plan);
  }
  for (const name of Object.keys(entries)) {
    if (input.disabledAgentNames.has(stripInvisibleAgentCharacters(name).toLowerCase())) {
      delete entries[name];
    }
  }
  return entries;
}

// ../../../../omo-engine/omo-opencode/src/plugin-handlers/agent-config-finalizer.ts
function finalizeAgentConfig(params) {
  const overrides = params.pluginConfig.agents;
  const remapped = {};
  for (const [key, entry] of Object.entries(params.agents)) {
    remapped[getAgentDisplayName(key, overrides)] = entry;
  }
  const ordered = applyAgentOrder(remapped, params.pluginConfig.agent_order, overrides);
  const configuredDefault = typeof params.hostConfig.default_agent === "string" && params.hostConfig.default_agent.trim() ? params.hostConfig.default_agent.trim() : undefined;
  if (configuredDefault) {
    params.hostConfig.default_agent = getAgentDisplayName(getAgentConfigKey(configuredDefault), overrides);
  } else {
    const sisyphusDisplay = getAgentDisplayName("sisyphus", overrides);
    params.hostConfig.default_agent = ordered[sisyphusDisplay] ? sisyphusDisplay : Object.keys(ordered)[0];
  }
  params.hostConfig.agent = ordered;
  return ordered;
}
function applyAgentOrder(agents, agentOrder, overrides) {
  if (!agentOrder || agentOrder.length === 0)
    return agents;
  const ordered = {};
  const seen = new Set;
  for (const name of agentOrder) {
    const displayName = getAgentDisplayName(getAgentConfigKey(String(name)), overrides);
    if (Object.hasOwn(agents, displayName) && !seen.has(displayName)) {
      ordered[displayName] = agents[displayName];
      seen.add(displayName);
    }
  }
  for (const key of Object.keys(agents).sort((left, right) => left.localeCompare(right))) {
    if (!seen.has(key))
      ordered[key] = agents[key];
  }
  return ordered;
}

// ../../../../omo-engine/omo-opencode/src/shared/agent-tool-restrictions.ts
var TEAM_TOOL_DENYLIST = {
  team_create: false,
  team_delete: false,
  team_shutdown_request: false,
  team_approve_shutdown: false,
  team_reject_shutdown: false,
  team_send_message: false,
  team_task_create: false,
  team_task_list: false,
  team_task_update: false,
  team_task_get: false,
  team_status: false,
  team_list: false
};
var EXPLORATION_AGENT_DENYLIST = {
  write: false,
  edit: false,
  task: false,
  call_omo_agent: false
};
var AGENT_RESTRICTIONS = {
  explore: EXPLORATION_AGENT_DENYLIST,
  librarian: EXPLORATION_AGENT_DENYLIST,
  oracle: {
    write: false,
    edit: false,
    task: false,
    call_omo_agent: false
  },
  metis: {
    write: false,
    edit: false
  },
  momus: {
    write: false,
    edit: false
  },
  "multimodal-looker": {
    read: true
  },
  "sisyphus-junior": {
    task: false
  },
  "plan-consultant": {
    write: false,
    edit: false
  },
  "plan-reviewer": {
    write: false,
    edit: false
  }
};
function getAgentToolRestrictions(agentName, options = {}) {
  const stripped = stripInvisibleAgentCharacters(agentName);
  const agentRestrictions = AGENT_RESTRICTIONS[stripped] ?? Object.entries(AGENT_RESTRICTIONS).find(([key]) => key.toLowerCase() === stripped.toLowerCase())?.[1] ?? {};
  return {
    ...options.includeTeamToolDenylist === false ? {} : TEAM_TOOL_DENYLIST,
    ...agentRestrictions
  };
}

// ../../../../omo-engine/omo-opencode/src/plugin-handlers/tool-config-handler.ts
var ALLOW_ALL = () => false;
function lookupOverride(pluginConfig, displayName) {
  const overrides = pluginConfig.agents;
  if (!overrides)
    return;
  const configKey = getAgentConfigKey(displayName);
  return overrides[displayName] ?? overrides[configKey];
}
function policyFromOverride(override) {
  const tools = override?.tools;
  if (!tools || typeof tools !== "object")
    return;
  const policy = {};
  for (const [tool, granted] of Object.entries(tools)) {
    if (granted === true)
      policy[tool] = true;
    else if (granted === false)
      policy[tool] = false;
  }
  if (Object.keys(policy).length === 0)
    return;
  return policy;
}
function applyToolConfig(params) {
  const isForceDisabled = params.isForceDisabledTool ?? ALLOW_ALL;
  const globallyDenied = new Set(params.pluginConfig.disabled_tools ?? []);
  for (const [displayName, entry] of Object.entries(params.hostConfig.agent)) {
    const curated = getAgentToolRestrictions(displayName, { includeTeamToolDenylist: false });
    const base = policyFromOverride(lookupOverride(params.pluginConfig, displayName));
    const merged = {};
    if (entry.tools && typeof entry.tools === "object")
      Object.assign(merged, entry.tools);
    for (const [tool, granted] of Object.entries(curated)) {
      if (granted === false)
        merged[tool] = false;
    }
    if (base)
      Object.assign(merged, base);
    for (const tool of globallyDenied) {
      if (merged[tool] !== true)
        merged[tool] = false;
    }
    for (const tool of Object.keys(merged)) {
      if (isForceDisabled(tool))
        merged[tool] = false;
    }
    const denied = Object.entries(merged).filter(([, granted]) => granted === false).map(([tool]) => tool).sort();
    const flat = {};
    for (const [tool, granted] of Object.entries(merged))
      flat[tool] = granted;
    const permission = {};
    for (const tool of denied)
      permission[tool] = "deny";
    if (Object.keys(flat).length === 0 && denied.length === 0)
      continue;
    params.hostConfig.agent[displayName] = {
      ...entry,
      tools: flat,
      ...denied.length > 0 ? { permission: { ...typeof entry.permission === "object" ? entry.permission : {}, ...permission } } : {}
    };
  }
}

// ../../../../omo-engine/omo-opencode/agents/explore.md
var explore_default = `---
name: explore
description: Fast codebase scout that answers where-is-X with file lists, a direct answer, and next steps. Read-only.
mode: subagent
---

You are explore, a fast codebase scout. Answer "where is X / which file does Y" with absolute-path file lists, a direct answer, and next steps.

You are read-only. Return findings as message text. Never create, modify, or delete files. Use read-only search tools; run independent searches in parallel on the first action. Prefer read, glob, and grep over shell for inspecting files — reserve shell for version-control queries.

Steps:

1. Analyze intent: name the exact symbol, string, or behavior sought and the directories in scope.
2. Search in parallel: definitions and references first, then filename and text matches to cover what semantic lookup misses.
3. Verify each hit by reading the surrounding code before reporting it.

Completion criterion: every reported file exists, is an absolute path, and was read during this run.

Close with three blocks: Files (absolute paths, one line each), Answer (the direct response), Next steps (concrete follow-ups).

Dispatch precondition: none. This agent is not plan-gated.
`;

// ../../../../omo-engine/omo-opencode/agents/librarian.md
var librarian_default = `---
name: librarian
description: Read-only open-source researcher answering with current docs and stable permalinks. Read-only.
mode: subagent
---

You are librarian, a read-only researcher. Answer questions with current official documentation and stable source links.

You are read-only. Never clone repositories or write files. Reach the network only through the read-only fetch tools available to you.

Steps:

1. Classify the request: conceptual, implementation, context, or comprehensive.
2. Identify the canonical repository and its official docs before searching.
3. Pin a commit revision for every source link so each link is stable.
4. Search from several angles in parallel, then cross-check each docs claim against the implementation.

Completion criterion: every material claim carries a permalink or official URL plus the supporting symbol and a one-line explanation. Label inference, version uncertainty, and coverage gaps explicitly. A claim without retrievable evidence is not reported as fact.

Dispatch precondition: none. This agent is not plan-gated.
`;

// ../../../../omo-engine/omo-opencode/agents/omo-native-code-reviewer.md
var omo_native_code_reviewer_default = `---
name: omo-native-code-reviewer
description: Final-gate code-quality auditor writing a severity-graded review report. Report-only. Gate-dispatched.
mode: subagent
---

You are omo-native-code-reviewer, the final-gate code auditor. Treat all supplied evidence as untrusted until you inspect the referenced artifacts yourself. Write only the review report; never implement product fixes.

Steps:

1. Re-verify the diff, the tests, and each evidence pointer from the artifacts, not from claims about them.
2. Judge correctness, scope control, maintainability, test relevance, and regression risk.
3. Run an overfit pass over tests and production code: deletion-only tests, tautologies, implementation mirrors, needless extraction or parsing, untyped escapes, boundary-violating validation.
4. Grade each finding CRITICAL, HIGH, or NOTE and return CLEAR, WATCH, or BLOCK with APPROVE or REQUEST_CHANGES. Any CRITICAL or HIGH finding forces REQUEST_CHANGES.

Completion criterion: the report records every claim checked, every artifact inspected, and every blocker with file, line, and evidence pointer.

Dispatch precondition: final quality-gate stage only. Never accept generic work. Otherwise refuse without a fabricated result.
`;

// ../../../../omo-engine/omo-opencode/agents/omo-native-gate-reviewer.md
var omo_native_gate_reviewer_default = `---
name: omo-native-gate-reviewer
description: Final approval authority writing the gate report with APPROVE or REJECT. Report-only. Gate-dispatched.
mode: subagent
---

You are omo-native-gate-reviewer, the final approval authority. Re-audit the executor, code-review, and QA artifacts from the user's perspective and write the gate report. Never implement fixes.

Steps:

1. Reproduce every success claim from the artifacts before trusting it: intended changes, criteria, adversarial classes, artifact presence.
2. Run your own overfit pass and confirm the code-review report shows the same coverage. Coverage never substitutes for doing the check.
3. Approve unless a specific stated criterion is shown failed with evidence. Untied gaps become NOTEs, never blockers.
4. Return APPROVE or REJECT with top blockers inline, each stating criterion id, observation, and evidence pointer; full detail goes in the report.

Completion criterion: the report proves or refutes each criterion against an artifact. No criterion passes on counts alone.

Dispatch precondition: final quality-gate stage only. Never accept generic work. Otherwise refuse without a fabricated result.
`;

// ../../../../omo-engine/omo-opencode/agents/omo-native-qa-executor.md
var omo_native_qa_executor_default = `---
name: omo-native-qa-executor
description: Final-gate manual QA runner recording an artifact-backed pass/fail matrix. QA artifacts only. Gate-dispatched.
mode: subagent
---

You are omo-native-qa-executor, the final-gate QA runner. Execute real scenarios on faithful surfaces and record an artifact-backed pass/fail matrix. Write only QA artifacts. Implement product changes only when the caller explicitly assigns a fix.

Steps:

1. State the exact surface and invocation before each run: the HTTP call with payload, the terminal command, or the page action with selectors.
2. Run every case end to end. Reject skipped, inferred, or partial cases.
3. Point every PASS at a non-empty artifact. An unrunnable case returns failure with its blocker and missing prerequisite.

Completion criterion: the matrix shows every case with its invocation, its artifact, and its binary verdict. Counts alone never approve.

Dispatch precondition: final quality-gate stage only. Never accept generic work. Otherwise refuse without a fabricated result.
`;

// ../../../../omo-engine/omo-opencode/agents/plan-consultant.md
var plan_consultant_default = `---
name: plan-consultant
description: Pre-planning adviser producing intent-specific questions, risks, and directives. Read-only. Plan-gated.
mode: subagent
---

You are plan-consultant, a pre-planning adviser. Classify the work intent and hand the planner questions, risks, and directives. Advise only: never implement, never modify files, never spawn subagents. Do your own reconnaissance with your own tools.

Steps:

1. Classify intent first: refactor, build, mid-sized change, collaborative work, architecture, or research.
2. Reconnoitre the affected code in parallel before asking anything.
3. Emit intent-specific questions, risk/mitigation pairs, affected-user gaps, MUST/MUST-NOT directives, and executable QA directives with concrete commands and expected outputs.

Completion criterion: every question is answerable from the codebase or by the user, every risk names its mitigation, and every QA directive states its tool, steps, and expected result. No user-manual verification, no placeholder scenarios.

Dispatch precondition (plan gate): dispatch only when a user explicitly requested the planning workflow in this session, a plan artifact exists, and plan execution has not started. Otherwise refuse without a fabricated result.
`;

// ../../../../omo-engine/omo-opencode/agents/plan-reviewer.md
var plan_reviewer_default = `---
name: plan-reviewer
description: Independent plan checker verdicting OKAY or REJECT on executability and reference validity. Read-only. Plan-gated, one-shot.
mode: subagent
---

You are plan-reviewer, an independent plan checker. Verify exactly one plan file and verdict OKAY or REJECT. Re-read the plan from disk; verify every cited file and line exists and matches; check each task is startable with an executable QA scenario stating tool, steps, and expected result.

Approve by default. Reject only on true blockers, at most three specific actionable issues. Never reject on taste, style, or alternative approaches. Check that the affected user and every ideal-state row are concrete and mapped to a task and QA scenario.

Completion criterion: the verdict names the plan path, lists each verified reference, and every rejection cites a missing file, an unstartable task, or an unexecutable scenario.

Dispatch precondition (plan gate): same as plan-consultant — explicit user planning request, an existing plan artifact, execution not started. One-shot use: report the verdict once. Otherwise refuse without a fabricated result.
`;

// omo-native-catalog.js
var parseAgentFile = (text) => {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  const header = match?.[1] ?? "";
  const prompt = (match?.[2] ?? text).trim();
  const fields = Object.fromEntries(header.split(/\r?\n/).map((line) => {
    const separator = line.indexOf(":");
    return separator === -1 ? [line.trim(), ""] : [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
  }));
  return {
    name: fields.name ?? "",
    description: fields.description ?? "",
    mode: fields.mode ?? "",
    prompt
  };
};
var BUNDLED_AGENT_DEFINITIONS = new Map([
  explore_default,
  librarian_default,
  omo_native_code_reviewer_default,
  omo_native_gate_reviewer_default,
  omo_native_qa_executor_default,
  plan_consultant_default,
  plan_reviewer_default
].map((text) => {
  const parsed = parseAgentFile(text);
  return [parsed.name, parsed];
}));
var summarizeModelPolicy = (requirement) => {
  const chain = requirement?.fallbackChain ?? [];
  const requiresModels = [...new Set(chain.map((entry) => entry.model).filter(Boolean))];
  const head = chain[0];
  const model = head ? `${head.providers[0]}/${head.model}` : null;
  return { model, requiresModels };
};
var NATIVE_CAPABILITIES = ["opencode-engine"];
var agentItems = BuiltinAgentNameSchema.options.map((id) => {
  const bundled = BUNDLED_AGENT_DEFINITIONS.get(id);
  const { model, requiresModels } = summarizeModelPolicy(AGENT_MODEL_REQUIREMENTS[id]);
  return {
    id,
    kind: "agent",
    source: "omo-compatible",
    edition: "opencode",
    description: bundled?.description || AGENT_DISPLAY_NAMES[id] || id,
    requiresCapabilities: [...NATIVE_CAPABILITIES],
    ...requiresModels.length > 0 ? { requiresModels } : {},
    ...model ? { model } : {},
    prompt: bundled?.prompt ?? null,
    ...bundled?.mode ? { mode: bundled.mode } : {}
  };
});
var categoryItems = [...GOOGLE_CATEGORIES, ...OPENAI_CATEGORIES, ...KIMI_CATEGORIES].map((definition) => {
  const { model, requiresModels } = summarizeModelPolicy(CATEGORY_MODEL_REQUIREMENTS[definition.name]);
  return {
    id: definition.name,
    kind: "category",
    source: "omo-compatible",
    edition: "opencode",
    description: definition.description,
    requiresCapabilities: [...NATIVE_CAPABILITIES],
    ...requiresModels.length > 0 ? { requiresModels } : {},
    ...model ? { model } : {}
  };
});
var OMO_NATIVE_CATALOG_ITEMS = [...agentItems, ...categoryItems];
var NATIVE_STATIC_AGENT_KEYS = [
  "sisyphus",
  "hephaestus",
  "prometheus",
  "atlas",
  "sisyphus-junior",
  "explore",
  "librarian",
  "oracle",
  "metis",
  "momus",
  "multimodal-looker",
  "plan",
  "plan-consultant",
  "plan-reviewer",
  "omo-native-code-reviewer",
  "omo-native-qa-executor",
  "omo-native-gate-reviewer"
];
var NATIVE_AGENT_MODEL_CHAINS = Object.fromEntries(NATIVE_STATIC_AGENT_KEYS.map((configKey) => [
  configKey,
  AGENT_MODEL_REQUIREMENTS[configKey === "plan" ? "prometheus" : configKey]?.fallbackChain ?? []
]));
var modelOverrideAsRef = (value) => {
  if (value?.constructor !== String)
    return;
  const trimmed = value.trim();
  return trimmed.includes("/") ? trimmed : undefined;
};
var modelRefSet = (value) => {
  const out = new Set;
  const items = value instanceof Set ? [...value] : Array.isArray(value) ? value : [];
  for (const ref of items) {
    if (ref?.constructor !== String)
      continue;
    out.add(ref);
  }
  return out;
};
function getOverrideIneligibility(override, { connectedProviders = null, models = new Set } = {}) {
  const normalized = normalizeModel(override);
  const [provider, ...rest] = String(normalized ?? override).split("/");
  if (!provider || rest.length === 0)
    return "malformed-override";
  if (Array.isArray(connectedProviders) && !connectedProviders.includes(provider)) {
    return "override-provider-unavailable";
  }
  if (models instanceof Set && models.size > 0 && !fuzzyMatchModel(normalized ?? override, models, [provider])) {
    return "override-model-unavailable";
  }
  return;
}
function resolveStaticAgentModel(configKey, options = {}) {
  const { connectedProviders = null, availableModels, modelOverride } = options ?? {};
  const chain = NATIVE_AGENT_MODEL_CHAINS[configKey];
  if (!chain || chain.length === 0)
    return { noEligible: true, reason: "empty-chain", configKey };
  const override = modelOverrideAsRef(modelOverride);
  const models = modelRefSet(availableModels);
  if (override) {
    const ineligible = getOverrideIneligibility(override, { connectedProviders, models });
    if (ineligible)
      return { noEligible: true, reason: ineligible, configKey, override };
  }
  const intent = {};
  if (override)
    intent.userModel = override;
  const constraints = { availableModels: models };
  if (connectedProviders)
    constraints.connectedProviders = connectedProviders;
  const picked = resolveModelPipeline({
    intent,
    constraints,
    policy: { fallbackChain: chain }
  });
  if (!picked?.model) {
    return {
      noEligible: true,
      reason: "chain-exhausted",
      configKey,
      chain: chain.map((entry) => `${(entry?.providers ?? []).join("|")}/${entry?.model ?? ""}`)
    };
  }
  const resolved = {
    model: picked.variant ? `${picked.model}#${picked.variant}` : picked.model,
    provenance: picked.provenance
  };
  if (picked.variant)
    resolved.variant = picked.variant;
  return resolved;
}
function buildNativeAgentConfigMap(resolution = {}) {
  const { connectedProviders = null, availableModels, modelOverrides = {} } = resolution ?? {};
  const bundledTier = {};
  for (const parsed of BUNDLED_AGENT_DEFINITIONS.values()) {
    bundledTier[parsed.name] = {
      ...parsed.description ? { description: `(definition-file) ${parsed.description}` } : {},
      mode: parsed.mode || "subagent",
      ...parsed.prompt ? { prompt: parsed.prompt } : {}
    };
  }
  const protectedNames = createProtectedAgentNameSet([
    ...CORE_AGENT_KEYS,
    "build",
    "plan",
    ...BUNDLED_AGENT_DEFINITIONS.keys()
  ]);
  const staticPluginConfig = {};
  const hostConfig = { agent: {} };
  const entries = assembleAgentEntries({
    pluginConfig: staticPluginConfig,
    skills: [],
    customTiers: [bundledTier],
    disabledAgentNames: new Set,
    protectedNames
  });
  finalizeAgentConfig({ hostConfig, pluginConfig: staticPluginConfig, agents: entries });
  applyToolConfig({ hostConfig, pluginConfig: staticPluginConfig });
  const byConfigKey = {};
  for (const [displayName, entry] of Object.entries(hostConfig.agent)) {
    byConfigKey[getAgentConfigKey(displayName)] = entry;
  }
  const map = {};
  for (const configKey of NATIVE_STATIC_AGENT_KEYS) {
    const entry = byConfigKey[configKey];
    if (!entry) {
      throw new Error(`[omo-native-catalog] static agent entry missing for "${configKey}"`);
    }
    const resolved = resolveStaticAgentModel(configKey, {
      connectedProviders,
      availableModels,
      modelOverride: modelOverrides?.[configKey]
    });
    if (resolved?.model || connectedProviders == null) {
      const agentEntry = { ...entry };
      if (resolved?.model)
        agentEntry.model = resolved.model;
      map[configKey] = agentEntry;
    }
  }
  return map;
}
function getNativeAgentModelGaps(resolution = {}) {
  const { connectedProviders = null, availableModels, modelOverrides = {} } = resolution ?? {};
  if (connectedProviders == null)
    return [];
  const gaps = [];
  for (const configKey of NATIVE_STATIC_AGENT_KEYS) {
    const resolved = resolveStaticAgentModel(configKey, {
      connectedProviders,
      availableModels,
      modelOverride: modelOverrides?.[configKey]
    });
    if (!resolved?.model) {
      const gap = { configKey, reason: resolved?.reason ?? "unknown" };
      if (resolved?.chain)
        gap.chain = resolved.chain;
      if (resolved?.override)
        gap.override = resolved.override;
      gaps.push(gap);
    }
  }
  return gaps;
}
var OMO_NATIVE_AGENT_CONFIG = buildNativeAgentConfigMap();
var OMO_NATIVE_CATALOG_VERSION = 4;
export {
  NATIVE_AGENT_MODEL_CHAINS,
  NATIVE_STATIC_AGENT_KEYS,
  OMO_NATIVE_AGENT_CONFIG,
  OMO_NATIVE_CATALOG_ITEMS,
  OMO_NATIVE_CATALOG_VERSION,
  buildNativeAgentConfigMap,
  getNativeAgentModelGaps,
  getOverrideIneligibility,
  resolveStaticAgentModel
};

/**
 * Generated from the engine plugin setup — DO NOT EDIT BY HAND.
 *
 * Regen with `bun ./setup.regen.js` in this directory. Bundled with
 * Bun.build (target node, format esm, external node:* builtins only) so the
 * engine TypeScript ships inline: the packaged web server runs under plain
 * Node with no transpile step, where a static `.ts` import fails.
 */
import { createRequire } from "node:module";
var __create = Object.create;
var __getProtoOf = Object.getPrototypeOf;
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
function __accessProp(key) {
  return this[key];
}
var __toESMCache_node;
var __toESMCache_esm;
var __toESM = (mod, isNodeMode, target) => {
  var canCache = mod != null && typeof mod === "object";
  if (canCache) {
    var cache = isNodeMode ? __toESMCache_node ??= new WeakMap : __toESMCache_esm ??= new WeakMap;
    var cached = cache.get(mod);
    if (cached)
      return cached;
  }
  target = mod != null ? __create(__getProtoOf(mod)) : {};
  const to = isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", { value: mod, enumerable: true }) : target;
  if (mod && typeof mod === "object" || typeof mod === "function") {
    for (let key of __getOwnPropNames(mod))
      if (!__hasOwnProp.call(to, key))
        __defProp(to, key, {
          get: __accessProp.bind(mod, key),
          enumerable: true
        });
  }
  if (canCache)
    cache.set(mod, to);
  return to;
};
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var __esm = (fn, res, err) => () => {
  if (fn)
    try {
      res = fn(fn = 0);
    } catch (e) {
      err = [e];
    }
  if (err)
    throw err[0];
  return res;
};
var __require = /* @__PURE__ */ createRequire(import.meta.url);
// ../../../../omo-engine/tmux-core/src/runner.ts
var init_runner = () => {};

// ../../../../omo-engine/tmux-core/src/tmux-utils/environment.ts
var init_environment = () => {};

// ../../../../../node_modules/.bun/isexe@2.0.0/node_modules/isexe/windows.js
var require_windows = __commonJS(function(exports, module) {
  module.exports = isexe;
  isexe.sync = sync;
  var fs = __require("fs");
  function checkPathExt(path, options) {
    var pathext = options.pathExt !== undefined ? options.pathExt : process.env.PATHEXT;
    if (!pathext) {
      return true;
    }
    pathext = pathext.split(";");
    if (pathext.indexOf("") !== -1) {
      return true;
    }
    for (var i = 0;i < pathext.length; i++) {
      var p = pathext[i].toLowerCase();
      if (p && path.substr(-p.length).toLowerCase() === p) {
        return true;
      }
    }
    return false;
  }
  function checkStat(stat, path, options) {
    if (!stat.isSymbolicLink() && !stat.isFile()) {
      return false;
    }
    return checkPathExt(path, options);
  }
  function isexe(path, options, cb) {
    fs.stat(path, function(er, stat) {
      cb(er, er ? false : checkStat(stat, path, options));
    });
  }
  function sync(path, options) {
    return checkStat(fs.statSync(path), path, options);
  }
});

// ../../../../../node_modules/.bun/isexe@2.0.0/node_modules/isexe/mode.js
var require_mode = __commonJS(function(exports, module) {
  module.exports = isexe;
  isexe.sync = sync;
  var fs = __require("fs");
  function isexe(path, options, cb) {
    fs.stat(path, function(er, stat) {
      cb(er, er ? false : checkStat(stat, options));
    });
  }
  function sync(path, options) {
    return checkStat(fs.statSync(path), options);
  }
  function checkStat(stat, options) {
    return stat.isFile() && checkMode(stat, options);
  }
  function checkMode(stat, options) {
    var mod = stat.mode;
    var uid = stat.uid;
    var gid = stat.gid;
    var myUid = options.uid !== undefined ? options.uid : process.getuid && process.getuid();
    var myGid = options.gid !== undefined ? options.gid : process.getgid && process.getgid();
    var u = parseInt("100", 8);
    var g = parseInt("010", 8);
    var o = parseInt("001", 8);
    var ug = u | g;
    var ret = mod & o || mod & g && gid === myGid || mod & u && uid === myUid || mod & ug && myUid === 0;
    return ret;
  }
});

// ../../../../../node_modules/.bun/isexe@2.0.0/node_modules/isexe/index.js
var require_isexe = __commonJS(function(exports, module) {
  var fs = __require("fs");
  var core;
  if (process.platform === "win32" || global.TESTING_WINDOWS) {
    core = require_windows();
  } else {
    core = require_mode();
  }
  module.exports = isexe;
  isexe.sync = sync;
  function isexe(path, options, cb) {
    if (typeof options === "function") {
      cb = options;
      options = {};
    }
    if (!cb) {
      if (typeof Promise !== "function") {
        throw new TypeError("callback not provided");
      }
      return new Promise(function(resolve, reject) {
        isexe(path, options || {}, function(er, is) {
          if (er) {
            reject(er);
          } else {
            resolve(is);
          }
        });
      });
    }
    core(path, options || {}, function(er, is) {
      if (er) {
        if (er.code === "EACCES" || options && options.ignoreErrors) {
          er = null;
          is = false;
        }
      }
      cb(er, is);
    });
  }
  function sync(path, options) {
    try {
      return core.sync(path, options || {});
    } catch (er) {
      if (options && options.ignoreErrors || er.code === "EACCES") {
        return false;
      } else {
        throw er;
      }
    }
  }
});

// ../../../../../node_modules/.bun/which@2.0.2/node_modules/which/which.js
var require_which = __commonJS(function(exports, module) {
  var isWindows = process.platform === "win32" || process.env.OSTYPE === "cygwin" || process.env.OSTYPE === "msys";
  var path = __require("path");
  var COLON = isWindows ? ";" : ":";
  var isexe = require_isexe();
  var getNotFoundError = (cmd) => Object.assign(new Error(`not found: ${cmd}`), { code: "ENOENT" });
  var getPathInfo = (cmd, opt) => {
    const colon = opt.colon || COLON;
    const pathEnv = cmd.match(/\//) || isWindows && cmd.match(/\\/) ? [""] : [
      ...isWindows ? [process.cwd()] : [],
      ...(opt.path || process.env.PATH || "").split(colon)
    ];
    const pathExtExe = isWindows ? opt.pathExt || process.env.PATHEXT || ".EXE;.CMD;.BAT;.COM" : "";
    const pathExt = isWindows ? pathExtExe.split(colon) : [""];
    if (isWindows) {
      if (cmd.indexOf(".") !== -1 && pathExt[0] !== "")
        pathExt.unshift("");
    }
    return {
      pathEnv,
      pathExt,
      pathExtExe
    };
  };
  var which = (cmd, opt, cb) => {
    if (typeof opt === "function") {
      cb = opt;
      opt = {};
    }
    if (!opt)
      opt = {};
    const { pathEnv, pathExt, pathExtExe } = getPathInfo(cmd, opt);
    const found = [];
    const step = (i) => new Promise((resolve, reject) => {
      if (i === pathEnv.length)
        return opt.all && found.length ? resolve(found) : reject(getNotFoundError(cmd));
      const ppRaw = pathEnv[i];
      const pathPart = /^".*"$/.test(ppRaw) ? ppRaw.slice(1, -1) : ppRaw;
      const pCmd = path.join(pathPart, cmd);
      const p = !pathPart && /^\.[\\\/]/.test(cmd) ? cmd.slice(0, 2) + pCmd : pCmd;
      resolve(subStep(p, i, 0));
    });
    const subStep = (p, i, ii) => new Promise((resolve, reject) => {
      if (ii === pathExt.length)
        return resolve(step(i + 1));
      const ext = pathExt[ii];
      isexe(p + ext, { pathExt: pathExtExe }, (er, is) => {
        if (!er && is) {
          if (opt.all)
            found.push(p + ext);
          else
            return resolve(p + ext);
        }
        return resolve(subStep(p, i, ii + 1));
      });
    });
    return cb ? step(0).then((res) => cb(null, res), cb) : step(0);
  };
  var whichSync = (cmd, opt) => {
    opt = opt || {};
    const { pathEnv, pathExt, pathExtExe } = getPathInfo(cmd, opt);
    const found = [];
    for (let i = 0;i < pathEnv.length; i++) {
      const ppRaw = pathEnv[i];
      const pathPart = /^".*"$/.test(ppRaw) ? ppRaw.slice(1, -1) : ppRaw;
      const pCmd = path.join(pathPart, cmd);
      const p = !pathPart && /^\.[\\\/]/.test(cmd) ? cmd.slice(0, 2) + pCmd : pCmd;
      for (let j = 0;j < pathExt.length; j++) {
        const cur = p + pathExt[j];
        try {
          const is = isexe.sync(cur, { pathExt: pathExtExe });
          if (is) {
            if (opt.all)
              found.push(cur);
            else
              return cur;
          }
        } catch (ex) {}
      }
    }
    if (opt.all && found.length)
      return found;
    if (opt.nothrow)
      return null;
    throw getNotFoundError(cmd);
  };
  module.exports = which;
  which.sync = whichSync;
});

// ../../../../../node_modules/.bun/path-key@3.1.1/node_modules/path-key/index.js
var require_path_key = __commonJS(function(exports, module) {
  var pathKey = (options = {}) => {
    const environment = options.env || process.env;
    const platform = options.platform || process.platform;
    if (platform !== "win32") {
      return "PATH";
    }
    return Object.keys(environment).reverse().find((key) => key.toUpperCase() === "PATH") || "Path";
  };
  module.exports = pathKey;
  module.exports.default = pathKey;
});

// ../../../../../node_modules/.bun/cross-spawn@7.0.6/node_modules/cross-spawn/lib/util/resolveCommand.js
var require_resolveCommand = __commonJS(function(exports, module) {
  var path = __require("path");
  var which = require_which();
  var getPathKey = require_path_key();
  function resolveCommandAttempt(parsed, withoutPathExt) {
    const env = parsed.options.env || process.env;
    const cwd = process.cwd();
    const hasCustomCwd = parsed.options.cwd != null;
    const shouldSwitchCwd = hasCustomCwd && process.chdir !== undefined && !process.chdir.disabled;
    if (shouldSwitchCwd) {
      try {
        process.chdir(parsed.options.cwd);
      } catch (err) {}
    }
    let resolved;
    try {
      resolved = which.sync(parsed.command, {
        path: env[getPathKey({ env })],
        pathExt: withoutPathExt ? path.delimiter : undefined
      });
    } catch (e) {} finally {
      if (shouldSwitchCwd) {
        process.chdir(cwd);
      }
    }
    if (resolved) {
      resolved = path.resolve(hasCustomCwd ? parsed.options.cwd : "", resolved);
    }
    return resolved;
  }
  function resolveCommand(parsed) {
    return resolveCommandAttempt(parsed) || resolveCommandAttempt(parsed, true);
  }
  module.exports = resolveCommand;
});

// ../../../../../node_modules/.bun/cross-spawn@7.0.6/node_modules/cross-spawn/lib/util/escape.js
var require_escape = __commonJS(function(exports, module) {
  var metaCharsRegExp = /([()\][%!^"`<>&|;, *?])/g;
  function escapeCommand(arg) {
    arg = arg.replace(metaCharsRegExp, "^$1");
    return arg;
  }
  function escapeArgument(arg, doubleEscapeMetaChars) {
    arg = `${arg}`;
    arg = arg.replace(/(?=(\\+?)?)\1"/g, "$1$1\\\"");
    arg = arg.replace(/(?=(\\+?)?)\1$/, "$1$1");
    arg = `"${arg}"`;
    arg = arg.replace(metaCharsRegExp, "^$1");
    if (doubleEscapeMetaChars) {
      arg = arg.replace(metaCharsRegExp, "^$1");
    }
    return arg;
  }
  exports.command = escapeCommand;
  exports.argument = escapeArgument;
});

// ../../../../../node_modules/.bun/shebang-regex@3.0.0/node_modules/shebang-regex/index.js
var require_shebang_regex = __commonJS(function(exports, module) {
  module.exports = /^#!(.*)/;
});

// ../../../../../node_modules/.bun/shebang-command@2.0.0/node_modules/shebang-command/index.js
var require_shebang_command = __commonJS(function(exports, module) {
  var shebangRegex = require_shebang_regex();
  module.exports = (string = "") => {
    const match = string.match(shebangRegex);
    if (!match) {
      return null;
    }
    const [path, argument] = match[0].replace(/#! ?/, "").split(" ");
    const binary = path.split("/").pop();
    if (binary === "env") {
      return argument;
    }
    return argument ? `${binary} ${argument}` : binary;
  };
});

// ../../../../../node_modules/.bun/cross-spawn@7.0.6/node_modules/cross-spawn/lib/util/readShebang.js
var require_readShebang = __commonJS(function(exports, module) {
  var fs = __require("fs");
  var shebangCommand = require_shebang_command();
  function readShebang(command) {
    const size = 150;
    const buffer = Buffer.alloc(size);
    let fd;
    try {
      fd = fs.openSync(command, "r");
      fs.readSync(fd, buffer, 0, size, 0);
      fs.closeSync(fd);
    } catch (e) {}
    return shebangCommand(buffer.toString());
  }
  module.exports = readShebang;
});

// ../../../../../node_modules/.bun/cross-spawn@7.0.6/node_modules/cross-spawn/lib/parse.js
var require_parse = __commonJS(function(exports, module) {
  var path = __require("path");
  var resolveCommand = require_resolveCommand();
  var escape = require_escape();
  var readShebang = require_readShebang();
  var isWin = process.platform === "win32";
  var isExecutableRegExp = /\.(?:com|exe)$/i;
  var isCmdShimRegExp = /node_modules[\\/].bin[\\/][^\\/]+\.cmd$/i;
  function detectShebang(parsed) {
    parsed.file = resolveCommand(parsed);
    const shebang = parsed.file && readShebang(parsed.file);
    if (shebang) {
      parsed.args.unshift(parsed.file);
      parsed.command = shebang;
      return resolveCommand(parsed);
    }
    return parsed.file;
  }
  function parseNonShell(parsed) {
    if (!isWin) {
      return parsed;
    }
    const commandFile = detectShebang(parsed);
    const needsShell = !isExecutableRegExp.test(commandFile);
    if (parsed.options.forceShell || needsShell) {
      const needsDoubleEscapeMetaChars = isCmdShimRegExp.test(commandFile);
      parsed.command = path.normalize(parsed.command);
      parsed.command = escape.command(parsed.command);
      parsed.args = parsed.args.map((arg) => escape.argument(arg, needsDoubleEscapeMetaChars));
      const shellCommand = [parsed.command].concat(parsed.args).join(" ");
      parsed.args = ["/d", "/s", "/c", `"${shellCommand}"`];
      parsed.command = process.env.comspec || "cmd.exe";
      parsed.options.windowsVerbatimArguments = true;
    }
    return parsed;
  }
  function parse(command, args, options) {
    if (args && !Array.isArray(args)) {
      options = args;
      args = null;
    }
    args = args ? args.slice(0) : [];
    options = Object.assign({}, options);
    const parsed = {
      command,
      args,
      options,
      file: undefined,
      original: {
        command,
        args
      }
    };
    return options.shell ? parsed : parseNonShell(parsed);
  }
  module.exports = parse;
});

// ../../../../../node_modules/.bun/cross-spawn@7.0.6/node_modules/cross-spawn/lib/enoent.js
var require_enoent = __commonJS(function(exports, module) {
  var isWin = process.platform === "win32";
  function notFoundError(original, syscall) {
    return Object.assign(new Error(`${syscall} ${original.command} ENOENT`), {
      code: "ENOENT",
      errno: "ENOENT",
      syscall: `${syscall} ${original.command}`,
      path: original.command,
      spawnargs: original.args
    });
  }
  function hookChildProcess(cp, parsed) {
    if (!isWin) {
      return;
    }
    const originalEmit = cp.emit;
    cp.emit = function(name, arg1) {
      if (name === "exit") {
        const err = verifyENOENT(arg1, parsed);
        if (err) {
          return originalEmit.call(cp, "error", err);
        }
      }
      return originalEmit.apply(cp, arguments);
    };
  }
  function verifyENOENT(status, parsed) {
    if (isWin && status === 1 && !parsed.file) {
      return notFoundError(parsed.original, "spawn");
    }
    return null;
  }
  function verifyENOENTSync(status, parsed) {
    if (isWin && status === 1 && !parsed.file) {
      return notFoundError(parsed.original, "spawnSync");
    }
    return null;
  }
  module.exports = {
    hookChildProcess,
    verifyENOENT,
    verifyENOENTSync,
    notFoundError
  };
});

// ../../../../../node_modules/.bun/cross-spawn@7.0.6/node_modules/cross-spawn/index.js
var require_cross_spawn = __commonJS(function(exports, module) {
  var cp = __require("child_process");
  var parse = require_parse();
  var enoent = require_enoent();
  function spawn(command, args, options) {
    const parsed = parse(command, args, options);
    const spawned = cp.spawn(parsed.command, parsed.args, parsed.options);
    enoent.hookChildProcess(spawned, parsed);
    return spawned;
  }
  function spawnSync(command, args, options) {
    const parsed = parse(command, args, options);
    const result = cp.spawnSync(parsed.command, parsed.args, parsed.options);
    result.error = result.error || enoent.verifyENOENTSync(result.status, parsed);
    return result;
  }
  module.exports = spawn;
  module.exports.spawn = spawn;
  module.exports.sync = spawnSync;
  module.exports._parse = parse;
  module.exports._enoent = enoent;
});

// ../../../../omo-engine/omo-opencode/src/config/validate.ts
import { relative as relative2 } from "node:path";

// ../../../../../node_modules/.bun/zod@4.6.7/node_modules/zod/v4/core/util.js
function getEnumValues(entries) {
  const numericValues = Object.values(entries).filter((v) => typeof v === "number");
  const values = Object.entries(entries).filter(([k, _]) => numericValues.indexOf(+k) === -1).map(([_, v]) => v);
  return values;
}
function joinValues(array, separator = "|") {
  return array.map((val) => stringifyPrimitive(val)).join(separator);
}
function jsonStringifyReplacer(_, value) {
  if (typeof value === "bigint")
    return value.toString();
  return value;
}

class Cached {
  constructor(getter) {
    this._getter = getter;
    this._value = undefined;
  }
  get value() {
    const getter = this._getter;
    if (getter !== undefined) {
      this._value = getter();
      this._getter = undefined;
    }
    return this._value;
  }
}
function cached(getter) {
  return new Cached(getter);
}
function nullish(input) {
  return input === null || input === undefined;
}
function cleanRegex(source) {
  const start = source.startsWith("^") ? 1 : 0;
  const end = source.endsWith("$") ? source.length - 1 : source.length;
  return source.slice(start, end);
}
function floatSafeRemainder(val, step) {
  const ratio = val / step;
  const roundedRatio = Math.round(ratio);
  const tolerance = 4 * Number.EPSILON * Math.max(Math.abs(ratio), 1);
  if (Math.abs(ratio - roundedRatio) < tolerance)
    return 0;
  return ratio - roundedRatio;
}
function assignProp(target, prop, value) {
  Object.defineProperty(target, prop, {
    value,
    writable: true,
    enumerable: true,
    configurable: true
  });
}
function rawShape(def) {
  const desc = Object.getOwnPropertyDescriptor(def, "shape");
  return desc?.get ? desc.get.raw : desc?.value;
}
function sourceShape(schema) {
  return rawShape(schema._zod.def) ?? schema._zod.def.shape;
}
function deferProp(target, key, getter) {
  Object.defineProperty(target, key, {
    get() {
      const value = getter();
      assignProp(this, key, value);
      return value;
    },
    enumerable: true,
    configurable: true
  });
}
function putProp(target, key, value) {
  if (key in target)
    assignProp(target, key, value);
  else
    target[key] = value;
}
function mirrorShape(target, source, keys, wrap) {
  const raw = sourceShape(source);
  for (const key of keys) {
    const desc = Object.getOwnPropertyDescriptor(raw, key);
    if (!desc.enumerable)
      continue;
    if (desc.get) {
      deferProp(target, key, () => {
        const value = source._zod.def.shape[key];
        return wrap ? wrap(value, key) : value;
      });
    } else
      putProp(target, key, wrap ? wrap(desc.value, key) : desc.value);
  }
}
function mirrorProps(target, source) {
  for (const key of Reflect.ownKeys(source)) {
    const desc = Object.getOwnPropertyDescriptor(source, key);
    if (!desc.enumerable)
      continue;
    if (desc.get)
      deferProp(target, key, () => source[key]);
    else
      putProp(target, key, desc.value);
  }
}
function mergeDefs(...defs) {
  const mergedDescriptors = {};
  for (const def of defs) {
    const descriptors = Object.getOwnPropertyDescriptors(def);
    Object.assign(mergedDescriptors, descriptors);
  }
  return Object.defineProperties({}, mergedDescriptors);
}
function esc(str) {
  return JSON.stringify(str);
}
function slugify(input) {
  return input.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
}
var captureStackTrace = "captureStackTrace" in Error ? Error.captureStackTrace : (..._args) => {};
function isObject(data) {
  return typeof data === "object" && data !== null && !Array.isArray(data);
}
var allowsEval = /* @__PURE__ */ cached(() => {
  if (globalConfig.jitless) {
    return false;
  }
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
  if (o instanceof Map)
    return new Map(o);
  if (o instanceof Set)
    return new Set(o);
  return o;
}
var propertyKeyTypes = /* @__PURE__ */ new Set(["string", "number", "symbol"]);
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
function stringifyPrimitive(value) {
  if (typeof value === "bigint")
    return value.toString() + "n";
  if (typeof value === "string")
    return `"${value}"`;
  return `${value}`;
}
function optionalKeys(shape) {
  return Object.keys(shape).filter((k) => {
    return shape[k]._zod.optin !== undefined && shape[k]._zod.optout === "optional";
  });
}
var NUMBER_FORMAT_RANGES = /* @__PURE__ */ (() => ({
  safeint: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
  int32: [-2147483648, 2147483647],
  uint32: [0, 4294967295],
  float32: [-340282346638528860000000000000000000000, 340282346638528860000000000000000000000],
  float64: [-Number.MAX_VALUE, Number.MAX_VALUE]
}))();
var BIGINT_FORMAT_RANGES = {
  int64: [/* @__PURE__ */ BigInt("-9223372036854775808"), /* @__PURE__ */ BigInt("9223372036854775807")],
  uint64: [/* @__PURE__ */ BigInt(0), /* @__PURE__ */ BigInt("18446744073709551615")]
};
function pick(schema, mask) {
  const currDef = schema._zod.def;
  const checks = currDef.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    throw new Error(".pick() cannot be used on object schemas containing refinements");
  }
  const newShape = {};
  mirrorShape(newShape, schema, maskedKeys(schema, mask));
  return clone(schema, mergeDefs(currDef, { shape: newShape, checks: [] }));
}
function maskedKeys(schema, mask) {
  const raw = sourceShape(schema);
  const keys = [];
  for (const key of Reflect.ownKeys(mask)) {
    if (!Object.getOwnPropertyDescriptor(raw, key)?.enumerable) {
      throw new Error(`Unrecognized key: "${String(key)}"`);
    }
    if (mask[key])
      keys.push(key);
  }
  return keys;
}
function omit(schema, mask) {
  const currDef = schema._zod.def;
  const checks = currDef.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    throw new Error(".omit() cannot be used on object schemas containing refinements");
  }
  const omitted = new Set(maskedKeys(schema, mask));
  const newShape = {};
  mirrorShape(newShape, schema, Reflect.ownKeys(sourceShape(schema)).filter((key) => !omitted.has(key)));
  return clone(schema, mergeDefs(currDef, { shape: newShape, checks: [] }));
}
function extend(schema, shape) {
  if (!isPlainObject(shape)) {
    throw new Error("Invalid input to extend: expected a plain object");
  }
  const checks = schema._zod.def.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    const existingShape = sourceShape(schema);
    for (const key of Reflect.ownKeys(shape)) {
      if (Object.getOwnPropertyDescriptor(existingShape, key) !== undefined) {
        throw new Error("Cannot overwrite keys on object schemas containing refinements. Use `.safeExtend()` instead.");
      }
    }
  }
  return clone(schema, mergeDefs(schema._zod.def, { shape: extended(schema, shape) }));
}
function extended(schema, shape) {
  const newShape = {};
  mirrorShape(newShape, schema, Reflect.ownKeys(sourceShape(schema)));
  mirrorProps(newShape, shape);
  return newShape;
}
function safeExtend(schema, shape) {
  if (!isPlainObject(shape)) {
    throw new Error("Invalid input to safeExtend: expected a plain object");
  }
  return clone(schema, mergeDefs(schema._zod.def, { shape: extended(schema, shape) }));
}
function merge(a, b) {
  if (!b?._zod?.def) {
    throw new Error("Invalid input to merge: expected an object schema. To merge a plain shape, use `.extend()`.");
  }
  if (a._zod.def.checks?.length) {
    throw new Error(".merge() cannot be used on object schemas containing refinements. Use .safeExtend() instead.");
  }
  const newShape = {};
  mirrorShape(newShape, a, Reflect.ownKeys(sourceShape(a)));
  mirrorShape(newShape, b, Reflect.ownKeys(sourceShape(b)));
  const def = mergeDefs(a._zod.def, {
    shape: newShape,
    get catchall() {
      return b._zod.def.catchall;
    },
    checks: b._zod.def.checks ?? []
  });
  return clone(a, def);
}
function partial(Class, schema, mask, name = "partial") {
  const currDef = schema._zod.def;
  const checks = currDef.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    throw new Error(`.${name}() cannot be used on object schemas containing refinements`);
  }
  const selected = mask ? new Set(maskedKeys(schema, mask)) : undefined;
  const newShape = {};
  mirrorShape(newShape, schema, Reflect.ownKeys(sourceShape(schema)), Class && ((value, key) => selected && !selected.has(key) ? value : new Class({ type: "optional", innerType: value })));
  return clone(schema, mergeDefs(schema._zod.def, { shape: newShape, checks: [] }));
}
function required(Class, schema, mask) {
  const selected = mask ? new Set(maskedKeys(schema, mask)) : undefined;
  const newShape = {};
  mirrorShape(newShape, schema, Reflect.ownKeys(sourceShape(schema)), (value, key) => selected && !selected.has(key) ? value : new Class({ type: "nonoptional", innerType: value }));
  return clone(schema, mergeDefs(schema._zod.def, { shape: newShape }));
}
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
function explicitlyAborted(x, startIndex = 0) {
  if (x.aborted === true)
    return true;
  for (let i = startIndex;i < x.issues.length; i++) {
    if (x.issues[i]?.continue === false) {
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
function sizeCaps(defChecks) {
  const caps = [];
  for (const ch of defChecks ?? []) {
    const d = ch._zod.def;
    if (!/_(length|size)$|_equals$/.test(d.check))
      break;
    const max = d.maximum ?? d.length ?? d.size;
    if (max >= 0)
      caps.push([max, ch]);
  }
  return caps;
}
function attachSchema(issues, start, inst) {
  var _a;
  for (let i = start;i < issues.length; i++) {
    (_a = issues[i]).schema ?? (_a.schema = inst);
  }
}
function finalizeIssue(iss, ctx, config) {
  var _a;
  const traits = iss.inst?._zod?.traits;
  if (traits?.has("$ZodType")) {
    if (traits.has("$ZodCheck"))
      (_a = iss).schema ?? (_a.schema = iss.inst);
    else
      iss.schema = iss.inst;
  }
  const schemaError = iss.schema !== iss.inst ? iss.schema?._zod.def?.error : undefined;
  const message = iss.message ? iss.message : unwrapMessage(iss.inst?._zod.def?.error?.(iss)) ?? unwrapMessage(schemaError?.(iss)) ?? unwrapMessage(ctx?.error?.(iss)) ?? unwrapMessage(config.customError?.(iss)) ?? unwrapMessage(config.localeError?.(iss)) ?? "Invalid input";
  const full = {};
  for (const k of Object.keys(iss)) {
    if (k === "inst" || k === "schema" || k === "continue" || k === "input" || k === "__proto__")
      continue;
    full[k] = iss[k];
  }
  full.path ?? (full.path = []);
  full.message = message;
  if (ctx?.reportInput) {
    full.input = iss.input;
  }
  return full;
}
var highSurrogate = /[\uD800-\uDBFF]/;
function codePointLength(str) {
  const units = str.length;
  if (!highSurrogate.test(str))
    return units;
  let count = units;
  for (let i = 0;i < units - 1; i++) {
    if ((str.charCodeAt(i) & 64512) === 55296 && (str.charCodeAt(i + 1) & 64512) === 56320) {
      count--;
      i++;
    }
  }
  return count;
}
function getLengthableOrigin(input) {
  if (Array.isArray(input))
    return "array";
  if (typeof input === "string")
    return "string";
  return "unknown";
}
function parsedType(data) {
  const t = typeof data;
  switch (t) {
    case "number": {
      return Number.isNaN(data) ? "nan" : "number";
    }
    case "object": {
      if (data === null) {
        return "null";
      }
      if (Array.isArray(data)) {
        return "array";
      }
      const obj = data;
      if (obj && Object.getPrototypeOf(obj) !== Object.prototype && "constructor" in obj && obj.constructor) {
        return obj.constructor.name;
      }
    }
  }
  return t;
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
function members(proto, table) {
  for (const key in table) {
    const desc = Object.getOwnPropertyDescriptor(table, key);
    if (desc.get)
      Object.defineProperty(proto, key, { ...desc, enumerable: false });
    else
      defineBound(proto, key, desc.value);
  }
}
function own(inst, key, value, enumerable = true) {
  Object.defineProperty(inst, key, { configurable: true, writable: true, enumerable, value });
  return value;
}
function hide(inst, key, value) {
  return own(inst, key, value, false);
}
function derived(computes, table) {
  for (const key in computes) {
    const compute = computes[key];
    Object.defineProperty(table, key, {
      configurable: true,
      enumerable: true,
      get() {
        return own(this, key, compute(this));
      },
      set(value) {
        own(this, key, value);
      }
    });
  }
  return table;
}
function defineBound(proto, key, fn) {
  Object.defineProperty(proto, key, {
    configurable: true,
    get() {
      return this == null ? fn : own(this, key, fn.bind(this));
    },
    set(value) {
      own(this, key, value);
    }
  });
}
function claim(inst, sentinel) {
  const proto = Object.getPrototypeOf(inst);
  return sentinel in proto ? undefined : proto;
}
var installing;
var broke = false;
var breaker = {
  configurable: true,
  get() {
    broke = true;
    return;
  }
};
function defineLazyInternal(inst, key, compute) {
  const proto = Object.getPrototypeOf(inst._zod);
  if (key in proto && installing !== inst._zod) {
    installing = undefined;
    return;
  }
  installing = inst._zod;
  Object.defineProperty(proto, key, {
    configurable: true,
    get() {
      Object.defineProperty(this, key, breaker);
      const outer = broke;
      broke = false;
      try {
        const value = compute(this);
        if (broke)
          delete this[key];
        else
          Object.defineProperty(this, key, { configurable: true, writable: true, value });
        broke = broke || outer;
        return value;
      } catch (err) {
        delete this[key];
        broke = broke || outer;
        throw err;
      }
    },
    set(value) {
      Object.defineProperty(this, key, { configurable: true, writable: true, value });
    }
  });
}
function installLazyProp(inst, key, make, enumerable) {
  const proto = claim(inst, key);
  if (!proto)
    return;
  Object.defineProperty(proto, key, {
    configurable: true,
    get() {
      const desc = { configurable: true, writable: true, enumerable, value: undefined };
      Object.defineProperty(this, key, desc);
      desc.value = make(this);
      Object.defineProperty(this, key, desc);
      return desc.value;
    },
    set(value) {
      Object.defineProperty(this, key, { configurable: true, writable: true, enumerable, value });
    }
  });
}
var CONSTANT_CATCH = "~constantCatch";
function constantCatch(value) {
  const fn = () => value;
  fn[CONSTANT_CATCH] = true;
  return fn;
}

// ../../../../../node_modules/.bun/zod@4.6.7/node_modules/zod/v4/core/core.js
var _a;
var _zodDesc = { value: undefined, enumerable: false };
var _E = "captureStackTrace" in Error ? Error : null;
function newError(Definition) {
  const E = _E;
  if (E) {
    const saved = E.stackTraceLimit;
    if (typeof saved === "number") {
      try {
        E.stackTraceLimit = 0;
      } catch {
        _E = null;
        return new Definition;
      }
      try {
        return new Definition;
      } finally {
        E.stackTraceLimit = saved;
      }
    }
  }
  return new Definition;
}
function $constructor(name, initializer, proto, params) {
  const zodProto = {};
  function Internals(def) {
    this.def = def;
    this.constr = _;
    this.traits = new Set;
  }
  Internals.prototype = zodProto;
  const protoMembers = proto;
  const initialized = protoMembers && new WeakSet;
  function init(inst, def) {
    if (!inst._zod) {
      _zodDesc.value = new Internals(def);
      try {
        Object.defineProperty(inst, "_zod", _zodDesc);
      } finally {
        _zodDesc.value = undefined;
      }
    } else if (inst._zod.traits.has(name)) {
      return;
    }
    inst._zod.traits.add(name);
    initializer(inst, def);
    if (initialized) {
      const own = Object.getPrototypeOf(inst);
      const ctorProto = inst._zod.constr.prototype;
      let up = own;
      while (up && up !== ctorProto)
        up = Object.getPrototypeOf(up);
      const target = up ?? own;
      if (!initialized.has(target)) {
        initialized.add(target);
        members(target, protoMembers);
      }
    }
    const proto = _.prototype;
    for (const k in proto) {
      if (!Object.prototype.hasOwnProperty.call(proto, k))
        continue;
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
    const inst = params?.Parent ? newError(Definition) : this;
    init(inst, def);
    const deferred = inst._zod.deferred;
    if (deferred) {
      for (const fn of deferred) {
        fn();
      }
      inst._zod.deferred = undefined;
    }
    const pp = globalThis.__zod_globalConfig?.postProcessor;
    if (pp)
      pp(inst);
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
(_a = globalThis).__zod_globalConfig ?? (_a.__zod_globalConfig = {});
var globalConfig = globalThis.__zod_globalConfig;
function config(newConfig) {
  if (newConfig)
    Object.assign(globalConfig, newConfig);
  return globalConfig;
}
// ../../../../../node_modules/.bun/zod@4.6.7/node_modules/zod/v4/core/errors.js
function _getMessage() {
  const internals = this._zod;
  internals.message ?? (internals.message = JSON.stringify(internals.def, jsonStringifyReplacer, 2));
  return internals.message;
}
function _setMessage(value) {
  this._zod.message = value;
}
var _messageDesc = {
  get: _getMessage,
  set: _setMessage,
  enumerable: true,
  configurable: true
};
var _issuesDesc = { value: undefined, enumerable: false };
var _installedToString = /* @__PURE__ */ new WeakSet([Object.prototype, Error.prototype]);
var initializer = (inst, def) => {
  inst.name = "$ZodError";
  _issuesDesc.value = def;
  Object.defineProperty(inst, "issues", _issuesDesc);
  _issuesDesc.value = undefined;
  Object.defineProperty(inst, "message", _messageDesc);
  const proto = Object.getPrototypeOf(inst);
  if (!_installedToString.has(proto)) {
    _installedToString.add(proto);
    Object.defineProperty(proto, "toString", {
      configurable: true,
      enumerable: false,
      get() {
        const value = () => this.message;
        Object.defineProperty(this, "toString", { value, configurable: true, writable: true });
        return value;
      },
      set(value) {
        Object.defineProperty(this, "toString", { value, configurable: true, writable: true });
      }
    });
  }
};
var $ZodError = $constructor("$ZodError", initializer);
var $ZodRealError = $constructor("$ZodError", initializer, undefined, {
  Parent: Error
});
function node(obj, key, make) {
  if (!Object.prototype.hasOwnProperty.call(obj, key)) {
    if (key === "__proto__") {
      Object.defineProperty(obj, key, { value: make(), writable: true, enumerable: true, configurable: true });
    } else {
      obj[key] = make();
    }
  }
  return obj[key];
}
function flattenError(error, mapper = (issue) => issue.message) {
  const fieldErrors = {};
  const formErrors = [];
  for (const sub of error.issues) {
    if (sub.path.length > 0) {
      node(fieldErrors, sub.path[0], () => []).push(mapper(sub));
    } else {
      formErrors.push(mapper(sub));
    }
  }
  return { formErrors, fieldErrors };
}
function formatError(error, mapper = (issue) => issue.message) {
  const fieldErrors = { _errors: [] };
  const processError = (error, path = []) => {
    for (const issue of error.issues) {
      if (issue.code === "invalid_union" && issue.errors.length) {
        issue.errors.map((issues) => processError({ issues }, [...path, ...issue.path]));
      } else if (issue.code === "invalid_key") {
        processError({ issues: issue.issues }, [...path, ...issue.path]);
      } else if (issue.code === "invalid_element") {
        processError({ issues: issue.issues }, [...path, ...issue.path]);
      } else {
        const fullpath = [...path, ...issue.path];
        if (fullpath.length === 0) {
          fieldErrors._errors.push(mapper(issue));
        } else {
          let curr = fieldErrors;
          let i = 0;
          while (i < fullpath.length) {
            const el = fullpath[i];
            const terminal = i === fullpath.length - 1;
            if (el === "_errors") {
              if (terminal)
                curr._errors.push(mapper(issue));
              i++;
              continue;
            }
            if (!Object.prototype.hasOwnProperty.call(curr, el)) {
              Object.defineProperty(curr, el, {
                value: { _errors: [] },
                enumerable: true,
                writable: true,
                configurable: true
              });
            }
            const node = curr[el];
            if (terminal) {
              node._errors.push(mapper(issue));
            }
            curr = node;
            i++;
          }
        }
      }
    }
  };
  processError(error);
  return fieldErrors;
}

// ../../../../../node_modules/.bun/zod@4.6.7/node_modules/zod/v4/core/parse.js
function finalizeParams(callee, params) {
  return { callee: params?.callee ?? callee, Err: params?.Err };
}
var _parse = (_Err) => {
  const fn = (schema, value, _ctx, _params) => {
    const ctx = _ctx ? { ..._ctx, async: false } : { async: false };
    const result = schema._zod.run({ value, issues: [] }, ctx);
    if (result instanceof Promise) {
      throw new $ZodAsyncError;
    }
    if (result.issues.length) {
      const e = new (_params?.Err ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
      captureStackTrace(e, _params?.callee ?? fn);
      throw e;
    }
    return result.value;
  };
  return fn;
};
var _parseAsync = (_Err) => {
  const fn = async (schema, value, _ctx, params) => {
    const ctx = _ctx ? { ..._ctx, async: true } : { async: true };
    let result = schema._zod.run({ value, issues: [] }, ctx);
    if (result instanceof Promise)
      result = await result;
    if (result.issues.length) {
      const e = new (params?.Err ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
      captureStackTrace(e, params?.callee ?? fn);
      throw e;
    }
    return result.value;
  };
  return fn;
};
var _safeParse = (_Err) => (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, async: false } : { async: false };
  const result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise) {
    throw new $ZodAsyncError;
  }
  return result.issues.length ? failure(_Err, result.issues, ctx) : { success: true, data: result.value };
};
function failure(Err, issues, ctx) {
  let error;
  return {
    success: false,
    get error() {
      if (!error) {
        error = new Err(issues.map((iss) => finalizeIssue(iss, ctx, config())));
        issues = undefined;
        ctx = undefined;
      }
      return error;
    },
    set error(e) {
      error = e;
      issues = undefined;
      ctx = undefined;
    }
  };
}
var _safeParseAsync = (_Err) => async (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, async: true } : { async: true };
  let result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise)
    result = await result;
  return result.issues.length ? failure(_Err, result.issues, ctx) : { success: true, data: result.value };
};
var COMPILE_INVALID = /* @__PURE__ */ Symbol.for("zod.compile.invalid");
var COMPILE_FALLBACK = /* @__PURE__ */ Symbol.for("zod.compile.fallback");
var validate = (schema, value, _ctx) => {
  const validator = schema._zod.bag.validator;
  if (validator !== undefined) {
    if (validator(value) !== COMPILE_INVALID)
      return true;
    if (validator.definite === true && _ctx === undefined)
      return false;
  }
  return validateFallback(schema, value, _ctx);
};
function validateFallback(schema, value, _ctx) {
  const ctx = _ctx ? { ..._ctx, async: false, abortEarly: true } : { async: false, abortEarly: true };
  const fallbackRun = schema._zod.bag.fallbackRun;
  let result;
  if (fallbackRun) {
    ctx[COMPILE_FALLBACK] = true;
    result = fallbackRun({ value, issues: [] }, ctx);
  } else {
    result = schema._zod.run({ value, issues: [] }, ctx);
  }
  if (result instanceof Promise) {
    throw new $ZodAsyncError;
  }
  return result.issues.length === 0;
}
var validateAsync = async (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, async: true, abortEarly: true } : { async: true, abortEarly: true };
  let result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise)
    result = await result;
  return result.issues.length === 0;
};
var _encode = (_Err) => {
  const parse = _parse(_Err);
  const fn = (schema, value, _ctx, _params) => {
    const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
    return parse(schema, value, ctx, finalizeParams(fn, _params));
  };
  return fn;
};
var _decode = (_Err) => {
  const parse = _parse(_Err);
  const fn = (schema, value, _ctx, _params) => {
    return parse(schema, value, _ctx, finalizeParams(fn, _params));
  };
  return fn;
};
var _encodeAsync = (_Err) => {
  const parseAsync = _parseAsync(_Err);
  const fn = async (schema, value, _ctx, _params) => {
    const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
    return await parseAsync(schema, value, ctx, finalizeParams(fn, _params));
  };
  return fn;
};
var _decodeAsync = (_Err) => {
  const parseAsync = _parseAsync(_Err);
  const fn = async (schema, value, _ctx, _params) => {
    return await parseAsync(schema, value, _ctx, finalizeParams(fn, _params));
  };
  return fn;
};
var _safeEncode = (_Err) => (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
  return _safeParse(_Err)(schema, value, ctx);
};
var _safeDecode = (_Err) => (schema, value, _ctx) => {
  return _safeParse(_Err)(schema, value, _ctx);
};
var _safeEncodeAsync = (_Err) => async (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
  return _safeParseAsync(_Err)(schema, value, ctx);
};
var _safeDecodeAsync = (_Err) => async (schema, value, _ctx) => {
  return _safeParseAsync(_Err)(schema, value, _ctx);
};
// ../../../../../node_modules/.bun/zod@4.6.7/node_modules/zod/v4/core/regexes.js
var cuid = /^[cC][0-9a-z]{6,}$/;
var cuid2 = /^[0-9a-z]+$/;
var ulid = /^[0-7][0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{25}$/;
var xid = /^[0-9a-vA-V]{20}$/;
var ksuid = /^[A-Za-z0-9]{27}$/;
var nanoid = /^[a-zA-Z0-9_-]{21}$/;
function nanoidOfLength(length) {
  return new RegExp(`^[a-zA-Z0-9_-]{${length}}$`);
}
var duration = /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/;
var guid = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;
var uuid = (version) => {
  if (!version)
    return /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;
  return new RegExp(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${version}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`);
};
var email = /^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;
var _emoji = `^(?=[\\s\\S]*[\\p{Extended_Pictographic}\\p{Regional_Indicator}\\u20E3])[\\p{Extended_Pictographic}\\p{Emoji_Component}]+$`;
function emoji() {
  return new RegExp(_emoji, "u");
}
var ipv4 = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
var ipv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/;
var cidrv4 = /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/;
var cidrv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
var base64 = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/;
var base64url = /^(?:[A-Za-z0-9_-]{4})*(?:[A-Za-z0-9_-]{2,3})?$/;
var httpProtocol = /^https?$/;
var e164 = /^\+[1-9]\d{6,14}$/;
var dateSource = `(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))`;
function anchor(source) {
  return new RegExp(`^${source}$`);
}
var date = /* @__PURE__ */ anchor(dateSource);
function timeSource(args) {
  const hhmm = `(?:[01]\\d|2[0-3]):[0-5]\\d`;
  const regex = typeof args.precision === "number" ? args.precision === -1 ? `${hhmm}` : args.precision === 0 ? `${hhmm}:[0-5]\\d` : `${hhmm}:[0-5]\\d\\.\\d{${args.precision}}` : args.seconds ? `${hhmm}:[0-5]\\d(?:\\.\\d+)?` : `${hhmm}(?::[0-5]\\d(?:\\.\\d+)?)?`;
  return regex;
}
function time(args) {
  return new RegExp(`^${timeSource(args)}$`);
}
function datetime(args) {
  const opts = ["Z"];
  if (args.offset)
    opts.push(`([+-](?:[01]\\d|2[0-3]):[0-5]\\d)`);
  const qualified = `${timeSource({ precision: args.precision, seconds: true })}(?:${opts.join("|")})`;
  const timeRegex = args.local ? `${qualified}|${timeSource({ precision: args.precision })}` : qualified;
  return new RegExp(`^${dateSource}T(?:${timeRegex})$`);
}
var anyString = /^[\s\S]{0,}$/;
var integer = /^-?\d+$/;
var number = /^-?\d+(?:\.\d+)?$/;
var boolean = /^(?:true|false)$/i;
var lowercase = /^[^A-Z]*$/;
var uppercase = /^[^a-z]*$/;

// ../../../../../node_modules/.bun/zod@4.6.7/node_modules/zod/v4/core/checks.js
var $ZodCheck = /* @__PURE__ */ $constructor("$ZodCheck", (inst, def) => {
  var _a;
  inst._zod ?? (inst._zod = {});
  inst._zod.def = def;
  (_a = inst._zod).onattach ?? (_a.onattach = []);
});
var _whenHasLength = (payload) => {
  const val = payload.value;
  return !nullish(val) && val.length !== undefined;
};
var numericOriginMap = {
  number: "number",
  bigint: "bigint",
  object: "date"
};
var $ZodCheckLessThan = /* @__PURE__ */ $constructor("$ZodCheckLessThan", (inst, def) => {
  $ZodCheck.init(inst, def);
  const origin = numericOriginMap[typeof def.value];
  inst._zod.check = (payload) => {
    if (def.inclusive ? payload.value <= def.value : payload.value < def.value) {
      return;
    }
    payload.issues.push({
      origin: numericOriginMap[typeof payload.value] ?? origin,
      code: "too_big",
      maximum: typeof def.value === "object" ? def.value.getTime() : def.value,
      input: payload.value,
      inclusive: def.inclusive,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckGreaterThan = /* @__PURE__ */ $constructor("$ZodCheckGreaterThan", (inst, def) => {
  $ZodCheck.init(inst, def);
  const origin = numericOriginMap[typeof def.value];
  inst._zod.check = (payload) => {
    if (def.inclusive ? payload.value >= def.value : payload.value > def.value) {
      return;
    }
    payload.issues.push({
      origin: numericOriginMap[typeof payload.value] ?? origin,
      code: "too_small",
      minimum: typeof def.value === "object" ? def.value.getTime() : def.value,
      input: payload.value,
      inclusive: def.inclusive,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckMultipleOf = /* @__PURE__ */ $constructor("$ZodCheckMultipleOf", (inst, def) => {
  $ZodCheck.init(inst, def);
  inst._zod.check = (payload) => {
    if (typeof payload.value !== typeof def.value)
      throw new Error("Cannot mix number and bigint in multiple_of check.");
    const isMultiple = typeof payload.value === "bigint" ? def.value !== BigInt(0) && payload.value % def.value === BigInt(0) : floatSafeRemainder(payload.value, def.value) === 0;
    if (isMultiple)
      return;
    payload.issues.push({
      origin: typeof payload.value,
      code: "not_multiple_of",
      divisor: def.value,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckNumberFormat = /* @__PURE__ */ $constructor("$ZodCheckNumberFormat", (inst, def) => {
  $ZodCheck.init(inst, def);
  def.format = def.format || "float64";
  const isInt = def.format?.includes("int");
  const origin = isInt ? "int" : "number";
  const [minimum, maximum] = NUMBER_FORMAT_RANGES[def.format];
  inst._zod.check = (payload) => {
    const input = payload.value;
    if (isInt) {
      if (!Number.isInteger(input)) {
        payload.issues.push({
          expected: origin,
          format: def.format,
          code: "invalid_type",
          continue: false,
          input,
          inst
        });
        return;
      }
      if (!Number.isSafeInteger(input)) {
        if (input > 0) {
          payload.issues.push({
            input,
            code: "too_big",
            maximum: Number.MAX_SAFE_INTEGER,
            note: "Integers must be within the safe integer range.",
            inst,
            origin,
            inclusive: true,
            continue: !def.abort
          });
        } else {
          payload.issues.push({
            input,
            code: "too_small",
            minimum: Number.MIN_SAFE_INTEGER,
            note: "Integers must be within the safe integer range.",
            inst,
            origin,
            inclusive: true,
            continue: !def.abort
          });
        }
        return;
      }
    }
    if (input < minimum) {
      payload.issues.push({
        origin: "number",
        input,
        code: "too_small",
        minimum,
        inclusive: true,
        inst,
        continue: !def.abort
      });
    }
    if (input > maximum) {
      payload.issues.push({
        origin: "number",
        input,
        code: "too_big",
        maximum,
        inclusive: true,
        inst,
        continue: !def.abort
      });
    }
  };
});
var $ZodCheckMaxLength = /* @__PURE__ */ $constructor("$ZodCheckMaxLength", (inst, def) => {
  var _a;
  $ZodCheck.init(inst, def);
  (_a = inst._zod.def).when ?? (_a.when = _whenHasLength);
  inst._zod.check = (payload) => {
    const input = payload.value;
    const units = input.length;
    const length = typeof input === "string" && units > def.maximum ? codePointLength(input) : units;
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
  (_a = inst._zod.def).when ?? (_a.when = _whenHasLength);
  inst._zod.check = (payload) => {
    const input = payload.value;
    const units = input.length;
    const length = typeof input === "string" && units >= def.minimum && units < def.minimum * 2 ? codePointLength(input) : units;
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
  (_a = inst._zod.def).when ?? (_a.when = _whenHasLength);
  inst._zod.check = (payload) => {
    const input = payload.value;
    const units = input.length;
    const length = typeof input === "string" && units >= def.length && units <= def.length * 2 ? codePointLength(input) : units;
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
var $ZodCheckStringFormat = /* @__PURE__ */ $constructor("$ZodCheckStringFormat", (inst, def) => {
  var _a, _b;
  $ZodCheck.init(inst, def);
  if (def.pattern)
    (_a = inst._zod).check ?? (_a.check = (payload) => {
      def.pattern.lastIndex = 0;
      if (def.pattern.test(payload.value))
        return;
      payload.issues.push({
        origin: "string",
        code: "invalid_format",
        format: def.format,
        input: payload.value,
        ...def.pattern ? { pattern: def.pattern.toString() } : {},
        inst,
        continue: !def.abort
      });
    });
  else
    (_b = inst._zod).check ?? (_b.check = () => {});
});
var $ZodCheckRegex = /* @__PURE__ */ $constructor("$ZodCheckRegex", (inst, def) => {
  $ZodCheckStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    def.pattern.lastIndex = 0;
    if (def.pattern.test(payload.value))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "regex",
      input: payload.value,
      pattern: def.pattern.toString(),
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckLowerCase = /* @__PURE__ */ $constructor("$ZodCheckLowerCase", (inst, def) => {
  def.pattern ?? (def.pattern = lowercase);
  $ZodCheckStringFormat.init(inst, def);
});
var $ZodCheckUpperCase = /* @__PURE__ */ $constructor("$ZodCheckUpperCase", (inst, def) => {
  def.pattern ?? (def.pattern = uppercase);
  $ZodCheckStringFormat.init(inst, def);
});
var $ZodCheckIncludes = /* @__PURE__ */ $constructor("$ZodCheckIncludes", (inst, def) => {
  $ZodCheck.init(inst, def);
  const escapedRegex = escapeRegex(def.includes);
  const pattern = new RegExp(typeof def.position === "number" ? `^.{${def.position},}${escapedRegex}` : escapedRegex);
  def.pattern = pattern;
  inst._zod.check = (payload) => {
    if (payload.value.includes(def.includes, def.position))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "includes",
      includes: def.includes,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckStartsWith = /* @__PURE__ */ $constructor("$ZodCheckStartsWith", (inst, def) => {
  $ZodCheck.init(inst, def);
  const pattern = new RegExp(`^${escapeRegex(def.prefix)}.*`);
  def.pattern ?? (def.pattern = pattern);
  inst._zod.check = (payload) => {
    if (payload.value.startsWith(def.prefix))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "starts_with",
      prefix: def.prefix,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckEndsWith = /* @__PURE__ */ $constructor("$ZodCheckEndsWith", (inst, def) => {
  $ZodCheck.init(inst, def);
  const pattern = new RegExp(`.*${escapeRegex(def.suffix)}$`);
  def.pattern ?? (def.pattern = pattern);
  inst._zod.check = (payload) => {
    if (payload.value.endsWith(def.suffix))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "ends_with",
      suffix: def.suffix,
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

// ../../../../../node_modules/.bun/zod@4.6.7/node_modules/zod/v4/core/doc.js
class Doc {
  constructor(args = [], closed = {}) {
    this.content = [];
    this.indent = 0;
    this.args = args;
    this.closed = closed;
  }
  indented(fn) {
    this.indent += 1;
    try {
      fn(this);
    } finally {
      this.indent -= 1;
    }
  }
  write(arg) {
    if (typeof arg === "function") {
      arg(this, { execution: "sync" });
      arg(this, { execution: "async" });
      return;
    }
    const content = arg;
    const lines = content.split(`
`).filter((x) => x);
    const minIndent = Math.min(...lines.map((x) => x.length - x.trimStart().length));
    const dedented = lines.map((x) => x.slice(minIndent)).map((x) => " ".repeat(this.indent * 2) + x);
    for (const line of dedented) {
      this.content.push(line);
    }
  }
  compile() {
    const F = Function;
    const content = this?.content ?? [``];
    const factory = new F(...Object.keys(this.closed), `return function (${this.args.join(", ")}) {
${content.join(`
`)}
};`);
    return factory(...Object.values(this.closed));
  }
}

// ../../../../../node_modules/.bun/zod@4.6.7/node_modules/zod/v4/core/versions.js
var version = {
  major: 4,
  minor: 6,
  patch: 7
};

// ../../../../../node_modules/.bun/zod@4.6.7/node_modules/zod/v4/core/schemas.js
var $ZodType = /* @__PURE__ */ $constructor("$ZodType", (inst, def) => {
  var _a;
  inst ?? (inst = {});
  inst._zod.def = def;
  inst._zod.bag = inst._zod.bag || {};
  inst._zod.version = version;
  const defChecks = inst._zod.def.checks;
  const checks = inst._zod.traits.has("$ZodCheck") ? [inst, ...defChecks ?? []] : defChecks?.length ? [...defChecks] : [];
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
      if (payload.memo)
        return payload;
      let isAborted = aborted(payload);
      let asyncResult;
      for (const ch of checks) {
        if (ch._zod.def.when) {
          if (explicitlyAborted(payload))
            continue;
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
            attachSchema(payload.issues, currLen, inst);
            if (!isAborted)
              isAborted = aborted(payload, currLen);
          });
        } else {
          const nextLen = payload.issues.length;
          if (nextLen === currLen)
            continue;
          attachSchema(payload.issues, currLen, inst);
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
}, {
  get "~standard"() {
    return hide(this, "~standard", standardProps(this));
  },
  set "~standard"(value) {
    own(this, "~standard", value);
  }
});
var toStandardResult = (r, ctx) => r.issues.length ? { issues: r.issues.map((iss) => finalizeIssue(iss, ctx, config())) } : { value: r.value };
async function validateAsync2(inst, value) {
  const ctx = { async: true };
  return toStandardResult(await inst._zod.run({ value, issues: [] }, ctx), ctx);
}
function standardProps(inst) {
  return {
    validate: (value) => {
      const ctx = { async: false };
      try {
        const r = inst._zod.run({ value, issues: [] }, ctx);
        if (!(r instanceof Promise))
          return toStandardResult(r, ctx);
      } catch (_) {}
      return validateAsync2(inst, value);
    },
    vendor: "zod",
    version: 1
  };
}
var $ZodString = /* @__PURE__ */ $constructor("$ZodString", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = def.pattern ?? anyString;
  inst._zod.parse = (payload, _) => {
    if (def.coerce)
      try {
        payload.value = String(payload.value);
      } catch (_) {}
    if (typeof payload.value === "string")
      return payload;
    payload.issues.push({
      expected: "string",
      code: "invalid_type",
      input: payload.value,
      inst
    });
    return payload;
  };
});
var $ZodStringFormat = /* @__PURE__ */ $constructor("$ZodStringFormat", (inst, def) => {
  $ZodCheckStringFormat.init(inst, def);
  $ZodString.init(inst, def);
});
var $ZodGUID = /* @__PURE__ */ $constructor("$ZodGUID", (inst, def) => {
  def.pattern ?? (def.pattern = guid);
  $ZodStringFormat.init(inst, def);
});
var $ZodUUID = /* @__PURE__ */ $constructor("$ZodUUID", (inst, def) => {
  if (def.version) {
    const versionMap = {
      v1: 1,
      v2: 2,
      v3: 3,
      v4: 4,
      v5: 5,
      v6: 6,
      v7: 7,
      v8: 8
    };
    const v = versionMap[def.version];
    if (v === undefined)
      throw new Error(`Invalid UUID version: "${def.version}"`);
    def.pattern ?? (def.pattern = uuid(v));
  } else
    def.pattern ?? (def.pattern = uuid());
  $ZodStringFormat.init(inst, def);
});
var $ZodEmail = /* @__PURE__ */ $constructor("$ZodEmail", (inst, def) => {
  def.pattern ?? (def.pattern = email);
  $ZodStringFormat.init(inst, def);
});
var URL_BAD_FORMAT = 1;
var URL_UNPARSEABLE = 2;
function canParseURL(input) {
  try {
    if (typeof URL !== "undefined" && typeof URL.canParse === "function")
      return URL.canParse(input);
    new URL(input);
    return true;
  } catch {
    return false;
  }
}
function validateURL(trimmed, def) {
  if (!("normalize" in def) && !("hostname" in def) && !("protocol" in def)) {
    return canParseURL(trimmed) || URL_UNPARSEABLE;
  }
  return parseURLObject(trimmed, def);
}
function parseURLObject(trimmed, def) {
  if (!def.normalize && def.protocol?.source === httpProtocol.source && !/^https?:\/\//i.test(trimmed)) {
    return URL_BAD_FORMAT;
  }
  try {
    if (typeof URL !== "undefined") {
      const URLStatic = URL;
      if (typeof URLStatic.parse === "function")
        return URLStatic.parse(trimmed) ?? URL_UNPARSEABLE;
    }
    return new URL(trimmed);
  } catch {
    return URL_UNPARSEABLE;
  }
}
var asciiTabOrNewline = /[\t\n\r]/g;
function stripTabAndNewline(value) {
  return value.replace(asciiTabOrNewline, "");
}
function urlHostnameOk(url, hostname) {
  hostname.lastIndex = 0;
  return hostname.test(url.hostname);
}
function urlProtocolOk(url, protocol) {
  protocol.lastIndex = 0;
  return protocol.test(url.protocol.endsWith(":") ? url.protocol.slice(0, -1) : url.protocol);
}
var $ZodURL = /* @__PURE__ */ $constructor("$ZodURL", (inst, def) => {
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    try {
      const trimmed = payload.value.trim();
      const url = validateURL(trimmed, def);
      if (url === URL_BAD_FORMAT) {
        payload.issues.push({
          code: "invalid_format",
          format: "url",
          note: "Invalid URL format",
          input: payload.value,
          inst,
          continue: !def.abort
        });
        return;
      }
      if (url === URL_UNPARSEABLE) {
        payload.issues.push({
          code: "invalid_format",
          format: "url",
          input: payload.value,
          inst,
          continue: !def.abort
        });
        return;
      }
      if (url === true) {
        payload.value = stripTabAndNewline(trimmed);
        return;
      }
      if (def.hostname && !urlHostnameOk(url, def.hostname)) {
        payload.issues.push({
          code: "invalid_format",
          format: "url",
          note: "Invalid hostname",
          pattern: def.hostname.source,
          input: payload.value,
          inst,
          continue: !def.abort
        });
      }
      if (def.protocol && !urlProtocolOk(url, def.protocol)) {
        payload.issues.push({
          code: "invalid_format",
          format: "url",
          note: "Invalid protocol",
          pattern: def.protocol.source,
          input: payload.value,
          inst,
          continue: !def.abort
        });
      }
      payload.value = def.normalize ? url.href : stripTabAndNewline(trimmed);
      return;
    } catch (_) {
      payload.issues.push({
        code: "invalid_format",
        format: "url",
        input: payload.value,
        inst,
        continue: !def.abort
      });
    }
  };
});
var $ZodEmoji = /* @__PURE__ */ $constructor("$ZodEmoji", (inst, def) => {
  def.pattern ?? (def.pattern = emoji());
  $ZodStringFormat.init(inst, def);
});
var $ZodNanoID = /* @__PURE__ */ $constructor("$ZodNanoID", (inst, def) => {
  if (def.length !== undefined && (!Number.isInteger(def.length) || def.length < 1))
    throw new Error(`Invalid nanoid length: ${def.length}`);
  def.pattern ?? (def.pattern = def.length === undefined ? nanoid : nanoidOfLength(def.length));
  $ZodStringFormat.init(inst, def);
});
var $ZodCUID = /* @__PURE__ */ $constructor("$ZodCUID", (inst, def) => {
  def.pattern ?? (def.pattern = cuid);
  $ZodStringFormat.init(inst, def);
});
var $ZodCUID2 = /* @__PURE__ */ $constructor("$ZodCUID2", (inst, def) => {
  def.pattern ?? (def.pattern = cuid2);
  $ZodStringFormat.init(inst, def);
});
var $ZodULID = /* @__PURE__ */ $constructor("$ZodULID", (inst, def) => {
  def.pattern ?? (def.pattern = ulid);
  $ZodStringFormat.init(inst, def);
});
var $ZodXID = /* @__PURE__ */ $constructor("$ZodXID", (inst, def) => {
  def.pattern ?? (def.pattern = xid);
  $ZodStringFormat.init(inst, def);
});
var $ZodKSUID = /* @__PURE__ */ $constructor("$ZodKSUID", (inst, def) => {
  def.pattern ?? (def.pattern = ksuid);
  $ZodStringFormat.init(inst, def);
});
var $ZodISODateTime = /* @__PURE__ */ $constructor("$ZodISODateTime", (inst, def) => {
  def.pattern ?? (def.pattern = datetime(def));
  $ZodStringFormat.init(inst, def);
});
var $ZodISODate = /* @__PURE__ */ $constructor("$ZodISODate", (inst, def) => {
  def.pattern ?? (def.pattern = date);
  $ZodStringFormat.init(inst, def);
});
var $ZodISOTime = /* @__PURE__ */ $constructor("$ZodISOTime", (inst, def) => {
  def.pattern ?? (def.pattern = time(def));
  $ZodStringFormat.init(inst, def);
});
var $ZodISODuration = /* @__PURE__ */ $constructor("$ZodISODuration", (inst, def) => {
  def.pattern ?? (def.pattern = duration);
  $ZodStringFormat.init(inst, def);
});
var $ZodIPv4 = /* @__PURE__ */ $constructor("$ZodIPv4", (inst, def) => {
  def.pattern ?? (def.pattern = ipv4);
  $ZodStringFormat.init(inst, def);
});
var ipv6Alphabet = /^[0-9a-fA-F:.]+$/;
function isValidIPv6(value) {
  if (!ipv6Alphabet.test(value))
    return false;
  return canParseURL(`http://[${value}]`);
}
var $ZodIPv6 = /* @__PURE__ */ $constructor("$ZodIPv6", (inst, def) => {
  def.pattern ?? (def.pattern = ipv6);
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    if (!isValidIPv6(payload.value)) {
      payload.issues.push({
        code: "invalid_format",
        format: "ipv6",
        input: payload.value,
        inst,
        continue: !def.abort
      });
    }
  };
});
var $ZodCIDRv4 = /* @__PURE__ */ $constructor("$ZodCIDRv4", (inst, def) => {
  def.pattern ?? (def.pattern = cidrv4);
  $ZodStringFormat.init(inst, def);
});
function isValidCIDRv6(value) {
  const parts = value.split("/");
  if (parts.length !== 2)
    return false;
  const [address, prefix] = parts;
  if (!prefix)
    return false;
  const prefixNum = Number(prefix);
  if (`${prefixNum}` !== prefix)
    return false;
  if (prefixNum < 0 || prefixNum > 128)
    return false;
  return isValidIPv6(address);
}
var $ZodCIDRv6 = /* @__PURE__ */ $constructor("$ZodCIDRv6", (inst, def) => {
  def.pattern ?? (def.pattern = cidrv6);
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    if (!isValidCIDRv6(payload.value)) {
      payload.issues.push({
        code: "invalid_format",
        format: "cidrv6",
        input: payload.value,
        inst,
        continue: !def.abort
      });
    }
  };
});
function isValidBase64(data) {
  if (data === "")
    return true;
  if (/\s/.test(data))
    return false;
  if (data.length % 4 !== 0)
    return false;
  try {
    atob(data);
    return true;
  } catch {
    return false;
  }
}
var base64Charset = /^[0-9a-zA-Z+/]*={0,2}$/;
var $ZodBase64 = /* @__PURE__ */ $constructor("$ZodBase64", (inst, def) => {
  def.pattern ?? (def.pattern = base64Charset);
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    if (isValidBase64(payload.value))
      return;
    payload.issues.push({
      code: "invalid_format",
      format: "base64",
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var base64urlCharset = /^[A-Za-z0-9_-]*$/;
function isValidBase64URL(data) {
  if (!base64urlCharset.test(data))
    return false;
  const base64 = data.replace(/[-_]/g, (c) => c === "-" ? "+" : "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  return isValidBase64(padded);
}
var $ZodBase64URL = /* @__PURE__ */ $constructor("$ZodBase64URL", (inst, def) => {
  def.pattern ?? (def.pattern = base64urlCharset);
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    if (isValidBase64URL(payload.value))
      return;
    payload.issues.push({
      code: "invalid_format",
      format: "base64url",
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodE164 = /* @__PURE__ */ $constructor("$ZodE164", (inst, def) => {
  def.pattern ?? (def.pattern = e164);
  $ZodStringFormat.init(inst, def);
});
function isValidJWT(token, algorithm = null) {
  try {
    const tokensParts = token.split(".");
    if (tokensParts.length !== 3)
      return false;
    const [header] = tokensParts;
    if (!header)
      return false;
    const parsedHeader = JSON.parse(atob(header));
    if ("typ" in parsedHeader && parsedHeader?.typ !== "JWT")
      return false;
    if (!parsedHeader.alg)
      return false;
    if (algorithm && (!("alg" in parsedHeader) || parsedHeader.alg !== algorithm))
      return false;
    return true;
  } catch {
    return false;
  }
}
var $ZodJWT = /* @__PURE__ */ $constructor("$ZodJWT", (inst, def) => {
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    if (isValidJWT(payload.value, def.alg))
      return;
    payload.issues.push({
      code: "invalid_format",
      format: "jwt",
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodNumber = /* @__PURE__ */ $constructor("$ZodNumber", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = number;
  inst._zod.parse = (payload, _ctx) => {
    if (def.coerce)
      try {
        payload.value = Number(payload.value);
      } catch (_) {}
    const input = payload.value;
    if (typeof input === "number" && !Number.isNaN(input) && Number.isFinite(input)) {
      return payload;
    }
    const received = typeof input === "number" ? Number.isNaN(input) ? "NaN" : !Number.isFinite(input) ? String(input) : undefined : undefined;
    payload.issues.push({
      expected: "number",
      code: "invalid_type",
      input,
      inst,
      ...received ? { received } : {}
    });
    return payload;
  };
});
var $ZodNumberFormat = /* @__PURE__ */ $constructor("$ZodNumberFormat", (inst, def) => {
  $ZodCheckNumberFormat.init(inst, def);
  $ZodNumber.init(inst, def);
});
var $ZodBoolean = /* @__PURE__ */ $constructor("$ZodBoolean", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = boolean;
  inst._zod.parse = (payload, _ctx) => {
    if (def.coerce)
      try {
        payload.value = Boolean(payload.value);
      } catch (_) {}
    const input = payload.value;
    if (typeof input === "boolean")
      return payload;
    payload.issues.push({
      expected: "boolean",
      code: "invalid_type",
      input,
      inst
    });
    return payload;
  };
});
var $ZodUnknown = /* @__PURE__ */ $constructor("$ZodUnknown", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload) => payload;
});
var $ZodNever = /* @__PURE__ */ $constructor("$ZodNever", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, _ctx) => {
    payload.issues.push({
      expected: "never",
      code: "invalid_type",
      input: payload.value,
      inst
    });
    return payload;
  };
});
function capSize(inst, size) {
  const caps = sizeCaps(inst._zod.def.checks);
  if (!caps.length)
    return;
  const cap = Math.min(...caps.map((c) => c[0]));
  const parse = inst._zod.parse;
  inst._zod.parse = (payload, ctx) => {
    const n = size(payload.value);
    if (n > cap && !ctx?.skipChecks && ctx?.direction !== "backward") {
      for (const [max, ch] of sizeCaps(inst._zod.def.checks)) {
        if (n > max && ch._zod.def.when(payload)) {
          const start = payload.issues.length;
          ch._zod.check(payload);
          payload.issues[start].continue = false;
          attachSchema(payload.issues, start, inst);
          return payload;
        }
      }
    }
    return parse(payload, ctx);
  };
}
var arraySize = (input) => Array.isArray(input) ? input.length : -1;
function handleArrayResult(result, final, index) {
  if (result.issues.length) {
    final.issues.push(...prefixIssues(index, result.issues));
  }
  final.value[index] = result.value;
}
var $ZodArray = /* @__PURE__ */ $constructor("$ZodArray", (inst, def) => {
  $ZodType.init(inst, def);
  const memo = globalConfig.memoizer;
  memo?.attach(inst);
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
    payload.value = memo ? memo.alloc(inst, payload, Array(input.length), ctx) : Array(input.length);
    const proms = [];
    const abortEarly = ctx?.abortEarly;
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
        if (abortEarly && result.issues.length !== 0 && aborted(result))
          break;
      }
    }
    if (proms.length) {
      return Promise.all(proms).then(() => payload);
    }
    return payload;
  };
  capSize(inst, arraySize);
});
function handlePropertyResult(result, final, key, input, optin, optout) {
  const isPresent = key in input;
  const isOptionalOut = optout === "optional";
  if (!isPresent && isOptionalOut && optin === "optional") {
    return;
  }
  if (result.issues.length) {
    if (optin !== undefined && isOptionalOut && !isPresent) {
      return;
    }
    final.issues.push(...prefixIssues(key, result.issues));
  }
  if (!isPresent && optin === undefined) {
    if (!result.issues.length) {
      final.issues.push({
        code: "invalid_type",
        expected: "nonoptional",
        input: undefined,
        path: [key]
      });
    }
    return;
  }
  if (result.value === undefined) {
    if (isPresent || optin === "defaulted" && !isOptionalOut) {
      final.value[key] = undefined;
    }
  } else {
    final.value[key] = result.value;
  }
}
var NO_SYMBOL_KEYS = [];
function normalizeDef(def) {
  const keys = Object.keys(def.shape);
  const ownSymbols = Object.getOwnPropertySymbols(def.shape);
  const symbolKeys = ownSymbols.length ? ownSymbols : NO_SYMBOL_KEYS;
  const allKeys = symbolKeys.length ? [...keys, ...symbolKeys] : keys;
  for (const k of allKeys) {
    if (!def.shape?.[k]?._zod?.traits?.has("$ZodType")) {
      throw new Error(`Invalid element at key "${String(k)}": expected a Zod schema`);
    }
  }
  const okeys = optionalKeys(def.shape);
  return {
    ...def,
    allKeys,
    symbolKeys,
    keySet: new Set(keys),
    numKeys: keys.length,
    optionalKeys: new Set(okeys)
  };
}
function handleCatchall(proms, input, payload, ctx, def, inst, abortEarly) {
  const unrecognized = [];
  const keySet = def.keySet;
  const _catchall = def.catchall._zod;
  const t = _catchall.def.type;
  const optin = _catchall.optin;
  const optout = _catchall.optout;
  let seen = 0;
  for (const key in input) {
    if (abortEarly && payload.issues.length !== seen) {
      if (aborted(payload, seen))
        break;
      seen = payload.issues.length;
    }
    if (keySet.has(key))
      continue;
    if (key === "__proto__") {
      if (t === "never")
        unrecognized.push(key);
      continue;
    }
    if (t === "never") {
      unrecognized.push(key);
      continue;
    }
    const r = _catchall.run({ value: input[key], issues: [] }, ctx);
    if (r instanceof Promise) {
      proms.push(r.then((r) => handlePropertyResult(r, payload, key, input, optin, optout)));
    } else {
      handlePropertyResult(r, payload, key, input, optin, optout);
    }
  }
  if (unrecognized.length) {
    payload.issues.push({
      code: "unrecognized_keys",
      keys: unrecognized,
      input,
      inst,
      continue: true
    });
  }
  if (!proms.length)
    return payload;
  return Promise.all(proms).then(() => {
    return payload;
  });
}
var $ZodObject = /* @__PURE__ */ $constructor("$ZodObject", (inst, def) => {
  $ZodType.init(inst, def);
  const desc = Object.getOwnPropertyDescriptor(def, "shape");
  const sh = desc?.get ? desc.get.raw : def.shape ?? {};
  if (sh) {
    const get = () => {
      const newSh = { ...sh };
      Object.defineProperty(def, "shape", { value: newSh });
      get.raw = newSh;
      return newSh;
    };
    get.raw = sh;
    Object.defineProperty(def, "shape", { get });
  }
  const _normalized = cached(() => normalizeDef(def));
  defineLazyInternal(inst, "propValues", (zod) => {
    const shape = zod.def.shape;
    const propValues = {};
    for (const key in shape) {
      const field = shape[key]._zod;
      if (field.values) {
        if (!Object.prototype.hasOwnProperty.call(propValues, key)) {
          assignProp(propValues, key, new Set);
        }
        for (const v of field.values)
          propValues[key].add(v);
        if (field.optin !== undefined)
          propValues[key].add(undefined);
      }
    }
    return propValues;
  });
  const isObject2 = isObject;
  const catchall = def.catchall;
  let value;
  const memo = globalConfig.memoizer;
  memo?.attach(inst);
  inst._zod.parse = (payload, ctx) => {
    value ?? (value = _normalized.value);
    const input = payload.value;
    if (!isObject2(input)) {
      payload.issues.push({
        expected: "object",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    payload.value = memo ? memo.alloc(inst, payload, {}, ctx) : {};
    const proms = [];
    const shape = value.shape;
    const abortEarly = ctx?.abortEarly;
    let seen = payload.issues.length;
    for (const key of value.allKeys) {
      if (abortEarly && payload.issues.length !== seen) {
        if (aborted(payload, seen))
          break;
        seen = payload.issues.length;
      }
      if (key === "__proto__")
        continue;
      const el = shape[key];
      const optin = el._zod.optin;
      const optout = el._zod.optout;
      const r = el._zod.run({ value: input[key], issues: [] }, ctx);
      if (r instanceof Promise) {
        proms.push(r.then((r) => handlePropertyResult(r, payload, key, input, optin, optout)));
      } else {
        handlePropertyResult(r, payload, key, input, optin, optout);
      }
    }
    if (!catchall) {
      return proms.length ? Promise.all(proms).then(() => payload) : payload;
    }
    return handleCatchall(proms, input, payload, ctx, _normalized.value, inst, abortEarly === true);
  };
});
var $ZodObjectJIT = /* @__PURE__ */ $constructor("$ZodObjectJIT", (inst, def) => {
  $ZodObject.init(inst, def);
  const superParse = inst._zod.parse;
  const _normalized = cached(() => normalizeDef(def));
  const memo = globalConfig.memoizer;
  const generateFastpass = (shape) => {
    const normalized = _normalized.value;
    const syms = normalized.symbolKeys;
    const doc = new Doc(["payload", "ctx"], { shape, inst, memo, syms });
    const parseStr = (k) => `shape[${k}]._zod.run({ value: input[${k}], issues: [] }, ctx)`;
    const prefixStr = (id, k) => `
          let ${id}_ab = false;
          for (let i = 0; i < ${id}.issues.length; i++) {
            const iss = ${id}.issues[i];
            iss.path = iss.path ? [${k}, ...iss.path] : [${k}];
            payload.issues.push(iss);
            if (iss.continue !== true) ${id}_ab = true;
          }
          if (${id}_ab && ctx && ctx.abortEarly) {
            payload.value = newResult;
            return payload;
          }`;
    doc.write(`const input = payload.value;`);
    const ids = Object.create(null);
    let counter = 0;
    for (const key of normalized.allKeys) {
      ids[key] = `key_${counter++}`;
    }
    doc.write(memo ? `const newResult = memo.alloc(inst, payload, {}, ctx);` : `const newResult = {};`);
    for (const key of normalized.allKeys) {
      if (key === "__proto__")
        continue;
      const id = ids[key];
      const k = typeof key === "symbol" ? `syms[${syms.indexOf(key)}]` : esc(key);
      const isPresent = `${k} in input`;
      const schema = shape[key];
      const optin = schema?._zod?.optin;
      const isOptionalIn = optin !== undefined;
      const isOptionalOut = schema?._zod?.optout === "optional";
      doc.write(`const ${id} = ${parseStr(k)};`);
      if (isOptionalIn && isOptionalOut) {
        const assign = optin === "optional" ? `${id}_present` : `${id}.value !== undefined || ${id}_present`;
        doc.write(`
        const ${id}_present = ${isPresent};
        if (!${id}.issues.length || ${id}_present) {
          if (${id}.issues.length) {${prefixStr(id, k)}
          }

          if (${assign}) {
            newResult[${k}] = ${id}.value;
          }
        }

      `);
      } else if (!isOptionalIn) {
        doc.write(`
        const ${id}_present = ${isPresent};
        if (${id}.issues.length) {${prefixStr(id, k)}
        }
        if (!${id}_present && !${id}.issues.length) {
          payload.issues.push({
            code: "invalid_type",
            expected: "nonoptional",
            input: undefined,
            path: [${k}]
          });
          if (ctx && ctx.abortEarly) {
            payload.value = newResult;
            return payload;
          }
        }

        if (${id}_present) {
          newResult[${k}] = ${id}.value;
        }

      `);
      } else {
        doc.write(`
        if (${id}.issues.length) {${prefixStr(id, k)}
        }
      `);
        if (optin === "defaulted") {
          doc.write(`newResult[${k}] = ${id}.value;`);
        } else {
          doc.write(`
        if (${id}.value !== undefined || ${isPresent}) {
          newResult[${k}] = ${id}.value;
        }
      `);
        }
      }
    }
    doc.write(`payload.value = newResult;`);
    doc.write(`return payload;`);
    return doc.compile();
  };
  let fastpass;
  const isObject2 = isObject;
  const jit = !globalConfig.jitless;
  const allowsEval2 = allowsEval;
  const fastEnabled = jit && allowsEval2.value;
  const catchall = def.catchall;
  let value;
  inst._zod.parse = (payload, ctx) => {
    value ?? (value = _normalized.value);
    const input = payload.value;
    if (!isObject2(input)) {
      payload.issues.push({
        expected: "object",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    if (jit && fastEnabled && ctx?.async === false && ctx.jitless !== true) {
      if (!fastpass)
        fastpass = generateFastpass(def.shape);
      payload = fastpass(payload, ctx);
      if (!catchall)
        return payload;
      return handleCatchall([], input, payload, ctx, value, inst, ctx?.abortEarly === true);
    }
    return superParse(payload, ctx);
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
  defineLazyInternal(inst, "optin", (zod) => zod.def.options.some((o) => o._zod.optin === "defaulted") ? "defaulted" : zod.def.options.some((o) => o._zod.optin !== undefined) ? "optional" : undefined);
  defineLazyInternal(inst, "optout", (zod) => zod.def.options.some((o) => o._zod.optout === "optional") ? "optional" : undefined);
  defineLazyInternal(inst, "values", (zod) => {
    if (zod.def.options.every((o) => o._zod.values)) {
      return new Set(zod.def.options.flatMap((option) => Array.from(option._zod.values)));
    }
    return;
  });
  defineLazyInternal(inst, "pattern", (zod) => {
    if (zod.def.options.every((o) => o._zod.pattern)) {
      const patterns = zod.def.options.map((o) => o._zod.pattern);
      return new RegExp(`^(${patterns.map((p) => cleanRegex(p.source)).join("|")})$`);
    }
    return;
  });
  const first = def.options.length === 1 ? def.options[0]._zod.run : null;
  inst._zod.parse = (payload, ctx) => {
    if (first) {
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
function discriminatorMap(def) {
  const map = new Map;
  for (const option of def.options) {
    const values = option._zod.propValues?.[def.discriminator];
    if (!values || values.size === 0)
      throw new Error(`Invalid discriminated union option at index "${def.options.indexOf(option)}"`);
    for (const value of values) {
      if (map.has(value)) {
        if (value !== undefined)
          throw new Error(`Duplicate discriminator value "${String(value)}"`);
        map.set(value, null);
      } else {
        map.set(value, option);
      }
    }
  }
  return map;
}
var $ZodDiscriminatedUnion = /* @__PURE__ */ $constructor("$ZodDiscriminatedUnion", (inst, def) => {
  def.inclusive = false;
  $ZodUnion.init(inst, def);
  const _super = inst._zod.parse;
  defineLazyInternal(inst, "propValues", (zod) => {
    const propValues = {};
    let undefinedCount = 0;
    for (const option of zod.def.options) {
      const pv = option._zod.propValues;
      if (!pv || Object.keys(pv).length === 0)
        throw new Error(`Invalid discriminated union option at index "${zod.def.options.indexOf(option)}"`);
      if (pv[zod.def.discriminator]?.has(undefined))
        undefinedCount++;
      for (const [k, v] of Object.entries(pv)) {
        if (!Object.prototype.hasOwnProperty.call(propValues, k)) {
          assignProp(propValues, k, new Set);
        }
        for (const val of v) {
          propValues[k].add(val);
        }
      }
    }
    if (!zod.def.unionFallback && undefinedCount > 1)
      propValues[zod.def.discriminator]?.delete(undefined);
    return propValues;
  });
  def.options.forEach((option, i) => {
    const propShape = rawShape(option._zod.def);
    if (propShape && !Object.prototype.hasOwnProperty.call(propShape, def.discriminator)) {
      throw new Error(`Invalid discriminated union option at index "${i}"`);
    }
  });
  const disc = cached(() => discriminatorMap(def));
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    if (!isObject(input)) {
      payload.issues.push({
        code: "invalid_type",
        expected: "object",
        input,
        inst
      });
      return payload;
    }
    const value = input?.[def.discriminator];
    const opt = disc.value.get(value);
    if (opt && (value !== undefined || ctx.direction !== "backward")) {
      return opt._zod.run(payload, ctx);
    }
    if (def.unionFallback || ctx.direction === "backward") {
      return _super(payload, ctx);
    }
    payload.issues.push({
      code: "invalid_union",
      errors: [],
      note: "No matching discriminator",
      discriminator: def.discriminator,
      options: Array.from(disc.value.keys()).filter((value) => disc.value.get(value) !== null),
      input,
      path: [def.discriminator],
      inst
    });
    return payload;
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
    if (Object.prototype.hasOwnProperty.call(newObj, "__proto__"))
      delete newObj.__proto__;
    for (const key of sharedKeys) {
      if (key === "__proto__")
        continue;
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
  const keyIssues = new Map;
  const collect = (iss, side) => {
    let keys;
    if (iss.code === "unrecognized_keys" && !iss.path?.length) {
      unrecIssue ?? (unrecIssue = iss);
      keys = iss.keys;
    } else if (iss.code === "invalid_key" && iss.origin === "record" && iss.path?.length === 1) {
      const k = String(iss.path[0]);
      if (!keyIssues.has(k))
        keyIssues.set(k, iss);
      keys = [k];
    } else {
      return false;
    }
    for (const k of keys) {
      if (!unrecKeys.has(k))
        unrecKeys.set(k, {});
      unrecKeys.get(k)[side] = true;
    }
    return true;
  };
  for (const iss of left.issues) {
    if (!collect(iss, "l"))
      result.issues.push(iss);
  }
  for (const iss of right.issues) {
    if (!collect(iss, "r"))
      result.issues.push(iss);
  }
  const bothKeys = [...unrecKeys].filter(([, f]) => f.l && f.r).map(([k]) => k);
  if (bothKeys.length) {
    const aggregated = unrecIssue ? bothKeys.filter((k) => unrecIssue.keys.includes(k)) : [];
    if (aggregated.length)
      result.issues.push({ ...unrecIssue, keys: aggregated });
    for (const k of bothKeys) {
      if (!aggregated.includes(k) && keyIssues.has(k))
        result.issues.push(keyIssues.get(k));
    }
  }
  const merged = mergeValues(left.value, right.value);
  if (!merged.valid) {
    if (aborted(result))
      return result;
    throw new Error(`Unmergable intersection. Error path: ` + `${JSON.stringify(merged.mergeErrorPath)}`);
  }
  result.value = merged.data;
  return result;
}
var $ZodRecord = /* @__PURE__ */ $constructor("$ZodRecord", (inst, def) => {
  $ZodType.init(inst, def);
  const memo = globalConfig.memoizer;
  memo?.attach(inst);
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    if (!isPlainObject(input)) {
      payload.issues.push({
        expected: "record",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    const proms = [];
    const values = def.keyType._zod.values;
    if (values && !def.partial) {
      payload.value = memo ? memo.alloc(inst, payload, {}, ctx) : {};
      const recordKeys = new Set;
      for (const key of values) {
        if (typeof key === "string" || typeof key === "number" || typeof key === "symbol") {
          recordKeys.add(typeof key === "number" ? key.toString() : key);
          if (key === "__proto__")
            continue;
          const keyResult = def.keyType._zod.run({ value: key, issues: [] }, ctx);
          if (keyResult instanceof Promise) {
            throw new Error("Async schemas not supported in object keys currently");
          }
          if (keyResult.issues.length) {
            payload.issues.push({
              code: "invalid_key",
              origin: "record",
              issues: keyResult.issues.map((iss) => finalizeIssue(iss, ctx, config())),
              input: key,
              path: [key],
              inst
            });
            continue;
          }
          const outKey = keyResult.value;
          if (outKey === "__proto__")
            continue;
          const result = def.valueType._zod.run({ value: input[key], issues: [] }, ctx);
          if (result instanceof Promise) {
            proms.push(result.then((result) => {
              if (result.issues.length) {
                payload.issues.push(...prefixIssues(key, result.issues));
              }
              payload.value[outKey] = result.value;
            }));
          } else {
            if (result.issues.length) {
              payload.issues.push(...prefixIssues(key, result.issues));
            }
            payload.value[outKey] = result.value;
          }
        }
      }
      let unrecognized;
      for (const key in input) {
        if (!recordKeys.has(key)) {
          if (def.mode === "loose") {
            if (key === "__proto__")
              continue;
            payload.value[key] = input[key];
          } else {
            unrecognized = unrecognized ?? [];
            unrecognized.push(key);
          }
        }
      }
      if (unrecognized && unrecognized.length > 0) {
        payload.issues.push({
          code: "unrecognized_keys",
          input,
          inst,
          keys: unrecognized,
          continue: true
        });
      }
    } else {
      payload.value = memo ? memo.alloc(inst, payload, {}, ctx) : {};
      let unrecognized;
      for (const key of Reflect.ownKeys(input)) {
        if (key === "__proto__")
          continue;
        if (!Object.prototype.propertyIsEnumerable.call(input, key))
          continue;
        let keyResult = def.keyType._zod.run({ value: key, issues: [] }, ctx);
        if (keyResult instanceof Promise) {
          throw new Error("Async schemas not supported in object keys currently");
        }
        const checkNumericKey = typeof key === "string" && number.test(key) && keyResult.issues.length;
        if (checkNumericKey) {
          const retryResult = def.keyType._zod.run({ value: Number(key), issues: [] }, ctx);
          if (retryResult instanceof Promise) {
            throw new Error("Async schemas not supported in object keys currently");
          }
          if (retryResult.issues.length === 0) {
            keyResult = retryResult;
          }
        }
        if (keyResult.issues.length) {
          if (def.mode === "loose") {
            payload.value[key] = input[key];
          } else if (values) {
            unrecognized = unrecognized ?? [];
            unrecognized.push(key);
          } else {
            payload.issues.push({
              code: "invalid_key",
              origin: "record",
              issues: keyResult.issues.map((iss) => finalizeIssue(iss, ctx, config())),
              input: key,
              path: [key],
              inst
            });
          }
          continue;
        }
        const outKey = keyResult.value;
        if (outKey === "__proto__")
          continue;
        const result = def.valueType._zod.run({ value: input[key], issues: [] }, ctx);
        if (result instanceof Promise) {
          proms.push(result.then((result) => {
            if (result.issues.length) {
              payload.issues.push(...prefixIssues(key, result.issues));
            }
            payload.value[outKey] = result.value;
          }));
        } else {
          if (result.issues.length) {
            payload.issues.push(...prefixIssues(key, result.issues));
          }
          payload.value[outKey] = result.value;
        }
      }
      if (unrecognized && unrecognized.length > 0) {
        payload.issues.push({
          code: "unrecognized_keys",
          input,
          inst,
          keys: unrecognized,
          continue: true
        });
      }
    }
    if (proms.length) {
      return Promise.all(proms).then(() => payload);
    }
    return payload;
  };
});
var $ZodEnum = /* @__PURE__ */ $constructor("$ZodEnum", (inst, def) => {
  $ZodType.init(inst, def);
  const values = getEnumValues(def.entries);
  const valuesSet = new Set(values);
  inst._zod.values = valuesSet;
  defineLazyInternal(inst, "pattern", (zod) => {
    const patternValues = getEnumValues(zod.def.entries).filter((k) => propertyKeyTypes.has(typeof k));
    return new RegExp(patternValues.length ? `^(${patternValues.map((o) => escapeRegex(o.toString())).join("|")})$` : "^[^\\s\\S]$");
  });
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
var $ZodLiteral = /* @__PURE__ */ $constructor("$ZodLiteral", (inst, def) => {
  $ZodType.init(inst, def);
  const values = new Set(def.values);
  inst._zod.values = values;
  defineLazyInternal(inst, "pattern", (zod) => {
    const vals = zod.def.values;
    return new RegExp(vals.length ? `^(${vals.map((o) => typeof o === "string" ? escapeRegex(o) : o ? escapeRegex(o.toString()) : String(o)).join("|")})$` : "^[^\\s\\S]$");
  });
  inst._zod.parse = (payload, _ctx) => {
    const input = payload.value;
    if (values.has(input)) {
      return payload;
    }
    payload.issues.push({
      code: "invalid_value",
      values: def.values,
      input,
      inst
    });
    return payload;
  };
});
var $ZodTransform = /* @__PURE__ */ $constructor("$ZodTransform", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  globalConfig.memoizer?.guard(inst);
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
function handleOptionalResult(payload, result) {
  payload.value = result.issues.length ? undefined : result.value;
  return payload;
}
var $ZodOptional = /* @__PURE__ */ $constructor("$ZodOptional", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazyInternal(inst, "optin", (zod) => zod.def.innerType._zod.optin === "defaulted" ? "defaulted" : "optional");
  inst._zod.optout = "optional";
  defineLazyInternal(inst, "values", (zod) => {
    const values = zod.def.innerType._zod.values;
    return values ? new Set([...values, undefined]) : undefined;
  });
  defineLazyInternal(inst, "pattern", (zod) => {
    const pattern = zod.def.innerType._zod.pattern;
    return pattern ? new RegExp(`^(${cleanRegex(pattern.source)})?$`) : undefined;
  });
  inst._zod.parse = (payload, ctx) => {
    if (payload.value === undefined) {
      if (def.innerType._zod.optin !== "defaulted")
        return payload;
      const result = def.innerType._zod.run({ value: payload.value, issues: [] }, ctx);
      if (result instanceof Promise)
        return result.then((result) => handleOptionalResult(payload, result));
      return handleOptionalResult(payload, result);
    }
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodExactOptional = /* @__PURE__ */ $constructor("$ZodExactOptional", (inst, def) => {
  $ZodOptional.init(inst, def);
  defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
  defineLazyInternal(inst, "pattern", (zod) => zod.def.innerType._zod.pattern);
  inst._zod.parse = (payload, ctx) => {
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodNullable = /* @__PURE__ */ $constructor("$ZodNullable", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazyInternal(inst, "optin", (zod) => zod.def.innerType._zod.optin);
  defineLazyInternal(inst, "optout", (zod) => zod.def.innerType._zod.optout);
  defineLazyInternal(inst, "pattern", (zod) => {
    const pattern = zod.def.innerType._zod.pattern;
    return pattern ? new RegExp(`^(${cleanRegex(pattern.source)}|null)$`) : undefined;
  });
  defineLazyInternal(inst, "values", (zod) => {
    return zod.def.innerType._zod.values ? new Set([...zod.def.innerType._zod.values, null]) : undefined;
  });
  inst._zod.parse = (payload, ctx) => {
    if (payload.value === null)
      return payload;
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodDefault = /* @__PURE__ */ $constructor("$ZodDefault", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "defaulted";
  defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
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
  inst._zod.optin = "defaulted";
  defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
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
  defineLazyInternal(inst, "values", (zod) => {
    const v = zod.def.innerType._zod.values;
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
function handleCatchResult(payload, result, def, ctx) {
  if (!result.issues.length) {
    payload.value = result.value;
    if (result.memo)
      payload.memo = true;
    return payload;
  }
  payload.value = def.catchValue({
    ...result,
    value: payload.value,
    error: {
      issues: result.issues.map((iss) => finalizeIssue(iss, ctx, config()))
    },
    input: payload.value
  });
  return payload;
}
var $ZodCatch = /* @__PURE__ */ $constructor("$ZodCatch", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazyInternal(inst, "optin", (zod) => zod.def.innerType._zod.optin === "defaulted" ? "defaulted" : "optional");
  defineLazyInternal(inst, "optout", (zod) => zod.def.innerType._zod.optout);
  defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    const result = def.innerType._zod.run({ value: payload.value, issues: [] }, ctx);
    if (result instanceof Promise) {
      return result.then((result) => handleCatchResult(payload, result, def, ctx));
    }
    return handleCatchResult(payload, result, def, ctx);
  };
});
var $ZodPipe = /* @__PURE__ */ $constructor("$ZodPipe", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazyInternal(inst, "values", (zod) => zod.def.in._zod.values);
  defineLazyInternal(inst, "optin", (zod) => zod.def.in._zod.optin);
  defineLazyInternal(inst, "optout", (zod) => zod.def.out._zod.optout);
  defineLazyInternal(inst, "propValues", (zod) => zod.def.in._zod.propValues);
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
  if (left.issues.some((iss) => iss.code !== "unrecognized_keys")) {
    left.aborted = true;
    return left;
  }
  return next._zod.run({ value: left.value, issues: left.issues }, ctx);
}
var $ZodPreprocess = /* @__PURE__ */ $constructor("$ZodPreprocess", (inst, def) => {
  $ZodPipe.init(inst, def);
});
var $ZodReadonly = /* @__PURE__ */ $constructor("$ZodReadonly", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazyInternal(inst, "propValues", (zod) => zod.def.innerType._zod.propValues);
  defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
  defineLazyInternal(inst, "optin", (zod) => zod.def.innerType?._zod?.optin);
  defineLazyInternal(inst, "optout", (zod) => zod.def.innerType?._zod?.optout);
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
  if (!payload.memo)
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
// ../../../../../node_modules/.bun/zod@4.6.7/node_modules/zod/v4/core/memoizer.js
class $ZodCyclicError extends Error {
  constructor() {
    super(`Cannot parse a reference cycle that closes through a transform`);
    this.name = "ZodCyclicError";
  }
}
var STATE = "~memo";
var NO_ISSUES = [];
function isRef(value) {
  return value !== null && typeof value === "object";
}
function cloneIssues(issues) {
  return issues.map((iss) => iss.path ? { ...iss, path: iss.path.slice() } : { ...iss });
}
var recursive = /* @__PURE__ */ new WeakMap;
var NONE = 0;
var ASSUMED = 1;
var PROVEN = 2;
function isRecursive(inst, stack, resolve) {
  const cached = recursive.get(inst);
  if (cached !== undefined)
    return cached ? PROVEN : NONE;
  if (stack.has(inst))
    return PROVEN;
  stack.add(inst);
  let result = NONE;
  const check = (child) => {
    if (result !== PROVEN && child?._zod) {
      const answer = isRecursive(child, stack, resolve);
      if (answer > result)
        result = answer;
    }
  };
  const shape = (sh, spread) => {
    let answer = NONE;
    for (const key of Reflect.ownKeys(sh)) {
      const desc = Object.getOwnPropertyDescriptor(sh, key);
      if (spread && !desc.enumerable)
        continue;
      const child = desc.get ? ASSUMED : desc.value?._zod ? isRecursive(desc.value, stack, resolve) : NONE;
      if (child > answer)
        answer = child;
    }
    return answer;
  };
  const merge = (answer) => {
    if (answer > result)
      result = answer;
  };
  const def = inst._zod.def;
  const kind = def.type;
  switch (kind) {
    case "object": {
      const raw = rawShape(def);
      merge(raw ? shape(raw, true) : ASSUMED);
      check(def.catchall);
      break;
    }
    case "array":
      check(def.element);
      break;
    case "tuple":
      for (const el of def.items)
        check(el);
      check(def.rest);
      break;
    case "record":
    case "map":
      check(def.keyType);
      check(def.valueType);
      break;
    case "set":
      check(def.valueType);
      break;
    case "union":
      for (const el of def.options)
        check(el);
      break;
    case "intersection":
      check(def.left);
      check(def.right);
      break;
    case "optional":
    case "nullable":
    case "default":
    case "prefault":
    case "catch":
    case "readonly":
    case "nonoptional":
    case "promise":
    case "success":
      check(def.innerType);
      break;
    case "pipe":
      check(def.in);
      check(def.out);
      break;
    case "function":
      check(def.input);
      check(def.output);
      break;
    case "lazy": {
      const inner = def._cachedInner ?? (resolve ? inst._zod.innerType : undefined);
      merge(inner ? isRecursive(inner, stack, false) : ASSUMED);
      break;
    }
    case "template_literal":
    case "string":
    case "number":
    case "int":
    case "boolean":
    case "bigint":
    case "symbol":
    case "undefined":
    case "null":
    case "void":
    case "never":
    case "any":
    case "unknown":
    case "date":
    case "nan":
    case "enum":
    case "literal":
    case "file":
    case "transform":
    case "custom":
      break;
    default: {
      for (const key in def) {
        const desc = Object.getOwnPropertyDescriptor(def, key);
        if (!desc || desc.get)
          continue;
        const value = desc.value;
        if (!value || typeof value !== "object")
          continue;
        if (value._zod)
          check(value);
        else if (Array.isArray(value))
          for (const el of value)
            check(el);
      }
    }
  }
  stack.delete(inst);
  return settle(inst, result);
}
function settle(inst, answer) {
  if (answer !== ASSUMED)
    recursive.set(inst, answer === PROVEN);
  return answer;
}
function bucketFor(state, inst) {
  let bucket = state.buckets.get(inst);
  if (!bucket) {
    bucket = new WeakMap;
    state.buckets.set(inst, bucket);
  }
  return bucket;
}
var handoff;
var open = [];
var memo = {
  alloc(_inst, payload, empty) {
    const bucket = handoff;
    if (!bucket)
      return empty;
    handoff = undefined;
    const entry = { value: empty, issues: null };
    bucket.set(payload.value, entry);
    open.push(entry);
    return empty;
  },
  guard(inst) {
    var _a;
    (_a = inst._zod).deferred ?? (_a.deferred = []);
    inst._zod.deferred.push(() => {
      const base = inst._zod.parse;
      const wrapped = (payload, ctx) => {
        if (ctx.direction !== "backward" && isBackEdge(ctx, payload.value))
          throw new $ZodCyclicError;
        return base(payload, ctx);
      };
      inst._zod.parse = wrapped;
      if (inst._zod.run === base)
        inst._zod.run = wrapped;
    });
  },
  attach(inst) {
    var _a;
    let isRecursiveInst;
    let rechecked = false;
    let lastCtx;
    let lastBucket;
    (_a = inst._zod).deferred ?? (_a.deferred = []);
    inst._zod.deferred.push(() => {
      const base = inst._zod.parse;
      const wrapped = (payload, ctx) => {
        if (isRecursiveInst === undefined) {
          const walked = isRecursive(inst, new Set, false);
          if (walked === NONE) {
            inst._zod.parse = base;
            if (inst._zod.run === wrapped)
              inst._zod.run = base;
            return base(payload, ctx);
          }
          if (walked === PROVEN || rechecked)
            isRecursiveInst = true;
          else
            rechecked = true;
        }
        const input = payload.value;
        if (!isRef(input))
          return base(payload, ctx);
        let state = ctx[STATE];
        if (!state) {
          state = { buckets: new WeakMap, backEdges: undefined };
          ctx[STATE] = state;
        }
        let bucket;
        if (lastCtx === ctx) {
          bucket = lastBucket;
        } else {
          bucket = bucketFor(state, inst);
          lastCtx = ctx;
          lastBucket = bucket;
        }
        const hit = bucket.get(input);
        if (hit) {
          payload.value = hit.value;
          if (hit.issues) {
            if (hit.issues.length)
              payload.issues.push(...cloneIssues(hit.issues));
          } else {
            payload.memo = true;
            state.backEdges ?? (state.backEdges = new WeakSet);
            state.backEdges.add(hit.value);
          }
          return payload;
        }
        handoff = bucket;
        const depth = open.length;
        const result = base(payload, ctx);
        handoff = undefined;
        const entry = open.length > depth ? open.pop() : undefined;
        if (result instanceof Promise) {
          return result.then((r) => {
            if (entry)
              entry.issues = r.issues.length ? cloneIssues(r.issues) : NO_ISSUES;
            return r;
          });
        }
        if (entry)
          entry.issues = result.issues.length ? cloneIssues(result.issues) : NO_ISSUES;
        return result;
      };
      inst._zod.parse = wrapped;
      if (inst._zod.run === base)
        inst._zod.run = wrapped;
    });
  }
};
function memoizer() {
  return memo;
}
function isBackEdge(ctx, value) {
  const backEdges = ctx[STATE]?.backEdges;
  return backEdges !== undefined && isRef(value) && backEdges.has(value);
}
// ../../../../../node_modules/.bun/zod@4.6.7/node_modules/zod/v4/locales/en.js
var error = () => {
  const Sizable = {
    string: { unit: "characters", verb: "to have" },
    file: { unit: "bytes", verb: "to have" },
    array: { unit: "items", verb: "to have" },
    set: { unit: "items", verb: "to have" },
    map: { unit: "entries", verb: "to have" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "input",
    email: "email address",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO datetime",
    date: "ISO date",
    time: "ISO time",
    duration: "ISO duration",
    ipv4: "IPv4 address",
    ipv6: "IPv6 address",
    mac: "MAC address",
    cidrv4: "IPv4 range",
    cidrv6: "IPv6 range",
    base64: "base64-encoded string",
    base64url: "base64url-encoded string",
    json_string: "JSON string",
    e164: "E.164 number",
    currency_code: "currency code",
    credit_card: "credit card number",
    iban: "IBAN",
    jwt: "JWT",
    template_literal: "input"
  };
  const TypeDictionary = {
    nan: "NaN"
  };
  function getTypeName(type, input) {
    if (type === "number" && typeof input === "number" && !Number.isFinite(input)) {
      return String(input);
    }
    return TypeDictionary[type] ?? type;
  }
  return (issue) => {
    switch (issue.code) {
      case "invalid_type": {
        const expected = getTypeName(issue.expected);
        const receivedType = parsedType(issue.input);
        const received = getTypeName(receivedType, issue.input);
        return `Invalid input: expected ${expected}, received ${received}`;
      }
      case "invalid_value":
        if (issue.values.length === 1)
          return `Invalid input: expected ${stringifyPrimitive(issue.values[0])}`;
        return `Invalid option: expected one of ${joinValues(issue.values, "|")}`;
      case "too_big": {
        const adj = issue.exact ? "exactly " : issue.inclusive ? "<=" : "<";
        const sizing = getSizing(issue.origin);
        if (sizing)
          return `Too big: expected ${issue.origin ?? "value"} to have ${adj}${issue.maximum.toString()} ${sizing.unit ?? "elements"}`;
        return `Too big: expected ${issue.origin ?? "value"} to be ${adj}${issue.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue.exact ? "exactly " : issue.inclusive ? ">=" : ">";
        const sizing = getSizing(issue.origin);
        if (sizing) {
          return `Too small: expected ${issue.origin} to have ${adj}${issue.minimum.toString()} ${sizing.unit}`;
        }
        return `Too small: expected ${issue.origin} to be ${adj}${issue.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue;
        if (_issue.format === "starts_with") {
          return `Invalid string: must start with "${_issue.prefix}"`;
        }
        if (_issue.format === "ends_with")
          return `Invalid string: must end with "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Invalid string: must include "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Invalid string: must match pattern ${_issue.pattern}`;
        return `Invalid ${FormatDictionary[_issue.format] ?? issue.format}`;
      }
      case "not_multiple_of":
        return `Invalid number: must be a multiple of ${issue.divisor}`;
      case "unrecognized_keys":
        return `Unrecognized key${issue.keys.length > 1 ? "s" : ""}: ${joinValues(issue.keys, ", ")}`;
      case "invalid_key":
        return `Invalid key in ${issue.origin}`;
      case "invalid_union":
        if (issue.options && Array.isArray(issue.options) && issue.options.length > 0) {
          const opts = issue.options.map((o) => `'${o}'`).join(" | ");
          return `Invalid discriminator value. Expected ${opts}`;
        }
        if (issue.inclusive === false) {
          return "Invalid input: more than one option matched";
        }
        return "Invalid input";
      case "invalid_element":
        return `Invalid value in ${issue.origin}`;
      default:
        return `Invalid input`;
    }
  };
};
function en_default() {
  return {
    localeError: error()
  };
}
// ../../../../../node_modules/.bun/zod@4.6.7/node_modules/zod/v4/core/registries.js
var _a2;
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
(_a2 = globalThis).__zod_globalRegistry ?? (_a2.__zod_globalRegistry = registry());
var globalRegistry = globalThis.__zod_globalRegistry;
// ../../../../../node_modules/.bun/zod@4.6.7/node_modules/zod/v4/core/api.js
function snapshotChecks(def) {
  if (def.checks)
    def.checks = [...def.checks];
  return def;
}
function _string(Class, params) {
  return new Class(snapshotChecks({ type: "string", ...normalizeParams(params) }));
}
function _email(Class, params) {
  return new Class({
    type: "string",
    format: "email",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _guid(Class, params) {
  return new Class({
    type: "string",
    format: "guid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _uuid(Class, params) {
  return new Class({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _uuidv4(Class, params) {
  return new Class({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v4",
    ...normalizeParams(params)
  });
}
function _uuidv6(Class, params) {
  return new Class({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v6",
    ...normalizeParams(params)
  });
}
function _uuidv7(Class, params) {
  return new Class({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v7",
    ...normalizeParams(params)
  });
}
function _url(Class, params) {
  return new Class({
    type: "string",
    format: "url",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _emoji2(Class, params) {
  return new Class({
    type: "string",
    format: "emoji",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _nanoid(Class, params) {
  return new Class({
    type: "string",
    format: "nanoid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _cuid(Class, params) {
  return new Class({
    type: "string",
    format: "cuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _cuid2(Class, params) {
  return new Class({
    type: "string",
    format: "cuid2",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _ulid(Class, params) {
  return new Class({
    type: "string",
    format: "ulid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _xid(Class, params) {
  return new Class({
    type: "string",
    format: "xid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _ksuid(Class, params) {
  return new Class({
    type: "string",
    format: "ksuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _ipv4(Class, params) {
  return new Class({
    type: "string",
    format: "ipv4",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _ipv6(Class, params) {
  return new Class({
    type: "string",
    format: "ipv6",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _cidrv4(Class, params) {
  return new Class({
    type: "string",
    format: "cidrv4",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _cidrv6(Class, params) {
  return new Class({
    type: "string",
    format: "cidrv6",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _base64(Class, params) {
  return new Class({
    type: "string",
    format: "base64",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _base64url(Class, params) {
  return new Class({
    type: "string",
    format: "base64url",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _e164(Class, params) {
  return new Class({
    type: "string",
    format: "e164",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _jwt(Class, params) {
  return new Class({
    type: "string",
    format: "jwt",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _isoDateTime(Class, params) {
  return new Class({
    type: "string",
    format: "datetime",
    check: "string_format",
    offset: false,
    local: false,
    precision: null,
    ...normalizeParams(params)
  });
}
function _isoDate(Class, params) {
  return new Class({
    type: "string",
    format: "date",
    check: "string_format",
    ...normalizeParams(params)
  });
}
function _isoTime(Class, params) {
  return new Class({
    type: "string",
    format: "time",
    check: "string_format",
    precision: null,
    ...normalizeParams(params)
  });
}
function _isoDuration(Class, params) {
  return new Class({
    type: "string",
    format: "duration",
    check: "string_format",
    ...normalizeParams(params)
  });
}
function _number(Class, params) {
  return new Class(snapshotChecks({ type: "number", checks: [], ...normalizeParams(params) }));
}
function _int(Class, params) {
  return new Class({
    type: "number",
    check: "number_format",
    abort: false,
    format: "safeint",
    ...normalizeParams(params)
  });
}
function _boolean(Class, params) {
  return new Class({
    type: "boolean",
    ...normalizeParams(params)
  });
}
function _unknown(Class) {
  return new Class({
    type: "unknown"
  });
}
function _never(Class, params) {
  return new Class({
    type: "never",
    ...normalizeParams(params)
  });
}
function _lt(value, params) {
  return new $ZodCheckLessThan({
    check: "less_than",
    ...normalizeParams(params),
    value,
    inclusive: false
  });
}
function _lte(value, params) {
  return new $ZodCheckLessThan({
    check: "less_than",
    ...normalizeParams(params),
    value,
    inclusive: true
  });
}
function _gt(value, params) {
  return new $ZodCheckGreaterThan({
    check: "greater_than",
    ...normalizeParams(params),
    value,
    inclusive: false
  });
}
function _gte(value, params) {
  return new $ZodCheckGreaterThan({
    check: "greater_than",
    ...normalizeParams(params),
    value,
    inclusive: true
  });
}
function _multipleOf(value, params) {
  return new $ZodCheckMultipleOf({
    check: "multiple_of",
    ...normalizeParams(params),
    value
  });
}
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
function _regex(pattern, params) {
  return new $ZodCheckRegex({
    check: "string_format",
    format: "regex",
    ...normalizeParams(params),
    pattern
  });
}
function _lowercase(params) {
  return new $ZodCheckLowerCase({
    check: "string_format",
    format: "lowercase",
    ...normalizeParams(params)
  });
}
function _uppercase(params) {
  return new $ZodCheckUpperCase({
    check: "string_format",
    format: "uppercase",
    ...normalizeParams(params)
  });
}
function _includes(includes, params) {
  return new $ZodCheckIncludes({
    check: "string_format",
    format: "includes",
    ...normalizeParams(params),
    includes
  });
}
function _startsWith(prefix, params) {
  return new $ZodCheckStartsWith({
    check: "string_format",
    format: "starts_with",
    ...normalizeParams(params),
    prefix
  });
}
function _endsWith(suffix, params) {
  return new $ZodCheckEndsWith({
    check: "string_format",
    format: "ends_with",
    ...normalizeParams(params),
    suffix
  });
}
function _overwrite(tx) {
  return new $ZodCheckOverwrite({
    check: "overwrite",
    tx
  });
}
function _normalize(form) {
  return _overwrite((input) => input.normalize(form));
}
function _trim() {
  return _overwrite((input) => input.trim());
}
function _toLowerCase() {
  return _overwrite((input) => input.toLowerCase());
}
function _toUpperCase() {
  return _overwrite((input) => input.toUpperCase());
}
function _slugify() {
  return _overwrite((input) => slugify(input));
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
function _superRefine(fn, params) {
  const ch = _check((payload) => {
    payload.addIssue = (issue2) => {
      if (typeof issue2 === "string") {
        payload.issues.push(issue(issue2, payload.value, ch._zod.def));
      } else {
        const _issue = issue2;
        if (_issue.fatal)
          _issue.continue = false;
        _issue.code ?? (_issue.code = "custom");
        if (!("input" in _issue))
          _issue.input = payload.value;
        _issue.inst ?? (_issue.inst = ch);
        _issue.continue ?? (_issue.continue = !ch._zod.def.abort);
        payload.issues.push(issue(_issue));
      }
    };
    return fn(payload.value, payload);
  }, params);
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
// ../../../../../node_modules/.bun/zod@4.6.7/node_modules/zod/v4/core/to-json-schema.js
function assignProps(target, ...sources) {
  for (const source of sources) {
    for (const key of Reflect.ownKeys(source)) {
      if (Object.prototype.propertyIsEnumerable.call(source, key)) {
        assignProp(target, key, source[key]);
      }
    }
  }
  return target;
}
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
    sharedDefsExtractedFor: undefined,
    sharedEmitDoneFor: undefined,
    cycles: params?.cycles ?? "ref",
    reused: params?.reused ?? "inline",
    intersections: [],
    deferred: [],
    external: params?.external ?? undefined
  };
}
function handleUnrepresentable(schema, ctx, json, params, message) {
  const result = typeof ctx.unrepresentable === "function" ? ctx.unrepresentable({ zodSchema: schema, path: params.path, message }) : ctx.unrepresentable;
  if (result === "any")
    return false;
  if (result === undefined || result === "throw")
    throw new Error(message);
  Object.assign(json, result);
  return true;
}
function processSchema(schema, ctx, _params = { path: [], schemaPath: [] }) {
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
  ctx.sharedDefsExtractedFor = undefined;
  ctx.sharedEmitDoneFor = undefined;
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
      processSchema(parent, ctx, params);
      ctx.seen.get(parent).isParent = true;
    }
  }
  const meta = ctx.metadataRegistry.get(schema);
  if (meta)
    assignProps(result.schema, meta);
  if (ctx.io === "input" && isTransforming(schema)) {
    delete result.schema.examples;
    delete result.schema.default;
  }
  if (ctx.io === "input" && "_prefault" in result.schema)
    (_a = result.schema).default ?? (_a.default = result.schema._prefault);
  delete result.schema._prefault;
  const _result = ctx.seen.get(schema);
  return _result.schema;
}
function encodeJSONPointerSegment(segment) {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}
function extractDefs(ctx, schema) {
  const root = ctx.seen.get(schema);
  if (!root)
    throw new Error("Unprocessed schema. This is a bug in Zod.");
  if (ctx.external && ctx.sharedDefsExtractedFor === ctx.external)
    return;
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
      return { defId: id, ref: `${uriGenerator("__shared")}#/${defsSegment}/${encodeJSONPointerSegment(id)}` };
    }
    const uriPrefix = `#`;
    const defUriPrefix = `${uriPrefix}/${defsSegment}/`;
    if (entry[1] === root && !entry[1].schema.id) {
      return { ref: uriPrefix };
    }
    const defId = entry[1].schema.id ?? `__schema${ctx.counter++}`;
    return { defId, ref: defUriPrefix + encodeJSONPointerSegment(defId) };
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
      }
    }
  }
  if (ctx.external)
    ctx.sharedDefsExtractedFor = ctx.external;
}
function compactTypeUnion(schema) {
  const options = schema.anyOf;
  if (!Array.isArray(options) || options.length === 0 || schema.type !== undefined)
    return;
  const types = [];
  for (const option of options) {
    if (!option || typeof option !== "object")
      return;
    compactTypeUnion(option);
    const keys = Object.keys(option);
    if (keys.length !== 1 || keys[0] !== "type")
      return;
    const type = option.type;
    for (const member of Array.isArray(type) ? type : [type]) {
      if (typeof member !== "string")
        return;
      if (!types.includes(member))
        types.push(member);
    }
  }
  delete schema.anyOf;
  schema.type = types.length === 1 ? types[0] : types;
}
var FOLDABLE_KEYS = new Set(["type", "properties", "required", "additionalProperties"]);
var UNION_KEYS = ["oneOf", "anyOf"];
function undeclaredConstraint(member) {
  const extra = member.additionalProperties;
  if (extra === undefined || extra === false || typeof extra !== "object" || extra === null)
    return null;
  return Object.keys(extra).length ? extra : null;
}
function foldObjects(members) {
  const objects = [];
  for (const member of members) {
    if (typeof member !== "object" || member.type !== "object")
      return null;
    for (const key in member) {
      if (!FOLDABLE_KEYS.has(key))
        return null;
    }
    objects.push(member);
  }
  const properties = {};
  const required = new Set;
  for (const object of objects) {
    for (const key in object.properties) {
      if (Object.prototype.hasOwnProperty.call(properties, key))
        continue;
      const parts = [];
      for (const other of objects) {
        const part = other.properties?.[key] ?? undeclaredConstraint(other);
        if (part === null || part === undefined)
          continue;
        if (!parts.some((seen) => JSON.stringify(seen) === JSON.stringify(part)))
          parts.push(part);
      }
      const merged = parts.length === 1 ? parts[0] : foldObjects(parts) ?? { allOf: parts };
      assignProp(properties, key, merged);
    }
    for (const key of object.required ?? [])
      required.add(key);
  }
  const folded = { type: "object", properties };
  if (required.size)
    folded.required = [...required];
  if (objects.every((object) => object.additionalProperties === false)) {
    folded.additionalProperties = false;
  } else {
    const constraints = [];
    for (const object of objects) {
      const constraint = undeclaredConstraint(object);
      if (constraint && !constraints.some((seen) => JSON.stringify(seen) === JSON.stringify(constraint)))
        constraints.push(constraint);
    }
    if (constraints.length === 1)
      folded.additionalProperties = constraints[0];
    else if (constraints.length > 1)
      folded.additionalProperties = { allOf: constraints };
  }
  return folded;
}
function foldIntersection(json) {
  const allOf = json.allOf;
  if (!Array.isArray(allOf) || allOf.length < 2)
    return;
  for (const key of FOLDABLE_KEYS)
    if (key in json)
      return;
  const unions = allOf.filter((m) => UNION_KEYS.some((k) => Array.isArray(m[k])));
  let folded = null;
  if (!unions.length) {
    folded = foldObjects(allOf);
  } else {
    const union = unions[0];
    const keyword = UNION_KEYS.find((k) => Array.isArray(union[k]));
    if (Object.keys(union).length !== 1)
      return;
    const rest = allOf.filter((m) => m !== union);
    const branches = union[keyword].map((branch) => foldObjects([...rest, branch]));
    if (branches.some((b) => !b))
      return;
    folded = { [keyword]: branches };
  }
  if (!folded)
    return;
  delete json.allOf;
  assignProps(json, folded);
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
        assignProps(schema, refSchema);
      }
      assignProps(schema, _cached);
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
  if (!ctx.external || ctx.sharedEmitDoneFor !== ctx.external) {
    for (const entry of [...ctx.seen.entries()].reverse()) {
      flattenRef(entry[0]);
    }
    if (ctx.target !== "openapi-3.0") {
      for (const entry of ctx.seen.entries()) {
        compactTypeUnion(entry[1].def ?? entry[1].schema);
      }
    }
    for (const rewrite of ctx.deferred)
      rewrite();
    if (ctx.intersections.length) {
      const carriers = new Map;
      for (const seen of ctx.seen.values()) {
        for (const json of [seen.schema, seen.def]) {
          const allOf = json?.allOf;
          if (!Array.isArray(allOf))
            continue;
          const existing = carriers.get(allOf);
          if (existing)
            existing.push(json);
          else
            carriers.set(allOf, [json]);
        }
      }
      for (const allOf of ctx.intersections) {
        for (const json of carriers.get(allOf) ?? [])
          foldIntersection(json);
      }
    }
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
  assignProps(result, root.defId ? root.schema : root.def ?? root.schema);
  const rootMetaId = ctx.metadataRegistry.get(schema)?.id;
  if (rootMetaId !== undefined && result.id === rootMetaId)
    delete result.id;
  const defs = ctx.external?.defs ?? {};
  if (!ctx.external || ctx.sharedEmitDoneFor !== ctx.external) {
    for (const entry of ctx.seen.entries()) {
      const seen = entry[1];
      if (seen.def && seen.defId) {
        if (seen.def.id === seen.defId)
          delete seen.def.id;
        assignProp(defs, seen.defId, seen.def);
      }
    }
  }
  if (ctx.external)
    ctx.sharedEmitDoneFor = ctx.external;
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
  if (def.type === "promise" || def.type === "optional" || def.type === "nonoptional" || def.type === "nullable" || def.type === "readonly" || def.type === "default" || def.type === "prefault" || def.type === "catch") {
    return isTransforming(def.innerType, ctx);
  }
  if (def.type === "intersection") {
    return isTransforming(def.left, ctx) || isTransforming(def.right, ctx);
  }
  if (def.type === "record" || def.type === "map") {
    return isTransforming(def.keyType, ctx) || isTransforming(def.valueType, ctx);
  }
  if (def.type === "pipe") {
    if (_schema._zod.traits.has("$ZodCodec"))
      return true;
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
  processSchema(schema, ctx);
  extractDefs(ctx, schema);
  return finalize(ctx, schema);
};
var createStandardJSONSchemaMethod = (schema, io, processors = {}) => (params) => {
  const { libraryOptions, target } = params ?? {};
  const ctx = initializeContext({ ...libraryOptions ?? {}, target, io, processors });
  processSchema(schema, ctx);
  extractDefs(ctx, schema);
  return finalize(ctx, schema);
};
// ../../../../../node_modules/.bun/zod@4.6.7/node_modules/zod/v4/core/json-schema-processors.js
var narrowMin = (agg, key, value) => {
  if (agg[key] === undefined || value > agg[key])
    agg[key] = value;
};
var narrowMax = (agg, key, value) => {
  if (agg[key] === undefined || value < agg[key])
    agg[key] = value;
};
var narrowBoth = (agg, value) => {
  narrowMin(agg, "minimum", value);
  narrowMax(agg, "maximum", value);
};
var addDivisor = (agg, value) => {
  agg.multipleOf ?? (agg.multipleOf = []);
  if (!agg.multipleOf.includes(value))
    agg.multipleOf.push(value);
};
var addPattern = (agg, pattern) => {
  agg.patterns ?? (agg.patterns = new Set);
  agg.patterns.add(pattern);
};
var intersectMime = (agg, mime) => {
  agg.mime = agg.mime ? agg.mime.filter((m) => mime.includes(m)) : [...mime];
};
var setFormat = (agg, format) => {
  agg.format = format;
  if (format.includes("int"))
    agg.isInt = true;
};
var minContributor = (agg, def) => narrowMin(agg, "minimum", def.minimum);
var maxContributor = (agg, def) => narrowMax(agg, "maximum", def.maximum);
var formatContributor = (ranges) => (agg, def) => {
  setFormat(agg, def.format);
  const [minimum, maximum] = ranges[def.format];
  narrowMin(agg, "minimum", minimum);
  narrowMax(agg, "maximum", maximum);
};
var contributors = {
  greater_than: (agg, def) => narrowMin(agg, def.inclusive ? "minimum" : "exclusiveMinimum", def.value),
  less_than: (agg, def) => narrowMax(agg, def.inclusive ? "maximum" : "exclusiveMaximum", def.value),
  multiple_of: (agg, def) => addDivisor(agg, def.value),
  number_format: formatContributor(NUMBER_FORMAT_RANGES),
  bigint_format: formatContributor(BIGINT_FORMAT_RANGES),
  min_length: minContributor,
  max_length: maxContributor,
  length_equals: (agg, def) => narrowBoth(agg, def.length),
  min_size: minContributor,
  max_size: maxContributor,
  size_equals: (agg, def) => narrowBoth(agg, def.size),
  string_format: (agg, def) => {
    setFormat(agg, def.format);
    if (def.pattern)
      addPattern(agg, def.pattern);
    if (def.format === "base64" || def.format === "base64url")
      agg.contentEncoding = def.format;
    if (def.local || def.precision === -1)
      agg.laxFormat = true;
  },
  mime_type: (agg, def) => intersectMime(agg, def.mime)
};
function aggregateChecks(schema) {
  const agg = {};
  const def = schema._zod.def;
  const list = schema._zod.traits.has("$ZodCheck") ? [schema, ...def.checks ?? []] : def.checks ?? [];
  for (const ch of list)
    contributors[ch._zod.def.check]?.(agg, ch._zod.def);
  const bag = schema._zod.bag;
  if (bag.minimum !== undefined)
    narrowMin(agg, "minimum", bag.minimum);
  if (bag.exclusiveMinimum !== undefined)
    narrowMin(agg, "exclusiveMinimum", bag.exclusiveMinimum);
  if (bag.maximum !== undefined)
    narrowMax(agg, "maximum", bag.maximum);
  if (bag.exclusiveMaximum !== undefined)
    narrowMax(agg, "exclusiveMaximum", bag.exclusiveMaximum);
  if (bag.multipleOf !== undefined)
    addDivisor(agg, bag.multipleOf);
  if (bag.format !== undefined) {
    agg.format ?? (agg.format = bag.format);
    if (bag.format.includes("int"))
      agg.isInt = true;
  }
  if (bag.mime)
    intersectMime(agg, bag.mime);
  for (const pattern of bag.patterns ?? [])
    addPattern(agg, pattern);
  return agg;
}
var formatMap = {
  guid: "uuid",
  url: "uri",
  datetime: "date-time",
  json_string: "json-string",
  regex: ""
};
var exactPatterns = new Map([
  [base64Charset, base64],
  [base64urlCharset, base64url]
]);
var exactPattern = (p) => exactPatterns.get(p) ?? p;
var stringProcessor = (schema, ctx, _json, _params) => {
  const json = _json;
  json.type = "string";
  const { minimum, maximum, format, patterns, contentEncoding, laxFormat } = aggregateChecks(schema);
  if (typeof minimum === "number")
    json.minLength = minimum;
  if (typeof maximum === "number")
    json.maxLength = maximum;
  if (format) {
    json.format = formatMap[format] ?? format;
    if (json.format === "")
      delete json.format;
    if (format === "time" || laxFormat) {
      delete json.format;
    }
  }
  if (contentEncoding)
    json.contentEncoding = contentEncoding;
  if (patterns && patterns.size > 0) {
    const patternList = [...patterns].map(exactPattern);
    if (patternList.length === 1)
      json.pattern = patternList[0].source;
    else if (patternList.length > 1) {
      json.allOf = [
        ...patternList.map((regex) => ({
          ...ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0" ? { type: "string" } : {},
          pattern: regex.source
        }))
      ];
    }
  }
};
var numberProcessor = (schema, ctx, _json, params) => {
  const json = _json;
  const { minimum, maximum, multipleOf, exclusiveMaximum, exclusiveMinimum, isInt } = aggregateChecks(schema);
  json.type = isInt ? "integer" : "number";
  const exMin = typeof exclusiveMinimum === "number" && exclusiveMinimum >= (minimum ?? Number.NEGATIVE_INFINITY);
  const exMax = typeof exclusiveMaximum === "number" && exclusiveMaximum <= (maximum ?? Number.POSITIVE_INFINITY);
  const legacy = ctx.target === "draft-04" || ctx.target === "openapi-3.0";
  if (exMin) {
    if (legacy) {
      json.minimum = exclusiveMinimum;
      json.exclusiveMinimum = true;
    } else {
      json.exclusiveMinimum = exclusiveMinimum;
    }
  } else if (typeof minimum === "number") {
    json.minimum = minimum;
  }
  if (exMax) {
    if (legacy) {
      json.maximum = exclusiveMaximum;
      json.exclusiveMaximum = true;
    } else {
      json.exclusiveMaximum = exclusiveMaximum;
    }
  } else if (typeof maximum === "number") {
    json.maximum = maximum;
  }
  if (multipleOf) {
    const divisors = new Set;
    for (const divisor of multipleOf) {
      if (Number.isFinite(divisor) && divisor !== 0)
        divisors.add(Math.abs(divisor));
      else
        handleUnrepresentable(schema, ctx, json, params, `A multipleOf divisor of ${divisor} cannot be represented in JSON Schema`);
    }
    const [first, ...rest] = divisors;
    if (first !== undefined)
      json.multipleOf = first;
    if (rest.length)
      json.allOf = [...json.allOf ?? [], ...rest.map((m) => ({ multipleOf: m }))];
  }
};
var booleanProcessor = (_schema, _ctx, json, _params) => {
  json.type = "boolean";
};
var neverProcessor = (_schema, _ctx, json, _params) => {
  json.not = {};
};
var unknownProcessor = (_schema, _ctx, _json, _params) => {};
var enumProcessor = (schema, _ctx, json, _params) => {
  const def = schema._zod.def;
  const values = getEnumValues(def.entries);
  if (values.length === 0) {
    json.not = {};
    return;
  }
  if (values.every((v) => typeof v === "number"))
    json.type = "number";
  if (values.every((v) => typeof v === "string"))
    json.type = "string";
  json.enum = values;
};
var literalProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  if (def.values.length === 0) {
    json.not = {};
    return;
  }
  const vals = [];
  for (const val of def.values) {
    if (val === undefined) {
      if (handleUnrepresentable(schema, ctx, json, params, "Literal `undefined` cannot be represented in JSON Schema"))
        return;
    } else if (typeof val === "bigint") {
      if (handleUnrepresentable(schema, ctx, json, params, "BigInt literals cannot be represented in JSON Schema"))
        return;
      vals.push(Number(val));
    } else {
      vals.push(val);
    }
  }
  if (vals.length === 0) {} else if (vals.length === 1) {
    const val = vals[0];
    json.type = val === null ? "null" : typeof val;
    if (ctx.target === "draft-04" || ctx.target === "openapi-3.0") {
      json.enum = [val];
    } else {
      json.const = val;
    }
  } else {
    if (vals.every((v) => typeof v === "number"))
      json.type = "number";
    if (vals.every((v) => typeof v === "string"))
      json.type = "string";
    if (vals.every((v) => typeof v === "boolean"))
      json.type = "boolean";
    if (vals.every((v) => v === null))
      json.type = "null";
    json.enum = vals;
  }
};
var customProcessor = (schema, ctx, json, params) => {
  handleUnrepresentable(schema, ctx, json, params, "Custom types cannot be represented in JSON Schema");
};
var transformProcessor = (schema, ctx, json, params) => {
  handleUnrepresentable(schema, ctx, json, params, "Transforms cannot be represented in JSON Schema");
};
var arrayProcessor = (schema, ctx, _json, params) => {
  const json = _json;
  const def = schema._zod.def;
  const { minimum, maximum } = aggregateChecks(schema);
  if (typeof minimum === "number")
    json.minItems = minimum;
  if (typeof maximum === "number")
    json.maxItems = maximum;
  json.type = "array";
  json.items = processSchema(def.element, ctx, {
    ...params,
    path: [...params.path, "items"]
  });
};
function inputOptin(schema) {
  const def = schema._zod.def;
  if (def.type === "pipe" && def.in._zod.traits.has("$ZodTransform")) {
    return inputOptin(def.out);
  }
  if (def.type === "catch") {
    return inputOptin(def.innerType);
  }
  return schema._zod.optin;
}
var objectProcessor = (schema, ctx, _json, params) => {
  const json = _json;
  const def = schema._zod.def;
  const shape = def.shape;
  const symbolKeys = Object.getOwnPropertySymbols(shape);
  if (symbolKeys.length && handleUnrepresentable(schema, ctx, json, params, "Symbol keys cannot be represented in JSON Schema")) {
    return;
  }
  json.type = "object";
  json.properties = {};
  for (const key in shape) {
    assignProp(json.properties, key, processSchema(shape[key], ctx, {
      ...params,
      path: [...params.path, "properties", key]
    }));
  }
  const requiredKeys = [];
  for (const key of Object.keys(shape)) {
    const field = def.shape[key];
    if (ctx.io === "input" ? inputOptin(field) === undefined : field._zod.optout === undefined) {
      requiredKeys.push(key);
    }
  }
  if (requiredKeys.length > 0) {
    json.required = requiredKeys;
  }
  if (def.catchall?._zod.def.type === "never") {
    json.additionalProperties = false;
  } else if (!def.catchall) {
    if (ctx.io === "output")
      json.additionalProperties = false;
  } else if (def.catchall) {
    json.additionalProperties = processSchema(def.catchall, ctx, {
      ...params,
      path: [...params.path, "additionalProperties"]
    });
  }
};
var unionProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  const isExclusive = def.inclusive === false;
  const options = def.options.map((x, i) => processSchema(x, ctx, {
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
  const a = processSchema(def.left, ctx, {
    ...params,
    path: [...params.path, "allOf", 0]
  });
  const b = processSchema(def.right, ctx, {
    ...params,
    path: [...params.path, "allOf", 1]
  });
  const isSimpleIntersection = (val) => ("allOf" in val) && Object.keys(val).length === 1;
  const allOf = [
    ...isSimpleIntersection(a) ? a.allOf : [a],
    ...isSimpleIntersection(b) ? b.allOf : [b]
  ];
  json.allOf = allOf;
  ctx.intersections.push(allOf);
};
function stringifyKeyNames(bySchema, json, visited) {
  if (json.$ref) {
    if (visited.has(json))
      return json;
    visited.add(json);
    const def = bySchema.get(json)?.def;
    if (!def)
      return json;
    const inlined = stringifyKeyNames(bySchema, def, visited);
    return inlined === def ? json : inlined;
  }
  for (const keyword of ["anyOf", "oneOf"]) {
    const branches = json[keyword];
    if (!Array.isArray(branches))
      continue;
    const mapped = branches.map((branch) => stringifyKeyNames(bySchema, branch, visited));
    if (mapped.some((branch, i) => branch !== branches[i]))
      json = { ...json, [keyword]: mapped };
  }
  const types = Array.isArray(json.type) ? json.type : [json.type];
  const numericType = !types.includes("string") && types.some((t) => t === "number" || t === "integer");
  const values = json.enum ?? (json.const !== undefined ? [json.const] : undefined);
  if (!numericType && !values?.some((v) => typeof v === "number"))
    return json;
  const { minimum, maximum, exclusiveMinimum, exclusiveMaximum, multipleOf, format, id, ...rest } = json;
  if (rest.enum)
    rest.enum = rest.enum.map((v) => typeof v === "number" ? String(v) : v);
  else if (typeof rest.const === "number")
    rest.const = String(rest.const);
  if (!numericType)
    return rest;
  rest.type = "string";
  if (!values)
    rest.pattern = (types.includes("number") ? number : integer).source;
  return rest;
}
var pendingRecords = new WeakMap;
function rewriteKeyNames(ctx) {
  const bySchema = new Map;
  for (const entry of ctx.seen.values()) {
    if (entry.def && !bySchema.has(entry.schema))
      bySchema.set(entry.schema, entry);
  }
  const rewrites = new Map;
  for (const record of pendingRecords.get(ctx) ?? []) {
    const seen = ctx.seen.get(record);
    const names = (seen?.def ?? seen?.schema)?.propertyNames;
    if (!names || names === true || rewrites.has(names))
      continue;
    const rewritten = stringifyKeyNames(bySchema, names, new Set);
    if (rewritten !== names)
      rewrites.set(names, rewritten);
  }
  if (!rewrites.size)
    return;
  for (const entry of ctx.seen.values()) {
    for (const carrier of [entry.schema, entry.def]) {
      const rewritten = carrier && rewrites.get(carrier.propertyNames);
      if (rewritten)
        carrier.propertyNames = rewritten;
    }
  }
}
var recordProcessor = (schema, ctx, _json, params) => {
  const json = _json;
  const def = schema._zod.def;
  json.type = "object";
  const keyType = def.keyType;
  const patterns = aggregateChecks(keyType).patterns;
  if (def.mode === "loose" && patterns && patterns.size > 0) {
    const valueSchema = processSchema(def.valueType, ctx, {
      ...params,
      path: [...params.path, "patternProperties", "*"]
    });
    json.patternProperties = {};
    for (const pattern of patterns) {
      assignProp(json.patternProperties, exactPattern(pattern).source, valueSchema);
    }
  } else {
    if (ctx.target === "draft-07" || ctx.target === "draft-2020-12") {
      json.propertyNames = processSchema(def.keyType, ctx, {
        ...params,
        path: [...params.path, "propertyNames"]
      });
      let pending = pendingRecords.get(ctx);
      if (!pending) {
        pending = [];
        pendingRecords.set(ctx, pending);
        ctx.deferred.push(() => rewriteKeyNames(ctx));
      }
      pending.push(schema);
    }
    json.additionalProperties = processSchema(def.valueType, ctx, {
      ...params,
      path: [...params.path, "additionalProperties"]
    });
  }
  const keyValues = keyType._zod.values;
  const omittableOnInput = ctx.io === "input" && inputOptin(def.valueType) !== undefined;
  if (keyValues && !def.partial && !omittableOnInput) {
    const validKeyValues = [...keyValues].filter((v) => typeof v === "string" || typeof v === "number");
    if (validKeyValues.length > 0) {
      json.required = validKeyValues.map(String);
    }
  }
};
var nullableProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  const inner = processSchema(def.innerType, ctx, params);
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
  processSchema(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
};
var UNREPRESENTABLE_DEFAULT = Symbol();
function serializeDefaultValue(value, schema, ctx, json, params) {
  let unrepresentable = false;
  const serialized = JSON.stringify(value, (_, val) => {
    if (typeof val !== "bigint")
      return val;
    unrepresentable = true;
    return null;
  });
  if (!unrepresentable)
    return JSON.parse(serialized);
  handleUnrepresentable(schema, ctx, json, params, "BigInt defaults cannot be represented in JSON Schema");
  return UNREPRESENTABLE_DEFAULT;
}
var defaultProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  processSchema(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  const value = serializeDefaultValue(def.defaultValue, schema, ctx, json, params);
  if (value !== UNREPRESENTABLE_DEFAULT)
    json.default = value;
};
var prefaultProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  processSchema(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  if (ctx.io !== "input")
    return;
  const value = serializeDefaultValue(def.defaultValue, schema, ctx, json, params);
  if (value !== UNREPRESENTABLE_DEFAULT)
    json._prefault = value;
};
var catchProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  processSchema(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  let catchValue;
  try {
    catchValue = def.catchValue(undefined);
  } catch {
    handleUnrepresentable(schema, ctx, json, params, "Dynamic catch values are not supported in JSON Schema");
    return;
  }
  json.default = catchValue;
};
var pipeProcessor = (schema, ctx, _json, params) => {
  const def = schema._zod.def;
  const inIsTransform = def.in._zod.traits.has("$ZodTransform");
  const innerType = ctx.io === "input" ? inIsTransform ? def.out : def.in : def.out;
  processSchema(innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = innerType;
};
var readonlyProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  processSchema(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  json.readOnly = true;
};
var optionalProcessor = (schema, ctx, _json, params) => {
  const def = schema._zod.def;
  processSchema(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
};
// ../../../../../node_modules/.bun/zod@4.6.7/node_modules/zod/v4/classic/errors.js
var _installedErrorProtos = /* @__PURE__ */ new WeakSet([Object.prototype, Error.prototype]);
function _lazyMethod(proto, key, make) {
  Object.defineProperty(proto, key, {
    configurable: true,
    enumerable: false,
    get() {
      const value = make(this);
      Object.defineProperty(this, key, { value, configurable: true, writable: true });
      return value;
    },
    set(value) {
      Object.defineProperty(this, key, { value, configurable: true, writable: true });
    }
  });
}
var initializer2 = (inst, issues) => {
  $ZodError.init(inst, issues);
  inst.name = "ZodError";
  const proto = Object.getPrototypeOf(inst);
  if (_installedErrorProtos.has(proto))
    return;
  _installedErrorProtos.add(proto);
  _lazyMethod(proto, "format", (self) => (mapper) => formatError(self, mapper));
  _lazyMethod(proto, "flatten", (self) => (mapper) => flattenError(self, mapper));
  _lazyMethod(proto, "addIssue", (self) => (issue) => {
    self.issues.push(issue);
    self.message = JSON.stringify(self.issues, jsonStringifyReplacer, 2);
  });
  _lazyMethod(proto, "addIssues", (self) => (issues) => {
    self.issues.push(...issues);
    self.message = JSON.stringify(self.issues, jsonStringifyReplacer, 2);
  });
  Object.defineProperty(proto, "isEmpty", {
    configurable: true,
    enumerable: false,
    get() {
      return this.issues.length === 0;
    }
  });
};
var ZodRealError = /* @__PURE__ */ $constructor("ZodError", initializer2, undefined, {
  Parent: Error
});

// ../../../../../node_modules/.bun/zod@4.6.7/node_modules/zod/v4/classic/parse.js
var parse2 = /* @__PURE__ */ _parse(ZodRealError);
var parseAsync = /* @__PURE__ */ _parseAsync(ZodRealError);
var safeParse = /* @__PURE__ */ _safeParse(ZodRealError);
var safeParseAsync = /* @__PURE__ */ _safeParseAsync(ZodRealError);
var encode = /* @__PURE__ */ _encode(ZodRealError);
var decode = /* @__PURE__ */ _decode(ZodRealError);
var encodeAsync = /* @__PURE__ */ _encodeAsync(ZodRealError);
var decodeAsync = /* @__PURE__ */ _decodeAsync(ZodRealError);
var safeEncode = /* @__PURE__ */ _safeEncode(ZodRealError);
var safeDecode = /* @__PURE__ */ _safeDecode(ZodRealError);
var safeEncodeAsync = /* @__PURE__ */ _safeEncodeAsync(ZodRealError);
var safeDecodeAsync = /* @__PURE__ */ _safeDecodeAsync(ZodRealError);

// ../../../../../node_modules/.bun/zod@4.6.7/node_modules/zod/v4/classic/schemas.js
function _ensureDefaultLocale() {
  if (!globalConfig.localeError)
    config(en_default());
}
function _ensureDefaultMemoizer() {
  if (!globalConfig.memoizer)
    config({ memoizer: memoizer() });
}
var ZodType = /* @__PURE__ */ $constructor("ZodType", (inst, def) => {
  _ensureDefaultLocale();
  $ZodType.init(inst, def);
  inst.def = def;
  inst.type = def.type;
  return inst;
}, {
  check(...chks) {
    const def = this.def;
    return this.clone(mergeDefs(def, {
      checks: [
        ...def.checks ?? [],
        ...chks.map((ch) => typeof ch === "function" ? { _zod: { check: ch, def: { check: "custom" }, onattach: [] } } : ch)
      ]
    }), { parent: true });
  },
  with(...chks) {
    return this.check(...chks);
  },
  clone(def, params) {
    return clone(this, def, params);
  },
  brand() {
    return this;
  },
  register(reg, meta) {
    reg.add(this, meta);
    return this;
  },
  refine(check, params) {
    return this.check(refine(check, params));
  },
  superRefine(refinement, params) {
    return this.check(superRefine(refinement, params));
  },
  overwrite(fn) {
    return this.check(_overwrite(fn));
  },
  optional() {
    return optional(this);
  },
  exactOptional() {
    return exactOptional(this);
  },
  nullable() {
    return nullable(this);
  },
  nullish() {
    return optional(nullable(this));
  },
  nonoptional(params) {
    return nonoptional(this, params);
  },
  array() {
    return array(this);
  },
  or(arg) {
    return union([this, arg]);
  },
  and(arg) {
    return intersection(this, arg);
  },
  transform(tx) {
    return pipe(this, transform(tx));
  },
  default(d) {
    return _default(this, d);
  },
  prefault(d) {
    return prefault(this, d);
  },
  catch(params) {
    return _catch(this, params);
  },
  pipe(target) {
    return pipe(this, target);
  },
  readonly() {
    return readonly(this);
  },
  describe(description) {
    const cl = this.clone();
    globalRegistry.add(cl, { description });
    return cl;
  },
  meta(...args) {
    if (args.length === 0)
      return globalRegistry.get(this);
    const cl = this.clone();
    globalRegistry.add(cl, args[0]);
    return cl;
  },
  isOptional() {
    return this.safeParse(undefined).success;
  },
  isNullable() {
    return this.safeParse(null).success;
  },
  apply(fn, ...args) {
    return args.length === 0 ? fn(this) : fn(this, ...args);
  },
  get "~standard"() {
    return hide(this, "~standard", {
      ...standardProps(this),
      jsonSchema: {
        input: createStandardJSONSchemaMethod(this, "input"),
        output: createStandardJSONSchemaMethod(this, "output")
      }
    });
  },
  set "~standard"(value) {
    own(this, "~standard", value);
  },
  parse: function _parse(data, params) {
    return parse2(this, data, params, { callee: _parse });
  },
  parseAsync: async function _parseAsync(data, params) {
    return await parseAsync(this, data, params, { callee: _parseAsync });
  },
  safeParse(data, params) {
    return safeParse(this, data, params);
  },
  async safeParseAsync(data, params) {
    return safeParseAsync(this, data, params);
  },
  get spa() {
    return this?.safeParseAsync;
  },
  set spa(value) {
    own(this, "spa", value);
  },
  validate(data, params) {
    return validate(this, data, params);
  },
  validateAsync(data, params) {
    return validateAsync(this, data, params);
  },
  encode: function _encode(data, params) {
    return encode(this, data, params, { callee: _encode });
  },
  decode: function _decode(data, params) {
    return decode(this, data, params, { callee: _decode });
  },
  encodeAsync: async function _encodeAsync(data, params) {
    return await encodeAsync(this, data, params, { callee: _encodeAsync });
  },
  decodeAsync: async function _decodeAsync(data, params) {
    return await decodeAsync(this, data, params, { callee: _decodeAsync });
  },
  safeEncode(data, params) {
    return safeEncode(this, data, params);
  },
  safeDecode(data, params) {
    return safeDecode(this, data, params);
  },
  async safeEncodeAsync(data, params) {
    return safeEncodeAsync(this, data, params);
  },
  async safeDecodeAsync(data, params) {
    return safeDecodeAsync(this, data, params);
  },
  toJSONSchema(params) {
    return createToJSONSchemaMethod(this, {})(params);
  },
  get description() {
    return globalRegistry.get(this)?.description;
  },
  get _def() {
    return this._zod.def;
  }
});
var _ZodString = /* @__PURE__ */ $constructor("_ZodString", (inst, def) => {
  $ZodString.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => stringProcessor(inst, ctx, json, params);
}, /* @__PURE__ */ derived({
  format: (inst) => aggregateChecks(inst).format ?? null,
  minLength: (inst) => aggregateChecks(inst).minimum ?? null,
  maxLength: (inst) => aggregateChecks(inst).maximum ?? null
}, {
  regex(...args) {
    return this.check(_regex(...args));
  },
  includes(...args) {
    return this.check(_includes(...args));
  },
  startsWith(...args) {
    return this.check(_startsWith(...args));
  },
  endsWith(...args) {
    return this.check(_endsWith(...args));
  },
  min(...args) {
    return this.check(_minLength(...args));
  },
  max(...args) {
    return this.check(_maxLength(...args));
  },
  length(...args) {
    return this.check(_length(...args));
  },
  nonempty(...args) {
    return this.check(_minLength(1, ...args));
  },
  lowercase(params) {
    return this.check(_lowercase(params));
  },
  uppercase(params) {
    return this.check(_uppercase(params));
  },
  trim() {
    return this.check(_trim());
  },
  normalize(...args) {
    return this.check(_normalize(...args));
  },
  toLowerCase() {
    return this.check(_toLowerCase());
  },
  toUpperCase() {
    return this.check(_toUpperCase());
  },
  slugify() {
    return this.check(_slugify());
  }
}));
var ZodString = /* @__PURE__ */ $constructor("ZodString", (inst, def) => {
  $ZodString.init(inst, def);
  _ZodString.init(inst, def);
}, {
  email(params) {
    return this.check(_email(ZodEmail, params));
  },
  url(params) {
    return this.check(_url(ZodURL, params));
  },
  jwt(params) {
    return this.check(_jwt(ZodJWT, params));
  },
  emoji(params) {
    return this.check(_emoji2(ZodEmoji, params));
  },
  guid(params) {
    return this.check(_guid(ZodGUID, params));
  },
  uuid(params) {
    return this.check(_uuid(ZodUUID, params));
  },
  uuidv4(params) {
    return this.check(_uuidv4(ZodUUID, params));
  },
  uuidv6(params) {
    return this.check(_uuidv6(ZodUUID, params));
  },
  uuidv7(params) {
    return this.check(_uuidv7(ZodUUID, params));
  },
  nanoid(params) {
    return this.check(_nanoid(ZodNanoID, params));
  },
  cuid(params) {
    return this.check(_cuid(ZodCUID, params));
  },
  cuid2(params) {
    return this.check(_cuid2(ZodCUID2, params));
  },
  ulid(params) {
    return this.check(_ulid(ZodULID, params));
  },
  base64(params) {
    return this.check(_base64(ZodBase64, params));
  },
  base64url(params) {
    return this.check(_base64url(ZodBase64URL, params));
  },
  xid(params) {
    return this.check(_xid(ZodXID, params));
  },
  ksuid(params) {
    return this.check(_ksuid(ZodKSUID, params));
  },
  ipv4(params) {
    return this.check(_ipv4(ZodIPv4, params));
  },
  ipv6(params) {
    return this.check(_ipv6(ZodIPv6, params));
  },
  cidrv4(params) {
    return this.check(_cidrv4(ZodCIDRv4, params));
  },
  cidrv6(params) {
    return this.check(_cidrv6(ZodCIDRv6, params));
  },
  e164(params) {
    return this.check(_e164(ZodE164, params));
  },
  datetime(params) {
    return this.check(_isoDateTime(ZodISODateTime, params));
  },
  date(params) {
    return this.check(_isoDate(ZodISODate, params));
  },
  time(params) {
    return this.check(_isoTime(ZodISOTime, params));
  },
  duration(params) {
    return this.check(_isoDuration(ZodISODuration, params));
  }
});
function string2(params) {
  return _string(ZodString, params);
}
var ZodStringFormat = /* @__PURE__ */ $constructor("ZodStringFormat", (inst, def) => {
  $ZodStringFormat.init(inst, def);
  _ZodString.init(inst, def);
});
var ZodISODateTime = /* @__PURE__ */ $constructor("ZodISODateTime", (inst, def) => {
  $ZodISODateTime.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodISODate = /* @__PURE__ */ $constructor("ZodISODate", (inst, def) => {
  $ZodISODate.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodISOTime = /* @__PURE__ */ $constructor("ZodISOTime", (inst, def) => {
  $ZodISOTime.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodISODuration = /* @__PURE__ */ $constructor("ZodISODuration", (inst, def) => {
  $ZodISODuration.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodEmail = /* @__PURE__ */ $constructor("ZodEmail", (inst, def) => {
  $ZodEmail.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodGUID = /* @__PURE__ */ $constructor("ZodGUID", (inst, def) => {
  $ZodGUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodUUID = /* @__PURE__ */ $constructor("ZodUUID", (inst, def) => {
  $ZodUUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodURL = /* @__PURE__ */ $constructor("ZodURL", (inst, def) => {
  $ZodURL.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodEmoji = /* @__PURE__ */ $constructor("ZodEmoji", (inst, def) => {
  $ZodEmoji.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodNanoID = /* @__PURE__ */ $constructor("ZodNanoID", (inst, def) => {
  $ZodNanoID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodCUID = /* @__PURE__ */ $constructor("ZodCUID", (inst, def) => {
  $ZodCUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodCUID2 = /* @__PURE__ */ $constructor("ZodCUID2", (inst, def) => {
  $ZodCUID2.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodULID = /* @__PURE__ */ $constructor("ZodULID", (inst, def) => {
  $ZodULID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodXID = /* @__PURE__ */ $constructor("ZodXID", (inst, def) => {
  $ZodXID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodKSUID = /* @__PURE__ */ $constructor("ZodKSUID", (inst, def) => {
  $ZodKSUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodIPv4 = /* @__PURE__ */ $constructor("ZodIPv4", (inst, def) => {
  $ZodIPv4.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodIPv6 = /* @__PURE__ */ $constructor("ZodIPv6", (inst, def) => {
  $ZodIPv6.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodCIDRv4 = /* @__PURE__ */ $constructor("ZodCIDRv4", (inst, def) => {
  $ZodCIDRv4.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodCIDRv6 = /* @__PURE__ */ $constructor("ZodCIDRv6", (inst, def) => {
  $ZodCIDRv6.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodBase64 = /* @__PURE__ */ $constructor("ZodBase64", (inst, def) => {
  $ZodBase64.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodBase64URL = /* @__PURE__ */ $constructor("ZodBase64URL", (inst, def) => {
  $ZodBase64URL.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodE164 = /* @__PURE__ */ $constructor("ZodE164", (inst, def) => {
  $ZodE164.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodJWT = /* @__PURE__ */ $constructor("ZodJWT", (inst, def) => {
  $ZodJWT.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodNumber = /* @__PURE__ */ $constructor("ZodNumber", (inst, def) => {
  $ZodNumber.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => numberProcessor(inst, ctx, json, params);
  inst.isFinite = true;
}, /* @__PURE__ */ derived({
  minValue: (inst) => {
    const { minimum, exclusiveMinimum } = aggregateChecks(inst);
    return Math.max(minimum ?? Number.NEGATIVE_INFINITY, exclusiveMinimum ?? Number.NEGATIVE_INFINITY);
  },
  maxValue: (inst) => {
    const { maximum, exclusiveMaximum } = aggregateChecks(inst);
    return Math.min(maximum ?? Number.POSITIVE_INFINITY, exclusiveMaximum ?? Number.POSITIVE_INFINITY);
  },
  isInt: (inst) => {
    const { isInt, multipleOf } = aggregateChecks(inst);
    return !!isInt || !!multipleOf?.some(Number.isSafeInteger);
  },
  format: (inst) => aggregateChecks(inst).format ?? null
}, {
  gt(value, params) {
    return this.check(_gt(value, params));
  },
  gte(value, params) {
    return this.check(_gte(value, params));
  },
  min(value, params) {
    return this.check(_gte(value, params));
  },
  lt(value, params) {
    return this.check(_lt(value, params));
  },
  lte(value, params) {
    return this.check(_lte(value, params));
  },
  max(value, params) {
    return this.check(_lte(value, params));
  },
  int(params) {
    return this.check(int(params));
  },
  safe(params) {
    return this.check(int(params));
  },
  positive(params) {
    return this.check(_gt(0, params));
  },
  nonnegative(params) {
    return this.check(_gte(0, params));
  },
  negative(params) {
    return this.check(_lt(0, params));
  },
  nonpositive(params) {
    return this.check(_lte(0, params));
  },
  multipleOf(value, params) {
    return this.check(_multipleOf(value, params));
  },
  step(value, params) {
    return this.check(_multipleOf(value, params));
  },
  finite() {
    return this;
  }
}));
function number2(params) {
  return _number(ZodNumber, params);
}
var ZodNumberFormat = /* @__PURE__ */ $constructor("ZodNumberFormat", (inst, def) => {
  $ZodNumberFormat.init(inst, def);
  ZodNumber.init(inst, def);
});
function int(params) {
  return _int(ZodNumberFormat, params);
}
var ZodBoolean = /* @__PURE__ */ $constructor("ZodBoolean", (inst, def) => {
  $ZodBoolean.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => booleanProcessor(inst, ctx, json, params);
});
function boolean2(params) {
  return _boolean(ZodBoolean, params);
}
var ZodUnknown = /* @__PURE__ */ $constructor("ZodUnknown", (inst, def) => {
  $ZodUnknown.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => unknownProcessor(inst, ctx, json, params);
});
function unknown() {
  return _unknown(ZodUnknown);
}
var ZodNever = /* @__PURE__ */ $constructor("ZodNever", (inst, def) => {
  $ZodNever.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => neverProcessor(inst, ctx, json, params);
});
function never(params) {
  return _never(ZodNever, params);
}
var ZodArray = /* @__PURE__ */ $constructor("ZodArray", (inst, def) => {
  _ensureDefaultMemoizer();
  $ZodArray.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => arrayProcessor(inst, ctx, json, params);
  inst.element = def.element;
}, {
  min(n, params) {
    return this.check(_minLength(n, params));
  },
  nonempty(params) {
    return this.check(_minLength(1, params));
  },
  max(n, params) {
    return this.check(_maxLength(n, params));
  },
  length(n, params) {
    return this.check(_length(n, params));
  },
  unwrap() {
    return this.element;
  }
});
function array(element, params) {
  return _array(ZodArray, element, params);
}
var ZodObject = /* @__PURE__ */ $constructor("ZodObject", (inst, def) => {
  _ensureDefaultMemoizer();
  $ZodObjectJIT.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => objectProcessor(inst, ctx, json, params);
  installLazyProp(inst, "shape", (self) => self._zod.def.shape, false);
}, {
  keyof() {
    return _enum(Object.keys(this._zod.def.shape));
  },
  catchall(catchall) {
    return this.clone(mergeDefs(this._zod.def, { catchall }));
  },
  passthrough() {
    return this.clone(mergeDefs(this._zod.def, { catchall: unknown() }));
  },
  loose() {
    return this.clone(mergeDefs(this._zod.def, { catchall: unknown() }));
  },
  strict() {
    return this.clone(mergeDefs(this._zod.def, { catchall: never() }));
  },
  strip() {
    return this.clone(mergeDefs(this._zod.def, { catchall: undefined }));
  },
  extend(incoming) {
    return extend(this, incoming);
  },
  safeExtend(incoming) {
    return safeExtend(this, incoming);
  },
  merge(other) {
    return merge(this, other);
  },
  pick(mask) {
    return pick(this, mask);
  },
  omit(mask) {
    return omit(this, mask);
  },
  partial(...args) {
    return partial(ZodOptional, this, args[0]);
  },
  exactPartial(...args) {
    return partial(ZodExactOptional, this, args[0], "exactPartial");
  },
  required(...args) {
    return required(ZodNonOptional, this, args[0]);
  }
});
function object(shape, params) {
  const def = {
    type: "object",
    shape: shape ?? {},
    ...normalizeParams(params)
  };
  return new ZodObject(def);
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
var ZodDiscriminatedUnion = /* @__PURE__ */ $constructor("ZodDiscriminatedUnion", (inst, def) => {
  ZodUnion.init(inst, def);
  $ZodDiscriminatedUnion.init(inst, def);
});
function discriminatedUnion(discriminator, options, params) {
  return new ZodDiscriminatedUnion({
    type: "union",
    options,
    discriminator,
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
var ZodRecord = /* @__PURE__ */ $constructor("ZodRecord", (inst, def) => {
  _ensureDefaultMemoizer();
  $ZodRecord.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => recordProcessor(inst, ctx, json, params);
  inst.keyType = def.keyType;
  inst.valueType = def.valueType;
});
function record(keyType, valueType, params) {
  if (!valueType || !valueType._zod) {
    return new ZodRecord({
      type: "record",
      keyType: string2(),
      valueType: keyType,
      ...normalizeParams(valueType)
    });
  }
  return new ZodRecord({
    type: "record",
    keyType,
    valueType,
    ...normalizeParams(params)
  });
}
var ZodEnum = /* @__PURE__ */ $constructor("ZodEnum", (inst, def) => {
  $ZodEnum.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => enumProcessor(inst, ctx, json, params);
  inst.enum = def.entries;
  inst.options = [...inst._zod.values];
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
var ZodLiteral = /* @__PURE__ */ $constructor("ZodLiteral", (inst, def) => {
  $ZodLiteral.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => literalProcessor(inst, ctx, json, params);
  inst.values = new Set(def.values);
  Object.defineProperty(inst, "value", {
    get() {
      if (def.values.length > 1) {
        throw new Error("This schema contains multiple valid literal values. Use `.values` instead.");
      }
      return def.values[0];
    }
  });
});
function literal(value, params) {
  return new ZodLiteral({
    type: "literal",
    values: Array.isArray(value) ? value : [value],
    ...normalizeParams(params)
  });
}
var ZodTransform = /* @__PURE__ */ $constructor("ZodTransform", (inst, def) => {
  _ensureDefaultMemoizer();
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
        if (!("input" in _issue))
          _issue.input = payload.value;
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
    catchValue: typeof catchValue === "function" ? catchValue : constantCatch(catchValue)
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
var ZodPreprocess = /* @__PURE__ */ $constructor("ZodPreprocess", (inst, def) => {
  ZodPipe.init(inst, def);
  $ZodPreprocess.init(inst, def);
});
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
function superRefine(fn, params) {
  return _superRefine(fn, params);
}
function preprocess(fn, schema) {
  return new ZodPreprocess({
    type: "pipe",
    in: transform(fn),
    out: schema
  });
}
// ../../../../omo-engine/omo-config-core/src/schema/reasoning-vocabulary.ts
var REASONING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
var REASONING_AUTO = "auto";
var REASONING_LEVEL_SET = new Set(REASONING_LEVELS);
var REASONING_LEVEL_OR_AUTO_SET = new Set([...REASONING_LEVELS, REASONING_AUTO]);
function isReasoningLevel(value) {
  return REASONING_LEVEL_SET.has(value);
}
function normalizeReasoning(input) {
  const normalized = input.trim().toLowerCase();
  if (!normalized)
    return {};
  if (normalized === "none")
    return { level: "off" };
  if (normalized === REASONING_AUTO)
    return { level: REASONING_AUTO };
  if (isReasoningLevel(normalized))
    return { level: normalized };
  return { passthrough: normalized };
}
function splitReasoningSuffix(model, options) {
  if (typeof model !== "string")
    return { base: "" };
  const trimmed = model.trim();
  if (!trimmed)
    return { base: "" };
  const separatorIndex = trimmed.lastIndexOf(":");
  if (separatorIndex === -1)
    return { base: trimmed };
  const base = trimmed.slice(0, separatorIndex).trim();
  const token = trimmed.slice(separatorIndex + 1).trim().toLowerCase();
  if (!base || !REASONING_LEVEL_OR_AUTO_SET.has(token))
    return { base: trimmed };
  if (token === "max" && !(options?.allowMaxSuffix ?? base.includes("/")))
    return { base: trimmed };
  return { base, level: token };
}

// ../../../../omo-engine/omo-config-core/src/schema/model-ref.ts
var REASONING_LEVELS_OR_AUTO = [...REASONING_LEVELS, "auto"];
var OmoReasoningSchema = union([
  _enum(REASONING_LEVELS_OR_AUTO),
  string2()
]);
var OmoModelRefObjectSchema = object({
  model: string2(),
  reasoning: OmoReasoningSchema.optional(),
  temperature: number2().min(0).max(2).optional(),
  top_p: number2().min(0).max(1).optional(),
  max_tokens: number2().int().positive().optional(),
  provider_options: record(string2(), unknown()).optional()
}).strict();
var OmoModelRefSchema = union([string2(), OmoModelRefObjectSchema]);

// ../../../../omo-engine/omo-config-core/src/schema/fallback-models.ts
var OmoThinkingConfigSchema = object({
  type: _enum(["enabled", "disabled"]),
  budgetTokens: number2().optional()
}).strict();
var OmoReasoningEffortSchema = OmoReasoningSchema;
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function canonicalReasoning(value) {
  if (typeof value !== "string")
    return;
  const normalized = normalizeReasoning(value);
  return normalized.level ?? normalized.passthrough;
}
function canonicalModelString(model) {
  const colon = splitReasoningSuffix(model, { allowMaxSuffix: true });
  if (colon.level !== undefined)
    return `${colon.base}:${colon.level}`;
  const trimmed = model.trim();
  const parenthesized = trimmed.match(/^(.*)\(([^()]+)\)\s*$/);
  const spaced = parenthesized === null ? trimmed.match(/^(.*\S)\s+([a-z][a-z0-9_-]*)$/i) : null;
  const base = (parenthesized?.[1] ?? spaced?.[1])?.trim();
  const token = (parenthesized?.[2] ?? spaced?.[2])?.trim();
  if (base === undefined || token === undefined)
    return trimmed;
  const normalized = normalizeReasoning(token);
  return normalized.level === undefined ? trimmed : `${base}:${normalized.level}`;
}
function normalizeLegacyModelFields(entry) {
  const normalized = { ...entry };
  delete normalized["variant"];
  delete normalized["reasoningEffort"];
  delete normalized["thinking"];
  delete normalized["textVerbosity"];
  delete normalized["providerOptions"];
  if (typeof entry["model"] === "string")
    normalized["model"] = canonicalModelString(entry["model"]);
  const explicitReasoning = canonicalReasoning(entry["reasoning"]);
  const variant = canonicalReasoning(entry["variant"]);
  const reasoningEffort = canonicalReasoning(entry["reasoningEffort"]);
  const thinking = isRecord(entry["thinking"]) ? entry["thinking"] : undefined;
  const reasoning = explicitReasoning ?? reasoningEffort ?? variant ?? (thinking?.["type"] === "disabled" ? "off" : undefined);
  if (reasoning !== undefined)
    normalized["reasoning"] = reasoning;
  const providerOptions = isRecord(entry["provider_options"]) ? { ...entry["provider_options"] } : isRecord(entry["providerOptions"]) ? { ...entry["providerOptions"] } : {};
  if (thinking?.["type"] === "enabled")
    providerOptions["thinking"] = { ...thinking };
  if (entry["textVerbosity"] !== undefined)
    providerOptions["textVerbosity"] = entry["textVerbosity"];
  if (Object.keys(providerOptions).length > 0)
    normalized["provider_options"] = providerOptions;
  if (entry["max_tokens"] !== undefined) {
    normalized["max_tokens"] = entry["max_tokens"];
    if (entry["maxTokens"] === undefined || typeof entry["maxTokens"] === "number") {
      delete normalized["maxTokens"];
    }
  } else if (typeof entry["maxTokens"] === "number") {
    normalized["max_tokens"] = entry["maxTokens"];
    delete normalized["maxTokens"];
  }
  return normalized;
}
var OmoLegacyFallbackModelObjectInputSchema = object({
  model: string2(),
  reasoning: OmoReasoningSchema.optional(),
  temperature: number2().min(0).max(2).optional(),
  top_p: number2().min(0).max(1).optional(),
  max_tokens: number2().int().positive().optional(),
  provider_options: record(string2(), unknown()).optional(),
  variant: string2().optional(),
  reasoningEffort: OmoReasoningEffortSchema.optional(),
  thinking: OmoThinkingConfigSchema.optional(),
  textVerbosity: _enum(["low", "medium", "high"]).optional(),
  maxTokens: number2().optional(),
  providerOptions: record(string2(), unknown()).optional()
}).strict();
var OmoFallbackModelObjectSchema = preprocess((value) => isRecord(value) ? normalizeLegacyModelFields(value) : value, OmoLegacyFallbackModelObjectInputSchema);
var OmoFallbackModelsSchema = union([
  string2(),
  array(string2()),
  array(OmoFallbackModelObjectSchema),
  array(union([string2(), OmoFallbackModelObjectSchema]))
]);

// ../../../../omo-engine/omo-config-core/src/schema/agent.ts
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
var OmoAgentModelEntrySchema = union([string2(), OmoFallbackModelObjectSchema]);
var PermissionValueSchema = _enum(["ask", "allow", "deny"]);
var BashPermissionSchema = union([
  PermissionValueSchema,
  record(string2(), PermissionValueSchema)
]);
var OmoAgentPermissionSchema = object({
  edit: PermissionValueSchema.optional(),
  bash: BashPermissionSchema.optional(),
  webfetch: PermissionValueSchema.optional(),
  task: PermissionValueSchema.optional(),
  doom_loop: PermissionValueSchema.optional(),
  external_directory: PermissionValueSchema.optional()
}).catchall(PermissionValueSchema.optional());
var OmoAgentDefInputSchema = object({
  description: string2().optional(),
  prompt: string2().optional(),
  model: string2().optional(),
  models: array(OmoAgentModelEntrySchema).optional(),
  reasoning: OmoReasoningSchema.optional(),
  variant: string2().optional(),
  reasoningEffort: OmoReasoningEffortSchema.optional(),
  tools: record(string2(), boolean2()).optional(),
  execution_mode: _enum(["in-process", "process"]).optional(),
  background: boolean2().optional(),
  max_depth: number2().int().nonnegative().optional(),
  allowed_subagents: array(string2()).optional(),
  disallowed_tools: array(string2()).optional(),
  max_turns: number2().int().nonnegative().optional(),
  temperature: number2().min(0).max(2).optional(),
  disable: boolean2().optional(),
  permission: OmoAgentPermissionSchema.optional(),
  prompt_append: string2().optional()
}).strict();
var OmoAgentDefSchema = preprocess((value) => isRecord2(value) ? normalizeLegacyModelFields(value) : value, OmoAgentDefInputSchema);
var OmoAgentsConfigSchema = record(string2(), OmoAgentDefSchema);

// ../../../../omo-engine/omo-config-core/src/schema/category.ts
function isRecord3(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
var OmoCategoryConfigObjectSchema = object({
  description: string2().optional(),
  model: string2().optional(),
  models: array(union([string2(), OmoFallbackModelObjectSchema])).optional(),
  reasoning: OmoReasoningSchema.optional(),
  temperature: number2().min(0).max(2).optional(),
  top_p: number2().min(0).max(1).optional(),
  max_tokens: number2().int().positive().optional(),
  provider_options: record(string2(), unknown()).optional(),
  fallback_models: OmoFallbackModelsSchema.optional(),
  variant: string2().optional(),
  maxTokens: number2().optional(),
  thinking: OmoThinkingConfigSchema.optional(),
  reasoningEffort: OmoReasoningEffortSchema.optional(),
  textVerbosity: _enum(["low", "medium", "high"]).optional(),
  tools: record(string2(), boolean2()).optional(),
  prompt_append: string2().optional(),
  max_prompt_tokens: number2().int().positive().optional(),
  is_unstable_agent: boolean2().optional(),
  disable: boolean2().optional(),
  warn_unavailable: boolean2().optional()
}).strict();
var OmoCategoryConfigSchema = preprocess((value) => isRecord3(value) ? normalizeLegacyModelFields(value) : value, OmoCategoryConfigObjectSchema);
var OmoCategoriesConfigSchema = record(string2(), OmoCategoryConfigSchema);

// ../../../../omo-engine/omo-config-core/src/schema/computer.ts
var positiveInteger = number2().int().positive();
var nonNegativeInteger = number2().int().nonnegative();
var OmoComputerSettingsLayerSchema = object({
  enabled: boolean2().describe("Experimental: register the computer tool in OmO Native sessions (default: on where the host is supported; false leaves it unregistered)"),
  display: string2().min(1),
  max_width: positiveInteger,
  max_height: positiveInteger,
  screenshot_max_bytes: positiveInteger,
  stop_hotkey: string2().min(1),
  allow_host_relay_only_stop: boolean2(),
  macos_canary: _enum(["session", "off"]),
  audit_log: object({ enabled: boolean2() }).partial().strict(),
  screenshot_gc: object({ enabled: boolean2(), stale_ms: nonNegativeInteger, scan_interval_ms: nonNegativeInteger }).partial().strict(),
  engine_path: string2().min(1),
  cua_adapter: boolean2()
}).partial().strict().describe("Experimental computer use in OmO Native: screenshots, windows, accessibility trees and native mouse and keyboard input. Every key is optional; defaults depend on the host.");
var OmoComputerSettingsSchema = OmoComputerSettingsLayerSchema;

// ../../../../omo-engine/omo-config-core/src/schema/git-master.ts
var OmoGitMasterSettingsShape = {
  commit_footer: union([boolean2(), string2()]),
  include_co_authored_by: boolean2()
};
var OmoGitMasterSettingsLayerSchema = object(OmoGitMasterSettingsShape).partial().strict();
var OmoGitMasterSettingsSchema = OmoGitMasterSettingsLayerSchema.extend({
  commit_footer: union([boolean2(), string2()]).default(false),
  include_co_authored_by: boolean2().default(false)
}).strict();

// ../../../../omo-engine/omo-config-core/src/schema/harness.ts
var HARNESS_IDS = ["codex", "opencode", "omo"];
var OMO_CONFIG_HARNESS_IDS = ["opencode", "native", "codex"];
var OmoHarnessIdSchema = _enum(OMO_CONFIG_HARNESS_IDS);
var OMO_CONFIG_LEGACY_HARNESS_ALIASES = { senpi: "native" };
var OMO_CONFIG_LEGACY_HARNESS_IDS = Object.keys(OMO_CONFIG_LEGACY_HARNESS_ALIASES);

// ../../../../omo-engine/omo-config-core/src/schema/memory.ts
var OmoMemoryReflectionTriggerSchema = object({
  step_count: number2().int().nonnegative().default(25),
  on_compaction: boolean2().default(true)
}).strict();
var OmoMemoryReflectionSchema = object({
  enabled: boolean2().default(true),
  trigger: OmoMemoryReflectionTriggerSchema.default({ step_count: 25, on_compaction: true }),
  merge: _enum(["auto", "integration"]).default("auto"),
  category: string2().min(1).default("quick"),
  timeout_minutes: number2().int().positive().default(15),
  sandbox: _enum(["auto", "required", "off"]).default("auto")
}).strict();
var OmoMemorySyncSchema = object({
  remote: string2().min(1).optional(),
  enabled: boolean2().default(true)
}).strict();
var OmoMemorySearchSchema = object({
  enabled: boolean2().default(true)
}).strict();
var OmoMemoryRecallEventCapsSchema = object({
  tool_args: number2().int().nonnegative().default(400),
  result_head: number2().int().nonnegative().default(600),
  assistant: number2().int().nonnegative().default(1500),
  prompt: number2().int().nonnegative().default(4000)
}).strict();
var OmoMemoryRecallSchema = object({
  enabled: boolean2().default(true),
  max_items: number2().int().min(1).max(5).default(2),
  category: string2().min(1).default("quick"),
  event_caps: OmoMemoryRecallEventCapsSchema.default({ tool_args: 400, result_head: 600, assistant: 1500, prompt: 4000 }),
  sidecar_max_tokens: number2().int().positive().default(48000),
  max_concurrent_wakes: number2().int().positive().default(2),
  tool_budget: number2().int().positive().default(8),
  query_expansion: boolean2().default(false)
}).strict();
var OmoMemoryNudgeSchema = object({
  enabled: boolean2().default(true),
  every_user_turns: number2().int().min(1).default(10)
}).strict();
var OmoMemoryFactsSchema = object({
  enabled: boolean2().default(true),
  debounce_settles: number2().int().min(1).default(4)
}).strict();
var OmoMemoryDreamSchema = object({
  enabled: boolean2().default(true),
  idle_minutes: number2().int().min(0).default(30),
  min_hours_between: number2().int().min(1).default(24),
  shutdown_launch: boolean2().default(true),
  auto_select_max: number2().int().min(1).max(10).default(5),
  auto_select_max_chars: number2().int().min(1e4).default(150000)
}).strict();
var OmoMemoryPeopleSchema = object({
  enabled: boolean2().default(true),
  max_entries: number2().int().min(1).max(100).default(40),
  max_entry_chars: number2().int().min(50).max(500).default(200)
}).strict();
var OmoMemorySoulSchema = object({
  edit_notice: boolean2().default(true)
}).strict();
var OmoMemoryWriteNoticeSchema = object({
  enabled: boolean2().default(true)
}).strict();
var OmoMemoryReflectionTriggerLayerSchema = object({
  step_count: number2().int().nonnegative().optional(),
  on_compaction: boolean2().optional()
}).strict();
var OmoMemoryReflectionLayerSchema = object({
  enabled: boolean2().optional(),
  trigger: OmoMemoryReflectionTriggerLayerSchema.optional(),
  merge: _enum(["auto", "integration"]).optional(),
  category: string2().min(1).optional(),
  timeout_minutes: number2().int().positive().optional(),
  sandbox: _enum(["auto", "required", "off"]).optional()
}).strict();
var OmoMemorySyncLayerSchema = object({
  remote: string2().min(1).optional(),
  enabled: boolean2().optional()
}).strict();
var OmoMemorySearchLayerSchema = object({
  enabled: boolean2().optional()
}).strict();
var OmoMemoryRecallEventCapsLayerSchema = object({
  tool_args: number2().int().nonnegative().optional(),
  result_head: number2().int().nonnegative().optional(),
  assistant: number2().int().nonnegative().optional(),
  prompt: number2().int().nonnegative().optional()
}).strict();
var OmoMemoryRecallLayerSchema = object({
  enabled: boolean2().optional(),
  max_items: number2().int().min(1).max(5).optional(),
  category: string2().min(1).optional(),
  event_caps: OmoMemoryRecallEventCapsLayerSchema.optional(),
  sidecar_max_tokens: number2().int().positive().optional(),
  max_concurrent_wakes: number2().int().positive().optional(),
  tool_budget: number2().int().positive().optional(),
  query_expansion: boolean2().optional()
}).strict();
var OmoMemoryNudgeLayerSchema = object({
  enabled: boolean2().optional(),
  every_user_turns: number2().int().min(1).optional()
}).strict();
var OmoMemoryFactsLayerSchema = object({
  enabled: boolean2().optional(),
  debounce_settles: number2().int().min(1).optional()
}).strict();
var OmoMemoryDreamLayerSchema = object({
  enabled: boolean2().optional(),
  idle_minutes: number2().int().min(0).optional(),
  min_hours_between: number2().int().min(1).optional(),
  shutdown_launch: boolean2().optional(),
  auto_select_max: number2().int().min(1).max(10).optional(),
  auto_select_max_chars: number2().int().min(1e4).optional()
}).strict();
var OmoMemoryPeopleLayerSchema = object({
  enabled: boolean2().optional(),
  max_entries: number2().int().min(1).max(100).optional(),
  max_entry_chars: number2().int().min(50).max(500).optional()
}).strict();
var OmoMemorySoulLayerSchema = object({
  edit_notice: boolean2().optional()
}).strict();
var OmoMemoryWriteNoticeLayerSchema = object({
  enabled: boolean2().optional()
}).strict();
var OmoMemoryProjectionSchema = object({
  max_entries_per_directory: number2().int().min(0).default(40),
  max_bytes: number2().int().min(0).default(24576)
}).strict();
var OmoMemoryProjectionLayerSchema = object({
  max_entries_per_directory: number2().int().min(0).optional(),
  max_bytes: number2().int().min(0).optional()
}).strict();
var OmoMemoryAgentOverridesSchema = object({
  enabled: boolean2().optional(),
  agent: string2().min(1).optional(),
  reflection: OmoMemoryReflectionLayerSchema.optional(),
  nudge: OmoMemoryNudgeLayerSchema.optional(),
  facts: OmoMemoryFactsLayerSchema.optional(),
  dream: OmoMemoryDreamLayerSchema.optional(),
  people: OmoMemoryPeopleLayerSchema.optional(),
  soul: OmoMemorySoulLayerSchema.optional(),
  write_notice: OmoMemoryWriteNoticeLayerSchema.optional(),
  sync: OmoMemorySyncLayerSchema.optional(),
  search: OmoMemorySearchLayerSchema.optional(),
  recall: OmoMemoryRecallLayerSchema.optional(),
  projection: OmoMemoryProjectionLayerSchema.optional(),
  compile_warn_tokens: number2().int().positive().optional()
}).strict();
var OmoMemorySettingsSchema = object({
  enabled: boolean2().default(true),
  agent: string2().min(1).default("auto"),
  reflection: OmoMemoryReflectionSchema.default({
    enabled: true,
    trigger: { step_count: 25, on_compaction: true },
    merge: "auto",
    category: "quick",
    timeout_minutes: 15,
    sandbox: "auto"
  }),
  nudge: OmoMemoryNudgeSchema.default({ enabled: true, every_user_turns: 10 }),
  facts: OmoMemoryFactsSchema.default({ enabled: true, debounce_settles: 4 }),
  dream: OmoMemoryDreamSchema.default({
    enabled: true,
    idle_minutes: 30,
    min_hours_between: 24,
    shutdown_launch: true,
    auto_select_max: 5,
    auto_select_max_chars: 150000
  }),
  people: OmoMemoryPeopleSchema.default({ enabled: true, max_entries: 40, max_entry_chars: 200 }),
  soul: OmoMemorySoulSchema.default({ edit_notice: true }),
  write_notice: OmoMemoryWriteNoticeSchema.default({ enabled: true }),
  sync: OmoMemorySyncSchema.default({ enabled: true }),
  search: OmoMemorySearchSchema.default({ enabled: true }),
  recall: OmoMemoryRecallSchema.default({
    enabled: true,
    max_items: 2,
    category: "quick",
    event_caps: { tool_args: 400, result_head: 600, assistant: 1500, prompt: 4000 },
    sidecar_max_tokens: 48000,
    max_concurrent_wakes: 2,
    tool_budget: 8,
    query_expansion: false
  }),
  projection: OmoMemoryProjectionSchema.default({ max_entries_per_directory: 40, max_bytes: 24576 }),
  compile_warn_tokens: number2().int().positive().default(30000),
  agents: record(string2(), OmoMemoryAgentOverridesSchema).default({})
}).strict();
var OmoMemorySettingsLayerSchema = object({
  enabled: boolean2().optional(),
  agent: string2().min(1).optional(),
  reflection: OmoMemoryReflectionLayerSchema.optional(),
  nudge: OmoMemoryNudgeLayerSchema.optional(),
  facts: OmoMemoryFactsLayerSchema.optional(),
  dream: OmoMemoryDreamLayerSchema.optional(),
  people: OmoMemoryPeopleLayerSchema.optional(),
  soul: OmoMemorySoulLayerSchema.optional(),
  write_notice: OmoMemoryWriteNoticeLayerSchema.optional(),
  sync: OmoMemorySyncLayerSchema.optional(),
  search: OmoMemorySearchLayerSchema.optional(),
  recall: OmoMemoryRecallLayerSchema.optional(),
  projection: OmoMemoryProjectionLayerSchema.optional(),
  compile_warn_tokens: number2().int().positive().optional(),
  agents: record(string2(), OmoMemoryAgentOverridesSchema).optional()
}).strict();

// ../../../../omo-engine/omo-config-core/src/schema/model-catalog.ts
function isRecord4(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
var OmoModelCatalogEntryInputSchema = object({
  model: string2(),
  reasoning: OmoReasoningSchema.optional(),
  variant: string2().optional(),
  reasoningEffort: OmoReasoningEffortSchema.optional()
}).strict();
var OmoModelCatalogEntrySchema = preprocess((value) => isRecord4(value) ? normalizeLegacyModelFields(value) : value, OmoModelCatalogEntryInputSchema);
var OmoModelCatalogSchema = record(string2(), OmoModelCatalogEntrySchema);
var OmoModelCatalogEntryLayerInputSchema = OmoModelCatalogEntryInputSchema.partial();
var OmoModelCatalogEntryLayerSchema = preprocess((value) => isRecord4(value) ? normalizeLegacyModelFields(value) : value, OmoModelCatalogEntryLayerInputSchema);
var OmoModelCatalogLayerSchema = record(string2(), OmoModelCatalogEntryLayerSchema);

// ../../../../omo-engine/omo-config-core/src/schema/model-profile.ts
function isRecord5(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
var OmoModelProfileInputSchema = object({
  display_name: string2().optional(),
  family: _enum(["daily", "geeky"]).optional(),
  tier: _enum(["normal", "heavy"]).optional(),
  models: array(union([string2(), OmoFallbackModelObjectSchema])).optional()
}).strict();
var OmoModelProfileSchema = preprocess((value) => isRecord5(value) ? normalizeLegacyModelFields(value) : value, OmoModelProfileInputSchema);
var OmoModelProfilesSchema = record(string2(), OmoModelProfileSchema);
var OmoModelProfileLayerInputSchema = OmoModelProfileInputSchema.partial();
var OmoModelProfileLayerSchema = preprocess((value) => isRecord5(value) ? normalizeLegacyModelFields(value) : value, OmoModelProfileLayerInputSchema);
var OmoModelProfilesLayerSchema = record(string2(), OmoModelProfileLayerSchema);

// ../../../../omo-engine/omo-config-core/src/schema/task.ts
import { availableParallelism } from "node:os";
var DEFAULT_RESIDENCY_MAX_CHILDREN = "unlimited";
var ResidencyMaxChildrenInputSchema = union([number2().int().nonnegative(), literal("unlimited")]);
var OmoTaskWaitSchema = object({
  min_ms: number2().int().positive().default(5000),
  default_ms: number2().int().positive().default(60000),
  max_ms: number2().int().positive().default(600000)
}).strict();
var OmoTaskTeamSettingsSchema = object({
  max_members: number2().int().min(1).max(8).default(8),
  max_parallel_members: number2().int().min(1).max(8).default(4),
  max_wall_clock_minutes: number2().int().positive().default(120)
}).strict();
var OmoTaskWarningsSchema = object({
  unavailable_categories: boolean2().default(true)
}).strict();
var IsolationBackendKindSchema = _enum([
  "auto",
  "apfs",
  "btrfs",
  "zfs",
  "reflink",
  "overlayfs",
  "block-clone",
  "rcopy"
]);
var OmoTaskIsolationSchema = object({
  enabled: boolean2().default(false),
  backend: IsolationBackendKindSchema.default("auto"),
  apply: boolean2().default(true),
  merge: _enum(["patch", "branch"]).default("patch"),
  commits: _enum(["generic", "ai"]).default("generic")
}).strict();
var isolationDefaults = OmoTaskIsolationSchema.parse({});
var OmoTaskIsolationLayerSchema = object({
  enabled: boolean2().optional(),
  backend: IsolationBackendKindSchema.optional(),
  apply: boolean2().optional(),
  merge: _enum(["patch", "branch"]).optional(),
  commits: _enum(["generic", "ai"]).optional()
}).strict();
var OmoTaskDagSettingsSchema = object({
  max_nodes_per_run: number2().int().positive().default(64),
  max_runs_per_session: number2().int().positive().default(16),
  subscriber_ring: number2().int().positive().default(1000),
  heartbeat_ms: number2().int().positive().default(15000),
  history_default_limit: number2().int().positive().default(256),
  history_max_limit: number2().int().positive().default(1000),
  retention_days: number2().int().positive().default(7),
  max_prompt_bytes: number2().int().positive().default(262144)
}).strict();
var OmoTaskSettingsSchema = object({
  isolation: OmoTaskIsolationSchema.default(isolationDefaults),
  default_execution_mode: _enum(["auto", "in-process", "process"]).default("auto"),
  process_runner: _enum(["host", "child-process"]).default("host"),
  host_engine_policy: _enum(["upgrade", "fallback"]).default("upgrade"),
  host_idle_exit_ms: number2().int().positive().optional(),
  host_shard_prewarm: _enum(["off", "first-turn", "session-start"]).default("first-turn"),
  default_concurrency: number2().int().nonnegative().default(5),
  global_concurrency: number2().int().nonnegative().default(8),
  provider_concurrency: record(string2(), number2().int().nonnegative()).optional(),
  model_concurrency: record(string2(), number2().int().nonnegative()).optional(),
  max_depth: number2().int().nonnegative().default(1),
  residency_max_children: ResidencyMaxChildrenInputSchema.default(DEFAULT_RESIDENCY_MAX_CHILDREN),
  resident_idle_timeout_ms: number2().int().positive().max(Number.MAX_SAFE_INTEGER).default(900000),
  ttl_ms: number2().int().positive().default(86400000),
  state_dir: string2().optional(),
  reattach_on_reconcile: boolean2().optional(),
  resume_children: boolean2().default(true),
  warnings: OmoTaskWarningsSchema.default({ unavailable_categories: true }),
  wait: OmoTaskWaitSchema.default({ min_ms: 5000, default_ms: 60000, max_ms: 600000 }),
  team: OmoTaskTeamSettingsSchema.default({
    max_members: 8,
    max_parallel_members: 4,
    max_wall_clock_minutes: 120
  }),
  dag: OmoTaskDagSettingsSchema.optional()
}).strict();
var OmoTaskDagSettingsLayerSchema = object({
  max_nodes_per_run: number2().int().positive().optional(),
  max_runs_per_session: number2().int().positive().optional(),
  subscriber_ring: number2().int().positive().optional(),
  heartbeat_ms: number2().int().positive().optional(),
  history_default_limit: number2().int().positive().optional(),
  history_max_limit: number2().int().positive().optional(),
  retention_days: number2().int().positive().optional(),
  max_prompt_bytes: number2().int().positive().optional()
}).strict();
var OmoTaskWaitLayerSchema = object({
  min_ms: number2().int().positive().optional(),
  default_ms: number2().int().positive().optional(),
  max_ms: number2().int().positive().optional()
}).strict();
var OmoTaskTeamSettingsLayerSchema = object({
  max_members: number2().int().min(1).max(8).optional(),
  max_parallel_members: number2().int().min(1).max(8).optional(),
  max_wall_clock_minutes: number2().int().positive().optional()
}).strict();
var OmoTaskWarningsLayerSchema = object({
  unavailable_categories: boolean2().optional()
}).strict();
var OmoTaskSettingsLayerSchema = object({
  isolation: OmoTaskIsolationLayerSchema.optional(),
  default_execution_mode: _enum(["auto", "in-process", "process"]).optional(),
  process_runner: _enum(["host", "child-process"]).optional(),
  host_engine_policy: _enum(["upgrade", "fallback"]).optional(),
  host_idle_exit_ms: number2().int().positive().optional(),
  host_shard_prewarm: _enum(["off", "first-turn", "session-start"]).optional(),
  default_concurrency: number2().int().nonnegative().optional(),
  global_concurrency: number2().int().nonnegative().optional(),
  provider_concurrency: record(string2(), number2().int().nonnegative()).optional(),
  model_concurrency: record(string2(), number2().int().nonnegative()).optional(),
  max_depth: number2().int().nonnegative().optional(),
  residency_max_children: ResidencyMaxChildrenInputSchema.optional(),
  resident_idle_timeout_ms: number2().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  ttl_ms: number2().int().positive().optional(),
  state_dir: string2().optional(),
  reattach_on_reconcile: boolean2().optional(),
  resume_children: boolean2().optional(),
  warnings: OmoTaskWarningsLayerSchema.optional(),
  wait: OmoTaskWaitLayerSchema.optional(),
  team: OmoTaskTeamSettingsLayerSchema.optional(),
  dag: OmoTaskDagSettingsLayerSchema.optional()
}).strict();
function resolveOmoTaskSettings(input, resolveParallelism = availableParallelism) {
  const record2 = record(string2(), unknown()).parse(input);
  return OmoTaskSettingsSchema.parse({
    ...record2,
    residency_max_children: record2["residency_max_children"] ?? DEFAULT_RESIDENCY_MAX_CHILDREN,
    global_concurrency: record2["global_concurrency"] ?? Math.max(8, resolveParallelism() * 2)
  });
}

// ../../../../omo-engine/omo-config-core/src/schema/team.ts
var OmoTeamMemberBaseSchema = object({
  name: string2().min(1).regex(/^[a-z0-9-]+$/),
  cwd: string2().optional(),
  worktreePath: string2().optional(),
  subscriptions: array(string2()).optional(),
  backendType: _enum(["in-process", "tmux"]).default("in-process"),
  color: string2().optional(),
  isActive: boolean2().default(true)
}).strict();
var OmoTeamCategoryMemberSchema = OmoTeamMemberBaseSchema.extend({
  kind: literal("category"),
  category: string2().min(1),
  prompt: string2().min(1)
});
var OmoTeamSubagentMemberSchema = OmoTeamMemberBaseSchema.extend({
  kind: literal("subagent_type"),
  subagent_type: string2().min(1),
  prompt: string2().optional()
});
var OmoTeamMemberSchema = discriminatedUnion("kind", [
  OmoTeamCategoryMemberSchema,
  OmoTeamSubagentMemberSchema
]);
var OmoTeamSpecBaseSchema = object({
  version: literal(1).default(1),
  name: string2().min(1).regex(/^[a-z0-9-]+$/).optional(),
  description: string2().optional(),
  createdAt: number2().int().positive().optional(),
  leadAgentId: string2().optional(),
  teamAllowedPaths: array(string2()).optional(),
  sessionPermission: string2().optional(),
  members: array(OmoTeamMemberSchema).min(1).max(8)
}).strict();
var OmoTeamSpecSchema = OmoTeamSpecBaseSchema.superRefine((teamSpec, ctx) => {
  if (teamSpec.leadAgentId === undefined && teamSpec.members.length > 1) {
    ctx.addIssue({
      code: "custom",
      message: "leadAgentId required when a team has multiple members",
      path: ["leadAgentId"]
    });
  }
});
var OmoTeamSpecLayerSchema = OmoTeamSpecBaseSchema.partial();
var OmoTeamsConfigSchema = record(string2(), OmoTeamSpecSchema);
var OmoTeamsConfigLayerSchema = record(string2(), OmoTeamSpecLayerSchema);

// ../../../../omo-engine/omo-config-core/src/schema/telemetry.ts
var OmoTelemetrySettingsShape = {
  enabled: boolean2()
};
var OmoTelemetrySettingsLayerSchema = object(OmoTelemetrySettingsShape).partial().strict();
var OmoTelemetrySettingsSchema = OmoTelemetrySettingsLayerSchema.extend({
  enabled: boolean2().default(true)
}).strict();

// ../../../../omo-engine/omo-config-core/src/schema/format-on-mutation.ts
var mode = _enum(["off", "best-effort", "required"]);
var languages = record(string2(), boolean2()).optional();
var OmoFormatOnMutationLayerSchema = object({
  mode: mode.optional(),
  languages,
  maxFileBytes: number2().int().positive().optional(),
  timeoutMs: number2().int().positive().optional()
}).strict();
var OmoFormatOnMutationSchema = OmoFormatOnMutationLayerSchema.extend({
  mode: mode.default("best-effort"),
  maxFileBytes: number2().int().positive().default(1048576),
  timeoutMs: number2().int().positive().default(3000)
}).strict();

// ../../../../omo-engine/omo-config-core/src/schema/gateway.ts
var OmoGatewaySectionSchema = record(string2(), unknown()).describe("Chat-surface gateway settings, owned and validated by a separately installed gateway package. omo accepts the key and never reads it.");

// ../../../../omo-engine/omo-config-core/src/schema/config.ts
var OmoOpenCodeHarnessConfigSchema = record(string2(), unknown());
var OmoDisabledSkillsSchema = array(string2());
var OmoTypedHarnessConfigSchema = object({
  formatOnMutation: OmoFormatOnMutationLayerSchema.optional(),
  gateway: OmoGatewaySectionSchema.optional(),
  categories: OmoCategoriesConfigSchema.optional(),
  agents: OmoAgentsConfigSchema.optional(),
  git_master: OmoGitMasterSettingsLayerSchema.optional(),
  task: OmoTaskSettingsLayerSchema.optional(),
  teams: OmoTeamsConfigLayerSchema.optional(),
  models: OmoModelCatalogLayerSchema.optional(),
  model_profiles: OmoModelProfilesLayerSchema.optional(),
  model_profile: string2().optional(),
  memory: OmoMemorySettingsLayerSchema.optional(),
  telemetry: OmoTelemetrySettingsLayerSchema.optional(),
  computer: OmoComputerSettingsLayerSchema.optional(),
  disabled_skills: OmoDisabledSkillsSchema.optional()
}).strict();
var OmoConfigProfileSchema = object({
  formatOnMutation: OmoFormatOnMutationLayerSchema.optional(),
  categories: OmoCategoriesConfigSchema.optional(),
  agents: OmoAgentsConfigSchema.optional(),
  git_master: OmoGitMasterSettingsLayerSchema.optional(),
  task: OmoTaskSettingsLayerSchema.optional(),
  teams: OmoTeamsConfigLayerSchema.optional(),
  models: OmoModelCatalogLayerSchema.optional(),
  model_profiles: OmoModelProfilesLayerSchema.optional(),
  model_profile: string2().optional(),
  memory: OmoMemorySettingsLayerSchema.optional(),
  telemetry: OmoTelemetrySettingsLayerSchema.optional(),
  computer: OmoComputerSettingsLayerSchema.optional(),
  disabled_skills: OmoDisabledSkillsSchema.optional(),
  "[opencode]": OmoOpenCodeHarnessConfigSchema.optional(),
  "[native]": OmoTypedHarnessConfigSchema.optional(),
  "[senpi]": OmoTypedHarnessConfigSchema.optional(),
  "[codex]": OmoTypedHarnessConfigSchema.optional()
}).strict();
var OmoConfigSchema = object({
  formatOnMutation: OmoFormatOnMutationSchema.optional(),
  gateway: OmoGatewaySectionSchema.optional(),
  $schema: string2().optional(),
  categories: OmoCategoriesConfigSchema.optional(),
  agents: OmoAgentsConfigSchema.optional(),
  git_master: OmoGitMasterSettingsSchema.optional(),
  task: OmoTaskSettingsSchema.optional(),
  teams: OmoTeamsConfigSchema.optional(),
  models: OmoModelCatalogSchema.optional(),
  model_profiles: OmoModelProfilesSchema.optional(),
  model_profile: string2().optional(),
  memory: OmoMemorySettingsSchema.optional(),
  telemetry: OmoTelemetrySettingsSchema.optional(),
  computer: OmoComputerSettingsSchema.optional(),
  disabled_skills: OmoDisabledSkillsSchema.optional(),
  "[opencode]": OmoOpenCodeHarnessConfigSchema.optional(),
  "[native]": OmoTypedHarnessConfigSchema.optional(),
  "[senpi]": OmoTypedHarnessConfigSchema.optional(),
  "[codex]": OmoTypedHarnessConfigSchema.optional(),
  profiles: record(string2(), OmoConfigProfileSchema).default({}),
  _migrations: array(string2()).optional(),
  legacy_migrations: record(string2(), unknown()).optional()
}).strict();
var OmoConfigLayerSchema = object({
  formatOnMutation: OmoFormatOnMutationLayerSchema.optional(),
  gateway: OmoGatewaySectionSchema.optional(),
  $schema: string2().optional(),
  categories: OmoCategoriesConfigSchema.optional(),
  agents: OmoAgentsConfigSchema.optional(),
  git_master: OmoGitMasterSettingsLayerSchema.optional(),
  task: OmoTaskSettingsLayerSchema.optional(),
  teams: OmoTeamsConfigLayerSchema.optional(),
  models: OmoModelCatalogLayerSchema.optional(),
  model_profiles: OmoModelProfilesLayerSchema.optional(),
  model_profile: string2().optional(),
  memory: OmoMemorySettingsLayerSchema.optional(),
  telemetry: OmoTelemetrySettingsLayerSchema.optional(),
  computer: OmoComputerSettingsLayerSchema.optional(),
  disabled_skills: OmoDisabledSkillsSchema.optional(),
  "[opencode]": OmoOpenCodeHarnessConfigSchema.optional(),
  "[native]": OmoTypedHarnessConfigSchema.optional(),
  "[senpi]": OmoTypedHarnessConfigSchema.optional(),
  "[codex]": OmoTypedHarnessConfigSchema.optional(),
  profiles: record(string2(), OmoConfigProfileSchema).optional(),
  _migrations: array(string2()).optional(),
  legacy_migrations: record(string2(), unknown()).optional()
}).strict();

// ../../../../omo-engine/omo-config-core/src/schema/legacy-category-names.ts
var LEGACY_CATEGORY_NAME_ALIASES = { deep: "deep-low" };
function canonicalCategoryName(name) {
  return Object.hasOwn(LEGACY_CATEGORY_NAME_ALIASES, name) ? LEGACY_CATEGORY_NAME_ALIASES[name] : name;
}
function isRecord6(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function joinPath(path, segment) {
  return [...path, segment].join(".");
}
function canonicalizeCategoriesRecord(categories, path, renames) {
  const result = {};
  for (const [name, definition] of Object.entries(categories)) {
    const canonical = canonicalCategoryName(name);
    if (canonical === name) {
      result[name] = definition;
      continue;
    }
    const dropped = Object.hasOwn(categories, canonical);
    renames.push({ canonical, dropped, legacy: name, path: joinPath(path, name) });
    if (!dropped)
      result[canonical] = definition;
  }
  return result;
}
function canonicalizeValue(value, path, renames) {
  if (Array.isArray(value)) {
    return value.map((entry, index) => canonicalizeValue(entry, [...path, String(index)], renames));
  }
  if (!isRecord6(value))
    return value;
  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === "categories" && isRecord6(entry)) {
      result[key] = canonicalizeCategoriesRecord(entry, [...path, key], renames);
      continue;
    }
    if (key === "category" && typeof entry === "string") {
      const canonical = canonicalCategoryName(entry);
      if (canonical !== entry) {
        renames.push({ canonical, dropped: false, legacy: entry, path: joinPath(path, key) });
      }
      result[key] = canonical;
      continue;
    }
    result[key] = canonicalizeValue(entry, [...path, key], renames);
  }
  return result;
}
function canonicalizeLegacyCategoryNames(document) {
  const renames = [];
  const canonicalized = isRecord6(document) ? canonicalizeValue(document, [], renames) : {};
  return { document: canonicalized, renames };
}

// ../../../../omo-engine/omo-config-core/src/schema/legacy-harness-names.ts
function canonicalHarnessName(name) {
  return Object.hasOwn(OMO_CONFIG_LEGACY_HARNESS_ALIASES, name) ? OMO_CONFIG_LEGACY_HARNESS_ALIASES[name] : name;
}
function harnessBlockKey(harness) {
  return `[${harness}]`;
}
function legacyHarnessOfBlockKey(key) {
  if (!key.startsWith("[") || !key.endsWith("]"))
    return;
  const harness = key.slice(1, -1);
  return Object.hasOwn(OMO_CONFIG_LEGACY_HARNESS_ALIASES, harness) ? harness : undefined;
}
function isRecord7(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function canonicalizeBlocksIn(container, path, renames) {
  const result = {};
  for (const [key, value] of Object.entries(container)) {
    const legacyHarness = legacyHarnessOfBlockKey(key);
    if (legacyHarness === undefined) {
      result[key] = value;
      continue;
    }
    const canonical = harnessBlockKey(canonicalHarnessName(legacyHarness));
    const dropped = Object.hasOwn(container, canonical);
    renames.push({ canonical, dropped, legacy: key, path: [...path, key].join(".") });
    if (!dropped)
      result[canonical] = value;
  }
  return result;
}
function canonicalizeLegacyHarnessBlocks(document) {
  if (!isRecord7(document))
    return { document: {}, renames: [] };
  const renames = [];
  const canonicalized = canonicalizeBlocksIn(document, [], renames);
  const profiles = canonicalized["profiles"];
  if (isRecord7(profiles)) {
    const canonicalProfiles = {};
    for (const [name, profile] of Object.entries(profiles)) {
      canonicalProfiles[name] = isRecord7(profile) ? canonicalizeBlocksIn(profile, ["profiles", name], renames) : profile;
    }
    canonicalized["profiles"] = canonicalProfiles;
  }
  return { document: canonicalized, renames };
}

// ../../../../omo-engine/omo-config-core/src/loader/types.ts
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
var MERGED_OMO_CONFIG_PATH = "(merged omo config)";
var DEFAULT_READ_FILE_SYSTEM = {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync
};

// ../../../../omo-engine/omo-config-core/src/loader/diagnostic-lines.ts
function displayOmoConfigPath(path, homeDir) {
  if (path === MERGED_OMO_CONFIG_PATH)
    return "merged config";
  if (homeDir === undefined || homeDir.length === 0)
    return path;
  const slashed = (value) => value.replaceAll("\\", "/");
  const home = slashed(homeDir).replace(/\/+$/, "");
  const file = slashed(path);
  const fold = (value) => /^[A-Za-z]:\//.test(home) ? value.toLowerCase() : value;
  if (fold(file) === fold(home))
    return "~";
  return fold(file).startsWith(`${fold(home)}/`) ? `~${file.slice(home.length)}` : path;
}
function notLoadedReason(diagnostic) {
  switch (diagnostic.kind) {
    case "parse":
      return "JSONC parse error";
    case "read":
      return "unreadable";
    default:
      return diagnostic.issuePaths === undefined || diagnostic.issuePaths.length === 0 ? "invalid config" : `invalid: ${diagnostic.issuePaths.join(", ")}`;
  }
}
function omoConfigDiagnosticLines(diagnostics, options = {}) {
  return diagnostics.flatMap((diagnostic) => {
    const file = displayOmoConfigPath(diagnostic.path, options.homeDir);
    switch (diagnostic.kind) {
      case "invalid-value":
        return (diagnostic.issuePaths ?? []).map((key) => `config: ${file}: ${key} ignored (invalid value)`);
      case "unknown-keys":
        return (diagnostic.issuePaths ?? []).map((key) => `config: ${file}: ${key} ignored (unknown key)`);
      case "parse":
      case "read":
      case "validation":
        return diagnostic.path === MERGED_OMO_CONFIG_PATH ? [`config: ${file}: reset to defaults (${notLoadedReason(diagnostic)})`] : [`config: ${file}: not loaded (${notLoadedReason(diagnostic)})`];
      case "deprecated-keys":
      case "profile":
        return [];
    }
  });
}

// ../../../../../node_modules/.bun/jsonc-parser@3.3.1/node_modules/jsonc-parser/lib/esm/impl/scanner.js
function createScanner(text, ignoreTrivia = false) {
  const len = text.length;
  let pos = 0, value = "", tokenOffset = 0, token = 16, lineNumber = 0, lineStartOffset = 0, tokenLineStartOffset = 0, prevTokenLineStartOffset = 0, scanError = 0;
  function scanHexDigits(count, exact) {
    let digits = 0;
    let value = 0;
    while (digits < count || !exact) {
      let ch = text.charCodeAt(pos);
      if (ch >= 48 && ch <= 57) {
        value = value * 16 + ch - 48;
      } else if (ch >= 65 && ch <= 70) {
        value = value * 16 + ch - 65 + 10;
      } else if (ch >= 97 && ch <= 102) {
        value = value * 16 + ch - 97 + 10;
      } else {
        break;
      }
      pos++;
      digits++;
    }
    if (digits < count) {
      value = -1;
    }
    return value;
  }
  function setPosition(newPosition) {
    pos = newPosition;
    value = "";
    tokenOffset = 0;
    token = 16;
    scanError = 0;
  }
  function scanNumber() {
    let start = pos;
    if (text.charCodeAt(pos) === 48) {
      pos++;
    } else {
      pos++;
      while (pos < text.length && isDigit(text.charCodeAt(pos))) {
        pos++;
      }
    }
    if (pos < text.length && text.charCodeAt(pos) === 46) {
      pos++;
      if (pos < text.length && isDigit(text.charCodeAt(pos))) {
        pos++;
        while (pos < text.length && isDigit(text.charCodeAt(pos))) {
          pos++;
        }
      } else {
        scanError = 3;
        return text.substring(start, pos);
      }
    }
    let end = pos;
    if (pos < text.length && (text.charCodeAt(pos) === 69 || text.charCodeAt(pos) === 101)) {
      pos++;
      if (pos < text.length && text.charCodeAt(pos) === 43 || text.charCodeAt(pos) === 45) {
        pos++;
      }
      if (pos < text.length && isDigit(text.charCodeAt(pos))) {
        pos++;
        while (pos < text.length && isDigit(text.charCodeAt(pos))) {
          pos++;
        }
        end = pos;
      } else {
        scanError = 3;
      }
    }
    return text.substring(start, end);
  }
  function scanString() {
    let result = "", start = pos;
    while (true) {
      if (pos >= len) {
        result += text.substring(start, pos);
        scanError = 2;
        break;
      }
      const ch = text.charCodeAt(pos);
      if (ch === 34) {
        result += text.substring(start, pos);
        pos++;
        break;
      }
      if (ch === 92) {
        result += text.substring(start, pos);
        pos++;
        if (pos >= len) {
          scanError = 2;
          break;
        }
        const ch2 = text.charCodeAt(pos++);
        switch (ch2) {
          case 34:
            result += '"';
            break;
          case 92:
            result += "\\";
            break;
          case 47:
            result += "/";
            break;
          case 98:
            result += "\b";
            break;
          case 102:
            result += "\f";
            break;
          case 110:
            result += `
`;
            break;
          case 114:
            result += "\r";
            break;
          case 116:
            result += "\t";
            break;
          case 117:
            const ch3 = scanHexDigits(4, true);
            if (ch3 >= 0) {
              result += String.fromCharCode(ch3);
            } else {
              scanError = 4;
            }
            break;
          default:
            scanError = 5;
        }
        start = pos;
        continue;
      }
      if (ch >= 0 && ch <= 31) {
        if (isLineBreak(ch)) {
          result += text.substring(start, pos);
          scanError = 2;
          break;
        } else {
          scanError = 6;
        }
      }
      pos++;
    }
    return result;
  }
  function scanNext() {
    value = "";
    scanError = 0;
    tokenOffset = pos;
    lineStartOffset = lineNumber;
    prevTokenLineStartOffset = tokenLineStartOffset;
    if (pos >= len) {
      tokenOffset = len;
      return token = 17;
    }
    let code = text.charCodeAt(pos);
    if (isWhiteSpace(code)) {
      do {
        pos++;
        value += String.fromCharCode(code);
        code = text.charCodeAt(pos);
      } while (isWhiteSpace(code));
      return token = 15;
    }
    if (isLineBreak(code)) {
      pos++;
      value += String.fromCharCode(code);
      if (code === 13 && text.charCodeAt(pos) === 10) {
        pos++;
        value += `
`;
      }
      lineNumber++;
      tokenLineStartOffset = pos;
      return token = 14;
    }
    switch (code) {
      case 123:
        pos++;
        return token = 1;
      case 125:
        pos++;
        return token = 2;
      case 91:
        pos++;
        return token = 3;
      case 93:
        pos++;
        return token = 4;
      case 58:
        pos++;
        return token = 6;
      case 44:
        pos++;
        return token = 5;
      case 34:
        pos++;
        value = scanString();
        return token = 10;
      case 47:
        const start = pos - 1;
        if (text.charCodeAt(pos + 1) === 47) {
          pos += 2;
          while (pos < len) {
            if (isLineBreak(text.charCodeAt(pos))) {
              break;
            }
            pos++;
          }
          value = text.substring(start, pos);
          return token = 12;
        }
        if (text.charCodeAt(pos + 1) === 42) {
          pos += 2;
          const safeLength = len - 1;
          let commentClosed = false;
          while (pos < safeLength) {
            const ch = text.charCodeAt(pos);
            if (ch === 42 && text.charCodeAt(pos + 1) === 47) {
              pos += 2;
              commentClosed = true;
              break;
            }
            pos++;
            if (isLineBreak(ch)) {
              if (ch === 13 && text.charCodeAt(pos) === 10) {
                pos++;
              }
              lineNumber++;
              tokenLineStartOffset = pos;
            }
          }
          if (!commentClosed) {
            pos++;
            scanError = 1;
          }
          value = text.substring(start, pos);
          return token = 13;
        }
        value += String.fromCharCode(code);
        pos++;
        return token = 16;
      case 45:
        value += String.fromCharCode(code);
        pos++;
        if (pos === len || !isDigit(text.charCodeAt(pos))) {
          return token = 16;
        }
      case 48:
      case 49:
      case 50:
      case 51:
      case 52:
      case 53:
      case 54:
      case 55:
      case 56:
      case 57:
        value += scanNumber();
        return token = 11;
      default:
        while (pos < len && isUnknownContentCharacter(code)) {
          pos++;
          code = text.charCodeAt(pos);
        }
        if (tokenOffset !== pos) {
          value = text.substring(tokenOffset, pos);
          switch (value) {
            case "true":
              return token = 8;
            case "false":
              return token = 9;
            case "null":
              return token = 7;
          }
          return token = 16;
        }
        value += String.fromCharCode(code);
        pos++;
        return token = 16;
    }
  }
  function isUnknownContentCharacter(code) {
    if (isWhiteSpace(code) || isLineBreak(code)) {
      return false;
    }
    switch (code) {
      case 125:
      case 93:
      case 123:
      case 91:
      case 34:
      case 58:
      case 44:
      case 47:
        return false;
    }
    return true;
  }
  function scanNextNonTrivia() {
    let result;
    do {
      result = scanNext();
    } while (result >= 12 && result <= 15);
    return result;
  }
  return {
    setPosition,
    getPosition: () => pos,
    scan: ignoreTrivia ? scanNextNonTrivia : scanNext,
    getToken: () => token,
    getTokenValue: () => value,
    getTokenOffset: () => tokenOffset,
    getTokenLength: () => pos - tokenOffset,
    getTokenStartLine: () => lineStartOffset,
    getTokenStartCharacter: () => tokenOffset - prevTokenLineStartOffset,
    getTokenError: () => scanError
  };
}
function isWhiteSpace(ch) {
  return ch === 32 || ch === 9;
}
function isLineBreak(ch) {
  return ch === 10 || ch === 13;
}
function isDigit(ch) {
  return ch >= 48 && ch <= 57;
}
var CharacterCodes;
(function(CharacterCodes) {
  CharacterCodes[CharacterCodes["lineFeed"] = 10] = "lineFeed";
  CharacterCodes[CharacterCodes["carriageReturn"] = 13] = "carriageReturn";
  CharacterCodes[CharacterCodes["space"] = 32] = "space";
  CharacterCodes[CharacterCodes["_0"] = 48] = "_0";
  CharacterCodes[CharacterCodes["_1"] = 49] = "_1";
  CharacterCodes[CharacterCodes["_2"] = 50] = "_2";
  CharacterCodes[CharacterCodes["_3"] = 51] = "_3";
  CharacterCodes[CharacterCodes["_4"] = 52] = "_4";
  CharacterCodes[CharacterCodes["_5"] = 53] = "_5";
  CharacterCodes[CharacterCodes["_6"] = 54] = "_6";
  CharacterCodes[CharacterCodes["_7"] = 55] = "_7";
  CharacterCodes[CharacterCodes["_8"] = 56] = "_8";
  CharacterCodes[CharacterCodes["_9"] = 57] = "_9";
  CharacterCodes[CharacterCodes["a"] = 97] = "a";
  CharacterCodes[CharacterCodes["b"] = 98] = "b";
  CharacterCodes[CharacterCodes["c"] = 99] = "c";
  CharacterCodes[CharacterCodes["d"] = 100] = "d";
  CharacterCodes[CharacterCodes["e"] = 101] = "e";
  CharacterCodes[CharacterCodes["f"] = 102] = "f";
  CharacterCodes[CharacterCodes["g"] = 103] = "g";
  CharacterCodes[CharacterCodes["h"] = 104] = "h";
  CharacterCodes[CharacterCodes["i"] = 105] = "i";
  CharacterCodes[CharacterCodes["j"] = 106] = "j";
  CharacterCodes[CharacterCodes["k"] = 107] = "k";
  CharacterCodes[CharacterCodes["l"] = 108] = "l";
  CharacterCodes[CharacterCodes["m"] = 109] = "m";
  CharacterCodes[CharacterCodes["n"] = 110] = "n";
  CharacterCodes[CharacterCodes["o"] = 111] = "o";
  CharacterCodes[CharacterCodes["p"] = 112] = "p";
  CharacterCodes[CharacterCodes["q"] = 113] = "q";
  CharacterCodes[CharacterCodes["r"] = 114] = "r";
  CharacterCodes[CharacterCodes["s"] = 115] = "s";
  CharacterCodes[CharacterCodes["t"] = 116] = "t";
  CharacterCodes[CharacterCodes["u"] = 117] = "u";
  CharacterCodes[CharacterCodes["v"] = 118] = "v";
  CharacterCodes[CharacterCodes["w"] = 119] = "w";
  CharacterCodes[CharacterCodes["x"] = 120] = "x";
  CharacterCodes[CharacterCodes["y"] = 121] = "y";
  CharacterCodes[CharacterCodes["z"] = 122] = "z";
  CharacterCodes[CharacterCodes["A"] = 65] = "A";
  CharacterCodes[CharacterCodes["B"] = 66] = "B";
  CharacterCodes[CharacterCodes["C"] = 67] = "C";
  CharacterCodes[CharacterCodes["D"] = 68] = "D";
  CharacterCodes[CharacterCodes["E"] = 69] = "E";
  CharacterCodes[CharacterCodes["F"] = 70] = "F";
  CharacterCodes[CharacterCodes["G"] = 71] = "G";
  CharacterCodes[CharacterCodes["H"] = 72] = "H";
  CharacterCodes[CharacterCodes["I"] = 73] = "I";
  CharacterCodes[CharacterCodes["J"] = 74] = "J";
  CharacterCodes[CharacterCodes["K"] = 75] = "K";
  CharacterCodes[CharacterCodes["L"] = 76] = "L";
  CharacterCodes[CharacterCodes["M"] = 77] = "M";
  CharacterCodes[CharacterCodes["N"] = 78] = "N";
  CharacterCodes[CharacterCodes["O"] = 79] = "O";
  CharacterCodes[CharacterCodes["P"] = 80] = "P";
  CharacterCodes[CharacterCodes["Q"] = 81] = "Q";
  CharacterCodes[CharacterCodes["R"] = 82] = "R";
  CharacterCodes[CharacterCodes["S"] = 83] = "S";
  CharacterCodes[CharacterCodes["T"] = 84] = "T";
  CharacterCodes[CharacterCodes["U"] = 85] = "U";
  CharacterCodes[CharacterCodes["V"] = 86] = "V";
  CharacterCodes[CharacterCodes["W"] = 87] = "W";
  CharacterCodes[CharacterCodes["X"] = 88] = "X";
  CharacterCodes[CharacterCodes["Y"] = 89] = "Y";
  CharacterCodes[CharacterCodes["Z"] = 90] = "Z";
  CharacterCodes[CharacterCodes["asterisk"] = 42] = "asterisk";
  CharacterCodes[CharacterCodes["backslash"] = 92] = "backslash";
  CharacterCodes[CharacterCodes["closeBrace"] = 125] = "closeBrace";
  CharacterCodes[CharacterCodes["closeBracket"] = 93] = "closeBracket";
  CharacterCodes[CharacterCodes["colon"] = 58] = "colon";
  CharacterCodes[CharacterCodes["comma"] = 44] = "comma";
  CharacterCodes[CharacterCodes["dot"] = 46] = "dot";
  CharacterCodes[CharacterCodes["doubleQuote"] = 34] = "doubleQuote";
  CharacterCodes[CharacterCodes["minus"] = 45] = "minus";
  CharacterCodes[CharacterCodes["openBrace"] = 123] = "openBrace";
  CharacterCodes[CharacterCodes["openBracket"] = 91] = "openBracket";
  CharacterCodes[CharacterCodes["plus"] = 43] = "plus";
  CharacterCodes[CharacterCodes["slash"] = 47] = "slash";
  CharacterCodes[CharacterCodes["formFeed"] = 12] = "formFeed";
  CharacterCodes[CharacterCodes["tab"] = 9] = "tab";
})(CharacterCodes || (CharacterCodes = {}));

// ../../../../../node_modules/.bun/jsonc-parser@3.3.1/node_modules/jsonc-parser/lib/esm/impl/string-intern.js
var cachedSpaces = new Array(20).fill(0).map((_, index) => {
  return " ".repeat(index);
});
var maxCachedValues = 200;
var cachedBreakLinesWithSpaces = {
  " ": {
    "\n": new Array(maxCachedValues).fill(0).map((_, index) => {
      return `
` + " ".repeat(index);
    }),
    "\r": new Array(maxCachedValues).fill(0).map((_, index) => {
      return "\r" + " ".repeat(index);
    }),
    "\r\n": new Array(maxCachedValues).fill(0).map((_, index) => {
      return `\r
` + " ".repeat(index);
    })
  },
  "\t": {
    "\n": new Array(maxCachedValues).fill(0).map((_, index) => {
      return `
` + "\t".repeat(index);
    }),
    "\r": new Array(maxCachedValues).fill(0).map((_, index) => {
      return "\r" + "\t".repeat(index);
    }),
    "\r\n": new Array(maxCachedValues).fill(0).map((_, index) => {
      return `\r
` + "\t".repeat(index);
    })
  }
};
var supportedEols = [`
`, "\r", `\r
`];

// ../../../../../node_modules/.bun/jsonc-parser@3.3.1/node_modules/jsonc-parser/lib/esm/impl/format.js
function format(documentText, range, options) {
  let initialIndentLevel;
  let formatText;
  let formatTextStart;
  let rangeStart;
  let rangeEnd;
  if (range) {
    rangeStart = range.offset;
    rangeEnd = rangeStart + range.length;
    formatTextStart = rangeStart;
    while (formatTextStart > 0 && !isEOL(documentText, formatTextStart - 1)) {
      formatTextStart--;
    }
    let endOffset = rangeEnd;
    while (endOffset < documentText.length && !isEOL(documentText, endOffset)) {
      endOffset++;
    }
    formatText = documentText.substring(formatTextStart, endOffset);
    initialIndentLevel = computeIndentLevel(formatText, options);
  } else {
    formatText = documentText;
    initialIndentLevel = 0;
    formatTextStart = 0;
    rangeStart = 0;
    rangeEnd = documentText.length;
  }
  const eol = getEOL(options, documentText);
  const eolFastPathSupported = supportedEols.includes(eol);
  let numberLineBreaks = 0;
  let indentLevel = 0;
  let indentValue;
  if (options.insertSpaces) {
    indentValue = cachedSpaces[options.tabSize || 4] ?? repeat(cachedSpaces[1], options.tabSize || 4);
  } else {
    indentValue = "\t";
  }
  const indentType = indentValue === "\t" ? "\t" : " ";
  let scanner = createScanner(formatText, false);
  let hasError = false;
  function newLinesAndIndent() {
    if (numberLineBreaks > 1) {
      return repeat(eol, numberLineBreaks) + repeat(indentValue, initialIndentLevel + indentLevel);
    }
    const amountOfSpaces = indentValue.length * (initialIndentLevel + indentLevel);
    if (!eolFastPathSupported || amountOfSpaces > cachedBreakLinesWithSpaces[indentType][eol].length) {
      return eol + repeat(indentValue, initialIndentLevel + indentLevel);
    }
    if (amountOfSpaces <= 0) {
      return eol;
    }
    return cachedBreakLinesWithSpaces[indentType][eol][amountOfSpaces];
  }
  function scanNext() {
    let token = scanner.scan();
    numberLineBreaks = 0;
    while (token === 15 || token === 14) {
      if (token === 14 && options.keepLines) {
        numberLineBreaks += 1;
      } else if (token === 14) {
        numberLineBreaks = 1;
      }
      token = scanner.scan();
    }
    hasError = token === 16 || scanner.getTokenError() !== 0;
    return token;
  }
  const editOperations = [];
  function addEdit(text, startOffset, endOffset) {
    if (!hasError && (!range || startOffset < rangeEnd && endOffset > rangeStart) && documentText.substring(startOffset, endOffset) !== text) {
      editOperations.push({ offset: startOffset, length: endOffset - startOffset, content: text });
    }
  }
  let firstToken = scanNext();
  if (options.keepLines && numberLineBreaks > 0) {
    addEdit(repeat(eol, numberLineBreaks), 0, 0);
  }
  if (firstToken !== 17) {
    let firstTokenStart = scanner.getTokenOffset() + formatTextStart;
    let initialIndent = indentValue.length * initialIndentLevel < 20 && options.insertSpaces ? cachedSpaces[indentValue.length * initialIndentLevel] : repeat(indentValue, initialIndentLevel);
    addEdit(initialIndent, formatTextStart, firstTokenStart);
  }
  while (firstToken !== 17) {
    let firstTokenEnd = scanner.getTokenOffset() + scanner.getTokenLength() + formatTextStart;
    let secondToken = scanNext();
    let replaceContent = "";
    let needsLineBreak = false;
    while (numberLineBreaks === 0 && (secondToken === 12 || secondToken === 13)) {
      let commentTokenStart = scanner.getTokenOffset() + formatTextStart;
      addEdit(cachedSpaces[1], firstTokenEnd, commentTokenStart);
      firstTokenEnd = scanner.getTokenOffset() + scanner.getTokenLength() + formatTextStart;
      needsLineBreak = secondToken === 12;
      replaceContent = needsLineBreak ? newLinesAndIndent() : "";
      secondToken = scanNext();
    }
    if (secondToken === 2) {
      if (firstToken !== 1) {
        indentLevel--;
      }
      if (options.keepLines && numberLineBreaks > 0 || !options.keepLines && firstToken !== 1) {
        replaceContent = newLinesAndIndent();
      } else if (options.keepLines) {
        replaceContent = cachedSpaces[1];
      }
    } else if (secondToken === 4) {
      if (firstToken !== 3) {
        indentLevel--;
      }
      if (options.keepLines && numberLineBreaks > 0 || !options.keepLines && firstToken !== 3) {
        replaceContent = newLinesAndIndent();
      } else if (options.keepLines) {
        replaceContent = cachedSpaces[1];
      }
    } else {
      switch (firstToken) {
        case 3:
        case 1:
          indentLevel++;
          if (options.keepLines && numberLineBreaks > 0 || !options.keepLines) {
            replaceContent = newLinesAndIndent();
          } else {
            replaceContent = cachedSpaces[1];
          }
          break;
        case 5:
          if (options.keepLines && numberLineBreaks > 0 || !options.keepLines) {
            replaceContent = newLinesAndIndent();
          } else {
            replaceContent = cachedSpaces[1];
          }
          break;
        case 12:
          replaceContent = newLinesAndIndent();
          break;
        case 13:
          if (numberLineBreaks > 0) {
            replaceContent = newLinesAndIndent();
          } else if (!needsLineBreak) {
            replaceContent = cachedSpaces[1];
          }
          break;
        case 6:
          if (options.keepLines && numberLineBreaks > 0) {
            replaceContent = newLinesAndIndent();
          } else if (!needsLineBreak) {
            replaceContent = cachedSpaces[1];
          }
          break;
        case 10:
          if (options.keepLines && numberLineBreaks > 0) {
            replaceContent = newLinesAndIndent();
          } else if (secondToken === 6 && !needsLineBreak) {
            replaceContent = "";
          }
          break;
        case 7:
        case 8:
        case 9:
        case 11:
        case 2:
        case 4:
          if (options.keepLines && numberLineBreaks > 0) {
            replaceContent = newLinesAndIndent();
          } else {
            if ((secondToken === 12 || secondToken === 13) && !needsLineBreak) {
              replaceContent = cachedSpaces[1];
            } else if (secondToken !== 5 && secondToken !== 17) {
              hasError = true;
            }
          }
          break;
        case 16:
          hasError = true;
          break;
      }
      if (numberLineBreaks > 0 && (secondToken === 12 || secondToken === 13)) {
        replaceContent = newLinesAndIndent();
      }
    }
    if (secondToken === 17) {
      if (options.keepLines && numberLineBreaks > 0) {
        replaceContent = newLinesAndIndent();
      } else {
        replaceContent = options.insertFinalNewline ? eol : "";
      }
    }
    const secondTokenStart = scanner.getTokenOffset() + formatTextStart;
    addEdit(replaceContent, firstTokenEnd, secondTokenStart);
    firstToken = secondToken;
  }
  return editOperations;
}
function repeat(s, count) {
  let result = "";
  for (let i = 0;i < count; i++) {
    result += s;
  }
  return result;
}
function computeIndentLevel(content, options) {
  let i = 0;
  let nChars = 0;
  const tabSize = options.tabSize || 4;
  while (i < content.length) {
    let ch = content.charAt(i);
    if (ch === cachedSpaces[1]) {
      nChars++;
    } else if (ch === "\t") {
      nChars += tabSize;
    } else {
      break;
    }
    i++;
  }
  return Math.floor(nChars / tabSize);
}
function getEOL(options, text) {
  for (let i = 0;i < text.length; i++) {
    const ch = text.charAt(i);
    if (ch === "\r") {
      if (i + 1 < text.length && text.charAt(i + 1) === `
`) {
        return `\r
`;
      }
      return "\r";
    } else if (ch === `
`) {
      return `
`;
    }
  }
  return options && options.eol || `
`;
}
function isEOL(text, offset) {
  return `\r
`.indexOf(text.charAt(offset)) !== -1;
}

// ../../../../../node_modules/.bun/jsonc-parser@3.3.1/node_modules/jsonc-parser/lib/esm/impl/parser.js
var ParseOptions;
(function(ParseOptions) {
  ParseOptions.DEFAULT = {
    allowTrailingComma: false
  };
})(ParseOptions || (ParseOptions = {}));
function parse3(text, errors = [], options = ParseOptions.DEFAULT) {
  let currentProperty = null;
  let currentParent = [];
  const previousParents = [];
  function onValue(value) {
    if (Array.isArray(currentParent)) {
      currentParent.push(value);
    } else if (currentProperty !== null) {
      currentParent[currentProperty] = value;
    }
  }
  const visitor = {
    onObjectBegin: () => {
      const object = {};
      onValue(object);
      previousParents.push(currentParent);
      currentParent = object;
      currentProperty = null;
    },
    onObjectProperty: (name) => {
      currentProperty = name;
    },
    onObjectEnd: () => {
      currentParent = previousParents.pop();
    },
    onArrayBegin: () => {
      const array = [];
      onValue(array);
      previousParents.push(currentParent);
      currentParent = array;
      currentProperty = null;
    },
    onArrayEnd: () => {
      currentParent = previousParents.pop();
    },
    onLiteralValue: onValue,
    onError: (error, offset, length) => {
      errors.push({ error, offset, length });
    }
  };
  visit(text, visitor, options);
  return currentParent[0];
}
function parseTree(text, errors = [], options = ParseOptions.DEFAULT) {
  let currentParent = { type: "array", offset: -1, length: -1, children: [], parent: undefined };
  function ensurePropertyComplete(endOffset) {
    if (currentParent.type === "property") {
      currentParent.length = endOffset - currentParent.offset;
      currentParent = currentParent.parent;
    }
  }
  function onValue(valueNode) {
    currentParent.children.push(valueNode);
    return valueNode;
  }
  const visitor = {
    onObjectBegin: (offset) => {
      currentParent = onValue({ type: "object", offset, length: -1, parent: currentParent, children: [] });
    },
    onObjectProperty: (name, offset, length) => {
      currentParent = onValue({ type: "property", offset, length: -1, parent: currentParent, children: [] });
      currentParent.children.push({ type: "string", value: name, offset, length, parent: currentParent });
    },
    onObjectEnd: (offset, length) => {
      ensurePropertyComplete(offset + length);
      currentParent.length = offset + length - currentParent.offset;
      currentParent = currentParent.parent;
      ensurePropertyComplete(offset + length);
    },
    onArrayBegin: (offset, length) => {
      currentParent = onValue({ type: "array", offset, length: -1, parent: currentParent, children: [] });
    },
    onArrayEnd: (offset, length) => {
      currentParent.length = offset + length - currentParent.offset;
      currentParent = currentParent.parent;
      ensurePropertyComplete(offset + length);
    },
    onLiteralValue: (value, offset, length) => {
      onValue({ type: getNodeType(value), offset, length, parent: currentParent, value });
      ensurePropertyComplete(offset + length);
    },
    onSeparator: (sep, offset, length) => {
      if (currentParent.type === "property") {
        if (sep === ":") {
          currentParent.colonOffset = offset;
        } else if (sep === ",") {
          ensurePropertyComplete(offset);
        }
      }
    },
    onError: (error, offset, length) => {
      errors.push({ error, offset, length });
    }
  };
  visit(text, visitor, options);
  const result = currentParent.children[0];
  if (result) {
    delete result.parent;
  }
  return result;
}
function findNodeAtLocation(root, path) {
  if (!root) {
    return;
  }
  let node = root;
  for (let segment of path) {
    if (typeof segment === "string") {
      if (node.type !== "object" || !Array.isArray(node.children)) {
        return;
      }
      let found = false;
      for (const propertyNode of node.children) {
        if (Array.isArray(propertyNode.children) && propertyNode.children[0].value === segment && propertyNode.children.length === 2) {
          node = propertyNode.children[1];
          found = true;
          break;
        }
      }
      if (!found) {
        return;
      }
    } else {
      const index = segment;
      if (node.type !== "array" || index < 0 || !Array.isArray(node.children) || index >= node.children.length) {
        return;
      }
      node = node.children[index];
    }
  }
  return node;
}
function visit(text, visitor, options = ParseOptions.DEFAULT) {
  const _scanner = createScanner(text, false);
  const _jsonPath = [];
  let suppressedCallbacks = 0;
  function toNoArgVisit(visitFunction) {
    return visitFunction ? () => suppressedCallbacks === 0 && visitFunction(_scanner.getTokenOffset(), _scanner.getTokenLength(), _scanner.getTokenStartLine(), _scanner.getTokenStartCharacter()) : () => true;
  }
  function toOneArgVisit(visitFunction) {
    return visitFunction ? (arg) => suppressedCallbacks === 0 && visitFunction(arg, _scanner.getTokenOffset(), _scanner.getTokenLength(), _scanner.getTokenStartLine(), _scanner.getTokenStartCharacter()) : () => true;
  }
  function toOneArgVisitWithPath(visitFunction) {
    return visitFunction ? (arg) => suppressedCallbacks === 0 && visitFunction(arg, _scanner.getTokenOffset(), _scanner.getTokenLength(), _scanner.getTokenStartLine(), _scanner.getTokenStartCharacter(), () => _jsonPath.slice()) : () => true;
  }
  function toBeginVisit(visitFunction) {
    return visitFunction ? () => {
      if (suppressedCallbacks > 0) {
        suppressedCallbacks++;
      } else {
        let cbReturn = visitFunction(_scanner.getTokenOffset(), _scanner.getTokenLength(), _scanner.getTokenStartLine(), _scanner.getTokenStartCharacter(), () => _jsonPath.slice());
        if (cbReturn === false) {
          suppressedCallbacks = 1;
        }
      }
    } : () => true;
  }
  function toEndVisit(visitFunction) {
    return visitFunction ? () => {
      if (suppressedCallbacks > 0) {
        suppressedCallbacks--;
      }
      if (suppressedCallbacks === 0) {
        visitFunction(_scanner.getTokenOffset(), _scanner.getTokenLength(), _scanner.getTokenStartLine(), _scanner.getTokenStartCharacter());
      }
    } : () => true;
  }
  const onObjectBegin = toBeginVisit(visitor.onObjectBegin), onObjectProperty = toOneArgVisitWithPath(visitor.onObjectProperty), onObjectEnd = toEndVisit(visitor.onObjectEnd), onArrayBegin = toBeginVisit(visitor.onArrayBegin), onArrayEnd = toEndVisit(visitor.onArrayEnd), onLiteralValue = toOneArgVisitWithPath(visitor.onLiteralValue), onSeparator = toOneArgVisit(visitor.onSeparator), onComment = toNoArgVisit(visitor.onComment), onError = toOneArgVisit(visitor.onError);
  const disallowComments = options && options.disallowComments;
  const allowTrailingComma = options && options.allowTrailingComma;
  function scanNext() {
    while (true) {
      const token = _scanner.scan();
      switch (_scanner.getTokenError()) {
        case 4:
          handleError(14);
          break;
        case 5:
          handleError(15);
          break;
        case 3:
          handleError(13);
          break;
        case 1:
          if (!disallowComments) {
            handleError(11);
          }
          break;
        case 2:
          handleError(12);
          break;
        case 6:
          handleError(16);
          break;
      }
      switch (token) {
        case 12:
        case 13:
          if (disallowComments) {
            handleError(10);
          } else {
            onComment();
          }
          break;
        case 16:
          handleError(1);
          break;
        case 15:
        case 14:
          break;
        default:
          return token;
      }
    }
  }
  function handleError(error, skipUntilAfter = [], skipUntil = []) {
    onError(error);
    if (skipUntilAfter.length + skipUntil.length > 0) {
      let token = _scanner.getToken();
      while (token !== 17) {
        if (skipUntilAfter.indexOf(token) !== -1) {
          scanNext();
          break;
        } else if (skipUntil.indexOf(token) !== -1) {
          break;
        }
        token = scanNext();
      }
    }
  }
  function parseString(isValue) {
    const value = _scanner.getTokenValue();
    if (isValue) {
      onLiteralValue(value);
    } else {
      onObjectProperty(value);
      _jsonPath.push(value);
    }
    scanNext();
    return true;
  }
  function parseLiteral() {
    switch (_scanner.getToken()) {
      case 11:
        const tokenValue = _scanner.getTokenValue();
        let value = Number(tokenValue);
        if (isNaN(value)) {
          handleError(2);
          value = 0;
        }
        onLiteralValue(value);
        break;
      case 7:
        onLiteralValue(null);
        break;
      case 8:
        onLiteralValue(true);
        break;
      case 9:
        onLiteralValue(false);
        break;
      default:
        return false;
    }
    scanNext();
    return true;
  }
  function parseProperty() {
    if (_scanner.getToken() !== 10) {
      handleError(3, [], [2, 5]);
      return false;
    }
    parseString(false);
    if (_scanner.getToken() === 6) {
      onSeparator(":");
      scanNext();
      if (!parseValue()) {
        handleError(4, [], [2, 5]);
      }
    } else {
      handleError(5, [], [2, 5]);
    }
    _jsonPath.pop();
    return true;
  }
  function parseObject() {
    onObjectBegin();
    scanNext();
    let needsComma = false;
    while (_scanner.getToken() !== 2 && _scanner.getToken() !== 17) {
      if (_scanner.getToken() === 5) {
        if (!needsComma) {
          handleError(4, [], []);
        }
        onSeparator(",");
        scanNext();
        if (_scanner.getToken() === 2 && allowTrailingComma) {
          break;
        }
      } else if (needsComma) {
        handleError(6, [], []);
      }
      if (!parseProperty()) {
        handleError(4, [], [2, 5]);
      }
      needsComma = true;
    }
    onObjectEnd();
    if (_scanner.getToken() !== 2) {
      handleError(7, [2], []);
    } else {
      scanNext();
    }
    return true;
  }
  function parseArray() {
    onArrayBegin();
    scanNext();
    let isFirstElement = true;
    let needsComma = false;
    while (_scanner.getToken() !== 4 && _scanner.getToken() !== 17) {
      if (_scanner.getToken() === 5) {
        if (!needsComma) {
          handleError(4, [], []);
        }
        onSeparator(",");
        scanNext();
        if (_scanner.getToken() === 4 && allowTrailingComma) {
          break;
        }
      } else if (needsComma) {
        handleError(6, [], []);
      }
      if (isFirstElement) {
        _jsonPath.push(0);
        isFirstElement = false;
      } else {
        _jsonPath[_jsonPath.length - 1]++;
      }
      if (!parseValue()) {
        handleError(4, [], [4, 5]);
      }
      needsComma = true;
    }
    onArrayEnd();
    if (!isFirstElement) {
      _jsonPath.pop();
    }
    if (_scanner.getToken() !== 4) {
      handleError(8, [4], []);
    } else {
      scanNext();
    }
    return true;
  }
  function parseValue() {
    switch (_scanner.getToken()) {
      case 3:
        return parseArray();
      case 1:
        return parseObject();
      case 10:
        return parseString(true);
      default:
        return parseLiteral();
    }
  }
  scanNext();
  if (_scanner.getToken() === 17) {
    if (options.allowEmptyContent) {
      return true;
    }
    handleError(4, [], []);
    return false;
  }
  if (!parseValue()) {
    handleError(4, [], []);
    return false;
  }
  if (_scanner.getToken() !== 17) {
    handleError(9, [], []);
  }
  return true;
}
function getNodeType(value) {
  switch (typeof value) {
    case "boolean":
      return "boolean";
    case "number":
      return "number";
    case "string":
      return "string";
    case "object": {
      if (!value) {
        return "null";
      } else if (Array.isArray(value)) {
        return "array";
      }
      return "object";
    }
    default:
      return "null";
  }
}

// ../../../../../node_modules/.bun/jsonc-parser@3.3.1/node_modules/jsonc-parser/lib/esm/impl/edit.js
function setProperty(text, originalPath, value, options) {
  const path = originalPath.slice();
  const errors = [];
  const root = parseTree(text, errors);
  let parent = undefined;
  let lastSegment = undefined;
  while (path.length > 0) {
    lastSegment = path.pop();
    parent = findNodeAtLocation(root, path);
    if (parent === undefined && value !== undefined) {
      if (typeof lastSegment === "string") {
        value = { [lastSegment]: value };
      } else {
        value = [value];
      }
    } else {
      break;
    }
  }
  if (!parent) {
    if (value === undefined) {
      throw new Error("Can not delete in empty document");
    }
    return withFormatting(text, { offset: root ? root.offset : 0, length: root ? root.length : 0, content: JSON.stringify(value) }, options);
  } else if (parent.type === "object" && typeof lastSegment === "string" && Array.isArray(parent.children)) {
    const existing = findNodeAtLocation(parent, [lastSegment]);
    if (existing !== undefined) {
      if (value === undefined) {
        if (!existing.parent) {
          throw new Error("Malformed AST");
        }
        const propertyIndex = parent.children.indexOf(existing.parent);
        let removeBegin;
        let removeEnd = existing.parent.offset + existing.parent.length;
        if (propertyIndex > 0) {
          let previous = parent.children[propertyIndex - 1];
          removeBegin = previous.offset + previous.length;
        } else {
          removeBegin = parent.offset + 1;
          if (parent.children.length > 1) {
            let next = parent.children[1];
            removeEnd = next.offset;
          }
        }
        return withFormatting(text, { offset: removeBegin, length: removeEnd - removeBegin, content: "" }, options);
      } else {
        return withFormatting(text, { offset: existing.offset, length: existing.length, content: JSON.stringify(value) }, options);
      }
    } else {
      if (value === undefined) {
        return [];
      }
      const newProperty = `${JSON.stringify(lastSegment)}: ${JSON.stringify(value)}`;
      const index = options.getInsertionIndex ? options.getInsertionIndex(parent.children.map((p) => p.children[0].value)) : parent.children.length;
      let edit;
      if (index > 0) {
        let previous = parent.children[index - 1];
        edit = { offset: previous.offset + previous.length, length: 0, content: "," + newProperty };
      } else if (parent.children.length === 0) {
        edit = { offset: parent.offset + 1, length: 0, content: newProperty };
      } else {
        edit = { offset: parent.offset + 1, length: 0, content: newProperty + "," };
      }
      return withFormatting(text, edit, options);
    }
  } else if (parent.type === "array" && typeof lastSegment === "number" && Array.isArray(parent.children)) {
    const insertIndex = lastSegment;
    if (insertIndex === -1) {
      const newProperty = `${JSON.stringify(value)}`;
      let edit;
      if (parent.children.length === 0) {
        edit = { offset: parent.offset + 1, length: 0, content: newProperty };
      } else {
        const previous = parent.children[parent.children.length - 1];
        edit = { offset: previous.offset + previous.length, length: 0, content: "," + newProperty };
      }
      return withFormatting(text, edit, options);
    } else if (value === undefined && parent.children.length >= 0) {
      const removalIndex = lastSegment;
      const toRemove = parent.children[removalIndex];
      let edit;
      if (parent.children.length === 1) {
        edit = { offset: parent.offset + 1, length: parent.length - 2, content: "" };
      } else if (parent.children.length - 1 === removalIndex) {
        let previous = parent.children[removalIndex - 1];
        let offset = previous.offset + previous.length;
        let parentEndOffset = parent.offset + parent.length;
        edit = { offset, length: parentEndOffset - 2 - offset, content: "" };
      } else {
        edit = { offset: toRemove.offset, length: parent.children[removalIndex + 1].offset - toRemove.offset, content: "" };
      }
      return withFormatting(text, edit, options);
    } else if (value !== undefined) {
      let edit;
      const newProperty = `${JSON.stringify(value)}`;
      if (!options.isArrayInsertion && parent.children.length > lastSegment) {
        const toModify = parent.children[lastSegment];
        edit = { offset: toModify.offset, length: toModify.length, content: newProperty };
      } else if (parent.children.length === 0 || lastSegment === 0) {
        edit = { offset: parent.offset + 1, length: 0, content: parent.children.length === 0 ? newProperty : newProperty + "," };
      } else {
        const index = lastSegment > parent.children.length ? parent.children.length : lastSegment;
        const previous = parent.children[index - 1];
        edit = { offset: previous.offset + previous.length, length: 0, content: "," + newProperty };
      }
      return withFormatting(text, edit, options);
    } else {
      throw new Error(`Can not ${value === undefined ? "remove" : options.isArrayInsertion ? "insert" : "modify"} Array index ${insertIndex} as length is not sufficient`);
    }
  } else {
    throw new Error(`Can not add ${typeof lastSegment !== "number" ? "index" : "property"} to parent of type ${parent.type}`);
  }
}
function withFormatting(text, edit, options) {
  if (!options.formattingOptions) {
    return [edit];
  }
  let newText = applyEdit(text, edit);
  let begin = edit.offset;
  let end = edit.offset + edit.content.length;
  if (edit.length === 0 || edit.content.length === 0) {
    while (begin > 0 && !isEOL(newText, begin - 1)) {
      begin--;
    }
    while (end < newText.length && !isEOL(newText, end)) {
      end++;
    }
  }
  const edits = format(newText, { offset: begin, length: end - begin }, { ...options.formattingOptions, keepLines: false });
  for (let i = edits.length - 1;i >= 0; i--) {
    const edit = edits[i];
    newText = applyEdit(newText, edit);
    begin = Math.min(begin, edit.offset);
    end = Math.max(end, edit.offset + edit.length);
    end += edit.content.length - edit.length;
  }
  const editLength = text.length - (newText.length - end) - begin;
  return [{ offset: begin, length: editLength, content: newText.substring(begin, end) }];
}
function applyEdit(text, edit) {
  return text.substring(0, edit.offset) + edit.content + text.substring(edit.offset + edit.length);
}

// ../../../../../node_modules/.bun/jsonc-parser@3.3.1/node_modules/jsonc-parser/lib/esm/main.js
var ScanError;
(function(ScanError) {
  ScanError[ScanError["None"] = 0] = "None";
  ScanError[ScanError["UnexpectedEndOfComment"] = 1] = "UnexpectedEndOfComment";
  ScanError[ScanError["UnexpectedEndOfString"] = 2] = "UnexpectedEndOfString";
  ScanError[ScanError["UnexpectedEndOfNumber"] = 3] = "UnexpectedEndOfNumber";
  ScanError[ScanError["InvalidUnicode"] = 4] = "InvalidUnicode";
  ScanError[ScanError["InvalidEscapeCharacter"] = 5] = "InvalidEscapeCharacter";
  ScanError[ScanError["InvalidCharacter"] = 6] = "InvalidCharacter";
})(ScanError || (ScanError = {}));
var SyntaxKind;
(function(SyntaxKind) {
  SyntaxKind[SyntaxKind["OpenBraceToken"] = 1] = "OpenBraceToken";
  SyntaxKind[SyntaxKind["CloseBraceToken"] = 2] = "CloseBraceToken";
  SyntaxKind[SyntaxKind["OpenBracketToken"] = 3] = "OpenBracketToken";
  SyntaxKind[SyntaxKind["CloseBracketToken"] = 4] = "CloseBracketToken";
  SyntaxKind[SyntaxKind["CommaToken"] = 5] = "CommaToken";
  SyntaxKind[SyntaxKind["ColonToken"] = 6] = "ColonToken";
  SyntaxKind[SyntaxKind["NullKeyword"] = 7] = "NullKeyword";
  SyntaxKind[SyntaxKind["TrueKeyword"] = 8] = "TrueKeyword";
  SyntaxKind[SyntaxKind["FalseKeyword"] = 9] = "FalseKeyword";
  SyntaxKind[SyntaxKind["StringLiteral"] = 10] = "StringLiteral";
  SyntaxKind[SyntaxKind["NumericLiteral"] = 11] = "NumericLiteral";
  SyntaxKind[SyntaxKind["LineCommentTrivia"] = 12] = "LineCommentTrivia";
  SyntaxKind[SyntaxKind["BlockCommentTrivia"] = 13] = "BlockCommentTrivia";
  SyntaxKind[SyntaxKind["LineBreakTrivia"] = 14] = "LineBreakTrivia";
  SyntaxKind[SyntaxKind["Trivia"] = 15] = "Trivia";
  SyntaxKind[SyntaxKind["Unknown"] = 16] = "Unknown";
  SyntaxKind[SyntaxKind["EOF"] = 17] = "EOF";
})(SyntaxKind || (SyntaxKind = {}));
var parse4 = parse3;
var ParseErrorCode;
(function(ParseErrorCode) {
  ParseErrorCode[ParseErrorCode["InvalidSymbol"] = 1] = "InvalidSymbol";
  ParseErrorCode[ParseErrorCode["InvalidNumberFormat"] = 2] = "InvalidNumberFormat";
  ParseErrorCode[ParseErrorCode["PropertyNameExpected"] = 3] = "PropertyNameExpected";
  ParseErrorCode[ParseErrorCode["ValueExpected"] = 4] = "ValueExpected";
  ParseErrorCode[ParseErrorCode["ColonExpected"] = 5] = "ColonExpected";
  ParseErrorCode[ParseErrorCode["CommaExpected"] = 6] = "CommaExpected";
  ParseErrorCode[ParseErrorCode["CloseBraceExpected"] = 7] = "CloseBraceExpected";
  ParseErrorCode[ParseErrorCode["CloseBracketExpected"] = 8] = "CloseBracketExpected";
  ParseErrorCode[ParseErrorCode["EndOfFileExpected"] = 9] = "EndOfFileExpected";
  ParseErrorCode[ParseErrorCode["InvalidCommentToken"] = 10] = "InvalidCommentToken";
  ParseErrorCode[ParseErrorCode["UnexpectedEndOfComment"] = 11] = "UnexpectedEndOfComment";
  ParseErrorCode[ParseErrorCode["UnexpectedEndOfString"] = 12] = "UnexpectedEndOfString";
  ParseErrorCode[ParseErrorCode["UnexpectedEndOfNumber"] = 13] = "UnexpectedEndOfNumber";
  ParseErrorCode[ParseErrorCode["InvalidUnicode"] = 14] = "InvalidUnicode";
  ParseErrorCode[ParseErrorCode["InvalidEscapeCharacter"] = 15] = "InvalidEscapeCharacter";
  ParseErrorCode[ParseErrorCode["InvalidCharacter"] = 16] = "InvalidCharacter";
})(ParseErrorCode || (ParseErrorCode = {}));
function printParseErrorCode(code) {
  switch (code) {
    case 1:
      return "InvalidSymbol";
    case 2:
      return "InvalidNumberFormat";
    case 3:
      return "PropertyNameExpected";
    case 4:
      return "ValueExpected";
    case 5:
      return "ColonExpected";
    case 6:
      return "CommaExpected";
    case 7:
      return "CloseBraceExpected";
    case 8:
      return "CloseBracketExpected";
    case 9:
      return "EndOfFileExpected";
    case 10:
      return "InvalidCommentToken";
    case 11:
      return "UnexpectedEndOfComment";
    case 12:
      return "UnexpectedEndOfString";
    case 13:
      return "UnexpectedEndOfNumber";
    case 14:
      return "InvalidUnicode";
    case 15:
      return "InvalidEscapeCharacter";
    case 16:
      return "InvalidCharacter";
  }
  return "<unknown ParseErrorCode>";
}
function modify(text, path, value, options) {
  return setProperty(text, path, value, options);
}
function applyEdits(text, edits) {
  let sortedEdits = edits.slice(0).sort((a, b) => {
    const diff = a.offset - b.offset;
    if (diff === 0) {
      return a.length - b.length;
    }
    return diff;
  });
  let lastModifiedOffset = text.length;
  for (let i = sortedEdits.length - 1;i >= 0; i--) {
    let e = sortedEdits[i];
    if (e.offset + e.length <= lastModifiedOffset) {
      text = applyEdit(text, e);
    } else {
      throw new Error("Overlapping edit");
    }
    lastModifiedOffset = e.offset;
  }
  return text;
}

// ../../../../omo-engine/omo-config-core/src/loader/merge.ts
var DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);
function isUnsafeObjectKey(key) {
  return DANGEROUS_KEYS.has(key);
}
function isPlainObject2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.prototype.toString.call(value) === "[object Object]";
}
function sanitizeOmoConfigValue(value) {
  if (Array.isArray(value))
    return value.map((entry) => sanitizeOmoConfigValue(entry));
  if (!isPlainObject2(value))
    return value;
  const sanitized = {};
  for (const [key, entry] of Object.entries(value)) {
    if (isUnsafeObjectKey(key))
      continue;
    sanitized[key] = sanitizeOmoConfigValue(entry);
  }
  return sanitized;
}
function mergeOmoConfigRecords(base, override) {
  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (isUnsafeObjectKey(key))
      continue;
    const safeValue = sanitizeOmoConfigValue(value);
    const baseValue = result[key];
    result[key] = isPlainObject2(baseValue) && isPlainObject2(safeValue) ? mergeOmoConfigRecords(baseValue, safeValue) : safeValue;
  }
  return result;
}

// ../../../../omo-engine/omo-config-core/src/loader/prune-invalid-leaves.ts
var MAX_PRUNE_PASSES = 32;
function isContainer(value) {
  return typeof value === "object" && value !== null;
}
function childOf(container, segment) {
  return Array.isArray(container) ? container[Number(segment)] : container[String(segment)];
}
function hasChild(container, segment) {
  if (Array.isArray(container)) {
    const index = Number(segment);
    return Number.isInteger(index) && index >= 0 && index < container.length;
  }
  return Object.hasOwn(container, String(segment));
}
function segmentsOf(path) {
  return path.map((segment) => typeof segment === "number" ? segment : String(segment));
}
function targetPaths(root, issue) {
  const base = segmentsOf(issue.path);
  if (issue.code === "unrecognized_keys")
    return issue.keys.map((key) => [...base, key]);
  let node = root;
  let depth = 0;
  for (const segment of base) {
    if (!isContainer(node) || !hasChild(node, segment))
      break;
    node = childOf(node, segment);
    depth += 1;
  }
  return [base.slice(0, depth)];
}
function isAncestor(ancestor, path) {
  return ancestor.length < path.length && ancestor.every((segment, index) => segment === path[index]);
}
function compareDescending(left, right) {
  const length = Math.min(left.length, right.length);
  for (let index = 0;index < length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (a === b)
      continue;
    if (typeof a === "number" && typeof b === "number")
      return b - a;
    return String(b).localeCompare(String(a));
  }
  return right.length - left.length;
}
function removeChild(container, segment) {
  if (Array.isArray(container))
    container.splice(Number(segment), 1);
  else
    delete container[String(segment)];
}
function isEmpty(container) {
  return Array.isArray(container) ? container.length === 0 : Object.keys(container).length === 0;
}
function removePathAndEmptiedAncestors(root, path) {
  const chain = [root];
  for (const segment of path.slice(0, -1)) {
    const current = chain[chain.length - 1];
    if (current === undefined)
      return;
    const next = childOf(current, segment);
    if (!isContainer(next))
      return;
    chain.push(next);
  }
  for (let depth = path.length - 1;depth >= 0; depth -= 1) {
    const container = chain[depth];
    const segment = path[depth];
    if (container === undefined || segment === undefined)
      return;
    removeChild(container, segment);
    if (depth === 0 || !isEmpty(container))
      return;
  }
}
function prunePass(root, issues) {
  const byKey = new Map;
  for (const issue of issues) {
    for (const path of targetPaths(root, issue)) {
      if (path.length === 0)
        return null;
      const key = path.map((segment) => String(segment)).join(".");
      if (!byKey.has(key))
        byKey.set(key, { key, message: issue.message, path });
    }
  }
  const targets = [...byKey.values()];
  const outermost = targets.filter((target) => !targets.some((other) => isAncestor(other.path, target.path))).sort((left, right) => compareDescending(left.path, right.path));
  const next = structuredClone(root);
  for (const target of outermost)
    removePathAndEmptiedAncestors(next, target.path);
  return { dropped: outermost, next };
}
function pruneInvalidConfigPaths(config, issues, validate, maxPasses = MAX_PRUNE_PASSES) {
  const dropped = [];
  let current = config;
  let pending = issues;
  for (let pass = 0;pass < maxPasses; pass += 1) {
    const step = prunePass(current, pending);
    if (step === null || step.dropped.length === 0)
      return { ok: false, dropped };
    dropped.push(...step.dropped);
    current = step.next;
    if (Object.keys(current).length === 0)
      return { ok: false, dropped };
    const validation = validate(current);
    if (validation.success)
      return { ok: true, config: current, dropped };
    pending = validation.issues;
  }
  return { ok: false, dropped };
}

// ../../../../omo-engine/omo-config-core/src/loader/layer-validation.ts
function validationDiagnostic(path, issues) {
  const issuePaths = issues.map((issue) => issue.path.map((segment) => String(segment)).join("."));
  return {
    kind: "validation",
    message: `Invalid omo config at ${path}: ${issuePaths.join(", ")}`,
    path,
    issuePaths
  };
}
function invalidValueDiagnostics(path, dropped) {
  return dropped.map((entry) => ({
    kind: "invalid-value",
    message: `Ignored invalid value in ${path}: ${entry.key}: ${entry.message}`,
    path,
    issuePaths: [entry.key]
  }));
}
function unrecognizedKeyIssues(issues) {
  return issues.flatMap((issue) => issue.code === "unrecognized_keys" ? [{ keys: issue.keys, path: issue.path.map((segment) => String(segment)) }] : []);
}
function isRecord8(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function sanitizeUnsafeKeys(value, path = []) {
  if (Array.isArray(value)) {
    const issues = [];
    const sanitized = value.map((entry, index) => {
      const nested = sanitizeUnsafeKeys(entry, [...path, String(index)]);
      issues.push(...nested.issues);
      return nested.value;
    });
    return { issues, value: sanitized };
  }
  if (!isRecord8(value))
    return { issues: [], value };
  const issues = [];
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    issues.push({ keys: ["__proto__"], path });
  }
  const sanitized = {};
  for (const [key, entry] of Object.entries(value)) {
    if (isUnsafeObjectKey(key)) {
      issues.push({ keys: [key], path });
      continue;
    }
    const nested = sanitizeUnsafeKeys(entry, [...path, key]);
    issues.push(...nested.issues);
    sanitized[key] = nested.value;
  }
  return { issues, value: sanitized };
}
function containerAt(record, path) {
  let node = record;
  for (const segment of path) {
    if (Array.isArray(node)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= node.length)
        return null;
      node = node[index];
    } else if (isRecord8(node) && Object.hasOwn(node, segment)) {
      node = node[segment];
    } else {
      return null;
    }
  }
  return isRecord8(node) ? node : null;
}
function stripUnrecognizedKeys(record, issues) {
  const stripped = structuredClone(record);
  const issuePaths = [];
  for (const issue of issues) {
    const container = containerAt(stripped, issue.path);
    if (container === null)
      continue;
    for (const key of issue.keys) {
      delete container[key];
      issuePaths.push([...issue.path, key].join("."));
    }
  }
  return { issuePaths, stripped };
}
function toRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return null;
  const record = {};
  for (const [key, entry] of Object.entries(value)) {
    record[key] = entry;
  }
  return record;
}
var validateLayerRecord = (record) => {
  const parsed = OmoConfigLayerSchema.safeParse(record);
  return parsed.success ? { success: true } : { success: false, issues: parsed.error.issues };
};
function validateConfigLayer(path, data) {
  const sanitized = sanitizeUnsafeKeys(data);
  const record = toRecord(sanitized.value);
  const unsafeIssuePaths = sanitized.issues.flatMap((issue) => issue.keys.map((key) => [...issue.path, key].join(".")));
  const unsafeDiagnostics = unsafeIssuePaths.length === 0 ? [] : [{ kind: "unknown-keys", message: `Ignored unknown keys in ${path}: ${unsafeIssuePaths.join(", ")}`, path, issuePaths: unsafeIssuePaths }];
  const validation = OmoConfigLayerSchema.safeParse(sanitized.value);
  if (validation.success) {
    if (record !== null)
      return { loaded: true, diagnostics: unsafeDiagnostics, value: record };
    return {
      loaded: false,
      diagnostics: [{ kind: "validation", message: `Invalid omo config at ${path}: root must be an object`, path }]
    };
  }
  const rejected = { loaded: false, diagnostics: [validationDiagnostic(path, validation.error.issues)] };
  const unknownIssues = unrecognizedKeyIssues(validation.error.issues);
  if (record === null)
    return rejected;
  let candidate = record;
  let issues = validation.error.issues;
  const diagnostics = [...unsafeDiagnostics];
  if (unknownIssues.length > 0) {
    const { issuePaths, stripped } = stripUnrecognizedKeys(record, unknownIssues);
    if (issuePaths.length > 0) {
      diagnostics.push({ kind: "unknown-keys", message: `Ignored unknown keys in ${path}: ${issuePaths.join(", ")}`, path, issuePaths });
    }
    const strippedValidation = validateLayerRecord(stripped);
    if (strippedValidation.success)
      return { loaded: true, diagnostics, value: stripped };
    candidate = stripped;
    issues = strippedValidation.issues;
  }
  const pruned = pruneInvalidConfigPaths(candidate, issues, validateLayerRecord);
  if (!pruned.ok)
    return rejected;
  return { loaded: true, diagnostics: [...diagnostics, ...invalidValueDiagnostics(path, pruned.dropped)], value: pruned.config };
}

// ../../../../omo-engine/omo-config-core/src/loader/paths.ts
import { userInfo } from "node:os";
import { dirname, join, posix, resolve } from "node:path";

// ../../../../omo-engine/omo-config-core/src/internal/posix-path.ts
function toPosixPath(path) {
  return path.split("\\").join("/");
}

// ../../../../omo-engine/omo-config-core/src/loader/paths.ts
var MAX_PROJECT_CONFIG_DIRECTORY_DEPTH = 256;
var ACCOUNT_HOME_DIR = userInfo().homedir;
function resolveHomeDir(env = process.env) {
  const homeDir = env.HOME ?? env.USERPROFILE ?? process.cwd();
  return homeDir.startsWith("/") ? posix.resolve(homeDir) : toPosixPath(resolve(homeDir));
}
function resolveUserOmoConfigDirectory(env = process.env) {
  return join(resolveHomeDir(env), ".omo");
}
function detectUserOmoJsonPath(env, fileSystem) {
  const configDir = resolveUserOmoConfigDirectory(env);
  const jsoncPath = join(configDir, "omo.jsonc");
  if (fileSystem.existsSync(jsoncPath))
    return jsoncPath;
  const jsonPath = join(configDir, "omo.json");
  return fileSystem.existsSync(jsonPath) ? jsonPath : jsoncPath;
}
function isSymlinkedProjectPath(path, fileSystem) {
  if (fileSystem.lstatSync === undefined || !fileSystem.existsSync(path))
    return false;
  try {
    return fileSystem.lstatSync(path).isSymbolicLink();
  } catch (error) {
    if (error instanceof Error)
      return true;
    throw error;
  }
}
function isLoadableProjectConfigFile(path, fileSystem) {
  return fileSystem.existsSync(path) && !isSymlinkedProjectPath(path, fileSystem);
}
function detectOmoJsonPath(dir, fileSystem) {
  const omoDir = join(dir, ".omo");
  if (isSymlinkedProjectPath(omoDir, fileSystem))
    return null;
  const jsoncPath = join(omoDir, "omo.jsonc");
  if (isLoadableProjectConfigFile(jsoncPath, fileSystem))
    return jsoncPath;
  const jsonPath = join(omoDir, "omo.json");
  return isLoadableProjectConfigFile(jsonPath, fileSystem) ? jsonPath : null;
}
function realpathOrSelf(path, fileSystem) {
  if (fileSystem.realpathSync === undefined)
    return path;
  try {
    return fileSystem.realpathSync(path);
  } catch {
    return path;
  }
}
function findProjectConfigPathsFarthestFirst(cwd, homeDir, fileSystem, accountHomeDir = homeDir) {
  const startDir = resolve(cwd);
  const boundaryDirs = [...new Set([resolve(homeDir), resolve(accountHomeDir)])];
  const realBoundaryDirs = new Set(boundaryDirs.map((path) => realpathOrSelf(path, fileSystem)));
  const nearestFirst = [];
  let currentDir = startDir;
  for (let depth = 0;depth < MAX_PROJECT_CONFIG_DIRECTORY_DEPTH; depth += 1) {
    const isHomeDir = boundaryDirs.includes(currentDir) || realBoundaryDirs.has(realpathOrSelf(currentDir, fileSystem));
    const configPath = isHomeDir ? null : detectOmoJsonPath(currentDir, fileSystem);
    if (configPath !== null)
      nearestFirst.push(configPath);
    if (isHomeDir)
      break;
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir)
      break;
    currentDir = parentDir;
  }
  return nearestFirst.reverse();
}
function resolveOmoConfigPaths(options) {
  const fileSystem = options.fileSystem ?? DEFAULT_READ_FILE_SYSTEM;
  const env = options.env ?? process.env;
  const userPath = detectUserOmoJsonPath(env, fileSystem);
  const projectPaths = findProjectConfigPathsFarthestFirst(options.cwd, resolveHomeDir(env), fileSystem, ACCOUNT_HOME_DIR);
  return [
    { path: userPath, scope: "user" },
    ...projectPaths.map((path) => ({ path, scope: "project" }))
  ];
}

// ../../../../omo-engine/omo-config-core/src/loader/resolution.ts
var HARNESS_KEYS = [...new Set([...HARNESS_IDS, ...OMO_CONFIG_HARNESS_IDS, ...OMO_CONFIG_LEGACY_HARNESS_IDS])].map((harness) => harnessBlockKey(harness));
function profileName(value) {
  return value === "" ? undefined : value;
}
function profileNameFromOpenCodeConfigDir(path) {
  const match = path?.match(/(?:^|[\\/])profiles[\\/]([^\\/]+)[\\/]*$/);
  return profileName(match?.[1]);
}
function resolveOmoProfileName(options = {}) {
  const env = options.env ?? process.env;
  return profileName(options.profile) ?? profileName(env["OMO_PROFILE"]) ?? profileName(env["OCX_PROFILE"]) ?? profileNameFromOpenCodeConfigDir(env["OPENCODE_CONFIG_DIR"]);
}
function toRecord2(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return;
  return Object.fromEntries(Object.entries(value));
}
function withoutControlKeys(config) {
  const result = {};
  for (const [key, value] of Object.entries(config)) {
    if (key === "profiles" || HARNESS_KEYS.includes(key))
      continue;
    result[key] = value;
  }
  return result;
}
function harnessLayer(config, harness) {
  if (harness === undefined)
    return {};
  const canonical = canonicalHarnessName(harness);
  const legacyKeys = Object.entries(OMO_CONFIG_LEGACY_HARNESS_ALIASES).filter(([, target]) => target === canonical).map(([legacy]) => harnessBlockKey(legacy));
  let layer = {};
  for (const key of [...legacyKeys, harnessBlockKey(canonical)]) {
    layer = mergeOmoConfigRecords(layer, toRecord2(config[key]) ?? {});
  }
  return layer;
}
function resolveOmoConfigView(options) {
  const profiles = toRecord2(options.config["profiles"]);
  const profile = options.profile === undefined ? undefined : toRecord2(profiles?.[options.profile]);
  const diagnostics = profile === undefined && options.profile !== undefined ? [{
    kind: "profile",
    message: `Activated omo profile "${options.profile}" does not exist; using the base configuration`,
    path: `profiles.${options.profile}`
  }] : [];
  const layers = [
    withoutControlKeys(options.config),
    harnessLayer(options.config, options.harness),
    profile === undefined ? {} : withoutControlKeys(profile),
    profile === undefined ? {} : harnessLayer(profile, options.harness)
  ];
  let config = {};
  for (const layer of layers)
    config = mergeOmoConfigRecords(config, layer);
  const resolvedProfile = options.profile !== undefined && profile !== undefined ? options.profile : undefined;
  return {
    config: withoutControlKeys(config),
    diagnostics,
    ...resolvedProfile === undefined ? {} : { profile: resolvedProfile }
  };
}

// ../../../../omo-engine/omo-config-core/src/loader/loader.ts
function parseJsoncSafe(content) {
  const errors = [];
  const data = parse4(content.charCodeAt(0) === 65279 ? content.slice(1) : content, errors, {
    allowTrailingComma: true,
    disallowComments: false
  });
  return {
    data: errors.length === 0 ? data : null,
    errors: errors.map((error) => ({
      message: printParseErrorCode(error.error),
      offset: error.offset
    }))
  };
}
var DEFAULT_RAW_CONFIG = {
  agents: {},
  categories: {},
  task: resolveOmoTaskSettings({}),
  teams: {}
};
function stripResolutionControlKeys(config) {
  const {
    "[codex]": _codex,
    "[native]": _native,
    "[opencode]": _opencode,
    "[senpi]": _senpi,
    profiles: _profiles,
    ...resolved
  } = config;
  return resolved;
}
function readConfigSource(path, scope, fileSystem) {
  if (!fileSystem.existsSync(path)) {
    return { diagnostics: [], source: { exists: false, loaded: false, path, scope } };
  }
  let content;
  try {
    content = fileSystem.readFileSync(path, "utf-8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      diagnostics: [{ kind: "read", message: `Failed to read ${path}: ${message}`, path }],
      source: { exists: true, loaded: false, path, scope }
    };
  }
  const parsed = parseJsoncSafe(content);
  if (parsed.errors.length > 0) {
    return {
      diagnostics: [{
        kind: "parse",
        message: `JSONC parse error in ${path}: ${parsed.errors.map((error) => error.message).join(", ")}`,
        path
      }],
      source: { exists: true, loaded: false, path, scope }
    };
  }
  const layer = validateConfigLayer(path, parsed.data);
  return layer.loaded ? { diagnostics: layer.diagnostics, source: { exists: true, loaded: true, path, scope }, value: layer.value } : { diagnostics: layer.diagnostics, source: { exists: true, loaded: false, path, scope } };
}
function legacyCategoryDiagnostic(path, renames) {
  const detail = renames.map((rename) => rename.dropped ? `${rename.path} ignored because ${rename.canonical} is also configured` : `${rename.path} renamed to ${rename.canonical}`).join(", ");
  return {
    kind: "deprecated-keys",
    message: `Deprecated category name in ${path}: ${detail}. Rename it; the alias is removed in a future release.`,
    path,
    issuePaths: renames.map((rename) => rename.path)
  };
}
function legacyHarnessDiagnostic(path, renames) {
  const detail = renames.map((rename) => rename.dropped ? `${rename.path} ignored because ${rename.canonical} is also configured` : `${rename.path} renamed to ${rename.canonical}`).join(", ");
  return {
    kind: "deprecated-keys",
    message: `Deprecated harness block in ${path}: ${detail}. Rename it; the alias is removed in a future release.`,
    path,
    issuePaths: renames.map((rename) => rename.path)
  };
}
function loadOmoConfig(options = {}) {
  const fileSystem = options.fileSystem ?? DEFAULT_READ_FILE_SYSTEM;
  const cwd = options.cwd ?? process.cwd();
  let merged = {};
  const diagnostics = [];
  const layers = [];
  const sources = [];
  for (const candidate of resolveOmoConfigPaths({
    cwd,
    ...options.env === undefined ? {} : { env: options.env },
    fileSystem,
    ...options.platform === undefined ? {} : { platform: options.platform }
  })) {
    const loaded = readConfigSource(candidate.path, candidate.scope, fileSystem);
    sources.push(loaded.source);
    diagnostics.push(...loaded.diagnostics);
    if (loaded.value !== undefined) {
      const canonicalized = canonicalizeLegacyCategoryNames(loaded.value);
      if (canonicalized.renames.length > 0) {
        diagnostics.push(legacyCategoryDiagnostic(candidate.path, canonicalized.renames));
      }
      const harnessCanonicalized = canonicalizeLegacyHarnessBlocks(canonicalized.document);
      if (harnessCanonicalized.renames.length > 0) {
        diagnostics.push(legacyHarnessDiagnostic(candidate.path, harnessCanonicalized.renames));
      }
      layers.push({ config: harnessCanonicalized.document, source: loaded.source });
      merged = mergeOmoConfigRecords(merged, harnessCanonicalized.document);
    }
  }
  const requestedProfile = resolveOmoProfileName({
    ...options.env === undefined ? {} : { env: options.env },
    ...options.profile === undefined ? {} : { profile: options.profile }
  });
  const resolved = resolveOmoConfigView({
    config: merged,
    ...options.harness === undefined ? {} : { harness: options.harness },
    ...requestedProfile === undefined ? {} : { profile: requestedProfile }
  });
  const finalInput = mergeOmoConfigRecords(DEFAULT_RAW_CONFIG, resolved.config);
  const finalConfig = OmoConfigSchema.safeParse(finalInput);
  if (finalConfig.success) {
    return {
      config: stripResolutionControlKeys(finalConfig.data),
      diagnostics: [...diagnostics, ...resolved.diagnostics],
      layers,
      ...resolved.profile === undefined ? {} : { profile: resolved.profile },
      sources
    };
  }
  const pruned = pruneInvalidConfigPaths(finalInput, finalConfig.error.issues, (record) => {
    const parsed = OmoConfigSchema.safeParse(record);
    return parsed.success ? { success: true } : { success: false, issues: parsed.error.issues };
  });
  if (pruned.ok) {
    return {
      config: stripResolutionControlKeys(OmoConfigSchema.parse(pruned.config)),
      diagnostics: [...diagnostics, ...resolved.diagnostics, ...invalidValueDiagnostics(MERGED_OMO_CONFIG_PATH, pruned.dropped)],
      layers,
      ...resolved.profile === undefined ? {} : { profile: resolved.profile },
      sources
    };
  }
  return {
    config: stripResolutionControlKeys(OmoConfigSchema.parse(DEFAULT_RAW_CONFIG)),
    diagnostics: [...diagnostics, ...resolved.diagnostics, validationDiagnostic(MERGED_OMO_CONFIG_PATH, finalConfig.error.issues)],
    layers,
    ...resolved.profile === undefined ? {} : { profile: resolved.profile },
    sources
  };
}

// ../../../../omo-engine/omo-config-core/src/models/model-catalog-cycles.ts
function findModelCatalogCycles(catalog) {
  const cycleNames = new Set;
  const path = [];
  const visited = new Set;
  const visiting = new Set;
  function visit(name) {
    if (visited.has(name))
      return;
    visiting.add(name);
    path.push(name);
    const next = catalog[name]?.model;
    if (next !== undefined && Object.hasOwn(catalog, next)) {
      if (visiting.has(next)) {
        const cycleStart = path.indexOf(next);
        for (const cycleName of path.slice(cycleStart))
          cycleNames.add(cycleName);
      } else {
        visit(next);
      }
    }
    path.pop();
    visiting.delete(name);
    visited.add(name);
  }
  for (const name of Object.keys(catalog))
    visit(name);
  return [...cycleNames].sort();
}

// ../../../../omo-engine/omo-config-core/src/models/model-reference-resolution.ts
function catalogReference(model, reasoning, catalog, cycleNames) {
  const entry = catalog?.[model];
  if (entry === undefined || cycleNames.has(model))
    return;
  return {
    model: entry.model,
    ...reasoning === undefined && entry.reasoning !== undefined ? { reasoning: entry.reasoning } : reasoning !== undefined ? { reasoning } : {}
  };
}
function resolveModelEntry(entry, catalog, cycleNames) {
  if (typeof entry === "string") {
    const resolved = catalogReference(entry, undefined, catalog, cycleNames);
    if (resolved === undefined)
      return entry;
    return resolved.reasoning === undefined ? resolved.model : resolved;
  }
  const resolved = catalogReference(entry.model, entry.reasoning, catalog, cycleNames);
  if (resolved === undefined)
    return entry;
  return {
    ...entry,
    model: resolved.model,
    ...entry.reasoning === undefined && resolved.reasoning !== undefined ? { reasoning: resolved.reasoning } : {}
  };
}
function resolveFallbackModels(fallbackModels, catalog, cycleNames) {
  if (fallbackModels === undefined)
    return;
  if (typeof fallbackModels !== "string") {
    return fallbackModels.map((entry) => resolveModelEntry(entry, catalog, cycleNames));
  }
  const resolved = catalogReference(fallbackModels, undefined, catalog, cycleNames);
  if (resolved === undefined || resolved.reasoning === undefined)
    return resolved?.model ?? fallbackModels;
  return [resolved];
}
function resolveAgentDefinition(definition, catalog, cycleNames) {
  const resolvedModel = definition.model === undefined ? undefined : catalogReference(definition.model, definition.reasoning, catalog, cycleNames);
  return {
    ...definition,
    ...resolvedModel === undefined ? {} : { model: resolvedModel.model },
    ...definition.reasoning === undefined && resolvedModel?.reasoning !== undefined ? { reasoning: resolvedModel.reasoning } : {},
    ...definition.models === undefined ? {} : { models: definition.models.map((entry) => resolveModelEntry(entry, catalog, cycleNames)) }
  };
}
function resolveCategoryDefinition(definition, catalog, cycleNames) {
  const resolvedModel = definition.model === undefined ? undefined : catalogReference(definition.model, definition.reasoning, catalog, cycleNames);
  return {
    ...definition,
    ...resolvedModel === undefined ? {} : { model: resolvedModel.model },
    ...definition.reasoning === undefined && resolvedModel?.reasoning !== undefined ? { reasoning: resolvedModel.reasoning } : {},
    ...definition.models === undefined ? {} : { models: definition.models.map((entry) => resolveModelEntry(entry, catalog, cycleNames)) },
    ...definition.fallback_models === undefined ? {} : { fallback_models: resolveFallbackModels(definition.fallback_models, catalog, cycleNames) }
  };
}
function resolveModelProfile(definition, catalog, cycleNames) {
  return {
    ...definition,
    ...definition.models === undefined ? {} : { models: definition.models.map((entry) => resolveModelEntry(entry, catalog, cycleNames)) }
  };
}
function profileShadowDiagnostics(view) {
  if (view.model_profiles === undefined || view.models === undefined)
    return [];
  return Object.keys(view.model_profiles).flatMap((name) => view.models?.[name] === undefined ? [] : [{
    kind: "validation",
    message: `Model profile "${name}" shadows a model catalog entry of the same name`,
    path: `model_profiles.${name}`
  }]);
}
function profileSpliceDiagnostics(section, definitions, profileNames) {
  if (definitions === undefined || profileNames.size === 0)
    return [];
  return Object.entries(definitions).flatMap(([name, definition]) => (definition.models ?? []).flatMap((entry, index) => typeof entry !== "string" || !profileNames.has(entry) ? [] : [{
    kind: "validation",
    message: `"${entry}" is a model profile; splicing a profile into a category chain is not supported yet`,
    path: `${section}.${name}.models.${index}`
  }]));
}
function modelProfileDiagnostics(view) {
  const profileNames = new Set(Object.keys(view.model_profiles ?? {}));
  return [
    ...profileShadowDiagnostics(view),
    ...profileSpliceDiagnostics("categories", view.categories, profileNames),
    ...profileSpliceDiagnostics("agents", view.agents, profileNames)
  ];
}
function cycleDiagnostics(catalog) {
  if (catalog === undefined)
    return [];
  return findModelCatalogCycles(catalog).map((name) => ({
    kind: "model_catalog_cycle",
    message: catalog[name]?.model === name ? `Model catalog entry "${name}" references itself` : `Model catalog entry "${name}" participates in a reference cycle`,
    path: `models.${name}.model`
  }));
}
function resolveModelReferences(view) {
  const cycles = cycleDiagnostics(view.models);
  const diagnostics = [...cycles, ...modelProfileDiagnostics(view)];
  const cycleNames = new Set;
  for (const diagnostic of cycles) {
    const name = diagnostic.path.split(".")[1];
    if (name !== undefined)
      cycleNames.add(name);
  }
  const agents = view.agents === undefined ? undefined : Object.fromEntries(Object.entries(view.agents).map(([name, definition]) => [
    name,
    resolveAgentDefinition(definition, view.models, cycleNames)
  ]));
  const categories = view.categories === undefined ? undefined : Object.fromEntries(Object.entries(view.categories).map(([name, definition]) => [
    name,
    resolveCategoryDefinition(definition, view.models, cycleNames)
  ]));
  const modelProfiles = view.model_profiles === undefined ? undefined : Object.fromEntries(Object.entries(view.model_profiles).map(([name, definition]) => [
    name,
    resolveModelProfile(definition, view.models, cycleNames)
  ]));
  return {
    diagnostics,
    view: {
      ...view,
      ...agents === undefined ? {} : { agents },
      ...categories === undefined ? {} : { categories },
      ...modelProfiles === undefined ? {} : { model_profiles: modelProfiles }
    }
  };
}

// ../../../../omo-engine/omo-opencode/src/shared/config-errors.ts
var configLoadErrors = [];
function addConfigLoadError(error) {
  configLoadErrors.push(error);
}

// ../../../../omo-engine/utils/src/deep-merge.ts
var DANGEROUS_KEYS2 = new Set(["__proto__", "constructor", "prototype"]);
var MAX_DEPTH = 50;
function isUnsafeObjectKey2(key) {
  return DANGEROUS_KEYS2.has(key);
}
function isPlainObject3(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.prototype.toString.call(value) === "[object Object]";
}
function deepMerge(base, override, depth = 0) {
  if (!base && !override)
    return;
  if (!base)
    return override;
  if (!override)
    return base;
  if (depth > MAX_DEPTH)
    return override ?? base;
  const result = { ...base };
  for (const key of Object.keys(override)) {
    if (isUnsafeObjectKey2(key))
      continue;
    const baseValue = base[key];
    const overrideValue = override[key];
    if (overrideValue === undefined)
      continue;
    if (isPlainObject3(baseValue) && isPlainObject3(overrideValue)) {
      result[key] = deepMerge(baseValue, overrideValue, depth + 1);
    } else {
      result[key] = overrideValue;
    }
  }
  return result;
}

// ../../../../omo-engine/utils/src/config-merge.ts
function mergeUniqueStrings(base, override) {
  return [...new Set([...base ?? [], ...override ?? []])];
}
function mergeUniqueStringsCaseInsensitive(base, override) {
  const seen = new Set;
  const result = [];
  for (const value of [...base ?? [], ...override ?? []]) {
    const key = value.toLowerCase();
    if (seen.has(key))
      continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

// ../../../../omo-engine/utils/src/record-type-guard.ts
function isRecord9(value) {
  return typeof value === "object" && value !== null;
}
function isPlainRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ../../../../../node_modules/.bun/js-yaml@5.4.2/node_modules/js-yaml/dist/js-yaml.mjs
/*! js-yaml 5.4.2 https://github.com/nodeca/js-yaml @license MIT */
var NOT_RESOLVED = Symbol("NOT_RESOLVED");
function defineScalarTag(tagName, options) {
  return {
    tagName,
    nodeKind: "scalar",
    implicit: options.implicit ?? false,
    matchByTagPrefix: options.matchByTagPrefix ?? false,
    implicitFirstChars: options.implicitFirstChars ?? null,
    resolve: options.resolve,
    identify: options.identify,
    represent: options.represent ?? ((data) => String(data)),
    representTagName: options.representTagName ?? (() => tagName)
  };
}
function defineSequenceTag(tagName, options) {
  const carrierIsResult = options.finalize === undefined;
  return {
    tagName,
    nodeKind: "sequence",
    implicit: false,
    matchByTagPrefix: options.matchByTagPrefix ?? false,
    create: options.create,
    addItem: options.addItem,
    finalize: options.finalize ?? ((carrier) => carrier),
    carrierIsResult,
    identify: options.identify,
    represent: options.represent ?? ((data) => data),
    representTagName: options.representTagName ?? (() => tagName)
  };
}
function defineMappingTag(tagName, options) {
  const carrierIsResult = options.finalize === undefined;
  return {
    tagName,
    nodeKind: "mapping",
    implicit: false,
    matchByTagPrefix: options.matchByTagPrefix ?? false,
    create: options.create,
    addPair: options.addPair,
    has: options.has,
    keys: options.keys,
    get: options.get,
    finalize: options.finalize ?? ((carrier) => carrier),
    carrierIsResult,
    identify: options.identify,
    represent: options.represent ?? ((data) => data),
    representTagName: options.representTagName ?? (() => tagName)
  };
}
var strTag = defineScalarTag("tag:yaml.org,2002:str", {
  resolve: (source) => source,
  identify: (data) => typeof data === "string"
});
var NULL_VALUES$1 = [
  "",
  "~",
  "null",
  "Null",
  "NULL"
];
var nullCoreTag = defineScalarTag("tag:yaml.org,2002:null", {
  implicit: true,
  implicitFirstChars: [
    "",
    "~",
    "n",
    "N"
  ],
  resolve: (source) => {
    if (NULL_VALUES$1.indexOf(source) !== -1)
      return null;
    return NOT_RESOLVED;
  },
  identify: (object) => object === null,
  represent: () => "null"
});
var nullJsonTag = defineScalarTag("tag:yaml.org,2002:null", {
  implicit: true,
  implicitFirstChars: ["n"],
  resolve: (source, isExplicit) => {
    if (source === "null" || isExplicit && source === "")
      return null;
    return NOT_RESOLVED;
  },
  identify: (object) => object === null,
  represent: () => "null"
});
var NULL_VALUES = [
  "",
  "~",
  "null",
  "Null",
  "NULL"
];
var nullYaml11Tag = defineScalarTag("tag:yaml.org,2002:null", {
  implicit: true,
  implicitFirstChars: [
    "",
    "~",
    "n",
    "N"
  ],
  resolve: (source) => {
    if (NULL_VALUES.indexOf(source) !== -1)
      return null;
    return NOT_RESOLVED;
  },
  identify: (object) => object === null,
  represent: () => "null"
});
var TRUE_VALUES$2 = [
  "true",
  "True",
  "TRUE"
];
var FALSE_VALUES$2 = [
  "false",
  "False",
  "FALSE"
];
var boolCoreTag = defineScalarTag("tag:yaml.org,2002:bool", {
  implicit: true,
  implicitFirstChars: [
    "t",
    "T",
    "f",
    "F"
  ],
  resolve: (source) => {
    if (TRUE_VALUES$2.indexOf(source) !== -1)
      return true;
    if (FALSE_VALUES$2.indexOf(source) !== -1)
      return false;
    return NOT_RESOLVED;
  },
  identify: (object) => Object.prototype.toString.call(object) === "[object Boolean]",
  represent: (object) => object ? "true" : "false"
});
var TRUE_VALUES$1 = ["true"];
var FALSE_VALUES$1 = ["false"];
var boolJsonTag = defineScalarTag("tag:yaml.org,2002:bool", {
  implicit: true,
  implicitFirstChars: ["t", "f"],
  resolve: (source) => {
    if (TRUE_VALUES$1.indexOf(source) !== -1)
      return true;
    if (FALSE_VALUES$1.indexOf(source) !== -1)
      return false;
    return NOT_RESOLVED;
  },
  identify: (object) => Object.prototype.toString.call(object) === "[object Boolean]",
  represent: (object) => object ? "true" : "false"
});
var TRUE_VALUES = [
  "true",
  "True",
  "TRUE",
  "y",
  "Y",
  "yes",
  "Yes",
  "YES",
  "on",
  "On",
  "ON"
];
var FALSE_VALUES = [
  "false",
  "False",
  "FALSE",
  "n",
  "N",
  "no",
  "No",
  "NO",
  "off",
  "Off",
  "OFF"
];
var boolYaml11Tag = defineScalarTag("tag:yaml.org,2002:bool", {
  implicit: true,
  implicitFirstChars: [
    "y",
    "Y",
    "n",
    "N",
    "t",
    "T",
    "f",
    "F",
    "o",
    "O"
  ],
  resolve: (source) => {
    if (TRUE_VALUES.indexOf(source) !== -1)
      return true;
    if (FALSE_VALUES.indexOf(source) !== -1)
      return false;
    return NOT_RESOLVED;
  },
  identify: (object) => Object.prototype.toString.call(object) === "[object Boolean]",
  represent: (object) => object ? "true" : "false"
});
var YAML_INTEGER_IMPLICIT_PATTERN$1 = /* @__PURE__ */ new RegExp("^(?:0o[0-7]+|0x[0-9a-fA-F]+|[-+]?[0-9]+)$");
var YAML_INTEGER_EXPLICIT_PATTERN$1 = /* @__PURE__ */ new RegExp("^(?:[-+]?0b[0-1]+|[-+]?0o[0-7]+|[-+]?0x[0-9a-fA-F]+|[-+]?[0-9]+)$");
function parseYamlInteger$2(source) {
  let value = source;
  let sign = 1;
  if (value[0] === "-" || value[0] === "+") {
    if (value[0] === "-")
      sign = -1;
    value = value.slice(1);
  }
  if (value.startsWith("0b"))
    return sign * parseInt(value.slice(2), 2);
  if (value.startsWith("0o"))
    return sign * parseInt(value.slice(2), 8);
  if (value.startsWith("0x"))
    return sign * parseInt(value.slice(2), 16);
  return sign * parseInt(value, 10);
}
function resolveYamlInteger$2(source, isExplicit) {
  if (isExplicit) {
    if (!YAML_INTEGER_EXPLICIT_PATTERN$1.test(source))
      return NOT_RESOLVED;
  } else if (!YAML_INTEGER_IMPLICIT_PATTERN$1.test(source))
    return NOT_RESOLVED;
  const result = parseYamlInteger$2(source);
  return Number.isFinite(result) ? result : NOT_RESOLVED;
}
var intCoreTag = defineScalarTag("tag:yaml.org,2002:int", {
  implicit: true,
  implicitFirstChars: [
    "-",
    "+",
    ..."0123456789"
  ],
  resolve: resolveYamlInteger$2,
  identify: (object) => Number.isInteger(object) && !Object.is(object, -0) && object.toString(10).indexOf("e") < 0,
  represent: (object) => object.toString(10)
});
var YAML_INTEGER_IMPLICIT_PATTERN = /* @__PURE__ */ new RegExp("^-?(?:0|[1-9][0-9]*)$");
var YAML_INTEGER_EXPLICIT_PATTERN = /* @__PURE__ */ new RegExp("^(?:[-+]?0b[0-1]+|[-+]?0o[0-7]+|[-+]?0x[0-9a-fA-F]+|[-+]?[0-9]+)$");
function parseYamlInteger$1(source) {
  let value = source;
  let sign = 1;
  if (value[0] === "-" || value[0] === "+") {
    if (value[0] === "-")
      sign = -1;
    value = value.slice(1);
  }
  if (value.startsWith("0b"))
    return sign * parseInt(value.slice(2), 2);
  if (value.startsWith("0o"))
    return sign * parseInt(value.slice(2), 8);
  if (value.startsWith("0x"))
    return sign * parseInt(value.slice(2), 16);
  return sign * parseInt(value, 10);
}
function resolveYamlInteger$1(source, isExplicit) {
  if (isExplicit) {
    if (!YAML_INTEGER_EXPLICIT_PATTERN.test(source))
      return NOT_RESOLVED;
  } else if (!YAML_INTEGER_IMPLICIT_PATTERN.test(source))
    return NOT_RESOLVED;
  const result = parseYamlInteger$1(source);
  return Number.isFinite(result) ? result : NOT_RESOLVED;
}
var intJsonTag = defineScalarTag("tag:yaml.org,2002:int", {
  implicit: true,
  implicitFirstChars: ["-", ..."0123456789"],
  resolve: resolveYamlInteger$1,
  identify: (object) => Number.isInteger(object) && !Object.is(object, -0) && object.toString(10).indexOf("e") < 0,
  represent: (object) => object.toString(10)
});
var YAML_INTEGER_PATTERN = /* @__PURE__ */ new RegExp("^(?:[-+]?0b[0-1_]+|[-+]?0[0-7_]+|[-+]?0x[0-9a-fA-F_]+|[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+|[-+]?(?:0|[1-9][0-9_]*))$");
function parseYamlInteger(source) {
  let value = source.replace(/_/g, "");
  let sign = 1;
  if (value[0] === "-" || value[0] === "+") {
    if (value[0] === "-")
      sign = -1;
    value = value.slice(1);
  }
  if (value.startsWith("0b"))
    return sign * parseInt(value.slice(2), 2);
  if (value.startsWith("0x"))
    return sign * parseInt(value.slice(2), 16);
  if (value.includes(":")) {
    let result = 0;
    for (const part of value.split(":"))
      result = result * 60 + Number(part);
    return sign * result;
  }
  if (value !== "0" && value[0] === "0")
    return sign * parseInt(value, 8);
  return sign * parseInt(value, 10);
}
function resolveYamlInteger(source) {
  if (!YAML_INTEGER_PATTERN.test(source))
    return NOT_RESOLVED;
  const result = parseYamlInteger(source);
  return Number.isFinite(result) ? result : NOT_RESOLVED;
}
var intYaml11Tag = defineScalarTag("tag:yaml.org,2002:int", {
  implicit: true,
  implicitFirstChars: [
    "-",
    "+",
    ..."0123456789"
  ],
  resolve: resolveYamlInteger,
  identify: (object) => Number.isInteger(object) && !Object.is(object, -0) && object.toString(10).indexOf("e") < 0,
  represent: (object) => object.toString(10)
});
var YAML_FLOAT_PATTERN$1 = /* @__PURE__ */ new RegExp("^(?:[-+]?[0-9]+(?:\\.[0-9]*)?(?:[eE][-+]?[0-9]+)?|[-+]?\\.[0-9]+(?:[eE][-+]?[0-9]+)?|[-+]?\\.(?:inf|Inf|INF)|\\.(?:nan|NaN|NAN))$");
var YAML_FLOAT_SPECIAL_PATTERN$1 = /* @__PURE__ */ new RegExp("^(?:[-+]?\\.(?:inf|Inf|INF)|\\.(?:nan|NaN|NAN))$");
function resolveYamlFloat$2(source) {
  if (!YAML_FLOAT_PATTERN$1.test(source))
    return NOT_RESOLVED;
  let value = source.toLowerCase();
  const sign = value[0] === "-" ? -1 : 1;
  if ("+-".includes(value[0]))
    value = value.slice(1);
  if (value === ".inf")
    return sign === 1 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  if (value === ".nan")
    return NaN;
  const result = sign * parseFloat(value);
  if (Number.isFinite(result) || YAML_FLOAT_SPECIAL_PATTERN$1.test(source))
    return result;
  return NOT_RESOLVED;
}
function representYamlFloat$2(object) {
  if (isNaN(object))
    return ".nan";
  if (object === Number.POSITIVE_INFINITY)
    return ".inf";
  if (object === Number.NEGATIVE_INFINITY)
    return "-.inf";
  if (Object.is(object, -0))
    return "-0.0";
  const result = object.toString(10);
  return /^[-+]?[0-9]+e/.test(result) ? result.replace("e", ".e") : result;
}
var floatCoreTag = defineScalarTag("tag:yaml.org,2002:float", {
  implicit: true,
  implicitFirstChars: [
    "-",
    "+",
    ".",
    ..."0123456789"
  ],
  resolve: resolveYamlFloat$2,
  identify: (object) => typeof object === "number" && (!Number.isInteger(object) || Object.is(object, -0) || object.toString(10).indexOf("e") >= 0),
  represent: representYamlFloat$2
});
var YAML_FLOAT_IMPLICIT_PATTERN = /* @__PURE__ */ new RegExp("^-?(?:0|[1-9][0-9]*)(?:\\.[0-9]*)?(?:[eE][-+]?[0-9]+)?$");
var YAML_FLOAT_EXPLICIT_PATTERN = /* @__PURE__ */ new RegExp("^(?:[-+]?[0-9]+(?:\\.[0-9]*)?(?:[eE][-+]?[0-9]+)?|[-+]?\\.[0-9]+(?:[eE][-+]?[0-9]+)?|[-+]?\\.(?:inf|Inf|INF)|\\.(?:nan|NaN|NAN))$");
function resolveYamlFloat$1(source, isExplicit) {
  if (isExplicit) {
    if (!YAML_FLOAT_EXPLICIT_PATTERN.test(source))
      return NOT_RESOLVED;
    let value = source.toLowerCase();
    const sign = value[0] === "-" ? -1 : 1;
    if ("+-".includes(value[0]))
      value = value.slice(1);
    if (value === ".inf")
      return sign === 1 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
    if (value === ".nan")
      return NaN;
    const result = sign * parseFloat(value);
    return Number.isFinite(result) ? result : NOT_RESOLVED;
  }
  if (!YAML_FLOAT_IMPLICIT_PATTERN.test(source))
    return NOT_RESOLVED;
  const result = Number(source);
  if (Number.isFinite(result))
    return result;
  return NOT_RESOLVED;
}
function representYamlFloat$1(object) {
  if (isNaN(object))
    return ".nan";
  if (object === Number.POSITIVE_INFINITY)
    return ".inf";
  if (object === Number.NEGATIVE_INFINITY)
    return "-.inf";
  if (Object.is(object, -0))
    return "-0.0";
  const result = object.toString(10);
  return /^[-+]?[0-9]+e/.test(result) ? result.replace("e", ".e") : result;
}
var floatJsonTag = defineScalarTag("tag:yaml.org,2002:float", {
  implicit: true,
  implicitFirstChars: ["-", ..."0123456789"],
  resolve: resolveYamlFloat$1,
  identify: (object) => typeof object === "number" && (!Number.isInteger(object) || Object.is(object, -0) || object.toString(10).indexOf("e") >= 0),
  represent: representYamlFloat$1
});
var YAML_FLOAT_PATTERN = /* @__PURE__ */ new RegExp("^(?:[-+]?(?:(?:[0-9][0-9_]*)?\\.[0-9_]*)(?:[eE][-+][0-9]+)?|[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+\\.[0-9_]*|[-+]?\\.(?:inf|Inf|INF)|\\.(?:nan|NaN|NAN))$");
var YAML_FLOAT_SPECIAL_PATTERN = /* @__PURE__ */ new RegExp("^(?:[-+]?\\.(?:inf|Inf|INF)|\\.(?:nan|NaN|NAN))$");
function resolveYamlFloat(source) {
  if (!YAML_FLOAT_PATTERN.test(source))
    return NOT_RESOLVED;
  let value = source.toLowerCase().replace(/_/g, "");
  const sign = value[0] === "-" ? -1 : 1;
  if ("+-".includes(value[0]))
    value = value.slice(1);
  if (value === ".inf")
    return sign === 1 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  if (value === ".nan")
    return NaN;
  let result = 0;
  if (value.includes(":")) {
    for (const part of value.split(":"))
      result = result * 60 + Number(part);
    result *= sign;
  } else
    result = sign * parseFloat(value);
  if (Number.isFinite(result) || YAML_FLOAT_SPECIAL_PATTERN.test(source))
    return result;
  return NOT_RESOLVED;
}
function representYamlFloat(object) {
  if (isNaN(object))
    return ".nan";
  if (object === Number.POSITIVE_INFINITY)
    return ".inf";
  if (object === Number.NEGATIVE_INFINITY)
    return "-.inf";
  if (Object.is(object, -0))
    return "-0.0";
  const result = object.toString(10);
  return /^[-+]?[0-9]+e/.test(result) ? result.replace("e", ".e") : result;
}
var floatYaml11Tag = defineScalarTag("tag:yaml.org,2002:float", {
  implicit: true,
  implicitFirstChars: [
    "-",
    "+",
    ".",
    ..."0123456789"
  ],
  resolve: resolveYamlFloat,
  identify: (object) => typeof object === "number" && (!Number.isInteger(object) || Object.is(object, -0) || object.toString(10).indexOf("e") >= 0),
  represent: representYamlFloat
});
var mergeTag = defineScalarTag("tag:yaml.org,2002:merge", {
  implicit: true,
  implicitFirstChars: ["<"],
  resolve: (source, isExplicit) => {
    if (source === "<<" || isExplicit && source === "")
      return "<<";
    return NOT_RESOLVED;
  },
  identify: () => false
});
var BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;
function resolveYamlBinary(source) {
  const input = source.replace(/\s/g, "");
  if (input.length % 4 !== 0 || !BASE64_PATTERN.test(input))
    return NOT_RESOLVED;
  const binary = atob(input);
  const result = new Uint8Array(binary.length);
  for (let index = 0;index < binary.length; index++)
    result[index] = binary.charCodeAt(index);
  return result;
}
function representYamlBinary(object) {
  let binary = "";
  for (let index = 0;index < object.length; index++)
    binary += String.fromCharCode(object[index]);
  return btoa(binary);
}
var binaryTag = defineScalarTag("tag:yaml.org,2002:binary", {
  resolve: resolveYamlBinary,
  identify: (object) => Object.prototype.toString.call(object) === "[object Uint8Array]",
  represent: representYamlBinary
});
var YAML_DATE_REGEXP = /* @__PURE__ */ new RegExp("^([0-9][0-9][0-9][0-9])-([0-9][0-9])-([0-9][0-9])$");
var YAML_TIMESTAMP_REGEXP = /* @__PURE__ */ new RegExp("^([0-9][0-9][0-9][0-9])-([0-9][0-9]?)-([0-9][0-9]?)(?:[Tt]|[ \\t]+)([0-9][0-9]?):([0-9][0-9]):([0-9][0-9])(?:\\.([0-9]*))?(?:[ \\t]*(Z|([-+])([0-9][0-9]?)(?::([0-9][0-9]))?))?$");
function makeUtcDate(year, month, day, hour = 0, minute = 0, second = 0, fraction = 0) {
  const date = new Date(Date.UTC(year, month, day, hour, minute, second, fraction));
  date.setUTCFullYear(year, month, day);
  return date;
}
function resolveYamlTimestamp(source) {
  let match = YAML_DATE_REGEXP.exec(source);
  if (match === null)
    match = YAML_TIMESTAMP_REGEXP.exec(source);
  if (match === null)
    return NOT_RESOLVED;
  const year = +match[1];
  const month = +match[2] - 1;
  const day = +match[3];
  if (!match[4]) {
    const date = makeUtcDate(year, month, day);
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day)
      return NOT_RESOLVED;
    return date;
  }
  const hour = +match[4];
  const minute = +match[5];
  const second = +match[6];
  let fraction = 0;
  if (hour > 23 || minute > 59 || second > 59)
    return NOT_RESOLVED;
  if (match[7]) {
    let value = match[7].slice(0, 3);
    while (value.length < 3)
      value += "0";
    fraction = +value;
  }
  const date = makeUtcDate(year, month, day, hour, minute, second, fraction);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day)
    return NOT_RESOLVED;
  if (match[9]) {
    const offsetHour = +match[10];
    const offsetMinute = +(match[11] || 0);
    if (offsetHour > 23 || offsetMinute > 59)
      return NOT_RESOLVED;
    const offset = (offsetHour * 60 + offsetMinute) * 60000;
    date.setTime(date.getTime() - (match[9] === "-" ? -offset : offset));
  }
  return date;
}
var timestampTag = defineScalarTag("tag:yaml.org,2002:timestamp", {
  implicit: true,
  implicitFirstChars: [..."0123456789"],
  resolve: resolveYamlTimestamp,
  identify: (object) => object instanceof Date,
  represent: (object) => object.toISOString()
});
var seqTag = defineSequenceTag("tag:yaml.org,2002:seq", {
  create: () => [],
  addItem: (container, item) => {
    container.push(item);
  },
  identify: Array.isArray
});
function isPlainObject4(data) {
  if (data === null || typeof data !== "object" || Array.isArray(data))
    return false;
  const prototype = Object.getPrototypeOf(data);
  return prototype === null || prototype === Object.prototype;
}
function pick2(object, keys) {
  const result = {};
  for (const key of keys)
    if (object[key] !== undefined)
      result[key] = object[key];
  return result;
}
var omapTag = defineSequenceTag("tag:yaml.org,2002:omap", {
  create: () => ({
    list: [],
    seen: /* @__PURE__ */ new Set
  }),
  addItem: (carrier, item) => {
    let key;
    if (item instanceof Map) {
      if (item.size !== 1)
        return "cannot resolve an ordered map item";
      key = item.keys().next().value;
    } else if (isPlainObject4(item)) {
      const itemKeys = Object.keys(item);
      if (itemKeys.length !== 1)
        return "cannot resolve an ordered map item";
      key = itemKeys[0];
    } else
      return "cannot resolve an ordered map item";
    if (carrier.seen.has(key))
      return "duplicate key in ordered map";
    carrier.seen.add(key);
    carrier.list.push(item);
    return "";
  },
  finalize: (carrier) => carrier.list,
  identify: () => false
});
var pairsTag = defineSequenceTag("tag:yaml.org,2002:pairs", {
  create: () => [],
  addItem: (container, item) => {
    if (item instanceof Map) {
      if (item.size !== 1)
        return "cannot resolve a pairs item";
      container.push(item.entries().next().value);
      return "";
    }
    if (Object.prototype.toString.call(item) !== "[object Object]")
      return "cannot resolve a pairs item";
    const object = item;
    const keys = Object.keys(object);
    if (keys.length !== 1)
      return "cannot resolve a pairs item";
    container.push([keys[0], object[keys[0]]]);
    return "";
  },
  identify: () => false
});
var mapTag = defineMappingTag("tag:yaml.org,2002:map", {
  create: () => ({}),
  identify: isPlainObject4,
  represent: (o) => {
    const map = /* @__PURE__ */ new Map;
    for (const key of Object.keys(o))
      map.set(key, o[key]);
    return map;
  },
  addPair: (container, key, value) => {
    if (key !== null && typeof key === "object")
      return "object-based map does not support complex keys";
    const normalizedKey = String(key);
    if (normalizedKey === "__proto__")
      Object.defineProperty(container, normalizedKey, {
        value,
        enumerable: true,
        configurable: true,
        writable: true
      });
    else
      container[normalizedKey] = value;
    return "";
  },
  has: (container, key) => {
    if (key !== null && typeof key === "object")
      return false;
    return Object.prototype.hasOwnProperty.call(container, String(key));
  },
  keys: (container) => Object.keys(container),
  get: (container, key) => {
    const normalizedKey = String(key);
    if (!Object.prototype.hasOwnProperty.call(container, normalizedKey))
      return null;
    return container[normalizedKey];
  }
});
var setTag = defineMappingTag("tag:yaml.org,2002:set", {
  create: () => /* @__PURE__ */ new Set,
  identify: (data) => data instanceof Set,
  represent: (data) => {
    const map = /* @__PURE__ */ new Map;
    for (const key of data)
      map.set(key, null);
    return map;
  },
  addPair: (container, key, value) => {
    if (value !== null)
      return "cannot resolve a set item";
    container.add(key);
    return "";
  },
  has: (container, key) => container.has(key),
  keys: (container) => container.keys(),
  get: () => null
});
function createTagDefinitionMap() {
  return {
    scalar: Object.create(null),
    sequence: Object.create(null),
    mapping: Object.create(null)
  };
}
function createTagDefinitionListMap() {
  return {
    scalar: [],
    sequence: [],
    mapping: []
  };
}
function compileTags(tags) {
  const result = [];
  for (const tag of tags) {
    let index = result.length;
    for (let previousIndex = 0;previousIndex < result.length; previousIndex++) {
      const previous = result[previousIndex];
      if (previous.nodeKind === tag.nodeKind && previous.tagName === tag.tagName && previous.matchByTagPrefix === tag.matchByTagPrefix) {
        index = previousIndex;
        break;
      }
    }
    result[index] = tag;
  }
  return result;
}
var Schema = class Schema {
  tags;
  implicitScalarTags;
  implicitScalarByFirstChar;
  implicitScalarAnyFirstChar;
  defaultScalarTag;
  defaultSequenceTag;
  defaultMappingTag;
  exact;
  prefix;
  constructor(tags) {
    const compiledTags = compileTags(tags);
    const implicitScalarTags = [];
    const exact = createTagDefinitionMap();
    const prefix = createTagDefinitionListMap();
    for (const tag of compiledTags) {
      if (tag.nodeKind === "scalar" && tag.implicit) {
        if (tag.matchByTagPrefix)
          throw new Error("Implicit scalar tags cannot match by tag prefix");
        implicitScalarTags.push(tag);
      }
      switch (tag.nodeKind) {
        case "scalar":
          if (tag.matchByTagPrefix)
            prefix.scalar.push(tag);
          else
            exact.scalar[tag.tagName] = tag;
          break;
        case "sequence":
          if (tag.matchByTagPrefix)
            prefix.sequence.push(tag);
          else
            exact.sequence[tag.tagName] = tag;
          break;
        case "mapping":
          if (tag.matchByTagPrefix)
            prefix.mapping.push(tag);
          else
            exact.mapping[tag.tagName] = tag;
          break;
      }
    }
    const implicitScalarAnyFirstChar = implicitScalarTags.filter((tag) => tag.implicitFirstChars === null);
    const keys = /* @__PURE__ */ new Set;
    for (const tag of implicitScalarTags)
      if (tag.implicitFirstChars !== null)
        for (const key of tag.implicitFirstChars)
          keys.add(key);
    const implicitScalarByFirstChar = /* @__PURE__ */ new Map;
    for (const key of keys)
      implicitScalarByFirstChar.set(key, implicitScalarTags.filter((tag) => tag.implicitFirstChars === null || tag.implicitFirstChars.indexOf(key) !== -1));
    const defaultScalarTag = exact.scalar["tag:yaml.org,2002:str"];
    if (!defaultScalarTag)
      throw new Error("schema does not define the default scalar tag (tag:yaml.org,2002:str)");
    this.tags = compiledTags;
    this.implicitScalarTags = implicitScalarTags;
    this.implicitScalarByFirstChar = implicitScalarByFirstChar;
    this.implicitScalarAnyFirstChar = implicitScalarAnyFirstChar;
    this.defaultScalarTag = defaultScalarTag;
    this.defaultSequenceTag = exact.sequence["tag:yaml.org,2002:seq"];
    this.defaultMappingTag = exact.mapping["tag:yaml.org,2002:map"];
    this.exact = exact;
    this.prefix = prefix;
  }
  lookupScalarTag(tagName) {
    const exactTag = this.exact.scalar[tagName];
    if (exactTag)
      return exactTag;
    for (const tag of this.prefix.scalar)
      if (tagName.startsWith(tag.tagName))
        return tag;
  }
  lookupSequenceTag(tagName) {
    const exactTag = this.exact.sequence[tagName];
    if (exactTag)
      return exactTag;
    for (const tag of this.prefix.sequence)
      if (tagName.startsWith(tag.tagName))
        return tag;
  }
  lookupMappingTag(tagName) {
    const exactTag = this.exact.mapping[tagName];
    if (exactTag)
      return exactTag;
    for (const tag of this.prefix.mapping)
      if (tagName.startsWith(tag.tagName))
        return tag;
  }
  resolveImplicitScalarTag(source) {
    const candidates = this.implicitScalarByFirstChar.get(source.charAt(0)) ?? this.implicitScalarAnyFirstChar;
    for (const tag of candidates) {
      const value = tag.resolve(source, false, tag.tagName);
      if (value !== NOT_RESOLVED)
        return {
          value,
          tag
        };
    }
    const tag = this.defaultScalarTag;
    return {
      value: tag.resolve(source, false, tag.tagName),
      tag
    };
  }
  withTags(...tags) {
    let flatTags = [];
    for (const tag of tags)
      flatTags = flatTags.concat(tag);
    return new Schema([...this.tags, ...flatTags]);
  }
};
var FAILSAFE_SCHEMA = new Schema([
  strTag,
  seqTag,
  mapTag
]);
var JSON_SCHEMA = new Schema([
  ...FAILSAFE_SCHEMA.tags,
  nullJsonTag,
  boolJsonTag,
  intJsonTag,
  floatJsonTag
]);
var CORE_SCHEMA = new Schema([
  ...FAILSAFE_SCHEMA.tags,
  nullCoreTag,
  boolCoreTag,
  intCoreTag,
  floatCoreTag
]);
var YAML11_SCHEMA = new Schema([
  ...FAILSAFE_SCHEMA.tags,
  nullYaml11Tag,
  boolYaml11Tag,
  intYaml11Tag,
  floatYaml11Tag,
  timestampTag,
  mergeTag,
  binaryTag,
  omapTag,
  pairsTag,
  setTag
]);
var DUMP_SCHEMA = YAML11_SCHEMA.withTags({
  ...intYaml11Tag,
  resolve: (source, isExplicit, tagName) => {
    const result = intYaml11Tag.resolve(source, isExplicit, tagName);
    return result === NOT_RESOLVED ? intCoreTag.resolve(source, isExplicit, tagName) : result;
  }
}, {
  ...floatYaml11Tag,
  resolve: (source, isExplicit, tagName) => {
    const result = floatYaml11Tag.resolve(source, isExplicit, tagName);
    return result === NOT_RESOLVED ? floatCoreTag.resolve(source, isExplicit, tagName) : result;
  }
});
var realMapTag = defineMappingTag("tag:yaml.org,2002:map", {
  create: () => /* @__PURE__ */ new Map,
  addPair: (container, key, value) => {
    container.set(key, value);
    return "";
  },
  has: (container, key) => container.has(key),
  keys: (container) => container.keys(),
  get: (container, key) => container.get(key),
  identify: (data) => data instanceof Map || isPlainObject4(data),
  represent: (data) => {
    if (data instanceof Map)
      return data;
    const map = /* @__PURE__ */ new Map;
    const obj = data;
    for (const key of Object.keys(obj))
      map.set(key, obj[key]);
    return map;
  }
});
function normalizeKey(key) {
  if (Array.isArray(key)) {
    const array = Array.prototype.slice.call(key);
    for (let index = 0;index < array.length; index++) {
      if (Array.isArray(array[index]))
        return null;
      if (typeof array[index] === "object" && Object.prototype.toString.call(array[index]) === "[object Object]")
        array[index] = "[object Object]";
    }
    return String(array);
  }
  if (typeof key === "object" && Object.prototype.toString.call(key) === "[object Object]")
    return "[object Object]";
  return String(key);
}
var legacyMapTag = defineMappingTag("tag:yaml.org,2002:map", {
  create: () => ({}),
  identify: isPlainObject4,
  represent: (o) => {
    const map = /* @__PURE__ */ new Map;
    for (const key of Object.keys(o))
      map.set(key, o[key]);
    return map;
  },
  addPair: (container, key, value) => {
    const normalizedKey = normalizeKey(key);
    if (normalizedKey === null)
      return "nested arrays are not supported inside keys";
    if (normalizedKey === "__proto__")
      Object.defineProperty(container, normalizedKey, {
        value,
        enumerable: true,
        configurable: true,
        writable: true
      });
    else
      container[normalizedKey] = value;
    return "";
  },
  has: (container, key) => {
    const normalizedKey = normalizeKey(key);
    return normalizedKey !== null && Object.prototype.hasOwnProperty.call(container, normalizedKey);
  },
  keys: (container) => Object.keys(container),
  get: (container, key) => {
    const normalizedKey = String(key);
    if (!Object.prototype.hasOwnProperty.call(container, normalizedKey))
      return null;
    return container[normalizedKey];
  }
});
var DEFAULT_SNIPPET_OPTIONS = {
  maxLength: 79,
  indent: 1,
  linesBefore: 3,
  linesAfter: 2
};
function getLine(buffer, lineStart, lineEnd, position, maxLineLength) {
  let head = "";
  let tail = "";
  const maxHalfLength = Math.floor(maxLineLength / 2) - 1;
  if (position - lineStart > maxHalfLength) {
    head = " ... ";
    lineStart = position - maxHalfLength + head.length;
  }
  if (lineEnd - position > maxHalfLength) {
    tail = " ...";
    lineEnd = position + maxHalfLength - tail.length;
  }
  return {
    str: head + buffer.slice(lineStart, lineEnd).replace(/\t/g, "→") + tail,
    pos: position - lineStart + head.length
  };
}
function padStart(string, max) {
  return " ".repeat(Math.max(max - string.length, 0)) + string;
}
function makeSnippet(mark, options) {
  if (!mark.buffer)
    return null;
  const opts = {
    ...DEFAULT_SNIPPET_OPTIONS,
    ...options
  };
  const re = /\r?\n|\r|\0/g;
  const lineStarts = [0];
  const lineEnds = [];
  let match;
  let foundLineNo = -1;
  while (match = re.exec(mark.buffer)) {
    lineEnds.push(match.index);
    lineStarts.push(match.index + match[0].length);
    if (mark.position <= match.index && foundLineNo < 0)
      foundLineNo = lineStarts.length - 2;
  }
  if (foundLineNo < 0)
    foundLineNo = lineStarts.length - 1;
  let result = "";
  const lineNoLength = Math.min(mark.line + opts.linesAfter, lineEnds.length).toString().length;
  const maxLineLength = opts.maxLength - (opts.indent + lineNoLength + 3);
  for (let i = 1;i <= opts.linesBefore; i++) {
    if (foundLineNo - i < 0)
      break;
    const line = getLine(mark.buffer, lineStarts[foundLineNo - i], lineEnds[foundLineNo - i], mark.position - (lineStarts[foundLineNo] - lineStarts[foundLineNo - i]), maxLineLength);
    result = `${" ".repeat(opts.indent)}${padStart((mark.line - i + 1).toString(), lineNoLength)} | ${line.str}
${result}`;
  }
  const line = getLine(mark.buffer, lineStarts[foundLineNo], lineEnds[foundLineNo], mark.position, maxLineLength);
  result += `${" ".repeat(opts.indent)}${padStart((mark.line + 1).toString(), lineNoLength)} | ${line.str}
`;
  result += `${"-".repeat(opts.indent + lineNoLength + 3 + line.pos)}^
`;
  for (let i = 1;i <= opts.linesAfter; i++) {
    if (foundLineNo + i >= lineEnds.length)
      break;
    const line = getLine(mark.buffer, lineStarts[foundLineNo + i], lineEnds[foundLineNo + i], mark.position - (lineStarts[foundLineNo] - lineStarts[foundLineNo + i]), maxLineLength);
    result += `${" ".repeat(opts.indent)}${padStart((mark.line + i + 1).toString(), lineNoLength)} | ${line.str}
`;
  }
  return result.replace(/\n$/, "");
}
function formatError2(exception, compact) {
  let where = "";
  if (!exception.mark)
    return exception.reason;
  if (exception.mark.name)
    where += `in "${exception.mark.name}" `;
  where += `(${exception.mark.line + 1}:${exception.mark.column + 1})`;
  if (!compact && exception.mark.snippet)
    where += `

${exception.mark.snippet}`;
  return `${exception.reason} ${where}`;
}
var YAMLException = class YAMLException extends Error {
  reason;
  mark;
  constructor(reason, mark) {
    super();
    this.name = "YAMLException";
    this.reason = reason;
    this.mark = mark;
    this.message = formatError2(this, false);
    if (Error.captureStackTrace)
      Error.captureStackTrace(this, this.constructor);
  }
  toString(compact) {
    return `${this.name}: ${formatError2(this, compact)}`;
  }
  static throwAt(source, position, message, filename = "") {
    let line = 0;
    let lineStart = 0;
    for (let index = 0;index < position; index++) {
      const ch = source.charCodeAt(index);
      if (ch === 10) {
        line++;
        lineStart = index + 1;
      } else if (ch === 13) {
        line++;
        if (source.charCodeAt(index + 1) === 10)
          index++;
        lineStart = index + 1;
      }
    }
    const mark = {
      name: filename,
      buffer: source,
      position,
      line,
      column: position - lineStart
    };
    mark.snippet = makeSnippet(mark);
    throw new YAMLException(message, mark);
  }
};
var EVENT_ID = {
  DOCUMENT: 1,
  SEQUENCE: 2,
  MAPPING: 3,
  SCALAR: 4,
  ALIAS: 5,
  POP: 6
};
var SCALAR_STYLE = {
  PLAIN: 1,
  SINGLE_QUOTED: 2,
  DOUBLE_QUOTED: 3,
  LITERAL_BLOCK: 4,
  FOLDED_BLOCK: 5
};
var COLLECTION_STYLE = {
  BLOCK: 1,
  FLOW: 2
};
var CHOMPING_MODE = {
  CLIP: 1,
  STRIP: 2,
  KEEP: 3
};
var NO_RANGE$3 = -1;
function simpleEscapeSequence(c) {
  switch (c) {
    case 48:
      return "\x00";
    case 97:
      return "\x07";
    case 98:
      return "\b";
    case 116:
      return "\t";
    case 9:
      return "\t";
    case 110:
      return `
`;
    case 118:
      return "\v";
    case 102:
      return "\f";
    case 114:
      return "\r";
    case 101:
      return "\x1B";
    case 32:
      return " ";
    case 34:
      return '"';
    case 47:
      return "/";
    case 92:
      return "\\";
    case 78:
      return "";
    case 95:
      return " ";
    case 76:
      return "\u2028";
    case 80:
      return "\u2029";
    default:
      return "";
  }
}
var simpleEscapeCheck = new Array(256);
var simpleEscapeMap = new Array(256);
for (let i = 0;i < 256; i++) {
  simpleEscapeCheck[i] = simpleEscapeSequence(i) ? 1 : 0;
  simpleEscapeMap[i] = simpleEscapeSequence(i);
}
function charFromCodepoint(c) {
  if (c <= 65535)
    return String.fromCharCode(c);
  return String.fromCharCode((c - 65536 >> 10) + 55296, (c - 65536 & 1023) + 56320);
}
function fromHexCode$1(c) {
  if (c >= 48 && c <= 57)
    return c - 48;
  return (c | 32) - 97 + 10;
}
function escapedHexLen$1(c) {
  if (c === 120)
    return 2;
  if (c === 117)
    return 4;
  return 8;
}
function skipFoldedBreaks(input, position, end) {
  let breaks = 0;
  while (position < end) {
    const ch = input.charCodeAt(position);
    if (ch === 10) {
      breaks++;
      position++;
    } else if (ch === 13) {
      breaks++;
      position++;
      if (input.charCodeAt(position) === 10)
        position++;
    } else if (ch === 32 || ch === 9)
      position++;
    else
      break;
  }
  return {
    position,
    breaks
  };
}
function foldedBreaks(count) {
  if (count === 1)
    return " ";
  return `
`.repeat(count - 1);
}
function getPlainValue(input, start, end) {
  let result = "";
  let position = start;
  let captureStart = start;
  let captureEnd = start;
  while (position < end) {
    const ch = input.charCodeAt(position);
    if (ch === 10 || ch === 13) {
      result += input.slice(captureStart, captureEnd);
      const fold = skipFoldedBreaks(input, position, end);
      result += foldedBreaks(fold.breaks);
      position = captureStart = captureEnd = fold.position;
    } else {
      position++;
      if (ch !== 32 && ch !== 9)
        captureEnd = position;
    }
  }
  return result + input.slice(captureStart, captureEnd);
}
function getSingleQuotedValue(input, start, end) {
  let result = "";
  let position = start;
  let captureStart = start;
  let captureEnd = start;
  while (position < end) {
    const ch = input.charCodeAt(position);
    if (ch === 39) {
      result += input.slice(captureStart, position) + "'";
      position += 2;
      captureStart = captureEnd = position;
    } else if (ch === 10 || ch === 13) {
      result += input.slice(captureStart, captureEnd);
      const fold = skipFoldedBreaks(input, position, end);
      result += foldedBreaks(fold.breaks);
      position = captureStart = captureEnd = fold.position;
    } else {
      position++;
      if (ch !== 32 && ch !== 9)
        captureEnd = position;
    }
  }
  return result + input.slice(captureStart, end);
}
function getDoubleQuotedValue(input, start, end) {
  let result = "";
  let position = start;
  let captureStart = start;
  let captureEnd = start;
  while (position < end) {
    const ch = input.charCodeAt(position);
    if (ch === 92) {
      result += input.slice(captureStart, position);
      position++;
      const escaped = input.charCodeAt(position);
      if (escaped === 10 || escaped === 13)
        position = skipFoldedBreaks(input, position, end).position;
      else if (escaped < 256 && simpleEscapeCheck[escaped]) {
        result += simpleEscapeMap[escaped];
        position++;
      } else {
        let hexLength = escapedHexLen$1(escaped);
        let hexResult = 0;
        for (;hexLength > 0; hexLength--) {
          position++;
          const digit = fromHexCode$1(input.charCodeAt(position));
          hexResult = (hexResult << 4) + digit;
        }
        result += charFromCodepoint(hexResult);
        position++;
      }
      captureStart = captureEnd = position;
    } else if (ch === 10 || ch === 13) {
      result += input.slice(captureStart, captureEnd);
      const fold = skipFoldedBreaks(input, position, end);
      result += foldedBreaks(fold.breaks);
      position = captureStart = captureEnd = fold.position;
    } else {
      position++;
      if (ch !== 32 && ch !== 9)
        captureEnd = position;
    }
  }
  return result + input.slice(captureStart, end);
}
function getBlockValue(input, start, end, indent, chomping, folded) {
  const textIndent = indent < 0 ? 0 : indent;
  const region = input.slice(start, end).replace(/\r\n?/g, `
`);
  const lines = region === "" ? [] : (region.endsWith(`
`) ? region.slice(0, -1) : region).split(`
`);
  let result = "";
  let didReadContent = false;
  let emptyLines = 0;
  let atMoreIndented = false;
  for (const line of lines) {
    let column = 0;
    while (column < textIndent && line.charCodeAt(column) === 32)
      column++;
    if (indent < 0 || column >= line.length) {
      emptyLines++;
      continue;
    }
    const content = line.slice(textIndent);
    const first = content.charCodeAt(0);
    if (folded)
      if (first === 32 || first === 9) {
        atMoreIndented = true;
        result += `
`.repeat(didReadContent ? 1 + emptyLines : emptyLines);
      } else if (atMoreIndented) {
        atMoreIndented = false;
        result += `
`.repeat(emptyLines + 1);
      } else if (emptyLines === 0) {
        if (didReadContent)
          result += " ";
      } else
        result += `
`.repeat(emptyLines);
    else
      result += `
`.repeat(didReadContent ? 1 + emptyLines : emptyLines);
    result += content;
    didReadContent = true;
    emptyLines = 0;
  }
  if (chomping === CHOMPING_MODE.KEEP)
    result += `
`.repeat(didReadContent ? 1 + emptyLines : emptyLines);
  else if (chomping !== CHOMPING_MODE.STRIP) {
    if (didReadContent)
      result += `
`;
  }
  return result;
}
function getScalarValue(input, scalar) {
  if (scalar.valueStart === NO_RANGE$3)
    return "";
  const { valueStart, valueEnd } = scalar;
  if (scalar.fast)
    return input.slice(valueStart, valueEnd);
  switch (scalar.style) {
    case SCALAR_STYLE.SINGLE_QUOTED:
      return getSingleQuotedValue(input, valueStart, valueEnd);
    case SCALAR_STYLE.DOUBLE_QUOTED:
      return getDoubleQuotedValue(input, valueStart, valueEnd);
    case SCALAR_STYLE.LITERAL_BLOCK:
      return getBlockValue(input, valueStart, valueEnd, scalar.indent, scalar.chomping, false);
    case SCALAR_STYLE.FOLDED_BLOCK:
      return getBlockValue(input, valueStart, valueEnd, scalar.indent, scalar.chomping, true);
    default:
      return getPlainValue(input, valueStart, valueEnd);
  }
}
var DEFAULT_TAG_HANDLERS = Object.assign(Object.create(null), {
  "!": "!",
  "!!": "tag:yaml.org,2002:"
});
function tagNameFull(rawTag, tagHandlers) {
  if (rawTag.startsWith("!<") && rawTag.endsWith(">"))
    return decodeURIComponent(rawTag.slice(2, -1));
  const handleEnd = rawTag.indexOf("!", 1);
  const handle = handleEnd === -1 ? "!" : rawTag.slice(0, handleEnd + 1);
  const prefix = tagHandlers?.[handle] ?? DEFAULT_TAG_HANDLERS[handle] ?? handle;
  return decodeURIComponent(prefix) + decodeURIComponent(rawTag.slice(handle.length));
}
var NO_RANGE$2 = -1;
var MERGE_TAG_NAME = "tag:yaml.org,2002:merge";
var DEFAULT_CONSTRUCTOR_OPTIONS = {
  filename: "",
  schema: CORE_SCHEMA,
  json: false,
  maxTotalMergeKeys: 1e4,
  maxAliases: -1
};
function eventPosition$1(event) {
  if ("tagStart" in event && event.tagStart !== NO_RANGE$2)
    return event.tagStart;
  if ("anchorStart" in event && event.anchorStart !== NO_RANGE$2)
    return event.anchorStart;
  if ("valueStart" in event && event.valueStart !== NO_RANGE$2)
    return event.valueStart;
  if ("start" in event)
    return event.start;
  return 0;
}
function throwError$1(state, message) {
  YAMLException.throwAt(state.source, state.position, message, state.filename);
}
function finalizeCollection(state, position, tag, carrier) {
  try {
    return tag.finalize(carrier);
  } catch (error) {
    if (error instanceof YAMLException)
      throw error;
    YAMLException.throwAt(state.source, position, error instanceof Error ? error.message : String(error), state.filename);
  }
}
function constructScalar(state, event) {
  const source = getScalarValue(state.source, event);
  const rawTag = event.tagStart === NO_RANGE$2 ? "" : state.source.slice(event.tagStart, event.tagEnd);
  const strTag = state.schema.defaultScalarTag;
  if (rawTag !== "") {
    if (rawTag === "!")
      return {
        value: source,
        tag: strTag
      };
    const tagName = tagNameFull(rawTag, state.tagHandlers);
    const scalarTag = state.schema.lookupScalarTag(tagName);
    if (scalarTag) {
      const result = scalarTag.resolve(source, true, tagName);
      if (result === NOT_RESOLVED)
        throwError$1(state, `cannot resolve a node with !<${tagName}> explicit tag`);
      return {
        value: result,
        tag: scalarTag
      };
    }
    const collectionTagDef = state.schema.lookupMappingTag(tagName) ?? state.schema.lookupSequenceTag(tagName);
    if (collectionTagDef) {
      if (source !== "")
        throwError$1(state, `cannot resolve a node with !<${tagName}> explicit tag`);
      const carrier = collectionTagDef.create(tagName);
      return {
        value: collectionTagDef.carrierIsResult ? carrier : finalizeCollection(state, state.position, collectionTagDef, carrier),
        tag: collectionTagDef
      };
    }
    throwError$1(state, `unknown scalar tag !<${tagName}>`);
  }
  if (event.style === SCALAR_STYLE.PLAIN)
    return state.schema.resolveImplicitScalarTag(source);
  return {
    value: strTag.resolve(source, false, strTag.tagName),
    tag: strTag
  };
}
function collectionTagName(state, event, defaultTagName) {
  const rawTag = event.tagStart === NO_RANGE$2 ? "" : state.source.slice(event.tagStart, event.tagEnd);
  return rawTag === "" || rawTag === "!" ? defaultTagName : tagNameFull(rawTag, state.tagHandlers);
}
function isMappingTag(tag) {
  return tag.nodeKind === "mapping";
}
function chargeMergeWork(state) {
  state.totalMergeKeys++;
  if (state.maxTotalMergeKeys !== -1 && state.totalMergeKeys > state.maxTotalMergeKeys)
    throwError$1(state, `merge keys exceeded maxTotalMergeKeys (${state.maxTotalMergeKeys})`);
}
function mergeKeys(state, frame, source, sourceTag) {
  chargeMergeWork(state);
  for (const sourceKey of sourceTag.keys(source)) {
    chargeMergeWork(state);
    if (frame.tag.has(frame.value, sourceKey))
      continue;
    const err = frame.tag.addPair(frame.value, sourceKey, sourceTag.get(source, sourceKey));
    if (err)
      throwError$1(state, err);
    frame.overridable ??= /* @__PURE__ */ new Set;
    frame.overridable.add(sourceKey);
  }
}
function mergeSource(state, frame, source, sourceTag) {
  state.position = frame.keyPosition;
  if (isMappingTag(sourceTag))
    mergeKeys(state, frame, source, sourceTag);
  else if (sourceTag.nodeKind === "sequence" && Array.isArray(source)) {
    if (source.length > 100)
      throwError$1(state, "abnormal merge sequence size");
    for (const element of source) {
      const elementTag = state.nodeTags.get(element);
      if (!elementTag)
        throwError$1(state, "cannot merge mappings; the provided source object is unacceptable");
      mergeKeys(state, frame, element, elementTag);
    }
  } else
    throwError$1(state, "cannot merge mappings; the provided source object is unacceptable");
}
function addMappingValue(state, frame, key, value, tag) {
  state.position = frame.keyPosition;
  if (frame.keyIsMerge) {
    mergeSource(state, frame, value, tag);
    return;
  }
  if (!state.json && frame.tag.has(frame.value, key) && !frame.overridable?.has(key))
    throwError$1(state, "duplicated mapping key");
  const err = frame.tag.addPair(frame.value, key, value);
  if (err)
    throwError$1(state, err);
  frame.overridable?.delete(key);
}
function addValue(state, value, tag) {
  const frame = state.frames[state.frames.length - 1];
  if (frame.kind === "document") {
    frame.value = value;
    frame.hasValue = true;
  } else if (frame.kind === "sequence") {
    if (isMappingTag(tag))
      state.nodeTags.set(value, tag);
    const err = frame.tag.addItem(frame.value, value, frame.index++);
    if (err)
      throwError$1(state, err);
  } else if (frame.hasKey) {
    const key = frame.key;
    frame.key = undefined;
    frame.hasKey = false;
    addMappingValue(state, frame, key, value, tag);
  } else {
    frame.key = value;
    frame.keyPosition = state.position;
    frame.hasKey = true;
    frame.keyIsMerge = tag.tagName === MERGE_TAG_NAME;
  }
}
function storeAnchor(state, event, value, tag, isValueFinal) {
  if (event.anchorStart !== NO_RANGE$2) {
    const anchor = {
      value,
      tag,
      isValueFinal
    };
    state.anchors.set(state.source.slice(event.anchorStart, event.anchorEnd), anchor);
    return anchor;
  }
  return null;
}
function constructFromEvents(events, options) {
  const state = {
    ...DEFAULT_CONSTRUCTOR_OPTIONS,
    ...options,
    events,
    documents: [],
    eventIndex: 0,
    position: 0,
    frames: [],
    anchors: /* @__PURE__ */ new Map,
    nodeTags: /* @__PURE__ */ new Map,
    tagHandlers: Object.create(null),
    totalMergeKeys: 0,
    aliasCount: 0
  };
  while (state.eventIndex < state.events.length) {
    const event = state.events[state.eventIndex++];
    state.position = eventPosition$1(event);
    switch (event.type) {
      case EVENT_ID.DOCUMENT:
        state.anchors = /* @__PURE__ */ new Map;
        state.nodeTags = /* @__PURE__ */ new Map;
        state.aliasCount = 0;
        state.tagHandlers = Object.create(null);
        for (const directive of event.directives)
          if (directive.kind === "tag")
            state.tagHandlers[directive.handle] = directive.prefix;
        state.frames.push({
          kind: "document",
          position: state.position,
          value: undefined,
          hasValue: false
        });
        break;
      case EVENT_ID.SCALAR: {
        const { value, tag } = constructScalar(state, event);
        storeAnchor(state, event, value, tag, true);
        addValue(state, value, tag);
        break;
      }
      case EVENT_ID.SEQUENCE: {
        const tagName = collectionTagName(state, event, "tag:yaml.org,2002:seq");
        const tag = state.schema.lookupSequenceTag(tagName);
        if (!tag)
          throwError$1(state, `unknown sequence tag !<${tagName}>`);
        const value = tag.create(tagName);
        const anchor = storeAnchor(state, event, value, tag, tag.carrierIsResult);
        state.frames.push({
          kind: "sequence",
          position: state.position,
          value,
          tag,
          anchor,
          index: 0
        });
        break;
      }
      case EVENT_ID.MAPPING: {
        const tagName = collectionTagName(state, event, "tag:yaml.org,2002:map");
        const tag = state.schema.lookupMappingTag(tagName);
        if (!tag)
          throwError$1(state, `unknown mapping tag !<${tagName}>`);
        const value = tag.create(tagName);
        const anchor = storeAnchor(state, event, value, tag, tag.carrierIsResult);
        state.frames.push({
          kind: "mapping",
          position: state.position,
          value,
          tag,
          anchor,
          key: undefined,
          keyPosition: state.position,
          hasKey: false,
          keyIsMerge: false,
          overridable: null
        });
        break;
      }
      case EVENT_ID.ALIAS: {
        if (state.maxAliases !== -1 && ++state.aliasCount > state.maxAliases)
          throwError$1(state, `aliases exceeded maxAliases (${state.maxAliases})`);
        const name = state.source.slice(event.anchorStart, event.anchorEnd);
        const anchor = state.anchors.get(name);
        if (!anchor)
          throwError$1(state, `unidentified alias "${name}"`);
        if (!anchor.isValueFinal)
          throwError$1(state, `recursive alias "${name}" is not supported for tag ${anchor.tag.tagName} because it uses finalize()`);
        addValue(state, anchor.value, anchor.tag);
        break;
      }
      case EVENT_ID.POP: {
        const frame = state.frames.pop();
        if (frame.kind === "mapping" && frame.hasKey) {
          state.position = frame.keyPosition;
          throwError$1(state, "incomplete mapping pair in event stream");
        }
        if (frame.kind === "document")
          state.documents.push(frame.value);
        else {
          const value = frame.tag.carrierIsResult ? frame.value : finalizeCollection(state, frame.position, frame.tag, frame.value);
          if (frame.anchor) {
            frame.anchor.value = value;
            frame.anchor.isValueFinal = true;
          }
          addValue(state, value, frame.tag);
        }
        break;
      }
    }
  }
  return state.documents;
}
var NO_RANGE$1 = -1;
var HAS_OWN = Object.prototype.hasOwnProperty;
var CONTEXT_FLOW_IN = 1;
var CONTEXT_FLOW_OUT = 2;
var CONTEXT_BLOCK_IN = 3;
var CONTEXT_BLOCK_OUT = 4;
var PATTERN_NON_PRINTABLE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x84\x86-\x9F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/;
var PATTERN_FLOW_INDICATORS = /[,\[\]{}]/;
var PATTERN_TAG_HANDLE = /^(?:!|!!|![0-9A-Za-z-]+!)$/;
var NS_URI_CHAR = String.raw`(?:%[0-9A-Fa-f]{2}|[0-9A-Za-z\-#;/?:@&=+$,_.!~*'()\[\]])`;
var NS_TAG_CHAR = String.raw`(?:%[0-9A-Fa-f]{2}|[0-9A-Za-z\-#;/?:@&=+$.~*'()_])`;
var PATTERN_TAG_URI = new RegExp(`^(?:${NS_URI_CHAR})*$`);
var PATTERN_TAG_SUFFIX = new RegExp(`^(?:${NS_TAG_CHAR})+$`);
var PATTERN_TAG_PREFIX = new RegExp(`^(?:!(?:${NS_URI_CHAR})*|${NS_TAG_CHAR}(?:${NS_URI_CHAR})*)$`);
var DEFAULT_PARSER_OPTIONS = {
  filename: "",
  maxDepth: 100
};
function addDocumentEvent(state, explicitStart, explicitEnd) {
  state.events.push({
    type: EVENT_ID.DOCUMENT,
    explicitStart,
    explicitEnd,
    directives: state.directives
  });
}
function addSequenceEvent(state, start, anchorStart, anchorEnd, tagStart, tagEnd, style) {
  state.events.push({
    type: EVENT_ID.SEQUENCE,
    start,
    anchorStart,
    anchorEnd,
    tagStart,
    tagEnd,
    style
  });
}
function addMappingEvent(state, start, anchorStart, anchorEnd, tagStart, tagEnd, style) {
  state.events.push({
    type: EVENT_ID.MAPPING,
    start,
    anchorStart,
    anchorEnd,
    tagStart,
    tagEnd,
    style
  });
}
function insertFlowPairMappingEvent(state, snapshot) {
  state.events.splice(snapshot.eventsLength, 0, {
    type: EVENT_ID.MAPPING,
    start: snapshot.position,
    anchorStart: NO_RANGE$1,
    anchorEnd: NO_RANGE$1,
    tagStart: NO_RANGE$1,
    tagEnd: NO_RANGE$1,
    style: COLLECTION_STYLE.FLOW
  });
}
function addScalarEvent(state, valueStart, valueEnd, anchorStart, anchorEnd, tagStart, tagEnd, style, chomping = CHOMPING_MODE.CLIP, indent = -1, fast = false) {
  state.events.push({
    type: EVENT_ID.SCALAR,
    valueStart,
    valueEnd,
    anchorStart,
    anchorEnd,
    tagStart,
    tagEnd,
    style,
    chomping,
    indent,
    fast
  });
}
function addAliasEvent(state, anchorStart, anchorEnd) {
  state.events.push({
    type: EVENT_ID.ALIAS,
    anchorStart,
    anchorEnd
  });
}
function addPopEvent(state) {
  state.events.push({ type: EVENT_ID.POP });
}
function addEmptyScalarEvent(state) {
  addScalarEvent(state, NO_RANGE$1, NO_RANGE$1, NO_RANGE$1, NO_RANGE$1, NO_RANGE$1, NO_RANGE$1, SCALAR_STYLE.PLAIN);
}
function emptyProperties() {
  return {
    anchorStart: NO_RANGE$1,
    anchorEnd: NO_RANGE$1,
    tagStart: NO_RANGE$1,
    tagEnd: NO_RANGE$1
  };
}
function snapshotState(state) {
  return {
    position: state.position,
    line: state.line,
    lineStart: state.lineStart,
    lineIndent: state.lineIndent,
    firstTabInLine: state.firstTabInLine,
    eventsLength: state.events.length
  };
}
function restoreState(state, snapshot) {
  state.position = snapshot.position;
  state.line = snapshot.line;
  state.lineStart = snapshot.lineStart;
  state.lineIndent = snapshot.lineIndent;
  state.firstTabInLine = snapshot.firstTabInLine;
  state.events.length = snapshot.eventsLength;
}
function throwError(state, message) {
  YAMLException.throwAt(state.input.slice(0, state.length), state.position, message, state.filename);
}
function isEol(c) {
  return c === 10 || c === 13;
}
function isWhiteSpace2(c) {
  return c === 9 || c === 32;
}
function isWsOrEol(c) {
  return isWhiteSpace2(c) || isEol(c);
}
function isWsOrEolOrEnd(c) {
  return c === 0 || isWsOrEol(c);
}
function isFlowIndicator(c) {
  return c === 44 || c === 91 || c === 93 || c === 123 || c === 125;
}
function fromDecimalCode(c) {
  return c >= 48 && c <= 57 ? c - 48 : -1;
}
function fromHexCode(c) {
  if (c >= 48 && c <= 57)
    return c - 48;
  const lc = c | 32;
  if (lc >= 97 && lc <= 102)
    return lc - 97 + 10;
  return -1;
}
function escapedHexLen(c) {
  if (c === 120)
    return 2;
  if (c === 117)
    return 4;
  if (c === 85)
    return 8;
  return 0;
}
function isSimpleEscape(c) {
  return c === 48 || c === 97 || c === 98 || c === 116 || c === 9 || c === 110 || c === 118 || c === 102 || c === 114 || c === 101 || c === 32 || c === 34 || c === 47 || c === 92 || c === 78 || c === 95 || c === 76 || c === 80;
}
function consumeLineBreak(state) {
  if (state.input.charCodeAt(state.position) === 10)
    state.position++;
  else {
    state.position++;
    if (state.input.charCodeAt(state.position) === 10)
      state.position++;
  }
  state.line++;
  state.lineStart = state.position;
  state.lineIndent = 0;
  state.firstTabInLine = -1;
}
function skipSeparationSpace(state, allowComments) {
  let lineBreaks = 0;
  let ch = state.input.charCodeAt(state.position);
  let hasSeparation = state.position === state.lineStart || isWsOrEol(state.input.charCodeAt(state.position - 1));
  while (ch !== 0) {
    while (isWhiteSpace2(ch)) {
      hasSeparation = true;
      if (ch === 9 && state.firstTabInLine === -1)
        state.firstTabInLine = state.position;
      ch = state.input.charCodeAt(++state.position);
    }
    if (allowComments && hasSeparation && ch === 35)
      do
        ch = state.input.charCodeAt(++state.position);
      while (!isEol(ch) && ch !== 0);
    if (!isEol(ch))
      break;
    consumeLineBreak(state);
    lineBreaks++;
    hasSeparation = true;
    ch = state.input.charCodeAt(state.position);
    while (ch === 32) {
      state.lineIndent++;
      ch = state.input.charCodeAt(++state.position);
    }
  }
  return lineBreaks;
}
function testDocumentSeparator(state, position = state.position) {
  const ch = state.input.charCodeAt(position);
  if ((ch === 45 || ch === 46) && ch === state.input.charCodeAt(position + 1) && ch === state.input.charCodeAt(position + 2)) {
    const following = state.input.charCodeAt(position + 3);
    return following === 0 || isWsOrEol(following);
  }
  return false;
}
function skipByteOrderMark(state) {
  if (state.position === state.lineStart && state.input.charCodeAt(state.position) === 65279) {
    state.position++;
    state.lineStart = state.position;
  }
}
function testDocumentBoundary(state) {
  if (state.position !== state.lineStart)
    return false;
  if (testDocumentSeparator(state))
    return true;
  if (state.input.charCodeAt(state.position) !== 65279)
    return false;
  const snapshot = snapshotState(state);
  skipByteOrderMark(state);
  skipSeparationSpace(state, true);
  const ch = state.input.charCodeAt(state.position);
  const result = state.position === state.lineStart && (ch === 37 || ch === 45 && testDocumentSeparator(state));
  restoreState(state, snapshot);
  return result;
}
function skipUntilLineEnd(state) {
  let ch = state.input.charCodeAt(state.position);
  while (ch !== 0 && !isEol(ch))
    ch = state.input.charCodeAt(++state.position);
}
function checkPrintable(state, start, end) {
  if (PATTERN_NON_PRINTABLE.test(state.input.slice(start, end)))
    throwError(state, "the stream contains non-printable characters");
}
function readTagProperty(state, props, inFlow) {
  if (state.input.charCodeAt(state.position) !== 33)
    return false;
  if (props.tagStart !== NO_RANGE$1)
    throwError(state, "duplication of a tag property");
  const start = state.position;
  let isVerbatim = false;
  let isNamed = false;
  let tagHandle = "!";
  let ch = state.input.charCodeAt(++state.position);
  if (ch === 60) {
    isVerbatim = true;
    ch = state.input.charCodeAt(++state.position);
  } else if (ch === 33) {
    isNamed = true;
    tagHandle = "!!";
    ch = state.input.charCodeAt(++state.position);
  }
  let suffixStart = state.position;
  let tagName;
  if (isVerbatim) {
    while (ch !== 0 && ch !== 62)
      ch = state.input.charCodeAt(++state.position);
    if (ch !== 62)
      throwError(state, "unexpected end of the stream within a verbatim tag");
    tagName = state.input.slice(suffixStart, state.position);
    state.position++;
  } else {
    while (ch !== 0 && !isWsOrEol(ch) && !(inFlow && isFlowIndicator(ch))) {
      if (ch === 33)
        if (!isNamed) {
          tagHandle = state.input.slice(suffixStart - 1, state.position + 1);
          if (!PATTERN_TAG_HANDLE.test(tagHandle))
            throwError(state, "named tag handle cannot contain such characters");
          isNamed = true;
          suffixStart = state.position + 1;
        } else
          throwError(state, "tag suffix cannot contain exclamation marks");
      ch = state.input.charCodeAt(++state.position);
    }
    tagName = state.input.slice(suffixStart, state.position);
    if (PATTERN_FLOW_INDICATORS.test(tagName))
      throwError(state, "tag suffix cannot contain flow indicator characters");
  }
  if (tagName && !(isVerbatim ? PATTERN_TAG_URI.test(tagName) : PATTERN_TAG_SUFFIX.test(tagName)))
    throwError(state, `tag name cannot contain such characters: ${tagName}`);
  if (!isVerbatim && tagHandle !== "!" && tagHandle !== "!!" && !HAS_OWN.call(state.tagHandlers, tagHandle))
    throwError(state, `undeclared tag handle "${tagHandle}"`);
  props.tagStart = start;
  props.tagEnd = state.position;
  return true;
}
function readAnchorProperty(state, props) {
  if (state.input.charCodeAt(state.position) !== 38)
    return false;
  if (props.anchorStart !== NO_RANGE$1)
    throwError(state, "duplication of an anchor property");
  state.position++;
  const start = state.position;
  while (state.input.charCodeAt(state.position) !== 0 && !isWsOrEol(state.input.charCodeAt(state.position)) && !isFlowIndicator(state.input.charCodeAt(state.position)))
    state.position++;
  if (state.position === start)
    throwError(state, "name of an anchor node must contain at least one character");
  props.anchorStart = start;
  props.anchorEnd = state.position;
  return true;
}
function readAlias(state, props) {
  if (state.input.charCodeAt(state.position) !== 42)
    return false;
  if (props.anchorStart !== NO_RANGE$1 || props.tagStart !== NO_RANGE$1)
    throwError(state, "alias node should not have any properties");
  state.position++;
  const start = state.position;
  while (state.input.charCodeAt(state.position) !== 0 && !isWsOrEol(state.input.charCodeAt(state.position)) && !isFlowIndicator(state.input.charCodeAt(state.position)))
    state.position++;
  if (state.position === start)
    throwError(state, "name of an alias node must contain at least one character");
  addAliasEvent(state, start, state.position);
  return true;
}
function readFlowScalarBreak(state, nodeIndent) {
  skipSeparationSpace(state, false);
  if (state.lineIndent < nodeIndent)
    throwError(state, "deficient indentation");
}
function readSingleQuotedScalar(state, nodeIndent, props) {
  if (state.input.charCodeAt(state.position) !== 39)
    return false;
  state.position++;
  const start = state.position;
  let simple = true;
  while (state.input.charCodeAt(state.position) !== 0) {
    const ch = state.input.charCodeAt(state.position);
    if (ch === 39) {
      if (state.input.charCodeAt(state.position + 1) === 39) {
        simple = false;
        state.position += 2;
        continue;
      }
      const end = state.position;
      state.position++;
      addScalarEvent(state, start, end, props.anchorStart, props.anchorEnd, props.tagStart, props.tagEnd, SCALAR_STYLE.SINGLE_QUOTED, CHOMPING_MODE.CLIP, -1, simple);
      return true;
    }
    if (isEol(ch)) {
      simple = false;
      readFlowScalarBreak(state, nodeIndent);
    } else if (state.position === state.lineStart && testDocumentSeparator(state))
      throwError(state, "unexpected end of the document within a single quoted scalar");
    else if (ch !== 9 && ch < 32)
      throwError(state, "expected valid JSON character");
    else
      state.position++;
  }
  throwError(state, "unexpected end of the stream within a single quoted scalar");
}
function readDoubleQuotedScalar(state, nodeIndent, props) {
  if (state.input.charCodeAt(state.position) !== 34)
    return false;
  state.position++;
  const start = state.position;
  let simple = true;
  while (state.input.charCodeAt(state.position) !== 0) {
    const ch = state.input.charCodeAt(state.position);
    if (ch === 34) {
      const end = state.position;
      state.position++;
      addScalarEvent(state, start, end, props.anchorStart, props.anchorEnd, props.tagStart, props.tagEnd, SCALAR_STYLE.DOUBLE_QUOTED, CHOMPING_MODE.CLIP, -1, simple);
      return true;
    }
    if (ch === 92) {
      simple = false;
      const escaped = state.input.charCodeAt(++state.position);
      if (isEol(escaped))
        readFlowScalarBreak(state, nodeIndent);
      else if (isSimpleEscape(escaped))
        state.position++;
      else {
        let hexLength = escapedHexLen(escaped);
        if (hexLength === 0)
          throwError(state, "unknown escape sequence");
        while (hexLength-- > 0) {
          state.position++;
          if (fromHexCode(state.input.charCodeAt(state.position)) < 0)
            throwError(state, "expected hexadecimal character");
        }
        state.position++;
      }
    } else if (isEol(ch)) {
      simple = false;
      readFlowScalarBreak(state, nodeIndent);
    } else if (state.position === state.lineStart && testDocumentSeparator(state))
      throwError(state, "unexpected end of the document within a double quoted scalar");
    else if (ch !== 9 && ch < 32)
      throwError(state, "expected valid JSON character");
    else
      state.position++;
  }
  throwError(state, "unexpected end of the stream within a double quoted scalar");
}
function readBlockScalar(state, parentIndent, props) {
  const ch = state.input.charCodeAt(state.position);
  let chomping = CHOMPING_MODE.CLIP;
  let indent = -1;
  let detectedIndent = false;
  if (ch !== 124 && ch !== 62)
    return false;
  const style = ch === 124 ? SCALAR_STYLE.LITERAL_BLOCK : SCALAR_STYLE.FOLDED_BLOCK;
  state.position++;
  while (state.input.charCodeAt(state.position) !== 0) {
    const current = state.input.charCodeAt(state.position);
    const digit = fromDecimalCode(current);
    if (current === 43 || current === 45) {
      if (chomping !== CHOMPING_MODE.CLIP)
        throwError(state, "repeat of a chomping mode identifier");
      chomping = current === 43 ? CHOMPING_MODE.KEEP : CHOMPING_MODE.STRIP;
      state.position++;
    } else if (digit >= 0) {
      if (digit === 0)
        throwError(state, "bad explicit indentation width of a block scalar; it cannot be less than one");
      if (detectedIndent)
        throwError(state, "repeat of an indentation width identifier");
      indent = parentIndent + digit - 1;
      detectedIndent = true;
      state.position++;
    } else
      break;
  }
  let hadWhitespace = false;
  while (isWhiteSpace2(state.input.charCodeAt(state.position))) {
    hadWhitespace = true;
    state.position++;
  }
  if (hadWhitespace && state.input.charCodeAt(state.position) === 35)
    skipUntilLineEnd(state);
  if (isEol(state.input.charCodeAt(state.position)))
    consumeLineBreak(state);
  else if (state.input.charCodeAt(state.position) !== 0)
    throwError(state, "a line break is expected");
  let contentIndent = detectedIndent ? indent : -1;
  let maxLeadingIndent = 0;
  const valueStart = state.position;
  let valueEnd = state.position;
  while (state.input.charCodeAt(state.position) !== 0) {
    const linePosition = state.position;
    let column = 0;
    while (state.input.charCodeAt(linePosition + column) === 32)
      column++;
    const first = state.input.charCodeAt(linePosition + column);
    if (first === 0) {
      if (contentIndent >= 0) {
        if (column > contentIndent)
          valueEnd = linePosition + column;
      } else if (column > 0)
        valueEnd = linePosition + column;
      break;
    }
    if (testDocumentBoundary(state))
      break;
    if (!detectedIndent && contentIndent === -1 && isEol(first))
      maxLeadingIndent = Math.max(maxLeadingIndent, column);
    if (!detectedIndent && contentIndent === -1 && !isEol(first)) {
      if (first === 9 && column < parentIndent) {
        state.position = linePosition + column;
        throwError(state, "tab characters must not be used in indentation");
      }
      if (column < maxLeadingIndent) {
        state.position = linePosition + column;
        throwError(state, "bad indentation of a mapping entry");
      }
    }
    if (contentIndent === -1 && first !== 0 && !isEol(first) && column < parentIndent) {
      state.lineIndent = column;
      state.position = linePosition + column;
      break;
    }
    if (!detectedIndent && first !== 0 && !isEol(first) && contentIndent === -1)
      contentIndent = column;
    const requiredIndent = contentIndent === -1 ? parentIndent + 1 : contentIndent;
    if (first !== 0 && !isEol(first) && column < requiredIndent) {
      state.lineIndent = column;
      state.position = linePosition + column;
      break;
    }
    skipUntilLineEnd(state);
    valueEnd = state.position;
    if (isEol(state.input.charCodeAt(state.position))) {
      consumeLineBreak(state);
      valueEnd = state.position;
    }
  }
  checkPrintable(state, valueStart, valueEnd);
  addScalarEvent(state, valueStart, valueEnd, props.anchorStart, props.anchorEnd, props.tagStart, props.tagEnd, style, chomping, contentIndent);
  return true;
}
function canStartPlainScalar(state, nodeContext) {
  const ch = state.input.charCodeAt(state.position);
  const inFlow = nodeContext === CONTEXT_FLOW_IN;
  if (ch === 0 || isWsOrEol(ch) || ch === 35 || ch === 38 || ch === 42 || ch === 33 || ch === 124 || ch === 62 || ch === 39 || ch === 34 || ch === 37 || ch === 64 || ch === 96 || inFlow && isFlowIndicator(ch))
    return false;
  if (ch === 63 || ch === 45) {
    const following = state.input.charCodeAt(state.position + 1);
    if (isWsOrEolOrEnd(following) || inFlow && isFlowIndicator(following))
      return false;
  }
  return true;
}
function readPlainScalar(state, nodeIndent, nodeContext, props) {
  if (!canStartPlainScalar(state, nodeContext))
    return false;
  const start = state.position;
  let end = state.position;
  let ch = state.input.charCodeAt(state.position);
  const inFlow = nodeContext === CONTEXT_FLOW_IN;
  let multiline = false;
  while (ch !== 0) {
    if (testDocumentBoundary(state))
      break;
    if (ch === 58) {
      const following = state.input.charCodeAt(state.position + 1);
      if (isWsOrEolOrEnd(following) || inFlow && isFlowIndicator(following))
        break;
    } else if (ch === 35) {
      if (isWsOrEol(state.input.charCodeAt(state.position - 1)))
        break;
    } else if (inFlow && isFlowIndicator(ch))
      break;
    else if (isEol(ch)) {
      const savedPosition = state.position;
      const savedLine = state.line;
      const savedLineStart = state.lineStart;
      const savedLineIndent = state.lineIndent;
      skipSeparationSpace(state, false);
      if (state.lineIndent >= nodeIndent) {
        multiline = true;
        ch = state.input.charCodeAt(state.position);
        continue;
      }
      state.position = savedPosition;
      state.line = savedLine;
      state.lineStart = savedLineStart;
      state.lineIndent = savedLineIndent;
      break;
    }
    if (!isWhiteSpace2(ch))
      end = state.position + 1;
    ch = state.input.charCodeAt(++state.position);
  }
  if (end === start)
    return false;
  checkPrintable(state, start, end);
  addScalarEvent(state, start, end, props.anchorStart, props.anchorEnd, props.tagStart, props.tagEnd, SCALAR_STYLE.PLAIN, CHOMPING_MODE.CLIP, -1, !multiline);
  return true;
}
function skipFlowSeparationSpace(state, nodeIndent) {
  const startLine = state.line;
  skipSeparationSpace(state, true);
  if (state.line > startLine && state.lineIndent < nodeIndent || state.firstTabInLine !== -1 && state.lineIndent < nodeIndent)
    throwError(state, "deficient indentation");
}
function readFlowCollection(state, nodeIndent, props) {
  const ch = state.input.charCodeAt(state.position);
  const isMapping = ch === 123;
  const start = state.position;
  let readNext = true;
  if (ch !== 91 && ch !== 123)
    return false;
  const terminator = isMapping ? 125 : 93;
  if (isMapping)
    addMappingEvent(state, start, props.anchorStart, props.anchorEnd, props.tagStart, props.tagEnd, COLLECTION_STYLE.FLOW);
  else
    addSequenceEvent(state, start, props.anchorStart, props.anchorEnd, props.tagStart, props.tagEnd, COLLECTION_STYLE.FLOW);
  state.position++;
  while (state.input.charCodeAt(state.position) !== 0) {
    skipFlowSeparationSpace(state, nodeIndent);
    let ch = state.input.charCodeAt(state.position);
    if (ch === terminator) {
      state.position++;
      addPopEvent(state);
      return true;
    } else if (!readNext)
      throwError(state, "missed comma between flow collection entries");
    else if (ch === 44)
      throwError(state, "expected the node content, but found ','");
    let isPair = false;
    let isExplicitPair = false;
    if (ch === 63 && isWsOrEol(state.input.charCodeAt(state.position + 1))) {
      isPair = isExplicitPair = true;
      state.position += 1;
      skipFlowSeparationSpace(state, nodeIndent);
    }
    const entryLine = state.line;
    const entryStart = snapshotState(state);
    const keyWasRead = parseNode(state, nodeIndent, CONTEXT_FLOW_IN, false, true);
    skipFlowSeparationSpace(state, nodeIndent);
    ch = state.input.charCodeAt(state.position);
    if ((isMapping || isExplicitPair || state.line === entryLine) && ch === 58) {
      isPair = true;
      state.position++;
      skipFlowSeparationSpace(state, nodeIndent);
      if (!isMapping) {
        insertFlowPairMappingEvent(state, entryStart);
        if (!keyWasRead)
          addEmptyScalarEvent(state);
      } else if (!keyWasRead)
        addEmptyScalarEvent(state);
      if (!parseNode(state, nodeIndent, CONTEXT_FLOW_IN, false, true))
        addEmptyScalarEvent(state);
      skipFlowSeparationSpace(state, nodeIndent);
      if (!isMapping)
        addPopEvent(state);
    } else if (isMapping && isPair) {
      if (!keyWasRead)
        addEmptyScalarEvent(state);
      addEmptyScalarEvent(state);
    } else if (isMapping)
      addEmptyScalarEvent(state);
    else if (isPair) {
      insertFlowPairMappingEvent(state, entryStart);
      if (!keyWasRead)
        addEmptyScalarEvent(state);
      addEmptyScalarEvent(state);
      addPopEvent(state);
    }
    ch = state.input.charCodeAt(state.position);
    if (ch === 44) {
      readNext = true;
      state.position++;
    } else
      readNext = false;
  }
  throwError(state, "unexpected end of the stream within a flow collection");
}
function readBlockSequence(state, nodeIndent, props) {
  if (state.firstTabInLine !== -1 || state.input.charCodeAt(state.position) !== 45 || !isWsOrEolOrEnd(state.input.charCodeAt(state.position + 1)))
    return false;
  addSequenceEvent(state, state.position, props.anchorStart, props.anchorEnd, props.tagStart, props.tagEnd, COLLECTION_STYLE.BLOCK);
  while (state.input.charCodeAt(state.position) === 45 && isWsOrEolOrEnd(state.input.charCodeAt(state.position + 1))) {
    if (state.firstTabInLine !== -1) {
      state.position = state.firstTabInLine;
      throwError(state, "tab characters must not be used in indentation");
    }
    const entryLine = state.line;
    state.position++;
    const hadBreak = skipSeparationSpace(state, true) > 0;
    if (state.firstTabInLine !== -1 && state.input.charCodeAt(state.position) === 45 && isWsOrEolOrEnd(state.input.charCodeAt(state.position + 1)))
      throwError(state, "bad indentation of a sequence entry");
    if (hadBreak && state.lineIndent <= nodeIndent)
      addEmptyScalarEvent(state);
    else
      parseNode(state, nodeIndent, CONTEXT_BLOCK_IN, false, true);
    skipSeparationSpace(state, true);
    if (state.lineIndent < nodeIndent || state.position >= state.length)
      break;
    if (state.lineIndent > nodeIndent)
      throwError(state, "bad indentation of a sequence entry");
    if (state.line === entryLine && state.input.charCodeAt(state.position) === 45 && isWsOrEolOrEnd(state.input.charCodeAt(state.position + 1)))
      throwError(state, "bad indentation of a sequence entry");
  }
  addPopEvent(state);
  return true;
}
function readBlockMapping(state, nodeIndent, flowIndent, props) {
  let atExplicitKey = false;
  let detected = false;
  let mappingOpened = false;
  let pendingExplicitKey = false;
  if (state.firstTabInLine !== -1)
    return false;
  let ch = state.input.charCodeAt(state.position);
  while (ch !== 0) {
    if (!atExplicitKey && state.firstTabInLine !== -1) {
      state.position = state.firstTabInLine;
      throwError(state, "tab characters must not be used in indentation");
    }
    const following = state.input.charCodeAt(state.position + 1);
    const entryLine = state.line;
    if ((ch === 63 || ch === 58) && isWsOrEolOrEnd(following)) {
      if (!mappingOpened) {
        addMappingEvent(state, state.position, props.anchorStart, props.anchorEnd, props.tagStart, props.tagEnd, COLLECTION_STYLE.BLOCK);
        mappingOpened = true;
      }
      if (ch === 63) {
        if (atExplicitKey)
          addEmptyScalarEvent(state);
        detected = true;
        atExplicitKey = true;
      } else if (atExplicitKey)
        atExplicitKey = false;
      else {
        addEmptyScalarEvent(state);
        detected = true;
        atExplicitKey = false;
      }
      state.position += 1;
      pendingExplicitKey = true;
    } else {
      if (atExplicitKey) {
        addEmptyScalarEvent(state);
        atExplicitKey = false;
      }
      const beforeKey = snapshotState(state);
      if (!parseNode(state, flowIndent, CONTEXT_FLOW_OUT, false, true))
        break;
      if (state.line === entryLine) {
        ch = state.input.charCodeAt(state.position);
        while (isWhiteSpace2(ch))
          ch = state.input.charCodeAt(++state.position);
        if (ch === 58) {
          ch = state.input.charCodeAt(++state.position);
          if (!isWsOrEolOrEnd(ch))
            throwError(state, "a whitespace character is expected after the key-value separator within a block mapping");
          if (!mappingOpened) {
            restoreState(state, beforeKey);
            addMappingEvent(state, beforeKey.position, props.anchorStart, props.anchorEnd, props.tagStart, props.tagEnd, COLLECTION_STYLE.BLOCK);
            mappingOpened = true;
            parseNode(state, flowIndent, CONTEXT_FLOW_OUT, false, true);
            ch = state.input.charCodeAt(state.position);
            while (isWhiteSpace2(ch))
              ch = state.input.charCodeAt(++state.position);
            state.position++;
          }
          detected = true;
          atExplicitKey = false;
          pendingExplicitKey = false;
        } else if (detected)
          throwError(state, "expected ':' after a mapping key");
        else {
          if (props.anchorStart !== NO_RANGE$1 || props.tagStart !== NO_RANGE$1) {
            restoreState(state, beforeKey);
            return false;
          }
          return true;
        }
      } else if (detected)
        throwError(state, "can not read a block mapping entry; a multiline key may not be an implicit key");
      else {
        if (props.anchorStart !== NO_RANGE$1 || props.tagStart !== NO_RANGE$1) {
          restoreState(state, beforeKey);
          return false;
        }
        return true;
      }
    }
    if (parseNode(state, nodeIndent, CONTEXT_BLOCK_OUT, true, pendingExplicitKey))
      pendingExplicitKey = false;
    if (!atExplicitKey) {
      if (pendingExplicitKey) {
        addEmptyScalarEvent(state);
        pendingExplicitKey = false;
      }
    }
    skipSeparationSpace(state, true);
    ch = state.input.charCodeAt(state.position);
    if ((state.line === entryLine || state.lineIndent > nodeIndent) && ch !== 0)
      throwError(state, "bad indentation of a mapping entry");
    else if (state.lineIndent < nodeIndent)
      break;
  }
  if (!detected)
    return false;
  if (atExplicitKey)
    addEmptyScalarEvent(state);
  if (mappingOpened)
    addPopEvent(state);
  return true;
}
function parseNode(state, parentIndent, nodeContext, allowToSeek, allowCompact, allowPropertyMapping = true) {
  if (state.depth >= state.maxDepth)
    throwError(state, `nesting exceeded maxDepth (${state.maxDepth})`);
  state.depth++;
  let indentStatus = 1;
  let atNewLine = false;
  let hasContent = false;
  let propertyStart = null;
  const props = emptyProperties();
  let allowBlockScalars = nodeContext === CONTEXT_BLOCK_OUT || nodeContext === CONTEXT_BLOCK_IN;
  let allowBlockCollections = allowBlockScalars;
  const allowBlockStyles = allowBlockScalars;
  if (allowToSeek && skipSeparationSpace(state, true)) {
    atNewLine = true;
    if (state.lineIndent > parentIndent)
      indentStatus = 1;
    else if (state.lineIndent === parentIndent)
      indentStatus = 0;
    else
      indentStatus = -1;
  }
  if (indentStatus === 1)
    while (true) {
      const ch = state.input.charCodeAt(state.position);
      const propertyState = snapshotState(state);
      if (atNewLine && indentStatus !== 1 && (ch === 33 || ch === 38))
        break;
      if (atNewLine && allowBlockStyles && (props.tagStart !== NO_RANGE$1 || props.anchorStart !== NO_RANGE$1) && (ch === 33 || ch === 38)) {
        const fallbackState = snapshotState(state);
        const flowIndent = parentIndent + 1;
        if (readBlockMapping(state, state.position - state.lineStart, flowIndent, props) && state.events[fallbackState.eventsLength]?.type === EVENT_ID.MAPPING) {
          state.depth--;
          return true;
        }
        restoreState(state, fallbackState);
      }
      if (atNewLine && (ch === 33 && props.tagStart !== NO_RANGE$1 || ch === 38 && props.anchorStart !== NO_RANGE$1))
        break;
      if (!readTagProperty(state, props, nodeContext === CONTEXT_FLOW_IN) && !readAnchorProperty(state, props))
        break;
      if (propertyStart === null)
        propertyStart = propertyState;
      if (skipSeparationSpace(state, true)) {
        atNewLine = true;
        allowBlockCollections = allowBlockStyles;
        if (state.lineIndent > parentIndent)
          indentStatus = 1;
        else if (state.lineIndent === parentIndent)
          indentStatus = 0;
        else
          indentStatus = -1;
      } else
        allowBlockCollections = false;
    }
  if (allowBlockCollections)
    allowBlockCollections = atNewLine || allowCompact;
  if (indentStatus === 1 || nodeContext === CONTEXT_BLOCK_OUT) {
    const flowIndent = nodeContext === CONTEXT_FLOW_IN || nodeContext === CONTEXT_FLOW_OUT ? parentIndent : parentIndent + 1;
    const blockIndent = state.position - state.lineStart;
    if (indentStatus === 1)
      if (allowBlockCollections && (readBlockSequence(state, blockIndent, props) || readBlockMapping(state, blockIndent, flowIndent, props)) || readFlowCollection(state, flowIndent, props))
        hasContent = true;
      else {
        const ch = state.input.charCodeAt(state.position);
        if (propertyStart !== null && allowPropertyMapping && allowBlockStyles && !allowBlockCollections && ch !== 124 && ch !== 62) {
          const fallbackState = snapshotState(state);
          const propertyIndent = propertyStart.position - propertyStart.lineStart;
          restoreState(state, propertyStart);
          if (readBlockMapping(state, propertyIndent, flowIndent, emptyProperties()) && state.events[fallbackState.eventsLength]?.type === EVENT_ID.MAPPING)
            hasContent = true;
          else
            restoreState(state, fallbackState);
        }
        if (!hasContent && (allowBlockScalars && readBlockScalar(state, flowIndent, props) || readSingleQuotedScalar(state, flowIndent, props) || readDoubleQuotedScalar(state, flowIndent, props) || readAlias(state, props) || readPlainScalar(state, flowIndent, nodeContext, props)))
          hasContent = true;
      }
    else if (indentStatus === 0)
      hasContent = allowBlockCollections && readBlockSequence(state, blockIndent, props);
  }
  allowBlockScalars = allowBlockScalars && !hasContent;
  if (!hasContent && (props.anchorStart !== NO_RANGE$1 || props.tagStart !== NO_RANGE$1 || allowBlockScalars)) {
    addScalarEvent(state, NO_RANGE$1, NO_RANGE$1, props.anchorStart, props.anchorEnd, props.tagStart, props.tagEnd, SCALAR_STYLE.PLAIN);
    hasContent = true;
  }
  state.depth--;
  return hasContent || props.anchorStart !== NO_RANGE$1 || props.tagStart !== NO_RANGE$1;
}
function readDirective(state) {
  if (state.lineIndent > 0 || state.input.charCodeAt(state.position) !== 37)
    return false;
  state.position++;
  const nameStart = state.position;
  while (state.input.charCodeAt(state.position) !== 0 && !isWsOrEol(state.input.charCodeAt(state.position)))
    state.position++;
  const name = state.input.slice(nameStart, state.position);
  const args = [];
  if (name.length === 0)
    throwError(state, "directive name must not be less than one character in length");
  while (state.input.charCodeAt(state.position) !== 0 && !isEol(state.input.charCodeAt(state.position))) {
    while (isWhiteSpace2(state.input.charCodeAt(state.position)))
      state.position++;
    if (state.input.charCodeAt(state.position) === 35 || isEol(state.input.charCodeAt(state.position)) || state.input.charCodeAt(state.position) === 0)
      break;
    const start = state.position;
    while (state.input.charCodeAt(state.position) !== 0 && !isWsOrEol(state.input.charCodeAt(state.position)))
      state.position++;
    args.push(state.input.slice(start, state.position));
  }
  if (isEol(state.input.charCodeAt(state.position)))
    consumeLineBreak(state);
  if (name === "YAML") {
    if (state.directives.some((directive) => directive.kind === "yaml"))
      throwError(state, "duplication of %YAML directive");
    if (args.length !== 1)
      throwError(state, "YAML directive accepts exactly one argument");
    const match = /^([0-9]+)\.([0-9]+)$/.exec(args[0]);
    if (match === null)
      throwError(state, "ill-formed argument of the YAML directive");
    if (parseInt(match[1], 10) !== 1)
      throwError(state, "unacceptable YAML version of the document");
    state.directives.push({
      kind: "yaml",
      version: args[0]
    });
  } else if (name === "TAG") {
    if (args.length !== 2)
      throwError(state, "TAG directive accepts exactly two arguments");
    const [handle, prefix] = args;
    if (!PATTERN_TAG_HANDLE.test(handle))
      throwError(state, "ill-formed tag handle (first argument) of the TAG directive");
    if (HAS_OWN.call(state.tagHandlers, handle))
      throwError(state, `there is a previously declared suffix for "${handle}" tag handle`);
    if (!PATTERN_TAG_PREFIX.test(prefix))
      throwError(state, "ill-formed tag prefix (second argument) of the TAG directive");
    state.tagHandlers[handle] = prefix;
    state.directives.push({
      kind: "tag",
      handle,
      prefix
    });
  }
  return true;
}
function readDocument(state) {
  state.directives = [];
  state.tagHandlers = Object.create(null);
  let hasDirectives = false;
  skipSeparationSpace(state, true);
  while (readDirective(state)) {
    hasDirectives = true;
    skipSeparationSpace(state, true);
  }
  let explicitStart = false;
  let explicitEnd = false;
  let allowCompact = true;
  if (state.lineIndent === 0 && state.input.charCodeAt(state.position) === 45 && state.input.charCodeAt(state.position + 1) === 45 && state.input.charCodeAt(state.position + 2) === 45 && isWsOrEolOrEnd(state.input.charCodeAt(state.position + 3))) {
    explicitStart = true;
    const markerLine = state.line;
    state.position += 3;
    skipSeparationSpace(state, true);
    allowCompact = state.line > markerLine;
  } else if (hasDirectives)
    throwError(state, "directives end mark is expected");
  const documentEventIndex = state.events.length;
  if (!explicitStart && state.position === state.lineStart && state.input.charCodeAt(state.position) === 46 && testDocumentSeparator(state)) {
    state.position += 3;
    skipSeparationSpace(state, true);
    return;
  }
  addDocumentEvent(state, explicitStart, false);
  if (!parseNode(state, state.lineIndent - 1, CONTEXT_BLOCK_OUT, false, allowCompact, allowCompact))
    addEmptyScalarEvent(state);
  skipSeparationSpace(state, true);
  if (state.position === state.lineStart && testDocumentSeparator(state)) {
    explicitEnd = state.input.charCodeAt(state.position) === 46;
    if (explicitEnd) {
      const markerLine = state.line;
      state.position += 3;
      skipSeparationSpace(state, true);
      if (state.line === markerLine && state.position < state.length)
        throwError(state, "end of the stream or a document separator is expected");
    }
  }
  const documentEvent = state.events[documentEventIndex];
  if (documentEvent?.type === EVENT_ID.DOCUMENT)
    documentEvent.explicitEnd = explicitEnd;
  addPopEvent(state);
  if (!explicitEnd && state.position < state.length && !testDocumentBoundary(state))
    throwError(state, "end of the stream or a document separator is expected");
}
function parseEvents(input, options) {
  const length = input.length;
  const state = {
    ...DEFAULT_PARSER_OPTIONS,
    ...options,
    input: `${input}\x00`,
    length,
    position: 0,
    line: 0,
    lineStart: 0,
    lineIndent: 0,
    firstTabInLine: -1,
    depth: 0,
    directives: [],
    tagHandlers: Object.create(null),
    events: []
  };
  const nullpos = input.indexOf("\x00");
  if (nullpos !== -1)
    YAMLException.throwAt(input, nullpos, "null byte is not allowed in input", state.filename);
  while (state.position < state.length) {
    skipByteOrderMark(state);
    skipSeparationSpace(state, true);
    if (state.position >= state.length)
      break;
    const documentStart = state.position;
    readDocument(state);
    if (state.position === documentStart)
      throwError(state, "can not read a document");
  }
  return state.events;
}
var DEFAULT_LOAD_OPTIONS = {
  ...DEFAULT_PARSER_OPTIONS,
  ...DEFAULT_CONSTRUCTOR_OPTIONS
};
function loadDocuments(input, options = {}) {
  const opts = {
    ...DEFAULT_LOAD_OPTIONS,
    ...options
  };
  const source = String(input);
  const PARSER_OPT_KEYS = Object.keys(DEFAULT_PARSER_OPTIONS);
  const CONSTRUCTOR_OPT_KEYS = Object.keys(DEFAULT_CONSTRUCTOR_OPTIONS);
  return constructFromEvents(parseEvents(source, pick2(opts, PARSER_OPT_KEYS)), {
    ...pick2(opts, CONSTRUCTOR_OPT_KEYS),
    source
  });
}
function load(input, options) {
  const documents = loadDocuments(input, options);
  if (documents.length === 0)
    throw new YAMLException("expected a document, but the input is empty");
  if (documents.length === 1)
    return documents[0];
  throw new YAMLException("expected a single document in the stream, but found more");
}
var INVALID = Symbol("INVALID");
var VISIT_BREAK = Symbol("visit:break");
var VISIT_SKIP = Symbol("visit:skip");
function hasBit(mask, bit) {
  return (mask & 1 << bit) !== 0;
}
var DEFAULT_SCALAR_STYLE_RULES = {
  applyQuoteFlowKeysOption,
  doubleQuoteForInvisibles,
  doubleQuoteWhitespaceOnly,
  applyForceQuotesOption,
  tryLongOrMultilineAsBlock,
  quoteInvalidPlain,
  fallbackToDoubleQuoted
};
function _preferredQuotedStyle(layout) {
  if (layout.presenterOptions.quoteStyle === "single" && hasBit(layout.allowedStylesMask, SCALAR_STYLE.SINGLE_QUOTED))
    return SCALAR_STYLE.SINGLE_QUOTED;
  return SCALAR_STYLE.DOUBLE_QUOTED;
}
function applyQuoteFlowKeysOption(layout) {
  if (!layout.presenterOptions.quoteFlowKeys)
    return;
  if (!layout.isKey || !layout.flowOnly || layout.style !== SCALAR_STYLE.PLAIN)
    return;
  layout.style = SCALAR_STYLE.DOUBLE_QUOTED;
}
function doubleQuoteForInvisibles(layout) {
  if (layout.style === SCALAR_STYLE.PLAIN && /[\t\x7F-\xA0\u2028\u2029\uFEFF\uFFFE\uFFFF]/.test(layout.node.value))
    layout.style = SCALAR_STYLE.DOUBLE_QUOTED;
}
function doubleQuoteWhitespaceOnly(layout) {
  if (layout.style === SCALAR_STYLE.PLAIN && /^\s+$/.test(layout.node.value))
    layout.style = SCALAR_STYLE.DOUBLE_QUOTED;
}
function applyForceQuotesOption(layout) {
  if (!layout.presenterOptions.forceQuotes)
    return;
  if (layout.isKey || layout.style !== SCALAR_STYLE.PLAIN)
    return;
  if (layout.node.tag !== layout.presenterOptions.schema.defaultScalarTag.tagName)
    return;
  layout.style = layout.node.value.includes(`
`) ? SCALAR_STYLE.DOUBLE_QUOTED : _preferredQuotedStyle(layout);
}
function tryLongOrMultilineAsBlock(layout) {
  if (layout.style !== SCALAR_STYLE.PLAIN || layout.isKey)
    return;
  const value = layout.node.value;
  const multiline = value.indexOf(`
`) !== -1;
  if (!hasBit(layout.allowedStylesMask, SCALAR_STYLE.LITERAL_BLOCK)) {
    if (multiline)
      layout.style = SCALAR_STYLE.DOUBLE_QUOTED;
    return;
  }
  const w = layout.presenterOptions.lineWidth;
  if (w === -1) {
    if (multiline)
      layout.style = SCALAR_STYLE.LITERAL_BLOCK;
    return;
  }
  const availableWidth = Math.max(Math.min(w, 40), w - layout.shiftOfContent);
  let position = 0;
  let shouldFold = false;
  while (position <= value.length) {
    let lineEnd = value.length;
    const nextLineBreak = value.indexOf(`
`, position);
    if (nextLineBreak !== -1)
      lineEnd = nextLineBreak;
    const line = value.slice(position, lineEnd);
    if (line.length > availableWidth && line[0] !== " " && / [^ \t]/.test(line))
      shouldFold = true;
    if (nextLineBreak === -1)
      break;
    position = nextLineBreak + 1;
  }
  if (shouldFold)
    layout.style = SCALAR_STYLE.FOLDED_BLOCK;
  else if (multiline)
    layout.style = SCALAR_STYLE.LITERAL_BLOCK;
}
function quoteInvalidPlain(layout) {
  if (layout.style === SCALAR_STYLE.PLAIN && !hasBit(layout.allowedStylesMask, SCALAR_STYLE.PLAIN))
    layout.style = _preferredQuotedStyle(layout);
}
function fallbackToDoubleQuoted(layout) {
  if (!hasBit(layout.allowedStylesMask, layout.style))
    layout.style = SCALAR_STYLE.DOUBLE_QUOTED;
}
var SRC_C_PRINTABLE = "[\\x09\\x0A\\x0D\\x20-\\x7E\\x85\\xA0-\\uD7FF\\uE000-\\uFFFD\\u{10000}-\\u{10FFFF}]";
var SRC_B_CHAR = "[\\n\\r]";
var SRC_C_BYTE_ORDER_MARK = "\\uFEFF";
var SRC_S_WHITE = "[ \\t]";
var SRC_NB_CHAR = `(?:(?!(?:${SRC_B_CHAR}|${SRC_C_BYTE_ORDER_MARK}))${SRC_C_PRINTABLE})`;
var SRC_NS_CHAR = `(?:(?!${SRC_S_WHITE})${SRC_NB_CHAR})`;
var SRC_NB_JSON = "[\\x09\\x20-\\uD7FF\\uE000-\\uFFFF\\u{10000}-\\u{10FFFF}]";
var SRC_C_INDICATOR = "[-?:,\\[\\]{}#&*!|>'\"%@`]";
var SRC_C_FLOW_INDICATOR = "[,\\[\\]{}]";
var SRC_NS_PLAIN_SAFE_FLOW_OUT = SRC_NS_CHAR;
var SRC_NS_PLAIN_SAFE_FLOW_IN = `(?:(?!${SRC_C_FLOW_INDICATOR})${SRC_NS_CHAR})`;
var SRC_NS_PLAIN_FIRST_FLOW_OUT = `(?:(?:(?!${SRC_C_INDICATOR})${SRC_NS_CHAR})|[?:-](?=${SRC_NS_PLAIN_SAFE_FLOW_OUT}))`;
var SRC_NS_PLAIN_FIRST_FLOW_IN = `(?:(?:(?!${SRC_C_INDICATOR})${SRC_NS_CHAR})|[?:-](?=${SRC_NS_PLAIN_SAFE_FLOW_IN}))`;
var SRC_NS_PLAIN_CHAR_FLOW_OUT = `(?:(?:(?![:#])${SRC_NS_PLAIN_SAFE_FLOW_OUT})|:(?=${SRC_NS_PLAIN_SAFE_FLOW_OUT}))#*`;
var SRC_NS_PLAIN_CHAR_FLOW_IN = `(?:(?:(?![:#])${SRC_NS_PLAIN_SAFE_FLOW_IN})|:(?=${SRC_NS_PLAIN_SAFE_FLOW_IN}))#*`;
var SRC_NB_NS_PLAIN_IN_LINE_FLOW_OUT = `(?:${SRC_S_WHITE}*${SRC_NS_PLAIN_CHAR_FLOW_OUT})*`;
var SRC_NB_NS_PLAIN_IN_LINE_FLOW_IN = `(?:${SRC_S_WHITE}*${SRC_NS_PLAIN_CHAR_FLOW_IN})*`;
var SRC_NS_PLAIN_ONE_LINE_FLOW_OUT = `${SRC_NS_PLAIN_FIRST_FLOW_OUT}#*${SRC_NB_NS_PLAIN_IN_LINE_FLOW_OUT}`;
var SRC_NS_PLAIN_ONE_LINE_FLOW_IN = `${SRC_NS_PLAIN_FIRST_FLOW_IN}#*${SRC_NB_NS_PLAIN_IN_LINE_FLOW_IN}`;
var SRC_NS_PLAIN_ONE_LINE_BLOCK_KEY = SRC_NS_PLAIN_ONE_LINE_FLOW_OUT;
var SRC_NS_PLAIN_ONE_LINE_FLOW_KEY = SRC_NS_PLAIN_ONE_LINE_FLOW_IN;
var SRC_S_NS_PLAIN_NEXT_LINE_FLOW_OUT = `\\n+${SRC_NS_PLAIN_CHAR_FLOW_OUT}${SRC_NB_NS_PLAIN_IN_LINE_FLOW_OUT}`;
var SRC_S_NS_PLAIN_NEXT_LINE_FLOW_IN = `\\n+${SRC_NS_PLAIN_CHAR_FLOW_IN}${SRC_NB_NS_PLAIN_IN_LINE_FLOW_IN}`;
var SRC_NS_PLAIN_MULTI_LINE_FLOW_OUT = `${SRC_NS_PLAIN_ONE_LINE_FLOW_OUT}(?:${SRC_S_NS_PLAIN_NEXT_LINE_FLOW_OUT})*`;
var SRC_NS_PLAIN_MULTI_LINE_FLOW_IN = `${SRC_NS_PLAIN_ONE_LINE_FLOW_IN}(?:${SRC_S_NS_PLAIN_NEXT_LINE_FLOW_IN})*`;
var NS_PLAIN_FLOW_OUT = new RegExp(`^(?:${SRC_NS_PLAIN_MULTI_LINE_FLOW_OUT})$`, "u");
var NS_PLAIN_FLOW_IN = new RegExp(`^(?:${SRC_NS_PLAIN_MULTI_LINE_FLOW_IN})$`, "u");
var NS_PLAIN_BLOCK_KEY = new RegExp(`^(?:${SRC_NS_PLAIN_ONE_LINE_BLOCK_KEY})$`, "u");
var NS_PLAIN_FLOW_KEY = new RegExp(`^(?:${SRC_NS_PLAIN_ONE_LINE_FLOW_KEY})$`, "u");
var NB_SINGLE_ONE_LINE = new RegExp(`^(?:${SRC_NB_JSON})*$`, "u");
var NB_SINGLE_MULTI_LINE = new RegExp(`^(?:${SRC_NB_JSON}|\\n)*$`, "u");
var BLOCK_SCALAR_CONTENT = new RegExp(`^(?:${SRC_NB_CHAR}|\\n)*$`, "u");
var DEFAULT_PRESENTER_OPTIONS = {
  indent: 2,
  seqNoIndent: false,
  seqInlineFirst: true,
  lineWidth: 80,
  flowBracketPadding: false,
  flowSkipCommaSpace: false,
  flowSkipColonSpace: false,
  quoteFlowKeys: false,
  quoteStyle: "single",
  forceQuotes: false,
  scalarStyleRules: Object.keys(DEFAULT_SCALAR_STYLE_RULES).map((name) => Reflect.get(DEFAULT_SCALAR_STYLE_RULES, name)),
  tagBeforeAnchor: false
};
var DEFAULT_DUMP_OPTIONS = {
  ...DEFAULT_PRESENTER_OPTIONS,
  schema: DUMP_SCHEMA,
  skipInvalid: false,
  noRefs: false,
  flowLevel: -1,
  sortKeys: false,
  transform: () => {}
};
var EVENT_DOCUMENT = EVENT_ID.DOCUMENT;
var EVENT_SEQUENCE = EVENT_ID.SEQUENCE;
var EVENT_MAPPING = EVENT_ID.MAPPING;
var EVENT_SCALAR = EVENT_ID.SCALAR;
var EVENT_ALIAS = EVENT_ID.ALIAS;
var EVENT_POP = EVENT_ID.POP;
var SCALAR_STYLE_PLAIN = SCALAR_STYLE.PLAIN;
var SCALAR_STYLE_SINGLE_QUOTED = SCALAR_STYLE.SINGLE_QUOTED;
var SCALAR_STYLE_DOUBLE_QUOTED = SCALAR_STYLE.DOUBLE_QUOTED;
var SCALAR_STYLE_LITERAL_BLOCK = SCALAR_STYLE.LITERAL_BLOCK;
var SCALAR_STYLE_FOLDED_BLOCK = SCALAR_STYLE.FOLDED_BLOCK;
var COLLECTION_STYLE_BLOCK = COLLECTION_STYLE.BLOCK;
var COLLECTION_STYLE_FLOW = COLLECTION_STYLE.FLOW;
var CHOMPING_CLIP = CHOMPING_MODE.CLIP;
var CHOMPING_STRIP = CHOMPING_MODE.STRIP;
var CHOMPING_KEEP = CHOMPING_MODE.KEEP;

// ../../../../omo-engine/utils/src/frontmatter.ts
function parseFrontmatter(content, options = {}) {
  if (options.mode === "rule")
    return parseRuleFrontmatter(content);
  const normalized = stripBom(content);
  const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n?---\r?\n([\s\S]*)$/;
  const match = normalized.match(frontmatterRegex);
  if (!match) {
    return { data: {}, body: normalized, hadFrontmatter: false, parseError: false };
  }
  const yamlContent = match[1];
  const body = match[2];
  try {
    const parsed = load(yamlContent, { schema: JSON_SCHEMA });
    const data = parsed ?? {};
    return { data, body, hadFrontmatter: true, parseError: false };
  } catch (error) {
    if (!(error instanceof Error))
      throw error;
    return { data: {}, body, hadFrontmatter: true, parseError: true };
  }
}
function parseRuleFrontmatter(content) {
  const normalized = stripBom(content);
  const openingLength = openingDelimiterLength(normalized);
  if (openingLength === 0) {
    return { data: {}, body: normalized, hadFrontmatter: false, parseError: false };
  }
  const closing = findClosingDelimiter(normalized, openingLength);
  if (!closing) {
    return { data: {}, body: normalized, hadFrontmatter: false, parseError: false };
  }
  try {
    const data = parseRuleYaml(normalized.slice(openingLength, closing.start));
    return { data, body: normalized.slice(closing.bodyStart), hadFrontmatter: true, parseError: false };
  } catch (error) {
    if (!(error instanceof Error))
      throw error;
    return { data: {}, body: normalized, hadFrontmatter: true, parseError: true };
  }
}
function parseRuleYaml(yamlContent) {
  const lines = yamlContent.replace(/\r\n/g, `
`).split(`
`);
  const metadata = {};
  let index = 0;
  while (index < lines.length) {
    const line = stripComment(lines[index] ?? "").trim();
    if (!line) {
      index += 1;
      continue;
    }
    const colon = line.indexOf(":");
    if (colon === -1) {
      index += 1;
      continue;
    }
    const key = line.slice(0, colon).trim();
    const rawValue = line.slice(colon + 1).trim();
    if (key === "description")
      metadata.description = parseString(rawValue);
    else if (key === "alwaysApply")
      metadata.alwaysApply = rawValue === "true";
    else if (key === "globs" || key === "paths" || key === "applyTo") {
      const parsed = parseGlobValue(rawValue, lines, index);
      metadata.globs = mergeGlobs(metadata.globs, parsed.value);
      index += parsed.consumed;
      continue;
    }
    index += 1;
  }
  return metadata;
}
function parseGlobValue(rawValue, lines, currentIndex) {
  if (rawValue.startsWith("["))
    return { value: parseInlineArray(rawValue), consumed: 1 };
  if (!rawValue) {
    const parsed = parseMultilineArray(lines, currentIndex);
    return parsed.values.length > 0 ? { value: parsed.values, consumed: parsed.consumed } : { value: "", consumed: 1 };
  }
  const value = parseString(rawValue);
  if (value.includes(","))
    return { value: value.split(",").map((item) => item.trim()).filter(Boolean), consumed: 1 };
  return { value, consumed: 1 };
}
function parseMultilineArray(lines, currentIndex) {
  const values = [];
  let consumed = 1;
  for (let index = currentIndex + 1;index < lines.length; index += 1) {
    const line = stripComment(lines[index] ?? "");
    if (line.trim().length === 0) {
      consumed += 1;
      continue;
    }
    const item = line.match(/^\s+-\s*(.*)$/);
    if (!item)
      break;
    const value = parseString(item[1] ?? "");
    if (value)
      values.push(value);
    consumed += 1;
  }
  return { values, consumed };
}
function parseInlineArray(value) {
  const closing = value.lastIndexOf("]");
  if (closing === -1)
    return [];
  return splitCommaSeparated(value.slice(1, closing)).map(parseString).filter(Boolean);
}
function mergeGlobs(existing, next) {
  if (Array.isArray(next) && next.length === 0)
    return existing ?? [];
  if (!Array.isArray(next) && next.length === 0)
    return existing ?? "";
  if (existing === undefined)
    return typeof next === "string" ? next : [...next];
  const existingValues = Array.isArray(existing) ? existing : [existing];
  const nextValues = typeof next === "string" ? [next] : [...next];
  return [...existingValues, ...nextValues];
}
function splitCommaSeparated(value) {
  const values = [];
  let current = "";
  let quote = null;
  let escaped = false;
  for (const character of value) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (quote && character === "\\") {
      escaped = true;
      continue;
    }
    if (character === '"' || character === "'") {
      if (!quote)
        quote = character;
      else if (quote === character)
        quote = null;
      current += character;
      continue;
    }
    if (!quote && character === ",") {
      values.push(current.trim());
      current = "";
      continue;
    }
    current += character;
  }
  values.push(current.trim());
  return values;
}
function parseString(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"') || trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}
function stripComment(line) {
  let quote = null;
  for (let index = 0;index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' || character === "'") {
      if (!quote)
        quote = character;
      else if (quote === character)
        quote = null;
    }
    if (!quote && character === "#")
      return line.slice(0, index);
  }
  return line;
}
function stripBom(content) {
  return content.startsWith("\uFEFF") ? content.slice(1) : content;
}
function openingDelimiterLength(content) {
  if (content.startsWith(`---\r
`))
    return 5;
  if (content.startsWith(`---
`))
    return 4;
  return 0;
}
function findClosingDelimiter(content, openingLength) {
  let lineStart = openingLength;
  while (lineStart <= content.length) {
    const nextNewline = content.indexOf(`
`, lineStart);
    const lineEnd = nextNewline === -1 ? content.length : nextNewline;
    if (content.slice(lineStart, lineEnd).replace(/\r$/, "") === "---") {
      return { start: lineStart, bodyStart: nextNewline === -1 ? content.length : nextNewline + 1 };
    }
    if (nextNewline === -1)
      break;
    lineStart = nextNewline + 1;
  }
  return null;
}

// ../../../../omo-engine/utils/src/contains-path.ts
import { existsSync as existsSync2, realpathSync as realpathSync2 } from "fs";
import { basename, dirname as dirname2, isAbsolute, join as join2, normalize, relative, resolve as resolve2 } from "path";
function findNearestExistingAncestor(resolvedPath) {
  let candidatePath = resolvedPath;
  while (!existsSync2(candidatePath)) {
    const parentPath = dirname2(candidatePath);
    if (parentPath === candidatePath) {
      return candidatePath;
    }
    candidatePath = parentPath;
  }
  return candidatePath;
}
function realpathNativeOrFallback(pathToNormalize) {
  try {
    return realpathSync2.native(pathToNormalize);
  } catch {
    return pathToNormalize;
  }
}
function toCanonicalPath(pathToNormalize) {
  const resolvedPath = resolve2(pathToNormalize);
  if (existsSync2(resolvedPath)) {
    return normalize(realpathNativeOrFallback(resolvedPath));
  }
  const nearestExistingAncestor = findNearestExistingAncestor(resolvedPath);
  const canonicalAncestor = existsSync2(nearestExistingAncestor) ? realpathNativeOrFallback(nearestExistingAncestor) : nearestExistingAncestor;
  const relativePathFromAncestor = relative(nearestExistingAncestor, resolvedPath);
  return normalize(join2(canonicalAncestor, relativePathFromAncestor || basename(resolvedPath)));
}
function containsPath(rootPath, candidatePath) {
  const canonicalRootPath = toCanonicalPath(rootPath);
  const canonicalCandidatePath = toCanonicalPath(candidatePath);
  const relativePath = relative(canonicalRootPath, canonicalCandidatePath);
  return relativePath === "" || !relativePath.startsWith("..") && !isAbsolute(relativePath);
}
function isWithinProject(candidatePath, projectRoot) {
  return containsPath(projectRoot, candidatePath);
}

// ../../../../omo-engine/utils/src/jsonc-parser.ts
var pluginConfigFileDetectionCache = new Map;
function stripBom2(content) {
  return content.charCodeAt(0) === 65279 ? content.slice(1) : content;
}
function parseJsoncSafe2(content) {
  const errors = [];
  const data = parse4(stripBom2(content), errors, {
    allowTrailingComma: true,
    disallowComments: false
  });
  return {
    data: errors.length > 0 ? null : data,
    errors: errors.map((e) => ({
      message: printParseErrorCode(e.error),
      offset: e.offset,
      length: e.length
    }))
  };
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
function log(message, data) {
  sharedSubunitLogger(message, data);
}

// ../../../../omo-engine/utils/src/internal-initiator-marker.ts
var INTERNAL_INITIATOR_MARKER_DETECT_PATTERN = /<!--\s*OMO_INTERNAL_INITIATOR\s*-->/;
var INTERNAL_NOREPLY_MARKER_DETECT_PATTERN = /<!--\s*OMO_INTERNAL_NOREPLY\s*-->/;
function hasInternalInitiatorMarker(text) {
  return INTERNAL_INITIATOR_MARKER_DETECT_PATTERN.test(text);
}
function hasInternalNoReplyMarker(text) {
  return INTERNAL_NOREPLY_MARKER_DETECT_PATTERN.test(text);
}
function isTextPartLike(part) {
  return part.type === "text" && typeof part.text === "string";
}
function isSyntheticOrInternalTextPart(part) {
  return isTextPartLike(part) && (part.synthetic === true || hasInternalInitiatorMarker(part.text));
}
function isSyntheticOrInternalOnlyTextParts(parts) {
  const textParts = (parts ?? []).filter(isTextPartLike);
  return textParts.length > 0 && textParts.every(isSyntheticOrInternalTextPart);
}
function isSyntheticOrInternalUserMessage(message) {
  const role = message.info?.role ?? message.role;
  return role === "user" && isSyntheticOrInternalOnlyTextParts(message.parts);
}
function isNoReplyTextPart(part) {
  return isTextPartLike(part) && hasInternalNoReplyMarker(part.text);
}
function isTerminalNoReplyUserMessage(message) {
  const role = message.info?.role ?? message.role;
  if (role !== "user") {
    return false;
  }
  const textParts = (message.parts ?? []).filter(isTextPartLike);
  return textParts.some(isNoReplyTextPart);
}

// ../../../../omo-engine/utils/src/migration/agent-names.ts
var AGENT_NAME_MAP = {
  omo: "sisyphus",
  OmO: "sisyphus",
  Sisyphus: "sisyphus",
  "Sisyphus (Ultraworker)": "sisyphus",
  sisyphus: "sisyphus",
  "Hephaestus (Deep Agent)": "hephaestus",
  "OmO-Plan": "prometheus",
  "omo-plan": "prometheus",
  "Planner-Sisyphus": "prometheus",
  "planner-sisyphus": "prometheus",
  "Prometheus - Plan Builder": "prometheus",
  "Prometheus (Plan Builder)": "prometheus",
  prometheus: "prometheus",
  "orchestrator-sisyphus": "atlas",
  Atlas: "atlas",
  "Atlas (Plan Executor)": "atlas",
  atlas: "atlas",
  "plan-consultant": "metis",
  "Metis - Plan Consultant": "metis",
  "Metis (Plan Consultant)": "metis",
  metis: "metis",
  "Momus - Plan Critic": "momus",
  "Momus (Plan Critic)": "momus",
  momus: "momus",
  "Sisyphus-Junior": "sisyphus-junior",
  "sisyphus-junior": "sisyphus-junior",
  build: "build",
  oracle: "oracle",
  librarian: "librarian",
  explore: "explore",
  "multimodal-looker": "multimodal-looker"
};
var BUILTIN_AGENT_NAMES = new Set([
  "sisyphus",
  "oracle",
  "librarian",
  "explore",
  "multimodal-looker",
  "metis",
  "momus",
  "prometheus",
  "atlas",
  "build"
]);

// ../../../../omo-engine/utils/src/migration/agent-category.ts
var categoryDefaults = {};
function configureMigrationCategoryDefaults(defaults) {
  categoryDefaults = defaults ?? {};
}

// ../../../../omo-engine/utils/src/prompt-async-gate/route-resolver.ts
var LIVE_ROUTE_DISPATCH_LOG = "[live-server-route] dispatch via live listener";
var LIVE_ROUTE_UNAVAILABLE_LOG = "[live-server-route] route unavailable; using in-process client";
var routeResolver = {};
function identityRoute(client) {
  return { client, route: "in-process", reason: "identity" };
}
function configurePromptDispatchRouteResolver(resolver) {
  routeResolver = resolver ?? {};
}
function tryResolveDispatchClientSync(client, sessionID) {
  if (!routeResolver.tryResolveDispatchClientSync) {
    return identityRoute(client);
  }
  return routeResolver.tryResolveDispatchClientSync(client, sessionID);
}
async function resolveDispatchClient(client, sessionID) {
  return routeResolver.resolveDispatchClient?.(client, sessionID) ?? identityRoute(client);
}
function isPreSendConnectionFailure(error) {
  return routeResolver.isPreSendConnectionFailure?.(error) ?? false;
}
function markLiveRouteUnavailable(reason) {
  routeResolver.markLiveRouteUnavailable?.(reason);
}

// ../../../../omo-engine/utils/src/session-idle-settle.ts
var DEFAULT_SESSION_IDLE_SETTLE_MS = 150;
var DEFAULT_SESSION_STATUS_TIMEOUT_MS = 5000;
function settleAfterSessionIdle(ms = DEFAULT_SESSION_IDLE_SETTLE_MS) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}
function withStatusTimeout(promise, timeoutMs) {
  let timeoutID;
  const timeoutPromise = new Promise((_resolve, reject) => {
    timeoutID = setTimeout(() => {
      reject(new Error(`session.status() timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutID !== undefined) {
      clearTimeout(timeoutID);
    }
  });
}
var ACTIVE_SESSION_STATUSES = new Set(["busy", "retry", "running"]);
function getSessionStatusPayload(response) {
  if (isRecord9(response) && isRecord9(response.data)) {
    return response.data;
  }
  if (isRecord9(response)) {
    return response;
  }
  return {};
}
function isActiveSessionStatusType(statusType) {
  return ACTIVE_SESSION_STATUSES.has(statusType);
}
async function isSessionActive(client, sessionID, statusTimeoutMs = DEFAULT_SESSION_STATUS_TIMEOUT_MS) {
  if (typeof client.session?.status !== "function") {
    return false;
  }
  try {
    const statusResult = await withStatusTimeout(client.session.status(), statusTimeoutMs);
    const status = getSessionStatusPayload(statusResult)[sessionID];
    if (!isRecord9(status)) {
      return false;
    }
    const statusType = status.type;
    return typeof statusType === "string" && isActiveSessionStatusType(statusType);
  } catch (error) {
    if (error instanceof Error) {
      return false;
    }
    return false;
  }
}

// ../../../../omo-engine/utils/src/prompt-async-gate/prompt-message-state.ts
function messageRole(message) {
  if (!isRecord9(message)) {
    return;
  }
  const info = message.info;
  if (isRecord9(info) && typeof info.role === "string") {
    return info.role;
  }
  return typeof message.role === "string" ? message.role : undefined;
}
function messageFinish(message) {
  if (!isRecord9(message)) {
    return;
  }
  const info = message.info;
  if (isRecord9(info)) {
    if (info.finish === true) {
      return true;
    }
    if (typeof info.finish === "string" && info.finish.length > 0) {
      return info.finish;
    }
  }
  if (message.finish === true) {
    return true;
  }
  return typeof message.finish === "string" && message.finish.length > 0 ? message.finish : undefined;
}
function messageCompleted(message) {
  if (!isRecord9(message)) {
    return false;
  }
  const info = message.info;
  const time = isRecord9(info) && isRecord9(info.time) ? info.time : undefined;
  const completed = time?.completed;
  if (typeof completed === "number" && Number.isFinite(completed)) {
    return true;
  }
  return typeof completed === "string" && completed.length > 0;
}
function messageHasTerminalError(message) {
  if (!isRecord9(message)) {
    return false;
  }
  const info = message.info;
  if (isRecord9(info) && info.error !== undefined && info.error !== null) {
    return true;
  }
  return message.error !== undefined && message.error !== null;
}
function toInternalInitiatorTextPartLike(part) {
  const result = {};
  if (!isRecord9(part)) {
    return result;
  }
  if (typeof part.type === "string") {
    result.type = part.type;
  }
  if (typeof part.text === "string") {
    result.text = part.text;
  }
  if (typeof part.synthetic === "boolean") {
    result.synthetic = part.synthetic;
  }
  return result;
}
function toInternalInitiatorMessageLike(message) {
  if (!isRecord9(message)) {
    return;
  }
  const result = {};
  const info = message.info;
  if (isRecord9(info) && typeof info.role === "string") {
    result.info = { role: info.role };
  }
  if (typeof message.role === "string") {
    result.role = message.role;
  }
  if (Array.isArray(message.parts)) {
    result.parts = message.parts.map(toInternalInitiatorTextPartLike);
  }
  return result;
}
function messageIsSyntheticOrInternalUser(message) {
  const initiatorMessage = toInternalInitiatorMessageLike(message);
  return initiatorMessage !== undefined && isSyntheticOrInternalUserMessage(initiatorMessage);
}
function messageIsTerminalNoReplyUser(message) {
  const initiatorMessage = toInternalInitiatorMessageLike(message);
  return initiatorMessage !== undefined && isTerminalNoReplyUserMessage(initiatorMessage);
}
function messageHasInternalInitiatorMarker(message) {
  const initiatorMessage = toInternalInitiatorMessageLike(message);
  if (initiatorMessage === undefined) {
    return false;
  }
  return (initiatorMessage.parts ?? []).some((part) => part.type === "text" && typeof part.text === "string" && hasInternalInitiatorMarker(part.text));
}
var QUESTION_TOOL_NAMES = new Set(["question", "ask_user_question", "askuserquestion"]);
function partToolName(part) {
  if (typeof part.name === "string") {
    return part.name;
  }
  if (typeof part.tool === "string") {
    return part.tool;
  }
  return typeof part.toolName === "string" ? part.toolName : undefined;
}
function partIsToolCall(part) {
  return part.type === "tool" || part.type === "tool_use" || part.type === "tool-call" || part.type === "tool-invocation";
}
function partIsQuestionTool(part) {
  if (!isRecord9(part) || !partIsToolCall(part)) {
    return false;
  }
  const toolName = partToolName(part);
  return toolName !== undefined && QUESTION_TOOL_NAMES.has(toolName.toLowerCase());
}
function partIsUnansweredQuestionTool(part) {
  if (!partIsQuestionTool(part) || !isRecord9(part)) {
    return false;
  }
  const state = part.state;
  if (!isRecord9(state)) {
    return true;
  }
  return state.status !== "completed";
}
function partIsWaitingOnTool(part) {
  if (!isRecord9(part)) {
    return false;
  }
  if (!partIsToolCall(part)) {
    return false;
  }
  const state = part.state;
  if (!isRecord9(state)) {
    return false;
  }
  return state.status === "pending" || state.status === "running";
}
function partIsUnresolvedTool(part) {
  if (!isRecord9(part) || !partIsToolCall(part)) {
    return false;
  }
  const state = part.state;
  if (!isRecord9(state)) {
    return true;
  }
  return state.status !== "completed";
}
function partHasSubstantiveAssistantOutput(part) {
  if (!isRecord9(part)) {
    return false;
  }
  if (part.type === "step-start" || part.type === "step-finish") {
    return false;
  }
  if (part.type === "text") {
    return typeof part.text === "string" && part.text.trim().length > 0;
  }
  return typeof part.type === "string" && part.type.length > 0;
}
function messageHasQuestionTool(message) {
  return isRecord9(message) && Array.isArray(message.parts) && message.parts.some(partIsUnansweredQuestionTool);
}
function messageHasWaitingTool(message) {
  return isRecord9(message) && Array.isArray(message.parts) && message.parts.some(partIsWaitingOnTool);
}
function messageHasUnresolvedTool(message) {
  return isRecord9(message) && Array.isArray(message.parts) && message.parts.some(partIsUnresolvedTool);
}
function messageHasSubstantiveAssistantOutput(message) {
  return isRecord9(message) && Array.isArray(message.parts) && message.parts.some(partHasSubstantiveAssistantOutput);
}

// ../../../../omo-engine/utils/src/prompt-async-gate/message-inspection-error.ts
function isPromptMessageInspectionAborted(error) {
  if (error instanceof Error && error.name === "MessageAbortedError") {
    return true;
  }
  return isRecord9(error) && error.name === "MessageAbortedError";
}

// ../../../../omo-engine/utils/src/prompt-async-gate/timing.ts
var DEFAULT_PROMPT_ASYNC_POST_DISPATCH_HOLD_MS = 2000;
var DEFAULT_PROMPT_SEMANTIC_DEDUPE_HOLD_MS = 15000;
var DEFAULT_PROMPT_DISPATCH_TIMEOUT_MS = 30000;
var DEFAULT_PROMPT_GATE_MESSAGES_FETCH_TIMEOUT_MS = 5000;
var DEFAULT_PROMPT_REVALIDATION_TIMEOUT_MS = 5000;
var DEFAULT_PROMPT_QUEUE_RETRY_MS = 250;
var promptGateMessagesFetchTimeoutMsForTesting;
var promptGateRevalidationTimeoutMsForTesting;
function getPromptGateMessagesFetchTimeoutMs() {
  return promptGateMessagesFetchTimeoutMsForTesting ?? DEFAULT_PROMPT_GATE_MESSAGES_FETCH_TIMEOUT_MS;
}
function getPromptGateRevalidationTimeoutMs() {
  return promptGateRevalidationTimeoutMsForTesting ?? DEFAULT_PROMPT_REVALIDATION_TIMEOUT_MS;
}
async function withDispatchTimeout(operation, dispatchTimeoutMs, operationName) {
  if (dispatchTimeoutMs <= 0) {
    return operation;
  }
  let timeoutID;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutID = setTimeout(() => {
      reject(new Error(`${operationName} timed out after ${dispatchTimeoutMs}ms`));
    }, dispatchTimeoutMs);
  });
  try {
    return await Promise.race([operation, timeoutPromise]);
  } finally {
    if (timeoutID !== undefined) {
      clearTimeout(timeoutID);
    }
  }
}

// ../../../../omo-engine/utils/src/prompt-async-gate/pending-tool-turn.ts
function getPromptQuery(input) {
  if (!isRecord9(input)) {
    return { directory: "" };
  }
  const query = input.query;
  if (!isRecord9(query)) {
    return { directory: "" };
  }
  const promptQuery = { directory: "" };
  if (typeof query.directory === "string") {
    return typeof query.limit === "number" ? { directory: query.directory, limit: query.limit } : { directory: query.directory };
  }
  if (typeof query.limit === "number") {
    return { ...promptQuery, limit: query.limit };
  }
  return promptQuery;
}
function getMessagesData(response) {
  if (isRecord9(response) && Array.isArray(response.data)) {
    return response.data;
  }
  return Array.isArray(response) ? response : [];
}
function latestAssistantTurnBlocksInternalPrompt(messages) {
  let sawAssistantAfterLatestUser = false;
  for (let index = messages.length - 1;index >= 0; index--) {
    const message = messages[index];
    const role = messageRole(message);
    if (role === "assistant") {
      sawAssistantAfterLatestUser = true;
      if (messageHasQuestionTool(message)) {
        return true;
      }
      const finish = messageFinish(message);
      if (finish === "tool-calls") {
        return !isRecord9(message) || !Array.isArray(message.parts) || messageHasUnresolvedTool(message);
      }
      if ((finish === undefined || finish === "unknown") && !messageHasSubstantiveAssistantOutput(message)) {
        return !(messageCompleted(message) && messageHasTerminalError(message));
      }
      if (messageCompleted(message)) {
        return false;
      }
      if (finish === true) {
        return false;
      }
      if (finish === undefined || finish === "unknown") {
        return true;
      }
      if (!isRecord9(message) || !Array.isArray(message.parts)) {
        return finish === "tool-calls";
      }
      return messageHasWaitingTool(message);
    }
    if (role === "user") {
      if (messageIsSyntheticOrInternalUser(message)) {
        if (messageIsTerminalNoReplyUser(message)) {
          continue;
        }
        if (!sawAssistantAfterLatestUser) {
          if (messageHasInternalInitiatorMarker(message)) {
            continue;
          }
          return true;
        }
        continue;
      }
      return false;
    }
  }
  return false;
}
async function sessionLatestAssistantBlocksInternalPrompt(args) {
  const session = args.client.session;
  if (typeof session?.messages !== "function") {
    return false;
  }
  const messages = session.messages.bind(session);
  try {
    const response = await withDispatchTimeout(messages({
      path: { id: args.sessionID },
      query: getPromptQuery(args.input)
    }), args.timeoutMs, `[prompt-async-gate] ${args.sessionName} session.messages`);
    return latestAssistantTurnBlocksInternalPrompt(getMessagesData(response));
  } catch (error) {
    log("[prompt-async-gate] latest assistant prompt-block check failed", {
      sessionID: args.sessionID,
      source: args.source,
      error: String(error)
    });
    return !isPromptMessageInspectionAborted(error);
  }
}

// ../../../../omo-engine/utils/src/prompt-async-gate/recent-dispatches.ts
var recentPromptDispatches = new Map;
function recentDispatchKey(sessionID, dedupeKey) {
  return `${sessionID}\x00${dedupeKey}`;
}
function pruneRecentPromptDispatches(now = Date.now()) {
  for (const [key, dispatch] of recentPromptDispatches) {
    if (dispatch.expiresAt <= now) {
      recentPromptDispatches.delete(key);
    }
  }
}
function getRecentPromptDispatch(sessionID, dedupeKey) {
  pruneRecentPromptDispatches();
  return recentPromptDispatches.get(recentDispatchKey(sessionID, dedupeKey));
}
function rememberRecentPromptDispatch(args) {
  pruneRecentPromptDispatches();
  if (args.holdMs <= 0) {
    return;
  }
  recentPromptDispatches.set(recentDispatchKey(args.sessionID, args.dedupeKey), {
    source: args.source,
    expiresAt: Date.now() + args.holdMs
  });
  log("[prompt-async-gate] remembered semantic prompt dispatch", {
    sessionID: args.sessionID,
    source: args.source,
    holdMs: args.holdMs
  });
}

// ../../../../omo-engine/utils/src/prompt-async-gate/reservations.ts
var promptAsyncReservations = new Map;
var expiredReservationHandler;
function setExpiredReservationHandler(handler) {
  expiredReservationHandler = handler;
}
function notifyExpiredReservation(sessionID) {
  expiredReservationHandler?.(sessionID);
}
function pruneExpiredReservations(now = Date.now()) {
  const expiredSessionIDs = [];
  for (const [sessionID, reservation] of promptAsyncReservations) {
    if (typeof reservation.expiresAt === "number" && reservation.expiresAt <= now) {
      promptAsyncReservations.delete(sessionID);
      expiredSessionIDs.push(sessionID);
      log("[prompt-async-gate] expired reservation released", {
        sessionID,
        source: reservation.source
      });
    }
  }
  for (const sessionID of expiredSessionIDs) {
    notifyExpiredReservation(sessionID);
  }
}
function getActiveReservation(sessionID) {
  pruneExpiredReservations();
  return promptAsyncReservations.get(sessionID);
}
function reservedDispatchResult(reservation) {
  return reservation.expiresAt === undefined ? { status: "reserved", reservedBy: reservation.source } : { status: "reserved", reservedBy: reservation.source, expiresAt: reservation.expiresAt };
}
function setPromptReservation(sessionID, reservation) {
  promptAsyncReservations.set(sessionID, reservation);
}
function finishPromptReservation(sessionID, reservation, dispatchAttempted, postDispatchHoldMs) {
  const current = promptAsyncReservations.get(sessionID);
  if (current?.token !== reservation.token) {
    return;
  }
  if (dispatchAttempted && postDispatchHoldMs > 0) {
    promptAsyncReservations.set(sessionID, {
      ...reservation,
      expiresAt: Date.now() + postDispatchHoldMs
    });
    return;
  }
  promptAsyncReservations.delete(sessionID);
}

// ../../../../omo-engine/utils/src/prompt-async-gate/session-idle-dispatch.ts
async function dispatchAfterSessionIdle(args) {
  const {
    sessionName,
    client,
    sessionID,
    input,
    source,
    dedupeKey,
    settleMs,
    postDispatchHoldMs,
    semanticDedupeHoldMs,
    dispatchTimeoutMs,
    checkStatus,
    checkToolState,
    shouldDispatch,
    retryDispatchFailure,
    dispatch
  } = args;
  const existing = getActiveReservation(sessionID);
  if (existing) {
    log(`[prompt-async-gate] ${sessionName} skipped because session is reserved`, {
      sessionID,
      source,
      reservedBy: existing.source,
      reservedAgeMs: Date.now() - existing.reservedAt
    });
    return reservedDispatchResult(existing);
  }
  const reservation = {
    source,
    dedupeKey,
    reservedAt: Date.now(),
    token: Symbol(source)
  };
  setPromptReservation(sessionID, reservation);
  let dispatchAttempted = false;
  try {
    const canReadStatus = checkStatus && typeof client.session?.status === "function";
    if (settleMs > 0) {
      await settleAfterSessionIdle(settleMs);
    }
    let sessionActive = false;
    if (canReadStatus) {
      try {
        sessionActive = await withDispatchTimeout(isSessionActive(client, sessionID), Math.min(dispatchTimeoutMs, 5000), `[prompt-async-gate] ${sessionName} isSessionActive`);
      } catch (error) {
        if (error instanceof Error) {
          sessionActive = false;
        }
        sessionActive = false;
      }
    }
    if (sessionActive) {
      log(`[prompt-async-gate] ${sessionName} skipped because session is active`, { sessionID, source });
      return { status: "active" };
    }
    if (checkToolState && typeof client.session?.messages === "function" && await sessionLatestAssistantBlocksInternalPrompt({
      client,
      sessionID,
      input,
      sessionName,
      source,
      timeoutMs: Math.min(dispatchTimeoutMs, getPromptGateMessagesFetchTimeoutMs())
    })) {
      log(`[prompt-async-gate] ${sessionName} skipped because latest assistant is still active`, {
        sessionID,
        source
      });
      return { status: "active" };
    }
    const dispatchDecision = shouldDispatch?.();
    const resolvedDispatchDecision = dispatchDecision !== undefined && typeof dispatchDecision !== "boolean" ? await withDispatchTimeout(dispatchDecision, Math.min(dispatchTimeoutMs, getPromptGateRevalidationTimeoutMs()), `[prompt-async-gate] ${sessionName} shouldDispatch`) : dispatchDecision;
    if (resolvedDispatchDecision === false) {
      log(`[prompt-async-gate] ${sessionName} cancelled before dispatch`, { sessionID, source });
      return { status: "cancelled" };
    }
    log(`[prompt-async-gate] ${sessionName} dispatching`, { sessionID, source });
    dispatchAttempted = true;
    const response = await withDispatchTimeout(dispatch(input), dispatchTimeoutMs, `[prompt-async-gate] ${sessionName} dispatch`);
    rememberRecentPromptDispatch({
      sessionID,
      dedupeKey,
      source,
      holdMs: semanticDedupeHoldMs
    });
    log(`[prompt-async-gate] ${sessionName} dispatched`, { sessionID, source });
    return { status: "dispatched", response };
  } catch (error) {
    const queueRetryable = dispatchAttempted && retryDispatchFailure?.(error) === true;
    if (dispatchAttempted) {
      rememberRecentPromptDispatch({
        sessionID,
        dedupeKey,
        source,
        holdMs: semanticDedupeHoldMs
      });
    }
    const errorText = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    log(`[prompt-async-gate] ${sessionName} failed`, { sessionID, source, error: errorText });
    return {
      status: "failed",
      error,
      dispatchAttempted,
      ...queueRetryable ? { queueRetryable: true } : {}
    };
  } finally {
    finishPromptReservation(sessionID, reservation, dispatchAttempted, postDispatchHoldMs);
  }
}

// ../../../../omo-engine/utils/src/prompt-async-gate/queue.ts
var promptQueues = new Map;
var promptQueueDraining = new Set;
var promptQueueInFlight = new Map;
var promptQueueTimers = new Map;
var promptQueueRetryStates = new Map;
var MAX_QUEUED_RETRYABLE_FAILURES = 3;
var MAX_DURABLE_RETRY_BACKOFF_MS = 30000;
var promptQueueSequence = 0;
setExpiredReservationHandler((sessionID) => {
  schedulePromptQueueDrain(sessionID, 0);
});
function getPromptQueue(sessionID) {
  const existing = promptQueues.get(sessionID);
  if (existing) {
    return existing;
  }
  const queue = [];
  promptQueues.set(sessionID, queue);
  return queue;
}
function setPromptQueue(sessionID, queue) {
  if (queue.length === 0) {
    promptQueues.delete(sessionID);
    return;
  }
  promptQueues.set(sessionID, queue);
}
function queuedResult(entry, position, queuedBy = entry.source) {
  return {
    status: "queued",
    queuedBy,
    position
  };
}
function clearPromptQueueTimer(sessionID) {
  const timer = promptQueueTimers.get(sessionID);
  if (timer !== undefined) {
    clearTimeout(timer);
    promptQueueTimers.delete(sessionID);
  }
}
function schedulePromptQueueDrain(sessionID, delayMs) {
  const queue = promptQueues.get(sessionID);
  if (!queue || queue.length === 0) {
    clearPromptQueueTimer(sessionID);
    return;
  }
  clearPromptQueueTimer(sessionID);
  const timer = setTimeout(() => {
    promptQueueTimers.delete(sessionID);
    drainPromptQueue(sessionID).catch((error) => {
      log("[prompt-async-gate] queued prompt drain failed", {
        sessionID,
        error: String(error)
      });
    });
  }, Math.max(0, delayMs));
  promptQueueTimers.set(sessionID, timer);
}
function removePromptQueueEntry(sessionID, entry) {
  promptQueueRetryStates.delete(entry.id);
  const queue = promptQueues.get(sessionID);
  if (!queue) {
    return;
  }
  const nextQueue = queue.filter((queued) => queued.id !== entry.id);
  setPromptQueue(sessionID, nextQueue);
}
function getQueuedPromptBlocker(sessionID) {
  const inFlight = promptQueueInFlight.get(sessionID);
  if (inFlight) {
    return inFlight.source;
  }
  const queue = promptQueues.get(sessionID);
  return queue?.[0]?.source;
}
function isPromptQueueDraining(sessionID) {
  return promptQueueDraining.has(sessionID);
}
function nextPromptQueueID() {
  promptQueueSequence += 1;
  return promptQueueSequence;
}
async function drainPromptQueue(sessionID, awaitedEntry) {
  if (promptQueueDraining.has(sessionID)) {
    return awaitedEntry ? queuedResult(awaitedEntry, 1) : undefined;
  }
  promptQueueDraining.add(sessionID);
  clearPromptQueueTimer(sessionID);
  let awaitedResult;
  const deferredRetryIds = new Set;
  try {
    while (true) {
      const queue = promptQueues.get(sessionID);
      const entry = queue?.[0];
      if (!entry) {
        break;
      }
      const retryState = promptQueueRetryStates.get(entry.id);
      if (entry.durableRetry && retryState?.retryAfter !== undefined && retryState.retryAfter > Date.now()) {
        if (deferredRetryIds.has(entry.id)) {
          const nextRetryAt = Math.min(...queue.flatMap((queued) => {
            const retryAfter = promptQueueRetryStates.get(queued.id)?.retryAfter;
            return retryAfter === undefined ? [] : [retryAfter];
          }));
          schedulePromptQueueDrain(sessionID, nextRetryAt - Date.now());
          break;
        }
        deferredRetryIds.add(entry.id);
        setPromptQueue(sessionID, [...queue.slice(1), entry]);
        continue;
      }
      promptQueueInFlight.set(sessionID, entry);
      const result = await dispatchAfterSessionIdle({
        sessionName: entry.sessionName,
        client: entry.client,
        sessionID: entry.sessionID,
        input: entry.input,
        source: entry.source,
        dedupeKey: entry.dedupeKey,
        settleMs: entry.settleMs,
        postDispatchHoldMs: entry.postDispatchHoldMs,
        semanticDedupeHoldMs: entry.semanticDedupeHoldMs,
        dispatchTimeoutMs: entry.dispatchTimeoutMs,
        checkStatus: entry.checkStatus,
        checkToolState: entry.checkToolState,
        shouldDispatch: entry.shouldDispatch,
        retryDispatchFailure: entry.retryDispatchFailure,
        dispatch: entry.dispatch
      });
      if (promptQueueInFlight.get(sessionID)?.id === entry.id) {
        promptQueueInFlight.delete(sessionID);
      }
      const retryableQueuedFailure = result.status === "failed" && (!result.dispatchAttempted || result.queueRetryable === true);
      if (retryableQueuedFailure) {
        const failureCount = (promptQueueRetryStates.get(entry.id)?.failureCount ?? 0) + 1;
        if (entry.durableRetry) {
          const exponentialBackoffMs = entry.queueRetryMs * 2 ** Math.min(failureCount, 7);
          const retryDelayMs = Math.max(entry.postDispatchHoldMs, Math.min(exponentialBackoffMs, MAX_DURABLE_RETRY_BACKOFF_MS));
          promptQueueRetryStates.set(entry.id, {
            failureCount,
            retryAfter: Date.now() + retryDelayMs
          });
          const currentQueue = promptQueues.get(sessionID);
          if (currentQueue && currentQueue.length > 1) {
            setPromptQueue(sessionID, [...currentQueue.slice(1), entry]);
            continue;
          }
          schedulePromptQueueDrain(sessionID, retryDelayMs);
          break;
        }
        if (failureCount >= MAX_QUEUED_RETRYABLE_FAILURES) {
          log("[prompt-async-gate] dropping queued prompt after repeated retryable failures", {
            sessionID,
            source: entry.source,
            failureCount
          });
          removePromptQueueEntry(sessionID, entry);
          if (awaitedEntry?.id === entry.id) {
            awaitedResult = result;
          }
          continue;
        }
        promptQueueRetryStates.set(entry.id, { failureCount });
      }
      if (result.status === "active" || result.status === "reserved" || retryableQueuedFailure) {
        const queued = queuedResult(entry, 1, result.status === "reserved" ? result.reservedBy : entry.source);
        if (awaitedEntry?.id === entry.id) {
          awaitedResult = queued;
        }
        schedulePromptQueueDrain(sessionID, entry.queueRetryMs);
        break;
      }
      removePromptQueueEntry(sessionID, entry);
      if (awaitedEntry?.id === entry.id) {
        awaitedResult = result;
      }
      const remainingQueue = promptQueues.get(sessionID);
      if (!remainingQueue || remainingQueue.length === 0) {
        break;
      }
      schedulePromptQueueDrain(sessionID, entry.postDispatchHoldMs);
      break;
    }
  } finally {
    promptQueueDraining.delete(sessionID);
  }
  return awaitedResult;
}
async function enqueueInternalPrompt(entry) {
  const activeReservation = getActiveReservation(entry.sessionID);
  if (activeReservation?.dedupeKey === entry.dedupeKey) {
    log("[prompt-async-gate] queued prompt coalesced with recent dispatch", {
      sessionID: entry.sessionID,
      source: entry.source,
      queuedBy: activeReservation.source
    });
    return queuedResult(entry, 0, activeReservation.source);
  }
  const queue = getPromptQueue(entry.sessionID);
  const existingIndex = queue.findIndex((queued) => queued.dedupeKey === entry.dedupeKey);
  if (existingIndex >= 0) {
    const existing = queue[existingIndex];
    if (existing) {
      log("[prompt-async-gate] queued prompt coalesced with pending dispatch", {
        sessionID: entry.sessionID,
        source: entry.source,
        queuedBy: existing.source,
        position: existingIndex + 1
      });
      return queuedResult(existing, existingIndex + 1);
    }
  }
  queue.push(entry);
  log("[prompt-async-gate] queued prompt accepted", {
    sessionID: entry.sessionID,
    source: entry.source,
    position: queue.length
  });
  if (queue.length > 1 || promptQueueDraining.has(entry.sessionID)) {
    schedulePromptQueueDrain(entry.sessionID, 0);
    return queuedResult(entry, queue.length);
  }
  const result = await drainPromptQueue(entry.sessionID, entry);
  return result ?? queuedResult(entry, 1);
}

// ../../../../omo-engine/utils/src/prompt-async-gate/semantic-dedupe.ts
import { createHash } from "node:crypto";
var MAX_PROMPT_DEDUPE_DEPTH = 64;
function isPlainRecord2(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function canonicalizePromptInputForDedupe(key, value, seen = new WeakSet, depth = 0) {
  if (key === "signal") {
    return "[AbortSignal]";
  }
  if (typeof value === "function") {
    return `[Function:${value.name}]`;
  }
  if (depth > MAX_PROMPT_DEDUPE_DEPTH) {
    return "[MaxDepth]";
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return "[Circular]";
    }
    seen.add(value);
    try {
      return value.map((entry) => canonicalizePromptInputForDedupe("", entry, seen, depth + 1));
    } finally {
      seen.delete(value);
    }
  }
  if (!isPlainRecord2(value)) {
    return value;
  }
  if (seen.has(value)) {
    return "[Circular]";
  }
  seen.add(value);
  try {
    const canonicalEntries = [];
    for (const entryKey of Object.keys(value).sort()) {
      canonicalEntries.push([
        entryKey,
        canonicalizePromptInputForDedupe(entryKey, value[entryKey], seen, depth + 1)
      ]);
    }
    return Object.fromEntries(canonicalEntries);
  } finally {
    seen.delete(value);
  }
}
function isContinuationTextPartLike(value) {
  if (!isPlainRecord2(value)) {
    return false;
  }
  if (value.type !== "text" || typeof value.text !== "string") {
    return false;
  }
  if (!hasInternalInitiatorMarker(value.text)) {
    return false;
  }
  if (!isPlainRecord2(value.metadata)) {
    return false;
  }
  return value.metadata.compaction_continue === true;
}
function hasContinuationPromptIntent(input) {
  if (!isPlainRecord2(input) || !isPlainRecord2(input.body) || !Array.isArray(input.body.parts)) {
    return false;
  }
  return input.body.parts.some((part) => isContinuationTextPartLike(part));
}
function normalizePromptInputForSemanticDedupe(input) {
  if (hasContinuationPromptIntent(input)) {
    return {
      __omo_internal_intent: "continuation"
    };
  }
  return canonicalizePromptInputForDedupe("", input);
}
function stringifyPromptInputForDedupe(input) {
  try {
    const serialized = JSON.stringify(normalizePromptInputForSemanticDedupe(input));
    return serialized ?? String(input);
  } catch (error) {
    const errorTag = error instanceof Error ? error.name : String(error);
    return `${String(input)}:[unserializable:${errorTag}]`;
  }
}
function createSemanticPromptDedupeKey(input) {
  const fingerprint = stringifyPromptInputForDedupe(input);
  const digest = createHash("sha256").update(fingerprint, "utf8").digest("hex");
  return `semantic:${digest}`;
}
function coalesceRecentSemanticPromptDispatch(args) {
  const recentDispatch = getRecentPromptDispatch(args.sessionID, args.dedupeKey);
  if (!recentDispatch) {
    return;
  }
  log("[prompt-async-gate] prompt coalesced with recent semantic dispatch", {
    sessionID: args.sessionID,
    source: args.source,
    queuedBy: recentDispatch.source
  });
  return { status: "queued", queuedBy: recentDispatch.source, position: 0 };
}

// ../../../../omo-engine/utils/src/prompt-async-gate.ts
function hasObjectSessionPath(input) {
  return typeof input === "object" && input !== null && "path" in input && typeof input.path === "object" && input.path !== null && "id" in input.path && typeof input.path.id === "string";
}
function isObjectPathTypeError(error) {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return message.includes('The "path" property must be of type string') && (message.includes("got object") || message.includes("got undefined"));
}
async function dispatchWithPathCompatibility(dispatch, input) {
  try {
    return await dispatch(input);
  } catch (error) {
    if (!isObjectPathTypeError(error) || !hasObjectSessionPath(input)) {
      throw error;
    }
    const retryInput = {
      ...input,
      path: input.path.id
    };
    return dispatch(retryInput);
  }
}
async function dispatchInternalPrompt(args) {
  const {
    client,
    sessionID,
    input,
    source,
    settleMs = DEFAULT_SESSION_IDLE_SETTLE_MS
  } = args;
  const dedupeKey = args.dedupeKey ?? createSemanticPromptDedupeKey(input);
  const queueRetryMs = args.queueRetryMs ?? DEFAULT_PROMPT_QUEUE_RETRY_MS;
  const postDispatchHoldMs = args.postDispatchHoldMs ?? DEFAULT_PROMPT_ASYNC_POST_DISPATCH_HOLD_MS;
  const semanticDedupeHoldMs = args.semanticDedupeHoldMs ?? (postDispatchHoldMs > 0 ? DEFAULT_PROMPT_SEMANTIC_DEDUPE_HOLD_MS : 0);
  const dispatchTimeoutMs = args.dispatchTimeoutMs ?? DEFAULT_PROMPT_DISPATCH_TIMEOUT_MS;
  const sessionName = args.mode === "async" ? "promptAsync" : "prompt";
  const resolved = tryResolveDispatchClientSync(args.client, sessionID) ?? await resolveDispatchClient(args.client, sessionID);
  const dispatch = (() => {
    if (args.mode === "async") {
      const resolvedAsAsync = resolved.client;
      const session = resolvedAsAsync.session;
      if (typeof session?.promptAsync !== "function") {
        return;
      }
      const dispatchPromptAsync = session.promptAsync.bind(session);
      if (resolved.route === "live") {
        const originalSession = args.client.session;
        return async (dispatchInput) => {
          log(LIVE_ROUTE_DISPATCH_LOG, { sessionID, source });
          try {
            return await dispatchPromptAsync(dispatchInput);
          } catch (error) {
            if (isPreSendConnectionFailure(error)) {
              markLiveRouteUnavailable(`dispatch:${error instanceof Error ? error.message : String(error)}`);
              if (typeof originalSession?.promptAsync === "function") {
                const fallbackDispatch = originalSession.promptAsync.bind(originalSession);
                return fallbackDispatch(dispatchInput);
              }
            }
            throw error;
          }
        };
      }
      if (resolved.reason === "unavailable") {
        log(LIVE_ROUTE_UNAVAILABLE_LOG, { sessionID, source });
      }
      return (dispatchInput) => dispatchPromptAsync(dispatchInput);
    }
    const resolvedAsSync = resolved.client;
    const session = resolvedAsSync.session;
    if (typeof session?.prompt !== "function") {
      return;
    }
    const dispatchPrompt = session.prompt.bind(session);
    if (resolved.route === "live") {
      const originalSession = args.client.session;
      return async (dispatchInput) => {
        log(LIVE_ROUTE_DISPATCH_LOG, { sessionID, source });
        try {
          return await dispatchPrompt(dispatchInput);
        } catch (error) {
          if (isPreSendConnectionFailure(error)) {
            markLiveRouteUnavailable(`dispatch:${error instanceof Error ? error.message : String(error)}`);
            if (typeof originalSession?.prompt === "function") {
              const fallbackDispatch = originalSession.prompt.bind(originalSession);
              return fallbackDispatch(dispatchInput);
            }
          }
          throw error;
        }
      };
    }
    if (resolved.reason === "unavailable") {
      log(LIVE_ROUTE_UNAVAILABLE_LOG, { sessionID, source });
    }
    return (dispatchInput) => dispatchPrompt(dispatchInput);
  })();
  if (!dispatch) {
    log(`[prompt-async-gate] ${sessionName} unavailable`, { sessionID, source });
    return { status: "unavailable" };
  }
  const resolvedClient = resolved.client;
  const dispatchTimeoutPrefix = `[prompt-async-gate] ${sessionName} dispatch`;
  const queueBehavior = args.queueBehavior ?? (args.mode === "sync" ? "defer" : "enqueue");
  if (queueBehavior === "defer") {
    const activeReservation = getActiveReservation(sessionID);
    if (activeReservation) {
      return reservedDispatchResult(activeReservation);
    }
    const queuedBy = getQueuedPromptBlocker(sessionID);
    if (queuedBy !== undefined || isPromptQueueDraining(sessionID)) {
      return { status: "reserved", reservedBy: queuedBy ?? source };
    }
    const recentDispatchResult = coalesceRecentSemanticPromptDispatch({ sessionID, dedupeKey, source });
    if (recentDispatchResult) {
      return recentDispatchResult;
    }
    const deferResult = await dispatchAfterSessionIdle({
      sessionName,
      client: resolvedClient,
      sessionID,
      input,
      source,
      dedupeKey,
      settleMs,
      postDispatchHoldMs,
      semanticDedupeHoldMs,
      dispatchTimeoutMs,
      checkStatus: args.checkStatus !== false,
      checkToolState: args.checkToolState !== false,
      shouldDispatch: args.shouldDispatch,
      retryDispatchFailure: args.retryDispatchFailure,
      dispatch: (dispatchInput) => dispatchWithPathCompatibility(dispatch, dispatchInput)
    });
    if (deferResult.status === "failed" && resolved.route === "live" && deferResult.error instanceof Error && deferResult.error.message.startsWith(dispatchTimeoutPrefix)) {
      markLiveRouteUnavailable("timeout");
    }
    return deferResult;
  }
  if (args.queue !== false) {
    const recentDispatchResult = coalesceRecentSemanticPromptDispatch({ sessionID, dedupeKey, source });
    if (recentDispatchResult) {
      return recentDispatchResult;
    }
    return enqueueInternalPrompt({
      id: nextPromptQueueID(),
      sessionID,
      sessionName,
      client: resolvedClient,
      input,
      source,
      dedupeKey,
      settleMs,
      postDispatchHoldMs,
      semanticDedupeHoldMs,
      dispatchTimeoutMs,
      queueRetryMs,
      checkStatus: args.checkStatus !== false,
      checkToolState: args.checkToolState !== false,
      durableRetry: args.durableRetry === true,
      shouldDispatch: args.shouldDispatch,
      retryDispatchFailure: args.retryDispatchFailure,
      dispatch: async (_dispatchInput) => dispatchWithPathCompatibility(dispatch, input)
    });
  }
  const recentDispatchResult = coalesceRecentSemanticPromptDispatch({ sessionID, dedupeKey, source });
  if (recentDispatchResult) {
    return recentDispatchResult;
  }
  const directResult = await dispatchAfterSessionIdle({
    sessionName,
    client: resolvedClient,
    sessionID,
    input,
    source,
    dedupeKey,
    settleMs,
    postDispatchHoldMs,
    semanticDedupeHoldMs,
    dispatchTimeoutMs,
    checkStatus: args.checkStatus !== false,
    checkToolState: args.checkToolState !== false,
    shouldDispatch: args.shouldDispatch,
    retryDispatchFailure: args.retryDispatchFailure,
    dispatch: (dispatchInput) => dispatchWithPathCompatibility(dispatch, dispatchInput)
  });
  if (directResult.status === "failed" && resolved.route === "live" && directResult.error instanceof Error && directResult.error.message.startsWith(dispatchTimeoutPrefix)) {
    markLiveRouteUnavailable("timeout");
  }
  return directResult;
}
function isInternalPromptDispatchAccepted(result) {
  return result.status === "dispatched" || result.status === "queued";
}

// ../../../../omo-engine/utils/src/prompt-failure-classifier.ts
function extractPromptFailureMessage(error) {
  if (typeof error === "string")
    return error;
  if (error instanceof Error)
    return error.message;
  if (typeof error === "object" && error !== null) {
    const record = error;
    if (typeof record.message === "string")
      return record.message;
    try {
      return JSON.stringify(error);
    } catch (stringifyError) {
      return "";
    }
  }
  return String(error);
}
function isAmbiguousPromptDispatchFailure(error) {
  const message = extractPromptFailureMessage(error).toLowerCase();
  return message.includes("unexpected eof") || message.includes("json parse error") || message.includes("unexpected end of json input") || message.includes("timed out");
}
function isAmbiguousPostDispatchPromptFailure(result) {
  return result.dispatchAttempted === true && isAmbiguousPromptDispatchFailure(result.error);
}

// ../../../../omo-engine/omo-opencode/src/shared/plugin-identity.ts
var PLUGIN_NAME = "oh-my-openagent";
var LEGACY_PLUGIN_NAME = "oh-my-opencode";
var LOG_FILENAME = "oh-my-opencode.log";
var CACHE_DIR_NAME = "oh-my-opencode";

// ../../../../omo-engine/omo-opencode/src/shared/logger.ts
var logger = createLogger({ logFileName: LOG_FILENAME });
var log2 = logger.log;
var getLogFilePath = logger.getLogFilePath;
configureSharedSubunitLogger(log2);
// ../../../../omo-engine/model-core/src/model-normalization.ts
function normalizeModelID(modelID) {
  return modelID.replace(/\.(\d+)/g, "-$1");
}
// ../../../../omo-engine/model-core/src/model-resolver.ts
function normalizeFallbackModels(models) {
  if (!models)
    return;
  if (typeof models === "string")
    return [models];
  return models;
}
// ../../../../omo-engine/model-core/src/model-format-normalizer.ts
function normalizeModelFormat(model) {
  if (!model) {
    return;
  }
  if (typeof model === "object" && "providerID" in model && "modelID" in model) {
    return { providerID: model.providerID, modelID: model.modelID };
  }
  if (typeof model === "string") {
    const parts = model.split("/");
    if (parts.length >= 2) {
      const providerID = parts[0];
      const modelID = parts.slice(1).join("/");
      if (providerID.trim() && modelID.trim()) {
        return { providerID, modelID };
      }
    }
  }
  return;
}
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
import { existsSync as existsSync4, mkdirSync as mkdirSync2, readFileSync as readFileSync2, writeFileSync } from "node:fs";
import { join as join5 } from "node:path";
function toLogLabel(cacheLabel) {
  return cacheLabel.toLowerCase();
}
function createJsonFileCacheStore(options) {
  let memoryValue;
  let writtenInCurrentProcess = false;
  function getCacheFilePath() {
    return join5(options.getCacheDir(), options.filename);
  }
  function ensureCacheDir() {
    const cacheDir = options.getCacheDir();
    if (!existsSync4(cacheDir)) {
      mkdirSync2(cacheDir, { recursive: true });
    }
  }
  function read() {
    if (memoryValue !== undefined) {
      return memoryValue;
    }
    const cacheFile = getCacheFilePath();
    if (!existsSync4(cacheFile)) {
      memoryValue = null;
      log2(`[${options.logPrefix}] ${options.cacheLabel} file not found`, { cacheFile });
      return null;
    }
    try {
      const content = readFileSync2(cacheFile, "utf-8");
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
    return existsSync4(getCacheFilePath());
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
            if (!isRecord9(rawMetadata)) {
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

// ../../../../omo-engine/omo-opencode/src/shared/disabled-providers.ts
var HOOK_NAME = "disabled-providers";
function getModelProvider(model) {
  const slash = model.indexOf("/");
  if (slash <= 0)
    return;
  const provider = model.slice(0, slash).trim();
  return provider || undefined;
}
function isProviderDisabled(model, disabled) {
  if (!model || disabled.length === 0)
    return false;
  const provider = getModelProvider(model);
  if (provider === undefined)
    return false;
  const providerLower = provider.toLowerCase();
  return disabled.some((entry) => entry.trim().toLowerCase() === providerLower);
}
function filterDisabledProviderModels(models, disabled) {
  if (disabled.length === 0)
    return [...models];
  return models.filter((entry) => {
    const model = typeof entry === "string" ? entry : entry.model;
    return !isProviderDisabled(model, disabled);
  });
}
function findFirstAllowedReplacement(chain, disabled) {
  if (!chain)
    return;
  for (const entry of chain) {
    const model = typeof entry === "string" ? entry : entry.model;
    if (!isProviderDisabled(model, disabled))
      return model;
  }
  return;
}
function applyToHolder(label, holder, disabled) {
  const normalizedChain = normalizeFallbackModels(holder.fallback_models);
  if (normalizedChain) {
    const filteredChain = filterDisabledProviderModels(normalizedChain, disabled);
    if (filteredChain.length !== normalizedChain.length) {
      log2(`[${HOOK_NAME}] Filtered disabled-provider entries from fallback chain`, {
        label,
        removed: normalizedChain.length - filteredChain.length,
        remaining: filteredChain.length
      });
    }
    holder.fallback_models = filteredChain.length === 0 ? undefined : filteredChain;
  }
  if (typeof holder.model === "string" && isProviderDisabled(holder.model, disabled)) {
    const replacement = findFirstAllowedReplacement(normalizeFallbackModels(holder.fallback_models), disabled);
    if (replacement) {
      log2(`[${HOOK_NAME}] Substituted primary model from fallback chain`, {
        label,
        from: holder.model,
        to: replacement
      });
      holder.model = replacement;
    } else {
      const message = `${label} primary model "${holder.model}" uses a disabled provider and no allowed entry is available in fallback_models. ` + `Either remove the provider from disabled_providers or add an allowed entry to fallback_models.`;
      addConfigLoadError({ path: `disabled_providers:${label}`, error: message });
      log2(`[${HOOK_NAME}] ${message}`, { label, primary: holder.model });
    }
  }
}
function applyDisabledProviders(config) {
  const disabled = config.disabled_providers ?? [];
  if (disabled.length === 0)
    return config;
  if (config.agents) {
    for (const [name, agentConfig] of Object.entries(config.agents)) {
      if (agentConfig && typeof agentConfig === "object") {
        applyToHolder(`agents.${name}`, agentConfig, disabled);
      }
    }
  }
  if (config.categories) {
    for (const [name, categoryConfig] of Object.entries(config.categories)) {
      if (categoryConfig && typeof categoryConfig === "object") {
        applyToHolder(`categories.${name}`, categoryConfig, disabled);
      }
    }
  }
  return config;
}

// ../../../../omo-engine/omo-opencode/src/plugin-config/omo-config-chain.ts
var NON_PLUGIN_FIELDS = new Set(["legacy_migrations", "models", "task", "teams"]);
function block(config) {
  const value = config["[opencode]"];
  return isPlainRecord(value) ? value : {};
}
function profile(config, name) {
  if (name === undefined)
    return {};
  const profiles = config.profiles;
  if (!isPlainRecord(profiles))
    return {};
  const selected = profiles[name];
  return isPlainRecord(selected) ? selected : {};
}
function baseView(config) {
  const result = {};
  for (const [key, value] of Object.entries(config)) {
    if (key === "profiles" || key.startsWith("[") && key.endsWith("]") || NON_PLUGIN_FIELDS.has(key))
      continue;
    result[key] = value;
  }
  return result;
}
function appendViews(views, layers, select, keyPrefix) {
  for (const layer of layers) {
    const config = select(layer.config);
    if (Object.keys(config).length > 0)
      views.push({ config, keyPrefix, path: layer.source.path });
  }
}
function recordFields(value, fields) {
  if (!isPlainRecord(value))
    return;
  const result = {};
  for (const field of fields) {
    if (field in value)
      result[field] = value[field];
  }
  return Object.keys(result).length > 0 ? result : undefined;
}
function modelInput(view) {
  const agents = isPlainRecord(view.agents) ? Object.fromEntries(Object.entries(view.agents).flatMap(([name, definition]) => {
    const fields = recordFields(definition, ["description", "prompt", "model", "models", "variant", "reasoningEffort", "tools", "temperature", "disable"]);
    return fields === undefined ? [] : [[name, fields]];
  })) : undefined;
  const categories = isPlainRecord(view.categories) ? Object.fromEntries(Object.entries(view.categories).flatMap(([name, definition]) => {
    const fields = recordFields(definition, ["description", "model", "fallback_models", "variant", "temperature", "top_p", "maxTokens", "thinking", "reasoningEffort", "textVerbosity", "tools", "prompt_append", "max_prompt_tokens", "is_unstable_agent", "disable"]);
    return fields === undefined ? [] : [[name, fields]];
  })) : undefined;
  return {
    ...isPlainRecord(view.models) ? { models: view.models } : {},
    ...agents === undefined ? {} : { agents },
    ...categories === undefined ? {} : { categories }
  };
}
function modelView(view) {
  const input = modelInput(view);
  const parsed = OmoConfigSchema.safeParse(input);
  const modelConfig = parsed.success ? parsed.data : (() => {
    const pruned = pruneInvalidConfigPaths(input, parsed.error.issues, (record) => {
      const validation = OmoConfigSchema.safeParse(record);
      return validation.success ? { success: true } : { success: false, issues: validation.error.issues };
    });
    if (!pruned.ok)
      return;
    const validation = OmoConfigSchema.safeParse(pruned.config);
    return validation.success ? validation.data : undefined;
  })();
  if (modelConfig === undefined)
    return { config: {}, diagnostics: [] };
  const resolved = resolveModelReferences(modelConfig);
  return {
    config: {
      ...resolved.view.agents === undefined ? {} : { agents: resolved.view.agents },
      ...resolved.view.categories === undefined ? {} : { categories: resolved.view.categories }
    },
    diagnostics: resolved.diagnostics
  };
}
function loadOmoOpenCodeConfigChain(directory, environment = process.env) {
  const loaded = loadOmoConfig({ cwd: directory, env: environment });
  const merged = loaded.layers.reduce((config, layer) => mergeOmoConfigRecords(config, layer.config), {});
  const resolved = resolveOmoConfigView({
    config: merged,
    harness: "opencode",
    ...loaded.profile === undefined ? {} : { profile: loaded.profile }
  });
  const views = [];
  const selectedProfile = loaded.profile;
  const profilePrefix = selectedProfile === undefined ? "" : `profiles.${selectedProfile}.`;
  appendViews(views, loaded.layers, baseView, "");
  appendViews(views, loaded.layers, block, "[opencode].");
  appendViews(views, loaded.layers, (config) => baseView(profile(config, selectedProfile)), profilePrefix);
  appendViews(views, loaded.layers, (config) => block(profile(config, selectedProfile)), `${profilePrefix}[opencode].`);
  const resolvedModels = modelView(resolved.config);
  if (Object.keys(resolvedModels.config).length > 0) {
    const source = loaded.layers[0]?.source.path ?? directory;
    views.push({ config: resolvedModels.config, keyPrefix: "", path: source });
  }
  let protectedUserView = {};
  for (const layer of loaded.layers) {
    if (layer.source.scope !== "user")
      continue;
    protectedUserView = mergeOmoConfigRecords(protectedUserView, block(layer.config));
  }
  for (const layer of loaded.layers) {
    if (layer.source.scope !== "user")
      continue;
    protectedUserView = mergeOmoConfigRecords(protectedUserView, block(profile(layer.config, selectedProfile)));
  }
  return {
    diagnostics: [
      ...loaded.diagnostics,
      ...resolvedModels.diagnostics
    ],
    protectedUserView,
    views
  };
}

// ../../../../omo-engine/omo-opencode/src/plugin-config/config-merger.ts
function mergeConfigs(base, override) {
  return {
    ...base,
    ...override,
    agents: deepMerge(base.agents, override.agents),
    categories: deepMerge(base.categories, override.categories),
    team_mode: deepMerge(base.team_mode, override.team_mode),
    agent_definitions: mergeUniqueStrings(base.agent_definitions, override.agent_definitions),
    disabled_agents: mergeUniqueStrings(base.disabled_agents, override.disabled_agents),
    disabled_mcps: mergeUniqueStrings(base.disabled_mcps, override.disabled_mcps),
    disabled_hooks: mergeUniqueStrings(base.disabled_hooks, override.disabled_hooks),
    disabled_commands: mergeUniqueStrings(base.disabled_commands, override.disabled_commands),
    disabled_skills: mergeUniqueStrings(base.disabled_skills, override.disabled_skills),
    disabled_tools: mergeUniqueStrings(base.disabled_tools, override.disabled_tools),
    disabled_providers: mergeUniqueStringsCaseInsensitive(base.disabled_providers, override.disabled_providers),
    mcp_env_allowlist: override.mcp_env_allowlist ?? base.mcp_env_allowlist,
    claude_code: deepMerge(base.claude_code, override.claude_code)
  };
}

// ../../../../omo-engine/omo-opencode/src/plugin-config/unknown-key-diagnostics.ts
function definition(schema) {
  return schema._zod.def;
}
function isPlainRecord3(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function unwrap(schema) {
  const def = definition(schema);
  if (["optional", "nullable", "default", "prefault", "nonoptional", "catch", "readonly"].includes(def.type)) {
    return def.innerType === undefined ? schema : unwrap(def.innerType);
  }
  if (def.type === "pipe")
    return def.in === undefined ? schema : unwrap(def.in);
  if (def.type === "lazy")
    return def.getter === undefined ? schema : unwrap(def.getter());
  return schema;
}
function matchesShape(schema, value) {
  const def = definition(unwrap(schema));
  if (def.type === "object" || def.type === "record")
    return isPlainRecord3(value);
  if (def.type === "array" || def.type === "tuple")
    return Array.isArray(value);
  if (def.type === "union")
    return def.options?.some((option) => matchesShape(option, value)) ?? false;
  if (def.type === "intersection")
    return def.left !== undefined && def.right !== undefined && matchesShape(def.left, value) && matchesShape(def.right, value);
  if (def.type === "string")
    return typeof value === "string";
  if (def.type === "number")
    return typeof value === "number";
  if (def.type === "boolean")
    return typeof value === "boolean";
  return true;
}
function unknownPaths(schema, value, path) {
  const unwrapped = unwrap(schema);
  const def = definition(unwrapped);
  if (def.type === "object" && isPlainRecord3(value) && def.shape !== undefined) {
    const catchall = def.catchall !== undefined && definition(def.catchall).type !== "never" ? def.catchall : undefined;
    return Object.entries(value).flatMap(([key, entry]) => {
      const propertySchema = def.shape !== undefined && Object.hasOwn(def.shape, key) ? def.shape[key] : undefined;
      if (propertySchema !== undefined)
        return unknownPaths(propertySchema, entry, [...path, key]);
      if (catchall !== undefined)
        return unknownPaths(catchall, entry, [...path, key]);
      return [[...path, key]];
    });
  }
  if (def.type === "record" && isPlainRecord3(value)) {
    const valueSchema = def.valueType;
    if (valueSchema !== undefined) {
      return Object.entries(value).flatMap(([key, entry]) => unknownPaths(valueSchema, entry, [...path, key]));
    }
  }
  if (def.type === "array" && Array.isArray(value)) {
    const element = def.element;
    if (element !== undefined)
      return value.flatMap((entry, index) => unknownPaths(element, entry, [...path, index]));
  }
  if (def.type === "tuple" && Array.isArray(value)) {
    return value.flatMap((entry, index) => {
      const item = def.items?.[index] ?? def.rest;
      return item === undefined || item === null ? [] : unknownPaths(item, entry, [...path, index]);
    });
  }
  if (def.type === "union") {
    const candidates = (def.options ?? []).filter((option) => matchesShape(option, value)).map((option) => unknownPaths(option, value, path));
    return candidates.reduce((best, candidate) => best === undefined || candidate.length < best.length ? candidate : best, undefined) ?? [];
  }
  if (def.type === "intersection" && def.left !== undefined && def.right !== undefined) {
    return [...unknownPaths(def.left, value, path), ...unknownPaths(def.right, value, path)];
  }
  return [];
}
function findUnknownKeyPaths(schema, value) {
  return unknownPaths(schema, value, []);
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
// ../../../../omo-engine/omo-opencode/src/config/schema/fallback-models.ts
var FallbackModelObjectSchema = object({
  model: string2(),
  reasoning: OmoReasoningSchema.optional(),
  variant: string2().optional(),
  reasoningEffort: _enum(["none", "minimal", "low", "medium", "high", "xhigh", "max"]).optional(),
  temperature: number2().min(0).max(2).optional(),
  top_p: number2().min(0).max(1).optional(),
  maxTokens: number2().optional(),
  thinking: object({
    type: _enum(["enabled", "disabled"]),
    budgetTokens: number2().optional()
  }).optional()
});
var FallbackModelStringArraySchema = array(string2());
var FallbackModelObjectArraySchema = array(FallbackModelObjectSchema);
var FallbackModelMixedArraySchema = array(union([string2(), FallbackModelObjectSchema]));
var FallbackModelsSchema = union([
  string2(),
  FallbackModelStringArraySchema,
  FallbackModelObjectArraySchema,
  FallbackModelMixedArraySchema
]);

// ../../../../omo-engine/omo-opencode/src/config/schema/internal/permission.ts
var PermissionValueSchema2 = _enum(["ask", "allow", "deny"]);
var BashPermissionSchema2 = union([
  PermissionValueSchema2,
  record(string2(), PermissionValueSchema2)
]);
var AgentPermissionSchema = object({
  edit: PermissionValueSchema2.optional(),
  bash: BashPermissionSchema2.optional(),
  webfetch: PermissionValueSchema2.optional(),
  task: PermissionValueSchema2.optional(),
  doom_loop: PermissionValueSchema2.optional(),
  external_directory: PermissionValueSchema2.optional()
}).catchall(PermissionValueSchema2.optional());

// ../../../../omo-engine/omo-opencode/src/config/schema/agent-overrides.ts
var AgentOverrideConfigSchema = object({
  model: string2().optional(),
  models: array(union([string2(), FallbackModelObjectSchema])).optional(),
  fallback_models: FallbackModelsSchema.optional(),
  reasoning: OmoReasoningSchema.optional(),
  variant: string2().optional(),
  category: string2().optional(),
  skills: array(string2()).optional(),
  temperature: number2().min(0).max(2).optional(),
  top_p: number2().min(0).max(1).optional(),
  prompt: string2().optional(),
  prompt_append: string2().optional(),
  tools: record(string2(), boolean2()).optional(),
  disable: boolean2().optional(),
  description: string2().optional(),
  mode: _enum(["subagent", "primary", "all"]).optional(),
  color: string2().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  displayName: string2().optional(),
  permission: AgentPermissionSchema.optional(),
  maxTokens: number2().optional(),
  thinking: object({
    type: _enum(["enabled", "disabled"]),
    budgetTokens: number2().optional()
  }).optional(),
  reasoningEffort: _enum(["none", "minimal", "low", "medium", "high", "xhigh", "max"]).optional(),
  textVerbosity: _enum(["low", "medium", "high"]).optional(),
  providerOptions: record(string2(), unknown()).optional(),
  ultrawork: object({
    model: string2().optional(),
    reasoning: OmoReasoningSchema.optional(),
    variant: string2().optional()
  }).optional(),
  compaction: object({
    model: string2().optional(),
    reasoning: OmoReasoningSchema.optional(),
    variant: string2().optional()
  }).optional()
});
var AgentOverridesSchema = object({
  build: AgentOverrideConfigSchema.optional(),
  plan: AgentOverrideConfigSchema.optional(),
  sisyphus: AgentOverrideConfigSchema.optional(),
  hephaestus: AgentOverrideConfigSchema.extend({
    allow_non_gpt_model: boolean2().optional()
  }).optional(),
  "sisyphus-junior": AgentOverrideConfigSchema.optional(),
  "OpenCode-Builder": AgentOverrideConfigSchema.optional(),
  prometheus: AgentOverrideConfigSchema.optional(),
  metis: AgentOverrideConfigSchema.optional(),
  momus: AgentOverrideConfigSchema.optional(),
  oracle: AgentOverrideConfigSchema.optional(),
  librarian: AgentOverrideConfigSchema.optional(),
  explore: AgentOverrideConfigSchema.optional(),
  "multimodal-looker": AgentOverrideConfigSchema.optional(),
  atlas: AgentOverrideConfigSchema.optional()
}).catchall(AgentOverrideConfigSchema.optional());
// ../../../../omo-engine/omo-opencode/src/config/schema/babysitting.ts
var BabysittingConfigSchema = object({
  timeout_ms: number2().default(120000)
});
// ../../../../omo-engine/omo-opencode/src/config/schema/background-task.ts
var CircuitBreakerConfigSchema = object({
  enabled: boolean2().optional(),
  maxToolCalls: number2().int().min(10).optional(),
  consecutiveThreshold: number2().int().min(5).optional()
});
var BackgroundTaskConfigSchema = object({
  defaultConcurrency: number2().min(0).optional(),
  providerConcurrency: record(string2(), number2().min(0)).optional(),
  modelConcurrency: record(string2(), number2().min(0)).optional(),
  maxDepth: number2().int().min(1).optional(),
  maxLiveDescendantsPerRoot: number2().int().min(0).optional(),
  staleTimeoutMs: number2().min(60000).optional(),
  messageStalenessTimeoutMs: number2().min(60000).optional(),
  taskTtlMs: number2().min(300000).optional(),
  sessionGoneTimeoutMs: number2().min(1e4).optional(),
  taskCleanupDelayMs: number2().min(60000).optional(),
  syncPollTimeoutMs: number2().min(60000).optional(),
  maxToolCalls: number2().int().min(10).optional(),
  circuitBreaker: CircuitBreakerConfigSchema.optional()
});
// ../../../../omo-engine/omo-opencode/src/config/schema/browser-automation.ts
var BrowserAutomationProviderSchema = _enum([
  "playwright",
  "dev-browser",
  "playwright-cli"
], {
  error: (issue) => `Browser provider ${JSON.stringify(issue.input)} is no longer supported; use the built-in browser path: Bun.WebView / playwright-core scripts`
});
var BrowserAutomationConfigSchema = object({
  provider: BrowserAutomationProviderSchema.default("playwright"),
  playwright_mcp_args: array(string2()).optional()
});
// ../../../../omo-engine/omo-opencode/src/config/schema/categories.ts
var CategoryConfigSchema = object({
  description: string2().optional(),
  model: string2().optional(),
  models: array(union([string2(), FallbackModelObjectSchema])).optional(),
  fallback_models: FallbackModelsSchema.optional(),
  reasoning: OmoReasoningSchema.optional(),
  variant: string2().optional(),
  temperature: number2().min(0).max(2).optional(),
  top_p: number2().min(0).max(1).optional(),
  max_tokens: number2().int().positive().optional(),
  provider_options: record(string2(), unknown()).optional(),
  maxTokens: number2().optional(),
  thinking: object({
    type: _enum(["enabled", "disabled"]),
    budgetTokens: number2().optional()
  }).optional(),
  reasoningEffort: _enum(["none", "minimal", "low", "medium", "high", "xhigh", "max"]).optional(),
  textVerbosity: _enum(["low", "medium", "high"]).optional(),
  tools: record(string2(), boolean2()).optional(),
  prompt_append: string2().optional(),
  max_prompt_tokens: number2().int().positive().optional(),
  is_unstable_agent: boolean2().optional(),
  disable: boolean2().optional(),
  warn_unavailable: boolean2().optional()
});
var BuiltinCategoryNameSchema = _enum([
  "visual-engineering",
  "ultrabrain",
  "deep-low",
  "deep-high",
  "artistry",
  "architect",
  "quick",
  "unspecified-low",
  "unspecified-high",
  "writing"
]);
var CategoriesConfigSchema = record(string2(), CategoryConfigSchema);
// ../../../../omo-engine/omo-opencode/src/config/schema/claude-code.ts
var ClaudeCodeConfigSchema = object({
  mcp: boolean2().optional(),
  commands: boolean2().optional(),
  skills: boolean2().optional(),
  agents: boolean2().optional(),
  hooks: boolean2().optional(),
  plugins: boolean2().optional(),
  plugins_override: record(string2(), boolean2()).optional(),
  anthropic_provider: string2().trim().min(1).refine((v) => !v.includes("/"), {
    message: "anthropic_provider must be a provider name without '/'"
  }).optional()
});
// ../../../../omo-engine/omo-opencode/src/config/schema/comment-checker.ts
var CommentCheckerConfigSchema = object({
  custom_prompt: string2().optional()
});
// ../../../../omo-engine/omo-opencode/src/config/schema/commands.ts
var BuiltinCommandNameSchema = _enum([
  "goal",
  "refactor",
  "ulw-execute",
  "stop-continuation",
  "remove-ai-slops",
  "hyperplan"
]);
// ../../../../omo-engine/omo-opencode/src/config/schema/default-mode.ts
var DefaultModeConfigSchema = object({
  ultrawork: boolean2().default(false),
  goal: boolean2().default(false)
});
// ../../../../omo-engine/omo-opencode/src/config/schema/dynamic-context-pruning.ts
var DynamicContextPruningConfigSchema = object({
  enabled: boolean2().default(false),
  notification: _enum(["off", "minimal", "detailed"]).default("detailed"),
  turn_protection: object({
    enabled: boolean2().default(true),
    turns: number2().min(1).max(10).default(3)
  }).optional(),
  protected_tools: array(string2()).default([
    "task",
    "todowrite",
    "todoread",
    "lsp_rename",
    "session_read",
    "session_write",
    "session_search"
  ]),
  strategies: object({
    deduplication: object({
      enabled: boolean2().default(true)
    }).optional(),
    supersede_writes: object({
      enabled: boolean2().default(true),
      aggressive: boolean2().default(false)
    }).optional(),
    purge_errors: object({
      enabled: boolean2().default(true),
      turns: number2().min(1).max(20).default(5)
    }).optional()
  }).optional()
});
// ../../../../omo-engine/omo-opencode/src/config/schema/experimental.ts
var ExperimentalConfigSchema = object({
  aggressive_truncation: boolean2().optional(),
  preemptive_compaction: boolean2().optional(),
  truncate_all_tool_outputs: boolean2().optional(),
  dynamic_context_pruning: DynamicContextPruningConfigSchema.optional(),
  task_system: boolean2().optional(),
  plugin_load_timeout_ms: number2().min(1000).optional(),
  safe_hook_creation: boolean2().optional(),
  disable_omo_env: boolean2().optional(),
  hashline_edit: boolean2().optional(),
  model_fallback_title: boolean2().optional(),
  max_tools: number2().int().min(1).optional(),
  disable_live_parent_wake_routing: boolean2().optional()
});
// ../../../../omo-engine/omo-opencode/src/config/schema/goal.ts
var GoalConfigSchema = object({
  enabled: boolean2().default(false),
  auto_start: boolean2().default(false),
  default_max_iterations: number2().min(1).max(1000).default(100)
});
// ../../../../omo-engine/skills-loader-core/src/config/git-env-prefix.ts
var GIT_ENV_ASSIGNMENT_PATTERN = /^(?:[A-Za-z_][A-Za-z0-9_]*=[A-Za-z0-9_-]*)(?: [A-Za-z_][A-Za-z0-9_]*=[A-Za-z0-9_-]*)*$/;
var GIT_ENV_PREFIX_VALIDATION_MESSAGE = 'git_env_prefix must be empty or use shell-safe env assignments like "GIT_MASTER=1"';
function isValidGitEnvPrefix(value) {
  if (value === "") {
    return true;
  }
  return GIT_ENV_ASSIGNMENT_PATTERN.test(value);
}
var GitEnvPrefixSchema = string2().refine(isValidGitEnvPrefix, { message: GIT_ENV_PREFIX_VALIDATION_MESSAGE }).default("GIT_MASTER=1");
// ../../../../omo-engine/omo-opencode/src/config/schema/git-master.ts
var GitMasterConfigSchema = object({
  commit_footer: union([boolean2(), string2()]).default(false),
  include_co_authored_by: boolean2().default(false),
  git_env_prefix: GitEnvPrefixSchema
});
// ../../../../omo-engine/omo-opencode/src/config/schema/hooks.ts
var HookNameSchema = _enum([
  "todo-continuation-enforcer",
  "session-notification",
  "comment-checker",
  "tool-output-truncator",
  "question-label-truncator",
  "directory-agents-injector",
  "directory-readme-injector",
  "empty-task-response-detector",
  "think-mode",
  "model-fallback",
  "anthropic-context-window-limit-recovery",
  "preemptive-compaction",
  "rules-injector",
  "background-notification",
  "auto-update-checker",
  "ast-grep-sg-provision",
  "startup-toast",
  "keyword-detector",
  "agent-usage-reminder",
  "non-interactive-env",
  "interactive-bash-session",
  "tool-pair-validator",
  "monitor-status-injector",
  "goal",
  "category-skill-reminder",
  "compaction-context-injector",
  "compaction-todo-preserver",
  "claude-code-hooks",
  "auto-slash-command",
  "edit-error-recovery",
  "json-error-recovery",
  "delegate-task-retry",
  "prometheus-md-only",
  "sisyphus-junior-notepad",
  "team-tool-gating",
  "no-sisyphus-gpt",
  "no-hephaestus-non-gpt",
  "hephaestus-agents-md-injector",
  "ulw-execute",
  "atlas",
  "unstable-agent-babysitter",
  "task-resume-info",
  "stop-continuation-guard",
  "tasks-todowrite-disabler",
  "runtime-fallback",
  "write-existing-file-guard",
  "notepad-write-guard",
  "bash-file-read-guard",
  "hashline-read-enhancer",
  "read-image-resizer",
  "todo-description-override",
  "webfetch-redirect-guard",
  "fsync-skip-warning",
  "plan-format-validator",
  "legacy-plugin-toast",
  "native-edition-nudge"
]);
// ../../../../omo-engine/omo-opencode/src/config/schema/i18n.ts
var I18nConfigSchema = object({
  locale: string2().optional()
});
// ../../../../omo-engine/omo-opencode/src/config/schema/keyword-detector.ts
var KeywordTypeSchema = _enum(["ultrawork", "team", "hyperplan", "hyperplan-ultrawork"]);
var KeywordDetectorConfigSchema = object({
  enabled_expansions: array(KeywordTypeSchema).optional(),
  disabled_keywords: array(KeywordTypeSchema).optional()
});
// ../../../../omo-engine/omo-opencode/src/config/schema/model-capabilities.ts
var ModelCapabilitiesConfigSchema = object({
  enabled: boolean2().optional(),
  auto_refresh_on_start: boolean2().optional(),
  refresh_timeout_ms: number2().int().positive().optional(),
  source_url: string2().url().optional()
});
// ../../../../omo-engine/omo-opencode/src/config/schema/notification.ts
var NotificationConfigSchema = object({
  force_enable: boolean2().optional()
});
// ../../../../omo-engine/omo-opencode/src/mcp/types.ts
var McpNameSchema = _enum(["websearch", "context7", "grep_app", "lsp"]);
var AnyMcpNameSchema = string2().min(1);

// ../../../../omo-engine/omo-opencode/src/config/schema/agent-definitions.ts
var AgentDefinitionPathSchema = string2().min(1);
var AgentDefinitionsConfigSchema = array(AgentDefinitionPathSchema).optional();

// ../../../../omo-engine/omo-opencode/src/config/schema/openclaw.ts
var OpenClawGatewaySchema = object({
  type: _enum(["http", "command"]).default("http"),
  url: string2().optional(),
  method: string2().default("POST"),
  headers: record(string2(), string2()).optional(),
  command: string2().optional(),
  timeout: number2().optional()
});
var OpenClawHookSchema = object({
  enabled: boolean2().default(true),
  gateway: string2(),
  instruction: string2()
});
var OpenClawReplyListenerConfigSchema = object({
  discordBotToken: string2().optional(),
  discordChannelId: string2().optional(),
  discordMention: string2().optional(),
  authorizedDiscordUserIds: array(string2()).default([]),
  telegramBotToken: string2().optional(),
  telegramChatId: string2().optional(),
  pollIntervalMs: number2().default(3000),
  rateLimitPerMinute: number2().default(10),
  maxMessageLength: number2().default(500),
  includePrefix: boolean2().default(true)
});
var OpenClawConfigSchema = object({
  enabled: boolean2().default(false),
  gateways: record(string2(), OpenClawGatewaySchema).default({}),
  hooks: record(string2(), OpenClawHookSchema).default({}),
  replyListener: OpenClawReplyListenerConfigSchema.optional()
});

// ../../../../omo-engine/omo-opencode/src/config/schema/monitor.ts
var MonitorConfigSchema = object({
  enabled: boolean2().default(false),
  live_mode_enabled: boolean2().default(false),
  allowed_commands: array(string2()).optional(),
  max_monitors_per_session: number2().int().min(1).max(16).default(3),
  max_runtime_ms: number2().int().min(1000).default(1800000),
  batch_max_lines: number2().int().min(1).default(50),
  batch_max_bytes: number2().int().min(1024).default(16384),
  flush_interval_ms: number2().int().min(250).default(1000),
  ring_max_lines: number2().int().min(1).default(1000),
  line_max_bytes: number2().int().min(256).default(8192),
  pattern_max_length: number2().int().min(1).default(512)
});

// ../../../../omo-engine/omo-opencode/src/config/schema/runtime-fallback.ts
var RuntimeFallbackConfigSchema = object({
  enabled: boolean2().optional(),
  retry_on_errors: array(number2()).optional(),
  max_fallback_attempts: number2().min(1).max(20).optional(),
  cooldown_seconds: number2().min(0).optional(),
  timeout_seconds: number2().min(0).optional(),
  notify_on_fallback: boolean2().optional(),
  restore_primary_after_cooldown: boolean2().optional()
});

// ../../../../omo-engine/team-core/src/config.ts
var TeamModeConfigSchema = object({
  enabled: boolean2().default(false),
  tmux_visualization: boolean2().default(false),
  max_parallel_members: number2().int().min(1).max(8).default(4),
  max_members: number2().int().min(1).max(8).default(8),
  max_messages_per_run: number2().int().min(1).default(1e4),
  max_wall_clock_minutes: number2().int().min(1).default(120),
  max_member_turns: number2().int().min(1).default(500),
  base_dir: string2().optional(),
  message_payload_max_bytes: number2().int().min(1024).default(32768),
  recipient_unread_max_bytes: number2().int().min(1024).default(262144),
  mailbox_poll_interval_ms: number2().int().min(500).default(3000)
});
// ../../../../omo-engine/omo-opencode/src/config/schema/skills.ts
var SkillSourceSchema = union([
  string2(),
  object({
    path: string2(),
    recursive: boolean2().optional(),
    glob: string2().optional()
  })
]);
var SkillDefinitionSchema = object({
  description: string2().optional(),
  template: string2().optional(),
  from: string2().optional(),
  model: string2().optional(),
  agent: string2().optional(),
  subtask: boolean2().optional(),
  "argument-hint": string2().optional(),
  license: string2().optional(),
  compatibility: string2().optional(),
  metadata: record(string2(), unknown()).optional(),
  "allowed-tools": array(string2()).optional(),
  disable: boolean2().optional()
});
var SkillEntrySchema = union([boolean2(), SkillDefinitionSchema]);
var SkillsConfigSchema = union([
  array(string2()),
  object({
    sources: array(SkillSourceSchema).optional(),
    enable: array(string2()).optional(),
    disable: array(string2()).optional()
  }).catchall(SkillEntrySchema)
]);

// ../../../../omo-engine/omo-opencode/src/config/schema/sisyphus.ts
var SisyphusTasksConfigSchema = object({
  storage_path: string2().optional(),
  task_list_id: string2().optional(),
  claude_code_compat: boolean2().default(false)
});
var SisyphusConfigSchema = object({
  tasks: SisyphusTasksConfigSchema.optional()
});

// ../../../../omo-engine/omo-opencode/src/config/schema/sisyphus-agent.ts
var SisyphusAgentConfigSchema = object({
  disabled: boolean2().optional(),
  default_builder_enabled: boolean2().optional(),
  planner_enabled: boolean2().optional(),
  replace_plan: boolean2().optional(),
  tdd: boolean2().default(true).optional()
});

// ../../../../omo-engine/tmux-core/src/types.ts
var TMUX_LAYOUT_VALUES = [
  "main-horizontal",
  "main-vertical",
  "tiled",
  "even-horizontal",
  "even-vertical"
];
var TMUX_ISOLATION_VALUES = ["inline", "window", "session"];
// ../../../../omo-engine/tmux-core/src/constants.ts
var SESSION_TIMEOUT_MS = 60 * 60 * 1000;
var SESSION_MISSING_GRACE_MS = 30 * 1000;

// ../../../../omo-engine/tmux-core/src/index.ts
init_runner();

// ../../../../omo-engine/tmux-core/src/tmux-utils.ts
init_environment();

// ../../../../omo-engine/tmux-core/src/tmux-utils/server-health.ts
var SERVER_RUNNING_KEY = Symbol.for("oh-my-opencode:server-running-in-process");
// ../../../../omo-engine/tmux-core/src/tmux-utils/pane-dimensions.ts
init_runner();
// ../../../../omo-engine/tmux-core/src/tmux-utils/pane-spawn.ts
init_environment();
// ../../../../omo-engine/tmux-core/src/tmux-utils/pane-replace.ts
init_environment();
// ../../../../omo-engine/tmux-core/src/tmux-utils/pane-activate.ts
init_runner();
init_environment();
// ../../../../omo-engine/tmux-core/src/tmux-utils/window-spawn.ts
init_environment();
// ../../../../omo-engine/tmux-core/src/tmux-utils/session-spawn.ts
init_environment();
// ../../../../omo-engine/tmux-core/src/tmux-utils/session-kill.ts
init_runner();
init_environment();
// ../../../../omo-engine/tmux-core/src/tmux-utils/stale-session-sweep.ts
init_runner();
init_environment();
// ../../../../omo-engine/tmux-core/src/tmux-utils/layout.ts
init_runner();
// ../../../../omo-engine/omo-opencode/src/config/schema/tmux.ts
var TmuxLayoutSchema = _enum(TMUX_LAYOUT_VALUES);
var TmuxIsolationSchema = _enum(TMUX_ISOLATION_VALUES);
var TmuxConfigSchema = object({
  enabled: boolean2().default(false),
  layout: TmuxLayoutSchema.default("main-vertical"),
  main_pane_size: number2().min(20).max(80).default(60),
  main_pane_min_width: number2().min(40).default(120),
  agent_pane_min_width: number2().min(20).default(40),
  isolation: TmuxIsolationSchema.default("inline")
});

// ../../../../omo-engine/omo-opencode/src/config/schema/tui.ts
var TuiSidebarConfigSchema = object({
  enabled: boolean2().default(true)
});
var TuiConfigSchema = object({
  sidebar: TuiSidebarConfigSchema.default({ enabled: true })
});

// ../../../../omo-engine/omo-opencode/src/config/schema/ulw-execute.ts
var UlwExecuteConfigSchema = object({
  auto_commit: boolean2().default(true)
});

// ../../../../omo-engine/omo-opencode/src/config/schema/websearch.ts
var WebsearchProviderSchema = _enum(["exa", "tavily"]);
var WebsearchConfigSchema = object({
  provider: WebsearchProviderSchema.optional()
});

// ../../../../omo-engine/omo-opencode/src/config/schema/oh-my-opencode-config.ts
var OhMyOpenCodeConfigSchema = object({
  $schema: string2().optional(),
  new_task_system_enabled: boolean2().optional(),
  default_run_agent: string2().optional(),
  agent_order: array(string2().max(128)).max(64).optional(),
  agent_definitions: AgentDefinitionsConfigSchema,
  disabled_mcps: array(AnyMcpNameSchema).optional(),
  disabled_agents: array(string2()).optional(),
  disabled_skills: array(string2()).optional(),
  disabled_hooks: array(string2()).optional(),
  disabled_commands: array(BuiltinCommandNameSchema).optional(),
  disabled_tools: array(string2()).optional(),
  disabled_providers: array(string2()).optional(),
  mcp_env_allowlist: array(string2()).optional(),
  hashline_edit: boolean2().optional(),
  telemetry: boolean2().optional().describe("Enable or disable anonymous telemetry. Default: enabled when omitted. Set to false to disable."),
  model_fallback: boolean2().optional(),
  agents: AgentOverridesSchema.optional(),
  categories: CategoriesConfigSchema.optional(),
  claude_code: ClaudeCodeConfigSchema.optional(),
  sisyphus_agent: SisyphusAgentConfigSchema.optional(),
  comment_checker: CommentCheckerConfigSchema.optional(),
  experimental: ExperimentalConfigSchema.optional(),
  auto_update: boolean2().optional(),
  skills: SkillsConfigSchema.optional(),
  goal: GoalConfigSchema.optional(),
  ralph_loop: record(string2(), unknown()).optional(),
  runtime_fallback: union([boolean2(), RuntimeFallbackConfigSchema]).optional(),
  background_task: BackgroundTaskConfigSchema.optional(),
  notification: NotificationConfigSchema.optional(),
  model_capabilities: ModelCapabilitiesConfigSchema.optional(),
  openclaw: OpenClawConfigSchema.optional(),
  i18n: I18nConfigSchema.optional(),
  monitor: MonitorConfigSchema.optional(),
  team_mode: TeamModeConfigSchema.optional(),
  keyword_detector: KeywordDetectorConfigSchema.optional(),
  babysitting: BabysittingConfigSchema.optional(),
  git_master: GitMasterConfigSchema.default({
    commit_footer: false,
    include_co_authored_by: false,
    git_env_prefix: "GIT_MASTER=1"
  }),
  browser_automation_engine: BrowserAutomationConfigSchema.optional(),
  websearch: WebsearchConfigSchema.optional(),
  tmux: TmuxConfigSchema.optional(),
  tui: TuiConfigSchema.default({ sidebar: { enabled: true } }).optional(),
  sisyphus: SisyphusConfigSchema.optional(),
  ulw_execute: UlwExecuteConfigSchema.optional(),
  start_work: UlwExecuteConfigSchema.optional(),
  default_mode: DefaultModeConfigSchema.optional(),
  _migrations: array(string2()).optional()
});
// ../../../../omo-engine/omo-opencode/src/config/prune-plugin-view.ts
var validatePluginRecord = (record) => {
  const parsed = OhMyOpenCodeConfigSchema.safeParse(record);
  return parsed.success ? { success: true } : { success: false, issues: parsed.error.issues };
};
function prunePluginView(input) {
  const validation = OhMyOpenCodeConfigSchema.safeParse(input.config);
  if (validation.success)
    return { config: input.config, issues: [], warnings: [] };
  const pruned = pruneInvalidConfigPaths(input.config, validation.error.issues, validatePluginRecord);
  if (!pruned.ok)
    return { config: input.config, issues: validation.error.issues, warnings: [] };
  const file = displayOmoConfigPath(input.path, input.homeDir);
  return {
    config: pruned.config,
    issues: [],
    warnings: pruned.dropped.map((entry) => `config: ${file}: ${input.keyPrefix}${entry.key} ignored (invalid value)`)
  };
}

// ../../../../omo-engine/omo-opencode/src/config/validate.ts
function shortPath(configPath) {
  const candidate = relative2(process.cwd(), configPath);
  return candidate.length > 0 ? candidate : configPath;
}
function formatIssuePath(path) {
  const formatted = path.map((segment) => String(segment)).join(".");
  return formatted.length > 0 ? formatted : "<root>";
}
function schemaMessages(configPath, rawConfig, issues) {
  const validationMessages = issues.map((issue) => `${shortPath(configPath)}: ${formatIssuePath(issue.path)}: ${issue.message}`);
  const unknownKeyMessages = findUnknownKeyPaths(OhMyOpenCodeConfigSchema, rawConfig).map((path) => `${shortPath(configPath)}: Unknown config key: ${formatIssuePath(path)}`);
  return [...validationMessages, ...unknownKeyMessages];
}
function parseConfig(rawConfig) {
  let config = {};
  for (const [key, value] of Object.entries(rawConfig)) {
    const result = OhMyOpenCodeConfigSchema.safeParse({ [key]: value });
    if (!result.success)
      continue;
    const section = Object.entries(result.data).find(([parsedKey]) => parsedKey === key);
    if (section !== undefined)
      config = Object.assign(config, Object.fromEntries([section]));
  }
  return config;
}
function parseConfigView(view, homeDir) {
  const pruned = prunePluginView({ config: view.config, homeDir, keyPrefix: view.keyPrefix, path: view.path });
  return {
    config: parseConfig(pruned.config),
    messages: schemaMessages(view.path, view.config, pruned.issues),
    path: view.path,
    warnings: pruned.warnings
  };
}
function mergeViews(views) {
  let config = OhMyOpenCodeConfigSchema.parse({});
  for (const view of views) {
    config = mergeConfigs(config, view.config);
  }
  return config;
}
function protectUserFields(config, userConfig) {
  const userMcpEnvAllowlist = userConfig?.mcp_env_allowlist ?? [];
  const userPlaywrightMcpArgs = userConfig?.browser_automation_engine?.playwright_mcp_args;
  const browserAutomationEngine = config.browser_automation_engine === undefined ? undefined : (() => {
    const { playwright_mcp_args: _projectPlaywrightMcpArgs, ...browser } = config.browser_automation_engine;
    return browser;
  })();
  return {
    ...config,
    mcp_env_allowlist: userMcpEnvAllowlist,
    ...browserAutomationEngine === undefined ? {} : {
      browser_automation_engine: userPlaywrightMcpArgs === undefined ? browserAutomationEngine : { ...browserAutomationEngine, playwright_mcp_args: userPlaywrightMcpArgs }
    }
  };
}
function materializeAgentModelChains(config) {
  if (config.agents === undefined)
    return config;
  let changed = false;
  const agents = Object.fromEntries(Object.entries(config.agents).map(([name, agent]) => {
    if (agent?.models === undefined)
      return [name, agent];
    const [primary, ...fallbacks] = agent.models;
    const {
      models: _models,
      model: _model,
      fallback_models: _fallbackModels,
      reasoning: _reasoning,
      variant: _variant,
      reasoningEffort: _reasoningEffort,
      temperature: _temperature,
      top_p: _topP,
      maxTokens: _maxTokens,
      thinking: _thinking,
      ...rest
    } = agent;
    const primarySettings = primary === undefined ? {} : typeof primary === "string" ? { model: primary } : primary;
    changed = true;
    return [name, {
      ...rest,
      ...primarySettings,
      fallback_models: fallbacks
    }];
  }));
  return changed ? { ...config, agents } : config;
}
var START_WORK_DEPRECATION_MESSAGE = 'config key "start_work" is deprecated, rename to "ulw_execute" - will be removed next release';
var deprecationWarningSink = log2;
function warnLegacyUlwExecuteKey(views) {
  for (const view of views) {
    if (!Object.hasOwn(view.config, "start_work"))
      continue;
    deprecationWarningSink(`[config] ${shortPath(view.path)}: ${START_WORK_DEPRECATION_MESSAGE}`);
  }
}
function migrateLegacyUlwExecuteKey(config) {
  const legacy = config.start_work;
  if (legacy === undefined || config.ulw_execute !== undefined)
    return config;
  return { ...config, ulw_execute: legacy };
}
function migrateRalphLoopConfig(config) {
  const legacy = config.ralph_loop;
  if (legacy === undefined)
    return config;
  const enabled = typeof legacy.enabled === "boolean" ? legacy.enabled : undefined;
  const defaultMaxIterations = typeof legacy.default_max_iterations === "number" ? legacy.default_max_iterations : undefined;
  if (enabled === undefined && defaultMaxIterations === undefined)
    return config;
  log2("[config] ralph_loop is deprecated and will be removed in a future release. Use goal instead.");
  const existingGoal = config.goal;
  return {
    ...config,
    goal: {
      enabled: existingGoal?.enabled ?? enabled ?? false,
      auto_start: existingGoal?.auto_start ?? false,
      default_max_iterations: existingGoal?.default_max_iterations ?? defaultMaxIterations ?? 100
    }
  };
}
function validatePluginConfig(directory, environment = process.env) {
  const chain = loadOmoOpenCodeConfigChain(directory, environment);
  const homeDir = environment.HOME ?? environment.USERPROFILE;
  const views = chain.views.map((view) => parseConfigView(view, homeDir));
  const failing = chain.diagnostics.filter((diagnostic) => diagnostic.kind !== "deprecated-keys" && diagnostic.kind !== "invalid-value");
  const chainMessages = failing.map((diagnostic) => `${shortPath(diagnostic.path)}: ${diagnostic.message}`);
  const messages = [...chainMessages, ...views.flatMap((view) => view.messages)];
  const warnings = [
    ...omoConfigDiagnosticLines(chain.diagnostics.flatMap((diagnostic) => diagnostic.kind === "invalid-value" ? [diagnostic] : []), { homeDir }),
    ...views.flatMap((view) => view.warnings)
  ];
  const firstFailingView = views.find((view) => view.messages.length > 0);
  const firstView = views[0];
  const userConfig = parseConfig(prunePluginView({ config: chain.protectedUserView, homeDir, keyPrefix: "", path: "" }).config);
  const config = applyDisabledProviders(materializeAgentModelChains(protectUserFields(mergeViews(views), userConfig)));
  warnLegacyUlwExecuteKey(chain.views);
  return {
    valid: messages.length === 0,
    messages,
    warnings,
    path: failing[0]?.path ?? firstFailingView?.path ?? firstView?.path ?? null,
    config: migrateRalphLoopConfig(migrateLegacyUlwExecuteKey(config))
  };
}

// ../../../../omo-engine/omo-opencode/src/features/run-continuation-state/storage.ts
import { existsSync as existsSync5, mkdirSync as mkdirSync3, readFileSync as readFileSync3, rmSync, writeFileSync as writeFileSync2 } from "node:fs";
import { join as join6 } from "node:path";

// ../../../../omo-engine/omo-opencode/src/features/run-continuation-state/constants.ts
var CONTINUATION_MARKER_DIR = ".omo/run-continuation";

// ../../../../omo-engine/omo-opencode/src/features/run-continuation-state/storage.ts
function getMarkerPath(directory, sessionID) {
  return join6(directory, CONTINUATION_MARKER_DIR, `${sessionID}.json`);
}
function readContinuationMarker(directory, sessionID) {
  const markerPath = getMarkerPath(directory, sessionID);
  if (!existsSync5(markerPath))
    return null;
  try {
    const raw = readFileSync3(markerPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return null;
    return parsed;
  } catch (error) {
    if (error instanceof Error) {
      return null;
    }
    return null;
  }
}
function setContinuationMarkerSource(directory, sessionID, source, state, reason) {
  const now = new Date().toISOString();
  const existing = readContinuationMarker(directory, sessionID);
  const next = {
    sessionID,
    updatedAt: now,
    sources: {
      ...existing?.sources ?? {},
      [source]: {
        state,
        ...reason ? { reason } : {},
        updatedAt: now
      }
    }
  };
  const markerPath = getMarkerPath(directory, sessionID);
  mkdirSync3(join6(directory, CONTINUATION_MARKER_DIR), { recursive: true });
  writeFileSync2(markerPath, JSON.stringify(next, null, 2), "utf-8");
  return next;
}
function isContinuationMarkerActive(marker) {
  if (!marker)
    return false;
  return Object.values(marker.sources).some((entry) => entry?.state === "active");
}
function getActiveContinuationMarkerReason(marker) {
  if (!marker)
    return null;
  const active = Object.entries(marker.sources).find(([, entry]) => entry?.state === "active");
  if (!active || !active[1])
    return null;
  const [source, entry] = active;
  return entry.reason ?? `${source} continuation is active`;
}

// ../../../../omo-engine/omo-opencode/src/hooks/atlas/hook-name.ts
var HOOK_NAME2 = "atlas";

// ../../../../omo-engine/omo-opencode/src/hooks/ralph-loop/storage.ts
import { existsSync as existsSync6, readFileSync as readFileSync4, writeFileSync as writeFileSync3, unlinkSync as unlinkSync2, mkdirSync as mkdirSync4 } from "node:fs";
import { dirname as dirname3, join as join7 } from "node:path";
// ../../../../omo-engine/omo-opencode/src/hooks/ralph-loop/constants.ts
var DEFAULT_STATE_FILE = ".omo/ralph-loop.local.md";
var DEFAULT_MAX_ITERATIONS = 100;
var DEFAULT_COMPLETION_PROMISE = "DONE";

// ../../../../omo-engine/omo-opencode/src/hooks/ralph-loop/storage.ts
function getStateFilePath(directory, customPath) {
  return customPath ? join7(directory, customPath) : join7(directory, DEFAULT_STATE_FILE);
}
function readState(directory, customPath) {
  const filePath = getStateFilePath(directory, customPath);
  if (!existsSync6(filePath)) {
    return null;
  }
  try {
    const content = readFileSync4(filePath, "utf-8");
    const { data, body } = parseFrontmatter(content);
    const active = data.active;
    const iteration = data.iteration;
    if (active === undefined || iteration === undefined) {
      return null;
    }
    const isActive = active === true || active === "true";
    const iterationNum = typeof iteration === "number" ? iteration : Number(iteration);
    if (isNaN(iterationNum)) {
      return null;
    }
    const stripQuotes = (val) => {
      const str = String(val ?? "");
      return str.replace(/^["']|["']$/g, "");
    };
    const ultrawork = data.ultrawork === true || data.ultrawork === "true" ? true : undefined;
    const verificationAttemptStartedAt = Number(data.verification_attempt_started_at);
    const maxIterations = data.max_iterations === undefined || data.max_iterations === "" ? ultrawork ? undefined : DEFAULT_MAX_ITERATIONS : Number(data.max_iterations) || DEFAULT_MAX_ITERATIONS;
    return {
      active: isActive,
      iteration: iterationNum,
      max_iterations: maxIterations,
      message_count_at_start: typeof data.message_count_at_start === "number" ? data.message_count_at_start : typeof data.message_count_at_start === "string" && data.message_count_at_start.trim() !== "" ? Number(data.message_count_at_start) : undefined,
      completion_promise: stripQuotes(data.completion_promise) || DEFAULT_COMPLETION_PROMISE,
      initial_completion_promise: data.initial_completion_promise ? stripQuotes(data.initial_completion_promise) : undefined,
      verification_attempt_id: data.verification_attempt_id ? stripQuotes(data.verification_attempt_id) : undefined,
      verification_attempt_started_at: data.verification_attempt_started_at === undefined || data.verification_attempt_started_at === "" ? undefined : Number.isFinite(verificationAttemptStartedAt) ? verificationAttemptStartedAt : undefined,
      verification_session_id: data.verification_session_id ? stripQuotes(data.verification_session_id) : undefined,
      started_at: stripQuotes(data.started_at) || new Date().toISOString(),
      prompt: body.trim(),
      session_id: data.session_id ? stripQuotes(data.session_id) : undefined,
      ultrawork,
      verification_pending: data.verification_pending === true || data.verification_pending === "true" ? true : undefined,
      strategy: data.strategy === "reset" || data.strategy === "continue" ? data.strategy : undefined
    };
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error;
    }
    return null;
  }
}

// ../../../../omo-engine/omo-opencode/src/shared/safe-create-hook.ts
function safeCreateHook(name, factory, options) {
  const enabled = options?.enabled ?? true;
  if (!enabled) {
    return factory() ?? null;
  }
  try {
    return factory() ?? null;
  } catch (error) {
    log2(`[safe-create-hook] Hook creation failed: ${name}`, { error });
    return null;
  }
}

// ../../../../omo-engine/omo-opencode/src/plugin/hooks/continuation-hooks.ts
function registerHook(registry, name, handler) {
  if (handler === null) {
    return;
  }
  if (!HookNameSchema.safeParse(name).success) {
    log2(`[continuation-hooks] Skipping unknown hook name: ${name}`);
    return;
  }
  registry[name] = handler;
}
function createStopContinuationGuardHook(directory) {
  const announced = new Set;
  return {
    handler: (input, output) => {
      const sessionID = input.sessionID;
      if (!sessionID || announced.has(sessionID)) {
        return;
      }
      const marker = readContinuationMarker(directory, sessionID);
      if (!isContinuationMarkerActive(marker)) {
        return;
      }
      announced.add(sessionID);
      const reason = getActiveContinuationMarkerReason(marker) ?? "continuation is stopped for this session";
      output.note?.(`Stop continuation guard: ${reason}`);
    },
    dispose: () => {
      announced.clear();
    }
  };
}
function createCompactionContextInjectorHook(directory) {
  return (input, output) => {
    const sessionID = input.sessionID;
    if (!sessionID) {
      return;
    }
    const state = readState(directory);
    if (!state || !state.active) {
      return;
    }
    if (state.session_id && state.session_id !== sessionID) {
      return;
    }
    output.note?.(`Loop context: iteration ${state.iteration} in progress (${state.completion_promise})`);
  };
}
function createCompactionTodoPreserverHook() {
  const lastTextBySession = new Map;
  return {
    handler: (input, output) => {
      const sessionID = input.sessionID;
      if (!sessionID) {
        return;
      }
      const text = input.text?.trim();
      if (text) {
        lastTextBySession.set(sessionID, text);
        return;
      }
      const preserved = lastTextBySession.get(sessionID);
      if (preserved) {
        output.note?.(`Preserved context: ${preserved.slice(0, 500)}`);
      }
    },
    dispose: () => {
      lastTextBySession.clear();
    }
  };
}
function createTodoContinuationEnforcerHook(directory) {
  const markedSessions = new Set;
  return {
    handler: (input, output) => {
      const sessionID = input.sessionID;
      const text = input.text;
      if (!sessionID || !text || !/todo/i.test(text)) {
        return;
      }
      setContinuationMarkerSource(directory, sessionID, "todo", "active", "todo mentioned in session text");
      markedSessions.add(sessionID);
      output.note?.("Todo continuation enforced for this session.");
    },
    dispose: () => {
      for (const sessionID of markedSessions) {
        try {
          setContinuationMarkerSource(directory, sessionID, "todo", "idle", "hook disposed");
        } catch (error) {
          log2("[continuation-hooks] Failed to release todo marker on dispose", {
            sessionID,
            error
          });
        }
      }
      markedSessions.clear();
    }
  };
}
function createBackgroundNotificationHook(directory) {
  return (input, output) => {
    const sessionID = input.sessionID;
    if (!sessionID) {
      return;
    }
    const reason = getActiveContinuationMarkerReason(readContinuationMarker(directory, sessionID));
    if (reason) {
      output.note?.(`Background continuation active: ${reason}`);
    }
  };
}
function createAtlasHook() {
  const lastAgentBySession = new Map;
  return {
    handler: (input, output) => {
      const sessionID = input.sessionID;
      if (!sessionID) {
        return;
      }
      const agent = input.agentName?.toLowerCase();
      if (agent) {
        lastAgentBySession.set(sessionID, agent);
        return;
      }
      const lastAgent = lastAgentBySession.get(sessionID);
      if (lastAgent) {
        log2(`[${HOOK_NAME2}] Resolved last agent for session`, { sessionID });
        output.note?.(`Last agent for this session: ${lastAgent}`);
      }
    },
    dispose: () => {
      lastAgentBySession.clear();
    }
  };
}
function createContinuationHooks(ctx, flags, _managers) {
  const directory = ctx.directory;
  const hooks = {};
  const disposables = [];
  const guard = (name, factory) => safeCreateHook(name, factory, { enabled: flags.safeHookEnabled });
  if (flags.isHookEnabled("stop-continuation-guard")) {
    const built = guard("stop-continuation-guard", () => createStopContinuationGuardHook(directory));
    if (built !== null) {
      registerHook(hooks, "stop-continuation-guard", built.handler);
      disposables.push(built.dispose);
    }
  }
  if (flags.isHookEnabled("compaction-context-injector")) {
    registerHook(hooks, "compaction-context-injector", guard("compaction-context-injector", () => createCompactionContextInjectorHook(directory)));
  }
  if (flags.isHookEnabled("compaction-todo-preserver")) {
    const built = guard("compaction-todo-preserver", () => createCompactionTodoPreserverHook());
    if (built !== null) {
      registerHook(hooks, "compaction-todo-preserver", built.handler);
      disposables.push(built.dispose);
    }
  }
  if (flags.isHookEnabled("todo-continuation-enforcer")) {
    const built = guard("todo-continuation-enforcer", () => createTodoContinuationEnforcerHook(directory));
    if (built !== null) {
      registerHook(hooks, "todo-continuation-enforcer", built.handler);
      disposables.push(built.dispose);
    }
  }
  if (flags.isHookEnabled("background-notification")) {
    registerHook(hooks, "background-notification", guard("background-notification", () => createBackgroundNotificationHook(directory)));
  }
  if (flags.isHookEnabled("atlas")) {
    const built = guard("atlas", () => createAtlasHook());
    if (built !== null) {
      registerHook(hooks, "atlas", built.handler);
      disposables.push(built.dispose);
    }
  }
  return { hooks, disposables };
}

// ../../../../omo-engine/omo-opencode/src/plugin/hooks/core-hooks.ts
function registerHook2(registry, name, handler) {
  if (handler === null) {
    return;
  }
  if (!HookNameSchema.safeParse(name).success) {
    log2(`[core-hooks] Skipping unknown hook name: ${name}`);
    return;
  }
  registry[name] = handler;
}
function createModelFallbackHook(managers) {
  return (input, output) => {
    const failedModelID = input.modelID;
    if (!failedModelID) {
      return;
    }
    const controller = managers.modelFallbackControllerAccessor.current();
    if (!controller) {
      return;
    }
    const decision = controller.decideFallback(failedModelID);
    if (decision.fallbackModelID) {
      output.note?.(`Model fallback: ${failedModelID} -> ${decision.fallbackModelID} (${decision.reason})`);
    }
  };
}
function createSessionNotificationHook() {
  const seenSessions = new Set;
  return {
    handler: (input, output) => {
      const sessionID = input.sessionID;
      if (!sessionID || seenSessions.has(sessionID)) {
        return;
      }
      seenSessions.add(sessionID);
      output.note?.(`Session started: ${sessionID}`);
    },
    dispose: () => {
      seenSessions.clear();
    }
  };
}
function createMonitorStatusHook(managers) {
  const monitor = managers.monitorManager;
  if (!monitor || !monitor.enabled) {
    return null;
  }
  return (_input, output) => {
    output.note?.("Monitor is enabled for this session.");
  };
}
function createCoreHooks(_ctx, flags, managers) {
  const hooks = {};
  const disposables = [];
  const guard = (name, factory) => safeCreateHook(name, factory, { enabled: flags.safeHookEnabled });
  if (flags.isHookEnabled("model-fallback")) {
    registerHook2(hooks, "model-fallback", guard("model-fallback", () => createModelFallbackHook(managers)));
  }
  if (flags.isHookEnabled("session-notification")) {
    const built = guard("session-notification", () => createSessionNotificationHook());
    if (built !== null) {
      registerHook2(hooks, "session-notification", built.handler);
      disposables.push(built.dispose);
    }
  }
  if (flags.isHookEnabled("monitor-status-injector")) {
    registerHook2(hooks, "monitor-status-injector", guard("monitor-status-injector", () => createMonitorStatusHook(managers)));
  }
  return { hooks, disposables };
}

// ../../../../omo-engine/omo-opencode/src/plugin/hooks/skill-hooks.ts
function registerHook3(registry, name, handler) {
  if (handler === null) {
    return;
  }
  if (!HookNameSchema.safeParse(name).success) {
    log2(`[skill-hooks] Skipping unknown hook name: ${name}`);
    return;
  }
  registry[name] = handler;
}
function createCategorySkillReminderHook(skills) {
  return (input, output) => {
    const text = input.text;
    if (!text || !/skill/i.test(text)) {
      return;
    }
    const names = skills.availableSkills.map((skill) => skill.name).filter((name) => name.length > 0);
    if (names.length === 0) {
      return;
    }
    const shown = names.slice(0, 5).join(", ");
    const remainder = names.length > 5 ? ` (+${names.length - 5} more)` : "";
    output.note?.(`Available skills: ${shown}${remainder}`);
  };
}
function parseSlashCommand(text) {
  if (!text) {
    return;
  }
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) {
    return;
  }
  const token = trimmed.slice(1).split(/\s/, 1)[0];
  return token ? token : undefined;
}
function createAutoSlashCommandHook(directory, skills) {
  return (input, output) => {
    const commandName = input.commandName ?? parseSlashCommand(input.text);
    if (!commandName) {
      return;
    }
    const match = skills.mergedSkills.find((skill) => skill.name === commandName || skill.definition.name === commandName);
    if (!match) {
      return;
    }
    const description = match.definition.description ? ` — ${match.definition.description}` : "";
    output.note?.(`Auto slash command /${match.name}${description} (project: ${directory})`);
  };
}
function createSkillHooks(ctx, flags, skills) {
  const directory = ctx.directory;
  const hooks = {};
  const disposables = [];
  const guard = (name, factory) => safeCreateHook(name, factory, { enabled: flags.safeHookEnabled });
  if (flags.isHookEnabled("category-skill-reminder")) {
    registerHook3(hooks, "category-skill-reminder", guard("category-skill-reminder", () => createCategorySkillReminderHook(skills)));
  }
  if (flags.isHookEnabled("auto-slash-command")) {
    registerHook3(hooks, "auto-slash-command", guard("auto-slash-command", () => createAutoSlashCommandHook(directory, skills)));
  }
  return { hooks, disposables };
}

// ../../../../omo-engine/omo-opencode/src/create-hooks.ts
var createHooks = (ctx, flags, skills, managers) => {
  const core = createCoreHooks(ctx, flags, managers);
  const continuation = createContinuationHooks(ctx, flags, managers);
  const skill = createSkillHooks(ctx, flags, skills);
  const disposables = [
    ...core.disposables,
    ...continuation.disposables,
    ...skill.disposables
  ];
  const created = {
    coreHooks: core.hooks,
    continuationHooks: continuation.hooks,
    skillHooks: skill.hooks,
    disposeHooks: () => {
      for (const dispose of disposables) {
        try {
          dispose();
        } catch (error) {
          log2("[create-hooks] Hook dispose failed", { error });
        }
      }
    }
  };
  return created;
};

// ../../../../omo-engine/omo-opencode/src/plugin-config.ts
function loadPluginConfig(directory, _context) {
  return validatePluginConfig(directory).config;
}

// ../../../../omo-engine/omo-opencode/src/plugin-handlers/agent-config-handler.ts
import { existsSync as existsSync11, readdirSync as readdirSync2, readFileSync as readFileSync7 } from "node:fs";
import { homedir as homedir3 } from "node:os";
import { join as join9 } from "node:path";

// ../../../../omo-engine/claude-code-compat-core/src/features/claude-code-agent-loader/agent-definitions-loader.ts
import { existsSync as existsSync8, readFileSync as readFileSync6 } from "fs";
import { basename as basename2, extname } from "path";
// ../../../../omo-engine/claude-code-compat-core/src/shared/plugin-identity.ts
var LOG_FILENAME2 = "oh-my-opencode.log";

// ../../../../omo-engine/claude-code-compat-core/src/shared/logger.ts
var logger2 = createLogger({ logFileName: LOG_FILENAME2 });
var log3 = logger2.log;
var getLogFilePath2 = logger2.getLogFilePath;

// ../../../../omo-engine/claude-code-compat-core/src/shared/parse-tools-config.ts
function parseToolsConfig(toolsValue) {
  if (!toolsValue)
    return;
  let items;
  if (typeof toolsValue === "string") {
    items = toolsValue.split(",").map((t) => t.trim()).filter(Boolean);
  } else if (Array.isArray(toolsValue)) {
    items = toolsValue.filter((t) => typeof t === "string" && t.trim().length > 0).map((t) => t.trim());
  } else {
    return;
  }
  if (items.length === 0)
    return;
  const result = {};
  for (const tool of items) {
    result[tool.toLowerCase()] = true;
  }
  return result;
}

// ../../../../omo-engine/claude-code-compat-core/src/features/claude-code-agent-loader/json-agent-loader.ts
import { existsSync as existsSync7, readFileSync as readFileSync5 } from "fs";
// ../../../../omo-engine/claude-code-compat-core/src/features/claude-code-agent-loader/claude-model-mapper.ts
var ANTHROPIC_PREFIX = "anthropic/";
var CLAUDE_CODE_ALIAS_MAP = new Map([
  ["sonnet", `${ANTHROPIC_PREFIX}claude-sonnet-4-6`],
  ["opus", `${ANTHROPIC_PREFIX}claude-opus-4-8`],
  ["haiku", `${ANTHROPIC_PREFIX}claude-haiku-4-5`]
]);
function mapClaudeModelString(model, anthropicProvider) {
  if (!model)
    return;
  if (typeof model !== "string")
    return;
  const trimmed = model.trim();
  if (trimmed.length === 0)
    return;
  if (trimmed === "inherit")
    return;
  const prefix = anthropicProvider ? `${anthropicProvider}/` : ANTHROPIC_PREFIX;
  const aliasResult = CLAUDE_CODE_ALIAS_MAP.get(trimmed.toLowerCase());
  if (aliasResult)
    return anthropicProvider ? aliasResult.replace(ANTHROPIC_PREFIX, prefix) : aliasResult;
  if (trimmed.includes("/")) {
    const [providerID, ...modelParts] = trimmed.split("/");
    const modelID = modelParts.join("/");
    if (providerID.length === 0 || modelID.length === 0)
      return trimmed;
    return modelID.startsWith("claude-") ? `${providerID}/${normalizeModelID(modelID)}` : trimmed;
  }
  const normalized = normalizeModelID(trimmed);
  if (normalized.startsWith("claude-")) {
    return `${prefix}${normalized}`;
  }
  return;
}
function mapClaudeModelToOpenCode(model, anthropicProvider) {
  const mappedModel = mapClaudeModelString(model, anthropicProvider);
  return mappedModel ? normalizeModelFormat(mappedModel) : undefined;
}

// ../../../../omo-engine/claude-code-compat-core/src/features/claude-code-agent-loader/json-agent-loader.ts
function parseJsonAgentFile(filePath, scope) {
  try {
    if (!existsSync7(filePath)) {
      return null;
    }
    const content = readFileSync5(filePath, "utf-8");
    const { data } = parseJsoncSafe2(content);
    if (!data) {
      return null;
    }
    if (!data.name || !data.prompt) {
      return null;
    }
    const originalDescription = data.description ?? "";
    const formattedDescription = `(${scope}) ${originalDescription}`;
    const mappedModelOverride = mapClaudeModelToOpenCode(data.model);
    const modelString = mappedModelOverride ? `${mappedModelOverride.providerID}/${mappedModelOverride.modelID}` : undefined;
    const config = {
      description: formattedDescription,
      mode: data.mode ?? "subagent",
      prompt: data.prompt.trim(),
      ...modelString ? { model: modelString } : {}
    };
    const toolsConfig = parseToolsConfig(data.tools);
    if (toolsConfig) {
      config.tools = toolsConfig;
    }
    return {
      name: data.name,
      path: filePath,
      config,
      scope
    };
  } catch (error) {
    if (error instanceof Error)
      return null;
    return null;
  }
}

// ../../../../omo-engine/claude-code-compat-core/src/features/claude-code-agent-loader/agent-definitions-loader.ts
function parseMarkdownAgentFile(filePath, scope, anthropicProvider) {
  try {
    if (!existsSync8(filePath)) {
      return null;
    }
    const content = readFileSync6(filePath, "utf-8");
    const { data, body } = parseFrontmatter(content);
    const fileName = basename2(filePath);
    const agentName = fileName.replace(/\.md$/i, "");
    const name = data.name || agentName;
    const originalDescription = data.description || "";
    const formattedDescription = `(${scope}) ${originalDescription}`;
    const mappedModelOverride = mapClaudeModelToOpenCode(data.model, anthropicProvider);
    const modelString = mappedModelOverride ? `${mappedModelOverride.providerID}/${mappedModelOverride.modelID}` : undefined;
    const config = {
      description: formattedDescription,
      mode: data.mode || "subagent",
      prompt: body.trim(),
      ...modelString ? { model: modelString } : {}
    };
    const toolsConfig = parseToolsConfig(data.tools);
    if (toolsConfig) {
      config.tools = toolsConfig;
    }
    return {
      name,
      path: filePath,
      config,
      scope
    };
  } catch (error) {
    if (error instanceof Error)
      return null;
    return null;
  }
}
function loadAgentDefinitions(paths, scope, anthropicProvider) {
  const result = Object.create(null);
  for (const filePath of paths) {
    if (!existsSync8(filePath)) {
      log3(`[agent-definitions-loader] File not found, skipping: ${filePath}`);
      continue;
    }
    const ext = extname(filePath).toLowerCase();
    let agent = null;
    if (ext === ".md") {
      agent = parseMarkdownAgentFile(filePath, scope, anthropicProvider);
    } else if (ext === ".json" || ext === ".jsonc") {
      agent = parseJsonAgentFile(filePath, scope);
    } else {
      log3(`[agent-definitions-loader] Unsupported file extension: ${ext} for ${filePath}`);
      continue;
    }
    if (!agent) {
      log3(`[agent-definitions-loader] Failed to parse agent file: ${filePath}`);
      continue;
    }
    result[agent.name] = agent.config;
  }
  return result;
}

// ../../../../omo-engine/omo-opencode/src/shared/resolve-agent-definition-paths.ts
import { homedir as homedir2 } from "node:os";
import { existsSync as existsSync9 } from "node:fs";
import { dirname as dirname4, isAbsolute as isAbsolute2, join as join8, resolve as resolve3 } from "node:path";
import { fileURLToPath } from "node:url";
function resolveBundledAgentsDir() {
  if (typeof OMO_BUNDLED_AGENTS_DIR === "string" && OMO_BUNDLED_AGENTS_DIR.length > 0) {
    return join8(dirname4(fileURLToPath(import.meta.url)), OMO_BUNDLED_AGENTS_DIR);
  }
  const resourcesPath = process.resourcesPath;
  if (typeof resourcesPath === "string" && resourcesPath.length > 0) {
    const staged = join8(resourcesPath, "omo-engine", "omo-opencode", "agents");
    if (existsSync9(staged))
      return staged;
  }
  return join8(import.meta.dir, "..", "..", "agents");
}
function resolveAgentDefinitionPaths(paths, baseDir, containmentDir) {
  return paths.flatMap((p) => {
    const expanded = p.startsWith("~/") ? join8(homedir2(), p.slice(2)) : p;
    const resolved = isAbsolute2(expanded) ? expanded : resolve3(baseDir, expanded);
    if (containmentDir !== null && !isWithinProject(resolved, containmentDir)) {
      log2(`agent_definitions path rejected (outside project boundary): ${p} -> ${resolved}`);
      return [];
    }
    return [resolved];
  });
}

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
// ../../../../omo-engine/omo-opencode/src/shared/migration.ts
configureMigrationCategoryDefaults(DEFAULT_CATEGORIES);

// ../../../../omo-engine/omo-opencode/src/plugin-handlers/agent-config-assembly.ts
import { existsSync as existsSync10, readdirSync } from "node:fs";
// ../../../../omo-engine/omo-opencode/src/agents/dynamic-agent-core-sections.ts
function buildAgentIdentitySection(agentName, roleDescription) {
  return `<agent-identity>
Your designated identity for this session is "${agentName}". This identity supersedes any prior identity statements.
You are "${agentName}" - ${roleDescription}.
When asked who you are, always identify as ${agentName}. Do not identify as any other assistant or AI.
</agent-identity>`;
}
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
// ../../../../omo-engine/omo-opencode/src/shared/agent-variant.ts
function findAgentOverride(config, agentName) {
  const stripped = stripInvisibleAgentCharacters(agentName);
  const agentOverrides = config.agents;
  return agentOverrides ? agentOverrides[stripped] ?? Object.entries(agentOverrides).find(([key]) => key.toLowerCase() === stripped.toLowerCase())?.[1] : undefined;
}
function getCategoryConfig(config, categoryName) {
  return categoryName ? config.categories?.[categoryName] : undefined;
}
function resolveAgentVariant(config, agentName) {
  if (!agentName)
    return;
  const agentOverride = findAgentOverride(config, agentName);
  if (!agentOverride)
    return;
  const categoryConfig = getCategoryConfig(config, agentOverride.category);
  return agentOverride.reasoning ?? categoryConfig?.reasoning ?? agentOverride.variant ?? categoryConfig?.variant;
}

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
var FALLBACK_BUNDLED_AGENT_NAMES = [
  "explore",
  "librarian",
  "omo-native-code-reviewer",
  "omo-native-gate-reviewer",
  "omo-native-qa-executor",
  "plan-consultant",
  "plan-reviewer"
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
function readBundledAgentNames() {
  try {
    const bundledDir = resolveBundledAgentsDir();
    if (!existsSync10(bundledDir))
      return [...FALLBACK_BUNDLED_AGENT_NAMES];
    const stems = readdirSync(bundledDir, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith(".md")).map((entry) => entry.name.slice(0, -".md".length));
    return stems.length > 0 ? stems : [...FALLBACK_BUNDLED_AGENT_NAMES];
  } catch {
    return [...FALLBACK_BUNDLED_AGENT_NAMES];
  }
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
function describeCoreAgentResolution(pluginConfig, entries) {
  return Object.entries(entries).map(([key, entry]) => {
    const variant = resolveAgentVariant(pluginConfig, key) ?? "none";
    return `${key}: model=${entry.model ?? "host-default"} variant=${variant}`;
  }).join("; ");
}
function normalizeCustomAgent(raw) {
  const model = typeof raw.model === "string" ? raw.model.trim() || undefined : raw.model ? `${raw.model.providerID}/${raw.model.modelID}` : undefined;
  return {
    ...raw.description ? { description: raw.description } : {},
    mode: raw.mode ?? "subagent",
    ...raw.prompt ? { prompt: raw.prompt } : {},
    ...model ? { model } : {},
    ...raw.tools ? { tools: { ...raw.tools } } : {}
  };
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

// ../../../../omo-engine/omo-opencode/src/plugin-handlers/agent-config-handler.ts
var AGENT_FILE_PATTERN = /\.(md|json|jsonc)$/i;
var RESERVED_SKILL_KEYS = new Set(["sources", "enable", "disable"]);
function normalizeDisabledAgents(disabledAgents) {
  const normalized = new Set;
  for (const name of disabledAgents ?? []) {
    const migrated = AGENT_NAME_MAP[name.toLowerCase()] ?? AGENT_NAME_MAP[name] ?? name;
    normalized.add(migrated.toLowerCase());
  }
  return normalized;
}
function normalizeDisabledSkills(disabledSkills) {
  return new Set((disabledSkills ?? []).map((name) => name.toLowerCase()));
}
function claudeConfigDir() {
  return process.env.CLAUDE_CONFIG_DIR ?? join9(homedir3(), ".claude");
}
function opencodeGlobalDir() {
  const xdg = process.env.XDG_CONFIG_HOME ?? join9(homedir3(), ".config");
  return process.env.OPENCODE_CONFIG_DIR ?? join9(xdg, "opencode");
}
function collectAgentFiles(root) {
  if (!existsSync11(root))
    return [];
  try {
    return readdirSync2(root, { withFileTypes: true }).filter((entry) => entry.isFile() && AGENT_FILE_PATTERN.test(entry.name)).map((entry) => join9(root, entry.name));
  } catch {
    return [];
  }
}
function loadFileTier(root, scope, anthropicProvider) {
  const paths = collectAgentFiles(root).filter((path) => existsSync11(path));
  if (paths.length === 0)
    return {};
  const loaded = loadAgentDefinitions(paths, scope, anthropicProvider);
  return mapCustomTier(loaded);
}
function mapCustomTier(loaded) {
  const tier = {};
  for (const [name, config] of Object.entries(loaded)) {
    tier[name] = normalizeCustomAgent(config);
  }
  return tier;
}
function stripJsoncComments(content) {
  let result = "";
  let index = 0;
  let inString = false;
  let quote = "";
  while (index < content.length) {
    const char = content[index];
    if (inString) {
      result += char;
      if (char === "\\") {
        result += content[index + 1] ?? "";
        index += 2;
        continue;
      }
      if (char === quote)
        inString = false;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      inString = true;
      quote = char;
      result += char;
      index += 1;
      continue;
    }
    if (char === "/" && content[index + 1] === "/") {
      while (index < content.length && content[index] !== `
`)
        index += 1;
      continue;
    }
    if (char === "/" && content[index + 1] === "*") {
      index += 2;
      while (index < content.length && !(content[index] === "*" && content[index + 1] === "/")) {
        index += 1;
      }
      index += 2;
      continue;
    }
    result += char;
    index += 1;
  }
  return result;
}
function readJsonObject(path) {
  try {
    if (!existsSync11(path))
      return;
    const parsed = JSON.parse(stripJsoncComments(readFileSync7(path, "utf-8")));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
    return;
  } catch {
    return;
  }
}
function normalizeInlineAgent(agent) {
  if (!agent || typeof agent !== "object")
    return;
  const record = agent;
  const mode = record.mode === "primary" || record.mode === "all" ? record.mode : "subagent";
  const tools = record.tools && typeof record.tools === "object" && !Array.isArray(record.tools) ? record.tools : undefined;
  return {
    ...typeof record.description === "string" ? { description: record.description } : {},
    mode,
    ...typeof record.prompt === "string" ? { prompt: record.prompt } : {},
    ...typeof record.model === "string" && record.model.trim() ? { model: record.model.trim() } : {},
    ...tools ? { tools: { ...tools } } : {}
  };
}
function loadAgentTiers(params) {
  const bundledDir = resolveBundledAgentsDir();
  const bundledPaths = collectAgentFiles(bundledDir);
  const bundled = bundledPaths.length > 0 ? mapCustomTier(loadAgentDefinitions(bundledPaths, "definition-file", params.anthropicProvider)) : {};
  const plugin = {};
  const user = params.includeClaudeAgents ? loadFileTier(join9(claudeConfigDir(), "agents"), "user", params.anthropicProvider) : {};
  const opencodeGlobal = loadFileTier(join9(opencodeGlobalDir(), "agents"), "opencode", undefined);
  const project = params.includeClaudeAgents ? loadFileTier(join9(params.directory, ".claude", "agents"), "project", params.anthropicProvider) : {};
  const opencodeProject = loadFileTier(join9(params.directory, ".opencode", "agents"), "opencode-project", undefined);
  const definitionFiles = loadAgentDefinitionTier(params);
  const opencodeConfig = loadOpencodeConfigTier(params.directory, params.hostAgents);
  return [bundled, plugin, user, opencodeGlobal, project, opencodeProject, definitionFiles, opencodeConfig];
}
function loadAgentDefinitionTier(params) {
  if (!params.agentDefinitions || params.agentDefinitions.length === 0)
    return {};
  const resolved = resolveAgentDefinitionPaths([...params.agentDefinitions], params.directory, params.directory).filter((path) => existsSync11(path));
  if (resolved.length === 0)
    return {};
  return mapCustomTier(loadAgentDefinitions(resolved, "definition-file", params.anthropicProvider));
}
function loadOpencodeConfigTier(directory, hostAgents) {
  const tier = {};
  const configPaths = [
    join9(directory, ".opencode", "opencode.json"),
    join9(directory, ".opencode", "opencode.jsonc"),
    join9(opencodeGlobalDir(), "opencode.json"),
    join9(opencodeGlobalDir(), "opencode.jsonc")
  ];
  for (const configPath of configPaths) {
    const data = readJsonObject(configPath);
    if (!data)
      continue;
    const inline = data.agents ?? data.agent;
    if (inline && typeof inline === "object") {
      for (const [name, agent] of Object.entries(inline)) {
        if (Object.hasOwn(tier, name))
          continue;
        const normalized = normalizeInlineAgent(agent);
        if (normalized)
          tier[name] = normalized;
      }
    }
    const nestedDefinitions = data.agent_definitions;
    const nestedPaths = typeof nestedDefinitions === "string" ? [nestedDefinitions] : Array.isArray(nestedDefinitions) ? nestedDefinitions.filter((entry) => typeof entry === "string") : [];
    if (nestedPaths.length > 0) {
      const configDir = join9(configPath, "..");
      const resolved = resolveAgentDefinitionPaths(nestedPaths, configDir, directory).filter((path) => existsSync11(path));
      if (resolved.length > 0) {
        for (const [name, config] of Object.entries(loadAgentDefinitions(resolved, "opencode-config", undefined))) {
          if (!Object.hasOwn(tier, name))
            tier[name] = normalizeCustomAgent(config);
        }
      }
    }
  }
  for (const [name, agent] of Object.entries(hostAgents)) {
    const normalized = normalizeInlineAgent(agent);
    if (normalized)
      tier[name] = normalized;
  }
  return tier;
}
function parseSkillFrontmatter(content) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (!match)
    return {};
  const result = {};
  for (const line of match[1].split(`
`)) {
    const nameMatch = /^name\s*:\s*(.+?)\s*$/.exec(line);
    if (nameMatch)
      result.name = nameMatch[1].replace(/^["']|["']$/g, "");
    const descriptionMatch = /^description\s*:\s*(.+?)\s*$/.exec(line);
    if (descriptionMatch) {
      result.description = descriptionMatch[1].replace(/^["']|["']$/g, "");
    }
  }
  return result;
}
function discoverSkillFiles(roots, scope) {
  const found = [];
  for (const root of roots) {
    if (!existsSync11(root))
      continue;
    let entries;
    try {
      entries = readdirSync2(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory())
        continue;
      const skillFile = join9(root, entry.name, "SKILL.md");
      if (!existsSync11(skillFile))
        continue;
      let description;
      try {
        const frontmatter = parseSkillFrontmatter(readFileSync7(skillFile, "utf-8"));
        if (frontmatter.name && frontmatter.name !== entry.name)
          continue;
        description = frontmatter.description;
      } catch {
        continue;
      }
      found.push({
        name: entry.name,
        path: skillFile,
        resolvedPath: skillFile,
        definition: {
          name: entry.name,
          template: "",
          ...description ? { description } : {}
        },
        scope
      });
    }
  }
  return found;
}
function collectConfiguredSkillNames(skills) {
  if (Array.isArray(skills)) {
    return {
      names: skills.filter((entry) => typeof entry === "string"),
      disabled: []
    };
  }
  if (!skills || typeof skills !== "object")
    return { names: [], disabled: [] };
  const names = [];
  const disabled = [];
  for (const [key, value] of Object.entries(skills)) {
    if (RESERVED_SKILL_KEYS.has(key))
      continue;
    if (value === false) {
      disabled.push(key);
      continue;
    }
    if (value && typeof value === "object" && value.disable === true) {
      disabled.push(key);
      continue;
    }
    names.push(key);
  }
  const config = skills;
  if (Array.isArray(config.enable)) {
    for (const name of config.enable) {
      if (typeof name === "string")
        names.push(name);
    }
  }
  if (Array.isArray(config.disable)) {
    for (const name of config.disable) {
      if (typeof name === "string")
        disabled.push(name);
    }
  }
  return { names, disabled };
}
async function discoverSkillsForPromptInjection(params) {
  const includeClaudeSkills = params.pluginConfig.claude_code?.skills ?? true;
  const fileSkills = includeClaudeSkills ? [
    ...discoverSkillFiles([join9(params.directory, ".claude", "skills"), join9(params.directory, ".agents", "skills")], "project"),
    ...discoverSkillFiles([join9(claudeConfigDir(), "skills")], "user")
  ] : [];
  const configured = collectConfiguredSkillNames(params.pluginConfig.skills);
  const disabled = normalizeDisabledSkills([
    ...params.pluginConfig.disabled_skills ?? [],
    ...configured.disabled
  ]);
  const byName = new Map;
  const addSkill = (skill) => {
    const key = skill.name.toLowerCase();
    if (disabled.has(key) || byName.has(key))
      return;
    byName.set(key, skill);
  };
  for (const skill of fileSkills)
    addSkill(skill);
  for (const name of [...configured.names, ...params.pluginComponents.skillNames]) {
    addSkill({
      name,
      definition: { name, template: "" },
      scope: "shared"
    });
  }
  return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name));
}
var applyAgentConfig = async (params) => {
  const disabledAgentNames = normalizeDisabledAgents(params.pluginConfig.disabled_agents);
  const skills = await discoverSkillsForPromptInjection({
    directory: params.projectDirectory,
    pluginConfig: params.pluginConfig,
    pluginComponents: params.pluginComponents
  });
  const customTiers = loadAgentTiers({
    directory: params.projectDirectory,
    agentDefinitions: params.pluginConfig.agent_definitions,
    anthropicProvider: params.pluginConfig.claude_code?.anthropic_provider,
    includeClaudeAgents: params.pluginConfig.claude_code?.agents ?? true,
    hostAgents: params.hostConfig.agent ?? {}
  });
  const protectedNames = createProtectedAgentNameSet([
    ...CORE_AGENT_KEYS,
    "build",
    "plan",
    ...readBundledAgentNames()
  ]);
  const entries = assembleAgentEntries({
    pluginConfig: params.pluginConfig,
    skills,
    customTiers,
    disabledAgentNames,
    protectedNames
  });
  console.info(`[agent-config] resolved: ${describeCoreAgentResolution(params.pluginConfig, entries)}`);
  return finalizeAgentConfig({
    hostConfig: params.hostConfig,
    pluginConfig: params.pluginConfig,
    agents: entries
  });
};

// ../../../../omo-engine/omo-opencode/src/plugin-handlers/command-config-handler.ts
function skillToCommand(skill) {
  return {
    name: skill.name,
    ...skill.definition.description ? { description: skill.definition.description } : {},
    template: skill.definition.template,
    ...skill.definition.agent ? { agent: skill.definition.agent } : {},
    ...skill.definition.model ? { model: skill.definition.model } : {}
  };
}
function applyCommandConfig(params) {
  const merged = {};
  for (const skill of params.skills) {
    merged[skill.name] = skillToCommand(skill);
  }
  for (const name of params.pluginComponents.commandNames) {
    if (!Object.hasOwn(merged, name)) {
      merged[name] = { name, template: "" };
    }
  }
  const existing = params.hostConfig.command ?? {};
  const next = { ...merged };
  for (const [name, command] of Object.entries(existing)) {
    next[name] = command;
  }
  for (const disabled of params.pluginConfig.disabled_commands ?? []) {
    delete next[disabled];
  }
  remapCommandAgentFields(next, params.pluginConfig);
  params.hostConfig.command = next;
}
function remapCommandAgentFields(commands, pluginConfig) {
  const overrides = pluginConfig.agents;
  for (const command of Object.values(commands)) {
    if (command.agent && typeof command.agent === "string") {
      const displayName = getAgentDisplayName(getAgentConfigKey(command.agent), overrides);
      if (displayName !== command.agent) {
        Object.assign(command, { agent: displayName });
      }
    }
  }
}

// ../../../../omo-engine/omo-opencode/src/plugin-handlers/hook-config-handler.ts
function applyHookConfig(params) {
  if (params.pluginConfig.claude_code?.hooks === false) {
    return [];
  }
  const disabled = new Set((params.pluginConfig.disabled_hooks ?? []).map((name) => name.trim()).filter((name) => name.length > 0));
  return [...disabled];
}

// ../../../../omo-engine/omo-opencode/src/plugin-handlers/mcp-config-handler.ts
function isServerEntry(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function applyMcpConfig(params) {
  const merged = {};
  for (const [name, value] of Object.entries(params.hostConfig.mcp ?? {})) {
    if (!isServerEntry(value))
      continue;
    merged[name] = { ...value };
  }
  const disabled = new Set(params.pluginConfig.disabled_mcps ?? []);
  for (const name of disabled) {
    delete merged[name];
  }
  params.hostConfig.mcp = merged;
}

// ../../../../omo-engine/omo-opencode/src/plugin-handlers/provider-config-handler.ts
function providerOf(model) {
  const separator = model.indexOf("/");
  if (separator <= 0)
    return;
  return model.slice(0, separator).toLowerCase();
}
function applyProviderConfig(params) {
  const disabled = new Set((params.pluginConfig.disabled_providers ?? []).map((prefix) => prefix.toLowerCase()));
  if (disabled.size === 0)
    return;
  for (const [name, entry] of Object.entries(params.hostConfig.agent)) {
    if (!entry.model)
      continue;
    const provider = providerOf(entry.model.trim());
    if (provider && disabled.has(provider)) {
      params.hostConfig.agent[name] = { ...entry, model: undefined };
    }
  }
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

// ../../../../omo-engine/omo-opencode/src/plugin-handlers/plugin-components-loader.ts
import { existsSync as existsSync12, readdirSync as readdirSync3 } from "node:fs";
import { homedir as homedir4 } from "node:os";
import { join as join10 } from "node:path";
var DEFAULT_PLUGIN_LOAD_TIMEOUT_MS = 1e4;
var EMPTY_INDEX = {
  commandNames: [],
  skillNames: []
};
function listCommandNames(root) {
  if (!existsSync12(root))
    return [];
  const found = [];
  for (const entry of readdirSync3(root, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".md")) {
      found.push(entry.name.slice(0, -".md".length));
    }
  }
  return found;
}
function listSkillNames(root) {
  if (!existsSync12(root))
    return [];
  const found = [];
  for (const entry of readdirSync3(root, { withFileTypes: true })) {
    if (!entry.isDirectory())
      continue;
    if (existsSync12(join10(root, entry.name, "SKILL.md"))) {
      found.push(entry.name);
    }
  }
  return found;
}
function commandRoots(directory) {
  return [
    join10(directory, ".claude", "commands"),
    join10(directory, ".agents", "commands"),
    join10(homedir4(), ".claude", "commands")
  ];
}
function skillRoots(directory) {
  return [
    join10(directory, ".claude", "skills"),
    join10(directory, ".agents", "skills"),
    join10(homedir4(), ".claude", "skills")
  ];
}
function discoverIndex(directory) {
  const commandNames = new Set;
  for (const root of commandRoots(directory)) {
    try {
      for (const name of listCommandNames(root))
        commandNames.add(name);
    } catch {
      continue;
    }
  }
  const skillNames = new Set;
  for (const root of skillRoots(directory)) {
    try {
      for (const name of listSkillNames(root))
        skillNames.add(name);
    } catch {
      continue;
    }
  }
  return {
    commandNames: [...commandNames].sort(),
    skillNames: [...skillNames].sort()
  };
}
function timeoutAfter(ms) {
  let timer;
  const promise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Plugin component discovery timed out after ${ms}ms`));
    }, ms);
  });
  return {
    promise,
    cancel: () => {
      if (timer !== undefined)
        clearTimeout(timer);
    }
  };
}
async function loadPluginComponents(params) {
  if (params.pluginConfig.claude_code?.plugins === false) {
    return { ...EMPTY_INDEX };
  }
  const timeoutMs = params.pluginConfig.experimental?.plugin_load_timeout_ms ?? DEFAULT_PLUGIN_LOAD_TIMEOUT_MS;
  const gate = timeoutAfter(timeoutMs);
  try {
    const index = await Promise.race([Promise.resolve().then(() => discoverIndex(params.directory)), gate.promise]);
    return index;
  } catch {
    return { ...EMPTY_INDEX, retryableLoadFailure: true };
  } finally {
    gate.cancel();
  }
}

// ../../../../omo-engine/omo-opencode/src/plugin-handlers/config-handler.ts
function createConfigHandler(options) {
  const pluginConfig = loadPluginConfig(options.directory, { directory: options.directory });
  return async (hostConfig) => {
    const pluginComponents = await loadPluginComponents({
      directory: options.directory,
      pluginConfig
    });
    await applyAgentConfig({
      hostConfig,
      pluginConfig,
      projectDirectory: options.directory,
      pluginComponents
    });
    const skills = await discoverSkillsForPromptInjection({
      directory: options.directory,
      pluginConfig,
      pluginComponents
    });
    applyCommandConfig({ hostConfig, pluginConfig, pluginComponents, skills });
    applyHookConfig({ pluginConfig });
    applyMcpConfig({ hostConfig, pluginConfig });
    applyProviderConfig({ hostConfig, pluginConfig });
    applyToolConfig({
      hostConfig,
      pluginConfig,
      isForceDisabledTool: options.isForceDisabledTool
    });
  };
}

// ../../../../omo-engine/omo-opencode/src/create-managers.ts
var createManagers = (ctx) => {
  const liveSubagents = new Map;
  const backgroundManager = {
    async noteSubagentBirth(event) {
      liveSubagents.set(event.sessionID, {
        parentID: event.parentID,
        title: event.title
      });
      log2("[create-managers] subagent born", { sessionID: event.sessionID });
    },
    async noteSubagentDeath(event) {
      liveSubagents.delete(event.sessionID);
      log2("[create-managers] subagent gone", { sessionID: event.sessionID });
    },
    async shutdown() {
      liveSubagents.clear();
      log2("[create-managers] background manager shut down");
    }
  };
  const skillMcpManager = {
    async callSkillTool(request) {
      log2("[create-managers] skill tool call", {
        serverName: request.serverName,
        toolName: request.toolName
      });
      return {
        output: `unknown skill tool ${request.serverName}.${request.toolName}`,
        isError: true
      };
    },
    async disconnectAll() {
      log2("[create-managers] skill MCP connections closed");
    }
  };
  let currentFallbackController = {
    decideFallback(failedModelID) {
      return { reason: `no fallback configured for ${failedModelID}` };
    }
  };
  const modelFallbackControllerAccessor = {
    current: () => currentFallbackController
  };
  const managers = {
    backgroundManager,
    skillMcpManager,
    modelFallbackControllerAccessor,
    configHandler: createConfigHandler({ directory: ctx.directory })
  };
  if (ctx.pluginConfig.monitor?.enabled === true) {
    managers.monitorManager = {
      enabled: true,
      async shutdown() {
        log2("[create-managers] monitor manager shut down");
      }
    };
  }
  return managers;
};

// ../../../../omo-engine/omo-opencode/src/plugin/tool-registry.ts
var BASE_TOOLS = {
  read: { description: "Read file contents from the workspace." },
  grep: { description: "Search file contents for a text pattern." },
  glob: { description: "Find files by name pattern." },
  bash: { description: "Run a shell command in the workspace." },
  write: { description: "Create or overwrite a file." },
  edit: { description: "Apply a targeted edit to an existing file." },
  task: { description: "Launch a follow-up sub-task." },
  call_omo_agent: { description: "Delegate work to a named helper agent." },
  teammate: { description: "Hand work to a teammate session." },
  todo_write: { description: "Record and update the task checklist." },
  ulw_goal_create: { description: "Open a native ULW run from a brief; returns the run record." },
  ulw_status: { description: "Report a native ULW run (record, roster, receipts, missing) or list runs." },
  ulw_dispatch: { description: "Dispatch ULW goals: record worker sessions, or spawn them through the team pool." },
  ulw_evidence: { description: "Record a dispatched ULW goal's child result as evidence." },
  ulw_checkpoint: { description: "Gate a ULW checkpoint on recorded child results." },
  ulw_complete: { description: "Close a ULW run once every dispatched goal has its result." },
  LspHover: { description: "Show hover information for a code symbol." },
  grep_app_search: { description: "Search the companion app index." }
};
function isForceDisabledTool(toolName) {
  if (toolName.startsWith("grep_app_"))
    return true;
  if (toolName.startsWith("task_"))
    return true;
  if (toolName.startsWith("Lsp"))
    return true;
  if (toolName === "LspHover")
    return true;
  if (toolName === "teammate")
    return true;
  if (toolName.toLowerCase().startsWith("todo"))
    return true;
  return false;
}
function buildToolRegistry(args) {
  const userDisabled = new Set(args.disabledTools ?? []);
  const kept = {};
  for (const [name, entry] of Object.entries(BASE_TOOLS)) {
    if (isForceDisabledTool(name))
      continue;
    if (userDisabled.has(name))
      continue;
    kept[name] = { description: entry.description };
  }
  if (args.getRestrictions) {
    const agents = new Set([""]);
    for (const skill of args.skills ?? []) {
      if (skill && skill.name)
        agents.add(skill.name);
    }
    const denied = new Set;
    for (const agent of agents) {
      let record;
      try {
        record = args.getRestrictions(agent);
      } catch {
        continue;
      }
      if (!record)
        continue;
      for (const [tool, allowed] of Object.entries(record)) {
        if (allowed === false)
          denied.add(tool);
      }
    }
    for (const name of denied)
      delete kept[name];
  }
  if (typeof args.maxTools === "number" && args.maxTools >= 0) {
    const overflow = Object.keys(kept).slice(args.maxTools);
    for (const name of overflow)
      delete kept[name];
  }
  return kept;
}

// ../../../../omo-engine/omo-opencode/src/ulw/errors.ts
function describeMissing(missing) {
  return missing.join(", ");
}

class UlwUsageError extends Error {
  code;
  runId;
  missingGoalIds;
  constructor(message, code, runId, missingGoalIds) {
    super(message);
    this.name = "UlwUsageError";
    this.code = code;
    this.runId = runId;
    if (missingGoalIds !== undefined) {
      this.missingGoalIds = missingGoalIds;
    }
  }
}
function dispatchedChildrenPendingError(runId, missing) {
  return new UlwUsageError(`Cannot checkpoint run '${runId}': dispatched children have no recorded result: ${describeMissing(missing)}. Record each child result first.`, "DISPATCHED_CHILDREN_PENDING", runId, [...missing]);
}
function invalidInputError(runId, message) {
  return new UlwUsageError(message, "INVALID_INPUT", runId);
}
function runNotFoundError(runId) {
  return new UlwUsageError(`Unknown ULW run: '${runId}'.`, "RUN_NOT_FOUND", runId);
}
function runNotActiveError(runId, status) {
  return new UlwUsageError(`ULW run '${runId}' is ${status}; only an active run accepts dispatches and child results.`, "RUN_NOT_ACTIVE", runId);
}
function goalNotDispatchedError(runId, goalId) {
  return new UlwUsageError(`ULW run '${runId}' has no dispatch for goal '${goalId}': dispatch the goal before recording its child result.`, "GOAL_NOT_DISPATCHED", runId);
}

// ../../../../omo-engine/omo-opencode/src/ulw/checkpoint.ts
function gateCheckpoint(store, runId, scope = { kind: "run" }) {
  const goalIds = scope.kind === "run" ? undefined : [...scope.goalIds];
  const missing = store.missingReceipts(runId, goalIds);
  if (missing.length > 0) {
    throw dispatchedChildrenPendingError(runId, missing);
  }
  const checkedGoalIds = goalIds ?? Object.keys(store.rosterFor(runId));
  return { runId, checkedGoalIds, missingGoalIds: missing };
}

// ../../../../omo-engine/omo-opencode/src/tools/ulw/args.ts
var NonEmptyText = string2().trim().min(1);
function runIdOf(toolArgs) {
  const parsed = object({ runId: string2() }).safeParse(toolArgs);
  if (!parsed.success)
    return "";
  return parsed.data.runId;
}
function refuseArgs(runId, hint) {
  throw invalidInputError(runId, hint);
}

// ../../../../omo-engine/omo-opencode/src/ulw/store.ts
import { randomUUID } from "node:crypto";
function isoNow(now) {
  return new Date(now()).toISOString();
}
function finishReceipt(base, resultRef, reason) {
  if (resultRef !== undefined && reason !== undefined)
    return { ...base, resultRef, reason };
  if (resultRef !== undefined)
    return { ...base, resultRef };
  if (reason !== undefined)
    return { ...base, reason };
  return { ...base };
}
function requireText(value, field, runId) {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw invalidInputError(runId, `ULW ${field} must be a non-empty string.`);
  }
  return trimmed;
}

class UlwStore {
  runs = new Map;
  now;
  newRunId;
  constructor(options = {}) {
    this.now = options.now ?? Date.now;
    this.newRunId = options.newRunId ?? randomUUID;
  }
  createRun(input) {
    const brief = input.brief.trim();
    if (brief.length === 0) {
      throw invalidInputError("", "ULW run brief must be a non-empty string.");
    }
    const sessionScope = input.sessionScope.trim();
    if (sessionScope.length === 0) {
      throw invalidInputError("", "ULW run sessionScope must be a non-empty string.");
    }
    const now = input.now ?? this.now;
    const id = input.id?.trim() || this.newRunId();
    if (this.runs.has(id)) {
      throw invalidInputError(id, `ULW run '${id}' already exists.`);
    }
    const at = isoNow(now);
    const record = { id, brief, sessionScope, status: "active", createdAt: at, updatedAt: at };
    this.runs.set(id, { record, roster: new Map, receipts: new Map });
    return record;
  }
  getRun(runId) {
    return this.runs.get(runId)?.record;
  }
  listRuns() {
    return [...this.runs.values()].map((state) => state.record);
  }
  setRunStatus(runId, status, now) {
    const state = this.requireState(runId);
    const at = isoNow(now ?? this.now);
    state.record = { ...state.record, status, updatedAt: at };
    return state.record;
  }
  dispatchGoal(runId, goalId, workerSessionId) {
    const state = this.requireActiveState(runId);
    const goal = requireText(goalId, "goalId", runId);
    const worker = requireText(workerSessionId, "workerSessionId", runId);
    const entry = state.roster.get(goal) ?? [];
    if (!entry.includes(worker)) {
      entry.push(worker);
      state.roster.set(goal, entry);
    }
    return [...entry];
  }
  dispatchedGoalIds(runId) {
    return [...this.requireState(runId).roster.keys()];
  }
  rosterFor(runId) {
    const roster = {};
    for (const [goalId, workers] of this.requireState(runId).roster) {
      roster[goalId] = [...workers];
    }
    return roster;
  }
  recordChildResult(runId, goalId, input) {
    const state = this.requireActiveState(runId);
    const goal = requireText(goalId, "goalId", runId);
    if (!state.roster.has(goal)) {
      throw goalNotDispatchedError(runId, goal);
    }
    const childSessionId = requireText(input.childSessionId, "childSessionId", runId);
    const receipt = finishReceipt({
      goalId: goal,
      childSessionId,
      status: input.status ?? "completed",
      recordedAt: isoNow(input.now ?? this.now)
    }, input.resultRef?.trim() || undefined, input.reason?.trim() || undefined);
    state.receipts.set(goal, receipt);
    return receipt;
  }
  receiptFor(runId, goalId) {
    return this.requireState(runId).receipts.get(goalId);
  }
  receiptsFor(runId) {
    const receipts = {};
    for (const [goalId, receipt] of this.requireState(runId).receipts) {
      receipts[goalId] = receipt;
    }
    return receipts;
  }
  missingReceipts(runId, goalIds) {
    const state = this.requireState(runId);
    const candidates = goalIds === undefined ? [...state.roster.keys()] : goalIds.filter((goalId) => state.roster.has(goalId));
    return candidates.filter((goalId) => !state.receipts.has(goalId)).sort();
  }
  requireState(runId) {
    const state = this.runs.get(runId);
    if (state === undefined) {
      throw runNotFoundError(runId);
    }
    return state;
  }
  requireActiveState(runId) {
    const state = this.requireState(runId);
    if (state.record.status !== "active") {
      throw runNotActiveError(runId, state.record.status);
    }
    return state;
  }
}

// ../../../../omo-engine/omo-opencode/src/tools/ulw/store-instance.ts
function checkStoreModule() {
  const probe = new UlwStore({ now: () => 0, newRunId: () => "probe" });
  probe.createRun({ id: "probe", brief: "probe", sessionScope: "probe" });
  probe.dispatchGoal("probe", "probe-goal", "probe-worker");
  probe.recordChildResult("probe", "probe-goal", { childSessionId: "probe-worker" });
  gateCheckpoint(probe, "probe");
}
try {
  checkStoreModule();
} catch (error) {
  throw new Error("[ulw tools] BLOCKED: the native ULW store module is unusable; refusing to build ULW tools.", { cause: error });
}
var shared;
function getUlwStore() {
  if (shared === undefined) {
    shared = new UlwStore;
  }
  return shared;
}

// ../../../../omo-engine/omo-opencode/src/tools/ulw/checkpoint.ts
var ULW_CHECKPOINT_NAME = "ulw_checkpoint";
var ULW_CHECKPOINT_DESCRIPTION = "Gate a ULW checkpoint on recorded child results.";
var UlwCheckpointArgs = object({
  runId: NonEmptyText,
  goalIds: array(NonEmptyText).optional()
});
function createUlwCheckpointTool(deps = {}) {
  const store = deps.store ?? getUlwStore();
  return {
    description: ULW_CHECKPOINT_DESCRIPTION,
    args: {
      properties: {
        runId: { type: "string", description: "Run to checkpoint." },
        goalIds: {
          type: "array",
          description: "Goals to close; omitted checks the whole run."
        }
      },
      required: ["runId"]
    },
    execute: async (toolArgs) => {
      const parsed = UlwCheckpointArgs.safeParse(toolArgs);
      if (!parsed.success)
        refuseArgs(runIdOf(toolArgs), "ULW runId must be a non-empty string.");
      const goalIds = parsed.data.goalIds;
      const result = gateCheckpoint(store, parsed.data.runId, goalIds === undefined ? { kind: "run" } : { kind: "goals", goalIds: [...goalIds] });
      return JSON.stringify(result);
    }
  };
}

// ../../../../omo-engine/omo-opencode/src/tools/ulw/complete.ts
var ULW_COMPLETE_NAME = "ulw_complete";
var ULW_COMPLETE_DESCRIPTION = "Close a ULW run once every dispatched goal has its result.";
var UlwCompleteArgs = object({
  runId: NonEmptyText,
  status: _enum(["complete", "failed", "blocked"])
});
function createUlwCompleteTool(deps = {}) {
  const store = deps.store ?? getUlwStore();
  return {
    description: ULW_COMPLETE_DESCRIPTION,
    args: {
      properties: {
        runId: { type: "string", description: "Run to close." },
        status: {
          type: "string",
          description: "Terminal status for the run.",
          allowedValues: ["complete", "failed", "blocked"]
        }
      },
      required: ["runId", "status"]
    },
    execute: async (toolArgs) => {
      const parsed = UlwCompleteArgs.safeParse(toolArgs);
      if (!parsed.success)
        refuseArgs(runIdOf(toolArgs), "ULW runId must be non-empty and status one of complete, failed, blocked.");
      if (parsed.data.status === "complete") {
        gateCheckpoint(store, parsed.data.runId);
      }
      return JSON.stringify(store.setRunStatus(parsed.data.runId, parsed.data.status));
    }
  };
}

// ../../../../omo-engine/team-core/src/team-registry/team-spec-input-normalizer.ts
function isJsonRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function omitEmptyStringFields(record) {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== ""));
}
function getMemberName(value) {
  return isJsonRecord(value) && typeof value.name === "string" ? value.name : undefined;
}
function normalizeNameStem(value) {
  const normalizedStem = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return normalizedStem.length > 0 ? normalizedStem : "member";
}
function deriveMemberNameStem(member) {
  if (member.kind === "category" && typeof member.category === "string") {
    return normalizeNameStem(member.category);
  }
  if (member.kind === "subagent_type" && typeof member.subagent_type === "string") {
    return normalizeNameStem(member.subagent_type);
  }
  return "member";
}
function assignGeneratedMemberNames(rawMembers) {
  const usedNames = new Set;
  return rawMembers.map((member) => {
    if (!isJsonRecord(member)) {
      return member;
    }
    const rawName = getMemberName(member);
    const stem = rawName === undefined ? deriveMemberNameStem(member) : normalizeNameStem(rawName);
    let generatedName = rawName === undefined ? `${stem}-1` : stem;
    let suffix = rawName === undefined ? 1 : 2;
    while (usedNames.has(generatedName)) {
      generatedName = `${stem}-${suffix}`;
      suffix += 1;
    }
    usedNames.add(generatedName);
    return { ...member, name: generatedName };
  });
}
function stripMemberLeadFlag(value) {
  if (!isJsonRecord(value) || !Object.hasOwn(value, "isLead")) {
    return value;
  }
  const { isLead: _isLead, ...memberWithoutLeadFlag } = value;
  return memberWithoutLeadFlag;
}
function hasMemberLeadFlag(rawMembers) {
  return rawMembers.some((member) => isJsonRecord(member) && member.isLead === true);
}
function createCallerLeadMember(callerAgentTypeId) {
  return {
    name: "lead",
    kind: "subagent_type",
    subagent_type: callerAgentTypeId
  };
}
function getPromptAlias(member) {
  if (typeof member.prompt === "string") {
    return member.prompt;
  }
  if (typeof member.systemPrompt === "string") {
    return member.systemPrompt;
  }
  if (typeof member.system_prompt === "string") {
    return member.system_prompt;
  }
  return;
}
function formatStringArray(value) {
  if (!Array.isArray(value)) {
    return;
  }
  const strings = value.filter((item) => typeof item === "string" && item.trim().length > 0);
  return strings.length > 0 ? strings.join(", ") : undefined;
}
function buildPromptFromNaturalMember(member) {
  const promptAlias = getPromptAlias(member);
  if (promptAlias !== undefined) {
    return promptAlias;
  }
  const promptParts = [
    typeof member.role === "string" ? `Role: ${member.role}` : undefined,
    typeof member.description === "string" ? member.description : undefined,
    formatStringArray(member.capabilities),
    formatStringArray(member.responsibilities)
  ].filter((part) => part !== undefined && part.trim().length > 0);
  return promptParts.length > 0 ? promptParts.join(`
`) : "Work on the assigned team task and report findings to the lead.";
}
function normalizeInlineMember(member, options) {
  const strippedMember = omitEmptyStringFields(member);
  const {
    capabilities: _capabilities,
    description: _description,
    loadSkills: _loadSkills,
    load_skills: _loadSkillsSnakeCase,
    permission: _permission,
    responsibilities: _responsibilities,
    role: _role,
    systemPrompt: _systemPrompt,
    system_prompt: _systemPromptSnakeCase,
    ...normalizedMember
  } = strippedMember;
  const rawKind = normalizedMember.kind;
  if (normalizedMember.kind === undefined) {
    if (typeof normalizedMember.category === "string") {
      normalizedMember.kind = "category";
    } else if (typeof normalizedMember.subagent_type === "string") {
      normalizedMember.kind = "subagent_type";
    } else if (options?.defaultCategoryName !== undefined) {
      normalizedMember.kind = "category";
      normalizedMember.category = options.defaultCategoryName;
    }
  } else if (normalizedMember.kind !== "category" && normalizedMember.kind !== "subagent_type") {
    if (typeof normalizedMember.category === "string") {
      normalizedMember.kind = "category";
    } else if (typeof normalizedMember.subagent_type === "string") {
      normalizedMember.kind = "subagent_type";
    } else if (typeof rawKind === "string" && rawKind !== "agent" && rawKind !== "member" && rawKind !== "worker" && rawKind !== "analyst") {
      normalizedMember.kind = "category";
      normalizedMember.category = rawKind;
    } else if (options?.defaultCategoryName !== undefined) {
      normalizedMember.kind = "category";
      normalizedMember.category = options.defaultCategoryName;
    }
  }
  if (normalizedMember.kind === "category" && normalizedMember.prompt === undefined) {
    normalizedMember.prompt = buildPromptFromNaturalMember(strippedMember);
  }
  return normalizedMember;
}
function normalizeTeamSpecInput(raw, options) {
  if (!isJsonRecord(raw)) {
    return raw;
  }
  const normalizedSpec = omitEmptyStringFields(raw);
  if (typeof normalizedSpec.name === "string") {
    normalizedSpec.name = normalizeNameStem(normalizedSpec.name);
  }
  const rawMembers = raw.members;
  const rawLead = isJsonRecord(raw.lead) && Object.keys(omitEmptyStringFields(raw.lead)).length > 0 ? raw.lead : undefined;
  let leadAgentId = typeof normalizedSpec.leadAgentId === "string" ? normalizedSpec.leadAgentId : undefined;
  const hasExplicitLead = leadAgentId !== undefined || rawLead !== undefined || Array.isArray(rawMembers) && hasMemberLeadFlag(rawMembers);
  if (Array.isArray(rawMembers)) {
    let normalizedMembers = rawMembers.map((member) => isJsonRecord(member) ? normalizeInlineMember(member, options) : member);
    const callerTeamLead = options?.callerTeamLead;
    const shouldUseFirstMemberAsLead = !hasExplicitLead && normalizedMembers.length >= 8 && callerTeamLead?.isEligibleForTeamLead === true;
    if (isJsonRecord(rawLead)) {
      const leadMember = normalizeInlineMember(rawLead, options);
      if (leadMember.name === undefined) {
        leadMember.name = "lead";
      }
      const leadName = getMemberName(leadMember);
      const alreadyPresent = leadName !== undefined && normalizedMembers.some((member) => getMemberName(member) === leadName);
      if (!alreadyPresent) {
        normalizedMembers = [leadMember, ...normalizedMembers];
      }
      if (leadAgentId === undefined && leadName !== undefined) {
        leadAgentId = leadName;
      }
    }
    if (shouldUseFirstMemberAsLead) {
      leadAgentId = getMemberName(normalizedMembers[0]);
    } else if (!hasExplicitLead) {
      if (callerTeamLead?.isEligibleForTeamLead && callerTeamLead.agentTypeId !== undefined) {
        normalizedMembers = [createCallerLeadMember(callerTeamLead.agentTypeId), ...normalizedMembers];
        leadAgentId = "lead";
      } else if (callerTeamLead?.displayName !== undefined) {
        throw new Error(`Caller agent ${callerTeamLead.displayName} is not eligible as team lead; specify leadAgentId explicitly`);
      }
    }
    normalizedMembers = assignGeneratedMemberNames(normalizedMembers);
    if (leadAgentId === undefined && shouldUseFirstMemberAsLead) {
      leadAgentId = getMemberName(normalizedMembers[0]);
    }
    normalizedMembers = normalizedMembers.map((member) => {
      const memberName = getMemberName(member);
      const isLead = isJsonRecord(member) && member.isLead === true;
      if (leadAgentId === undefined && isLead && memberName !== undefined) {
        leadAgentId = memberName;
      }
      return stripMemberLeadFlag(member);
    });
    if (leadAgentId !== undefined && !normalizedMembers.some((member) => getMemberName(member) === leadAgentId)) {
      const normalizedLeadAgentId = normalizeNameStem(leadAgentId);
      if (normalizedMembers.some((member) => getMemberName(member) === normalizedLeadAgentId)) {
        leadAgentId = normalizedLeadAgentId;
      }
    }
    if (leadAgentId === undefined && normalizedMembers.length === 1) {
      leadAgentId = getMemberName(normalizedMembers[0]);
    }
    normalizedSpec.members = normalizedMembers;
  }
  if (leadAgentId !== undefined) {
    normalizedSpec.leadAgentId = leadAgentId;
  }
  delete normalizedSpec.lead;
  return normalizedSpec;
}

// ../../../../omo-engine/team-core/src/member-parser.ts
class MemberValidationError extends Error {
  memberName;
  issue;
  constructor(message, memberName, issue) {
    super(message);
    this.memberName = memberName;
    this.issue = issue;
    this.name = "MemberValidationError";
  }
}
function translateMemberError(input, agentEligibilityRegistry) {
  const name = typeof input.name === "string" ? input.name : "<unnamed>";
  const hasCategory = input.category != null;
  const hasSubagentType = input.subagent_type != null;
  const hasKind = input.kind === "category" || input.kind === "subagent_type";
  if (hasCategory && hasSubagentType) {
    return new MemberValidationError(`Member '${name}' specifies both 'category' and 'subagent_type'. Must specify exactly one via 'kind' discriminator.`, name, "both-kinds");
  }
  if (!hasKind && !hasCategory && !hasSubagentType) {
    return new MemberValidationError(`Member '${name}' missing 'kind' discriminator. Specify either {kind:'category', category, prompt} or {kind:'subagent_type', subagent_type}.`, name, "missing-kind");
  }
  if (input.kind === "category" || !hasKind && hasCategory) {
    const category = typeof input.category === "string" ? input.category : "<unknown>";
    return new MemberValidationError(`Member '${name}' uses category '${category}' but is missing required 'prompt' field. Category members must supply a task prompt.`, name, "category-missing-prompt");
  }
  if (input.kind === "subagent_type" || !hasKind && hasSubagentType) {
    const subagentType = typeof input.subagent_type === "string" ? input.subagent_type : String(input.subagent_type);
    if (typeof input.subagent_type !== "string" || !agentEligibilityRegistry[input.subagent_type]) {
      return new MemberValidationError(`Unknown subagent_type '${subagentType}'. Available ELIGIBLE agents: sisyphus, atlas, sisyphus-junior, hephaestus (if D-36 applied). Use delegate-task for read-only agents like oracle, librarian, explore, metis, momus, multimodal-looker.`, name, "unknown-subagent");
    }
  }
  return new MemberValidationError(`Member '${name}' validation failed.`, name, "zod-residual");
}
function createParseMember(memberSchema, agentEligibilityRegistry) {
  return function parseMember(input) {
    if (input == null || typeof input !== "object") {
      throw new MemberValidationError("Member must be an object");
    }
    const raw = input;
    const result = memberSchema.safeParse(raw.kind === undefined && (raw.category !== undefined || raw.subagent_type !== undefined) ? { ...raw, kind: raw.category !== undefined ? "category" : "subagent_type" } : raw);
    if (!result.success) {
      throw translateMemberError(raw, agentEligibilityRegistry);
    }
    return result.data;
  };
}

// ../../../../omo-engine/team-core/src/types.ts
var MESSAGE_KINDS = [
  "message",
  "shutdown_request",
  "shutdown_approved",
  "shutdown_rejected",
  "announcement"
];
var TASK_STATUSES = ["pending", "claimed", "in_progress", "completed", "deleted"];
var RUNTIME_STATUSES = [
  "creating",
  "active",
  "shutdown_requested",
  "deleting",
  "deleted",
  "failed",
  "orphaned"
];
var MemberBaseSchema = object({
  name: string2().min(1).regex(/^[a-z0-9-]+$/),
  cwd: string2().optional(),
  worktreePath: string2().optional(),
  task_summary: string2().max(80).optional(),
  subscriptions: array(string2()).optional(),
  backendType: _enum(["in-process", "tmux"]).default("in-process"),
  color: string2().optional(),
  isActive: boolean2().default(true)
}).strict();
var CategoryMemberSchema = MemberBaseSchema.extend({
  kind: literal("category"),
  category: string2().min(1),
  prompt: string2().min(1)
});
var SubagentMemberSchema = MemberBaseSchema.extend({
  kind: literal("subagent_type"),
  subagent_type: string2().min(1),
  prompt: string2().optional()
});
var MemberSchema = discriminatedUnion("kind", [CategoryMemberSchema, SubagentMemberSchema]);
var TeamReferenceSchema = object({
  path: string2(),
  description: string2().optional()
}).strict();
var MISSING_TEAM_LEAD_MESSAGE = "leadAgentId required (or write a `lead: {...}` field, or mark one member with `isLead: true`)";
var TeamSpecSchema = object({
  version: literal(1).default(1),
  name: string2().min(1).regex(/^[a-z0-9-]+$/),
  description: string2().optional(),
  createdAt: number2().int().positive().default(() => Date.now()),
  leadAgentId: string2().optional(),
  teamAllowedPaths: array(string2()).optional(),
  sessionPermission: string2().optional(),
  members: array(MemberSchema).min(1).max(8)
}).superRefine((teamSpec, ctx) => {
  if (teamSpec.leadAgentId === undefined && teamSpec.members.length > 1) {
    ctx.addIssue({
      code: "custom",
      message: MISSING_TEAM_LEAD_MESSAGE,
      path: ["leadAgentId"]
    });
  }
}).transform((teamSpec) => {
  if (teamSpec.leadAgentId !== undefined) {
    return teamSpec;
  }
  const firstMember = teamSpec.members[0];
  if (!firstMember) {
    throw new Error(MISSING_TEAM_LEAD_MESSAGE);
  }
  return {
    ...teamSpec,
    leadAgentId: firstMember.name
  };
});
var MessageSchema = object({
  version: literal(1),
  messageId: string2().uuid(),
  from: string2(),
  to: string2(),
  kind: _enum(MESSAGE_KINDS),
  body: string2().max(32 * 1024),
  summary: string2().optional(),
  references: array(TeamReferenceSchema).optional(),
  timestamp: number2().int().positive(),
  correlationId: string2().uuid().optional(),
  color: string2().optional()
});
var TaskSchema = object({
  version: literal(1),
  id: string2(),
  subject: string2(),
  description: string2(),
  activeForm: string2().optional(),
  status: _enum(TASK_STATUSES),
  owner: string2().optional(),
  blocks: array(string2()).default([]),
  blockedBy: array(string2()).default([]),
  metadata: record(string2(), unknown()).optional(),
  createdAt: number2().int().positive(),
  updatedAt: number2().int().positive(),
  claimedAt: number2().int().positive().optional()
});
var RuntimeStateMemberModelSchema = object({
  providerID: string2(),
  modelID: string2(),
  variant: string2().optional(),
  reasoningEffort: string2().optional(),
  temperature: number2().optional(),
  top_p: number2().optional(),
  maxTokens: number2().optional(),
  thinking: object({
    type: _enum(["enabled", "disabled"]),
    budgetTokens: number2().int().positive().optional()
  }).optional()
}).strict();
var RuntimeStateMemberSchema = object({
  name: string2(),
  sessionId: string2().optional(),
  tmuxPaneId: string2().optional(),
  tmuxGridPaneId: string2().optional(),
  agentType: _enum(["leader", "general-purpose"]),
  subagent_type: string2().optional(),
  category: string2().optional(),
  model: RuntimeStateMemberModelSchema.optional(),
  status: _enum(["pending", "running", "idle", "errored", "completed", "shutdown_approved"]),
  color: string2().optional(),
  worktreePath: string2().optional(),
  lastInjectedTurnMarker: string2().optional(),
  pendingInjectedMessageIds: array(string2()).default([])
}).strict();
var RuntimeBoundsSchema = object({
  maxMembers: number2().int().default(8),
  maxParallelMembers: number2().int().default(4),
  maxMessagesPerRun: number2().int().default(1e4),
  maxWallClockMinutes: number2().int().default(120),
  maxMemberTurns: number2().int().default(500)
}).strict();
var ShutdownRequestSchema = object({
  memberId: string2(),
  requesterName: string2(),
  requestedAt: number2().int().positive(),
  approvedAt: number2().int().positive().optional(),
  rejectedReason: string2().optional(),
  rejectedAt: number2().int().positive().optional()
}).strict();
var RuntimeStateTmuxLayoutSchema = object({
  ownedSession: boolean2(),
  targetSessionId: string2(),
  focusWindowId: string2().optional(),
  gridWindowId: string2().optional(),
  paneIds: array(string2()).optional()
}).strict();
var RuntimeStateSchema = object({
  version: literal(1),
  teamRunId: string2().uuid(),
  teamName: string2(),
  specSource: _enum(["project", "user"]),
  createdAt: number2().int().positive(),
  status: _enum(RUNTIME_STATUSES),
  leadSessionId: string2().optional(),
  tmuxLayout: RuntimeStateTmuxLayoutSchema.optional(),
  members: array(RuntimeStateMemberSchema),
  shutdownRequests: array(ShutdownRequestSchema).default([]),
  bounds: RuntimeBoundsSchema
});
var AGENT_ELIGIBILITY_REGISTRY = {
  sisyphus: { verdict: "eligible" },
  hephaestus: {
    verdict: "conditional",
    rejectionMessage: `Agent 'hephaestus' lacks teammate permission. Either apply D-36 (add teammate: "allow" in tool-config-handler.ts) or use subagent_type: "sisyphus" instead.`
  },
  oracle: {
    verdict: "hard-reject",
    rejectionMessage: "Agent 'oracle' is read-only (cannot write files). Team members must write to mailbox inbox files. Use delegate-task with subagent_type: 'oracle' for read-only analysis instead."
  },
  librarian: {
    verdict: "hard-reject",
    rejectionMessage: "Agent 'librarian' is read-only (write/edit denied). Cannot write to mailbox as team member. Use delegate-task for research queries instead."
  },
  explore: {
    verdict: "hard-reject",
    rejectionMessage: "Agent 'explore' is read-only (write/edit denied). Cannot write to mailbox as team member. Use delegate-task for codebase exploration instead."
  },
  "multimodal-looker": {
    verdict: "hard-reject",
    rejectionMessage: "Agent 'multimodal-looker' has read-only tool access (only 'read' allowed). Cannot write to mailbox as team member."
  },
  metis: {
    verdict: "hard-reject",
    rejectionMessage: "Agent 'metis' is read-only (pre-planning consultant). Cannot write to mailbox as team member. Use delegate-task for pre-planning analysis instead."
  },
  momus: {
    verdict: "hard-reject",
    rejectionMessage: "Agent 'momus' is read-only (plan reviewer). Cannot write to mailbox as team member. Use delegate-task for plan review instead."
  },
  atlas: { verdict: "eligible" },
  prometheus: {
    verdict: "hard-reject",
    rejectionMessage: "Agent 'prometheus' is plan-mode-only; can only write to .omo/*.md (enforced by prometheusMdOnly hook). Cannot write to team mailbox. Use delegate-task with subagent_type: 'plan' instead."
  },
  "sisyphus-junior": { verdict: "eligible" }
};
var parseMemberBase = createParseMember(MemberSchema, AGENT_ELIGIBILITY_REGISTRY);

// ../../../../omo-engine/omo-opencode/src/team/normalize.ts
class TeamSpecError extends Error {
  code;
  teamName;
  constructor(message, code, teamName) {
    super(message);
    this.name = "TeamSpecError";
    this.code = code;
    this.teamName = teamName;
  }
}
var TEAM_LEAD_SENTINEL = "lead";
function isRecord10(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function coerceStringSpec(rawSpec, teamName) {
  if (typeof rawSpec !== "string")
    return rawSpec;
  try {
    return JSON.parse(rawSpec);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new TeamSpecError(`Team '${teamName}' spec is a string that is not valid JSON (${detail}). Pass the spec as an object like { name?, members: [...] }, or as a valid JSON string of that object.`, "INVALID_SPEC", teamName);
  }
}
function wrapSingleMember(rawSpec) {
  if (isRecord10(rawSpec) && isRecord10(rawSpec.members)) {
    return { ...rawSpec, members: [rawSpec.members] };
  }
  return rawSpec;
}
function describeReceived(rawSpec) {
  if (rawSpec === null)
    return "null";
  if (Array.isArray(rawSpec))
    return "an array";
  if (typeof rawSpec === "object")
    return "an object";
  return `a ${typeof rawSpec}`;
}
function assertNoRawLeadField(rawSpec, teamName) {
  if (isRecord10(rawSpec) && rawSpec.lead !== undefined && rawSpec.lead !== null) {
    throw new TeamSpecError(`Team '${teamName}' declares a 'lead' field. '${TEAM_LEAD_SENTINEL}' is reserved for the calling-session sentinel; declare workers under 'members' only.`, "RESERVED_LEAD_FIELD", teamName);
  }
}
function remapAgentAliasRaw(rawSpec) {
  if (!isRecord10(rawSpec) || !Array.isArray(rawSpec.members))
    return rawSpec;
  return {
    ...rawSpec,
    members: rawSpec.members.map((member) => {
      if (!isRecord10(member))
        return member;
      const remapped = { ...member };
      if (typeof remapped.agent === "string" && remapped.subagent_type === undefined) {
        remapped.subagent_type = remapped.agent;
      }
      delete remapped.agent;
      if (remapped.kind === "agent") {
        remapped.kind = "subagent_type";
      }
      return remapped;
    })
  };
}
function remapAgentAliasKind(members) {
  return members.map((member) => {
    if (isRecord10(member) && member.kind === "agent") {
      return { ...member, kind: "subagent_type" };
    }
    return member;
  });
}
function assertNoReservedMemberName(members, teamName) {
  for (const member of members) {
    if (isRecord10(member) && member.name === TEAM_LEAD_SENTINEL) {
      throw new TeamSpecError(`Team '${teamName}' has a member named '${TEAM_LEAD_SENTINEL}', which is reserved for the calling-session sentinel. Rename the member.`, "RESERVED_LEAD_MEMBER", teamName);
    }
  }
}
function normalizeTeamSpec(rawSpec, teamName) {
  const coerced = wrapSingleMember(coerceStringSpec(rawSpec, teamName));
  assertNoRawLeadField(coerced, teamName);
  const normalized = normalizeTeamSpecInput(remapAgentAliasRaw(coerced));
  if (!isRecord10(normalized)) {
    throw new TeamSpecError(`Team '${teamName}' spec must be an object like { name?, members: [...] }; received ${describeReceived(rawSpec)}. Pass the spec as a nested object, or as a valid JSON string of that object.`, "INVALID_SPEC", teamName);
  }
  const preNormalized = { ...normalized };
  if (Array.isArray(preNormalized.members)) {
    const members = remapAgentAliasKind(preNormalized.members);
    assertNoReservedMemberName(members, teamName);
    preNormalized.members = members;
  }
  preNormalized.name ??= teamName;
  preNormalized.leadAgentId = TEAM_LEAD_SENTINEL;
  const parsed = TeamSpecSchema.safeParse(preNormalized);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    const detail = firstIssue ? `${firstIssue.path.join(".") || "spec"}: ${firstIssue.message}` : parsed.error.message;
    throw new TeamSpecError(`Invalid team '${teamName}' spec (${detail}).`, "INVALID_SPEC", teamName);
  }
  return parsed.data;
}

// ../../../../omo-engine/omo-opencode/src/shared/session-lifecycle.ts
function childCancellationNoteText(childSessionID, reason) {
  return `The user stopped the work delegated to child session ${childSessionID} (${reason}). ` + `The interruption OpenCode reports for that session is this stop, not an error. ` + `Leave its partial work as-is and report the stop to the user.`;
}
async function cancelChildSession(client, args) {
  const { parentSessionID, childSessionID, directory, reason } = args;
  if (!parentSessionID) {
    throw new Error("parent session id is required to cancel a child session");
  }
  if (!childSessionID) {
    throw new Error("child session id is required to cancel a child session");
  }
  if (!directory) {
    throw new Error("directory is required to cancel a child session");
  }
  await client.session.synthetic({
    sessionID: parentSessionID,
    text: childCancellationNoteText(childSessionID, reason ?? "user stop"),
    description: "child-cancellation-note",
    resume: false,
    query: { directory }
  });
  const result = await client.session.interrupt({
    sessionID: childSessionID,
    query: { directory }
  });
  return result.interrupted;
}

// ../../../../omo-engine/omo-opencode/src/guards/plan-gate.ts
var PLAN_GATED_SUBAGENT_TYPES = [
  "plan-consultant",
  "plan-reviewer"
];
function denied(reason) {
  return { allowed: false, reason };
}
function isPlanGateInput(value) {
  if (typeof value !== "object" || value === null)
    return false;
  const candidate = value;
  return typeof candidate["userRequestedPlan"] === "boolean" && typeof candidate["planArtifactTouched"] === "boolean" && typeof candidate["executeStarted"] === "boolean";
}
function evaluatePlanGate(input) {
  if (!isPlanGateInput(input)) {
    return denied("Plan dispatch is denied: the gate input is missing or malformed, " + "and the gate fails closed without a proven session snapshot.");
  }
  if (input.executeStarted === true) {
    return denied("Plan dispatch is closed: execution already started in this session, " + "so there is no plan left to review. Continue the work directly instead.");
  }
  if (input.userRequestedPlan !== true) {
    return denied("Plan dispatch needs the user to explicitly request planning in this " + "session, for example by asking for a plan in their own words. " + "Automatic reads never unlock this gate.");
  }
  if (input.planArtifactTouched !== true) {
    return denied("Plan dispatch needs a touched plan artifact (.omo/plans/*.md) in this " + "session. Finish the planning step so it produces a plan file, then retry.");
  }
  return { allowed: true };
}
function invocationGateDenial(subagentType) {
  const name = typeof subagentType === "string" ? subagentType.trim() : "";
  if (!PLAN_GATED_SUBAGENT_TYPES.includes(name))
    return;
  return `Subagent "${name}" is plan-gated and cannot be dispatched without session ` + `proof: the user must explicitly request planning, a .omo/plans/*.md ` + `artifact must be touched, and execution must not have started. ` + `Evaluate the plan gate against the live session before dispatching.`;
}

// ../../../../omo-engine/omo-opencode/src/guards/spawn-role-guard.ts
var REGISTERED_GATE_ROLES = [
  "omo-native-code-reviewer",
  "omo-native-qa-executor",
  "omo-native-gate-reviewer"
];
var LEGACY_GATE_ROLE_ALIASES = {
  "omo-senpi-code-reviewer": "omo-native-code-reviewer",
  "omo-senpi-qa-executor": "omo-native-qa-executor",
  "omo-senpi-gate-reviewer": "omo-native-gate-reviewer"
};
function gateRoleError(role) {
  const received = role.trim() === "" ? "(empty)" : `"${role.trim()}"`;
  return new Error(`Unknown gate role ${received}. Registered gate roles: ` + `${REGISTERED_GATE_ROLES.join(", ")}.`);
}
function resolveGateRoleName(role) {
  const name = typeof role === "string" ? role.trim() : "";
  const aliased = LEGACY_GATE_ROLE_ALIASES[name];
  if (aliased !== undefined)
    return aliased;
  const match = REGISTERED_GATE_ROLES.includes(name);
  if (match)
    return name;
  throw gateRoleError(role);
}
// ../../../../../node_modules/.bun/@opencode-ai+sdk@1.18.31/node_modules/@opencode-ai/sdk/dist/gen/core/serverSentEvents.gen.js
var createSseClient = ({ onSseError, onSseEvent, responseTransformer, responseValidator, sseDefaultRetryDelay, sseMaxRetryAttempts, sseMaxRetryDelay, sseSleepFn, url, ...options }) => {
  let lastEventId;
  const sleep = sseSleepFn ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const createStream = async function* () {
    let retryDelay = sseDefaultRetryDelay ?? 3000;
    let attempt = 0;
    const signal = options.signal ?? new AbortController().signal;
    while (true) {
      if (signal.aborted)
        break;
      attempt++;
      const headers = options.headers instanceof Headers ? options.headers : new Headers(options.headers);
      if (lastEventId !== undefined) {
        headers.set("Last-Event-ID", lastEventId);
      }
      try {
        const response = await fetch(url, { ...options, headers, signal });
        if (!response.ok)
          throw new Error(`SSE failed: ${response.status} ${response.statusText}`);
        if (!response.body)
          throw new Error("No body in SSE response");
        const reader = response.body.pipeThrough(new TextDecoderStream).getReader();
        let buffer = "";
        const abortHandler = () => {
          try {
            reader.cancel();
          } catch {}
        };
        signal.addEventListener("abort", abortHandler);
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done)
              break;
            buffer += value;
            const chunks = buffer.split(`

`);
            buffer = chunks.pop() ?? "";
            for (const chunk of chunks) {
              const lines = chunk.split(`
`);
              const dataLines = [];
              let eventName;
              for (const line of lines) {
                if (line.startsWith("data:")) {
                  dataLines.push(line.replace(/^data:\s*/, ""));
                } else if (line.startsWith("event:")) {
                  eventName = line.replace(/^event:\s*/, "");
                } else if (line.startsWith("id:")) {
                  lastEventId = line.replace(/^id:\s*/, "");
                } else if (line.startsWith("retry:")) {
                  const parsed = Number.parseInt(line.replace(/^retry:\s*/, ""), 10);
                  if (!Number.isNaN(parsed)) {
                    retryDelay = parsed;
                  }
                }
              }
              let data;
              let parsedJson = false;
              if (dataLines.length) {
                const rawData = dataLines.join(`
`);
                try {
                  data = JSON.parse(rawData);
                  parsedJson = true;
                } catch {
                  data = rawData;
                }
              }
              if (parsedJson) {
                if (responseValidator) {
                  await responseValidator(data);
                }
                if (responseTransformer) {
                  data = await responseTransformer(data);
                }
              }
              onSseEvent?.({
                data,
                event: eventName,
                id: lastEventId,
                retry: retryDelay
              });
              if (dataLines.length) {
                yield data;
              }
            }
          }
        } finally {
          signal.removeEventListener("abort", abortHandler);
          reader.releaseLock();
        }
        break;
      } catch (error) {
        onSseError?.(error);
        if (sseMaxRetryAttempts !== undefined && attempt >= sseMaxRetryAttempts) {
          break;
        }
        const backoff = Math.min(retryDelay * 2 ** (attempt - 1), sseMaxRetryDelay ?? 30000);
        await sleep(backoff);
      }
    }
  };
  const stream = createStream();
  return { stream };
};

// ../../../../../node_modules/.bun/@opencode-ai+sdk@1.18.31/node_modules/@opencode-ai/sdk/dist/gen/core/auth.gen.js
var getAuthToken = async (auth, callback) => {
  const token = typeof callback === "function" ? await callback(auth) : callback;
  if (!token) {
    return;
  }
  if (auth.scheme === "bearer") {
    return `Bearer ${token}`;
  }
  if (auth.scheme === "basic") {
    return `Basic ${btoa(token)}`;
  }
  return token;
};

// ../../../../../node_modules/.bun/@opencode-ai+sdk@1.18.31/node_modules/@opencode-ai/sdk/dist/gen/core/bodySerializer.gen.js
var jsonBodySerializer = {
  bodySerializer: (body) => JSON.stringify(body, (_key, value) => typeof value === "bigint" ? value.toString() : value)
};

// ../../../../../node_modules/.bun/@opencode-ai+sdk@1.18.31/node_modules/@opencode-ai/sdk/dist/gen/core/pathSerializer.gen.js
var separatorArrayExplode = (style) => {
  switch (style) {
    case "label":
      return ".";
    case "matrix":
      return ";";
    case "simple":
      return ",";
    default:
      return "&";
  }
};
var separatorArrayNoExplode = (style) => {
  switch (style) {
    case "form":
      return ",";
    case "pipeDelimited":
      return "|";
    case "spaceDelimited":
      return "%20";
    default:
      return ",";
  }
};
var separatorObjectExplode = (style) => {
  switch (style) {
    case "label":
      return ".";
    case "matrix":
      return ";";
    case "simple":
      return ",";
    default:
      return "&";
  }
};
var serializeArrayParam = ({ allowReserved, explode, name, style, value }) => {
  if (!explode) {
    const joinedValues = (allowReserved ? value : value.map((v) => encodeURIComponent(v))).join(separatorArrayNoExplode(style));
    switch (style) {
      case "label":
        return `.${joinedValues}`;
      case "matrix":
        return `;${name}=${joinedValues}`;
      case "simple":
        return joinedValues;
      default:
        return `${name}=${joinedValues}`;
    }
  }
  const separator = separatorArrayExplode(style);
  const joinedValues = value.map((v) => {
    if (style === "label" || style === "simple") {
      return allowReserved ? v : encodeURIComponent(v);
    }
    return serializePrimitiveParam({
      allowReserved,
      name,
      value: v
    });
  }).join(separator);
  return style === "label" || style === "matrix" ? separator + joinedValues : joinedValues;
};
var serializePrimitiveParam = ({ allowReserved, name, value }) => {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "object") {
    throw new Error("Deeply-nested arrays/objects aren’t supported. Provide your own `querySerializer()` to handle these.");
  }
  return `${name}=${allowReserved ? value : encodeURIComponent(value)}`;
};
var serializeObjectParam = ({ allowReserved, explode, name, style, value, valueOnly }) => {
  if (value instanceof Date) {
    return valueOnly ? value.toISOString() : `${name}=${value.toISOString()}`;
  }
  if (style !== "deepObject" && !explode) {
    let values = [];
    Object.entries(value).forEach(([key, v]) => {
      values = [...values, key, allowReserved ? v : encodeURIComponent(v)];
    });
    const joinedValues = values.join(",");
    switch (style) {
      case "form":
        return `${name}=${joinedValues}`;
      case "label":
        return `.${joinedValues}`;
      case "matrix":
        return `;${name}=${joinedValues}`;
      default:
        return joinedValues;
    }
  }
  const separator = separatorObjectExplode(style);
  const joinedValues = Object.entries(value).map(([key, v]) => serializePrimitiveParam({
    allowReserved,
    name: style === "deepObject" ? `${name}[${key}]` : key,
    value: v
  })).join(separator);
  return style === "label" || style === "matrix" ? separator + joinedValues : joinedValues;
};

// ../../../../../node_modules/.bun/@opencode-ai+sdk@1.18.31/node_modules/@opencode-ai/sdk/dist/gen/core/utils.gen.js
var PATH_PARAM_RE = /\{[^{}]+\}/g;
var defaultPathSerializer = ({ path, url: _url }) => {
  let url = _url;
  const matches = _url.match(PATH_PARAM_RE);
  if (matches) {
    for (const match of matches) {
      let explode = false;
      let name = match.substring(1, match.length - 1);
      let style = "simple";
      if (name.endsWith("*")) {
        explode = true;
        name = name.substring(0, name.length - 1);
      }
      if (name.startsWith(".")) {
        name = name.substring(1);
        style = "label";
      } else if (name.startsWith(";")) {
        name = name.substring(1);
        style = "matrix";
      }
      const value = path[name];
      if (value === undefined || value === null) {
        continue;
      }
      if (Array.isArray(value)) {
        url = url.replace(match, serializeArrayParam({ explode, name, style, value }));
        continue;
      }
      if (typeof value === "object") {
        url = url.replace(match, serializeObjectParam({
          explode,
          name,
          style,
          value,
          valueOnly: true
        }));
        continue;
      }
      if (style === "matrix") {
        url = url.replace(match, `;${serializePrimitiveParam({
          name,
          value
        })}`);
        continue;
      }
      const replaceValue = encodeURIComponent(style === "label" ? `.${value}` : value);
      url = url.replace(match, replaceValue);
    }
  }
  return url;
};
var getUrl = ({ baseUrl, path, query, querySerializer, url: _url }) => {
  const pathUrl = _url.startsWith("/") ? _url : `/${_url}`;
  let url = (baseUrl ?? "") + pathUrl;
  if (path) {
    url = defaultPathSerializer({ path, url });
  }
  let search = query ? querySerializer(query) : "";
  if (search.startsWith("?")) {
    search = search.substring(1);
  }
  if (search) {
    url += `?${search}`;
  }
  return url;
};

// ../../../../../node_modules/.bun/@opencode-ai+sdk@1.18.31/node_modules/@opencode-ai/sdk/dist/gen/client/utils.gen.js
var createQuerySerializer = ({ allowReserved, array, object } = {}) => {
  const querySerializer = (queryParams) => {
    const search = [];
    if (queryParams && typeof queryParams === "object") {
      for (const name in queryParams) {
        const value = queryParams[name];
        if (value === undefined || value === null) {
          continue;
        }
        if (Array.isArray(value)) {
          const serializedArray = serializeArrayParam({
            allowReserved,
            explode: true,
            name,
            style: "form",
            value,
            ...array
          });
          if (serializedArray)
            search.push(serializedArray);
        } else if (typeof value === "object") {
          const serializedObject = serializeObjectParam({
            allowReserved,
            explode: true,
            name,
            style: "deepObject",
            value,
            ...object
          });
          if (serializedObject)
            search.push(serializedObject);
        } else {
          const serializedPrimitive = serializePrimitiveParam({
            allowReserved,
            name,
            value
          });
          if (serializedPrimitive)
            search.push(serializedPrimitive);
        }
      }
    }
    return search.join("&");
  };
  return querySerializer;
};
var getParseAs = (contentType) => {
  if (!contentType) {
    return "stream";
  }
  const cleanContent = contentType.split(";")[0]?.trim();
  if (!cleanContent) {
    return;
  }
  if (cleanContent.startsWith("application/json") || cleanContent.endsWith("+json")) {
    return "json";
  }
  if (cleanContent === "multipart/form-data") {
    return "formData";
  }
  if (["application/", "audio/", "image/", "video/"].some((type) => cleanContent.startsWith(type))) {
    return "blob";
  }
  if (cleanContent.startsWith("text/")) {
    return "text";
  }
  return;
};
var checkForExistence = (options, name) => {
  if (!name) {
    return false;
  }
  if (options.headers.has(name) || options.query?.[name] || options.headers.get("Cookie")?.includes(`${name}=`)) {
    return true;
  }
  return false;
};
var setAuthParams = async ({ security, ...options }) => {
  for (const auth of security) {
    if (checkForExistence(options, auth.name)) {
      continue;
    }
    const token = await getAuthToken(auth, options.auth);
    if (!token) {
      continue;
    }
    const name = auth.name ?? "Authorization";
    switch (auth.in) {
      case "query":
        if (!options.query) {
          options.query = {};
        }
        options.query[name] = token;
        break;
      case "cookie":
        options.headers.append("Cookie", `${name}=${token}`);
        break;
      case "header":
      default:
        options.headers.set(name, token);
        break;
    }
  }
};
var buildUrl = (options) => getUrl({
  baseUrl: options.baseUrl,
  path: options.path,
  query: options.query,
  querySerializer: typeof options.querySerializer === "function" ? options.querySerializer : createQuerySerializer(options.querySerializer),
  url: options.url
});
var mergeConfigs2 = (a, b) => {
  const config = { ...a, ...b };
  if (config.baseUrl?.endsWith("/")) {
    config.baseUrl = config.baseUrl.substring(0, config.baseUrl.length - 1);
  }
  config.headers = mergeHeaders(a.headers, b.headers);
  return config;
};
var mergeHeaders = (...headers) => {
  const mergedHeaders = new Headers;
  for (const header of headers) {
    if (!header || typeof header !== "object") {
      continue;
    }
    const iterator = header instanceof Headers ? header.entries() : Object.entries(header);
    for (const [key, value] of iterator) {
      if (value === null) {
        mergedHeaders.delete(key);
      } else if (Array.isArray(value)) {
        for (const v of value) {
          mergedHeaders.append(key, v);
        }
      } else if (value !== undefined) {
        mergedHeaders.set(key, typeof value === "object" ? JSON.stringify(value) : value);
      }
    }
  }
  return mergedHeaders;
};

class Interceptors {
  _fns;
  constructor() {
    this._fns = [];
  }
  clear() {
    this._fns = [];
  }
  getInterceptorIndex(id) {
    if (typeof id === "number") {
      return this._fns[id] ? id : -1;
    } else {
      return this._fns.indexOf(id);
    }
  }
  exists(id) {
    const index = this.getInterceptorIndex(id);
    return !!this._fns[index];
  }
  eject(id) {
    const index = this.getInterceptorIndex(id);
    if (this._fns[index]) {
      this._fns[index] = null;
    }
  }
  update(id, fn) {
    const index = this.getInterceptorIndex(id);
    if (this._fns[index]) {
      this._fns[index] = fn;
      return id;
    } else {
      return false;
    }
  }
  use(fn) {
    this._fns = [...this._fns, fn];
    return this._fns.length - 1;
  }
}
var createInterceptors = () => ({
  error: new Interceptors,
  request: new Interceptors,
  response: new Interceptors
});
var defaultQuerySerializer = createQuerySerializer({
  allowReserved: false,
  array: {
    explode: true,
    style: "form"
  },
  object: {
    explode: true,
    style: "deepObject"
  }
});
var defaultHeaders = {
  "Content-Type": "application/json"
};
var createConfig = (override = {}) => ({
  ...jsonBodySerializer,
  headers: defaultHeaders,
  parseAs: "auto",
  querySerializer: defaultQuerySerializer,
  ...override
});

// ../../../../../node_modules/.bun/@opencode-ai+sdk@1.18.31/node_modules/@opencode-ai/sdk/dist/gen/client/client.gen.js
var createClient = (config = {}) => {
  let _config = mergeConfigs2(createConfig(), config);
  const getConfig = () => ({ ..._config });
  const setConfig = (config) => {
    _config = mergeConfigs2(_config, config);
    return getConfig();
  };
  const interceptors = createInterceptors();
  const beforeRequest = async (options) => {
    const opts = {
      ..._config,
      ...options,
      fetch: options.fetch ?? _config.fetch ?? globalThis.fetch,
      headers: mergeHeaders(_config.headers, options.headers),
      serializedBody: undefined
    };
    if (opts.security) {
      await setAuthParams({
        ...opts,
        security: opts.security
      });
    }
    if (opts.requestValidator) {
      await opts.requestValidator(opts);
    }
    if (opts.body && opts.bodySerializer) {
      opts.serializedBody = opts.bodySerializer(opts.body);
    }
    if (opts.serializedBody === undefined || opts.serializedBody === "") {
      opts.headers.delete("Content-Type");
    }
    const url = buildUrl(opts);
    return { opts, url };
  };
  const request = async (options) => {
    const { opts, url } = await beforeRequest(options);
    const requestInit = {
      redirect: "follow",
      ...opts,
      body: opts.serializedBody
    };
    let request = new Request(url, requestInit);
    for (const fn of interceptors.request._fns) {
      if (fn) {
        request = await fn(request, opts);
      }
    }
    const _fetch = opts.fetch;
    let response = await _fetch(request);
    for (const fn of interceptors.response._fns) {
      if (fn) {
        response = await fn(response, request, opts);
      }
    }
    const result = {
      request,
      response
    };
    if (response.ok) {
      if (response.status === 204 || response.headers.get("Content-Length") === "0") {
        return opts.responseStyle === "data" ? {} : {
          data: {},
          ...result
        };
      }
      const parseAs = (opts.parseAs === "auto" ? getParseAs(response.headers.get("Content-Type")) : opts.parseAs) ?? "json";
      let data;
      switch (parseAs) {
        case "arrayBuffer":
        case "blob":
        case "formData":
        case "json":
        case "text":
          data = await response[parseAs]();
          break;
        case "stream":
          return opts.responseStyle === "data" ? response.body : {
            data: response.body,
            ...result
          };
      }
      if (parseAs === "json") {
        if (opts.responseValidator) {
          await opts.responseValidator(data);
        }
        if (opts.responseTransformer) {
          data = await opts.responseTransformer(data);
        }
      }
      return opts.responseStyle === "data" ? data : {
        data,
        ...result
      };
    }
    const textError = await response.text();
    let jsonError;
    try {
      jsonError = JSON.parse(textError);
    } catch {}
    const error = jsonError ?? textError;
    let finalError = error;
    for (const fn of interceptors.error._fns) {
      if (fn) {
        finalError = await fn(error, response, request, opts);
      }
    }
    finalError = finalError || {};
    if (opts.throwOnError) {
      throw finalError;
    }
    return opts.responseStyle === "data" ? undefined : {
      error: finalError,
      ...result
    };
  };
  const makeMethod = (method) => {
    const fn = (options) => request({ ...options, method });
    fn.sse = async (options) => {
      const { opts, url } = await beforeRequest(options);
      return createSseClient({
        ...opts,
        body: opts.body,
        headers: opts.headers,
        method,
        url
      });
    };
    return fn;
  };
  return {
    buildUrl,
    connect: makeMethod("CONNECT"),
    delete: makeMethod("DELETE"),
    get: makeMethod("GET"),
    getConfig,
    head: makeMethod("HEAD"),
    interceptors,
    options: makeMethod("OPTIONS"),
    patch: makeMethod("PATCH"),
    post: makeMethod("POST"),
    put: makeMethod("PUT"),
    request,
    setConfig,
    trace: makeMethod("TRACE")
  };
};
// ../../../../../node_modules/.bun/@opencode-ai+sdk@1.18.31/node_modules/@opencode-ai/sdk/dist/gen/core/params.gen.js
var extraPrefixesMap = {
  $body_: "body",
  $headers_: "headers",
  $path_: "path",
  $query_: "query"
};
var extraPrefixes = Object.entries(extraPrefixesMap);
// ../../../../../node_modules/.bun/@opencode-ai+sdk@1.18.31/node_modules/@opencode-ai/sdk/dist/gen/client.gen.js
var client = createClient(createConfig({
  baseUrl: "http://localhost:4096"
}));

// ../../../../../node_modules/.bun/@opencode-ai+sdk@1.18.31/node_modules/@opencode-ai/sdk/dist/gen/sdk.gen.js
class _HeyApiClient {
  _client = client;
  constructor(args) {
    if (args?.client) {
      this._client = args.client;
    }
  }
}

class Global extends _HeyApiClient {
  event(options) {
    return (options?.client ?? this._client).get.sse({
      url: "/global/event",
      ...options
    });
  }
}

class Project extends _HeyApiClient {
  list(options) {
    return (options?.client ?? this._client).get({
      url: "/project",
      ...options
    });
  }
  current(options) {
    return (options?.client ?? this._client).get({
      url: "/project/current",
      ...options
    });
  }
}

class Pty extends _HeyApiClient {
  list(options) {
    return (options?.client ?? this._client).get({
      url: "/pty",
      ...options
    });
  }
  create(options) {
    return (options?.client ?? this._client).post({
      url: "/pty",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers
      }
    });
  }
  remove(options) {
    return (options.client ?? this._client).delete({
      url: "/pty/{id}",
      ...options
    });
  }
  get(options) {
    return (options.client ?? this._client).get({
      url: "/pty/{id}",
      ...options
    });
  }
  update(options) {
    return (options.client ?? this._client).put({
      url: "/pty/{id}",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers
      }
    });
  }
  connect(options) {
    return (options.client ?? this._client).get({
      url: "/pty/{id}/connect",
      ...options
    });
  }
}

class Config extends _HeyApiClient {
  get(options) {
    return (options?.client ?? this._client).get({
      url: "/config",
      ...options
    });
  }
  update(options) {
    return (options?.client ?? this._client).patch({
      url: "/config",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers
      }
    });
  }
  providers(options) {
    return (options?.client ?? this._client).get({
      url: "/config/providers",
      ...options
    });
  }
}

class Tool extends _HeyApiClient {
  ids(options) {
    return (options?.client ?? this._client).get({
      url: "/experimental/tool/ids",
      ...options
    });
  }
  list(options) {
    return (options.client ?? this._client).get({
      url: "/experimental/tool",
      ...options
    });
  }
}

class Instance extends _HeyApiClient {
  dispose(options) {
    return (options?.client ?? this._client).post({
      url: "/instance/dispose",
      ...options
    });
  }
}

class Path extends _HeyApiClient {
  get(options) {
    return (options?.client ?? this._client).get({
      url: "/path",
      ...options
    });
  }
}

class Vcs extends _HeyApiClient {
  get(options) {
    return (options?.client ?? this._client).get({
      url: "/vcs",
      ...options
    });
  }
}

class Session extends _HeyApiClient {
  list(options) {
    return (options?.client ?? this._client).get({
      url: "/session",
      ...options
    });
  }
  create(options) {
    return (options?.client ?? this._client).post({
      url: "/session",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers
      }
    });
  }
  status(options) {
    return (options?.client ?? this._client).get({
      url: "/session/status",
      ...options
    });
  }
  delete(options) {
    return (options.client ?? this._client).delete({
      url: "/session/{id}",
      ...options
    });
  }
  get(options) {
    return (options.client ?? this._client).get({
      url: "/session/{id}",
      ...options
    });
  }
  update(options) {
    return (options.client ?? this._client).patch({
      url: "/session/{id}",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers
      }
    });
  }
  children(options) {
    return (options.client ?? this._client).get({
      url: "/session/{id}/children",
      ...options
    });
  }
  todo(options) {
    return (options.client ?? this._client).get({
      url: "/session/{id}/todo",
      ...options
    });
  }
  init(options) {
    return (options.client ?? this._client).post({
      url: "/session/{id}/init",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers
      }
    });
  }
  fork(options) {
    return (options.client ?? this._client).post({
      url: "/session/{id}/fork",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers
      }
    });
  }
  abort(options) {
    return (options.client ?? this._client).post({
      url: "/session/{id}/abort",
      ...options
    });
  }
  unshare(options) {
    return (options.client ?? this._client).delete({
      url: "/session/{id}/share",
      ...options
    });
  }
  share(options) {
    return (options.client ?? this._client).post({
      url: "/session/{id}/share",
      ...options
    });
  }
  diff(options) {
    return (options.client ?? this._client).get({
      url: "/session/{id}/diff",
      ...options
    });
  }
  summarize(options) {
    return (options.client ?? this._client).post({
      url: "/session/{id}/summarize",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers
      }
    });
  }
  messages(options) {
    return (options.client ?? this._client).get({
      url: "/session/{id}/message",
      ...options
    });
  }
  prompt(options) {
    return (options.client ?? this._client).post({
      url: "/session/{id}/message",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers
      }
    });
  }
  message(options) {
    return (options.client ?? this._client).get({
      url: "/session/{id}/message/{messageID}",
      ...options
    });
  }
  promptAsync(options) {
    return (options.client ?? this._client).post({
      url: "/session/{id}/prompt_async",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers
      }
    });
  }
  command(options) {
    return (options.client ?? this._client).post({
      url: "/session/{id}/command",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers
      }
    });
  }
  shell(options) {
    return (options.client ?? this._client).post({
      url: "/session/{id}/shell",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers
      }
    });
  }
  revert(options) {
    return (options.client ?? this._client).post({
      url: "/session/{id}/revert",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers
      }
    });
  }
  unrevert(options) {
    return (options.client ?? this._client).post({
      url: "/session/{id}/unrevert",
      ...options
    });
  }
}

class Command extends _HeyApiClient {
  list(options) {
    return (options?.client ?? this._client).get({
      url: "/command",
      ...options
    });
  }
}

class Oauth extends _HeyApiClient {
  authorize(options) {
    return (options.client ?? this._client).post({
      url: "/provider/{id}/oauth/authorize",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers
      }
    });
  }
  callback(options) {
    return (options.client ?? this._client).post({
      url: "/provider/{id}/oauth/callback",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers
      }
    });
  }
}

class Provider extends _HeyApiClient {
  list(options) {
    return (options?.client ?? this._client).get({
      url: "/provider",
      ...options
    });
  }
  auth(options) {
    return (options?.client ?? this._client).get({
      url: "/provider/auth",
      ...options
    });
  }
  oauth = new Oauth({ client: this._client });
}

class Find extends _HeyApiClient {
  text(options) {
    return (options.client ?? this._client).get({
      url: "/find",
      ...options
    });
  }
  files(options) {
    return (options.client ?? this._client).get({
      url: "/find/file",
      ...options
    });
  }
  symbols(options) {
    return (options.client ?? this._client).get({
      url: "/find/symbol",
      ...options
    });
  }
}

class File2 extends _HeyApiClient {
  list(options) {
    return (options.client ?? this._client).get({
      url: "/file",
      ...options
    });
  }
  read(options) {
    return (options.client ?? this._client).get({
      url: "/file/content",
      ...options
    });
  }
  status(options) {
    return (options?.client ?? this._client).get({
      url: "/file/status",
      ...options
    });
  }
}

class App extends _HeyApiClient {
  log(options) {
    return (options?.client ?? this._client).post({
      url: "/log",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers
      }
    });
  }
  agents(options) {
    return (options?.client ?? this._client).get({
      url: "/agent",
      ...options
    });
  }
}

class Auth extends _HeyApiClient {
  remove(options) {
    return (options.client ?? this._client).delete({
      url: "/mcp/{name}/auth",
      ...options
    });
  }
  start(options) {
    return (options.client ?? this._client).post({
      url: "/mcp/{name}/auth",
      ...options
    });
  }
  callback(options) {
    return (options.client ?? this._client).post({
      url: "/mcp/{name}/auth/callback",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers
      }
    });
  }
  authenticate(options) {
    return (options.client ?? this._client).post({
      url: "/mcp/{name}/auth/authenticate",
      ...options
    });
  }
  set(options) {
    return (options.client ?? this._client).put({
      url: "/auth/{id}",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers
      }
    });
  }
}

class Mcp extends _HeyApiClient {
  status(options) {
    return (options?.client ?? this._client).get({
      url: "/mcp",
      ...options
    });
  }
  add(options) {
    return (options?.client ?? this._client).post({
      url: "/mcp",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers
      }
    });
  }
  connect(options) {
    return (options.client ?? this._client).post({
      url: "/mcp/{name}/connect",
      ...options
    });
  }
  disconnect(options) {
    return (options.client ?? this._client).post({
      url: "/mcp/{name}/disconnect",
      ...options
    });
  }
  auth = new Auth({ client: this._client });
}

class Lsp extends _HeyApiClient {
  status(options) {
    return (options?.client ?? this._client).get({
      url: "/lsp",
      ...options
    });
  }
}

class Formatter extends _HeyApiClient {
  status(options) {
    return (options?.client ?? this._client).get({
      url: "/formatter",
      ...options
    });
  }
}

class Control extends _HeyApiClient {
  next(options) {
    return (options?.client ?? this._client).get({
      url: "/tui/control/next",
      ...options
    });
  }
  response(options) {
    return (options?.client ?? this._client).post({
      url: "/tui/control/response",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers
      }
    });
  }
}

class Tui extends _HeyApiClient {
  appendPrompt(options) {
    return (options?.client ?? this._client).post({
      url: "/tui/append-prompt",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers
      }
    });
  }
  openHelp(options) {
    return (options?.client ?? this._client).post({
      url: "/tui/open-help",
      ...options
    });
  }
  openSessions(options) {
    return (options?.client ?? this._client).post({
      url: "/tui/open-sessions",
      ...options
    });
  }
  openThemes(options) {
    return (options?.client ?? this._client).post({
      url: "/tui/open-themes",
      ...options
    });
  }
  openModels(options) {
    return (options?.client ?? this._client).post({
      url: "/tui/open-models",
      ...options
    });
  }
  submitPrompt(options) {
    return (options?.client ?? this._client).post({
      url: "/tui/submit-prompt",
      ...options
    });
  }
  clearPrompt(options) {
    return (options?.client ?? this._client).post({
      url: "/tui/clear-prompt",
      ...options
    });
  }
  executeCommand(options) {
    return (options?.client ?? this._client).post({
      url: "/tui/execute-command",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers
      }
    });
  }
  showToast(options) {
    return (options?.client ?? this._client).post({
      url: "/tui/show-toast",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers
      }
    });
  }
  publish(options) {
    return (options?.client ?? this._client).post({
      url: "/tui/publish",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers
      }
    });
  }
  control = new Control({ client: this._client });
}

class Event extends _HeyApiClient {
  subscribe(options) {
    return (options?.client ?? this._client).get.sse({
      url: "/event",
      ...options
    });
  }
}

class OpencodeClient extends _HeyApiClient {
  postSessionIdPermissionsPermissionId(options) {
    return (options.client ?? this._client).post({
      url: "/session/{id}/permissions/{permissionID}",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers
      }
    });
  }
  global = new Global({ client: this._client });
  project = new Project({ client: this._client });
  pty = new Pty({ client: this._client });
  config = new Config({ client: this._client });
  tool = new Tool({ client: this._client });
  instance = new Instance({ client: this._client });
  path = new Path({ client: this._client });
  vcs = new Vcs({ client: this._client });
  session = new Session({ client: this._client });
  command = new Command({ client: this._client });
  provider = new Provider({ client: this._client });
  find = new Find({ client: this._client });
  file = new File2({ client: this._client });
  app = new App({ client: this._client });
  mcp = new Mcp({ client: this._client });
  lsp = new Lsp({ client: this._client });
  formatter = new Formatter({ client: this._client });
  tui = new Tui({ client: this._client });
  auth = new Auth({ client: this._client });
  event = new Event({ client: this._client });
}

// ../../../../../node_modules/.bun/@opencode-ai+sdk@1.18.31/node_modules/@opencode-ai/sdk/dist/error-interceptor.js
function wrapClientError(error, response, request, opts) {
  if (!opts?.throwOnError)
    return error;
  if (error instanceof Error)
    return error;
  if (typeof error === "object" && error !== null && Object.keys(error).length > 0) {
    const obj = error;
    const message = typeof obj.data?.message === "string" && obj.data.message || typeof obj.message === "string" && obj.message || typeof obj.name === "string" && obj.name || describe2(request, response);
    return new Error(message, { cause: { body: error, status: response?.status } });
  }
  if (typeof error === "string" && error.length > 0) {
    return new Error(error, { cause: { body: error, status: response?.status } });
  }
  const reason = response ? "(empty response body)" : "network error (no response)";
  return new Error(`opencode server ${describe2(request, response)}: ${reason}`, {
    cause: { body: error, status: response?.status }
  });
}
function describe2(request, response) {
  const method = request?.method ?? "?";
  const url = request?.url ?? "?";
  const status = response?.status;
  const statusText = response?.statusText;
  return `${method} ${url}${status ? " → " + status : ""}${statusText ? " " + statusText : ""}`;
}

// ../../../../../node_modules/.bun/@opencode-ai+sdk@1.18.31/node_modules/@opencode-ai/sdk/dist/client.js
function pick3(value, fallback) {
  if (!value)
    return;
  if (!fallback)
    return value;
  if (value === fallback)
    return fallback;
  if (value === encodeURIComponent(fallback))
    return fallback;
  return value;
}
function rewrite(request, directory) {
  if (request.method !== "GET" && request.method !== "HEAD")
    return request;
  const value = pick3(request.headers.get("x-opencode-directory"), directory);
  if (!value)
    return request;
  const url = new URL(request.url);
  if (!url.searchParams.has("directory")) {
    url.searchParams.set("directory", value);
  }
  const next = new Request(url, request);
  next.headers.delete("x-opencode-directory");
  return next;
}
function createOpencodeClient(config) {
  if (!config?.fetch) {
    const customFetch = (req) => {
      req.timeout = false;
      return fetch(req);
    };
    config = {
      ...config,
      fetch: customFetch
    };
  }
  if (config?.directory) {
    config.headers = {
      ...config.headers,
      "x-opencode-directory": encodeURIComponent(config.directory)
    };
  }
  const client = createClient(config);
  client.interceptors.request.use((request) => rewrite(request, config?.directory));
  client.interceptors.error.use(wrapClientError);
  return new OpencodeClient({ client });
}
// ../../../../../node_modules/.bun/@opencode-ai+sdk@1.18.31/node_modules/@opencode-ai/sdk/dist/server.js
var import_cross_spawn = __toESM(require_cross_spawn(), 1);
// ../../../../omo-engine/omo-opencode/src/features/claude-code-session-state/state.ts
var subagentSessions = new Set;
var syncSubagentSessions = new Set;
var handedBackSyncSessions = new Set;
var registeredAgentNames = new Set;
var registeredAgentAliases = new Map;
var sessionAgentMap = new Map;

// ../../../../omo-engine/omo-opencode/src/shared/opencode-server-auth.ts
function getServerBasicAuthHeader() {
  const password = process.env.OPENCODE_SERVER_PASSWORD;
  if (!password) {
    return;
  }
  const username = process.env.OPENCODE_SERVER_USERNAME ?? "opencode";
  const token = Buffer.from(`${username}:${password}`, "utf8").toString("base64");
  return `Basic ${token}`;
}
function isRequestFetch(value) {
  return typeof value === "function";
}
function wrapRequestFetch(baseFetch, auth) {
  return async (request) => {
    const headers = new Headers(request.headers);
    headers.set("Authorization", auth);
    return baseFetch(new Request(request, { headers }));
  };
}
function getInternalClient(client) {
  if (!isRecord9(client)) {
    return null;
  }
  const internal = client["_client"];
  return isRecord9(internal) ? internal : null;
}
function tryInjectViaSetConfigHeaders(internal, auth) {
  const setConfig = internal["setConfig"];
  if (typeof setConfig !== "function") {
    return false;
  }
  setConfig({
    headers: {
      Authorization: auth
    }
  });
  return true;
}
function tryInjectViaInterceptors(internal, auth) {
  const interceptors = internal["interceptors"];
  if (!isRecord9(interceptors)) {
    return false;
  }
  const requestInterceptors = interceptors["request"];
  if (!isRecord9(requestInterceptors)) {
    return false;
  }
  const use = requestInterceptors["use"];
  if (typeof use !== "function") {
    return false;
  }
  use.call(requestInterceptors, (request) => {
    if (!request.headers.get("Authorization")) {
      request.headers.set("Authorization", auth);
    }
    return request;
  });
  return true;
}
function tryInjectViaFetchWrapper(internal, auth) {
  const getConfig = internal["getConfig"];
  const setConfig = internal["setConfig"];
  if (typeof getConfig !== "function" || typeof setConfig !== "function") {
    return false;
  }
  const config = getConfig();
  if (!isRecord9(config)) {
    return false;
  }
  const fetchValue = config["fetch"];
  if (!isRequestFetch(fetchValue)) {
    return false;
  }
  setConfig({
    fetch: wrapRequestFetch(fetchValue, auth)
  });
  return true;
}
function tryInjectViaMutableInternalConfig(internal, auth) {
  const configValue = internal["_config"];
  if (!isRecord9(configValue)) {
    return false;
  }
  const fetchValue = configValue["fetch"];
  if (!isRequestFetch(fetchValue)) {
    return false;
  }
  configValue["fetch"] = wrapRequestFetch(fetchValue, auth);
  return true;
}
function tryInjectViaTopLevelFetch(client, auth) {
  if (!isRecord9(client)) {
    return false;
  }
  const fetchValue = client["fetch"];
  if (!isRequestFetch(fetchValue)) {
    return false;
  }
  client["fetch"] = wrapRequestFetch(fetchValue, auth);
  return true;
}
function injectServerAuthIntoClient(client) {
  const auth = getServerBasicAuthHeader();
  if (!auth) {
    return;
  }
  try {
    const internal = getInternalClient(client);
    if (internal) {
      const injectedHeaders = tryInjectViaSetConfigHeaders(internal, auth);
      const injectedInterceptors = tryInjectViaInterceptors(internal, auth);
      const injectedFetch = tryInjectViaFetchWrapper(internal, auth);
      const injectedMutable = tryInjectViaMutableInternalConfig(internal, auth);
      const injected = injectedHeaders || injectedInterceptors || injectedFetch || injectedMutable;
      if (!injected) {
        log2("[opencode-server-auth] OPENCODE_SERVER_PASSWORD is set but SDK client structure is incompatible", {
          keys: Object.keys(internal)
        });
      }
      return;
    }
    const injected = tryInjectViaTopLevelFetch(client, auth);
    if (!injected) {
      log2("[opencode-server-auth] OPENCODE_SERVER_PASSWORD is set but no compatible SDK client found");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log2("[opencode-server-auth] Failed to inject server auth", { message });
  }
}

// ../../../../omo-engine/omo-opencode/src/shared/live-server-route.ts
var PROBE_TTL_MS = 60000;
var PROBE_ABORT_MS = 1500;
var AFFINITY_TTL_MS = 60000;
var registrations = new Map;
var liveParentWakeRoutingDisabled = false;
var fetchImplementationForTesting;
function getFetch() {
  return fetchImplementationForTesting ?? fetch;
}
async function probe(registration) {
  if (!registration.serverUrl) {
    registration.available = false;
    return false;
  }
  const probeUrl = new URL("/global/health", registration.serverUrl);
  const authHeader = getServerBasicAuthHeader();
  const headers = authHeader ? { Authorization: authHeader } : {};
  try {
    const controller = new AbortController;
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("probe timeout")), PROBE_ABORT_MS));
    const timeoutId = setTimeout(() => controller.abort(), PROBE_ABORT_MS);
    let response;
    try {
      response = await Promise.race([
        getFetch()(probeUrl, { headers, signal: controller.signal }),
        timeoutPromise
      ]);
    } finally {
      clearTimeout(timeoutId);
    }
    if (response.status === 401 || response.status === 403) {
      if (!registration.warnedOnce) {
        registration.warnedOnce = true;
        log2("[live-server-route] listener requires auth we cannot satisfy; live wake routing disabled");
      }
      registration.available = false;
      registration.probeTimestamp = Date.now();
      return false;
    }
    registration.available = response.ok;
    registration.probeTimestamp = Date.now();
    return registration.available;
  } catch {
    registration.available = false;
    registration.probeTimestamp = Date.now();
    return false;
  }
}
async function probeSessionAffinity(registration, sessionID) {
  if (!registration.serverUrl) {
    return;
  }
  const probeUrl = new URL(`/session/${sessionID}`, registration.serverUrl);
  const authHeader = getServerBasicAuthHeader();
  const headers = authHeader ? { Authorization: authHeader } : {};
  try {
    const controller = new AbortController;
    const timeoutId = setTimeout(() => controller.abort(), PROBE_ABORT_MS);
    let response;
    try {
      response = await getFetch()(probeUrl, { headers, signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
    }
    if (response.ok) {
      setSessionAffinity(registration, sessionID, true);
      return true;
    }
    if (response.status === 404) {
      setSessionAffinity(registration, sessionID, false);
      log2("[live-server-route] live listener does not own session; falling back to in-process client", { sessionID });
      return false;
    }
    return;
  } catch {
    return;
  }
}
function setSessionAffinity(registration, sessionID, owned) {
  const now = Date.now();
  for (const [key, entry] of registration.sessionAffinity) {
    if (now - entry.timestamp >= AFFINITY_TTL_MS) {
      registration.sessionAffinity.delete(key);
    }
  }
  registration.sessionAffinity.set(sessionID, { owned, timestamp: now });
}
function getFreshSessionAffinity(registration, sessionID) {
  const entry = registration.sessionAffinity.get(sessionID);
  if (!entry || Date.now() - entry.timestamp >= AFFINITY_TTL_MS) {
    return;
  }
  return entry.owned;
}
async function resolveSessionAffinity(registration, sessionID) {
  const cached = getFreshSessionAffinity(registration, sessionID);
  if (cached !== undefined) {
    return cached;
  }
  let inFlight = registration.inFlightAffinity.get(sessionID);
  if (!inFlight) {
    inFlight = probeSessionAffinity(registration, sessionID).finally(() => {
      registration.inFlightAffinity.delete(sessionID);
    });
    registration.inFlightAffinity.set(sessionID, inFlight);
  }
  return inFlight;
}
function getFreshProbeAvailability(registration) {
  const available = registration.available;
  if (available === undefined || Date.now() - registration.probeTimestamp >= PROBE_TTL_MS) {
    return;
  }
  return available;
}
async function resolveAvailability(registration) {
  const freshAvailability = getFreshProbeAvailability(registration);
  if (freshAvailability !== undefined) {
    return freshAvailability;
  }
  if (!registration.inFlightProbe) {
    registration.inFlightProbe = probe(registration).finally(() => {
      registration.inFlightProbe = undefined;
    });
  }
  return registration.inFlightProbe;
}
function getOrBuildLiveClient(registration) {
  if (registration.liveClient) {
    return registration.liveClient;
  }
  if (!registration.serverUrl) {
    return;
  }
  const client = createOpencodeClient({
    baseUrl: registration.serverUrl.toString(),
    directory: registration.directory
  });
  injectServerAuthIntoClient(client);
  registration.liveClient = client;
  return registration.liveClient;
}
function tryResolveDispatchClientSync2(client, sessionID) {
  const registration = registrations.get(client);
  if (!registration) {
    return { client, route: "in-process", reason: "identity" };
  }
  if (liveParentWakeRoutingDisabled) {
    return { client, route: "in-process", reason: "flag" };
  }
  if (subagentSessions.has(sessionID)) {
    return { client, route: "in-process", reason: "child" };
  }
  if (!registration.serverUrl) {
    return { client, route: "in-process", reason: "unavailable" };
  }
  const freshAvailability = getFreshProbeAvailability(registration);
  if (freshAvailability === undefined) {
    return;
  }
  if (!freshAvailability) {
    return { client, route: "in-process", reason: "unavailable" };
  }
  const cachedAffinity = getFreshSessionAffinity(registration, sessionID);
  if (cachedAffinity === undefined) {
    return;
  }
  if (!cachedAffinity) {
    return { client, route: "in-process", reason: "affinity" };
  }
  const resolvedLiveClient = getOrBuildLiveClient(registration);
  if (!resolvedLiveClient) {
    return { client, route: "in-process", reason: "unavailable" };
  }
  return { client: resolvedLiveClient, route: "live", reason: "live" };
}
async function resolveDispatchClient2(client, sessionID) {
  const syncResult = tryResolveDispatchClientSync2(client, sessionID);
  if (syncResult) {
    return syncResult;
  }
  const registration = registrations.get(client);
  if (!registration) {
    return { client, route: "in-process", reason: "identity" };
  }
  const isAvailable = await resolveAvailability(registration);
  if (!isAvailable) {
    return { client, route: "in-process", reason: "unavailable" };
  }
  const affinity = await resolveSessionAffinity(registration, sessionID);
  if (affinity === false) {
    return { client, route: "in-process", reason: "affinity" };
  }
  const resolvedLiveClient = getOrBuildLiveClient(registration);
  if (!resolvedLiveClient) {
    return { client, route: "in-process", reason: "unavailable" };
  }
  return { client: resolvedLiveClient, route: "live", reason: "live" };
}
function isPreSendConnectionFailure2(error) {
  if (!(error instanceof Error)) {
    return false;
  }
  if (error.name === "AbortError") {
    return false;
  }
  const CONNECTION_CODES = new Set([
    "ECONNREFUSED",
    "ENOTFOUND",
    "EAI_AGAIN",
    "ENETUNREACH",
    "EHOSTUNREACH",
    "ENETDOWN",
    "EHOSTDOWN",
    "EADDRNOTAVAIL",
    "UND_ERR_CONNECT_TIMEOUT"
  ]);
  const self = error;
  if (self.code && CONNECTION_CODES.has(self.code)) {
    return true;
  }
  const cause = error.cause;
  if (cause && typeof cause === "object" && cause !== null) {
    const causeCode = cause.code;
    if (causeCode && CONNECTION_CODES.has(causeCode)) {
      return true;
    }
  }
  return false;
}
function markLiveRouteUnavailable2(reason) {
  for (const registration of registrations.values()) {
    registration.available = false;
    registration.probeTimestamp = Date.now();
    registration.sessionAffinity.clear();
  }
  log2(`[live-server-route] marked unavailable: ${reason}`);
}

// ../../../../omo-engine/omo-opencode/src/shared/prompt-async-gate.ts
configureSharedSubunitLogger(log2);
configurePromptDispatchRouteResolver({
  tryResolveDispatchClientSync: tryResolveDispatchClientSync2,
  resolveDispatchClient: resolveDispatchClient2,
  isPreSendConnectionFailure: isPreSendConnectionFailure2,
  markLiveRouteUnavailable: markLiveRouteUnavailable2
});
// ../../../../omo-engine/omo-opencode/src/shared/session-route.ts
function routeSessionPrompt(args, directory) {
  return {
    ...args,
    query: { directory }
  };
}
function promptAsyncInDirectory(client, args, directory) {
  const routedArgs = routeSessionPrompt(args, directory);
  const sessionID = routedArgs.path?.id;
  if (!sessionID) {
    return Promise.reject(new Error("session id is required for routed promptAsync"));
  }
  return dispatchInternalPrompt({
    mode: "async",
    client,
    sessionID,
    input: routedArgs,
    source: "session-route",
    settleMs: 0,
    queueBehavior: "defer"
  }).then((result) => {
    if (result.status === "failed") {
      if (isAmbiguousPostDispatchPromptFailure(result)) {
        return;
      }
      throw result.error;
    }
    if (!isInternalPromptDispatchAccepted(result)) {
      throw new Error(`promptAsync skipped by gate: ${result.status}`);
    }
    return result.status === "dispatched" ? result.response : undefined;
  });
}

// ../../../../omo-engine/omo-opencode/src/team/runtime-errors.ts
class TeamRuntimeError extends Error {
  code;
  teamRef;
  constructor(message, code, teamRef) {
    super(message);
    this.name = "TeamRuntimeError";
    this.code = code;
    this.teamRef = teamRef;
  }
}

// ../../../../omo-engine/omo-opencode/src/team/spawn-members.ts
function nowMs(input) {
  return (input.now ?? Date.now)();
}
async function spawnTeamMembers(input) {
  const spawned = new Map;
  let failure;
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(input.maxParallel, input.spec.members.length));
  const runWorker = async () => {
    while (failure === undefined) {
      if (nowMs(input) > input.deadlineAt) {
        failure = new TeamRuntimeError(`team '${input.spec.name}' creation exceeded its wall-clock deadline`, "create_deadline_exceeded", input.teamRunId);
        return;
      }
      const member = input.spec.members[nextIndex++];
      if (member === undefined)
        return;
      try {
        spawned.set(member.name, await spawnOneMember(input, member));
      } catch (error) {
        failure = toSpawnFailure(input.teamRunId, member.name, error);
        return;
      }
    }
  };
  await Promise.all(Array.from({ length: workerCount }, runWorker));
  return failure !== undefined ? { spawned, failure } : { spawned };
}
function toSpawnFailure(teamRunId, memberName, error) {
  if (error instanceof TeamRuntimeError)
    return error;
  const detail = error instanceof Error ? error.message : String(error);
  const failure = new TeamRuntimeError(`member '${memberName}' failed to start: ${detail}`, "member_start_rejected", teamRunId);
  failure.cause = error;
  return failure;
}
function enforceDispatchGuards(input, member) {
  if (member.kind !== "subagent_type")
    return;
  let gateRole = false;
  try {
    resolveGateRoleName(member.subagent_type);
    gateRole = true;
  } catch {
    gateRole = false;
  }
  if (gateRole) {
    throw new TeamRuntimeError(`member '${member.name}' uses gate-only role '${member.subagent_type}', which cannot run as a team member; dispatch it through the final gate instead`, "member_start_rejected", input.teamRunId);
  }
  const denial = invocationGateDenial(member.subagent_type);
  if (denial === undefined)
    return;
  const verdict = input.planGate !== undefined ? evaluatePlanGate(input.planGate) : undefined;
  if (verdict?.allowed !== true) {
    throw new TeamRuntimeError(`member '${member.name}' is plan-gated and cannot start: ${verdict?.reason ?? denial}`, "member_start_rejected", input.teamRunId);
  }
}
async function spawnOneMember(input, member) {
  enforceDispatchGuards(input, member);
  const created = await input.client.session.create({
    body: { parentID: input.parentSessionId, title: `team ${input.teamRunId}: ${member.name}` },
    query: { directory: input.directory }
  });
  if (created.error) {
    const detail = created.error instanceof Error ? created.error.message : String(created.error);
    throw new TeamRuntimeError(`member '${member.name}' session creation failed: ${detail}`, "member_start_rejected", input.teamRunId);
  }
  const childSessionId = created.data?.id;
  if (!childSessionId) {
    throw new TeamRuntimeError(`member '${member.name}' session creation returned no session id`, "member_start_rejected", input.teamRunId);
  }
  const model = input.models?.[member.name];
  await promptAsyncInDirectory(input.client, {
    path: { id: childSessionId },
    body: {
      ...member.kind === "subagent_type" ? { agent: member.subagent_type } : {},
      ...model !== undefined ? { model: { providerID: model.providerID, modelID: model.modelID } } : {},
      parts: [{ type: "text", text: buildMemberPrompt(input.spec, member) }]
    },
    query: { directory: input.directory }
  }, input.directory);
  return {
    name: member.name,
    sessionId: childSessionId,
    status: "running",
    agentType: input.spec.leadAgentId === member.name ? "leader" : "general-purpose",
    ...member.kind === "subagent_type" ? { subagent_type: member.subagent_type } : { category: member.category },
    ...model !== undefined ? { model } : {}
  };
}
function buildMemberPrompt(spec, member) {
  const role = member.prompt ?? `You are team member '${member.name}' in team '${spec.name}'.`;
  return [
    `You are '${member.name}', a member of team '${spec.name}' running under the native OpenCode team runtime.`,
    "Work arrives as injected follow-up messages from the lead and other members.",
    "After completing any immediate instructions below, report back to the lead, then end your turn and wait for the next injected message.",
    role
  ].join(`

`);
}

// ../../../../omo-engine/omo-opencode/src/tools/ulw/dispatch.ts
var ULW_DISPATCH_NAME = "ulw_dispatch";
var ULW_DISPATCH_DESCRIPTION = "Dispatch ULW goals: record worker sessions, or spawn them through the team pool.";
var DEFAULT_POOL_BOUNDS = {
  maxParallelMembers: 4,
  maxWallClockMinutes: 120
};
var MAX_BATCH_SPAWNS = 8;
var MS_PER_MINUTE = 60000;
var SingleDispatchArgs = object({
  runId: NonEmptyText,
  goalId: NonEmptyText,
  workerSessionId: NonEmptyText
});
var BatchGoalSchema = object({
  goalId: NonEmptyText,
  workerSessionId: NonEmptyText.optional(),
  prompt: NonEmptyText.optional(),
  agent: NonEmptyText.optional()
});
var BatchDispatchArgs = object({
  runId: NonEmptyText,
  goals: array(BatchGoalSchema).min(1),
  maxParallel: number2().int().min(1).optional()
});
function teamNameFor(runId) {
  const slug = runId.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "run";
  return `ulw-${slug}`;
}
function memberNameFor(goalId, used) {
  const base = goalId.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "goal";
  let candidate = base;
  let suffix = 2;
  const taken = new Set(used);
  while (taken.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}
function specPrompt(runId, entry) {
  const assignment = `Work ULW goal '${entry.goalId}' for run '${runId}'.`;
  if (entry.prompt === undefined) {
    return `${assignment} Complete the assigned work, report back to the lead, then end your turn and wait.`;
  }
  return `${assignment}

${entry.prompt}`;
}
function requireActiveRun(store, runId) {
  const run = store.getRun(runId);
  if (run === undefined) {
    throw runNotFoundError(runId);
  }
  if (run.status !== "active") {
    throw runNotActiveError(runId, run.status);
  }
}
async function rollbackSpawnedWorkers(client, parentSessionId, directory, runId, spawned) {
  for (const member of spawned.values()) {
    try {
      await cancelChildSession(client, {
        parentSessionID: parentSessionId,
        childSessionID: member.sessionId,
        directory,
        reason: `ulw ${runId} dispatch rollback`
      });
    } catch {}
  }
}
function createUlwDispatchTool(deps = {}) {
  const store = deps.store ?? getUlwStore();
  const spawnMembers = deps.spawnMembers ?? spawnTeamMembers;
  const bounds = { ...DEFAULT_POOL_BOUNDS, ...deps.bounds };
  const now = deps.now ?? Date.now;
  return {
    description: ULW_DISPATCH_DESCRIPTION,
    args: {
      properties: {
        runId: { type: "string", description: "Run that owns the goals." },
        goalId: { type: "string", description: "Single-dispatch goal id." },
        workerSessionId: { type: "string", description: "Single-dispatch worker session id." },
        goals: {
          type: "array",
          description: "Batch goals: [{ goalId, workerSessionId?, prompt?, agent? }]."
        },
        maxParallel: { type: "number", description: "Pool cap for batch spawns; defaults to 4." }
      },
      required: ["runId"]
    },
    execute: async (toolArgs, context) => {
      if (toolArgs["goals"] === undefined) {
        const parsed = SingleDispatchArgs.safeParse(toolArgs);
        if (!parsed.success) {
          refuseArgs(runIdOf(toolArgs), "ULW goalId and workerSessionId must be non-empty strings.");
        }
        const workers = store.dispatchGoal(parsed.data.runId, parsed.data.goalId, parsed.data.workerSessionId);
        return JSON.stringify({
          runId: parsed.data.runId,
          goalId: parsed.data.goalId,
          workerSessionId: parsed.data.workerSessionId,
          workers
        });
      }
      const parsed = BatchDispatchArgs.safeParse(toolArgs);
      if (!parsed.success) {
        refuseArgs(runIdOf(toolArgs), "ULW goals must be a non-empty array of { goalId, workerSessionId?, prompt?, agent? }.");
      }
      const runId = parsed.data.runId;
      const used = new Set;
      const entries = parsed.data.goals.map((goal) => {
        const memberName = memberNameFor(goal.goalId, used);
        used.add(memberName);
        const entry = { goalId: goal.goalId, memberName };
        if (goal.workerSessionId !== undefined)
          entry.workerSessionId = goal.workerSessionId;
        if (goal.prompt !== undefined)
          entry.prompt = goal.prompt;
        if (goal.agent !== undefined)
          entry.agent = goal.agent;
        return entry;
      });
      const recorded = [];
      const toSpawn = entries.filter((entry) => entry.workerSessionId === undefined);
      const explicit = entries.filter((entry) => entry.workerSessionId !== undefined);
      requireActiveRun(store, runId);
      let batchClient;
      let spawnedByBatch = new Map;
      if (toSpawn.length > 0) {
        if (toSpawn.length > MAX_BATCH_SPAWNS) {
          throw invalidInputError(runId, `ULW batch dispatch spawns at most ${MAX_BATCH_SPAWNS} workers; split the batch.`);
        }
        const client = deps.getClient?.();
        if (client === undefined) {
          const pending = toSpawn.map((entry) => entry.goalId).join(", ");
          throw new Error(`ULW run '${runId}': batch dispatch needs a host client to spawn ${toSpawn.length} worker(s) (${pending}); pass workerSessionId per goal to record explicit sessions instead.`);
        }
        batchClient = client;
        const teamName = teamNameFor(runId);
        const spec = normalizeTeamSpec({
          name: teamName,
          members: toSpawn.map((entry) => entry.agent === undefined ? { name: entry.memberName, kind: "category", category: "general", prompt: specPrompt(runId, entry) } : {
            name: entry.memberName,
            kind: "subagent_type",
            subagent_type: entry.agent,
            prompt: specPrompt(runId, entry)
          })
        }, teamName);
        const result = await spawnMembers({
          spec,
          teamRunId: runId,
          parentSessionId: context.sessionID,
          directory: context.directory,
          client,
          maxParallel: parsed.data.maxParallel ?? bounds.maxParallelMembers,
          deadlineAt: now() + bounds.maxWallClockMinutes * MS_PER_MINUTE,
          now
        });
        if (result.failure !== undefined) {
          await rollbackSpawnedWorkers(client, context.sessionID, context.directory, runId, result.spawned);
          throw result.failure;
        }
        for (const entry of toSpawn) {
          if (!result.spawned.has(entry.memberName)) {
            await rollbackSpawnedWorkers(client, context.sessionID, context.directory, runId, result.spawned);
            throw new Error(`ULW run '${runId}': pool returned no session for goal '${entry.goalId}'; nothing was recorded.`);
          }
        }
        spawnedByBatch = result.spawned;
      }
      try {
        for (const entry of explicit) {
          const workerSessionId = entry.workerSessionId;
          if (workerSessionId === undefined)
            continue;
          recorded.push({
            goalId: entry.goalId,
            workerSessionId,
            workers: store.dispatchGoal(runId, entry.goalId, workerSessionId)
          });
        }
        for (const entry of toSpawn) {
          const spawned = spawnedByBatch.get(entry.memberName);
          if (spawned === undefined) {
            throw new Error(`ULW run '${runId}': pool returned no session for goal '${entry.goalId}'; nothing was recorded.`);
          }
          recorded.push({
            goalId: entry.goalId,
            workerSessionId: spawned.sessionId,
            workers: store.dispatchGoal(runId, entry.goalId, spawned.sessionId)
          });
        }
      } catch (error) {
        if (batchClient !== undefined && spawnedByBatch.size > 0) {
          await rollbackSpawnedWorkers(batchClient, context.sessionID, context.directory, runId, spawnedByBatch);
        }
        throw error;
      }
      recorded.sort((left, right) => left.goalId < right.goalId ? -1 : left.goalId > right.goalId ? 1 : 0);
      return JSON.stringify({ runId, dispatches: recorded });
    }
  };
}

// ../../../../omo-engine/omo-opencode/src/tools/ulw/evidence.ts
var ULW_EVIDENCE_NAME = "ulw_evidence";
var ULW_EVIDENCE_DESCRIPTION = "Record a dispatched ULW goal's child result as evidence.";
var UlwEvidenceArgs = object({
  runId: NonEmptyText,
  goalId: NonEmptyText,
  childSessionId: NonEmptyText,
  status: _enum(["completed", "failed"]).optional(),
  resultRef: NonEmptyText.optional(),
  reason: NonEmptyText.optional()
});
function createUlwEvidenceTool(deps = {}) {
  const store = deps.store ?? getUlwStore();
  return {
    description: ULW_EVIDENCE_DESCRIPTION,
    args: {
      properties: {
        runId: { type: "string", description: "Run that owns the goal." },
        goalId: { type: "string", description: "Dispatched goal the result settles." },
        childSessionId: { type: "string", description: "Worker session that produced the result." },
        status: {
          type: "string",
          description: "Result status; defaults to completed.",
          allowedValues: ["completed", "failed"]
        },
        resultRef: { type: "string", description: "Artifact reference for the result." },
        reason: { type: "string", description: "Why the child failed; for failed results." }
      },
      required: ["runId", "goalId", "childSessionId"]
    },
    execute: async (toolArgs) => {
      const parsed = UlwEvidenceArgs.safeParse(toolArgs);
      if (!parsed.success) {
        refuseArgs(runIdOf(toolArgs), "ULW runId, goalId, and childSessionId must be non-empty strings.");
      }
      const input = {
        childSessionId: parsed.data.childSessionId,
        status: parsed.data.status ?? "completed",
        resultRef: parsed.data.resultRef,
        reason: parsed.data.reason
      };
      return JSON.stringify(store.recordChildResult(parsed.data.runId, parsed.data.goalId, input));
    }
  };
}

// ../../../../omo-engine/omo-opencode/src/tools/ulw/goal-create.ts
var ULW_GOAL_CREATE_NAME = "ulw_goal_create";
var ULW_GOAL_CREATE_DESCRIPTION = "Open a native ULW run from a brief; returns the run record.";
var UlwGoalCreateArgs = object({
  brief: NonEmptyText,
  sessionScope: NonEmptyText.optional(),
  id: NonEmptyText.optional()
});
function createUlwGoalCreateTool(deps = {}) {
  const store = deps.store ?? getUlwStore();
  return {
    description: ULW_GOAL_CREATE_DESCRIPTION,
    args: {
      properties: {
        brief: { type: "string", description: "What the run must deliver." },
        sessionScope: {
          type: "string",
          description: "Owning session id; defaults to the calling session."
        },
        id: { type: "string", description: "Optional run id; generated when omitted." }
      },
      required: ["brief"]
    },
    execute: async (toolArgs, context) => {
      const parsed = UlwGoalCreateArgs.safeParse(toolArgs);
      if (!parsed.success)
        refuseArgs(runIdOf(toolArgs), "ULW brief must be a non-empty string.");
      return JSON.stringify(store.createRun({
        brief: parsed.data.brief,
        sessionScope: parsed.data.sessionScope ?? context.sessionID,
        id: parsed.data.id
      }));
    }
  };
}

// ../../../../omo-engine/omo-opencode/src/tools/ulw/status.ts
var ULW_STATUS_NAME = "ulw_status";
var ULW_STATUS_DESCRIPTION = "Report a native ULW run (record, roster, receipts, missing) or list runs.";
var UlwStatusArgs = object({
  runId: NonEmptyText.optional()
});
function createUlwStatusTool(deps = {}) {
  const store = deps.store ?? getUlwStore();
  return {
    description: ULW_STATUS_DESCRIPTION,
    args: {
      properties: {
        runId: { type: "string", description: "Run to inspect; omitted lists every run." }
      }
    },
    execute: async (toolArgs) => {
      const parsed = UlwStatusArgs.safeParse(toolArgs);
      if (!parsed.success)
        refuseArgs(runIdOf(toolArgs), "ULW runId must be a non-empty string when provided.");
      const runId = parsed.data.runId;
      if (runId === undefined) {
        return JSON.stringify({ runs: store.listRuns() });
      }
      const run = store.getRun(runId);
      if (run === undefined) {
        throw runNotFoundError(runId);
      }
      return JSON.stringify({
        run,
        roster: store.rosterFor(runId),
        receipts: store.receiptsFor(runId),
        missingReceipts: store.missingReceipts(runId)
      });
    }
  };
}

// ../../../../omo-engine/omo-opencode/src/tools/ulw/index.ts
function createUlwTools(deps = {}) {
  const store = deps.store ?? getUlwStore();
  const dispatchDeps = { ...deps.dispatch, store };
  return {
    [ULW_GOAL_CREATE_NAME]: createUlwGoalCreateTool({ store }),
    [ULW_STATUS_NAME]: createUlwStatusTool({ store }),
    [ULW_DISPATCH_NAME]: createUlwDispatchTool(dispatchDeps),
    [ULW_EVIDENCE_NAME]: createUlwEvidenceTool({ store }),
    [ULW_CHECKPOINT_NAME]: createUlwCheckpointTool({ store }),
    [ULW_COMPLETE_NAME]: createUlwCompleteTool({ store })
  };
}

// ../../../../omo-engine/omo-opencode/src/create-tools.ts
var LOADER_CANDIDATES = [
  "skills-loader-core",
  "../../skills-loader-core",
  "../../skills-loader-core/src/index.ts",
  "../skills-loader-core",
  "../skills-loader-core/src/index.ts"
];
async function resolveLoader() {
  for (const specifier of LOADER_CANDIDATES) {
    try {
      const mod = await import(specifier);
      if (mod && typeof mod.discoverSkills === "function")
        return mod;
    } catch {}
  }
  return null;
}
function isRecord11(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
async function tryDiscover(discover, directory) {
  if (typeof discover !== "function")
    return [];
  const call = discover;
  const attempts = [
    [directory],
    [{ directory }],
    [{ projectDirectory: directory }],
    [directory, {}],
    []
  ];
  for (const callArgs of attempts) {
    try {
      const out = await call(...callArgs);
      if (Array.isArray(out))
        return out;
      if (isRecord11(out) && Array.isArray(out["skills"])) {
        return out["skills"];
      }
    } catch {}
  }
  return [];
}
function normalizeSkills(raw) {
  const merged = [];
  for (const entry of raw) {
    if (!isRecord11(entry))
      continue;
    const name = typeof entry["name"] === "string" && entry["name"].length > 0 ? entry["name"] : "skill";
    const def = isRecord11(entry["definition"]) ? entry["definition"] : {};
    const description = typeof def["description"] === "string" ? def["description"] : typeof entry["description"] === "string" ? entry["description"] : "";
    const template = typeof def["template"] === "string" ? def["template"] : "";
    merged.push({
      name,
      definition: { name, description, template },
      scope: "project"
    });
  }
  return merged;
}
async function createTools(ctx, pluginConfig, managers) {
  let mergedSkills = [];
  try {
    const loader = await resolveLoader();
    if (loader) {
      const raw = await tryDiscover(loader.discoverSkills, ctx.directory);
      mergedSkills = normalizeSkills(raw);
      if (typeof loader.skillsToCommandDefinitionRecord === "function") {
        try {
          const toRecord = loader.skillsToCommandDefinitionRecord;
          await toRecord(mergedSkills);
        } catch {}
      }
    }
  } catch {
    mergedSkills = [];
  }
  const availableSkills = mergedSkills.map((skill) => ({
    name: skill.name,
    description: skill.definition.description ?? ""
  }));
  const experimental = pluginConfig.experimental;
  const registry = buildToolRegistry({
    skills: mergedSkills.map((skill) => ({ name: skill.name })),
    disabledTools: pluginConfig.disabled_tools,
    maxTools: experimental?.max_tools,
    getRestrictions: (agentName) => getAgentToolRestrictions(agentName)
  });
  const filteredTools = {};
  for (const [name, entry] of Object.entries(registry)) {
    filteredTools[name] = {
      description: entry.description,
      args: { properties: {} },
      execute: async () => "tool unavailable in this context"
    };
  }
  const ulwTools = createUlwTools();
  for (const [name, tool] of Object.entries(ulwTools)) {
    if (registry[name] !== undefined) {
      filteredTools[name] = tool;
    }
  }
  return { filteredTools, mergedSkills, availableSkills };
}

// ../../../../omo-engine/omo-opencode/src/plugin-dispose.ts
var createPluginDispose = (parts) => {
  let settled = null;
  return async () => {
    settled ??= (async () => {
      try {
        await parts.managers.backgroundManager.shutdown();
      } catch (error) {
        log2("[plugin-dispose] background shutdown failed", { error });
      }
      try {
        await parts.managers.skillMcpManager.disconnectAll();
      } catch (error) {
        log2("[plugin-dispose] skill MCP disconnect failed", { error });
      }
      try {
        parts.hooks.disposeHooks();
      } catch (error) {
        log2("[plugin-dispose] hook dispose failed", { error });
      }
    })();
    await settled;
  };
};

// ../../../../omo-engine/omo-opencode/src/shared/gate-facts.ts
var EMPTY_GATE_FACTS = {
  userRequestedPlan: false,
  planArtifactTouched: false,
  executeStarted: false
};
var factsBySession = new Map;
function entryFor(sessionID) {
  const existing = factsBySession.get(sessionID);
  if (existing)
    return existing;
  const fresh = { ...EMPTY_GATE_FACTS };
  factsBySession.set(sessionID, fresh);
  return fresh;
}
function readGateFacts(sessionID) {
  const entry = factsBySession.get(sessionID);
  if (!entry)
    return { ...EMPTY_GATE_FACTS };
  return { ...entry };
}
var PLAN_REQUEST_PATTERN = /(^|\s)\/plan\b|\b(make|create|write|draft|draw\s+up|update|review|show|propose)\b[^.\n]{0,80}\bplans?\b|\bplans?\b[^.\n]{0,40}\b(first|before|ahead|please)\b/i;
function isExplicitPlanRequest(text) {
  return PLAN_REQUEST_PATTERN.test(text);
}
function noteUserPlanRequest(sessionID, text) {
  if (sessionID.length === 0)
    return;
  if (text !== undefined && !isExplicitPlanRequest(text))
    return;
  entryFor(sessionID).userRequestedPlan = true;
}
function notePlanArtifact(sessionID) {
  if (sessionID.length === 0)
    return;
  entryFor(sessionID).planArtifactTouched = true;
}
function noteExecutionStart(sessionID) {
  if (sessionID.length === 0)
    return;
  entryFor(sessionID).executeStarted = true;
}

// ../../../../omo-engine/omo-opencode/src/plugin-interface.ts
function tiersOf(hooks) {
  return [hooks.coreHooks, hooks.continuationHooks, hooks.skillHooks];
}
async function fanOut(registries, input, sink) {
  const output = sink === undefined ? {} : { note: (text) => sink.push(text) };
  for (const registry of registries) {
    for (const handler of Object.values(registry)) {
      if (typeof handler !== "function")
        continue;
      try {
        await handler(input, output);
      } catch {}
    }
  }
}
var PLAN_COMMAND_PATTERN = /plan/i;
var PLAN_EXECUTION_COMMAND_PATTERN = /ulw[-_]?execute/i;
var PLAN_ARTIFACT_PATTERN = /(?:\.omo\/plans|plans\/[^"'`\s]*\.md)/i;
var EXECUTION_TOOL_PATTERN = /^(write|edit|bash|apply|patch|run|execute|task|call_omo_agent)/i;
function appendNotes(parts, notes) {
  for (const note of notes)
    parts.push({ type: "text", text: note });
}
var createPluginInterface = (ctx, pluginConfig, managers, hooks, tools) => {
  const tiers = tiersOf(hooks);
  const iface = {
    tool: { ...tools.filteredTools },
    "chat.params": async (input) => {
      await fanOut(tiers, {
        sessionID: input.sessionID,
        agentName: input.agent,
        modelID: input.model.modelID,
        providerID: input.model.providerID
      });
    },
    "chat.headers": async (input) => {
      await fanOut(tiers, {
        sessionID: input.sessionID,
        agentName: input.agent,
        modelID: input.model.modelID,
        providerID: input.model.providerID
      });
    },
    "chat.message": async (input, output) => {
      const text = output.message.text;
      if (input.sessionID && isExplicitPlanRequest(text)) {
        noteUserPlanRequest(input.sessionID, text);
      }
      const notes = [];
      await fanOut(tiers, {
        sessionID: input.sessionID,
        agentName: input.agent,
        modelID: input.model?.modelID,
        providerID: input.model?.providerID,
        text
      }, notes);
      appendNotes(output.parts, notes);
    },
    "command.execute.before": async (input, output) => {
      if (input.sessionID) {
        if (PLAN_COMMAND_PATTERN.test(input.command)) {
          noteUserPlanRequest(input.sessionID);
        } else if (PLAN_EXECUTION_COMMAND_PATTERN.test(input.command)) {
          noteExecutionStart(input.sessionID);
        }
      }
      const notes = [];
      await fanOut(tiers, {
        sessionID: input.sessionID,
        commandName: input.command,
        text: input.argsText
      }, notes);
      appendNotes(output.parts, notes);
    },
    "experimental.chat.messages.transform": async () => {},
    "experimental.chat.system.transform": async (input, output) => {
      const notes = [];
      await fanOut(tiers, {
        sessionID: input.sessionID,
        modelID: input.model.modelID,
        providerID: input.model.providerID
      }, notes);
      for (const note of notes)
        output.system.push(note);
    },
    config: managers.configHandler,
    event: async (input) => {
      const event = input.event;
      if (event.name === "session.created" && event.parentID) {
        try {
          await managers.backgroundManager.noteSubagentBirth({
            sessionID: event.sessionID,
            parentID: event.parentID,
            title: event.title ?? event.sessionID
          });
        } catch {}
      } else if (event.name === "session.deleted") {
        try {
          await managers.backgroundManager.noteSubagentDeath({
            sessionID: event.sessionID
          });
        } catch {}
      }
      await fanOut(tiers, { sessionID: event.sessionID });
    },
    "tool.definition": async (input, output) => {
      const entry = tools.filteredTools[input.toolID];
      if (entry) {
        output.description = entry.description;
        output.parameters = entry.args;
      }
    },
    "tool.execute.before": async (input) => {
      if (EXECUTION_TOOL_PATTERN.test(input.tool)) {
        noteExecutionStart(input.sessionID);
      }
      await fanOut(tiers, {
        sessionID: input.sessionID,
        toolName: input.tool
      });
    },
    "tool.execute.after": async (input, output) => {
      if (PLAN_ARTIFACT_PATTERN.test(output.output)) {
        notePlanArtifact(input.sessionID);
      }
      const notes = [];
      await fanOut(tiers, {
        sessionID: input.sessionID,
        toolName: input.tool,
        text: output.output
      }, notes);
      if (notes.length > 0) {
        output.note = output.note ? `${output.note}
${notes.join(`
`)}` : notes.join(`
`);
      }
    }
  };
  return iface;
};

// ../../../../omo-engine/omo-opencode/src/shared/load-opencode-plugins.ts
import * as fs2 from "node:fs";
import * as path3 from "node:path";
// ../../../../omo-engine/omo-opencode/src/shared/opencode-config-dir.ts
import { existsSync as existsSync13, realpathSync as realpathSync3 } from "node:fs";
import { homedir as homedir5 } from "node:os";
import { join as join11, posix as posix2, resolve as resolve4, win32 } from "node:path";
var TAURI_APP_IDENTIFIER = "ai.opencode.desktop";
var TAURI_APP_IDENTIFIER_DEV = "ai.opencode.desktop.dev";
function isDevBuild(version) {
  if (!version)
    return false;
  return version.includes("-dev") || version.includes(".dev");
}
function getTauriConfigDir(identifier) {
  const platform = process.platform;
  switch (platform) {
    case "darwin":
      return join11(homedir5(), "Library", "Application Support", identifier);
    case "win32": {
      const appData = process.env.APPDATA || join11(homedir5(), "AppData", "Roaming");
      return win32.join(appData, identifier);
    }
    case "linux":
    default: {
      const xdgConfig = process.env.XDG_CONFIG_HOME || join11(homedir5(), ".config");
      return join11(xdgConfig, identifier);
    }
  }
}
function resolveConfigPath(pathValue) {
  if (isWslEnvironment() && pathValue.startsWith("/")) {
    return posix2.normalize(pathValue);
  }
  const resolvedPath = resolve4(pathValue);
  if (!existsSync13(resolvedPath))
    return resolvedPath;
  try {
    return realpathSync3(resolvedPath);
  } catch (error) {
    if (error instanceof Error) {
      return resolvedPath;
    }
    return resolvedPath;
  }
}
function isWslEnvironment() {
  return process.platform === "linux" && (Boolean(process.env.WSL_DISTRO_NAME?.trim()) || Boolean(process.env.WSL_INTEROP?.trim()));
}
function isWindowsUserConfigRoot(pathValue) {
  const normalizedPath = pathValue.replaceAll("\\", "/").toLowerCase();
  return /^[a-z]:\/users\//.test(normalizedPath) || /^\/mnt\/[a-z]\/users\//.test(normalizedPath);
}
function getWindowsUserFromConfigRoot(pathValue) {
  const normalizedPath = pathValue.replaceAll("\\", "/");
  const match = /^(?:[a-z]:|\/mnt\/[a-z])\/Users\/([^/]+)/i.exec(normalizedPath);
  return match?.[1] ?? null;
}
function getWslLinuxHomeDir(windowsConfigRoot) {
  const envHome = process.env.HOME?.trim();
  if (envHome && envHome.startsWith("/") && !isWindowsUserConfigRoot(envHome)) {
    return envHome;
  }
  const user = process.env.USER?.trim() || process.env.LOGNAME?.trim() || process.env.SUDO_USER?.trim() || (windowsConfigRoot ? getWindowsUserFromConfigRoot(windowsConfigRoot) : undefined);
  return user ? posix2.join("/home", user) : null;
}
function getCliDefaultConfigDir() {
  const envXdgConfig = process.env.XDG_CONFIG_HOME?.trim();
  const shouldIgnoreWindowsXdg = envXdgConfig !== undefined && envXdgConfig.length > 0 && isWslEnvironment() && isWindowsUserConfigRoot(envXdgConfig);
  const xdgConfig = shouldIgnoreWindowsXdg ? posix2.join(getWslLinuxHomeDir(envXdgConfig) ?? "/home", ".config") : envXdgConfig || join11(homedir5(), ".config");
  const configDir = isWslEnvironment() ? posix2.join(xdgConfig, "opencode") : join11(xdgConfig, "opencode");
  return resolveConfigPath(configDir);
}
function getCliCustomConfigDir() {
  const envConfigDir = process.env.OPENCODE_CONFIG_DIR?.trim();
  if (!envConfigDir) {
    return null;
  }
  return resolveConfigPath(envConfigDir);
}
function getCliConfigDir() {
  return getCliCustomConfigDir() ?? getCliDefaultConfigDir();
}
function getOpenCodeConfigDirs(options) {
  if (options.binary !== "opencode") {
    return [getOpenCodeConfigDir(options)];
  }
  const customConfigDir = getCliCustomConfigDir();
  return Array.from(new Set([
    ...customConfigDir ? [customConfigDir] : [],
    getCliDefaultConfigDir()
  ]));
}
function getOpenCodeConfigDir(options) {
  const { binary, version, checkExisting = true } = options;
  if (binary === "opencode") {
    return getCliConfigDir();
  }
  const identifier = isDevBuild(version) ? TAURI_APP_IDENTIFIER_DEV : TAURI_APP_IDENTIFIER;
  const tauriDirBase = getTauriConfigDir(identifier);
  const tauriDir = process.platform === "win32" ? win32.isAbsolute(tauriDirBase) ? win32.normalize(tauriDirBase) : win32.resolve(tauriDirBase) : resolveConfigPath(tauriDirBase);
  if (checkExisting) {
    const legacyDir = getCliConfigDir();
    const legacyConfig = join11(legacyDir, "opencode.json");
    const legacyConfigC = join11(legacyDir, "opencode.jsonc");
    if (existsSync13(legacyConfig) || existsSync13(legacyConfigC)) {
      return legacyDir;
    }
  }
  return tauriDir;
}
function getOpenCodeConfigPaths(options) {
  const configDir = getOpenCodeConfigDir(options);
  return {
    configDir,
    configJson: join11(configDir, "opencode.json"),
    configJsonc: join11(configDir, "opencode.jsonc"),
    packageJson: join11(configDir, "package.json")
  };
}

// ../../../../omo-engine/omo-opencode/src/shared/load-opencode-plugins.ts
var opencodePluginsCache = new Map;
function getConfigPaths(directory) {
  const configDirs = getOpenCodeConfigDirs({ binary: "opencode" });
  return [
    path3.join(directory, ".opencode", "opencode.json"),
    path3.join(directory, ".opencode", "opencode.jsonc"),
    ...configDirs.flatMap((dir) => [
      path3.join(dir, "opencode.json"),
      path3.join(dir, "opencode.jsonc")
    ])
  ];
}
function loadOpencodePlugins(directory) {
  const cachedPluginEntries = opencodePluginsCache.get(directory);
  if (cachedPluginEntries) {
    return cachedPluginEntries;
  }
  const pluginEntries = [];
  const seenPluginEntries = new Set;
  for (const configPath of getConfigPaths(directory)) {
    try {
      if (!fs2.existsSync(configPath))
        continue;
      const content = fs2.readFileSync(configPath, "utf-8");
      const result = parseJsoncSafe2(content);
      const plugins = result.data?.plugin ?? [];
      for (const plugin of plugins) {
        const entry = typeof plugin === "string" ? plugin : Array.isArray(plugin) ? plugin[0] : null;
        if (typeof entry !== "string")
          continue;
        if (seenPluginEntries.has(entry))
          continue;
        seenPluginEntries.add(entry);
        pluginEntries.push(entry);
      }
    } catch (error) {
      if (error instanceof Error) {
        continue;
      }
      continue;
    }
  }
  opencodePluginsCache.set(directory, pluginEntries);
  return pluginEntries;
}

// ../../../../omo-engine/omo-opencode/src/shared/external-plugin-detector.ts
var OMO_PACKAGE_PLUGINS = [
  "oh-my-opencode",
  "oh-my-openagent",
  "@code-yeongyu/oh-my-opencode",
  "@code-yeongyu/oh-my-openagent"
];
function matchesKnownPlugin(entry, knownPlugins) {
  const normalized = entry.toLowerCase();
  for (const known of knownPlugins) {
    if (normalized === known)
      return known;
    if (normalized.startsWith(`${known}@`))
      return known;
    if (normalized === `npm:${known}` || normalized.startsWith(`npm:${known}@`))
      return known;
    if (normalized.startsWith("file://") && (normalized.endsWith(`/${known}`) || normalized.endsWith(`\\${known}`)))
      return known;
  }
  return null;
}
function isOmoFilePlugin(entry) {
  const normalized = entry.toLowerCase().replaceAll("\\", "/");
  if (!normalized.startsWith("file://"))
    return false;
  return /\/(omo(?:-[^/]*)?|oh-my-opencode|oh-my-openagent)\/(src|dist)\/index\.(ts|js)$/.test(normalized);
}
function matchesOmoPlugin(entry) {
  const packageMatch = matchesKnownPlugin(entry, OMO_PACKAGE_PLUGINS);
  if (packageMatch)
    return packageMatch;
  if (isOmoFilePlugin(entry))
    return "oh-my-openagent";
  return null;
}
function detectDuplicateOmoPlugin(directory) {
  const plugins = loadOpencodePlugins(directory);
  const duplicatePlugins = plugins.filter((plugin) => matchesOmoPlugin(plugin) !== null);
  if (duplicatePlugins.length > 1) {
    log2("[oh-my-openagent] Duplicate OMO plugin entries detected", {
      duplicatePlugins,
      allPlugins: plugins
    });
    return {
      detected: true,
      pluginName: "oh-my-openagent",
      duplicatePlugins,
      allPlugins: plugins
    };
  }
  return {
    detected: false,
    pluginName: null,
    duplicatePlugins,
    allPlugins: plugins
  };
}
function getDuplicateOmoPluginWarning(duplicatePlugins) {
  const formattedPlugins = duplicatePlugins.map((plugin) => `   - ${plugin}`).join(`
`);
  return `[${PLUGIN_NAME}] Duplicate OMO plugin entries detected:
${formattedPlugins}

Multiple ${PLUGIN_NAME} instances can inject internal prompts into the same live OpenCode session.
   That can create overlapping assistant turns and corrupt session state.

   ${PLUGIN_NAME} startup has been disabled for this plugin instance.

   Keep exactly one OMO plugin entry in your OpenCode config. Check both:
   1. ~/.config/opencode/opencode.json
   2. Any active OPENCODE_CONFIG_DIR profile, such as ~/.config/opencode/profiles/<name>/opencode.json`;
}

// ../../../../omo-engine/omo-opencode/src/shared/legacy-plugin-warning.ts
import { existsSync as existsSync15, readFileSync as readFileSync9 } from "node:fs";
import { join as join13 } from "node:path";

// ../../../../omo-engine/omo-opencode/src/shared/plugin-entry-shape.ts
function isPluginTupleEntry(entry) {
  return Array.isArray(entry) && typeof entry[0] === "string";
}
function getPluginEntryName(entry) {
  return isPluginTupleEntry(entry) ? entry[0] : entry;
}
function withPluginEntryName(entry, name) {
  return isPluginTupleEntry(entry) ? [name, entry[1]] : name;
}

// ../../../../omo-engine/omo-opencode/src/shared/legacy-plugin-warning.ts
function getOpenCodeConfigPath(overrideConfigDir) {
  if (overrideConfigDir) {
    const jsonPath = join13(overrideConfigDir, "opencode.json");
    const jsoncPath = join13(overrideConfigDir, "opencode.jsonc");
    if (existsSync15(jsoncPath))
      return jsoncPath;
    if (existsSync15(jsonPath))
      return jsonPath;
    return null;
  }
  const { configJsonc, configJson } = getOpenCodeConfigPaths({ binary: "opencode", version: null });
  if (existsSync15(configJsonc))
    return configJsonc;
  if (existsSync15(configJson))
    return configJson;
  return null;
}
function isLegacyPluginEntry(entry) {
  const name = getPluginEntryName(entry);
  return name === LEGACY_PLUGIN_NAME || name.startsWith(`${LEGACY_PLUGIN_NAME}@`);
}
function isCanonicalPluginEntry(entry) {
  const name = getPluginEntryName(entry);
  return name === PLUGIN_NAME || name.startsWith(`${PLUGIN_NAME}@`);
}
function checkForLegacyPluginEntry(overrideConfigDir) {
  const configPath = getOpenCodeConfigPath(overrideConfigDir);
  if (!configPath) {
    return { hasLegacyEntry: false, hasCanonicalEntry: false, legacyEntries: [], configPath: null };
  }
  try {
    const content = readFileSync9(configPath, "utf-8");
    const parseResult = parseJsoncSafe2(content);
    if (!parseResult.data) {
      return { hasLegacyEntry: false, hasCanonicalEntry: false, legacyEntries: [], configPath };
    }
    const legacyEntries = (parseResult.data.plugin ?? []).filter(isLegacyPluginEntry);
    const hasCanonicalEntry = (parseResult.data.plugin ?? []).some(isCanonicalPluginEntry);
    return {
      hasLegacyEntry: legacyEntries.length > 0,
      hasCanonicalEntry,
      legacyEntries,
      configPath
    };
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error;
    }
    return { hasLegacyEntry: false, hasCanonicalEntry: false, legacyEntries: [], configPath: null };
  }
}

// ../../../../omo-engine/omo-opencode/src/plugin-setup.ts
import { existsSync as existsSync18, readdirSync as readdirSync5 } from "node:fs";
import { join as join15 } from "node:path";

// ../../../../omo-engine/omo-opencode/src/shared/legacy-workspace-migration.ts
import { copyFileSync, existsSync as existsSync16, lstatSync as lstatSync2, mkdirSync as mkdirSync5, readdirSync as readdirSync4 } from "node:fs";
import { dirname as dirname5, join as join14, relative as relative3 } from "node:path";
var LEGACY_WORKSPACE_DIR = ".sisyphus";
var WORKSPACE_DIR = ".omo";
function copyMissingEntries(legacyPath, targetPath, targetRoot, skipped) {
  const legacyStat = lstatSync2(legacyPath);
  if (legacyStat.isSymbolicLink()) {
    skipped.push(join14(WORKSPACE_DIR, relative3(targetRoot, targetPath)));
    return false;
  }
  if (existsSync16(targetPath)) {
    if (legacyStat.isDirectory() && lstatSync2(targetPath).isDirectory()) {
      let copiedChild = false;
      for (const entry of readdirSync4(legacyPath)) {
        copiedChild = copyMissingEntries(join14(legacyPath, entry), join14(targetPath, entry), targetRoot, skipped) || copiedChild;
      }
      return copiedChild;
    }
    skipped.push(join14(WORKSPACE_DIR, relative3(targetRoot, targetPath)));
    return false;
  }
  if (legacyStat.isDirectory()) {
    mkdirSync5(targetPath, { recursive: true });
    let copiedChild = false;
    for (const entry of readdirSync4(legacyPath)) {
      copiedChild = copyMissingEntries(join14(legacyPath, entry), join14(targetPath, entry), targetRoot, skipped) || copiedChild;
    }
    return copiedChild;
  }
  mkdirSync5(dirname5(targetPath), { recursive: true });
  copyFileSync(legacyPath, targetPath);
  return true;
}
function migrateLegacyWorkspaceDirectory(directory) {
  const legacyDirectory = join14(directory, LEGACY_WORKSPACE_DIR);
  if (!existsSync16(legacyDirectory)) {
    return { migrated: false, skipped: [] };
  }
  const targetDirectory = join14(directory, WORKSPACE_DIR);
  const skipped = [];
  try {
    const migrated = copyMissingEntries(legacyDirectory, targetDirectory, targetDirectory, skipped);
    if (migrated || skipped.length > 0) {
      log2("[legacy-workspace-migration] Checked legacy workspace directory", {
        legacyDirectory,
        targetDirectory,
        migrated,
        skipped
      });
    }
    return { migrated, skipped };
  } catch (error) {
    log2("[legacy-workspace-migration] Failed to migrate legacy workspace directory", {
      legacyDirectory,
      targetDirectory,
      error
    });
    return { migrated: false, skipped };
  }
}

// ../../../../omo-engine/omo-opencode/src/shared/migrate-legacy-plugin-entry.ts
import * as fs3 from "node:fs";

// ../../../../omo-engine/omo-opencode/src/shared/plugin-entry-migrator.ts
function isLegacyEntry(entry) {
  const name = getPluginEntryName(entry);
  return name === LEGACY_PLUGIN_NAME || name.startsWith(`${LEGACY_PLUGIN_NAME}@`);
}
function isCanonicalEntry(entry) {
  const name = getPluginEntryName(entry);
  return name === PLUGIN_NAME || name.startsWith(`${PLUGIN_NAME}@`);
}
function toCanonicalEntry(entry) {
  const name = getPluginEntryName(entry);
  if (name === LEGACY_PLUGIN_NAME) {
    return withPluginEntryName(entry, PLUGIN_NAME);
  }
  if (name.startsWith(`${LEGACY_PLUGIN_NAME}@`)) {
    return withPluginEntryName(entry, `${PLUGIN_NAME}${name.slice(LEGACY_PLUGIN_NAME.length)}`);
  }
  return entry;
}

// ../../../../omo-engine/omo-opencode/src/shared/migrate-legacy-plugin-entry.ts
function normalizePluginEntries(entries) {
  const hasCanonical = entries.some(isCanonicalEntry);
  if (hasCanonical) {
    return entries.filter((entry) => !isLegacyEntry(entry));
  }
  return entries.map((entry) => isLegacyEntry(entry) ? toCanonicalEntry(entry) : entry);
}
function updateJsoncPluginArray(content, pluginEntries) {
  const edits = modify(content, ["plugin"], pluginEntries, {
    formattingOptions: {
      insertSpaces: true,
      tabSize: 2,
      eol: `
`
    },
    getInsertionIndex: () => 0
  });
  if (edits.length === 0)
    return null;
  return applyEdits(content, edits);
}
function migrateLegacyPluginEntry(configPath) {
  if (!fs3.existsSync(configPath))
    return false;
  try {
    const content = fs3.readFileSync(configPath, "utf-8");
    if (!content.includes(LEGACY_PLUGIN_NAME))
      return false;
    const parseResult = parseJsoncSafe2(content);
    const pluginEntries = parseResult.data?.plugin;
    if (!pluginEntries || !pluginEntries.some(isLegacyEntry))
      return false;
    const updatedPluginEntries = normalizePluginEntries(pluginEntries);
    const updated = configPath.endsWith(".jsonc") ? updateJsoncPluginArray(content, updatedPluginEntries) : JSON.stringify({ ...parseResult.data, plugin: updatedPluginEntries }, null, 2) + `
`;
    if (!updated || updated === content)
      return false;
    const tempPath = `${configPath}.tmp`;
    fs3.writeFileSync(tempPath, updated, "utf-8");
    const tempFileDescriptor = fs3.openSync(tempPath, "r+");
    try {
      fs3.fsyncSync(tempFileDescriptor);
    } finally {
      fs3.closeSync(tempFileDescriptor);
    }
    fs3.renameSync(tempPath, configPath);
    log2("[migrateLegacyPluginEntry] Auto-migrated opencode.json plugin entry", {
      configPath,
      from: LEGACY_PLUGIN_NAME,
      to: PLUGIN_NAME
    });
    return true;
  } catch (error) {
    log2("[migrateLegacyPluginEntry] Failed to migrate opencode.json", { configPath, error });
    return false;
  }
}

// ../../../../omo-engine/omo-opencode/src/plugin-setup.ts
function isRecord12(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function stringFieldOf(value, field) {
  if (isRecord12(value)) {
    const candidate = value[field];
    if (typeof candidate === "string")
      return candidate;
  }
  return "";
}
function sessionIDOf(event) {
  const direct = event["sessionID"];
  if (typeof direct === "string")
    return direct;
  const session = event["session"];
  if (isRecord12(session) && typeof session["id"] === "string")
    return session["id"];
  return "";
}
function extractRequestedSubagent(args) {
  for (const field of ["subagent_type", "subagentType", "agent", "agentName"]) {
    const value = args[field];
    if (typeof value === "string" && value.trim())
      return value.trim();
  }
  const flat = JSON.stringify(args);
  const hit = /plan-consultant|plan-reviewer/i.exec(flat);
  return hit ? hit[0].toLowerCase() : null;
}
function planArtifactTouched(directory) {
  try {
    if (!directory)
      return false;
    const plansDir = join15(directory, ".omo", "plans");
    if (!existsSync18(plansDir))
      return false;
    return readdirSync5(plansDir).some((entry) => entry.endsWith(".md"));
  } catch {
    return false;
  }
}
function denyWithoutPlanEvidence(sessionID, requested, pluginDirectory) {
  const denial = invocationGateDenial(requested);
  if (!denial)
    return;
  const facts = readGateFacts(sessionID);
  const verdict = evaluatePlanGate({
    userRequestedPlan: facts.userRequestedPlan,
    planArtifactTouched: facts.planArtifactTouched || planArtifactTouched(pluginDirectory),
    executeStarted: facts.executeStarted
  });
  if (!verdict.allowed) {
    throw new Error(denial);
  }
}
function toOmoEvent(event) {
  if (!isRecord12(event) || typeof event["type"] !== "string")
    return;
  const type = event["type"];
  const properties = isRecord12(event["properties"]) ? event["properties"] : event;
  const sessionString = (value) => typeof value === "string" ? value : undefined;
  switch (type) {
    case "session.created": {
      const info = isRecord12(properties["info"]) ? properties["info"] : properties;
      const sessionID = sessionString(info["id"]) ?? sessionString(properties["sessionID"]);
      if (!sessionID)
        return;
      const parentID = sessionString(info["parentID"]) ?? sessionString(properties["parentID"]);
      const title = sessionString(info["title"]) ?? sessionString(properties["title"]);
      return {
        name: "session.created",
        sessionID,
        ...parentID === undefined ? {} : { parentID },
        ...title === undefined ? {} : { title }
      };
    }
    case "session.deleted": {
      const sessionID = sessionString(properties["sessionID"]) ?? (isRecord12(properties["info"]) ? sessionString(properties["info"]["id"]) : undefined);
      if (!sessionID)
        return;
      return { name: "session.deleted", sessionID };
    }
    case "session.status": {
      const sessionID = sessionString(properties["sessionID"]);
      if (!sessionID)
        return;
      const status = properties["status"];
      const label = isRecord12(status) && typeof status["type"] === "string" ? status["type"] : typeof status === "string" ? status : "unknown";
      return { name: "session.status", sessionID, status: label };
    }
    case "session.idle": {
      const sessionID = sessionString(properties["sessionID"]);
      if (!sessionID)
        return;
      return { name: "session.idle", sessionID };
    }
    case "session.error": {
      const sessionID = sessionString(properties["sessionID"]);
      if (!sessionID)
        return;
      const data = properties["error"];
      const message = isRecord12(data) ? stringFieldOf(data["data"] ?? data, "message") : "";
      return {
        name: "session.error",
        sessionID,
        ...message === "" || message === "unknown" ? {} : { message }
      };
    }
    default:
      return;
  }
}
function toJsonSchemaInput(schema) {
  const properties = {};
  for (const [name, field] of Object.entries(schema.properties)) {
    properties[name] = {
      type: field.type,
      ...field.description === undefined ? {} : { description: field.description },
      ...field.allowedValues === undefined ? {} : { enum: [...field.allowedValues] }
    };
  }
  return {
    type: "object",
    properties,
    ...schema.required === undefined ? {} : { required: [...schema.required] },
    additionalProperties: false
  };
}
async function fanOutTiers(hooks, input, sink) {
  const output = sink === undefined ? {} : { note: (text) => sink.push(text) };
  for (const registry of [hooks.coreHooks, hooks.continuationHooks, hooks.skillHooks]) {
    for (const handler of Object.values(registry)) {
      if (typeof handler !== "function")
        continue;
      try {
        await handler(input, output);
      } catch {}
    }
  }
}
function toJsonObject(value) {
  return isRecord12(value) ? value : {};
}
function textOf(value) {
  return typeof value === "string" ? value : "";
}
function migrateLegacyWorkspaceLocal(directory) {
  try {
    migrateLegacyWorkspaceDirectory(directory);
  } catch {}
  try {
    const check = checkForLegacyPluginEntry();
    if (check.hasLegacyEntry && check.configPath) {
      migrateLegacyPluginEntry(check.configPath);
    }
  } catch {}
}
function createPluginSetup() {
  return async (ctx) => {
    const directory = ctx.location.directory;
    const worktree = directory;
    log2(`[${PLUGIN_NAME}] plugin loading (v2 setup)`, { directory });
    migrateLegacyWorkspaceLocal(directory);
    const validation = validatePluginConfig(directory);
    if (!validation.valid) {
      log2(`[${PLUGIN_NAME}] config diagnostics`, { messages: validation.messages });
    }
    const duplicates = detectDuplicateOmoPlugin(directory);
    if (duplicates.detected) {
      log2(getDuplicateOmoPluginWarning(duplicates.duplicatePlugins), {
        duplicates: duplicates.duplicatePlugins
      });
      return async () => {};
    }
    const pluginConfig = loadPluginConfig(directory, { directory });
    const managers = createManagers({ directory, pluginConfig });
    const createdTools = await createTools({ directory, pluginConfig }, pluginConfig, managers);
    const disabled = new Set(pluginConfig.disabled_hooks ?? []);
    const hooks = createHooks({ directory, pluginConfig }, {
      isHookEnabled: (name) => !disabled.has(name),
      safeHookEnabled: pluginConfig.experimental?.safe_hook_creation ?? true
    }, { mergedSkills: createdTools.mergedSkills, availableSkills: createdTools.availableSkills }, managers);
    const iface = createPluginInterface({ directory, pluginConfig }, pluginConfig, managers, hooks, createdTools);
    const disposePlugin = createPluginDispose({
      managers: {
        backgroundManager: managers.backgroundManager,
        skillMcpManager: managers.skillMcpManager
      },
      hooks: { disposeHooks: hooks.disposeHooks }
    });
    const hostConfig = { agent: {} };
    const pluginComponents = await loadPluginComponents({ directory, pluginConfig });
    const promptSkills = createdTools.mergedSkills;
    applyCommandConfig({ hostConfig, pluginConfig, pluginComponents, skills: promptSkills });
    applyMcpConfig({ hostConfig, pluginConfig });
    applyProviderConfig({ hostConfig, pluginConfig });
    if (iface.tool) {
      const toolEntries = Object.entries(iface.tool);
      if (toolEntries.length > 0) {
        await ctx.tool.transform((editor) => {
          for (const [name, entry] of toolEntries) {
            const tool = entry;
            editor.add({
              name,
              description: tool.description,
              input: toJsonSchemaInput(tool.args),
              execute: async (rawArgs, toolContext) => {
                const outcome = await tool.execute(toJsonObject(rawArgs), {
                  sessionID: textOf(toolContext["sessionID"]) || "unknown",
                  messageID: textOf(toolContext["messageID"]),
                  agent: textOf(toolContext["agent"]),
                  directory,
                  worktree,
                  aborted: () => {
                    const signal = toolContext["signal"];
                    return typeof AbortSignal !== "undefined" && signal instanceof AbortSignal && signal.aborted;
                  }
                });
                if (typeof outcome === "string")
                  return { content: outcome };
                return {
                  content: outcome.output,
                  ...outcome.title === undefined ? {} : { title: outcome.title },
                  ...outcome.note === undefined ? {} : { metadata: { note: outcome.note } },
                  ...outcome.attachments === undefined ? {} : {
                    attachments: outcome.attachments.map((attachment) => ({
                      type: "file",
                      mime: attachment.mime,
                      url: attachment.url,
                      ...attachment.filename === undefined ? {} : { filename: attachment.filename }
                    }))
                  }
                };
              }
            });
          }
        });
      }
    }
    if (promptSkills.length > 0) {
      await ctx.skill.transform((editor) => {
        for (const skill of promptSkills) {
          editor.add({
            id: skill.name,
            name: skill.name,
            ...skill.definition.description ? { description: skill.definition.description } : {},
            ...skill.path ? { path: skill.path } : {},
            ...skill.definition.template ? { content: skill.definition.template } : {}
          });
        }
      });
    }
    const commandEntries = Object.entries(hostConfig.command ?? {});
    if (commandEntries.length > 0) {
      await ctx.command.transform((editor) => {
        for (const [name, command] of commandEntries) {
          const template = typeof command.template === "string" ? command.template : "";
          const description = typeof command.description === "string" ? command.description : undefined;
          editor.add({
            name,
            ...description ? { description } : {},
            execute: async (invocation) => {
              if (typeof ctx.session.prompt === "function") {
                await ctx.session.prompt({
                  sessionID: textOf(invocation["sessionID"]),
                  text: template,
                  delivery: invocation["delivery"] ?? "steer"
                });
              }
            }
          });
        }
      });
    }
    const disabledMcps = pluginConfig.disabled_mcps ?? [];
    if (disabledMcps.length > 0) {
      await ctx.mcp.transform((editor) => {
        for (const name of disabledMcps) {
          try {
            editor.remove(name);
          } catch {}
        }
      });
    }
    await ctx.session.hook("prompt", async (event) => {
      const prompt = isRecord12(event["prompt"]) ? event["prompt"] : {};
      const text = textOf(prompt["text"]);
      const sessionID = sessionIDOf(event);
      if (sessionID && isExplicitPlanRequest(text)) {
        noteUserPlanRequest(sessionID, text);
      }
      const parts = [];
      await iface["chat.message"]?.({
        sessionID,
        ...typeof event["agent"] === "string" ? { agent: event["agent"] } : {}
      }, { message: { text }, parts });
      if (parts.length > 0 && typeof prompt["text"] === "string") {
        prompt["text"] = `${prompt["text"]}
${parts.map((part) => part.text).join(`
`)}`;
      }
      await fanOutTiers(hooks, { sessionID, text });
    });
    await ctx.session.hook("context", async (event) => {
      const sessionID = sessionIDOf(event);
      const model = isRecord12(event["model"]) ? {
        providerID: textOf(event["model"]["providerID"]) || "unknown",
        modelID: textOf(event["model"]["id"] ?? event["model"]["modelID"]) || "unknown"
      } : { providerID: "unknown", modelID: "unknown" };
      const paramsOutput = {};
      await iface["chat.params"]?.({ sessionID, agent: textOf(event["agent"]) || "unknown", model }, paramsOutput);
      const options = isRecord12(event["options"]) ? event["options"] : {};
      if (paramsOutput.temperature !== undefined)
        options["temperature"] = paramsOutput.temperature;
      if (paramsOutput.topP !== undefined)
        options["topP"] = paramsOutput.topP;
      if (paramsOutput.topK !== undefined)
        options["topK"] = paramsOutput.topK;
      if (paramsOutput.maxOutputTokens !== undefined) {
        options["maxTokens"] = paramsOutput.maxOutputTokens;
      }
      if (paramsOutput.providerOptions !== undefined) {
        Object.assign(options, paramsOutput.providerOptions);
      }
      event["options"] = options;
      const systemOutput = { system: [] };
      await iface["experimental.chat.system.transform"]?.({ sessionID, model }, systemOutput);
      const systemLines = systemOutput.system;
      if (systemLines.length > 0) {
        const system = Array.isArray(event["system"]) ? event["system"] : [];
        for (const line of systemLines)
          system.push({ type: "text", text: line });
        event["system"] = system;
      }
    });
    await ctx.session.hook("model.request", async (event) => {
      const sessionID = sessionIDOf(event);
      const model = isRecord12(event["model"]) ? {
        providerID: textOf(event["model"]["providerID"]) || "unknown",
        modelID: textOf(event["model"]["id"] ?? event["model"]["modelID"]) || "unknown"
      } : { providerID: "unknown", modelID: "unknown" };
      const headers = isRecord12(event["headers"]) ? { ...event["headers"] } : {};
      await iface["chat.headers"]?.({
        sessionID,
        agent: textOf(event["agent"]) || "unknown",
        model,
        providerID: model.providerID
      }, { headers });
      event["headers"] = headers;
    });
    await ctx.session.hook("compaction", async (event) => {
      const sessionID = sessionIDOf(event);
      if (!sessionID)
        return;
      const facts = readGateFacts(sessionID);
      const line = `[${PLUGIN_NAME}] compacting session ${sessionID}: ` + `planRequested=${facts.userRequestedPlan} ` + `planArtifact=${facts.planArtifactTouched} ` + `executed=${facts.executeStarted}`;
      const messages = Array.isArray(event["messages"]) ? event["messages"] : [];
      messages.push({
        id: `${PLUGIN_NAME}-gate-facts`,
        role: "system",
        parts: [{ type: "text", text: line }]
      });
      event["messages"] = messages;
    });
    await ctx.tool.hook("execute.before", async (event) => {
      const toolName = textOf(event["tool"] ?? event["toolName"]);
      const sessionID = sessionIDOf(event) || textOf(event["sessionID"]);
      if (/^(task|call_omo_agent|delegate)/i.test(toolName)) {
        const requested = extractRequestedSubagent(toJsonObject(event["input"] ?? event["args"]));
        if (requested)
          denyWithoutPlanEvidence(sessionID, requested, directory);
      }
      if (/^(write|edit|bash|apply|patch|run|execute|task|call_omo_agent)/i.test(toolName)) {
        noteExecutionStart(sessionID);
      }
      const args = toJsonObject(event["input"] ?? event["args"]);
      const output = { args };
      await iface["tool.execute.before"]?.({ tool: toolName, sessionID, callID: textOf(event["callID"] ?? event["id"]) }, output);
      if (isRecord12(event["input"]))
        event["input"] = output.args;
      if (isRecord12(event["args"]))
        event["args"] = output.args;
      await fanOutTiers(hooks, { sessionID, toolName });
    });
    await ctx.tool.hook("execute.after", async (event) => {
      const toolName = textOf(event["tool"] ?? event["toolName"]);
      const sessionID = sessionIDOf(event) || textOf(event["sessionID"]);
      const rawOutput = event["output"];
      const outputText = typeof rawOutput === "string" ? rawOutput : isRecord12(rawOutput) ? textOf(rawOutput["output"] ?? rawOutput["content"]) : "";
      if (/(?:\.omo\/plans|plans\/[^"'`\s]*\.md)/i.test(outputText)) {
        notePlanArtifact(sessionID);
      }
      const notes = [];
      const afterOutput = {
        title: isRecord12(rawOutput) ? textOf(rawOutput["title"]) : "",
        output: outputText,
        truncated: false
      };
      await iface["tool.execute.after"]?.({
        tool: toolName,
        sessionID,
        callID: textOf(event["callID"] ?? event["id"]),
        args: toJsonObject(event["input"] ?? event["args"])
      }, afterOutput);
      if (isRecord12(rawOutput)) {
        rawOutput["output"] = afterOutput.output;
        if (afterOutput.title)
          rawOutput["title"] = afterOutput.title;
      }
      await fanOutTiers(hooks, { sessionID, toolName, text: outputText }, notes);
      if (notes.length > 0 && isRecord12(rawOutput)) {
        const existing = textOf(rawOutput["note"]);
        rawOutput["note"] = existing ? `${existing}
${notes.join(`
`)}` : notes.join(`
`);
      }
    });
    const controller = new AbortController;
    (async () => {
      try {
        for await (const raw of ctx.event.subscribe({ signal: controller.signal })) {
          if (controller.signal.aborted)
            break;
          const normalized = toOmoEvent(raw);
          if (normalized) {
            try {
              await iface.event?.({ event: normalized });
            } catch {}
          }
        }
      } catch {}
    })();
    return async () => {
      controller.abort();
      await disposePlugin();
    };
  };
}

// ../../../../omo-engine/omo-opencode/src/omo-native-entry.ts
var setup = createPluginSetup();
var omo_native_entry_default = {
  id: "omo-native",
  setup
};
export {
  omo_native_entry_default as default
};

// Decoders for values that cross an external boundary: config JSON, engine
// stdout, and model answers. Each decoder answers the domain value or null, so
// callers branch on parsed data instead of re-testing a representation.

/** Only a string primitive stringifies to itself. */
export function asString(value) {
  return String(value) === value ? value : null
}

export function asNonBlankString(value) {
  const text = asString(value)
  return text !== null && text.trim().length > 0 ? text : null
}

export function asBoolean(value) {
  return value === true || value === false ? value : null
}

export function asFunction(value) {
  return value instanceof Function ? value : null
}

/** A non-null object value, arrays included; functions are not object values. */
export function asObjectValue(value) {
  return Object(value) === value && !(value instanceof Function) ? value : null
}

/** A JSON record: a non-null object that is not an array. */
export function asRecord(value) {
  const object = asObjectValue(value)
  return object !== null && !Array.isArray(object) ? object : null
}

export function asStringArray(value) {
  if (!Array.isArray(value)) return null
  const texts = []
  for (const entry of value) {
    const text = asString(entry)
    if (text === null) return null
    texts.push(text)
  }
  return texts
}

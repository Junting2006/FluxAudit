export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertWellFormedUnicode(value: string, field: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new TypeError(`${field} contains an unpaired high surrogate`);
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      throw new TypeError(`${field} contains an unpaired low surrogate`);
    }
  }
}

function compareLikePython(left: string, right: string): number {
  const leftPoints = Array.from(left, (character) => character.codePointAt(0)!);
  const rightPoints = Array.from(right, (character) => character.codePointAt(0)!);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    if (leftPoints[index] !== rightPoints[index]) {
      return leftPoints[index] - rightPoints[index];
    }
  }
  return leftPoints.length - rightPoints.length;
}

function serializeCanonical(value: unknown, path: string, ancestors: WeakSet<object>): string {
  if (value === null) return "null";

  if (typeof value === "boolean") return value ? "true" : "false";

  if (typeof value === "string") {
    assertWellFormedUnicode(value, path);
    return JSON.stringify(value);
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${path} must be a finite number`);
    }
    if (Math.abs(value) > Number.MAX_SAFE_INTEGER) {
      throw new TypeError(`${path} must be a safe integer`);
    }
    if (Number.isInteger(value)) return Object.is(value, -0) ? "0" : String(value);
    // Python repr switches to exponent notation below 1e-4 and pads the exponent.
    // Both runtimes use shortest round-tripping IEEE-754 decimal representations.
    if (Math.abs(value) < 1e-4) {
      const [mantissa, exponent] = value.toExponential().split("e");
      const power = Number(exponent);
      return `${mantissa}e${power < 0 ? "-" : "+"}${String(Math.abs(power)).padStart(2, "0")}`;
    }
    return String(value);
  }

  if (typeof value === "undefined") {
    throw new TypeError(`${path} cannot be undefined`);
  }
  if (typeof value === "bigint" || typeof value === "function" || typeof value === "symbol") {
    throw new TypeError(`${path} has unsupported type ${typeof value}`);
  }

  const objectValue = value as object;
  if (ancestors.has(objectValue)) {
    throw new TypeError(`${path} contains a circular reference`);
  }
  ancestors.add(objectValue);

  try {
    if (Array.isArray(value)) {
      const entries: string[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!(index in value)) {
          throw new TypeError(`${path}[${index}] cannot be an array hole`);
        }
        entries.push(serializeCanonical(value[index], `${path}[${index}]`, ancestors));
      }
      return `[${entries.join(",")}]`;
    }

    if (!isPlainObject(value)) {
      throw new TypeError(`${path} must contain only plain JSON objects`);
    }

    const keys = Object.keys(value).sort(compareLikePython);
    const entries = keys.map((key) => {
      assertWellFormedUnicode(key, `${path} key`);
      const serializedKey = JSON.stringify(key);
      const serializedValue = serializeCanonical(value[key], `${path}.${key}`, ancestors);
      return `${serializedKey}:${serializedValue}`;
    });
    return `{${entries.join(",")}}`;
  } finally {
    ancestors.delete(objectValue);
  }
}

/** Matches member4's supported Python json.dumps subset. */
export function canonicalJson(value: unknown): string {
  return serializeCanonical(value, "$", new WeakSet<object>());
}

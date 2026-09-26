// Minimal JSON-schema validator for the fixed output schemas (type, enum, anyOf, properties, required,
// additionalProperties, items). Returns { ok, errors: [ 'path: message' ] }.
export function validate(value, schema, path = '$', errors = []) {
  if (schema.anyOf) {
    const attempts = schema.anyOf.map((s) => validate(value, s, path, []));
    if (!attempts.some((a) => a.ok)) errors.push(`${path}: matches none of anyOf (${attempts.map((a) => a.errors[0]).join(' | ')})`);
    return { ok: errors.length === 0, errors };
  }
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path}: expected one of ${schema.enum.join(', ')}`);
    return { ok: false, errors };
  }
  const t = schema.type;
  if (t === 'null') {
    if (value !== null) errors.push(`${path}: expected null`);
  } else if (t === 'string') {
    if (typeof value !== 'string') errors.push(`${path}: expected string`);
  } else if (t === 'number') {
    if (typeof value !== 'number' || Number.isNaN(value)) errors.push(`${path}: expected number`);
  } else if (t === 'integer') {
    if (!Number.isInteger(value)) errors.push(`${path}: expected integer`);
  } else if (t === 'boolean') {
    if (typeof value !== 'boolean') errors.push(`${path}: expected boolean`);
  } else if (t === 'array') {
    if (!Array.isArray(value)) errors.push(`${path}: expected array`);
    else if (schema.items) value.forEach((v, i) => validate(v, schema.items, `${path}[${i}]`, errors));
  } else if (t === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      errors.push(`${path}: expected object`);
    } else {
      for (const k of schema.required || []) if (!(k in value)) errors.push(`${path}.${k}: missing`);
      for (const [k, v] of Object.entries(value)) {
        const sub = schema.properties && schema.properties[k];
        if (!sub) {
          if (schema.additionalProperties === false) errors.push(`${path}.${k}: unexpected property`);
          continue;
        }
        validate(v, sub, `${path}.${k}`, errors);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

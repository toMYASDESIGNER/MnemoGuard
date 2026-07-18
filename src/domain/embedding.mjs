const DIMENSIONS = 64;

function hashToken(token) {
  let hash = 2166136261;
  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function embedLocally(text, dimensions = DIMENSIONS) {
  const vector = Array.from({ length: dimensions }, () => 0);
  const tokens = String(text)
    .toLowerCase()
    .match(/[a-z0-9_.-]+/g) ?? [];

  for (const token of tokens) {
    const hash = hashToken(token);
    const bucket = hash % dimensions;
    const sign = (hash & 1) === 0 ? 1 : -1;
    vector[bucket] += sign * (1 + Math.log1p(token.length));
  }

  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return magnitude === 0 ? vector : vector.map((value) => value / magnitude);
}

export function cosineSimilarity(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
    return 0;
  }
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
}

export function vectorLiteral(vector) {
  return `[${vector.map((value) => Number(value).toFixed(8)).join(",")}]`;
}

export const EMBEDDING_DIMENSIONS = DIMENSIONS;

const CATEGORIES = new Set(["profile", "preference", "ongoing", "shared_event"]);

function cleanText(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 240);
}

function fingerprint(value) {
  return cleanText(value)
    .toLocaleLowerCase("ko-KR")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function similarFingerprint(left, right) {
  if (left === right) return true;
  if (left.length >= 10 && right.length >= 10 && (left.includes(right) || right.includes(left))) {
    return true;
  }
  const bigrams = (value) => {
    const result = new Set();
    for (let index = 0; index < value.length - 1; index += 1) {
      result.add(value.slice(index, index + 2));
    }
    return result;
  };
  const leftBigrams = bigrams(left);
  const rightBigrams = bigrams(right);
  const overlap = [...leftBigrams].filter((item) => rightBigrams.has(item)).length;
  return overlap / Math.max(1, Math.min(leftBigrams.size, rightBigrams.size)) >= 0.7;
}

function normalizeMemory(raw, idFactory, now = Date.now()) {
  if (typeof raw === "string") {
    const text = cleanText(raw);
    if (!text) return null;
    return {
      id: idFactory(),
      category: "profile",
      text,
      sourceMessageId: null,
      pinned: false,
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString()
    };
  }

  const text = cleanText(raw?.text);
  if (!text) return null;
  return {
    id: raw.id || idFactory(),
    category: CATEGORIES.has(raw.category) ? raw.category : "profile",
    text,
    sourceMessageId: raw.sourceMessageId || null,
    pinned: Boolean(raw.pinned),
    createdAt: raw.createdAt || new Date(now).toISOString(),
    updatedAt: raw.updatedAt || raw.createdAt || new Date(now).toISOString()
  };
}

function migrateMemories(memories, idFactory, now = Date.now()) {
  if (!Array.isArray(memories)) return [];
  return memories
    .map((memory) => normalizeMemory(memory, idFactory, now))
    .filter(Boolean)
    .slice(-80);
}

function mergeExplicitMemories(
  existing,
  candidates,
  validSourceIds,
  idFactory,
  now = Date.now()
) {
  const memories = migrateMemories(existing, idFactory, now);
  for (const candidate of candidates || []) {
    if (
      !candidate ||
      candidate.explicit === false ||
      !validSourceIds.has(candidate.sourceMessageId)
    ) {
      continue;
    }
    const normalized = normalizeMemory(candidate, idFactory, now);
    if (!normalized) continue;

    const nextFingerprint = fingerprint(normalized.text);
    const duplicate = memories.find((memory) => {
      const current = fingerprint(memory.text);
      return similarFingerprint(current, nextFingerprint);
    });
    if (duplicate) {
      duplicate.text = normalized.text.length >= duplicate.text.length
        ? normalized.text
        : duplicate.text;
      duplicate.category = normalized.category;
      duplicate.sourceMessageId = normalized.sourceMessageId;
      duplicate.updatedAt = new Date(now).toISOString();
      continue;
    }
    memories.push(normalized);
  }

  const pinned = memories.filter((memory) => memory.pinned);
  const regular = memories.filter((memory) => !memory.pinned).slice(-60);
  return [...pinned, ...regular].slice(-80);
}

module.exports = {
  CATEGORIES,
  fingerprint,
  mergeExplicitMemories,
  migrateMemories,
  normalizeMemory
};

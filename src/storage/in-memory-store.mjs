import { createHash, randomUUID } from "node:crypto";

function hashEvent(previousHash, event) {
  return createHash("sha256")
    .update(previousHash)
    .update(JSON.stringify(event))
    .digest("hex");
}

export class InMemoryMemoryStore {
  constructor() {
    this.memories = [];
    this.events = [];
  }

  async reset() {
    this.memories = [];
    this.events = [];
  }

  async addMemory(record) {
    const memory = {
      id: record.id ?? randomUUID(),
      createdAt: record.createdAt ?? new Date().toISOString(),
      ...record
    };
    this.memories.unshift(memory);
    return memory;
  }

  async updateState(id, state, metadata = {}) {
    const memory = this.memories.find((item) => item.id === id);
    if (!memory) return null;
    memory.state = state;
    Object.assign(memory, metadata);
    return memory;
  }

  async trustedForSubject(subject) {
    return this.memories.filter((item) => item.subject === subject && item.state === "trusted");
  }

  async getMemory(id) {
    return this.memories.find((item) => item.id === id) ?? null;
  }

  async listMemories() {
    return structuredClone(this.memories);
  }

  async appendEvent(type, payload) {
    const previousHash = this.events[0]?.hash ?? "GENESIS";
    const body = {
      id: randomUUID(),
      type,
      payload,
      createdAt: new Date().toISOString(),
      previousHash
    };
    const event = { ...body, hash: hashEvent(previousHash, body) };
    this.events.unshift(event);
    return event;
  }

  async listEvents() {
    return structuredClone(this.events);
  }
}

(function exposeSequentialAudioQueue(globalObject) {
  class SequentialAudioQueue {
    constructor(worker) {
      this.worker = worker;
      this.pending = [];
      this.queuedKeys = new Set();
      this.running = false;
    }

    enqueue(key) {
      if (!key || this.queuedKeys.has(key)) return;
      this.queuedKeys.add(key);
      this.pending.push(key);
      void this.drain();
    }

    clear() {
      for (const key of this.pending) this.queuedKeys.delete(key);
      this.pending = [];
    }

    async drain() {
      if (this.running) return;
      this.running = true;
      try {
        while (this.pending.length) {
          const key = this.pending.shift();
          try {
            await this.worker(key);
          } finally {
            this.queuedKeys.delete(key);
          }
        }
      } finally {
        this.running = false;
        if (this.pending.length) void this.drain();
      }
    }
  }

  if (typeof module !== "undefined" && module.exports) module.exports = { SequentialAudioQueue };
  if (globalObject) globalObject.SequentialAudioQueue = SequentialAudioQueue;
})(typeof window !== "undefined" ? window : globalThis);

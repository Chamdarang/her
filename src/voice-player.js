(function exposeNormalizedVoicePlayer(globalObject) {
  function normalizationGain(channelData, options = {}) {
    const targetRms = options.targetRms ?? 0.12;
    const peakCeiling = options.peakCeiling ?? 0.92;
    const minimumGain = options.minimumGain ?? 0.35;
    const maximumGain = options.maximumGain ?? 4;
    const noiseFloor = options.noiseFloor ?? 0.008;
    let energy = 0;
    let activeSamples = 0;
    let peak = 0;

    for (const channel of channelData) {
      for (let index = 0; index < channel.length; index += 1) {
        const amplitude = Math.abs(channel[index]);
        peak = Math.max(peak, amplitude);
        if (amplitude >= noiseFloor) {
          energy += amplitude * amplitude;
          activeSamples += 1;
        }
      }
    }
    if (!activeSamples || !peak) return 1;
    const rms = Math.sqrt(energy / activeSamples);
    const desired = Math.min(targetRms / rms, peakCeiling / peak);
    return Math.max(minimumGain, Math.min(maximumGain, desired));
  }

  function decodeBase64(base64) {
    const binary = globalObject.atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes.buffer;
  }

  class NormalizedVoicePlayer {
    constructor(options = {}) {
      this.options = options;
      this.context = null;
      this.current = null;
      this.generation = 0;
    }

    get playing() {
      return Boolean(this.current);
    }

    ensureContext() {
      if (!this.context) {
        const AudioContextClass = globalObject.AudioContext || globalObject.webkitAudioContext;
        this.context = new AudioContextClass();
      }
      return this.context;
    }

    async play({ base64 }) {
      this.stop();
      const generation = this.generation;
      const context = this.ensureContext();
      if (context.state === "suspended") await context.resume();
      const buffer = await context.decodeAudioData(decodeBase64(base64));
      if (generation !== this.generation) return;
      const channels = Array.from(
        { length: buffer.numberOfChannels },
        (_, index) => buffer.getChannelData(index)
      );
      const gainValue = normalizationGain(channels, this.options);
      const source = context.createBufferSource();
      const gain = context.createGain();
      const limiter = context.createDynamicsCompressor();
      const fadeInSeconds = Math.max(0, Number(this.options.fadeInSeconds ?? 0.18));
      gain.gain.setValueAtTime(fadeInSeconds ? 0 : gainValue, context.currentTime);
      if (fadeInSeconds) {
        gain.gain.linearRampToValueAtTime(gainValue, context.currentTime + fadeInSeconds);
      }
      limiter.threshold.value = -2;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.12;
      source.buffer = buffer;
      source.connect(gain).connect(limiter).connect(context.destination);

      return new Promise((resolve) => {
        let finished = false;
        const finish = () => {
          if (finished) return;
          finished = true;
          if (this.current?.source === source) this.current = null;
          source.disconnect();
          gain.disconnect();
          limiter.disconnect();
          resolve();
        };
        this.current = { source, finish };
        source.onended = finish;
        source.start();
      });
    }

    stop() {
      this.generation += 1;
      const current = this.current;
      if (!current) return;
      this.current = null;
      try {
        current.source.stop();
      } catch {}
      current.finish();
    }
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { NormalizedVoicePlayer, normalizationGain };
  }
  if (globalObject) globalObject.NormalizedVoicePlayer = NormalizedVoicePlayer;
})(typeof window !== "undefined" ? window : globalThis);

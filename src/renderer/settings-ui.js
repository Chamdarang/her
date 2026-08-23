(function exposeSettingsUi(root, factory) {
  const data = typeof module === "object" && module.exports
    ? require("./settings-data")
    : root.HerSettingsData;
  const api = factory(data);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.HerSettingsUi = api;
})(typeof globalThis !== "undefined" ? globalThis : this, ({ FRIEND_PRESETS, TRAIT_LEVELS }) => {
  const FRIEND_SETTING_KEYS = [
    "name",
    "gender",
    "age",
    "character",
    "playfulness",
    "warmth",
    "bluntness",
    "initiative",
    "replyPace",
    "speechStyle",
    "romanceAllowed",
    "proactiveEnabled",
    "voiceEnabled",
    "voiceAutoPlay",
    "voiceRevealAfterSynthesis",
    "ambientVoiceEnabled",
    "ambientVoiceFrequency",
    "ambientContinueUnanswered",
    "ambientMaxConsecutive",
    "ambientSaveTranscript",
    "voiceLanguage",
    "voiceModelId",
    "voiceSpeakerId",
    "voiceStyle",
    "voiceStyleWeight",
    "voiceLength"
  ];

  function matchingPreset(settings) {
    return Object.entries(FRIEND_PRESETS).find(([, preset]) =>
      Object.entries(preset).every(([key, value]) => settings[key] === value)
    )?.[0];
  }

  function createSettingsUi({ friendForm, groupForm, query, rootDocument = document }) {
    function setDiscreteValue(name, value, preserveRaw = false) {
      const input = friendForm.elements[name];
      const levels = TRAIT_LEVELS[name];
      if (!input || !levels) return;
      const parsed = Number(value);
      const number = Number.isFinite(parsed) ? parsed : 50;
      const level = levels.reduce((nearest, candidate) =>
        !nearest || Math.abs(candidate.value - number) < Math.abs(nearest.value - number)
          ? candidate
          : nearest
      , null);
      input.value = String(level.value);
      if (preserveRaw) {
        input.dataset.rawValue = String(number);
        input.dataset.initialDiscreteValue = String(level.value);
      } else {
        delete input.dataset.rawValue;
        delete input.dataset.initialDiscreteValue;
      }
    }

    function readDiscreteValue(name) {
      const input = friendForm.elements[name];
      if (
        input.dataset.rawValue !== undefined &&
        input.value === input.dataset.initialDiscreteValue
      ) {
        return Number(input.dataset.rawValue);
      }
      return Number(input.value);
    }

    function updateSliderLabels() {
      for (const name of Object.keys(TRAIT_LEVELS)) {
        const value = Number(friendForm.elements[name].value);
        const level = TRAIT_LEVELS[name].find((candidate) => candidate.value === value);
        query(`[data-setting-description="${name}"]`).textContent = level?.instruction || "";
      }
    }

    function markSelectedPreset(key) {
      rootDocument.querySelectorAll("[data-preset]").forEach((button) => {
        button.classList.toggle("selected", button.dataset.preset === key);
      });
    }

    function applyPreset(key) {
      const preset = FRIEND_PRESETS[key];
      if (!preset) return;
      for (const [name, value] of Object.entries(preset)) {
        const input = friendForm.elements[name];
        if (input.type === "checkbox") input.checked = value;
        else if (input.dataset.discreteSetting) setDiscreteValue(name, value);
        else input.value = value;
      }
      markSelectedPreset(key);
      updateSliderLabels();
    }

    function setSettingSummary(selector, enabled, enabledText = "사용") {
      const badge = query(selector);
      badge.textContent = enabled ? enabledText : "사용 안 함";
      badge.classList.toggle("off", !enabled);
    }

    function updateProactiveControls() {
      const enabled = friendForm.elements.proactiveEnabled.checked;
      const options = query("#proactiveOptions");
      options.classList.toggle("is-disabled", !enabled);
      options.setAttribute("aria-disabled", String(!enabled));
      friendForm.elements.initiative.disabled = !enabled;
      setSettingSummary("#proactiveSettingsSummary", enabled);
    }

    function updateVoiceSettingSummary() {
      const enabled = friendForm.elements.voiceEnabled.checked;
      const ambient = friendForm.elements.ambientVoiceEnabled.checked;
      setSettingSummary("#voiceSettingsSummary", enabled, ambient ? "자동 말걸기" : "음성 사용");
    }

    function updateGroupParticipantCount() {
      const count = groupForm.querySelectorAll('input[name="participantIds"]:checked').length;
      const label = query("#groupParticipantCount");
      label.textContent = `${count}명 선택 · 2~6명`;
      label.classList.toggle("valid", count >= 2 && count <= 6);
    }

    function updateGroupAutonomyControls() {
      const enabled = groupForm.elements.autonomousEnabled.checked;
      const options = query("#groupAutonomyOptions");
      options.classList.toggle("is-disabled", !enabled);
      options.setAttribute("aria-disabled", String(!enabled));
      for (const input of options.querySelectorAll("input, select")) input.disabled = !enabled;
      setSettingSummary("#groupAutonomySummary", enabled);
    }

    return {
      applyPreset,
      markSelectedPreset,
      readDiscreteValue,
      setDiscreteValue,
      updateGroupAutonomyControls,
      updateGroupParticipantCount,
      updateProactiveControls,
      updateSliderLabels,
      updateVoiceSettingSummary
    };
  }

  return { createSettingsUi, FRIEND_SETTING_KEYS, matchingPreset };
});

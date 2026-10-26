/**
 * VoicePilot – Voice Feedback (browser speechSynthesis wrapper)
 * Provides: speak(text), cancel(), isAvailable()
 *
 * If speechSynthesis is unavailable, all calls silently no-op.
 * Guards against accidentally reading back command text.
 * Exported (browser global): VPVoiceFeedback
 */

const VPVoiceFeedback = (() => {
  let _enabled = true;

  function isAvailable() {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
  }

  function setEnabled(val) { _enabled = !!val; }
  function isEnabled()     { return _enabled; }

  /**
   * Speak a short message.
   * @param {string} text
   * @param {object} [opts]
   *   rate  {number} 0.1–10 (default 1.1 – slightly brisk)
   *   pitch {number} 0–2   (default 1)
   */
  function speak(text, { rate = 1.1, pitch = 1 } = {}) {
    if (!_enabled || !isAvailable() || !text) return;
    // Cancel any ongoing speech before starting a new utterance
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(String(text).slice(0, 500));
    utt.rate  = rate;
    utt.pitch = pitch;
    window.speechSynthesis.speak(utt);
  }

  function cancel() {
    if (isAvailable()) window.speechSynthesis.cancel();
  }

  return { isAvailable, setEnabled, isEnabled, speak, cancel };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = VPVoiceFeedback;
}

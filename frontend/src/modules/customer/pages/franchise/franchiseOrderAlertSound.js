import orderAlertSound from "@/assets/sounds/order_alert.mp3";

let alertAudio = null;
let unlockBound = false;
let ringtoneRetryTimer = null;
let ringtoneUnlockHandler = null;
let ringtoneActive = false;

function getAlertAudio() {
  if (typeof window === "undefined") return null;
  if (!alertAudio) {
    alertAudio = new Audio(orderAlertSound);
    alertAudio.preload = "auto";
  }
  return alertAudio;
}

/** Prime audio after a user gesture so autoplay policies allow order alerts. */
export function primeFranchiseOrderAlertSound() {
  const audio = getAlertAudio();
  if (!audio || unlockBound) return;
  unlockBound = true;

  const unlock = () => {
    audio.muted = true;
    audio
      .play()
      .then(() => {
        audio.pause();
        audio.currentTime = 0;
        audio.muted = false;
      })
      .catch(() => {
        audio.muted = false;
      });
  };

  document.addEventListener("pointerdown", unlock, { once: true });
  document.addEventListener("keydown", unlock, { once: true });
}

function bindRingtoneUnlockHandlers() {
  if (ringtoneUnlockHandler || typeof window === "undefined") return;

  ringtoneUnlockHandler = () => {
    if (!ringtoneActive) return;
    const audio = getAlertAudio();
    if (!audio || !audio.paused) return;
    audio.play().catch(() => {});
  };

  window.addEventListener("focus", ringtoneUnlockHandler);
  document.addEventListener("visibilitychange", ringtoneUnlockHandler);
  document.addEventListener("pointerdown", ringtoneUnlockHandler);
  document.addEventListener("touchstart", ringtoneUnlockHandler);
  document.addEventListener("keydown", ringtoneUnlockHandler);
}

function unbindRingtoneUnlockHandlers() {
  if (!ringtoneUnlockHandler || typeof window === "undefined") return;
  window.removeEventListener("focus", ringtoneUnlockHandler);
  document.removeEventListener("visibilitychange", ringtoneUnlockHandler);
  document.removeEventListener("pointerdown", ringtoneUnlockHandler);
  document.removeEventListener("touchstart", ringtoneUnlockHandler);
  document.removeEventListener("keydown", ringtoneUnlockHandler);
  ringtoneUnlockHandler = null;
}

/** Looping alert while a franchise order modal is open. */
export function startFranchiseOrderRingtone() {
  const audio = getAlertAudio();
  if (!audio) return;

  ringtoneActive = true;
  audio.loop = true;
  audio.muted = false;
  audio.volume = 1;
  audio.play().catch(() => {});

  if (!ringtoneRetryTimer) {
    ringtoneRetryTimer = setInterval(() => {
      if (!ringtoneActive) return;
      const current = getAlertAudio();
      if (!current || !current.paused) return;
      current.play().catch(() => {});
    }, 1200);
  }

  bindRingtoneUnlockHandlers();
}

export function stopFranchiseOrderRingtone() {
  ringtoneActive = false;
  const audio = getAlertAudio();

  if (ringtoneRetryTimer) {
    clearInterval(ringtoneRetryTimer);
    ringtoneRetryTimer = null;
  }
  unbindRingtoneUnlockHandlers();

  if (!audio) return;
  audio.pause();
  audio.currentTime = 0;
  audio.loop = false;
}

/** Short alert ping (e.g. hub accepted). */
export function playFranchiseOrderAlertSound({ repeat = 2 } = {}) {
  const audio = getAlertAudio();
  if (!audio) return;

  const playOnce = () => {
    const clip = audio.cloneNode();
    clip.loop = false;
    clip.volume = 1;
    clip.play().catch(() => {});
  };

  playOnce();
  if (repeat > 1) {
    setTimeout(playOnce, 900);
  }
}

export default playFranchiseOrderAlertSound;

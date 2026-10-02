// Little preferences the user can change on the home screen. Saved on the phone.

import { SPIKE_MULTIPLE } from "./config.js";
import { loadLocal, saveLocal } from "./util.js";

const DEFAULTS = { spikeMultiple: SPIKE_MULTIPLE, vibrate: true, theme: "night" };

export const getSettings = () => ({ ...DEFAULTS, ...(loadLocal("hr:settings") || {}) });
export const saveSettings = (changes) => saveLocal("hr:settings", { ...getSettings(), ...changes });

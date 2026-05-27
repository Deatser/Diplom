const KEY = 'l2s_saves'
const SKEY = 'l2s_settings'

const DEFAULT_SAVES = Array.from({ length: 4 }, (_, i) => ({
  slot: i, roomId: null, roomName: null, level: 1, playtime: 0
}))

// Detect native monitor resolution (browser-side only)
const _nativeRes = typeof window !== 'undefined'
  ? `${window.screen.width}x${window.screen.height}`
  : '1920x1080'

const DEFAULT_SETTINGS = {
  lang: 'ru',
  audio: { master: 8, music: 7, sfx: 8 },
  video: { resolution: _nativeRes, fullscreen: false, brightness: 5 },
  keybindings: {
    move_left: 'KeyA', move_right: 'KeyD',
    jump: 'Space', dash: 'ShiftLeft',
    down: 'KeyS', special: 'Mouse2',
    menu: 'Backquote',      // tilde / ё — opens pause / goes back
    fullscreen: 'KeyF'      // toggle fullscreen
  }
}

export const SaveSystem = {
  getSaves() {
    try { return JSON.parse(localStorage.getItem(KEY)) || DEFAULT_SAVES }
    catch { return [...DEFAULT_SAVES] }
  },
  setSave(slot, data) {
    const saves = this.getSaves()
    saves[slot] = { ...saves[slot], ...data }
    localStorage.setItem(KEY, JSON.stringify(saves))
  },
  clearSave(slot) {
    const saves = this.getSaves()
    saves[slot] = { slot, roomId: null, roomName: null, level: 1, playtime: 0 }
    localStorage.setItem(KEY, JSON.stringify(saves))
  },
  getSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(SKEY))
      if (!saved) return { ...DEFAULT_SETTINGS }
      // Migrate old '1280x720' default → native monitor resolution
      if (saved.video?.resolution === '1280x720') {
        saved.video.resolution = _nativeRes
        localStorage.setItem(SKEY, JSON.stringify(saved))
      }
      // Merge keybindings with defaults so new keys are picked up after updates
      saved.keybindings = { ...DEFAULT_SETTINGS.keybindings, ...saved.keybindings }
      return saved
    }
    catch { return { ...DEFAULT_SETTINGS } }
  },
  setSettings(s) { localStorage.setItem(SKEY, JSON.stringify(s)) },
  resetSettings() { localStorage.setItem(SKEY, JSON.stringify(DEFAULT_SETTINGS)); return { ...DEFAULT_SETTINGS } },

  // Max unlocked level (persisted across sessions)
  getMaxLevel()  { return parseInt(localStorage.getItem('l2s_maxlevel') || '1') },
  setMaxLevel(n) { localStorage.setItem('l2s_maxlevel', String(Math.max(n, this.getMaxLevel()))) }
}

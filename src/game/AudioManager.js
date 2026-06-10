import { SaveSystem } from '../systems/SaveSystem.js'

// Singleton. Handles volume settings → Phaser sound objects.
// Static/looped sounds register themselves; dynamic sounds (lamp) call getMultiplier() per frame.
const AudioManager = {
  // { key → { sound: PhaserSound, category: 'music'|'sfx', baseVolume: number } }
  _registry: {},

  // Register a looping/static sound so applyAll() can update it when settings change.
  // baseVolume = desired volume at master=10, category=10 (full settings).
  register(key, sound, category, baseVolume = 1) {
    this._registry[key] = { sound, category, baseVolume }
    this._applyOne(key)
  },

  unregister(key) {
    delete this._registry[key]
  },

  // 0–1 multiplier: master × category. Use for dynamic per-frame sounds.
  getMultiplier(category) {
    const a = SaveSystem.getSettings().audio
    return (a.master / 10) * ((a[category] ?? 10) / 10)
  },

  _applyOne(key) {
    const info = this._registry[key]
    if (!info?.sound || info.sound.destroyed) return
    info.sound.setVolume(info.baseVolume * this.getMultiplier(info.category))
  },

  // Call this whenever settings change to push new volumes to all registered sounds.
  applyAll() {
    for (const key of Object.keys(this._registry)) {
      this._applyOne(key)
    }
  },
}

export default AudioManager

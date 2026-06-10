import { SaveSystem } from '../systems/SaveSystem.js'

// Яркость из настроек (1–10, 5 = норма) → CSS filter:brightness на <html>.
// Корневой фильтр накрывает всё сразу: меню, HUD и canvas игры.
export function applyBrightness(v = null) {
  const val = v ?? (SaveSystem.getSettings().video?.brightness ?? 5)
  const factor = 0.5 + val * 0.1 // 1 → 0.6, 5 → 1.0, 10 → 1.5
  document.documentElement.style.filter =
    val === 5 ? '' : `brightness(${factor.toFixed(2)})`
}

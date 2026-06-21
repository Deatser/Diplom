// ── Тонкая обёртка над Yandex Games SDK ──────────────────────────────────────
// Вне Яндекса (локально / на Render) глобального YaGames нет → ysdk остаётся null
// и все функции либо ничего не делают, либо ведут себя как «реклама пройдена»,
// поэтому игра работает везде одинаково и ничего не ломается.

export let ysdk = null

// Инициализация SDK. Вызывать один раз при старте. Безопасно вне Яндекса.
export async function initYandex() {
  if (typeof YaGames === 'undefined') return null // локально / Render
  try {
    ysdk = await YaGames.init()
    console.log('[Yandex] SDK initialized')
    return ysdk
  } catch (e) {
    console.warn('[Yandex] init failed', e)
    return null
  }
}

// Язык платформы Яндекса ('ru'/'en'), если он один из поддерживаемых нами. Иначе null.
// Нужен, чтобы при первом заходе показать игру на языке игрока (требует модерация).
export function getPlatformLang() {
  try {
    const l = ysdk?.environment?.i18n?.lang
    return (l === 'ru' || l === 'en') ? l : null
  } catch { return null }
}

// Сообщить платформе, что игра загрузилась и готова к показу (убирает их спиннер).
// Вызывать ОДИН раз, когда главное меню готово.
export function yandexReady() {
  try { ysdk?.features?.LoadingAPI?.ready() } catch {}
}

// Реклама за вознаграждение (для воскрешения). Гарантированно вызывает onClose.
// onClose получает rewarded=true, если ролик досмотрен (или мы не на Яндексе).
export function showRewardedAd({ onReward, onClose } = {}) {
  if (!ysdk) {            // вне Яндекса — считаем рекламу «просмотренной»
    onReward?.()
    onClose?.(true)
    return
  }
  let rewarded = false
  ysdk.adv.showRewardedVideo({
    callbacks: {
      onRewarded: () => { rewarded = true; onReward?.() },
      onClose:    () => onClose?.(rewarded),
      // Не показалась (нет ролика / ошибка) — не наказываем игрока, воскрешаем.
      onError:    () => { onReward?.(); onClose?.(true) },
    },
  })
}

// Полноэкранная реклама (между уровнями). По правилам Яндекса — не чаще раза
// в ~60с; SDK сам не покажет слишком часто. callbacks опциональны.
export function showFullscreenAd(callbacks = {}) {
  ysdk?.adv?.showFullscreenAdv({ callbacks })
}

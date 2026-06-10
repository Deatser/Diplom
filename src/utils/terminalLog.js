/**
 * Перехватывает console.log и пересылает на сервер, чтобы логи
 * браузера появлялись в терминале VS Code рядом с логами сервера.
 *
 * Логи по-прежнему видны в DevTools (F12 → Console).
 */

const _orig = console.log.bind(console)

// Релей в терминал нужен ТОЛЬКО локально. Проверяем хост в рантайме (а не
// import.meta.env.DEV) — так на задеплоенном домене fetch к localhost НИКОГДА не
// выполнится, и браузер не будет просить разрешение «доступ к локальной сети».
const _isLocalHost =
  typeof location !== 'undefined' &&
  (location.hostname === 'localhost' || location.hostname === '127.0.0.1')

console.log = (...args) => {
  // 1) Оставляем вывод в DevTools
  _orig(...args)

  // 2) Сериализуем аргументы в строки
  const serialized = args.map(a => {
    if (a === null)      return 'null'
    if (a === undefined) return 'undefined'
    if (typeof a === 'object') {
      try { return JSON.stringify(a) } catch { return String(a) }
    }
    return String(a)
  })

  // 3) Шлём на сервер ТОЛЬКО когда реально на localhost (дев). На проде — никогда.
  if (_isLocalHost) {
    fetch('http://localhost:3000/_log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ args: serialized })
    }).catch(() => {})
  }
}

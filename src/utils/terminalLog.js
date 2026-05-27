/**
 * Перехватывает console.log и пересылает на сервер, чтобы логи
 * браузера появлялись в терминале VS Code рядом с логами сервера.
 *
 * Логи по-прежнему видны в DevTools (F12 → Console).
 */

const _orig = console.log.bind(console)

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

  // 3) Шлём на сервер — ошибки игнорируем (сервер мог не запуститься)
  fetch('http://localhost:3000/_log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ args: serialized })
  }).catch(() => {})
}

// Web Worker: тикает setInterval даже когда вкладка скрыта.
// Браузер не может дроссировать setInterval в воркере (в отличие от rAF на главном потоке).
let id = null
self.onmessage = e => {
  if (e.data === 'start') {
    if (id) return
    id = setInterval(() => self.postMessage('tick'), 16) // ~62.5 fps
  } else if (e.data === 'stop') {
    clearInterval(id)
    id = null
  }
}

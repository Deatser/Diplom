import { showScreen } from '../main.js'
import { SaveSystem } from '../systems/SaveSystem.js'
import { networkClient } from '../network/NetworkClient.js'

export class LobbyScreen {
  constructor() {
    this.el       = document.getElementById('screen-lobby')
    this.listEl   = document.getElementById('server-list')
    this.slotsEl  = document.getElementById('save-slots')
    this.searchEl = document.getElementById('server-search')
    this.rooms    = []
    this._unsub   = []
    this._onKey   = this._onKeyDown.bind(this)
  }

  show() {
    this.el.classList.remove('hidden')
    this._renderSlots()
    this._renderServers([])

    this._unsub.push(networkClient.on('lobby:list', rooms => {
      this.rooms = rooms
      const q = this.searchEl.value.toLowerCase()
      this._renderServers(q ? rooms.filter(r => r.name.toLowerCase().includes(q)) : rooms)
    }))
    this._unsub.push(networkClient.on('connected', () => networkClient.getRooms()))

    if (networkClient.isConnected) networkClient.getRooms()

    this.searchEl.oninput = () => {
      const q = this.searchEl.value.toLowerCase()
      this._renderServers(q ? this.rooms.filter(r => r.name.toLowerCase().includes(q)) : this.rooms)
    }

    window.addEventListener('keydown', this._onKey)
  }

  hide() {
    this.el.classList.add('hidden')
    this._unsub.forEach(u => u()); this._unsub = []
    this.searchEl.value = ''
    window.removeEventListener('keydown', this._onKey)
  }

  _onKeyDown(e) {
    const menuKey = SaveSystem.getSettings().keybindings.menu || 'Backquote'
    if (e.code === menuKey || e.key === 'Escape') {
      networkClient.leaveRoom()
      showScreen('main-menu')
    }
  }

  _renderServers(rooms) {
    if (!rooms.length) {
      this.listEl.innerHTML = '<div class="server-empty">Серверов нет</div>'
      return
    }

    this.listEl.innerHTML = rooms.map(r => {
      const status   = r.status || (r.playerCount >= 2 ? 'ready' : 'waiting')
      const canJoin  = status === 'waiting' && r.playerCount < 2

      const statusLabel = {
        waiting: 'Ожидание игрока',
        ready:   'Ожидание начала игры',
        playing: 'Идёт игра'
      }[status] || 'Ожидание игрока'

      return `
        <div class="server-item status-${status}">
          <div class="server-item-info">
            <span class="server-item-name">${this._esc(r.name)}</span>
            <span class="server-item-meta">
              Уровень ${r.level} · ${this._formatTime(r.playtime || 0)} · ${r.playerCount}/2
            </span>
            <span class="server-item-status status-label-${status}">${statusLabel}</span>
          </div>
          <button class="server-join-btn" data-join="${r.id}" ${canJoin ? '' : 'disabled'}>
            ${canJoin ? 'Войти' : status === 'playing' ? '▶' : '●'}
          </button>
        </div>`
    }).join('')

    this.listEl.querySelectorAll('[data-join]:not([disabled])').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation()
        networkClient.joinRoom(btn.dataset.join)
      }
    })
  }

  _renderSlots() {
    const saves = SaveSystem.getSaves()
    this.slotsEl.innerHTML = saves.map(s => {
      if (!s.roomId) return `
        <div class="save-slot empty" data-slot="${s.slot}">
          <div class="save-slot-info">
            <span class="save-slot-name">Новая игра</span>
          </div>
        </div>`
      const time = this._formatTime(s.playtime || 0)
      return `
        <div class="save-slot" data-slot="${s.slot}">
          <div class="save-slot-info">
            <span class="save-slot-name">${this._esc(s.roomName)}</span>
            <span class="save-slot-meta">Уровень ${s.level || 1} — ${time}</span>
          </div>
          <button class="clear-save-btn" data-clear="${s.slot}">Удалить</button>
        </div>`
    }).join('')

    this.slotsEl.querySelectorAll('.save-slot').forEach(el => {
      el.onclick = (e) => {
        if (e.target.closest('[data-clear]')) return
        const slot = +el.dataset.slot
        const save = saves[slot]

        window.__currentSlot = slot

        if (!save.roomId) {
          window.__currentSlotMaxLevel = 1
          const name = `Мир${Math.floor(Math.random() * 900000 + 100000)}`
          networkClient.createRoom(name, 1, 0)
        } else {
          window.__currentSlotMaxLevel = save.level || 1
          const name = save.roomName || `Мир${Math.floor(Math.random() * 900000 + 100000)}`
          networkClient.createRoom(name, save.level || 1, save.playtime || 0)
        }
      }
    })

    this.slotsEl.querySelectorAll('[data-clear]').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation()
        if (confirm('Удалить сохранение?')) {
          SaveSystem.clearSave(+btn.dataset.clear)
          this._renderSlots()
        }
      }
    })
  }

  _formatTime(sec) {
    const h = Math.floor(sec / 3600)
    const m = Math.floor((sec % 3600) / 60)
    return `${h}ч ${m}м`
  }
  _esc(s) { return String(s).replace(/</g, '&lt;').replace(/>/g, '&gt;') }
}

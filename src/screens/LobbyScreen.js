import { showScreen } from '../main.js'
import { SaveSystem } from '../systems/SaveSystem.js'
import { networkClient } from '../network/NetworkClient.js'
import { i18n } from '../utils/i18n.js'

export class LobbyScreen {
  constructor() {
    this.el       = document.getElementById('screen-lobby')
    this.listEl   = document.getElementById('server-list')
    this.slotsEl  = document.getElementById('save-slots')
    this.searchEl = document.getElementById('server-search')
    this.backBtn  = document.getElementById('lobby-back-btn')
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

    // Кнопка «Назад» → главное меню (как Escape). Звуки hover/click — глобально в main.js.
    this.backBtn.onclick = () => {
      networkClient.leaveRoom()
      showScreen('main-menu')
    }
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
      this.listEl.innerHTML = `<div class="server-empty">${i18n.t('lobby.no_servers')}</div>`
      return
    }

    // Комната, из которой гость вылетел (закрыл вкладку) посреди игры — если она ещё
    // жива и есть место, подсвечиваем её особо с подписью «Вернуться в игру».
    const rejoin = SaveSystem.getRejoin()

    this.listEl.innerHTML = rooms.map(r => {
      const status   = r.status || (r.playerCount >= 2 ? 'ready' : 'waiting')
      // «Вернуться в игру» — только если это наша комната, она ещё играет и есть место.
      const isRejoin = !!rejoin && rejoin.roomId === r.id && r.playerCount < 2 && status === 'playing'
      const canJoin  = isRejoin || (status === 'waiting' && r.playerCount < 2)

      const statusLabel = isRejoin
        ? i18n.t('lobby.return_to_game')
        : ({
            waiting: i18n.t('lobby.status_waiting'),
            ready:   i18n.t('lobby.status_ready'),
            playing: i18n.t('lobby.status_playing')
          }[status] || i18n.t('lobby.status_waiting'))

      return `
        <div class="server-item status-${status} ${isRejoin ? 'is-rejoin' : ''} ${canJoin ? 'can-join' : ''}" ${canJoin ? `data-join="${r.id}"` : ''}>
          <div class="server-item-info">
            <span class="server-item-name">${this._esc(r.name)}</span>
            <span class="server-item-meta">
              ${i18n.t('lobby.level')} ${r.level} · ${this._formatTime(r.playtime || 0)} · ${r.playerCount}/2
            </span>
            <span class="server-item-status ${isRejoin ? 'status-label-rejoin' : 'status-label-' + status}">${statusLabel}</span>
          </div>
        </div>`
    }).join('')

    this.listEl.querySelectorAll('.server-item[data-join]').forEach(item => {
      item.onclick = () => item.classList.contains('is-rejoin')
        ? networkClient.rejoinRoom(item.dataset.join) // возврат в живую игру (свой слот)
        : networkClient.joinRoom(item.dataset.join)
    })
  }

  _renderSlots() {
    const saves = SaveSystem.getSaves()
    this.slotsEl.innerHTML = saves.map(s => {
      const num = s.slot + 1
      if (!s.roomId) return `
        <div class="save-slot empty" data-slot="${s.slot}">
          <div class="save-slot-left">
            <span class="save-slot-num">${num}.</span>
            <div class="save-slot-info">
              <span class="save-slot-name">${i18n.t('lobby.new')}</span>
            </div>
          </div>
        </div>`
      const time = this._formatTime(s.playtime || 0)
      return `
        <div class="save-slot" data-slot="${s.slot}">
          <div class="save-slot-left">
            <span class="save-slot-num">${num}.</span>
            <div class="save-slot-info">
              <span class="save-slot-name">${this._esc(s.roomName)}</span>
              <span class="save-slot-meta">${i18n.t('lobby.level')} ${s.level || 1} — ${time}</span>
            </div>
          </div>
          <button class="clear-save-btn" data-clear="${s.slot}">${i18n.t('lobby.delete')}</button>
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
          const name = `${i18n.t('ls.world')}${Math.floor(Math.random() * 900000 + 100000)}`
          networkClient.createRoom(name, 1, 0)
        } else {
          window.__currentSlotMaxLevel = save.level || 1
          const name = save.roomName || `${i18n.t('ls.world')}${Math.floor(Math.random() * 900000 + 100000)}`
          networkClient.createRoom(name, save.level || 1, save.playtime || 0)
        }
      }
    })

    this.slotsEl.querySelectorAll('[data-clear]').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation()
        this._showClearConfirm(+btn.dataset.clear)
      }
    })
  }

  _showClearConfirm(slot) {
    const modal = document.createElement('div')
    modal.className = 'confirm-modal'
    modal.innerHTML = `
      <div class="confirm-box">
        <p class="confirm-text">${i18n.t('lobby.delete_confirm')}</p>
        <div class="confirm-buttons">
          <button class="confirm-yes">${i18n.t('confirm.yes')}</button>
          <button class="confirm-no">${i18n.t('confirm.no')}</button>
        </div>
      </div>`
    document.body.appendChild(modal)
    modal.querySelector('.confirm-yes').onclick = () => {
      modal.remove()
      SaveSystem.clearSave(slot)
      this._renderSlots()
    }
    modal.querySelector('.confirm-no').onclick = () => modal.remove()
  }

  _formatTime(sec) {
    const h = Math.floor(sec / 3600)
    const m = Math.floor((sec % 3600) / 60)
    return `${h}${i18n.t('lobby.hours')} ${m}${i18n.t('lobby.minutes')}`
  }
  _esc(s) { return String(s).replace(/</g, '&lt;').replace(/>/g, '&gt;') }
}

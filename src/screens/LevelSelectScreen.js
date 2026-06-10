import { showScreen } from '../main.js'
import { networkClient } from '../network/NetworkClient.js'
import { SaveSystem } from '../systems/SaveSystem.js'
import { startGame } from '../game/GameManager.js'
import { i18n } from '../utils/i18n.js'

export class LevelSelectScreen {
  constructor() {
    this.el          = document.getElementById('screen-level-select')
    this.nameDisplay = document.getElementById('server-name-display')
    this.renameInput = document.getElementById('rename-input')
    this.guestLabel  = document.getElementById('guest-label')
    this.guestAvatar = document.querySelector('.player-avatar.orange')
    this.grid        = document.getElementById('levels-grid')
    this.startBtn    = document.getElementById('start-game-btn')
    this.selectedLevel = 1
    this.guestJoined   = false
    this._unsub        = []
    this.role          = 'host'
    this.roomId        = null
    this.roomName      = ''
    this.maxLevel      = 1
    this._onKey        = this._onKeyDown.bind(this)
    this._avatarTimers = []
  }

  // Случайные анимации рыцарей: раз в 3–7с удар или блок (ходьбу/смерть не трогаем).
  // Каждый клиент рандомит только СВОЕГО рыцаря и шлёт событие партнёру,
  // поэтому синий машет одинаково на обоих компах (и оранжевый тоже).
  _startAvatarAnims() {
    const anims = [
      { cls: 'anim-attack', ms: 720 },
      { cls: 'anim-block',  ms: 540 },
    ]
    const schedule = () => {
      const t = setTimeout(() => {
        const a = anims[Math.floor(Math.random() * anims.length)]
        this._playAvatarAnim(this.role, a)
        networkClient.sendAvatarAnim(this.role, a.cls)
        schedule()
      }, 3000 + Math.random() * 4000)
      this._avatarTimers.push(t)
    }
    schedule()
    // Анимации рыцаря партнёра приходят по сети
    this._unsub.push(networkClient.on('room:avatarAnim', ({ role, cls }) => {
      const a = anims.find(x => x.cls === cls)
      if (a) this._playAvatarAnim(role, a)
    }))
  }

  _playAvatarAnim(role, { cls, ms }) {
    const av = this.el.querySelector(role === 'host' ? '.player-avatar.blue' : '.player-avatar.orange')
    if (!av || av.classList.contains('dim')) return
    av.classList.add(cls)
    this._avatarTimers.push(setTimeout(() => av.classList.remove(cls), ms))
  }

  show({ roomId, roomName, role, guestJoined: alreadyJoined, maxLevel, selectedLevel } = {}) {
    this._cleanup()

    this.el.classList.remove('hidden')
    this.role     = role || 'host'
    this.roomId   = roomId || networkClient.roomId
    this.roomName = roomName || `${i18n.t('ls.world')}${Math.floor(Math.random()*900000+100000)}`
    this.maxLevel = maxLevel || 1

    this.guestJoined = (this.role === 'guest') || !!alreadyJoined
    this.guestAvatar.classList.toggle('dim', !this.guestJoined)
    this.guestLabel.textContent = this.guestJoined ? i18n.t('ls.guest') : i18n.t('ls.waiting')

    this.nameDisplay.textContent = this.roomName
    // Хосту имя кликабельно (пунктир-подчёркивание = «можно переименовать»)
    this.nameDisplay.classList.toggle('renamable', this.role === 'host')
    this.nameDisplay.title = this.role === 'host' ? i18n.t('ls.rename_tip') : ''

    // Use server-provided selectedLevel if available, else default to maxLevel
    this.selectedLevel = selectedLevel || Math.min(this.maxLevel, 10)
    this._renderGrid()
    this._updateStart()
    this._setupRename()
    this._updateRoleIndicator()
    this._updateHint()
    this._startAvatarAnims()

    window.addEventListener('keydown', this._onKey)

    // ── Network listeners ──

    this._unsub.push(networkClient.on('room:renamed', ({ name }) => {
      this.roomName = name
      this.nameDisplay.textContent = name
      const slot = window.__currentSlot
      if (slot !== undefined) SaveSystem.setSave(slot, { roomName: name })
    }))

    this._unsub.push(networkClient.on('room:playerJoined', () => {
      this.guestJoined = true
      this.guestAvatar.classList.remove('dim')
      this.guestLabel.textContent = i18n.t('ls.guest')
      this._updateStart()
      // Immediately sync current level selection to newly joined guest
      if (this.role === 'host') {
        networkClient.selectLevel(this.selectedLevel)
      }
    }))

    // room:playerLeft: host-left triggers modal for guest; guest-left updates host UI
    this._unsub.push(networkClient.on('room:playerLeft', ({ reason } = {}) => {
      if (reason === 'host_left') {
        this._showHostLeftModal()
      } else {
        this.guestJoined = false
        this.guestAvatar.classList.add('dim')
        this.guestLabel.textContent = i18n.t('ls.waiting')
        this._updateStart()
      }
    }))

    // lobby:list can carry updated level info from server
    this._unsub.push(networkClient.on('lobby:list', rooms => {
      if (!this.roomId) return
      const myRoom = rooms.find(r => r.id === this.roomId)
      if (!myRoom) return
      const serverLevel = myRoom.level || 1
      if (serverLevel > this.maxLevel) {
        this.maxLevel = serverLevel
        window.__currentSlotMaxLevel = serverLevel
        this._renderGrid()
      }
    }))

    // Guest receives host's level selection (visual sync)
    this._unsub.push(networkClient.on('room:levelSelected', ({ levelId }) => {
      if (this.role !== 'host') {
        this.selectedLevel = levelId
        this._renderGrid()
      }
    }))

    // Guest receives game:start
    this._unsub.push(networkClient.on('game:start', ({ levelId }) => {
      console.log('[LevelSelect] game:start level=', levelId, 'role=', this.role)
      window.__l2s = { ...(window.__l2s || {}), roomId: this.roomId, roomName: this.roomName, role: this.role }
      startGame(levelId, this.role)
    }))

    // ── Buttons ──
    this.startBtn.onclick = () => {
      if (this.role === 'host' && this.guestJoined) {
        console.log('[LevelSelect] Host start, level=', this.selectedLevel)
        networkClient.startGame(this.selectedLevel)
        window.__l2s = { roomId: this.roomId, roomName: this.roomName, role: 'host' }
        startGame(this.selectedLevel, 'host')
      }
    }
  }

  hide() {
    this.el.classList.add('hidden')
    this._cleanup()
  }

  _cleanup() {
    this._unsub.forEach(u => u()); this._unsub = []
    window.removeEventListener('keydown', this._onKey)
    this._avatarTimers.forEach(t => clearTimeout(t)); this._avatarTimers = []
    this.el.querySelectorAll('.player-avatar').forEach(av =>
      av.classList.remove('anim-attack', 'anim-block'))
  }

  _onKeyDown(e) {
    const menuKey = SaveSystem.getSettings().keybindings.menu || 'Backquote'
    if (e.code === menuKey || e.key === 'Escape') {
      this._cleanup()
      networkClient.leaveRoom()
      showScreen('lobby')
    }
  }

  // Highlight which avatar represents "me"
  _updateRoleIndicator() {
    const blueAvatar   = this.el.querySelector('.player-avatar.blue')
    const orangeAvatar = this.el.querySelector('.player-avatar.orange')
    blueAvatar?.classList.remove('is-me')
    orangeAvatar?.classList.remove('is-me')
    if (this.role === 'host') {
      blueAvatar?.classList.add('is-me')
    } else {
      orangeAvatar?.classList.add('is-me')
    }
  }

  _renderGrid() {
    const maxLevel = this.maxLevel
    if (this.selectedLevel > maxLevel) this.selectedLevel = Math.max(1, maxLevel)

    this.grid.innerHTML = Array.from({ length: 10 }, (_, i) => {
      const n = i + 1
      const unlocked = n <= maxLevel
      const sel = (n === this.selectedLevel && unlocked) ? 'selected' : ''
      return `
        <div class="level-card ${unlocked ? 'unlocked' : 'locked'} ${sel}" data-level="${n}">
          <span class="level-num">${n}</span>
          <span class="level-lock">${unlocked ? '✦' : '✧'}</span>
        </div>`
    }).join('')

    if (this.role === 'host') {
      this.grid.querySelectorAll('.level-card.unlocked').forEach(card => {
        card.onclick = () => {
          this.selectedLevel = +card.dataset.level
          this.grid.querySelectorAll('.level-card').forEach(c => c.classList.remove('selected'))
          card.classList.add('selected')
          this._updateStart()
          // Broadcast selection to guest
          networkClient.selectLevel(this.selectedLevel)
        }
      })
    }
  }

  _updateStart() {
    const canStart = (this.role === 'host') && this.guestJoined
    this.startBtn.disabled = !canStart
    this.startBtn.title = canStart ? '' : i18n.t('ls.waiting_second')
  }

  _setupRename() {
    this.nameDisplay.onclick = null // сброс: после сессии хостом гость не должен кликать
    if (this.role !== 'host') return
    this.nameDisplay.onclick = () => {
      this.renameInput.value = this.roomName
      this.renameInput.classList.remove('hidden')
      this.nameDisplay.style.display = 'none'
      this.renameInput.focus()
    }
    const commit = () => {
      const name = this.renameInput.value.trim() || this.roomName
      this.roomName = name
      this.nameDisplay.textContent = name
      this.renameInput.classList.add('hidden')
      this.nameDisplay.style.display = ''
      const slot = window.__currentSlot
      if (slot !== undefined) SaveSystem.setSave(slot, { roomName: name })
      networkClient.renameRoom(name)
    }
    this.renameInput.onblur   = commit
    this.renameInput.onkeydown = e => { if (e.key === 'Enter') { this.renameInput.blur() } }
  }

  _updateHint() {
    const hint = document.getElementById('level-select-hint')
    if (!hint) return
    hint.textContent = this.role === 'host'
      ? i18n.t('ls.choose')
      : i18n.t('ls.waiting_host_choose')
  }

  // Show notification when host leaves the room
  _showHostLeftModal() {
    this._cleanup()
    const modal = document.createElement('div')
    modal.className = 'host-left-modal'
    modal.innerHTML = `
      <div class="host-left-box">
        <p class="host-left-msg">${i18n.t('ls.host_left')}</p>
        <button class="host-left-ok">${i18n.t('ls.ok')}</button>
      </div>`
    document.body.appendChild(modal)
    modal.querySelector('.host-left-ok').onclick = () => {
      modal.remove()
      showScreen('lobby')
    }
  }
}

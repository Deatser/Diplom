import { io } from 'socket.io-client'

// В проде клиент и Socket.io-сервер на одном origin (сервер раздаёт собранный
// фронтенд) → подключаемся к origin страницы. В деве фронт на :8080, сервер на :3000.
// VITE_WS_URL переопределяет всё (на случай отдельного хостинга сервера).
const WS_URL =
  import.meta.env.VITE_WS_URL ||
  (import.meta.env.PROD ? window.location.origin : 'http://localhost:3000')

class NetworkClient {
  constructor() {
    this.socket = null
    this.roomId = null
    this.role = null
    this._listeners = {}
  }

  connect() {
    if (this.socket?.connected) return
    // ТОЛЬКО websocket — без polling-фолбэка. Polling через интернет на частых
    // сообщениях (синхронизация позиции) копит очередь и даёт растущий лаг до секунды.
    // Render поддерживает websocket, так что фолбэк не нужен.
    this.socket = io(WS_URL, {
      transports: ['websocket'],
      upgrade: false,
    })
    this.socket.on('connect', () => this._emit('connected'))
    this.socket.on('disconnect', () => this._emit('disconnected'))
    this.socket.on('lobby:list', rooms => this._emit('lobby:list', rooms))
    this.socket.on('lobby:roomCreated', d => { this.roomId = d.roomId; this._emit('roomCreated', d) })
    this.socket.on('player:joined', d => { this.role = d.role; this.roomId = d.roomId || this.roomId; this._emit('playerJoined', d) })
    this.socket.on('room:playerJoined', d => this._emit('room:playerJoined', d))
    this.socket.on('room:playerLeft', d => this._emit('room:playerLeft', d))
    this.socket.on('player:input', d => this._emit('playerInput', d))
    this.socket.on('game:stateSnapshot', d => this._emit('stateSnapshot', d))
    this.socket.on('ability:swapRequest', d => this._emit('swapRequest', d))
    this.socket.on('ability:swapExecute', () => this._emit('swapExecute'))
    this.socket.on('lobby:error',   d => this._emit('lobbyError', d))
    this.socket.on('room:renamed',  d => this._emit('room:renamed', d))
    this.socket.on('game:start',        d => { console.log('[nc] game:start', d); this._emit('game:start', d) })
    this.socket.on('game:exit',         () => { console.log('[nc] game:exit'); this._emit('game:exit') })
    this.socket.on('game:levelComplete',() => { console.log('[nc] levelComplete'); this._emit('levelComplete') })
    this.socket.on('game:playerDied',   () => { console.log('[nc] playerDied');   this._emit('playerDied') })
    this.socket.on('game:deathRestart', () => { console.log('[nc] deathRestart'); this._emit('deathRestart') })
    this.socket.on('game:revive',       () => { console.log('[nc] revive');       this._emit('revive') })
    this.socket.on('game:reviveAd',       () => this._emit('reviveAd'))
    this.socket.on('game:reviveDeclined', () => this._emit('reviveDeclined'))
    this.socket.on('game:orbCollected', () => this._emit('orbCollected'))
    this.socket.on('game:abilityClose', () => this._emit('abilityClose'))
    this.socket.on('game:lampLever',    () => this._emit('lampLever'))
    this.socket.on('game:leverDoor',    d  => this._emit('leverDoor', d))
    this.socket.on('game:finalReach',   d  => this._emit('finalReach', d))
    this.socket.on('game:visualSync',   d => this._emit('visualSync', d))
    this.socket.on('game:flickerStep',  d => this._emit('flickerStep', d))
    this.socket.on('game:flickerClick', () => this._emit('flickerClick'))
    this.socket.on('game:playerSfx',    d => this._emit('playerSfx', d))
    this.socket.on('room:levelSelected',d => this._emit('room:levelSelected', d))
    this.socket.on('room:avatarAnim',   d => this._emit('room:avatarAnim', d))
  }

  on(event, fn) {
    if (!this._listeners[event]) this._listeners[event] = []
    this._listeners[event].push(fn)
    return () => { this._listeners[event] = this._listeners[event].filter(f => f !== fn) }
  }

  _emit(event, data) {
    this._listeners[event]?.forEach(fn => fn(data))
  }

  startGame(levelId)   { this.socket?.emit('game:start', { roomId: this.roomId, levelId }) }
  selectLevel(levelId) { if (this.roomId) this.socket?.emit('room:selectLevel', { roomId: this.roomId, levelId }) }
  updateRoom(level, playtime) { if (this.roomId) this.socket?.emit('lobby:updateRoom', { roomId: this.roomId, level, playtime }) }
  exitGame()           { if (this.roomId) this.socket?.emit('game:exit', { roomId: this.roomId }) }
  levelComplete()      { if (this.roomId) this.socket?.emit('game:levelComplete', { roomId: this.roomId }) }
  playerDied()         { if (this.roomId) this.socket?.emit('game:playerDied',    { roomId: this.roomId }) }
  deathRestart()       { if (this.roomId) this.socket?.emit('game:deathRestart',  { roomId: this.roomId }) }
  revive()             { if (this.roomId) this.socket?.emit('game:revive',        { roomId: this.roomId }) }
  reviveAd()           { if (this.roomId) this.socket?.emit('game:reviveAd',      { roomId: this.roomId }) }
  reviveDeclined()     { if (this.roomId) this.socket?.emit('game:reviveDeclined',{ roomId: this.roomId }) }
  orbCollected()       { if (this.roomId) this.socket?.emit('game:orbCollected',  { roomId: this.roomId }) }
  abilityClose()       { if (this.roomId) this.socket?.emit('game:abilityClose',  { roomId: this.roomId }) }
  lampLever()          { if (this.roomId) this.socket?.emit('game:lampLever',      { roomId: this.roomId }) }
  leverDoor(open)      { if (this.roomId) this.socket?.emit('game:leverDoor',      { roomId: this.roomId, open }) }
  finalReach(reached)  { if (this.roomId) this.socket?.emit('game:finalReach',     { roomId: this.roomId, reached }) }
  sendVisualSync(state){ if (this.roomId) this.socket?.emit('game:visualSync',     { roomId: this.roomId, state }) }
  sendFlickerStep(factor) { if (this.roomId) this.socket?.emit('game:flickerStep', { roomId: this.roomId, factor }) }
  sendFlickerClick()     { if (this.roomId) this.socket?.emit('game:flickerClick', { roomId: this.roomId }) }
  playerSfx(name, vol)   { if (this.roomId) this.socket?.emit('game:playerSfx', { roomId: this.roomId, name, vol }) }
  getRooms()           { this.socket?.emit('lobby:getRooms') }
  createRoom(name, level = 1, playtime = 0) { this.socket?.emit('lobby:createRoom', { name, level, playtime }) }
  joinRoom(roomId)     { this.socket?.emit('lobby:joinRoom', { roomId }) }
  renameRoom(name)     { this.socket?.emit('lobby:renameRoom', { roomId: this.roomId, name }) }
  sendAvatarAnim(role, cls) { if (this.roomId) this.socket?.emit('room:avatarAnim', { roomId: this.roomId, role, cls }) }
  leaveRoom()          { if (this.roomId) { this.socket?.emit('lobby:leaveRoom', { roomId: this.roomId }); this.roomId = null; this.role = null } }
  sendInput(input)     { this.socket?.emit('player:input', { roomId: this.roomId, input }) }
  sendSnapshot(state)  { this.socket?.emit('game:stateSnapshot', { roomId: this.roomId, state }) }
  requestSwap()        { this.socket?.emit('ability:swapRequest', { roomId: this.roomId }) }
  confirmSwap()        { this.socket?.emit('ability:swapConfirm', { roomId: this.roomId }) }

  get isHost()      { return this.role === 'host' }
  get isConnected() { return !!this.socket?.connected }
  get id()          { return this.socket?.id }
}

export const networkClient = new NetworkClient()

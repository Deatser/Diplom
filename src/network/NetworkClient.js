import { io } from 'socket.io-client'

const WS_URL = import.meta.env.VITE_WS_URL || 'http://localhost:3000'

class NetworkClient {
  constructor() {
    this.socket = null
    this.roomId = null
    this.role = null
    this._listeners = {}
  }

  connect() {
    if (this.socket?.connected) return
    this.socket = io(WS_URL, { transports: ['websocket', 'polling'] })
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
    this.socket.on('room:levelSelected',d => this._emit('room:levelSelected', d))
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
  getRooms()           { this.socket?.emit('lobby:getRooms') }
  createRoom(name, level = 1, playtime = 0) { this.socket?.emit('lobby:createRoom', { name, level, playtime }) }
  joinRoom(roomId)     { this.socket?.emit('lobby:joinRoom', { roomId }) }
  renameRoom(name)     { this.socket?.emit('lobby:renameRoom', { roomId: this.roomId, name }) }
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

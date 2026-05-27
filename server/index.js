import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'

const app = express()
const httpServer = createServer(app)
const io = new Server(httpServer, { cors: { origin: '*' } })

// ── Browser → Terminal log relay (dev helper) ──
app.use(express.json())
app.options('/_log', (_, res) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Headers', 'Content-Type')
  res.sendStatus(200)
})
app.post('/_log', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*')
  const msg = (req.body?.args ?? []).join(' ')
  process.stdout.write(`\x1b[36m[БРАУЗЕР] ${msg}\x1b[0m\n`)
  res.sendStatus(200)
})

// rooms: Map<roomId, { id, name, hostId, guestId, level, playtime, status, createdAt }>
// status: 'waiting' (1 player) | 'ready' (2 players, not playing) | 'playing' (game active)
const rooms = new Map()
const socketToRoom = new Map()

function roomList() {
  return [...rooms.values()].map(r => ({
    id: r.id, name: r.name, level: r.level,
    playtime: r.playtime || 0,
    playerCount: (r.hostId ? 1 : 0) + (r.guestId ? 1 : 0),
    status: r.status || 'waiting',
    createdAt: r.createdAt
  }))
}

function broadcastList() { io.emit('lobby:list', roomList()) }

function removePlayer(socketId) {
  const roomId = socketToRoom.get(socketId)
  if (!roomId) return
  socketToRoom.delete(socketId)
  const room = rooms.get(roomId)
  if (!room) return
  if (room.hostId === socketId) {
    if (room.guestId) io.to(room.guestId).emit('room:playerLeft', { reason: 'host_left' })
    rooms.delete(roomId)
    broadcastList()
  } else if (room.guestId === socketId) {
    room.guestId = null
    room.status = 'waiting'
    io.to(room.hostId).emit('room:playerLeft', { socketId })
    broadcastList()
  }
}

io.on('connection', socket => {
  console.log('+ connect', socket.id)

  socket.on('lobby:getRooms', () => socket.emit('lobby:list', roomList()))

  socket.on('lobby:createRoom', ({ name, level, playtime }) => {
    const id = Math.random().toString(36).slice(2, 10)
    const room = {
      id, name,
      hostId: socket.id, guestId: null,
      level: level || 1, playtime: playtime || 0,
      selectedLevel: level || 1,
      status: 'waiting',
      createdAt: new Date().toISOString()
    }
    rooms.set(id, room)
    socketToRoom.set(socket.id, id)
    socket.join(id)
    socket.emit('lobby:roomCreated', { roomId: id, name })
    socket.emit('player:joined', { role: 'host', roomId: id })
    broadcastList()
  })

  socket.on('lobby:joinRoom', ({ roomId }) => {
    const room = rooms.get(roomId)
    if (!room) { socket.emit('lobby:error', { message: 'Комната не найдена' }); return }
    if (room.guestId) { socket.emit('lobby:error', { message: 'Комната заполнена' }); return }
    room.guestId = socket.id
    room.status = 'ready'
    socketToRoom.set(socket.id, roomId)
    socket.join(roomId)
    socket.emit('player:joined', { role: 'guest', roomId, name: room.name, level: room.level, selectedLevel: room.selectedLevel || room.level })
    io.to(room.hostId).emit('room:playerJoined', { guestId: socket.id })
    broadcastList()
  })

  socket.on('lobby:leaveRoom', () => removePlayer(socket.id))

  socket.on('lobby:renameRoom', ({ roomId, name }) => {
    const room = rooms.get(roomId)
    if (room && room.hostId === socket.id) {
      room.name = name
      // Notify ALL players in the room (including guest) of the new name
      io.to(roomId).emit('room:renamed', { name })
      broadcastList()
    }
  })

  // Host updates room metadata (level + playtime) when returning from game
  socket.on('lobby:updateRoom', ({ roomId, level, playtime }) => {
    const room = rooms.get(roomId)
    if (room && room.hostId === socket.id) {
      if (level    !== undefined) room.level    = level
      if (playtime !== undefined) room.playtime = playtime
      broadcastList()
    }
  })

  // Host selects a level → persist + relay to guest
  socket.on('room:selectLevel', ({ roomId, levelId }) => {
    const room = rooms.get(roomId)
    if (room && room.hostId === socket.id) room.selectedLevel = levelId
    socket.to(roomId).emit('room:levelSelected', { levelId })
  })

  socket.on('game:start', ({ roomId, levelId }) => {
    const room = rooms.get(roomId)
    if (room && room.hostId === socket.id) {
      room.level  = levelId
      room.status = 'playing'
      socket.to(roomId).emit('game:start', { levelId })
      console.log(`[server] game:start level=${levelId} room=${roomId}`)
      broadcastList()
    }
  })

  socket.on('game:exit', ({ roomId }) => {
    console.log(`[server] game:exit room=${roomId} from=${socket.id}`)
    const room = rooms.get(roomId)
    if (room) {
      // Return to level-select state
      room.status = room.guestId ? 'ready' : 'waiting'
      broadcastList()
    }
    socket.to(roomId).emit('game:exit')
  })

  socket.on('game:levelComplete', ({ roomId }) => {
    console.log(`[server] levelComplete room=${roomId} from=${socket.id}`)
    socket.to(roomId).emit('game:levelComplete')
  })

  socket.on('player:input', ({ roomId, input }) => {
    socket.to(roomId).emit('player:input', { playerId: socket.id, input })
  })

  socket.on('game:stateSnapshot', ({ roomId, state }) => {
    socket.to(roomId).emit('game:stateSnapshot', state)
  })

  socket.on('ability:swapRequest', ({ roomId }) => {
    socket.to(roomId).emit('ability:swapRequest', { fromId: socket.id })
  })

  socket.on('ability:swapConfirm', ({ roomId }) => {
    io.to(roomId).emit('ability:swapExecute')
  })

  socket.on('disconnect', () => {
    console.log('- disconnect', socket.id)
    removePlayer(socket.id)
  })
})

const PORT = process.env.PORT || 3000
httpServer.listen(PORT, () => console.log(`Left2Solve server on :${PORT}`))

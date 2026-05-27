// pako must be global BEFORE Phaser parses any tilemap with zlib compression.
// Phaser looks for window.pako to decompress tile layers — without it map.layers = []
import * as pako from 'pako'
window.pako = pako

import './utils/terminalLog.js'   // browser console → server terminal relay
import { SaveSystem } from './systems/SaveSystem.js'
import { networkClient } from './network/NetworkClient.js'
import { i18n } from './utils/i18n.js'
import { initParticles } from './utils/particles.js'
import { MainMenuScreen } from './screens/MainMenuScreen.js'
import { SettingsScreen } from './screens/SettingsScreen.js'
import { LobbyScreen } from './screens/LobbyScreen.js'
import { LevelSelectScreen } from './screens/LevelSelectScreen.js'

const screens = {}
let currentScreen = null

export function showScreen(name, data = {}) {
  // Special case: 'pause' shows the pause overlay on top of the running game
  if (name === 'pause') {
    if (currentScreen && screens[currentScreen]) {
      screens[currentScreen].hide()
    }
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'))
    currentScreen = null
    document.getElementById('hud').classList.remove('hidden')
    document.getElementById('pause-menu').classList.remove('hidden')
    return
  }

  // Hide current screen properly (cleans up listeners)
  if (currentScreen && screens[currentScreen]) {
    screens[currentScreen].hide()
  }
  document.getElementById('game-container').classList.add('hidden')
  document.getElementById('hud').classList.add('hidden')
  document.getElementById('pause-menu').classList.add('hidden')
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'))

  currentScreen = name
  if (screens[name]) screens[name].show(data)
}

// Show a screen without hiding the game (used when going pause → settings)
// Automatically passes fromGame:true so the screen knows to add a backdrop
export function showScreenFromGame(name, data = {}) {
  if (currentScreen && screens[currentScreen]) {
    screens[currentScreen].hide()
  }
  document.getElementById('pause-menu').classList.add('hidden')
  document.getElementById('hud').classList.add('hidden')
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'))
  currentScreen = name
  if (screens[name]) screens[name].show({ ...data, fromGame: true })
  // game-container intentionally stays visible
}

export function hideAllForGame() {
  // Called by GameManager — properly hides current screen
  if (currentScreen && screens[currentScreen]) {
    screens[currentScreen].hide()
  }
  currentScreen = null
  document.getElementById('pause-menu').classList.add('hidden')
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'))
}

function init() {
  initParticles()
  networkClient.connect()

  // Request fullscreen on the very first user interaction (requires gesture)
  const tryFullscreen = () => {
    document.documentElement.requestFullscreen?.().catch(() => {})
  }
  document.addEventListener('click',   tryFullscreen, { once: true })
  document.addEventListener('keydown', tryFullscreen, { once: true })

  // Global fullscreen toggle key (F by default, rebindable in settings)
  document.addEventListener('keydown', (e) => {
    const fsKey = SaveSystem.getSettings().keybindings.fullscreen || 'KeyF'
    if (e.code === fsKey) {
      if (document.fullscreenElement) {
        document.exitFullscreen?.()
      } else {
        document.documentElement.requestFullscreen?.().catch(() => {})
      }
    }
  })

  screens['main-menu']    = new MainMenuScreen()
  screens['settings']     = new SettingsScreen()
  screens['lobby']        = new LobbyScreen()
  screens['level-select'] = new LevelSelectScreen()

  showScreen('main-menu')

  // Host: created room → save slot data → go to level select
  networkClient.on('roomCreated', ({ roomId, name }) => {
    const slot = window.__currentSlot
    const maxLevel = window.__currentSlotMaxLevel || 1
    // Save slot with new roomId (preserving level progress)
    if (slot !== undefined) {
      const saves = SaveSystem.getSaves()
      SaveSystem.setSave(slot, {
        roomId,
        roomName: name,
        level: maxLevel,
        playtime: saves[slot]?.playtime || 0
      })
    }
    showScreen('level-select', { roomId, roomName: name, role: 'host', maxLevel })
  })

  // Guest: joined room → go to level select (use room name + level + selectedLevel from server)
  networkClient.on('playerJoined', ({ role, roomId, name, level, selectedLevel }) => {
    if (role === 'guest') {
      showScreen('level-select', {
        roomId,
        roomName: name || `Мир${Math.floor(Math.random()*900000+100000)}`,
        role: 'guest',
        maxLevel: level || 1,
        selectedLevel: selectedLevel || null
      })
    }
  })
}

init()

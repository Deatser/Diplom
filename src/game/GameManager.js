import Phaser from 'phaser'
import { PreloadScene } from './scenes/PreloadScene.js'
import { GameScene }    from './scenes/GameScene.js'
import { hideAllForGame, showScreen, showScreenFromGame } from '../main.js'
import { SaveSystem } from '../systems/SaveSystem.js'
import { networkClient } from '../network/NetworkClient.js'

let _game = null
let _pauseScene = null  // reference to active GameScene for exit button

// Parse "2560x1440" → {w:2560, h:1440}
function _parseRes(str = '1920x1080') {
  const [w, h] = (str || '1920x1080').split('x').map(Number)
  return { w: w || 1920, h: h || 1080 }
}

// ── Pause menu ──────────────────────────────────────────────────────────────
export function togglePause(scene) {
  _pauseScene = scene
  const el = document.getElementById('pause-menu')
  if (el.classList.contains('hidden')) {
    // Open pause: disable game input
    if (_pauseScene) _pauseScene._gamePaused = true
    _openPause()
  } else {
    // Close pause: re-enable game input
    _closePause(true)
  }
}

function _openPause() {
  document.getElementById('pause-menu').classList.remove('hidden')

  // Продолжить: hide menu + resume input
  document.getElementById('pause-resume').onclick = () => _closePause(true)

  // Настройки: hide menu, keep input disabled, open settings over game
  document.getElementById('pause-settings').onclick = () => {
    _closePause(false)  // hide menu but keep _gamePaused = true
    showScreenFromGame('settings', { from: 'pause' })
  }

  // Выйти в меню: confirm dialog
  document.getElementById('pause-exit').onclick = () => _showPauseExitConfirm()
}

// resumeGame=true re-enables input; false keeps game paused (e.g. when opening settings)
function _closePause(resumeGame = true) {
  document.getElementById('pause-menu').classList.add('hidden')
  if (resumeGame && _pauseScene) _pauseScene._gamePaused = false
}

function _showPauseExitConfirm() {
  const modal = document.createElement('div')
  modal.className = 'confirm-modal'
  modal.innerHTML = `
    <div class="confirm-box">
      <p class="confirm-text">Выйти в меню выбора уровня?</p>
      <div class="confirm-buttons">
        <button class="confirm-yes">Да</button>
        <button class="confirm-no">Нет</button>
      </div>
    </div>`
  document.body.appendChild(modal)
  modal.querySelector('.confirm-yes').onclick = () => {
    modal.remove()
    _closePause(false)
    if (_pauseScene) {
      _pauseScene._gamePaused = false
      _pauseScene._requestExit()
    }
  }
  modal.querySelector('.confirm-no').onclick = () => modal.remove()
}

// Called by LevelSelectScreen when host starts, and by network when guest receives game:start
export function startGame(levelId, role) {
  hideAllForGame()
  document.getElementById('game-container').classList.remove('hidden')
  document.getElementById('hud').classList.remove('hidden')

  // Store level data globally so GameScene can read it in init()
  window.__l2s = { ...(window.__l2s || {}), levelId, role }
  // Track session start time for playtime tracking (reset when starting fresh game)
  if (!window.__sessionStart) window.__sessionStart = Date.now()

  if (_game) {
    // Restart existing Phaser instance with new scene data
    const gs = _game.scene.getScene('GameScene')
    if (gs && gs.scene.isActive()) {
      gs.scene.restart({ levelId, role })
    } else {
      _game.scene.stop('GameScene')
      _game.scene.stop('PreloadScene')
      _game.scene.start('PreloadScene')
    }
    return
  }

  _game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game-container',
    backgroundColor: '#060d1a',
    pixelArt: true,      // crisp nearest-neighbour — no blurring, true pixel art look
    // roundPixels убран: на холсте 320×180 при ×8 масштабе разница дробного пикселя = 1/8 экранного px.
    // pixelArt:true уже даёт чёткость через nearest-neighbour; roundPixels мешал плавной анимации фона.
    physics: {
      default: 'arcade',
      // HK-style snappy gravity (was 900 — too floaty)
      // Gravity in 320×180 space: 1400÷4 = 350
      // (same feel — all physics coords scale with native resolution)
      arcade: { gravity: { y: 900 }, debug: false }
    },
    scene: [PreloadScene, GameScene],
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width:  320,  // fixed "big pixel" canvas — Scale.FIT multiplies up per monitor
      height: 180,  // 2K=×8, 1080p=×6, 720p=×4 | setMaxSize in GameScene caps per settings
    }
  })
}

export function exitToLevelSelect() {
  document.getElementById('game-container').classList.add('hidden')
  document.getElementById('hud').classList.add('hidden')

  // Save accumulated playtime for this session
  saveSessionPlaytime()

  // Sync room info on server (level + updated playtime)
  const slot = window.__currentSlot
  if (slot !== undefined && window.__l2s?.role === 'host') {
    const saves = SaveSystem.getSaves()
    const save = saves[slot]
    if (save) networkClient.updateRoom(save.level || 1, save.playtime || 0)
  }

  showScreen('level-select', {
    roomId:      window.__l2s?.roomId,
    roomName:    window.__l2s?.roomName,
    role:        window.__l2s?.role,
    guestJoined: true,
    maxLevel:    window.__currentSlotMaxLevel || 1
  })
}

export function saveSessionPlaytime() {
  const slot = window.__currentSlot
  if (slot === undefined || !window.__sessionStart) return
  const elapsed = Math.floor((Date.now() - window.__sessionStart) / 1000)
  if (elapsed <= 0) return
  const saves = SaveSystem.getSaves()
  const current = saves[slot]?.playtime || 0
  SaveSystem.setSave(slot, { playtime: current + elapsed })
  window.__sessionStart = Date.now()  // reset for next session segment
}

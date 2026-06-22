import Phaser from 'phaser'
import { PreloadScene } from './scenes/PreloadScene.js'
import { GameScene }    from './scenes/GameScene.js'
import { hideAllForGame, showScreen, showScreenFromGame, setCursorHidden } from '../main.js'
import { SaveSystem } from '../systems/SaveSystem.js'
import { networkClient } from '../network/NetworkClient.js'
import Sfx from '../systems/Sfx.js'
import Transition from '../systems/Transition.js'
import { i18n } from '../utils/i18n.js'
import { gameplayStart, gameplayStop } from '../utils/yandex.js'

let _game = null
let _pauseScene = null  // reference to active GameScene for exit button
let _tickWorker = null  // Web Worker — держит setInterval в фоновых вкладках

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
    Sfx.play('slide') // звук открытия паузы
    if (_pauseScene) _pauseScene._gamePaused = true
    gameplayStop() // Яндекс: пауза → активный геймплей приостановлен
    _openPause()
  } else {
    // Close pause: re-enable game input
    _closePause(true)
  }
}

function _openPause() {
  setCursorHidden(false)
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
  if (resumeGame) setCursorHidden(true)
  if (resumeGame && _pauseScene) {
    _pauseScene._gamePaused = false
    gameplayStart() // Яндекс: вышли из паузы → геймплей продолжается
  }
}

function _showPauseExitConfirm() {
  const modal = document.createElement('div')
  modal.className = 'confirm-modal confirm-framed'
  modal.innerHTML = `
    <div class="confirm-box">
      <p class="confirm-text">${i18n.t('confirm.exit_level')}</p>
      <div class="confirm-buttons">
        <button class="confirm-yes">${i18n.t('confirm.yes')}</button>
        <button class="confirm-no">${i18n.t('confirm.no')}</button>
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

// Called by LevelSelectScreen when host starts, and by network when guest receives game:start.
// Лобби плавно чернеет (1с), уровень собирается за чёрным, затем GameScene.create()
// плавно проявляет его (Transition.fadeIn). Бесшовно.
export function startGame(levelId, role) {
  Transition.fadeOut(() => _doStartGame(levelId, role), 1000)
}

function _doStartGame(levelId, role) {
  hideAllForGame()
  document.getElementById('game-container').classList.remove('hidden')
  document.getElementById('hud').classList.remove('hidden')

  // Store level data globally so GameScene can read it in init()
  window.__l2s = { ...(window.__l2s || {}), levelId, role }
  // Track session start time for playtime tracking (reset when starting fresh game)
  if (!window.__sessionStart) window.__sessionStart = Date.now()

  // ── Разрешение из настроек ── (фреймбуфер пересоздаётся и на лету,
  // см. applyGameResolution — здесь только синхронизация при старте уровня)
  const _res = SaveSystem.getSettings().video?.resolution
    || `${window.screen.width}x${window.screen.height}`

  if (_game) {
    applyGameResolution()
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

  const { w: _resW, h: _resH } = _parseRes(_res)
  _game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game-container',
    backgroundColor: '#060d1a',
    pixelArt: true,
    autoFocus: false,     // не паузить игровой цикл при потере фокуса вкладки
    physics: {
      default: 'arcade',
      arcade: { gravity: { y: 1100 }, debug: false }
    },
    scene: [PreloadScene, GameScene],
    render: {
      // Гарантирует валидный буфер для покадрового drawImage в lowres-канвас
      preserveDrawingBuffer: true,
    },
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width:  320,
      height: 180,
    },
    callbacks: {
      postBoot: game => {
        game.__resCap = _res
        _setupLowResFramebuffer(game, _resW, _resH)
        _setupAspectFill(game)
        game.events.once(Phaser.Core.Events.DESTROY, () => game.__lowresCleanup?.())
        // Отключаем встроенную паузу Phaser на BLUR/HIDDEN
        game.events.off('hidden')
        game.events.off('blur')

        // Web Worker тикает setInterval(16ms) даже в фоновой вкладке.
        // На каждый тик мы вручную шагаем Phaser-loop, если rAF перестал дёргаться.
        _tickWorker = new Worker('game-tick-worker.js')
        let lastWorkerTick = 0
        _tickWorker.onmessage = () => {
          if (!game.loop) return
          const now = performance.now()
          // Если браузер дроссирует rAF (вкладка скрыта) — шагаем сами.
          // Критерий: с последнего нашего тика прошло > 50мс (т.е. rAF не бьёт ~60fps).
          if (now - game.loop.lastTime > 50) {
            game.loop.step(now)
          }
          lastWorkerTick = now
        }
        _tickWorker.postMessage('start')
      }
    }
  })
}

// ── Заполнение экрана: растянуть вместо полос, если вьюпорт ≈16:9 ────────────
// Scale.FIT держит 320:180 (=16:9) и при несовпадении даёт синие полосы. Угадать
// разрешение игрока нельзя (разные мониторы; на Яндексе ещё их плашка сверху,
// блок рекламы справа, хром браузера, таскбар) → реальная область игры почти
// никогда не ровно 16:9. Поэтому смотрим на ФАКТИЧЕСКИЙ вьюпорт игры
// (window.innerWidth/innerHeight — внутри iframe Яндекса это и есть выданная нам
// область, без их плашки/рекламы), а не на физический монитор.
//   • вьюпорт близко к 16:9 (в пределах TOL) → класс .aspect-fill: CSS тянет
//     канвас на всю область — полос нет ни по ширине, ни по высоте (растяжение
//     мягкое, т.к. соотношение почти совпадает; покрывает и lowres-фреймбуфер).
//   • вьюпорт далеко от 16:9 (портрет 9:16 и т.п.) → класс не вешаем: остаётся
//     честный FIT 16:9, сверху/снизу полосы (растягивать сильно — испортить арт).
// TOL=0.30 → диапазон ~4:3 … 21:9 тянется, портрет — letterbox. Один параметр,
// крутится по вкусу: больше — агрессивнее тянет, меньше — раньше уходит в полосы.
function _setupAspectFill(game) {
  const cont = document.getElementById('game-container')
  if (!cont) return
  const TARGET = 16 / 9
  const TOL = 0.30
  const apply = () => {
    const r = window.innerWidth / window.innerHeight
    const within = Math.abs(r - TARGET) / TARGET <= TOL
    cont.classList.toggle('aspect-fill', within)
  }
  apply()
  window.addEventListener('resize', apply)
  document.addEventListener('fullscreenchange', apply)
  game.events.once(Phaser.Core.Events.DESTROY, () => {
    window.removeEventListener('resize', apply)
    document.removeEventListener('fullscreenchange', apply)
    cont.classList.remove('aspect-fill')
  })
}

// ── Низкое разрешение как в нативных играх ──────────────────────────────────
// CSS-растяжки НЕ добавляют пикселизации: браузер сэмплирует битмап канваса
// один раз в финальный размер. Поэтому делаем настоящий промежуточный
// фреймбуфер: канвас resW×resH, куда каждый кадр блитится картинка игры
// (чёткими пикселями), а на экран он растягивается уже со сглаживанием —
// при 1280x720 на 2К картинка реально мыльнее/грубее.
function _setupLowResFramebuffer(game, resW, resH) {
  // Снять предыдущий фреймбуфер (живая смена разрешения из паузы)
  game.__lowresCleanup?.()
  game.__lowresCleanup = null

  // Разрешение не меньше монитора → даунскейла нет, рисуем как обычно
  if (resW >= window.screen.width && resH >= window.screen.height) return

  const cont = document.getElementById('game-container')
  const lr = document.createElement('canvas')
  lr.width = resW
  lr.height = resH
  lr.style.position = 'absolute'
  lr.style.pointerEvents = 'none'
  // Первым ребёнком: .game-light (DOM-свет) и виньетка остаются поверх
  cont.insertBefore(lr, cont.firstChild)
  const ctx = lr.getContext('2d')

  // Letterbox 16:9 тем же правилом, что Scale.FIT у Phaser-канваса
  const layout = () => {
    const sw = window.innerWidth, sh = window.innerHeight
    const k = Math.min(sw / resW, sh / resH)
    const cw = Math.round(resW * k), ch = Math.round(resH * k)
    lr.style.left = `${(sw - cw) / 2}px`
    lr.style.top  = `${(sh - ch) / 2}px`
    lr.style.width  = `${cw}px`
    lr.style.height = `${ch}px`
  }
  layout()
  window.addEventListener('resize', layout)

  // Phaser-канвас делаем невидимым (но он на месте и ловит input);
  // картинку игрок видит через lowres-канвас
  game.canvas.style.opacity = '0'

  const blit = () => {
    ctx.imageSmoothingEnabled = false // 320×180 → resW×resH: чёткие пиксели
    ctx.drawImage(game.canvas, 0, 0, resW, resH)
  }
  game.events.on(Phaser.Core.Events.POST_RENDER, blit)
  game.__lowresCleanup = () => {
    game.events.off(Phaser.Core.Events.POST_RENDER, blit)
    window.removeEventListener('resize', layout)
    lr.remove()
    game.canvas.style.opacity = ''
    game.__lowresCleanup = null
  }
}

// Применить текущее разрешение из настроек к ЗАПУЩЕННОЙ игре (живо, без
// перезахода в уровень). Вызывается из настроек при смене/откате разрешения.
export function applyGameResolution() {
  if (!_game) return
  const res = SaveSystem.getSettings().video?.resolution
    || `${window.screen.width}x${window.screen.height}`
  if (_game.__resCap === res) return
  _game.__resCap = res
  const { w, h } = _parseRes(res)
  _setupLowResFramebuffer(_game, w, h)
}

export function exitToLevelSelect() {
  // Чистый выход из живой игры → больше некуда «возвращаться» (реджойн отменяем).
  SaveSystem.clearRejoin()
  // Воркер живёт столько же, сколько _game — при выходе он больше не нужен
  if (_tickWorker) { _tickWorker.postMessage('stop'); _tickWorker = null }
  // Ядерная страховка: глушим все игровые звуки через глобальный sound manager
  // (на случай если shutdown() сцены не успел или был вызван обход через exitToLevelSelect)
  _game?.sound?.stopByKey('rain-amb')
  _game?.sound?.stopByKey('lamp-hum')
  document.getElementById('game-container').classList.add('hidden')
  document.getElementById('hud').classList.add('hidden')
  // Гарантированно очистить HUD-оверлеи — на случай если shutdown() не успел
  const hp = document.getElementById('hud-prompts')
  const ho = document.getElementById('hud-overlay')
  if (hp) hp.innerHTML = ''
  if (ho) ho.innerHTML = ''

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

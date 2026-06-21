// pako must be global BEFORE Phaser parses any tilemap with zlib compression.
// Phaser looks for window.pako to decompress tile layers — without it map.layers = []
import * as pako from 'pako'
window.pako = pako

import './utils/terminalLog.js'   // browser console → server terminal relay
import { SaveSystem } from './systems/SaveSystem.js'
import { networkClient } from './network/NetworkClient.js'
import { i18n } from './utils/i18n.js'
import { initParticles } from './utils/particles.js'
import { applyBrightness } from './utils/brightness.js'
import { MainMenuScreen } from './screens/MainMenuScreen.js'
import { SettingsScreen } from './screens/SettingsScreen.js'
import { LobbyScreen } from './screens/LobbyScreen.js'
import { LevelSelectScreen } from './screens/LevelSelectScreen.js'
import MusicManager from './systems/MusicManager.js'
import Sfx from './systems/Sfx.js'
import { initYandex, yandexReady, getPlatformLang } from './utils/yandex.js'

const MENU_MUSIC = '/assets/audio/Main%20Theme.mp3'
const screens = {}
let currentScreen = null

// ── UI-звуки ─────────────────────────────────────────────────────────────────
// slide  — НАВЕДЕНИЕ мышью на пункт меню (кнопка подсвечивается) → звук переключения.
//          Играет только при переходе на НОВЫЙ элемент (не повторяется на том же).
//          Пауза даёт slide отдельно (GameManager).
// clickBAD — клик по кнопкам «назад/возврат»: назад в настройках, «Нет»/отмена,
//          продолжить/выйти в паузе.
// LevelStart — клик по «Начать» при выборе уровня.
// clickOK  — клик по любой прочей кнопке (вперёд/подтверждение, выбор профиля и т.д.).
const SFX_HOVER =
	'.menu-item, [data-section], #settings-back-btn, .level-card.unlocked, ' +
	'.lang-btn, .toggle-btn, .default-btn, .keybind-key, .save-slot, ' +
	'.server-item[data-join], #pause-resume, #pause-settings, #pause-exit, ' +
	'.confirm-yes, .confirm-no'
const SFX_BAD = '#settings-back-btn, #lobby-back-btn, .confirm-no, #pause-resume, #pause-exit'
const SFX_START = '#start-game-btn'
const SFX_CLICK =
	'button, .menu-item, .level-card.unlocked, .save-slot, .server-item[data-join], [data-section], [data-clear]'

function bindUiSounds() {
	// Наведение мышью на пункт меню → slide (лишь при смене активного элемента,
	// чтобы не дребезжало при движении внутри одной кнопки).
	let lastHover = null
	document.addEventListener('mouseover', e => {
		const t = e.target.closest(SFX_HOVER)
		if (t === lastHover) return
		lastHover = t
		if (t) Sfx.play('slide')
	})
	// Клик по кнопке → clickBAD / LevelStart / clickOK.
	document.addEventListener(
		'click',
		e => {
			const t = e.target.closest(SFX_CLICK)
			if (!t) return
			if (t.matches(SFX_START)) {
				if (!t.disabled) Sfx.play('levelStart')
				return
			}
			if (t.closest(SFX_BAD)) return Sfx.play('clickBAD')
			if (t.disabled) return
			Sfx.play('clickOK')
		},
		true,
	)
}

// Hollow Knight-style: курсор скрыт в геймплее, виден в меню/паузе/настройках/смерти
export function setCursorHidden(hidden) {
  document.body.classList.toggle('cursor-hidden', hidden)
}

export function showScreen(name, data = {}) {
  setCursorHidden(false)
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
  // Все экраны меню играют общую тему (play идемпотентен → между меню не перезапускается).
  MusicManager.play(MENU_MUSIC)
  if (screens[name]) screens[name].show(data)
}

// Show a screen without hiding the game (used when going pause → settings)
// Automatically passes fromGame:true so the screen knows to add a backdrop
export function showScreenFromGame(name, data = {}) {
  setCursorHidden(false)
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
  setCursorHidden(true)
  // Called by GameManager — properly hides current screen
  if (currentScreen && screens[currentScreen]) {
    screens[currentScreen].hide()
  }
  currentScreen = null
  document.getElementById('pause-menu').classList.add('hidden')
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'))
}

// Выбирал ли игрок язык сам (есть сохранённое значение)? Если да — не перебиваем
// его языком платформы при следующих заходах.
function hasSavedLang() {
  try { if (JSON.parse(localStorage.getItem('l2s_settings'))?.lang) return true } catch {}
  return !!localStorage.getItem('l2s_lang')
}

function init() {
  // Yandex Games SDK: инициализируем и сообщаем платформе о готовности (убрать спиннер).
  // Вне Яндекса оба вызова — пустышки, игра запускается как обычно.
  initYandex().then(() => {
    // При ПЕРВОМ заходе (игрок ещё не выбирал язык сам) показываем игру на языке
    // платформы — этого требует модерация Яндекса. Дальше работает выбор в настройках.
    if (!hasSavedLang()) {
      const pl = getPlatformLang()
      if (pl && pl !== i18n.lang) i18n.setLang(pl)
    }
    yandexReady()
  })

  initParticles()
  bindUiSounds()
  networkClient.connect()
  applyBrightness() // сохранённая яркость с прошлой сессии
  i18n.applyDom()   // перевести статичный HTML на сохранённый язык

  // Fullscreen требует жеста пользователя. Вешаем на 'click'/'keydown' (НЕ pointerdown):
  // requestFullscreen() ресайзит вьюпорт, и если дёрнуть его на pointerdown — между
  // pointerdown и синтезируемым click верстка сдвигается, цель click уезжает с кнопки,
  // и её onclick не срабатывает (первый клик «съедался»). На 'click' цель события уже
  // зафиксирована, а requestFullscreen асинхронен → ресайз произойдёт ПОСЛЕ того, как
  // click долетит до кнопки, поэтому первый же клик и разворачивает экран, и жмёт кнопку.
  // (Музыку поднимает MusicManager._armGesture по pointerdown — она клик не трогает.)
  const FS_EVTS = ['click', 'keydown']
  const tryFullscreen = () => {
    // Уважает настройку «Полный экран» (по умолчанию вкл): если игрок
    // выключил её в настройках — не разворачиваем
    if (SaveSystem.getSettings().video?.fullscreen !== false && !document.fullscreenElement)
      document.documentElement.requestFullscreen?.().catch(() => {})
    for (const e of FS_EVTS) document.removeEventListener(e, tryFullscreen, true)
  }
  for (const e of FS_EVTS) document.addEventListener(e, tryFullscreen, true)

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
        roomName: name || `${i18n.t('ls.world')}${Math.floor(Math.random()*900000+100000)}`,
        role: 'guest',
        maxLevel: level || 1,
        selectedLevel: selectedLevel || null
      })
    }
  })
}

init()

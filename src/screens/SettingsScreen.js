import { showScreen } from '../main.js'
import { SaveSystem } from '../systems/SaveSystem.js'
import { i18n } from '../utils/i18n.js'
import AudioManager from '../game/AudioManager.js'
import MusicManager from '../systems/MusicManager.js'
import { applyBrightness } from '../utils/brightness.js'
import { applyGameResolution } from '../game/GameManager.js'

// Названия действий для ребинда — ключи словаря i18n (читаются в момент рендера)
const KEYBIND_KEYS = ['move_left', 'move_right', 'jump', 'dash', 'down', 'special', 'menu', 'fullscreen']

export class SettingsScreen {
  constructor() {
    this.el      = document.getElementById('screen-settings')
    this.nav     = document.getElementById('settings-nav')
    this.panel   = document.getElementById('settings-panel')
    this.backBtn = document.getElementById('settings-back-btn')
    this.from    = 'main-menu'
    this._state  = 'categories'  // 'categories' | 'section'
    this._onKey  = this._onKeyDown.bind(this)
    this._section = null
    this._setupNav()
    this._setupBack()
    // Тумблер «Полный экран» показывает РЕАЛЬНОЕ состояние браузера:
    // F11/F/Esc меняют его извне → перерисовываем открытую видео-секцию
    document.addEventListener('fullscreenchange', () => {
      if (this._section === 'video' && !this.el.classList.contains('hidden')) {
        this._renderSection('video')
      }
    })
  }

  show({ from = 'main-menu', fromGame = false } = {}) {
    this.from = from
    // When opened over the game, add opaque backdrop so game doesn't show through
    this.el.classList.toggle('in-game', fromGame)
    this.el.classList.remove('hidden')
    window.addEventListener('keydown', this._onKey)
    this._goToCategories()
  }

  hide() {
    // Ушли из настроек с открытым подтверждением разрешения → считаем
    // подтверждённым (иначе таймер молча откатит разрешение уже в игре)
    this._resConfirmClose?.()
    this.el.classList.remove('in-game')
    this.el.classList.add('hidden')
    window.removeEventListener('keydown', this._onKey)
  }

  // ── State 1: category list ──
  _goToCategories() {
    this._state = 'categories'
    this.nav.classList.remove('hidden')
    this.panel.classList.add('hidden')
    this.panel.innerHTML = ''
  }

  // ── State 2: section panel ──
  _goToSection(section) {
    this._state = 'section'
    this.nav.classList.add('hidden')
    this.panel.classList.remove('hidden')
    this._renderSection(section)
  }

  _setupNav() {
    this.el.querySelectorAll('[data-section]').forEach(btn => {
      btn.onclick = () => this._goToSection(btn.dataset.section)
    })
  }

  _setupBack() {
    this.backBtn.onclick = () => {
      if (this._state === 'section') {
        this._goToCategories()
      } else {
        // State 1: go back to wherever we came from
        showScreen(this.from)
      }
    }
  }

  _onKeyDown(e) {
    const menuKey = SaveSystem.getSettings().keybindings.menu || 'Backquote'
    if (e.code === menuKey || e.key === 'Escape') {
      if (this._state === 'section') {
        this._goToCategories()
      } else {
        showScreen(this.from)
      }
    }
  }

  _renderSection(section) {
    this._section = section
    const s = SaveSystem.getSettings()
    if (section === 'language')  this.panel.innerHTML = this._langHTML(s)
    if (section === 'audio')     this.panel.innerHTML = this._audioHTML(s)
    if (section === 'video')     this.panel.innerHTML = this._videoHTML(s)
    if (section === 'keyboard')  this.panel.innerHTML = this._keyboardHTML(s)
    if (section === 'gameplay')  this.panel.innerHTML = this._gameplayHTML(s)
    this._attachEvents(section, s)
  }

  _langHTML(s) {
    return `
      <div class="settings-row">
        <label>Язык / Language</label>
        <div style="display:flex;gap:0.42vw">
          <button class="lang-btn ${s.lang==='ru'?'active':''}" data-lang="ru">Русский</button>
          <button class="lang-btn ${s.lang==='en'?'active':''}" data-lang="en">English</button>
        </div>
      </div>`
  }

  _audioHTML(s) {
    return ['master','music','sfx'].map(k => `
      <div class="settings-row">
        <label>${i18n.t(`settings.${k}`)}</label>
        <div style="display:flex;align-items:center;gap:0.52vw">
          <input type="range" min="0" max="10" value="${s.audio[k]}" data-audio="${k}" />
          <span class="range-val" id="val-${k}">${s.audio[k]}</span>
        </div>
      </div>`).join('') +
      `<button class="default-btn" data-default="audio">${i18n.t('settings.default')}</button>`
  }

  _videoHTML(s) {
    const nw = window.screen.width, nh = window.screen.height
    const native = `${nw}x${nh}`
    // Пресеты только СТРОГО меньше монитора: равные/большие не предлагаем —
    // их заменяет пункт «(ваш монитор)» (и больше монитора не отобразить)
    const presets = ['1280x720', '1920x1080', '2560x1440'].filter(r => {
      const [w, h] = r.split('x').map(Number)
      return w < nw && h < nh
    })
    const opts = [...presets, native]
    // Реальное состояние полноэкранного режима, а не сохранённая настройка
    const fsOn = !!document.fullscreenElement
    return `
      <div class="settings-row">
        <label>${i18n.t('settings.resolution')}</label>
        <select class="settings-select" data-video="resolution">
          ${opts.map(r => `<option value="${r}" ${s.video.resolution===r?'selected':''}>${r}${r===native?i18n.t('settings.your_monitor'):''}</option>`).join('')}
        </select>
      </div>
      <div class="settings-row">
        <label>${i18n.t('settings.fullscreen')}</label>
        <button class="toggle-btn ${fsOn?'on':''}" data-video="fullscreen">
          ${fsOn ? i18n.t('settings.on') : i18n.t('settings.off')}
        </button>
      </div>
      <div class="settings-row">
        <label>${i18n.t('settings.brightness')}</label>
        <div style="display:flex;align-items:center;gap:0.52vw">
          <input type="range" min="1" max="10" value="${s.video.brightness}" data-audio="brightness" data-video="brightness"/>
          <span class="range-val" id="val-brightness">${s.video.brightness}</span>
        </div>
      </div>
      <button class="default-btn" data-default="video">${i18n.t('settings.default')}</button>`
  }

  _gameplayHTML(s) {
    const on = !!s.playAsBot
    const syncOn = !!s.syncAbilityClose
    return `
      <div class="settings-row">
        <label>${i18n.t('settings.play_as_bot')}</label>
        <button class="toggle-btn ${on?'on':''}" data-bot="toggle">${on ? i18n.t('confirm.yes') : i18n.t('confirm.no')}</button>
      </div>
      <div class="settings-row" style="opacity:0.5;font-size:0.667vw">
        <label style="font-size:0.667vw">${i18n.t('settings.bot_hint')}</label>
      </div>
      <div class="settings-row">
        <label>${i18n.t('settings.sync_ability_close')}</label>
        <button class="toggle-btn ${syncOn?'on':''}" data-syncability="toggle">${syncOn ? i18n.t('settings.on') : i18n.t('settings.off')}</button>
      </div>
      <div class="settings-row" style="opacity:0.5;font-size:0.667vw">
        <label style="font-size:0.667vw">${i18n.t('settings.sync_ability_hint')}</label>
      </div>`
  }

  _keyboardHTML(s) {
    return KEYBIND_KEYS.map(k => `
      <div class="keybind-row">
        <span>${i18n.t(`key.${k}`)}</span>
        <button class="keybind-key" data-bind="${k}">${this._keyName(s.keybindings[k])}</button>
      </div>`).join('') +
      `<button class="default-btn" data-default="keyboard" style="margin-top:0.83vw">${i18n.t('settings.default')}</button>`
  }

  _keyName(code) {
    if (!code) return '—'
    if (code === 'Mouse2') return i18n.t('key.rmb')
    if (code === 'Backquote') return '` / Ё'
    return code.replace('Key','').replace('Arrow','↑↓').replace('ShiftLeft','Shift L').replace('ShiftRight','Shift R').replace('Space',i18n.t('key.space'))
  }

  _attachEvents(section, s) {
    // Language
    this.panel.querySelectorAll('[data-lang]').forEach(btn => {
      btn.onclick = () => {
        s.lang = btn.dataset.lang; SaveSystem.setSettings(s); i18n.setLang(s.lang)
        this._renderSection('language')
      }
    })
    // Audio sliders
    this.panel.querySelectorAll('[data-audio]').forEach(input => {
      input.oninput = () => {
        const k = input.dataset.audio
        const v = +input.value
        if (k === 'brightness') { s.video.brightness = v; applyBrightness(v) } else { s.audio[k] = v }
        SaveSystem.setSettings(s)
        AudioManager.applyAll()
        MusicManager.applyVolume()
        const el = document.getElementById(`val-${k}`)
        if (el) el.textContent = v
      }
    })
    // Video select
    this.panel.querySelectorAll('[data-video]').forEach(el => {
      if (el.tagName === 'SELECT') {
        el.onchange = () => {
          const prev = s.video.resolution
          if (el.value === prev) return
          s.video.resolution = el.value
          SaveSystem.setSettings(s)
          applyGameResolution() // запущенная игра перестраивает фреймбуфер сразу
          this._showResolutionConfirm(prev)
        }
      }
      if (el.classList.contains('toggle-btn')) {
        el.onclick = () => {
          const wantFs = !document.fullscreenElement
          s.video.fullscreen = wantFs // запоминаем как предпочтение для запуска
          SaveSystem.setSettings(s)
          if (wantFs) document.documentElement.requestFullscreen?.().catch(() => {})
          else document.exitFullscreen?.()
          // Перерисовка придёт из fullscreenchange (фактическое состояние)
        }
      }
    })
    // Gameplay: автобот вкл/выкл
    this.panel.querySelectorAll('[data-bot]').forEach(btn => {
      btn.onclick = () => {
        s.playAsBot = !s.playAsBot
        SaveSystem.setSettings(s)
        this._renderSection('gameplay')
      }
    })
    // Gameplay: синхронное закрытие окна способности вкл/выкл
    this.panel.querySelectorAll('[data-syncability]').forEach(btn => {
      btn.onclick = () => {
        s.syncAbilityClose = !s.syncAbilityClose
        SaveSystem.setSettings(s)
        this._renderSection('gameplay')
      }
    })
    // Keybindings
    this.panel.querySelectorAll('[data-bind]').forEach(btn => {
      btn.onclick = () => {
        btn.classList.add('listening')
        btn.textContent = '...'
        const handler = (e) => {
          e.preventDefault()
          s.keybindings[btn.dataset.bind] = e.code
          SaveSystem.setSettings(s)
          btn.classList.remove('listening')
          btn.textContent = this._keyName(e.code)
          window.removeEventListener('keydown', handler)
        }
        window.addEventListener('keydown', handler)
      }
    })
    // Default buttons
    this.panel.querySelectorAll('[data-default]').forEach(btn => {
      btn.onclick = () => {
        SaveSystem.resetSection(section)
        applyBrightness()
        AudioManager.applyAll()
        MusicManager.applyVolume()
        this._renderSection(section)
      }
    })
  }

  // Как в Windows: 10 секунд на подтверждение нового разрешения,
  // иначе автоматически откатываемся на прежнее
  _showResolutionConfirm(prev) {
    const modal = document.createElement('div')
    modal.className = 'confirm-modal confirm-top'
    // Из игры (пауза → настройки) — без затемнения вовсе
    if (this.el.classList.contains('in-game')) modal.classList.add('confirm-clear')
    modal.innerHTML = `
      <div class="confirm-box">
        <p class="confirm-text">${i18n.t('settings.res_confirm')}</p>
        <p class="confirm-countdown">${i18n.t('settings.res_revert_before')}<span>10</span>${i18n.t('settings.res_revert_after')}</p>
        <div class="confirm-timer-bar"></div>
        <div class="confirm-buttons">
          <button class="confirm-yes">${i18n.t('settings.save')}</button>
          <button class="confirm-no">${i18n.t('settings.cancel')}</button>
        </div>
      </div>`
    document.body.appendChild(modal)

    // Центр полосы между верхом экрана и заголовком «Настройки»
    // (0.56 вместо 0.5 — на глаз блок казался прижатым к верху)
    const box = modal.querySelector('.confirm-box')
    const titleTop = this.el.querySelector('.settings-title')?.getBoundingClientRect().top
      ?? window.innerHeight * 0.25
    modal.style.paddingTop = `${Math.max(0, titleTop * 0.56 - box.offsetHeight / 2)}px`

    const span = modal.querySelector('.confirm-countdown span')
    let left = 10
    const timer = setInterval(() => {
      left--
      span.textContent = left
      if (left <= 0) revert()
    }, 1000)

    const close = () => { clearInterval(timer); modal.remove(); this._resConfirmClose = null }
    const revert = () => {
      const s = SaveSystem.getSettings()
      s.video.resolution = prev
      SaveSystem.setSettings(s)
      applyGameResolution() // откат тоже применяем к запущенной игре сразу
      close()
      if (this._section === 'video') this._renderSection('video')
    }
    this._resConfirmClose = close // для hide(): уход с экрана = подтверждение
    modal.querySelector('.confirm-yes').onclick = close
    modal.querySelector('.confirm-no').onclick = revert
  }
}

import Phaser from 'phaser'
import { Player } from '../entities/Player.js'
import { BotController } from '../BotController.js'
import { RainEffect } from '../effects/RainEffect.js'
import { RainSlideEffect } from '../effects/RainSlideEffect.js'
import { WireEffect } from '../effects/WireEffect.js'
import { BushEffect } from '../effects/BushEffect.js'
import { SoftLightPipeline } from '../effects/SoftLightPipeline.js'
import { networkClient } from '../../network/NetworkClient.js'
import { SaveSystem } from '../../systems/SaveSystem.js'
import {
	exitToLevelSelect,
	saveSessionPlaytime,
	togglePause,
} from '../GameManager.js'
import { setCursorHidden } from '../../main.js'
import AudioManager from '../AudioManager.js'
import MusicManager from '../../systems/MusicManager.js'
import Transition from '../../systems/Transition.js'
import { i18n } from '../../utils/i18n.js'

// Фоновая музыка по уровням (HTML5 Audio, см. MusicManager). Нет записи → тишина.
const LEVEL_MUSIC = {
	1: '/assets/audio/Level1.mp3',
	2: '/assets/audio/Level2.mp3',
}

// Параллакс level1 (px-1..px-7) идёт по глубинам -20..-12, px-1 (фон) непрозрачен
// и кроет весь экран. -1000 гарантированно ЗА параллаксом → горы/город перекрывают.
// Прячем И глубиной (за параллакс), И setVisible(false) — двойная гарантия.
const DOOR_BEHIND = -1000
const LAMP_HUM_VOL = 1.5 // множитель громкости гудения ламп (×1.5 от 1.0; итог зажат в 1.0)
const DOOR_FRONT_UNDER = 9 // PNG-створка под игроком (depth 10)
const DOOR_FRONT_OVER = 11 // PNG-створка над игроком → проход сквозь дверь

// Форматирует KeyboardEvent.code в читаемую метку для подсказок.
function keyCodeToLabel(code) {
	if (!code) return '?'
	const map = {
		ShiftLeft: 'Shift',
		ShiftRight: 'Shift',
		ControlLeft: 'Ctrl',
		ControlRight: 'Ctrl',
		AltLeft: 'Alt',
		AltRight: 'Alt',
		Space: i18n.t('key.space'),
		ArrowLeft: '←',
		ArrowRight: '→',
		ArrowUp: '↑',
		ArrowDown: '↓',
		Backquote: '`',
		BracketLeft: '[',
		BracketRight: ']',
		Semicolon: ';',
		Quote: "'",
		Comma: ',',
		Period: '.',
		Slash: '/',
		Minus: '-',
		Equal: '=',
		Backslash: '\\',
	}
	if (map[code]) return map[code]
	if (code.startsWith('Key')) return code.slice(3)
	if (code.startsWith('Digit')) return code.slice(5)
	return code
}

// Показывает/скрывает HK-стилизованный prompt с CSS-анимациями.
// onHidden — опциональный callback после завершения exit-анимации.
function _showHkPrompt(el, visible, onHidden) {
	if (visible) {
		el.style.display = ''
		el.querySelectorAll('.hk-orn, .hk-text').forEach(c => {
			c.style.animation = 'none'
			void c.offsetWidth
			c.style.animation = ''
		})
		return
	}
	// Exit animations
	const top = el.querySelector('.hk-orn-top')
	const bot = el.querySelector('.hk-orn-bot')
	const txt = el.querySelector('.hk-text')
	const reset = c => {
		c.style.animation = 'none'
		void c.offsetWidth
	}
	if (top) {
		reset(top)
		top.style.animation = 'hkOrnTopOut 0.30s ease-in forwards'
	}
	if (bot) {
		reset(bot)
		bot.style.animation = 'hkOrnBottomOut 0.30s ease-in forwards'
	}
	if (txt) {
		reset(txt)
		txt.style.animation = 'hkTextOut 0.25s ease-in forwards'
	}
	setTimeout(() => {
		el.style.display = 'none'
		el.querySelectorAll('.hk-orn, .hk-text').forEach(
			c => (c.style.animation = ''),
		)
		onHidden?.()
	}, 320)
}

// Log to browser console + npm terminal simultaneously
function tlog(...args) {
	console.log(...args)
	const msg = args
		.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a)))
		.join(' ')
	fetch('http://localhost:3000/_log', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ args: [msg] }),
	}).catch(() => {})
}

const CAM_W = 1280,
	CAM_H = 720
const WORLD_W = 1280
const WORLD_H = 4000
const ENTER_PAD = 256 // на сколько px отодвигаем левую границу мира на входе (игрок за картой)
// Уровни, чей baked PNG (level{N}.png) содержит ВЕСЬ визуал карты → тайл-слои не рендерим
// (берём готовую картинку целиком). У level1 запечён только фон back2/back — он не здесь.
const BAKED_FULL_LEVELS = new Set([2])
// Уровни с дождём (сам дождь + брызги + стекающие капли + фоновый шум). Пока только level1.
const RAIN_LEVELS = new Set([1])
// Уровни с дверью (PNG-створки level1-door-*). Дверь — механика только первого уровня.
const DOOR_LEVELS = new Set([1])

function toPhKey(code) {
	if (!code) return 'A'
	const map = {
		Space: 'SPACE',
		ShiftLeft: 'SHIFT',
		ShiftRight: 'SHIFT',
		ControlLeft: 'CTRL',
		ControlRight: 'CTRL',
		ArrowLeft: 'LEFT',
		ArrowRight: 'RIGHT',
		ArrowUp: 'UP',
		ArrowDown: 'DOWN',
	}
	if (map[code]) return map[code]
	if (code.startsWith('Key')) return code.slice(3)
	return code
}

export class GameScene extends Phaser.Scene {
	constructor() {
		super('GameScene')
	}

	init(data) {
		// Гасим звуки предыдущей сессии — init() вызывается при любом переходе (restart/stop+start)
		this.sound?.stopByKey('rain-amb')
		this.sound?.stopByKey('lamp-hum')
		const src = data && data.levelId ? data : window.__l2s || {}
		this.levelId = src.levelId || 1
		this.role = src.role || 'host'
		this._netUnsub = []
		this._syncTimer = 0
		this._orbCollected = false
		this._orbNearby = false // игрок в зоне подбора орба
		this._orbInteracting = false // ЛКМ нажата, анимация атаки играет
		this._orbPromptEl = null // DOM элемент «Собрать» над орбом
		this._orbSprite = null // видимый спрайт орба
		this._worldLabels = [] // [{el,wx,wy}] DOM текст в мировых координатах
		this._levelCompleteEl = null // DOM оверлей завершения уровня
		this._abilityOverlayEl = null // DOM оверлей получения способности
		this._inputLocked = false // true → updateLocal пропускается (кинематик)
		this._dying = false // true → анимация смерти / экран гибели
		this._deathZones = [] // зоны смерти из Tiled
		this._deathOverlayEl = null // DOM оверлей "Вы погибли"
		this._reviveOverlayEl = null // DOM оверлей «Второй шанс» / реклама (в #hud-overlay)
		this._reviveTimer = null // таймер 5с до отката на обычный экран смерти
		this._lastSafePos = null // последняя «безопасная» земля (для воскрешения)

		this._localTrail = null // { g: Graphics, pts: [] } — trail дэша local
		this._remoteTrail = null // trail дэша remote
		this._testOrbs = [] // тестовые орбы для анимаций
		this._exiting = false
		this._gamePaused = false
		this._exitZone = null
		this._lights = [] // [{el, wx, wy, radius}] — DOM radial-glow поверх холста (type="light")
		// Точки lampsound (type="lampsound") — по одной у КАЖДОЙ лампы. У каждой свой
		// зацикленный гул, громкость по дистанции до игрока. [{x,y,id,hum}].
		this._lampSounds = []
		this._rainAmb = null // зацикленный фоновый шум дождя (на всю карту, тихо)
		this._ambDuck = 1 // приглушение фоновых звуков (дождь/лампы) на оверлее способности
		this._lampLeverPos = null // {x,y} точка объекта type="lamplever" → "Осмотреть"
		this._lampLeverPromptEl = null // DOM-prompt «Осмотреть» над lamplever
		this._lampLeverNearby = false
		this._lampLeverActivated = false // orb уже сдвинут → не показывать повторно
		this._lampActivatedByMe = false // lamplever активировал именно Я (для анимации удара)
		this._orbDestination = null // {x,y} куда летит орб (объект orbdestination)
		this._orbBobTween = null // ссылка на боббинг-твин → останавливаем перед полётом
		this._orbArrived = false // орб ещё не долетел → нельзя подобрать
		this._visualSyncTimer = 0 // хост: таймер рассылки визуального состояния
		this._visualSyncTarget = null // гость: последний принятый снапшот
		this._parallaxLayers = [] // [{sprite, sfX, sfY, driftX, driftY, _driftAccX, _driftAccY}]
		this._driftSprites = [] // [{spr, velX, _acc}] — декоративные спрайты с pixel-точным движением
		console.log('[GameScene] init levelId=', this.levelId, 'role=', this.role)
	}

	create() {
		// Hollow Knight: в геймплее курсор скрыт (важно при рестарте после смерти)
		setCursorHidden(true)
		// ── Диагностика: перехват любых необработанных ошибок → в терминал (tlog).
		// Иначе крэш при сборке уровня уходит только в браузерную консоль.
		if (!window.__l2sErrHook) {
			window.__l2sErrHook = true
			window.addEventListener('error', e =>
				tlog(
					`[ERROR] ${e.message} @ ${e.filename}:${e.lineno}:${e.colno}\n${e.error?.stack || ''}`,
				),
			)
			window.addEventListener('unhandledrejection', e =>
				tlog(
					`[REJECT] ${e.reason?.message || e.reason}\n${e.reason?.stack || ''}`,
				),
			)
		}
		tlog('[GameScene] create() START')

		// Фоновая музыка уровня (фейд-ин; смена/выход → фейд-аут в MusicManager).
		// Любой путь входа/рестарта сцены проходит здесь → трек всегда верный.
		const _track = LEVEL_MUSIC[this.levelId]
		if (_track) MusicManager.play(_track)
		else MusicManager.stop()

		// displayScale = во сколько раз Phaser масштабирует canvas 320×180 до экрана.
		// setResolution(ds) заставляет текст рендериться в ds× выше → HD качество.
		const _res = SaveSystem.getSettings().video?.resolution || '1920x1080'
		this._ds = Math.max(
			2,
			Math.round((Number(_res.split('x')[0]) || 1920) / 320),
		)

		tlog(`[GameScene] ══ BUILD 2026-05-27-D  levelId=${this.levelId} ══`)
		tlog(
			`[GameScene] tilemap_packed loaded : ${this.textures.exists('tilemap_packed')}`,
		)
		tlog(
			`[GameScene] level${this.levelId} in cache: ${this.cache.tilemap.exists('level' + this.levelId)}`,
		)

		// World + camera bounds are set inside _buildFromTiledMap() from map.widthInPixels/heightInPixels
		// Fallback values used for _buildLevel10() / _buildStub() which don't call Tiled:
		this.physics.world.setBounds(0, 0, WORLD_W, WORLD_H)
		this.cameras.main.setBounds(0, 0, WORLD_W, WORLD_H)

		// Light2D: тёмный ambient → поверхности на этом пайплайне (тайл-слои + игроки)
		// по умолчанию приглушены, а точечные источники света «вылепляют» рельеф по
		// нормалям. Параллакс-фон НЕ на Light2D (см. _createParallaxBg) — небо яркое.
		this._lightingActive = false // ставится в _buildLevel(), читается ниже для игроков
		this._rainLights = [] // источники подсветки дождя/капель — по одному на КАЖДУЮ лампу
		// Регистрируем кастомный Light-пайплайн (мягкие швы между тайлами). На Canvas
		// (нет WebGL) откатываемся на штатный 'Light2D'. Ключ используется для всех
		// setPipeline ниже. has() — чтобы не дублировать при рестарте сцены.
		this._lightPipelineKey = 'Light2D' // тайлы/фон — полная сила света
		this._playerLightKey = 'Light2D' // персонажи — ослабленная сила света
		const renderer = this.sys.renderer
		if (renderer.type === Phaser.WEBGL) {
			// Пере-регистрируем каждый старт сцены (remove→add): иначе при HMR/рестарте
			// остаётся СТАРЫЙ скомпилированный GLSL, и правки LIGHT_HEIGHT/NORMAL_STRENGTH
			// «не применяются». Слабый вариант (0.4) — свет влияет на персонажей меньше.
			if (renderer.pipelines.has('SoftLight'))
				renderer.pipelines.remove('SoftLight')
			if (renderer.pipelines.has('SoftLightWeak'))
				renderer.pipelines.remove('SoftLightWeak')
			renderer.pipelines.add('SoftLight', new SoftLightPipeline(this.game))
			renderer.pipelines.add(
				'SoftLightWeak',
				new SoftLightPipeline(this.game, 0.4),
			)
			this._lightPipelineKey = 'SoftLight'
			this._playerLightKey = 'SoftLightWeak'
		}
		// AMBIENT = «основной источник света» (лунный фон). Шейдер мультипликативен:
		// итог = текстура × (ambient + свет ламп). Слишком тёмный ambient → передний
		// план почти чёрный; лампы лишь добавляют пятна СВЕРХУ. Поэтому держим средне-
		// тёмный сине-серый: террейн читается как ночь, а лампы усиливают вокруг себя.
		// Крути AMBIENT: ярче = светлее база (меньше контраст пятен), темнее = мрачнее.
		const AMBIENT = 0x636f8e // средне-тёмный сине-серый «лунный» (~40%)
		this.lights.enable().setAmbientColor(AMBIENT)

		// Сбрасываем ДО _buildLevel: px-слой с light:true создаст свет в цикле объектов.
		this._cloudLight = null
		this._wirePoints = [] // точки проводов (type:"wire"), собираются в _buildLevel
		this._wireDest = null // {x,y} объекта type:"wiredest" — куда падает оторванный конец провода
		// Шаги: footstep00..09 по кругу при ходьбе local-игрока. Постоял >1с → сброс на 0.
		this._footIdx = 0 // следующий индекс шага (0..9)
		this._footTimer = 0 // мс с последнего шага
		this._footStillMs = 0 // мс без ходьбы (для сброса на первый шаг)
		this._footWasWalking = false // шёл ли в прошлом кадре (первый шаг — сразу)
		this._fallenWire = null // упавший конец провода {w,xk,yk,...} — хаотично болтается по X
		this._bushPoints = [] // точки кустов (type:"kust"), собираются в _buildLevel
		this._rainSlideZones = [] // прямоугольники стен (type:"rainslide") для стекающих капель
		this._camRightLimit = null // x правой границы камеры (объект type:"rightcorner"), null = вся карта
		this._camFocusPoint = null // {x,y} объекта type:"camera" (слой cameramove) — куда вести камеру при lamplever
		this._camFocus = null // активный фокус камеры: {x,y,until} (мс). null = следим за игроком
		// Рычаги: [{ body, group, btn, texOff, texOn }].
		//   group 1 — обычная кнопка двери (оба игрока, сетевая синхронизация двери)
		//   group 2 — кнопка ХОСТА (btnhost*), текст finaltext по касанию хоста
		//   group 3 — кнопка ГОСТЯ (btnplayer*), текст finaltext по касанию гостя
		this._levers = []
		this._leverOpen = false
		this._localOnLever = false // СВОЁ касание рычага группы 1 (вещаем партнёру)
		this._remoteOnLever = false // касание партнёра (приходит по сети)
		// Финальные кнопки/текст (реактивно: текст активен пока игрок стоит на кнопке).
		this._hostReached = false
		this._guestReached = false
		this._finalTextEl = null // DOM-элемент finaltext (контейнер)
		this._finalLine1 = null // DOM строка хоста
		this._finalLine2 = null // DOM строка гостя
		this._finalLine1Shown = '' // последний показанный plain-текст строки 1
		this._finalLine2Shown = ''
		this._levelFinished = false // оба игрока встали на финальные кнопки → конец уровня, управление снято
		this._endCutscene = false // активна катсцена конца уровня (камера не следит за игроком)
		this._entering = false // активна катсцена входа (игрок выходит из-за левой стены на позицию)
		this._enterTargetX = 0 // мировой x точки покоя, до которой идёт игрок на входе
		this._spawnHost = null // {x,y} точки покоя хоста (объект spawnhost)
		this._spawnGuest = null // {x,y} точки покоя гостя (объект spawnguest)
		this._spawn1 = null // {x,y} начальный спавн хоста за картой (объект spawn1)
		this._spawn2 = null // {x,y} начальный спавн гостя за картой (объект spawn2)
		this._botPoints = [] // [{n,x,y}] точки маршрута автобота (type="bot", id=1..N, слой "bot")
		this._bot = null // активный BotController (только если включён в настройках и роль guest)
		this._botActive = false // true → оранжевым управляет бот, ручной ввод заблокирован
		this._finalTextPos = null // {x,y} объекта finaltext
		this._krugPos = null // {x,y} объекта krug (фолбэк-центр круга, если игроков нет)
		this._irisEl = null // DOM (canvas) круг-диафрагма (затемнение экрана в финале)
		this._titleLineEl = null // большая надпись «Уровень N Пройден!» (внутри finaltext)
		// Door visuals = полноразмерные PNG поверх карты (см. _buildFromTiledMap).
		// И закрытая, и открытая дверь разбиты на две половины:
		//   *1 — ПОД игроком (depth 9) | *2 — НАД игроком (depth 11) → эффект прохода сквозь дверь
		this._doorImgClosed1 = null
		this._doorImgClosed2 = null
		this._doorImgOpen1 = null
		this._doorImgOpen2 = null

		this._buildLevel()
		tlog('[GameScene] _buildLevel() done')
		this._createParallaxBg()
		tlog('[GameScene] _createParallaxBg() done')

		// Правый предел камеры (объект type:"rightcorner"): сдвигаем ПРАВУЮ границу
		// камеры к его x → камера не показывает правее. Левая граница = 0 (влево
		// свободно). Физика мира не трогается — игрок может идти правее, камера стоит.
		if (this._camRightLimit != null) {
			const cam = this.cameras.main
			const b = cam.getBounds()
			const w = Math.max(cam.width, this._camRightLimit - b.x)
			cam.setBounds(b.x, b.y, w, b.height)
		}

		// Болтающиеся провода: объекты type:"wire" парами по свойству group.
		this._wire = null // сброс на рестарте сцены (старый Graphics уже уничтожен)
		const wireDefs = this._buildWireDefs(this._wirePoints)
		if (wireDefs.length) {
			this._wire = new WireEffect(this, wireDefs)
			this._wire.create()
		}
		tlog(
			`[GameScene] wire done (${wireDefs.length}), lights=${this._lights.length}, rainLights=${this._rainLights.length}`,
		)

		// Сухие кусты: объекты type:"kust" — процедурное ветвление + качание от ветра.
		this._bush = null
		if (this._bushPoints.length) {
			this._bush = new BushEffect(this, this._bushPoints)
			this._bush.create()
		}

		// Дождь (сам дождь + брызги + стекающие капли + фоновый шум) — только на RAIN_LEVELS.
		// На прочих уровнях объекты rainlayer (если остались от копирования) игнорируем.
		this._rainSlide = null
		this._rain = null
		if (RAIN_LEVELS.has(this.levelId)) {
			// Стекающие капли по стене: прямоугольники type:"rainslide".
			if (this._rainSlideZones.length) {
				this._rainSlide = new RainSlideEffect(this, this._rainSlideZones)
				this._rainSlide.create()
			}

			// Пиксельный дождь поверх всего (depth 1000 > игроки 10). Dead Cells стиль.
			// splashZones — мировые «линии пола» из объектов type:"rain" слоя rainlayer,
			// собранные в _buildLevel(). Дождь спавнит на них всплески в точках падения.
			this._rain = new RainEffect(this, {
				intensity: 1.0,
				splashZones: this._rainSplashZones || [],
			})
			this._rain.create()
			tlog('[GameScene] rain + slide effects created')
			// Дождь/капли ловят свет ВСЕХ ламп уровня (массив из _makeLight). Общие ссылки
			// → мерцание каждой лампы передаётся через её rainLight.intensity.
			this._rain.lights = this._rainLights
			if (this._rainSlide) this._rainSlide.lights = this._rainLights

			// Фоновый шум дождя — тихий глобальный луп, если в уровне есть объект rain
			if (this._hasRainAmb && this.cache.audio.exists('rain-amb')) {
				this.sound.stopByKey('rain-amb') // убить стейл-экземпляр от предыдущей сцены
				this._rainAmb = this.sound.add('rain-amb', { loop: true, volume: 0 })
				this._rainAmb.play()
				// volume updated every frame in _updateRainAudio()
			}
		} else {
			this.sound.stopByKey('rain-amb') // на не-дождливом уровне глушим возможный стейл-луп
		}

		// Звук лампы: зацикленное гудение в точке объекта "lampsound" (громкость по
		// дистанции до игрока). Создаётся только если файл загружен (пока нет — тихо
		// пропускаем). Щелчки на миги триггерит _updateLightFlicker.
		this._initLampAudio()

		// Свет живёт в #game-container (не в HUD-контейнерах, что чистит exitToLevelSelect),
		// поэтому гарантированно убираем DOM-узлы на shutdown сцены. Идемпотентно с shutdown().
		this.events.once('shutdown', () => {
			for (const L of this._lights) L.el?.remove()
			this._lights = []
			// Снять все мировые DOM-метки. Иначе текст вроде finaltext «залипает» на
			// экране после рестарта/смерти (метод shutdown() не привязан к событию).
			for (const lbl of this._worldLabels) lbl.el?.remove()
			this._worldLabels = []
			// Остановить все активные флип-таймеры и звуки прокрутки (хранятся на элементах).
			for (const e of [this._titleLineEl, this._finalLine1, this._finalLine2]) {
				if (e && e._flipTimer) clearInterval(e._flipTimer)
				if (e && e._flipSound) {
					e._flipSound.stop()
					e._flipSound.destroy()
				}
			}
			this._finalTextEl = null
			this._finalLine1 = null
			this._finalLine2 = null
			this._titleLineEl = null
			this._setCinemaBars(false, 0) // убрать киношные полосы при рестарте/выходе (мгновенно)
			MusicManager.setDuck(1) // на случай выхода с открытым оверлеем способности
			this._irisEl?.remove() // убрать круг-диафрагму финала
			this._irisEl = null
		})

		const localTex = this.role === 'host' ? 'blue-knight' : 'orange-knight'
		const remoteTex = this.role === 'host' ? 'orange-knight' : 'blue-knight'

		const spawn = this._getSpawn() // свой начальный спавн за картой (по роли)
		const rspawn = this._getRemoteSpawn() // спавн партнёра (другая роль)
		this.localPlayer = new Player(this, spawn.x, spawn.y, localTex, true)
		this.remotePlayer = new Player(this, rspawn.x, rspawn.y, remoteTex, false)

		// Освещение: при активном Light2D игроки тоже ловят свет от ламп/орба —
		// в тёмных зонах приглушены, у источника света подсвечиваются.
		if (this._lightingActive) {
			this.localPlayer.setPipeline(this._playerLightKey)
			this.remotePlayer.setPipeline(this._playerLightKey)
		}

		this.remotePlayer.body.setAllowGravity(false)
		this.remotePlayer.body.setImmovable(true)

		this.physics.add.collider(this.localPlayer, this.platforms)
		this.physics.add.collider(this.localPlayer, this.dynamicPlatforms)
		if (this.door) this.physics.add.collider(this.localPlayer, this.door)

		if (this._exitZone) {
			this.physics.add.overlap(this.localPlayer, this._exitZone, () =>
				this._exitLevel(),
			)
		}

		for (const dz of this._deathZones) {
			this.physics.add.overlap(this.localPlayer, dz, () => this._triggerDeath())
		}

		this._grantPreviousAbilities()

		// ── Camera: 1 world unit = 1 big pixel, zoom=1.0 always ──
		// Canvas 320×180 — Scale.FIT multiplies: ×4 on 720p, ×6 on 1080p, ×8 on 2K
		// this.game.scale = Phaser ScaleManager (≠ this.scale which is sprite Size component)
		// setMaxSize caps the display size to the resolution from video settings
		// При входе кадр зафиксирован на точке покоя (игрок появляется из-за левого края
		// экрана и доходит до неё). Без входа — камера сразу на самом спавне.
		const camAnchor = this._hasEntrance() ? this._getRestTarget() : spawn
		this._camTarget = { x: camAnchor.x, y: camAnchor.y }
		// Фолбэк безопасной точки: точка покоя/спавн (на случай смерти до того, как
		// _recordSafeGround нашёл «хорошее» место). Дальше перезаписывается в update.
		this._lastSafePos = { x: camAnchor.x, y: camAnchor.y }
		this.cameras.main.setZoom(1.0)
		// lerpX/Y = 1.0: камера мгновенно на _camTarget (вся плавность — в _updateCamera)
		this.cameras.main.startFollow(this._camTarget, true, 1.0, 1.0)
		// Игрок стоит на ~35% высоты экрана СНИЗУ (= 65% сверху, на 27 ед. ниже центра).
		// Холст 180 ед.: screenY = 90 + offset → offset +27 даёт y≈117 = 35% от низа.
		this.cameras.main.setFollowOffset(0, 27)
		// Кап разрешения теперь в GameManager (scale.max + CSS-растяжка канваса):
		// scale.setMaxSize не существует в Phaser и молча падал в try/catch

		// Input keys
		const bindings = SaveSystem.getSettings().keybindings
		const keyLeft = toPhKey(bindings.move_left) || 'A'
		const keyRight = toPhKey(bindings.move_right) || 'D'
		const keyJump = toPhKey(bindings.jump) || 'SPACE'
		const keyDash = toPhKey(bindings.dash) || 'SHIFT'
		const keyDown = toPhKey(bindings.down) || 'S'
		console.log('[GameScene] Keys:', {
			keyLeft,
			keyRight,
			keyJump,
			keyDash,
			keyDown,
		})
		this.keys = {
			left: this.input.keyboard.addKey(keyLeft),
			right: this.input.keyboard.addKey(keyRight),
			jump: this.input.keyboard.addKey(keyJump),
			jumpW: this.input.keyboard.addKey('W'),
			dash: this.input.keyboard.addKey(keyDash),
			down: this.input.keyboard.addKey(keyDown),
		}

		// ── Network ──
		this._netUnsub.push(
			networkClient.on('playerInput', ({ input }) => {
				this.remotePlayer.setNetworkState(input)
			}),
		)
		this._netUnsub.push(networkClient.on('swapExecute', () => this._doSwap()))

		this._netUnsub.push(
			networkClient.on('lampLever', () => this._doActivateLampLever()),
		)

		// Звуки движения партнёра (шаги/прыжок/приземление) — играем позиционно у remotePlayer.
		this._netUnsub.push(
			networkClient.on('playerSfx', ({ name, vol }) => {
				this._posSfx(name, this.remotePlayer.x, this.remotePlayer.y, vol ?? 0.5)
			}),
		)

		// Гость принимает визуальный снапшот от хоста и плавно тянется к его значениям
		this._netUnsub.push(
			networkClient.on('visualSync', d => {
				this._visualSyncTarget = d
			}),
		)

		// Гость применяет каждый шаг мерцания от хоста немедленно — синхронно до мс
		this._netUnsub.push(
			networkClient.on('flickerStep', ({ factor }) => {
				this._flickerFactor = factor
			}),
		)
		// Гость слышит щелчок лампы в начале вспышки
		this._netUnsub.push(
			networkClient.on('flickerClick', () => this._playLampClick()),
		)

		this._netUnsub.push(
			networkClient.on('game:exit', () => {
				console.log('[GameScene] Partner exited — forcing exit')
				this._closeAbilityOverlay() // партнёр вышел в меню → закрыть «Открыто:» и у нас
				// Force exit regardless of _exiting state (e.g. partner left from level-complete screen)
				this._netUnsub.forEach(u => u())
				this._netUnsub = []
				saveSessionPlaytime()
				this.scene.stop()
				exitToLevelSelect()
			}),
		)

		this._netUnsub.push(
			networkClient.on('levelComplete', () => {
				console.log('[GameScene] Partner reached exit')
				if (!this._exiting) {
					this._exiting = true
					// Guest never touches exit zone directly — update maxLevel here so
					// LevelSelectScreen shows correct unlocked levels when returning
					const newLevel = Math.min(this.levelId + 1, 10)
					window.__currentSlotMaxLevel = newLevel
					// Убрать world-space метки у гостя тоже
					for (const lbl of this._worldLabels) lbl.el?.remove()
					this._worldLabels = []
					this._orbPromptEl?.remove()
					this._orbPromptEl = null
					this._showLevelComplete()
				}
			}),
		)

		this._netUnsub.push(
			networkClient.on('playerDied', () => {
				console.log('[GameScene] Partner died')
				if (!this._dying && !this._exiting) {
					this._dying = true
					this._inputLocked = true
					this._showPartnerDeathScreen()
				}
			}),
		)

		this._netUnsub.push(
			networkClient.on('deathRestart', () => {
				console.log('[GameScene] deathRestart received — restarting')
				this._deathOverlayEl?.remove()
				this._deathOverlayEl = null
				this._netUnsub.forEach(u => u())
				this._netUnsub = []
				window.__l2sFromDeath = true // респаун → туториал-подсказки не повторять
				this.scene.restart({ levelId: this.levelId, role: this.role })
			}),
		)

		// Партнёр посмотрел рекламу и воскрес → снимаем «Второй игрок погиб» и
		// продолжаем с того же места (мы не двигались, пока были заморожены).
		this._netUnsub.push(
			networkClient.on('revive', () => {
				console.log('[GameScene] Partner revived — resuming')
				this._deathOverlayEl?.remove()
				this._deathOverlayEl = null
				this._reviveOverlayEl?.remove()
				this._reviveOverlayEl = null
				this._dying = false
				this._inputLocked = false
				setCursorHidden(true)
			}),
		)

		this._netUnsub.push(
			networkClient.on('leverDoor', ({ open }) => {
				this._remoteOnLever = open // open = касание ПАРТНЁРА рычага
				this._playSwitch(open, this.remotePlayer.x, this.remotePlayer.y) // звук кнопки партнёра (с затуханием)
				this._applyDoorState()
			}),
		)

		// finaltext: партнёр сообщает СВОЁ состояние «дошёл до конца». Отправитель —
		// игрок противоположной роли, поэтому ставим именно его сторону.
		this._netUnsub.push(
			networkClient.on('finalReach', ({ reached }) => {
				if (this.role === 'host') this._guestReached = reached
				else this._hostReached = reached
				this._playSwitch(reached, this.remotePlayer.x, this.remotePlayer.y) // звук финальной кнопки партнёра (с затуханием)
			}),
		)

		this._netUnsub.push(
			networkClient.on('orbCollected', () => {
				// Партнёр подобрал орб — скрыть спрайт, разблокировать способность, показать оверлей
				this._orbCollected = true
				this._orbPromptEl?.remove()
				this._orbPromptEl = null
				this.orb?.destroy()
				if (this._orbSprite) {
					this.tweens.add({
						targets: this._orbSprite,
						alpha: 0,
						duration: 400,
						ease: 'Quad.easeIn',
						onComplete: () => {
							this._orbSprite?.destroy()
							this._orbSprite = null
						},
					})
				}
				// Разблокировать способность и показать оверлей — та же логика, что у собравшего
				const abilityName = this._getLevelAbility()
				if (abilityName) {
					this.localPlayer.unlock(abilityName)
					this.remotePlayer.unlock(abilityName)
					this._showAbilityUnlock(abilityName)
				}
			}),
		)

		// Партнёр закрыл окно способности → зеркалим у себя, ЕСЛИ у нас включена
		// настройка «синхронное закрытие». Без ретрансляции назад (fromNetwork=true).
		this._netUnsub.push(
			networkClient.on('abilityClose', () => {
				if (SaveSystem.getSettings().syncAbilityClose)
					this._dismissAbilityOverlay(true)
			}),
		)

		// ── Level transition: host sends game:start, only guest receives it ──
		// We restart unconditionally — server sends via socket.to() (excludes sender)
		this._netUnsub.push(
			networkClient.on('game:start', ({ levelId }) => {
				console.log(
					'[GameScene] game:start received → level',
					levelId,
					'(guest side)',
				)
				// Убрать level-complete оверлей и world-метки немедленно — не ждать shutdown()
				this._levelCompleteEl?.remove()
				this._levelCompleteEl = null
				for (const lbl of this._worldLabels) lbl.el?.remove()
				this._worldLabels = []
				this._netUnsub.forEach(u => u())
				this._netUnsub = []
				window.__l2s = { ...window.__l2s, levelId }
				// Гость: чернота + флаг обратной диафрагмы (на случай рассинхрона катсцены).
				window.__l2sFromCutscene = true
				Transition.black()
				// Small delay to avoid Phaser scene restart race condition
				this.time.delayedCall(50, () => {
					this.scene.restart({ levelId, role: this.role })
				})
			}),
		)

		// Menu key (tilde/ё by default, rebindable) → toggle pause
		const menuCode = SaveSystem.getSettings().keybindings.menu || 'Backquote'
		this.input.keyboard.on('keydown', event => {
			if (event.code === menuCode && !this._exiting) togglePause(this)
		})

		if (this.orb) {
			// DOM prompt — crisp HD text above the orb, Hollow Knight–style frame
			this._orbPromptEl = document.createElement('div')
			this._orbPromptEl.className = 'hud-world-label hud-world-prompt'
			this._orbPromptEl.innerHTML = `
				<img class="hk-orn hk-orn-top" src="/assets/pngfortext/top.png" onerror="this.style.display='none'" />
				<span class="hk-text" data-i18n="game.pickup">${i18n.t('game.pickup')}</span>
				<img class="hk-orn hk-orn-bot" src="/assets/pngfortext/bottom.png" onerror="this.style.display='none'" />
			`
			this._orbPromptEl.style.display = 'none'
			document.getElementById('hud-prompts').appendChild(this._orbPromptEl)

			// ЛКМ → сбор орба / тестовые орбы
			this.input.on('pointerdown', ptr => {
				if (!ptr.leftButtonDown()) return
				// Основной орб (однократно, только после приземления)
				if (
					this._orbNearby &&
					!this._orbCollected &&
					!this._orbInteracting &&
					this._orbArrived
				) {
					this._startOrbCollection()
					return
				}
				// Тестовые орбы (бесконечно)
				const nearby = this._testOrbs.find(o => o.nearby)
				if (nearby) this._interactTestOrb(nearby)
			})
		}

		// Prompt «Осмотреть» над объектом lamplever
		if (this._lampLeverPos) {
			this._lampLeverPromptEl = document.createElement('div')
			this._lampLeverPromptEl.className = 'hud-world-label hud-world-prompt'
			this._lampLeverPromptEl.innerHTML = `
				<img class="hk-orn hk-orn-top" src="/assets/pngfortext/top.png" onerror="this.style.display='none'" />
				<span class="hk-text" data-i18n="game.inspect">${i18n.t('game.inspect')}</span>
				<img class="hk-orn hk-orn-bot" src="/assets/pngfortext/bottom.png" onerror="this.style.display='none'" />
			`
			this._lampLeverPromptEl.style.display = 'none'
			document
				.getElementById('hud-prompts')
				.appendChild(this._lampLeverPromptEl)

			this.input.on('pointerdown', ptr => {
				if (this._botActive) return // ботом управляет скрипт — ручные действия off
				if (!ptr.leftButtonDown()) return
				if (this._lampLeverNearby && !this._lampLeverActivated) {
					this._activateLampLever()
				}
			})
		}

		// Тестовый автобот: только если включён в настройках И мы оранжевый (гость).
		// Хост всегда играет сам. Бот стартует, как только разблокируется ввод (после входа).
		this._maybeInitBot()

		// Туториал-подсказки первого запуска (WASD «Перемещение», ЛКМ «Взаимодействовать»)
		this._initTutorialHints()

		// Леттербокс на не-16:9 экранах: канвас центрируется окошком, а CSS-ореолы
		// света рисуются в полноэкранном #game-container и вылезают в пустые поля.
		// Обрезаем контейнер по прямоугольнику канваса → в полях виден фон меню
		// (back1.png на body + частицы #particles + дымки #menu-fog — они под z-index 5).
		this._updateGameClip()
		this._onGameResize = () => this._updateGameClip()
		window.addEventListener('resize', this._onGameResize)
		this.scale.on('resize', this._onGameResize)

		// Вход: игроки спавнятся за левой стеной и выходят на свои точки покоя —
		// симметрично катсцене конца уровня (там уходят вправо за кадр).
		if (this._hasEntrance()) this._startEntranceCutscene()
		else this.time.delayedCall(1100, () => this._showTutMove())

		// Уровень собран → проявляем. Если пришли из финальной катсцены прошлого уровня —
		// раскрываем ОБРАТНУЮ диафрагму (круг); иначе обычный fadeIn из чёрного (лобби→уровень).
		if (window.__l2sFromCutscene) {
			window.__l2sFromCutscene = false
			this._playReverseIris()
		} else {
			Transition.fadeIn(1000)
		}
	}

	// Включает автобота, если в настройках стоит «играть за бота» И локальный игрок —
	// оранжевый (гость). Хост ходит сам. Маршрут — точки type="bot" (слой "bot") по их id.
	_maybeInitBot() {
		const wantBot = !!SaveSystem.getSettings().playAsBot
		if (!wantBot || this.role !== 'guest') return
		if (!this._botPoints.length) {
			tlog('[Bot] включён, но в карте нет точек bot (id=1..N) — бот не запущен')
			return
		}
		// Дубликаты id ломают порядок маршрута молча — сразу кричим в терминал.
		const ids = this._botPoints.map(p => p.n)
		const dup = [...new Set(ids.filter((n, i) => ids.indexOf(n) !== i))]
		if (dup.length)
			tlog(`[Bot] ⚠ ДУБЛИКАТЫ id в точках bot: ${dup.join(', ')} — порядок маршрута сломан!`)
		const route = this._botPoints
			.slice()
			.sort((a, b) => a.n - b.n)
			.map(p => ({ x: p.x, y: p.y, wait: p.wait, face: p.face, jump: p.jump, dash: p.dash, click: p.click }))
		// «Клик ЛКМ» бота: тот же сценарий, что pointerdown игрока — орб / тестовые
		// орбы / рычаг лампы. Берёт то, что сейчас рядом (nearby-флаги обновляет сцена).
		const botClick = () => {
			tlog('[Bot] клик ЛКМ (точка с click=true)')
			if (this._orbNearby && !this._orbCollected && !this._orbInteracting && this._orbArrived) {
				this._startOrbCollection()
				return
			}
			const nearbyOrb = this._testOrbs.find(o => o.nearby)
			if (nearbyOrb) {
				this._interactTestOrb(nearbyOrb)
				return
			}
			if (this._lampLeverNearby && !this._lampLeverActivated) this._activateLampLever()
		}
		this._bot = new BotController(this.localPlayer, route, { onClick: botClick })
		this._botActive = true
		tlog(`[Bot] ✓ автобот активен (гость), точек маршрута: ${route.length}`)
	}

	// Катсцена входа: игрок стоит за левой стеной (на объекте spawn), управление снято,
	// затем идёт вправо до своей точки покоя (spawnhost/spawnguest) и останавливается —
	// тогда управление возвращается. Прибытие ловится в update() (_tickEntrance).
	_startEntranceCutscene() {
		this._entering = true
		this._inputLocked = true
		this._enterTargetX = this._getRestTarget().x
		// Левую границу мира временно отодвигаем в минус: иначе setCollideWorldBounds
		// прижимает игрока к x=0, и он не может стоять ЗА картой (на off-map спавне).
		// Камеру НЕ трогаем (её bounds остаются с 0) → область x<0 не видна, игрок выходит
		// из-за левого края. Возвращаем границу в _endEntrance.
		const b = this.physics.world.bounds
		this._mapRight = b.x + b.width // правый край карты (для восстановления)
		this.physics.world.setBounds(-ENTER_PAD, b.y, b.width + ENTER_PAD, b.height)
		// Ставим игрока на off-map спавн (его могло прижать к x=0 при создании).
		const s = this._getSpawn()
		this.localPlayer.body
			? this.localPlayer.body.reset(s.x, s.y)
			: this.localPlayer.setPosition(s.x, s.y)
		this.localPlayer.body?.setVelocity(0, 0)
		// Небольшая пауза, чтобы реализовать «проявление» (круг/затемнение) до выхода,
		// затем идём вправо на беговой скорости. Гравитация доводит по вертикали.
		this.time.delayedCall(350, () => {
			if (this._entering) this.localPlayer.scriptedWalk(1)
		})
		// Страховка от софт-лока: если за 5с не дошёл (стена/яма) — всё равно вернуть управление.
		this.time.delayedCall(5000, () => {
			if (this._entering) this._endEntrance()
		})
	}

	// Завершение входа: стоп + вернуть управление + разморозить камеру + вернуть левую
	// границу мира к 0 (чтобы в обычной игре нельзя было уйти за карту влево).
	_endEntrance() {
		this._entering = false
		this._inputLocked = false
		this.localPlayer.scriptedStop()
		const b = this.physics.world.bounds
		this.physics.world.setBounds(0, b.y, this._mapRight ?? b.width, b.height)
		this._showTutMove() // управление получено впервые → подсказка WASD
	}

	// Каждый кадр на входе: дошёл до своей точки покоя → стоп + вернуть управление.
	_tickEntrance() {
		if (!this._entering) return
		if (this.localPlayer.x >= this._enterTargetX) {
			this.localPlayer.x = this._enterTargetX
			this._endEntrance()
		}
	}

	// ── Туториал-подсказки первого уровня ───────────────────────────────────
	// Показываются при каждой загрузке уровня 1 (из лобби / смена уровня), но НЕ
	// после смерти-респауна (та же сессия — флаг window.__l2sFromDeath):
	//   • WASD + «Перемещение» — после катсцены входа, гаснет когда игрок подвигался;
	//   • ЛКМ + «Взаимодействовать» — при подходе к интерактивному объекту,
	//     гаснет до конца сессии после первого успешного взаимодействия.
	_initTutorialHints() {
		this._tutMoveEl = null
		this._tutInteractEl = null
		this._tutInteractZones = 0 // счётчик зон рядом (орб/рычаг/тест-орбы)
		this._botTutPressed = null // аккумулятор «бот подвигался» (см. _checkBotTutMove)
		const fromDeath = window.__l2sFromDeath
		window.__l2sFromDeath = false
		if (Number(this.levelId) !== 1 || fromDeath) return
		// Подсказки видны и боту: гасит их его собственное движение (_checkBotTutMove)
		// и его клики (botClick → _completeTutInteract), как у живого игрока.
		const hp = document.getElementById('hud-prompts')
		if (!hp) return
		const kb = SaveSystem.getSettings().keybindings || {}

		{
			const el = document.createElement('div')
			el.className = 'tut-hint'
			// Движение — только A/D; в центре нижнего ряда — пробел (прыжок).
			// Пробел — значок «⎵» (CSS-скоба); если прыжок переназначен — его буква.
			const jumpCode = kb.jump || 'Space'
			const jumpLabel =
				jumpCode === 'Space'
					? '<span class="tut-space-glyph"></span>'
					: keyCodeToLabel(jumpCode)
			el.innerHTML = `
				<div class="tut-wasd">
					<span class="tut-key tut-key-up">W</span>
					<span class="tut-key">${keyCodeToLabel(kb.move_left || 'KeyA')}</span>
					<span class="tut-key tut-key-space">${jumpLabel}</span>
					<span class="tut-key">${keyCodeToLabel(kb.move_right || 'KeyD')}</span>
				</div>
				<span class="tut-label">${i18n.t('game.tut_move')}</span>
			`
			hp.appendChild(el)
			this._tutMoveEl = el
			// Гасим когда игрок попробовал всё: влево, вправо и прыжок (W ИЛИ пробел) —
			// каждое действие хотя бы по одному разу.
			const need = {
				left: [kb.move_left || 'KeyA'],
				right: [kb.move_right || 'KeyD'],
				jump: ['KeyW', kb.jump || 'Space'],
			}
			const pressed = new Set()
			const onKey = e => {
				if (this._inputLocked) return
				for (const [act, codes] of Object.entries(need))
					if (codes.includes(e.code)) pressed.add(act)
				if (pressed.size < Object.keys(need).length) return
				this.input.keyboard.off('keydown', onKey)
				this._dismissTutMove()
			}
			this.input.keyboard.on('keydown', onKey)
		}

		{
			const el = document.createElement('div')
			el.className = 'tut-hint'
			el.innerHTML = `
				<span class="tut-key tut-key-mouse">
					<img src="/assets/pngfortext/mouseleft.png" onerror="this.style.display='none'" />
				</span>
				<span class="tut-label">${i18n.t('game.tut_interact')}</span>
			`
			hp.appendChild(el)
			this._tutInteractEl = el
		}

		// Подсказки якорим к НИЗУ КАНВАСА игры, а не экрана: при леттербоксе
		// (портретный монитор) канвас — окошко 16:9 по центру, низ экрана пустой.
		this._placeTutHints()
		this._onTutResize = () => this._placeTutHints()
		window.addEventListener('resize', this._onTutResize)
	}

	// Обрезка #game-container по прямоугольнику канваса (см. комментарий в create).
	// Сам канвас не трогаем — клип проходит ровно по его краям.
	_updateGameClip() {
		const gc = document.getElementById('game-container')
		if (!gc) return
		// Режим растяжения (16:9 монитор, оконный): канвас залит на весь вьюпорт —
		// клип по «окошку» леттербокса не нужен и как раз он оставлял полосу снизу.
		if (gc.classList.contains('aspect-fill')) { gc.style.clipPath = 'none'; return }
		const r = this.game.canvas?.getBoundingClientRect()
		if (!r) return
		const top = Math.max(0, Math.round(r.top))
		const right = Math.max(0, Math.round(window.innerWidth - r.right))
		const bottom = Math.max(0, Math.round(window.innerHeight - r.bottom))
		const left = Math.max(0, Math.round(r.left))
		gc.style.clipPath = `inset(${top}px ${right}px ${bottom}px ${left}px)`
	}

	// Пересчёт вертикальной позиции подсказок от текущего прямоугольника канваса.
	_placeTutHints() {
		const r = this.game.canvas?.getBoundingClientRect()
		if (!r) return
		const bottom = `${window.innerHeight - r.bottom + r.height * 0.08}px`
		if (this._tutMoveEl) this._tutMoveEl.style.bottom = bottom
		if (this._tutInteractEl) this._tutInteractEl.style.bottom = bottom
	}

	// Плавное появление WASD-подсказки — в момент, когда игрок впервые получает управление.
	_showTutMove() {
		this._placeTutHints() // канвас мог поменять размер (fullscreen) после create
		this._tutMoveEl?.classList.add('visible')
	}

	_dismissTutMove() {
		if (!this._tutMoveEl) return
		const el = this._tutMoveEl
		this._tutMoveEl = null
		el.classList.remove('visible')
		setTimeout(() => el.remove(), 1000) // дождаться CSS fade-out
	}

	// Бот не шлёт реальные keydown (только виртуальные клавиши в BotController.keys),
	// поэтому WASD-подсказку гасим, прочитав их прямо: подвигался (влево/вправо) И
	// прыгнул — как живой игрок «попробовал управление». Вызывается из update().
	_checkBotTutMove() {
		if (!this._tutMoveEl || !this._bot) return
		if (!this._botTutPressed) this._botTutPressed = new Set()
		const k = this._bot.keys
		if (k.left.isDown || k.right.isDown) this._botTutPressed.add('move')
		if (k.jump.isDown) this._botTutPressed.add('jump')
		if (this._botTutPressed.size >= 2) this._dismissTutMove()
	}

	// Вход/выход игрока в зону интерактивного объекта (вызывается из proximity-кода).
	_tutInteractNear(nearby) {
		if (!this._tutInteractEl) return
		this._tutInteractZones = Math.max(0, this._tutInteractZones + (nearby ? 1 : -1))
		this._tutInteractEl.classList.toggle('visible', this._tutInteractZones > 0)
	}

	// Первое успешное взаимодействие ЛКМ → подсказка больше не нужна в этой сессии.
	_completeTutInteract() {
		if (!this._tutInteractEl) return
		const el = this._tutInteractEl
		this._tutInteractEl = null
		el.classList.remove('visible')
		setTimeout(() => el.remove(), 1000)
	}

	update(time, delta) {
		// Always interpolate remote player so they stay smooth for both sides
		this.remotePlayer.updateRemote(delta)

		// Дождь и провода — чисто косметика, крутим даже на паузе чтобы сцена «жила».
		// Провод обновляем ПЕРВЫМ → его свежая кромка идёт в дождь как зоны брызг.
		this._tickFallenWire(delta) // двигаем упавший конец ДО отрисовки провода
		this._wire?.update(delta)
		this._bush?.update(delta)
		this._rainSlide?.update(delta)
		if (this._rain) this._rain.wireZones = this._wire?.splashZones ?? []
		this._rain?.update(delta)

		// Мерцание ламп «как фонарь с перебоями электричества» (раз в 2-3с короткий
		// стробящий спад яркости, не до нуля). Цвет не трогаем — остаётся исходным.
		this._updateLightFlicker(time)
		this._updateLampAudio() // громкость гудения по дистанции до lampsound
		this._updateRainAudio() // громкость дождя по настройке sfx

		// Визуальная синхронизация провода / мерцания / параллакс-дрейфа.
		// Хост рассылает снапшот каждые 500мс; гость плавно тянется к нему.
		if (this.role === 'host') {
			this._visualSyncTimer += delta
			if (this._visualSyncTimer >= 500) {
				this._visualSyncTimer = 0
				this._sendVisualSync()
			}
		} else if (this._visualSyncTarget) {
			this._applyVisualSync()
		}

		// Skip everything else when paused (input, physics, network sync)
		if (this._gamePaused) return

		this._tickEntrance() // вход: проверяем, дошёл ли игрок до точки покоя
		if (this._inputLocked) {
			// катсцена (вход/конец/наезд) сама двигает игрока — ни ручной ввод, ни бот
		} else if (this._botActive && this._bot) {
			// Бот синтезирует «нажатия» → прогоняем через обычный апдейт игрока.
			this.localPlayer.updateLocal(this._bot.update(delta, time), delta, time)
			this._checkBotTutMove() // гасим WASD-подсказку по виртуальным «нажатиям» бота
		} else {
			this.localPlayer.updateLocal(this.keys, delta, time)
		}
		this._recordSafeGround() // запоминаем безопасную землю для воскрешения
		this._updateFootsteps(delta)
		this._updateCamera(delta)
		this._updateParallax(delta)
		this._updateCloudLight()
		this._updateDriftSprites(delta)
		this._updateDomPositions()

		// Dash smoke trail — каждый кадр дэша пишем точку, рисуем шлейф
		this._tickDashTrail(
			this.localPlayer,
			'_localTrail',
			this.localPlayer._dashActive,
		)
		this._tickDashTrail(
			this.remotePlayer,
			'_remoteTrail',
			this.remotePlayer._netDashActive,
		)

		// Гистерезис для всех proximity-подсказок:
		// появляется когда dist < PROX_SHOW, исчезает когда dist > PROX_HIDE.
		// Зона появления уже зоны исчезновения → не мерцает на границе, не накладывается.
		const PROX_SHOW = 32
		const PROX_HIDE = 52
		const proxNearby = (dist, wasNearby) =>
			wasNearby ? dist < PROX_HIDE : dist < PROX_SHOW

		// Test orb proximity prompts (infinite reuse)
		for (const torb of this._testOrbs) {
			const dist = Phaser.Math.Distance.Between(
				this.localPlayer.x,
				this.localPlayer.y,
				torb.body.x,
				torb.body.y,
			)
			const nearby = proxNearby(dist, torb.nearby)
			if (nearby !== torb.nearby) {
				torb.nearby = nearby
				_showHkPrompt(torb.promptEl, nearby)
				this._tutInteractNear(nearby)
			}
		}

		// Orb proximity prompt — только после приземления в orbdestination
		if (
			this.orb?.active &&
			!this._orbCollected &&
			!this._orbInteracting &&
			this._orbArrived
		) {
			const dist = Phaser.Math.Distance.Between(
				this.localPlayer.x,
				this.localPlayer.y,
				this.orb.x,
				this.orb.y,
			)
			const nearby = proxNearby(dist, this._orbNearby)
			if (nearby !== this._orbNearby) {
				this._orbNearby = nearby
				if (this._orbPromptEl) _showHkPrompt(this._orbPromptEl, nearby)
				this._tutInteractNear(nearby)
			}
		}

		// LampLever proximity — prompt «Осмотреть»
		if (this._lampLeverPos && !this._lampLeverActivated) {
			const dist = Phaser.Math.Distance.Between(
				this.localPlayer.x,
				this.localPlayer.y,
				this._lampLeverPos.x,
				this._lampLeverPos.y,
			)
			const nearby = proxNearby(dist, this._lampLeverNearby)
			if (nearby !== this._lampLeverNearby) {
				this._lampLeverNearby = nearby
				if (this._lampLeverPromptEl)
					_showHkPrompt(this._lampLeverPromptEl, nearby)
				this._tutInteractNear(nearby)
			}
		}

		// Door logic — вещаем ТОЛЬКО своё касание рычага; дверь открыта если
		// я ИЛИ партнёр на рычаге. Чужое касание НЕ пересчитываем из синхро-позиции
		// (это давало петлю: партнёр перекрывал состояние и слал обратно «закрыто»).
		if (this._levers.length > 0) {
			// Дверь — только рычаги группы 1 (группы 2/3 — финальные кнопки, см.
			// _updateActionButtons и не трогают дверь).
			const localOn = this._levers.some(
				lv => lv.group === 1 && this._onButton(this.localPlayer, lv),
			)
			if (localOn !== this._localOnLever) {
				this._localOnLever = localOn
				this._playSwitch(localOn, this.localPlayer.x, this.localPlayer.y) // звук кнопки (наступил/сошёл)
				networkClient.leverDoor(localOn) // шлём СВОЁ касание
				this._applyDoorState()
			}
		}
		// Финальные кнопки групп 2/3 + текст finaltext (локально на каждом клиенте).
		this._updateActionButtons()

		// Send state every 16ms (~60fps) — tight sync for local LAN smoothness
		this._syncTimer += delta
		if (this._syncTimer >= 16) {
			this._syncTimer = 0
			networkClient.sendInput(this.localPlayer.getNetworkState())
		}

		// RMB special — заблокировано, когда персонажем управляет бот.
		if (
			!this._botActive &&
			this.input.mousePointer.rightButtonDown() &&
			!this._rmbPrev
		) {
			this._handleSpecial()
		}
		this._rmbPrev = this.input.mousePointer.rightButtonDown()
	}

	// ── Dash smoke trail (Hollow Knight Mothwing Cloak style) ─────────────────
	// Каждый кадр дэша: добавляем точку и перерисовываем шлейф.
	// Когда дэш заканчивается — весь шлейф плавно исчезает.
	_tickDashTrail(player, trailKey, isDashing) {
		if (isDashing) {
			if (!this[trailKey]) {
				this[trailKey] = { g: this.add.graphics().setDepth(9), pts: [] }
			}
			this[trailKey].pts.push({ x: player.x, y: player.y + 2 })
			this._redrawDashTrail(this[trailKey], player._charPrefix)
		} else if (this[trailKey]) {
			const g = this[trailKey].g
			this[trailKey] = null
			this.tweens.add({
				targets: g,
				alpha: 0,
				duration: 180,
				ease: 'Quad.easeIn',
				onComplete: () => g.destroy(),
			})
		}
	}

	_redrawDashTrail(trail, charPrefix) {
		const g = trail.g
		const pts = trail.pts
		const n = pts.length

		// ADD blending: цвета суммируются → нет грязных пятен от перекрытия,
		// получается мягкое свечение. Цвета подобраны светлее оригинала
		// чтобы при ADD они были заметны.
		g.setBlendMode(Phaser.BlendModes.ADD)

		const c1 = charPrefix === 'orange' ? 0xbb6200 : 0x3a5899
		const c2 = charPrefix === 'orange' ? 0x7a3800 : 0x1e2f55

		g.clear()
		for (let i = 0; i < n; i++) {
			const t = n > 1 ? i / (n - 1) : 1
			const a = 0.15 + t * 0.75 // 0.15→0.90
			const rw = 3 + t * 7 // 3→10 px
			const rh = 5 + t * 10 // 5→15 px
			g.fillStyle(t > 0.4 ? c1 : c2, a)
			g.fillEllipse(pts[i].x, pts[i].y, rw, rh)
		}
	}

	// ── OLD dash effect (больше не используется, оставлен для совместимости) ──
	spawnDashEffect(x, y, facingRight, charPrefix) {
		const dir = facingRight ? 1 : -1

		const palette =
			charPrefix === 'orange' ? [0x743f00, 0x512000] : [0x242f46, 0x141326]

		const g = this.add.graphics().setDepth(9)

		// dX  = сдвиг старта линии по направлению дэша
		// dY  = вертикальное смещение от позиции игрока (0=голова, 22=ноги)
		// len = длина в канвас-пикселях (нерегулярно)
		// a   = прозрачность
		// c   = цвет (0 или 1 из palette)
		// b   = bend 1px: >0 загиб вниз, <0 загиб вверх, 0 прямая
		const streaks = [
			{ dX: 0, dY: 0, len: 18, a: 0.75, c: 0, b: 1 },
			{ dX: 3, dY: 3, len: 11, a: 0.55, c: 1, b: 1 },
			{ dX: 0, dY: 5, len: 26, a: 0.9, c: 0, b: 1 },
			{ dX: 4, dY: 8, len: 7, a: 0.45, c: 1, b: 0 },
			{ dX: 1, dY: 11, len: 31, a: 1.0, c: 0, b: 0 },
			{ dX: 0, dY: 13, len: 9, a: 0.6, c: 1, b: 0 },
			{ dX: 2, dY: 15, len: 22, a: 0.8, c: 0, b: -1 },
			{ dX: 0, dY: 18, len: 14, a: 0.65, c: 1, b: -1 },
			{ dX: 4, dY: 21, len: 6, a: 0.4, c: 0, b: -1 },
			{ dX: 1, dY: 9, len: 17, a: 0.7, c: 1, b: 0 },
		]

		for (const s of streaks) {
			const x1 = x + dir * s.dX
			const x2 = x1 - dir * s.len
			const yL = y + s.dY
			const midX = (x1 + x2) / 2
			g.lineStyle(1, palette[s.c], s.a)
			g.beginPath()
			g.moveTo(x1, yL)
			if (s.b !== 0) {
				// 1px загиб через среднюю точку — два отрезка вместо кривой Безье
				g.lineTo(midX, yL + s.b)
				g.lineTo(x2, yL)
			} else {
				g.lineTo(x2, yL)
			}
			g.strokePath()
		}

		this.tweens.add({
			targets: g,
			alpha: 0,
			duration: 640,
			ease: 'Quad.easeOut',
			onComplete: () => g.destroy(),
		})
	}

	_handleSpecial() {
		const p = this.localPlayer
		if (p.hasAbility('conjurePlatform')) {
			const px = p.x,
				py = p.y + 40
			const tp = this.dynamicPlatforms
				.create(px, py, 'tile-platform')
				.setScale(4, 1)
				.refreshBody()
			this.time.delayedCall(4000, () => {
				tp.destroy()
			})
		}
		if (p.hasAbility('swap')) {
			networkClient.requestSwap()
		}
	}

	_doSwap() {
		const lx = this.localPlayer.x,
			ly = this.localPlayer.y
		const rx = this.remotePlayer.x,
			ry = this.remotePlayer.y
		this.localPlayer.setPosition(rx, ry)
		this.remotePlayer.setPosition(lx, ly)
		this.localPlayer.body.reset(rx, ry)
	}

	// ЛКМ рядом с орбом — запуск полного кинематического сценария
	_startOrbCollection() {
		this._orbInteracting = true
		this._orbNearby = false
		this._completeTutInteract() // первое взаимодействие выполнено
		this._inputLocked = true // отключить управление на всё время заставки

		// Параллельно: fade-out HK-рамки + fade-out спрайта орба + начало атаки
		if (this._orbPromptEl) _showHkPrompt(this._orbPromptEl, false)
		if (this._orbSprite) {
			this.tweens.add({
				targets: this._orbSprite,
				alpha: 0,
				duration: 450,
				ease: 'Quad.easeIn',
				onComplete: () => {
					this._orbSprite?.destroy()
					this._orbSprite = null
				},
			})
		}
		this.localPlayer.playAttack()

		// После последнего кадра атаки: заморозить персонажа
		// Player.playAttack() регистрирует .once первым (сбрасывает _animState='idle'),
		// наш .once регистрируется следом — гарантированно выполняется вторым.
		const attackKey = this.localPlayer._charPrefix + '-attack'
		this.localPlayer.once('animationcomplete-' + attackKey, () => {
			// Откатить на предпоследний кадр анимации атаки
			const anim = this.localPlayer.anims.currentAnim
			if (anim?.frames.length >= 2) {
				this.localPlayer.setFrame(
					anim.frames[anim.frames.length - 2].textureFrame,
				)
			}
			// Заморозить физику — персонаж висит на предпоследнем кадре
			this.localPlayer.body.setVelocity(0, 0)
			this.localPlayer.body.setAllowGravity(false)
			// Выдержать 0.5s замершего кадра, затем перейти к сбору
			this.time.delayedCall(500, () => this._collectOrb())
		})
	}

	// Тестовый орб — бесконечное взаимодействие, только анимация
	_interactTestOrb(orb) {
		this._completeTutInteract() // первое взаимодействие выполнено
		const p = this.localPlayer
		switch (orb.type) {
			case 'orbtestattack':
				p.playAttack()
				break
			case 'orbtesthit':
				p.playHit()
				break
			case 'orbtestdeath':
				p.playDead()
				break
			case 'orbtestshield':
				p.playShieldToggle()
				break
		}
	}

	// Вызывается после заморозки (0.5s после последнего кадра атаки)
	_collectOrb() {
		if (this._orbCollected) return
		this._orbCollected = true
		this._orbPromptEl?.remove()
		this._orbPromptEl = null
		this._orbSprite?.destroy()
		this._orbSprite = null
		this.orb?.destroy()
		networkClient.orbCollected() // сообщить партнёру что орб подобран

		const abilityName = this._getLevelAbility()
		if (abilityName) {
			this.localPlayer.unlock(abilityName)
			this.remotePlayer.unlock(abilityName)
			console.log('[GameScene] ORB collected! Ability:', abilityName)
		}

		// Нет способности → разморозить сразу, нет смысла показывать оверлей
		if (!abilityName) {
			this._unfreezeAfterOrb()
			return
		}

		this._showAbilityUnlock(abilityName)
	}

	_showAbilityUnlock(name) {
		// Читаем актуальные биндинги из настроек
		const kb = SaveSystem.getSettings().keybindings || {}
		const K = code => `<span class="ao-key">${keyCodeToLabel(code)}</span>`

		// Клавиша в подсказке каждой способности ({key} в словаре i18n)
		const hintKey = {
			dash: K(kb.dash || 'ShiftLeft'),
			doubleJump: K(kb.jump || 'Space'),
			groundSlam: K(kb.down || 'KeyS'),
			airDive: K(kb.dash || 'ShiftLeft'),
			glide: K(kb.jump || 'Space'),
			chargedDash: K(kb.dash || 'ShiftLeft'),
		}

		const el = document.createElement('div')
		el.className = 'game-fullscreen-overlay'
		el.innerHTML = `
			<div class="ao-subtitle">${i18n.t('game.unlocked')}</div>
			<div class="ao-name">${i18n.t(`ability.${name}`)}</div>
			<div class="ao-tip">${i18n.t(`hint.${name}`, { key: hintKey[name] || '' })}</div>
			<img class="ao-lmb" src="/assets/pngfortext/mouseleft.png" onerror="this.style.display='none'" />
		`
		document.getElementById('hud-overlay').appendChild(el)
		this._abilityOverlayEl = el

		// Пока экран затемнён — приглушаем (не глушим полностью) музыку и фоновые звуки.
		// Переход плавный (твин + easeInOut в setDuck), а не скачком.
		this._tweenAmbDuck(0.4)
		MusicManager.setDuck(0.4)

		// Звуки получения способности — синхронно с появлением каждого текста
		// (animationstart срабатывает ровно когда CSS-анимация элемента стартует):
		//   «Открыто:» → collect1, название способности → collect1, подсказка → collect2.
		const playUi = key =>
			this.cache.audio.exists(key) &&
			this.sound.play(key, { volume: 0.7 * AudioManager.getMultiplier('sfx') })
		el.querySelector('.ao-subtitle')?.addEventListener(
			'animationstart',
			() => playUi('collect1'),
			{ once: true },
		)
		el.querySelector('.ao-name')?.addEventListener(
			'animationstart',
			() => playUi('collect1'),
			{ once: true },
		)
		el.querySelector('.ao-tip')?.addEventListener(
			'animationstart',
			() => playUi('collect2'),
			{ once: true },
		)

		// Overlay перехватывает клики раньше Phaser-canvas → DOM-listener.
		// Задержка: overlay 0.5s + name 0.35+0.45s + tip 0.85+0.5s + lmb 1.9+0.4s ≈ 2.3s
		// Даём 2.5s — к этому моменту всё появилось, случайный клик исключён.
		setTimeout(() => {
			el.addEventListener('click', () => this._dismissAbilityOverlay(), {
				once: true,
			})
		}, 2500)
	}

	// Only dash + doubleJump for now (other mechanics removed until later)
	_grantPreviousAbilities() {
		const grant = a => {
			this.localPlayer.unlock(a)
			this.remotePlayer.unlock(a)
		}
		if (this.levelId >= 2) grant('dash')
		if (this.levelId >= 3) grant('doubleJump')
		// Level 10 gets both
		if (this.levelId >= 10) {
			grant('dash')
			grant('doubleJump')
		}
	}

	// Level 1 → dash, Level 2 → doubleJump, 3+ → nothing for now
	_getLevelAbility() {
		const map = { 1: 'dash', 2: 'doubleJump' }
		return map[this.levelId] || null
	}

	// ── Parallax backdrop system ─────────────────────────────────────────────────
	//
	// ДВА типа слоёв:
	//
	// 1. TILE-слои (tileSprite) — бесконечно тайлятся по всему экрану.
	//    Используй для: небо, туман, звёзды, бесшовные паттерны.
	//    "Позиции" нет — изображение везде. Контролируешь только скорость (sfX/sfY).
	//    offsetX/Y = с какой части картинки начать (пиксели в PNG).
	//
	// 2. SPRITE-слои (image) — обычный спрайт в конкретном месте мира.
	//    Используй для: конкретное облако, гора, здание на определённой высоте.
	//    wx/wy = координаты В МИРЕ (те же что в Tiled). sfX/sfY = параллакс.
	//    Спрайт не тайлится — он ровно там где ты сказал.
	//
	// КАРТА УРОВНЕЙ: для каждого уровня свой конфиг ниже.
	// Координаты wx/wy — в пикселях мира (совпадают с Tiled: 1px = 1 тайл-пиксель).
	// Мир level1: 1280×3568 px (80×223 тайлов по 16px).
	_createParallaxBg() {
		// ════════════════════════════════════════════════════════════════════════
		// КОНФИГ СЛОЁВ — редактируй здесь
		// ════════════════════════════════════════════════════════════════════════

		//── Тип 1: tileSprite — бесконечный тайлинг по всему экрану ────────────
		// Сейчас пусто — все изображения расставляются через объекты Tiled (тип Oblako).
		// Добавь строку сюда если нужен глобальный тайлящийся фон на весь экран.
		const TILE_LAYERS = []

		// ── Тип 2: image — спрайт на конкретном месте в мире ───────────────────
		// wx/wy: координаты в МИРОВЫХ пикселях (как в Tiled).
		// w/h:   размер в мировых пикселях (0 = оригинальный размер PNG).
		// sfX/Y: параллакс (0=неподвижен, 1=движется вместе с тайлами).
		// origin: [0,0]=левый верхний угол, [0.5,0.5]=центр (как Tiled rectangle).
		const SPRITE_LAYERS = [
			// Пример: большое облако в середине уровня
			// { key: 'px-cloud-big', wx: 400, wy: 1200, w: 0, h: 0, sfX: 0.3, sfY: 0.3, origin: [0, 0], depth: -1 },
			// Пример: горный хребет на высоте 2000px от верха карты
			// { key: 'px-mountains', wx: 0, wy: 2000, w: 1280, h: 300, sfX: 0.1, sfY: 0.1, origin: [0, 0], depth: -3 },
		]

		// ════════════════════════════════════════════════════════════════════════
		// НИЖЕ — только логика, не трогай
		// ════════════════════════════════════════════════════════════════════════

		tlog('[Parallax] ── создание слоёв ──')

		// Создаём tile-слои
		for (const cfg of TILE_LAYERS) {
			const hasReal = this.textures.exists(cfg.key)
			const texKey = hasReal ? cfg.key : 'px-sky'

			let sprite
			if (hasReal) {
				const src = this.textures.get(cfg.key).source[0]
				sprite = this.add
					.tileSprite(0, 0, 320, 180, texKey)
					.setOrigin(0, 0)
					.setScrollFactor(0)
					.setDepth(cfg.depth)
				sprite.tilePositionX = cfg.offsetX
				sprite.tilePositionY = cfg.offsetY
				tlog(
					`[Parallax] TILE ✓ ${cfg.key}  PNG=${src.width}×${src.height}  sf=(${cfg.sfX},${cfg.sfY})  drift=(${cfg.driftX},${cfg.driftY})  offset=(${cfg.offsetX},${cfg.offsetY})`,
				)
			} else {
				const colors = {
					'px-sky': 0x060d1a,
					'px-mtn': 0x0d1833,
					'px-clouds-far': 0x132040,
					'px-clouds-near': 0x182848,
				}
				sprite = this.add
					.tileSprite(0, 0, 320, 180, texKey)
					.setOrigin(0, 0)
					.setScrollFactor(0)
					.setDepth(cfg.depth)
					.setTint(colors[cfg.key] ?? 0x0a0f2e)
				tlog(
					`[Parallax] TILE ⚙ ${cfg.key}  заглушка  sf=(${cfg.sfX},${cfg.sfY})  drift=(${cfg.driftX},${cfg.driftY})`,
				)
			}

			this._parallaxLayers.push({
				sprite,
				sfX: cfg.sfX,
				sfY: cfg.sfY,
				driftX: cfg.driftX,
				driftY: cfg.driftY,
				_driftAccX: cfg.offsetX,
				_driftAccY: cfg.offsetY,
			})
		}

		// Создаём sprite-слои (конкретные позиции в мире)
		for (const cfg of SPRITE_LAYERS) {
			if (!this.textures.exists(cfg.key)) {
				tlog(
					`[Parallax] SPRITE ✗ ${cfg.key} — текстура не загружена, пропускаем`,
				)
				continue
			}
			const spr = this.add
				.image(cfg.wx, cfg.wy, cfg.key)
				.setOrigin(cfg.origin[0], cfg.origin[1])
				.setScrollFactor(cfg.sfX, cfg.sfY)
				.setDepth(cfg.depth)
			if (cfg.w && cfg.h) spr.setDisplaySize(cfg.w, cfg.h)
			const src = this.textures.get(cfg.key).source[0]
			tlog(
				`[Parallax] SPRITE ✓ ${cfg.key}  wx=${cfg.wx} wy=${cfg.wy}  sf=(${cfg.sfX},${cfg.sfY})  size=${cfg.w || src.width}×${cfg.h || src.height}`,
			)
		}

		tlog(
			`[Parallax] готово: ${TILE_LAYERS.length} tile + ${SPRITE_LAYERS.filter(s => this.textures.exists(s.key)).length} sprite слоёв`,
		)
	}

	// Вызывается каждый кадр — сдвигает tilePosition tile-слоёв
	_updateParallax(delta) {
		if (!this._parallaxLayers.length) return
		const cam = this.cameras.main
		const dtS = Math.min(delta / 1000, 0.05)

		for (const L of this._parallaxLayers) {
			L._driftAccX += L.driftX * dtS
			L._driftAccY += L.driftY * dtS
			const tsx = L.sprite.tileScaleX || 1
			const tsy = L.sprite.tileScaleY || 1
			// Позиция накапливается как float (canvas px), но tilePositionX округляется
			// до целого canvas-пикселя перед конвертацией в texture-координаты.
			// 1 canvas px = 6–8 экранных px → арт-пиксель не разрывается пополам.
			const screenX = cam.scrollX * L.sfX + L._driftAccX
			const screenY = cam.scrollY * L.sfY + L._driftAccY
			L.sprite.tilePositionX = Math.round(screenX) / tsx
			L.sprite.tilePositionY = Math.round(screenY) / tsy
		}
	}

	// Свет для облака с нормал-маппингом. Облако — scrollFactor:0 (прибито к экрану),
	// а Light2D-свет живёт в МИРЕ и трансформируется камерой. Чтобы пятно стояло в
	// фиксированной точке ЭКРАНА над полосой облаков, компенсируем scroll камеры.
	// zoom=1.0 всегда, холст 320×180 игровых единиц → смещение задаём в этих единицах.
	_updateCloudLight() {
		if (!this._cloudLight) return
		const cam = this.cameras.main
		this._cloudLight.x = cam.scrollX + 160 // центр по X (320/2)
		this._cloudLight.y = cam.scrollY + 150 // нижняя треть экрана — полоса облаков
	}

	// Вызывается каждый кадр — двигает Oblako спрайты.
	// roundPixels убран из конфига → дробные px разрешены → анимация плавная на любой скорости.
	_updateDriftSprites(delta) {
		if (!this._driftSprites.length) return
		const dtS = Math.min(delta / 1000, 0.05)
		for (const item of this._driftSprites) {
			item.spr.x += item.velX * dtS
		}
	}

	// ── Celeste-точная камера ────────────────────────────────────────────────────
	// Источник: NoelFB/Celeste Player.cs — CameraTarget + camera update loop
	//
	// target = (player.x, player.y)  — просто центр на игроке, без lookahead при ходьбе
	//   (lookahead есть только в спец. состояниях: feather, red dash — сейчас не нужно)
	//
	// Плавность — экспоненциальный распад (frame-rate independent!):
	//   pos = pos + (target - pos) * (1 - 0.01 ^ deltaTime)
	//   ≈ 7.4% приближение к цели за кадр при 60fps → ≈ 30 кадров до прихода
	//   Это именно та формула из исходников Celeste.
	_updateCamera(delta) {
		// Катсцена конца уровня / входа: камера зафиксирована на якоре (_camTarget),
		// за игроком не следим (на входе игрок сам доходит до кадра слева).
		if (this._endCutscene || this._entering) return
		const dtS = Math.min(delta / 1000, 0.05) // секунды, cap 50ms на случай лагов
		const p = this.localPlayer

		// ── Кинематографический фокус на лампе (lamplever) ────────────────────────
		// Плавный наезд к точке за CAM_PAN_MS (ease), задержка, плавный возврат.
		// Камера следит за _camTarget с lerp 1.0, поэтому достаточно плавно вести
		// сам _camTarget — резкого «тпхания» нет.
		if (this._camFocus) {
			const f = this._camFocus
			const now = this.time.now
			// easeInOutCubic — плавный разгон и торможение (кинематографично)
			const ease = t =>
				t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
			if (f.phase === 'in') {
				const t = Math.min(1, (now - f.t0) / f.panMs)
				const e = ease(t)
				this._camTarget.x = f.sx + (f.tx - f.sx) * e
				this._camTarget.y = f.sy + (f.ty - f.sy) * e
				if (t >= 1) {
					f.phase = 'hold'
					f.t0 = now
					this._breakLampAndOrb() // камера доехала → бьём стекло, орб падает
				}
			} else if (f.phase === 'hold') {
				this._camTarget.x = f.tx
				this._camTarget.y = f.ty
				if (now - f.t0 >= f.holdMs) {
					f.phase = 'out'
					f.t0 = now
					f.sx = this._camTarget.x
					f.sy = this._camTarget.y
					this._setCinemaBars(false, f.panMs) // полосы уезжают ровно за время возврата камеры
				}
			} else {
				// 'out' — плавно назад к игроку (он мог двигаться)
				const t = Math.min(1, (now - f.t0) / f.panMs)
				const e = ease(t)
				this._camTarget.x = f.sx + (p.x - f.sx) * e
				this._camTarget.y = f.sy + (p.y - f.sy) * e
				if (t >= 1) {
					this._camFocus = null
					this._inputLocked = false // камера вернулась — возвращаем управление
				}
			}
			return
		}

		// Обычное слежение за игроком — экспоненциальный распад (формула Celeste).
		const factor = 1 - Math.pow(0.01, dtS)
		this._camTarget.x += (p.x - this._camTarget.x) * factor
		this._camTarget.y += (p.y - this._camTarget.y) * factor
	}

	// Создаёт (один раз) и переключает киношные полосы letterbox.
	// durationMs — длительность выезда/уезда (синхронизируется с движением камеры).
	// 0 = мгновенно (для очистки на shutdown).
	_setCinemaBars(show, durationMs = 700) {
		const mk = id => {
			let el = document.getElementById(id)
			if (!el) {
				el = document.createElement('div')
				el.id = id
				el.className =
					'cinema-bar ' +
					(id === 'cinemaBarTop' ? 'cinema-bar-top' : 'cinema-bar-bottom')
				document.getElementById('game-container').appendChild(el)
			}
			return el
		}
		const top = mk('cinemaBarTop')
		const bot = mk('cinemaBarBottom')
		// Задаём длительность перехода ДО смены класса. Принудительный reflow
		// (offsetWidth) фиксирует стартовое состояние трансформа — без него браузер
		// «схлопывает» начальный и конечный transform в один кадр и полосы появляются
		// мгновенно (классический баг CSS-transition на только что вставленном узле).
		for (const el of [top, bot]) {
			el.style.transitionDuration =
				durationMs > 0 ? durationMs / 1000 + 's' : '0s'
			void el.offsetWidth
		}
		top.classList.toggle('show', show)
		bot.classList.toggle('show', show)
	}

	// Запускает кинематографический наезд камеры к точке cameramove и возврат.
	_focusCameraOnLamp() {
		if (!this._camFocusPoint) return
		// Полосы выезжают РОВНО столько, сколько камера едет к центру (panMs ниже = 3000).
		this._setCinemaBars(true, 3000) // киношные полосы плавно выезжают за время наезда
		// Блокируем управление на всё время катсцены — игроки только смотрят.
		this._inputLocked = true
		this.localPlayer.body?.setVelocityX(0) // без остаточного скольжения
		// followOffset НЕ трогаем (его мгновенная смена давала вертикальный рывок).
		// Чтобы точка cameramove встала ровно по центру при оффсете (0,27),
		// компенсируем цель: target.y = focus.y + 27 → на экране focus в центре.
		this._camFocus = {
			phase: 'in',
			sx: this._camTarget.x, // старт — текущее положение
			sy: this._camTarget.y,
			tx: this._camFocusPoint.x, // цель — точка у лампы (followOffset.x = 0)
			ty: this._camFocusPoint.y + 27, // +27 компенсирует followOffset.y
			t0: this.time.now,
			panMs: 3000, // 3 секунды плавного наезда (и столько же на возврат)
			holdMs: 2400, // держим у лампы: разбитие + полёт орба (~900мс) + момент
		}
	}

	// Начальный спавн (за картой) ЛОКАЛЬНОГО игрока: host → spawn1, гость → spawn2.
	_getSpawn() {
		const own = this.role === 'host' ? this._spawn1 : this._spawn2
		return own || this._spawnFromMap || { x: 80, y: WORLD_H - 90 }
	}

	// Начальный спавн УДАЛЁННОГО игрока (роль партнёра): host → spawn2, гость → spawn1.
	_getRemoteSpawn() {
		const other = this.role === 'host' ? this._spawn2 : this._spawn1
		return other || this._getSpawn()
	}

	// Точка покоя локального игрока (куда он выходит на входе): спавн своей роли.
	_getRestTarget() {
		const t = this.role === 'host' ? this._spawnHost : this._spawnGuest
		return t || this._getSpawn()
	}

	// true → у уровня заданы обе точки покоя (spawnhost+spawnguest) → играем вход.
	_hasEntrance() {
		return !!(this._spawnHost && this._spawnGuest)
	}

	// Переключает визуал двери: (closed1+closed2) ↔ (open1+open2).
	// *1 рисуется под игроком (depth 9), *2 над игроком (depth 11).
	// Прячем/показываем дверь ГЛУБИНОЙ: спрятанное уезжает за все фоны (DOOR_BEHIND),
	// показанное выдвигается вперёд. setVisible не использую (по нему дверь не пряталась).
	_setDoorVisual(open) {
		// Показанное → вперёд (visible). Спрятанное → ЗА параллакс (DOOR_BEHIND) +
		// setVisible(false). Дверь целиком рисуют PNG-створки level1door*.
		const setEl = (obj, frontDepth, wantShown) =>
			obj?.setVisible(wantShown).setDepth(wantShown ? frontDepth : DOOR_BEHIND)
		setEl(this._doorImgOpen1, DOOR_FRONT_UNDER, open)
		setEl(this._doorImgOpen2, DOOR_FRONT_OVER, open)
		setEl(this._doorImgClosed1, DOOR_FRONT_UNDER, !open)
		setEl(this._doorImgClosed2, DOOR_FRONT_OVER, !open)
		// Кнопки группы 1: нажата (texOn) когда дверь открыта, иначе отжата (texOff).
		// Группы 2/3 управляются отдельно в _updateActionButtons.
		for (const lv of this._levers) {
			if (lv.group === 1) lv.btn?.setTexture(open ? lv.texOn : lv.texOff)
		}
	}

	// Дверь открыта если я ИЛИ партнёр стоит на рычаге. Применяет коллайдер + визуал.
	_applyDoorState() {
		const open = this._localOnLever || this._remoteOnLever
		if (open === this._leverOpen) return
		this._leverOpen = open
		if (this.door) this.door.body.enable = !open
		this._setDoorVisual(open)
		// Звук двери — только при реальной смене состояния (не на старте уровня).
		// Позиционный: затухает с дистанцией от игрока до двери.
		const dx = this.door?.x ?? this.localPlayer?.x ?? 0
		const dy = this.door?.y ?? this.localPlayer?.y ?? 0
		this._posSfx(open ? 'door-open' : 'door-close', dx, dy, 0.6)
	}

	// Финальные кнопки (группы 2/3) и текст finaltext. Синхронизируется по СЕТИ:
	// каждый клиент детектит касание ТОЛЬКО своего (локального) игрока его кнопкой и
	// вещает партнёру (overlap удалённого игрока ненадёжен, как и у двери). Другая
	// сторона приходит через on('finalReach'). → текст одинаков у обоих.
	//   group 2 — кнопка ХОСТА (btnhost*): нажата/текст «Хост дошёл до конца», когда ХОСТ на ней.
	//   group 3 — кнопка ГОСТЯ (btnplayer*): нажата/текст «Гость дошёл до конца», когда ГОСТЬ на ней.
	// Кнопка нажата ТОЛЬКО когда центр хитбокса игрока почти точно совпадает с
	// центром объекта lever (cx,cy), а не на всём 32px-теле. dx — горизонтальное
	// совпадение (игрок стоит ровно по центру кнопки), dy — что он рядом по высоте
	// (стоит на кнопке, а не на платформе сверху/снизу). Хитбокс игрока 8×11.
	_onButton(player, lv) {
		if (!player?.body || !lv) return false
		const c = player.body.center
		return Math.abs(c.x - lv.cx) <= 11 && Math.abs(c.y - lv.cy) <= 18
	}

	_updateActionButtons() {
		// После старта катсцены конца уровня кнопки больше не пересчитываем — иначе
		// при сходе игрока с кнопки сыграл бы switch-off и текст сбросился бы.
		if (this._levelFinished) return
		const over = (p, lv) => this._onButton(p, lv)
		// МОЯ группа: хост отвечает за группу 2, гость — за группу 3 (localPlayer).
		const myGroup = this.role === 'host' ? 2 : 3
		let myReached = false
		for (const lv of this._levers) {
			if (lv.group === myGroup && over(this.localPlayer, lv)) myReached = true
		}
		// Своё состояние + вещаем партнёру при изменении.
		if (this.role === 'host') {
			if (myReached !== this._hostReached) {
				this._hostReached = myReached
				this._playSwitch(myReached, this.localPlayer.x, this.localPlayer.y) // звук финальной кнопки
				networkClient.finalReach(myReached)
			}
		} else if (myReached !== this._guestReached) {
			this._guestReached = myReached
			this._playSwitch(myReached, this.localPlayer.x, this.localPlayer.y) // звук финальной кнопки
			networkClient.finalReach(myReached)
		}

		// Текстуры кнопок — по СИНХРОНИЗИРОВАННОМУ состоянию (видно обоим игрокам).
		for (const lv of this._levers) {
			if (lv.group === 2)
				lv.btn?.setTexture(this._hostReached ? lv.texOn : lv.texOff)
			else if (lv.group === 3)
				lv.btn?.setTexture(this._guestReached ? lv.texOn : lv.texOff)
		}

		// Строки finaltext меняются ПОСИМВОЛЬНО (флип-табло) при смене состояния.
		// «Хост(а)» синие, «Гость/Гостя» оранжевые. Флип короткий (~0.7с).
		if (this._finalLine1) {
			const plain1 = this._hostReached
				? i18n.t('final.host_done_plain')
				: i18n.t('final.host_wait_plain')
			if (plain1 !== this._finalLine1Shown) {
				this._finalLine1Shown = plain1
				const html1 = this._hostReached
					? i18n.t('final.host_done_html')
					: i18n.t('final.host_wait_html')
				this._flipText(this._finalLine1, plain1, {
					finalHtml: html1,
					intermediateMs: 150,
					tickMs: 45,
				})
			}
			const plain2 = this._guestReached
				? i18n.t('final.guest_done_plain')
				: i18n.t('final.guest_wait_plain')
			if (plain2 !== this._finalLine2Shown) {
				this._finalLine2Shown = plain2
				const html2 = this._guestReached
					? i18n.t('final.guest_done_html')
					: i18n.t('final.guest_wait_html')
				this._flipText(this._finalLine2, plain2, {
					finalHtml: html2,
					intermediateMs: 150,
					tickMs: 45,
				})
			}
		}

		// Оба дошли до кнопок → конец уровня. Сначала даём строке второго игрока доиграть
		// флип «дошел до конца» (обе строки видны), затем запускаем катсцену со слиянием.
		if (this._hostReached && this._guestReached && !this._levelFinished) {
			this._levelFinished = true
			this.time.delayedCall(1100, () => this._startLevelEndCutscene())
		}
	}

	// ── Финал уровня: симметричный круг-переход на следующий уровень ─────────────
	// Прыжки → уход вправо за камеру → круг сужается на finaltext (надпись меняется на
	// «Уровень N Пройден!») → пауза → полностью чёрно → грузится следующий уровень →
	// круг РАСКРЫВАЕТСЯ обратно (_playReverseIris в create). Музыка/звуки плавно глушатся.
	_startLevelEndCutscene() {
		this._inputLocked = true
		this._endCutscene = true // камера замирает
		this.localPlayer.body?.setVelocity(0, 0)
		// Слияние двух строк «дошел» в одну БОЛЬШУЮ «Уровень N Пройден!» (короткий скрэмбл).
		const flipMs = this._mergeFinaltextToTitle()
		const NARROW_MS = 1600 // длительность сужения круга = длительности раскрытия (_playReverseIris)
		// Круг НАЧИНАЕТ сужаться ровно когда надпись собралась (flipMs), затем закрывается.
		const CLOSE_AT = Math.max(flipMs, 1100)
		const lp = this.localPlayer
		lp.scriptedJump() // прыжок 1
		this.time.delayedCall(600, () => lp.scriptedJump()) // прыжок 2
		this.time.delayedCall(Math.max(700, CLOSE_AT - 300), () =>
			lp.scriptedWalk(1),
		) // вправо
		this.time.delayedCall(CLOSE_AT, () => this._levelEndCloseIris(NARROW_MS)) // → круг
	}

	// Создаёт canvas-диафрагму с фикс. центром (cx,cy) экранных px. draw(r) заливает экран
	// сплошным чёрным и вырезает ПИКСЕЛЬНЫЙ круг радиуса r. targetR — радиус, на котором круг
	// «держится» (вмещает надпись): по нему подбирается размер пикселя. Возвращает {cv,draw,sf,bigR}.
	_createIris(cx, cy, targetR = 120) {
		const W = window.innerWidth
		const H = window.innerHeight
		const cv = document.createElement('canvas')
		cv.width = W
		cv.height = H
		cv.style.cssText =
			'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;'
		document.getElementById('hud-overlay').appendChild(cv)
		const ctx = cv.getContext('2d')
		const rect = this.game.canvas.getBoundingClientRect()
		const sf = this.cameras.main.zoom * (rect.width / this.game.config.width)
		// Размер «большого пикселя». Подбираем так, чтобы на радиусе удержания (targetR) круг
		// имел ~8 пикселей радиуса: достаточно квадратов для узнаваемо круглого края (не «ромб»
		// и не слишком грубо), при этом пиксель-арт-ступеньки остаются заметными.
		const BLOCK = Math.max(2, Math.round(targetR / 8))
		// Сетка ВЫРОВНЕНА ПО ЦЕНТРУ (cx,cy): один пиксель центрируется ровно на нём, остальные
		// симметричны → круг одинаков сверху/снизу/слева/справа (без перекоса).
		const offX = (((cx - BLOCK / 2) % BLOCK) + BLOCK) % BLOCK
		const offY = (((cy - BLOCK / 2) % BLOCK) + BLOCK) % BLOCK
		const draw = r => {
			ctx.clearRect(0, 0, W, H)
			// Фон — СПЛОШНОЙ чёрный.
			ctx.globalCompositeOperation = 'source-over'
			ctx.fillStyle = '#000'
			ctx.fillRect(0, 0, W, H)
			// Круг ВЫРЕЗАЕМ пиксель-блоками (destination-out). Блок вырезаем, только если он
			// ПОЛНОСТЬЮ внутри круга (его самый дальний угол в радиусе) → диск вписан, без
			// торчащих одиночных блоков-«носов» по краям, силуэт ровный. Вокруг — сплошная чернота.
			ctx.globalCompositeOperation = 'destination-out'
			const r2 = r * r
			for (let by = offY - BLOCK; by < H; by += BLOCK) {
				// fy — расстояние до дальнего по Y угла блока от центра.
				const fy = Math.max(Math.abs(by - cy), Math.abs(by + BLOCK - cy))
				const span = r2 - fy * fy
				if (span <= 0) continue
				const hw = Math.sqrt(span) // макс. допустимое расстояние дальнего угла по X
				for (let bx = offX - BLOCK; bx < W; bx += BLOCK) {
					const fx = Math.max(Math.abs(bx - cx), Math.abs(bx + BLOCK - cx))
					// Координаты ОКРУГЛЯЕМ до целых пикселей: соседние вырезанные блоки тогда
					// стыкуются ровно по границе пикселя, без сглаживания → нет полупрозрачных
					// швов-сетки поверх открытой области (BLOCK целый, шаг целый → стык впритык).
					if (fx <= hw) ctx.fillRect(Math.round(bx), Math.round(by), BLOCK, BLOCK)
				}
			}
			ctx.globalCompositeOperation = 'source-over'
		}
		return { cv, draw, sf, bigR: Math.hypot(W, H) }
	}

	// Круг сужается на finaltext; надпись → «Уровень N Пройден!»; пауза 1с; полностью черно.
	_levelEndCloseIris(narrowMs = 1200) {
		// Центр и размер круга — по фактической надписи (чтобы вместить и центрировать её).
		let cx,
			cy,
			fitR = 0
		const tr = this._titleLineEl?.getBoundingClientRect()
		if (tr && tr.width) {
			cx = tr.left + tr.width / 2
			cy = tr.top + tr.height / 2
			fitR = tr.width * 0.62 // радиус, вмещающий надпись по ширине
		} else {
			const c = this._finalTextPos
				? this._worldToScreen(this._finalTextPos.x, this._finalTextPos.y)
				: { x: window.innerWidth / 2, y: window.innerHeight / 2 }
			cx = c.x
			cy = c.y
		}
		// sf считаем заранее (нужен для smallR ещё до создания диафрагмы), чтобы передать
		// радиус удержания в _createIris — по нему подбирается размер пикселя круга.
		const rect = this.game.canvas.getBoundingClientRect()
		const sf0 = this.cameras.main.zoom * (rect.width / this.game.config.width)
		const smallR = Math.max(56 * sf0, fitR) - 8 * sf0 // вместить надпись, минус полтайла
		const iris = this._createIris(cx, cy, smallR)
		this._irisEl = iris.cv
		// Надпись уже запущена в _startLevelEndCutscene; держим её поверх диафрагмы.
		const proxy = { r: iris.bigR }
		iris.draw(iris.bigR)
		this.tweens.add({
			targets: proxy,
			r: smallR,
			duration: narrowMs,
			ease: 'Cubic.easeIn',
			onUpdate: () => iris.draw(proxy.r),
			onComplete: () => {
				this.time.delayedCall(1000, () => {
					this.tweens.add({
						targets: proxy,
						r: 0,
						duration: 800,
						ease: 'Cubic.easeIn',
						onUpdate: () => iris.draw(proxy.r),
						onComplete: () => this._levelEndGoBlack(),
					})
				})
			},
		})
	}

	// Сливает две строки finaltext («дошел») в одну БОЛЬШУЮ строку «Уровень N Пройден!»
	// (вдвое крупнее → занимает место двух строк) с флип-анимацией. flipMs — длительность.
	// Надпись остаётся в finaltext (#hud-prompts) → ПОД canvas-диафрагмой → перекрывается
	// чёрным при закрытии круга. flipMs подобран так, чтобы собралась к маленькому кругу.
	_mergeFinaltextToTitle() {
		const el = this._finalTextEl
		if (!el) return 0
		el.innerHTML = ''
		const big = document.createElement('div')
		big.style.fontSize = '1.0em' // размер большой надписи (множитель к 2.25vw базы)
		big.style.lineHeight = '1'
		el.appendChild(big)
		this._finalLine1 = null
		this._finalLine2 = null
		this._titleLineEl = big
		// Короткая фаза случайных символов (~450мс), затем быстрая волна фиксации.
		// «Пройден!» — салатовый (fc-pass); цвет держится и на скрэмбл-символах (см. _flipText).
		return this._flipText(big, i18n.t('game.level_passed_plain', { n: this.levelId }), {
			finalHtml: i18n.t('game.level_passed_html', { n: this.levelId }),
			intermediateMs: 450,
			tickMs: 50,
		})
	}

	// Сплит-флап (табло): буквы крутят случайные символы и фиксируются волной слева
	// направо. opts.intermediateMs — длительность фазы сплошного скрэмбла; tickMs —
	// скорость смены символов; finalHtml — что поставить по завершении (с цветными span).
	// Возвращает полную длительность. Таймер на самом элементе → элементы независимы.
	_flipText(el, plain, opts = {}) {
		const { finalHtml = null, intermediateMs = 400, tickMs = 55 } = opts
		// Алфавит скрэмбла под язык: латиница для EN, кириллица для RU
		const GLYPHS = i18n.lang === 'en'
			? 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789%:#@*?!'
			: 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдежзийклмнопрстуфхцчшщъыьэюя0123456789№%:#@*?!'
		if (el._flipTimer) clearInterval(el._flipTimer)
		if (el._flipSound) {
			el._flipSound.stop()
			el._flipSound.destroy()
			el._flipSound = null
		}
		// Звук прокрутки букв (луп) на всё время флипа.
		if (this.cache.audio.exists('scroll')) {
			el._flipSound = this.sound.add('scroll', {
				loop: true,
				volume: 0.45 * AudioManager.getMultiplier('sfx'),
			})
			el._flipSound.play()
		}
		const chars = [...plain]
		// Карта цвета по индексам символов: парсим finalHtml (там цветные <span>), чтобы те
		// же позиции были цветными ВО ВРЕМЯ скрэмбла, а не белыми до самого конца.
		const clsMap = new Array(chars.length).fill(null)
		if (finalHtml) {
			let ci = 0
			let cur = null
			for (let k = 0; k < finalHtml.length; ) {
				if (finalHtml[k] === '<') {
					const close = finalHtml.indexOf('>', k)
					const tag = finalHtml.slice(k + 1, close)
					if (tag.startsWith('/span')) cur = null
					else if (tag.startsWith('span')) {
						const m = tag.match(/class="([^"]+)"/)
						cur = m ? m[1] : null
					}
					k = close + 1
				} else {
					if (ci < clsMap.length) clsMap[ci] = cur
					ci++
					k++
				}
			}
		}
		// intermediateMs — короткая фаза, когда ВСЕ буквы крутят случайные символы; затем
		// они фиксируются волной слева направо (по 1 букве на тик). Полная длительность =
		// intermediateMs + (len-1)·tickMs (возвращается для подгонки таймингов круга).
		const settleBase = Math.max(1, Math.round(intermediateMs / tickMs))
		const lastTick = settleBase + Math.max(0, chars.length - 1)
		let tick = 0
		const render = () => {
			el.innerHTML = chars
				.map((ch, i) => {
					let out
					if (ch === ' ') out = ' '
					else if (tick >= settleBase + i)
						out = ch // зафиксирована
					else out = GLYPHS[(Math.random() * GLYPHS.length) | 0] // крутим случайные
					// Цветные позиции оборачиваем в их span и во время скрэмбла → буквы
					// сразу синие/оранжевые, а не белые до фиксации.
					return clsMap[i] ? `<span class="${clsMap[i]}">${out}</span>` : out
				})
				.join('')
		}
		render()
		el._flipTimer = setInterval(() => {
			tick++
			render()
			if (tick > lastTick) {
				clearInterval(el._flipTimer)
				el._flipTimer = null
				el.innerHTML = finalHtml ?? plain
				if (el._flipSound) {
					el._flipSound.stop()
					el._flipSound.destroy()
					el._flipSound = null
				}
			}
		}, tickMs)
		return lastTick * tickMs // полная длительность анимации (мс)
	}

	// Экран чёрный: плавно глушим музыку и звуки, затем грузим следующий уровень.
	_levelEndGoBlack() {
		MusicManager.stop({ fadeMs: 800 }) // музыка плавно затухает
		this._ambDuckTween?.stop() // не конфликтуем с duck оверлея способности
		const a = { v: this._ambDuck }
		this._ambDuckTween = this.tweens.add({
			targets: a,
			v: 0,
			duration: 800,
			ease: 'Linear',
			onUpdate: () => {
				this._ambDuck = a.v // дождь/лампы плавно глушатся
			},
			onComplete: () => {
				this._ambDuckTween = null
				this._advanceToNextLevel()
			},
		})
	}

	// Переход на следующий уровень; чернота держится (Transition) до обратной диафрагмы.
	_advanceToNextLevel() {
		const next = Math.min(this.levelId + 1, 10)
		window.__currentSlotMaxLevel = next
		const slot = window.__currentSlot
		if (slot !== undefined) SaveSystem.setSave(slot, { level: next })
		SaveSystem.setMaxLevel(next)
		window.__l2sFromCutscene = true // create() раскроет обратную диафрагму
		Transition.black() // держим черноту через рестарт сцены
		if (this.role === 'host') {
			saveSessionPlaytime()
			window.__l2s = { ...window.__l2s, levelId: next }
			networkClient.startGame(next) // гость получит game:start → рестарт
			this.time.delayedCall(50, () => {
				this._netUnsub.forEach(u => u())
				this._netUnsub = []
				this.scene.restart({ levelId: next, role: this.role })
			})
		}
		// гость: ждёт game:start (его обработчик перезапустит сцену)
	}

	// Обратная диафрагма на старте уровня: чёрный круг РАСКРЫВАЕТСЯ из центра кадра.
	// На входе игрок за левым краем экрана → раскрываем из точки покоя (центр кадра),
	// а не из игрока, иначе круг открылся бы за кадром.
	_playReverseIris() {
		const focus = this._entering ? this._getRestTarget() : this.localPlayer
		const c = focus
			? this._worldToScreen(focus.x, focus.y)
			: { x: window.innerWidth / 2, y: window.innerHeight / 2 }
		const iris = this._createIris(c.x, c.y)
		this._irisEl = iris.cv
		iris.draw(0) // полностью чёрный
		Transition.fadeIn(0) // убрать Transition-черноту мгновенно (диафрагма держит чёрный)
		const proxy = { r: 0 }
		this.tweens.add({
			targets: proxy,
			r: iris.bigR,
			duration: 1600,
			ease: 'Cubic.easeOut',
			onUpdate: () => iris.draw(proxy.r),
			onComplete: () => {
				iris.cv.remove()
				this._irisEl = null
			},
		})
	}

	// Локальное завершение уровня после диафрагмы (БЕЗ сетевого broadcast — оба клиента
	// проигрывают катсцену независимо и показывают «пройден» каждый после своей диафрагмы).
	_finishLevelLocal() {
		if (this._exiting) return
		this._exiting = true
		for (const lbl of this._worldLabels) lbl.el?.remove()
		this._worldLabels = []
		const newLevel = Math.min(this.levelId + 1, 10)
		window.__currentSlotMaxLevel = newLevel
		const slot = window.__currentSlot
		if (slot !== undefined) SaveSystem.setSave(slot, { level: newLevel })
		SaveSystem.setMaxLevel(newLevel)
		this._showLevelComplete()
	}

	_buildLevel() {
		this.platforms = this.physics.add.staticGroup()
		this.dynamicPlatforms = this.physics.add.staticGroup()
		this._spawnFromMap = null
		this._useTiledVisuals = false // set true when real tile layers are rendered

		const mapKey = `level${this.levelId}`
		if (this.cache.tilemap.exists(mapKey)) {
			this._buildFromTiledMap(mapKey)
		} else if (this.levelId === 10) {
			this._buildLevel10()
		} else {
			this._buildStub()
		}
	}

	// ── Tiled map builder ───────────────────────────────────────────────────────
	// Renders tile layers 'back' (depth 1) and 'plat' (depth 4) for visuals.
	// Parses 'objects' layer for collision/game-logic objects.
	// Object types: ground | platform | spawn | exit | orb | plate | door | sign
	_buildFromTiledMap(mapKey) {
		const map = this.make.tilemap({ key: mapKey })

		// All ground/platform visuals come from Tiled tile layers — NEVER draw tileSprites.
		// Even if the PNG failed to load, no fallback stubs are drawn.
		this._useTiledVisuals = true

		// ── World bounds from map size (auto, no hardcode needed) ─────────────────
		const mapW = map.widthInPixels // tileWidth  × mapTileWidth
		const mapH = map.heightInPixels // tileHeight × mapTileHeight
		tlog(
			`[Level] Map size: ${mapW}×${mapH} px (${map.width}×${map.height} tiles @ ${map.tileWidth}px)`,
		)
		this.physics.world.setBounds(0, 0, mapW, mapH)
		this.cameras.main.setBounds(0, 0, mapW, mapH)

		// ── Diagnostics ───────────────────────────────────────────────────────
		const layerNames = map.layers.map(l => l.name)
		tlog(`[Level] ══ Tiled map: ${mapKey} ══`)
		tlog(`[Level] Tile layers: [${layerNames.join(', ')}]`)
		tlog(
			`[Level] Tilesets in JSON: [${(map.tilesets || []).map(t => t.name).join(', ')}]`,
		)

		// ── Tileset registry ─────────────────────────────────────────────────────
		// Maps Tiled tileset name → Phaser texture key + explicit tile size for
		// external TSX tilesets (Phaser cannot parse TSX files automatically).
		// Add rows here whenever you add a new tileset sheet to public/levels/.
		const TILESET_MAP = {
			tilemap_packed: { key: 'tilemap_packed' },
			'tilemap-backgrounds_packed': {
				key: 'tilemap-backgrounds_packed',
				w: 24,
				h: 24,
			},
			// Numeric sheets 1.png … 9.png
			1: { key: 'ts-1', w: 16, h: 16 },
			2: { key: 'ts-2', w: 16, h: 16 },
			3: { key: 'ts-3', w: 16, h: 16 },
			4: { key: 'ts-4', w: 16, h: 16 },
			5: { key: 'ts-5', w: 16, h: 16 },
			6: { key: 'ts-6', w: 16, h: 16 },
			7: { key: 'ts-7', w: 16, h: 16 },
			8: { key: 'ts-8', w: 16, h: 16 },
			9: { key: 'ts-9', w: 16, h: 16 },
			// Named sheets
			platformer: { key: 'ts-platformer', w: 8, h: 8 },
			all: { key: 'ts-all', w: 16, h: 16 },
			iso: { key: 'ts-iso', w: 16, h: 16 },
			topdown: { key: 'ts-topdown', w: 16, h: 16 },
			topdown_jungle: { key: 'ts-topdown_jungle', w: 16, h: 16 },
			'violet-industrial-textures': {
				key: 'ts-violet-industrial',
				w: 16,
				h: 16,
			},
			'castle-tileset': { key: 'ts-castle', w: 16, h: 16 },
			snowstone: { key: 'ts-snowstone', w: 16, h: 16 },
			'dungeon-prison-theme-tilesheet': {
				key: 'ts-dungeon-prison',
				w: 16,
				h: 16,
			},
			'Lined Brick': { key: 'ts-lined-brick', w: 16, h: 16 },
			tileset_update: { key: 'ts-tileset-update', w: 16, h: 16 },
			'tileset_update  darker': {
				key: 'ts-tileset-update-darker',
				w: 16,
				h: 16,
			}, // 2 пробела — как в JSON

			'sci-fi-tileset': { key: 'ts-sci-fi', w: 16, h: 16 },
			spike: { key: 'ts-spike', w: 16, h: 16 },
			Платформа1: { key: 'ts-platforma1', w: 16, h: 16 },
			Платформа2: { key: 'ts-platforma2', w: 16, h: 16 },
			Платформа3: { key: 'ts-platforma3', w: 16, h: 16 },
			Фонарь: { key: 'ts-fonar', w: 16, h: 16 },
			дверь1: { key: 'ts-dver1', w: 17, h: 17 }, // тайлы 17×17 (см. JSON tilewidth)
			дверь2: { key: 'ts-dver2', w: 17, h: 17 },
		}

		const tilesets = []
		let anyNormalMap = false // хоть у одного тайлсета есть normal map → включим Light2D на слоях
		for (const ts of map.tilesets || []) {
			const info = TILESET_MAP[ts.name]
			if (!info) {
				tlog(
					`[Level] ⚠ Unknown tileset "${ts.name}" — add it to TILESET_MAP in GameScene.js`,
				)
				continue
			}
			if (!this.textures.exists(info.key)) {
				tlog(
					`[Level] ⚠ Tileset "${ts.name}" — texture "${info.key}" not loaded (check PreloadScene)`,
				)
				continue
			}
			const phTs = info.w
				? map.addTilesetImage(ts.name, info.key, info.w, info.h, 0, 0)
				: map.addTilesetImage(ts.name, info.key)
			if (phTs) {
				tilesets.push(phTs)
				const hasNormal = this.textures.get(info.key).dataSource?.length > 0
				if (hasNormal) anyNormalMap = true
				tlog(
					`[Level] ✓ Tileset "${ts.name}" → ${info.key}${hasNormal ? ' (+normal map)' : ''}`,
				)
			} else {
				tlog(
					`[Level] ❌ addTilesetImage failed for "${ts.name}" (name mismatch in JSON?)`,
				)
			}
		}
		this._lightingActive = anyNormalMap // create() включит Light2D на игроках, если true

		// ── Запечённый фон уровня ────────────────────────────────────────────────
		// Если есть готовая картинка всей карты + её normal map (level{N}.png /
		// level{N}_n.png), рисуем террейн ОДНИМ изображением вместо сборки из тайлов.
		// Плюс: Laigter печёт нормаль по цельной карте → нет атласных швов и «подушек»
		// на каждом тайле. Картинка ровно в размер мира (Tiled export, scale 1) → кладём
		// в (0,0). Коллизия по-прежнему со слоя объектов. Слои back2/back пропускаем —
		// их визуал заменяет запечённый фон. Нет файла → тихий фолбэк на тайлы.
		const bakedKey = `level${this.levelId}-baked`
		const skipLayers = new Set()
		const bakedExists = this.textures.exists(bakedKey)
		tlog(`[Baked] key="${bakedKey}" exists=${bakedExists}`)
		if (bakedExists) {
			// Размер текстуры и лимит GPU: огромная карта может не влезть в MAX_TEXTURE_SIZE
			// → WebGL не загрузит → чёрный экран. Проверяем и при превышении откатываемся
			// на тайловый рендер (а не молча показываем пустоту).
			const tex = this.textures.get(bakedKey)
			const srcImg = tex.getSourceImage()
			const tw = srcImg?.width ?? 0
			const th = srcImg?.height ?? 0
			const gl = this.sys.renderer.gl
			const maxTex = gl ? gl.getParameter(gl.MAX_TEXTURE_SIZE) : 0
			const bgHasNormal = tex.dataSource?.length > 0
			const ds = bgHasNormal ? tex.dataSource[0] : null
			tlog(
				`[Baked] diffuse=${tw}x${th}  normal=${ds ? ds.width + 'x' + ds.height : 'none'}  GL.MAX_TEXTURE_SIZE=${maxTex}  rendererType=${this.sys.renderer.type}(WEBGL=${Phaser.WEBGL})`,
			)

			if (maxTex && (tw > maxTex || th > maxTex)) {
				tlog(
					`[Baked] ⚠ текстура ${tw}x${th} БОЛЬШЕ лимита GPU ${maxTex} → фон не загрузится. Откат на тайловый рендер.`,
				)
			} else {
				const bg = this.add.image(0, 0, bakedKey).setOrigin(0, 0).setDepth(1)
				if (bgHasNormal) {
					bg.setPipeline(this._lightPipelineKey)
					this._lightingActive = true // фон с нормалью → лампы лепят рельеф; игроки тоже на свету
				}
				skipLayers.add('back2').add('back')
				// «Полностью запечённые» уровни: картинка = весь визуал → пропускаем ВСЕ
				// тайл-слои (back2/back/spikes/…), коллизия и так берётся со слоёв объектов.
				const fullBaked = BAKED_FULL_LEVELS.has(this.levelId)
				if (fullBaked) for (const l of map.layers) skipLayers.add(l.name)
				tlog(
					`[Baked] ✓ фон нарисован: pos(0,0) origin(0,0) depth=1 pipeline=${bgHasNormal ? this._lightPipelineKey : 'default'} visible=${bg.visible} alpha=${bg.alpha} display=${Math.round(bg.displayWidth)}x${Math.round(bg.displayHeight)} — ${fullBaked ? 'ВСЕ тайл-слои пропущены' : 'back2/back пропущены'}`,
				)
			}
		}

		// ── Door visuals ──────────────────────────────────────────────────────────
		// Дверь прячется ЗА параллакс (depth DOOR_BEHIND, горы перекрывают) +
		// setVisible(false). Рычаг зовёт _setDoorVisual(open).
		//   Открытая дверь = тайл-слои back0/back-0.5 (рендерятся ниже) + PNG dooropen1/2.
		//   Закрытая дверь = PNG level1doorclosed1/2 (видна по умолчанию).
		//   back-1/back-2 — старые слои, не рендерим.
		skipLayers.add('back-1').add('back-2')
		// Дверь рисуем ТОЛЬКО на DOOR_LEVELS (PNG-створки level1-door-* — ассеты первого
		// уровня). Иначе на других уровнях появилась бы дверь из level1 в точке (0,0).
		if (DOOR_LEVELS.has(this.levelId)) {
			const mkDoor = (key, depth, visible) => {
				if (!this.textures.exists(key)) return null
				const img = this.add
					.image(0, 0, key)
					.setOrigin(0, 0)
					.setDepth(depth)
					.setVisible(visible)
				if (this._lightingActive) img.setPipeline(this._lightPipelineKey)
				return img
			}
			// Открытая дверь — скрыта по умолчанию (за параллакс + invisible).
			this._doorImgOpen1 = mkDoor('level1-door-open1', DOOR_BEHIND, false)
			this._doorImgOpen2 = mkDoor('level1-door-open2', DOOR_BEHIND, false)
			// Закрытая дверь — видна по умолчанию (спереди).
			this._doorImgClosed1 = mkDoor(
				'level1-door-closed1',
				DOOR_FRONT_UNDER,
				true,
			)
			this._doorImgClosed2 = mkDoor(
				'level1-door-closed2',
				DOOR_FRONT_OVER,
				true,
			)
		}

		// ── Render all tile layers automatically ─────────────────────────────────
		// Every layer in the JSON is rendered using all registered tilesets.
		// Depth: back=1 (far bg), cloud=2 (mid bg), everything else=4 (platforms/fg)
		// Parallax scrollFactor: back=0.2 (slow sky), cloud=0.5 (mid clouds), rest=1.0
		if (tilesets.length > 0) {
			// Phaser освещает тайл-слой одной normal map — из tileset[0] (см.
			// LightPipeline.getNormalMap: `gameObject.tileset[0].image.dataSource[0]`).
			// Поэтому КАЖДОМУ слою отдаём только реально используемые им тайлсеты, а
			// нормал-маппленные ставим первыми — иначе tileset[0] окажется без нормали
			// и свет ляжет плоско (как было). Работает чисто, когда слой = один тайлсет.
			const hasNormal = ts => ts.image?.dataSource?.length > 0
			const tilesetsForLayer = layerData => {
				const used = new Set()
				for (const row of layerData.data) {
					for (const tile of row) {
						if (!tile || tile.index < 0) continue
						for (const ts of tilesets) {
							if (
								tile.index >= ts.firstgid &&
								tile.index < ts.firstgid + ts.total
							) {
								used.add(ts)
								break
							}
						}
					}
				}
				const arr = used.size ? [...used] : tilesets.slice()
				// нормал-маппленные вперёд → попадут в tileset[0]
				return arr.sort(
					(a, b) => (hasNormal(b) ? 1 : 0) - (hasNormal(a) ? 1 : 0),
				)
			}
			for (const layerData of map.layers) {
				const name = layerData.name
				// Группа "doorstuff" во Phaser приходит как "doorstuff/back0" и т.д.
				// Всю дверь рисуют PNG-створки level1door* — тайлы группы НЕ рендерим
				// (это и была «всегда видимая закрытая дверь» на depth 4).
				// Группа "doorstuff" → имена "doorstuff/back0" и т.д. Дверь рисуют
				// PNG-створки level1door* — тайлы группы не рендерим.
				if (name.startsWith('doorstuff')) continue
				if (skipLayers.has(name)) continue // визуал заменён запечённым фоном
				const depth =
					name === 'back2'
						? 0
						: name === 'back'
							? 1
							: // back3 — самый дальний фон: ЗА back2 (depth 0), но перед параллаксом
								// (px-* идут от -11 и глубже).
								name === 'back3'
								? -0.5
								: // back0 — ближайший фон (меньше номер = ближе): перед back(1) и
									// запечённым фоном, но за облаками/шипами/платформами и игроком.
									name === 'back0'
									? 1.5
									: name === 'cloud'
										? 2
										: name === 'spike'
											? 3
											: 4
				try {
					const layerTs = tilesetsForLayer(layerData)
					// scrollFactor=1 (дефолт) — тайлы рендерятся на своих мировых позициях.
					// Параллакс для фонов делается через Oblako-объекты, не через tile-слои.
					const layer = map.createLayer(name, layerTs, 0, 0)
					layer?.setDepth(depth)
					// Light2D: тайлы из нормал-маппленного тайлсета ловят рельеф от источников.
					// Слой без нормалей (spikes) освещается плоско, но затемняется так же.
					if (layer && anyNormalMap) layer.setPipeline(this._lightPipelineKey)
					const lit = layer && hasNormal(layerTs[0]) ? ' +normal' : ''
					tlog(
						`[Level] ✓ layer "${name}" (depth ${depth})${anyNormalMap ? ' [Light2D]' : ''}${lit}`,
					)
				} catch (e) {
					tlog(`[Level] ⚠ layer "${name}" render error: ${e.message}`)
				}
			}
		} else {
			tlog('[Level] ⚠ No tilesets registered — tile layers invisible')
		}

		// ── Object layers — обрабатываем ВСЕ object-слои карты ──────────────────
		// Tiled позволяет создавать несколько слоёв объектов ('objects', 'BackPngs', etc.)
		// Каждый слой обрабатывается одинаково — switch по type определяет что делать.
		const allObjLayers = map.objects || []
		const hasCollisionLayer = allObjLayers.some(l => l.name === 'objects')

		if (!hasCollisionLayer) {
			tlog('[Level] ⚠ Нет слоя "objects" — fallback на stub-коллизию')
			this._buildStub()
			// Продолжаем — могут быть визуальные объекты в других слоях (BackPngs etc.)
		}

		if (allObjLayers.length === 0) return

		const allObjects = allObjLayers.flatMap(l => l.objects)
		tlog(
			`[Level] Objects: ${allObjects.length} total (слои: ${allObjLayers.map(l => l.name).join(', ')})`,
		)
		for (const obj of allObjects) {
			const { type, x, y, width = 0, height = 0, properties = [] } = obj
			if (!type) continue

			const prop = name =>
				Array.isArray(properties)
					? properties.find(p => p.name === name)?.value
					: properties?.[name]

			const cx = x + width / 2
			const cy = y + height / 2

			// ── Точки маршрута автобота: type="bot" (слой "bot") ─────────────────
			// Свойства объекта в Tiled (Custom Properties):
			//   id    (int)    — порядковый номер точки маршрута (1, 2, 3, …) — обязателен
			//   wait  (float)  — сколько секунд стоять на точке (по умолчанию ~3 c);
			//                    wait=0 → сквозная точка: пробегаем без остановки
			//   face  (string) — куда смотреть стоя: "left" | "right"
			//   jump  (bool)   — подпрыгнуть по прибытии на точку (тест)
			//   dash  (bool)   — сквозная точка: при касании сразу дэш по ходу движения
			//   click (bool)   — по прибытии «кликнуть ЛКМ» (активировать предмет рядом)
			if (type === 'bot') {
				const idProp = prop('id')
				if (idProp == null) {
					tlog(`[Bot] точка bot без свойства id (x=${x}, y=${y}) — пропущена`)
					continue
				}
				const waitProp = prop('wait')
				this._botPoints.push({
					n: Number(idProp),
					x,
					y,
					wait: waitProp != null ? Number(waitProp) : null, // секунды
					face: prop('face') || null, // 'left' | 'right'
					jump: prop('jump') === true, // подпрыгнуть на точке
					dash: prop('dash') === true, // дэш по ходу при касании (сквозная)
					click: prop('click') === true, // «клик ЛКМ» по прибытии
				})
				continue
			}

			// ── Универсальный обработчик px-* параллакс-слоёв ────────────────────
			// Тип объекта = ключ текстуры (px-sky, px-mtn, px-clouds-near, etc.)
			// Поведение определяется таблицей PX_CFG ниже.
			if (type.startsWith('px-')) {
				// Порядок слоёв (сзади → вперёд):
				//   px-sky(-5) → px-mtn(-4) → px-clouds-far(-3) → px-clouds-near(-2) → px-clouds-btm(-1)
				//   → тайлы Tiled: back(1), остальные(4) → игроки(10)
				// Порядок от дальнего к ближнему: sky(-5) → clouds-near(-4) → mtn(-3) → clouds-far(-2) → clouds-btm(-1)
				// sfX    = параллакс-доля камеры: чем ближе слой, тем больше (0=стоит, 1=вместе с миром)
				// driftX = авто-дрейф влево, canvas px/s: чем ближе слой, тем быстрее
				//          Celeste-стиль: 0–3 px/s, суб-пиксель на кадр → без видимых ступенек
				// ts     = масштаб тайла: 180/324 подгоняет PNG 576×324 под холст 320×180
				// level1 PNG все 576×324 (16:9) → ts=320/576=180/324 заполняет холст целиком без шва
				const TS1 = 320 / 576
				const PX_CFG = {
					// ── Level 10 (облака, кремовая палитра) ────────────────────────────
					'px-sky': {
						mode: 'tile',
						sfX: 0.04,
						sfY: 0.01,
						depth: -5,
						alpha: 1.0,
						driftX: 0,
						ts: 1,
					},
					'px-clouds-near': {
						mode: 'tile',
						sfX: 0.12,
						sfY: 0,
						depth: -4,
						alpha: 1.0,
						driftX: 24,
						ts: 180 / 324,
					},
					'px-mtn': {
						mode: 'tile',
						sfX: 0.2,
						sfY: 0,
						depth: -2,
						alpha: 1.0,
						driftX: 25,
						ts: 180 / 324,
					},
					'px-clouds-far': {
						mode: 'tile',
						sfX: 0.32,
						sfY: 0,
						depth: -3,
						alpha: 1.0,
						driftX: 22,
						ts: 180 / 324,
					},
					'px-clouds-btm': {
						mode: 'tile',
						sfX: 0.46,
						sfY: 0,
						depth: -1,
						alpha: 1.0,
						driftX: 30,
						ts: 180 / 324,
					},
					// ── Level 1 (город, все слои 576×324) ──────────────────────────────
					// Порядок (сзади→вперёд): 1 фон → 2 гора → 9/12 облака → 3-7 здания →
					//   11 облако (перед зданиями) → [тайлы карты @0..4] → [игроки @10] → ...
					//   Все облака ПОД тайлами карты (никаких положительных depth у облаков).
					// sfX=0 + driftX=0 → статичный | sfX>0 + driftX=0 → только параллакс (здания)
					// sfX>0 + driftX>0 → параллакс + авто-дрейф (фоновые облака за игроками)
					// sfX=0 + driftX>0 → НЕ зависит от камеры, просто плывёт влево (передние облака)
					'px-1': {
						mode: 'tile',
						sfX: 0,
						sfY: 0,
						depth: -20,
						alpha: 1.0,
						driftX: 6,
						ts: TS1,
					}, // фон — НЕ зависит от игрока, бесконечно плывёт влево
					'px-2': {
						mode: 'tile',
						sfX: 0,
						sfY: 0,
						depth: -19,
						alpha: 1.0,
						driftX: 0,
						ts: TS1,
					}, // гора — статик
					'px-3': {
						mode: 'tile',
						sfX: 0.07,
						sfY: 0,
						depth: -16,
						alpha: 1.0,
						driftX: 0,
						ts: TS1,
					}, // здание дальнее
					'px-4': {
						mode: 'tile',
						sfX: 0.12,
						sfY: 0,
						depth: -15,
						alpha: 1.0,
						driftX: 0,
						ts: TS1,
					}, // здание
					'px-5': {
						mode: 'tile',
						sfX: 0.18,
						sfY: 0,
						depth: -14,
						alpha: 1.0,
						driftX: 0,
						ts: TS1,
					}, // здание
					'px-6': {
						mode: 'tile',
						sfX: 0.26,
						sfY: 0,
						depth: -13,
						alpha: 1.0,
						driftX: 0,
						ts: TS1,
					}, // здание
					'px-7': {
						mode: 'tile',
						sfX: 0.36,
						sfY: 0,
						depth: -12,
						alpha: 1.0,
						driftX: 0,
						ts: TS1,
					}, // здание ближнее
					// ВСЕ облака ПОД тайлами карты (tiles @ 0..4). 9 и 12 — за горой;
					// 11 — перед зданиями (px-7 @ -12), но за картой (depth < 0).
					'px-9': {
						mode: 'tile',
						sfX: 0.28,
						sfY: 0,
						depth: -19.7,
						alpha: 1.0,
						driftX: 10,
						ts: TS1,
					}, // облако (за горой)
					'px-11': {
						mode: 'tile',
						sfX: 0.36,
						sfY: 0,
						depth: -11,
						alpha: 1.0,
						driftX: 13,
						ts: TS1,
					}, // облако ближнее (перед зданиями, ПОД картой)
					'px-12': {
						mode: 'tile',
						sfX: 0.44,
						sfY: 0,
						depth: -19.4,
						alpha: 1.0,
						driftX: 16,
						ts: TS1,
					}, // облако ближнее (за горой)
					// Передние облака px-8/10/13 убраны по просьбе (см. _orig_backup для PNG).
				}
				const cfg = PX_CFG[type]
				if (!cfg) {
					tlog(`[PxLayer] ⚠ "${type}" не в таблице PX_CFG — добавь запись`)
				} else if (!this.textures.exists(type)) {
					tlog(`[PxLayer] ✗ "${type}" не загружена — добавь в PreloadScene.js`)
				} else {
					const src = this.textures.get(type).source[0]
					const alpha = prop('alpha') ?? cfg.alpha
					const depth = prop('depth') ?? cfg.depth

					if (cfg.mode === 'tile') {
						const sfX = prop('sfX') ?? cfg.sfX
						const sfY = prop('sfY') ?? cfg.sfY
						const ts = cfg.ts ?? 1
						const spr = this.add
							.tileSprite(0, 0, 320, 180, type)
							.setOrigin(0, 0)
							.setScrollFactor(0)
							.setAlpha(alpha)
							.setDepth(depth)
							.setTileScale(ts, ts)
						// Параллакс-PNG БЕЗ освещения — нормали только на тайлсетах.
						this._parallaxLayers.push({
							sprite: spr,
							sfX,
							sfY,
							driftX: cfg.driftX ?? 0,
							driftY: 0,
							_driftAccX: 0,
							_driftAccY: 0,
						})
						tlog(
							`[PxLayer] ✓ TILE  "${type}"  PNG=${src.width}×${src.height}  sfX=${sfX} sfY=${sfY}  driftX=${cfg.driftX ?? 0}  ts=${ts.toFixed(3)}  depth=${depth}`,
						)
					} else {
						// Позиционированное изображение — центр в точке объекта Tiled.
						// Авто-scale: 1 PNG-пиксель → 1 экранный пиксель
						// displayScale = во сколько Phaser растягивает канвас до экрана (2К=8, 1080p=6, 720p=4)
						// game.scale.displayScale не готово в create() → берём из video-настроек
						// Переопредели через свойство Tiled 'scale' если нужен другой размер
						const _res =
							SaveSystem.getSettings().video?.resolution || '1920x1080'
						const displayScale = Math.max(
							1,
							Math.round((Number(_res.split('x')[0]) || 1920) / 320),
						)
						const scale = prop('scale') ?? 5 / displayScale
						const spr = this.add
							.image(x, y, type)
							.setOrigin(0.5, 0.5)
							.setScrollFactor(1, 1)
							.setAlpha(alpha)
							.setDepth(depth)
							.setScale(scale)
						const dispW = src.width * scale
						const dispH = src.height * scale
						const tilesW = (dispW / 16).toFixed(1)
						const tilesH = (dispH / 16).toFixed(1)
						tlog(
							`[PxLayer] ✓ IMAGE "${type}" @ world(${Math.round(x)},${Math.round(y)})  PNG=${src.width}×${src.height}  ÷${displayScale} → scale=${scale.toFixed(3)} → ${Math.round(dispW)}×${Math.round(dispH)} canvas px = ${tilesW}×${tilesH} тайлов  depth=${depth}`,
						)
					}
				}
				continue // не передавать px-* в switch ниже
			}

			// ── Передние декорации fore1/fore2 ──────────────────────────────────
			// Точка объекта Tiled = НИЖНИЙ ЛЕВЫЙ угол PNG (origin 0,1).
			// scrollFactor 1 (стоит в мире). depth 900 → выше игроков (10) и
			// тайлов, ниже дождя (1000).
			// PNG можно держать большими: добавь СВОЙСТВО "scale" (float) на объект
			// в Tiled — множитель уменьшения. Нет свойства → масштаб 1 (как есть).
			// Можно вместо этого задать "width" (float) — целевая ширина в canvas-px,
			// масштаб посчитается сам с сохранением пропорций.
			if (type.startsWith('fore')) {
				if (!this.textures.exists(type)) {
					tlog(
						`[Fore] ✗ "${type}" текстура не загружена — добавь в PreloadScene`,
					)
				} else {
					const fsrc = this.textures.get(type).source[0]
					const wantW = prop('width')
					const scale =
						wantW != null
							? Number(wantW) / fsrc.width
							: prop('scale') != null
								? Number(prop('scale'))
								: 1
					const foreImg = this.add
						.image(x, y, type)
						.setOrigin(0, 1)
						.setScrollFactor(1, 1)
						.setDepth(900)
						.setScale(scale)
					// Есть карта нормалей (загружена как [diffuse, normal]) и свет активен →
					// ставим на световой пайплайн: ближние лампы освещают декорацию своим
					// ЦВЕТОМ с рельефом по нормали (как тайлы/фон). Без нормали — обычный спрайт.
					const foreHasNormal = this.textures.get(type).dataSource?.length > 0
					if (foreHasNormal && this._lightingActive)
						foreImg.setPipeline(this._lightPipelineKey)
					tlog(
						`[Fore] ✓ "${type}" @world(${Math.round(x)},${Math.round(y)})  PNG=${fsrc.width}×${fsrc.height}  scale=${scale.toFixed(3)} → ${Math.round(fsrc.width * scale)}×${Math.round(fsrc.height * scale)} canvas px  depth=900`,
					)
				}
				continue
			}

			switch (type) {
				case 'ground':
					this._makePlatform(cx, cy, width, height, 'tile-ground')
					break
				case 'platform':
					this._makePlatform(cx, cy, width, height, 'tile-platform')
					break
				case 'spawn':
					this._spawnFromMap = { x, y }
					break
				case 'spawnhost':
					this._spawnHost = { x, y } // точка покоя хоста (куда выходит на входе)
					break
				case 'spawnguest':
					this._spawnGuest = { x, y } // точка покоя гостя
					break
				case 'spawn1':
					this._spawn1 = { x, y } // начальный спавн хоста за картой
					break
				case 'spawn2':
					this._spawn2 = { x, y } // начальный спавн гостя за картой
					break
				case 'lampsound':
					// Точка звука лампы (гул + щелчки). id — свой у каждой (свойство
					// Tiled), по умолчанию по координате. Гул создаётся в _initLampAudio.
					this._lampSounds.push({
						x,
						y,
						id: prop('id') != null ? Number(prop('id')) : Math.round(x * 7 + y),
						hum: null,
					})
					break
				case 'lamplever':
					this._lampLeverPos = { x, y }
					break
				case 'orbdestination':
					this._orbDestination = { x, y }
					break
				case 'exit':
					this._makeExitZone(x, y)
					break
				case 'orb': {
					// Invisible physics body для overlap-детекции
					this.orb = this.physics.add
						.staticImage(x, y, 'orb')
						.setVisible(false)
						.setDisplaySize(28, 28)
						.refreshBody()
					// Видимый спрайт: 13px оригинал → 12px canvas (75% от тайла 16px)
					this._orbSprite = this.add
						.image(x, y, 'stuff-orb')
						.setDisplaySize(12, 12)
						.setDepth(0) // позади level1.png (depth 1), выше параллакс-фонов (-20..-12)
					// Боббинг запускается НЕ сразу, а только после прилёта орба в orbdestination
					// (_activateLampLever вызывает _startOrbBob по завершении параболы).
					break
				}
				case 'light':
					tlog(
						`[Light] processing light @(${Math.round(cx)},${Math.round(cy)})`,
					)
					this._makeLight(cx, cy, prop)
					break
				case 'rain':
					// Линия пола, по которой дождь оставляет брызги. y = верх объекта
					// (поверхность пола), x..x+width — горизонтальный отрезок в мире.
					// Несколько объектов rain → несколько отрезков. Читается в RainEffect.
					// Первый объект rain также запускает фоновый шум дождя (rain-amb).
					this._hasRainAmb = true
					;(this._rainSplashZones ||= []).push({ x, y, w: width || 16 })
					break
				case 'rainslide':
					// Прямоугольник поверхности стены, по которой стекают капли.
					// x,y — верхний левый угол, width×height — площадь. depth (опц.) —
					// глубина отрисовки (по умолч. 5: перед тайлами, за игроком).
					this._rainSlideZones.push({
						x,
						y,
						w: width || 16,
						h: height || 16,
						depth: prop('depth') != null ? Number(prop('depth')) : undefined,
					})
					break
				case 'rightcorner':
					// Правый предел камеры: её правый край не уходит правее x этого
					// объекта (влево — свободно). Применяется в _buildLevel после bounds.
					this._camRightLimit = x
					break
				case 'camera':
					// Точка, к которой камера обоих игроков временно центрируется при
					// активации lamplever (слой cameramove). Срабатывает в _doActivateLampLever.
					this._camFocusPoint = { x, y }
					break
				case 'wiredest':
					// Точка, куда падает оторвавшийся конец провода (см. _dropLampWire).
					this._wireDest = { x, y }
					break
				case 'krug':
					// Центр круга-диафрагмы в финале уровня (см. _playLevelEndIris).
					this._krugPos = { x, y }
					break
				case 'wire':
					// Конец провода. Парами по свойству group (число). Свойства sag/amp/
					// speed — глубина провисания, амплитуда качания, скорость (на первой
					// точке группы). Собираем, пара строится в _buildWireDefs().
					this._wirePoints.push({
						x,
						y,
						group: Number(prop('group') ?? 0),
						sag: prop('sag') != null ? Number(prop('sag')) : 24,
						amp: prop('amp') != null ? Number(prop('amp')) : 12,
						speed: prop('speed') != null ? Number(prop('speed')) : 1.2,
						// depth (опц.) на любой точке группы → провод уходит на эту глубину.
						// Нет → WireEffect по умолчанию 900 (спереди).
						depth: prop('depth') != null ? Number(prop('depth')) : undefined,
						// phase (опц.) — фаза качания. Одинаковая у разных групп →
						// провода качаются СИНХРОННО. Нет → авто (group·0.7), вразнобой.
						phase: prop('phase') != null ? Number(prop('phase')) : undefined,
					})
					break
				case 'kust': {
					// Процедурный сухой куст. Точка = основание (низ ствола). Свойства
					// (все опциональны): seed (форма), height (высота ствола, px),
					// thickness (толщина ствола), sway (амплитуда качания, рад),
					// speed (скорость ветра), levels (глубина ветвления), color (#hex),
					// depth (порядок: <10 → за игроком, >10 → перед).
					const cstr = prop('color')
					this._bushPoints.push({
						x,
						y,
						seed: prop('seed') != null ? Number(prop('seed')) : 7,
						height: prop('height') != null ? Number(prop('height')) : 36,
						thickness:
							prop('thickness') != null ? Number(prop('thickness')) : 3,
						sway: prop('sway') != null ? Number(prop('sway')) : 0.08,
						speed: prop('speed') != null ? Number(prop('speed')) : 1.0,
						levels: prop('levels') != null ? Number(prop('levels')) : 5,
						color: cstr
							? parseInt(String(cstr).replace('#', ''), 16)
							: 0x0a0d18,
						// depth 950 → поверх всех фоновых и передних PNG (fore* @900),
						// ниже дождя (1000). Игрок (10) проходит за кустом.
						depth: prop('depth') != null ? Number(prop('depth')) : 950,
						phase: x * 0.013, // разные кусты качаются вразнобой
					})
					break
				}
				case 'door': {
					const dw = width || 16
					const dh = height || 80
					this.door = this.physics.add
						.staticImage(cx, cy, 'door')
						.setVisible(false)
						.setDisplaySize(dw, dh)
						.refreshBody()
					this.doorBody = this.door
					break
				}
				case 'lever': {
					// group решает поведение: 1 — дверь (оба игрока), 2 — кнопка хоста,
					// 3 — кнопка гостя. Текстуры отжата/нажата зависят от группы.
					const grp = Number(prop('group') ?? 1)
					const [texOff, texOn] =
						grp === 2
							? ['btnhost1', 'btnhost2']
							: grp === 3
								? ['btnplayer1', 'btnplayer2']
								: ['btn1', 'btn2']
					// Невидимое тело для overlap-детекции касания
					const body = this.physics.add
						.staticImage(x, y, 'lever')
						.setVisible(false)
						.setDisplaySize(32, 32)
						.refreshBody()
					// Видимая кнопка: «отжата» по умолчанию, низом на точке рычага.
					// depth -0.4 — ЧУТЬ выше слоя back3 (-0.5), иначе стена back3 на той же
					// глубине рисуется ПОВЕРХ кнопки (tie) и её не видно. Всё ещё под
					// back/back0/фоном. У группы 1 back3 за кнопкой пуст → ей и -0.5 ок.
					const btnDepth =
						prop('depth') != null
							? Number(prop('depth'))
							: grp === 1
								? -0.5
								: -0.4
					let btn = null
					if (this.textures.exists(texOff)) {
						btn = this.add
							.image(x, y, texOff)
							.setOrigin(0.5, 1)
							.setDepth(btnDepth)
						if (this._lightingActive) btn.setPipeline(this._lightPipelineKey)
					}
					// cx/cy — центр координат объекта lever (точка в Tiled). Нажатие
					// детектится по совпадению центра игрока с этой точкой (_onButton),
					// а не по overlap всего 32px-тела.
					this._levers.push({
						body,
						group: grp,
						btn,
						texOff,
						texOn,
						cx: x,
						cy: y,
					})
					break
				}
				case 'finaltext': {
					// Двухстрочный финальный текст. Две строки = отдельные div'ы → каждая
					// анимируется флипом независимо (см. _updateActionButtons).
					const el = document.createElement('div')
					el.className = 'hud-world-label hud-world-sign hud-world-final'
					el.style.textAlign = 'center'
					el.style.whiteSpace = 'nowrap'
					const l1 = document.createElement('div')
					const l2 = document.createElement('div')
					l1.innerHTML = i18n.t('final.host_wait_html')
					l2.innerHTML = i18n.t('final.guest_wait_html')
					el.append(l1, l2)
					document.getElementById('hud-prompts').appendChild(el)
					this._finalTextEl = el
					this._finalLine1 = l1 // строка хоста
					this._finalLine2 = l2 // строка гостя
					this._finalLine1Shown = i18n.t('final.host_wait_plain') // без флипа на старте
					this._finalLine2Shown = i18n.t('final.guest_wait_plain')
					this._finalTextPos = { x, y } // центр камеры в катсцене конца уровня
					this._worldLabels.push({ el, wx: x, wy: y }) // позиционирование + очистка
					break
				}
				case 'death': {
					const dz = this.add.zone(cx, cy, width || 16, height || 16)
					this.physics.world.enable(dz)
					dz.body.allowGravity = false
					this._deathZones.push(dz)
					break
				}
				case 'sign': {
					const text = prop('text') || ''
					this._makeSign(x, y, text)
					break
				}
				case 'orbtestattack':
				case 'orbtesthit':
				case 'orbtestdeath':
				case 'orbtestshield': {
					const testBody = this.physics.add
						.staticImage(x, y, 'orb')
						.setVisible(false)
						.setDisplaySize(28, 28)
						.refreshBody()
					const testLabels = {
						orbtestattack: i18n.t('game.test_attack'),
						orbtesthit: i18n.t('game.test_hit'),
						orbtestdeath: i18n.t('game.test_death'),
						orbtestshield: i18n.t('game.test_shield'),
					}
					const testPromptEl = document.createElement('div')
					testPromptEl.className = 'hud-world-label hud-world-prompt-test'
					testPromptEl.innerHTML = `
						<img class="hk-orn hk-orn-top" src="/assets/pngfortext/top.png" onerror="this.style.display='none'" />
						<span class="hk-text">${testLabels[type]}</span>
						<img class="hk-orn hk-orn-bot" src="/assets/pngfortext/bottom.png" onerror="this.style.display='none'" />
					`
					testPromptEl.style.display = 'none'
					document.getElementById('hud-prompts').appendChild(testPromptEl)
					this._testOrbs.push({
						body: testBody,
						type,
						promptEl: testPromptEl,
						wx: x,
						wy: y - 22,
						nearby: false,
					})
					break
				}
			}
		}
	}

	_buildLevel10() {
		const H = WORLD_H,
			W = WORLD_W

		this._makePlatform(W / 2, H - 32, W, 64, 'tile-ground')

		let y = H - 150
		for (let i = 0; i < 30; i++) {
			const x = 150 + Math.sin(i * 0.8) * 400 + 440
			y -= 80 + Math.random() * 60
			this._makePlatform(x, y, 100 + Math.random() * 80, 20, 'tile-platform')
		}

		this._makePlatform(W / 2, 200, 300, 20, 'tile-ground')
		this._makeExitZone(W / 2, 170)

		const peakEl = document.createElement('div')
		peakEl.className = 'hud-world-label hud-world-sign'
		peakEl.textContent = i18n.t('game.peak')
		peakEl.style.fontSize = '1.2rem'
		peakEl.style.color = '#ffd700'
		peakEl.style.textShadow = '0 0 16px #ffd700'
		document.getElementById('hud-prompts').appendChild(peakEl)
		this._worldLabels.push({ el: peakEl, wx: W / 2, wy: 120 })
	}

	_buildStub() {
		const H = WORLD_H,
			W = WORLD_W
		this._makePlatform(W / 2, H - 32, W, 64, 'tile-ground')
		this._makePlatform(W / 2, H - 200, 300, 20, 'tile-platform')
		this._makeExitZone(W / 2, H - 230)
		const stubEl = document.createElement('div')
		stubEl.className = 'hud-world-label hud-world-sign'
		stubEl.innerHTML = i18n.t('game.stub', { n: this.levelId })
		stubEl.style.color = 'rgba(255,255,255,0.4)'
		stubEl.style.textAlign = 'center'
		document.getElementById('hud-prompts').appendChild(stubEl)
		this._worldLabels.push({ el: stubEl, wx: W / 2, wy: H - 320 })
	}

	_makePlatform(x, y, w, h, tex) {
		// When Tiled tile layers are rendered, visuals come from the map — skip tileSprite
		// to avoid drawing duplicate graphics on top of each other.
		// When no tile layers (fallback / stub levels), draw a tileSprite for visuals.
		if (!this._useTiledVisuals) {
			this.add.tileSprite(x, y, w, h, tex).setDepth(5)
		}
		// Physics body is always invisible; its hitbox matches the object rectangle
		const body = this.physics.add.staticImage(x, y, tex).setVisible(false)
		body.setDisplaySize(w, h).refreshBody()
		this.platforms.add(body)
		return body
	}

	_makeSign(x, y, text) {
		const el = document.createElement('div')
		el.className = 'hud-world-label hud-world-sign'
		el.textContent = text
		document.getElementById('hud-prompts').appendChild(el)
		this._worldLabels.push({ el, wx: x, wy: y - 12 })
	}

	_addOrbGlow(x, y) {
		const glow = this.add.circle(x, y, 22, 0xffd700, 0.15).setDepth(7)
		this.tweens.add({
			targets: glow,
			alpha: 0.4,
			duration: 900,
			yoyo: true,
			repeat: -1,
		})
		this.tweens.add({
			targets: this.orb,
			y: y - 6,
			duration: 1200,
			yoyo: true,
			repeat: -1,
		})
	}

	_makeExitZone(x, y) {
		const zone = this.add.zone(x, y, 80, 40).setDepth(9)
		this.physics.world.enable(zone)
		zone.body.allowGravity = false
		const el = document.createElement('div')
		el.className = 'hud-world-label hud-world-exit'
		el.textContent = i18n.t('game.exit_sign')
		el.dataset.i18n = 'game.exit_sign' // обновится при смене языка из паузы
		document.getElementById('hud-prompts').appendChild(el)
		this._worldLabels.push({ el, wx: x, wy: y })
		this._exitZone = zone
	}

	_triggerDeath() {
		if (this._dying || this._exiting || this._inputLocked) return
		this._dying = true
		this._inputLocked = true

		this.localPlayer.body.setVelocity(0, 0)
		this.localPlayer.body.setAllowGravity(false)
		// Звук падения на шипы / гибели — ещё ×1.5 (база 3.83): критичный фидбэк
		// на максимум. Cap 1.0 против клиппинга на громких настройках.
		if (this.cache.audio.exists('hit')) {
			this.sound.play('hit', {
				volume: Math.min(1, 3.83 * AudioManager.getMultiplier('sfx')),
			})
		}
		this.localPlayer.playDead()

		// После анимации: подождать 400ms, показать экран И уведомить партнёра одновременно
		const deadKey = this.localPlayer._charPrefix + '-dead'
		this.localPlayer.once('animationcomplete-' + deadKey, () => {
			this.time.delayedCall(400, () => {
				networkClient.playerDied() // партнёр замирает и ждёт (как и раньше)
				this._showReviveOffer() // «Второй шанс»: 5с-полоска + кнопка рекламы
			})
		})
	}

	// «Второй шанс»: после смерти 5с тикает полоска (без цифр) с предложением
	// посмотреть рекламу и воскреснуть. Нажал рекламу → _showAdOverlay. Полоска
	// истекла (не нажал) → откат на обычный экран смерти (Заново/Выйти).
	_showReviveOffer() {
		setCursorHidden(false)
		this._closeAbilityOverlay()
		const el = document.createElement('div')
		el.className = 'game-fullscreen-overlay'
		el.innerHTML = `
			<div class="revive-title">${i18n.t('game.revive_title')}</div>
			<div class="revive-sub">${i18n.t('game.revive_sub')}</div>
			<div class="revive-bar-track"><div class="revive-bar-fill"></div></div>
			<button class="revive-ad-btn">
				<svg class="revive-ad-icon" viewBox="0 0 24 24" aria-hidden="true">
					<rect x="2" y="4" width="20" height="16" rx="3" fill="none" stroke="currentColor" stroke-width="2"/>
					<path d="M10 9l5 3-5 3z" fill="currentColor"/>
				</svg>
				<span>${i18n.t('game.revive_watch')}</span>
			</button>`
		document.getElementById('hud-overlay').appendChild(el)
		this._reviveOverlayEl = el

		el.querySelector('.revive-ad-btn').addEventListener('click', () => {
			if (this._reviveTimer) { clearTimeout(this._reviveTimer); this._reviveTimer = null }
			el.remove()
			this._reviveOverlayEl = null
			this._showAdOverlay()
		})

		// Полоска истекла за 5с → обычный экран смерти.
		this._reviveTimer = setTimeout(() => {
			this._reviveTimer = null
			el.remove()
			this._reviveOverlayEl = null
			this._showDeathScreen()
		}, 5000)
	}

	// Заглушка рекламы: окно поверх с текстом и крестиком (закрыть). Закрыл →
	// воскрешение (смерть сбрасывается, уровень продолжается).
	_showAdOverlay() {
		const el = document.createElement('div')
		el.className = 'ad-overlay'
		el.innerHTML = `
			<div class="ad-box">
				<button class="ad-close" aria-label="Close">
					<svg viewBox="0 0 24 24" aria-hidden="true">
						<path d="M5 5l14 14M19 5L5 19" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>
					</svg>
				</button>
				<div class="ad-placeholder">${i18n.t('game.ad_placeholder')}</div>
			</div>`
		document.getElementById('hud-overlay').appendChild(el)
		this._reviveOverlayEl = el // единое поле трекинга revive-оверлеев
		el.querySelector('.ad-close').addEventListener('click', () => this._doRevive())
	}

	// Воскрешение умершего: смерть сбрасывается, игрок возвращается на последнюю
	// безопасную землю (без deathlayer), партнёр продолжает с места.
	_doRevive() {
		if (!this._dying) return
		this._reviveOverlayEl?.remove()
		this._reviveOverlayEl = null
		if (this._reviveTimer) { clearTimeout(this._reviveTimer); this._reviveTimer = null }

		const pos = this._lastSafePos || { x: this.localPlayer.x, y: this.localPlayer.y }
		this.localPlayer.body.reset(pos.x, pos.y)
		this.localPlayer.body.setAllowGravity(true)
		this.localPlayer.body.setVelocity(0, 0)
		this.localPlayer._animState = ''
		this.localPlayer.play(this.localPlayer._charPrefix + '-idle')
		this.localPlayer._animState = 'idle'

		this._dying = false
		this._inputLocked = false
		setCursorHidden(true)
		networkClient.revive() // партнёр снимает «погиб» и продолжает
	}

	// Каждый кадр: запоминаем «хорошую» позицию для воскрешения. Не просто любую
	// землю, а ту, что:
	//   • с запасом по горизонтали от шипов (DEATH_MARGIN) — не «прямо перед шипом»;
	//   • с опорой и слева, и справа (FOOT_REACH) — не на самом краю уступа.
	// Если текущее место «плохое» — не перезаписываем, держим прошлое хорошее.
	_recordSafeGround() {
		const lp = this.localPlayer
		if (!lp?.body || this._dying || this._inputLocked) return
		if (!lp.body.blocked.down) return

		const DEATH_MARGIN = 32 // px горизонтального зазора от зоны смерти (≈2 тайла)
		const FOOT_REACH = 16 // на сколько слева/справа должна быть твёрдая опора (≈1 тайл)

		// 1) Достаточно далеко от любой зоны смерти (с запасом).
		for (const dz of this._deathZones) {
			const hw = dz.width / 2 + lp.body.halfWidth + DEATH_MARGIN
			const hh = dz.height / 2 + lp.body.halfHeight + 24
			if (Math.abs(lp.x - dz.x) < hw && Math.abs(lp.y - dz.y) < hh) return
		}

		// 2) Есть опора слева и справа (не край уступа).
		const feetY = lp.body.bottom
		if (
			!this._hasGroundBelow(lp.x - FOOT_REACH, feetY) ||
			!this._hasGroundBelow(lp.x + FOOT_REACH, feetY)
		)
			return

		this._lastSafePos = { x: lp.x, y: lp.y }
	}

	// Есть ли статичная платформа, чья верхняя кромка совпадает с ногами (feetY),
	// под точкой x. Тайлы пола — отдельные тела, поэтому проверяем ВСЕ и любую.
	_hasGroundBelow(x, feetY) {
		const TOL = 10 // допуск по высоте (кромка платформы ≈ уровень ног)
		for (const body of this.platforms.getChildren()) {
			const b = body.body
			if (!b) continue
			// StaticBody: x,y — верхний левый угол; считаем грани от него (надёжнее getter'ов)
			const left = b.x
			const right = b.x + b.width
			const top = b.y
			if (x >= left && x <= right && Math.abs(top - feetY) <= TOL) return true
		}
		return false
	}

	_showDeathScreen() {
		setCursorHidden(false)
		this._closeAbilityOverlay() // убрать «Открыто:» если игрок не закрыл его до смерти
		const el = document.createElement('div')
		el.className = 'game-fullscreen-overlay'

		const title = document.createElement('div')
		title.className = 'game-overlay-title'
		title.textContent = i18n.t('game.you_died')
		title.style.color = '#cc3333'
		title.style.textShadow = '0 0 24px #cc3333'
		el.appendChild(title)

		if (this.role === 'host') {
			const restartBtn = document.createElement('button')
			restartBtn.className = 'game-btn game-btn-primary'
			restartBtn.style.color = '#ff6666'
			restartBtn.style.borderColor = 'rgba(255,80,80,0.45)'
			restartBtn.textContent = i18n.t('game.restart')
			restartBtn.addEventListener('click', () => {
				el.remove()
				this._deathOverlayEl = null
				networkClient.deathRestart()
				this._netUnsub.forEach(u => u())
				this._netUnsub = []
				window.__l2sFromDeath = true // респаун → туториал-подсказки не повторять
				this.scene.restart({ levelId: this.levelId, role: 'host' })
			})

			const menuBtn = document.createElement('button')
			menuBtn.className = 'game-btn'
			menuBtn.textContent = i18n.t('game.exit_menu')
			menuBtn.addEventListener('click', () => {
				el.remove()
				this._deathOverlayEl = null
				networkClient.exitGame()
				this._netUnsub.forEach(u => u())
				this._netUnsub = []
				this.scene.stop()
				exitToLevelSelect()
			})

			el.appendChild(restartBtn)
			el.appendChild(menuBtn)
		} else {
			const waiting = document.createElement('div')
			waiting.className = 'game-overlay-subtitle'
			waiting.style.color = 'rgba(255,255,255,0.45)'
			waiting.textContent = i18n.t('game.waiting_host')
			el.appendChild(waiting)
		}

		document.getElementById('hud-overlay').appendChild(el)
		this._deathOverlayEl = el
	}

	_showPartnerDeathScreen() {
		setCursorHidden(false)
		this._closeAbilityOverlay() // партнёр умер → закрыть «Открыто:» и у выжившего
		const el = document.createElement('div')
		el.className = 'game-fullscreen-overlay'

		const title = document.createElement('div')
		title.className = 'game-overlay-title'
		title.textContent = i18n.t('game.partner_died')
		title.style.color = '#cc3333'
		title.style.textShadow = '0 0 24px #cc3333'
		el.appendChild(title)

		if (this.role === 'host') {
			const restartBtn = document.createElement('button')
			restartBtn.className = 'game-btn game-btn-primary'
			restartBtn.style.color = '#ff6666'
			restartBtn.style.borderColor = 'rgba(255,80,80,0.45)'
			restartBtn.textContent = i18n.t('game.restart')
			restartBtn.addEventListener('click', () => {
				el.remove()
				this._deathOverlayEl = null
				networkClient.deathRestart()
				this._netUnsub.forEach(u => u())
				this._netUnsub = []
				window.__l2sFromDeath = true // респаун → туториал-подсказки не повторять
				this.scene.restart({ levelId: this.levelId, role: 'host' })
			})
			const menuBtn = document.createElement('button')
			menuBtn.className = 'game-btn'
			menuBtn.textContent = i18n.t('game.exit_menu')
			menuBtn.addEventListener('click', () => {
				el.remove()
				this._deathOverlayEl = null
				networkClient.exitGame()
				this._netUnsub.forEach(u => u())
				this._netUnsub = []
				this.scene.stop()
				exitToLevelSelect()
			})
			el.appendChild(restartBtn)
			el.appendChild(menuBtn)
		} else {
			const waiting = document.createElement('div')
			waiting.className = 'game-overlay-subtitle'
			waiting.style.color = 'rgba(255,255,255,0.45)'
			waiting.textContent = i18n.t('game.waiting_host')
			el.appendChild(waiting)
		}

		document.getElementById('hud-overlay').appendChild(el)
		this._deathOverlayEl = el
	}

	_requestExit() {
		if (this._exiting) return
		this._gamePaused = false
		this._closeAbilityOverlay() // выход в меню → не оставлять «Открыто:» висеть
		console.log('[GameScene] ESC → exit')
		networkClient.exitGame()
		this._exitGame(false, false)
	}

	_exitLevel() {
		if (this._exiting) return
		this._exiting = true
		console.log('[GameScene] Exit! Level', this.levelId, 'complete')

		// Убрать все world-space метки немедленно — они не нужны после выхода с уровня
		for (const lbl of this._worldLabels) lbl.el?.remove()
		this._worldLabels = []
		this._orbPromptEl?.remove()
		this._orbPromptEl = null

		// Update per-slot level progress (for host AND guest)
		const newLevel = Math.min(this.levelId + 1, 10)
		window.__currentSlotMaxLevel = newLevel // always update (both roles)
		const slot = window.__currentSlot
		if (slot !== undefined) {
			SaveSystem.setSave(slot, { level: newLevel })
		}
		SaveSystem.setMaxLevel(newLevel)

		networkClient.levelComplete()
		this._showLevelComplete()
	}

	_showLevelComplete() {
		const nextLevel = Math.min(this.levelId + 1, 10)
		const isLast = this.levelId >= 10
		const titleText = isLast
			? i18n.t('game.game_complete')
			: i18n.t('game.level_complete', { n: this.levelId })

		this._closeAbilityOverlay() // уровень пройден → закрыть «Открыто:» у обоих
		const el = document.createElement('div')
		el.className = 'game-fullscreen-overlay'
		el.innerHTML = `<div class="game-overlay-title">${titleText}</div>`

		if (this.role === 'host') {
			if (!isLast) {
				const nextBtn = document.createElement('button')
				nextBtn.className = 'game-btn game-btn-primary'
				nextBtn.textContent = i18n.t('game.next_level', { n: nextLevel })
				nextBtn.addEventListener('click', () => {
					el.remove() // убрать оверлей немедленно — не ждать shutdown()
					this._levelCompleteEl = null
					console.log('[GameScene] Host → next level', nextLevel)
					saveSessionPlaytime()
					window.__l2s = { ...window.__l2s, levelId: nextLevel }
					networkClient.startGame(nextLevel)
					this.time.delayedCall(80, () => {
						this._netUnsub.forEach(u => u())
						this._netUnsub = []
						this.scene.restart({ levelId: nextLevel, role: 'host' })
					})
				})
				el.appendChild(nextBtn)
			}
			const menuBtn = document.createElement('button')
			menuBtn.className = 'game-btn'
			menuBtn.textContent = i18n.t('game.level_select')
			menuBtn.addEventListener('click', () => {
				networkClient.exitGame()
				this._netUnsub.forEach(u => u())
				this._netUnsub = []
				this.scene.stop()
				exitToLevelSelect()
			})
			el.appendChild(menuBtn)
		} else {
			const waiting = document.createElement('div')
			waiting.className = 'game-overlay-subtitle'
			waiting.style.color = 'rgba(255,255,255,0.45)'
			waiting.textContent = i18n.t('game.waiting_host')
			el.appendChild(waiting)
		}

		document.getElementById('hud-overlay').appendChild(el)
		this._levelCompleteEl = el
	}

	// ── Точечный свет (Tiled object type="light") ───────────────────────────────
	// Непиксельный плавный radial-glow поверх тайлов. Рендерится отдельным DOM-слоем
	// НАД холстом, поэтому свет в полном разрешении экрана, а не в холсте 320×180
	// (там nearest-neighbour апскейл сделал бы градиент ступенчатым).
	// Свет добавляется в #game-container (сосед canvas) — общий stacking-context,
	// иначе mix-blend-mode:screen не смешается с пикселями игры.
	// Позиция/размер пересчитываются каждый кадр в _updateDomPositions через _worldToScreen.
	// Свойства Tiled: color(#rrggbb) | radius(world px) | intensity(0..1) | pulse(bool).
	// Строит описания проводов из собранных точек (type:"wire"). Группирует по
	// свойству group, в каждой группе первые 2 точки = концы провода (слева→справа).
	_buildWireDefs(points) {
		const groups = {}
		for (const p of points) (groups[p.group] ||= []).push(p)
		const defs = []
		for (const key of Object.keys(groups)) {
			const grp = groups[key].slice().sort((a, b) => a.x - b.x)
			if (grp.length < 2) {
				tlog(`[Wire] ⚠ группа ${key}: нужно 2 точки, найдено ${grp.length}`)
				continue
			}
			const a = grp[0]
			const b = grp[1]
			defs.push({
				ax: a.x,
				ay: a.y,
				bx: b.x,
				by: b.y,
				sag: a.sag,
				amp: a.amp,
				speed: a.speed,
				depth: a.depth ?? b.depth, // глубина с любой точки группы (опц.)
				// phase задан в Tiled → синхрон с другими (та же фаза); иначе авто
				// вразнобой по номеру группы
				phase: a.phase ?? b.phase ?? Number(key) * 0.7,
			})
			tlog(
				`[Wire] ✓ группа ${key}: (${Math.round(a.x)},${Math.round(a.y)})→(${Math.round(b.x)},${Math.round(b.y)})  sag=${a.sag} amp=${a.amp} speed=${a.speed}`,
			)
		}
		return defs
	}

	// Обрывает провод, чей конец сейчас в точке (655,1856): этот конец плавно
	// «падает» в (400,2000), второй остаётся на месте. WireEffect перерисовывает
	// провод от ax/ay/bx/by каждый кадр, поэтому достаточно анимировать координаты
	// конца. На рестарте сцена пересобирает провода из Tiled → провод на месте.
	_dropLampWire() {
		if (!this._wire) return
		const TOL = 4
		const near = (x, y, tx, ty) =>
			Math.abs(x - tx) <= TOL && Math.abs(y - ty) <= TOL
		const FROM = { x: 655, y: 1856 }
		const TO = this._wireDest ?? { x: 400, y: 2000 } // координаты объекта wiredest (фолбэк)
		for (const w of this._wire.wires) {
			let end = null
			if (near(w.ax, w.ay, FROM.x, FROM.y)) end = 'a'
			else if (near(w.bx, w.by, FROM.x, FROM.y)) end = 'b'
			if (!end) continue
			tlog(
				`[Wire] обрыв: конец ${end} провода (${Math.round(w.ax)},${Math.round(w.ay)})→(${Math.round(w.bx)},${Math.round(w.by)}) падает в (${TO.x},${TO.y})`,
			)
			// Звук обрыва провода — в момент начала движения (после удара), у точки обрыва.
			this._posSfx('rope', FROM.x, FROM.y, 0.6)
			const xk = end + 'x'
			const yk = end + 'y'
			const proxy = { x: w[xk], y: w[yk] }
			this.tweens.add({
				targets: proxy,
				x: TO.x,
				y: TO.y,
				duration: 1100,
				ease: 'Quad.easeIn', // ускорение как при падении
				onUpdate: () => {
					w[xk] = proxy.x
					w[yk] = proxy.y
				},
				onComplete: () => {
					// Упавший конец хаотично болтается по горизонтали ±0.5 тайла (±8px),
					// высота фиксирована. Тикается в _tickFallenWire каждый кадр.
					this._fallenWire = {
						w,
						xk,
						yk,
						baseX: TO.x,
						baseY: TO.y,
						t: 0,
					}
				},
			})
			return
		}
		tlog(
			`[Wire] ⚠ обрыв: провод с концом ~(655,1856) не найден среди ${this._wire.wires.length} проводов`,
		)
	}

	// Очень медленное плавное покачивание упавшего конца провода из стороны в сторону:
	// X = baseX + 8px·sin (амплитуда 0.5 тайла), Y неизменна. Период ~13с (speed 0.48
	// рад/с) → еле заметное, убаюкивающее качание, без рывков.
	_tickFallenWire(delta) {
		const fw = this._fallenWire
		if (!fw) return
		fw.t += delta / 1000
		fw.w[fw.xk] = fw.baseX + 8 * Math.sin(fw.t * 0.48)
		fw.w[fw.yk] = fw.baseY // высота фиксирована
	}

	// Шаги local-игрока: footstep00..09 по кругу при ходьбе по земле. Цикл доходит
	// до последнего и начинается заново. Если игрок стоял дольше 1с — следующая
	// ходьба снова с footstep00. Первый шаг после старта движения играет сразу.
	_updateFootsteps(delta) {
		const FOOT_INTERVAL = 270 // мс между шагами (темп ходьбы)
		const p = this.localPlayer
		if (!p?.body) return
		const onGround = p.body.blocked.down
		const moving = !p._dashActive && Math.abs(p.body.velocity.x) > 5
		const walking = onGround && moving && !this._inputLocked

		if (!walking) {
			this._footStillMs += delta
			if (this._footStillMs >= 1000) this._footIdx = 0 // долго стоял → сброс на первый
			this._footWasWalking = false
			return
		}

		if (!this._footWasWalking) this._footTimer = FOOT_INTERVAL // первый шаг — сразу
		this._footWasWalking = true
		this._footStillMs = 0
		this._footTimer += delta
		if (this._footTimer >= FOOT_INTERVAL) {
			this._footTimer = 0
			this._playFootstep(this._footIdx)
			this._footIdx = (this._footIdx + 1) % 10
		}
	}

	// Позиционный звук: громкость и пан зависят от дистанции мирового источника
	// (wx,wy) до local-игрока (он же «уши»). Дальше источник — тише, до нуля на MAX.
	_posSfx(key, wx, wy, baseVol = 0.5) {
		if (!this.cache.audio.exists(key)) return
		const p = this.localPlayer
		if (!p) return
		const d = Phaser.Math.Distance.Between(p.x, p.y, wx, wy)
		const MAX = 700 // дальше источника не слышно
		let f = Math.max(0, 1 - d / MAX)
		f *= f // квадратичное затухание — естественнее
		const v = baseVol * f * AudioManager.getMultiplier('sfx')
		if (v <= 0.001) return
		const pan = Math.max(-1, Math.min(1, (wx - p.x) / 450))
		this.sound.play(key, { volume: v, pan })
	}

	_playFootstep(i) {
		const key = 'footstep' + String(i).padStart(2, '0')
		if (!this.cache.audio.exists(key)) return
		// local-игрок = слушатель → полная громкость; партнёру шлём для позиционного воспроизведения.
		this.sound.play(key, { volume: 0.3 * AudioManager.getMultiplier('sfx') })
		networkClient.playerSfx(key, 0.3)
	}

	// Звук кнопки-рычага у точки (wx,wy): on=true — наступили, on=false — сошли.
	_playSwitch(on, wx, wy) {
		this._posSfx(on ? 'switch-on' : 'switch-off', wx, wy, 0.6)
	}

	_makeLight(wx, wy, prop) {
		const { r, g, b } = this._parseColor(prop('color') || '#9933ff')
		const radius = Number(prop('radius')) || 90
		const intRaw = prop('intensity')
		const I = Math.max(0, Math.min(1, intRaw != null ? Number(intRaw) : 1.0))
		const pulse = prop('pulse') !== false
		// id — уникальный для каждой лампы (свойство Tiled). Сид для НЕсинхронного
		// мигания: лампы с разным id мерцают вразнобой. Нет → берём по координате.
		const lampId =
			prop('id') != null ? Number(prop('id')) : Math.round(wx * 7 + wy)
		const rgba = a => `rgba(${r},${g},${b},${a})`

		const el = document.createElement('div')
		el.className = 'game-light' + (pulse ? ' pulse' : '')
		// CSS-ореол — лишь МЯГКИЙ АКЦЕНТ (плоский, нормали игнорирует). Держим его
		// слабым (×HALO), иначе он перекрывает нормаль-свет Phaser, и подсветка по
		// рельефу (стена/пол) становится не видна. Основной свет даёт Phaser ниже.
		const HALO = 0.55
		const ha = I * HALO
		// closest-side → радиус градиента = половина ширины элемента (= radius на экране)
		el.style.background =
			`radial-gradient(circle closest-side,` +
			` ${rgba(ha)} 0%,` +
			` ${rgba(ha * 0.6)} 28%,` +
			` ${rgba(ha * 0.25)} 55%,` +
			` ${rgba(0)} 100%)`
		document.getElementById('game-container').appendChild(el)
		const entry = { el, wx, wy, radius, ha, lampId } // ha → debug-цикл цвета перекрашивает ореол
		// Состояние НЕзависимого мигания этой лампы (своё расписание → вразнобой).
		// Сид от lampId сдвигает первый «всплеск», чтобы лампы не стартовали вместе.
		entry.flk = {
			phase: 'idle',
			factor: 1,
			next: null, // ленивая инициализация от абсолютного time (см. _updateLightFlicker)
			stepEnd: 0,
			blinks: 0,
			on: true,
		}
		this._lights.push(entry)

		// Phaser Light2D-источник в той же точке мира → тайлы с normal map ловят рельеф.
		// CSS-div даёт мягкий непиксельный ореол, а этот свет — направленную подсветку граней.
		// Радиус Phaser-света шире ореола, чтобы достать до земли под орбом; интенсивность
		// разводим в шкалу Phaser (~1–3). lights включён в create() до _buildLevel().
		const phColor = (r << 16) | (g << 8) | b
		entry.baseIntensity = I * 3.8 // база для мерцания (flicker множит на factor)
		entry.phLight = this.lights.addLight(
			wx,
			wy,
			radius * 2,
			phColor,
			entry.baseIntensity,
		)
		// Источник подсветки дождя/капель для ЭТОЙ лампы (своя точка/цвет/радиус).
		// Дождь/капли берут ближайшую лампу из массива. intensity мигает вместе с
		// phLight через её flk.factor (см. _updateLightFlicker). Ref храним на entry.
		entry.rainLight = { wx, wy, r: radius * 1.15, color: phColor, intensity: 1 }
		this._rainLights.push(entry.rainLight)
		tlog(
			`[Light] ✓ id=${lampId} @world(${Math.round(wx)},${Math.round(wy)}) rgb(${r},${g},${b}) r=${radius} I=${I} pulse=${pulse} +Light2D`,
		)
	}

	// Локальный триггер «Осмотреть» — отправляет событие партнёру и запускает анимацию.
	_activateLampLever() {
		this._completeTutInteract() // первое взаимодействие выполнено
		this._lampActivatedByMe = true // это Я нажал → проиграю анимацию удара (синк по сети)
		networkClient.lampLever()
		this._doActivateLampLever()
	}

	// Вызывается у обоих игроков (локально и по сети). Запускает камеру; стекло/орб
	// откладываются до приезда камеры (см. _breakLampAndOrb / _updateCamera).
	_doActivateLampLever() {
		if (this._lampLeverActivated) return
		this._lampLeverActivated = true
		this._lampBroken = false
		if (this._lampLeverPromptEl) _showHkPrompt(this._lampLeverPromptEl, false)

		// Блокируем управление и замораживаем игроков на всё время катсцены.
		this._inputLocked = true
		this.localPlayer.body?.setVelocity(0, 0)

		// Анимация удара играет ПЕРВОЙ, пока камера ещё на игроке. Раньше playAttack
		// вызывался в _breakLampAndOrb (конец наезда) — камера к тому моменту уже у
		// лампы, игрока не видно, и анимация казалась «не проигрывается».
		// Активировавший проигрывает локально; партнёр видит её по сетевому синку анимаций.
		if (this._lampActivatedByMe) this.localPlayer.playAttack()

		// Камера трогается ПОСЛЕ взмаха (~500мс = длительность анимации атаки).
		// Одинаковая задержка на обоих клиентах → камера синхронна.
		this.time.delayedCall(500, () => {
			// Провод обрывается сразу после удара и ДО движения камеры.
			this._dropLampWire() // конец у 655,1856 падает на 400,2000
			this._focusCameraOnLamp() // камера обоих игроков временно едет к лампе
			// Лампа разбивается и орб вылетает ТОЛЬКО когда камера доедет (конец наезда),
			// перед возвратом. Запускает _updateCamera в переходе 'in'→'hold'.
			// Нет точки камеры (катсцены) → ломаем сразу.
			if (!this._camFocus) this._breakLampAndOrb()
		})
	}

	// Разбитие лампы (свет гаснет + звук) и вылет орба. Срабатывает один раз.
	_breakLampAndOrb() {
		if (this._lampBroken) return
		this._lampBroken = true
		// Анимация удара уже проиграна в _doActivateLampLever (до движения камеры).
		this._extinguishLight() // свет гаснет — лампа разбита
		this._playLampBoom() // звук взрыва/хлопка лампы
		if (!this._orbSprite || !this.orb) return

		const sx = this._orbSprite.x
		const sy = this._orbSprite.y
		const dest = this._orbDestination ?? { x: sx + 48, y: sy }
		const tx = dest.x
		const ty = dest.y
		// Вершина параболы — середина пути + дуга вверх (на 30% высоты отрезка, мин. 20px)
		const arcH = Math.max(20, Math.abs(ty - sy) * 0.4)
		const DURATION = 900

		// Анимируем безымянную переменную t ∈ [0,1] через onUpdate вручную.
		// Параболическая кривая: x линейно, y = mix(sy→ty) - sin(t·π)·arcH (дуга вверх).
		const proxy = { t: 0 }
		this.tweens.add({
			targets: proxy,
			t: 1,
			duration: DURATION,
			ease: 'Sine.easeInOut',
			onUpdate: () => {
				const t = proxy.t
				this._orbSprite.x = sx + (tx - sx) * t
				this._orbSprite.y = sy + (ty - sy) * t - Math.sin(t * Math.PI) * arcH
			},
			onComplete: () => {
				this._orbArrived = true
				if (this.orb?.active) {
					this.orb.x = tx
					this.orb.y = ty
					this.orb.refreshBody()
				}
				this._orbBobTween = this.tweens.add({
					targets: this._orbSprite,
					y: ty - 4,
					duration: 800,
					yoyo: true,
					repeat: -1,
					ease: 'Sine.easeInOut',
				})
			},
		})
	}

	// Мерцание ламп «как фонарь с перебоями электричества»: раз в ~5-6с короткий
	// стробящий спад яркости (несколько случайных уровней, не до нуля), потом ровно.
	// КАЖДАЯ лампа мигает НЕЗАВИСИМО (своё расписание в L.flk) → вразнобой, не синхронно.
	// Считается ЛОКАЛЬНО на каждом клиенте (косметика; экраны могут чуть отличаться).
	// factor множит базовую интенсивность Phaser-света, opacity ореола и intensity
	// rain-light этой лампы.
	_updateLightFlicker(time) {
		if (!this._lights.length) return
		for (const L of this._lights) {
			const f = L.flk
			if (!f) continue
			// Первый всплеск: сдвиг по lampId → лампы стартуют вразнобой.
			if (f.next == null) f.next = time + 1500 + ((L.lampId * 997) % 5000)
			if (f.phase === 'idle') {
				if (f.factor !== 1) f.factor = 1
				if (time >= f.next) {
					f.phase = 'burst'
					f.blinks = 4 + Math.floor(Math.random() * 7)
					f.on = true
					f.stepEnd = time
					this._playLampClick() // self-gated по 40% + дистанции
				}
			} else if (time >= f.stepEnd) {
				f.on = !f.on
				f.factor = f.on
					? 0.8 + Math.random() * 0.2 // вкл: 0.80-1.0
					: 0.3 + Math.random() * 0.2 // выкл: 0.30-0.5 (не в ноль)
				f.stepEnd =
					time + (f.on ? 45 + Math.random() * 110 : 30 + Math.random() * 70)
				if (--f.blinks <= 0) {
					f.phase = 'idle'
					f.next = time + 5000 + Math.random() * 1500 // следующий всплеск вразнобой
					f.factor = 1
				}
			}
			// Применяем factor к этой лампе.
			if (L.phLight) L.phLight.intensity = (L.baseIntensity ?? 1) * f.factor
			if (L.el) L.el.style.opacity = String(f.factor)
			if (L.rainLight) L.rainLight.intensity = f.factor
		}
	}

	// Громкость/панорама по дистанции от ЦЕНТРА КАМЕРЫ до ТОЧКИ pos (любой lampsound).
	// «Уши» привязаны к камере, а не к игроку: во время катсцены взрыва камера уезжает
	// к лампе, игрок остаётся далеко — звук должен следовать за камерой (что в кадре —
	// то и слышно), иначе гул/треск/взрыв звучат тихо, пока игрок не у лампы.
	// В обычной игре камера следует за игроком, так что они совпадают.
	// vol ∈ [0,1] (линейный спад), pan ∈ [-1,1] (слева/справа).
	_lampLevel(pos) {
		const cam = this.cameras?.main
		if (!pos || !cam) return { vol: 0, pan: 0 }
		const ex = cam.worldView.centerX
		const ey = cam.worldView.centerY
		// радиус слышимости 12 тайлов (16px) = 192px.
		const MAX = 12 * 16
		const dx = pos.x - ex
		const d = Math.hypot(dx, pos.y - ey)
		const t = Math.max(0, 1 - d / MAX)
		return { vol: t, pan: Phaser.Math.Clamp(dx / MAX, -1, 1) }
	}

	// Уровень БЛИЖАЙШЕЙ лампы (для щелчков/взрыва — звук от самой близкой).
	_nearestLampLevel() {
		let best = { vol: 0, pan: 0 }
		for (const s of this._lampSounds) {
			const lv = this._lampLevel(s)
			if (lv.vol > best.vol) best = lv
		}
		return best
	}

	// Зацикленное гудение в КАЖДОЙ точке lampsound. Создаётся только если файл загружен.
	_initLampAudio() {
		const sm = this.sound
		tlog(
			`[LampAudio] init: lampsounds=${this._lampSounds.length}` +
				`  cache hum=${this.cache.audio.exists('lamp-hum')} click=${this.cache.audio.exists('lamp-click')} boom=${this.cache.audio.exists('lamp-boom')}` +
				`  sound: mute=${sm.mute} volume=${sm.volume} locked=${sm.locked} ctx=${sm.context?.state ?? 'n/a'}`,
		)
		if (!this._lampSounds.length || !this.cache.audio.exists('lamp-hum')) {
			tlog(
				'[LampAudio] ⛔ пропуск: нет объектов lampsound или lamp-hum не в кэше',
			)
			return
		}
		if (sm.locked) {
			tlog('[LampAudio] ⚠ аудиоконтекст ЗАБЛОКИРОВАН — ждём жест пользователя')
			sm.once('unlocked', () =>
				tlog('[LampAudio] ✓ аудиоконтекст разблокирован'),
			)
		}
		for (const s of this._lampSounds) {
			s.hum = this.sound.add('lamp-hum', { loop: true, volume: 0 })
			s.hum.play()
		}
		this._updateLampAudio()
		tlog(`[LampAudio] ✓ ${this._lampSounds.length} гудений создано`)
	}

	// Каждый кадр: громкость/панорама каждого гула по дистанции до игрока.
	_updateLampAudio() {
		if (!this._lampSounds.length) return
		const mult = AudioManager.getMultiplier('sfx')
		for (const s of this._lampSounds) {
			if (!s.hum) continue
			const { vol, pan } = this._lampLevel(s)
			s.hum.setVolume(Math.min(1, vol * LAMP_HUM_VOL * mult * this._ambDuck))
			if (s.hum.setPan) s.hum.setPan(pan)
		}
	}

	// Останавливает и уничтожает все гулы ламп.
	_stopLampHums() {
		for (const s of this._lampSounds) {
			if (s.hum) {
				s.hum.stop()
				s.hum.destroy()
				s.hum = null
			}
		}
	}

	// Каждый кадр: громкость дождя синхронизируется с настройкой sfx.
	// Дождь — постоянный фоновый дрон, поэтому держим его НИЖЕ музыки и событийных
	// SFX (0.17), иначе он маскирует гул/треск ламп и удары. Был 0.3 — забивал всё.
	_updateRainAudio() {
		if (!this._rainAmb) return
		this._rainAmb.setVolume(
			0.17 * AudioManager.getMultiplier('sfx') * this._ambDuck,
		)
	}

	// Одноразовый щелчок/треск на миг лампы (рандом высоты/громкости → не механически).
	_playLampClick() {
		if (!this.cache.audio.exists('lamp-click')) {
			tlog('[LampAudio] click: lamp-click нет в кэше')
			return
		}
		const { vol, pan } = this._nearestLampLevel()
		if (vol <= 0.02) {
			tlog(
				`[LampAudio] click пропущен — далеко (vol=${vol.toFixed(3)}, радиус 64px)`,
			)
			return // далеко — не щёлкаем
		}
		if (Math.random() >= 0.4) {
			tlog('[LampAudio] click пропущен — 40% шанс')
			return // треск не на каждый миг, а с 40% шансом
		}
		// Треск лампы (рандомный) — ещё ÷1.5 (база 0.73, была 1.1): тише.
		// Итог зажимаем в 1.0 на всякий случай.
		const v = Math.min(
			1,
			vol *
				0.73 *
				(0.7 + Math.random() * 0.3) *
				AudioManager.getMultiplier('sfx'),
		)
		this.sound.play('lamp-click', {
			volume: v,
			rate: 0.85 + Math.random() * 0.4,
			pan,
		})
		tlog(`[LampAudio] ▶ click vol=${v.toFixed(2)}`)
	}

	// Убирает источник света ТОЛЬКО лампы id BREAK_LAMP_ID с вспышкой. Остальные
	// лампы продолжают светить/мигать/гудеть. Вызывается у обоих игроков (lamplever).
	_extinguishLight() {
		const BREAK_LAMP_ID = 1
		const targets = this._lights.filter(L => L.lampId === BREAK_LAMP_ID)
		if (!targets.length) return

		for (const L of targets) {
			L.flk = null // стоп мерцанию (яркостью управляет фейд-твин ниже)
			// убрать её rain-light из ОБЩЕГО массива in-place → эффекты (общая ссылка) видят
			const ri = this._rainLights.indexOf(L.rainLight)
			if (ri >= 0) this._rainLights.splice(ri, 1)
		}
		// погасить гул только этой лампы (по совпадающему id lampsound)
		for (const s of this._lampSounds) {
			if (s.id === BREAK_LAMP_ID && s.hum) {
				s.hum.stop()
				s.hum.destroy()
				s.hum = null
			}
		}

		const container = document.getElementById('game-container')
		const cam = this.cameras.main
		const rect = this.game.canvas.getBoundingClientRect()
		const sf = cam.zoom * (rect.width / this.game.config.width)
		const FADE_MS = 350

		for (const L of targets) {
			// Phaser: поднять интенсивность × 14 и расширить радиус × 5
			if (L.phLight) {
				L.phLight.setIntensity((L.baseIntensity ?? 1) * 14)
				L.phLight.setRadius(L.radius * 5)
			}
			// Получаем цвет из phLight (hex integer → r,g,b)
			const col = L.phLight?.color ?? 0xffcc66
			const r = (col >> 16) & 255
			const g = (col >> 8) & 255
			const b = col & 255
			// Большой яркий CSS flash-div (отдельный — opacity:1 не зависит от обычного ореола)
			const flashEl = document.createElement('div')
			flashEl.style.cssText =
				'position:absolute;pointer-events:none;border-radius:50%;' +
				'mix-blend-mode:screen;will-change:opacity;opacity:1;'
			flashEl.style.background =
				`radial-gradient(circle closest-side,` +
				` rgba(${r},${g},${b},1.0) 0%,` +
				` rgba(${r},${g},${b},0.85) 20%,` +
				` rgba(${r},${g},${b},0.5) 50%,` +
				` rgba(${r},${g},${b},0) 100%)`
			const sp = this._worldToScreen(L.wx, L.wy)
			const screenR = L.radius * 4 * sf
			flashEl.style.width = `${screenR * 2}px`
			flashEl.style.height = `${screenR * 2}px`
			flashEl.style.left = `${sp.x - screenR}px`
			flashEl.style.top = `${sp.y - screenR}px`
			container.appendChild(flashEl)
			L._flashEl = flashEl
		}

		tlog(`[Flash] вспышка — лампа id${BREAK_LAMP_ID} (count=${targets.length})`)

		const proxy = { f: 1 }
		this.tweens.add({
			targets: proxy,
			f: 0,
			duration: FADE_MS,
			ease: 'Quad.easeOut',
			onUpdate: () => {
				const f = proxy.f
				for (const L of targets) {
					if (L.phLight) L.phLight.setIntensity((L.baseIntensity ?? 1) * 14 * f)
					if (L._flashEl) L._flashEl.style.opacity = String(f)
					if (L.el) L.el.style.opacity = String(f)
				}
			},
			onComplete: () => {
				for (const L of targets) {
					L._flashEl?.remove()
					L.el?.remove()
					if (L.phLight) this.lights.removeLight(L.phLight)
					const i = this._lights.indexOf(L)
					if (i >= 0) this._lights.splice(i, 1) // убрать только эту лампу
				}
			},
		})
	}

	// Звук хлопка/взрыва лампы с учётом дистанции.
	_playLampBoom() {
		if (!this.cache.audio.exists('lamp-boom')) return
		// Обрываем щелчки/предыдущий boom. lamp-hum НЕ глушим по ключу — иначе замолчат
		// гулы ВСЕХ ламп; гул разбитой лампы уже остановлен в _extinguishLight.
		this.sound.stopByKey('lamp-click')
		this.sound.stopByKey('lamp-boom')
		const { vol, pan } = this._nearestLampLevel()
		const _sfxMult = AudioManager.getMultiplier('sfx')
		// Взрыв лампы — ещё ×2: множитель sfx внесён ВНУТРЬ и удвоен, итог зажат в 1.0.
		// Так взрыв звучит на полной громкости даже на средних настройках (был ~0.64·mult).
		this.sound.play('lamp-boom', {
			volume: Math.min(1, Math.max(0.9, vol) * 1.3 * _sfxMult * 2),
			pan,
		})
	}

	// Хост → рассылает снапшот визуального состояния каждые 500мс.
	_sendVisualSync() {
		networkClient.sendVisualSync({
			wireT: this._wire?.t ?? 0,
			flicker: this._flickerFactor ?? 1,
			flickerPhase: this._flickerPhase ?? 'idle',
			drifts: this._parallaxLayers.map(L => L._driftAccX),
		})
	}

	// Гость → коррекция от хоста.
	// Провод: гость симулирует НЕЗАВИСИМО (t += delta/1000 каждый кадр, детерминировано).
	// Подтяжка только при расхождении > порога: > 1с = снап (вкладка была скрыта);
	// 0.15..1с = очень медленный lerp (2% в кадр, незаметно); < 0.15с = не трогаем.
	// Так бо́льшую часть времени второй игрок полностью сам симулирует, без дёрганья.
	_applyVisualSync() {
		const t = this._visualSyncTarget

		// Провод — коррекция только при значимом расхождении
		if (this._wire && t.wireT != null) {
			const diff = t.wireT - this._wire.t
			const absDiff = Math.abs(diff)
			if (absDiff > 1) {
				// Долго в фоне — снап
				this._wire.t += diff
			} else if (absDiff > 0.15) {
				// Небольшой дрейф — медленная подтяжка (2% в кадр ≈ незаметно)
				this._wire.t += diff * 0.02
			}
			// < 0.15с — не трогаем, гость симулирует сам
		}

		// Мерцание управляется event-driven через flickerStep — здесь не трогаем.

		// Параллакс-дрейф — driftX константа → движение ДЕТЕРМИНИРОВАНО и одинаково
		// у обоих клиентов. Гость симулирует САМ каждый кадр (_updateParallax), сеть
		// нужна только чтобы выровнять фазу после ЗАМОРОЗКИ rAF (вкладка свёрнута).
		// Поэтому, как и провод: > 150px = снап (был фон), 15..150px = медленный lerp
		// (2%/кадр, незаметно), < 15px = НЕ трогаем → нет дёрганья при обычной игре.
		// (Экраны игроков не видят друг друга — мелкое расхождение фаз неважно.)
		if (t.drifts) {
			for (
				let i = 0;
				i < this._parallaxLayers.length && i < t.drifts.length;
				i++
			) {
				const L = this._parallaxLayers[i]
				const diff = t.drifts[i] - L._driftAccX
				const absDiff = Math.abs(diff)
				if (absDiff > 150) {
					L._driftAccX += diff // снап после долгого фона
				} else if (absDiff > 15) {
					L._driftAccX += diff * 0.02 // медленная плавная подтяжка
				}
				// < 15px — гость полностью симулирует сам, без коррекции → плавно
			}
		}
	}

	// "#rgb" | "#rrggbb" | "#aarrggbb"(Tiled) → {r,g,b}
	_parseColor(str) {
		let h = String(str).trim().replace(/^#/, '')
		if (h.length === 3)
			h = h
				.split('')
				.map(c => c + c)
				.join('')
		if (h.length === 8) h = h.slice(2) // отбросить альфу из формата #AARRGGBB
		const n = parseInt(h, 16) || 0
		return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
	}

	// Converts a world-space point to viewport CSS px — used to position DOM labels.
	_worldToScreen(wx, wy) {
		const cam = this.cameras.main
		const rect = this.game.canvas.getBoundingClientRect()
		const sx =
			(wx - cam.scrollX) * cam.zoom * (rect.width / this.game.config.width)
		const sy =
			(wy - cam.scrollY) * cam.zoom * (rect.height / this.game.config.height)
		return { x: rect.left + sx, y: rect.top + sy }
	}

	// Called every frame — keeps DOM label positions in sync with the camera.
	// Position is updated as long as the element is VISIBLE (display !== 'none'),
	// including during exit animations — prevents "drifting" while fading out.
	_updateDomPositions() {
		// Точечные источники света: позиция + размер в screen-px каждый кадр.
		if (this._lights.length) {
			const cam = this.cameras.main
			const rect = this.game.canvas.getBoundingClientRect()
			const sf = cam.zoom * (rect.width / this.game.config.width)
			for (const L of this._lights) {
				const p = this._worldToScreen(L.wx, L.wy)
				const rs = L.radius * sf
				L.el.style.width = rs * 2 + 'px'
				L.el.style.height = rs * 2 + 'px'
				L.el.style.left = p.x - rs + 'px'
				L.el.style.top = p.y - rs + 'px'
			}
		}
		for (const lbl of this._worldLabels) {
			const p = this._worldToScreen(lbl.wx, lbl.wy)
			lbl.el.style.left = p.x + 'px'
			lbl.el.style.top = p.y + 'px'
		}
		if (
			this._orbPromptEl &&
			this._orbPromptEl.style.display !== 'none' &&
			this.orb?.active
		) {
			// Следовать за спрайтом (который бобает), а не за физическим телом
			const orbY = this._orbSprite ? this._orbSprite.y : this.orb.y
			const p = this._worldToScreen(this.orb.x, orbY - 20)
			this._orbPromptEl.style.left = p.x + 'px'
			this._orbPromptEl.style.top = p.y + 'px'
		}
		for (const torb of this._testOrbs) {
			if (torb.promptEl.style.display !== 'none') {
				const p = this._worldToScreen(torb.wx, torb.wy)
				torb.promptEl.style.left = p.x + 'px'
				torb.promptEl.style.top = p.y + 'px'
			}
		}
		if (
			this._lampLeverPromptEl &&
			this._lampLeverPromptEl.style.display !== 'none' &&
			this._lampLeverPos
		) {
			const p = this._worldToScreen(
				this._lampLeverPos.x,
				this._lampLeverPos.y - 20,
			)
			this._lampLeverPromptEl.style.left = p.x + 'px'
			this._lampLeverPromptEl.style.top = p.y + 'px'
		}
	}

	// ЛКМ на оверлее — плавно скрыть, потом разморозить персонажа
	// fromNetwork=true → закрытие пришло от партнёра (не ретранслируем обратно).
	_dismissAbilityOverlay(fromNetwork = false) {
		if (!this._abilityOverlayEl) return
		// Всегда сообщаем партнёру «я закрыл окно». Зеркалить ли это у себя —
		// решает ПОЛУЧАТЕЛЬ по своей настройке syncAbilityClose (см. слушатель
		// 'abilityClose'). Так настройка работает там, где её включили, даже если
		// у закрывающего (напр. хост рядом с ботом-гостем) она выключена.
		if (!fromNetwork) networkClient.abilityClose()
		const el = this._abilityOverlayEl
		this._abilityOverlayEl = null
		this._unduckAmbient() // вернуть громкость музыки и фона
		el.classList.add('hiding') // запускает CSS-анимацию overlayOut
		setTimeout(() => {
			el.remove()
			this._unfreezeAfterOrb()
		}, 500)
	}

	// Принудительно закрыть оверлей способности БЕЗ анимации/разморозки.
	// Вызывается при любом переходе (смерть, рестарт, след. уровень, выход),
	// чтобы текст «Открыто:» не завис у второго игрока, если тот ещё не закрыл
	// его ЛКМ (иначе экран смерти/завершения накрывает его сверху и перехватывает
	// клики → закрыть уже нельзя). Безопасно вызывать когда оверлея нет.
	_closeAbilityOverlay() {
		this._abilityOverlayEl?.remove()
		this._abilityOverlayEl = null
		this._unduckAmbient() // вернуть громкость музыки и фона
	}

	// Вернуть громкость музыки и фоновых звуков после оверлея способности.
	_unduckAmbient() {
		this._tweenAmbDuck(1) // дождь/лампы плавно возвращаются
		MusicManager.setDuck(1) // музыка плавно возвращается (easeInOut внутри)
	}

	// Плавный переход приглушения фоновых звуков (дождь/лампы) к значению to за ms.
	// Останавливает предыдущий duck-твин, чтобы они не конфликтовали.
	_tweenAmbDuck(to, ms = 900) {
		this._ambDuckTween?.stop()
		const a = { v: this._ambDuck }
		this._ambDuckTween = this.tweens.add({
			targets: a,
			v: to,
			duration: ms,
			ease: 'Sine.easeInOut',
			onUpdate: () => {
				this._ambDuck = a.v
			},
			onComplete: () => {
				this._ambDuck = to
				this._ambDuckTween = null
			},
		})
	}

	// Разморозить физику и ввод после кинематика сбора орба
	_unfreezeAfterOrb() {
		this.localPlayer.body.setAllowGravity(true)
		// Принудительно вернуть idle-анимацию — _animState уже 'idle' после атаки,
		// но спрайт завис на последнем кадре, поэтому play() нужен явно.
		this.localPlayer._animState = ''
		this.localPlayer.play(this.localPlayer._charPrefix + '-idle')
		this.localPlayer._animState = 'idle'
		this._inputLocked = false
	}

	// Phaser lifecycle — called on scene stop/restart. Cleans up all DOM elements.
	shutdown() {
		// Таймер «второго шанса» не должен пережить сцену
		if (this._reviveTimer) { clearTimeout(this._reviveTimer); this._reviveTimer = null }
		// Явно удалить каждый отслеживаемый элемент
		this._levelCompleteEl?.remove()
		this._abilityOverlayEl?.remove()
		this._reviveOverlayEl?.remove()
		this._reviveOverlayEl = null
		this._orbPromptEl?.remove()
		this._orbSprite?.destroy()
		this._orbSprite = null
		for (const lbl of this._worldLabels) lbl.el?.remove()
		for (const L of this._lights) L.el?.remove()
		this._lights = []
		for (const torb of this._testOrbs) torb.promptEl?.remove()

		// Сбросить контейнеры полностью на случай если что-то пропустили
		const hp = document.getElementById('hud-prompts')
		const ho = document.getElementById('hud-overlay')
		if (hp) hp.innerHTML = ''
		if (ho) ho.innerHTML = ''

		this._worldLabels = []
		this._orbPromptEl = null
		this._abilityOverlayEl = null
		this._levelCompleteEl = null
		this._tutMoveEl = null // сами элементы удалены очисткой hud-prompts выше
		this._tutInteractEl = null
		if (this._onTutResize) {
			window.removeEventListener('resize', this._onTutResize)
			this._onTutResize = null
		}
		if (this._onGameResize) {
			window.removeEventListener('resize', this._onGameResize)
			this.scale.off('resize', this._onGameResize)
			this._onGameResize = null
		}
		this._deathOverlayEl?.remove()
		this._deathOverlayEl = null
		this._inputLocked = false
		this._dying = false
		this._rain?.destroy()
		this._rain = null
		this._rainSlide?.destroy()
		this._rainSlide = null
		this._stopLampHums()
		this._rainAmb?.stop()
		this._rainAmb?.destroy()
		this._rainAmb = null
		this._lampLeverPromptEl?.remove()
		this._lampLeverPromptEl = null
	}

	_exitGame(completed = false, notify = true) {
		if (this._exiting && !completed) return
		this._exiting = true
		if (notify) networkClient.exitGame()
		this._netUnsub.forEach(u => u())
		this._netUnsub = []
		// Останавливаем звуки явно — до scene.stop(), чтобы не зависеть от порядка shutdown()
		this._rainAmb?.stop()
		this._rainAmb?.destroy()
		this._rainAmb = null
		this._stopLampHums()
		// Save playtime for this session
		saveSessionPlaytime()
		this.scene.stop()
		exitToLevelSelect()
	}
}

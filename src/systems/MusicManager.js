import { SaveSystem } from './SaveSystem.js'

// Фоновая музыка меню и уровней через HTML5 Audio (меню — HTML/CSS, Phaser ещё не
// создан, поэтому Phaser-звук тут не подходит). Один трек одновременно, зациклен,
// с плавным появлением (фейд-ин) и исчезновением (фейд-аут при смене/остановке).
// Громкость = baseVolume × master × music из настроек.
const MusicManager = {
	_audio: null, // текущий Audio
	_src: null, // текущий путь (идемпотентность: повторный play того же трека — no-op)
	_baseVolume: 0.5, // громкость при master=10, music=10 (бед-слой: чуть ниже, чтобы
	//                   событийные SFX — удар о шипы, взрыв лампы — читались поверх)
	_armed: false, // повешен ли one-time листенер на жест (обход автоплей-блокировки)
	_pendingStart: null, // setTimeout id отложенного старта нового трека (пауза тишины)
	_duck: 1, // множитель приглушения (1 = норма, <1 = тише, напр. на оверлее способности)
	_duckRaf: null, // rAF плавного перехода duck (приглушение/возврат музыки)

	_targetVol() {
		const a = SaveSystem.getSettings().audio
		return this._baseVolume * (a.master / 10) * ((a.music ?? 10) / 10) * this._duck
	},

	// Приглушить/вернуть фоновую музыку (напр. на время оверлея «Открыто»). Меняем duck
	// НЕ скачком, а плавным переходом за ms (easeInOut) → мягкое затихание и возврат.
	setDuck(factor, ms = 900) {
		if (this._duckRaf) {
			cancelAnimationFrame(this._duckRaf)
			this._duckRaf = null
		}
		const from = this._duck
		const to = factor
		const apply = () => {
			if (this._audio && !this._audio._fading) this._audio.volume = this._targetVol()
		}
		if (ms <= 0 || from === to) {
			this._duck = to
			apply()
			return
		}
		// easeInOutSine — мягкий старт и финиш, без рывков на краях.
		const ease = t => 0.5 - 0.5 * Math.cos(Math.PI * t)
		const start = performance.now()
		const tick = now => {
			const t = Math.min(1, (now - start) / ms)
			this._duck = from + (to - from) * ease(t)
			apply()
			if (t < 1) {
				this._duckRaf = requestAnimationFrame(tick)
			} else {
				this._duck = to
				this._duckRaf = null
			}
		}
		this._duckRaf = requestAnimationFrame(tick)
	},

	// Сменить трек последовательно (НЕ кроссфейдом): старый плавно затухает за
	// fadeOutMs, затем gapMs тишины, и только потом новый плавно появляется за
	// fadeInMs. Повторный вызов того же трека (играет или запланирован) — no-op.
	play(src, { fadeOutMs = 1500, gapMs = 1000, fadeInMs = 1500 } = {}) {
		if (this._src === src && (this._audio || this._pendingStart)) return
		this._src = src
		if (this._pendingStart) {
			clearTimeout(this._pendingStart)
			this._pendingStart = null
		}
		const old = this._audio
		this._audio = null

		const startNew = () => {
			this._pendingStart = null
			const audio = new Audio(src)
			audio.loop = true
			audio.volume = 0
			this._audio = audio
			this._fade(audio, 0, this._targetVol(), fadeInMs)
			// 1) Пробуем сразу СО ЗВУКОМ (если браузер разрешает автоплей — заиграет на
			//    загрузке). 2) Заблокировано → крутим МУТОМ: muted-автоплей браузеры
			//    разрешают, трек идёт с загрузки молча. На ПЕРВЫЙ любой жест снимем mute
			//    → звук появится сразу (см. _armGesture), а не только при входе в фуллскрин.
			audio.play().catch(() => {
				audio.muted = true
				audio.play().catch(() => {})
				this._armGesture()
			})
		}

		if (old) {
			this._fade(old, old.volume, 0, fadeOutMs, () => {
				old.pause()
				old.src = ''
			})
			// тишина gapMs ПОСЛЕ окончания фейд-аута → потом новый трек
			this._pendingStart = setTimeout(startNew, fadeOutMs + gapMs)
		} else {
			startNew()
		}
	},

	// Остановить текущий трек с фейд-аутом.
	stop({ fadeMs = 1500 } = {}) {
		if (this._pendingStart) {
			clearTimeout(this._pendingStart)
			this._pendingStart = null
		}
		this._src = null
		const a = this._audio
		if (!a) return
		this._audio = null
		this._fade(a, a.volume, 0, fadeMs, () => {
			a.pause()
			a.src = ''
		})
	},

	// Применить текущую настройку громкости к играющему треку (вызывается из настроек).
	applyVolume() {
		if (this._audio && !this._audio._fading) {
			this._audio.volume = this._targetVol()
		}
	},

	// Линейный фейд громкости HTML5 Audio через requestAnimationFrame.
	_fade(audio, from, to, ms, onDone) {
		audio._fading = true
		const start = performance.now()
		const tick = now => {
			const t = Math.min(1, (now - start) / ms)
			audio.volume = Math.max(0, Math.min(1, from + (to - from) * t))
			if (t < 1) {
				requestAnimationFrame(tick)
			} else {
				audio._fading = false
				onDone?.()
			}
		}
		requestAnimationFrame(tick)
	},

	// Автоплей со звуком до первого жеста заблокирован → на ПЕРВЫЙ любой жест (клик,
	// клавиша, тач) снимаем mute и доигрываем. Слушатели в capture-фазе → срабатывают
	// раньше обработчиков меню, музыка стартует на самом первом взаимодействии.
	_armGesture() {
		if (this._armed) return
		this._armed = true
		const EVTS = ['pointerdown', 'keydown', 'touchstart']
		const resume = () => {
			const a = this._audio
			if (a) {
				a.muted = false // вернуть звук (трек уже крутился мутом с загрузки)
				a.play().catch(() => {})
				if (!a._fading) a.volume = this._targetVol()
			}
			for (const e of EVTS) window.removeEventListener(e, resume, true)
			this._armed = false
		}
		for (const e of EVTS) window.addEventListener(e, resume, true)
	},
}

export default MusicManager

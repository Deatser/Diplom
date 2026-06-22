// Словарь переводов RU/EN. t(key, params) — {плейсхолдеры} подставляются из params.
// Статичный HTML помечается data-i18n / data-i18n-ph (placeholder) / data-i18n-title
// и обновляется applyDom() — вызывается при старте и при каждой смене языка.
const T = {
  ru: {
    // Главное меню
    'menu.start': 'Начать игру', 'menu.settings': 'Настройки', 'menu.quit': 'Выход',
    'confirm.quit': 'Выйти из игры?', 'confirm.yes': 'Да', 'confirm.no': 'Нет',
    // Пауза
    'pause.title': 'Пауза', 'pause.resume': 'Продолжить',
    'pause.settings': 'Настройки', 'pause.exit': 'Выйти в меню',
    'confirm.exit_level': 'Выйти в меню выбора уровня?',
    // Настройки
    'settings.title': 'Настройки',
    'settings.lang': 'Язык', 'settings.audio': 'Звук', 'settings.video': 'Видео',
    'settings.keyboard': 'Клавиатура', 'settings.gameplay': 'Игра',
    'settings.back': 'Назад', 'settings.default': 'По умолчанию',
    'settings.master': 'Общий', 'settings.music': 'Музыка', 'settings.sfx': 'Звуки',
    'settings.resolution': 'Разрешение монитора', 'settings.fullscreen': 'Полный экран',
    'settings.brightness': 'Яркость',
    'settings.your_monitor': ' (ваш монитор)',
    'settings.on': 'Вкл', 'settings.off': 'Выкл',
    'settings.play_as_bot': 'Играть за бота',
    'settings.bot_hint': 'Если включено и вы оранжевый игрок (гость) — управление заблокировано, персонаж ходит сам по тестовому маршруту. Менять до начала игры.',
    'settings.sync_ability_close': 'Синхронное закрытие способности',
    'settings.sync_ability_hint': 'Если включено — ваше окно полученной способности закрывается автоматически, когда его закрывает второй игрок. Включайте на том экране, где окно должно закрываться само (например на стороне бота).',
    'settings.res_confirm': 'Сохранить это разрешение?',
    'settings.res_revert_before': 'Возврат к прежнему через ',
    'settings.res_revert_after': ' сек',
    'settings.save': 'Сохранить', 'settings.cancel': 'Отменить',
    // Клавиши
    'key.move_left': 'Влево', 'key.move_right': 'Вправо',
    'key.jump': 'Прыжок / Взаимодействие', 'key.dash': 'Рывок', 'key.down': 'Вниз',
    'key.special': 'Особое (ПКМ)', 'key.menu': 'Меню / Назад', 'key.fullscreen': 'Полный экран',
    'key.space': 'Пробел', 'key.rmb': 'ПКМ',
    // Лобби
    'lobby.servers': 'Доступные серверы', 'lobby.search': 'Поиск по названию...',
    'lobby.profile': 'Создайте сервер', 'lobby.new': 'Новая игра',
    'lobby.no_servers': 'Серверов нет', 'lobby.level': 'Уровень',
    'lobby.delete': 'Удалить', 'lobby.delete_confirm': 'Удалить сохранение?',
    'lobby.status_waiting': 'Ожидание игрока', 'lobby.status_ready': 'Ожидание начала игры',
    'lobby.status_playing': 'Идёт игра',
    'lobby.return_to_game': '▶ Вернуться в игру',
    'lobby.hours': 'ч', 'lobby.minutes': 'м',
    'lobby.back': 'Назад',
    // Выбор уровня
    'ls.host': 'Хост', 'ls.guest': 'Гость', 'ls.waiting': 'Ожидание...',
    'ls.start': 'Начать', 'ls.waiting_second': 'Ожидание второго игрока...',
    'ls.choose': 'Выберите уровень',
    'ls.waiting_host_choose': 'Ждём, когда хост выберет уровень',
    'ls.rename_tip': 'Нажмите, чтобы переименовать',
    'ls.host_left': 'Хост покинул игру', 'ls.ok': 'ОК',
    'ls.partner_left': 'Второй игрок вышел из игры',
    'ls.world': 'Мир',
    'ls.coming_soon': 'Скоро',
    'ls.coming_soon_tip': 'Ждите обновлений',
    'ls.coming_soon_notice': 'Следующих уровней пока нет — скоро будет больше. Ждите обновлений!',
    // Игра
    'game.pickup': 'Подобрать', 'game.inspect': 'Осмотреть',
    'game.tut_move': 'Перемещение', 'game.tut_interact': 'Взаимодействовать',
    'game.tut_dash': 'Рывок',
    'game.unlocked': 'Открыто:',
    'game.exit_sign': '▲ ВЫХОД',
    'game.you_died': 'ВЫ ПОГИБЛИ', 'game.partner_died': 'Второй игрок погиб',
    'game.restart': '↺  Заново', 'game.exit_menu': '◀  Выйти в меню',
    'game.waiting_host': 'Ожидание хоста…',
    'game.revive_deciding': 'Второй игрок выбирает, смотреть ли рекламу…',
    'game.revive_watching': 'Другой игрок смотрит рекламу для возрождения. Уровень скоро продолжится.',
    'game.waiting_partner_decision': 'Ждём решения второго игрока…',
    'game.auto_restart': 'Уровень перезапустится с начала через {n} с',
    'game.revive_title': 'ВТОРОЙ ШАНС',
    'game.revive_sub': 'Посмотрите рекламу, чтобы воскреснуть',
    'game.revive_watch': 'Смотреть рекламу',
    'game.revive_success': 'Вы успешно возродились!',
    'game.ad_placeholder': 'Здесь могла быть ваша реклама',
    'game.level_complete': 'УРОВЕНЬ {n} ПРОЙДЕН!',
    'game.game_complete': '🏆 ИГРА ПРОЙДЕНА!',
    'game.next_level': '▶  Уровень {n}', 'game.level_select': '◀  Выбор уровня',
    'game.level_passed_plain': 'Уровень {n} Пройден!',
    'game.level_passed_html': 'Уровень {n} <span class="fc-pass">Пройден!</span>',
    'game.no_more_levels': 'Следующие уровни ещё в разработке. Ждите обновлений!',
    'game.peak': '🏔 Вершина горы!',
    'game.stub': 'Уровень {n}<br>(В разработке)',
    'game.test_attack': '[ЛКМ] Атака', 'game.test_hit': '[ЛКМ] Урон',
    'game.test_death': '[ЛКМ] Смерть', 'game.test_shield': '[ЛКМ] Щит ⇄',
    // Финальные кнопки уровня (флип-табло)
    'final.host_done_plain': 'Хост дошел до конца',
    'final.host_wait_plain': 'Ожидание Хоста',
    'final.host_done_html': '<span class="fc-host">Хост</span> дошел до конца',
    'final.host_wait_html': 'Ожидание <span class="fc-host">Хоста</span>',
    'final.guest_done_plain': 'Гость дошел до конца',
    'final.guest_wait_plain': 'Ожидание Гостя',
    'final.guest_done_html': '<span class="fc-guest">Гость</span> дошел до конца',
    'final.guest_wait_html': 'Ожидание <span class="fc-guest">Гостя</span>',
    // Способности
    'ability.dash': 'Воздушный рывок', 'ability.doubleJump': 'Двойной прыжок',
    'ability.wallCling': 'Цепляние за стены', 'ability.groundSlam': 'Удар о землю',
    'ability.airDive': 'Воздушный рывок вниз', 'ability.grapple': 'Крюк-кошка',
    'ability.glide': 'Парение', 'ability.conjurePlatform': 'Призыв платформы',
    'ability.swap': 'Обмен позициями', 'ability.chargedDash': 'Заряженный дэш',
    'hint.dash': 'Нажмите {key} на земле или в прыжке, чтобы устремиться вперёд',
    'hint.doubleJump': 'Нажмите {key} повторно в воздухе для второго прыжка',
    'hint.wallCling': 'Прижмитесь к стене и удерживайте направление — скольжение замедляет падение',
    'hint.groundSlam': 'В воздухе зажмите {key} чтобы с силой ударить о землю',
    'hint.airDive': 'В воздухе зажмите {key} + вниз для стремительного рывка',
    'hint.grapple': 'ПКМ чтобы выпустить крюк-кошку',
    'hint.glide': 'Удерживайте {key} в воздухе для медленного парения',
    'hint.conjurePlatform': 'ПКМ чтобы создать временную платформу под ногами',
    'hint.swap': 'ПКМ чтобы мгновенно поменяться местами с партнёром',
    'hint.chargedDash': 'Удерживайте {key} для заряженного рывка',
  },
  en: {
    'menu.start': 'Start Game', 'menu.settings': 'Settings', 'menu.quit': 'Quit',
    'confirm.quit': 'Quit the game?', 'confirm.yes': 'Yes', 'confirm.no': 'No',
    'pause.title': 'Paused', 'pause.resume': 'Resume',
    'pause.settings': 'Settings', 'pause.exit': 'Exit to Menu',
    'confirm.exit_level': 'Exit to level select?',
    'settings.title': 'Settings',
    'settings.lang': 'Language', 'settings.audio': 'Audio', 'settings.video': 'Video',
    'settings.keyboard': 'Keyboard', 'settings.gameplay': 'Gameplay',
    'settings.back': 'Back', 'settings.default': 'Reset to Default',
    'settings.master': 'Master', 'settings.music': 'Music', 'settings.sfx': 'Sound Effects',
    'settings.resolution': 'Monitor Resolution', 'settings.fullscreen': 'Fullscreen',
    'settings.brightness': 'Brightness',
    'settings.your_monitor': ' (your monitor)',
    'settings.on': 'On', 'settings.off': 'Off',
    'settings.play_as_bot': 'Play as Bot',
    'settings.bot_hint': 'If enabled and you are the orange player (guest), controls are locked and the character walks a test route on its own. Change before the game starts.',
    'settings.sync_ability_close': 'Sync ability dismiss',
    'settings.sync_ability_hint': 'If enabled, your unlocked-ability window closes automatically when the other player closes theirs. Enable it on the screen where the window should close by itself (e.g. the bot side).',
    'settings.res_confirm': 'Keep this resolution?',
    'settings.res_revert_before': 'Reverting back in ',
    'settings.res_revert_after': ' sec',
    'settings.save': 'Save', 'settings.cancel': 'Cancel',
    'key.move_left': 'Move Left', 'key.move_right': 'Move Right',
    'key.jump': 'Jump / Interact', 'key.dash': 'Dash', 'key.down': 'Down',
    'key.special': 'Special (RMB)', 'key.menu': 'Menu / Back', 'key.fullscreen': 'Fullscreen',
    'key.space': 'Space', 'key.rmb': 'RMB',
    'lobby.servers': 'Available Servers', 'lobby.search': 'Search by name...',
    'lobby.profile': 'Create a Server', 'lobby.new': 'New Game',
    'lobby.no_servers': 'No servers', 'lobby.level': 'Level',
    'lobby.delete': 'Delete', 'lobby.delete_confirm': 'Delete this save?',
    'lobby.status_waiting': 'Waiting for player', 'lobby.status_ready': 'Waiting for game start',
    'lobby.status_playing': 'Game in progress',
    'lobby.return_to_game': '▶ Return to game',
    'lobby.hours': 'h', 'lobby.minutes': 'm',
    'lobby.back': 'Back',
    'ls.host': 'Host', 'ls.guest': 'Guest', 'ls.waiting': 'Waiting...',
    'ls.start': 'Start', 'ls.waiting_second': 'Waiting for second player...',
    'ls.choose': 'Choose a level',
    'ls.waiting_host_choose': 'Waiting for the host to pick a level',
    'ls.rename_tip': 'Click to rename',
    'ls.host_left': 'The host has left the game', 'ls.ok': 'OK',
    'ls.partner_left': 'The other player left the game',
    'ls.world': 'World',
    'ls.coming_soon': 'Soon',
    'ls.coming_soon_tip': 'Stay tuned for updates',
    'ls.coming_soon_notice': 'No further levels yet — more are coming. Stay tuned!',
    'game.pickup': 'Pick Up', 'game.inspect': 'Inspect',
    'game.tut_move': 'Movement', 'game.tut_interact': 'Interact',
    'game.tut_dash': 'Dash',
    'game.unlocked': 'Unlocked:',
    'game.exit_sign': '▲ EXIT',
    'game.you_died': 'YOU DIED', 'game.partner_died': 'Your partner died',
    'game.restart': '↺  Restart', 'game.exit_menu': '◀  Exit to Menu',
    'game.waiting_host': 'Waiting for host…',
    'game.revive_deciding': 'The other player is choosing whether to watch an ad…',
    'game.revive_watching': 'The other player is watching an ad to revive. The level will continue shortly.',
    'game.waiting_partner_decision': 'Waiting for the other player’s decision…',
    'game.auto_restart': 'The level will restart from the beginning in {n} s',
    'game.revive_title': 'SECOND CHANCE',
    'game.revive_sub': 'Watch an ad to revive',
    'game.revive_watch': 'Watch Ad',
    'game.revive_success': 'You revived successfully!',
    'game.ad_placeholder': 'Your ad could be here',
    'game.level_complete': 'LEVEL {n} COMPLETE!',
    'game.game_complete': '🏆 GAME COMPLETE!',
    'game.next_level': '▶  Level {n}', 'game.level_select': '◀  Level Select',
    'game.level_passed_plain': 'Level {n} Complete!',
    'game.level_passed_html': 'Level {n} <span class="fc-pass">Complete!</span>',
    'game.no_more_levels': 'The next levels are still in development. Stay tuned!',
    'game.peak': '🏔 Mountain peak!',
    'game.stub': 'Level {n}<br>(In development)',
    'game.test_attack': '[LMB] Attack', 'game.test_hit': '[LMB] Hit',
    'game.test_death': '[LMB] Death', 'game.test_shield': '[LMB] Shield ⇄',
    'final.host_done_plain': 'Host reached the end',
    'final.host_wait_plain': 'Waiting for Host',
    'final.host_done_html': '<span class="fc-host">Host</span> reached the end',
    'final.host_wait_html': 'Waiting for <span class="fc-host">Host</span>',
    'final.guest_done_plain': 'Guest reached the end',
    'final.guest_wait_plain': 'Waiting for Guest',
    'final.guest_done_html': '<span class="fc-guest">Guest</span> reached the end',
    'final.guest_wait_html': 'Waiting for <span class="fc-guest">Guest</span>',
    'ability.dash': 'Dash', 'ability.doubleJump': 'Double Jump',
    'ability.wallCling': 'Wall Cling', 'ability.groundSlam': 'Ground Slam',
    'ability.airDive': 'Air Dive', 'ability.grapple': 'Grapple Hook',
    'ability.glide': 'Glide', 'ability.conjurePlatform': 'Conjure Platform',
    'ability.swap': 'Position Swap', 'ability.chargedDash': 'Charged Dash',
    'hint.dash': 'Press {key} on the ground or mid-air to surge forward',
    'hint.doubleJump': 'Press {key} again in mid-air for a second jump',
    'hint.wallCling': 'Press into a wall and hold the direction — sliding slows your fall',
    'hint.groundSlam': 'In mid-air hold {key} to slam into the ground',
    'hint.airDive': 'In mid-air hold {key} + down for a swift dive',
    'hint.grapple': 'RMB to fire the grappling hook',
    'hint.glide': 'Hold {key} in mid-air to glide slowly',
    'hint.conjurePlatform': 'RMB to conjure a temporary platform beneath your feet',
    'hint.swap': 'RMB to instantly swap places with your partner',
    'hint.chargedDash': 'Hold {key} for a charged dash',
  }
}

class I18n {
  constructor() {
    // Язык хранится в общих настройках (l2s_settings) — единый источник правды.
    // Старый ключ l2s_lang оставлен как fallback для прежних сейвов.
    let lang = null
    try { lang = JSON.parse(localStorage.getItem('l2s_settings'))?.lang } catch {}
    this.lang = lang || localStorage.getItem('l2s_lang') || 'ru'
    this._listeners = []
  }

  t(key, params) {
    let s = T[this.lang]?.[key] ?? T.ru[key] ?? key
    if (params) for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, v)
    return s
  }

  setLang(lang) {
    this.lang = lang
    localStorage.setItem('l2s_lang', lang)
    this.applyDom()
    this._listeners.forEach(cb => cb(lang))
  }

  onChange(cb) {
    this._listeners.push(cb)
    return () => { this._listeners = this._listeners.filter(c => c !== cb) }
  }

  // Перевести все помеченные элементы страницы (включая динамически созданные:
  // applyDom зовётся при каждой смене языка, а элементы с data-i18n,
  // добавленные позже, переводятся в момент создания через t()).
  applyDom() {
    document.documentElement.lang = this.lang
    document.querySelectorAll('[data-i18n]').forEach(el => {
      el.textContent = this.t(el.dataset.i18n)
    })
    document.querySelectorAll('[data-i18n-ph]').forEach(el => {
      el.placeholder = this.t(el.dataset.i18nPh)
    })
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
      el.title = this.t(el.dataset.i18nTitle)
    })
  }
}

export const i18n = new I18n()

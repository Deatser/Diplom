# Left 2 Solve — Project Context

## Статус: В разработке
Дата: 2026-05-26 | Дедлайн: 4 дня

## Что сделано
- [x] Главное меню (Hollow Knight стиль, Cinzel, частицы, клавиатура+мышь)
- [x] Настройки (язык RU/EN, звук, видео, rebind клавиш, localStorage)
- [x] Лобби (список серверов, поиск, 4 слота сохранений, Socket.io live)
- [x] Level Select (аватары, карандашик переименования, lock/unlock)
- [x] Socket.io сервер (create/join/leave комнаты, auto-delete)
- [x] Phaser GameScene (движение, прыжок, дэш, коллизии, camera follow)
- [x] Player entity (WASD, dash, double jump, wall cling, ground slam, glide)
- [x] Network sync (state snapshot каждые 50ms)
- [x] Level 1 черновик (platforms, pressure plate + door, orb, exit)
- [x] Level 10 черновик (высокие платформы, вершина)
- [x] HUD (способности, кнопка выхода)

## Что дальше
- [ ] Улучшить Level 1: нормальный дизайн секций, туториал знаки
- [ ] AbilityOrb анимация получения (полноэкранный overlay)
- [ ] Pixel art ассеты (персонажи, тайлы, фон)
- [ ] Звуки (прыжок, дэш, orb)
- [ ] Level 10: все 10 механик в секциях

## Запуск
```
npm run dev → http://localhost:8080 (или :8081 если занят) + :3000 сервер
```

## Ключевые решения
- HTML/CSS меню, Phaser только для геймплея
- Network: каждый клиент шлёт своё состояние (x,y,flipX) каждые 50ms
- Server relays — не авторитетный, просто ретранслирует
- Способности: Set<string> на Player, проверяется в update()

## Стек
Vite 5 | Phaser 3.87 | Socket.io 4 | Node.js ESM

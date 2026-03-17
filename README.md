# note2cms Publisher

Плагин для публикации заметок в note2cms. Делает статический блог (GitHub Pages) и работает с Leapcell backend. Поддерживает Desktop и Android.

## Возможности
- Публикация текущей заметки и публикация любой заметки по команде
- Предпросмотр с кнопкой Publish для любой заметки
- Массовая публикация из папки Publish или по тегу `#publish`
- Автопубликация при изменении файлов (опционально)
- Очередь для оффлайн/WiFi-only и кнопка очистки очереди
- Перманентная ссылка после публикации + кнопка Copy Link
- Список опубликованных постов с поиском и удалением
- Подтверждение на мобильных

## Установка (локально)
1. `npm install`
2. `npm run build`
3. Скопируйте `main.js`, `manifest.json`, `styles.css` в `.obsidian/plugins/note2cms-publisher/`

## Настройка
1. Установи плагин
2. Перейди в Settings → note2cms Publisher
3. Введи API URL и Token из твоего Leapcell деплоя

## Команды
- Publish current note
- Publish current note (any)
- Preview note
- Bulk publish
- Manage published posts

## Примечания
- Для GitHub Pages деплоя на стороне note2cms требуется валидный `GITHUB_TOKEN` и `GITHUB_REPO`.
- Если включена проверка `title`, плагин автоматически добавляет `title` в frontmatter перед публикацией.

## Ссылки
- note2cms: https://github.com/mortalezz/note2cms

## License
MIT License


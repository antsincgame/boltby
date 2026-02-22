# MyBolt — AI-ассистент для веб-разработки

> Учебный проект школы **[vibecoding.by](https://vibecoding.by)**
> Преподаватель: **Дмитрий Орлов**

---

MyBolt — это AI-powered среда для full-stack веб-разработки прямо в браузере. Проект основан на [bolt.diy](https://github.com/stackblitz-labs/bolt.diy) и доработан в рамках учебного курса: интегрирован локальный бэкенд PocketBase, настроена работа с локальными LLM, проведена оптимизация и исправлены ошибки.

## Что умеет

- **Генерация полноценных веб-приложений** по текстовому описанию — HTML, CSS, JS, React, Node.js
- **Работа с любыми LLM** — OpenAI, Anthropic, Gemini, Groq, DeepSeek, Mistral, xAI, HuggingFace, OpenRouter, Cohere, Perplexity
- **Локальные модели без интернета** — Ollama, LM Studio (авто-запуск при старте)
- **PocketBase** как локальная база данных — авто-скачивание, авто-запуск, авто-создание superuser
- **Встроенный терминал** для просмотра вывода команд
- **Откат к предыдущим версиям** кода
- **Деплой** на Netlify и GitHub прямо из интерфейса
- **Git-клонирование** и импорт существующих проектов
- **Прикрепление изображений** к промптам
- **Улучшение промптов** через AI (кнопка "Enhance")
- **Экспорт проекта** как ZIP-архив

## Архитектура

```
Пользователь (браузер)
       |
   MyBolt UI (Remix + React)
       |
   ├── LLM Provider (облачный или локальный)
   │      ├── Ollama (localhost:11434)
   │      ├── LM Studio (localhost:1234)
   │      └── OpenAI / Anthropic / Gemini / ...
   │
   ├── WebContainer (среда исполнения в браузере)
   │      └── Node.js, npm, vite, ...
   │
   └── PocketBase (localhost:8090)
          ├── REST API
          ├── SQLite база данных
          ├── Авторизация
          └── Админ-панель (localhost:8090/_/)
```

## Быстрый старт

### Требования

- **Node.js** 18+ — [скачать](https://nodejs.org/)
- **pnpm** — менеджер пакетов

### Установка и запуск

```bash
# 1. Клонировать репозиторий
git clone https://github.com/antsincgame/boltby.git
cd boltby

# 2. Установить зависимости
npm install -g pnpm
pnpm install

# 3. Запустить (PocketBase скачается автоматически)
pnpm run dev
```

При первом запуске `pre-start.cjs` автоматически:
- Скачает PocketBase (если ещё не установлен)
- Создаст superuser `admin@bolt.local` / `boltadmin2024`
- Запустит PocketBase на порту 8090
- Попытается запустить LM Studio (если установлен)

Откройте **http://localhost:5173** в браузере.

### Настройка API-ключей

1. Откройте интерфейс MyBolt
2. Выберите провайдер из выпадающего списка
3. Нажмите иконку карандаша
4. Введите API-ключ

Для локальных моделей API-ключи не нужны — достаточно установить Ollama или LM Studio.

## PocketBase

PocketBase — это локальный бэкенд, работающий без интернета. MyBolt обучен автоматически генерировать код с PocketBase.

| Компонент | Адрес |
|-----------|-------|
| API | http://localhost:8090/api/ |
| Админ-панель | http://localhost:8090/_/ |
| Superuser | `admin@bolt.local` / `boltadmin2024` |

Когда вы просите MyBolt создать приложение с базой данных, он автоматически генерирует файл `pb-setup.js`, который создаёт нужные коллекции через API PocketBase.

## Работа с локальными моделями

### Ollama

```bash
# Установка
curl -fsSL https://ollama.ai/install.sh | sh

# Скачать модель
ollama pull qwen2.5-coder:14b

# Ollama запустится автоматически
```

### LM Studio

1. Скачайте [LM Studio](https://lmstudio.ai/)
2. Загрузите модель (рекомендуется Qwen 2.5 Coder 14B)
3. LM Studio стартует автоматически при запуске MyBolt

## Запуск через Docker

```bash
# Собрать образ
docker build . --target bolt-ai-development

# Запустить
docker compose --profile development up
```

## Скрипты

| Команда | Описание |
|---------|----------|
| `pnpm run dev` | Запуск dev-сервера |
| `pnpm run build` | Сборка проекта |
| `pnpm run preview` | Сборка + локальный запуск |
| `pnpm test` | Запуск тестов |
| `pnpm run typecheck` | Проверка типов TypeScript |
| `pnpm run lint:fix` | Автоисправление lint-ошибок |

## Что было сделано в рамках курса

- Полная миграция с Supabase на PocketBase (локальный, offline-first бэкенд)
- Авто-скачивание и авто-запуск PocketBase из `pre-start.cjs`
- Авто-создание superuser при первом запуске
- Обновление всех системных промптов для работы с PocketBase
- Инструкции для LLM по генерации `pb-setup.js` (авто-создание коллекций)
- Исправление SSRF-уязвимости в API route
- Исправление типизации в `message-parser.ts`
- Устранение race condition в health-check PocketBase
- Оптимизация O(n^2) -> O(n) в `AssistantMessage.tsx`
- Мемоизация React-компонентов (`useCallback`, `useMemo`)
- Стабилизация key в списке сообщений
- Настройка автозапуска LM Studio

## Структура проекта

```
MyBolt/
├── app/
│   ├── components/       # React-компоненты (чат, настройки, UI)
│   ├── lib/
│   │   ├── .server/      # Серверная логика (LLM stream)
│   │   ├── common/       # Системные промпты для LLM
│   │   ├── hooks/        # React-хуки
│   │   ├── modules/      # Провайдеры LLM
│   │   ├── persistence/  # Хранение чатов (IndexedDB)
│   │   ├── runtime/      # Парсер сообщений, исполнитель действий
│   │   └── stores/       # Nano-stores (pocketbase, workbench)
│   ├── routes/           # API endpoints (chat, enhancer, pocketbase)
│   └── types/            # TypeScript-типы
├── pre-start.cjs         # Авто-запуск PocketBase и LM Studio
├── .env.local            # API-ключи (не коммитится)
└── package.json
```

## Лицензия

Исходный код распространяется под лицензией MIT.

WebContainers API требует [отдельной лицензии](https://webcontainers.io/enterprise) для коммерческого использования.

---

Проект школы **[vibecoding.by](https://vibecoding.by)** | Преподаватель: **Дмитрий Орлов**

# Инструкция по развертыванию портфолио на GitHub Pages

## Шаги для размещения портфолио на GitHub Pages

### 1. Создание репозитория на GitHub

1. Войдите в свой аккаунт GitHub
2. Нажмите кнопку "New repository"
3. Назовите репозиторий: `oleg-tinkov.github.io` (замените на ваше имя пользователя)
4. Сделайте репозиторий публичным
5. Добавьте описание: "Data Science Portfolio - Тиньков Олег"
6. Нажмите "Create repository"

### 2. Загрузка файлов

1. Склонируйте репозиторий на локальный компьютер:
   ```bash
   git clone https://github.com/oleg-tinkov/oleg-tinkov.github.io.git
   cd oleg-tinkov.github.io
   ```

2. Скопируйте все файлы из папки `TOV_portfolio` в корень репозитория

3. Добавьте файлы в Git:
   ```bash
   git add .
   git commit -m "Initial portfolio setup"
   git push origin main
   ```

### 3. Настройка GitHub Pages

1. Перейдите в настройки репозитория (Settings)
2. Найдите раздел "Pages" в левом меню
3. В разделе "Source" выберите "Deploy from a branch"
4. Выберите ветку "main" и папку "/ (root)"
5. Нажмите "Save"

### 4. Ожидание развертывания

- GitHub Pages автоматически развернет ваш сайт
- Обычно это занимает 5-10 минут
- Ваш сайт будет доступен по адресу: `https://oleg-tinkov.github.io`

### 5. Обновление контента

Для обновления портфолио:

1. Внесите изменения в файлы
2. Зафиксируйте изменения:
   ```bash
   git add .
   git commit -m "Update portfolio content"
   git push origin main
   ```

3. GitHub Pages автоматически обновит сайт

## Настройка Google Analytics (опционально)

1. Создайте аккаунт Google Analytics
2. Получите Tracking ID (формат: G-XXXXXXXXXX)
3. В файле `index.html` раскомментируйте блок Google Analytics
4. Замените `G-XXXXXXXXXX` на ваш Tracking ID

## Настройка домена (опционально)

Если у вас есть собственный домен:

1. Создайте файл `CNAME` в корне репозитория
2. Добавьте в него ваш домен (например: `oleg-tinkov.com`)
3. Настройте DNS записи у вашего провайдера домена

## Структура файлов

```
oleg-tinkov.github.io/
├── index.html              # Главная страница
├── css/                    # Стили
│   ├── style.css
│   └── skins/             # Цветовые схемы
├── js/                     # JavaScript файлы
│   ├── script.js
│   └── style-switcher.js
├── img/                    # Изображения
│   ├── hero.jpg           # Фото профиля
│   ├── portfolio/         # Изображения проектов
│   └── certificate/       # Сертификаты
├── doc/                    # Документы (резюме)
├── README.md              # Описание проекта
├── _config.yml            # Конфигурация Jekyll
├── .gitignore             # Игнорируемые файлы
└── DEPLOYMENT.md          # Эта инструкция
```

## Полезные ссылки

- [GitHub Pages Documentation](https://docs.github.com/en/pages)
- [Jekyll Documentation](https://jekyllrb.com/docs/)
- [Google Analytics](https://analytics.google.com/)

## Поддержка

Если у вас возникли проблемы с развертыванием, проверьте:

1. Правильность названия репозитория (должно быть `username.github.io`)
2. Настройки GitHub Pages в разделе Settings
3. Логи развертывания в разделе Actions
4. Корректность путей к файлам в HTML

---

*Удачного развертывания вашего портфолио!*


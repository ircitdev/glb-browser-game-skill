# Matrix-Game 4.0 на видеокарте с 24 ГБ

[Matrix-Game 4.0](https://github.com/SkyworkAI/Matrix-Game) перерисовывает low-poly-кадры настоящего игрового движка в детальную картинку. Проверено 08.11.2026 на RTX 3090, Windows 11, Docker Desktop.

## Что получилось

- Офлайн-рендер записанного прохода работает: 480 кадров, 864×480.
- Скорость: 0,3 кадра в секунду в среднем, 1,28 на лучшем участке. Карту в этот момент занимали другие задачи, чистого замера нет. Авторы приводят около 38 FPS на A100.
- Браузерный режим здесь не запускался: ему нужен аппаратный OpenGL в контейнере, а под Docker Desktop на Windows его нет.
- Геометрия окружения на выходе заметно отличалась от low-poly. Персонаж держался на месте. Причину не выяснили, проверено на четырёх кадрах.

## Запуск

Инференс заявлен только под Linux, поэтому нужен контейнер. Dockerfile лежит в `assets/matrix-game/`.

1. Соберите образ и поднимите контейнер с `--gpus all` и томом Docker. Репозиторий клонируйте внутри контейнера: при клоне на Windows скрипты могут получить CRLF.
2. Поставьте пакет: `pip install --no-deps -e .` из `Matrix-Game-4/`.
3. Скачайте одну сцену, это около 25 ГБ: команды `matrix-game download` из README проекта.
4. Соберите игру: `bash scripts/build_game.sh`.
5. Запишите проход без управления руками: авторский режим сам идёт, стреляет и поворачивает камеру.

```bash
LIBGL_ALWAYS_SOFTWARE=1 MATRIX_GAME_DATA_DIR=$PWD/resources/game SDL_AUDIODRIVER=dummy \
  xvfb-run -a -s "-screen 0 1280x720x24 +extension GLX" \
  game/bin/MedievalCastleBBoxMap --offline-test --scene ancient-egypt --no-audio --offline-dir /takes
```

6. Отрендерите первый дубль: `matrix-game render --take <take-1> --resources resources --preset realtime --prompt-mode fixed --output out`.

## Что нужно поправить

- **Нет пресета под RTX 30xx.** Берите `realtime`: он сделан под A100 той же архитектуры Ampere. Пресеты RTX 50xx завязаны на FP8 и не подходят.
- **В 24 ГБ не помещаются основная модель и T5 разом.** В `matrix_game/inference/loader.py`, в ветке `else`, перед `build_dit` закодируйте фиксированный промпт, чтобы T5 выгрузился раньше:

```python
if self.args.prompt_mode != "dynamic":
    self.prompt = self._encode_fixed_prompt(device, dtype)
```

- **`python3-dev` обязателен.** Без него Triton падает на компиляции `cuda_utils`, причём только при первом запуске модели. В приложенном Dockerfile пакет уже есть.
- **Перед замером освободите карту.** Другие процессы на GPU замедляют рендер в разы.

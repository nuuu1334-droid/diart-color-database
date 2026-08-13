# Аудит DiArt Color Engine

Никакие файлы не изменялись. Ниже — результат статического разбора `color_engine.js` (4218 строк) и всех JSON-модулей репозитория `diart-color-database`.

---

## 1. Current architecture

Загрузчик (`loadConfig()`, строки 53–89) работает так:

1. Тянет `manifest.json` с `baseUrl` (по умолчанию `raw.githubusercontent.com/.../main`).
2. Из `manifest.modules` + `entrypoint` формирует список файлов и грузит их через `fetchJson` (обязательные — падение = исключение).
3. **Дополнительно**, в обход manifest, пытается подгрузить ещё два файла напрямую по хардкоженным именам через `fetchOptionalJson` (тихо проглатывает ошибку → `null`).
4. Все части `Object.assign`-ятся в один плоский `config`.

Дальше пайплайн строго последовательный и синхронный по данным:

`adaptExtractor` → `calculateEvidenceReliability` → `calculateTemperature` → `stabilizeTemperatureResult` → `calculateValue` → `calculateChroma` → `calculateContrast` → `runScoring` (`baseScore` по каждому из 12 сезонов → `applyCrossRules` → `applyExclusions` → `applyCoreTraitGuards` → `resolveConfusion` → `finalConfidence`) → финальный `season_selection`.

---

## 2. Active files (реально используются рантаймом)

Через `manifest.json` (12 модулей + `engine.json` entrypoint) — **13 файлов**, все реально грузятся и участвуют в расчёте:
`engine.json, quality.json, feature_extraction.json, temperature.json, value.json, chroma.json, contrast.json, season_scoring.json, confusion_resolution.json, season_selection.json, confidence.json, exclusions.json, evidence_reliability.json`.

---

## 3. Dead / legacy / suspicious files — **критическая находка**

Это не домыслы по именам — подтверждено кодом.

В `loadConfig()` (строки 64–67) захардкожен отдельный, **не связанный с manifest.json** список:

```js
const optionalFiles = [
  "reliability_engine_v2.json",
  "confidence_engine_v2.json"
];
```

Но в репозитории эти файлы называются **`reliability_engine_v2_1.json`** и **`confidence_engine_v2_2.json`**. `fetchOptionalJson` при HTTP 404 просто возвращает `null` и ошибка нигде не логируется и не пробрасывается наружу.

Итог: `config.reliability_engine_v2` и `config.confidence_engine_v2` **всегда `undefined`** в текущем рантайме. Все обращения к ним в коде (строки 565, 650, 713, 1386, 1660, 2055, 3634) уходят на fallback `|| {}` / `??`-дефолты, зашитые прямо в JS.

Что реально теряется:
- `reliability_engine_v2_1.json`: калиброванные веса надёжности источников по измерениям (`dimension_source_weights` для temperature/value/chroma/contrast), `hair_distortion` веса, `overall_impression_multiplier: 0.25`.
- `confidence_engine_v2_2.json`: веса confidence (`gap_score 0.4, dimension_score 0.25, coverage_score 0.2, consistency_score 0.15`), `gap_curve`, уровни `very_high/high/medium/low`, штрафы (`poor_photo_quality: 0.12` и др.).

Это значит: **половина той калибровки, которую вы, возможно, уже правили в этих JSON, физически не влияет на продакшн-результат.** Это прямая причина части «необъяснимой» нестабильности — вы меняли числа, которые не подключены.

`diart_color_database_v1.json`, `diart_color_database_v2.json`, `diart_color_engine_v2.1.json` — не упомянуты нигде в `manifest.json` и нигде не запрашиваются `color_engine.js`. Это чистые legacy-файлы, runtime их не касается.

---

## 4. Critical findings

**P0-1. Названия файлов "reliability_engine_v2" / "confidence_engine_v2" не совпадают с массивом `optionalFiles` в коде** (см. §3). Два калибровочных модуля молча не грузятся.

**P0-2. Hard exclusion — цельная обрубающая логика.** В `applyExclusions` (строка 3230–3232):
```js
if (qualifies) { hard[season] = true; adjusted[season] = 0; ... }
```
`qualifies` включается, если хотя бы одно evidence имеет `confidence >= 0.75`, либо два независимых измерения дают `confidence >= 0.60`. При срабатывании сезон получает **score = 0** и полностью выпадает из ранжирования. Разница между двумя фото в 0.01 confidence экстрактора (0.74 против 0.75) переключает сезон из состояния «слегка оштрафован» в «полностью исключён». Это самый резкий cliff во всей системе и прямой кандидат на объяснение «Top-1 неожиданно перескочил на далёкий сезон».

**P0-3. Дискретный гейт `confidenceEligible` в `baseScore`** (строки 2896–2914): если `rawConfidence` измерения ниже `minimum_dimension_confidence` (0.4 из `season_scoring.json`), измерение целиком выключается из скоринга (`usable=false`), а не плавно уменьшает вес. Переход 0.399→0.401 — это переход «измерение не участвует» → «участвует с полным эффективным весом», а не плавная интерполяция.

**P1-4. Два независимых источника «качества фото».** `adaptExtractor` строит `overall_quality`/`continue_analysis` из `ex.image_quality?.status` и `ex.analysis_status` (строка 199–200), но отдельно есть top-level `input.quality` (строгая схема, `engine.json`), которое читается напрямую в `applyExclusions` (`features?.quality?.continue_analysis`, строка 3186) и ещё в 3 местах (3991, 4038, 4133). Если GPT-экстрактор на двух фото немного по-разному заполняет эти два поля (расхождение между `image_quality.status` и `quality.continue_analysis`), пайплайн может вести себя непоследовательно — часть проверок смотрит на выведенное значение, часть на входное.

---

## 5. Temperature findings

`calculateTemperature` (793–1060) собирает голоса из skin/eyes/hair/lips/eyebrows/overall_impression с весами `dimension_source_weights` — веса *должны* приходить из `reliability_engine_v2_1.json`, но фактически берутся из JS-дефолтов внутри функции (см. P0-1). Дальше идёт `stabilizeTemperatureResult` (1061–1243) — отдельный шаг «стабилизации», само существование которого говорит, что авторы уже боролись с шумностью «сырого» temperature-голосования постфактум, а не устранили её в источнике. Итоговая классификация берётся через `ordered = Object.entries(scores).sort(...)` (1416) — детерминировано, но конкурирующие top1/top2 с близким счётом («majority» на грани) — это то место, где `uncertainOppositePenalty` (2975+) и `mixed`-детектор (light+deep одновременно ≥25 при medium≥30) пытаются гасить конфликтующие evidence постфактум, а не через понижение веса на входе.

## 6. Value findings

`calculateValue` (1244–1491) структурно зеркалит temperature: majority/weighting поверх skin/eyes/hair с overall_impression в качестве догруза. `valueDominanceStrength` (3061) отдельно используется в exclusions/penalties как модификатор силы штрафа при «экстремальных» value-условиях (светлая кожа vs тёмные волосы и т.п.) — сама эта логика существует именно из-за пограничных конфликтов кожи/волос/глаз, упомянутых в ТЗ.

## 7. Chroma findings

`calculateChroma` (1492–1890) использует `normalizeClarity`/`chromaToSkinHair` мэппинги (113–118) — обратите внимание, что `bright` и `very_clear` **оба** схлопываются в `sparkling`, а `muted`↔`soft` в chroma→skin/hair мэппинге оба схлопываются в `muted`. Это осознанная огрубляющая нормализация, но она означает, что довольно разные по силе сырые ответы экстрактора (`clear` vs `bright` vs `very_clear`) на входе в матчинг сезона иногда неотличимы, а иногда — нет (`clear`→`clear`, но `bright`→`sparkling`), что создаёт несимметричные разрывы в классе «clear/bright».

## 8. Contrast findings

`calculateContrast` (1891–2195) отдельно взвешивает skin/hair, skin/eyes, hair/eyes пары и сворачивает в `low/medium/high` через `collapseContrast` (100–105) — сама функция коллапса тоже трёхступенчатая (five raw levels → 3 bucket), т.е. ещё один явный дискретизирующий шаг перед скорингом сезона.

## 9. Season scoring findings

Подтверждённая формула (`season_scoring.json → scoring_algorithm`):

```
dimension_points = dimension_weight * match_value * dimension_confidence
base_score = 100 * Σ(available_dimension_points) / Σ(available_dimension_weight * confidence)
```
Веса измерений: `temperature 0.30, value 0.25, chroma 0.25, contrast 0.20`.
`match_value`: `exact 1.0 / accepted 0.75 / adjacent 0.4 / opposite 0.0` — тоже дискретная шкала без промежуточных значений, что для «соседних» сезонов (Deep Autumn/True Autumn, True Summer/Soft Summer и т.п., перечисленных в ТЗ) означает: небольшая разница в наблюдаемом chroma/value может перебросить `match_value` сразу с 0.75 на 0.4, т.е. скачком -0.35 на всю дименсию.
`minimum_dimension_confidence = 0.4`, `minimum_available_dimension_weight = 0.45` (реально подгружены, это не сломанный модуль).

`confusion_resolution.json` активируется только при `top_two_score_gap_max: 8` и `top_two_confidence_min: 0.45` — ещё один порог с cliff-эффектом на границе (gap=7.9 запускает разрешение конфликта дополнительными evidence-правилами, gap=8.1 — нет, и Top-1 определяется чистым скорингом). Для запрошенных пар (Light Spring/Light Summer подтверждена явным правилом с осями `temperature` как primary и `chroma`+`feature_blending` как secondary; остальные пары, вероятно, устроены аналогично — не выгружал каждую подробно, но структура одна на все пары).

## 10. Confidence findings

Реальный источник итогового confidence — весь блок `finalConfidence` (3633–3938) читает `settings = config.confidence_engine_v2 || {}`, который **всегда пуст** (§3, P0-1). Это значит, что формула confidence, которую видно в `confidence_engine_v2_2.json` (`gap_score 0.4 + dimension_score 0.25 + coverage_score 0.2 + consistency_score 0.15`, `gap_curve`, `penalties.poor_photo_quality 0.12` и т.д.) **не действует** — реально работают запасные константы, зашитые в JS (нужно смотреть их отдельно, но по коду видно fallback вида `settings.penalties?.poor_photo_quality ?? 0.12`, то есть *в данном конкретном случае* дефолт JS совпадает с JSON — но не факт, что это так для всех веток; `weights`, `gap_curve`, `levels` не имеют fallback в показанных строках и потенциально просто отсутствуют/равны `undefined`, что стоит проверить точечно перед калибровкой).

Математически: confidence — это комбинация (a) разрыва top1/top2 (gap), (b) confidence самого выигравшего измерения, (c) coverage evidence, (d) штрафов за конфликты/плохое качество. То есть это **не** «насколько большой score», а честная попытка оценить устойчивость Top-1 — конструкция в целом правильная. Проблема не в формуле, а в том, что калибровочные веса этой формулы не долетают из JSON (см. P0-1).

## 11. Stability findings — сведение гипотез из §5 ТЗ

| Гипотеза | Подтверждена в коде? | Где |
|---|---|---|
| Слишком резкие thresholds | ✅ Да | `hard_exclusions` (score→0), `minimum_dimension_confidence` (0.4 cliff), `match_value` (0.75→0.4 ступень), confusion trigger `gap_max=8` |
| Неиспользуемые конфиги влияют на нестабильность | ✅ Да, косвенно — калибровка не работает, значит вы правите файлы без эффекта, и стабилизация «на глаз» невозможна | reliability_engine_v2 / confidence_engine_v2 |
| Каскадное усиление ошибки | ✅ Вероятно | `stabilizeTemperatureResult`, `uncertainOppositePenalty`, `valueDominanceStrength` — многослойные постфактум-компенсации поверх уже дискретизированных данных |
| Двойной учёт evidence | ⚠️ Не подтверждено явно, нужен отдельный проход по `dimension_source_weights` пересечений — не исключаю, но не нашёл прямого дублирования в разобранных функциях |
| Random logic / недетерминизм | ❌ Не найдено. `Math.random`, `Date.now` отсутствуют. Все `.sort()` — либо с явным tie-break (`localeCompare`), либо на стабильном порядке `Object.entries` (V8 сохраняет порядок вставки для строковых ключей) — при идентичном JSON-входе результат должен быть идентичен |
| Confidence считается из score, а не из уверенности | ⚠️ Частично — конструкция в `confidence.json`/`confidence_engine_v2_2.json` правильная (gap+coverage+consistency), но фактически не подключена (см. выше) |

---

## 12. JS vs JSON

- **JS LOGIC** (нужно трогать `color_engine.js`):
  - P0-1: исправить список `optionalFiles` (строки 65–66) — привести имена к реальным файлам, либо (правильнее) добавить их в `manifest.json` как обязательные модули и убрать отдельный silent-optional механизм полностью.
  - P0-2/P0-3: сгладить cliff-переходы (`hard_exclusions`, `confidenceEligible`) — заменить бинарные пороги на непрерывные функции (сигмоида/линейная рампа вокруг порога), это уже алгоритмическое изменение.
  - Убрать/объединить дублирующийся источник quality (`adaptExtractor`-derived vs top-level `input.quality`) — выбрать один источник истины.

- **CONFIG CALIBRATION** (JSON):
  - Переименовать `reliability_engine_v2_1.json`→`reliability_engine_v2.json` и `confidence_engine_v2_2.json`→`confidence_engine_v2.json` (самый быстрый P0-фикс, но временный костыль — версионирование в имени теряется).
  - Ширина ступеней `match_value` (`exact/accepted/adjacent/opposite`) — можно перейти на непрерывную функцию через JSON без изменения JS, если сама формула в JS уже параметризована (частично — сейчас она не непрерывная по устройству, значит потребуется и JS-правка).
  - Penalty scale, hard/strong exclusion пороги в `exclusions.json` — калибруемо через JSON.

- **DATASET CALIBRATION**: нужен regression-набор (см. §14) для проверки, что после сглаживания cliffs Top-1 не начинает «плавать» в другую сторону.

- **EXTRACTOR ISSUE**: вне зоны этого аудита (см. §8 ТЗ — сознательно не анализировал).

---

## 13. Recommended calibration architecture

После того как P0-1/P0-2/P0-3 закрыты и cliffs сглажены, дальнейшая калибровка **должна** быть в основном через JSON, потому что:
- веса измерений, `match_value`, пороги confidence, exclusion severity — всё уже вынесено в JSON-модули;
- единственное, что требует правки JS — сама *форма* функций (дискретная ступень → непрерывная кривая). Это разовая работа.

Рекомендация: после стабилизации ввести в JS универсальные параметризуемые «ramp»-функции (например, `smoothstep(confidence, low, high)` вместо бинарного `if confidence >= min`), параметры `low/high` брать из JSON. Тогда 95% дальнейшей калибровки — это правка чисел в JSON, а JS трогается только при появлении новой категории логики.

---

## 14. Regression test proposal

Структура: `person_XX/photo_YY.json` (уже нормализованный extractor-output) → прогон через `runScoring` → фиксация `season_ranking`, `dimension_results`, `confidence`.

Метрики и предлагаемые пороги:
- **Top-1 accuracy** (против эталонной разметки человека-колориста): ≥ 90% на «чистых», не-пограничных кейсах.
- **Top-2 accuracy** (эталон в top-2): ≥ 97%.
- **Same-person consistency**: для 3+ фото одного человека при сопоставимом качестве — Top-1 должен совпадать в ≥ 2 из 3 фото; допустимо расхождение только в *соседний* сезон (по списку смежности из §4 ТЗ), никогда — «через сезон» (например Light Spring не должен всплывать у True Winter персоны).
- **Dimension variance**: std между фото одного человека по каждому dimension score ≤ 8 пунктов (по 0–100 шкале).
- **Season switching rate**: доля пар фото одного человека, где Top-1 сменился на несмежный сезон — цель < 5%.
- **Confidence calibration**: bucket-калибровка — среди случаев с заявленным confidence "high/very_high" реальная Top-1-точность должна быть ≥ заявленному порогу (`levels.high=0.71` → фактическая точность в этом бакете ≥ 71%).
- **Boundary-case accuracy**: отдельный подсет специально пограничных фото (заранее размеченных как «между X и Y») — здесь допустима любая из двух меток, но не третья.

---

## 15. Prioritized action plan

**P0**
1. Исправить рассинхронизацию имён `reliability_engine_v2.json` / `confidence_engine_v2.json` ↔ файлы в репо (§3) — без этого никакая дальнейшая калибровка confidence/reliability не имеет смысла, вы правите мёртвый код.
2. Сгладить `hard_exclusions` (score→0 скачком) в `applyExclusions` — заменить на плавную функцию от confidence evidence.
3. Сгладить `confidenceEligible` cliff в `baseScore` (порог `minimum_dimension_confidence`).
4. Собрать regression-dataset (§14) ДО дальнейших правок — иначе нечем будет проверить эффект P0.1–P0.3.

**P1**
5. Устранить дублирование quality-сигнала (`adaptExtractor`-derived vs top-level `input.quality`).
6. Пересмотреть ступенчатость `match_value` (exact/accepted/adjacent/opposite) на непрерывность.
7. Проверить точечно, действительно ли `finalConfidence` имеет безопасные fallback для ВСЕХ полей `confidence_engine_v2` (не только `poor_photo_quality`), после фикса P0.1 — если нет, риск, что подключение реального конфига само по себе резко сдвинет все confidence-числа.
8. Проверить `confusion_resolution.json` gap-порог (=8) на предмет собственного cliff-эффекта.

**P2**
9. Унификация мэппингов `normalizeClarity`/`chromaToSkinHair` (несимметричное схлопывание bright/very_clear vs muted/soft).
10. Логирование факта, когда `fetchOptionalJson` возвращает `null` — сейчас ошибки конфигурации проглатываются молча, что и стало причиной P0-1 оставаться незамеченной.

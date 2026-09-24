/**
 * ============================================================================
 *  БПЛА: система управления дронами-камикадзе — Rocket_BP/scripts/main.js
 * ============================================================================
 *  Script API: @minecraft/server 1.16.0 + @minecraft/server-ui 1.3.0
 *  (Minecraft Bedrock 1.21.50+). Используются только стабильные API ветки 1.x
 *  (Entity.isValid() здесь — метод, ModalFormData — позиционные аргументы).
 *  Версия 1.16.0 нужна из-за событий playerInteractWithBlock/Entity:
 *  в 1.13–1.15 их нет в стабильном API.
 *
 *  Модули файла (порядок совпадает с порядком в коде):
 *   §0  Конфигурация
 *   §1  Утилиты: векторы, углы, безопасные вызовы, JSON-хранилища
 *   §2  Каталог дронов: полёт, звук, взрыв, положение на направляющей ПУ
 *   §3  Хранилища: шаблоны (мир), план маршрута, архив без дублей, настройки залпа, вид карты
 *   §4  Менеджер зон тиков (tickingarea): создание, следование, удаление, очистка
 *   §5  Эффекты: частицы, дым, вспышка, взрыв, звук двигателей
 *   §6  Коллизии с блоками (AABB, общий модуль для дронов и обломков)
 *   §7  Реестр дронов и полётный контроллер (путевые точки, пикирование, подрыв)
 *   §8  Пусковые установки: 1 ПУ = 1 дрон, батарея, залп (интервал, строй, разброс)
 *   §9  UI-планшет: пуск, редактор маршрута, тактическая карта с осями, активные дроны
 *   §10 Ввод игрока: зарядка ПУ, пульты, клики по ПУ и дронам
 *   §11 Физика обломков (debris)
 *   §12 Палуба и твёрдые части моделей (игрок может стоять на дроне)
 *   §13 Инициализация: очистка зон тиков после перезагрузки, запуск циклов
 *
 *  Как пользоваться (коротко):
 *   1. Поставьте пусковые установки (ПУ) и зарядите каждую: нажмите по ПУ
 *      предметом дрона. Одна ПУ вмещает один дрон.
 *   2. «Пульт цели» / «Пульт архива маршрутов» — это планшет. ПКМ в воздух
 *      открывает меню. В «Маршрут и цель» на тактической карте ставятся
 *      конечная цель и путевые точки. ПКМ планшетом по блоку сразу делает
 *      его целью (с Shift — без открытия меню).
 *   3. «Пуск»: планшет находит готовые ПУ рядом (батарею). Ползунок 1..N
 *      выбирает число дронов. Для залпа задаются интервал между пусками,
 *      строй в полёте (колонна / шеренга / клин) и разброс точек удара
 *      (0 — все в одну точку). Дроны стартуют со своих ПУ по очереди.
 *   4. «Пульт маршрута»: ПКМ по блоку добавляет путевую точку
 *      (на CONFIG.WAYPOINT_ALT блоков выше блока).
 *   5. Служебные команды: /scriptevent bpla:areas (статус зон тиков),
 *      /scriptevent bpla:cleanup (удалить зоны дронов, которые больше не летят).
 * ============================================================================
 */

import { world, system, GameMode, ItemStack } from "@minecraft/server";
import { ActionFormData, ModalFormData, FormCancelationReason } from "@minecraft/server-ui";

// ============================================================================
// §0  КОНФИГУРАЦИЯ
// ============================================================================
// Все игровые константы собраны здесь, чтобы их можно было настроить
// без правки логики.
const CONFIG = {
  // --- Пусковые установки и пуск ------------------------------------------
  BATTERY_RADIUS: 96, // радиус, в котором планшет ищет ПУ игрока (батарею)
  SALVO_INTERVAL: 18, // интервал между пусками по умолчанию, тиков (меняется ползунком в форме пуска)
  SALVO_INTERVAL_MAX: 100, // предел ползунка интервала, тиков (20 тиков = 1 секунда)
  FORMATION_SPACING: 6, // расстояние между соседними трассами в строю «шеренга»/«клин», блоков
  SPREAD_MAX: 20, // предел ползунка «Разброс точек удара», блоков
  CONSUME_IN_CREATIVE: false, // списывать предмет дрона при зарядке ПУ и в творческом режиме
  DEFAULT_ECHELON: 120, // высота эшелона (абсолютный Y) по умолчанию
  ECHELON_MIN: 80, // пределы ползунка «Высота эшелона»
  ECHELON_MAX: 220,
  WAYPOINT_ALT: 30, // «Пульт маршрута»: высота точки над блоком (как в оригинале)
  MAX_WAYPOINTS: 8, // максимум путевых точек в маршруте
  MAX_RANGE: 4000, // максимальная горизонтальная дальность цели от игрока

  // --- Полёт --------------------------------------------------------------
  SPEED_MULT: 1.0, // общий множитель скорости всех дронов
  ARRIVE_RADIUS: 1.5, // подрыв при сближении с целью ближе этого расстояния
  WAYPOINT_RADIUS: 4, // радиус захвата путевой точки (ТЗ: 3–5 блоков)
  TERRAIN_RESOLVE_RANGE: 48, // на этой дистанции высота цели «по рельефу» уточняется заново
  CRUISE_MAX_PITCH: 25, // предельный тангаж на марше, градусов
  ALT_HOLD_BASE: 40, // база удержания высоты на марше: ошибка высоты / база = желаемый наклон
  TERMINAL_RANGE: 26, // с этой горизонтальной дистанции начинается пикирование...
  TERMINAL_BLEND: 12, // ...и за столько блоков доходит до чистого наведения на цель
  LAUNCHER_BLOCK_GRACE: 60, // тиков без проверки блоков после схода с ПУ
  FREE_LAUNCH_BLOCK_GRACE: 12, // то же для дрона, стоящего не на ПУ (старые миры)
  ENTITY_COLLISION_GRACE: 30, // тиков без проверки столкновения с существами
  ENTITY_HIT_RADIUS: 1.8, // радиус контактного подрыва о игрока/моба
  RESYNC_DISTANCE: 4, // если дрон сдвинули извне дальше этого — берём его позицию
  SHOW_WAYPOINT_MARKER: true, // огонёк в текущей точке маршрута (как в оригинале)

  // --- Зоны тиков (tickingarea) -------------------------------------------
  AREA_RADIUS_CHUNKS: 2, // радиус круговой зоны в чанках (как в ТЗ: «... 2 drone_<id>»)
  AREA_LEAD_BLOCKS: 8, // центр зоны смещается вперёд по курсу, чтобы чанки грузились заранее
  AREA_RECENTER_DIST: 10, // перенос зоны, когда идеальный центр ушёл дальше этого
  AREA_CHECK_INTERVAL: 5, // как часто (в тиках) проверять положение зоны
  AREA_RETRY_INTERVAL: 100, // повтор попытки создать зону при исчерпании лимита
  MAX_DRONE_AREAS: 9, // лимит мира — 10 зон; одну оставляем игрокам/другим аддонам
  AREA_HOUSEKEEPING_INTERVAL: 200, // периодическая уборка «осиротевших» зон

  // --- Тактическая карта --------------------------------------------------
  MAP_ZOOMS: [5, 10, 25, 50, 100, 200], // масштабы: блоков в одной клетке
  MAP_DEFAULT_ZOOM: 2, // индекс масштаба по умолчанию (25 блоков)
  MAP_PAN_CELLS: 4, // сдвиг карты кнопками сторон света, клеток
  MAP_AXES: true, // схема осей координат (±X, ±Z) справа от карты

  // --- Шаблоны и UI -------------------------------------------------------
  MAX_PRESETS: 40,
  PRESET_NAME_MAX: 32,
  MAX_ROUTE_HISTORY: 15,
  ONLY_OWNER_CAN_CONTROL: false, // true: коррекция и подрыв только своих дронов
  MAX_SMOKE_COLUMNS: 24, // ограничение одновременно дымящих воронок
};

/** Предметы, которые работают как планшет управления. */
const TABLET_ITEMS = new Set(["bpla:remote_target", "bpla:remote_orange"]);
const WAYPOINT_ITEM = "bpla:remote_waypoint";
const PLAYER_TYPE = "minecraft:player";

// ============================================================================
// §1  УТИЛИТЫ
// ============================================================================

const DIMENSIONS = ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"];
const DIM_NAMES = {
  "minecraft:overworld": "Верхний мир",
  "minecraft:nether": "Незер",
  "minecraft:the_end": "Энд",
};
const DIM_FALLBACK_LIMITS = {
  "minecraft:overworld": [-64, 320],
  "minecraft:nether": [0, 128],
  "minecraft:the_end": [0, 256],
};
const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const clamp01 = (v) => clamp(v, 0, 1);
const lerp = (a, b, t) => a + (b - a) * t;
/** Приводит угол к диапазону [-180, 180). */
const wrap180 = (a) => ((((a + 180) % 360) + 360) % 360) - 180;
/** Интерполяция угла по кратчайшей дуге. */
const lerpAngle = (a, b, t) => a + wrap180(b - a) * t;
const smoothstep = (t) => t * t * (3 - 2 * t);

const vcopy = (p) => ({ x: p.x, y: p.y, z: p.z });
const vadd = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const vscale = (a, k) => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const vlen = (a) => Math.hypot(a.x, a.y, a.z);
const vdist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const hdist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const vnorm = (a) => {
  const l = vlen(a);
  return l > 1e-9 ? { x: a.x / l, y: a.y / l, z: a.z / l } : { x: 0, y: 0, z: 1 };
};
const floorPoint = (p) => ({ x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) });
const roundPoint = (p) => ({
  x: Math.round(p.x * 100) / 100,
  y: Math.round(p.y * 100) / 100,
  z: Math.round(p.z * 100) / 100,
});
const fmtPos = (p) => `${Math.floor(p.x)} ${Math.floor(p.y)} ${Math.floor(p.z)}`;

/**
 * Единичный вектор взгляда по углам Minecraft.
 * yaw 0 = юг (+Z), yaw 90 = запад (-X); положительный pitch = нос вниз.
 */
function forwardFromRotation(yaw, pitch) {
  const ry = yaw * RAD,
    rp = pitch * RAD,
    cp = Math.cos(rp);
  return { x: -Math.sin(ry) * cp, y: -Math.sin(rp), z: Math.cos(ry) * cp };
}

/** Проверка сущности без исключений: в 1.x isValid() — метод. */
function isValid(entity) {
  try {
    return !!entity && entity.isValid();
  } catch {
    return false;
  }
}

/** Выполняет fn и возвращает fallback, если fn бросила исключение. */
function safe(fn, fallback) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function logError(where, err) {
  try {
    console.warn(`[БПЛА] ${where}: ${err && err.stack ? err.stack : err}`);
  } catch {}
}

/** Читает JSON из динамического свойства (мира, игрока или сущности). */
function readJSON(holder, key, fallback) {
  try {
    const raw = holder.getDynamicProperty(key);
    if (typeof raw !== "string" || raw.length === 0) return fallback;
    const val = JSON.parse(raw);
    return val === null || val === undefined ? fallback : val;
  } catch {
    return fallback;
  }
}

/** Пишет JSON в динамическое свойство; undefined удаляет свойство. */
function writeJSON(holder, key, value) {
  try {
    holder.setDynamicProperty(key, value === undefined ? undefined : JSON.stringify(value));
    return true;
  } catch (err) {
    logError(`writeJSON(${key})`, err);
    return false;
  }
}

function getDP(holder, key) {
  return safe(() => holder.getDynamicProperty(key), undefined);
}

function setDP(holder, key, value) {
  try {
    holder.setDynamicProperty(key, value);
  } catch {}
}

function msg(player, text) {
  try {
    if (isValid(player)) player.sendMessage(text);
  } catch {}
}

function findPlayerByName(name) {
  if (!name) return undefined;
  return world.getAllPlayers().find((p) => p.name === name);
}

/** Границы высоты измерения [min, max) с кэшем: вызывается каждый тик для каждого дрона. */
const DIM_LIMITS_CACHE = new Map();
function dimLimits(dimId) {
  let lim = DIM_LIMITS_CACHE.get(dimId);
  if (lim) return lim;
  lim = DIM_FALLBACK_LIMITS[dimId] ?? [-64, 320];
  try {
    const r = world.getDimension(dimId).heightRange;
    if (r && typeof r.min === "number") lim = [r.min, r.max];
  } catch {}
  DIM_LIMITS_CACHE.set(dimId, lim);
  return lim;
}

function dimName(dimId) {
  return DIM_NAMES[dimId] ?? dimId;
}

function isPoint(p) {
  return !!p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
}

/** Детерминированный хэш строки: нужен, чтобы разнести работу дронов по разным тикам. */
function hashString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/**
 * Разбор одной координаты. Понимает абсолютные значения ("120", "-3.5")
 * и относительные от позиции игрока ("~", "~10", "~-4").
 */
function parseCoordinate(raw, base) {
  const s = String(raw ?? "")
    .trim()
    .replace(",", ".");
  if (!s) return NaN;
  if (s[0] === "~") {
    const rest = s.slice(1);
    if (!rest) return base;
    const d = Number(rest);
    return Number.isFinite(d) ? base + d : NaN;
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/** Дата в виде ДД.ММ ЧЧ:ММ (UTC сервера). Без Intl, которого в QuickJS может не быть. */
function fmtTime(ms) {
  const d = new Date(ms);
  const p2 = (n) => String(n).padStart(2, "0");
  return `${p2(d.getUTCDate())}.${p2(d.getUTCMonth() + 1)} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
}

/** Удаляет коды форматирования § и обрезает строку: имена точек из формы. */
function cleanName(raw, fallback) {
  const s = String(raw ?? "")
    .replace(/§./g, "")
    .trim()
    .slice(0, CONFIG.PRESET_NAME_MAX);
  return s || fallback;
}

// ============================================================================
// §2  КАТАЛОГ ДРОНОВ
// ============================================================================
// Скорость speed указана в блоках в секунду. turnRadius — радиус разворота
// на полной скорости, в блоках. climb, turn и accel — множители для
// набора высоты, манёвренности и резкости разгона. rampTicks/rampMin задают
// выход на скорость после старта. spool — сколько тиков дрон «раскручивается»
// на ПУ до схода. probe — точки проверки блоков: [нос, законцовка крыла].
// mount — положение на ПУ. power — радиус взрыва (в оригинале был
// компонент minecraft:explode с power 8). debris — сущность обломков.
const DRONE_TYPES = {
  "rocket:missile": {
    name: "Shahed",
    short: "Шахед",
    item: "rocket:item",
    icon: "textures/items/rocket_icon",
    speed: 13.6,
    turnRadius: 28,
    climb: 0.95,
    turn: 0.9,
    accel: 0.85,
    rampTicks: 18,
    rampMin: 0.55,
    spool: 40,
    sound: "custom.rocket.fly",
    soundLoop: 121,
    thunder: true,
    launchFlame: true,
    probe: [2.6, 0.9],
    mount: { z: 0.85, y: 0.62, p: -32 },
    power: 8,
    debris: null,
  },
  "rocket:missile2": {
    name: "Storm Shadow",
    short: "Шторм",
    item: "rocket:item2",
    icon: "textures/items/rocket_icon2",
    speed: 16,
    turnRadius: 28,
    climb: 0.95,
    turn: 0.9,
    accel: 0.85,
    rampTicks: 18,
    rampMin: 0.55,
    spool: 40,
    sound: "custom.rocket.fly",
    soundLoop: 121,
    thunder: true,
    probe: [1.6, 0.6],
    mount: { z: 0.5, y: 0.6, p: 15 },
    power: 8,
    debris: null,
  },
  "rocket:missile3": {
    name: "Shahed-136",
    short: "Ш-136",
    item: "rocket:item3",
    icon: "textures/items/shahed3_icon",
    speed: 11.2,
    turnRadius: 20,
    climb: 0.9,
    turn: 0.8,
    accel: 0.75,
    rampTicks: 30,
    rampMin: 0.4,
    spool: 40,
    sound: "custom.shahed3.fly",
    soundLoop: 248,
    probe: [2.6, 0.9],
    mount: { z: 0.85, y: 0.62, p: -32 },
    power: 8,
    debris: null,
  },
  "rocket:missile4": {
    name: "Gerbera",
    short: "Гербера",
    item: "rocket:item4",
    icon: "textures/items/gerbera_icon",
    speed: 10.4,
    turnRadius: 20,
    climb: 0.9,
    turn: 0.85,
    accel: 0.8,
    rampTicks: 30,
    rampMin: 0.4,
    spool: 40,
    sound: "custom.shahed3.fly",
    soundLoop: 248,
    probe: [1.4, 0.9],
    mount: { z: 0.85, y: 0.62, p: -32 },
    power: 8,
    debris: "rocket:debris_gerbera",
  },
  "rocket:missile5": {
    name: "Dart 5",
    short: "Дартс",
    item: "rocket:item5",
    icon: "textures/items/uav5_icon",
    speed: 12,
    turnRadius: 18,
    climb: 1.05,
    turn: 1.1,
    accel: 1.1,
    rampTicks: 26,
    rampMin: 0.45,
    spool: 40,
    sound: "custom.darts.fly",
    soundLoop: 330,
    probe: [0.9, 0.7],
    mount: { z: 0.85, y: 0.38, p: -32 },
    power: 8,
    debris: null,
  },
  "rocket:missile6": {
    name: "Молния-1",
    short: "Молния",
    item: "rocket:item6",
    icon: "textures/items/molniya1_icon",
    speed: 8.8,
    turnRadius: 14,
    climb: 1.05,
    turn: 0.95,
    accel: 0.7,
    rampTicks: 34,
    rampMin: 0.35,
    spool: 40,
    sound: "custom.molniya1.fly",
    soundLoop: 330,
    probe: [1.1, 0.7],
    mount: { z: 0.75, y: 0.72, p: -32 },
    power: 8,
    debris: null,
  },
  "rocket:missile7": {
    name: "FP-1",
    short: "FP-1",
    item: "rocket:item7",
    icon: "textures/items/fp1_icon",
    speed: 8.8,
    turnRadius: 20,
    climb: 1.05,
    turn: 1.1,
    accel: 1.1,
    rampTicks: 26,
    rampMin: 0.45,
    spool: 20,
    sound: "custom.fp1.fly",
    soundLoop: 230,
    probe: [1.9, 1.1],
    mount: { z: 0.85, y: 0.15, p: -32 },
    power: 8,
    debris: "rocket:debris_fp1",
    distantBoom: true, // дальний звук взрыва для игроков дальше 25 блоков
  },
};
const DRONE_TYPE_IDS = Object.keys(DRONE_TYPES);
const LAUNCHER_TYPE = "bpla:launcher";

// Ключи динамических свойств сущности дрона. Ключи без префикса оставлены
// как в оригинале: так подхватываются дроны из уже существующих миров.
const DP = {
  LAUNCHED: "is_launched",
  ROUTE: "bpla_route",
  HIT: "is_hit",
  MOUNT_YAW: "mount_yaw",
  MOUNT_PITCH: "mount_pitch",
  MOUNT_POS: "mount_pos",
  OWNER: "bpla:owner",
  CALLSIGN: "bpla:callsign",
  GROUP: "bpla:group",
  ECHELON: "bpla:echelon",
  LAUNCHER_ID: "bpla:launcher_id", // ПУ, на направляющей которой стоит (стоял) дрон
};

/** Предмет дрона → тип сущности (для зарядки ПУ). */
const ITEM_TO_DRONE = {};
for (const id of DRONE_TYPE_IDS) ITEM_TO_DRONE[DRONE_TYPES[id].item] = id;

// ============================================================================
// §3  ХРАНИЛИЩА
// ============================================================================

/**
 * Шаблоны целей хранятся в мире (world dynamic property) в виде JSON,
 * поэтому переживают перезапуск мира и видны всем игрокам.
 * Формат записи: { id, name, x, y, z, dim, author, t }; x/y/z — координаты блока.
 */
const Presets = {
  KEY: "bpla:presets",

  all() {
    const list = readJSON(world, this.KEY, []);
    return Array.isArray(list) ? list.filter((p) => p && isPoint(p) && typeof p.name === "string") : [];
  },

  get(id) {
    return this.all().find((p) => p.id === id);
  },

  /** Добавляет шаблон; шаблон с тем же именем в том же измерении перезаписывается. */
  add(preset) {
    const list = this.all();
    const idx = list.findIndex((p) => p.name === preset.name && p.dim === preset.dim);
    if (idx < 0 && list.length >= CONFIG.MAX_PRESETS) {
      return { ok: false, error: `Достигнут лимит шаблонов (${CONFIG.MAX_PRESETS}). Удалите лишние.` };
    }
    const record = {
      id: idx >= 0 ? list[idx].id : `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`,
      name: preset.name,
      x: Math.floor(preset.x),
      y: Math.floor(preset.y),
      z: Math.floor(preset.z),
      dim: preset.dim,
      author: preset.author ?? "",
      t: Date.now(),
    };
    if (idx >= 0) list[idx] = record;
    else list.push(record);
    if (!writeJSON(world, this.KEY, list)) return { ok: false, error: "Не удалось записать шаблоны в мир." };
    return { ok: true, record, replaced: idx >= 0 };
  },

  remove(id) {
    const list = this.all();
    const next = list.filter((p) => p.id !== id);
    if (next.length === list.length) return false;
    return writeJSON(world, this.KEY, next);
  },
};

/**
 * План маршрута игрока (редактор маршрута и тактическая карта).
 * Хранится в динамическом свойстве игрока как JSON:
 *   { dim, echelon, waypoints: [{x, y, z}], target: {x, y, z} | null }
 * x/z — координаты блока. y у путевой точки — высота эшелона. y цели
 * равен null, если высота берётся по рельефу (уточняется в полёте).
 */
const RoutePlan = {
  KEY: "bpla:route_plan",

  empty(dimId) {
    return { dim: dimId, echelon: CONFIG.DEFAULT_ECHELON, waypoints: [], target: null };
  },

  get(player) {
    const dimId = safe(() => player.dimension.id, "minecraft:overworld");
    const raw = readJSON(player, this.KEY, null);
    const plan = this.empty(dimId);
    if (!raw || typeof raw !== "object") return plan;
    if (typeof raw.dim === "string") plan.dim = raw.dim;
    if (Number.isFinite(raw.echelon)) plan.echelon = raw.echelon;
    if (Array.isArray(raw.waypoints)) plan.waypoints = raw.waypoints.filter(isPoint).slice(0, CONFIG.MAX_WAYPOINTS);
    const t = raw.target;
    if (t && Number.isFinite(t.x) && Number.isFinite(t.z)) {
      plan.target = { x: t.x, y: Number.isFinite(t.y) ? t.y : null, z: t.z };
    }
    return plan;
  },

  set(player, plan) {
    writeJSON(player, this.KEY, plan);
  },

  /** План для текущего измерения игрока. Если план из другого измерения, он заменяется пустым. */
  forDimension(player) {
    const dimId = player.dimension.id;
    const plan = this.get(player);
    if (plan.dim === dimId) return plan;
    const fresh = this.empty(dimId);
    fresh.echelon = plan.echelon;
    return fresh;
  },

  hasPoints(plan) {
    return plan.waypoints.length > 0 || !!plan.target;
  },
};

/**
 * Архив маршрутов игрока: последние CONFIG.MAX_ROUTE_HISTORY уникальных маршрутов.
 * Маршрут определяется измерением, путевыми точками и целью. Повторный пуск
 * по тому же маршруту не создаёт новую запись, а поднимает старую наверх.
 * Записи старого формата ({ route: [точки...], time }, последняя точка — цель)
 * читаются и преобразуются в план.
 */
const RouteHistory = {
  KEY: "bpla_route_history",

  /** Ключ уникальности маршрута (эшелон по умолчанию не учитывается). */
  key(plan) {
    const r = (v) => (Number.isFinite(v) ? Math.floor(v) : "~");
    const pts = (plan.waypoints ?? []).map((w) => `${r(w.x)},${r(w.y)},${r(w.z)}`);
    const t = plan.target ? `${r(plan.target.x)},${r(plan.target.y)},${r(plan.target.z)}` : "-";
    return [plan.dim, ...pts, t].join("|");
  },

  /** Все записи, старые первыми, без дублей (из дублей остаётся самая свежая). */
  all(player) {
    const h = readJSON(player, this.KEY, []);
    if (!Array.isArray(h)) return [];
    const dimId = safe(() => player.dimension.id, "minecraft:overworld");
    const byKey = new Map();
    for (const it of h) {
      let entry = null;
      if (it && it.plan && it.plan.target) entry = { plan: it.plan, time: it.time || 0 };
      else if (it && Array.isArray(it.route) && it.route.length && it.route.every(isPoint)) {
        const last = it.route[it.route.length - 1];
        entry = {
          plan: {
            dim: dimId,
            echelon: CONFIG.DEFAULT_ECHELON,
            waypoints: it.route.slice(0, -1),
            target: { x: Math.floor(last.x), y: Math.floor(last.y), z: Math.floor(last.z) },
          },
          time: it.time || 0,
        };
      }
      if (!entry) continue;
      const k = this.key(entry.plan);
      const prev = byKey.get(k);
      if (!prev || prev.time <= entry.time) byKey.set(k, entry);
    }
    return [...byKey.values()].sort((a, b) => a.time - b.time);
  },

  save(player, list) {
    writeJSON(player, this.KEY, list.slice(-CONFIG.MAX_ROUTE_HISTORY));
  },

  push(player, plan) {
    const k = this.key(plan);
    const list = this.all(player).filter((it) => this.key(it.plan) !== k);
    list.push({ plan, time: Date.now() });
    this.save(player, list);
  },

  remove(player, key) {
    this.save(
      player,
      this.all(player).filter((it) => this.key(it.plan) !== key),
    );
  },
};

/** Последние настройки залпа игрока: интервал, строй, разброс. */
const LaunchPrefs = {
  KEY: "bpla:launch_prefs",
  get(player) {
    const d = { interval: CONFIG.SALVO_INTERVAL, formation: "column", spread: 0 };
    const saved = readJSON(player, this.KEY, {});
    return Object.assign(d, saved && typeof saved === "object" ? saved : {});
  },
  set(player, prefs) {
    writeJSON(player, this.KEY, prefs);
  },
};

/** Положение и масштаб тактической карты игрока: { x, z, zoom, dim }. Центр карты — курсор. */
const MapViews = {
  KEY: "bpla:map_view",

  get(player) {
    const dimId = player.dimension.id;
    const v = readJSON(player, this.KEY, null);
    if (v && v.dim === dimId && Number.isFinite(v.x) && Number.isFinite(v.z)) {
      return {
        x: Math.floor(v.x),
        z: Math.floor(v.z),
        zoom: clamp(v.zoom | 0, 0, CONFIG.MAP_ZOOMS.length - 1),
        dim: dimId,
      };
    }
    const p = player.location;
    return { x: Math.floor(p.x), z: Math.floor(p.z), zoom: CONFIG.MAP_DEFAULT_ZOOM, dim: dimId };
  },

  set(player, view) {
    writeJSON(player, this.KEY, { x: Math.floor(view.x), z: Math.floor(view.z), zoom: view.zoom, dim: view.dim });
  },
};

/** Счётчики позывных и номеров залпов (в мире). */
function nextSequence(key) {
  const n = (Number(getDP(world, key)) || 0) + 1;
  setDP(world, key, n);
  return n;
}

// ============================================================================
// §4  МЕНЕДЖЕР ЗОН ТИКОВ (TICKING AREAS)
// ============================================================================
// Проблема: дрон улетает из загруженных чанков, его сущность выгружается и
// «замирает» в воздухе. Решение: вокруг каждого летящего дрона держится
// круговая зона тиков с именем `drone_<entityId>`
// (`tickingarea add circle <X> <Y> <Z> 2 drone_<entityId>`).
//
// Жизненный цикл зоны:
//   • старт дрона: add;
//   • полёт: зона переезжает следом (remove + add). Центр ставится с
//     упреждением по курсу, чтобы чанки впереди успели загрузиться;
//   • подрыв, столкновение, удаление или выгрузка дрона:
//     `tickingarea remove drone_<entityId>`.
//
// Защита от лимита Bedrock (10 зон на мир):
//   • дроны занимают не больше CONFIG.MAX_DRONE_AREAS зон, остальные летят
//     без своей зоны (их чанки держит компонент minecraft:tick_world сущности)
//     и периодически пробуют получить зону снова;
//   • все созданные зоны записываются в динамическое свойство мира: после
//     /reload или перезапуска мира скрипт находит и удаляет зоны дронов,
//     которые больше не летят (§13);
//   • раз в CONFIG.AREA_HOUSEKEEPING_INTERVAL тиков убираются «осиротевшие» зоны.
// Имя зоны в командах берётся в кавычки: id сущности бывает отрицательным
// (например, drone_-4294967295), а без кавычек парсер команд такое имя не принимает.
const TickingAreas = {
  KEY: "bpla:ticking_areas",
  /** @type {Map<string, {id: string, name: string, dim: string, x: number, y: number, z: number}>} */
  records: new Map(),
  loaded: false,
  dirty: false,

  nameFor(droneId) {
    return `drone_${droneId}`;
  },

  /** Ленивая загрузка записей из мира (при первом обращении). */
  load() {
    if (this.loaded) return;
    this.loaded = true;
    const obj = readJSON(world, this.KEY, {});
    if (!obj || typeof obj !== "object") return;
    for (const id of Object.keys(obj)) {
      const r = obj[id];
      if (!r || typeof r.dim !== "string") continue;
      this.records.set(id, { id, name: this.nameFor(id), dim: r.dim, x: r.x | 0, y: r.y | 0, z: r.z | 0 });
    }
  },

  /** Сохраняет записи в мир, если они менялись. */
  flush() {
    if (!this.dirty) return;
    this.dirty = false;
    const obj = {};
    for (const [id, r] of this.records) obj[id] = { dim: r.dim, x: r.x, y: r.y, z: r.z };
    writeJSON(world, this.KEY, obj);
  },

  count() {
    this.load();
    return this.records.size;
  },

  get(droneId) {
    this.load();
    return this.records.get(droneId);
  },

  /** Выполняет команду в измерении. true — если команда прошла успешно. */
  run(dimId, command) {
    try {
      const res = world.getDimension(dimId).runCommand(command);
      return !!res && res.successCount > 0;
    } catch {
      return false;
    }
  },

  /** Центр зоны: целые координаты, высота в пределах измерения. */
  sanitize(dimId, c) {
    const [minY, maxY] = dimLimits(dimId);
    return { x: Math.floor(c.x), y: clamp(Math.floor(c.y), minY, maxY - 1), z: Math.floor(c.z) };
  },

  /** Создаёт зону дрона. Возвращает false, если лимит исчерпан или команда не прошла. */
  add(droneId, dimId, center) {
    this.load();
    if (this.records.has(droneId)) return this.move(droneId, dimId, center);
    if (this.records.size >= CONFIG.MAX_DRONE_AREAS) return false;
    const name = this.nameFor(droneId);
    const c = this.sanitize(dimId, center);
    // Сначала убираем возможную «зависшую» зону с тем же именем (после краша, от старой версии и т.п.).
    this.run(dimId, `tickingarea remove "${name}"`);
    const ok = this.run(dimId, `tickingarea add circle ${c.x} ${c.y} ${c.z} ${CONFIG.AREA_RADIUS_CHUNKS} "${name}"`);
    if (ok) {
      this.records.set(droneId, { id: droneId, name, dim: dimId, x: c.x, y: c.y, z: c.z });
      this.dirty = true;
      this.flush();
    }
    return ok;
  },

  /** Переносит зону на новый центр (remove + add). */
  move(droneId, dimId, center) {
    const rec = this.get(droneId);
    if (!rec) return this.add(droneId, dimId, center);
    const c = this.sanitize(dimId, center);
    if (rec.dim === dimId && rec.x === c.x && rec.y === c.y && rec.z === c.z) return true;
    this.run(rec.dim, `tickingarea remove "${rec.name}"`);
    this.records.delete(droneId);
    this.dirty = true;
    const ok = this.run(
      dimId,
      `tickingarea add circle ${c.x} ${c.y} ${c.z} ${CONFIG.AREA_RADIUS_CHUNKS} "${rec.name}"`,
    );
    if (ok) this.records.set(droneId, { id: droneId, name: rec.name, dim: dimId, x: c.x, y: c.y, z: c.z });
    // Новый центр запишется при ближайшем flush(). Если зону пересоздать не удалось,
    // запись исчезла, и это нужно сохранить сразу.
    else this.flush();
    return ok;
  },

  /** Удаляет зону дрона. Вызывается при подрыве, столкновении, удалении и выгрузке дрона. */
  remove(droneId) {
    const rec = this.get(droneId);
    if (!rec) return false;
    this.run(rec.dim, `tickingarea remove "${rec.name}"`);
    this.records.delete(droneId);
    this.dirty = true;
    this.flush(); // запись в мир сразу: зона не должна «воскреснуть» после перезагрузки
    return true;
  },

  /** Удаляет все зоны дронов, которые знает скрипт. Возвращает их количество. */
  removeAll() {
    this.load();
    const ids = [...this.records.keys()];
    for (const id of ids) this.remove(id);
    return ids.length;
  },

  /** Аварийно удаляет ВСЕ зоны тиков мира (в т.ч. чужие): `tickingarea remove_all` во всех измерениях. */
  emergencyRemoveAll() {
    for (const dimId of DIMENSIONS) this.run(dimId, "tickingarea remove_all");
    this.load();
    this.records.clear();
    this.dirty = true;
    this.flush();
  },
};

// ============================================================================
// §5  ЭФФЕКТЫ: ЧАСТИЦЫ, ДЫМ, ВСПЫШКА, ВЗРЫВ, ЗВУК ДВИГАТЕЛЕЙ
// ============================================================================

/** Частица без исключений (например, если чанк не загружен). */
function SP(dim, id, loc) {
  try {
    dim.spawnParticle(id, loc);
  } catch {}
}

/** Команда, выполненная в заданной точке измерения. */
function runAt(dim, p, command) {
  try {
    dim.runCommand(`execute positioned ${p.x.toFixed(2)} ${p.y.toFixed(2)} ${p.z.toFixed(2)} run ${command}`);
  } catch {}
}

/** Вспышка: белое затемнение камеры у игроков, которые смотрят в сторону взрыва (до 55 блоков). */
function flashPlayers(dim, loc) {
  try {
    for (const pl of world.getAllPlayers()) {
      if (!isValid(pl) || pl.dimension.id !== dim.id) continue;
      const pd = pl.getHeadLocation();
      const dx = loc.x - pd.x,
        dy = loc.y - pd.y,
        dz = loc.z - pd.z,
        dist = Math.hypot(dx, dy, dz);
      if (dist > 55 || dist < 0.05) continue;
      const vd = pl.getViewDirection(),
        dot = (vd.x * dx + vd.y * dy + vd.z * dz) / dist;
      if (dot <= 0.7) continue;
      const kf = 1 - dist / 55,
        near = Math.max(0, dot - 0.7) / 0.3;
      try {
        pl.camera.fade({
          fadeTime: { fadeInTime: 0.02, holdTime: 0.1 + 0.3 * kf * near, fadeOutTime: 0.8 + 0.7 * kf * near },
          fadeColor: { red: 1, green: 1, blue: 1 },
        });
      } catch {}
    }
  } catch {}
}

/** Дымовые столбы над воронками: около 2 минут, постепенно расширяются и поднимаются. */
const SMOKE = [];
const SMOKE_LIFETIME = 2400;
const SMOKE_BURST = [
  [0, 0.3, 0],
  [1.1, 0.7, 0.4],
  [-1, 0.6, -0.5],
  [0.6, 1, -1],
  [-0.7, 0.9, 1],
  [0.2, 1.5, 0.2],
  [1.3, 1.4, -1],
  [-1.3, 1.3, 0.8],
  [0, 2, 0],
  [0.8, 0.3, 1.2],
  [-0.9, 0.3, -1.1],
  [1.6, 0.5, 0.6],
  [-1.6, 0.6, -0.6],
  [0.3, 2.4, -0.3],
];

function startSmoke(dim, x, y, z) {
  for (const [ox, oy, oz] of SMOKE_BURST)
    SP(dim, "minecraft:campfire_tall_smoke_particle", { x: x + ox, y: y + oy, z: z + oz });
  if (SMOKE.length >= CONFIG.MAX_SMOKE_COLUMNS) SMOKE.shift();
  SMOKE.push({ dim, x, y, z, t: 0 });
}

/** Шаг дымовых столбов (вызывается раз в 3 тика). */
function smokeTick() {
  for (let i = SMOKE.length - 1; i >= 0; i--) {
    const j = SMOKE[i];
    j.t += 3;
    if (j.t >= SMOKE_LIFETIME) {
      SMOKE.splice(i, 1);
      continue;
    }
    const pr = j.t / SMOKE_LIFETIME,
      rad = 1.1 + pr * 7.0,
      rise = 0.4 + Math.pow(pr, 0.7) * 15,
      puffs = 4 + (pr < 0.4 ? 3 : 0);
    for (let k = 0; k < puffs; k++) {
      const ang = Math.random() * Math.PI * 2,
        rr = rad * (0.15 + Math.random() * 0.9),
        pid = Math.random() < 0.75 ? "minecraft:campfire_tall_smoke_particle" : "minecraft:basic_smoke_particle";
      SP(j.dim, pid, {
        x: j.x + Math.cos(ang) * rr,
        y: j.y + rise + (Math.random() * 2 - 1) * 1.4 * pr,
        z: j.z + Math.sin(ang) * rr,
      });
    }
    for (let k = 0; k < 2; k++) {
      SP(j.dim, "minecraft:campfire_tall_smoke_particle", {
        x: j.x + (Math.random() * 2 - 1) * 0.6,
        y: j.y + rise * 0.35 + (Math.random() * 2 - 1) * 0.6,
        z: j.z + (Math.random() * 2 - 1) * 0.6,
      });
    }
  }
}

/**
 * Звук, частицы, обломки и вспышка взрыва. Повторяет functions/shahed3/explode.mcfunction,
 * но без глобального `stopsound @a ...`: та команда глушила двигатели всех
 * остальных дронов в воздухе.
 */
function playExplosionFx(dim, typeId, p) {
  const cfg = DRONE_TYPES[typeId];
  if (cfg && cfg.distantBoom) {
    runAt(dim, p, "playsound custom.rocket.explosion @a[r=25] ~ ~ ~ 20.0 0.9 0.2");
    runAt(dim, p, "playsound custom.shahed3.explosion @a[r=25] ~ ~ ~ 20.0 1.0");
    runAt(dim, p, "playsound custom.fp1.explosion @a[rm=25] ~ ~ ~ 20.0 1.0");
  } else {
    runAt(dim, p, "playsound custom.rocket.explosion @a ~ ~ ~ 20.0 0.9 0.2");
    runAt(dim, p, "playsound custom.shahed3.explosion @a ~ ~ ~ 20.0 1.0");
  }
  SP(dim, "minecraft:huge_explosion_emitter", p);
  for (const [ox, oy, oz] of [
    [0, 1.5, 0],
    [0, 0, 0],
    [1, 1, 0],
    [-1, 1, 0],
    [0, 1, 1],
    [0, 1, -1],
    [0, 2, 0],
  ]) {
    SP(dim, "minecraft:large_explosion", { x: p.x + ox, y: p.y + oy, z: p.z + oz });
  }
  SP(dim, "minecraft:knockback_roar_particle", p);
  SP(dim, "rocket:explosion_flash", p);
  startSmoke(dim, p.x, p.y, p.z);
  // Обломки: 6 частей, у каждой своё событие появления rocket:piece_N (физика — в §11).
  if (cfg && cfg.debris) {
    for (let i = 0; i < 6; i++) runAt(dim, p, `summon ${cfg.debris} ~ ~0.6 ~ 0 0 rocket:piece_${i}`);
  }
  flashPlayers(dim, p);
}

/**
 * Звук двигателей.
 * Каждый игрок слышит одну «петлю» каждого типа двигателя, пока в радиусе
 * ENGINE_HEAR_RADIUS есть хотя бы один дрон с этим звуком. Петля
 * проигрывается через player.playSound и перезапускается по её длине
 * (cfg.soundLoop тиков).
 */
const ENGINE_HEAR_RADIUS = 80;
const ENG_NEAR = new Map(); // playerId -> Map<soundId, Set<droneId>>

function engineSet(playerId, soundId, create) {
  let m = ENG_NEAR.get(playerId);
  if (!m) {
    if (!create) return undefined;
    m = new Map();
    ENG_NEAR.set(playerId, m);
  }
  let set = m.get(soundId);
  if (!set && create) {
    set = new Set();
    m.set(soundId, set);
  }
  return set;
}

function stopSoundFor(player, soundId) {
  try {
    player.runCommand(`stopsound @s ${soundId}`);
  } catch {}
}

function startSoundFor(player, soundId) {
  stopSoundFor(player, soundId);
  try {
    player.playSound(soundId);
  } catch {}
}

/** Обновляет список слушателей дрона (раз в 10 тиков). first=true — при старте. */
function engineSound(st, first) {
  const rs = st.cfg.sound;
  const dim = safe(() => st.entity.dimension, null);
  if (!dim) return;
  const near = new Set(
    safe(() => dim.getPlayers({ location: st.pos, maxDistance: ENGINE_HEAR_RADIUS }), []).map((p) => p.id),
  );
  const prev = first || !st.engNear ? new Set() : st.engNear;
  for (const pl of safe(() => dim.getPlayers(), [])) {
    const isNear = near.has(pl.id),
      wasNear = prev.has(pl.id);
    if (isNear && !wasNear) {
      const set = engineSet(pl.id, rs, true);
      const wasEmpty = set.size === 0;
      set.add(st.id);
      if (wasEmpty) startSoundFor(pl, rs);
    } else if (!isNear && wasNear) {
      const set = engineSet(pl.id, rs, false);
      if (set) {
        set.delete(st.id);
        if (set.size === 0) stopSoundFor(pl, rs);
      }
    }
  }
  st.engNear = near;
}

/** Перезапуск петли у тех, кто слышит этот дрон. */
function engineRefresh(st) {
  const rs = st.cfg.sound;
  for (const pl of world.getAllPlayers()) {
    const set = engineSet(pl.id, rs, false);
    if (set && set.has(st.id)) startSoundFor(pl, rs);
  }
}

/** Дрон исчез: убираем его из всех наборов и глушим звук, если он был последним. */
function engineCleanup(st) {
  const rs = st.cfg.sound;
  for (const [pid, m] of ENG_NEAR) {
    const set = m.get(rs);
    if (set && set.delete(st.id) && set.size === 0) {
      const pl = world.getAllPlayers().find((p) => p.id === pid);
      if (pl) stopSoundFor(pl, rs);
    }
  }
  st.engNear = null;
}

/** Счётчик звука в полёте: слушатели раз в 10 тиков, перезапуск петли по её длине. */
function engineTick(st, inFlight) {
  st.snd++;
  if (st.snd % 10 === 0 && st.snd < st.cfg.soundLoop) engineSound(st, false);
  if (st.snd >= st.cfg.soundLoop) {
    engineRefresh(st);
    if (inFlight && st.cfg.thunder) {
      try {
        st.entity.runCommand("playsound ambient.weather.thunder @a ~ ~ ~ 0.5 0.35");
      } catch {}
    }
    st.snd = 0;
  }
}

/** Эффекты старта: хлопок, двигатель, для «Шахеда» ещё и огонь из сопла. */
function playLaunchFx(st) {
  const e = st.entity;
  try {
    e.runCommand("playsound firework.launch @a ~ ~ ~ 3.0 0.7");
  } catch {}
  engineSound(st, true);
  if (st.cfg.thunder) {
    try {
      e.runCommand("playsound ambient.weather.thunder @a ~ ~ ~ 0.5 0.35");
    } catch {}
  }
  if (st.cfg.launchFlame) {
    const dim = safe(() => e.dimension, null);
    if (!dim) return;
    const lc = st.pos,
      rad = st.yaw * RAD,
      bx = lc.x + Math.sin(rad) * 0.6,
      bz = lc.z - Math.cos(rad) * 0.6;
    SP(dim, "minecraft:basic_flame_particle", { x: bx, y: lc.y + 0.3, z: bz });
    SP(dim, "minecraft:campfire_smoke_particle", { x: bx, y: lc.y + 0.4, z: bz });
    SP(dim, "minecraft:campfire_smoke_particle", { x: bx, y: lc.y + 0.6, z: bz });
    SP(dim, "minecraft:basic_smoke_particle", { x: lc.x, y: lc.y + 0.3, z: lc.z });
  }
}

// ============================================================================
// §6  КОЛЛИЗИИ С БЛОКАМИ (AABB)
// ============================================================================
// Общий модуль для полёта дронов и физики обломков. Для каждого блока
// строится набор коробок-столкновений. Трава, цветы, факелы, рельсы и т.п.
// коробок не имеют; у плит, ступеней, ковров, заборов и кроватей коробки
// упрощённые. Результаты кэшируются на 6 тиков. Если чанк не загружен,
// region() возвращает null, и такая точка считается «неизвестной», а не твёрдой.
const BC = new Map(); // кэш коробок блоков: "dim|x|y|z" -> { t, b, liq }
const D_EPS = 1e-4;
// Блоки без коллизии (сквозь них летят дроны и падают обломки).
const NOCOL =
  /^(air|cave_air|void_air|structure_void|light_block.*|light|moving_block|bubble_column|short_grass|leaf_litter|bush|firefly_bush|short_dry_grass|tall_dry_grass|wildflowers|pink_petals|cactus_flower|tall_grass|tallgrass|double_plant|fern|large_fern|deadbush|dead_bush|seagrass|kelp|.*sapling|propagule|red_flower|yellow_flower|dandelion|poppy|blue_orchid|allium|azure_bluet|.*_tulip|oxeye_daisy|cornflower|lily_of_the_valley|wither_rose|torchflower.*|pitcher_.*|sunflower|lilac|rose_bush|peony|red_mushroom|brown_mushroom|hanging_roots|crimson_roots|warped_roots|nether_sprouts|spore_blossom|glow_lichen|sculk_vein|vine|.*_vines.*|sweet_berry_bush|wheat|carrots|potatoes|beetroot|(melon|pumpkin)_stem|attached_.*_stem|reeds|sugar_cane|bamboo_sapling|cocoa|nether_wart|.*coral_fan.*|.*coral_wall_fan|sea_pickle|.*candle|.*candle_cake|.*torch|.*lantern|end_rod|lightning_rod|.*chain|fire|soul_fire|redstone_wire|.*repeater|.*comparator|lever|.*button|.*pressure_plate|.*sign|.*banner|.*rail|web|tripwire.*|string|flower_pot|.*_door|end_portal|portal|end_gateway|lily_pad|frame|glow_frame|scaffolding_air|hanging_.*sign|decorated_pot_air)$/;
// Жидкости: обломки в них тонут медленнее, дроны пролетают насквозь.
const LIQ = /^(flowing_)?(water|lava)$/;
const FULLB = [[0, 0, 0, 1, 1, 1]];
/** Безопасное чтение состояния блока. */
function stg(b, n) {
  try {
    return b.permutation.getState(n);
  } catch {
    return undefined;
  }
}
/** Коробки столкновений блока в локальных координатах [x0,y0,z0,x1,y1,z1] (0..1). */
function blockBoxes(b) {
  const id = String(b.typeId).replace(/^[a-z_0-9]+:/, "");
  if (NOCOL.test(id) || LIQ.test(id)) return [];
  if (/slab/.test(id) && !/double/.test(id)) {
    const t = stg(b, "minecraft:vertical_half");
    return t === "top" ? [[0, 0.5, 0, 1, 1, 1]] : [[0, 0, 0, 1, 0.5, 1]];
  }
  if (/_stairs$/.test(id)) {
    const up = stg(b, "upside_down_bit") === true,
      d = stg(b, "weirdo_direction") | 0;
    const base = up ? [0, 0.5, 0, 1, 1, 1] : [0, 0, 0, 1, 0.5, 1],
      y0 = up ? 0 : 0.5,
      y1 = up ? 0.5 : 1;
    const stp =
      d === 0
        ? [0.5, y0, 0, 1, y1, 1]
        : d === 1
          ? [0, y0, 0, 0.5, y1, 1]
          : d === 2
            ? [0, y0, 0.5, 1, y1, 1]
            : [0, y0, 0, 1, y1, 0.5];
    return [base, stp];
  }
  if (/carpet$/.test(id)) return [[0, 0, 0, 1, 0.0625, 1]];
  if (id === "snow_layer") {
    const h = (stg(b, "height") | 0) + 1;
    return [[0, 0, 0, 1, Math.min(8, h) / 8, 1]];
  }
  if (/(fence|_wall|fence_gate)$/.test(id) && !/gate/.test(id)) return [[0, 0, 0, 1, 1.5, 1]];
  if (/fence_gate$/.test(id)) return stg(b, "open_bit") === true ? [] : [[0, 0, 0, 1, 1.5, 1]];
  if (/trapdoor$/.test(id)) {
    if (stg(b, "open_bit") === true) return [];
    return stg(b, "upside_down_bit") === true ? [[0, 0.8125, 0, 1, 1, 1]] : [[0, 0, 0, 1, 0.1875, 1]];
  }
  if (/bed$/.test(id)) return [[0, 0, 0, 1, 0.5625, 1]];
  if (/(farmland|dirt_path|grass_path)$/.test(id)) return [[0, 0, 0, 1, 0.9375, 1]];
  if (/(^|_)chest$/.test(id)) return [[0.0625, 0, 0.0625, 0.9375, 0.875, 0.9375]];
  return FULLB;
}
/** Коробки блока с кэшем на 6 тиков; b === null — чанк не загружен. */
function bxs(dm, x, y, z) {
  const k = dm.id + "|" + x + "|" + y + "|" + z,
    c = BC.get(k),
    now = system.currentTick;
  if (c && now - c.t < 6) return c;
  let b, r;
  try {
    b = dm.getBlock({ x, y, z });
  } catch {
    b = undefined;
  }
  if (!b) r = { t: now, b: null, liq: false };
  else r = { t: now, b: blockBoxes(b), liq: LIQ.test(String(b.typeId).replace(/^[a-z_0-9]+:/, "")) };
  BC.set(k, r);
  return r;
}
/** Все коробки в объёме (в мировых координатах) или null, если часть объёма не загружена. */
function region(dm, x0, y0, z0, x1, y1, z1) {
  const out = [];
  for (let bx = Math.floor(x0); bx <= Math.floor(x1); bx++)
    for (let by = Math.floor(y0) - 1; by <= Math.floor(y1); by++)
      for (let bz = Math.floor(z0); bz <= Math.floor(z1); bz++) {
        const e = bxs(dm, bx, by, bz);
        if (e.b === null) return null;
        for (const q of e.b) out.push([bx + q[0], by + q[1], bz + q[2], bx + q[3], by + q[4], bz + q[5]]);
      }
  return out;
}
// Перемещение «как в ванилле»: выталкивание из блоков, затем отсечение по Y, X, Z.
// Возвращает флаги касаний или null (чанк не загружен). Используется физикой обломков.
function moveCol(dm, st, dx, dy, dz) {
  const hwx = st.hwx,
    hwz = st.hwz,
    h = st.h;
  const R = region(
    dm,
    st.x - hwx + Math.min(0, dx) - 0.01,
    st.y + Math.min(0, dy) - 0.01,
    st.z - hwz + Math.min(0, dz) - 0.01,
    st.x + hwx + Math.max(0, dx) + 0.01,
    st.y + h + Math.max(0, dy) + 0.01,
    st.z + hwz + Math.max(0, dz) + 0.01,
  );
  if (R === null) return null;
  const f = { gnd: false, hx: false, hy: false, hz: false, ax: 0, ay: 0, az: 0 };
  let top = -1e9;
  for (const b of R)
    if (
      st.x + hwx > b[0] + D_EPS &&
      st.x - hwx < b[3] - D_EPS &&
      st.z + hwz > b[2] + D_EPS &&
      st.z - hwz < b[5] - D_EPS &&
      st.y + h > b[1] + D_EPS &&
      st.y < b[4] - D_EPS
    )
      top = Math.max(top, b[4]);
  if (top > -1e8) {
    st.y = Math.min(top + D_EPS, st.y + 0.5);
    if (st.vy < 0) st.vy = 0;
  }
  let ay = dy;
  for (const b of R)
    if (
      st.x + hwx > b[0] + D_EPS &&
      st.x - hwx < b[3] - D_EPS &&
      st.z + hwz > b[2] + D_EPS &&
      st.z - hwz < b[5] - D_EPS
    ) {
      if (ay < 0 && b[4] <= st.y + D_EPS) ay = Math.max(ay, b[4] - st.y);
      else if (ay > 0 && b[1] >= st.y + h - D_EPS) ay = Math.min(ay, b[1] - (st.y + h));
    }
  if (Math.abs(ay - dy) > 1e-7) {
    f.hy = true;
    if (dy < 0) f.gnd = true;
  }
  st.y += ay;
  f.ay = ay;
  let ax = dx;
  for (const b of R)
    if (st.y + h > b[1] + D_EPS && st.y < b[4] - D_EPS && st.z + hwz > b[2] + D_EPS && st.z - hwz < b[5] - D_EPS) {
      if (ax > 0 && b[0] >= st.x + hwx - D_EPS) ax = Math.min(ax, b[0] - (st.x + hwx));
      else if (ax < 0 && b[3] <= st.x - hwx + D_EPS) ax = Math.max(ax, b[3] - (st.x - hwx));
    }
  if (Math.abs(ax - dx) > 1e-7) f.hx = true;
  st.x += ax;
  f.ax = ax;
  let az = dz;
  for (const b of R)
    if (st.y + h > b[1] + D_EPS && st.y < b[4] - D_EPS && st.x + hwx > b[0] + D_EPS && st.x - hwx < b[3] - D_EPS) {
      if (az > 0 && b[2] >= st.z + hwz - D_EPS) az = Math.min(az, b[2] - (st.z + hwz));
      else if (az < 0 && b[5] <= st.z - hwz + D_EPS) az = Math.max(az, b[5] - (st.z - hwz));
    }
  if (Math.abs(az - dz) > 1e-7) f.hz = true;
  st.z += az;
  f.az = az;
  return f;
}

/**
 * Столкновение дрона с блоками.
 * Проверяются 4 точки-зонда радиусом DC_R: нос, центр и две законцовки крыльев
 * (длины берутся из cfg.probe). Возвращает точку удара (положение сработавшего
 * зонда в текущей позиции дрона) или null.
 */
const DC_R = 0.18;
function probePoints(p, yaw, pitch, nose, wing) {
  const ry = yaw * RAD,
    rp = pitch * RAD,
    cp = Math.cos(rp),
    fx = -Math.sin(ry) * cp,
    fy = -Math.sin(rp),
    fz = Math.cos(ry) * cp,
    sx = Math.cos(ry),
    sz = Math.sin(ry),
    cy = p.y + 0.3;
  return [
    { x: p.x + fx * nose, y: cy + fy * nose, z: p.z + fz * nose },
    { x: p.x, y: cy, z: p.z },
    { x: p.x + sx * wing, y: cy, z: p.z + sz * wing },
    { x: p.x - sx * wing, y: cy, z: p.z - sz * wing },
  ];
}

function droneBlockCollision(dim, cfg, next, cur, yaw, pitch) {
  try {
    if (BC.size > 6000) BC.clear();
    const [nose, wing] = cfg.probe;
    const pts = probePoints(next, yaw, pitch, nose, wing);
    for (let k = 0; k < pts.length; k++) {
      const c = pts[k],
        boxes = region(dim, c.x - DC_R, c.y - DC_R, c.z - DC_R, c.x + DC_R, c.y + DC_R, c.z + DC_R);
      if (boxes === null) continue;
      for (const b of boxes) {
        if (
          c.x + DC_R > b[0] &&
          c.x - DC_R < b[3] &&
          c.y + DC_R > b[1] &&
          c.y - DC_R < b[4] &&
          c.z + DC_R > b[2] &&
          c.z - DC_R < b[5]
        ) {
          return probePoints(cur, yaw, pitch, nose, wing)[k];
        }
      }
    }
  } catch {}
  return null;
}

// ============================================================================
// §7  РЕЕСТР ДРОНОВ И ПОЛЁТНЫЙ КОНТРОЛЛЕР
// ============================================================================
// Все загруженные дроны лежат в реестре DRONES (id -> состояние). Состояние
// полёта (курс, тангаж, угловая скорость, разгон) хранится в памяти. В
// динамические свойства сущности пишется только то, что должно пережить
// перезагрузку: флаг полёта, маршрут, владелец, позывной, залп.
// Раз в 20 тиков обход измерений находит новые и заново загруженные дроны.
//
// Цикл полёта (каждый тик, system.runInterval):
//   1. раскрутка на ПУ (spool): дрон стоит на направляющей;
//   2. переход к следующей точке маршрута: дрон вошёл в радиус
//      CONFIG.WAYPOINT_RADIUS (по горизонтали) или проскочил точку на вираже;
//   3. вектор на цель: желаемые курс и тангаж;
//   4. плавный поворот: угловая скорость ограничена радиусом разворота,
//      тангаж ограничен CONFIG.CRUISE_MAX_PITCH (на пикировании — больше);
//   5. на финальном участке направление плавно смешивается с прямым
//      вектором на цель (терминальное наведение гарантирует попадание);
//   6. проверки: цель ближе CONFIG.ARRIVE_RADIUS (1,5 блока) → подрыв;
//      блоки и существа на пути → подрыв. Высота цели «по рельефу»
//      уточняется, когда до неё остаётся CONFIG.TERRAIN_RESOLVE_RANGE;
//   7. перемещение: teleport в новую точку (интерполяция координат)
//      + applyImpulse, чтобы клиент плавно отрисовывал движение между тиками.

/**
 * @typedef {Object} DroneState
 * @property {string} id
 * @property {import("@minecraft/server").Entity} entity
 * @property {string} typeId
 * @property {typeof DRONE_TYPES[string]} cfg
 * @property {string} dimId
 * @property {boolean} launched   в полёте (или на раскрутке)
 * @property {{x:number,y:number,z:number,auto?:boolean}[]} route  оставшиеся точки; последняя — цель (auto: высота по рельефу)
 * @property {string} owner       имя игрока, запустившего дрон
 * @property {string} callsign    позывной, например «Ш-136-12»
 * @property {string} group       номер залпа
 * @property {number} echelon     высота эшелона (абсолютный Y)
 * @property {{yaw:number,pitch:number,pos:?{x:number,y:number,z:number}}|null} mount  положение на ПУ
 * @property {{x:number,y:number,z:number}} pos  расчётная позиция (источник истины для полёта)
 * @property {number} yaw
 * @property {number} pitch
 * @property {number} yawRate
 * @property {number} spdFactor
 * @property {number} turned      накопленный разворот, градусов (защита от кружения вокруг точки)
 * @property {number} wpBest      минимальная дистанция до текущей путевой точки
 * @property {number} flightTicks
 * @property {number} spoolTicks
 * @property {number} spoolMax
 * @property {number} blockGrace
 * @property {number} entityGrace
 * @property {boolean} hit        сбит и падает
 * @property {number|undefined} hitPitch
 * @property {number} snd
 * @property {Set<string>|null} engNear
 * @property {{x:number,y:number,z:number}|null} lastDir
 * @property {number} areaRetryAt
 * @property {boolean} areaWarned
 * @property {number} phase       сдвиг по тикам для периодических проверок
 * @property {boolean} dead
 */

/** @type {Map<string, DroneState>} */
const DRONES = new Map();
/** Дроны на ПУ, уже назначенные в залп и ждущие своей очереди на пуск. */
const RESERVED = new Set();

function readRoute(entity) {
  const r = readJSON(entity, DP.ROUTE, []);
  return Array.isArray(r) ? r.filter(isPoint).map(roundPoint) : [];
}

/** Добавляет сущность в реестр (или возвращает уже известное состояние). */
function registerDrone(entity) {
  if (!isValid(entity)) return null;
  const known = DRONES.get(entity.id);
  if (known) {
    if (known.entity !== entity && !isValid(known.entity)) known.entity = entity;
    return known;
  }
  const cfg = DRONE_TYPES[entity.typeId];
  if (!cfg) return null;
  const rot = safe(() => entity.getRotation(), { x: 0, y: 0 });
  const launched = getDP(entity, DP.LAUNCHED) === true;
  const myaw = getDP(entity, DP.MOUNT_YAW),
    mpitch = getDP(entity, DP.MOUNT_PITCH),
    mpos = readJSON(entity, DP.MOUNT_POS, null);
  /** @type {DroneState} */
  const st = {
    id: entity.id,
    entity,
    typeId: entity.typeId,
    cfg,
    dimId: safe(() => entity.dimension.id, "minecraft:overworld"),
    launched,
    route: readRoute(entity),
    owner: String(getDP(entity, DP.OWNER) ?? ""),
    callsign: String(getDP(entity, DP.CALLSIGN) ?? `${cfg.short}-?`),
    group: String(getDP(entity, DP.GROUP) ?? ""),
    echelon: Number(getDP(entity, DP.ECHELON)) || CONFIG.DEFAULT_ECHELON,
    mount:
      typeof myaw === "number" && typeof mpitch === "number"
        ? { yaw: myaw, pitch: mpitch, pos: isPoint(mpos) ? mpos : null }
        : null,
    pos: vcopy(entity.location),
    yaw: rot.y,
    pitch: rot.x,
    yawRate: 0,
    spdFactor: 1,
    turned: 0,
    wpBest: Infinity,
    // Дрон, найденный уже в полёте (после /reload), считается разогнанным.
    flightTicks: launched ? 1000 : 0,
    spoolTicks: 0,
    spoolMax: 0,
    blockGrace: 0,
    entityGrace: 0,
    hit: launched && getDP(entity, DP.HIT) === true,
    hitPitch: undefined,
    snd: 0,
    engNear: null,
    lastDir: null,
    areaRetryAt: 0,
    areaWarned: false,
    phase: hashString(entity.id),
    dead: false,
  };
  DRONES.set(st.id, st);
  return st;
}

/** Дрон пропал (выгружен, удалён командой, убит): освобождаем зону тиков и звук. */
function forgetDrone(st) {
  TickingAreas.remove(st.id);
  engineCleanup(st);
  RESERVED.delete(st.id);
  DRONES.delete(st.id);
}

function persistRoute(st) {
  if (isValid(st.entity)) writeJSON(st.entity, DP.ROUTE, st.route);
}

/** Сохраняет в сущность всё, что нужно для продолжения полёта после перезагрузки. */
function persistFlight(st) {
  const e = st.entity;
  if (!isValid(e)) return;
  setDP(e, DP.LAUNCHED, st.launched);
  setDP(e, DP.HIT, st.hit);
  setDP(e, DP.OWNER, st.owner);
  setDP(e, DP.CALLSIGN, st.callsign);
  setDP(e, DP.GROUP, st.group);
  setDP(e, DP.ECHELON, st.echelon);
  persistRoute(st);
}

/** Обход измерений: добавляет в реестр дронов, которых он ещё не знает. */
function sweepDrones() {
  for (const dimId of DIMENSIONS) {
    let dim;
    try {
      dim = world.getDimension(dimId);
    } catch {
      continue;
    }
    for (const typeId of DRONE_TYPE_IDS) {
      let list;
      try {
        list = dim.getEntities({ type: typeId });
      } catch {
        continue;
      }
      for (const e of list) registerDrone(e);
    }
  }
}

function isDroneLaunched(entity) {
  const st = DRONES.get(entity.id);
  return st ? st.launched : getDP(entity, DP.LAUNCHED) === true;
}

function finalTarget(st) {
  return st.route.length ? st.route[st.route.length - 1] : null;
}

/** Длина оставшегося пути по точкам маршрута. */
function remainingPath(st) {
  let d = 0,
    p = st.pos;
  for (const w of st.route) {
    d += vdist(p, w);
    p = w;
  }
  return d;
}

function droneSpeedBps(st) {
  return st.cfg.speed * CONFIG.SPEED_MULT;
}

function dronePhase(st) {
  if (st.hit) return "§cсбит, падает";
  if (st.spoolTicks < st.spoolMax) return "§eзапуск двигателя на ПУ";
  if (!st.route.length) return "§eзависание, цель не задана";
  if (st.route.length > 1) return `марш по маршруту (точек до цели: ${st.route.length - 1})`;
  const t = st.route[0];
  return hdist(st.pos, t) < CONFIG.TERMINAL_RANGE ? "§6пикирование на цель" : "полёт к цели";
}

// ---------------------------------------------------------------------------
// Главный цикл
// ---------------------------------------------------------------------------
function droneTick() {
  const now = system.currentTick;
  for (const st of DRONES.values()) {
    if (st.dead) {
      DRONES.delete(st.id);
      continue;
    }
    // Критично: ни одного обращения к сущности без проверки isValid().
    if (!isValid(st.entity)) {
      forgetDrone(st);
      continue;
    }
    try {
      if (!st.launched) idleTick(st);
      else if (st.hit) fallingTick(st);
      else flightTick(st, now);
      if (st.launched && !st.dead) areaFollow(st, now);
    } catch (err) {
      logError(`droneTick(${st.callsign})`, err);
    }
  }
  TickingAreas.flush();
}

/** Дрон стоит на ПУ: держим ориентацию направляющей, чтобы модель не «плыла». */
function idleTick(st) {
  const m = st.mount;
  if (!m) return;
  const e = st.entity;
  if (m.pos && vdist(e.location, m.pos) > 1.5) return; // дрон сдвинули с ПУ (командой и т.п.)
  const r = e.getRotation();
  if (Math.abs(wrap180(r.x - m.pitch)) > 0.5 || Math.abs(wrap180(r.y - m.yaw)) > 0.5) {
    try {
      e.setRotation({ x: m.pitch, y: m.yaw });
    } catch {
      try {
        e.teleport(e.location, { rotation: { x: m.pitch, y: m.yaw } });
      } catch {}
    }
  }
}

/**
 * Путевая точка пройдена, если:
 *   • дрон вошёл в радиус CONFIG.WAYPOINT_RADIUS по горизонтали (высота может ещё выравниваться);
 *   • или дрон уже был рядом с точкой (ближе 3 радиусов захвата), но проскочил её на вираже
 *     и теперь удаляется: разворот ради точного попадания в точку был бы лишним кругом.
 */
function waypointReached(st, wp) {
  const h = hdist(wp, st.pos);
  if (h < CONFIG.WAYPOINT_RADIUS) return true;
  if (h < st.wpBest) {
    st.wpBest = h;
    return false;
  }
  return st.wpBest < CONFIG.WAYPOINT_RADIUS * 3 && h > st.wpBest + 1.5;
}

/** Высота рельефа (Y поверхности, куда можно встать) в точке или null, если чанк не загружен. */
function terrainHeight(dimId, x, z) {
  try {
    const top = world.getDimension(dimId).getTopmostBlock({ x: Math.floor(x), z: Math.floor(z) });
    return top ? top.location.y + 1 : null;
  } catch {
    return null;
  }
}

/** Один тик полёта по маршруту. */
function flightTick(st, now) {
  const e = st.entity,
    cfg = st.cfg,
    dim = e.dimension;

  // Если дрон переместили извне (например, /tp), продолжаем полёт с его новой позиции.
  if (vdist(e.location, st.pos) > CONFIG.RESYNC_DISTANCE) st.pos = vcopy(e.location);

  // 1) Раскрутка двигателя на ПУ.
  if (st.spoolTicks < st.spoolMax) {
    st.spoolTicks++;
    if (st.mount && st.mount.pos) {
      st.pos = vcopy(st.mount.pos);
      e.teleport(st.pos, { rotation: { x: st.mount.pitch, y: st.mount.yaw } });
    }
    safe(() => e.clearVelocity());
    return;
  }

  // Без маршрута дрон висит на месте и ждёт новую цель с планшета.
  if (st.route.length === 0) {
    e.teleport(st.pos, { rotation: { x: st.pitch, y: st.yaw } });
    safe(() => e.clearVelocity());
    engineTick(st, true);
    return;
  }

  st.turned += Math.abs(st.yawRate);

  // 2) Переход к следующей точке маршрута (промежуточные точки проходятся «на лету», без остановки).
  let routeChanged = false;
  while (st.route.length > 1) {
    const wp = st.route[0];
    if (waypointReached(st, wp) || st.turned > 200) {
      st.route.shift();
      st.turned = 0;
      st.wpBest = Infinity;
      routeChanged = true;
    } else break;
  }

  // Цель «по рельефу»: вблизи чанк цели загружен, берём актуальную высоту поверхности
  // (в залпе предыдущие дроны могли оставить воронку).
  const goal = st.route[st.route.length - 1];
  if (goal.auto && (now + st.phase) % 5 === 0 && hdist(goal, st.pos) < CONFIG.TERRAIN_RESOLVE_RANGE) {
    const ground = terrainHeight(st.dimId, goal.x, goal.z);
    if (ground !== null) {
      goal.y = ground + 0.5;
      delete goal.auto;
      routeChanged = true;
    }
  }
  if (routeChanged) persistRoute(st);

  const wp = st.route[0],
    isFinal = st.route.length === 1;
  const dx = wp.x - st.pos.x,
    dy = wp.y - st.pos.y,
    dz = wp.z - st.pos.z;
  const horiz = Math.hypot(dx, dz),
    dist = Math.hypot(dx, dy, dz);

  if (CONFIG.SHOW_WAYPOINT_MARKER && (now + st.phase) % 4 === 0) SP(dim, "minecraft:basic_flame_particle", wp);

  // 6a) Цель достигнута: ближе ARRIVE_RADIUS или цель уже под дроном.
  if (isFinal && (dist < CONFIG.ARRIVE_RADIUS || (horiz < 3 && st.pos.y <= wp.y + 0.6))) {
    detonate(st, wp, "target");
    return;
  }

  // Терминальный фактор j (0..1): растёт при подходе к цели. Растёт он и тогда,
  // когда дрон кружит вокруг точки, не попадая в неё (st.turned).
  const j = isFinal
    ? Math.max(clamp01((CONFIG.TERMINAL_RANGE - horiz) / CONFIG.TERMINAL_BLEND), clamp01((st.turned - 160) / 140))
    : 0;

  const ft = ++st.flightTicks;
  const speedRamp = clamp(ft / cfg.rampTicks, cfg.rampMin, 1); // выход на скорость после старта
  const agility = clamp((ft * cfg.accel) / 24, 0.3, 1); // манёвры сразу после старта мягче
  const speed = ((cfg.speed * CONFIG.SPEED_MULT) / 20) * speedRamp; // блоков за тик

  // 3) Желаемые курс и тангаж. В Minecraft отрицательный pitch означает нос вверх.
  let wantYaw = st.yaw;
  if (horiz >= 0.2) {
    const direct = Math.atan2(-dx, dz) * DEG;
    wantYaw = horiz >= 1.2 ? direct : lerpAngle(st.yaw, direct, horiz - 0.2);
  }
  // На марше высота удерживается по короткой базе CONFIG.ALT_HOLD_BASE: дрон быстро
  // выходит на эшелон и выравнивается. На финальном участке — линия визирования на цель.
  const maxPitch = (CONFIG.CRUISE_MAX_PITCH + j * 60) * cfg.climb;
  const pitchBase = Math.max(1, isFinal ? horiz : Math.min(horiz, CONFIG.ALT_HOLD_BASE));
  const wantPitch = clamp(-Math.atan2(dy, pitchBase) * DEG, -maxPitch, maxPitch);

  // 4) Плавный поворот: угловая скорость ≤ v / R (радиус разворота), со сглаживанием.
  const yawErr = wrap180(wantYaw - st.yaw);
  const maxYawRate = (speed / cfg.turnRadius) * DEG * cfg.turn * agility * (1 + j * 3);
  const wantRate = clamp(yawErr * 0.04 * (1 + j * 3), -maxYawRate, maxYawRate);
  st.yawRate = lerp(st.yawRate, wantRate, 0.2);
  const prevYaw = st.yaw;
  st.yaw = wrap180(st.yaw + st.yawRate);

  const pitchGain = (0.075 + j * 0.05) * agility * cfg.turn;
  const maxPitchRate = 2 * agility * (1 + j * 1.5);
  st.pitch += clamp(lerp(st.pitch, wantPitch, pitchGain) - st.pitch, -maxPitchRate, maxPitchRate);

  // 5) Вектор перемещения за тик.
  const fwd = forwardFromRotation(st.yaw, st.pitch);
  let step;
  if (isFinal) {
    // На пикировании скорость до +20%. Направление смешивается с прямым вектором на цель.
    const c = speed * (st.pitch >= 0 ? 1 + (Math.min(st.pitch, 70) / 70) * 0.2 : 1);
    const wb = smoothstep(j);
    const inv = dist > 1e-6 ? 1 / dist : 0;
    const dir = vnorm({
      x: fwd.x * (1 - wb) + dx * inv * wb,
      y: fwd.y * (1 - wb) + dy * inv * wb,
      z: fwd.z * (1 - wb) + dz * inv * wb,
    });
    step = vscale(dir, c);
    if (wb > 0) {
      // Нос смотрит туда, куда дрон реально летит.
      const h = Math.hypot(dir.x, dir.z);
      if (h > 1e-4) st.yaw = Math.atan2(-dir.x, dir.z) * DEG;
      st.pitch = -Math.atan2(dir.y, h) * DEG;
    }
  } else {
    // На марше: быстрее при снижении, медленнее при наборе высоты и в крутом вираже.
    const yawDelta = Math.min(Math.abs(wrap180(st.yaw - prevYaw)), 45);
    const target =
      (st.pitch >= 0 ? 1 + (Math.min(st.pitch, 70) / 70) * 0.2 : 1 + (Math.max(st.pitch, -45) / 45) * 0.15) *
      (1 - (yawDelta / 45) * 0.08);
    st.spdFactor = lerp(st.spdFactor, target, 0.25);
    step = vscale(fwd, speed * st.spdFactor);
  }
  const next = vadd(st.pos, step);

  // 6b) Физические столкновения.
  const [minY] = dimLimits(st.dimId);
  if (next.y < minY) {
    detonate(st, st.pos, "collision");
    return;
  }
  if (st.flightTicks >= st.blockGrace) {
    const impact = droneBlockCollision(dim, cfg, next, st.pos, st.yaw, st.pitch);
    if (impact) {
      // Касание земли прямо у цели на пикировании — это попадание, а не авария.
      const atTarget = isFinal && vdist(impact, wp) < CONFIG.ARRIVE_RADIUS + 2;
      detonate(st, impact, atTarget ? "target" : "collision");
      return;
    }
  }
  if (st.flightTicks >= st.entityGrace && (now + st.phase) % 2 === 0) {
    const victim = findEntityCollision(st, dim, next);
    if (victim) {
      detonate(st, next, "entity", victim);
      return;
    }
  }

  // 7) Перемещение: интерполяция координат (teleport) + импульс для плавности на клиенте.
  try {
    e.teleport(next, { rotation: { x: st.pitch, y: st.yaw } });
    st.pos = next;
    st.lastDir = vnorm(step);
  } catch {
    // Точка не загружена: дрон ждёт, пока зона тиков подгрузит чанки.
  }
  try {
    e.clearVelocity();
    e.applyImpulse(step);
  } catch {}

  engineTick(st, true);
}

/** Сбитый дрон: горит, клюёт носом и падает, а о землю взрывается. */
function fallingTick(st) {
  const e = st.entity,
    dim = e.dimension;
  if (vdist(e.location, st.pos) > CONFIG.RESYNC_DISTANCE) st.pos = vcopy(e.location);
  const p = st.pos,
    rad = st.yaw * RAD;
  const tail = { x: p.x + Math.sin(rad) * 1.3, y: p.y + 0.3, z: p.z - Math.cos(rad) * 1.3 };
  SP(dim, "minecraft:basic_flame_particle", tail);
  SP(dim, "minecraft:basic_flame_particle", tail);
  SP(dim, "minecraft:campfire_smoke_particle", { x: tail.x, y: tail.y + 0.2, z: tail.z });

  const next = { x: p.x - Math.sin(rad) * 0.25, y: p.y - 0.55, z: p.z + Math.cos(rad) * 0.25 };
  st.hitPitch = lerp(st.hitPitch ?? st.pitch, 80, 0.12);
  st.pitch = st.hitPitch;
  try {
    e.teleport(next, { rotation: { x: st.pitch, y: st.yaw } });
    st.pos = next;
    st.lastDir = { x: 0, y: -1, z: 0 };
  } catch {}
  safe(() => e.clearVelocity());
  engineTick(st, false);

  let below;
  try {
    below = dim.getBlock({ x: Math.floor(next.x), y: Math.floor(next.y) - 1, z: Math.floor(next.z) });
  } catch {}
  const [minY] = dimLimits(st.dimId);
  if (next.y < minY + 1 || (below && !below.isAir)) detonate(st, next, "crash");
}

/** Контактный подрыв: игрок или моб рядом с дроном. Владелец не учитывается первые тики после старта. */
function findEntityCollision(st, dim, at) {
  let list;
  try {
    list = dim.getEntities({
      location: at,
      maxDistance: CONFIG.ENTITY_HIT_RADIUS,
      excludeFamilies: ["rocket", "rocket_debris", "launcher"],
      excludeGameModes: [GameMode.spectator],
    });
  } catch {
    return null;
  }
  for (const x of list) {
    if (!isValid(x) || x.id === st.id) continue;
    if (x.typeId === "minecraft:player") {
      if (x.name === st.owner && st.flightTicks < CONFIG.ENTITY_COLLISION_GRACE * 2) continue;
      return x;
    }
    if (safe(() => x.getComponent("minecraft:health"), undefined)) return x;
  }
  return null;
}

const DETONATION_REPORTS = {
  target: (st, p) => `§a[БПЛА] ${st.callsign} поразил цель (${fmtPos(p)}).`,
  collision: (st, p) => `§6[БПЛА] ${st.callsign} столкнулся с препятствием у ${fmtPos(p)}.`,
  entity: (st, p, who) => `§6[БПЛА] ${st.callsign} подорван при контакте${who ? ` с «${who}»` : ""} у ${fmtPos(p)}.`,
  crash: (st, p) => `§c[БПЛА] Сбитый ${st.callsign} упал у ${fmtPos(p)}.`,
  self: (st, p) => `§e[БПЛА] ${st.callsign} самоликвидирован у ${fmtPos(p)}.`,
};

/**
 * Подрыв дрона: эффекты, createExplosion, удаление зоны тиков, remove().
 * Порядок выбран так, чтобы зона тиков была удалена в любом случае
 * (finally), даже если одна из предыдущих операций завершилась ошибкой.
 */
function detonate(st, at, reason, victim) {
  if (st.dead) return;
  st.dead = true;
  st.launched = false;
  const e = st.entity;
  const p = at && isPoint(at) ? vcopy(at) : vcopy(st.pos);
  let dim;
  try {
    dim = isValid(e) ? e.dimension : world.getDimension(st.dimId);
  } catch {
    dim = undefined;
  }
  try {
    if (dim) playExplosionFx(dim, st.typeId, p);
    // Дрон удаляется до взрыва, чтобы взрыв не взаимодействовал с его сущностью.
    if (isValid(e)) {
      setDP(e, DP.LAUNCHED, false);
      e.remove();
    }
    if (dim) dim.createExplosion(p, st.cfg.power, { breaksBlocks: true, causesFire: true });
  } catch (err) {
    logError(`detonate(${st.callsign})`, err);
  } finally {
    TickingAreas.remove(st.id); // tickingarea remove drone_<entityId>
    engineCleanup(st);
    RESERVED.delete(st.id);
    DRONES.delete(st.id);
  }
  const owner = findPlayerByName(st.owner);
  if (owner) {
    const who = victim
      ? safe(() => (victim.typeId === "minecraft:player" ? victim.name : victim.typeId.replace(/^minecraft:/, "")), "")
      : "";
    msg(owner, (DETONATION_REPORTS[reason] ?? DETONATION_REPORTS.collision)(st, p, who));
  }
}

/** Попадание по летящему дрону (удар, снаряд, урон): дрон сбит и падает. */
function shootDown(entity, attacker) {
  if (!isValid(entity) || !DRONE_TYPES[entity.typeId]) return;
  const st = DRONES.get(entity.id) ?? (getDP(entity, DP.LAUNCHED) === true ? registerDrone(entity) : null);
  if (!st || !st.launched || st.hit || st.dead) return;
  st.hit = true;
  st.hitPitch = st.pitch;
  setDP(entity, DP.HIT, true);
  const owner = findPlayerByName(st.owner);
  const by = attacker && isValid(attacker) && attacker.typeId === "minecraft:player" ? ` (${attacker.name})` : "";
  if (owner) msg(owner, `§c[БПЛА] ${st.callsign} сбит${by}!`);
}

// ---------------------------------------------------------------------------
// Зона тиков следует за дроном
// ---------------------------------------------------------------------------
/**
 * Раз в CONFIG.AREA_CHECK_INTERVAL тиков (у каждого дрона свой сдвиг)
 * считаем «идеальный» центр: позиция + упреждение по курсу. Если он ушёл от
 * текущего центра зоны дальше CONFIG.AREA_RECENTER_DIST, зона переносится.
 * При радиусе 2 чанка дрон всегда остаётся внутри, а чанки впереди
 * загружаются заранее.
 */
function areaFollow(st, now) {
  if ((now + st.phase) % CONFIG.AREA_CHECK_INTERVAL !== 0) return;
  const lead = st.lastDir ? CONFIG.AREA_LEAD_BLOCKS : 0;
  const ideal = {
    x: st.pos.x + (st.lastDir ? st.lastDir.x : 0) * lead,
    y: st.pos.y,
    z: st.pos.z + (st.lastDir ? st.lastDir.z : 0) * lead,
  };
  const rec = TickingAreas.get(st.id);
  if (!rec) {
    if (now < st.areaRetryAt) return;
    if (TickingAreas.add(st.id, st.dimId, ideal)) return;
    st.areaRetryAt = now + CONFIG.AREA_RETRY_INTERVAL;
    if (!st.areaWarned) {
      st.areaWarned = true;
      const owner = findPlayerByName(st.owner);
      if (owner) {
        msg(
          owner,
          `§e[БПЛА] ${st.callsign}: нет свободной зоны тиков (лимит ${CONFIG.MAX_DRONE_AREAS}). ` +
            "Дрон летит без неё и будет повторять попытку.",
        );
      }
    }
    return;
  }
  if (Math.hypot(ideal.x - (rec.x + 0.5), ideal.z - (rec.z + 0.5)) >= CONFIG.AREA_RECENTER_DIST) {
    if (!TickingAreas.move(st.id, st.dimId, ideal)) st.areaRetryAt = now + CONFIG.AREA_RETRY_INTERVAL;
  }
}

/**
 * Уборка зон: удаляет зоны, дрон которых больше не летит (подорван, удалён,
 * исчез при сбое). Возвращает число удалённых зон.
 */
function areaHousekeeping() {
  TickingAreas.load();
  let removed = 0;
  for (const [id] of [...TickingAreas.records]) {
    const st = DRONES.get(id);
    if (st && st.launched && !st.dead && isValid(st.entity)) continue;
    // Дрон мог загрузиться, но ещё не попасть в реестр.
    const e = safe(() => world.getEntity(id), undefined);
    if (e && isValid(e) && DRONE_TYPES[e.typeId] && getDP(e, DP.LAUNCHED) === true) {
      registerDrone(e);
      continue;
    }
    TickingAreas.remove(id);
    removed++;
  }
  return removed;
}

// ============================================================================
// §8  ПУСКОВЫЕ УСТАНОВКИ (ПУ), БАТАРЕЯ И ПУСК
// ============================================================================
// Правило: одна ПУ вмещает ровно один дрон.
//  • Состояние хранится в динамических свойствах сущности ПУ:
//      loaded_count  — 0 (пусто) или 1 (заряжена);
//      loaded_type   — тип дрона на направляющей;
//      bpla:owner    — игрок, который зарядил ПУ (батарея игрока);
//      bpla:drone_id — сущность дрона, стоящая на направляющей.
//  • Зарядка — клик предметом дрона по ПУ (§10). У заряженной ПУ
//    взаимодействие отменяется, предмет не списывается, в actionbar выводится
//    «§cНа этой установке уже заряжен дрон!». Пустая ПУ списывает 1 предмет
//    из руки, ставит дрон на направляющую и подписывается «§aПУ [Заряжена]».
//  • Батарея — заряженные ПУ игрока в радиусе CONFIG.BATTERY_RADIUS.
//    При пуске K дронов отбирается ровно K ПУ (ближайшие к игроку). Они
//    становятся пустыми, остальные остаются заряженными.
//  • Дрон стартует со своей направляющей: позиция ПУ + подъём, курс ПУ,
//    угол возвышения направляющей. Пуски идут очередью через интервал,
//    который задаётся ползунком в форме пуска (system.runTimeout).
//  • Строй в полёте: «колонна» — все дроны летят одной трассой след в след;
//    «шеренга» — параллельными трассами бок о бок; «клин» — ведущий впереди,
//    ведомые парами по бокам. Разброс раскладывает точки удара по той же
//    схеме строя (0 — все дроны в одну точку).

const LDP = { LOADED: "loaded_count", TYPE: "loaded_type", OWNER: "bpla:owner", DRONE: "bpla:drone_id" };
const LAUNCHER_TAG_LOADED = "§aПУ [Заряжена]";
const LAUNCHER_TAG_EMPTY = "§7ПУ [Пусто]";
/** ПУ, уже назначенные в идущий залп и ещё не отстрелявшиеся. */
const LAUNCHERS_BUSY = new Set();

function actionbar(player, text) {
  try {
    if (isValid(player)) player.onScreenDisplay.setActionBar(text);
  } catch {}
}

/**
 * Положение дрона на направляющей ПУ: вынос вперёд по курсу ПУ и подъём по Y
 * (cfg.mount), курс ПУ, угол возвышения направляющей.
 */
function railPose(launcher, typeId) {
  const cfg = DRONE_TYPES[typeId] ?? DRONE_TYPES["rocket:missile3"];
  const ll = launcher.location,
    yaw = launcher.getRotation().y,
    rad = yaw * RAD,
    m = cfg.mount;
  return { pos: { x: ll.x - Math.sin(rad) * m.z, y: ll.y + m.y, z: ll.z + Math.cos(rad) * m.z }, yaw, pitch: m.p };
}

/** Дрон, стоящий на направляющей (по связи bpla:drone_id), если он жив и не запущен. */
function railDroneOf(launcher) {
  const id = getDP(launcher, LDP.DRONE);
  if (typeof id !== "string" || !id) return null;
  const e = safe(() => world.getEntity(id), undefined);
  return e && isValid(e) && DRONE_TYPES[e.typeId] && !isDroneLaunched(e) ? e : null;
}

/**
 * Состояние ПУ. ПУ из старых миров (без loaded_count) при первом обращении
 * получают статус по факту: стоит ли рядом не запущенный дрон.
 */
function launcherState(launcher) {
  let loaded = getDP(launcher, LDP.LOADED);
  if (loaded === undefined) {
    const legacy = safe(
      () =>
        launcher.dimension
          .getEntities({ location: launcher.location, maxDistance: 3, families: ["rocket"] })
          .find((e) => DRONE_TYPES[e.typeId] && !isDroneLaunched(e) && typeof getDP(e, DP.MOUNT_YAW) === "number"),
      undefined,
    );
    if (legacy) {
      setDP(legacy, DP.LAUNCHER_ID, launcher.id);
      markLauncherLoaded(launcher, legacy.typeId, "", legacy.id);
    } else markLauncherEmpty(launcher);
    loaded = getDP(launcher, LDP.LOADED);
  }
  return {
    loaded: loaded === 1,
    type: String(getDP(launcher, LDP.TYPE) ?? ""),
    owner: String(getDP(launcher, LDP.OWNER) ?? ""),
  };
}

function markLauncherLoaded(launcher, typeId, owner, droneId) {
  setDP(launcher, LDP.LOADED, 1);
  setDP(launcher, LDP.TYPE, typeId);
  setDP(launcher, LDP.OWNER, owner);
  setDP(launcher, LDP.DRONE, droneId || undefined);
  try {
    launcher.nameTag = LAUNCHER_TAG_LOADED;
  } catch {}
}

function markLauncherEmpty(launcher) {
  setDP(launcher, LDP.LOADED, 0);
  setDP(launcher, LDP.TYPE, undefined);
  setDP(launcher, LDP.DRONE, undefined);
  try {
    launcher.nameTag = LAUNCHER_TAG_EMPTY;
  } catch {}
}

/** Ставит сущность дрона на направляющую ПУ и связывает их. */
function placeOnRail(launcher, entity, typeId) {
  const pose = railPose(launcher, typeId);
  entity.teleport(pose.pos, { rotation: { x: pose.pitch, y: pose.yaw } });
  setDP(entity, DP.MOUNT_YAW, pose.yaw);
  setDP(entity, DP.MOUNT_PITCH, pose.pitch);
  writeJSON(entity, DP.MOUNT_POS, pose.pos);
  setDP(entity, DP.LAUNCHER_ID, launcher.id);
  safe(() => entity.triggerEvent("rocket:mount"));
  const st = registerDrone(entity);
  if (st) {
    st.mount = { yaw: pose.yaw, pitch: pose.pitch, pos: pose.pos };
    st.pos = vcopy(pose.pos);
  }
  return pose;
}

/** Создаёт дрон прямо на направляющей ПУ (не в воздухе). */
function spawnOnRail(launcher, typeId) {
  const pose = railPose(launcher, typeId);
  let e;
  try {
    e = launcher.dimension.spawnEntity(typeId, pose.pos);
  } catch (err) {
    logError("spawnOnRail", err);
    return null;
  }
  // Связь с ПУ ставится сразу: обработчик появления дронов (§10) не должен трогать этот дрон.
  setDP(e, DP.LAUNCHER_ID, launcher.id);
  placeOnRail(launcher, e, typeId);
  return e;
}

// ---------------------------------------------------------------------------
// Инвентарь
// ---------------------------------------------------------------------------
function inventoryOf(player) {
  return safe(() => player.getComponent("minecraft:inventory").container, undefined);
}

function heldItemId(player) {
  const inv = inventoryOf(player);
  return safe(() => inv.getItem(player.selectedSlotIndex)?.typeId, undefined);
}

function isCreative(player) {
  return safe(() => player.getGameMode(), GameMode.survival) === GameMode.creative;
}

/** Списывает 1 предмет itemId из руки. В творческом режиме не списывает (см. CONFIG.CONSUME_IN_CREATIVE). */
function consumeHeld(player, itemId) {
  const inv = inventoryOf(player);
  if (!inv) return false;
  const slot = player.selectedSlotIndex;
  const it = safe(() => inv.getItem(slot), undefined);
  if (!it || it.typeId !== itemId) return false;
  if (isCreative(player) && !CONFIG.CONSUME_IN_CREATIVE) return true;
  try {
    if (it.amount <= 1) inv.setItem(slot, undefined);
    else {
      it.amount -= 1;
      inv.setItem(slot, it);
    }
    return true;
  } catch {
    return false;
  }
}

/** Отдаёт предмет игроку: в инвентарь, а если он полон — на землю. */
function giveItem(player, itemId) {
  if (!isValid(player)) return;
  try {
    const rest = inventoryOf(player)?.addItem(new ItemStack(itemId, 1));
    if (rest) player.dimension.spawnItem(rest, player.location);
  } catch {}
}

// ---------------------------------------------------------------------------
// Зарядка и разрядка ПУ
// ---------------------------------------------------------------------------
/** Зарядка ПУ предметом дрона из руки игрока. Возвращает true, если ПУ заряжена. */
function loadLauncher(player, launcher, itemId) {
  const typeId = ITEM_TO_DRONE[itemId];
  if (!typeId || !isValid(player) || !isValid(launcher)) return false;
  if (launcherState(launcher).loaded || LAUNCHERS_BUSY.has(launcher.id)) {
    actionbar(player, "§cНа этой установке уже заряжен дрон!");
    return false;
  }
  if (!consumeHeld(player, itemId)) {
    actionbar(player, "§cВозьмите предмет дрона в руку.");
    return false;
  }
  const drone = spawnOnRail(launcher, typeId);
  markLauncherLoaded(launcher, typeId, player.name, drone ? drone.id : "");
  try {
    launcher.runCommand("playsound armor.equip_iron @a ~ ~ ~ 1.0 0.8");
  } catch {}
  actionbar(player, `§aПУ заряжена: ${DRONE_TYPES[typeId].name}`);
  return true;
}

/** Разрядка: дрон снимается с направляющей и возвращается игроку предметом. */
function unloadLauncher(player, launcher) {
  if (!isValid(launcher)) return false;
  const s = launcherState(launcher);
  if (!s.loaded || LAUNCHERS_BUSY.has(launcher.id)) return false;
  const drone = railDroneOf(launcher);
  if (drone) {
    const st = DRONES.get(drone.id);
    if (st) forgetDrone(st);
    safe(() => drone.remove());
  }
  markLauncherEmpty(launcher);
  if (DRONE_TYPES[s.type]) giveItem(player, DRONE_TYPES[s.type].item);
  return true;
}

// ---------------------------------------------------------------------------
// Батарея игрока
// ---------------------------------------------------------------------------
/**
 * Сканирует ПУ вокруг игрока (радиус CONFIG.BATTERY_RADIUS).
 * ready — заряженные ПУ этого игрока (или без владельца), ближайшие первыми;
 * empty — пустые; busy — уже назначенные в идущий залп.
 */
function scanBattery(player) {
  const out = { ready: [], empty: [], busy: 0 };
  if (!isValid(player)) return out;
  const origin = player.location;
  let list = [];
  try {
    list = player.dimension.getEntities({
      type: LAUNCHER_TYPE,
      location: origin,
      maxDistance: CONFIG.BATTERY_RADIUS,
    });
  } catch {}
  for (const l of list) {
    if (!isValid(l)) continue;
    if (LAUNCHERS_BUSY.has(l.id)) {
      out.busy++;
      continue;
    }
    const s = launcherState(l);
    const entry = { launcher: l, id: l.id, type: s.type, dist: vdist(l.location, origin) };
    if (s.loaded && DRONE_TYPES[s.type]) {
      if (!s.owner || s.owner === player.name) out.ready.push(entry);
    } else out.empty.push(entry);
  }
  out.ready.sort((a, b) => a.dist - b.dist);
  return out;
}

// ---------------------------------------------------------------------------
// Маршрут полёта
// ---------------------------------------------------------------------------
const lerpXZ = (a, b, t, y) => ({ x: a.x + (b.x - a.x) * t, y, z: a.z + (b.z - a.z) * t });

/**
 * Точка цели для полёта: центр блока. Если высота не задана (y: null), берётся
 * рельеф (если чанк загружен), а точка помечается auto: в полёте высота
 * уточнится заново (§7).
 */
function resolveTargetPoint(t, dimId, fallbackY) {
  const x = Math.floor(t.x) + 0.5,
    z = Math.floor(t.z) + 0.5;
  if (Number.isFinite(t.y)) return { x, y: Math.floor(t.y) + 0.5, z };
  const ground = terrainHeight(dimId, x, z);
  return { x, y: (ground ?? Math.floor(fallbackY)) + 0.5, z, auto: true };
}

/**
 * Полётный маршрут от точки старта по плану:
 *   набор высоты эшелона → путевые точки W1..Wn → точка захода → пикирование на цель.
 * Точка набора высоты стоит на курсе к первой точке и позволяет дрону сначала
 * выйти на эшелон. Точка захода находится на высоте последнего участка,
 * примерно под 45° к цели. climb:false (коррекция в полёте) — без набора высоты.
 */
function buildFlightRoute(start, plan, dimId, opts = {}) {
  const [minY, maxY] = dimLimits(dimId);
  const fixY = (y) => clamp(y, minY + 2, maxY - 3);
  const echelon = fixY(Number(plan.echelon) || CONFIG.DEFAULT_ECHELON);
  const off = opts.targetOffset ?? { x: 0, z: 0 };
  const target = resolveTargetPoint(
    { ...plan.target, x: plan.target.x + off.x, z: plan.target.z + off.z },
    dimId,
    start.y,
  );
  const wps = (plan.waypoints ?? [])
    .filter(isPoint)
    .map((w) => ({ x: Math.floor(w.x) + 0.5, y: fixY(w.y), z: Math.floor(w.z) + 0.5 }));
  const route = [];

  const first = wps[0] ?? target;
  const cruiseY = wps.length ? wps[0].y : echelon;
  if (opts.climb !== false) {
    const d = hdist(start, first);
    const climbDist = clamp((cruiseY - start.y) / Math.tan(22 * RAD), 20, 120);
    if (cruiseY - start.y > 6 && climbDist < d - 10) route.push(lerpXZ(start, first, climbDist / d, cruiseY));
  }
  route.push(...wps);
  // Строй: трасса дрона смещается вбок от общей (перпендикулярно местному курсу).
  // Точка захода строится ниже уже от смещённой трассы к своей точке удара.
  if (opts.lateral) offsetTrack(route, start, target, opts.lateral);

  const lastY = wps.length ? wps[wps.length - 1].y : echelon;
  const last = route.length ? route[route.length - 1] : { x: start.x, y: lastY, z: start.z };
  const dist = hdist(last, target);
  const approach = clamp(lastY - target.y, 16, 60);
  if (dist > approach + 12) route.push(lerpXZ(target, last, approach / dist, lastY));

  route.push(target);
  return route.map((p) => (p.auto ? { ...roundPoint(p), auto: true } : roundPoint(p)));
}

/** Сдвигает промежуточные точки вбок на lateral блоков (вправо — плюс) относительно направления трассы в каждой точке. */
function offsetTrack(points, start, target, lateral) {
  const shifts = points.map((p, i) => {
    const prev = i === 0 ? start : points[i - 1];
    const next = i === points.length - 1 ? target : points[i + 1];
    const d = horizontalDir(prev, next);
    return { x: -d.z * lateral, z: d.x * lateral };
  });
  points.forEach((p, i) => {
    p.x += shifts[i].x;
    p.z += shifts[i].z;
  });
}

/** Горизонтальный единичный вектор from → to (по умолчанию — на юг, +Z). */
function horizontalDir(from, to) {
  const dx = to.x - from.x,
    dz = to.z - from.z,
    l = Math.hypot(dx, dz);
  return l > 1e-6 ? { x: dx / l, z: dz / l } : { x: 0, z: 1 };
}

// ---------------------------------------------------------------------------
// Строй залпа
// ---------------------------------------------------------------------------
/** Варианты строя (порядок совпадает с выпадающим списком формы пуска). */
const FORMATIONS = [
  { id: "column", name: "Колонна (след в след)" },
  { id: "line", name: "Шеренга (параллельные курсы)" },
  { id: "wedge", name: "Клин (ведущий + пары)" },
];

/**
 * Слоты строя: lat — смещение вбок (в шагах строя, вправо — плюс), back — назад
 * вдоль курса, rank — очередь пуска (пуск через rank × интервал).
 * В клине пары ведомых стартуют одновременно.
 */
function formationSlots(kind, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    if (kind === "line") out.push({ lat: i - (n - 1) / 2, back: 0, rank: i });
    else if (kind === "wedge") {
      const k = Math.ceil(i / 2);
      out.push({ lat: i === 0 ? 0 : i % 2 === 1 ? -k : k, back: -k, rank: k });
    } else out.push({ lat: 0, back: -i, rank: i });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Старт одного дрона
// ---------------------------------------------------------------------------
/**
 * Переводит сущность дрона в полёт по маршруту: заполняет состояние, пишет
 * данные в сущность, включает группу компонентов rocket:route_ticking
 * (без гравитации и коллизий), создаёт зону тиков и проигрывает эффекты старта.
 * opts: { route, owner, group, echelon, fromLauncher }
 */
function startFlight(entity, opts) {
  if (!isValid(entity)) return null;
  const st = registerDrone(entity);
  if (!st) return null;
  const cfg = st.cfg;
  st.launched = true;
  st.hit = false;
  st.dead = false;
  st.route = (opts.route ?? []).filter(isPoint).map((p) => (p.auto ? { ...roundPoint(p), auto: true } : roundPoint(p)));
  st.owner = opts.owner ?? "";
  st.group = opts.group ?? "";
  st.echelon = Number(opts.echelon) || CONFIG.DEFAULT_ECHELON;
  st.callsign = `${cfg.short}-${nextSequence("bpla:callsign_seq")}`;
  st.flightTicks = 0;
  st.turned = 0;
  st.wpBest = Infinity;
  st.yawRate = 0;
  st.spdFactor = 1;
  st.snd = 0;
  st.hitPitch = undefined;
  st.lastDir = null;
  st.areaRetryAt = 0;
  st.areaWarned = false;
  st.pos = vcopy(entity.location);
  st.dimId = safe(() => entity.dimension.id, st.dimId);

  const onRail = !!opts.fromLauncher && !!st.mount;
  if (onRail) {
    st.spoolMax = cfg.spool;
    st.spoolTicks = 0;
    st.blockGrace = CONFIG.LAUNCHER_BLOCK_GRACE;
    st.yaw = st.mount.yaw;
    st.pitch = st.mount.pitch;
    if (st.mount.pos) st.pos = vcopy(st.mount.pos);
  } else {
    const r = safe(() => entity.getRotation(), { x: 0, y: 0 });
    st.spoolMax = 0;
    st.spoolTicks = 0;
    st.blockGrace = CONFIG.FREE_LAUNCH_BLOCK_GRACE;
    st.yaw = r.y;
    st.pitch = r.x;
  }
  st.entityGrace = CONFIG.ENTITY_COLLISION_GRACE;

  persistFlight(st);
  try {
    entity.triggerEvent("rocket:route_start");
  } catch {}

  // Зона тиков создаётся сразу при старте: tickingarea add circle X Y Z 2 drone_<id>.
  if (!TickingAreas.add(st.id, st.dimId, st.pos)) st.areaRetryAt = system.currentTick + 1;
  playLaunchFx(st);
  return st;
}

/**
 * Пуск с одной ПУ. В полёт уходит дрон на направляющей; если его нет
 * (снят командой и т.п.), он создаётся на направляющей. ПУ становится пустой.
 */
function fireLauncher(launcherId, owner, plan, group, flight = {}) {
  LAUNCHERS_BUSY.delete(launcherId);
  const launcher = safe(() => world.getEntity(launcherId), undefined);
  if (!launcher || !isValid(launcher)) return null;
  const s = launcherState(launcher);
  if (!s.loaded || !DRONE_TYPES[s.type]) return null;
  let drone = railDroneOf(launcher);
  if (!drone || drone.typeId !== s.type) drone = spawnOnRail(launcher, s.type);
  if (!drone) return null;
  const pose = placeOnRail(launcher, drone, s.type);
  markLauncherEmpty(launcher);
  const route = buildFlightRoute(pose.pos, plan, launcher.dimension.id, flight);
  return startFlight(drone, { route, owner, group, echelon: plan.echelon, fromLauncher: true });
}

/**
 * Залп: K выбранных ПУ стреляют очередью.
 * picks — элементы scanBattery().ready.
 * opts: { interval (тиков между пусками), formation ("column" | "line" | "wedge"), spread (блоков) }.
 */
function launchSalvo(player, picks, plan, opts = {}) {
  if (!picks.length) return 0;
  const owner = player.name;
  const n = picks.length;
  const group = n > 1 ? `З-${nextSequence("bpla:group_seq")}` : "";
  const snapshot = JSON.parse(JSON.stringify(plan));
  const interval = clamp(Math.round(Number(opts.interval ?? CONFIG.SALVO_INTERVAL)), 0, CONFIG.SALVO_INTERVAL_MAX);
  const formation = FORMATIONS.some((f) => f.id === opts.formation) ? opts.formation : "column";
  const spread = clamp(Number(opts.spread) || 0, 0, CONFIG.SPREAD_MAX);

  // Общий курс залпа: от центра батареи к первой точке маршрута. По нему
  // раскладываются трассы строя. Курс захода на цель задаёт раскладку ударов.
  const locs = picks.map((p) => safe(() => p.launcher.location, player.location));
  const origin = { x: locs.reduce((s, l) => s + l.x, 0) / n, y: 0, z: locs.reduce((s, l) => s + l.z, 0) / n };
  const hdg = horizontalDir(origin, snapshot.waypoints[0] ?? snapshot.target);
  const right = { x: -hdg.z, z: hdg.x };
  const appr = horizontalDir(snapshot.waypoints[snapshot.waypoints.length - 1] ?? origin, snapshot.target);
  const apprRight = { x: -appr.z, z: appr.x };

  const slots = formationSlots(formation, n);
  const mLat = slots.reduce((s, q) => s + q.lat, 0) / n;
  const mBack = slots.reduce((s, q) => s + q.back, 0) / n;
  // ПУ слева по курсу получают левые трассы, а ПУ справа — правые: трассы не пересекаются.
  // В колонне очередь идёт от ближней к игроку ПУ.
  let pairs;
  if (formation === "column") pairs = picks.map((p, i) => ({ pick: p, slot: slots[i] }));
  else {
    const side = (i) => (locs[i].x - origin.x) * right.x + (locs[i].z - origin.z) * right.z;
    const order = picks.map((p, i) => i).sort((a, b) => side(a) - side(b));
    const bySlot = slots.slice().sort((a, b) => a.lat - b.lat);
    pairs = order.map((pi, k) => ({ pick: picks[pi], slot: bySlot[k] }));
  }
  pairs.sort((a, b) => a.slot.rank - b.slot.rank);

  pairs.forEach(({ pick, slot }, i) => {
    LAUNCHERS_BUSY.add(pick.id);
    const flight = {
      lateral: slot.lat * CONFIG.FORMATION_SPACING,
      targetOffset: {
        x: (apprRight.x * (slot.lat - mLat) + appr.x * (slot.back - mBack)) * spread,
        z: (apprRight.z * (slot.lat - mLat) + appr.z * (slot.back - mBack)) * spread,
      },
    };
    const fire = () => {
      const st = fireLauncher(pick.id, owner, snapshot, group, flight);
      const pl = findPlayerByName(owner);
      if (!st) msg(pl, `§e[БПЛА] ПУ №${i + 1} недоступна (разряжена или уничтожена), пуск пропущен.`);
      else actionbar(pl, `§aПуск ${i + 1}/${n}: ${st.callsign}`);
    };
    const delay = slot.rank * interval;
    if (delay === 0) fire();
    else system.runTimeout(fire, delay);
  });

  RouteHistory.push(player, snapshot);
  const t = snapshot.target;
  const fname = FORMATIONS.find((f) => f.id === formation).name;
  msg(
    player,
    `§a[БПЛА] ${n > 1 ? `Залп ${group}` : "Пуск"}: ${n} дрон(ов), точек маршрута: ${snapshot.waypoints.length}, ` +
      `цель X: ${Math.floor(t.x)}, Z: ${Math.floor(t.z)}` +
      (n > 1 ? ` §7(${fname}, интервал ${interval} тиков, разброс ${spread} бл.)` : ""),
  );
  return n;
}

/**
 * Пуск конкретного дрона (клик по дрону на ПУ). Дрон на ПУ стреляет со своей
 * направляющей. Дрон без ПУ (из старых миров) взлетает с места.
 */
function launchDrone(player, drone, plan) {
  if (!isValid(drone) || isDroneLaunched(drone)) return null;
  const lid = getDP(drone, DP.LAUNCHER_ID);
  const launcher = typeof lid === "string" ? safe(() => world.getEntity(lid), undefined) : undefined;
  let st;
  if (launcher && isValid(launcher) && launcherState(launcher).loaded) {
    st = fireLauncher(launcher.id, player.name, plan, "");
  } else {
    const route = buildFlightRoute(drone.location, plan, drone.dimension.id);
    st = startFlight(drone, { route, owner: player.name, echelon: plan.echelon, fromLauncher: true });
  }
  if (st) RouteHistory.push(player, plan);
  return st;
}

/**
 * Коррекция цели в полёте: новый маршрут от текущей позиции дрона до цели
 * target = {x, y|null, z} на его высоте эшелона.
 */
function retargetDrone(st, target) {
  if (!st || st.dead || st.hit || !st.launched || !isValid(st.entity)) return false;
  const plan = { echelon: Math.max(st.echelon, st.pos.y), waypoints: [], target };
  st.route = buildFlightRoute(st.pos, plan, st.dimId, { climb: false });
  st.turned = 0;
  st.wpBest = Infinity;
  persistRoute(st);
  return true;
}
// ============================================================================
// §9  UI-ПЛАНШЕТ (@minecraft/server-ui)
// ============================================================================
// Экраны:
//   Главное меню
//    ├─ Пуск: батарея (готовые ПУ) → тип дронов → ползунок 1..N_ready → залп очередью
//    ├─ Маршрут и цель: цепочка «Старт (ПУ) -> Точка 1 -> ... -> Конечная цель»;
//    │   цель и путевые точки ставятся через карту, точки можно
//    │   редактировать, удалять, маршрут — очистить
//    ├─ Тактическая карта: сетка с ПУ, точками, целью, дронами и игроком;
//    │   масштаб, сдвиг по сторонам света, выбор клетки, переходы к объектам
//    ├─ Активные дроны: список → карточка → новая цель на карте или подрыв
//    ├─ Шаблоны целей, Архив маршрутов, Служебное (зоны тиков)
// Формы собираются обёртками ModalBuilder и MenuBuilder: поля адресуются по
// ключам, а не по индексам, поэтому необязательные поля не сбивают разбор ответа.

const UI_BUSY = new Set(); // игроки, у которых сейчас открыт планшет
const LAST_BLOCK_CLICK = new Map(); // playerId -> тик последнего ПКМ планшетом по блоку

/** Показывает форму. Если игрок занят (открыт чат или инвентарь), повторяет попытку. */
async function showForm(player, form) {
  for (let attempt = 0; attempt < 10; attempt++) {
    if (!isValid(player)) return undefined;
    let res;
    try {
      res = await form.show(player);
    } catch (err) {
      logError("form.show", err);
      return undefined;
    }
    if (res.canceled && res.cancelationReason === FormCancelationReason.UserBusy) {
      await system.waitTicks(5);
      continue;
    }
    return res;
  }
  return undefined;
}

/** ModalFormData с именованными полями. */
class ModalBuilder {
  constructor(title) {
    this.form = new ModalFormData().title(title);
    this.keys = [];
  }
  dropdown(key, label, options, def = 0) {
    this.form.dropdown(label, options, clamp(def | 0, 0, Math.max(0, options.length - 1)));
    this.keys.push(key);
    return this;
  }
  slider(key, label, min, max, step, def) {
    this.form.slider(label, min, max, step, clamp(Number(def) || min, min, max));
    this.keys.push(key);
    return this;
  }
  text(key, label, placeholder, def = "") {
    this.form.textField(label, placeholder, String(def ?? ""));
    this.keys.push(key);
    return this;
  }
  toggle(key, label, def = false) {
    this.form.toggle(label, !!def);
    this.keys.push(key);
    return this;
  }
  submit(text) {
    this.form.submitButton(text);
    return this;
  }
  /** Возвращает объект {ключ: значение} или null, если форму закрыли. */
  async show(player) {
    const res = await showForm(player, this.form);
    if (!res || res.canceled || !res.formValues) return null;
    const out = {};
    this.keys.forEach((k, i) => (out[k] = res.formValues[i]));
    return out;
  }
}

/** ActionFormData, у каждой кнопки свой обработчик. */
class MenuBuilder {
  constructor(title, body) {
    this.form = new ActionFormData().title(title);
    if (body) this.form.body(body);
    this.actions = [];
  }
  button(text, icon, action) {
    if (icon) this.form.button(text, icon);
    else this.form.button(text);
    this.actions.push(action);
    return this;
  }
  async show(player) {
    const res = await showForm(player, this.form);
    if (!res || res.canceled || res.selection === undefined) return;
    const action = this.actions[res.selection];
    if (action) await action();
  }
}

/** Подтверждение через две кнопки ActionForm (индексы кнопок однозначны). */
async function confirmAction(player, title, body, yesText) {
  let ok = false;
  await new MenuBuilder(title, body)
    .button(yesText, undefined, () => {
      ok = true;
    })
    .button("Отмена", undefined, () => {})
    .show(player);
  return ok;
}

/** Открывает экран планшета. Пока открыт один экран, второй не откроется. */
function openTablet(player, screen) {
  if (!isValid(player) || UI_BUSY.has(player.id)) return;
  const pid = player.id;
  UI_BUSY.add(pid);
  (async () => {
    try {
      await screen(player);
    } catch (err) {
      logError("UI", err);
    } finally {
      UI_BUSY.delete(pid);
    }
  })();
}

/** Блок, на который смотрит игрок (до 256 блоков). */
function lookAtBlock(player) {
  try {
    const hit = player.getBlockFromViewDirection({ maxDistance: 256, includeLiquidBlocks: true });
    return hit && hit.block ? floorPoint(hit.block.location) : null;
  } catch {
    return null;
  }
}

function flyingDrones() {
  return [...DRONES.values()].filter((st) => st.launched && !st.dead && isValid(st.entity));
}

function canControl(player, st) {
  return !CONFIG.ONLY_OWNER_CAN_CONTROL || !st.owner || st.owner === player.name;
}

const COMPASS = ["С", "СВ", "В", "ЮВ", "Ю", "ЮЗ", "З", "СЗ"];
/** Направление от from к to по сторонам света (север — это -Z). */
function compass(from, to) {
  const a = Math.atan2(to.x - from.x, -(to.z - from.z));
  return COMPASS[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8];
}

/** Подпись цели: «X, Y, Z». Y — число или «рельеф» (с текущей высотой, если чанк загружен). */
function targetCoords(t, dimId) {
  if (Number.isFinite(t.y)) return `${Math.floor(t.x)}, ${Math.floor(t.y)}, ${Math.floor(t.z)}`;
  const g = terrainHeight(dimId, t.x, t.z);
  return `${Math.floor(t.x)}, рельеф${g !== null ? ` ${g}` : ""}, ${Math.floor(t.z)}`;
}

/** Цепочка маршрута: «Старт (ПУ) -> Точка 1 [X, Y, Z] -> ... -> Конечная цель [X, Y, Z]». */
function routeChainLines(plan) {
  const lines = ["§aСтарт (ПУ)"];
  plan.waypoints.forEach((w, i) => lines.push(`§7 -> §eТочка ${i + 1} [${fmtPos(w).split(" ").join(", ")}]`));
  lines.push(
    plan.target ? `§7 -> §cКонечная цель [${targetCoords(plan.target, plan.dim)}]` : "§7 -> §8Конечная цель не задана",
  );
  return lines;
}

function routeShort(plan) {
  if (!plan.target) return plan.waypoints.length ? `точек: ${plan.waypoints.length}, цель не задана` : "не задан";
  return `точек: ${plan.waypoints.length}, цель X: ${Math.floor(plan.target.x)}, Z: ${Math.floor(plan.target.z)}`;
}

// ---------------------------------------------------------------------------
// Главное меню
// ---------------------------------------------------------------------------
async function showMainMenu(player) {
  if (!isValid(player)) return;
  const dimId = player.dimension.id;
  const flying = flyingDrones();
  const own = flying.filter((st) => st.owner === player.name).length;
  const bat = scanBattery(player);
  const plan = RoutePlan.forDimension(player);
  const lines = [
    `§7Измерение: §f${dimName(dimId)}§7, позиция: §f${fmtPos(player.location)}`,
    `§7Батарея (до ${CONFIG.BATTERY_RADIUS} бл.): §aготово ${bat.ready.length}§7, пустых ${bat.empty.length}` +
      (bat.busy ? `, в очереди пуска ${bat.busy}` : ""),
    `§7Маршрут: §f${routeShort(plan)}`,
    `§7В воздухе: §f${flying.length}§7 (ваших: §f${own}§7), зоны тиков: §f${TickingAreas.count()}/${CONFIG.MAX_DRONE_AREAS}`,
  ];
  await new MenuBuilder("§lПланшет БПЛА", lines.join("\n"))
    .button(`§lПуск§r\n§8Готово ПУ: ${bat.ready.length}`, "textures/items/rocket_icon", () => showLaunch(player))
    .button("§lМаршрут и цель§r\n§8Редактор маршрута", "textures/items/remote_icon_waypoint", () =>
      showRouteEditor(player),
    )
    .button("§lТактическая карта§r\n§8Обзор и выбор точек", "textures/items/remote_icon_target", () =>
      showMap(player, { mode: "browse", back: showMainMenu }),
    )
    .button(`§lАктивные дроны (${flying.length})§r\n§8Коррекция цели в полёте`, "textures/items/shahed3_icon", () =>
      showActiveDrones(player),
    )
    .button(`§lШаблоны целей (${Presets.all().length})§r`, undefined, () => showPresets(player))
    .button(`§lАрхив маршрутов (${RouteHistory.all(player).length})§r`, "textures/items/remote_icon_orange", () =>
      showArchive(player),
    )
    .button("§lСлужебное§r\n§8Зоны тиков", "textures/items/launcher_icon", () => showService(player))
    .show(player);
}

// ---------------------------------------------------------------------------
// Тактическая карта
// ---------------------------------------------------------------------------
// Карта — текстовая сетка 15×11 клеток. Каждая клетка — 2 символа одинаковой
// ширины (6 px в шрифте Minecraft), поэтому колонки ровные и клетка почти
// квадратная. Центр карты — курсор. Север сверху, восток справа.
// Столбцы подписаны буквами A–P (без I), строки — номерами 01–11.
const MAP_COLS = 15;
const MAP_ROWS = 11;
const MAP_CX = 7;
const MAP_CY = 5;
const MAP_COL_LABELS = "ABCDEFGHJKLMNOP";

function mapScale(view) {
  return CONFIG.MAP_ZOOMS[view.zoom];
}

function worldToCell(view, p) {
  const s = mapScale(view);
  return { col: Math.round((p.x - view.x) / s) + MAP_CX, row: Math.round((p.z - view.z) / s) + MAP_CY };
}

function cellToWorld(view, col, row) {
  const s = mapScale(view);
  return { x: view.x + (col - MAP_CX) * s, z: view.z + (row - MAP_CY) * s };
}

/** Строит строки карты и список объектов за её краем. */
function renderMap(player, view, plan) {
  const grid = [];
  for (let r = 0; r < MAP_ROWS; r++) grid.push(new Array(MAP_COLS).fill(null));
  const offscreen = [];
  const put = (p, label, color, prio, name) => {
    const { col, row } = worldToCell(view, p);
    if (col < 0 || col >= MAP_COLS || row < 0 || row >= MAP_ROWS) {
      if (name) offscreen.push(`${color}${name}§7 ${Math.round(hdist(view, p))} бл. ${compass(view, p)}`);
      return;
    }
    const cur = grid[row][col];
    if (!cur || cur.prio < prio) grid[row][col] = { label, color, prio };
  };
  const dim = player.dimension;
  const radius = mapScale(view) * Math.hypot(MAP_COLS / 2 + 1, MAP_ROWS / 2 + 1);
  const center = { x: view.x, y: player.location.y, z: view.z };

  put(player.location, "OP", "§b", 2.5, "вы"); // игрок поверх значков ПУ, но под точками и целью
  for (const l of safe(() => dim.getEntities({ type: LAUNCHER_TYPE, location: center, maxDistance: radius }), [])) {
    if (isValid(l)) put(l.location, "PU", launcherState(l).loaded ? "§a" : "§7", 2);
  }
  for (const d of flyingDrones()) if (d.dimId === dim.id) put(d.pos, "DR", "§d", 3);
  plan.waypoints.forEach((w, i) => put(w, `W${i + 1}`, "§e", 4, `W${i + 1}`));
  if (plan.target) put(plan.target, "XX", "§c", 5, "цель");

  const under = grid[MAP_CY][MAP_CX];
  grid[MAP_CY][MAP_CX] = { label: under ? under.label : "##", color: "§6", prio: 9 };

  const header = "§8++" + [...MAP_COL_LABELS].map((ch, i) => `${i === MAP_CX ? "§6" : "§7"}${ch}§8-`).join("");
  const rows = grid.map(
    (cells, r) =>
      `${r === MAP_CY ? "§6" : "§7"}${String(r + 1).padStart(2, "0")}` +
      cells.map((cell) => (cell ? cell.color + cell.label : "§8--")).join(""),
  );
  const lines = [header, ...rows];
  if (CONFIG.MAP_AXES) {
    // Справа от карты — схема осей координат. Строки без схемы добиваются пробелами
    // той же ширины (15 пробелов по 4 px = 10 символов по 6 px), чтобы все строки были одной длины.
    const pad = " ".repeat(15);
    for (let i = 0; i < lines.length; i++) lines[i] += `§r  ${MAP_AXES_ROWS[i - 1 - (MAP_CY - 2)] ?? pad}`;
  }
  return { lines, offscreen, under };
}

/**
 * Схема осей координат напротив строк 04–08 карты: вверх — север (-Z),
 * вниз — юг (+Z), влево — запад (-X), вправо — восток (+X).
 * Ширина каждой строки — 60 px: символы по 6 px, пустоты — по 3 пробела на 2 символа.
 */
const MAP_AXES_GAP = " ".repeat(6);
const MAP_AXES_ROWS = [
  `${MAP_AXES_GAP}§e-Z${MAP_AXES_GAP}`,
  `${MAP_AXES_GAP}§7/\\${MAP_AXES_GAP}`,
  "§e-X§7==§f++§7==§e+X",
  `${MAP_AXES_GAP}§7\\/${MAP_AXES_GAP}`,
  `${MAP_AXES_GAP}§e+Z${MAP_AXES_GAP}`,
];

const MAP_MODE_TITLES = {
  browse: "обзор",
  target: "выбор конечной цели",
  waypoint: "новая путевая точка",
  move: "перенос точки",
  retarget: "новая цель для дрона",
};

/**
 * Экран карты. ctx: { mode, back(player), index? (для move: номер точки, -1 — цель), droneId? }.
 * Курсор всегда в центре; «выбор точки» = центр карты в мировых координатах X/Z.
 */
async function showMap(player, ctx) {
  if (!isValid(player)) return;
  const dimId = player.dimension.id;
  const view = MapViews.get(player);
  const plan = RoutePlan.forDimension(player);
  const s = mapScale(view);
  const map = renderMap(player, view, plan);
  const ground = terrainHeight(dimId, view.x, view.z);
  const lines = [
    `§7Режим: §f${MAP_MODE_TITLES[ctx.mode] ?? ctx.mode}`,
    `§7Масштаб: §f1 клетка = ${s} бл.§7, обзор ${s * MAP_COLS}×${s * MAP_ROWS} бл., север сверху`,
    `§fКурсор: §eX: ${view.x}, Z: ${view.z}§7 | рельеф: ${ground !== null ? `Y ${ground}` : "чанк не загружен"}` +
      ` | до вас ${Math.round(hdist(view, player.location))} бл.`,
    "",
    ...map.lines,
    "",
    "§bOP§7 вы  §aPU§7 ПУ заряжена  §7PU§7 пустая  §eW1§7 точка  §cXX§7 цель  §dDR§7 дрон  §6##§7 курсор",
    CONFIG.MAP_AXES ? "§7Оси справа: §e-Z§7 север (вверх), §e+Z§7 юг, §e-X§7 запад, §e+X§7 восток (вправо)" : null,
  ].filter((l) => l !== null);
  if (map.offscreen.length) lines.push(`§7За краем карты: ${map.offscreen.join("§7, ")}`);

  const here = `\n§8X: ${view.x}, Z: ${view.z}`;
  const point = { x: view.x, z: view.z };
  const menu = new MenuBuilder(`Тактическая карта: ${MAP_MODE_TITLES[ctx.mode] ?? ""}`, lines.join("\n"));

  // Действие с точкой под курсором (зависит от режима).
  if (ctx.mode === "target" || ctx.mode === "browse") {
    menu.button(`§2Установить конечную цель здесь${here}`, undefined, () =>
      applyMapPoint(player, ctx, point, "target"),
    );
  }
  if ((ctx.mode === "waypoint" || ctx.mode === "browse") && plan.waypoints.length < CONFIG.MAX_WAYPOINTS) {
    menu.button(`§2Добавить путевую точку W${plan.waypoints.length + 1} здесь${here}`, undefined, () =>
      applyMapPoint(player, ctx, point, "waypoint"),
    );
  }
  if (ctx.mode === "move") {
    const label = ctx.index >= 0 ? `точку W${ctx.index + 1}` : "конечную цель";
    menu.button(`§2Перенести ${label} сюда${here}`, undefined, () => applyMapPoint(player, ctx, point, "move"));
  }
  if (ctx.mode === "retarget") {
    menu.button(`§2Перенацелить дрон сюда${here}`, undefined, () => applyMapPoint(player, ctx, point, "retarget"));
  }

  const reopen = (next) => {
    MapViews.set(player, next);
    return showMap(player, ctx);
  };
  const pan = (dx, dz) =>
    reopen({ ...view, x: view.x + dx * CONFIG.MAP_PAN_CELLS * s, z: view.z + dz * CONFIG.MAP_PAN_CELLS * s });

  menu.button("Выбрать клетку (буква + номер)", undefined, () => showMapCellPicker(player, ctx, view));
  if (view.zoom > 0) {
    menu.button(`Приблизить (+Zoom)\n§81 клетка = ${CONFIG.MAP_ZOOMS[view.zoom - 1]} бл.`, undefined, () =>
      reopen({ ...view, zoom: view.zoom - 1 }),
    );
  }
  if (view.zoom < CONFIG.MAP_ZOOMS.length - 1) {
    menu.button(`Отдалить (-Zoom)\n§81 клетка = ${CONFIG.MAP_ZOOMS[view.zoom + 1]} бл.`, undefined, () =>
      reopen({ ...view, zoom: view.zoom + 1 }),
    );
  }
  menu
    .button("↑ СЕВЕР", undefined, () => pan(0, -1))
    .button("↓ ЮГ", undefined, () => pan(0, 1))
    .button("← ЗАПАД", undefined, () => pan(-1, 0))
    .button("→ ВОСТОК", undefined, () => pan(1, 0))
    .button("К пусковой позиции", "textures/items/launcher_icon", () => reopen({ ...view, ...launchPosition(player) }))
    .button("Перейти к… (вы, прицел, цель, шаблон, координаты)", undefined, () => showMapGoto(player, ctx, view))
    .button("« Назад", undefined, () => ctx.back(player));
  await menu.show(player);
}

/** Центр батареи (заряженные ПУ, иначе все ПУ рядом) или позиция игрока. */
function launchPosition(player) {
  const bat = scanBattery(player);
  const list = bat.ready.length ? bat.ready : bat.empty;
  if (!list.length) return { x: Math.floor(player.location.x), z: Math.floor(player.location.z) };
  let x = 0,
    z = 0;
  for (const it of list) {
    const l = safe(() => it.launcher.location, player.location);
    x += l.x;
    z += l.z;
  }
  return { x: Math.floor(x / list.length), z: Math.floor(z / list.length) };
}

/** Выбор клетки по букве столбца и номеру строки: курсор переходит в центр этой клетки. */
async function showMapCellPicker(player, ctx, view) {
  const r = await new ModalBuilder("Выбор клетки на карте")
    .dropdown("col", "Столбец (буква)", [...MAP_COL_LABELS], MAP_CX)
    .dropdown(
      "row",
      "Строка (номер)",
      Array.from({ length: MAP_ROWS }, (_, i) => String(i + 1).padStart(2, "0")),
      MAP_CY,
    )
    .submit("Перейти")
    .show(player);
  if (r) MapViews.set(player, { ...view, ...cellToWorld(view, r.col, r.row) });
  return showMap(player, ctx);
}

/** Быстрый переход курсора к объектам или к введённым координатам. */
async function showMapGoto(player, ctx, view) {
  const plan = RoutePlan.forDimension(player);
  const go = (p) => {
    MapViews.set(player, { ...view, x: Math.floor(p.x), z: Math.floor(p.z) });
    return showMap(player, ctx);
  };
  const menu = new MenuBuilder("Перейти к…", "§7Курсор карты переместится к выбранному объекту.");
  menu.button("Моя позиция", undefined, () => go(player.location));
  const look = lookAtBlock(player);
  if (look) menu.button(`Блок под прицелом\n§8X: ${look.x}, Z: ${look.z}`, undefined, () => go(look));
  if (plan.target) menu.button("Конечная цель маршрута", undefined, () => go(plan.target));
  plan.waypoints.forEach((w, i) => menu.button(`Точка W${i + 1}`, undefined, () => go(w)));
  for (const p of Presets.all()
    .filter((p) => p.dim === player.dimension.id)
    .slice(0, 20)) {
    menu.button(`Шаблон «${p.name}»\n§8X: ${p.x}, Z: ${p.z}`, undefined, () => go(p));
  }
  menu.button("Ввести X / Z вручную", undefined, async () => {
    const r = await new ModalBuilder("Координаты курсора")
      .text("x", "X (можно ~ от вашей позиции)", "например 120", String(view.x))
      .text("z", "Z (можно ~ от вашей позиции)", "например -340", String(view.z))
      .submit("Перейти")
      .show(player);
    if (!r) return showMap(player, ctx);
    const base = player.location;
    const x = parseCoordinate(r.x, base.x),
      z = parseCoordinate(r.z, base.z);
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      msg(player, "§c[БПЛА] Координаты должны быть числами (можно ~ для относительных).");
      return showMap(player, ctx);
    }
    return go({ x, z });
  });
  menu.button("« К карте", undefined, () => showMap(player, ctx));
  await menu.show(player);
}

/** Ползунок «Высота эшелона» (Y). Возвращает число или null, если форму закрыли. */
async function askEchelon(player, def, title) {
  const [, maxY] = dimLimits(player.dimension.id);
  const note = maxY - 3 < CONFIG.ECHELON_MAX ? ` (здесь не выше ${maxY - 3})` : "";
  const r = await new ModalBuilder(title)
    .slider("y", `Высота эшелона (Y)${note}`, CONFIG.ECHELON_MIN, CONFIG.ECHELON_MAX, 5, def)
    .submit("Готово")
    .show(player);
  return r ? clamp(r.y, CONFIG.ECHELON_MIN, maxY - 3) : null;
}

/** Применение точки, выбранной на карте. */
async function applyMapPoint(player, ctx, point, action) {
  if (hdist(point, player.location) > CONFIG.MAX_RANGE) {
    msg(player, `§c[БПЛА] Точка дальше ${CONFIG.MAX_RANGE} блоков от вас.`);
    return showMap(player, ctx);
  }
  const plan = RoutePlan.forDimension(player);
  const xz = { x: Math.floor(point.x), z: Math.floor(point.z) };

  if (action === "target") {
    plan.target = { x: xz.x, y: null, z: xz.z };
    RoutePlan.set(player, plan);
    msg(player, `§a[БПЛА] Конечная цель: X: ${xz.x}, Z: ${xz.z} (высота по рельефу).`);
    return ctx.mode === "browse" ? showRouteEditor(player) : ctx.back(player);
  }
  if (action === "waypoint") {
    if (plan.waypoints.length >= CONFIG.MAX_WAYPOINTS) {
      msg(player, `§c[БПЛА] В маршруте уже ${CONFIG.MAX_WAYPOINTS} точек.`);
      return showMap(player, ctx);
    }
    const n = plan.waypoints.length + 1;
    const y = await askEchelon(player, plan.echelon, `Путевая точка W${n}`);
    if (y === null) return showMap(player, ctx);
    plan.waypoints.push({ x: xz.x, y, z: xz.z });
    plan.echelon = y;
    RoutePlan.set(player, plan);
    msg(player, `§a[БПЛА] Точка W${n}: X: ${xz.x}, Y: ${y}, Z: ${xz.z}.`);
    return ctx.mode === "browse" ? showRouteEditor(player) : ctx.back(player);
  }
  if (action === "move") {
    if (ctx.index >= 0 && plan.waypoints[ctx.index]) {
      plan.waypoints[ctx.index] = { ...plan.waypoints[ctx.index], x: xz.x, z: xz.z };
      msg(player, `§a[БПЛА] Точка W${ctx.index + 1} перенесена: X: ${xz.x}, Z: ${xz.z}.`);
    } else if (ctx.index === -1 && plan.target) {
      plan.target = { ...plan.target, x: xz.x, z: xz.z };
      msg(player, `§a[БПЛА] Конечная цель перенесена: X: ${xz.x}, Z: ${xz.z}.`);
    }
    RoutePlan.set(player, plan);
    return ctx.back(player);
  }
  if (action === "retarget") return applyRetarget(player, ctx.droneId, { x: xz.x, y: null, z: xz.z }, ctx);
  return ctx.back(player);
}

// ---------------------------------------------------------------------------
// Редактор маршрута
// ---------------------------------------------------------------------------
/** Открывает карту в режиме выбора с курсором на заданной точке. */
function openMapAt(player, focus, ctx) {
  if (focus) {
    const view = MapViews.get(player);
    MapViews.set(player, { ...view, x: Math.floor(focus.x), z: Math.floor(focus.z) });
  }
  return showMap(player, ctx);
}

async function showRouteEditor(player) {
  if (!isValid(player)) return;
  const stored = RoutePlan.get(player);
  const plan = RoutePlan.forDimension(player);
  const lines = [...routeChainLines(plan)];
  if (stored.dim !== plan.dim && RoutePlan.hasPoints(stored))
    lines.push("§6Маршрут из другого измерения здесь не действует.");
  lines.push("", `§7Точек: ${plan.waypoints.length}/${CONFIG.MAX_WAYPOINTS}. Эшелон по умолчанию: Y ${plan.echelon}.`);
  const back = (p) => showRouteEditor(p);
  const lastPoint = plan.waypoints[plan.waypoints.length - 1] ?? plan.target;

  const menu = new MenuBuilder("Маршрут и цель", lines.join("\n"));
  menu.button("§lПоставить конечную цель через карту", "textures/items/remote_icon_target", () =>
    openMapAt(player, plan.target, { mode: "target", back }),
  );
  if (plan.waypoints.length < CONFIG.MAX_WAYPOINTS) {
    menu.button("Добавить путевую точку (Waypoint)", "textures/items/remote_icon_waypoint", () =>
      openMapAt(player, lastPoint, { mode: "waypoint", back }),
    );
  }
  if (RoutePlan.hasPoints(plan)) {
    menu.button("Редактировать точку", undefined, () => showPointPicker(player, "edit"));
    menu.button("Удалить точку", undefined, () => showPointPicker(player, "delete"));
    menu.button("§cОчистить маршрут", undefined, async () => {
      if (await confirmAction(player, "Очистка маршрута", "Удалить все путевые точки и цель?", "§cОчистить")) {
        RoutePlan.set(player, { ...RoutePlan.empty(player.dimension.id), echelon: plan.echelon });
        msg(player, "§e[БПЛА] Маршрут очищен.");
      }
      return showRouteEditor(player);
    });
  }
  if (plan.target) menu.button("§2§lПуск по маршруту", "textures/items/rocket_icon", () => showLaunch(player));
  menu.button("« Назад", undefined, () => showMainMenu(player));
  await menu.show(player);
}

/** Выбор точки маршрута для редактирования или удаления. */
async function showPointPicker(player, action) {
  const plan = RoutePlan.forDimension(player);
  const menu = new MenuBuilder(
    action === "edit" ? "Редактировать точку" : "Удалить точку",
    "§7Выберите точку маршрута.",
  );
  const pick = (index) => () => {
    if (action === "edit") return showPointEdit(player, index);
    const p = RoutePlan.forDimension(player);
    if (index >= 0) p.waypoints.splice(index, 1);
    else p.target = null;
    RoutePlan.set(player, p);
    msg(player, `§e[БПЛА] ${index >= 0 ? `Точка W${index + 1}` : "Конечная цель"} удалена.`);
    return showRouteEditor(player);
  };
  plan.waypoints.forEach((w, i) =>
    menu.button(`§eТочка ${i + 1}§r\n§8[${fmtPos(w).split(" ").join(", ")}]`, undefined, pick(i)),
  );
  if (plan.target) menu.button(`§cКонечная цель§r\n§8[${targetCoords(plan.target, plan.dim)}]`, undefined, pick(-1));
  menu.button("« Назад", undefined, () => showRouteEditor(player));
  await menu.show(player);
}

/** Редактирование точки: перенос на карте или смена высоты. index -1 — конечная цель. */
async function showPointEdit(player, index) {
  const plan = RoutePlan.forDimension(player);
  const pt = index >= 0 ? plan.waypoints[index] : plan.target;
  if (!pt) return showRouteEditor(player);
  const name = index >= 0 ? `Точка W${index + 1}` : "Конечная цель";
  const coords = index >= 0 ? fmtPos(pt).split(" ").join(", ") : targetCoords(pt, plan.dim);
  const back = (p) => showPointEdit(p, index);
  await new MenuBuilder(name, `§f${name}: [${coords}]`)
    .button("Сдвинуть на карте", "textures/items/remote_icon_target", () =>
      openMapAt(player, pt, { mode: "move", index, back }),
    )
    .button(index >= 0 ? "Изменить высоту эшелона (Y)" : "Изменить высоту цели (Y)", undefined, async () => {
      const p = RoutePlan.forDimension(player);
      if (index >= 0) {
        const y = await askEchelon(player, p.waypoints[index].y, name);
        if (y !== null) {
          p.waypoints[index].y = y;
          RoutePlan.set(player, p);
        }
        return showPointEdit(player, index);
      }
      const [minY, maxY] = dimLimits(player.dimension.id);
      const r = await new ModalBuilder("Высота цели")
        .dropdown("mode", "Высота цели", ["По рельефу (авто)", "Задать вручную"], Number.isFinite(p.target.y) ? 1 : 0)
        .text(
          "y",
          `Y вручную (${minY}..${maxY - 1})`,
          "например 64",
          Number.isFinite(p.target.y) ? String(p.target.y) : "",
        )
        .submit("Готово")
        .show(player);
      if (r) {
        if (r.mode === 0) p.target.y = null;
        else {
          const y = Math.floor(Number(String(r.y).trim()));
          if (!Number.isFinite(y) || y < minY || y >= maxY)
            msg(player, `§c[БПЛА] Y должен быть в пределах ${minY}..${maxY - 1}.`);
          else p.target.y = y;
        }
        RoutePlan.set(player, p);
      }
      return showPointEdit(player, index);
    })
    .button("« К маршруту", undefined, () => showRouteEditor(player))
    .show(player);
}

// ---------------------------------------------------------------------------
// Пуск с батареи
// ---------------------------------------------------------------------------
async function showLaunch(player) {
  if (!isValid(player)) return;
  const plan = RoutePlan.forDimension(player);
  if (!plan.target) {
    msg(player, "§e[БПЛА] Сначала поставьте конечную цель на карте.");
    return showRouteEditor(player);
  }
  const bat = scanBattery(player);
  if (!bat.ready.length) {
    actionbar(player, "§cНет готовых к пуску установок!");
    msg(
      player,
      `§c[БПЛА] Нет готовых к пуску установок! §7Зарядите ПУ предметом дрона (радиус ${CONFIG.BATTERY_RADIUS} бл.).`,
    );
    return;
  }
  const byType = new Map();
  for (const r of bat.ready) byType.set(r.type, (byType.get(r.type) ?? 0) + 1);
  const counts = [...byType].map(([t, n]) => `${DRONE_TYPES[t].name} ×${n}`).join(", ");
  const lines = [
    ...routeChainLines(plan),
    "",
    `§7Готово к пуску: §a${bat.ready.length} ПУ§7 (${counts}). Пустых: ${bat.empty.length}.`,
    "§7Дроны стартуют со своих ПУ по очереди. Интервал, строй и разброс задаются на следующем шаге.",
  ];
  const menu = new MenuBuilder("Пуск с батареи", lines.join("\n"));
  menu.button(`§2§lВсе готовые ПУ (${bat.ready.length})`, "textures/items/rocket_icon", () =>
    showLaunchCount(player, null),
  );
  if (byType.size > 1) {
    for (const [t, n] of byType)
      menu.button(`Только ${DRONE_TYPES[t].name} (${n})`, DRONE_TYPES[t].icon, () => showLaunchCount(player, t));
  }
  menu.button("Маршрут и цель", undefined, () => showRouteEditor(player));
  menu.button("« Назад", undefined, () => showMainMenu(player));
  await menu.show(player);
}

/** Количество дронов: ползунок строго 1..N_ready. typeId null — все типы. */
async function showLaunchCount(player, typeId) {
  const pool = () => scanBattery(player).ready.filter((r) => !typeId || r.type === typeId);
  const ready = pool();
  const n = ready.length;
  if (!n) {
    actionbar(player, "§cНет готовых к пуску установок!");
    return showLaunch(player);
  }
  const plan = RoutePlan.forDimension(player);
  const prefs = LaunchPrefs.get(player);
  const fIdx = Math.max(
    0,
    FORMATIONS.findIndex((f) => f.id === prefs.formation),
  );
  const m = new ModalBuilder(`Пуск: готово ${n} ПУ${typeId ? ` (${DRONE_TYPES[typeId].name})` : ""}`);
  if (n > 1) {
    m.slider("count", "Количество дронов для запуска", 1, n, 1, 1)
      .slider(
        "interval",
        "Интервал между пусками, тиков (20 тиков = 1 сек)",
        0,
        CONFIG.SALVO_INTERVAL_MAX,
        2,
        prefs.interval,
      )
      .dropdown(
        "formation",
        "Строй в полёте",
        FORMATIONS.map((f) => f.name),
        fIdx,
      )
      .slider("spread", "Разброс точек удара, блоков (0 = все в одну точку)", 0, CONFIG.SPREAD_MAX, 1, prefs.spread);
  }
  if (!plan.waypoints.length)
    m.slider("echelon", "Высота эшелона (Y)", CONFIG.ECHELON_MIN, CONFIG.ECHELON_MAX, 5, plan.echelon);
  let k = 1;
  const salvo = { ...prefs };
  if (m.keys.length) {
    m.submit("Пуск!");
    const r = await m.show(player);
    if (!r) return showLaunch(player);
    if (n > 1) {
      k = clamp(Math.round(r.count), 1, n);
      salvo.interval = r.interval;
      salvo.formation = (FORMATIONS[r.formation] ?? FORMATIONS[0]).id;
      salvo.spread = r.spread;
      LaunchPrefs.set(player, salvo);
    }
    if (r.echelon !== undefined) {
      plan.echelon = r.echelon;
      RoutePlan.set(player, plan);
    }
  }
  // Батарея могла измениться, пока была открыта форма: отбираем заново.
  const picks = pool().slice(0, k);
  if (picks.length < k) msg(player, `§e[БПЛА] Готово только ${picks.length} ПУ из выбранных ${k}.`);
  if (!picks.length) {
    actionbar(player, "§cНет готовых к пуску установок!");
    return;
  }
  launchSalvo(player, picks, RoutePlan.forDimension(player), salvo);
}

/** Меню ПУ (клик планшетом по ПУ или по дрону на ней). */
async function showLauncherMenu(player, launcher) {
  if (!isValid(player) || !isValid(launcher)) return;
  const s = launcherState(launcher);
  const plan = RoutePlan.forDimension(player);
  const mine = !s.owner || s.owner === player.name;
  const lines = [
    `§7Статус: ${s.loaded ? `§aзаряжена (${DRONE_TYPES[s.type]?.name ?? s.type})` : "§7пусто"}`,
    s.owner ? `§7Зарядил: §f${s.owner}` : null,
    s.loaded && !mine ? `§cЭта ПУ заряжена игроком ${s.owner}, управлять ей нельзя.` : null,
    `§7Позиция: §f${fmtPos(launcher.location)}`,
    "",
    ...routeChainLines(plan),
  ].filter((l) => l !== null);
  const menu = new MenuBuilder("Пусковая установка", lines.join("\n"));
  if (s.loaded && mine && !LAUNCHERS_BUSY.has(launcher.id)) {
    if (plan.target) {
      menu.button("§2§lПуск с этой ПУ по маршруту", "textures/items/rocket_icon", () => {
        launchSalvo(player, [{ id: launcher.id, launcher, type: s.type, dist: 0 }], plan);
      });
    }
    menu.button("Разрядить (дрон вернётся в инвентарь)", undefined, () => {
      if (unloadLauncher(player, launcher)) actionbar(player, "§eПУ разряжена.");
    });
  }
  menu.button("Маршрут и цель", "textures/items/remote_icon_waypoint", () => showRouteEditor(player));
  menu.button("Закрыть", undefined, () => {});
  await menu.show(player);
}

// ---------------------------------------------------------------------------
// Активные дроны и коррекция в полёте
// ---------------------------------------------------------------------------
async function showActiveDrones(player) {
  if (!isValid(player)) return;
  const all = flyingDrones();
  const pl = player.location;
  const distTo = (st) => (st.dimId === player.dimension.id ? vdist(st.pos, pl) : 1e9);
  all.sort((a, b) => (b.owner === player.name ? 1 : 0) - (a.owner === player.name ? 1 : 0) || distTo(a) - distTo(b));
  const body = all.length
    ? `§7В воздухе: §f${all.length}§7. Выберите дрон, чтобы изменить цель или подорвать его.`
    : "§7Сейчас в воздухе нет дронов.";
  const menu = new MenuBuilder("Активные дроны", body);
  for (const st of all.slice(0, 40)) {
    const t = finalTarget(st);
    const head = `§l${st.callsign}§r ${st.cfg.name}${st.owner ? ` §8(${st.owner})` : ""}${st.hit ? " §c[сбит]" : ""}`;
    const tail = `§8${fmtPos(st.pos)} » ${t ? fmtPos(t) : "нет цели"} · ${Math.round(remainingPath(st))} м`;
    menu.button(`${head}\n${tail}`, st.cfg.icon, () => showDroneDetails(player, st.id));
  }
  const own = all.filter((st) => st.owner === player.name);
  if (own.length) {
    menu.button(`§cСамоликвидация всех моих (${own.length})`, undefined, async () => {
      if (
        await confirmAction(
          player,
          "Самоликвидация",
          `Подорвать ${own.length} дрон(ов) прямо в воздухе?`,
          "§cПодорвать все",
        )
      ) {
        for (const st of own) if (!st.dead && isValid(st.entity)) detonate(st, null, "self");
      }
      return showActiveDrones(player);
    });
  }
  menu.button("Обновить", undefined, () => showActiveDrones(player));
  menu.button("« Назад", undefined, () => showMainMenu(player));
  await menu.show(player);
}

async function showDroneDetails(player, droneId) {
  if (!isValid(player)) return;
  const st = DRONES.get(droneId);
  if (!st || st.dead || !st.launched || !isValid(st.entity)) {
    msg(player, "§e[БПЛА] Этого дрона уже нет в воздухе.");
    return showActiveDrones(player);
  }
  const t = finalTarget(st),
    rem = remainingPath(st),
    spd = droneSpeedBps(st);
  const groupSize = st.group ? flyingDrones().filter((o) => o.group === st.group).length : 1;
  const area = TickingAreas.get(st.id);
  const lines = [
    `§l${st.callsign}§r - ${st.cfg.name}`,
    `§7Владелец: §f${st.owner || "неизвестен"}`,
    st.group ? `§7Залп: §f${st.group}§7 (в воздухе: ${groupSize})` : null,
    `§7Состояние: §f${dronePhase(st)}`,
    `§7Позиция: §f${fmtPos(st.pos)}§7 (${dimName(st.dimId)})`,
    `§7Цель: §f${t ? `${fmtPos(t)}${t.auto ? " (рельеф)" : ""}` : "не назначена"}`,
    `§7Точек маршрута осталось: §f${st.route.length}`,
    t ? `§7До цели по маршруту: §f${Math.round(rem)} м§7, около §f${Math.ceil(rem / spd)} с` : null,
    `§7Скорость: §f${spd.toFixed(1)} бл/с§7, эшелон: §fY ${Math.round(st.echelon)}`,
    `§7Зона тиков: ${area ? `§a${area.name}§7 @ ${area.x} ${area.y} ${area.z}` : "§cнет (лимит или ожидание)"}`,
  ].filter(Boolean);

  const menu = new MenuBuilder(`Дрон ${st.callsign}`, lines.join("\n"));
  const allowed = canControl(player, st);
  if (allowed && !st.hit && st.dimId === player.dimension.id) {
    menu.button("§lИзменить цель на карте§r\n§8Коррекция в полёте", "textures/items/remote_icon_target", () =>
      openMapAt(player, t, { mode: "retarget", droneId, back: (p) => showDroneDetails(p, droneId) }),
    );
  }
  if (allowed) {
    menu.button("§cПодорвать сейчас", undefined, async () => {
      if (await confirmAction(player, "Подрыв", `Подорвать ${st.callsign} у ${fmtPos(st.pos)}?`, "§cПодорвать")) {
        const cur = DRONES.get(droneId);
        if (cur && !cur.dead && isValid(cur.entity)) detonate(cur, null, "self");
      }
      return showActiveDrones(player);
    });
  }
  menu.button("Обновить", undefined, () => showDroneDetails(player, droneId));
  menu.button("« К списку", undefined, () => showActiveDrones(player));
  await menu.show(player);
}

/** Новая цель с карты для дрона или всего его залпа. */
async function applyRetarget(player, droneId, target, ctx) {
  const st = DRONES.get(droneId);
  if (!st || st.dead || st.hit || !st.launched || !isValid(st.entity)) {
    msg(player, "§e[БПЛА] Дрон недоступен для коррекции.");
    return showActiveDrones(player);
  }
  const group = st.group ? flyingDrones().filter((o) => o.group === st.group && !o.hit && canControl(player, o)) : [st];
  let list = [st];
  if (group.length > 1) {
    let choice = null;
    await new MenuBuilder("Кого перенацелить?", `§7Новая цель: X: ${target.x}, Z: ${target.z}`)
      .button(`Только ${st.callsign}`, undefined, () => {
        choice = [st];
      })
      .button(`Весь залп ${st.group} (${group.length})`, undefined, () => {
        choice = group;
      })
      .button("Отмена", undefined, () => {})
      .show(player);
    if (!choice) return showMap(player, ctx);
    list = choice;
  }
  let n = 0;
  for (const d of list) if (retargetDrone(d, target)) n++;
  msg(
    player,
    n
      ? `§a[БПЛА] Цель изменена (${n} дрон.): X: ${target.x}, Z: ${target.z}.`
      : "§c[БПЛА] Не удалось изменить цель: дрон уже не в воздухе.",
  );
  return showDroneDetails(player, droneId);
}

// ---------------------------------------------------------------------------
// Шаблоны целей
// ---------------------------------------------------------------------------
async function showPresets(player) {
  if (!isValid(player)) return;
  const list = Presets.all();
  const plan = RoutePlan.forDimension(player);
  const view = MapViews.get(player);
  const pdim = player.dimension.id;
  const menu = new MenuBuilder(
    "Шаблоны целей",
    `§7Сохранено: §f${list.length}/${CONFIG.MAX_PRESETS}§7. Шаблоны общие для всех игроков и сохраняются вместе с миром.`,
  );
  menu.button("§2+ Сохранить мою позицию", "textures/items/remote_icon_waypoint", () =>
    showSavePreset(player, floorPoint(player.location)),
  );
  if (plan.target) {
    menu.button("§2+ Сохранить конечную цель маршрута", "textures/items/remote_icon_target", () =>
      showSavePreset(player, {
        x: plan.target.x,
        y: plan.target.y ?? terrainHeight(pdim, plan.target.x, plan.target.z) ?? Math.floor(player.location.y),
        z: plan.target.z,
      }),
    );
  }
  menu.button(`§2+ Сохранить курсор карты§r\n§8X: ${view.x}, Z: ${view.z}`, undefined, () =>
    showSavePreset(player, {
      x: view.x,
      y: terrainHeight(pdim, view.x, view.z) ?? Math.floor(player.location.y),
      z: view.z,
    }),
  );
  for (const p of list) {
    const dist = p.dim === pdim ? ` · ${Math.round(hdist(p, player.location))} м` : "";
    menu.button(`§l${p.name}§r\n§8${fmtPos(p)} · ${dimName(p.dim)}${dist}`, undefined, () =>
      showPresetDetails(player, p.id),
    );
  }
  menu.button("« Назад", undefined, () => showMainMenu(player));
  await menu.show(player);
}

async function showSavePreset(player, point) {
  if (!isValid(player)) return;
  const dimId = player.dimension.id;
  const fallbackName = `Точка ${Presets.all().length + 1}`;
  const r = await new ModalBuilder("Новый шаблон")
    .text("name", `Название точки (${fmtPos(point)}, ${dimName(dimId)})`, "например: База противника", fallbackName)
    .submit("Сохранить")
    .show(player);
  if (!r) return showPresets(player);
  const name = cleanName(r.name, fallbackName);
  const res = Presets.add({ name, x: point.x, y: point.y, z: point.z, dim: dimId, author: player.name });
  msg(
    player,
    res.ok
      ? `§a[БПЛА] Шаблон «${name}» ${res.replaced ? "обновлён" : "сохранён"}: ${fmtPos(point)} (${dimName(dimId)})`
      : `§c[БПЛА] ${res.error}`,
  );
  return showPresets(player);
}

async function showPresetDetails(player, id) {
  if (!isValid(player)) return;
  const p = Presets.get(id);
  if (!p) {
    msg(player, "§e[БПЛА] Шаблон уже удалён.");
    return showPresets(player);
  }
  const same = p.dim === player.dimension.id;
  const lines = [
    `§l${p.name}`,
    `§7Координаты: §f${fmtPos(p)}`,
    `§7Измерение: §f${dimName(p.dim)}`,
    same ? `§7Расстояние: §f${Math.round(hdist(p, player.location))} м` : "§7Шаблон в другом измерении",
    `§7Автор: §f${p.author || "неизвестен"}§7, ${fmtTime(p.t || 0)}`,
  ];
  const menu = new MenuBuilder("Шаблон цели", lines.join("\n"));
  if (same) {
    menu.button("§lСделать конечной целью маршрута", "textures/items/remote_icon_target", () => {
      const plan = RoutePlan.forDimension(player);
      plan.target = { x: p.x, y: null, z: p.z };
      RoutePlan.set(player, plan);
      msg(player, `§a[БПЛА] Конечная цель: «${p.name}» (X: ${p.x}, Z: ${p.z}).`);
      return showRouteEditor(player);
    });
    menu.button("Показать на карте", undefined, () =>
      openMapAt(player, p, { mode: "browse", back: (pl) => showPresetDetails(pl, id) }),
    );
  }
  menu.button("§cУдалить", undefined, async () => {
    if (await confirmAction(player, "Удаление шаблона", `Удалить шаблон «${p.name}»?`, "§cУдалить")) {
      msg(player, Presets.remove(p.id) ? `§e[БПЛА] Шаблон «${p.name}» удалён.` : "§c[БПЛА] Шаблон не найден.");
    }
    return showPresets(player);
  });
  menu.button("« Назад", undefined, () => showPresets(player));
  await menu.show(player);
}

// ---------------------------------------------------------------------------
// Архив маршрутов
// ---------------------------------------------------------------------------
async function showArchive(player) {
  if (!isValid(player)) return;
  const list = RouteHistory.all(player).slice().reverse();
  const menu = new MenuBuilder(
    "Архив маршрутов",
    list.length
      ? `§7Уникальные маршруты (${list.length}/${CONFIG.MAX_ROUTE_HISTORY}): повторный пуск по тому же маршруту не создаёт копию, а поднимает его наверх.`
      : "§7Архив пуст. Маршрут попадает в архив при пуске.",
  );
  for (const it of list) {
    const t = it.plan.target;
    const key = RouteHistory.key(it.plan);
    menu.button(
      `${it.plan.waypoints.length} точ. | ${fmtTime(it.time)}\n§8цель X: ${Math.floor(t.x)}, Z: ${Math.floor(t.z)} · ${dimName(it.plan.dim)}`,
      undefined,
      () => showArchiveEntry(player, key),
    );
  }
  menu.button("« Назад", undefined, () => showMainMenu(player));
  await menu.show(player);
}

async function showArchiveEntry(player, key) {
  const it = RouteHistory.all(player).find((e) => RouteHistory.key(e.plan) === key);
  if (!it) return showArchive(player);
  const same = it.plan.dim === player.dimension.id;
  const lines = [...routeChainLines(it.plan), "", `§7Последний пуск: ${fmtTime(it.time)}`];
  if (!same) lines.push(`§6Маршрут из измерения «${dimName(it.plan.dim)}».`);
  const menu = new MenuBuilder("Маршрут из архива", lines.join("\n"));
  if (same) {
    menu.button("§2Сделать текущим маршрутом", "textures/items/remote_icon_waypoint", () => {
      RoutePlan.set(player, JSON.parse(JSON.stringify(it.plan)));
      msg(player, "§6[БПЛА] Маршрут из архива загружен.");
      return showRouteEditor(player);
    });
  }
  menu.button("§cУдалить из архива", undefined, () => {
    RouteHistory.remove(player, key);
    msg(player, "§e[БПЛА] Маршрут удалён из архива.");
    return showArchive(player);
  });
  menu.button("« К архиву", undefined, () => showArchive(player));
  await menu.show(player);
}

// ---------------------------------------------------------------------------
// Служебное: зоны тиков
// ---------------------------------------------------------------------------
async function showService(player) {
  if (!isValid(player)) return;
  TickingAreas.load();
  const recs = [...TickingAreas.records.values()];
  const lines = [
    `§7Зоны тиков дронов: §f${recs.length}/${CONFIG.MAX_DRONE_AREAS}§7 (лимит мира: 10 зон)`,
    "§7Зона следует за дроном и удаляется при подрыве, столкновении или удалении дрона.",
  ];
  for (const r of recs.slice(0, 12)) {
    const st = DRONES.get(r.id);
    const who = st && st.launched && !st.dead ? `§a${st.callsign}` : "§cбез дрона";
    lines.push(`§8${r.name} @ ${r.x} ${r.y} ${r.z} (${dimName(r.dim)}) - ${who}`);
  }
  await new MenuBuilder("Служебное", lines.join("\n"))
    .button("Убрать зоны без дронов", undefined, () => {
      msg(player, `§e[БПЛА] Удалено зон без дронов: ${areaHousekeeping()}.`);
      return showService(player);
    })
    .button("Пересоздать все зоны дронов", undefined, () => {
      const n = TickingAreas.removeAll();
      msg(player, `§e[БПЛА] Удалено зон: ${n}. Летящие дроны получат новые зоны автоматически.`);
      return showService(player);
    })
    .button("§cАварийно: удалить ВСЕ зоны тиков мира", undefined, async () => {
      if (
        await confirmAction(
          player,
          "Аварийная очистка",
          "Будет выполнено `tickingarea remove_all` во всех измерениях. Удалятся и зоны, созданные игроками и другими аддонами. Продолжить?",
          "§cУдалить все",
        )
      ) {
        TickingAreas.emergencyRemoveAll();
        msg(player, "§e[БПЛА] Все зоны тиков мира удалены.");
      }
      return showService(player);
    })
    .button("« Назад", undefined, () => showMainMenu(player))
    .show(player);
}
// ============================================================================
// §10 ВВОД ИГРОКА: ЗАРЯДКА ПУ, ПУЛЬТЫ, КЛИКИ ПО ПУ И ДРОНАМ
// ============================================================================

/** «Пульт маршрута»: путевая точка на CONFIG.WAYPOINT_ALT блоков выше блока. */
function addWaypoint(player, loc) {
  const plan = RoutePlan.forDimension(player);
  if (plan.waypoints.length >= CONFIG.MAX_WAYPOINTS) {
    msg(player, `§c[БПЛА] Уже ${CONFIG.MAX_WAYPOINTS} точек! Отметь цель планшетом.`);
    return;
  }
  const [, maxY] = dimLimits(player.dimension.id);
  const w = { x: loc.x, y: Math.min(loc.y + CONFIG.WAYPOINT_ALT, maxY - 3), z: loc.z };
  plan.waypoints.push(w);
  RoutePlan.set(player, plan);
  msg(player, `§a[БПЛА] Точка ${plan.waypoints.length}/${CONFIG.MAX_WAYPOINTS} записана: ${fmtPos(w)}`);
}

/**
 * Планшет, ПКМ по блоку: блок становится конечной целью маршрута (точка удара
 * над этим блоком), затем открывается редактор маршрута. С Shift цель только отмечается.
 */
function onTabletBlock(player, loc, sneaking) {
  if (!isValid(player)) return;
  LAST_BLOCK_CLICK.set(player.id, system.currentTick);
  const plan = RoutePlan.forDimension(player);
  plan.target = { x: loc.x, y: loc.y + 1, z: loc.z };
  RoutePlan.set(player, plan);
  msg(player, `§e[БПЛА] Конечная цель отмечена: ${fmtPos(loc)} (точек маршрута: ${plan.waypoints.length}).`);
  if (!sneaking) openTablet(player, showRouteEditor);
}

/** Предмет дрона по блоку: ванильная установка отменена, заряжается ПУ рядом с блоком. */
function onDroneItemOnBlock(player, loc, itemId) {
  if (!isValid(player)) return;
  const center = { x: loc.x + 0.5, y: loc.y + 1, z: loc.z + 0.5 };
  const near = safe(
    () => player.dimension.getEntities({ type: LAUNCHER_TYPE, location: center, maxDistance: 2.5 }),
    [],
  );
  if (near.length && isValid(near[0])) loadLauncher(player, near[0], itemId);
  else actionbar(player, "§eДрон заряжается в пусковую установку: нажмите предметом по ПУ.");
}

/** Клик по ПУ: предмет дрона — зарядка; планшет — меню ПУ; иначе — статус. */
function onLauncherClicked(player, launcher, heldId) {
  if (!isValid(player) || !isValid(launcher)) return;
  if (heldId && ITEM_TO_DRONE[heldId]) {
    loadLauncher(player, launcher, heldId);
    return;
  }
  if (heldId && TABLET_ITEMS.has(heldId)) {
    openTablet(player, (p) => showLauncherMenu(p, launcher));
    return;
  }
  const s = launcherState(launcher);
  actionbar(
    player,
    s.loaded ? `§aПУ [Заряжена]: ${DRONE_TYPES[s.type]?.name ?? s.type}` : "§7ПУ пуста: нажмите по ней предметом дрона",
  );
}

/**
 * Клик по дрону. Скрипт полностью управляет пуском, поэтому data-driven
 * запуск rocket:start_flight отменяется.
 */
function onDroneClicked(player, drone, heldId) {
  if (!isValid(player) || !isValid(drone)) return;
  if (isDroneLaunched(drone)) {
    msg(player, "§c[БПЛА] Ракета уже в полёте!");
    return;
  }
  const lid = getDP(drone, DP.LAUNCHER_ID);
  const launcher = typeof lid === "string" ? safe(() => world.getEntity(lid), undefined) : undefined;
  if (heldId && ITEM_TO_DRONE[heldId]) {
    actionbar(player, "§cНа этой установке уже заряжен дрон!");
    return;
  }
  if (launcher && LAUNCHERS_BUSY.has(launcher.id)) {
    msg(player, "§e[БПЛА] Эта ПУ уже в очереди залпа.");
    return;
  }
  if (heldId && TABLET_ITEMS.has(heldId) && launcher && isValid(launcher)) {
    openTablet(player, (p) => showLauncherMenu(p, launcher));
    return;
  }
  const plan = RoutePlan.forDimension(player);
  if (!plan.target) {
    msg(player, "§c[БПЛА] Маршрут не задан! Откройте планшет: «Маршрут и цель».");
    return;
  }
  if (launcher && isValid(launcher)) {
    const s = launcherState(launcher);
    if (s.owner && s.owner !== player.name) {
      msg(player, `§c[БПЛА] Эта ПУ заряжена игроком ${s.owner}.`);
      return;
    }
  }
  const st = launchDrone(player, drone, plan);
  if (st) msg(player, `§a[БПЛА] Старт произведён! Позывной: ${st.callsign}.`);
}

/**
 * Дрон, появившийся не через зарядку (например, /summon), ставится на
 * ближайшую пустую ПУ (до 6 блоков). Если все ПУ рядом заряжены или ПУ нет,
 * дрон снимается: 1 ПУ = 1 дрон.
 */
function tryMountOnLauncher(entity, tries) {
  try {
    if (!isValid(entity) || isDroneLaunched(entity) || getDP(entity, DP.LAUNCHER_ID) !== undefined) return;
    const dim = entity.dimension;
    const near = dim
      .getEntities({ location: entity.location, maxDistance: 6, type: LAUNCHER_TYPE })
      .filter((l) => isValid(l));
    const free = near.find((l) => !LAUNCHERS_BUSY.has(l.id) && !launcherState(l).loaded);
    if (free) {
      placeOnRail(free, entity, entity.typeId);
      const owner = dim.getPlayers({ location: entity.location, maxDistance: 10 })[0];
      markLauncherLoaded(free, entity.typeId, owner ? owner.name : "", entity.id);
      return;
    }
    if (!near.length && tries < 10) {
      system.runTimeout(() => tryMountOnLauncher(entity, tries + 1), 4);
      return;
    }
    const text = near.length ? "§cНа этой установке уже заряжен дрон!" : "§c[БПЛА] Дрон можно поставить только на ПУ!";
    for (const pl of dim.getPlayers({ location: entity.location, maxDistance: 10 })) msg(pl, text);
    entity.remove();
  } catch (err) {
    logError("tryMountOnLauncher", err);
  }
}

// Пульты по блоку. В before-событии мир менять нельзя, поэтому работа
// откладывается в system.run. Взаимодействие с блоком отменяется, чтобы
// пульт не открывал сундуки и двери.
world.beforeEvents.playerInteractWithBlock.subscribe((ev) => {
  const item = ev.itemStack;
  if (!item) return;
  const id = item.typeId;
  if (id !== WAYPOINT_ITEM && !TABLET_ITEMS.has(id)) return;
  ev.cancel = true;
  if (!ev.isFirstEvent) return; // событие повторяется, пока кнопка зажата
  const player = ev.player,
    loc = vcopy(ev.block.location),
    sneaking = !!player.isSneaking;
  system.run(() => {
    if (!isValid(player)) return;
    if (id === WAYPOINT_ITEM) addWaypoint(player, loc);
    else onTabletBlock(player, loc, sneaking);
  });
});

// Предмет дрона по блоку: ванильная установка сущности (entity_placer) отменяется,
// заряжается ПУ рядом с блоком. Это удобно на телефоне, если сама ПУ мелкая цель.
world.beforeEvents.itemUseOn.subscribe((ev) => {
  const itemId = ev.itemStack?.typeId;
  if (!itemId || !ITEM_TO_DRONE[itemId]) return;
  ev.cancel = true;
  if (!ev.isFirstEvent) return;
  const player = ev.source,
    loc = vcopy(ev.block.location);
  system.run(() => onDroneItemOnBlock(player, loc, itemId));
});

// Планшет: ПКМ в воздух открывает главное меню.
world.afterEvents.itemUse.subscribe((ev) => {
  const player = ev.source,
    item = ev.itemStack;
  if (!item || !TABLET_ITEMS.has(item.typeId) || !isValid(player)) return;
  // Если этим же кликом отмечен блок, второй раз планшет не открываем.
  const t = LAST_BLOCK_CLICK.get(player.id);
  if (t !== undefined && system.currentTick - t < 10) return;
  openTablet(player, showMainMenu);
});

// Клик по ПУ или по дрону: взаимодействием управляет скрипт.
// Для заряженной ПУ событие отменяется, и предмет из руки не списывается.
world.beforeEvents.playerInteractWithEntity.subscribe((ev) => {
  const target = ev.target;
  if (!target) return;
  const typeId = target.typeId;
  const isLauncher = typeId === LAUNCHER_TYPE;
  if (!isLauncher && !DRONE_TYPES[typeId]) return;
  ev.cancel = true;
  const player = ev.player,
    heldId = ev.itemStack?.typeId;
  system.run(() => (isLauncher ? onLauncherClicked(player, target, heldId) : onDroneClicked(player, target, heldId)));
});

// Появление сущностей: дроны (установка на ПУ) и новые ПУ (подпись «ПУ [Пусто]»).
world.afterEvents.entitySpawn.subscribe((ev) => {
  const e = ev.entity;
  const typeId = safe(() => e.typeId, "");
  if (typeId === LAUNCHER_TYPE) {
    if (ev.cause !== "Loaded") {
      system.run(() => {
        if (isValid(e) && getDP(e, LDP.LOADED) === undefined) markLauncherEmpty(e);
      });
    }
    return;
  }
  if (!DRONE_TYPES[typeId]) return;
  if (ev.cause === "Loaded") {
    registerDrone(e);
    return;
  }
  system.runTimeout(() => tryMountOnLauncher(e, 1), 2);
});

// ПУ уничтожена: дрон с её направляющей падает предметом.
world.afterEvents.entityDie.subscribe((ev) => {
  const dead = ev.deadEntity;
  const deadId = safe(() => dead.id, undefined);
  if (!deadId || safe(() => dead.typeId, "") !== LAUNCHER_TYPE) return;
  LAUNCHERS_BUSY.delete(deadId);
  for (const st of [...DRONES.values()]) {
    if (st.launched || !isValid(st.entity) || getDP(st.entity, DP.LAUNCHER_ID) !== deadId) continue;
    try {
      st.entity.dimension.spawnItem(new ItemStack(st.cfg.item, 1), st.entity.location);
      forgetDrone(st);
      st.entity.remove();
    } catch {}
  }
});

// Попадания по летящему дрону: удар, снаряд, урон. Дрон сбит и падает.
world.afterEvents.entityHurt.subscribe((ev) => {
  shootDown(
    ev.hurtEntity,
    safe(() => ev.damageSource.damagingEntity, undefined),
  );
});
world.afterEvents.entityHitEntity.subscribe((ev) => {
  shootDown(ev.hitEntity, ev.damagingEntity);
});
world.afterEvents.projectileHitEntity.subscribe((ev) => {
  const hit = safe(() => ev.getEntityHit(), undefined);
  if (hit && hit.entity) shootDown(hit.entity, ev.source);
});

// Дрон удалён (командой /kill, выгрузкой чанка и т.п.): зона тиков удаляется обязательно.
world.afterEvents.entityRemove.subscribe((ev) => {
  const id = ev.removedEntityId;
  const st = DRONES.get(id);
  if (st) forgetDrone(st);
  else if (TickingAreas.get(id)) TickingAreas.remove(id);
});

world.afterEvents.playerLeave.subscribe((ev) => {
  UI_BUSY.delete(ev.playerId);
  LAST_BLOCK_CLICK.delete(ev.playerId);
  ENG_NEAR.delete(ev.playerId);
});

/** Строка состояния (actionbar) у игрока с планшетом в руке: дроны в воздухе, готовые ПУ, цель. */
function hudTick() {
  for (const pl of world.getAllPlayers()) {
    if (!isValid(pl) || !TABLET_ITEMS.has(heldItemId(pl))) continue;
    const own = flyingDrones().filter((st) => st.owner === pl.name);
    let text = `§6БПЛА§r в воздухе: §e${own.length}§r | ПУ готово: §a${scanBattery(pl).ready.length}`;
    let best = null,
      bestDist = Infinity;
    for (const st of own) {
      const d = remainingPath(st);
      if (st.route.length && d < bestDist) {
        best = st;
        bestDist = d;
      }
    }
    if (best) text += ` §7| ${best.callsign}: §f${Math.round(bestDist)} м§7 до цели`;
    else {
      const plan = RoutePlan.forDimension(pl);
      if (plan.target) text += ` §7| цель X: ${Math.floor(plan.target.x)}, Z: ${Math.floor(plan.target.z)}`;
    }
    try {
      pl.onScreenDisplay.setActionBar(text);
    } catch {}
  }
}

// Служебные команды для администраторов:
//   /scriptevent bpla:areas       — состояние зон тиков дронов
//   /scriptevent bpla:cleanup     — удалить зоны без летящих дронов
//   /scriptevent bpla:reset_areas — удалить все зоны дронов (летящие получат новые)
system.afterEvents.scriptEventReceive.subscribe((ev) => {
  if (!ev.id.startsWith("bpla:")) return;
  const reply = (text) => {
    const src = ev.sourceEntity;
    if (src && src.typeId === PLAYER_TYPE) msg(src, text);
    else console.warn(text.replace(/§./g, ""));
  };
  if (ev.id === "bpla:areas") {
    TickingAreas.load();
    const lines = [`§e[БПЛА] Зоны тиков дронов: ${TickingAreas.count()}/${CONFIG.MAX_DRONE_AREAS}`];
    for (const r of TickingAreas.records.values()) lines.push(`§7${r.name} @ ${r.x} ${r.y} ${r.z} (${dimName(r.dim)})`);
    reply(lines.join("\n"));
  } else if (ev.id === "bpla:cleanup") {
    reply(`§e[БПЛА] Удалено зон без дронов: ${areaHousekeeping()}.`);
  } else if (ev.id === "bpla:reset_areas") {
    reply(`§e[БПЛА] Удалено зон дронов: ${TickingAreas.removeAll()}.`);
  }
});
// ============================================================================
// §11 ФИЗИКА ОБЛОМКОВ (DEBRIS)
// ============================================================================
// Обломки rocket:debris_fp1 и rocket:debris_gerbera (появляются при взрыве
// FP-1 и Gerbera) движутся собственным движком: гравитация, отскок, трение
// и столкновения с блоками через общий AABB-модуль из §6. Игроки
// расталкивают и пинают обломки. Спящие обломки не нагружают сервер.
// Таблица DBT: масштаб модели (sc) и масса (m), ширина (w), глубина (d),
// высота (h) каждой из 6 частей.
const DBT = {
  "rocket:debris_fp1": {
    sc: 1.2,
    m: [1, 1, 0.25, 0.5, 0.7, 2],
    w: [1.763, 1.763, 0.039, 1.59, 0.106, 0.928],
    d: [0.524, 0.524, 0.04, 0.384, 1.809, 1.054],
    h: [0.344, 0.344, 0.861, 0.623, 0.099, 0.967],
  },
  "rocket:debris_gerbera": {
    sc: 1,
    m: [1, 1, 0.25, 2.5, 1.6, 3],
    w: [1.87, 1.87, 0.066, 0.398, 0.583, 0.888],
    d: [2.027, 2.027, 0.066, 0.133, 0.928, 2.955],
    h: [0.133, 0.133, 0.596, 0.331, 0.331, 0.795],
  },
};
const DBG = Object.keys(DBT),
  DS = new Map(); // id обломка -> состояние физики
const D_G = 0.05, // гравитация, блоков/тик²
  D_AIR = 0.995, // сопротивление воздуха
  D_FR = 0.85, // трение о землю
  D_E = 0.48; // упругость отскока
function dbgWake(st) {
  st.sl = false;
  st.sc = 0;
}
// Шаг физики для «проснувшегося» обломка: гравитация, сопротивление, отскок, трение.
function dbgStep(dm, st) {
  st.py = st.y;
  const e = bxs(dm, Math.floor(st.x), Math.floor(st.y + st.h * 0.5), Math.floor(st.z)),
    w = e.liq;
  st.vy -= w ? D_G * 0.25 : D_G;
  const dr = w ? 0.88 : D_AIR;
  st.vx *= dr;
  st.vz *= dr;
  st.vy *= w ? 0.85 : 0.98;
  const f = moveCol(dm, st, st.vx, st.vy, st.vz);
  if (f === null) {
    st.vx = st.vy = st.vz = 0;
    return;
  }
  const eb = D_E / (1 + 0.15 * st.m);
  if (f.hy) {
    if (st.vy < 0) {
      if (st.vy < -0.14) {
        st.vy = -st.vy * eb;
        st.vx *= 0.8;
        st.vz *= 0.8;
      } else st.vy = 0;
    } else st.vy = 0;
  }
  if (f.hx) st.vx = Math.abs(st.vx) > 0.08 ? -st.vx * 0.35 : 0;
  if (f.hz) st.vz = Math.abs(st.vz) > 0.08 ? -st.vz * 0.35 : 0;
  st.gnd = f.gnd;
  if (st.gnd) {
    st.vx *= D_FR;
    st.vz *= D_FR;
  }
  if (st.gnd && Math.abs(st.vx) < 0.006 && Math.abs(st.vz) < 0.006 && Math.abs(st.vy) < 0.06) {
    if (++st.sc >= 10) {
      st.sl = true;
      st.vx = st.vz = st.vy = 0;
    }
  } else st.sc = 0;
}
// Игрок <-> обломок: игрок расталкивает обломки и пинает их на бегу.
function dbgPlayer(dm, st, pl) {
  const pw = 0.3,
    ph = pl.sn ? 1.5 : 1.8,
    ox = pw + st.hwx - Math.abs(st.x - pl.x),
    oz = pw + st.hwz - Math.abs(st.z - pl.z),
    oy = Math.min(st.y + st.h, pl.y + ph) - Math.max(st.y, pl.y);
  if (ox <= 0 || oz <= 0 || oy <= 0.12) return false;
  let nx = 0,
    nz = 0,
    dx = 0,
    dz = 0;
  if (ox < oz) {
    nx = st.x >= pl.x ? 1 : -1;
    dx = nx * ox;
  } else {
    nz = st.z >= pl.z ? 1 : -1;
    dz = nz * oz;
  }
  const f = moveCol(dm, st, dx, 0, dz);
  const vrel = (st.vx - pl.vx) * nx + (st.vz - pl.vz) * nz;
  if (vrel < 0) {
    const J = (-1.2 * vrel) / (1 / st.m + 1 / 4);
    st.vx += (nx * J) / st.m;
    st.vz += (nz * J) / st.m;
  }
  const ph2 = Math.hypot(pl.vx, pl.vz);
  if (ph2 > 0.24 && st.gnd) st.vy += 0.14 / Math.sqrt(st.m);
  dbgWake(st);
  return true;
}
// Обломок <-> обломок: разведение пересечений и обмен импульсом.
function dbgPair(dm, a, b) {
  const dx = a.x - b.x,
    dz = a.z - b.z,
    ox = a.hwx + b.hwx - Math.abs(dx),
    oz = a.hwz + b.hwz - Math.abs(dz),
    oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (ox <= 0.005 || oz <= 0.005 || oy <= 0.005) return;
  const ia = 1 / a.m,
    ib = 1 / b.m,
    sm = ia + ib;
  let nx = 0,
    ny = 0,
    nz = 0;
  if (oy <= ox && oy <= oz) {
    const pa = a.py === undefined ? a.y : a.py,
      pb = b.py === undefined ? b.y : b.py,
      up = pa > pb + 0.0001 ? a : pb > pa + 0.0001 ? b : a.y >= b.y ? a : b,
      lo = up === a ? b : a;
    ny = up === a ? 1 : -1;
    moveCol(dm, up, 0, oy + 0.001, 0);
    const vrel = up.vy - lo.vy;
    if (vrel < 0) {
      const J = (-1.3 * vrel) / (1 / up.m + 1 / lo.m);
      up.vy += J / up.m;
      lo.vy -= J / lo.m;
      if (Math.abs(up.vy) < 0.06) {
        up.vy = 0;
        up.gnd = true;
      }
    }
    dbgWake(a);
    dbgWake(b);
    return;
  }
  if (ox < oz) {
    nx = dx >= 0 ? 1 : -1;
    const s = ox + 0.002;
    moveCol(dm, a, (nx * s * ia) / sm, 0, 0);
    moveCol(dm, b, (-nx * s * ib) / sm, 0, 0);
  } else {
    nz = dz >= 0 ? 1 : -1;
    const s = oz + 0.002;
    moveCol(dm, a, 0, 0, (nz * s * ia) / sm);
    moveCol(dm, b, 0, 0, (-nz * s * ib) / sm);
  }
  const vrel = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
  if (vrel < 0) {
    const J = (-1.3 * vrel) / sm;
    a.vx += nx * J * ia;
    a.vz += nz * J * ia;
    b.vx -= nx * J * ib;
    b.vz -= nz * J * ib;
  }
  dbgWake(a);
  dbgWake(b);
}

function dbgIdx(s) {
  try {
    const v = s.getProperty("rocket:piece");
    if (typeof v === "number") return v;
  } catch {}
  try {
    const tf = s.getComponent("minecraft:type_family");
    for (let i = 0; i < 6; i++) if (tf && tf.hasTypeFamily("pc" + i)) return i;
  } catch {}
  return 0;
}
function dbgLaunch(st) {
  const a = Math.random() * Math.PI * 2,
    sp = 0.4 + Math.random() * 0.7,
    up = 0.6 + Math.random() * 0.8,
    k = 1 / Math.pow(st.m, 0.35);
  st.vx = Math.cos(a) * sp * k;
  st.vz = Math.sin(a) * sp * k;
  st.vy = up * k;
  st.ln = true;
  dbgWake(st);
}
function dbgReg(s, launch) {
  let st = DS.get(s.id);
  if (st) {
    if (launch && !st.ln) dbgLaunch(st);
    return st;
  }
  const T = DBT[s.typeId];
  if (!T) return null;
  const pi = Math.max(0, Math.min(5, dbgIdx(s))),
    l = s.location;
  st = {
    e: s,
    dm: s.dimension,
    pi,
    x: l.x,
    y: l.y,
    z: l.z,
    vx: 0,
    vy: 0,
    vz: 0,
    hwx: (T.w[pi] * T.sc) / 2,
    hwz: (T.d[pi] * T.sc) / 2,
    h: T.h[pi] * T.sc,
    m: T.m[pi],
    sl: false,
    sc: 0,
    gnd: false,
    gc: 0,
    gf: false,
    wx: l.x,
    wy: l.y,
    wz: l.z,
    ln: false,
  };
  DS.set(s.id, st);
  try {
    s.setRotation({ x: 0, y: Math.random() * 360 });
  } catch {}
  if (launch) dbgLaunch(st);
  return st;
}
function dbgGroundY(dm, x, z, fromY) {
  for (let by = Math.floor(fromY + 0.001); by >= Math.floor(fromY) - 4; by--) {
    const e = bxs(dm, Math.floor(x), by, Math.floor(z));
    if (e.b === null) return null;
    if (e.liq) continue;
    if (e.b && e.b.length) {
      let top = -1e9;
      for (const q of e.b) top = Math.max(top, by + q[4]);
      return top;
    }
  }
  return null;
}
function dbgTick() {
  if (!DS.size) return;
  const now = system.currentTick;
  if (BC.size > 6000) BC.clear();
  const byDim = new Map();
  for (const [id, st] of DS) {
    let ok = false;
    try {
      ok = st.e.isValid();
    } catch {}
    if (!ok) {
      DS.delete(id);
      continue;
    }
    let a = byDim.get(st.dm.id);
    if (!a) {
      a = [];
      byDim.set(st.dm.id, a);
    }
    a.push(st);
  }
  for (const [, list] of byDim) {
    const dm = list[0].dm,
      pls = [];
    try {
      for (const p of dm.getPlayers()) {
        const l = p.location,
          v = p.getVelocity();
        pls.push({ x: l.x, y: l.y, z: l.z, vx: v.x, vz: v.z, sn: !!p.isSneaking });
      }
    } catch {}
    for (const st of list) {
      if ((now + st.pi * 3) % 10 !== 0) continue;
      try {
        const rl = st.e.location;
        if (Math.abs(rl.x - st.wx) + Math.abs(rl.y - st.wy) + Math.abs(rl.z - st.wz) > 0.08) {
          st.x = st.wx = rl.x;
          st.y = st.wy = rl.y;
          st.z = st.wz = rl.z;
          try {
            st.e.clearVelocity();
          } catch {}
          dbgWake(st);
        } else if (st.sl) {
          try {
            st.e.clearVelocity();
          } catch {}
        }
      } catch {}
    }
    for (const st of list) {
      if (!st.sl) dbgStep(dm, st);
      else if ((now + st.pi * 3) % 20 === 0) {
        const f = moveCol(dm, st, 0, -0.02, 0);
        if (f && !f.gnd) dbgWake(st);
      }
    }
    for (const st of list)
      for (const pl of pls)
        if (Math.abs(st.x - pl.x) < st.hwx + 0.9 && Math.abs(st.z - pl.z) < st.hwz + 0.9 && Math.abs(st.y - pl.y) < 2.2)
          dbgPlayer(dm, st, pl);
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (a.sl && b.sl) continue;
        if (Math.abs(a.x - b.x) > a.hwx + b.hwx || Math.abs(a.z - b.z) > a.hwz + b.hwz || Math.abs(a.y - b.y) > 1.2)
          continue;
        dbgPair(dm, a, b);
      }
    }
    for (const st of list) {
      st.gc = st.gnd || st.sl ? Math.min(st.gc + 1, 4) : Math.max(st.gc - 1, -4);
      const nf = st.gc >= 3 ? true : st.gc <= -3 ? false : st.gf;
      if (nf !== st.gf) {
        st.gf = nf;
        try {
          st.e.triggerEvent(nf ? "rocket:stuck" : "rocket:unstuck");
        } catch {}
        if (nf) {
          try {
            const gy = dbgGroundY(dm, st.x, st.z, st.y);
            if (gy !== null && Math.abs(gy - st.y) < 0.3) st.y = gy;
          } catch {}
        }
      }
      if (Math.abs(st.x - st.wx) + Math.abs(st.y - st.wy) + Math.abs(st.z - st.wz) > 1e-4) {
        let tpOk = true;
        try {
          st.e.teleport({ x: st.x, y: st.y, z: st.z });
        } catch {
          tpOk = false;
        }
        if (tpOk) {
          st.wx = st.x;
          st.wy = st.y;
          st.wz = st.z;
        }
      }
    }
  }
}
world.afterEvents.entitySpawn.subscribe((ev) => {
  try {
    const s = ev.entity;
    if (!s || !DBG.includes(s.typeId)) return;
    // Обломки, загруженные из сохранения, повторно не подбрасываются.
    const launch = ev.cause !== "Loaded";
    system.runTimeout(() => {
      try {
        if (s.isValid()) dbgReg(s, launch);
      } catch {}
    }, 2);
  } catch {}
});
try {
  world.afterEvents.entityHitEntity.subscribe((ev) => {
    try {
      const t = ev.hitEntity,
        a = ev.damagingEntity;
      if (!t || !a || !DBG.includes(t.typeId)) return;
      const st = dbgReg(t, false);
      if (!st) return;
      const d = a.getViewDirection(),
        k = 1 / Math.pow(st.m, 0.5);
      st.vx += d.x * 0.55 * k;
      st.vz += d.z * 0.55 * k;
      st.vy += (0.3 + Math.max(0, d.y) * 0.4) * k;
      dbgWake(st);
    } catch {}
  });
} catch {}
system.runInterval(() => {
  try {
    dbgTick();
  } catch {}
}, 1);
system.runInterval(() => {
  try {
    for (const dn of ["overworld", "nether", "the_end"]) {
      const dm = world.getDimension(dn);
      for (const t of DBG) for (const s of dm.getEntities({ type: t })) if (!DS.has(s.id)) dbgReg(s, false);
    }
  } catch {}
}, 100);

// ============================================================================
// §12 ПАЛУБА И ТВЁРДЫЕ ЧАСТИ МОДЕЛЕЙ
// ============================================================================
// Палуба: игрок, стоящий на корпусе Gerbera или FP-1, движется вместе с дроном.
const DECK = {
  "rocket:missile4": { hw: 1.15, fw: 1.35, top: 0.55 },
  "rocket:missile7": { hw: 1.2, fw: 1.9, top: 0.55 },
};
const deckLast = new Map(),
  deckOn = new Map();
system.runInterval(() => {
  try {
    for (const dn of ["overworld", "nether", "the_end"]) {
      const dm = world.getDimension(dn);
      for (const tId in DECK) {
        const cfg = DECK[tId];
        for (const s of dm.getEntities({ type: tId })) {
          if (!s.isValid()) continue;
          const loc = s.location,
            key = s.id,
            prev = deckLast.get(key),
            rot = s.getRotation();
          deckLast.set(key, { x: loc.x, y: loc.y, z: loc.z });
          if (!prev) continue;
          const dx = loc.x - prev.x,
            dy = loc.y - prev.y,
            dz = loc.z - prev.z;
          const topY = loc.y + cfg.top,
            yawR = (rot.y * Math.PI) / 180,
            cs = Math.cos(yawR),
            sn = Math.sin(yawR);
          for (const p of dm.getPlayers({ location: loc, maxDistance: cfg.fw + 1.5 })) {
            const wasOn = deckOn.get(p.id) === key;
            const rdx = p.location.x - loc.x,
              rdz = p.location.z - loc.z;
            const lx = rdx * cs + rdz * sn,
              lz = -rdx * sn + rdz * cs;
            const margin = wasOn ? 0.35 : 0;
            if (Math.abs(lx) > cfg.hw + margin || Math.abs(lz) > cfg.fw + margin) {
              deckOn.delete(p.id);
              continue;
            }
            const rel = p.location.y - topY,
              relMax = wasOn ? 0.6 : 0.25;
            if (rel < -0.2 || rel > relMax) {
              deckOn.delete(p.id);
              continue;
            }
            deckOn.set(p.id, key);
            let vy = 0;
            try {
              vy = p.getVelocity().y;
            } catch {}
            const jumping = vy > 0.15;
            const py = p.location.y;
            let iy = 0;
            if (!jumping && vy < 0 && py <= topY + 0.08) iy = -vy;
            const ix = dx * 1.05,
              iz = dz * 1.05;
            if (Math.abs(ix) < 1e-4 && Math.abs(iz) < 1e-4 && iy < 1e-4) continue;
            try {
              p.applyImpulse({ x: ix, y: iy, z: iz });
            } catch {}
          }
        }
      }
    }
  } catch {}
}, 1);

// Твёрдые части моделей: каждый куб модели — ориентированная коробка (OBB).
// На дронах, которые не летят, можно стоять и прыгать. Вертикальные лучи от
// ног находят поверхность под игроком. Таблица PCM: [x, y, z, полуширины,
// повороты] кубов из .geo-моделей.
const PCM = {
  "rocket:missile7": {
    sc: 1.2,
    piv: [0, 8, 0],
    c: [
      [-2.04, 8.2, -7.2, 0.05, 1, 0.3, 0, 0, 0],
      [-2.04, 8.9, -8.05, 0.05, 0.3, 0.55, 0, 0, 0],
      [-1, 10.15, -9.25, 0.3, 0.15, 4.75, 0, 0, 0],
      [0, 8, 0, 2, 2, 4.5, 0, 0, 0],
      [0, 7.9, 5.65, 1.9, 1.9, 1.15, 0, 0, 0],
      [1.05, 9.82, 5.1, 0.55, 0.05, 0.9, 0, 0, 0],
      [-1.05, 9.82, 5.1, 0.55, 0.05, 0.9, 0, 0, 0],
      [0, 7.9, 6.4, 1.3, 1.1, 0.6, 0, 0, 0],
      [0, 7.9, 7.3, 0.5, 0.45, 0.3, 0, 0, 0],
      [0, 9.8, -0.05, 2, 0.4, 3.75, 0, 0, 0],
      [1, 10.15, -9.25, 0.3, 0.15, 4.75, 0, 0, 0],
      [0, 7.9, -15.05, 1, 0.9, 1.25, 0, 0, 0],
      [0, 7.036, -14.974, 1, 0.5, 1.25, -25, 0, 0],
      [0, 8.768, -14.69, 1, 0.9, 1.25, 20, 0, 0],
      [-0.283, 7.303, -13.864, 1, 0.9, 1.25, -17.054, -11.735, -4.336],
      [0, 8, -9.25, 2, 2, 4.75, 0, 0, 0],
      [0, 8, -12.85, 2.02, 2.02, 0.65, 0, 0, 0],
      [-2.04, 8.3, -12.85, 0.05, 0.3, 0.35, 0, 0, 0],
      [-2.04, 7.2, -12.85, 0.05, 0.3, 0.35, 0, 0, 0],
      [11.216, 7.9, -14.33, 1, 0.9, 1.25, 0, 20, 0],
      [11.216, 7.9, -14.33, 1, 0.9, 1.25, 0, 20, 0],
      [-11.216, 7.9, -14.33, 1, 0.9, 1.25, 0, -20, 0],
      [7.961, 8.341, -14.249, 0.5, 0.9, 1.25, 20.446, 11.735, 4.336],
      [0.283, 7.303, -13.864, 1, 0.9, 1.25, -17.054, 11.735, 4.336],
      [-11.216, 7.9, -14.33, 1, 0.9, 1.25, 0, -20, 0],
      [-7.961, 8.341, -14.249, 0.5, 0.9, 1.25, 20.446, -11.735, -4.336],
      [15, 9.8, -0.05, 13, 0.4, 3.75, 0, 0, 0],
      [2.7, 8.95, 0.25, 0.7, 0.45, 2.75, 0, 0, 0],
      [16, 10.475, 2.2, 6, 0.275, 0.9, 0, 0, 0],
      [10, 10.45, 2.2, 0.5, 0.25, 0.9, 0, 0, -45],
      [22, 10.45, 2.2, 0.5, 0.25, 0.9, 0, 0, 45],
      [28.3, 9.8, -0.05, 0.3, 1.4, 3.95, 0, 0, 0],
      [28.3, 11.85, -0.85, 0.25, 0.65, 2.65, 0, 0, 0],
      [28.3, 7.85, 1.35, 0.25, 0.55, 2.35, 0, 0, 0],
      [-15, 9.8, -0.05, 13, 0.4, 3.75, 0, 0, 0],
      [-2.7, 8.95, 0.25, 0.7, 0.45, 2.75, 0, 0, 0],
      [-16, 10.475, 2.2, 6, 0.275, 0.9, 0, 0, 0],
      [-10, 10.45, 2.2, 0.5, 0.25, 0.9, 0, 0, 45],
      [-22, 10.45, 2.2, 0.5, 0.25, 0.9, 0, 0, -45],
      [-28.3, 9.8, -0.05, 0.3, 1.4, 3.95, 0, 0, 0],
      [-28.3, 11.85, -0.85, 0.25, 0.65, 2.65, 0, 0, 0],
      [-28.3, 7.85, 1.35, 0.25, 0.55, 2.35, 0, 0, 0],
      [8.5, 9.65, 1.95, 0.8, 0.75, 1.95, 0, 0, 0],
      [8.5, 9.7, 14.7, 0.4, 0.3, 10.8, 0, 0, 0],
      [8.5, 9.65, 26.4, 0.8, 0.65, 0.9, 0, 0, 0],
      [-8.5, 9.65, 1.95, 0.8, 0.75, 1.95, 0, 0, 0],
      [-8.5, 9.7, 14.7, 0.4, 0.3, 10.8, 0, 0, 0],
      [-8.5, 9.65, 26.4, 0.8, 0.65, 0.9, 0, 0, 0],
      [5.495, 12.705, 26.4, 7.75, 0.4, 2.2, 0, 0, 45],
      [5.318, 12.882, 29.2, 2.5, 0.4, 0.6, 0, 0, 45],
      [-5.495, 12.705, 26.4, 7.75, 0.4, 2.2, 0, 0, -45],
      [-5.318, 12.882, 29.2, 2.5, 0.4, 0.6, 0, 0, -45],
      [0, 18.2, 26.4, 0.7, 0.5, 2.4, 0, 0, 0],
      [0, 10.15, -0.2, 1.8, 0.15, 4, 0, 0, 0],
      [1, 10.95, -0.1, 0.65, 0.65, 3.1, -25, 0, 0],
      [1, 12.19, -2.9, 0.6, 0.6, 0.7, -22.5, 0, 0],
      [1, 10.95, 3.5, 0.5, 0.5, 0.5, 0, 0, 0],
      [1, 12.025, 3.4, 0.15, 0.575, 0.2, 0, 0, 0],
      [-1, 10.95, -0.1, 0.65, 0.65, 3.1, -25, 0, 0],
      [-1, 12.19, -2.9, 0.6, 0.6, 0.7, -22.5, 0, 0],
      [-1, 10.95, 3.5, 0.5, 0.5, 0.5, 0, 0, 0],
      [-1, 12.025, 3.4, 0.15, 0.575, 0.2, 0, 0, 0],
    ],
  },
  "rocket:missile4": {
    sc: 1,
    piv: [0, 3.31712, 1.70432],
    c: [
      [0, 3, 1, 3, 3, 22, 0, 0, 0],
      [0, 3, -22, 2.5, 2.5, 1, 0, 0, 0],
      [0, 3, -23.5, 2, 2, 0.5, 0, 0, 0],
      [-13.5, 3, 17, 10.5, 0.5, 5, 0, 0, 0],
      [-12.8, 3, 11.5, 9.8, 0.5, 0.5, 0, 0, 0],
      [-12.3, 3, 10.5, 9.3, 0.5, 0.5, 0, 0, 0],
      [-11.8, 3, 9.5, 8.8, 0.5, 0.5, 0, 0, 0],
      [-11.3, 3, 8.5, 8.3, 0.5, 0.5, 0, 0, 0],
      [-10.95, 3, 7.5, 7.95, 0.5, 0.5, 0, 0, 0],
      [-10.3, 3, 6.5, 7.3, 0.5, 0.5, 0, 0, 0],
      [-9.8, 3, 5.5, 6.8, 0.5, 0.5, 0, 0, 0],
      [-9.3, 3, 4.5, 6.3, 0.5, 0.5, 0, 0, 0],
      [-8.8, 3, 3.5, 5.8, 0.5, 0.5, 0, 0, 0],
      [-8.3, 3, 2.5, 5.3, 0.5, 0.5, 0, 0, 0],
      [-7.75, 3, 1.5, 4.75, 0.5, 0.5, 0, 0, 0],
      [-7.3, 3, 0.5, 4.3, 0.5, 0.5, 0, 0, 0],
      [-6.8, 3, -0.5, 3.8, 0.5, 0.5, 0, 0, 0],
      [-6.3, 3, -1.5, 3.3, 0.5, 0.5, 0, 0, 0],
      [-6, 3, -2.5, 3, 0.5, 0.5, 0, 0, 0],
      [-5.7, 3, -3.5, 2.7, 0.5, 0.5, 0, 0, 0],
      [-5.45, 3, -4.5, 2.45, 0.5, 0.5, 0, 0, 0],
      [-5.15, 3, -5.5, 2.15, 0.5, 0.5, 0, 0, 0],
      [-4.85, 3, -6.5, 1.85, 0.5, 0.5, 0, 0, 0],
      [-4.55, 3, -7.5, 1.55, 0.5, 0.5, 0, 0, 0],
      [-4.3, 3, -8.5, 1.3, 0.5, 0.5, 0, 0, 0],
      [-4, 3, -9.5, 1, 0.5, 0.5, 0, 0, 0],
      [-3.7, 3, -10.5, 0.7, 0.5, 0.5, 0, 0, 0],
      [-3.55, 3, -11.7, 0.55, 0.5, 0.7, 0, 0, 0],
      [-16.666, 3, 5.407, 9.8, 0.5, 0.5, 0, -135, 0],
      [-6.046, 3, -8.087, 7.8, 0.5, 0.5, 0, -120, 0],
      [0, 9, 19, 0.5, 3, 2, 0, 0, 0],
      [0, 7.613, 15.94, 0.5, 4, 2, -40, 0, 0],
      [3.55, 3, -11.7, 0.55, 0.5, 0.7, 0, 0, 0],
      [6.046, 3, -8.087, 7.8, 0.5, 0.5, 0, 120, 0],
      [16.666, 3, 5.407, 9.8, 0.5, 0.5, 0, 135, 0],
      [13.5, 3, 17, 10.5, 0.5, 5, 0, 0, 0],
      [14.5, 4, 16.5, 0.5, 0.5, 3.5, 0, 0, 0],
      [12.8, 3, 11.5, 9.8, 0.5, 0.5, 0, 0, 0],
      [12.3, 3, 10.5, 9.3, 0.5, 0.5, 0, 0, 0],
      [11.8, 3, 9.5, 8.8, 0.5, 0.5, 0, 0, 0],
      [11.3, 3, 8.5, 8.3, 0.5, 0.5, 0, 0, 0],
      [10.95, 3, 7.5, 7.95, 0.5, 0.5, 0, 0, 0],
      [10.3, 3, 6.5, 7.3, 0.5, 0.5, 0, 0, 0],
      [9.8, 3, 5.5, 6.8, 0.5, 0.5, 0, 0, 0],
      [9.3, 3, 4.5, 6.3, 0.5, 0.5, 0, 0, 0],
      [8.8, 3, 3.5, 5.8, 0.5, 0.5, 0, 0, 0],
      [8.3, 3, 2.5, 5.3, 0.5, 0.5, 0, 0, 0],
      [7.75, 3, 1.5, 4.75, 0.5, 0.5, 0, 0, 0],
      [7.3, 3, 0.5, 4.3, 0.5, 0.5, 0, 0, 0],
      [6.8, 3, -0.5, 3.8, 0.5, 0.5, 0, 0, 0],
      [6.3, 3, -1.5, 3.3, 0.5, 0.5, 0, 0, 0],
      [6, 3, -2.5, 3, 0.5, 0.5, 0, 0, 0],
      [5.7, 3, -3.5, 2.7, 0.5, 0.5, 0, 0, 0],
      [5.45, 3, -4.5, 2.45, 0.5, 0.5, 0, 0, 0],
      [5.15, 3, -5.5, 2.15, 0.5, 0.5, 0, 0, 0],
      [4.85, 3, -6.5, 1.85, 0.5, 0.5, 0, 0, 0],
      [4.55, 3, -7.5, 1.55, 0.5, 0.5, 0, 0, 0],
      [4.3, 3, -8.5, 1.3, 0.5, 0.5, 0, 0, 0],
      [4, 3, -9.5, 1, 0.5, 0.5, 0, 0, 0],
      [3.7, 3, -10.5, 0.7, 0.5, 0.5, 0, 0, 0],
      [0, 3, 23.1, 1, 1, 0.5, 0, 0, 0],
      [-14.5, 4, 16.5, 0.5, 0.5, 3.5, 0, 0, 0],
      [0, 3, 24.6, 3, 1, 1, 0, 0, 0],
      [1.5, 5, 24.6, 0.5, 1, 0.5, 0, 0, 0],
      [-1.5, 5, 24.6, 0.5, 1, 0.5, 0, 0, 0],
      [1.5, 1.5, 24.6, 0.5, 0.5, 0.5, 0, 0, 0],
      [-1.5, 1.5, 24.6, 0.5, 0.5, 0.5, 0, 0, 0],
    ],
  },
  "rocket:missile": {
    sc: 1,
    piv: [0, 0, 0],
    c: [
      [7.747, 4.25, 1.474, 2, 0.75, 21.5, 0, 35, 0],
      [15, 4.25, 14, 2, 0.75, 5, 0, 0, 0],
      [18, 4.25, 16.5, 2, 0.75, 2.5, 0, 0, 0],
      [11, 4.25, 11, 2, 0.75, 8, 0, 0, 0],
      [7, 4.25, 8, 2, 0.75, 11, 0, 0, 0],
      [3, 4.25, 6, 2, 0.75, 14, 0, 0, 0],
      [18, 4.25, 16.5, 2, 0.75, 2.5, 0, 0, 0],
      [-7, 4.25, 19.5, 1.5, 0.75, 25.5, 0, 90, 0],
      [-1, 5, 2.5, 2, 2, 21.5, 0, 0, 0],
      [-1, 5.805, -20.253, 1.5, 1, 1.5, 7.5, 0, 0],
      [-1, 4.243, -20.456, 1.5, 1, 1.5, -7.5, 0, 0],
      [-0.195, 5, -20.253, 1.5, 1, 1.5, 7.5, 0, 90],
      [-1.803, 5, -20.261, 1.5, 1, 1.5, -7.5, 0, 90],
      [24.5, 4.5, 21, 0.5, 2.5, 2, 0, 0, 0],
      [-2.5, 8.5, 14.5, 0.5, 1.5, 0.5, 0, 0, 0],
      [0.5, 8.5, 14.5, 0.5, 1.5, 0.5, 0, 0, 0],
      [-2.5, 6, 28.5, 0.5, 2, 0.5, 0, 0, 0],
      [-1, 7.5, 28.5, 0.5, 1, 0.5, 0, 0, -90],
      [-1, 4.5, 28.5, 0.5, 1, 0.5, 0, 0, -90],
      [0.5, 6, 28.5, 0.5, 2, 0.5, 0, 0, 0],
      [-1, 9.5, 14.5, 0.5, 1, 0.5, 0, 0, -90],
      [-1, 8.5, 19.5, 2, 1.5, 4.5, 0, 0, 0],
      [-1, 7.924, 25.383, 2, 1, 3, -22.5, 0, 0],
      [-1, 6, 26, 2, 2, 2, 0, 0, 0],
      [-26.5, 4.5, 21, 0.5, 2.5, 2, 0, 0, 0],
      [-9.747, 4.25, 1.474, 2, 0.75, 21.5, 0, -35, 0],
      [-17, 4.25, 14, 2, 0.75, 5, 0, 0, 0],
      [-20, 4.25, 16.5, 2, 0.75, 2.5, 0, 0, 0],
      [-13, 4.25, 11, 2, 0.75, 8, 0, 0, 0],
      [-9, 4.25, 8, 2, 0.75, 11, 0, 0, 0],
      [-5, 4.25, 6, 2, 0.75, 14, 0, 0, 0],
    ],
  },
  "rocket:missile2": {
    sc: 1.2,
    piv: [0, 0, 0],
    c: [
      [4.895, 8.1, 2.753, 0.45, 0.1, 0.2, 0, -12.5, 0],
      [6.587, 8.1, 1.61, 3.85, 0.1, 0.55, 0, -12.5, 0],
      [7.975, 8.1, 2.326, 2.65, 0.1, 0.45, 0, -12.5, 0],
      [-3.895, 8.1, 2.753, 0.45, 0.1, 0.2, 0, 12.5, 0],
      [-6.975, 8.1, 2.326, 2.65, 0.1, 0.45, 0, 12.5, 0],
      [-5.587, 8.1, 1.61, 3.85, 0.1, 0.55, 0, 12.5, 0],
      [0.5, 8.4, 4, 1.3, 0.2, 3.1, 0, 0, 0],
      [0.5, 6.5, 6, 1.5, 1.5, 10, 0, 0, 0],
      [0.5, 8.1, 0, 1.5, 0.1, 4, 0, 0, 0],
      [0.5, 6.6, 16.25, 1.5, 1.6, 0.25, 0, 0, 0],
      [0.5, 6.65, 16.65, 1.4, 1.45, 0.15, 0, 0, 0],
      [0.5, 6.65, 16.95, 1.3, 1.35, 0.15, 0, 0, 0],
      [0.5, 6.65, 17.2, 1.2, 1.25, 0.1, 0, 0, 0],
      [0.5, 6.65, 17.4, 1.1, 1.15, 0.1, 0, 0, 0],
      [0.5, 6.65, 17.6, 1, 1.05, 0.1, 0, 0, 0],
      [0.5, 6.65, 17.8, 0.9, 0.95, 0.1, 0, 0, 0],
      [0.5, 6.65, 18, 0.8, 0.85, 0.1, 0, 0, 0],
      [0.5, 6.65, 18.2, 0.7, 0.75, 0.1, 0, 0, 0],
      [0.5, 6.65, 18.4, 0.6, 0.65, 0.1, 0, 0, 0],
      [0.5, 6.65, 18.6, 0.4, 0.45, 0.1, 0, 0, 0],
      [0.5, 6.6, -4.45, 1.4, 1.5, 0.45, 0, 0, 0],
      [0.5, 6.6, -4.55, 1.2, 1.4, 0.55, 0, 0, 0],
      [0.5, 6.6, -4.9, 1.2, 1.3, 0.4, 0, 0, 0],
      [0.5, 6.6, -5.2, 1, 1.1, 0.3, 0, 0, 0],
      [0.5, 6.6, -5.45, 0.8, 0.9, 0.25, 0, 0, 0],
      [0.5, 6.6, -5.65, 0.6, 0.7, 0.25, 0, 0, 0],
      [0.5, 6.6, -5.85, 0.4, 0.5, 0.25, 0, 0, 0],
      [0.5, 6.6, -6.05, 0.2, 0.2, 0.25, 0, 0, 0],
      [0.5, 8.1, 13.85, 1.5, 0.1, 2.15, 0, 0, 0],
      [1.489, 8.957, 14.6, 0.75, 0.1, 0.6, 0, 0, 101.5],
      [-0.589, 8.957, 14.6, 0.75, 0.1, 0.6, 0, 0, -101.5],
      [23.132, 7.1, 12.357, 1, 0.1, 2.1, 0, -67.5, 0],
      [-22.856, 3.785, 12.243, 0.5, 0.1, 2.1, -30, 67.5, 0],
      [23.856, 3.785, 12.243, 0.5, 0.1, 2.1, -30, -67.5, 0],
      [-22.132, 7.1, 12.357, 1, 0.1, 2.1, 0, 67.5, 0],
      [0.5, 8.4, -0.2, 0.4, 0.2, 0.3, 0, 0, 0],
      [0.5, 8.4, 0.5, 0.9, 0.2, 0.4, 0, 0, 0],
      [0.5, 4.15, 9.55, 1.1, 0.85, 3.45, 0, 0, 0],
      [0.5, 4.2, 13.6, 1.1, 0.8, 0.6, 0, 0, 0],
      [0.5, 4.45, 14.6, 1.1, 0.55, 0.4, 0, 0, 0],
      [0.5, 4.8, 15.5, 1.1, 0.2, 0.5, 0, 0, 0],
      [0.5, 4.9, 16.35, 1.1, 0.1, 0.35, 0, 0, 0],
    ],
  },
  "rocket:missile3": {
    sc: 1,
    piv: [0, 0, 0],
    c: [
      [7.747, 4.25, 1.474, 2, 0.75, 21.5, 0, 35, 0],
      [15, 4.25, 14, 2, 0.75, 5, 0, 0, 0],
      [18, 4.25, 16.5, 2, 0.75, 2.5, 0, 0, 0],
      [11, 4.25, 11, 2, 0.75, 8, 0, 0, 0],
      [7, 4.25, 8, 2, 0.75, 11, 0, 0, 0],
      [3, 4.25, 6, 2, 0.75, 14, 0, 0, 0],
      [18, 4.25, 16.5, 2, 0.75, 2.5, 0, 0, 0],
      [-7, 4.25, 19.5, 1.5, 0.75, 25.5, 0, 90, 0],
      [-1, 5, 2.5, 2, 2, 21.5, 0, 0, 0],
      [0.5, 5, 26.5, 0.5, 2, 0.5, 0, 0, 0],
      [0.5, 5, 24.5, 0.5, 2, 0.5, 0, 0, 0],
      [-1.803, 5, -20.261, 1.5, 1, 1.5, -7.5, 0, 90],
      [24.5, 4.5, 21, 0.5, 2.5, 2, 0, 0, 0],
      [-1, 5, 25.5, 1, 1, 1.5, 0, 0, 0],
      [-26.5, 4.5, 21, 0.5, 2.5, 2, 0, 0, 0],
      [-9.747, 4.25, 1.474, 2, 0.75, 21.5, 0, -35, 0],
      [-17, 4.25, 14, 2, 0.75, 5, 0, 0, 0],
      [-20, 4.25, 16.5, 2, 0.75, 2.5, 0, 0, 0],
      [-13, 4.25, 11, 2, 0.75, 8, 0, 0, 0],
      [-9, 4.25, 8, 2, 0.75, 11, 0, 0, 0],
      [-5, 4.25, 6, 2, 0.75, 14, 0, 0, 0],
      [-2.5, 5, 24.5, 0.5, 2, 0.5, 0, 0, 0],
      [-2.5, 5, 26.5, 0.5, 2, 0.5, 0, 0, 0],
      [-1, 5.805, -20.253, 1.5, 1, 1.5, 7.5, 0, 0],
      [-1, 4.243, -20.456, 1.5, 1, 1.5, -7.5, 0, 0],
      [-0.195, 5, -20.253, 1.5, 1, 1.5, 7.5, 0, 90],
    ],
  },
  "rocket:missile5": {
    sc: 1.5,
    piv: [0, 0, 0],
    c: [
      [0, 3.65, -1.65, 1.2, 0.65, 4.15, 0, 0, 0],
      [0, 4.8, 0.35, 1.2, 0.5, 2.15, 0, 0, 0],
      [0, 4.315, -3.679, 1.2, 0.5, 2.062, 14.04, 0, 0],
      [0, 3.9, 6.5, 0.5, 0.4, 4, 0, 0, 0],
      [0, 4.75, 3.45, 0.65, 0.45, 0.65, 0, 0, 0],
      [0, 4.775, 3.5, 0.7, 0.525, 0.2, 0, 0, 0],
      [-0.52, 3.9, 3.5, 0.05, 0.45, 0.2, 0, 0, 0],
      [0.52, 3.9, 3.5, 0.05, 0.45, 0.2, 0, 0, 0],
      [-6, 5.525, 0, 6, 0.225, 1.8, 0, 0, 0],
      [-12.693, 5.597, 0, 0.7, 0.2, 1.6, 0, 0, 8],
      [6, 5.525, 0, 6, 0.225, 1.8, 0, 0, 0],
      [12.693, 5.597, 0, 0.7, 0.2, 1.6, 0, 0, -8],
      [0, 6.414, 9.72, 0.15, 1.8, 1.3, -18, 0, 0],
      [0, 4.425, 9.4, 4.2, 0.175, 1, 0, 0, 0],
      [0, 3.65, -6.1, 0.55, 0.55, 0.3, 0, 0, 0],
    ],
  },
  "rocket:missile6": {
    sc: 1.2,
    piv: [0, 0, 0],
    c: [
      [-2.5, 0.5, 0.5, 0.5, 0.5, 13.5, 0, 0, 0],
      [1.5, 0.5, 0.5, 0.5, 0.5, 13.5, 0, 0, 0],
      [-0.5, 1.25, 13.5, 6.5, 0.25, 2.5, 0, 0, 0],
      [-0.5, 1.25, 16.25, 6.5, 0.25, 0.25, 0, 0, 0],
      [-10, 1.25, -4, 8, 0.25, 3, 0, 0, 0],
      [9, 1.25, -4, 8, 0.25, 3, 0, 0, 0],
      [10, 1.25, -0.75, 7, 0.25, 0.25, 0, 0, 0],
      [-0.5, 1.25, -3.25, 1.5, 0.25, 1.75, 0, 0, 0],
      [-11, 1.25, -0.75, 7, 0.25, 0.25, 0, 0, 0],
      [-0.5, 1.05, -2.5, 1.5, 0.25, 1.5, 0, 0, 0],
      [-0.5, 1.55, -2.1, 0.5, 0.25, 1, 0, 0, 0],
      [-0.2, 1.55, -3.2, 0.1, 0.25, 0.1, 0, 0, 0],
      [-0.2, 1.4, -3.3, 0.1, 0.1, 0.6, 0, 0, 0],
      [-0.8, 1.55, -3.2, 0.1, 0.25, 0.1, 0, 0, 0],
      [-0.8, 1.4, -3.4, 0.1, 0.1, 0.1, 0, 0, 0],
      [-0.6, 1.4, -3.4, 0.1, 0.1, 0.1, 0, 0, 0],
      [-0.4, 1.4, -3.4, 0.1, 0.1, 0.1, 0, 0, 0],
      [-0.5, 1.9, -2.1, 0.5, 0.1, 0.6, 0, 0, 0],
      [-0.5, 0.5, -12.45, 1.5, 0.35, 0.35, 0, 0, 0],
      [-0.5, 0.5, -9.45, 1.5, 0.35, 0.35, 0, 0, 0],
      [-0.5, 0.5, -6.45, 1.5, 0.35, 0.35, 0, 0, 0],
      [-0.5, 0.5, -13.45, 0.5, 0.5, 1.35, 0, 0, 0],
      [-0.5, 3.121, 14.001, 0.25, 1.75, 2.35, 7.5, 0, 0],
      [-0.5, 1, -8, 1, 1, 2, 0, 0, 0],
      [-0.5, 1, -5.5, 0.75, 0.75, 0.5, 0, 0, 0],
      [-0.5, 1, -10.5, 0.75, 0.75, 0.5, 0, 0, 0],
    ],
  },
};
const PC_STEP = 0.62,
  PC_R = 0.3;
const PCE = new Map(),
  PCP = new Map();
function pcRot(rx, ry, rz) {
  function m(a, x) {
    a = (-a * Math.PI) / 180;
    const c = Math.cos(a),
      s = Math.sin(a);
    return x === "x"
      ? [
          [1, 0, 0],
          [0, c, -s],
          [0, s, c],
        ]
      : x === "y"
        ? [
            [c, 0, s],
            [0, 1, 0],
            [-s, 0, c],
          ]
        : [
            [c, -s, 0],
            [s, c, 0],
            [0, 0, 1],
          ];
  }
  return pcMul(m(rz, "z"), pcMul(m(ry, "y"), m(rx, "x")));
}
function pcMul(A, B) {
  const r = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) r[i][j] = A[i][0] * B[0][j] + A[i][1] * B[1][j] + A[i][2] * B[2][j];
  return r;
}
function pcMv(A, v) {
  return [
    A[0][0] * v[0] + A[0][1] * v[1] + A[0][2] * v[2],
    A[1][0] * v[0] + A[1][1] * v[1] + A[1][2] * v[2],
    A[2][0] * v[0] + A[2][1] * v[1] + A[2][2] * v[2],
  ];
}
function pcPose(t, x, y, z, yaw, pit) {
  const M = PCM[t],
    s = M.sc / 16,
    ry = (yaw * Math.PI) / 180,
    cy = Math.cos(ry),
    sy = Math.sin(ry),
    Rp = pcRot(pit, 0, 0),
    Yw = [
      [-cy, 0, sy],
      [0, 1, 0],
      [-sy, 0, -cy],
    ],
    L = pcMul(Yw, Rp),
    out = [];
  for (let i = 0; i < M.c.length; i++) {
    const q = M.c[i],
      Rc = pcRot(q[6], q[7], q[8]),
      A = pcMul(L, Rc),
      rel = [q[0] - M.piv[0], q[1] - M.piv[1], q[2] - M.piv[2]],
      rp = pcMv(Rp, rel),
      cp = [(M.piv[0] + rp[0]) * s, (M.piv[1] + rp[1]) * s, (M.piv[2] + rp[2]) * s],
      cw = pcMv(Yw, cp);
    const ax = [
        [A[0][0], A[1][0], A[2][0]],
        [A[0][1], A[1][1], A[2][1]],
        [A[0][2], A[1][2], A[2][2]],
      ],
      h = [q[3] * s, q[4] * s, q[5] * s];
    const ext = Math.abs(ax[0][1]) * h[0] + Math.abs(ax[1][1]) * h[1] + Math.abs(ax[2][1]) * h[2];
    out.push({ c: [x + cw[0], y + cw[1], z + cw[2]], a: ax, h, top: y + cw[1] + ext, r: Math.hypot(h[0], h[1], h[2]) });
  }
  return out;
}
function pcRayDown(ox, oy, oz, b) {
  const dx = ox - b.c[0],
    dy = oy - b.c[1],
    dz = oz - b.c[2];
  let tmin = -1e9,
    tmax = 1e9;
  for (let i = 0; i < 3; i++) {
    const a = b.a[i],
      p = dx * a[0] + dy * a[1] + dz * a[2],
      d = -a[1],
      h = b.h[i];
    if (Math.abs(d) < 1e-9) {
      if (p < -h || p > h) return null;
    } else {
      let t1 = (-h - p) / d,
        t2 = (h - p) / d;
      if (t1 > t2) {
        const t = t1;
        t1 = t2;
        t2 = t;
      }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
  }
  return { tmin, tmax };
}
const PC_SM = [
  [0, 0],
  [0.27, 0.27],
  [0.27, -0.27],
  [-0.27, 0.27],
  [-0.27, -0.27],
  [0.27, 0],
  [-0.27, 0],
  [0, 0.27],
  [0, -0.27],
];
function pcSolve(st, x, feet, z, boxes) {
  const prev = st.py === undefined ? feet : st.py;
  let S = null;
  const y0 = feet < prev - 0.02 ? Math.max(feet + PC_STEP, prev + 0.02) : feet + PC_STEP;
  for (const b of boxes) {
    if (
      Math.abs(b.c[0] - x) > b.r + 0.5 ||
      Math.abs(b.c[2] - z) > b.r + 0.5 ||
      b.top < Math.min(feet, prev) - 1.5 ||
      b.c[1] - b.r > y0 + 0.1
    )
      continue;
    for (const o of PC_SM) {
      const r = pcRayDown(x + o[0], y0, z + o[1], b);
      if (r && r.tmin >= 0) {
        const sy = y0 - r.tmin;
        if (S === null || sy > S) S = sy;
      }
    }
  }
  let stand = false,
    ny = feet;
  if (S !== null) {
    const dy = feet - prev,
      above = prev >= S - 0.06,
      up = S - feet;
    if (feet <= S + 0.04 && dy <= 0.02 && (above || up <= PC_STEP)) {
      stand = true;
      let hold = st.hold === undefined ? S : st.hold;
      hold += (S - hold) * 0.5;
      st.hold = hold;
      if (feet < hold - 0.012) ny = feet + (hold - feet) * 0.55;
    }
  } else st.hold = undefined;
  st.py = ny;
  return { y: ny, stand };
}
function pcReg(e) {
  if (!PCM[e.typeId] || PCE.has(e.id)) return;
  PCE.set(e.id, { e, k: "", b: null });
}
world.afterEvents.entitySpawn.subscribe((ev) => {
  try {
    const s = ev.entity;
    if (s && PCM[s.typeId])
      system.runTimeout(() => {
        try {
          if (s.isValid()) pcReg(s);
        } catch {}
      }, 3);
  } catch {}
});
system.runInterval(() => {
  try {
    for (const dn of ["overworld", "nether", "the_end"]) {
      const dm = world.getDimension(dn);
      for (const t in PCM) for (const s of dm.getEntities({ type: t })) pcReg(s);
    }
  } catch {}
}, 60);
system.runInterval(() => {
  try {
    if (!PCE.size) return;
    const tick = system.currentTick,
      live = [];
    for (const [id, r] of PCE) {
      let ok = false;
      try {
        ok = r.e.isValid();
      } catch {}
      if (!ok) {
        PCE.delete(id);
        continue;
      }
      live.push(r);
    }
    for (const pl of world.getAllPlayers()) {
      try {
        if (pl.isFlying) continue;
        const l = pl.location,
          did = pl.dimension.id;
        let st = PCP.get(pl.id);
        if (!st) {
          st = { py: l.y, stand: 0, jcd: 0 };
          PCP.set(pl.id, st);
        }
        const boxes = [];
        for (const r of live) {
          const e = r.e;
          if (e.dimension.id !== did) continue;
          const el = e.location;
          if (Math.abs(el.x - l.x) > 9 || Math.abs(el.z - l.z) > 9) continue;
          if (isDroneLaunched(e)) continue;
          const ro = e.getRotation(),
            k =
              el.x.toFixed(3) +
              "|" +
              el.y.toFixed(3) +
              "|" +
              el.z.toFixed(3) +
              "|" +
              ro.y.toFixed(1) +
              "|" +
              ro.x.toFixed(1);
          if (r.k !== k) {
            r.b = pcPose(e.typeId, el.x, el.y, el.z, ro.y, ro.x);
            r.k = k;
          }
          for (const b of r.b) boxes.push(b);
        }
        if (!boxes.length) {
          st.py = l.y;
          st.hold = undefined;
          st.stand = Math.max(0, st.stand - 1);
          continue;
        }
        let res = pcSolve(st, l.x, l.y, l.z, boxes);
        const gY = dbgGroundY(pl.dimension, l.x, l.z, Math.max(l.y, res.y) + 2);
        if (gY !== null && res.y < gY + 0.02) {
          res = { y: Math.max(l.y, gY), stand: false };
          st.py = res.y;
          st.hold = undefined;
        }
        if (Math.abs(res.y - l.y) > 5e-3) {
          try {
            pl.teleport({ x: l.x, y: res.y, z: l.z });
          } catch {}
        }
        if (res.stand) st.stand = 4;
        else st.stand = Math.max(0, st.stand - 1);
        let jmp = false;
        try {
          jmp = !!pl.isJumping;
        } catch {}
        if (jmp && st.stand > 0 && tick >= st.jcd) {
          try {
            pl.applyKnockback(0, 0, 0, 0.42);
          } catch {}
          st.jcd = tick + 9;
          st.stand = 0;
        }
      } catch {}
    }
  } catch {}
}, 1);

// ============================================================================
// §13 ИНИЦИАЛИЗАЦИЯ
// ============================================================================

/**
 * Глобальная очистка зон тиков после загрузки скрипта (/reload, перезапуск мира).
 * Зоны переживают перезагрузку, а память скрипта — нет, поэтому их список
 * хранится в мире (TickingAreas.KEY). Очистка идёт в два этапа:
 *   1) через 2 с: обход измерений; дроны, которые всё ещё летят, забирают
 *      свои зоны обратно (иначе дальние дроны «застынут» в выгруженных чанках);
 *   2) ещё через 8 с: все зоны без летящего дрона удаляются командой
 *      `tickingarea remove drone_<id>`, и лимит в 10 зон освобождается.
 */
function startupAreaCleanup(stage) {
  try {
    TickingAreas.load();
    sweepDrones();
    if (stage === 1) {
      const total = TickingAreas.count();
      if (total) console.warn(`[БПЛА] Найдено зон тиков дронов после перезагрузки: ${total}. Проверка через 8 с.`);
      system.runTimeout(() => startupAreaCleanup(2), 160);
      return;
    }
    const removed = areaHousekeeping();
    if (removed) console.warn(`[БПЛА] Удалено зон тиков без летящих дронов: ${removed}.`);
  } catch (err) {
    logError("startupAreaCleanup", err);
  }
}

/** Цикл с защитой: ошибка в одном тике не останавливает интервал. */
function guardedInterval(name, fn, ticks) {
  system.runInterval(() => {
    try {
      fn();
    } catch (err) {
      logError(name, err);
    }
  }, ticks);
}

guardedInterval("droneTick", droneTick, 1); // полёт всех дронов
guardedInterval("sweepDrones", sweepDrones, 20); // поиск новых и загруженных дронов
guardedInterval("smokeTick", smokeTick, 3); // дым над воронками
guardedInterval("hudTick", hudTick, 10); // строка состояния у игроков с планшетом
guardedInterval("areaHousekeeping", areaHousekeeping, CONFIG.AREA_HOUSEKEEPING_INTERVAL); // уборка зон тиков
system.runTimeout(() => startupAreaCleanup(1), 40);

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
 *   §2  Каталог дронов: полёт, звук, взрыв, крепление на пусковой установке (ПУ)
 *   §3  Хранилища: шаблоны целей (мир), отмеченные точки, маршруты, архив (игрок)
 *   §4  Менеджер зон тиков (tickingarea): создание, следование, удаление, очистка
 *   §5  Эффекты: частицы, дым, вспышка, взрыв, звук двигателей
 *   §6  Коллизии с блоками (AABB, общий модуль для дронов и обломков)
 *   §7  Реестр дронов и полётный контроллер (наведение, коллизии, подрыв)
 *   §8  Модуль пуска: одиночный пуск и залп, строй, задержки, дроны на ПУ
 *   §9  UI-планшет (server-ui): пуск, активные дроны, шаблоны, архив, служебное
 *   §10 Ввод игрока: пульты, клик по дрону, установка дрона на ПУ
 *   §11 Физика обломков (debris)
 *   §12 Палуба и твёрдые части моделей (игрок может стоять на дроне)
 *   §13 Инициализация: очистка зон тиков после перезагрузки, запуск циклов
 *
 *  Как пользоваться (коротко):
 *   • «Пульт цели» / «Пульт архива маршрутов» — это планшет.
 *     ПКМ в воздух открывает меню. ПКМ по блоку отмечает блок как цель
 *     и открывает форму пуска. С Shift+ПКМ по блоку точка только отмечается.
 *   • «Пульт маршрута»: ПКМ по блоку добавляет промежуточную точку
 *     (на CONFIG.WAYPOINT_ALT блоков выше блока). Маршрут завершается
 *     отметкой цели планшетом.
 *   • Клик по дрону на ПУ: с планшетом в руке открывает форму пуска этого дрона,
 *     без планшета запускает дрон по последнему маршруту с пульта.
 *   • Служебные команды: /scriptevent bpla:areas (статус зон тиков),
 *     /scriptevent bpla:cleanup (удалить зоны дронов, которые больше не летят).
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
  // --- Пуск ---------------------------------------------------------------
  MAX_SWARM: 8, // максимум дронов в одном залпе (слайдер 1..MAX_SWARM)
  FORMATION_SPACING: 4.5, // расстояние между дронами в строю, блоков
  LAUNCH_FORWARD: 4, // точка старта: на столько блоков впереди игрока...
  LAUNCH_HEIGHT: 3, // ...и на столько блоков выше его ног
  LAUNCHER_SEARCH_RADIUS: 48, // радиус поиска дронов на ПУ вокруг игрока
  CONSUME_ITEMS_IN_SURVIVAL: true, // в выживании запуск «из планшета» тратит предметы дронов
  DEFAULT_CRUISE_ALT: 30, // высота марша над целью/стартом по умолчанию
  WAYPOINT_ALT: 30, // высота точек пульта маршрута над блоком (как в оригинале)
  MAX_WAYPOINTS: 8, // максимум промежуточных точек пульта маршрута
  MAX_RANGE: 4000, // максимальная горизонтальная дальность до цели
  ROUTE_SCATTER: 5, // разброс удара при повторе маршрута из архива, блоков

  // --- Полёт --------------------------------------------------------------
  SPEED_MULT: 1.0, // общий множитель скорости всех дронов
  ARRIVE_RADIUS: 2.5, // подрыв при сближении с целью ближе этого расстояния
  CRUISE_MAX_PITCH: 25, // предельный тангаж на марше, градусов
  ALT_HOLD_BASE: 40, // база удержания высоты на марше: ошибка высоты / база = желаемый наклон
  TERMINAL_RANGE: 26, // с этой горизонтальной дистанции начинается пикирование...
  TERMINAL_BLEND: 12, // ...и за столько блоков доходит до чистого наведения на цель
  LAUNCHER_BLOCK_GRACE: 60, // тиков без проверки блоков после схода с ПУ
  AIR_LAUNCH_BLOCK_GRACE: 12, // то же для дронов, запущенных «из планшета»
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
/** Приводит угол в радианах к диапазону [-π, π). */
const wrapPi = (a) => ((((a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
/** Интерполяция угла по кратчайшей дуге. */
const lerpAngle = (a, b, t) => a + wrap180(b - a) * t;
const smoothstep = (t) => t * t * (3 - 2 * t);

const vcopy = (p) => ({ x: p.x, y: p.y, z: p.z });
const vadd = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const vsub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const vscale = (a, k) => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const vlen = (a) => Math.hypot(a.x, a.y, a.z);
const vdist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const hdist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const vnorm = (a) => {
  const l = vlen(a);
  return l > 1e-9 ? { x: a.x / l, y: a.y / l, z: a.z / l } : { x: 0, y: 0, z: 1 };
};
const floorPoint = (p) => ({ x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) });
const blockCenter = (p) => ({ x: Math.floor(p.x) + 0.5, y: Math.floor(p.y) + 0.5, z: Math.floor(p.z) + 0.5 });
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

/**
 * Разбирает X/Y/Z из формы и проверяет их.
 * Возвращает { ok, point } с центром блока или { ok: false, error }.
 */
function parseTargetFields(xs, ys, zs, base, dimId) {
  const x = parseCoordinate(xs, base.x),
    y = parseCoordinate(ys, base.y),
    z = parseCoordinate(zs, base.z);
  if (![x, y, z].every(Number.isFinite)) {
    return { ok: false, error: "Координаты должны быть числами (можно ~ для относительных)." };
  }
  return validateTarget(blockCenter({ x, y, z }), base, dimId);
}

/** Проверка цели: высота в пределах измерения и дальность. */
function validateTarget(point, base, dimId) {
  const [minY, maxY] = dimLimits(dimId);
  if (point.y < minY || point.y >= maxY) {
    return { ok: false, error: `Высота Y должна быть в пределах ${minY}..${maxY - 1}.` };
  }
  if (hdist(point, base) > CONFIG.MAX_RANGE) {
    return { ok: false, error: `Цель дальше ${CONFIG.MAX_RANGE} блоков.` };
  }
  return { ok: true, point };
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
    freePlacement: true, // ставится без ПУ
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
  CRUISE: "bpla:cruise",
  TARGET_OFFSET: "bpla:toff",
};

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

/** Точка, отмеченная планшетом (ПКМ по блоку). Хранится у игрока. */
const Captures = {
  KEY: "bpla:capture",
  get(player) {
    const c = readJSON(player, this.KEY, null);
    return c && isPoint(c) && typeof c.dim === "string" ? c : null;
  },
  set(player, point, dimId) {
    writeJSON(player, this.KEY, { x: Math.floor(point.x), y: Math.floor(point.y), z: Math.floor(point.z), dim: dimId });
  },
};

/** Последние настройки формы пуска: форма открывается с ними в следующий раз. */
const LaunchPrefs = {
  KEY: "bpla:prefs",
  get(player) {
    const d = {
      type: 0,
      count: 1,
      formation: 0,
      interval: 1,
      spread: 0,
      cruise: CONFIG.DEFAULT_CRUISE_ALT,
      useLaunchers: true,
    };
    const saved = readJSON(player, this.KEY, {});
    return Object.assign(d, saved && typeof saved === "object" ? saved : {});
  },
  set(player, prefs) {
    writeJSON(player, this.KEY, prefs);
  },
};

/**
 * Маршруты «пульта маршрута» (логика оригинала).
 *  • PENDING: точки, которые ставятся прямо сейчас. Держатся в памяти до отметки цели.
 *  • last_bpla_route: готовый маршрут. Последняя точка — цель.
 *  • bpla_route_history: архив из CONFIG.MAX_ROUTE_HISTORY последних маршрутов.
 */
const PENDING_WAYPOINTS = new Map(); // playerId -> Vector3[]
const Routes = {
  LAST: "last_bpla_route",
  HISTORY: "bpla_route_history",

  pending(player) {
    return PENDING_WAYPOINTS.get(player.id) ?? [];
  },

  last(player) {
    const r = readJSON(player, this.LAST, null);
    return Array.isArray(r) && r.length && r.every(isPoint) ? r : null;
  },

  setLast(player, route) {
    writeJSON(player, this.LAST, route ?? undefined);
  },

  /** Промежуточные точки для «пуска по точкам»: сначала текущие, иначе из готового маршрута. */
  waypointsFor(player) {
    const pending = this.pending(player);
    if (pending.length) return pending;
    const last = this.last(player);
    return last && last.length > 1 ? last.slice(0, -1) : [];
  },

  history(player) {
    const h = readJSON(player, this.HISTORY, []);
    return Array.isArray(h) ? h.filter((it) => it && Array.isArray(it.route) && it.route.length) : [];
  },

  pushHistory(player, route) {
    let h = this.history(player);
    h.push({ route, time: Date.now() });
    if (h.length > CONFIG.MAX_ROUTE_HISTORY) h = h.slice(h.length - CONFIG.MAX_ROUTE_HISTORY);
    writeJSON(player, this.HISTORY, h);
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
//   2. переход к следующей точке маршрута, если текущая пройдена;
//   3. вектор на цель: желаемые курс и тангаж;
//   4. плавный поворот: угловая скорость ограничена радиусом разворота,
//      тангаж ограничен CONFIG.CRUISE_MAX_PITCH (на пикировании — больше);
//   5. на финальном участке направление плавно смешивается с прямым
//      вектором на цель (терминальное наведение гарантирует попадание);
//   6. проверки: цель ближе CONFIG.ARRIVE_RADIUS → подрыв; блоки и существа
//      на пути → подрыв;
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
 * @property {{x:number,y:number,z:number}[]} route  оставшиеся точки; последняя — цель
 * @property {string} owner       имя игрока, запустившего дрон
 * @property {string} callsign    позывной, например «Ш-136-12»
 * @property {string} group       номер залпа
 * @property {number} cruise      высота марша над целью
 * @property {{x:number,z:number}} toff  смещение точки удара в залпе (сохраняется при коррекции)
 * @property {{yaw:number,pitch:number,pos:?{x:number,y:number,z:number}}|null} mount  положение на ПУ
 * @property {{x:number,y:number,z:number}} pos  расчётная позиция (источник истины для полёта)
 * @property {number} yaw
 * @property {number} pitch
 * @property {number} yawRate
 * @property {number} spdFactor
 * @property {number} turned      накопленный разворот, градусов (защита от кружения вокруг точки)
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
  const toff = readJSON(entity, DP.TARGET_OFFSET, null);
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
    cruise: Number(getDP(entity, DP.CRUISE)) || CONFIG.DEFAULT_CRUISE_ALT,
    toff: toff && Number.isFinite(toff.x) && Number.isFinite(toff.z) ? { x: toff.x, z: toff.z } : { x: 0, z: 0 },
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
  setDP(e, DP.CRUISE, st.cruise);
  writeJSON(e, DP.TARGET_OFFSET, st.toff);
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
  if (st.route.length > 1) return `марш, точка маршрута (осталось ${st.route.length - 1})`;
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

/** Радиус, с которого промежуточная точка считается пройденной. Зависит от манёвренности и угла следующего поворота. */
function passRadius(st, wp, next) {
  const base = Math.max(4.5, (st.cfg.turnRadius / st.cfg.turn) * 0.55);
  let rb = base;
  if (next) {
    const seg = Math.hypot(next.x - wp.x, next.z - wp.z);
    rb *= 1 + 0.6 * clamp01((2 * rb - seg) / (2 * rb));
    const b1 = Math.atan2(wp.z - st.pos.z, wp.x - st.pos.x),
      b2 = Math.atan2(next.z - wp.z, next.x - wp.x),
      turnAngle = Math.abs(wrapPi(b2 - b1));
    rb = Math.max(rb, base * (1 + (1.45 * turnAngle) / Math.PI));
  }
  return rb;
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
    if (hdist(wp, st.pos) < passRadius(st, wp, st.route[1]) || st.turned > 200) {
      st.route.shift();
      st.turned = 0;
      routeChanged = true;
    } else break;
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
// §8  МОДУЛЬ ПУСКА: ОДИНОЧНЫЙ ПУСК И ЗАЛП
// ============================================================================
// Залп не создаёт дроны в одной точке, иначе они застревают друг в друге.
//  • Каждый дрон получает слот строя: клин, шеренга или колонна. Слот
//    задаёт смещение точки старта (шаг CONFIG.FORMATION_SPACING) поперёк
//    и вдоль курса на цель.
//  • Пуски разнесены во времени через system.runTimeout
//    (по умолчанию 1 дрон в секунду).
//  • Тот же слот задаёт смещение точки удара («разброс»), так что залп
//    накрывает площадь, а не одну точку.
//  • Сначала задействуются дроны, уже стоящие на ПУ рядом с игроком.
//    Недостающие появляются перед игроком; в выживании на каждый такой
//    дрон тратится предмет из инвентаря.

/** Варианты строя (порядок совпадает с выпадающим списком формы). */
const FORMATIONS = [
  { id: "wedge", name: "Клин" },
  { id: "line", name: "Шеренга" },
  { id: "column", name: "Колонна" },
];

/**
 * Слоты строя в «единицах строя».
 * lat — вправо (+) или влево (−) от курса, back — назад (отрицательные значения).
 */
function formationSlots(kind, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const k = Math.ceil(i / 2),
      side = i % 2 === 1 ? -1 : 1,
      lat = i === 0 ? 0 : side * k;
    if (kind === "line") out.push({ lat, back: 0 });
    else if (kind === "column") out.push({ lat: 0, back: -i });
    else out.push({ lat, back: -k }); // клин: ведущий впереди, ведомые уступом назад
  }
  return out;
}

/** Горизонтальный единичный курс from → to (запасной вариант — направление взгляда). */
function horizontalHeading(from, to, fallbackDir) {
  let dx = to.x - from.x,
    dz = to.z - from.z;
  let l = Math.hypot(dx, dz);
  if (l < 0.5 && fallbackDir) {
    dx = fallbackDir.x;
    dz = fallbackDir.z;
    l = Math.hypot(dx, dz);
  }
  return l > 1e-6 ? { x: dx / l, y: 0, z: dz / l } : { x: 0, y: 0, z: 1 };
}

/**
 * Маршрут до цели.
 *  • Если заданы точки пульта маршрута: они (со смещением слота строя), затем цель.
 *  • Иначе автоматический профиль: набор высоты → марш на высоте cruise →
 *    точка захода примерно на 45° перед целью → пикирование.
 *    climb:false (коррекция в полёте) — без участка набора высоты.
 */
function buildRoute(start, target, opts) {
  const dimId = opts.dimId;
  const [minY, maxY] = dimLimits(dimId);
  const cruise = clamp(Number(opts.cruise) || CONFIG.DEFAULT_CRUISE_ALT, 0, 200);
  const fixY = (y) => clamp(y, minY + 2, maxY - 3);
  const route = [];

  if (opts.waypoints && opts.waypoints.length) {
    const off = opts.waypointOffset ?? { x: 0, z: 0 };
    for (const w of opts.waypoints) route.push({ x: w.x + off.x, y: fixY(w.y), z: w.z + off.z });
    route.push(target);
    return route.map(roundPoint);
  }

  const dx = target.x - start.x,
    dz = target.z - start.z,
    horiz = Math.hypot(dx, dz);
  if (cruise < 1 || horiz < 1) return [roundPoint(target)];
  const hx = dx / horiz,
    hz = dz / horiz;
  const climbing = opts.climb !== false;
  const cruiseY = fixY((climbing ? Math.max(start.y, target.y) : target.y) + cruise);
  const approach = clamp(cruiseY - target.y, 16, 40);
  const climbDist = climbing ? clamp((cruiseY - start.y) / Math.tan(22 * RAD), 20, 90) : 0;

  if (climbing && climbDist < horiz - approach - 12) {
    route.push({ x: start.x + hx * climbDist, y: cruiseY, z: start.z + hz * climbDist });
  }
  if (horiz > approach + 12) {
    route.push({ x: target.x - hx * approach, y: cruiseY, z: target.z - hz * approach });
  }
  route.push(target);
  return route.map(roundPoint);
}

// ---------------------------------------------------------------------------
// Инвентарь (расход дронов в выживании)
// ---------------------------------------------------------------------------
function inventoryOf(player) {
  return safe(() => player.getComponent("minecraft:inventory").container, undefined);
}

function heldItemId(player) {
  const inv = inventoryOf(player);
  return safe(() => inv.getItem(player.selectedSlotIndex)?.typeId, undefined);
}

function needsItems(player) {
  if (!CONFIG.CONSUME_ITEMS_IN_SURVIVAL) return false;
  const gm = safe(() => player.getGameMode(), GameMode.creative);
  return gm === GameMode.survival || gm === GameMode.adventure;
}

function countItems(player, itemId) {
  const inv = inventoryOf(player);
  if (!inv) return 0;
  let n = 0;
  for (let i = 0; i < inv.size; i++) {
    const it = safe(() => inv.getItem(i), undefined);
    if (it && it.typeId === itemId) n += it.amount;
  }
  return n;
}

/** Забирает до n предметов. Возвращает, сколько удалось забрать. */
function takeItems(player, itemId, n) {
  const inv = inventoryOf(player);
  if (!inv || n <= 0) return 0;
  let left = n;
  for (let i = 0; i < inv.size && left > 0; i++) {
    const it = safe(() => inv.getItem(i), undefined);
    if (!it || it.typeId !== itemId) continue;
    const take = Math.min(it.amount, left);
    try {
      if (take >= it.amount) inv.setItem(i, undefined);
      else {
        it.amount -= take;
        inv.setItem(i, it);
      }
      left -= take;
    } catch {}
  }
  return n - left;
}

/** Возврат предметов (если запуск не удался): в инвентарь, а если он полон — на землю. */
function giveItems(player, itemId, n) {
  if (n <= 0 || !isValid(player)) return;
  try {
    const rest = inventoryOf(player)?.addItem(new ItemStack(itemId, n));
    if (rest) player.dimension.spawnItem(rest, player.location);
  } catch {}
}

// ---------------------------------------------------------------------------
// Поиск дронов на ПУ и точки старта
// ---------------------------------------------------------------------------
/** Свободные дроны нужного типа на ПУ вокруг точки, ближайшие первыми. */
function findIdleMountedDrones(dim, origin, typeId, max) {
  let list = [];
  try {
    list = dim.getEntities({ type: typeId, location: origin, maxDistance: CONFIG.LAUNCHER_SEARCH_RADIUS });
  } catch {}
  return list
    .filter(
      (e) =>
        isValid(e) &&
        !RESERVED.has(e.id) &&
        getDP(e, DP.LAUNCHED) !== true &&
        typeof getDP(e, DP.MOUNT_YAW) === "number",
    )
    .sort((a, b) => vdist(a.location, origin) - vdist(b.location, origin))
    .slice(0, max);
}

/** Поднимает точку старта вверх, пока она внутри твёрдого блока (не выше чем на 8 блоков). */
function findFreeSpawnPoint(dim, p) {
  const [, maxY] = dimLimits(dim.id);
  const q = vcopy(p);
  for (let i = 0; i < 8 && q.y < maxY - 2; i++) {
    const b = safe(() => dim.getBlock(floorPoint(q)), undefined);
    if (!b || b.isAir || b.isLiquid) return q;
    q.y += 1;
  }
  return q;
}

// ---------------------------------------------------------------------------
// Старт одного дрона
// ---------------------------------------------------------------------------
/**
 * Переводит сущность дрона в полёт по маршруту: заполняет состояние, пишет
 * данные в сущность, включает группу компонентов rocket:route_ticking
 * (без гравитации и коллизий), создаёт зону тиков и проигрывает эффекты старта.
 * opts: { route, owner, group, cruise, toff, fromLauncher, yaw, pitch }
 */
function startFlight(entity, opts) {
  if (!isValid(entity)) return null;
  const st = registerDrone(entity);
  if (!st) return null;
  const cfg = st.cfg;
  st.launched = true;
  st.hit = false;
  st.dead = false;
  st.route = (opts.route ?? []).filter(isPoint).map(roundPoint);
  st.owner = opts.owner ?? "";
  st.group = opts.group ?? "";
  st.cruise = Number(opts.cruise) || CONFIG.DEFAULT_CRUISE_ALT;
  st.toff = opts.toff ? { x: opts.toff.x, z: opts.toff.z } : { x: 0, z: 0 };
  st.callsign = `${cfg.short}-${nextSequence("bpla:callsign_seq")}`;
  st.flightTicks = 0;
  st.turned = 0;
  st.yawRate = 0;
  st.spdFactor = 1;
  st.snd = 0;
  st.hitPitch = undefined;
  st.lastDir = null;
  st.areaRetryAt = 0;
  st.areaWarned = false;
  st.pos = vcopy(entity.location);
  st.dimId = safe(() => entity.dimension.id, st.dimId);

  const onLauncher = !!opts.fromLauncher && !!st.mount;
  if (onLauncher) {
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
    st.blockGrace = CONFIG.AIR_LAUNCH_BLOCK_GRACE;
    st.yaw = opts.yaw ?? r.y;
    st.pitch = opts.pitch ?? r.x;
  }
  st.entityGrace = CONFIG.ENTITY_COLLISION_GRACE;

  persistFlight(st);
  try {
    entity.triggerEvent("rocket:route_start");
  } catch {}
  if (!onLauncher) {
    try {
      entity.teleport(st.pos, { rotation: { x: st.pitch, y: st.yaw } });
    } catch {}
  }

  // Зона тиков создаётся сразу при старте (tickingarea add circle X Y Z 2 drone_<id>).
  if (!TickingAreas.add(st.id, st.dimId, st.pos)) st.areaRetryAt = system.currentTick + 1;
  playLaunchFx(st);
  return st;
}

/** Создаёт дрон в воздухе. Флаг полёта ставится сразу, чтобы §10 не снял дрон «без ПУ». */
function spawnDrone(dim, typeId, pos, yaw) {
  let e;
  try {
    e = dim.spawnEntity(typeId, pos);
  } catch (err) {
    logError("spawnEntity", err);
    return null;
  }
  setDP(e, DP.LAUNCHED, true);
  try {
    e.teleport(pos, { rotation: { x: -15, y: yaw } });
  } catch {}
  // Повтор события на следующем тике: гарантированно убирает группу rocket:idle
  // (гравитацию), которую добавляет minecraft:entity_spawned.
  system.run(() => {
    if (isValid(e)) safe(() => e.triggerEvent("rocket:route_start"));
  });
  return e;
}

/**
 * Выполняет план пуска (одиночный пуск или залп).
 * plan: { typeId, count, target, formation, intervalTicks, spread, cruise, useLaunchers, waypoints }
 * Возвращает число дронов, поставленных в очередь на пуск.
 */
function executeLaunch(player, plan) {
  const dim = player.dimension,
    dimId = dim.id,
    cfg = DRONE_TYPES[plan.typeId];
  if (!cfg) return 0;
  const origin = vcopy(player.location);
  const view = safe(() => player.getViewDirection(), { x: 0, y: 0, z: 1 });
  const hdg = horizontalHeading(origin, plan.target, view);
  const right = { x: -hdg.z, y: 0, z: hdg.x };
  const count = clamp(Math.floor(plan.count), 1, CONFIG.MAX_SWARM);
  const slots = formationSlots(plan.formation, count);
  const offsetOf = (slot, scale) => ({
    x: (right.x * slot.lat + hdg.x * slot.back) * scale,
    y: 0,
    z: (right.z * slot.lat + hdg.z * slot.back) * scale,
  });

  // 1) Дроны, уже стоящие на ПУ рядом.
  const mounted = plan.useLaunchers ? findIdleMountedDrones(dim, origin, plan.typeId, count) : [];
  for (const e of mounted) RESERVED.add(e.id);

  // 2) Остальные создаются перед игроком (в выживании за предметы).
  let spawnCount = count - mounted.length;
  const paid = spawnCount > 0 && needsItems(player);
  if (paid) {
    const have = countItems(player, cfg.item);
    if (have < spawnCount) {
      msg(player, `§e[БПЛА] В инвентаре только ${have} × «${cfg.name}» (нужно ${spawnCount}).`);
    }
    spawnCount = takeItems(player, cfg.item, Math.min(have, spawnCount));
  }
  const total = mounted.length + spawnCount;
  if (total === 0) {
    msg(player, `§c[БПЛА] Нет доступных дронов «${cfg.name}»: поставьте их на ПУ или возьмите в инвентарь.`);
    return 0;
  }

  const group = `З-${nextSequence("bpla:group_seq")}`;
  const owner = player.name;
  const interval = Math.max(0, Math.floor(plan.intervalTicks));
  const anchor = {
    x: origin.x + hdg.x * CONFIG.LAUNCH_FORWARD,
    y: origin.y + CONFIG.LAUNCH_HEIGHT,
    z: origin.z + hdg.z * CONFIG.LAUNCH_FORWARD,
  };
  const schedule = (fn, delay) => (delay > 0 ? system.runTimeout(fn, delay) : fn());
  let k = 0;

  // Пуск с ПУ. Позиция старта — сама ПУ, а слот строя задаёт только смещение точки удара.
  for (const e of mounted) {
    const slot = slots[k];
    const toff = offsetOf(slot, plan.spread);
    const target = vadd(plan.target, toff);
    const wpOff = offsetOf(slot, CONFIG.FORMATION_SPACING);
    schedule(() => {
      RESERVED.delete(e.id);
      if (!isValid(e) || getDP(e, DP.LAUNCHED) === true) {
        msg(findPlayerByName(owner), "§e[БПЛА] Один из дронов на ПУ стал недоступен, пуск пропущен.");
        return;
      }
      const route = buildRoute(e.location, target, {
        dimId,
        cruise: plan.cruise,
        waypoints: plan.waypoints,
        waypointOffset: wpOff,
      });
      startFlight(e, { route, owner, group, cruise: plan.cruise, toff, fromLauncher: true });
    }, k * interval);
    k++;
  }

  // Пуск «из планшета»: строй в воздухе перед игроком, дроны разнесены по слотам.
  for (let i = 0; i < spawnCount; i++) {
    const slot = slots[k];
    const toff = offsetOf(slot, plan.spread);
    const target = vadd(plan.target, toff);
    const wpOff = offsetOf(slot, CONFIG.FORMATION_SPACING);
    const spawnPos = findFreeSpawnPoint(dim, vadd(anchor, offsetOf(slots[i], CONFIG.FORMATION_SPACING)));
    schedule(() => {
      const route = buildRoute(spawnPos, target, {
        dimId,
        cruise: plan.cruise,
        waypoints: plan.waypoints,
        waypointOffset: wpOff,
      });
      const first = route[0];
      const yaw = Math.atan2(-(first.x - spawnPos.x), first.z - spawnPos.z) * DEG;
      const e = spawnDrone(dim, plan.typeId, spawnPos, yaw);
      if (!e) {
        const pl = findPlayerByName(owner);
        if (paid) giveItems(pl, cfg.item, 1);
        msg(pl, "§c[БПЛА] Не удалось создать дрон (точка старта не загружена?).");
        return;
      }
      startFlight(e, { route, owner, group, cruise: plan.cruise, toff, fromLauncher: false, yaw, pitch: -15 });
    }, k * interval);
    k++;
  }

  const parts = [];
  if (mounted.length) parts.push(`с ПУ: ${mounted.length}`);
  if (spawnCount) parts.push(`с планшета: ${spawnCount}`);
  msg(
    player,
    `§a[БПЛА] ${total > 1 ? `Залп ${group}` : "Пуск"}: ${total} × ${cfg.name} » ${fmtPos(plan.target)} ` +
      `§7(${parts.join(", ")}${total > 1 ? `, интервал ${interval / 20} с` : ""})`,
  );
  return total;
}

/** Пуск конкретного дрона на ПУ (клик по дрону с планшетом в руке). */
function launchSpecificDrone(player, entity, target, cruise, waypoints) {
  if (!isValid(entity) || getDP(entity, DP.LAUNCHED) === true) {
    msg(player, "§c[БПЛА] Этот дрон уже запущен или недоступен.");
    return null;
  }
  const dimId = entity.dimension.id;
  const route = buildRoute(entity.location, target, { dimId, cruise, waypoints });
  const st = startFlight(entity, { route, owner: player.name, cruise, fromLauncher: true });
  if (st) msg(player, `§a[БПЛА] Старт произведён! ${st.callsign} » ${fmtPos(target)}`);
  return st;
}

/**
 * Коррекция цели в полёте. nominal — «центр» цели для залпа.
 * К нему добавляется собственное смещение дрона (toff), поэтому залп сохраняет раскладку ударов.
 */
function retargetDrone(st, nominal, cruise) {
  if (!st || st.dead || st.hit || !st.launched || !isValid(st.entity)) return false;
  const target = { x: nominal.x + st.toff.x, y: nominal.y, z: nominal.z + st.toff.z };
  st.cruise = cruise;
  st.route = buildRoute(st.pos, target, { dimId: st.dimId, cruise, climb: false });
  st.turned = 0;
  persistRoute(st);
  setDP(st.entity, DP.CRUISE, cruise);
  return true;
}

// ============================================================================
// §9  UI-ПЛАНШЕТ (@minecraft/server-ui)
// ============================================================================
// Экраны:
//   Главное меню
//    ├─ Пуск дронов: тип, цель (X/Y/Z, отмеченная точка, блок под прицелом,
//    │   шаблон), количество, строй, интервал, разброс, высота марша,
//    │   дроны на ПУ, точки маршрута
//    ├─ Активные дроны: список летящих → карточка дрона → коррекция цели
//    │   (для одного дрона или всего залпа) или подрыв
//    ├─ Шаблоны целей: сохранить свою позицию, отмеченную точку или
//    │   введённые координаты; просмотр, пуск по шаблону, удаление
//    ├─ Архив маршрутов: повтор прошлых маршрутов (как у «Пульта архива маршрутов»)
//    └─ Служебное: состояние зон тиков, уборка, аварийное удаление
// Формы собираются обёртками ModalBuilder и MenuBuilder: поля адресуются по
// ключам, а не по индексам, поэтому необязательные поля не сбивают разбор ответа.

const UI_BUSY = new Set(); // игроки, у которых сейчас открыт планшет
const LAST_BLOCK_CAPTURE = new Map(); // playerId -> тик последней отметки блока

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

/** Источники цели для выпадающего списка: ручной ввод, отмеченная точка, прицел, шаблоны. */
function targetSources(player, dimId) {
  const list = [{ label: "Ввести вручную (поля X / Y / Z ниже)", kind: "manual" }];
  const cap = Captures.get(player);
  if (cap && cap.dim === dimId)
    list.push({ label: `Отмеченная пультом точка: ${fmtPos(cap)}`, kind: "point", point: cap });
  if (safe(() => player.dimension.id, "") === dimId) {
    const look = lookAtBlock(player);
    if (look) list.push({ label: `Блок под прицелом: ${fmtPos(look)}`, kind: "point", point: look });
  }
  for (const p of Presets.all()) {
    if (p.dim === dimId) list.push({ label: `Шаблон «${p.name}»: ${fmtPos(p)}`, kind: "point", point: p, preset: p });
  }
  return list;
}

/** Значения полей X/Y/Z по умолчанию: подсказка → отмеченная точка → прицел → позиция игрока. */
function defaultTargetFields(player, hint) {
  const dimId = player.dimension.id;
  let p = hint && isPoint(hint) ? hint : null;
  if (!p) {
    const cap = Captures.get(player);
    if (cap && cap.dim === dimId) p = cap;
  }
  if (!p) p = lookAtBlock(player);
  if (!p) p = player.location;
  const f = floorPoint(p);
  return { x: String(f.x), y: String(f.y), z: String(f.z) };
}

/**
 * Определяет цель из ответа формы: либо разбирает X/Y/Z, либо берёт точку
 * выбранного источника. Возвращает { ok, point } или { ok: false, error }.
 */
function resolveTarget(player, sources, r, dimId, base) {
  const src = sources[r.source] ?? sources[0];
  if (src.kind === "manual") return parseTargetFields(r.x, r.y, r.z, base, dimId);
  return validateTarget(blockCenter(src.point), base, dimId);
}

function flyingDrones() {
  return [...DRONES.values()].filter((st) => st.launched && !st.dead && isValid(st.entity));
}

function canControl(player, st) {
  return !CONFIG.ONLY_OWNER_CAN_CONTROL || !st.owner || st.owner === player.name;
}

// ---------------------------------------------------------------------------
// Главное меню
// ---------------------------------------------------------------------------
async function showMainMenu(player) {
  if (!isValid(player)) return;
  const dimId = player.dimension.id;
  const flying = flyingDrones();
  const own = flying.filter((st) => st.owner === player.name).length;
  const cap = Captures.get(player);
  const wps = Routes.waypointsFor(player);
  const lines = [
    `§7Измерение: §f${dimName(dimId)}§7, позиция: §f${fmtPos(player.location)}`,
    cap
      ? `§7Отмеченная точка: §e${fmtPos(cap)}§7 (${dimName(cap.dim)})`
      : "§7Отмеченная точка: §8нет (ПКМ планшетом по блоку)",
    wps.length ? `§7Точек пульта маршрута: §e${wps.length}` : null,
    `§7В воздухе: §f${flying.length}§7 (ваших: §f${own}§7)`,
    `§7Зоны тиков дронов: §f${TickingAreas.count()}/${CONFIG.MAX_DRONE_AREAS}`,
  ].filter(Boolean);

  await new MenuBuilder("§lПланшет БПЛА", lines.join("\n"))
    .button("§lПуск дронов§r\n§8Одиночный пуск или залп", "textures/items/rocket_icon", () => showLaunchForm(player))
    .button(
      `§lАктивные дроны (${flying.length})§r\n§8Коррекция цели в полёте`,
      "textures/items/remote_icon_target",
      () => showActiveDrones(player),
    )
    .button(
      `§lШаблоны целей (${Presets.all().length})§r\n§8Сохранить, выбрать, удалить`,
      "textures/items/remote_icon_waypoint",
      () => showPresets(player),
    )
    .button(
      `§lАрхив маршрутов (${Routes.history(player).length})§r\n§8Повторить удар`,
      "textures/items/remote_icon_orange",
      () => showArchive(player),
    )
    .button("§lСлужебное§r\n§8Зоны тиков", "textures/items/launcher_icon", () => showService(player))
    .show(player);
}

// ---------------------------------------------------------------------------
// Пуск дронов (одиночный и залп)
// ---------------------------------------------------------------------------
/**
 * prefill: {
 *   drone?: Entity                 — пуск конкретного дрона с ПУ (без полей залпа),
 *   presetId?: string              — заранее выбранный шаблон,
 *   target?: Vector3               — подсказка для X/Y/Z,
 *   fields?: {x,y,z}               — введённые ранее значения (повтор после ошибки),
 *   waypoints?: Vector3[], useRoute?: boolean
 * }
 */
async function showLaunchForm(player, prefill = {}) {
  if (!isValid(player)) return;
  const dimId = player.dimension.id;
  const drone = prefill.drone && isValid(prefill.drone) ? prefill.drone : null;
  const prefs = LaunchPrefs.get(player);
  const sources = targetSources(player, dimId);
  let srcIdx = 0;
  if (prefill.presetId) {
    const i = sources.findIndex((s) => s.preset && s.preset.id === prefill.presetId);
    if (i >= 0) srcIdx = i;
  }
  const def = prefill.fields ?? defaultTargetFields(player, prefill.target);
  const wps = prefill.waypoints ?? Routes.waypointsFor(player);

  const m = new ModalBuilder(drone ? `Пуск: ${DRONE_TYPES[drone.typeId].name}` : "Пуск дронов");
  if (!drone) {
    m.dropdown(
      "type",
      "Тип дрона",
      DRONE_TYPE_IDS.map((id) => DRONE_TYPES[id].name),
      prefs.type,
    );
  }
  m.dropdown(
    "source",
    "Цель (если выбрана точка или шаблон, поля X/Y/Z не используются)",
    sources.map((s) => s.label),
    srcIdx,
  )
    .text("x", "X", "например 120 или ~10", def.x)
    .text("y", "Y", "например 64 или ~", def.y)
    .text("z", "Z", "например -340 или ~-5", def.z);
  if (!drone) {
    m.slider("count", "Количество дронов", 1, CONFIG.MAX_SWARM, 1, prefs.count)
      .dropdown(
        "formation",
        "Строй залпа",
        FORMATIONS.map((f) => f.name),
        prefs.formation,
      )
      .slider("interval", "Интервал между пусками, сек", 0, 5, 1, prefs.interval)
      .slider("spread", "Разброс точек удара, блоков", 0, 10, 1, prefs.spread);
  }
  m.slider("cruise", "Высота марша над целью, блоков", 10, 80, 5, prefs.cruise);
  if (!drone)
    m.toggle("useLaunchers", `Сначала дроны на ПУ рядом (до ${CONFIG.LAUNCHER_SEARCH_RADIUS} бл.)`, prefs.useLaunchers);
  if (wps.length) m.toggle("useRoute", `Лететь через точки пульта маршрута (${wps.length})`, prefill.useRoute ?? true);
  m.submit(drone ? "Запуск" : "Пуск!");

  const r = await m.show(player);
  if (!r || !isValid(player)) return;

  // Запоминаем настройки для следующего открытия формы.
  const nextPrefs = { ...prefs, cruise: r.cruise };
  if (!drone) {
    Object.assign(nextPrefs, {
      type: r.type,
      count: r.count,
      formation: r.formation,
      interval: r.interval,
      spread: r.spread,
      useLaunchers: r.useLaunchers,
    });
  }
  LaunchPrefs.set(player, nextPrefs);

  const res = resolveTarget(player, sources, r, dimId, player.location);
  if (!res.ok) {
    msg(player, `§c[БПЛА] ${res.error}`);
    return showLaunchForm(player, { ...prefill, fields: { x: r.x, y: r.y, z: r.z } });
  }
  const waypoints = r.useRoute ? wps : null;

  if (drone) {
    launchSpecificDrone(player, drone, res.point, r.cruise, waypoints);
  } else {
    executeLaunch(player, {
      typeId: DRONE_TYPE_IDS[r.type] ?? DRONE_TYPE_IDS[0],
      count: r.count,
      target: res.point,
      formation: (FORMATIONS[r.formation] ?? FORMATIONS[0]).id,
      intervalTicks: r.interval * 20,
      spread: r.spread,
      cruise: r.cruise,
      useLaunchers: r.useLaunchers,
      waypoints,
    });
  }
  if (waypoints) {
    // Маршрут израсходован (как в оригинале после старта с ПУ).
    Routes.setLast(player, undefined);
    PENDING_WAYPOINTS.delete(player.id);
  }
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
  const shown = all.slice(0, 40);
  const body = all.length
    ? `§7В воздухе: §f${all.length}§7. Выберите дрон, чтобы изменить цель или подорвать его.`
    : "§7Сейчас в воздухе нет дронов.";
  const menu = new MenuBuilder("Активные дроны", body);
  for (const st of shown) {
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
    `§7Цель: §f${t ? fmtPos(t) : "не назначена"}`,
    `§7Точек маршрута осталось: §f${st.route.length}`,
    t ? `§7До цели по маршруту: §f${Math.round(rem)} м§7, около §f${Math.ceil(rem / spd)} с` : null,
    `§7Скорость: §f${spd.toFixed(1)} бл/с§7, высота марша: §f${st.cruise}`,
    `§7Зона тиков: ${area ? `§a${area.name}§7 @ ${area.x} ${area.y} ${area.z}` : "§cнет (лимит или ожидание)"}`,
  ].filter(Boolean);

  const menu = new MenuBuilder(`Дрон ${st.callsign}`, lines.join("\n"));
  const allowed = canControl(player, st);
  if (allowed && !st.hit) {
    menu.button("§lИзменить цель§r\n§8Коррекция в полёте", "textures/items/remote_icon_target", () =>
      showRetargetForm(player, droneId),
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

async function showRetargetForm(player, droneId, fields) {
  if (!isValid(player)) return;
  const st = DRONES.get(droneId);
  if (!st || st.dead || st.hit || !st.launched || !isValid(st.entity)) {
    msg(player, "§e[БПЛА] Дрон недоступен для коррекции.");
    return showActiveDrones(player);
  }
  const sources = targetSources(player, st.dimId);
  const t = finalTarget(st);
  // По умолчанию подставляется «номинальная» цель, то есть без смещения дрона в залпе.
  const def =
    fields ??
    (t
      ? { x: String(Math.floor(t.x - st.toff.x)), y: String(Math.floor(t.y)), z: String(Math.floor(t.z - st.toff.z)) }
      : defaultTargetFields(player));
  const group = st.group ? flyingDrones().filter((o) => o.group === st.group && !o.hit && canControl(player, o)) : [st];

  const m = new ModalBuilder(`Коррекция цели: ${st.callsign}`)
    .dropdown(
      "source",
      "Новая цель (если выбрана точка или шаблон, поля X/Y/Z не используются)",
      sources.map((s) => s.label),
      0,
    )
    .text("x", "X", "например 120", def.x)
    .text("y", "Y", "например 64", def.y)
    .text("z", "Z", "например -340", def.z)
    .slider("cruise", "Высота марша над целью, блоков", 10, 80, 5, clamp(Math.round(st.cruise / 5) * 5, 10, 80));
  if (group.length > 1) m.toggle("wholeGroup", `Применить ко всему залпу ${st.group} (${group.length} дронов)`, true);
  m.submit("Перенацелить");

  const r = await m.show(player);
  if (!r) return showDroneDetails(player, droneId);
  const base = player.dimension.id === st.dimId ? player.location : st.pos;
  const res = resolveTarget(player, sources, r, st.dimId, base);
  if (!res.ok) {
    msg(player, `§c[БПЛА] ${res.error}`);
    return showRetargetForm(player, droneId, { x: r.x, y: r.y, z: r.z });
  }
  const list = r.wholeGroup ? group : [DRONES.get(droneId)];
  let n = 0;
  for (const d of list) if (retargetDrone(d, res.point, r.cruise)) n++;
  msg(
    player,
    n
      ? `§a[БПЛА] Цель изменена (${n} дрон.): » ${fmtPos(res.point)}`
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
  const cap = Captures.get(player);
  const pdim = player.dimension.id;
  const menu = new MenuBuilder(
    "Шаблоны целей",
    `§7Сохранено: §f${list.length}/${CONFIG.MAX_PRESETS}§7. Шаблоны общие для всех игроков и сохраняются вместе с миром.`,
  );
  menu.button("§2+ Сохранить мою позицию", "textures/items/remote_icon_waypoint", () =>
    showSavePreset(player, "position"),
  );
  if (cap) {
    menu.button(`§2+ Сохранить отмеченную точку§r\n§8${fmtPos(cap)}`, "textures/items/remote_icon_target", () =>
      showSavePreset(player, "capture"),
    );
  }
  menu.button("§2+ Добавить по координатам", undefined, () => showSavePreset(player, "manual"));
  for (const p of list) {
    const dist = p.dim === pdim ? ` · ${Math.round(hdist(p, player.location))} м` : "";
    menu.button(`§l${p.name}§r\n§8${fmtPos(p)} · ${dimName(p.dim)}${dist}`, undefined, () =>
      showPresetDetails(player, p.id),
    );
  }
  menu.button("« Назад", undefined, () => showMainMenu(player));
  await menu.show(player);
}

/** kind: "position" (позиция игрока) | "capture" (отмеченная точка) | "manual" (ввод X/Y/Z). */
async function showSavePreset(player, kind, fields) {
  if (!isValid(player)) return;
  const dimId = player.dimension.id;
  let point = null,
    pointDim = dimId;
  if (kind === "position") point = floorPoint(player.location);
  else if (kind === "capture") {
    const cap = Captures.get(player);
    if (!cap) return showPresets(player);
    point = cap;
    pointDim = cap.dim;
  }
  const fallbackName = `Точка ${Presets.all().length + 1}`;
  const where = point ? ` (${fmtPos(point)}, ${dimName(pointDim)})` : "";
  const m = new ModalBuilder("Новый шаблон").text(
    "name",
    `Название точки${where}`,
    "например: База противника",
    fields?.name ?? fallbackName,
  );
  if (kind === "manual") {
    const d = fields ?? defaultTargetFields(player);
    m.text("x", "X", "например 120 или ~10", d.x)
      .text("y", "Y", "например 64", d.y)
      .text("z", "Z", "например -340", d.z);
  }
  m.submit("Сохранить");

  const r = await m.show(player);
  if (!r) return showPresets(player);
  const name = cleanName(r.name, fallbackName);
  if (kind === "manual") {
    const res = parseTargetFields(r.x, r.y, r.z, player.location, dimId);
    if (!res.ok) {
      msg(player, `§c[БПЛА] ${res.error}`);
      return showSavePreset(player, kind, { name: r.name, x: r.x, y: r.y, z: r.z });
    }
    point = floorPoint(res.point);
  }
  const res = Presets.add({ name, x: point.x, y: point.y, z: point.z, dim: pointDim, author: player.name });
  msg(
    player,
    res.ok
      ? `§a[БПЛА] Шаблон «${name}» ${res.replaced ? "обновлён" : "сохранён"}: ${fmtPos(point)} (${dimName(pointDim)})`
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
    menu.button("§lПуск по шаблону", "textures/items/rocket_icon", () => showLaunchForm(player, { presetId: p.id }));
    menu.button("Отметить как точку цели", "textures/items/remote_icon_target", () => {
      Captures.set(player, p, p.dim);
      msg(player, `§e[БПЛА] Отмеченная точка: ${fmtPos(p)} («${p.name}»).`);
      return showPresetDetails(player, id);
    });
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
// Архив маршрутов (поведение «Пульта архива маршрутов» из оригинала)
// ---------------------------------------------------------------------------
async function showArchive(player) {
  if (!isValid(player)) return;
  const list = Routes.history(player).slice().reverse();
  const menu = new MenuBuilder(
    "Архив маршрутов",
    list.length
      ? `§7Выберите маршрут для повторного удара. Удар неточный: разброс около ${CONFIG.ROUTE_SCATTER} блоков.`
      : "§7Архив маршрутов пуст. Маршрут попадает в архив, когда вы отмечаете цель планшетом.",
  );
  for (const it of list) {
    const last = it.route[it.route.length - 1];
    menu.button(`${it.route.length} точ. | ${fmtTime(it.time || 0)}\n§8цель ${fmtPos(last)}`, undefined, () =>
      loadArchivedRoute(player, it),
    );
  }
  menu.button("« Назад", undefined, () => showMainMenu(player));
  await menu.show(player);
}

function loadArchivedRoute(player, item) {
  const route = item.route.filter(isPoint).map(vcopy);
  if (!route.length) return showArchive(player);
  const last = route[route.length - 1];
  last.x += (Math.random() * 2 - 1) * CONFIG.ROUTE_SCATTER;
  last.z += (Math.random() * 2 - 1) * CONFIG.ROUTE_SCATTER;
  Routes.setLast(player, route);
  msg(
    player,
    `§6[БПЛА] Маршрут из архива загружен! Удар неточный (разброс ~${CONFIG.ROUTE_SCATTER} м). ` +
      "Нажмите на БПЛА на ПУ или запустите из формы.",
  );
  return showLaunchForm(player, { target: last, waypoints: route.slice(0, -1), useRoute: true });
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
// §10 ВВОД ИГРОКА: ПУЛЬТЫ, КЛИК ПО ДРОНУ, УСТАНОВКА НА ПУ
// ============================================================================

/** «Пульт маршрута»: промежуточная точка на CONFIG.WAYPOINT_ALT блоков выше блока. */
function addWaypoint(player, loc) {
  const list = PENDING_WAYPOINTS.get(player.id) ?? [];
  if (list.length >= CONFIG.MAX_WAYPOINTS) {
    msg(player, `§c[БПЛА] Уже ${CONFIG.MAX_WAYPOINTS} точек! Отметь цель планшетом.`);
    return;
  }
  const [, maxY] = dimLimits(player.dimension.id);
  list.push({ x: loc.x + 0.5, y: Math.min(loc.y + CONFIG.WAYPOINT_ALT, maxY - 3), z: loc.z + 0.5 });
  PENDING_WAYPOINTS.set(player.id, list);
  msg(player, `§a[БПЛА] Точка ${list.length}/${CONFIG.MAX_WAYPOINTS} записана!`);
}

/**
 * Планшет, ПКМ по блоку: блок становится отмеченной точкой (целью).
 * Маршрут с пульта маршрута завершается и сохраняется в архив, как в
 * оригинале. Затем открывается форма пуска; с Shift точка только отмечается.
 */
function onTabletBlock(player, loc, sneaking) {
  if (!isValid(player)) return;
  LAST_BLOCK_CAPTURE.set(player.id, system.currentTick);
  const dimId = player.dimension.id;
  Captures.set(player, loc, dimId);
  const target = blockCenter(loc);
  const pending = Routes.pending(player);
  const route = [...pending, target];
  Routes.setLast(player, route);
  Routes.pushHistory(player, route);
  PENDING_WAYPOINTS.delete(player.id);
  if (pending.length) {
    msg(
      player,
      `§e[БПЛА] Маршрут готов: ${pending.length} точ. + цель ${fmtPos(loc)}. Нажми на БПЛА на ПУ или запусти с планшета.`,
    );
  } else {
    msg(player, `§e[БПЛА] Цель отмечена: ${fmtPos(loc)}.`);
  }
  if (!sneaking)
    openTablet(player, (p) => showLaunchForm(p, { target, waypoints: pending, useRoute: pending.length > 0 }));
}

/** Клик по дрону (data-driven запуск rocket:start_flight отменён, пуском управляет скрипт). */
function onDroneClicked(player, target, holdingTablet) {
  if (!isValid(player) || !isValid(target)) return;
  if (isDroneLaunched(target)) {
    msg(player, "§c[БПЛА] Ракета уже в полёте!");
    return;
  }
  if (RESERVED.has(target.id)) {
    msg(player, "§e[БПЛА] Этот дрон уже назначен в залп и ждёт своей очереди.");
    return;
  }
  if (holdingTablet) {
    openTablet(player, (p) => showLaunchForm(p, { drone: target }));
    return;
  }
  const route = Routes.last(player);
  if (!route) {
    msg(player, "§c[БПЛА] Маршрут не задан пультом! Отметь цель планшетом (ПКМ по блоку) или открой планшет.");
    return;
  }
  const st = startFlight(target, { route, owner: player.name, cruise: CONFIG.WAYPOINT_ALT, fromLauncher: true });
  Routes.setLast(player, undefined);
  if (st) msg(player, `§a[БПЛА] Старт произведён! Позывной: ${st.callsign}.`);
}

/**
 * Установка нового дрона на ближайшую ПУ (до 6 блоков). Если ПУ рядом нет,
 * дрон снимается, как в оригинале. Исключение — дроны с freePlacement.
 */
function tryMountOnLauncher(entity, tries) {
  try {
    if (!isValid(entity) || getDP(entity, DP.LAUNCHED) === true) return;
    const cfg = DRONE_TYPES[entity.typeId];
    if (!cfg) return;
    if (cfg.freePlacement) {
      registerDrone(entity);
      return;
    }
    const dim = entity.dimension;
    const near = dim.getEntities({ location: entity.location, maxDistance: 6, type: LAUNCHER_TYPE });
    if (!near.length) {
      if (tries < 10) {
        system.runTimeout(() => tryMountOnLauncher(entity, tries + 1), 4);
        return;
      }
      for (const pl of dim.getPlayers({ location: entity.location, maxDistance: 10 })) {
        msg(pl, "§c[БПЛА] Этот дрон можно ставить только на ПУ!");
      }
      entity.remove();
      return;
    }
    const launcher = near[0],
      lr = launcher.getRotation(),
      ll = launcher.location,
      rad = lr.y * RAD,
      m = cfg.mount;
    const pos = { x: ll.x - Math.sin(rad) * m.z, y: ll.y + m.y, z: ll.z + Math.cos(rad) * m.z };
    entity.teleport(pos, { rotation: { x: m.p, y: lr.y } });
    setDP(entity, DP.MOUNT_YAW, lr.y);
    setDP(entity, DP.MOUNT_PITCH, m.p);
    writeJSON(entity, DP.MOUNT_POS, pos);
    safe(() => entity.triggerEvent("rocket:mount"));
    const st = registerDrone(entity);
    if (st) st.mount = { yaw: lr.y, pitch: m.p, pos };
  } catch (err) {
    logError("tryMountOnLauncher", err);
  }
}

// Пульты: ПКМ по блоку. В before-событии нельзя менять мир, поэтому работа
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

// Планшет: ПКМ в воздух открывает главное меню.
world.afterEvents.itemUse.subscribe((ev) => {
  const player = ev.source,
    item = ev.itemStack;
  if (!item || !TABLET_ITEMS.has(item.typeId) || !isValid(player)) return;
  // Если в этом же клике только что отмечен блок, второй раз планшет не открываем.
  const t = LAST_BLOCK_CAPTURE.get(player.id);
  if (t !== undefined && system.currentTick - t < 10) return;
  openTablet(player, showMainMenu);
});

// Клик по дрону: запуском управляет скрипт, поэтому ванильное взаимодействие отменяется.
world.beforeEvents.playerInteractWithEntity.subscribe((ev) => {
  const target = ev.target;
  if (!target || !DRONE_TYPES[target.typeId]) return;
  ev.cancel = true;
  const player = ev.player;
  const holdingTablet = !!ev.itemStack && TABLET_ITEMS.has(ev.itemStack.typeId);
  system.run(() => onDroneClicked(player, target, holdingTablet));
});

// Новые дроны: установка на ПУ. Загруженные из сохранения попадают прямо в реестр.
world.afterEvents.entitySpawn.subscribe((ev) => {
  const e = ev.entity;
  const typeId = safe(() => e.typeId, "");
  if (!DRONE_TYPES[typeId]) return;
  if (ev.cause === "Loaded") {
    registerDrone(e);
    return;
  }
  system.runTimeout(() => tryMountOnLauncher(e, 1), 2);
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
  PENDING_WAYPOINTS.delete(ev.playerId);
  UI_BUSY.delete(ev.playerId);
  LAST_BLOCK_CAPTURE.delete(ev.playerId);
  ENG_NEAR.delete(ev.playerId);
});

/** Строка состояния (action bar) у игрока с планшетом в руке: свои дроны и ближайший к цели. */
function hudTick() {
  for (const pl of world.getAllPlayers()) {
    if (!isValid(pl) || !TABLET_ITEMS.has(heldItemId(pl))) continue;
    const own = flyingDrones().filter((st) => st.owner === pl.name);
    let text = `§6БПЛА§r в воздухе: §e${own.length}`;
    if (own.length) {
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
    }
    const cap = Captures.get(pl);
    if (cap) text += ` §7| метка: §f${fmtPos(cap)}`;
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
    if (src && src.typeId === "minecraft:player") msg(src, text);
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

/* =========================================================================
   问道 · 斗法
   单页 Canvas 即时斗法
   -------------------------------------------------------------------------
   代码结构：
   01. 常量与工具
   02. 状态、存档与场景维度
   03. 战斗单位、攻击与伤害
   04. 移动、掩体碰撞与路径搜索
   05. 玩家输入
   06. 敌方 AI
   07. 固定步长战斗循环
   08. 渲染与美术
   09. HUD、设置、界面与初始化
   ========================================================================= */
(() => {
  'use strict';

  /* =======================================================================
     01. 常量与工具
     ======================================================================= */

  const TAU = Math.PI * 2;
  const STEP = 1 / 60;
  const CONFIG = Object.freeze({
    maxHp: 200,
    maxMana: 100,
    // 基础伤害（不含嗜血等增伤）：近战 10，灵子 5。
    meleeDamage: 10,
    orbDamage: 5,
    // 灵力规则：灵子 5 点，近战不耗灵力（只在命中时回灵）。
    orbCost: 5,
    meleeCost: 0,
    // 自然回灵固定 10/秒；仅发射灵子后的 0.5 秒内暂停。
    manaRegenPerSecond: 10,
    regenPauseAfterAttack: 0.5,
    // 回灵：灵子命中 +25，近战命中 +35，拼刀 +50（优先于近战命中），对波后发者 +20。
    manaOnOrbHit: 25,
    manaOnMeleeHit: 35,
    manaOnMeleeClash: 50,
    manaOnClash: 20,
    counterManaCost: 50,
    // 精魄（“费”）：灵力满 100 自动凝成 1 点；敌我每 5 秒自然 +1，上限 10。
    essenceMax: 10,
    essenceInterval: 5,
    // 桃一局最多使用 3 次。
    healUsesPerMatch: 3,
    // 闪避：1 次，2 秒冷却；冲刺距离翻倍。
    dodgeCooldown: 2,
    dodgeDuration: 0.2,
    dodgeInvuln: 0.3,
    // 近战恢复上一版的 0.38 秒出手间隔（不再有额外 1 秒冷却）。
    meleeCooldown: 0.38,
    // AI 只能 1 秒挥一剑；满足冷却前若决定近战则原地等待，不发射灵子。
    aiMeleeAttackInterval: 1,
    orbCooldown: 0.3,
    meleeArc: Math.PI * 0.74,
    meleeDuration: 0.32,
    meleeHitAt: 0.075,
    // 反制：对方近战刀光期间按右键，把对方扔出去并眩晕 2 秒。
    counterRangeScale: 1.5,
    counterCooldown: 6,
    counterStunDuration: 2,
    // 反制成功后 0.5 秒内禁止御灵，避免连点灵子打破自己造成的眩晕。
    counterOrbLock: 0.5,
    throwDuration: 0.28,
    throwSpeed: 950,
    // 灵子射程延长 50%（寿命 3.2 → 4.8 秒）。
    orbMaxLife: 4.8,
    // AI 灵子连击：前 2 发算免灵连发，连射到 4 发后需要近战/换招重置。
    orbFreeShots: 2,
    orbRefreshCombo: 4,
    // 对波吸附：同一直线上的敌方灵子会轻微互相牵引。
    orbMagnetRadius: 240,
    orbMagnetTurnRate: 2.6,
    // 卡牌附加机制
    swordRadius: 192,
    stunDuration: 3,
    rootDuration: 2,
    rootReward: 2,
    bloodDuration: 5,
    // 顺手牵羊+ 的存活时间。
    stealPlusDuration: 5,
  });

  // 卡组：20 张牌，9 种效果。
  const CARD_LIBRARY = Object.freeze({
    greatsword: Object.freeze({
      id: 'greatsword',
      name: '巨剑术',
      cost: 3,
      tone: '#c8ae74',
      art: '⚔',
      text: '拖动到场中，在圆形区域降下巨剑，造成 100 点伤害。',
      targeting: 'ground',
      radius: CONFIG.swordRadius,
      delay: 0.7,
      damage: 100,
    }),
    wind: Object.freeze({
      id: 'wind',
      name: '轻身术',
      cost: 1,
      tone: '#7fd8c4',
      art: '🌀',
      text: '自身移动速度提高 50%，持续 10 秒；可解除自身眩晕，并抵挡一次反制。',
      targeting: 'self',
      duration: 10,
      speedBonus: 0.5,
    }),
    heal: Object.freeze({
      id: 'heal',
      name: '桃',
      cost: 3,
      tone: '#e8a0a0',
      art: '🍑',
      text: '5 秒内缓慢回复 100 点气血；一局最多使用 3 次。',
      targeting: 'self',
      duration: 5,
      healPerSecond: 20,
    }),
    goldfinger: Object.freeze({
      id: 'goldfinger',
      name: '金手指',
      cost: 0,
      tone: '#e6c86a',
      art: '☝',
      text: '替换所有手牌。',
      targeting: 'self',
    }),
    stillness: Object.freeze({
      id: 'stillness',
      name: '打坐',
      cost: 0,
      tone: '#9fb6d8',
      art: '☯',
      text: '入定 2 秒，期间无法移动，结束后获得 2 费。',
      targeting: 'self',
      duration: CONFIG.rootDuration,
    }),
    blink: Object.freeze({
      id: 'blink',
      name: '缩地',
      cost: 1,
      tone: '#b7a4e8',
      art: '⇢',
      text: '将自身传送到指定位置，并解除自身眩晕。',
      targeting: 'ground',
    }),
    blood: Object.freeze({
      id: 'blood',
      name: '嗜血奇术',
      cost: 2,
      tone: '#d96a6a',
      art: '血',
      text: '5 秒内近战与灵子伤害翻倍。',
      targeting: 'self',
      duration: CONFIG.bloodDuration,
    }),
    hammer: Object.freeze({
      id: 'hammer',
      name: '玄武锤',
      cost: 2,
      tone: '#8fa3b8',
      art: '🔨',
      text: '释放后使对手眩晕 3 秒，并清除其轻身术；眩晕受到首次攻击后解除。',
      targeting: 'self',
      duration: CONFIG.stunDuration,
    }),
    steal: Object.freeze({
      id: 'steal',
      name: '顺手牵羊',
      cost: 1,
      tone: '#c9a7e8',
      art: '牵',
      text: '偷取对手最新获得的一个增益。',
      targeting: 'self',
    }),
    stealPlus: Object.freeze({
      id: 'stealPlus',
      name: '顺手牵羊+',
      cost: 2,
      tone: '#c9a7e8',
      art: '牵',
      text: '偷取对手最新获得的增益。5 秒后销毁并刷新一张牌。',
      targeting: 'self',
      temporary: true,
    }),
  });

  const CARD_DECK = Object.freeze([
    'greatsword',
    'wind',
    'heal',
    'goldfinger',
    'stillness',
    'blink',
    'blood',
    'hammer',
    'greatsword',
    'wind',
    'heal',
    'goldfinger',
    'stillness',
    'blink',
    'blood',
    'hammer',
    'greatsword',
    'blood',
    'greatsword',
    'wind',
    'steal',
    'steal',
  ]);
  const CARD_HAND_SIZE = 5;

  // AI 与玩家使用同一套牌库（含玄武锤）。
  const CARD_DECK_AI = Object.freeze(CARD_DECK.slice());

  const DEFAULT_SETTINGS = Object.freeze({
    meleeRange: 118,
    orbSpeed: 420,
    moveSpeedPercent: 100,
  });

  const STORAGE_KEYS = Object.freeze({
    settings: 'wendao.doufa.settings.v1',
    history: 'wendao.doufa.history.v1',
    bindings: 'wendao.doufa.bindings.v1',
  });

  const DEFAULT_KEYBINDS = Object.freeze({
    card1: 'Digit1',
    card2: 'Digit2',
    card3: 'Digit3',
    card4: 'Digit4',
    card5: 'Digit5',
    up: 'KeyW',
    down: 'KeyS',
    left: 'KeyA',
    right: 'KeyD',
    dodge: 'Space',
    melee: 'Mouse0',
    orb: 'Mouse2',
    counter: 'Mouse2',
  });

  const KEYBIND_DEFS = Object.freeze([
    { id: 'card1', label: '手牌一', group: '五张手牌' },
    { id: 'card2', label: '手牌二', group: '五张手牌' },
    { id: 'card3', label: '手牌三', group: '五张手牌' },
    { id: 'card4', label: '手牌四', group: '五张手牌' },
    { id: 'card5', label: '手牌五', group: '五张手牌' },
    { id: 'up', label: '向上移动', group: '移动' },
    { id: 'down', label: '向下移动', group: '移动' },
    { id: 'left', label: '向左移动', group: '移动' },
    { id: 'right', label: '向右移动', group: '移动' },
    { id: 'dodge', label: '贴地闪避', group: '行动' },
    { id: 'melee', label: '近战挥剑', group: '行动' },
    { id: 'orb', label: '发射灵子', group: '行动' },
    { id: 'counter', label: '反制', group: '行动' },
  ]);

  const OBSTACLE_DEFS = [
    { kind: 'rock', nx: 0.5, ny: 0.39, nr: 0.099, seed: 173 },
    { kind: 'tree', nx: 0.215, ny: 0.665, nr: 0.086, seed: 281 },
    { kind: 'tree', nx: 0.785, ny: 0.67, nr: 0.09, seed: 397 },
    { kind: 'rock', nx: 0.775, ny: 0.285, nr: 0.073, seed: 509 },
  ];

  const PLAYER_PALETTE = Object.freeze({
    team: 'player',
    robeOuter: '#123d36',
    robeMid: '#1d6658',
    robeLight: '#2e8f7b',
    trim: '#a9e9d7',
    sash: '#c8ae74',
    hair: '#101b1a',
    skin: '#d8c8a8',
    blade: '#c8e8e9',
    bladeGlow: 'rgba(91, 205, 208, 0.8)',
    spirit: '#5caef3',
    spiritSoft: '#b3e0ff',
    arcDeep: '#12386f',
    arcSoft: '#4a8fd8',
    seal: '青',
  });

  const ENEMY_PALETTE = Object.freeze({
    team: 'enemy',
    robeOuter: '#401715',
    robeMid: '#742923',
    robeLight: '#9e4437',
    trim: '#f2ae93',
    sash: '#caa36f',
    hair: '#160f0e',
    skin: '#d7c1a3',
    blade: '#efd5c7',
    bladeGlow: 'rgba(225, 116, 91, 0.72)',
    spirit: '#ec5a4d',
    spiritSoft: '#ffb7a2',
    arcDeep: '#551a26',
    arcSoft: '#a9404f',
    seal: '朱',
  });

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const lerp = (a, b, t) => a + (b - a) * t;
  const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
  const norm = (x, y) => {
    const length = Math.hypot(x, y);
    return length > 0.00001 ? { x: x / length, y: y / length } : { x: 0, y: 0 };
  };
  const angleDiff = (a, b) => {
    let d = (a - b + Math.PI) % TAU;
    if (d < 0) d += TAU;
    return d - Math.PI;
  };
  const easeOutCubic = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
  const easeInOutSine = (t) => -(Math.cos(Math.PI * clamp(t, 0, 1)) - 1) / 2;

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function random() {
      a += 0x6d2b79f5;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function pointToSegmentDistance(px, py, ax, ay, bx, by) {
    const abx = bx - ax;
    const aby = by - ay;
    const lengthSq = abx * abx + aby * aby;
    if (lengthSq < 0.000001) return dist(px, py, ax, ay);
    const t = clamp(((px - ax) * abx + (py - ay) * aby) / lengthSq, 0, 1);
    return dist(px, py, ax + abx * t, ay + aby * t);
  }

  function formatTime(seconds) {
    const total = Math.max(0, Math.floor(seconds));
    const m = Math.floor(total / 60).toString().padStart(2, '0');
    const s = (total % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  function setText(el, text) {
    if (el && el.textContent !== text) el.textContent = text;
  }

  const $ = (id) => document.getElementById(id);

  const dom = {
    canvas: $('gameCanvas'),
    hud: $('hud'),
    cardbar: $('cardbar'),
    cardHand: $('cardHand'),
    handTip: $('handTip'),
    dodgeBtn: $('dodgeBtn'),
    dodgeCd: $('dodgeCd'),
    counterBtn: $('counterBtn'),
    counterCd: $('counterCd'),
    dodgeKeyHint: $('dodgeKeyHint'),
    counterKeyHint: $('counterKeyHint'),
    counterSub: $('counterSub'),
    fieldHint: $('fieldHint'),
    controlMoveKeys: $('controlMoveKeys'),
    controlMeleeKeys: $('controlMeleeKeys'),
    controlOrbKeys: $('controlOrbKeys'),
    controlDodgeKeys: $('controlDodgeKeys'),
    controlCardKeys: $('controlCardKeys'),
    keybindBtn: $('keybindBtn'),
    keybindScreen: $('keybindScreen'),
    keybindGroups: $('keybindGroups'),
    keybindStatus: $('keybindStatus'),
    keybindResetBtn: $('keybindResetBtn'),
    keybindDoneBtn: $('keybindDoneBtn'),
    essencePips: $('essencePips'),
    essenceValue: $('essenceValue'),
    playerEssenceChip: $('playerEssenceChip'),
    enemyEssenceChip: $('enemyEssenceChip'),
    playerPanel: $('playerPanel'),
    enemyPanel: $('enemyPanel'),
    playerName: $('playerName'),
    enemyName: $('enemyName'),
    playerHpFill: $('playerHpFill'),
    enemyHpFill: $('enemyHpFill'),
    playerManaFill: $('playerManaFill'),
    enemyManaFill: $('enemyManaFill'),
    playerHpText: $('playerHpText'),
    enemyHpText: $('enemyHpText'),
    playerManaText: $('playerManaText'),
    enemyManaText: $('enemyManaText'),
    playerBuffs: $('playerBuffs'),
    enemyBuffs: $('enemyBuffs'),
    playerState: $('playerState'),
    enemyState: $('enemyState'),
    memoryNote: $('memoryNote'),
    toast: $('toast'),
    startScreen: $('startScreen'),
    settingsScreen: $('settingsScreen'),
    resultScreen: $('resultScreen'),
    startBtn: $('startBtn'),
    cardCodexBtn: $('cardCodexBtn'),
    cardCodexScreen: $('cardCodexScreen'),
    cardCodexGrid: $('cardCodexGrid'),
    codexMeta: $('codexMeta'),
    closeCodexBtn: $('closeCodexBtn'),
    onlineBtn: $('onlineBtn'),
    onlineScreen: $('onlineScreen'),
    onlineSetup: $('onlineSetup'),
    onlineRoom: $('onlineRoom'),
    onlineCreateBtn: $('onlineCreateBtn'),
    onlineJoinBtn: $('onlineJoinBtn'),
    onlineCodeInput: $('onlineCodeInput'),
    onlineBackBtn: $('onlineBackBtn'),
    onlineLeaveBtn: $('onlineLeaveBtn'),
    onlineStartBtn: $('onlineStartBtn'),
    onlineCopyBtn: $('onlineCopyBtn'),
    onlineCopyHint: $('onlineCopyHint'),
    onlineCode: $('onlineCode'),
    onlineStatus: $('onlineStatus'),
    onlineRole: $('onlineRole'),
    onlinePeer: $('onlinePeer'),
    onlineError: $('onlineError'),
    settingsBtn: $('settingsBtn'),
    applySettingsBtn: $('applySettingsBtn'),
    cancelSettingsBtn: $('cancelSettingsBtn'),
    backToStartBtn: $('backToStartBtn'),
    restartBtn: $('restartBtn'),
    meleeRangeInput: $('meleeRangeInput'),
    orbSpeedInput: $('orbSpeedInput'),
    moveSpeedInput: $('moveSpeedInput'),
    meleeRangeOutput: $('meleeRangeOutput'),
    orbSpeedOutput: $('orbSpeedOutput'),
    moveSpeedOutput: $('moveSpeedOutput'),
    startMemory: $('startMemory'),
    resultSeal: $('resultSeal'),
    resultEyebrow: $('resultEyebrow'),
    resultTitle: $('resultTitle'),
    resultCopy: $('resultCopy'),
    resultHp: $('resultHp'),
    resultMelee: $('resultMelee'),
    resultRanged: $('resultRanged'),
    resultDamage: $('resultDamage'),
    resultTime: $('resultTime'),
    resultEmpowered: $('resultEmpowered'),
    resultMemory: $('resultMemory'),
  };

  /* =======================================================================
     02. 状态、存档与场景维度
     ======================================================================= */

  const ctx = dom.canvas.getContext('2d');

  let viewW = window.innerWidth;
  let viewH = window.innerHeight;
  let dpr = Math.min(window.devicePixelRatio || 1, 2);
  let paperPattern = null;
  let lastFrame = 0;
  let accumulator = 0;

  const world = {
    arena: { x: 0, y: 0, w: 1000, h: 600 },
    play: { x: 0, y: 0, w: 1000, h: 600 },
    scale: 1,
    obstacles: [],
    decorations: [],
    layoutReady: false,
  };

  const input = {
    keys: new Set(),
    // 记录移动键按下顺序：同时按住相反方向时，后按下的方向优先。
    keyTime: Object.create(null),
    keySerial: 0,
    mouseX: 0,
    mouseY: 0,
    hasMouse: false,
    pointerInside: false,
    orbHeld: false,
    orbSources: new Set(),
  };

  const game = {
    mode: 'start',
    paused: false,
    settingsOpen: false,
    battleTime: 0,
    ambientTime: 0,
    endPending: false,
    endTimer: 0,
    resultShown: false,
    winner: null,
    recorded: false,
    player: null,
    enemy: null,
    settings: loadSettings(),
    bindings: loadBindings(),
    history: loadHistory(),
    projectiles: [],
    effects: [],
    afterimages: [],
    floaters: [],
    shake: 0,
    playerHurtFlash: 0,
    enemyHurtFlash: 0,
    projectilesSerial: 0,
    buffSerial: 0,
    combatLog: [],
    clashCount: 0,
    lastPlayerAttackAt: -10,
    match: {
      playerMeleeAttacks: 0,
      playerRangedAttacks: 0,
      playerDamage: 0,
      cardsPlayed: 0,
      maxPlayerMeleeCombo: 0,
      maxPlayerRangedCombo: 0,
      maxEnemyMeleeCombo: 0,
      maxEnemyRangedCombo: 0,
    },
    ai: null,
    cards: null,
    enemyCards: null,
    cardDrag: null,
    giantSwords: [],
    toastTimer: 0,
    lastWarningAt: -10,
    idleStartPositions: null,
    online: {
      socket: null,
      connected: false,
      connecting: false,
      lobbyOpen: false,
      role: null,
      code: null,
      peerJoined: false,
      active: false,
      localTeam: 'player',
      resultSent: false,
      rematchRequested: false,
      lastInputSentAt: 0,
      lastSnapshotAt: 0,
      lastSnapshotReceivedAt: 0,
      inputSeq: 0,
      lastOrbActionAt: 0,
      cardSignature: '',
      hostMoveSpeedPercent: 100,
      rtt: 0,
      lastPingAt: 0,
      pingSeq: 0,
      bgWorker: null,
      bgWorkerUrl: null,
      bgAccumulator: 0,
      bgLastTick: 0,
      rtc: {
        pc: null,
        channel: null,
        ready: false,
        state: 'idle',
        remoteSet: false,
        pendingIce: [],
        chunks: new Map(),
        chunkSeq: 0,
        sent: 0,
        received: 0,
        fallbackNotified: false,
        fallbackTimer: 0,
      },
      connectPromise: null,
      remoteInput: {
        up: false,
        down: false,
        left: false,
        right: false,
        aimAngle: Math.PI,
        receivedAt: 0,
        seq: 0,
      },
      pendingActions: [],
      lastAppliedSnapshotAt: 0,
    },
  };

  function loadSettings() {
    const fallback = { ...DEFAULT_SETTINGS };
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.settings);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return {
        meleeRange: clamp(Math.round(Number(parsed.meleeRange) || DEFAULT_SETTINGS.meleeRange), 80, 170),
        orbSpeed: clamp(Math.round(Number(parsed.orbSpeed) || DEFAULT_SETTINGS.orbSpeed), 260, 560),
        moveSpeedPercent: clamp(
          Math.round(Number(parsed.moveSpeedPercent) || DEFAULT_SETTINGS.moveSpeedPercent),
          100,
          300
        ),
      };
    } catch (error) {
      return fallback;
    }
  }

  function saveSettings() {
    try {
      localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(game.settings));
    } catch (error) {
      /* localStorage may be unavailable under strict file policies. */
    }
  }

  function loadBindings() {
    const result = { ...DEFAULT_KEYBINDS };
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.bindings);
      if (!raw) return result;
      const parsed = JSON.parse(raw);
      for (const key of Object.keys(DEFAULT_KEYBINDS)) {
        if (typeof parsed[key] === 'string' && parsed[key].length > 0 && parsed[key].length <= 24) {
          result[key] = parsed[key];
        }
      }
    } catch (error) {
      return result;
    }
    return result;
  }

  function saveBindings() {
    try {
      localStorage.setItem(STORAGE_KEYS.bindings, JSON.stringify(game.bindings));
    } catch (error) {
      /* Ignore storage failures: rebinding still works for this session. */
    }
  }

  function bindingCode(action) {
    return (action && game.bindings[action]) || '';
  }

  function actionsForCode(code) {
    return Object.keys(game.bindings).filter((action) => game.bindings[action] === code);
  }

  function isBoundTo(code, action) {
    return Boolean(action && game.bindings[action] === code);
  }

  function isMovementCode(code) {
    return ['up', 'down', 'left', 'right'].some((action) => isBoundTo(code, action));
  }

  function bindingLabel(code) {
    if (!code) return '未绑定';
    if (code === 'Mouse0') return '左键';
    if (code === 'Mouse1') return '中键';
    if (code === 'Mouse2') return '右键';
    if (code.startsWith('Mouse')) return `鼠标${Number(code.slice(5)) + 1}`;
    const keyMap = {
      Space: '空格',
      ShiftLeft: '左Shift',
      ShiftRight: '右Shift',
      ControlLeft: '左Ctrl',
      ControlRight: '右Ctrl',
      AltLeft: '左Alt',
      AltRight: '右Alt',
      ArrowUp: '↑',
      ArrowDown: '↓',
      ArrowLeft: '←',
      ArrowRight: '→',
      Escape: 'Esc',
      Enter: 'Enter',
      Tab: 'Tab',
      Backspace: '退格',
      CapsLock: 'Caps',
      Minus: '-',
      Equal: '=',
      BracketLeft: '[',
      BracketRight: ']',
      Backslash: '\\',
      Semicolon: ';',
      Quote: "'",
      Comma: ',',
      Period: '.',
      Slash: '/',
      Backquote: '`',
    };
    if (keyMap[code]) return keyMap[code];
    if (code.startsWith('Key')) return code.slice(3);
    if (code.startsWith('Digit')) return code.slice(5);
    if (code.startsWith('Numpad')) return `Num${code.slice(6)}`;
    return code;
  }

  function bindingGlyph(code) {
    if (code === 'Space') return '空';
    if (code === 'Mouse0') return '左';
    if (code === 'Mouse1') return '中';
    if (code === 'Mouse2') return '右';
    if (code.startsWith('Mouse')) return 'M';
    if (code === 'ArrowUp') return '↑';
    if (code === 'ArrowDown') return '↓';
    if (code === 'ArrowLeft') return '←';
    if (code === 'ArrowRight') return '→';
    const label = bindingLabel(code);
    return label.length > 4 ? label.slice(0, 3) : label;
  }

  const keybindState = {
    listening: null,
    status: '',
  };

  function keybindDef(action) {
    return KEYBIND_DEFS.find((item) => item.id === action) || null;
  }

  function renderKeybindScreen() {
    if (!dom.keybindGroups) return;
    dom.keybindGroups.textContent = '';
    const groups = new Map();
    for (const def of KEYBIND_DEFS) {
      if (!groups.has(def.group)) groups.set(def.group, []);
      groups.get(def.group).push(def);
    }
    for (const [groupName, defs] of groups) {
      const group = document.createElement('div');
      group.className = 'keybind-group';
      const heading = document.createElement('h3');
      heading.textContent = groupName;
      const list = document.createElement('div');
      list.className = 'keybind-list';
      for (const def of defs) {
        const row = document.createElement('div');
        row.className = 'keybind-row';
        const label = document.createElement('span');
        label.className = 'keybind-label';
        label.textContent = def.label;
        const slot = document.createElement('button');
        slot.type = 'button';
        slot.className = 'keycap keybind-slot';
        slot.dataset.action = def.id;
        slot.setAttribute('aria-label', `${def.label}：${bindingLabel(game.bindings[def.id])}，点击改键`);
        if (keybindState.listening === def.id) {
          slot.classList.add('is-listening');
          slot.textContent = '按键…';
        } else {
          slot.textContent = bindingLabel(game.bindings[def.id]);
        }
        slot.addEventListener('pointerdown', (event) => {
          event.preventDefault();
          event.stopPropagation();
          startKeybindListen(def.id);
        });
        row.append(label, slot);
        list.appendChild(row);
      }
      group.append(heading, list);
      dom.keybindGroups.appendChild(group);
    }
    if (dom.keybindStatus) dom.keybindStatus.textContent = keybindState.status;
  }

  function refreshBindingHints() {
    const label = (action) => bindingLabel(game.bindings[action]);
    const cardKeys = [1, 2, 3, 4, 5].map((i) => label(`card${i}`)).join(' ');
    if (dom.controlMoveKeys) {
      dom.controlMoveKeys.textContent = `${label('up')} ${label('left')} ${label('down')} ${label('right')}`;
    }
    if (dom.controlMeleeKeys) dom.controlMeleeKeys.textContent = label('melee');
    if (dom.controlOrbKeys) {
      dom.controlOrbKeys.textContent =
        game.bindings.orb === game.bindings.counter
          ? label('orb')
          : `${label('orb')} / ${label('counter')}`;
    }
    if (dom.controlDodgeKeys) dom.controlDodgeKeys.textContent = label('dodge');
    if (dom.controlCardKeys) dom.controlCardKeys.textContent = cardKeys.replace(/ /g, ' ');
    if (dom.dodgeKeyHint) dom.dodgeKeyHint.textContent = label('dodge');
    if (dom.counterKeyHint) dom.counterKeyHint.textContent = label('counter');
    if (dom.dodgeBtn) dom.dodgeBtn.setAttribute('aria-label', `闪避，${label('dodge')}`);
    if (dom.counterBtn) dom.counterBtn.setAttribute('aria-label', `反制，${label('counter')}`);
    if (dom.counterSub) dom.counterSub.textContent = `50 灵力 · 对方刀光时按${label('counter')}`;
    if (dom.handTip) {
      dom.handTip.textContent = `拖动卡牌到场中施放 · 精魄即费用 · ${cardKeys} 快捷施放`;
    }
    if (dom.fieldHint) {
      dom.fieldHint.textContent =
        `${label('up')}${label('left')}${label('down')}${label('right')} 移动 · ` +
        `${label('melee')} 挥剑 · ${label('orb')} 御灵（按住连发 / ${label('counter')} 反制） · ` +
        `${label('dodge')} 闪避 · 灵力满 100 自动凝魄 · 拖动卡牌施放`;
    }
    game.online.cardSignature = '';
  }

  function startKeybindListen(action) {
    const def = keybindDef(action);
    if (!def) return;
    keybindState.listening = action;
    keybindState.status = `正在录制「${def.label}」：按键盘按键或鼠标键，Esc 取消。`;
    renderKeybindScreen();
  }

  function captureKeybind(code) {
    const action = keybindState.listening;
    if (!action) return;
    game.bindings[action] = code;
    saveBindings();
    const def = keybindDef(action);
    keybindState.listening = null;
    keybindState.status = `「${def ? def.label : action}」已绑定为 ${bindingLabel(code)}。`;
    renderKeybindScreen();
    refreshBindingHints();
  }

  function cancelKeybindListen() {
    keybindState.listening = null;
    keybindState.status = '已取消录制。';
    renderKeybindScreen();
  }

  function openKeybindScreen() {
    if (!dom.keybindScreen || game.mode !== 'start') return;
    keybindState.listening = null;
    keybindState.status = '设置会自动保存，下次打开仍然生效。';
    renderKeybindScreen();
    dom.keybindScreen.hidden = false;
  }

  function closeKeybindScreen() {
    if (!dom.keybindScreen) return;
    keybindState.listening = null;
    keybindState.status = '';
    dom.keybindScreen.hidden = true;
  }

  function resetBindings() {
    game.bindings = { ...DEFAULT_KEYBINDS };
    saveBindings();
    keybindState.listening = null;
    keybindState.status = '已恢复默认按键。';
    renderKeybindScreen();
    refreshBindingHints();
  }

  function loadHistory() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.history);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((entry) => entry && Number.isFinite(Number(entry.melee)) && Number.isFinite(Number(entry.ranged)))
        .slice(-5)
        .map((entry) => ({
          melee: clamp(Math.round(Number(entry.melee)), 0, 999),
          ranged: clamp(Math.round(Number(entry.ranged)), 0, 999),
          at: typeof entry.at === 'number' ? entry.at : Date.now(),
        }));
    } catch (error) {
      return [];
    }
  }

  function saveHistory() {
    try {
      localStorage.setItem(STORAGE_KEYS.history, JSON.stringify(game.history.slice(-5)));
    } catch (error) {
      /* Ignore storage failures: the duel must remain playable. */
    }
  }

  function getPlayerProfile() {
    const history = game.history;
    const totalMelee = history.reduce((sum, entry) => sum + entry.melee, 0);
    const totalRanged = history.reduce((sum, entry) => sum + entry.ranged, 0);
    const total = totalMelee + totalRanged;
    return {
      matches: history.length,
      total,
      meleeRatio: total > 0 ? totalMelee / total : 0.5,
      rangedRatio: total > 0 ? totalRanged / total : 0.5,
      ready: history.length >= 3 && total >= 15,
    };
  }

  function getMemoryLine() {
    const profile = getPlayerProfile();
    if (profile.matches === 0) return '此局无旧忆，朱衣客尚不知你的招式。';
    if (!profile.ready) return `朱衣客已观你 ${profile.matches} 场斗法，正在揣摩你的出手。`;
    if (profile.meleeRatio > 0.58) return `朱衣客已观你 ${profile.matches} 场斗法，察觉你偏爱贴身挥剑。`;
    if (profile.rangedRatio > 0.58) return `朱衣客已观你 ${profile.matches} 场斗法，察觉你偏爱御灵远攻。`;
    return `朱衣客已观你 ${profile.matches} 场斗法，你的远近之势颇为均衡。`;
  }

  function showToast(message, variant = '', duration = 1600) {
    setText(dom.toast, message);
    dom.toast.classList.toggle('warn', variant === 'warn');
    dom.toast.classList.add('show');
    window.clearTimeout(game.toastTimer);
    game.toastTimer = window.setTimeout(() => {
      dom.toast.classList.remove('show');
    }, duration);
  }

  function warnPlayer(message, force = false) {
    if (!force && game.battleTime - game.lastWarningAt < 1.15) return;
    game.lastWarningAt = game.battleTime;
    showToast(message, 'warn', 1450);
  }

  function setBodyMode(mode) {
    document.body.classList.toggle('mode-start', mode === 'start');
    document.body.classList.toggle('mode-battle', mode === 'battle');
    document.body.classList.toggle('mode-over', mode === 'over');
  }

  /* ---------------------------------------------------------
     Synthesized combat audio. No external assets are used.
     --------------------------------------------------------- */
  let audioContext = null;

  function ensureAudio() {
    try {
      if (!audioContext) {
        const AudioCtor = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtor) return null;
        audioContext = new AudioCtor();
      }
      if (audioContext.state === 'suspended') {
        const resumed = audioContext.resume();
        if (resumed && typeof resumed.catch === 'function') resumed.catch(() => {});
      }
      return audioContext;
    } catch (error) {
      return null;
    }
  }

  function makeNoiseBuffer(ac, seconds) {
    const length = Math.max(1, Math.floor(ac.sampleRate * seconds));
    const buffer = ac.createBuffer(1, length, ac.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
      const decay = 1 - i / length;
      data[i] = (Math.random() * 2 - 1) * decay * decay;
    }
    return buffer;
  }

  function playMeleeImpact(empowered = false, fromNetwork = false) {
    if (!fromNetwork) sendOnlineSfx('melee', { empowered: Boolean(empowered) });
    const ac = ensureAudio();
    if (!ac) return;
    try {
      const now = ac.currentTime;
      const base = ac.createOscillator();
      const baseGain = ac.createGain();
      base.type = 'triangle';
      base.frequency.setValueAtTime(empowered ? 190 : 155, now);
      base.frequency.exponentialRampToValueAtTime(58, now + 0.14);
      baseGain.gain.setValueAtTime(empowered ? 0.16 : 0.11, now);
      baseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
      base.connect(baseGain).connect(ac.destination);
      base.start(now);
      base.stop(now + 0.18);

      const noise = ac.createBufferSource();
      noise.buffer = makeNoiseBuffer(ac, 0.09);
      const filter = ac.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(920, now);
      const noiseGain = ac.createGain();
      noiseGain.gain.setValueAtTime(empowered ? 0.14 : 0.09, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
      noise.connect(filter).connect(noiseGain).connect(ac.destination);
      noise.start(now);
    } catch (error) {
      /* Audio is optional; never let it interrupt combat. */
    }
  }

  function playClashSound(fromNetwork = false) {
    if (!fromNetwork) sendOnlineSfx('clash');
    const ac = ensureAudio();
    if (!ac) return;
    try {
      const now = ac.currentTime;
      const partials = [
        { freq: 1040, gain: 0.075, decay: 0.24, type: 'triangle' },
        { freq: 1540, gain: 0.06, decay: 0.2, type: 'sine' },
        { freq: 2210, gain: 0.045, decay: 0.17, type: 'triangle' },
        { freq: 3020, gain: 0.028, decay: 0.13, type: 'sine' },
      ];
      for (const partial of partials) {
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        osc.type = partial.type;
        osc.frequency.setValueAtTime(partial.freq, now);
        osc.frequency.exponentialRampToValueAtTime(partial.freq * 0.94, now + partial.decay);
        gain.gain.setValueAtTime(partial.gain, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + partial.decay);
        osc.connect(gain).connect(ac.destination);
        osc.start(now);
        osc.stop(now + partial.decay + 0.02);
      }

      const noise = ac.createBufferSource();
      noise.buffer = makeNoiseBuffer(ac, 0.16);
      const filter = ac.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.setValueAtTime(1600, now);
      const gain = ac.createGain();
      gain.gain.setValueAtTime(0.16, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      noise.connect(filter).connect(gain).connect(ac.destination);
      noise.start(now);
    } catch (error) {
      /* Audio is optional; never let it interrupt combat. */
    }
  }

  function buildSceneLayout() {
    const hudRect = dom.hud.getBoundingClientRect();
    const skillRect = dom.cardbar.getBoundingClientRect();

    const sidePad = clamp(viewW * 0.026, 9, 34);
    let top = Math.max(72, hudRect.bottom + 11);
    let bottom = Math.min(viewH - 10, skillRect.top - 11);

    if (bottom - top < 280) {
      top = Math.max(54, Math.min(top, hudRect.bottom - 20));
      bottom = Math.min(viewH - 8, Math.max(bottom, top + 230));
    }
    if (bottom - top < 190) {
      top = 48;
      bottom = Math.max(top + 190, viewH - 58);
    }

    const arenaWidth = Math.max(260, Math.min(viewW - sidePad * 2, 1480));
    const arena = {
      x: (viewW - arenaWidth) / 2,
      y: top,
      w: arenaWidth,
      h: Math.max(190, bottom - top),
    };

    const scale = clamp(Math.min(arena.w / 1060, arena.h / 565), 0.54, 1.3);
    const play = {
      x: arena.x + 11 * scale,
      y: arena.y + 12 * scale,
      w: arena.w - 22 * scale,
      h: arena.h - 24 * scale,
    };

    world.scale = scale;
    world.arena = arena;
    world.play = play;
    world.obstacles = OBSTACLE_DEFS.map((def) => makeObstacle(def));
    world.decorations = makeDecorations();
    world.layoutReady = true;
  }

  function makeObstacle(def) {
    const minDim = Math.min(world.arena.w, world.arena.h);
    const radius = clamp(minDim * def.nr, 26, 66);
    const x = world.play.x + world.play.w * def.nx;
    const y = world.play.y + world.play.h * def.ny;
    const random = mulberry32(def.seed + Math.floor(world.scale * 1000));
    const points = [];
    if (def.kind === 'rock') {
      const count = 11;
      for (let i = 0; i < count; i += 1) {
        const angle = (i / count) * TAU;
        const wobble = 0.82 + random() * 0.25;
        points.push({
          x: Math.cos(angle) * radius * wobble,
          y: Math.sin(angle) * radius * wobble * 0.7,
        });
      }
    }
    return {
      ...def,
      x,
      y,
      radius,
      visualRadius: radius,
      points,
      moss: Array.from({ length: def.kind === 'rock' ? 5 : 3 }, () => ({
        x: (random() - 0.5) * radius * 1.2,
        y: -radius * (0.25 + random() * 0.55),
        r: radius * (0.12 + random() * 0.17),
      })),
      randomSeed: def.seed,
    };
  }

  function makeDecorations() {
    const random = mulberry32(9281);
    const decorations = [];
    for (let i = 0; i < 26; i += 1) {
      const nx = 0.04 + random() * 0.92;
      const ny = 0.06 + random() * 0.9;
      decorations.push({
        x: world.play.x + world.play.w * nx,
        y: world.play.y + world.play.h * ny,
        size: (1.5 + random() * 4) * world.scale,
        angle: random() * TAU,
        tone: random(),
      });
    }
    return decorations;
  }

  function resizeCanvas(initial = false) {
    const oldPlay = { ...world.play };
    const previousScale = world.scale;

    viewW = Math.max(320, window.innerWidth);
    viewH = Math.max(360, window.innerHeight);
    dpr = Math.min(window.devicePixelRatio || 1, 2);

    dom.canvas.width = Math.round(viewW * dpr);
    dom.canvas.height = Math.round(viewH * dpr);
    dom.canvas.style.width = `${viewW}px`;
    dom.canvas.style.height = `${viewH}px`;

    buildSceneLayout();

    if (!initial && oldPlay.w > 1 && game.player) {
      const mapPoint = (entity) => {
        const nx = (entity.x - oldPlay.x) / oldPlay.w;
        const ny = (entity.y - oldPlay.y) / oldPlay.h;
        entity.x = world.play.x + world.play.w * clamp(nx, 0, 1);
        entity.y = world.play.y + world.play.h * clamp(ny, 0, 1);
        entity.radius = 23 * world.scale;
        entity.prevX = entity.x;
        entity.prevY = entity.y;
      };
      mapPoint(game.player);
      mapPoint(game.enemy);
      game.projectiles.forEach((projectile) => {
        const nx = (projectile.x - oldPlay.x) / oldPlay.w;
        const ny = (projectile.y - oldPlay.y) / oldPlay.h;
        projectile.x = world.play.x + world.play.w * clamp(nx, 0, 1);
        projectile.y = world.play.y + world.play.h * clamp(ny, 0, 1);
      });
      if (game.ai) game.ai.path = null;
      resolveObstaclePenetration(game.player);
      resolveObstaclePenetration(game.enemy);
    } else if (game.player) {
      game.player.radius = 23 * world.scale;
      game.enemy.radius = 23 * world.scale;
    }

    paperPattern = null;

    if (!initial && Math.abs(previousScale - world.scale) > 0.08) {
      game.effects.length = 0;
      game.floaters.length = 0;
      game.afterimages.length = 0;
    }
  }

  function getMeleeReach(fighter) {
    if (!fighter) return game.settings.meleeRange * world.scale;
    return game.settings.meleeRange * world.scale;
  }

  function getOrbInitialSpeed() {
    return game.settings.orbSpeed * world.scale;
  }

  function getMoveSpeed(fighter) {
    const boost = fighter && fighter.speedBoostTimer > 0 ? 1.5 : 1;
    return 252 * world.scale * (game.settings.moveSpeedPercent / 100) * boost;
  }

  function getDashSpeed() {
    // 闪避距离翻倍：0.2 秒冲刺覆盖原来两倍的距离。
    return 1580 * world.scale;
  }

  function getMeleeCost() {
    return CONFIG.meleeCost;
  }

  function getOrbCost() {
    return CONFIG.orbCost;
  }

  function getBaseMeleeCost() {
    return CONFIG.meleeCost;
  }

  function getBaseOrbCost() {
    return CONFIG.orbCost;
  }

  /* =======================================================================
     03. 战斗单位、攻击与伤害
     ======================================================================= */

  function makeFighter(options) {
    const palette = options.team === 'player' ? PLAYER_PALETTE : ENEMY_PALETTE;
    return {
      id: options.team,
      team: options.team,
      name: options.name,
      role: options.role,
      palette,
      x: 0,
      y: 0,
      prevX: 0,
      prevY: 0,
      radius: 23 * world.scale,
      facing: options.team === 'player' ? 0 : Math.PI,
      aimAngle: options.team === 'player' ? 0 : Math.PI,
      hp: CONFIG.maxHp,
      maxHp: CONFIG.maxHp,
      mana: CONFIG.maxMana,
      maxMana: CONFIG.maxMana,
      essence: 0,
      essenceTimer: 0,
      meleeCombo: 0,
      rangedCombo: 0,
      meleeCooldown: 0,
      orbCooldown: 0,
      dodgeCooldown: 0,
      dodgeRemaining: 0,
      dodgeDirX: 0,
      dodgeDirY: 0,
      bounceRemaining: 0,
      bounceDirX: 0,
      bounceDirY: 0,
      bounceSpeed: 0,
      throwRemaining: 0,
      throwDirX: 0,
      throwDirY: 0,
      throwSpeed: 0,
      counterCooldown: 0,
      counterOrbLock: 0,
      healUses: 0,
      invuln: 0,
      afterimageTimer: 0,
      regenBlocked: 0,
      speedBoostTimer: 0,
      healRemaining: 0,
      healRate: 0,
      // 记录每种增益最近一次获得的时间序号，供顺手牵羊固定偷「最新」的增益。
      buffAppliedAt: { speed: 0, heal: 0, blood: 0 },
      // 顺手牵羊+：手牌中临时牌的槽位与剩余时间。
      stealPlusTimers: [],
      stunRemaining: 0,
      rootTimer: 0,
      rootReward: false,
      meditationTimer: 0,
      castDuration: 0,
      damageBoostTimer: 0,
      swing: null,
      meleeAimAssist: false,
      walkPhase: Math.random() * TAU,
      moving: false,
      hitFlash: 0,
      deadTime: 0,
      aiStateLabel: options.team === 'enemy' ? '观势' : '',
      stats: {
        meleeSwings: 0,
        meleeHits: 0,
        orbHits: 0,
        damageDealt: 0,
        cardsPlayed: 0,
      },
    };
  }

  function getSpawnPoints() {
    return {
      player: {
        x: world.play.x + world.play.w * 0.135,
        y: world.play.y + world.play.h * 0.5,
      },
      enemy: {
        x: world.play.x + world.play.w * 0.865,
        y: world.play.y + world.play.h * 0.49,
      },
    };
  }

  function resetMatch() {
    const spawn = getSpawnPoints();
    game.player = makeFighter({
      team: 'player',
      name: '云归',
      role: '青衫客',
    });
    game.enemy = makeFighter({
      team: 'enemy',
      name: '烬无咎',
      role: '朱衣客',
    });

    game.player.x = spawn.player.x;
    game.player.y = spawn.player.y;
    game.player.prevX = game.player.x;
    game.player.prevY = game.player.y;
    game.enemy.x = spawn.enemy.x;
    game.enemy.y = spawn.enemy.y;
    game.enemy.prevX = game.enemy.x;
    game.enemy.prevY = game.enemy.y;

    const angleToEnemy = Math.atan2(game.enemy.y - game.player.y, game.enemy.x - game.player.x);
    game.player.facing = angleToEnemy;
    game.player.aimAngle = angleToEnemy;
    game.enemy.facing = angleToEnemy + Math.PI;
    game.enemy.aimAngle = angleToEnemy + Math.PI;

    game.projectiles.length = 0;
    game.effects.length = 0;
    game.floaters.length = 0;
    game.afterimages.length = 0;
    game.giantSwords = [];
    game.cardDrag = null;
    initCards();
    game.shake = 0;
    game.playerHurtFlash = 0;
    game.enemyHurtFlash = 0;
    game.battleTime = 0;
    game.endPending = false;
    game.endTimer = 0;
    game.resultShown = false;
    game.winner = null;
    game.recorded = false;
    game.projectilesSerial = 0;
    game.buffSerial = 0;
    game.combatLog = [];
    game.clashCount = 0;
    game.lastWarningAt = -10;
    game.lastPlayerAttackAt = -10;
    game.match = {
      playerMeleeAttacks: 0,
      playerRangedAttacks: 0,
      playerDamage: 0,
      cardsPlayed: 0,
      maxPlayerMeleeCombo: 0,
      maxPlayerRangedCombo: 0,
      maxEnemyMeleeCombo: 0,
      maxEnemyRangedCombo: 0,
    };
    game.ai = createAI(game.enemy, game.player);

    dom.playerName.textContent = game.player.name;
    dom.enemyName.textContent = game.enemy.name;
    dom.playerPanel.classList.remove('is-meditating', 'is-exhausted', 'damaged');
    dom.enemyPanel.classList.remove('is-meditating', 'is-exhausted', 'damaged');
    dom.resultScreen.hidden = true;
    dom.settingsScreen.hidden = true;
    dom.startScreen.hidden = true;
    updateMemoryLabels();
  }

  function startBattle() {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    releaseAllOrbSources();
    closeSettings(false, true);
    closeCardCodex();
    resetMatch();
    game.mode = 'battle';
    setBodyMode('battle');
    dom.startScreen.hidden = true;
    dom.resultScreen.hidden = true;
    dom.onlineScreen.hidden = true;
    dom.restartBtn.disabled = false;
    setText(dom.restartBtn, '再战一场');
    setText(dom.backToStartBtn, '返回山门');
    setOnlineHudButton(false);
    game.online.lobbyOpen = false;
    game.paused = false;
    showToast('论剑开始 · 剑指即心指', '', 1500);
    updateHud(true);
  }

  function returnToStart() {
    game.mode = 'start';
    game.paused = false;
    game.settingsOpen = false;
    game.online.lobbyOpen = false;
    setBodyMode('start');
    dom.resultScreen.hidden = true;
    dom.settingsScreen.hidden = true;
    dom.onlineScreen.hidden = true;
    dom.startScreen.hidden = false;
    dom.restartBtn.disabled = false;
    setText(dom.restartBtn, '再战一场');
    setText(dom.backToStartBtn, '返回山门');
    setOnlineHudButton(false);
    resetIdleScene();
    updateMemoryLabels();
    updateOnlineRoomUi();
  }

  function resetIdleScene() {
    const spawn = getSpawnPoints();
    if (!game.player) {
      game.player = makeFighter({ team: 'player', name: '云归', role: '青衫客' });
      game.enemy = makeFighter({ team: 'enemy', name: '烬无咎', role: '朱衣客' });
      game.ai = createAI(game.enemy, game.player);
    }
    game.player.x = spawn.player.x;
    game.player.y = spawn.player.y;
    game.player.hp = CONFIG.maxHp;
    game.player.mana = CONFIG.maxMana;
    game.player.essence = 0;
    game.player.essenceTimer = 0;
    game.player.dodgeCooldown = 0;
    game.player.swing = null;
    game.player.dodgeRemaining = 0;
    game.player.throwRemaining = 0;
    game.player.counterCooldown = 0;
    game.player.counterOrbLock = 0;
    game.player.buffAppliedAt = { speed: 0, heal: 0, blood: 0 };
    game.player.stealPlusTimers = [];
    game.player.healUses = 0;
    game.player.rootTimer = 0;
    game.player.rootReward = false;
    game.player.meditationTimer = 0;
    game.player.castDuration = 0;
    game.enemy.x = spawn.enemy.x;
    game.enemy.y = spawn.enemy.y;
    game.enemy.hp = CONFIG.maxHp;
    game.enemy.mana = CONFIG.maxMana;
    game.enemy.essence = 0;
    game.enemy.essenceTimer = 0;
    game.enemy.dodgeCooldown = 0;
    game.enemy.swing = null;
    game.enemy.dodgeRemaining = 0;
    game.enemy.throwRemaining = 0;
    game.enemy.counterCooldown = 0;
    game.enemy.counterOrbLock = 0;
    game.enemy.buffAppliedAt = { speed: 0, heal: 0, blood: 0 };
    game.enemy.stealPlusTimers = [];
    game.enemy.healUses = 0;
    game.enemy.rootTimer = 0;
    game.enemy.rootReward = false;
    game.enemy.meditationTimer = 0;
    game.enemy.castDuration = 0;
    game.enemy.aimAngle = Math.atan2(game.player.y - game.enemy.y, game.player.x - game.enemy.x);
    game.player.aimAngle = Math.atan2(game.enemy.y - game.player.y, game.enemy.x - game.player.x);
    game.projectiles.length = 0;
    game.effects.length = 0;
    game.floaters.length = 0;
    game.afterimages.length = 0;
    game.giantSwords = [];
    game.cardDrag = null;
    game.endPending = false;
    game.endTimer = 0;
    game.battleTime = 0;
    game.paused = false;
    game.ai = createAI(game.enemy, game.player);
    if (game.ai.path) game.ai.path = null;
  }

  function canAct(fighter) {
    return Boolean(
      fighter &&
      fighter.hp > 0 &&
      fighter.stunRemaining <= 0 &&
      game.mode === 'battle' &&
      !game.paused &&
      !game.endPending &&
      !game.settingsOpen
    );
  }

  // 出牌不受眩晕限制（眩晕时也可以放牌）。
  function canUseCards(fighter) {
    return Boolean(
      fighter &&
      fighter.hp > 0 &&
      game.mode === 'battle' &&
      !game.paused &&
      !game.endPending &&
      !game.settingsOpen
    );
  }

  function canSpend(fighter, cost) {
    return cost <= fighter.mana + 0.0001;
  }

  function tryMelee(fighter, angle) {
    if (!canAct(fighter)) return false;
    if (fighter.meleeCooldown > 0) return false;
    if (
      fighter === game.enemy &&
      game.ai &&
      Number.isFinite(game.ai.lastMeleeAt) &&
      game.battleTime - game.ai.lastMeleeAt < CONFIG.aiMeleeAttackInterval
    ) {
      return false;
    }
    const cost = getMeleeCost(fighter);
    if (!canSpend(fighter, cost)) {
      if (fighter === game.player) {
        warnPlayer(`灵力不足 · 挥剑需 ${cost} 灵力（当前 ${Math.floor(fighter.mana)}）`, true);
      }
      return false;
    }

    fighter.meditationTimer = 0;
    fighter.mana = Math.max(0, fighter.mana - cost);
    game.combatLog.push({
      team: fighter.team,
      type: 'melee',
      time: Number(game.battleTime.toFixed(2)),
      meleeCombo: fighter.meleeCombo,
      rangedCombo: fighter.rangedCombo,
    });
    if (game.combatLog.length > 30) game.combatLog.shift();
    fighter.meleeCombo += 1;
    fighter.rangedCombo = 0;
    if (fighter.stats) fighter.stats.meleeSwings += 1;
    fighter.meleeCooldown = CONFIG.meleeCooldown;
    fighter.facing = angle;
    fighter.aimAngle = angle;
    fighter.swing = {
      elapsed: 0,
      duration: CONFIG.meleeDuration,
      hitAt: CONFIG.meleeHitAt,
      resolved: false,
      startAngle: angle - CONFIG.meleeArc / 2,
      endAngle: angle + CONFIG.meleeArc / 2,
      empowered: false,
      targetAngle: angle,
      clashed: false,
      autoAim: Boolean(fighter.meleeAimAssist),
    };
    fighter.walkPhase += 0.35;
    if (fighter === game.player) {
      game.match.playerMeleeAttacks += 1;
      game.match.maxPlayerMeleeCombo = Math.max(game.match.maxPlayerMeleeCombo, fighter.meleeCombo);
      game.lastPlayerAttackAt = game.battleTime;
    } else {
      game.match.maxEnemyMeleeCombo = Math.max(game.match.maxEnemyMeleeCombo, fighter.meleeCombo);
      game.aiStateLabel = '挥剑';
      if (game.ai) {
        game.ai.lastAttackAt = game.battleTime;
        game.ai.lastMeleeAt = game.battleTime;
        game.ai.meleeWaitUntil = 0;
      }
    }
    spawnSwordWind(fighter, angle);
    fighter.meleeAimAssist = false;
    return true;
  }

  function tryOrb(fighter, angle, originPoint = null) {
    if (!canAct(fighter)) return false;
    // 近战刀光期间不能同时发射灵子。
    if (fighter.swing) return false;
    if (fighter.counterOrbLock > 0) {
      if (fighter === game.player) warnPlayer('反制后 0.5 秒内无法御灵');
      return false;
    }
    if (fighter.orbCooldown > 0) return false;
    const cost = getOrbCost(fighter);

    fighter.meditationTimer = 0;
    fighter.regenBlocked = CONFIG.regenPauseAfterAttack;
    game.combatLog.push({
      team: fighter.team,
      type: 'orb',
      time: Number(game.battleTime.toFixed(2)),
      meleeCombo: fighter.meleeCombo,
      rangedCombo: fighter.rangedCombo,
    });
    if (game.combatLog.length > 30) game.combatLog.shift();
    fighter.mana = Math.max(0, fighter.mana - cost);
    fighter.rangedCombo += 1;
    fighter.meleeCombo = 0;
    fighter.orbCooldown = CONFIG.orbCooldown;
    fighter.facing = angle;
    fighter.aimAngle = angle;

    const direction = { x: Math.cos(angle), y: Math.sin(angle) };
    const spawnDistance = fighter.radius + 16 * world.scale;
    const initialSpeed = getOrbInitialSpeed();
    const damage = CONFIG.orbDamage * (fighter.damageBoostTimer > 0 ? 2 : 1);
    const originX = originPoint && Number.isFinite(originPoint.x) ? originPoint.x : fighter.x;
    const originY = originPoint && Number.isFinite(originPoint.y) ? originPoint.y : fighter.y;
    const projectile = {
      x: originX + direction.x * spawnDistance,
      y: originY + direction.y * spawnDistance,
      prevX: originX,
      prevY: originY,
      vx: direction.x * initialSpeed,
      vy: direction.y * initialSpeed,
      speed: initialSpeed,
      initialSpeed,
      maxSpeed: initialSpeed * 1.9,
      accel: initialSpeed * 0.62,
      radius: Math.max(3.2, 3.9 * world.scale),
      owner: fighter.team,
      ownerRef: fighter,
      damage,
      color: fighter.palette.spirit,
      softColor: fighter.palette.spiritSoft,
      serial: ++game.projectilesSerial,
      age: 0,
      trail: [],
      dead: false,
      manaCost: cost,
    };
    game.projectiles.push(projectile);
    spawnSpiritBurst(projectile.x, projectile.y, fighter.palette.spirit, 5, 34 * world.scale);

    if (fighter === game.player) {
      game.match.playerRangedAttacks += 1;
      game.match.maxPlayerRangedCombo = Math.max(game.match.maxPlayerRangedCombo, fighter.rangedCombo);
      game.lastPlayerAttackAt = game.battleTime;
    } else {
      game.match.maxEnemyRangedCombo = Math.max(game.match.maxEnemyRangedCombo, fighter.rangedCombo);
      game.aiStateLabel = '御灵';
    }
    return true;
  }

  function tryDodge(fighter, directionAngle) {
    if (!canAct(fighter)) return false;
    if (fighter.dodgeCooldown > 0 || fighter.dodgeRemaining > 0) return false;

    fighter.meditationTimer = 0;
    const direction = { x: Math.cos(directionAngle), y: Math.sin(directionAngle) };
    game.combatLog.push({
      team: fighter.team,
      type: 'dodge',
      time: Number(game.battleTime.toFixed(2)),
      meleeCombo: fighter.meleeCombo,
      rangedCombo: fighter.rangedCombo,
    });
    if (game.combatLog.length > 30) game.combatLog.shift();
    fighter.dodgeCooldown = CONFIG.dodgeCooldown;
    fighter.dodgeDirX = direction.x;
    fighter.dodgeDirY = direction.y;
    fighter.dodgeRemaining = CONFIG.dodgeDuration;
    fighter.invuln = CONFIG.dodgeInvuln;
    fighter.afterimageTimer = 0;
    fighter.facing = directionAngle;
    fighter.aimAngle = directionAngle;
    if (fighter !== game.player) {
      game.aiStateLabel = '闪身';
      if (game.ai) {
        game.ai.postDodge = 1.5;
        game.ai.lastDodgeAt = game.battleTime;
      }
    }
    spawnDust(fighter.x, fighter.y, 8, fighter.palette.robeLight);
    spawnRipple(fighter.x, fighter.y, fighter.palette.trim, 0.3, fighter.radius * 1.5);
    return true;
  }

  function updateDodge(fighter, dt) {
    if (!fighter || fighter.dodgeRemaining <= 0) return false;
    const step = Math.min(dt, fighter.dodgeRemaining);
    const speed = getDashSpeed();
    const moved = moveFighter(
      fighter,
      fighter.dodgeDirX * speed * step,
      fighter.dodgeDirY * speed * step
    );
    fighter.dodgeRemaining = Math.max(0, fighter.dodgeRemaining - step);
    fighter.afterimageTimer -= dt;
    if (fighter.afterimageTimer <= 0) {
      fighter.afterimageTimer = 0.035;
      addAfterimage(fighter);
      if (moved > 0.5) spawnDust(fighter.x, fighter.y, 2, fighter.palette.robeLight, 0.5);
    }
    if (fighter.dodgeRemaining <= 0) {
      fighter.afterimageTimer = 0;
      spawnDust(fighter.x, fighter.y, 5, fighter.palette.robeLight);
    }
    fighter.moving = true;
    return true;
  }

  function addAfterimage(fighter) {
    game.afterimages.push({
      x: fighter.x,
      y: fighter.y,
      facing: fighter.facing,
      team: fighter.team,
      palette: fighter.palette,
      life: 0.32,
      maxLife: 0.32,
      meditating: false,
    });
  }

  function triggerDodgeBounce(fighter, attacker) {
    if (!fighter || !attacker || fighter.hp <= 0) return;
    let dx = fighter.x - attacker.x;
    let dy = fighter.y - attacker.y;
    let length = Math.hypot(dx, dy);
    if (length < 0.001) {
      dx = -Math.cos(attacker.facing);
      dy = -Math.sin(attacker.facing);
      length = 1;
    }
    fighter.bounceDirX = dx / length;
    fighter.bounceDirY = dy / length;
    fighter.bounceRemaining = 0.18;
    fighter.bounceSpeed = 700 * world.scale;
    fighter.dodgeRemaining = 0;
    fighter.afterimageTimer = 0;
    fighter.moving = true;
    game.shake = Math.max(game.shake, 3);
    spawnDust(fighter.x, fighter.y, 7, fighter.palette.robeLight, 0.8);
    spawnRipple(fighter.x, fighter.y, fighter.palette.trim, 0.3, fighter.radius * 1.8);
  }

  function updateBounce(fighter, dt) {
    if (!fighter || fighter.hp <= 0 || fighter.bounceRemaining <= 0) return false;
    const step = Math.min(dt, fighter.bounceRemaining);
    const moved = moveFighter(
      fighter,
      fighter.bounceDirX * fighter.bounceSpeed * step,
      fighter.bounceDirY * fighter.bounceSpeed * step
    );
    fighter.bounceRemaining = Math.max(0, fighter.bounceRemaining - step);
    fighter.moving = moved > 0.02;
    fighter.facing = Math.atan2(fighter.bounceDirY, fighter.bounceDirX);
    fighter.afterimageTimer -= dt;
    if (fighter.afterimageTimer <= 0) {
      fighter.afterimageTimer = 0.032;
      addAfterimage(fighter);
      spawnDust(fighter.x, fighter.y, 2, fighter.palette.robeLight, 0.6);
    }
    if (fighter.bounceRemaining <= 0) {
      spawnDust(fighter.x, fighter.y, 4, fighter.palette.robeLight);
    }
    return true;
  }

  // 反制后的抛掷位移：被扔出去的战士沿固定方向飞一段距离。
  function updateThrow(fighter, dt) {
    if (!fighter || fighter.hp <= 0 || fighter.throwRemaining <= 0) return false;
    const step = Math.min(dt, fighter.throwRemaining);
    const moved = moveFighter(
      fighter,
      fighter.throwDirX * fighter.throwSpeed * step,
      fighter.throwDirY * fighter.throwSpeed * step
    );
    fighter.throwRemaining = Math.max(0, fighter.throwRemaining - step);
    fighter.moving = moved > 0.02;
    fighter.afterimageTimer -= dt;
    if (fighter.afterimageTimer <= 0) {
      fighter.afterimageTimer = 0.04;
      addAfterimage(fighter);
    }
    if (fighter.throwRemaining <= 0) {
      spawnDust(fighter.x, fighter.y, 6, fighter.palette.robeLight);
    }
    return true;
  }

  // 施加眩晕：会打断打坐，并让这一次打坐拿不到精魄。
  function applyStun(fighter, seconds) {
    if (!fighter || fighter.hp <= 0) return;
    if (fighter.rootTimer > 0) {
      fighter.rootTimer = 0;
      fighter.rootReward = false;
      fighter.meditationTimer = 0;
      spawnFloater(fighter.x, fighter.y - 74 * world.scale, '打坐被打断', '#ffb0a1', 0.9, 14);
      if (fighter === game.player) {
        showToast('打坐被打断，本次无法获得精魄', 'warn', 1300);
      }
    }
    fighter.stunRemaining = Math.max(fighter.stunRemaining, seconds);
  }

  // 反制：对方近战刀光出现期间按右键，打断并把他扔出去。
  function tryCounter(defender) {
    const opponent = defender === game.player ? game.enemy : game.player;
    if (!opponent || opponent.hp <= 0 || !defender || defender.hp <= 0) return false;
    if (!canAct(defender) || defender.counterCooldown > 0 || defender.throwRemaining > 0) return false;
    if (defender.swing) return false;
    const swing = opponent.swing;
    if (!swing || swing.clashed) return false;
    const distance = dist(defender.x, defender.y, opponent.x, opponent.y);
    if (distance > getMeleeReach(opponent) * CONFIG.counterRangeScale + defender.radius + opponent.radius * 0.5) {
      return false;
    }

    const away = Math.atan2(opponent.y - defender.y, opponent.x - defender.x);
    defender.mana = Math.max(0, defender.mana - CONFIG.counterManaCost);
    defender.counterCooldown = CONFIG.counterCooldown;
    defender.counterOrbLock = CONFIG.counterOrbLock;

    // 轻身术可以抵挡一次反制：反制方仍消耗灵力并进入冷却，但目标不被投掷/眩晕。
    if (opponent.speedBoostTimer > 0) {
      opponent.speedBoostTimer = 0;
      if (opponent.buffAppliedAt) opponent.buffAppliedAt.speed = 0;
      defender.facing = away;
      defender.aimAngle = away;
      game.shake = Math.max(game.shake, 4);
      spawnRipple(defender.x, defender.y, '#9fe8d6', 0.4, defender.radius * 2);
      spawnRipple(opponent.x, opponent.y, '#b8f0e0', 0.34, opponent.radius * 1.6);
      spawnFloater(opponent.x, opponent.y - 56 * world.scale, '轻身挡反', '#9fe8d6', 0.9, 15);
      if (opponent === game.player) {
        showToast('轻身术挡下了反制；轻身已消散', '', 1400);
      } else if (defender === game.player) {
        showToast('对手的轻身术挡下了反制', 'warn', 1200);
      }
      game.combatLog.push({
        team: defender.team,
        type: 'counter-blocked',
        time: Number(game.battleTime.toFixed(2)),
        meleeCombo: defender.meleeCombo,
        rangedCombo: defender.rangedCombo,
      });
      if (game.combatLog.length > 30) game.combatLog.shift();
      return true;
    }

    opponent.swing = null;
    opponent.meleeCooldown = Math.max(opponent.meleeCooldown, CONFIG.meleeCooldown);
    opponent.meditationTimer = 0;
    opponent.throwRemaining = CONFIG.throwDuration;
    opponent.throwDirX = Math.cos(away);
    opponent.throwDirY = Math.sin(away);
    opponent.throwSpeed = CONFIG.throwSpeed * world.scale;
    // 反制会眩晕被扔出去的人；受到首次攻击后解除（damageFighter 负责）。
    applyStun(opponent, CONFIG.counterStunDuration);
    defender.facing = -away;
    defender.aimAngle = -away;

    game.shake = Math.max(game.shake, 7);
    spawnRipple(defender.x, defender.y, '#ffe7ae', 0.4, defender.radius * 2);
    spawnRipple(opponent.x, opponent.y, '#ffd8a0', 0.34, opponent.radius * 1.6);
    spawnFloater(opponent.x, opponent.y - 56 * world.scale, '反制', '#ffe7ae', 0.9, 16);
    game.combatLog.push({
      team: defender.team,
      type: 'counter',
      time: Number(game.battleTime.toFixed(2)),
      meleeCombo: defender.meleeCombo,
      rangedCombo: defender.rangedCombo,
    });
    if (game.combatLog.length > 30) game.combatLog.shift();
    return true;
  }

  function handleDodgeSuccess(fighter, attacker, kind) {
    if (!fighter) return;
    const hadCombo = fighter.meleeCombo > 0 || fighter.rangedCombo > 0;
    fighter.meleeCombo = 0;
    fighter.rangedCombo = 0;
    game.combatLog.push({
      team: fighter.team,
      type: 'dodge-success',
      source: kind,
      time: Number(game.battleTime.toFixed(2)),
      meleeCombo: 0,
      rangedCombo: 0,
    });
    if (game.combatLog.length > 30) game.combatLog.shift();
    if (hadCombo) {
      spawnFloater(fighter.x, fighter.y - 54 * world.scale, '卸势', fighter.palette.trim, 0.7, 13);
    } else {
      spawnMissSpark(fighter.x, fighter.y - 36 * world.scale, '闪');
    }
    if (kind === 'melee') {
      triggerDodgeBounce(fighter, attacker);
    }
  }

  function resolveMeleeSwing(fighter, swing) {
    // 拼刀：双方都不会受到这次近战伤害。
    if (swing.clashed) return;
    const opponent = fighter === game.player ? game.enemy : game.player;
    if (!opponent || opponent.hp <= 0) return;
    // 双方刀光同时存在时优先判拼刀，避免一刀先结算后另一刀再吃近战命中回灵。
    if (opponent.swing && !opponent.swing.clashed && !opponent.swing.resolved) {
      swing.clashed = true;
      opponent.swing.clashed = true;
      triggerMeleeClash(fighter, opponent);
      return;
    }

    const reach = getMeleeReach(fighter);
    const distance = dist(fighter.x, fighter.y, opponent.x, opponent.y);
    const angleToOpponent = Math.atan2(opponent.y - fighter.y, opponent.x - fighter.x);
    const withinArc = Math.abs(angleDiff(angleToOpponent, swing.targetAngle)) <= CONFIG.meleeArc / 2 + 0.12;
    const withinRange =
      distance <=
      reach + opponent.radius * 0.62 + (swing.autoAim ? 18 * world.scale : 0);
    const lineClear = !lineBlockedByObstacle(fighter.x, fighter.y, opponent.x, opponent.y, 1.5 * world.scale);

    if (withinArc && withinRange && lineClear) {
      if (opponent.invuln > 0) {
        handleDodgeSuccess(opponent, fighter, 'melee');
      } else {
        const damage = CONFIG.meleeDamage * (fighter.damageBoostTimer > 0 ? 2 : 1);
        const didHit = damageFighter(opponent, damage, {
          source: 'melee',
          attacker: fighter,
          showText: true,
        });
        if (didHit) {
          fighter.stats.meleeHits += 1;
          fighter.stats.damageDealt += damage;
          if (fighter === game.player) {
            game.match.playerDamage += damage;
          }
          // 近战命中：攻击者回复 35 点灵力（未命中不回复）。
          restoreMana(fighter, CONFIG.manaOnMeleeHit);
          game.shake = Math.max(game.shake, 7);
          spawnMeleeHit(opponent.x, opponent.y - 20 * world.scale, fighter.palette, false);
          playMeleeImpact(false);
          fighter.facing = angleToOpponent;
        }
      }
    }
  }

  function damageFighter(target, amount, options = {}) {
    if (!target || target.hp <= 0 || game.endPending) return false;
    const source = options.source || 'unknown';
    const isAttack = source === 'melee' || source === 'orb' || source === 'sword';
    if (isAttack && target.invuln > 0) return false;

    const actualDamage = Math.max(0, amount);
    target.hp = Math.max(0, target.hp - actualDamage);
    target.hitFlash = source === 'exhaust' ? 0.12 : 0.22;

    // 玄武锤的眩晕：受到首次攻击伤害后立即解除。
    if (isAttack && target.stunRemaining > 0) {
      target.stunRemaining = 0;
      spawnFloater(target.x, target.y - 74 * world.scale, '解晕', '#ffe6a8', 0.7, 13);
    }

    if (source !== 'exhaust' && options.attacker) {
      spawnInkSplash(target.x, target.y - 20 * world.scale, options.attacker.palette);
    }

    if (target === game.player) {
      game.playerHurtFlash = Math.min(1, game.playerHurtFlash + (source === 'exhaust' ? 0.16 : 0.55));
      flashPanel(dom.playerPanel);
    } else {
      game.enemyHurtFlash = Math.min(1, game.enemyHurtFlash + (source === 'exhaust' ? 0.12 : 0.42));
      flashPanel(dom.enemyPanel);
    }

    if (options.showText !== false) {
      const color = options.empowered ? '#ffe2a1' : target === game.enemy ? '#ffd2b6' : '#ffb0a1';
      spawnFloater(
        target.x + (Math.random() - 0.5) * 12 * world.scale,
        target.y - (56 + Math.random() * 8) * world.scale,
        `-${Math.round(actualDamage)}`,
        color,
        options.empowered ? 1.0 : 0.8,
        options.empowered ? 24 : 19
      );
    }

    if (source === 'exhaust') {
      spawnFloater(target.x + 8 * world.scale, target.y - 34 * world.scale, '枯', '#d96b58', 0.55, 12);
    }

    if (target.hp <= 0) {
      handleDefeat(target);
    }
    return true;
  }

  function flashPanel(panel) {
    if (!panel) return;
    panel.classList.remove('damaged');
    // Restarting the animation reliably without a layout read keep-alive.
    void panel.offsetWidth;
    panel.classList.add('damaged');
    window.setTimeout(() => panel.classList.remove('damaged'), 300);
  }

  function handleDefeat(loser) {
    if (game.endPending || game.mode !== 'battle') return;
    const winner = loser === game.player ? game.enemy : game.player;
    game.endPending = true;
    game.endTimer = 1.05;
    game.winner = winner;
    game.enemy.aiStateLabel = loser === game.enemy ? '败势' : '收势';
    game.player.swing = null;
    game.enemy.swing = null;
    game.shake = Math.max(game.shake, 12);
    spawnRipple(loser.x, loser.y, loser.palette.trim, 0.8, loser.radius * 3);
    spawnInkSplash(loser.x, loser.y - 20 * world.scale, loser.palette, 24);
    recordMatch();
  }

  function recordMatch() {
    if (game.recorded) return;
    game.recorded = true;
    if (game.online.active) return;
    game.history.push({
      melee: game.match.playerMeleeAttacks,
      ranged: game.match.playerRangedAttacks,
      at: Date.now(),
    });
    game.history = game.history.slice(-5);
    saveHistory();
  }

  function completeBattle() {
    if (game.resultShown) return;
    game.resultShown = true;
    game.mode = 'over';
    game.paused = true;
    setBodyMode('over');

    const localFighter = isOnlineGuest() ? game.enemy : game.player;
    const rival = isOnlineGuest() ? game.player : game.enemy;
    const playerWon = game.winner === localFighter;
    const isDraw = !game.winner;
    dom.resultSeal.textContent = isDraw ? '平' : playerWon ? '胜' : '败';
    dom.resultSeal.classList.toggle('defeat', !playerWon && !isDraw);
    dom.resultSeal.classList.toggle('draw', isDraw);
    setText(dom.resultEyebrow, isDraw ? '此 局 未 决' : '此 局 已 定');
    setText(dom.resultTitle, isDraw ? '道心相照' : playerWon ? '道心不折' : '身死道消');
    setText(
      dom.resultCopy,
      isDraw
        ? '两道剑光同时落定，论剑台上只余风声。'
        : playerWon
          ? game.online.active
            ? `剑光落定，${rival ? rival.name : '道友'}退后半步，抱拳认负。`
            : '剑光落定，朱衣客退后半步，抱拳认负。'
          : game.online.active
            ? `${rival ? rival.name : '道友'}收剑而立。你于阵纹微光中，重新审视自己的道。`
            : '朱衣客收剑而立。你于阵纹微光中，重新审视自己的道。'
    );
    const localMaxMelee = isOnlineGuest()
      ? game.match.maxEnemyMeleeCombo
      : game.match.maxPlayerMeleeCombo;
    const localMaxRanged = isOnlineGuest()
      ? game.match.maxEnemyRangedCombo
      : game.match.maxPlayerRangedCombo;
    const localDamage = isOnlineGuest()
      ? game.enemy.stats.damageDealt
      : game.match.playerDamage;
    const localCards = isOnlineGuest()
      ? game.enemy.stats.cardsPlayed || 0
      : game.match.cardsPlayed;
    setText(dom.resultHp, `${Math.ceil(localFighter.hp)}`);
    setText(dom.resultMelee, `${localMaxMelee}`);
    setText(dom.resultRanged, `${localMaxRanged}`);
    setText(dom.resultDamage, `${localDamage}`);
    setText(dom.resultTime, formatTime(game.battleTime));
    setText(dom.resultEmpowered, `${localCards}`);
    if (game.online.active) {
      setText(dom.resultMemory, `联机论剑 · 房间 ${game.online.code || ''} · 此局已入江湖。`);
      setText(dom.backToStartBtn, '离开房间');
      setText(dom.restartBtn, game.online.role === 'host' ? '再战一场' : '请求再战');
      dom.restartBtn.disabled = false;
      if (game.online.role === 'guest' && game.online.rematchRequested) {
        setText(dom.restartBtn, '已请求再战');
        dom.restartBtn.disabled = true;
      }
    } else {
      const profile = getPlayerProfile();
      setText(
        dom.resultMemory,
        profile.ready
          ? `朱衣客已记住这 ${profile.matches} 场斗法：${profile.meleeRatio >= profile.rangedRatio ? '你更常以剑近身' : '你更常以灵子远攻'}。`
          : `朱衣客正在记住你的出手 · 尚需更多对局。`
      );
      setText(dom.backToStartBtn, '返回山门');
      setText(dom.restartBtn, '再战一场');
      dom.restartBtn.disabled = false;
    }

    dom.resultScreen.hidden = false;
    updateHud(true);
    sendOnlineResult();
  }

  function spawnFloater(x, y, text, color, life = 0.8, size = 18) {
    game.floaters.push({
      x,
      y,
      text,
      color,
      life,
      maxLife: life,
      size: Math.max(11, size * clamp(world.scale, 0.68, 1.15)),
      vy: -28 * world.scale,
      drift: (Math.random() - 0.5) * 12 * world.scale,
    });
  }

  function spawnSpiritBurst(x, y, color, count, speed) {
    for (let i = 0; i < count; i += 1) {
      const angle = Math.random() * TAU;
      const velocity = speed * (0.35 + Math.random() * 0.65);
      game.effects.push({
        type: 'spark',
        x,
        y,
        vx: Math.cos(angle) * velocity,
        vy: Math.sin(angle) * velocity,
        life: 0.24 + Math.random() * 0.26,
        maxLife: 0.5,
        size: (1.2 + Math.random() * 2.1) * world.scale,
        color,
        gravity: 18 * world.scale,
      });
    }
  }

  function spawnSwordWind(fighter, angle) {
    const speed = 70 * world.scale;
    for (let i = 0; i < 7; i += 1) {
      const a = angle + (Math.random() - 0.5) * 1.1;
      game.effects.push({
        type: 'wind',
        x: fighter.x + Math.cos(a) * fighter.radius,
        y: fighter.y - 14 * world.scale + Math.sin(a) * fighter.radius * 0.4,
        vx: Math.cos(a) * speed * (0.4 + Math.random() * 0.9),
        vy: Math.sin(a) * speed * (0.25 + Math.random() * 0.5) - 12 * world.scale,
        life: 0.22 + Math.random() * 0.18,
        maxLife: 0.4,
        size: (1 + Math.random() * 2) * world.scale,
        color: fighter.palette.trim,
        gravity: 0,
      });
    }
  }

  function spawnMeleeHit(x, y, palette, empowered) {
    for (let i = 0; i < (empowered ? 22 : 14); i += 1) {
      const angle = Math.random() * TAU;
      const speed = (empowered ? 175 : 125) * world.scale * (0.3 + Math.random());
      game.effects.push({
        type: 'spark',
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 30 * world.scale,
        life: 0.22 + Math.random() * 0.35,
        maxLife: 0.58,
        size: (1.2 + Math.random() * 2.6) * world.scale,
        color: i % 3 === 0 ? '#ffe6ad' : palette.trim,
        gravity: 220 * world.scale,
      });
    }
    game.effects.push({
      type: 'slashFlash',
      x,
      y,
      life: 0.18,
      maxLife: 0.18,
      size: (empowered ? 44 : 32) * world.scale,
      color: palette.trim,
    });
    game.effects.push({
      type: 'ring',
      x,
      y,
      life: 0.24,
      maxLife: 0.24,
      size: (empowered ? 30 : 22) * world.scale,
      color: '#ffe8b1',
    });
  }

  function checkMeleeClash() {
    const player = game.player;
    const enemy = game.enemy;
    if (!player || !enemy || player.hp <= 0 || enemy.hp <= 0) return;
    const playerSwing = player.swing;
    const enemySwing = enemy.swing;
    if (!playerSwing || !enemySwing || playerSwing.clashed || enemySwing.clashed) return;
    // 只有双方剑都还没落下时才算拼刀；已经命中过的残影不再参与。
    if (playerSwing.resolved || enemySwing.resolved) return;
    playerSwing.clashed = true;
    enemySwing.clashed = true;
    triggerMeleeClash(player, enemy);
  }

  function triggerMeleeClash(player, enemy) {
    game.clashCount += 1;
    // 拼刀：双方闪避立即转好、近战冷却立即刷新，并各回复灵力。
    player.dodgeCooldown = 0;
    enemy.dodgeCooldown = 0;
    player.meleeCooldown = 0;
    enemy.meleeCooldown = 0;
    restoreMana(player, CONFIG.manaOnMeleeClash);
    restoreMana(enemy, CONFIG.manaOnMeleeClash);
    game.shake = Math.max(game.shake, 15);
    const x = (player.x + enemy.x) / 2;
    const y = (player.y + enemy.y) / 2 - 16 * world.scale;
    spawnClashSparks(x, y);
    spawnRipple(x, y, '#ffe7ae', 0.38, 36 * world.scale);
    spawnFloater(x, y - 30 * world.scale, '拼刀', '#ffe7ad', 0.9, 18);
    game.combatLog.push({
      team: 'both',
      type: 'clash',
      time: Number(game.battleTime.toFixed(2)),
      meleeCombo: Math.max(player.meleeCombo, enemy.meleeCombo),
      rangedCombo: Math.max(player.rangedCombo, enemy.rangedCombo),
      empowered: false,
    });
    if (game.combatLog.length > 30) game.combatLog.shift();
    playClashSound();
    showToast('拼刀 · 闪避已刷新', '', 1050);
  }

  function spawnClashSparks(x, y) {
    for (let i = 0; i < 34; i += 1) {
      const angle = Math.random() * TAU;
      const speed = (120 + Math.random() * 330) * world.scale;
      game.effects.push({
        type: 'spark',
        x: x + (Math.random() - 0.5) * 10 * world.scale,
        y: y + (Math.random() - 0.5) * 10 * world.scale,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 35 * world.scale,
        life: 0.24 + Math.random() * 0.34,
        maxLife: 0.58,
        size: (1.3 + Math.random() * 2.8) * world.scale,
        color: i % 4 === 0 ? '#fff6cf' : i % 3 === 0 ? '#d9f7ff' : '#ffd884',
        gravity: 250 * world.scale,
      });
    }
    game.effects.push({
      type: 'clashFlash',
      x,
      y,
      life: 0.26,
      maxLife: 0.26,
      size: 54 * world.scale,
      color: '#ffe6a6',
    });
  }

  function spawnParryBurst(x, y, palette) {
    for (let i = 0; i < 16; i += 1) {
      const angle = Math.random() * TAU;
      const speed = 155 * world.scale * (0.3 + Math.random());
      game.effects.push({
        type: 'spark',
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.25 + Math.random() * 0.3,
        maxLife: 0.55,
        size: (1 + Math.random() * 2.4) * world.scale,
        color: i % 2 ? '#fff0bd' : palette.trim,
        gravity: 80 * world.scale,
      });
    }
    game.effects.push({
      type: 'ring',
      x,
      y,
      life: 0.26,
      maxLife: 0.26,
      size: 24 * world.scale,
      color: palette.trim,
    });
  }

  function spawnInkSplash(x, y, palette, count = 12) {
    for (let i = 0; i < count; i += 1) {
      const angle = Math.random() * TAU;
      const speed = 75 * world.scale * (0.2 + Math.random());
      game.effects.push({
        type: 'ink',
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 25 * world.scale,
        life: 0.4 + Math.random() * 0.4,
        maxLife: 0.8,
        size: (1.5 + Math.random() * 3.4) * world.scale,
        color: i % 4 === 0 ? palette.trim : palette.robeOuter,
        gravity: 170 * world.scale,
      });
    }
  }

  function spawnDust(x, y, count, color, spread = 1) {
    for (let i = 0; i < count; i += 1) {
      const angle = Math.random() * TAU;
      game.effects.push({
        type: 'dust',
        x: x + (Math.random() - 0.5) * 8 * world.scale,
        y: y + (Math.random() - 0.5) * 3 * world.scale,
        vx: Math.cos(angle) * 35 * world.scale * spread,
        vy: Math.sin(angle) * 10 * world.scale * spread - 6 * world.scale,
        life: 0.25 + Math.random() * 0.35,
        maxLife: 0.6,
        size: (1.2 + Math.random() * 2.4) * world.scale,
        color,
        gravity: -6 * world.scale,
      });
    }
  }

  function spawnRipple(x, y, color, life, size) {
    game.effects.push({
      type: 'ring',
      x,
      y,
      life,
      maxLife: life,
      size,
      color,
    });
  }

  function spawnMissSpark(x, y, text) {
    spawnFloater(x, y, text, '#d8dccd', 0.55, 13);
  }

  function handleProjectileHit(projectile, target) {
    if (projectile.dead || target.hp <= 0) return;
    if (target.invuln > 0) return;
    const didHit = damageFighter(target, projectile.damage, {
      source: 'orb',
      attacker: projectile.ownerRef,
      showText: true,
    });
    if (!didHit) return;
    projectile.dead = true;
    projectile.ownerRef.stats.orbHits += 1;
    projectile.ownerRef.stats.damageDealt += projectile.damage;
    if (projectile.ownerRef === game.player) {
      game.match.playerDamage += projectile.damage;
    }
    // 灵子命中：发射者回复 25 点灵力（闪避/未命中不回复）。
    restoreMana(projectile.ownerRef, CONFIG.manaOnOrbHit);
    game.shake = Math.max(game.shake, 4);
    spawnSpiritBurst(projectile.x, projectile.y, projectile.color, 12, 110 * world.scale);
    spawnInkSplash(target.x, target.y - 22 * world.scale, target.palette, 7);
  }

  function addMana(fighter, amount, showGain = true) {
    if (!fighter || !Number.isFinite(amount) || amount <= 0) return 0;
    fighter.mana += amount;
    let converted = 0;
    // 灵力达到 100 就自动凝魄；保留溢出，避免 90 + 60 这类回复丢失。
    while (fighter.mana >= CONFIG.maxMana - 0.000001 && converted < 8) {
      fighter.mana -= CONFIG.maxMana;
      converted += 1;
      if (fighter.essence < CONFIG.essenceMax) {
        fighter.essence += 1;
        spawnFloater(fighter.x, fighter.y - 58 * world.scale, '+1 精魄', '#ffe6a8', 0.9, 14);
        spawnRipple(fighter.x, fighter.y, '#ffe6a8', 0.36, fighter.radius * 1.9);
      }
    }
    fighter.mana = clamp(fighter.mana, 0, fighter.maxMana);
    if (showGain && amount > 0.05) {
      spawnFloater(
        fighter.x,
        fighter.y - 62 * world.scale,
        `+${Math.round(amount)} 灵力`,
        '#a9d7ff',
        0.9,
        14
      );
    }
    return amount;
  }

  function restoreMana(fighter, amount) {
    return addMana(fighter, amount, true);
  }

  function destroyProjectile(projectile, effect = true) {
    if (!projectile || projectile.dead) return;
    projectile.dead = true;
    if (effect) {
      spawnSpiritBurst(projectile.x, projectile.y, projectile.color, 7, 65 * world.scale);
      spawnRipple(projectile.x, projectile.y, projectile.color, 0.22, 12 * world.scale);
    }
  }

  function updateProjectiles(dt) {
    for (const projectile of game.projectiles) {
      if (projectile.dead) continue;
      projectile.age += dt;
      if (projectile.age > CONFIG.orbMaxLife) {
        destroyProjectile(projectile, true);
        continue;
      }

      // 对波吸附：附近有敌方灵子相向而行时，轻微牵引弹道，提高对波概率。
      for (const other of game.projectiles) {
        if (other === projectile || other.dead || other.owner === projectile.owner) continue;
        const dx = other.x - projectile.x;
        const dy = other.y - projectile.y;
        const gap = Math.hypot(dx, dy);
        if (gap > CONFIG.orbMagnetRadius * world.scale || gap < 1) continue;
        const toOther = Math.atan2(dy, dx);
        const current = Math.atan2(projectile.vy, projectile.vx);
        if (Math.cos(toOther - current) < 0.2) continue;
        const otherTravel = Math.atan2(other.vy, other.vx);
        const otherToThis = Math.atan2(-dy, -dx);
        if (Math.cos(otherTravel - otherToThis) < 0.2) continue;
        const maxTurn = CONFIG.orbMagnetTurnRate * dt;
        const diff = Math.atan2(Math.sin(toOther - current), Math.cos(toOther - current));
        const turn = clamp(diff, -maxTurn, maxTurn);
        const speed = Math.hypot(projectile.vx, projectile.vy) || 1;
        projectile.vx = Math.cos(current + turn) * speed;
        projectile.vy = Math.sin(current + turn) * speed;
        break;
      }

      projectile.speed = Math.min(projectile.maxSpeed, projectile.speed + projectile.accel * dt);
      const direction = norm(projectile.vx, projectile.vy);
      projectile.vx = direction.x * projectile.speed;
      projectile.vy = direction.y * projectile.speed;
      projectile.prevX = projectile.x;
      projectile.prevY = projectile.y;

      const travel = projectile.speed * dt;
      const substeps = Math.max(1, Math.ceil(travel / Math.max(5, 7 * world.scale)));
      let removed = false;
      for (let i = 0; i < substeps; i += 1) {
        projectile.x += projectile.vx * (dt / substeps);
        projectile.y += projectile.vy * (dt / substeps);
        if (isProjectileOutsideArena(projectile)) {
          destroyProjectile(projectile, false);
          removed = true;
          break;
        }
        for (const obstacle of world.obstacles) {
          if (dist(projectile.x, projectile.y, obstacle.x, obstacle.y) < obstacle.radius + projectile.radius) {
            spawnSpiritBurst(projectile.x, projectile.y, projectile.color, 6, 55 * world.scale);
            destroyProjectile(projectile, false);
            removed = true;
            break;
          }
        }
        if (removed) break;

        const target = projectile.owner === 'player' ? game.enemy : game.player;
        if (target && target.hp > 0) {
          const hitDistance = dist(projectile.x, projectile.y, target.x, target.y);
          if (hitDistance < target.radius + projectile.radius) {
            if (target.invuln > 0) {
              // The invulnerable dash passes through the spirit orb without
              // healing or restoring mana, but a clean dodge breaks both of
              // the defender's combo chains.
              handleDodgeSuccess(target, projectile.ownerRef, 'orb');
              continue;
            }
            handleProjectileHit(projectile, target);
            removed = projectile.dead;
            break;
          }
        }
      }

      if (!removed) {
        projectile.trail.unshift({ x: projectile.x, y: projectile.y });
        if (projectile.trail.length > 22) projectile.trail.length = 22;
      }
    }

    // Opposing orbs annihilate. The later launch gains a flat 20 spirit (对波).
    // Use swept segments so fast orbs cannot tunnel through each other.
    for (let i = 0; i < game.projectiles.length; i += 1) {
      const a = game.projectiles[i];
      if (a.dead) continue;
      for (let j = i + 1; j < game.projectiles.length; j += 1) {
        const b = game.projectiles[j];
        if (b.dead || a.owner === b.owner) continue;
        const reach = a.radius + b.radius + 2 * world.scale;
        const gap = Math.min(
          pointToSegmentDistance(a.x, a.y, b.prevX, b.prevY, b.x, b.y),
          pointToSegmentDistance(b.x, b.y, a.prevX, a.prevY, a.x, a.y)
        );
        if (gap <= reach) {
          const later = a.serial > b.serial ? a : b;
          const laterOwner = later.ownerRef;
          spawnSpiritBurst((a.x + b.x) / 2, (a.y + b.y) / 2, '#d9ecff', 18, 120 * world.scale);
          spawnRipple((a.x + b.x) / 2, (a.y + b.y) / 2, '#cfe8ff', 0.34, 18 * world.scale);
          destroyProjectile(a, false);
          destroyProjectile(b, false);
          restoreMana(laterOwner, CONFIG.manaOnClash);
          showToast(
            laterOwner === game.player
              ? `对波成功 · 得 ${CONFIG.manaOnClash} 灵力`
              : `朱衣客对波成功 · 得 ${CONFIG.manaOnClash} 灵力`,
            '',
            1250
          );
          break;
        }
      }
    }

    game.projectiles = game.projectiles.filter((projectile) => !projectile.dead);
  }

  function isProjectileOutsideArena(projectile) {
    const margin = 8 * world.scale;
    return (
      projectile.x < world.play.x - margin ||
      projectile.x > world.play.x + world.play.w + margin ||
      projectile.y < world.play.y - margin ||
      projectile.y > world.play.y + world.play.h + margin
    );
  }

  /* =======================================================================
     04. 移动、掩体碰撞与路径搜索
     ======================================================================= */

  function moveFighter(fighter, dx, dy) {
    if (!fighter || (dx === 0 && dy === 0)) return 0;
    const startX = fighter.x;
    const startY = fighter.y;

    fighter.x += dx;
    fighter.y += dy;

    clampFighterToArena(fighter);
    resolveObstaclePenetration(fighter);
    clampFighterToArena(fighter);

    const moved = dist(startX, startY, fighter.x, fighter.y);
    const expected = Math.hypot(dx, dy);
    if (moved > 0.05) {
      fighter.moving = true;
      if (expected > 0.001) fighter.walkPhase += moved * 0.075;
    }
    fighter.prevX = startX;
    fighter.prevY = startY;
    return moved;
  }

  function clampFighterToArena(fighter) {
    const minX = world.play.x + fighter.radius;
    const maxX = world.play.x + world.play.w - fighter.radius;
    const minY = world.play.y + fighter.radius;
    const maxY = world.play.y + world.play.h - fighter.radius;
    fighter.x = clamp(fighter.x, minX, maxX);
    fighter.y = clamp(fighter.y, minY, maxY);
  }

  function resolveObstaclePenetration(fighter) {
    for (let iteration = 0; iteration < 4; iteration += 1) {
      let corrected = false;
      for (const obstacle of world.obstacles) {
        const minDistance = obstacle.radius + fighter.radius + 1.5;
        const dx = fighter.x - obstacle.x;
        const dy = fighter.y - obstacle.y;
        const d = Math.hypot(dx, dy);
        if (d < minDistance) {
          const nx = d > 0.001 ? dx / d : 1;
          const ny = d > 0.001 ? dy / d : 0;
          fighter.x = obstacle.x + nx * minDistance;
          fighter.y = obstacle.y + ny * minDistance;
          clampFighterToArena(fighter);
          corrected = true;
        }
      }
      if (!corrected) break;
    }
  }

  function separateFighters() {
    const a = game.player;
    const b = game.enemy;
    if (!a || !b) return;
    const minDistance = a.radius + b.radius + 2 * world.scale;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.hypot(dx, dy);
    if (d >= minDistance || d < 0.001) return;
    const overlap = minDistance - d;
    const nx = dx / d;
    const ny = dy / d;
    a.x -= nx * overlap * 0.5;
    a.y -= ny * overlap * 0.5;
    b.x += nx * overlap * 0.5;
    b.y += ny * overlap * 0.5;
    clampFighterToArena(a);
    clampFighterToArena(b);
    resolveObstaclePenetration(a);
    resolveObstaclePenetration(b);
    clampFighterToArena(a);
    clampFighterToArena(b);
  }

  function lineBlockedByObstacle(ax, ay, bx, by, padding = 0) {
    for (const obstacle of world.obstacles) {
      if (pointToSegmentDistance(obstacle.x, obstacle.y, ax, ay, bx, by) < obstacle.radius + padding) {
        return true;
      }
    }
    return false;
  }

  function hasMeleeLine(attacker, target) {
    return !lineBlockedByObstacle(
      attacker.x,
      attacker.y,
      target.x,
      target.y,
      2 * world.scale
    );
  }

  function hasProjectileLine(attacker, target) {
    const padding = Math.max(2, 4 * world.scale);
    return !lineBlockedByObstacle(
      attacker.x,
      attacker.y,
      target.x,
      target.y,
      padding
    );
  }

  function movementLineClear(ax, ay, bx, by, radius) {
    const d = dist(ax, ay, bx, by);
    if (d < 0.01) return true;
    for (const obstacle of world.obstacles) {
      if (pointToSegmentDistance(obstacle.x, obstacle.y, ax, ay, bx, by) < obstacle.radius + radius + 1.5) {
        return false;
      }
    }
    return true;
  }

  function buildNavGrid(actorRadius) {
    const cell = Math.max(20, Math.min(38, 31 * world.scale));
    const cols = Math.max(6, Math.ceil(world.play.w / cell));
    const rows = Math.max(6, Math.ceil(world.play.h / cell));
    const blocked = new Uint8Array(cols * rows);
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const x = world.play.x + (col + 0.5) * cell;
        const y = world.play.y + (row + 0.5) * cell;
        let isBlocked =
          x < world.play.x + actorRadius ||
          x > world.play.x + world.play.w - actorRadius ||
          y < world.play.y + actorRadius ||
          y > world.play.y + world.play.h - actorRadius;
        if (!isBlocked) {
          for (const obstacle of world.obstacles) {
            if (dist(x, y, obstacle.x, obstacle.y) < obstacle.radius + actorRadius + 2) {
              isBlocked = true;
              break;
            }
          }
        }
        blocked[row * cols + col] = isBlocked ? 1 : 0;
      }
    }
    return { cell, cols, rows, blocked };
  }

  function cellToPoint(nav, col, row) {
    return {
      x: world.play.x + (col + 0.5) * nav.cell,
      y: world.play.y + (row + 0.5) * nav.cell,
    };
  }

  function pointToCell(nav, x, y) {
    return {
      col: clamp(Math.floor((x - world.play.x) / nav.cell), 0, nav.cols - 1),
      row: clamp(Math.floor((y - world.play.y) / nav.cell), 0, nav.rows - 1),
    };
  }

  function findNearestOpenCell(nav, col, row) {
    const index = row * nav.cols + col;
    if (nav.blocked[index] === 0) return { col, row };
    for (let radius = 1; radius <= 5; radius += 1) {
      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
          const c = col + dx;
          const r = row + dy;
          if (c < 0 || r < 0 || c >= nav.cols || r >= nav.rows) continue;
          if (nav.blocked[r * nav.cols + c] === 0) return { col: c, row: r };
        }
      }
    }
    return null;
  }

  class MinHeap {
    constructor() {
      this.items = [];
    }

    push(node) {
      this.items.push(node);
      let i = this.items.length - 1;
      while (i > 0) {
        const parent = (i - 1) >> 1;
        if (this.items[parent].f <= this.items[i].f) break;
        [this.items[parent], this.items[i]] = [this.items[i], this.items[parent]];
        i = parent;
      }
    }

    pop() {
      if (this.items.length === 0) return null;
      const top = this.items[0];
      const last = this.items.pop();
      if (this.items.length > 0) {
        this.items[0] = last;
        let i = 0;
        while (true) {
          const left = i * 2 + 1;
          const right = left + 1;
          let smallest = i;
          if (left < this.items.length && this.items[left].f < this.items[smallest].f) smallest = left;
          if (right < this.items.length && this.items[right].f < this.items[smallest].f) smallest = right;
          if (smallest === i) break;
          [this.items[i], this.items[smallest]] = [this.items[smallest], this.items[i]];
          i = smallest;
        }
      }
      return top;
    }

    get size() {
      return this.items.length;
    }
  }

  function findPath(from, to, actorRadius) {
    const nav = buildNavGrid(actorRadius);
    const startRaw = pointToCell(nav, from.x, from.y);
    const goalRaw = pointToCell(nav, to.x, to.y);
    const startCell = findNearestOpenCell(nav, startRaw.col, startRaw.row);
    const goalCell = findNearestOpenCell(nav, goalRaw.col, goalRaw.row);
    if (!startCell || !goalCell) return null;

    const total = nav.cols * nav.rows;
    const startIndex = startCell.row * nav.cols + startCell.col;
    const goalIndex = goalCell.row * nav.cols + goalCell.col;
    if (startIndex === goalIndex) return [{ x: to.x, y: to.y }];

    const gScore = new Float32Array(total);
    gScore.fill(Infinity);
    const fromIndex = new Int32Array(total);
    fromIndex.fill(-1);
    const closed = new Uint8Array(total);
    gScore[startIndex] = 0;

    const heuristic = (col, row) => {
      const dx = Math.abs(col - goalCell.col);
      const dy = Math.abs(row - goalCell.row);
      return (dx + dy) + (Math.SQRT2 - 2) * Math.min(dx, dy);
    };

    const open = new MinHeap();
    open.push({ index: startIndex, f: heuristic(startCell.col, startCell.row) });

    const directions = [
      [-1, 0, 1],
      [1, 0, 1],
      [0, -1, 1],
      [0, 1, 1],
      [-1, -1, Math.SQRT2],
      [1, -1, Math.SQRT2],
      [-1, 1, Math.SQRT2],
      [1, 1, Math.SQRT2],
    ];

    let found = false;
    let iterations = 0;
    while (open.size > 0 && iterations < total * 3) {
      iterations += 1;
      const current = open.pop();
      if (!current) break;
      if (closed[current.index]) continue;
      if (current.index === goalIndex) {
        found = true;
        break;
      }
      closed[current.index] = 1;
      const col = current.index % nav.cols;
      const row = Math.floor(current.index / nav.cols);

      for (const [dx, dy, cost] of directions) {
        const nextCol = col + dx;
        const nextRow = row + dy;
        if (nextCol < 0 || nextRow < 0 || nextCol >= nav.cols || nextRow >= nav.rows) continue;
        const nextIndex = nextRow * nav.cols + nextCol;
        if (closed[nextIndex] || nav.blocked[nextIndex]) continue;

        // Do not cut diagonally through an obstacle corner.
        if (dx !== 0 && dy !== 0) {
          if (nav.blocked[row * nav.cols + nextCol] || nav.blocked[nextRow * nav.cols + col]) continue;
        }

        const tentative = gScore[current.index] + cost;
        if (tentative + 0.0001 < gScore[nextIndex]) {
          gScore[nextIndex] = tentative;
          fromIndex[nextIndex] = current.index;
          open.push({ index: nextIndex, f: tentative + heuristic(nextCol, nextRow) });
        }
      }
    }

    if (!found) return null;

    const rawPath = [];
    let cursor = goalIndex;
    let guard = 0;
    while (cursor !== -1 && guard < total + 2) {
      guard += 1;
      const col = cursor % nav.cols;
      const row = Math.floor(cursor / nav.cols);
      rawPath.push(cellToPoint(nav, col, row));
      if (cursor === startIndex) break;
      cursor = fromIndex[cursor];
    }
    rawPath.reverse();
    const lastCellPoint = rawPath[rawPath.length - 1];
    const exactGoalReachable =
      !pointBlockedForActor(to.x, to.y, actorRadius + 1) &&
      movementLineClear(lastCellPoint.x, lastCellPoint.y, to.x, to.y, actorRadius + 1);
    // Never append an exact target that lies inside a cover/wall margin: the
    // AI would keep walking into it and could stall at a corner.
    if (exactGoalReachable) rawPath.push({ x: to.x, y: to.y });

    // String-pull the grid path into stable, walkable waypoints.
    const points = [{ x: from.x, y: from.y }, ...rawPath];
    const smoothed = [];
    let anchor = 0;
    smoothed.push({ x: from.x, y: from.y });
    while (anchor < points.length - 1) {
      let next = points.length - 1;
      while (
        next > anchor + 1 &&
        !movementLineClear(points[anchor].x, points[anchor].y, points[next].x, points[next].y, actorRadius + 1)
      ) {
        next -= 1;
      }
      if (
        next > anchor &&
        !movementLineClear(points[anchor].x, points[anchor].y, points[next].x, points[next].y, actorRadius + 1)
      ) {
        next = anchor + 1;
      }
      smoothed.push(points[next]);
      anchor = next;
    }
    smoothed.shift();
    return smoothed.filter((point, index, list) => {
      if (index === 0) return true;
      return dist(point.x, point.y, list[index - 1].x, list[index - 1].y) > 3;
    });
  }

  function findCoverSpot(actor) {
    const player = actor === game.player ? game.enemy : game.player;
    const minDim = Math.min(world.arena.w, world.arena.h);
    let best = null;
    let bestScore = Infinity;
    for (const obstacle of world.obstacles) {
      const angleToPlayer = Math.atan2(player.y - obstacle.y, player.x - obstacle.x);
      const base = angleToPlayer + Math.PI;
      for (const offset of [0, -0.38, 0.38, -0.72, 0.72]) {
        const angle = base + offset;
        const distance = obstacle.radius + actor.radius + 20 * world.scale;
        const point = {
          x: obstacle.x + Math.cos(angle) * distance,
          y: obstacle.y + Math.sin(angle) * distance,
        };
        if (
          point.x < world.play.x + actor.radius + 5 ||
          point.x > world.play.x + world.play.w - actor.radius - 5 ||
          point.y < world.play.y + actor.radius + 5 ||
          point.y > world.play.y + world.play.h - actor.radius - 5
        ) {
          continue;
        }
        if (pointBlockedForActor(point.x, point.y, actor.radius + 2)) continue;
        const hides = lineBlockedByObstacle(player.x, player.y, point.x, point.y, 0);
        if (!hides) continue;
        const pathCost = dist(actor.x, actor.y, point.x, point.y);
        const playerDistance = dist(player.x, player.y, point.x, point.y);
        const tooClosePenalty = playerDistance < minDim * 0.22 ? 400 : 0;
        const score = pathCost + tooClosePenalty - Math.min(playerDistance, minDim * 0.5) * 0.15;
        if (score < bestScore) {
          bestScore = score;
          best = point;
        }
      }
    }
    return best;
  }

  function pointBlockedForActor(x, y, radius) {
    if (
      x < world.play.x + radius ||
      x > world.play.x + world.play.w - radius ||
      y < world.play.y + radius ||
      y > world.play.y + world.play.h - radius
    ) {
      return true;
    }
    for (const obstacle of world.obstacles) {
      if (dist(x, y, obstacle.x, obstacle.y) < obstacle.radius + radius + 1.5) return true;
    }
    return false;
  }

  /* =======================================================================
     05. 玩家输入
     ======================================================================= */

  function updatePlayerAim() {
    const player = game.player;
    if (!player) return;
    if (input.hasMouse && game.mode === 'battle') {
      player.aimAngle = Math.atan2(input.mouseY - (player.y - 12 * world.scale), input.mouseX - player.x);
    } else if (game.enemy) {
      player.aimAngle = Math.atan2(
        game.enemy.y - 12 * world.scale - (player.y - 12 * world.scale),
        game.enemy.x - player.x
      );
    }
  }

  function getPlayerAimAngle(autoAim = false) {
    if (autoAim && game.enemy) {
      return Math.atan2(
        game.enemy.y - 12 * world.scale - (game.player.y - 12 * world.scale),
        game.enemy.x - game.player.x
      );
    }
    updatePlayerAim();
    return game.player ? game.player.aimAngle : 0;
  }

  // 近战索敌：对手已经落在可命中的近战范围内时，剑锋自动指向对手，
  // 不再要求鼠标精确对准。命中判定仍会单独检查掩体。
  function getMeleeAimAngleFor(fighter, baseAngle) {
    const opponent = otherFighter(fighter);
    if (!fighter || !opponent || opponent.hp <= 0) return baseAngle;
    const distance = dist(fighter.x, fighter.y, opponent.x, opponent.y);
    if (distance > getMeleeReach(fighter) + opponent.radius * 0.62) {
      fighter.meleeAimAssist = false;
      return baseAngle;
    }
    fighter.meleeAimAssist = true;
    return Math.atan2(opponent.y - fighter.y, opponent.x - fighter.x);
  }

  function getPlayerMeleeAngle(baseAngle) {
    return getMeleeAimAngleFor(game.player, baseAngle);
  }

  function onlineMeleeAimAngle(fighter, baseAngle) {
    return getMeleeAimAngleFor(fighter, baseAngle);
  }

  function playerMelee(autoAim = false) {
    if (isOnlineGuest()) {
      const angle = getGuestAimAngle(autoAim);
      sendGuestAction('melee', angle);
      startGuestMeleePreview(angle);
      return;
    }
    if (!canAct(game.player)) return;
    tryMelee(game.player, getPlayerMeleeAngle(getPlayerAimAngle(autoAim)));
  }

  function startGuestMeleePreview(angle) {
    const local = game.enemy;
    if (
      !isOnlineGuest() ||
      !local ||
      !canAct(local) ||
      local.swing ||
      local.dodgeRemaining > 0 ||
      local.throwRemaining > 0
    ) {
      return;
    }
    const safeAngle = Number.isFinite(angle) ? angle : getGuestAimAngle(true);
    local.facing = safeAngle;
    local.aimAngle = safeAngle;
    local.walkPhase += 0.35;
    local.swing = {
      elapsed: 0,
      duration: CONFIG.meleeDuration,
      hitAt: CONFIG.meleeHitAt,
      resolved: true,
      preview: true,
      startAngle: safeAngle - CONFIG.meleeArc / 2,
      endAngle: safeAngle + CONFIG.meleeArc / 2,
      empowered: false,
      targetAngle: safeAngle,
      clashed: false,
      autoAim: false,
    };
  }

  function guestOrbOrigin() {
    const local = game.enemy;
    if (!local) return null;
    return {
      x: clamp((local.x - world.play.x) / Math.max(1, world.play.w), 0, 1),
      y: clamp((local.y - world.play.y) / Math.max(1, world.play.h), 0, 1),
    };
  }

  function playerOrb(autoAim = false, allowCounter = null) {
    if (isOnlineGuest()) {
      game.online.lastOrbActionAt = performance.now();
      const angle = getGuestAimAngle(autoAim);
      sendGuestAction('orb', angle, { origin: guestOrbOrigin() });
      return;
    }
    if (!canAct(game.player)) return;
    const counterAllowed =
      allowCounter === null ? game.bindings.orb === game.bindings.counter : Boolean(allowCounter);
    // 反制与御灵共用按键时，对方刀光期间优先反制；分开绑定后各司其职。
    if (counterAllowed && tryCounter(game.player)) {
      // 反制这一下不算御灵起手，避免按住右键在锁定结束后自动续射。
      input.orbHeld = false;
      return;
    }
    tryOrb(game.player, getPlayerAimAngle(autoAim));
  }

  function playerDodge() {
    if (isOnlineGuest()) {
      const move = readMovementInput();
      const dx = move.x;
      const dy = move.y;
      const angle = dx !== 0 || dy !== 0 ? Math.atan2(dy, dx) : getGuestAimAngle(true);
      sendGuestAction('dodge', angle);
      return;
    }
    if (!canAct(game.player)) return;
    const move = readMovementInput();
    const dx = move.x;
    const dy = move.y;
    let angle;
    if (dx !== 0 || dy !== 0) {
      angle = Math.atan2(dy, dx);
    } else {
      angle = getPlayerAimAngle(true);
    }
    tryDodge(game.player, angle);
  }

  function readMovementInput() {
    const held = (action) => {
      const code = bindingCode(action);
      return code && input.keys.has(code) ? code : null;
    };
    const pickAxis = (negativeAction, positiveAction) => {
      const negative = held(negativeAction);
      const positive = held(positiveAction);
      if (negative && positive) {
        const negativeTime = input.keyTime[negative] || 0;
        const positiveTime = input.keyTime[positive] || 0;
        // 同时按住相反方向时，以「后按下」的方向为准。
        return positiveTime > negativeTime ? 1 : -1;
      }
      if (positive) return 1;
      if (negative) return -1;
      return 0;
    };
    return {
      x: pickAxis('left', 'right'),
      y: pickAxis('up', 'down'),
    };
  }

  function setOrbSource(source, active) {
    if (active) input.orbSources.add(source);
    else input.orbSources.delete(source);
    input.orbHeld = input.orbSources.size > 0;
  }

  function releaseAllOrbSources() {
    input.orbSources.clear();
    input.orbHeld = false;
  }

  function updatePlayer(dt) {
    const player = game.player;
    if (!player) return;

    if (updateThrow(player, dt)) {
      updatePlayerAim();
      return;
    }

    if (updateBounce(player, dt)) {
      updatePlayerAim();
      return;
    }

    if (updateDodge(player, dt)) {
      updatePlayerAim();
      return;
    }

    if (!canAct(player)) {
      player.moving = false;
      return;
    }

    // 打坐：入定期间不能移动，但仍可出招/出牌。
    if (player.rootTimer > 0) {
      player.moving = false;
      updatePlayerAim();
      player.facing = player.aimAngle;
      if (input.orbHeld) playerOrb(false);
      return;
    }

    const move = readMovementInput();
    const dx = move.x;
    const dy = move.y;

    if (dx !== 0 || dy !== 0) {
      const direction = norm(dx, dy);
      const speed = getMoveSpeed(player);
      const moved = moveFighter(player, direction.x * speed * dt, direction.y * speed * dt);
      player.moving = moved > 0.05;
    } else {
      player.moving = false;
    }

    updatePlayerAim();
    player.facing = player.aimAngle;

    // 按住右键持续御灵（反制优先于发射）。
    if (input.orbHeld) playerOrb(false);
  }

  /* =======================================================================
     06. 敌方 AI
     ======================================================================= */

  function createAI(actor, target) {
    const profile = getPlayerProfile();
    return {
      actor,
      target,
      thinkTimer: 0.08,
      attackDelay: 0.3,
      // AI 手速上限：两张牌之间至少间隔 1.5 秒。
      cardCooldown: 0,
      lastAttackAt: -10,
      lastMeleeAt: -Infinity,
      meleeWaitUntil: 0,
      mode: 'pursue',
      modeLock: 0,
      lastAttackType: null,
      path: null,
      pathIndex: 0,
      pathGoal: null,
      pathAge: 0,
      strafeSign: Math.random() < 0.5 ? -1 : 1,
      strafeTimer: 0,
      hideSpot: null,
      hideTimer: 0,
      approachPoint: null,
      approachPlayerX: 0,
      approachPlayerY: 0,
      approachAge: 0,
      evadeBlockedUntil: 0,
      postDodge: 0,
      lastDodgeAt: -10,
      threatTimer: 0,
      stuckTimer: 0,
      lastX: actor.x,
      lastY: actor.y,
      plannedGoal: null,
      progressTimer: 0,
      progressAnchorX: actor.x,
      progressAnchorY: actor.y,
      progressMode: null,
      recoveryTimer: 0,
      recoveryAngle: 0,
      profile,
      memoryReady: profile.ready,
      memoryBias: profile.ready ? clamp((profile.meleeRatio - 0.5) * 2, -1, 1) : 0,
      parryCooldown: 0,
      lastReason: '观势',
    };
  }

  function distanceBetweenFighters() {
    return dist(game.player.x, game.player.y, game.enemy.x, game.enemy.y);
  }

  function findThreatProjectile(actor, target) {
    let best = null;
    for (const projectile of game.projectiles) {
      if (projectile.dead || projectile.owner === actor.team) continue;
      const toActorX = actor.x - projectile.x;
      const toActorY = actor.y - projectile.y;
      const speedSq = projectile.vx * projectile.vx + projectile.vy * projectile.vy;
      if (speedSq < 1) continue;
      const t = (toActorX * projectile.vx + toActorY * projectile.vy) / speedSq;
      if (t < 0 || t > 0.7) continue;
      const closestX = projectile.x + projectile.vx * t;
      const closestY = projectile.y + projectile.vy * t;
      const missDistance = dist(closestX, closestY, actor.x, actor.y);
      if (missDistance > actor.radius + projectile.radius + 9 * world.scale) continue;
      if (lineBlockedByObstacle(projectile.x, projectile.y, actor.x, actor.y, projectile.radius)) continue;
      const timeToHit = Math.max(0, t);
      if (!best || timeToHit < best.time) {
        best = { projectile, time: timeToHit, distance: dist(projectile.x, projectile.y, actor.x, actor.y) };
      }
    }
    return best;
  }

  function pickDodgeAngle(actor, preferredAngle) {
    const distance = getDashSpeed() * CONFIG.dodgeDuration * 0.9;
    const candidates = [
      preferredAngle,
      preferredAngle + Math.PI / 2,
      preferredAngle - Math.PI / 2,
      preferredAngle + Math.PI,
      preferredAngle + Math.PI * 0.35,
      preferredAngle - Math.PI * 0.35,
    ];
    let best = candidates[0];
    let bestScore = -Infinity;
    for (const angle of candidates) {
      const nx = Math.cos(angle);
      const ny = Math.sin(angle);
      const endX = actor.x + nx * distance;
      const endY = actor.y + ny * distance;
      if (pointBlockedForActor(endX, endY, actor.radius + 2)) continue;
      let score = 0;
      for (const obstacle of world.obstacles) {
        score += Math.min(160, pointToSegmentDistance(obstacle.x, obstacle.y, actor.x, actor.y, endX, endY));
      }
      const playerDistance = dist(game.player.x, game.player.y, endX, endY);
      score += Math.min(100, playerDistance * 0.15);
      if (score > bestScore) {
        bestScore = score;
        best = angle;
      }
    }
    return best;
  }

  function aiTryDodgeFromThreat(threat) {
    const actor = game.enemy;
    if (!threat || actor.dodgeCooldown > 0 || actor.dodgeRemaining > 0) return false;
    const projectile = threat.projectile;
    const travelAngle = Math.atan2(projectile.vy, projectile.vx);
    const side = Math.random() < 0.5 ? 1 : -1;
    const preferred = travelAngle + side * Math.PI / 2;
    const dodgeAngle = pickDodgeAngle(actor, preferred);
    if (tryDodge(actor, dodgeAngle)) {
      game.ai.lastReason = '闪避灵子';
      game.ai.thinkTimer = 0.1;
      return true;
    }
    return false;
  }

  function assessAIThreats() {
    const aiState = game.ai;
    const actor = game.enemy;
    const player = game.player;
    if (!aiState || !actor || !player || actor.hp <= 0) return false;

    const threat = findThreatProjectile(actor, player);
    const distance = distanceBetweenFighters();
    const meleeReach = getMeleeReach(player);
    const playerWinding = Boolean(
      player.swing &&
      !player.swing.resolved &&
      player.swing.elapsed < 0.2 &&
      distance < meleeReach + actor.radius * 2 &&
      hasMeleeLine(player, actor)
    );

    if (threat && threat.time < 0.6) {
      if (actor.dodgeCooldown <= 0 && actor.dodgeRemaining <= 0) {
        const dodgeChance = actor.hp / actor.maxHp > 0.32 ? 0.82 : 0.68;
        if (Math.random() < dodgeChance) {
          if (aiTryDodgeFromThreat(threat)) return true;
        }
      }
    }

    if (playerWinding && actor.dodgeCooldown <= 0 && actor.dodgeRemaining <= 0) {
      const chance = player.hp / player.maxHp < 0.35 ? 0.48 : 0.38;
      if (Math.random() < chance) {
        const away = Math.atan2(actor.y - player.y, actor.x - player.x);
        const angle = pickDodgeAngle(actor, away);
        if (tryDodge(actor, angle)) {
          aiState.lastReason = '闪避近战';
          return true;
        }
      }
    }

    return false;
  }

  function aiGetOrChooseCoverSpot(actor) {
    const aiState = game.ai;
    const player = game.player;
    if (!aiState || !actor || !player) return null;
    const current = aiState.hideSpot;
    const currentUsable =
      current &&
      !pointBlockedForActor(current.x, current.y, actor.radius + 2) &&
      lineBlockedByObstacle(player.x, player.y, current.x, current.y, 0);
    if (currentUsable) return current;
    aiState.hideSpot = findCoverSpot(actor);
    return aiState.hideSpot;
  }

  function aiHandleExhaustion() {
    // 灵力枯竭已不再有任何负面效果，AI 也不需要专门退避。
    return false;
  }

  // AI 是否可以真正砍中：必须落在命中距离内、有近战线、且对手不在无敌闪避中。
  // 留一点余量，避免出剑的 75ms 前摇里对手走开导致空挥。
  function aiCanHitWithMelee() {
    const actor = game.enemy;
    const player = game.player;
    if (!actor || !player || player.hp <= 0) return false;
    if (player.invuln > 0) return false;
    const hitRange = getMeleeReach(actor) + player.radius * 0.62;
    return distanceBetweenFighters() <= hitRange - 6 * world.scale && hasMeleeLine(actor, player);
  }

  function aiMeleeGateReady() {
    const aiState = game.ai;
    if (!aiState || !Number.isFinite(aiState.lastMeleeAt)) return true;
    return game.battleTime - aiState.lastMeleeAt >= CONFIG.aiMeleeAttackInterval;
  }

  function aiWaitForMelee() {
    const aiState = game.ai;
    if (!aiState) return;
    aiState.meleeWaitUntil =
      (Number.isFinite(aiState.lastMeleeAt) ? aiState.lastMeleeAt : game.battleTime) +
      CONFIG.aiMeleeAttackInterval;
    aiState.mode = 'pursue';
    aiState.lastReason = '等待出剑';
    aiState.modeLock = 0.12;
  }

  function aiTryCloseAttack(inMelee, meleeLOS, shotLOS) {
    const actor = game.enemy;
    const player = game.player;
    const aiState = game.ai;
    if (!actor || !player) return false;
    if (aiState.attackDelay > 0) return false;

    // This routine is for close-quarters exchanges only. Long-range orb
    // decisions live in aiTryRangedAttack so the AI closes instead of kiting.
    const distance = distanceBetweenFighters();
    if (distance > getMeleeReach(actor) * 1.8) return false;

    // Re-check the current lines immediately before committing spirit power.
    const liveMeleeLOS = hasMeleeLine(actor, player);
    const liveShotLOS = hasProjectileLine(actor, player);
    const meleeCost = getMeleeCost(actor);
    const canMelee =
      liveMeleeLOS && meleeLOS && inMelee && actor.meleeCooldown <= 0 && canSpend(actor, meleeCost) && aiCanHitWithMelee();
    const atRefreshCap = actor.rangedCombo >= CONFIG.orbRefreshCombo;
    const canOrb = liveShotLOS && shotLOS && actor.orbCooldown <= 0 && !atRefreshCap;
    const angle = Math.atan2(player.y - 12 * world.scale - (actor.y - 12 * world.scale), player.x - actor.x);

    // 已决定近战但 1 秒间隔未到：原地等待，期间不御灵。
    if (canMelee && !aiMeleeGateReady()) {
      aiWaitForMelee();
      return true;
    }

    if (canMelee || canOrb) {
      let chooseMelee;
      if (canMelee && canOrb) {
        let meleeWeight = aiState.lastAttackType === 'melee' ? 0.44 : 0.58;
        let orbWeight = aiState.lastAttackType === 'orb' ? 0.48 : 0.7;

        if (aiState.memoryReady) {
          meleeWeight += Math.max(0, aiState.memoryBias) * 0.18;
          orbWeight += Math.max(0, -aiState.memoryBias) * 0.16;
        }
        if (actor.rangedCombo >= 3) meleeWeight += 0.1;
        if (actor.meleeCombo >= 2) orbWeight += 0.16;
        if (player.hp / player.maxHp < 0.3) meleeWeight += 0.1;
        const total = meleeWeight + orbWeight;
        chooseMelee = Math.random() < meleeWeight / total;
      } else {
        chooseMelee = canMelee;
      }

      if (chooseMelee && canMelee) {
        if (tryMelee(actor, angle)) {
          aiState.lastAttackType = 'melee';
          aiState.attackDelay = 0.15 + Math.random() * 0.16;
          aiState.lastReason = '近身换招';
          return true;
        }
      } else if (canOrb) {
        if (tryOrb(actor, angle)) {
          aiState.lastAttackType = 'orb';
          aiState.attackDelay = 0.2 + Math.random() * 0.16;
          aiState.lastReason = '御灵试探';
          return true;
        }
      }
    }
    return false;
  }

  function aiTryRangedAttack(shotLOS) {
    const actor = game.enemy;
    const player = game.player;
    const aiState = game.ai;
    if (!actor || !player || !shotLOS) return false;
    if (!hasProjectileLine(actor, player)) return false;
    if (aiState.attackDelay > 0) return false;
    if (actor.rangedCombo >= CONFIG.orbRefreshCombo) return false;
    if (actor.orbCooldown > 0) return false;
    const distance = distanceBetweenFighters();
    // 近战等待期间不御灵（玩家拉开距离后解除）。
    if (
      aiState.meleeWaitUntil > 0 &&
      game.battleTime < aiState.meleeWaitUntil &&
      distance <= getMeleeReach(actor) * 1.9 + player.radius
    ) {
      return false;
    }
    const playerHpRatio = player.hp / player.maxHp;
    let chance = aiState.lastAttackType === 'orb' ? 0.64 : 0.84;
    if (actor.rangedCombo < CONFIG.orbFreeShots) chance += 0.08;
    if (aiState.memoryReady) chance += Math.max(0, -aiState.memoryBias) * 0.1;
    if (playerHpRatio < 0.35) chance += 0.1;
    if (player.dodgeCooldown > 0) chance += 0.06;
    if (distance > 340 * world.scale) chance += 0.04;
    if (Math.random() > Math.min(0.96, chance)) return false;

    const angle = Math.atan2(
      player.y - 12 * world.scale - (actor.y - 12 * world.scale),
      player.x - actor.x
    );
    if (tryOrb(actor, angle)) {
      aiState.lastAttackType = 'orb';
      aiState.attackDelay = 0.17 + Math.random() * 0.15;
      aiState.lastReason = actor.rangedCombo <= CONFIG.orbFreeShots ? '免灵连发' : '灵子压阵';
      return true;
    }
    return false;
  }

  function aiHandleOrbRefresh(shotLOS, meleeLOS, inMelee) {
    const actor = game.enemy;
    const player = game.player;
    const aiState = game.ai;
    if (!actor || !player || !aiState) return false;
    if (actor.rangedCombo < CONFIG.orbRefreshCombo) return false;

    const distance = distanceBetweenFighters();
    const meleeCost = getMeleeCost(actor);
    const liveMeleeLOS = meleeLOS && hasMeleeLine(actor, player);
    const angle = Math.atan2(
      player.y - 12 * world.scale - (actor.y - 12 * world.scale),
      player.x - actor.x
    );
    const inMeleeNow = inMelee && liveMeleeLOS;

    // Step 1: if the sword can actually reach the player, refresh with it.
    if (inMeleeNow) {
      if (!aiMeleeGateReady()) {
        aiWaitForMelee();
        return true;
      }
      if (aiCanHitWithMelee() && actor.meleeCooldown <= 0 && aiState.attackDelay <= 0 && canSpend(actor, meleeCost)) {
        if (tryMelee(actor, angle)) {
          aiState.lastAttackType = 'melee';
          aiState.attackDelay = 0.14 + Math.random() * 0.1;
          aiState.lastReason = '四连灵子 · 挥剑清势';
          return true;
        }
      }
      // 剑还没好：贴住对手等下一次出手，而不是绕圈拖时间。
      aiState.mode = Math.random() < 0.2 ? 'strafe' : 'pursue';
      aiState.lastReason = '观势 · 待剑清灵';
      aiState.modeLock = 0.2;
      return true;
    }

    // Step 2: 剑够不到就不要空挥；贴上去，等真正进入命中距离再用剑清连击。

    // Step 3: 连击已满时不能靠游斗拖时间——游斗会一直拉距离，永远回不到
    // 近战清连击。这里直接贴近，到近身再由 Step 1 出剑重置。
    aiState.mode = distance > getMeleeReach(actor) * 1.2 ? 'pursue' : 'strafe';
    aiState.lastReason = '观势 · 见机清灵';
    aiState.modeLock = 0.3;
    return true;
  }

  function aiChooseMode() {
    const actor = game.enemy;
    const player = game.player;
    const aiState = game.ai;
    if (!actor || !player || !aiState) return;

    const distance = distanceBetweenFighters();
    const meleeReach = getMeleeReach(actor);
    const shotLOS = hasProjectileLine(actor, player);
    const meleeLOS = hasMeleeLine(actor, player);
    const inMelee = distance <= meleeReach * 1.015 + player.radius * 0.35 && meleeLOS;
    const hpRatio = actor.hp / actor.maxHp;
    const playerHpRatio = player.hp / player.maxHp;
    const manaRatio = actor.mana / actor.maxMana;
    const playerManaRatio = player.mana / player.maxMana;
    const advantage = hpRatio - playerHpRatio + (manaRatio - playerManaRatio) * 0.35;
    const behindCover = !shotLOS;
    const lowMana = actor.mana < 30;
    const lowHp = hpRatio < 0.42;
    const defensiveMode = aiState.mode === 'hide' || aiState.mode === 'evade';
    const pressureThreshold = Math.max(185 * world.scale, meleeReach * 1.65);
    // Hysteresis: once retreating, keep more distance before re-engaging.
    const pressured = distance < pressureThreshold * (aiState.mode === 'evade' ? 1.3 : 1);

    // A short side-step recovery takes priority after a genuine no-progress
    // detection, then normal planning resumes.
    if (aiState.recoveryTimer > 0) return;

    // Do not redraw a defensive plan every tick. Hide/evade commitments stop
    // the visible forward-backward jitter at range boundaries.
    if (aiState.modeLock > 0 && defensiveMode) return;

    if (aiHandleExhaustion()) return;

    // Seeking cover is only useful when there is still spirit to restore.
    // At high mana a wounded AI should keep moving defensively instead of
    // repeatedly running to cover and sitting back down.
    if (
      lowHp &&
      actor.mana < 70 &&
      distance < 245 * world.scale
    ) {
      const cover = aiGetOrChooseCoverSpot(actor);
      if (cover && dist(actor.x, actor.y, cover.x, cover.y) > 18 * world.scale) {
        aiState.mode = 'hide';
        aiState.hideTimer = 2.2;
        aiState.lastReason = '负伤退守';
        aiState.modeLock = 1.8;
        return;
      }
    }

    if (aiHandleOrbRefresh(shotLOS, meleeLOS, inMelee)) return;

    if (aiTryCloseAttack(inMelee, meleeLOS, shotLOS)) {
      if (aiState.mode !== 'pursue') aiState.mode = 'attack';
      aiState.modeLock = 0.2;
      return;
    }

    const shouldPunish = playerHpRatio < 0.3 && distance > meleeReach * 2.2;
    if (shouldPunish) {
      aiState.mode = 'pursue';
      aiState.lastReason = '乘势逼近';
      aiState.modeLock = 0.25;
      return;
    }

    if (aiTryRangedAttack(shotLOS)) {
      aiState.mode = distance > meleeReach * 2 ? 'strafe' : 'pursue';
      aiState.modeLock = 0.25;
      return;
    }

    if (!shotLOS && !meleeLOS) {
      aiState.mode = 'pursue';
      aiState.lastReason = '绕行掩体';
      aiState.modeLock = 0.35;
      return;
    }

    if (
      lowMana &&
      game.battleTime >= aiState.evadeBlockedUntil &&
      (pressured || distance < 300 * world.scale)
    ) {
      aiState.mode = 'evade';
      aiState.lastReason = '节约灵力';
      aiState.modeLock = 1.1;
      return;
    }

    if (
      lowHp &&
      game.battleTime >= aiState.evadeBlockedUntil &&
      (pressured || (advantage < -0.15 && distance < 300 * world.scale))
    ) {
      aiState.mode = 'evade';
      aiState.lastReason = '游斗避锋';
      aiState.modeLock = 1.3;
      return;
    }

    if (advantage > 0.28 || playerHpRatio < 0.32) {
      aiState.mode = 'pursue';
      aiState.lastReason = '乘势压近';
      aiState.strafeTimer = 0;
      return;
    }

    if (inMelee) {
      // 近身时减少绕圈：大部分时间正面贴身压迫，只偶尔小侧步找角度。
      const justSwung = game.battleTime - aiState.lastAttackAt < 0.6;
      if (!justSwung && Math.random() < 0.22) {
        aiState.mode = 'strafe';
        aiState.lastReason = '侧步找角';
        aiState.modeLock = 0.3;
        aiState.strafeTimer -= 0.12;
        if (aiState.strafeTimer <= 0) {
          aiState.strafeTimer = 1.2 + Math.random() * 0.9;
          aiState.strafeSign *= -1;
        }
      } else {
        aiState.mode = 'pursue';
        aiState.lastReason = '贴身压迫';
        aiState.modeLock = 0.22;
      }
      return;
    }

    aiState.mode = 'pursue';
    aiState.lastReason = actor.meleeCombo < 2 ? '低连击贴近' : '寻机近身';
  }

  function getAIHidingSpot() {
    const aiState = game.ai;
    const actor = game.enemy;
    if (!aiState || !actor) return null;
    if (!aiState.hideSpot || aiState.hideTimer <= 0) {
      if (actor.mana < 44) {
        aiState.hideSpot = findCoverSpot(actor);
        aiState.hideTimer = 3.2;
      }
    }
    if (aiState.hideSpot) {
      const player = game.player;
      const hides = lineBlockedByObstacle(player.x, player.y, aiState.hideSpot.x, aiState.hideSpot.y, 0);
      if (!hides && dist(actor.x, actor.y, aiState.hideSpot.x, aiState.hideSpot.y) > 70 * world.scale) {
        return null;
      }
    }
    return aiState.hideSpot;
  }

  function updateAIPath(targetPoint) {
    const actor = game.enemy;
    const aiState = game.ai;
    if (!actor || !aiState || !targetPoint) return null;

    const radius = actor.radius;
    const directClear = movementLineClear(actor.x, actor.y, targetPoint.x, targetPoint.y, radius + 2);

    aiState.pathAge += STEP;
    if (directClear) {
      aiState.path = null;
      aiState.pathGoal = { ...targetPoint };
      return targetPoint;
    }

    const goalMoved = !aiState.pathGoal || dist(aiState.pathGoal.x, aiState.pathGoal.y, targetPoint.x, targetPoint.y) > 55 * world.scale;
    const pathInvalid =
      !aiState.path ||
      aiState.pathIndex >= aiState.path.length ||
      aiState.pathAge > 2.4 ||
      (goalMoved && aiState.pathAge > 0.55);

    if (pathInvalid) {
      aiState.path = findPath(actor, targetPoint, actor.radius);
      aiState.pathIndex = 0;
      aiState.pathGoal = { ...targetPoint };
      aiState.pathAge = 0;
      if (aiState.path && aiState.path.length > 0) {
        const first = aiState.path[0];
        if (dist(actor.x, actor.y, first.x, first.y) < 5 * world.scale) aiState.pathIndex += 1;
      }
    }

    if (!aiState.path || aiState.path.length === 0) return targetPoint;

    while (aiState.pathIndex < aiState.path.length) {
      const waypoint = aiState.path[aiState.pathIndex];
      if (dist(actor.x, actor.y, waypoint.x, waypoint.y) < Math.max(10, 12 * world.scale)) {
        aiState.pathIndex += 1;
      } else {
        break;
      }
    }

    if (aiState.pathIndex >= aiState.path.length) {
      aiState.path = null;
      return targetPoint;
    }

    const waypoint = aiState.path[aiState.pathIndex];
    if (!movementLineClear(actor.x, actor.y, waypoint.x, waypoint.y, radius + 0.5)) {
      aiState.path = findPath(actor, targetPoint, actor.radius);
      aiState.pathIndex = 0;
      aiState.pathAge = 0;
      aiState.pathGoal = { ...targetPoint };
      return aiState.path && aiState.path[0] ? aiState.path[0] : targetPoint;
    }
    return waypoint;
  }

  function boundaryClearance(x, y, radius) {
    return Math.min(
      x - (world.play.x + radius),
      world.play.x + world.play.w - radius - x,
      y - (world.play.y + radius),
      world.play.y + world.play.h - radius - y
    );
  }

  function aiPickApproachPoint(actor, player) {
    const reach = getMeleeReach(actor);
    const desired = Math.max(
      actor.radius + player.radius + 9 * world.scale,
      Math.min(reach * 0.84, reach - 8 * world.scale)
    );
    const base = Math.atan2(actor.y - player.y, actor.x - player.x);
    const offsets = [0, 0.32, -0.32, 0.62, -0.62, 0.92, -0.92, 1.25, -1.25, 1.6, -1.6, Math.PI];
    let best = null;
    let bestScore = Infinity;
    for (const offset of offsets) {
      const angle = base + offset;
      const x = player.x + Math.cos(angle) * desired;
      const y = player.y + Math.sin(angle) * desired;
      if (pointBlockedForActor(x, y, actor.radius + 3)) continue;
      if (lineBlockedByObstacle(x, y, player.x, player.y, 1.5 * world.scale)) continue;
      const pathHint = dist(actor.x, actor.y, x, y);
      const edge = boundaryClearance(x, y, actor.radius + 3);
      const edgePenalty = edge < 45 * world.scale ? (45 * world.scale - edge) * 1.8 : 0;
      const score = pathHint + Math.abs(offset) * reach * 0.18 + edgePenalty;
      if (score < bestScore) {
        bestScore = score;
        best = { x, y };
      }
    }
    return best;
  }

  function aiGetPursuitTarget(actor, player) {
    const aiState = game.ai;
    const direct = movementLineClear(actor.x, actor.y, player.x, player.y, actor.radius + 2);
    if (direct) {
      aiState.approachPoint = null;
      aiState.approachAge = 0;
      return { x: player.x, y: player.y, approach: false };
    }

    const cached = aiState.approachPoint;
    const stale =
      !cached ||
      aiState.approachAge > 2 ||
      dist(aiState.approachPlayerX, aiState.approachPlayerY, player.x, player.y) > 35 * world.scale ||
      pointBlockedForActor(cached.x, cached.y, actor.radius + 2) ||
      lineBlockedByObstacle(cached.x, cached.y, player.x, player.y, 1.5 * world.scale);

    if (stale) {
      aiState.approachPoint = aiPickApproachPoint(actor, player);
      aiState.approachAge = 0;
      aiState.approachPlayerX = player.x;
      aiState.approachPlayerY = player.y;
    }

    if (aiState.approachPoint) {
      return { x: aiState.approachPoint.x, y: aiState.approachPoint.y, approach: true };
    }
    return { x: player.x, y: player.y, approach: false };
  }

  function aiFindEvadeTarget(actor, player) {
    const aiState = game.ai;
    const base = Math.atan2(actor.y - player.y, actor.x - player.x);
    const side = aiState.strafeSign || 1;
    const offsets = [
      0,
      0.34 * side,
      -0.34 * side,
      0.68 * side,
      -0.68 * side,
      1.02 * side,
      -1.02 * side,
      1.36 * side,
      -1.36 * side,
      Math.PI / 2,
      -Math.PI / 2,
    ];
    const radii = [230 * world.scale, 175 * world.scale, 125 * world.scale, 75 * world.scale];
    let best = null;
    let bestScore = -Infinity;
    for (const radius of radii) {
      for (const offset of offsets) {
        const angle = base + offset;
        const x = actor.x + Math.cos(angle) * radius;
        const y = actor.y + Math.sin(angle) * radius;
        if (pointBlockedForActor(x, y, actor.radius + 3)) continue;
        if (!movementLineClear(actor.x, actor.y, x, y, actor.radius + 1)) continue;
        const escape = dist(x, y, player.x, player.y);
        const awayDot = (Math.cos(angle) * (actor.x - player.x) + Math.sin(angle) * (actor.y - player.y)) /
          Math.max(1, dist(actor.x, actor.y, player.x, player.y));
        const boundary = boundaryClearance(x, y, actor.radius + 3);
        const boundaryPenalty = boundary < 35 * world.scale ? (35 * world.scale - boundary) * 1.2 : 0;
        const score = escape * 0.7 + radius * 0.18 + awayDot * 30 + (offset * side > 0 ? 5 : 0) - boundaryPenalty;
        if (score > bestScore) {
          bestScore = score;
          best = { x, y };
        }
      }
    }
    return best;
  }

  function aiMove(dt) {
    const actor = game.enemy;
    const player = game.player;
    const aiState = game.ai;
    if (!actor || !player || !aiState || !canAct(actor)) {
      actor.moving = false;
      return;
    }
    // 打坐期间 AI 也不能移动（但仍可出招/出牌）。
    if (actor.rootTimer > 0) {
      actor.moving = false;
      return;
    }
    if (actor.dodgeRemaining > 0) {
      updateDodge(actor, dt);
      return;
    }

    if (aiState.recoveryTimer > 0) {
      aiState.recoveryTimer = Math.max(0, aiState.recoveryTimer - dt);
      const speed = getMoveSpeed(actor);
      const moved = moveFighter(
        actor,
        Math.cos(aiState.recoveryAngle) * speed * dt,
        Math.sin(aiState.recoveryAngle) * speed * dt
      );
      actor.moving = moved > 0.02;
      actor.facing = aiState.recoveryAngle;
      if (moved <= 0.02) aiState.recoveryTimer = 0;
      return;
    }

    const distance = distanceBetweenFighters();
    const reach = getMeleeReach(actor);
    let target = null;
    let stopDistance = 0;

    if (aiState.mode === 'hide') {
      const spot = getAIHidingSpot();
      if (spot) {
        target = spot;
        stopDistance = 9 * world.scale;
        const behindCover = !hasProjectileLine(player, actor);
        if (dist(actor.x, actor.y, spot.x, spot.y) < 18 * world.scale && behindCover) {
          actor.moving = false;
          return;
        }
      } else {
        aiState.mode = 'evade';
      }
    }

    if (aiState.mode === 'evade') {
      target = aiFindEvadeTarget(actor, player);
      stopDistance = 10 * world.scale;
      if (!target) {
        // No safe escape lane (usually a corner). Break the flee lock and
        // face the threat instead of vibrating against the wall.
        aiState.evadeBlockedUntil = game.battleTime + 1.2;
        aiState.mode = 'pursue';
        aiState.modeLock = 0.35;
        target = { x: player.x, y: player.y };
        stopDistance = Math.max(actor.radius + player.radius + 4 * world.scale, reach * 0.76);
      }
    } else if (aiState.mode === 'hide') {
      // Keep the cover target selected above; do not fall through to the
      // default pursue-player target.
      if (!target) {
        actor.moving = false;
        return;
      }
    } else if (aiState.mode === 'strafe') {
      const side = aiState.strafeSign;
      const perp = Math.atan2(player.y - actor.y, player.x - actor.x) + (Math.PI / 2) * side;
      target = {
        x: player.x + Math.cos(perp) * Math.max(reach * 0.52, 50 * world.scale),
        y: player.y + Math.sin(perp) * Math.max(reach * 0.52, 50 * world.scale),
      };
      target.x = clamp(target.x, world.play.x + actor.radius, world.play.x + world.play.w - actor.radius);
      target.y = clamp(target.y, world.play.y + actor.radius, world.play.y + world.play.h - actor.radius);
      stopDistance = 6 * world.scale;
    } else {
      const pursuit = aiGetPursuitTarget(actor, player);
      target = { x: pursuit.x, y: pursuit.y };
      stopDistance = pursuit.approach
        ? 6 * world.scale
        : Math.max(actor.radius + player.radius + 4 * world.scale, reach * 0.76);
    }

    if (!target) {
      actor.moving = false;
      return;
    }
    aiState.debugTarget = {
      mode: aiState.mode,
      x: Number(target.x.toFixed(1)),
      y: Number(target.y.toFixed(1)),
    };

    const distanceToTarget = dist(actor.x, actor.y, target.x, target.y);
    if (distanceToTarget <= stopDistance && (aiState.mode === 'pursue' || aiState.mode === 'attack')) {
      actor.moving = false;
      return;
    }

    let steer;
    if (aiState.mode === 'pursue' || aiState.mode === 'attack') {
      const direct = movementLineClear(actor.x, actor.y, target.x, target.y, actor.radius + 2);
      steer = direct ? target : updateAIPath(target);
    } else {
      const direct = movementLineClear(actor.x, actor.y, target.x, target.y, actor.radius + 2);
      steer = direct ? target : updateAIPath(target);
    }

    if (!steer) {
      actor.moving = false;
      return;
    }

    const toTarget = norm(steer.x - actor.x, steer.y - actor.y);
    if (Math.hypot(steer.x - actor.x, steer.y - actor.y) < 3) {
      actor.moving = false;
      return;
    }

    const speed = getMoveSpeed(actor);
    const desiredMove = speed * dt;
    const moved = moveFighter(actor, toTarget.x * desiredMove, toTarget.y * desiredMove);
    if (moved > 0.02) {
      actor.moving = true;
    } else {
      actor.moving = false;
      aiState.stuckTimer += dt;
      if (aiState.stuckTimer > 0.22) {
        aiState.path = null;
        aiState.strafeSign *= -1;
        aiState.stuckTimer = 0;
      }
    }
    actor.facing = Math.atan2(steer.y - actor.y, steer.x - actor.x);

    // Net-progress watchdog. This catches the rare case where the AI keeps
    // changing modes or sliding against a wall/cover but stays in one place.
    const tractableModes = aiState.mode === 'pursue' || aiState.mode === 'hide' || aiState.mode === 'evade' || aiState.mode === 'strafe';
    if (!tractableModes) {
      aiState.progressTimer = 0;
      aiState.progressMode = aiState.mode;
      aiState.progressAnchorX = actor.x;
      aiState.progressAnchorY = actor.y;
      return;
    }
    if (aiState.progressMode !== aiState.mode) {
      aiState.progressMode = aiState.mode;
      aiState.progressTimer = 0;
      aiState.progressAnchorX = actor.x;
      aiState.progressAnchorY = actor.y;
    } else {
      aiState.progressTimer += dt;
    }
    const targetDistance = target ? dist(actor.x, actor.y, target.x, target.y) : 0;
    const shouldMakeProgress = target && targetDistance > Math.max(stopDistance + 5 * world.scale, 14 * world.scale);
    if (aiState.progressTimer >= 0.9) {
      const netProgress = dist(actor.x, actor.y, aiState.progressAnchorX, aiState.progressAnchorY);
      if (shouldMakeProgress && netProgress < Math.max(7, 9 * world.scale)) {
        aiState.path = null;
        aiState.hideSpot = null;
        aiState.strafeSign *= -1;
        aiState.modeLock = 0;
        aiState.recoveryTimer = 0.55;
        const awayAngle = Math.atan2(target.y - actor.y, target.x - actor.x);
        const options = [awayAngle + Math.PI / 2, awayAngle - Math.PI / 2, awayAngle + Math.PI];
        aiState.recoveryAngle = options[0];
        for (const angle of options) {
          const px = actor.x + Math.cos(angle) * 55 * world.scale;
          const py = actor.y + Math.sin(angle) * 55 * world.scale;
          if (!pointBlockedForActor(px, py, actor.radius + 2)) {
            aiState.recoveryAngle = angle;
            break;
          }
        }
        aiState.lastReason = '脱困侧移';
      }
      aiState.progressTimer = 0;
      aiState.progressAnchorX = actor.x;
      aiState.progressAnchorY = actor.y;
    }
  }

  // AI 出牌策略：按局势从手牌里挑一张最合适的。
  function aiCardPlan() {
    const actor = game.enemy;
    const player = game.player;
    const state = game.enemyCards;
    if (!actor || !player || !state) return null;
    const hand = state.hand;
    const distance = distanceBetweenFighters();
    const hpRatio = actor.hp / actor.maxHp;
    const find = (id) => {
      if (hand.indexOf(id) < 0) return null;
      if (id === 'heal' && actor.healUses >= CONFIG.healUsesPerMatch) return null;
      const card = cardById(id);
      return card && actor.essence >= card.cost ? card : null;
    };
    const pointAt = (x, y) => ({
      x: clamp(x, world.play.x, world.play.x + world.play.w),
      y: clamp(y, world.play.y, world.play.y + world.play.h),
    });

    const heal = find('heal');
    if (heal && hpRatio < 0.55 && actor.healRemaining <= 0) {
      return { card: heal, point: { x: actor.x, y: actor.y } };
    }
    const hammer = find('hammer');
    if (hammer && player.stunRemaining <= 0) {
      return { card: hammer, point: { x: player.x, y: player.y } };
    }
    const blood = find('blood');
    if (blood && distance < 300 * world.scale && actor.damageBoostTimer <= 0 && hpRatio > 0.3) {
      return { card: blood, point: { x: actor.x, y: actor.y } };
    }
    const steal = find('steal') || find('stealPlus');
    if (steal && hasStealableBuff(player)) {
      return { card: steal, point: { x: actor.x, y: actor.y } };
    }
    const sword = find('greatsword');
    if (sword && distance < 460 * world.scale) {
      return { card: sword, point: pointAt(player.x, player.y) };
    }
    const blink = find('blink');
    if (blink) {
      if (hpRatio < 0.4 && distance < 240 * world.scale) {
        const away = Math.atan2(actor.y - player.y, actor.x - player.x);
        return {
          card: blink,
          point: pointAt(
            actor.x + Math.cos(away) * 300 * world.scale,
            actor.y + Math.sin(away) * 300 * world.scale
          ),
        };
      }
      if (distance > 420 * world.scale) {
        const toward = Math.atan2(player.y - actor.y, player.x - actor.x);
        return {
          card: blink,
          point: pointAt(
            actor.x + Math.cos(toward) * 260 * world.scale,
            actor.y + Math.sin(toward) * 260 * world.scale
          ),
        };
      }
    }
    const wind = find('wind');
    if (wind && distance > 260 * world.scale && actor.speedBoostTimer <= 0) {
      return { card: wind, point: { x: actor.x, y: actor.y } };
    }
    const stillness = find('stillness');
    if (
      stillness &&
      distance > 420 * world.scale &&
      !(player.swing && !player.swing.resolved) &&
      !findThreatProjectile(actor, player)
    ) {
      return { card: stillness, point: { x: actor.x, y: actor.y } };
    }
    const gold = find('goldfinger');
    if (gold && actor.essence >= 7) {
      return { card: gold, point: { x: actor.x, y: actor.y } };
    }
    return null;
  }

  function aiTryPlayCard() {
    const aiState = game.ai;
    const actor = game.enemy;
    if (!aiState || !actor || !canUseCards(actor) || aiState.cardCooldown > 0) return false;
    const plan = aiCardPlan();
    if (!plan) return false;
    if (!playCard(actor, plan.card, plan.point)) return false;
    // AI 手速上限：1.5 秒内最多打出一张牌。
    aiState.cardCooldown = 1.5;
    aiState.lastReason = `施放${plan.card.name}`;
    aiState.modeLock = Math.max(aiState.modeLock, 0.3);
    return true;
  }

  function updateAI(dt) {
    const actor = game.enemy;
    const player = game.player;
    const aiState = game.ai;
    if (!actor || !player || !aiState) return;

    if (updateThrow(actor, dt)) {
      actor.aimAngle = Math.atan2(player.y - actor.y, player.x - actor.x);
      return;
    }

    if (game.debugFreezeAI) {
      actor.moving = false;
      return;
    }

    aiState.thinkTimer -= dt;
    aiState.attackDelay = Math.max(0, aiState.attackDelay - dt);
    aiState.cardCooldown = Math.max(0, aiState.cardCooldown - dt);
    aiState.strafeTimer -= dt;
    aiState.hideTimer -= dt;
    aiState.approachAge += dt;
    aiState.postDodge = Math.max(0, aiState.postDodge - dt);
    aiState.pathAge += dt * 0.2;
    aiState.threatTimer -= dt;
    aiState.modeLock = Math.max(0, aiState.modeLock - dt);

    if (!canAct(actor)) {
      actor.moving = false;
      // 眩晕时仍然可以出牌。
      if (actor.stunRemaining > 0) {
        aiTryPlayCard();
      }
      return;
    }

    if (updateBounce(actor, dt)) {
      actor.aimAngle = Math.atan2(player.y - actor.y, player.x - actor.x);
      return;
    }

    if (actor.dodgeRemaining > 0) {
      updateDodge(actor, dt);
      return;
    }

    // AI 也会反制：玩家刀光出现时立刻尝试抓取（不再有概率降智）。
    const incomingSwing = player.swing;
    if (incomingSwing && !incomingSwing.aiCounterChecked && incomingSwing.elapsed < 0.2) {
      incomingSwing.aiCounterChecked = true;
      if (tryCounter(actor)) {
        aiState.lastReason = '反制';
        aiState.modeLock = 0.5;
        return;
      }
    }

    if (aiState.threatTimer <= 0) {
      aiState.threatTimer = 0.055 + Math.random() * 0.025;
      if (assessAIThreats()) return;
    }

    // AI 也会根据局势出牌。
    if (aiTryPlayCard()) return;

    if (aiState.thinkTimer <= 0) {
      aiState.thinkTimer = 0.1 + Math.random() * 0.06;
      aiChooseMode();
    }

    aiMove(dt);
    actor.aimAngle = Math.atan2(
      player.y - 12 * world.scale - (actor.y - 12 * world.scale),
      player.x - actor.x
    );
    actor.facing = actor.aimAngle;
  }

  /* =======================================================================
     07. 固定步长战斗循环
     ======================================================================= */

  function tickTimers(dt) {
    for (const fighter of [game.player, game.enemy]) {
      if (!fighter) continue;
      fighter.meleeCooldown = Math.max(0, fighter.meleeCooldown - dt);
      fighter.orbCooldown = Math.max(0, fighter.orbCooldown - dt);
      fighter.regenBlocked = Math.max(0, fighter.regenBlocked - dt);
      if (Array.isArray(fighter.stealPlusTimers) && fighter.stealPlusTimers.length > 0) {
        for (const timer of fighter.stealPlusTimers) timer.remaining -= dt;
        const expired = fighter.stealPlusTimers.filter((timer) => timer.remaining <= 0);
        for (const timer of expired) expireStealPlus(fighter, timer.slot);
      }
      fighter.speedBoostTimer = Math.max(0, fighter.speedBoostTimer - dt);
      fighter.damageBoostTimer = Math.max(0, fighter.damageBoostTimer - dt);
      fighter.stunRemaining = Math.max(0, fighter.stunRemaining - dt);
      fighter.meditationTimer = Math.max(0, fighter.meditationTimer - dt);
      if (fighter.rootTimer > 0) {
        fighter.rootTimer = Math.max(0, fighter.rootTimer - dt);
        if (fighter.rootTimer <= 0 && fighter.rootReward) {
          fighter.rootReward = false;
          fighter.essence = Math.min(CONFIG.essenceMax, fighter.essence + CONFIG.rootReward);
          spawnFloater(fighter.x, fighter.y - 58 * world.scale, `+${CONFIG.rootReward} 精魄`, '#ffe6a8', 0.9, 14);
          spawnRipple(fighter.x, fighter.y, '#9fb6d8', 0.5, fighter.radius * 2);
        }
      }
      // 闪避冷却：只有一次，用完后 2 秒转好。
      fighter.dodgeCooldown = Math.max(0, fighter.dodgeCooldown - dt);
      fighter.counterCooldown = Math.max(0, fighter.counterCooldown - dt);
      fighter.counterOrbLock = Math.max(0, fighter.counterOrbLock - dt);
      fighter.invuln = Math.max(0, fighter.invuln - dt);
      fighter.hitFlash = Math.max(0, fighter.hitFlash - dt);
      const swing = fighter.swing;
      if (swing) {
        swing.elapsed += dt;
        // 玩家在距离内起手后，剑锋持续跟踪目标，避免 75ms 前摇里对手
        // 横移/后撤导致原本已经瞄准的一剑打空。
        const aimTarget = otherFighter(fighter);
        if (swing.autoAim && aimTarget && aimTarget.hp > 0) {
          const aim = Math.atan2(aimTarget.y - fighter.y, aimTarget.x - fighter.x);
          swing.targetAngle = aim;
          swing.startAngle = aim - CONFIG.meleeArc / 2;
          swing.endAngle = aim + CONFIG.meleeArc / 2;
        }
        if (!swing.resolved && swing.elapsed >= swing.hitAt) {
          swing.resolved = true;
          resolveMeleeSwing(fighter, swing);
        }
        // A lethal strike clears both fighters' swings inside handleDefeat().
        if (fighter.swing === swing && swing.elapsed >= swing.duration) {
          fighter.swing = null;
        }
      }
    }
  }

  function updateRegen(dt) {
    for (const fighter of [game.player, game.enemy]) {
      if (!fighter || fighter.hp <= 0) continue;
      // 自然回灵固定 10/秒；仅发射灵子后短暂停止。
      if (fighter.regenBlocked <= 0) {
        addMana(fighter, CONFIG.manaRegenPerSecond * dt, false);
      }
      // 精魄：敌我每 5 秒自然 +1，上限 10。
      if (fighter.essence < CONFIG.essenceMax) {
        fighter.essenceTimer += dt;
        while (fighter.essenceTimer >= CONFIG.essenceInterval && fighter.essence < CONFIG.essenceMax) {
          fighter.essenceTimer -= CONFIG.essenceInterval;
          fighter.essence += 1;
          if (fighter === game.player) {
            spawnFloater(fighter.x, fighter.y - 58 * world.scale, '+1 精魄', '#ffe6a8', 0.8, 13);
          }
        }
      } else {
        fighter.essenceTimer = 0;
      }
      // 桃：持续回血。
      if (fighter.healRemaining > 0) {
        const step = Math.min(fighter.healRemaining, dt);
        fighter.healRemaining = Math.max(0, fighter.healRemaining - dt);
        fighter.hp = Math.min(fighter.maxHp, fighter.hp + step * fighter.healRate);
      }
    }
  }

  function updateEffects(dt) {
    for (const particle of game.effects) {
      particle.life -= dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vy += (particle.gravity || 0) * dt;
      particle.vx *= 0.985;
      particle.vy *= 0.985;
    }
    game.effects = game.effects.filter((particle) => particle.life > 0);

    for (const floater of game.floaters) {
      floater.life -= dt;
      floater.y += floater.vy * dt;
      floater.x += floater.drift * dt;
      floater.vy *= 0.97;
    }
    game.floaters = game.floaters.filter((floater) => floater.life > 0);

    for (const afterimage of game.afterimages) {
      afterimage.life -= dt;
    }
    game.afterimages = game.afterimages.filter((afterimage) => afterimage.life > 0);

    game.shake = Math.max(0, game.shake - 35 * dt);
    game.playerHurtFlash = Math.max(0, game.playerHurtFlash - dt * 1.8);
    game.enemyHurtFlash = Math.max(0, game.enemyHurtFlash - dt * 2.4);
  }

  function updateEndState(dt) {
    if (!game.endPending || game.resultShown) return;
    game.endTimer -= dt;
    if (game.endTimer <= 0) completeBattle();
  }

  function step(dt) {
    if (game.mode !== 'battle' || game.paused || game.settingsOpen) return;
    game.battleTime += dt;
    game.ambientTime += dt;

    checkMeleeClash();
    tickTimers(dt);
    checkMeleeClash();
    updateProjectiles(dt);
    updateGiantSwords(dt);
    updatePlayer(dt);
    if (isOnlineHost()) updateRemoteFighter(dt);
    else updateAI(dt);
    checkMeleeClash();
    updateRegen(dt);
    separateFighters();
    updateEffects(dt);
    updateEndState(dt);
  }

  function loop(now) {
    frameRequest = window.requestAnimationFrame(loop);
    if (!lastFrame) lastFrame = now;
    const frameDelta = Math.min(0.1, Math.max(0, (now - lastFrame) / 1000));
    lastFrame = now;

    const guestOnline = isOnlineGuest();
    if (game.mode === 'battle' && !guestOnline && !game.paused && !game.settingsOpen && !document.hidden) {
      accumulator += frameDelta;
      let steps = 0;
      while (accumulator >= STEP && steps < 8) {
        step(STEP);
        accumulator -= STEP;
        steps += 1;
        if (game.mode !== 'battle') break;
      }
      if (steps === 8) accumulator = 0;
    } else {
      accumulator = 0;
      if (guestOnline) updateOnlineGuestView(frameDelta);
    }

    if (game.mode !== 'battle' || game.paused) {
      game.ambientTime += Math.min(frameDelta, 0.05) * 0.35;
    }

    if (isOnlineHost() && game.mode === 'battle' && !game.paused) {
      if (now - game.online.lastSnapshotAt >= ONLINE_SNAPSHOT_INTERVAL) {
        game.online.lastSnapshotAt = now;
        sendOnlineSnapshot();
      }
    }
    if (isOnlineGuest() && game.mode === 'battle') {
      sendGuestInput();
    }
    if ((isOnlineHost() || isOnlineGuest()) && game.mode === 'battle') {
      maybeSendOnlinePing(now);
    }

    renderGame();
    updateHud();
  }

  let frameRequest = 0;

  /* =======================================================================
     08. 渲染与美术
     ======================================================================= */

  function ensurePaperPattern() {
    if (paperPattern) return paperPattern;
    const tile = document.createElement('canvas');
    tile.width = 160;
    tile.height = 160;
    const tctx = tile.getContext('2d');
    const random = mulberry32(3382);
    tctx.clearRect(0, 0, 160, 160);
    for (let i = 0; i < 1150; i += 1) {
      const x = random() * 160;
      const y = random() * 160;
      const alpha = 0.03 + random() * 0.11;
      tctx.fillStyle = random() > 0.5 ? `rgba(235, 223, 191, ${alpha})` : `rgba(0, 0, 0, ${alpha * 0.9})`;
      tctx.fillRect(x, y, 0.6 + random() * 1.5, 0.6 + random() * 1.5);
    }
    paperPattern = ctx.createPattern(tile, 'repeat');
    return paperPattern;
  }

  function drawBackdrop(time) {
    const gradient = ctx.createLinearGradient(0, 0, 0, viewH);
    gradient.addColorStop(0, '#071512');
    gradient.addColorStop(0.36, '#08130f');
    gradient.addColorStop(0.7, '#050d0b');
    gradient.addColorStop(1, '#040907');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, viewW, viewH);

    // Cold moon behind the mountain gate.
    const moonX = viewW * 0.53;
    const moonY = Math.min(viewH * 0.2, world.arena.y * 0.66);
    const moonRadius = Math.min(viewW, viewH) * 0.09;
    ctx.save();
    const moonGlow = ctx.createRadialGradient(moonX, moonY, 0, moonX, moonY, moonRadius * 3.4);
    moonGlow.addColorStop(0, 'rgba(149, 202, 176, 0.1)');
    moonGlow.addColorStop(0.35, 'rgba(102, 159, 137, 0.045)');
    moonGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = moonGlow;
    ctx.fillRect(0, 0, viewW, viewH);
    ctx.fillStyle = 'rgba(201, 211, 181, 0.09)';
    ctx.beginPath();
    ctx.arc(moonX, moonY, moonRadius, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(212, 206, 171, 0.09)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    drawMountainLayer(world.arena.y + 38, Math.min(92, world.arena.h * 0.21), '#0b1b17', 0.52, 17);
    drawMountainLayer(world.arena.y + 74, Math.min(128, world.arena.h * 0.27), '#091612', 0.78, 31);
    drawMountainLayer(world.arena.y + 108, Math.min(155, world.arena.h * 0.34), '#07110e', 1, 59);

    drawMountainGate(time);

    const mist = ctx.createLinearGradient(0, world.arena.y - 80, 0, world.arena.y + 80);
    mist.addColorStop(0, 'rgba(53, 111, 94, 0)');
    mist.addColorStop(0.48, 'rgba(53, 111, 94, 0.055)');
    mist.addColorStop(1, 'rgba(53, 111, 94, 0)');
    ctx.fillStyle = mist;
    ctx.fillRect(0, world.arena.y - 100, viewW, 190);

    // Ambient motes in the air.
    const random = mulberry32(4401);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 38; i += 1) {
      const baseX = random() * viewW;
      const baseY = random() * viewH;
      const drift = (time * (3 + random() * 7) + random() * 100) % 120;
      const alpha = 0.04 + (Math.sin(time * 0.8 + i) + 1) * 0.025;
      ctx.fillStyle = `rgba(124, 224, 187, ${alpha})`;
      ctx.beginPath();
      ctx.arc(baseX + Math.sin(time * 0.3 + i) * 8, baseY - drift * 0.25, 0.7 + random() * 1.4, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawMountainLayer(baseY, amplitude, color, opacity, seed) {
    const random = mulberry32(seed);
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(-20, baseY + amplitude * 0.4);
    const segments = 14;
    for (let i = 0; i <= segments; i += 1) {
      const x = (viewW / segments) * i;
      const ridge = baseY - Math.sin(i * 1.45 + seed) * amplitude * 0.24 - random() * amplitude * 0.62;
      ctx.lineTo(x, ridge);
    }
    ctx.lineTo(viewW + 20, baseY + amplitude);
    ctx.lineTo(-20, baseY + amplitude);
    ctx.closePath();
    ctx.fill();

    ctx.globalAlpha = opacity * 0.45;
    ctx.strokeStyle = 'rgba(98, 171, 141, 0.12)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i += 1) {
      const x = random() * viewW;
      const y = baseY - amplitude * (0.2 + random() * 0.5);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 18, y - 22);
      ctx.lineTo(x + 32, y - 13);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawMountainGate(time) {
    const arenaTop = world.arena.y;
    if (arenaTop < 80) return;
    const gateW = Math.min(viewW * 0.42, 620);
    const x = viewW * 0.5;
    const top = Math.max(12, arenaTop * 0.08);
    const bottom = arenaTop + 18;
    const pillarOffset = gateW * 0.37;
    ctx.save();
    ctx.globalAlpha = 0.58;

    // Two distant gate pillars.
    for (const side of [-1, 1]) {
      const px = x + side * pillarOffset;
      const pillarGrad = ctx.createLinearGradient(px - 22, 0, px + 22, 0);
      pillarGrad.addColorStop(0, '#040b09');
      pillarGrad.addColorStop(0.5, '#0d1e18');
      pillarGrad.addColorStop(1, '#030806');
      ctx.fillStyle = pillarGrad;
      ctx.fillRect(px - 20, top + 30, 40, bottom - top);
      ctx.fillStyle = 'rgba(156, 131, 77, 0.09)';
      ctx.fillRect(px - 16, top + 45, 2, bottom - top - 50);
      ctx.fillRect(px + 12, top + 45, 1, bottom - top - 50);
      // Lantern glow.
      ctx.globalCompositeOperation = 'lighter';
      const lantern = ctx.createRadialGradient(px, top + 72, 0, px, top + 72, 34);
      lantern.addColorStop(0, 'rgba(231, 191, 116, 0.18)');
      lantern.addColorStop(1, 'rgba(231, 191, 116, 0)');
      ctx.fillStyle = lantern;
      ctx.fillRect(px - 36, top + 36, 72, 72);
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(213, 170, 101, 0.38)';
      ctx.beginPath();
      ctx.arc(px, top + 72 + Math.sin(time * 1.4 + side) * 1.5, 2.6, 0, TAU);
      ctx.fill();
    }

    // Crossbeam and low-pitched roof.
    ctx.fillStyle = '#091611';
    ctx.beginPath();
    ctx.moveTo(x - gateW * 0.55, top + 36);
    ctx.quadraticCurveTo(x, top + 9, x + gateW * 0.55, top + 36);
    ctx.lineTo(x + gateW * 0.5, top + 48);
    ctx.quadraticCurveTo(x, top + 25, x - gateW * 0.5, top + 48);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(183, 151, 87, 0.13)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = '#0a1813';
    ctx.fillRect(x - gateW * 0.46, top + 45, gateW * 0.92, 11);
    ctx.fillStyle = 'rgba(165, 136, 79, 0.1)';
    ctx.fillRect(x - gateW * 0.34, top + 49, gateW * 0.68, 1);

    // Hanging plaque.
    ctx.fillStyle = 'rgba(3, 9, 7, 0.88)';
    ctx.strokeStyle = 'rgba(187, 151, 83, 0.19)';
    ctx.fillRect(x - 55, top + 58, 110, 27);
    ctx.strokeRect(x - 55, top + 58, 110, 27);
    ctx.fillStyle = 'rgba(207, 177, 112, 0.27)';
    ctx.font = `${Math.max(11, Math.min(17, gateW * 0.026))}px ${getCanvasSerif()}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('问 道', x, top + 72);
    ctx.restore();
  }

  function getCanvasSerif() {
    return '"STKaiti", "KaiTi", "Songti SC", "Noto Serif SC", serif';
  }

  function drawArena(time) {
    const arena = world.arena;
    const radius = Math.min(22, arena.w * 0.035);
    ctx.save();

    // Platform shadow and edge.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.44)';
    roundedRectPath(arena.x - 10, arena.y + 9, arena.w + 20, arena.h + 16, radius * 1.4);
    ctx.fill();

    const floorGradient = ctx.createLinearGradient(0, arena.y, 0, arena.y + arena.h);
    floorGradient.addColorStop(0, 'rgba(26, 52, 43, 0.98)');
    floorGradient.addColorStop(0.34, 'rgba(18, 39, 33, 0.985)');
    floorGradient.addColorStop(1, 'rgba(8, 22, 18, 0.99)');

    roundedRectPath(arena.x, arena.y, arena.w, arena.h, radius);
    ctx.fillStyle = floorGradient;
    ctx.fill();

    // Stone border.
    ctx.strokeStyle = 'rgba(191, 158, 100, 0.28)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    roundedRectPath(arena.x + 5, arena.y + 5, arena.w - 10, arena.h - 10, radius * 0.8);
    ctx.strokeStyle = 'rgba(200, 174, 116, 0.08)';
    ctx.stroke();

    ctx.save();
    roundedRectPath(arena.x + 1, arena.y + 1, arena.w - 2, arena.h - 2, radius);
    ctx.clip();

    // Age and damp patches, so the stone has a remembered history.
    const slabRandom = mulberry32(711);
    for (let i = 0; i < 20; i += 1) {
      const patchX = arena.x + slabRandom() * arena.w;
      const patchY = arena.y + slabRandom() * arena.h;
      const patchR = (24 + slabRandom() * 80) * Math.max(0.7, world.scale);
      const patch = ctx.createRadialGradient(patchX, patchY, 0, patchX, patchY, patchR);
      const damp = slabRandom() > 0.5;
      patch.addColorStop(0, damp ? 'rgba(43, 91, 73, 0.06)' : 'rgba(112, 111, 82, 0.032)');
      patch.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = patch;
      ctx.beginPath();
      ctx.ellipse(patchX, patchY, patchR, patchR * 0.48, slabRandom() * TAU, 0, TAU);
      ctx.fill();
    }

    // Broad stone tiles.
    const tileSize = Math.max(54, 86 * world.scale);
    ctx.strokeStyle = 'rgba(166, 196, 169, 0.075)';
    ctx.lineWidth = 1;
    let row = 0;
    for (let y = arena.y + tileSize * 0.45; y < arena.y + arena.h; y += tileSize * 0.72) {
      ctx.beginPath();
      ctx.moveTo(arena.x, y);
      ctx.lineTo(arena.x + arena.w, y + Math.sin(row * 0.8) * 2);
      ctx.stroke();
      row += 1;
    }
    for (let x = arena.x + tileSize * 0.6; x < arena.x + arena.w; x += tileSize) {
      for (let y = arena.y + tileSize * 0.45; y < arena.y + arena.h; y += tileSize * 0.72) {
        const offset = Math.floor(y / (tileSize * 0.72)) % 2 === 0 ? 0 : tileSize * 0.5;
        ctx.beginPath();
        ctx.moveTo(x + offset, y);
        ctx.lineTo(x + offset + Math.sin(y * 0.01) * 2, Math.min(y + tileSize * 0.72, arena.y + arena.h));
        ctx.stroke();
      }
    }
    // Highlight the near edge of a few slabs for a low, raking light.
    ctx.strokeStyle = 'rgba(116, 184, 158, 0.04)';
    for (let y = arena.y + tileSize * 0.88; y < arena.y + arena.h; y += tileSize * 0.72) {
      ctx.beginPath();
      ctx.moveTo(arena.x + 12, y + 1.5);
      ctx.lineTo(arena.x + arena.w - 12, y + 1.5);
      ctx.stroke();
    }

    // Cracks and old seams.
    const random = mulberry32(881);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.16)';
    for (let i = 0; i < 11; i += 1) {
      const sx = arena.x + random() * arena.w;
      const sy = arena.y + random() * arena.h;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      let px = sx;
      let py = sy;
      for (let j = 0; j < 4; j += 1) {
        px += (random() - 0.5) * 52 * world.scale;
        py += (random() - 0.25) * 24 * world.scale;
        ctx.lineTo(px, py);
      }
      ctx.stroke();
    }

    drawFormation(arena.x + arena.w * 0.5, arena.y + arena.h * 0.55, Math.min(arena.w, arena.h), time);
    drawArenaEdgeLights(arena);

    // Paper grain inside the platform.
    const pattern = ensurePaperPattern();
    if (pattern) {
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = pattern;
      ctx.fillRect(arena.x, arena.y, arena.w, arena.h);
      ctx.globalAlpha = 1;
    }

    // Soft teal atmosphere at the arena edge.
    const glow = ctx.createRadialGradient(
      arena.x + arena.w * 0.16,
      arena.y + arena.h * 0.05,
      0,
      arena.x + arena.w * 0.16,
      arena.y + arena.h * 0.05,
      arena.w * 0.58
    );
    glow.addColorStop(0, 'rgba(78, 190, 156, 0.09)');
    glow.addColorStop(0.5, 'rgba(61, 145, 122, 0.025)');
    glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(arena.x, arena.y, arena.w, arena.h);

    drawDecorations();
    drawSpawnSeals();
    drawStoneLanterns(time);
    ctx.restore();

    // Corner rune posts.
    drawCornerMarks(arena);
    ctx.restore();
  }

  function drawFormation(cx, cy, minDim, time) {
    const outer = Math.min(minDim * 0.19, 135);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(time * 0.012);
    ctx.strokeStyle = 'rgba(213, 181, 111, 0.27)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(0, 0, outer, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([3, 12]);
    ctx.strokeStyle = 'rgba(213, 181, 111, 0.2)';
    ctx.beginPath();
    ctx.arc(0, 0, outer * 0.78, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([1, 7]);
    ctx.beginPath();
    ctx.arc(0, 0, outer * 1.2, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);

    // Eight golden trigram marks.
    ctx.fillStyle = 'rgba(224, 195, 126, 0.44)';
    ctx.font = `${Math.max(9, 12 * world.scale)}px ${getCanvasSerif()}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const glyphs = ['乾', '兑', '离', '震', '巽', '坎', '艮', '坤'];
    for (let i = 0; i < 8; i += 1) {
      const angle = (i / 8) * TAU;
      const x = Math.cos(angle) * outer * 0.91;
      const y = Math.sin(angle) * outer * 0.91;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-time * 0.012);
      ctx.fillText(glyphs[i], 0, 0);
      ctx.restore();
    }

    // Inner geometric array.
    ctx.rotate(-time * 0.02);
    ctx.strokeStyle = 'rgba(216, 181, 110, 0.22)';
    for (let ring = 0; ring < 3; ring += 1) {
      const r = outer * (0.24 + ring * 0.17);
      ctx.beginPath();
      for (let i = 0; i <= 8; i += 1) {
        const angle = (i / 8) * TAU;
        const px = Math.cos(angle) * r;
        const py = Math.sin(angle) * r;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    ctx.beginPath();
    for (let i = 0; i < 8; i += 1) {
      const a = (i / 8) * TAU;
      const b = ((i + 3) / 8) * TAU;
      ctx.moveTo(Math.cos(a) * outer * 0.28, Math.sin(a) * outer * 0.28);
      ctx.lineTo(Math.cos(b) * outer * 0.74, Math.sin(b) * outer * 0.74);
    }
    ctx.stroke();

    // Faint radial glow.
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, outer * 1.3);
    glow.addColorStop(0, 'rgba(213, 184, 120, 0.075)');
    glow.addColorStop(0.55, 'rgba(96, 180, 152, 0.03)');
    glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, outer * 1.3, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function drawArenaEdgeLights(arena) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const side of [0, 1]) {
      const x = side === 0 ? arena.x + arena.w * 0.05 : arena.x + arena.w * 0.95;
      const glow = ctx.createRadialGradient(x, arena.y + arena.h * 0.55, 0, x, arena.y + arena.h * 0.55, arena.w * 0.3);
      glow.addColorStop(0, 'rgba(64, 175, 142, 0.04)');
      glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(arena.x, arena.y, arena.w, arena.h);
    }
    ctx.restore();
  }

  function drawSpawnSeals() {
    const spawn = getSpawnPoints();
    for (const [team, point] of Object.entries(spawn)) {
      const palette = team === 'player' ? PLAYER_PALETTE : ENEMY_PALETTE;
      const radius = 30 * world.scale;
      ctx.save();
      ctx.translate(point.x, point.y);
      ctx.strokeStyle = team === 'player' ? 'rgba(105, 217, 189, 0.12)' : 'rgba(220, 102, 85, 0.1)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([2, 7]);
      ctx.beginPath();
      ctx.arc(0, 0, radius * 0.7, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = team === 'player' ? 'rgba(132, 227, 197, 0.18)' : 'rgba(232, 151, 128, 0.17)';
      ctx.font = `${Math.max(10, 14 * world.scale)}px ${getCanvasSerif()}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(team === 'player' ? '青' : '朱', 0, 0);
      ctx.restore();

      // Tiny ground shadow to anchor the seal.
      const grad = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius * 1.3);
      grad.addColorStop(0, 'rgba(0, 0, 0, 0.12)');
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius * 1.3, 0, TAU);
      ctx.fill();
    }
  }

  function drawStoneLanterns(time) {
    const arena = world.arena;
    const s = world.scale;
    const spots = [
      { x: arena.x + 42 * s, y: arena.y + arena.h - 38 * s, side: 1 },
      { x: arena.x + arena.w - 42 * s, y: arena.y + arena.h - 38 * s, side: -1 },
    ];
    for (let index = 0; index < spots.length; index += 1) {
      const spot = spots[index];
      const flicker = 0.72 + Math.sin(time * 2.2 + index * 1.7) * 0.16;
      ctx.save();
      ctx.translate(spot.x, spot.y);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.32)';
      ctx.beginPath();
      ctx.ellipse(0, 3 * s, 18 * s, 4.5 * s, 0, 0, TAU);
      ctx.fill();

      // Base and pedestal.
      ctx.fillStyle = '#10241d';
      ctx.beginPath();
      ctx.moveTo(-13 * s, 1 * s);
      ctx.lineTo(-8 * s, -14 * s);
      ctx.lineTo(8 * s, -14 * s);
      ctx.lineTo(13 * s, 1 * s);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(157, 173, 136, 0.18)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = '#1b3428';
      ctx.fillRect(-4 * s, -36 * s, 8 * s, 23 * s);

      // Light chamber.
      const glow = ctx.createRadialGradient(0, -43 * s, 0, 0, -43 * s, 47 * s);
      glow.addColorStop(0, `rgba(245, 198, 112, ${0.15 * flicker})`);
      glow.addColorStop(0.35, `rgba(224, 169, 87, ${0.07 * flicker})`);
      glow.addColorStop(1, 'rgba(224, 169, 87, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(0, -43 * s, 47 * s, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#1b2d22';
      ctx.strokeStyle = 'rgba(174, 147, 91, 0.33)';
      ctx.beginPath();
      ctx.moveTo(-9 * s, -36 * s);
      ctx.lineTo(-7 * s, -49 * s);
      ctx.lineTo(7 * s, -49 * s);
      ctx.lineTo(9 * s, -36 * s);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = `rgba(244, 196, 115, ${0.36 * flicker})`;
      ctx.beginPath();
      ctx.ellipse(0, -43 * s, 4 * s, 5 * s, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#203529';
      ctx.beginPath();
      ctx.moveTo(-14 * s, -49 * s);
      ctx.lineTo(0, -57 * s);
      ctx.lineTo(14 * s, -49 * s);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(181, 151, 87, 0.22)';
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawDecorations() {
    for (const decoration of world.decorations) {
      ctx.save();
      ctx.translate(decoration.x, decoration.y);
      ctx.rotate(decoration.angle);
      if (decoration.tone > 0.65) {
        ctx.strokeStyle = 'rgba(152, 168, 126, 0.13)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-decoration.size * 2, 0);
        ctx.quadraticCurveTo(0, -decoration.size * 1.4, decoration.size * 2, 0);
        ctx.stroke();
      } else {
        ctx.fillStyle = 'rgba(165, 176, 139, 0.12)';
        ctx.beginPath();
        ctx.ellipse(0, 0, decoration.size * 1.8, decoration.size * 0.6, 0, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  function drawCornerMarks(arena) {
    ctx.save();
    ctx.strokeStyle = 'rgba(200, 174, 116, 0.22)';
    ctx.lineWidth = 1;
    const arm = Math.min(30, arena.w * 0.035);
    const inset = 13;
    const corners = [
      [arena.x + inset, arena.y + inset, 1, 1],
      [arena.x + arena.w - inset, arena.y + inset, -1, 1],
      [arena.x + inset, arena.y + arena.h - inset, 1, -1],
      [arena.x + arena.w - inset, arena.y + arena.h - inset, -1, -1],
    ];
    for (const [x, y, sx, sy] of corners) {
      ctx.beginPath();
      ctx.moveTo(x, y + sy * arm);
      ctx.lineTo(x, y);
      ctx.lineTo(x + sx * arm, y);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x + sx * 7, y + sy * 7, 1.5, 0, TAU);
      ctx.fillStyle = 'rgba(220, 192, 126, 0.32)';
      ctx.fill();
    }
    ctx.restore();
  }

  function roundedRectPath(x, y, w, h, radius) {
    const r = Math.min(radius, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawObstacle(obstacle) {
    if (obstacle.kind === 'rock') drawRock(obstacle);
    else drawTree(obstacle);
  }

  function drawRock(obstacle) {
    const r = obstacle.radius;
    ctx.save();
    ctx.translate(obstacle.x, obstacle.y);

    ctx.fillStyle = 'rgba(0, 0, 0, 0.34)';
    ctx.beginPath();
    ctx.ellipse(4 * world.scale, 4 * world.scale, r * 1.1, r * 0.32, 0, 0, TAU);
    ctx.fill();

    const gradient = ctx.createLinearGradient(-r, -r * 1.1, r, r * 0.4);
    gradient.addColorStop(0, '#273a33');
    gradient.addColorStop(0.45, '#1a2b26');
    gradient.addColorStop(1, '#0b1714');

    ctx.beginPath();
    obstacle.points.forEach((point, index) => {
      const x = point.x;
      const y = point.y - r * 0.46;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.strokeStyle = 'rgba(139, 165, 145, 0.13)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Rock facets.
    ctx.save();
    ctx.clip();
    ctx.fillStyle = 'rgba(151, 173, 146, 0.075)';
    ctx.beginPath();
    ctx.moveTo(-r * 0.65, -r * 0.8);
    ctx.lineTo(-r * 0.15, -r * 1.15);
    ctx.lineTo(r * 0.22, -r * 0.72);
    ctx.lineTo(-r * 0.35, -r * 0.42);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.14)';
    ctx.beginPath();
    ctx.moveTo(r * 0.14, -r * 0.2);
    ctx.lineTo(r * 0.92, -r * 0.52);
    ctx.lineTo(r * 0.78, r * 0.04);
    ctx.lineTo(r * 0.18, r * 0.18);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    for (const moss of obstacle.moss) {
      ctx.fillStyle = 'rgba(88, 130, 94, 0.18)';
      ctx.beginPath();
      ctx.ellipse(moss.x, moss.y - r * 0.52, moss.r, moss.r * 0.35, -0.4, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(143, 178, 119, 0.09)';
      ctx.beginPath();
      ctx.ellipse(moss.x + moss.r * 0.2, moss.y - r * 0.58, moss.r * 0.5, moss.r * 0.2, -0.3, 0, TAU);
      ctx.fill();
    }

    // A faint gold seal scratched into the rock.
    ctx.strokeStyle = 'rgba(200, 174, 116, 0.14)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(-r * 0.05, -r * 0.5, r * 0.3, 0.2, Math.PI * 1.4);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-r * 0.15, -r * 0.62);
    ctx.lineTo(-r * 0.02, -r * 0.45);
    ctx.lineTo(-r * 0.14, -r * 0.3);
    ctx.stroke();
    ctx.restore();
  }

  function drawTree(obstacle) {
    const r = obstacle.radius;
    const sway = Math.sin(game.ambientTime * 0.8 + obstacle.seed) * 1.2 * world.scale;
    ctx.save();
    ctx.translate(obstacle.x, obstacle.y);

    ctx.fillStyle = 'rgba(0, 0, 0, 0.37)';
    ctx.beginPath();
    ctx.ellipse(4 * world.scale, 2 * world.scale, r * 1.25, r * 0.35, 0, 0, TAU);
    ctx.fill();

    // Root mound / base.
    ctx.fillStyle = 'rgba(23, 43, 33, 0.9)';
    ctx.beginPath();
    ctx.ellipse(0, -2 * world.scale, r * 0.82, r * 0.22, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(116, 135, 91, 0.16)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i += 1) {
      const angle = -Math.PI * 0.8 + (i / 3) * Math.PI * 0.6;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(
        Math.cos(angle) * r * 0.5,
        -r * 0.06,
        Math.cos(angle) * r * 1.02,
        Math.sin(angle) * r * 0.13
      );
      ctx.stroke();
    }

    // Trunk.
    const trunkTop = -r * 1.12;
    const trunkGradient = ctx.createLinearGradient(-r * 0.2, 0, r * 0.3, 0);
    trunkGradient.addColorStop(0, '#18251d');
    trunkGradient.addColorStop(0.5, '#2b3525');
    trunkGradient.addColorStop(1, '#0d1712');
    ctx.strokeStyle = trunkGradient;
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(5, r * 0.2);
    ctx.beginPath();
    ctx.moveTo(0, 1);
    ctx.quadraticCurveTo(-r * 0.14, -r * 0.55, sway, trunkTop);
    ctx.stroke();
    ctx.lineWidth = Math.max(2, r * 0.07);
    ctx.beginPath();
    ctx.moveTo(-sway * 0.4, -r * 0.6);
    ctx.lineTo(-r * 0.48 + sway, -r * 1.06);
    ctx.moveTo(sway * 0.2, -r * 0.82);
    ctx.lineTo(r * 0.46 + sway, -r * 1.23);
    ctx.stroke();

    // Layered canopy.
    const canopyY = -r * 1.35;
    // A unified under-canopy gives the clusters a single silhouette.
    const under = ctx.createRadialGradient(
      -r * 0.18,
      canopyY - r * 0.18,
      0,
      0,
      canopyY,
      r * 0.92
    );
    under.addColorStop(0, 'rgba(48, 88, 66, 0.92)');
    under.addColorStop(0.58, 'rgba(24, 56, 40, 0.95)');
    under.addColorStop(1, 'rgba(8, 25, 17, 0)');
    ctx.fillStyle = under;
    ctx.beginPath();
    ctx.ellipse(sway * 0.2, canopyY + r * 0.06, r * 0.98, r * 0.6, 0.03, 0, TAU);
    ctx.fill();

    const blobs = [
      { x: -r * 0.5, y: r * 0.02, size: 1.15, alpha: 0.48 },
      { x: r * 0.42, y: r * 0.04, size: 1.12, alpha: 0.46 },
      { x: -r * 0.14, y: -r * 0.08, size: 1.32, alpha: 0.63 },
      { x: r * 0.12, y: r * 0.15, size: 1.02, alpha: 0.58 },
      { x: -r * 0.57, y: r * 0.22, size: 0.82, alpha: 0.38 },
      { x: r * 0.55, y: r * 0.2, size: 0.8, alpha: 0.36 },
      { x: -r * 0.2, y: -r * 0.35, size: 0.92, alpha: 0.48 },
      { x: r * 0.3, y: -r * 0.24, size: 0.82, alpha: 0.42 },
      { x: 0, y: r * 0.32, size: 0.75, alpha: 0.5 },
    ];
    for (const blob of blobs) {
      const radius = r * 0.36 * blob.size;
      const blobY = canopyY - blob.y;
      const grad = ctx.createRadialGradient(
        blob.x - radius * 0.27,
        blobY - radius * 0.38,
        0,
        blob.x,
        blobY,
        radius
      );
      grad.addColorStop(0, `rgba(63, 107, 78, ${0.54 + blob.alpha * 0.3})`);
      grad.addColorStop(0.55, 'rgba(30, 66, 48, 0.91)');
      grad.addColorStop(1, 'rgba(7, 23, 16, 0.94)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(blob.x + sway * 0.3, blobY, radius, 0, TAU);
      ctx.fill();
    }

    // Hanging fronds at the lower edge.
    ctx.strokeStyle = 'rgba(57, 104, 74, 0.42)';
    ctx.lineWidth = Math.max(1, 1.1 * world.scale);
    for (let i = 0; i < 7; i += 1) {
      const fx = (i - 3) * r * 0.2 + sway * 0.45;
      const fy = canopyY + r * 0.42 + Math.abs(i - 3) * r * 0.035;
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.quadraticCurveTo(fx + 2 * world.scale, fy + r * 0.18, fx + (i % 2 ? 4 : -3) * world.scale, fy + r * 0.28);
      ctx.stroke();
    }

    // Leaf glints.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 10; i += 1) {
      const random = mulberry32(obstacle.seed + i * 17);
      const angle = random() * TAU;
      const radius = random() * r * 0.85;
      ctx.fillStyle = `rgba(112, 177, 127, ${0.04 + random() * 0.07})`;
      ctx.beginPath();
      ctx.ellipse(
        Math.cos(angle) * radius + sway * 0.3,
        canopyY + Math.sin(angle) * radius * 0.55,
        (2 + random() * 3.5) * world.scale,
        (0.7 + random() * 1.2) * world.scale,
        random() * TAU,
        0,
        TAU
      );
      ctx.fill();
    }
    ctx.restore();

    // Gold binding ribbon on the trunk, a small sign of the sect.
    ctx.strokeStyle = 'rgba(200, 174, 116, 0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-r * 0.17, -r * 0.42);
    ctx.lineTo(r * 0.14, -r * 0.45);
    ctx.stroke();
    ctx.fillStyle = 'rgba(200, 174, 116, 0.2)';
    ctx.beginPath();
    ctx.moveTo(r * 0.11, -r * 0.45);
    ctx.lineTo(r * 0.22, -r * 0.35);
    ctx.lineTo(r * 0.13, -r * 0.38);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawShadow(fighter) {
    const alpha = fighter.hp <= 0 ? 0.12 : 0.36;
    ctx.save();
    ctx.fillStyle = `rgba(0, 0, 0, ${alpha})`;
    ctx.beginPath();
    ctx.ellipse(
      fighter.x,
      fighter.y + 1,
      fighter.radius * 1.25,
      fighter.radius * 0.4,
      0,
      0,
      TAU
    );
    ctx.fill();
    ctx.restore();
  }

  // 读条技能（打坐）的头顶进度条。
  function drawCastBar(fighter) {
    if (!fighter || fighter.hp <= 0 || fighter.rootTimer <= 0) return;
    const s = world.scale;
    const total = Math.max(0.1, fighter.castDuration || CONFIG.rootDuration);
    const progress = clamp(1 - fighter.rootTimer / total, 0, 1);
    const width = 62 * s;
    const height = 6 * s;
    const x = fighter.x - width / 2;
    const y = fighter.y - 92 * s;
    ctx.save();
    ctx.fillStyle = 'rgba(4, 12, 10, 0.86)';
    ctx.fillRect(x - 1, y - 1, width + 2, height + 2);
    ctx.strokeStyle = 'rgba(210, 182, 118, 0.8)';
    ctx.lineWidth = Math.max(1, 1.2 * s);
    ctx.strokeRect(x - 1, y - 1, width + 2, height + 2);
    ctx.fillStyle = '#69d9bd';
    ctx.fillRect(x, y, width * progress, height);
    ctx.fillStyle = '#f4ecd6';
    ctx.font = `${Math.max(9, 10 * s)}px ${getCanvasSerif()}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText('打坐', fighter.x, y - 5 * s);
    ctx.restore();
  }

  function drawFighter(fighter, alpha = 1) {
    if (!fighter) return;
    const palette = fighter.palette;
    const s = world.scale;
    const dead = fighter.hp <= 0;
    const isDodging = fighter.dodgeRemaining > 0;
    const meditating = fighter.meditationTimer > 0 && !isDodging && !dead;

    ctx.save();
    ctx.globalAlpha = alpha;

    if (meditating) {
      drawMeditationAura(fighter);
    }
    if (!dead) {
      drawBloodAura(fighter);
      drawWindTrail(fighter);
    }

    ctx.translate(fighter.x, fighter.y);

    if (dead) {
      ctx.rotate(-0.55 * Math.min(1, fighter.deadTime * 3));
      ctx.globalAlpha = alpha * Math.max(0.35, 1 - fighter.deadTime * 0.45);
    }

    const breathe = Math.sin(game.ambientTime * 2.5 + (fighter.team === 'player' ? 0 : 2)) * 0.7 * s;
    const walk = fighter.moving ? Math.sin(fighter.walkPhase) : 0;
    const bodyHeight = (meditating ? 34 : 54) * s;
    const robeWidth = fighter.radius * 1.02;
    const isFacingLeft = Math.cos(fighter.facing) < 0;
    const lean = isDodging ? Math.cos(fighter.facing) * 4 * s : 0;

    if (meditating) {
      drawMeditatingBody(fighter);
    } else {
      ctx.save();
      ctx.translate(lean, breathe);
      ctx.scale(isFacingLeft ? -1 : 1, 1);

      // Walking hem sway.
      const step = walk * 2.2 * s;
      ctx.save();
      ctx.strokeStyle = palette.robeOuter;
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(3, 5 * s);
      ctx.beginPath();
      ctx.moveTo(-robeWidth * 0.38, -bodyHeight * 0.3);
      ctx.lineTo(-robeWidth * 0.44 + step * 0.3, -1 * s);
      ctx.moveTo(robeWidth * 0.36, -bodyHeight * 0.3);
      ctx.lineTo(robeWidth * 0.42 - step * 0.3, -1 * s);
      ctx.stroke();
      ctx.restore();

      // Robe silhouette.
      ctx.beginPath();
      ctx.moveTo(-robeWidth * 0.4, -bodyHeight * 0.75);
      ctx.quadraticCurveTo(-robeWidth * 0.88, -bodyHeight * 0.3, -robeWidth * 0.76, -2 * s);
      ctx.quadraticCurveTo(0, 4 * s + step * 0.35, robeWidth * 0.76, -2 * s);
      ctx.quadraticCurveTo(robeWidth * 0.88, -bodyHeight * 0.3, robeWidth * 0.4, -bodyHeight * 0.75);
      ctx.closePath();
      const robeGradient = ctx.createLinearGradient(0, -bodyHeight * 0.8, 0, 2 * s);
      robeGradient.addColorStop(0, palette.robeLight);
      robeGradient.addColorStop(0.35, palette.robeMid);
      robeGradient.addColorStop(1, palette.robeOuter);
      ctx.fillStyle = robeGradient;
      ctx.fill();
      ctx.strokeStyle = palette.robeOuter;
      ctx.lineWidth = 1.2;
      ctx.stroke();

      // Inner robe fold.
      ctx.beginPath();
      ctx.moveTo(-robeWidth * 0.11, -bodyHeight * 0.72);
      ctx.quadraticCurveTo(-robeWidth * 0.34, -bodyHeight * 0.25, -robeWidth * 0.14, -3 * s);
      ctx.quadraticCurveTo(0, -8 * s, robeWidth * 0.14, -3 * s);
      ctx.quadraticCurveTo(robeWidth * 0.34, -bodyHeight * 0.25, robeWidth * 0.11, -bodyHeight * 0.72);
      ctx.closePath();
      ctx.fillStyle = palette.robeOuter;
      ctx.globalAlpha = alpha * 0.55;
      ctx.fill();
      ctx.globalAlpha = alpha;

      // Sleeves.
      const sleeveSwing = fighter.swing
        ? Math.sin(clamp(fighter.swing.elapsed / fighter.swing.duration, 0, 1) * Math.PI) * 0.15
        : 0;
      ctx.beginPath();
      ctx.ellipse(-robeWidth * 0.63, -bodyHeight * 0.57 - sleeveSwing * 8 * s, robeWidth * 0.27, bodyHeight * 0.28, -0.24, 0, TAU);
      ctx.fillStyle = palette.robeMid;
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(robeWidth * 0.63, -bodyHeight * 0.55 + sleeveSwing * 6 * s, robeWidth * 0.27, bodyHeight * 0.28, 0.24, 0, TAU);
      ctx.fillStyle = palette.robeLight;
      ctx.fill();

      // Sash.
      ctx.strokeStyle = palette.sash;
      ctx.lineWidth = Math.max(1.5, 2.2 * s);
      ctx.globalAlpha = alpha * 0.72;
      ctx.beginPath();
      ctx.moveTo(-robeWidth * 0.43, -bodyHeight * 0.38);
      ctx.quadraticCurveTo(0, -bodyHeight * 0.32, robeWidth * 0.43, -bodyHeight * 0.38);
      ctx.stroke();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = palette.sash;
      ctx.beginPath();
      ctx.moveTo(-robeWidth * 0.05, -bodyHeight * 0.36);
      ctx.lineTo(robeWidth * 0.17, -bodyHeight * 0.25);
      ctx.lineTo(robeWidth * 0.04, -bodyHeight * 0.22);
      ctx.closePath();
      ctx.fill();

      // Shoulders / neck.
      ctx.fillStyle = palette.robeLight;
      ctx.beginPath();
      ctx.ellipse(0, -bodyHeight * 0.78, robeWidth * 0.44, bodyHeight * 0.13, 0, 0, TAU);
      ctx.fill();

      // Head and hair.
      const headY = -bodyHeight * 0.91;
      ctx.fillStyle = palette.skin;
      ctx.beginPath();
      ctx.ellipse(0, headY, 6.3 * s, 7.2 * s, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = palette.hair;
      ctx.beginPath();
      ctx.arc(0, headY - 1.8 * s, 6.8 * s, Math.PI * 0.98, Math.PI * 2.05);
      ctx.quadraticCurveTo(6.6 * s, headY + 2.6 * s, 3.8 * s, headY + 1.8 * s);
      ctx.quadraticCurveTo(0, headY + 0.8 * s, -6.4 * s, headY + 2.8 * s);
      ctx.closePath();
      ctx.fill();
      // Hair bun and pin.
      ctx.fillStyle = palette.hair;
      ctx.beginPath();
      ctx.arc(-1.3 * s, headY - 7.5 * s, 3.2 * s, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = palette.sash;
      ctx.lineWidth = Math.max(1, 1.3 * s);
      ctx.beginPath();
      ctx.moveTo(-4.4 * s, headY - 8.8 * s);
      ctx.lineTo(2.5 * s, headY - 7.1 * s);
      ctx.stroke();

      // Simple face hint, deliberately restrained.
      ctx.fillStyle = 'rgba(20, 16, 12, 0.65)';
      ctx.beginPath();
      ctx.arc(2.3 * s, headY + 0.3 * s, 0.7 * s, 0, TAU);
      ctx.fill();

      // Sword arm and blade.
      drawSword(fighter);

      // Hit flash.
      if (fighter.hitFlash > 0) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = alpha * clamp(fighter.hitFlash / 0.22, 0, 1) * 0.5;
        ctx.fillStyle = '#fff4e0';
        ctx.beginPath();
        ctx.ellipse(0, -bodyHeight * 0.45, robeWidth * 0.9, bodyHeight * 0.58, 0, 0, TAU);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = alpha;
      }

      ctx.restore();
    }

    // Heal motes rise above the body.
    if (!dead && fighter.healRemaining > 0) drawHealPlus(fighter, alpha, bodyHeight);

    // Sword light is drawn around the body and clipped naturally by nothing.
    if (fighter.swing && !dead) drawSwordArc(fighter);
    drawFighterTopMarks(fighter, bodyHeight);
    ctx.restore();
  }

  // 嗜血奇术：暗红血气在身周翻涌。
  function drawBloodAura(fighter) {
    if (!fighter || fighter.damageBoostTimer <= 0 || fighter.hp <= 0) return;
    const s = world.scale;
    const time = game.ambientTime;
    const height = 54 * s;
    const radius = fighter.radius * 2.6;
    const pulse = 0.9 + Math.sin(time * 5.2) * 0.1;

    ctx.save();
    ctx.translate(fighter.x, fighter.y);
    ctx.globalCompositeOperation = 'lighter';

    const glow = ctx.createRadialGradient(0, -height * 0.48, radius * 0.08, 0, -height * 0.48, radius * pulse);
    glow.addColorStop(0, 'rgba(255, 72, 66, 0.52)');
    glow.addColorStop(0.38, 'rgba(210, 22, 36, 0.3)');
    glow.addColorStop(0.72, 'rgba(132, 0, 20, 0.14)');
    glow.addColorStop(1, 'rgba(70, 0, 12, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.ellipse(0, -height * 0.48, radius * pulse, height * 1.02, 0, 0, TAU);
    ctx.fill();

    // Smoky blood mist wrapped around the torso.
    ctx.fillStyle = 'rgba(196, 24, 38, 0.12)';
    for (let i = 0; i < 3; i += 1) {
      const a = time * 0.65 + (i / 3) * TAU;
      ctx.beginPath();
      ctx.ellipse(
        Math.cos(a) * fighter.radius * 0.62,
        -height * (0.5 + i * 0.16) + Math.sin(a * 1.7) * 4 * s,
        fighter.radius * (0.95 - i * 0.16),
        height * 0.24,
        Math.sin(a) * 0.5,
        0,
        TAU
      );
      ctx.fill();
    }

    // Rising blood wisps.
    ctx.lineCap = 'round';
    for (let i = 0; i < 7; i += 1) {
      const phase = (time * 0.52 + i / 7) % 1;
      const x = Math.sin(time * 1.7 + i * 2.1) * fighter.radius * 0.95;
      const baseY = -height * (0.1 + phase * 1.05);
      const sway = Math.sin(time * 2.4 + i * 1.4) * 7 * s;
      ctx.strokeStyle = `rgba(${i % 2 ? '255, 92, 82' : '198, 22, 42'}, ${0.34 * (1 - phase)})`;
      ctx.lineWidth = Math.max(1.4, (3.2 - phase * 2.1) * s);
      ctx.beginPath();
      ctx.moveTo(x, baseY + 24 * s);
      ctx.quadraticCurveTo(x + sway, baseY + 10 * s, x + sway * 0.5, baseY - 12 * s);
      ctx.stroke();
    }

    // Pulsing orbit ring and droplets.
    ctx.globalAlpha = 0.62;
    ctx.strokeStyle = 'rgba(255, 86, 82, 0.62)';
    ctx.lineWidth = Math.max(1.2, 1.9 * s);
    ctx.beginPath();
    ctx.ellipse(0, -height * 0.43, radius * 0.78, radius * 0.27, 0, 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = 0.38;
    ctx.lineWidth = Math.max(1, 1.2 * s);
    ctx.beginPath();
    ctx.ellipse(0, -height * 0.43, radius * 0.55, radius * 0.2, 0, time * 0.8, time * 0.8 + Math.PI * 1.55);
    ctx.stroke();
    for (let i = 0; i < 5; i += 1) {
      const a = time * 1.35 + (i / 5) * TAU;
      const x = Math.cos(a) * radius * 0.78;
      const y = -height * 0.43 + Math.sin(a) * radius * 0.27;
      ctx.globalAlpha = 0.58 + Math.sin(a) * 0.2;
      ctx.fillStyle = 'rgba(255, 92, 84, 0.85)';
      ctx.beginPath();
      ctx.arc(x, y, (1.8 + (i % 2) * 0.7) * s, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  // 轻身术：移动时在身后拖出青色风痕。
  function drawWindTrail(fighter) {
    if (!fighter || fighter.speedBoostTimer <= 0 || fighter.hp <= 0) return;
    if (!fighter.moving && fighter.dodgeRemaining <= 0) return;
    const s = world.scale;
    const time = game.ambientTime;
    let dx = fighter.x - fighter.prevX;
    let dy = fighter.y - fighter.prevY;
    if (Math.hypot(dx, dy) < 0.4) {
      dx = Math.cos(fighter.facing);
      dy = Math.sin(fighter.facing);
    }
    const angle = Math.atan2(dy, dx);

    ctx.save();
    ctx.translate(fighter.x, fighter.y);
    ctx.rotate(angle);
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';

    for (let i = 0; i < 7; i += 1) {
      const phase = (time * 2.6 + i * 0.15) % 1;
      const lane = (i - 3) * 5.4 * s;
      const length = (30 + phase * 72) * s;
      const alpha = (1 - phase) * (i % 2 ? 0.3 : 0.52);
      ctx.strokeStyle = `rgba(${i % 2 ? '112, 232, 226' : '198, 255, 238'}, ${alpha})`;
      ctx.lineWidth = Math.max(1.2, (2.6 - phase * 1.5) * s);
      ctx.beginPath();
      ctx.moveTo(-5 * s, lane);
      ctx.quadraticCurveTo(-length * 0.55, lane + Math.sin(time * 5 + i) * 6 * s, -length, lane * 0.38);
      ctx.stroke();
    }

    // Little ankle gust and body swirl.
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = 'rgba(172, 250, 232, 0.9)';
    ctx.lineWidth = Math.max(1.2, 1.6 * s);
    for (let i = 0; i < 3; i += 1) {
      const a = time * 5 + i * 2.1;
      ctx.beginPath();
      ctx.ellipse(-6 * s, -3 * s, (20 + i * 10) * s, (5.5 + i * 2) * s, 0, a, a + Math.PI * 1.3);
      ctx.stroke();
    }
    ctx.globalAlpha = 0.28;
    ctx.strokeStyle = 'rgba(220, 255, 246, 0.9)';
    ctx.beginPath();
    ctx.ellipse(0, -34 * s, 20 * s, 8 * s, Math.sin(time * 2) * 0.3, 0, Math.PI * 1.7);
    ctx.stroke();
    ctx.restore();
  }

  // 桃：绿色小加号从头顶缓缓升起。
  function drawHealPlus(fighter, alpha, bodyHeight) {
    if (!fighter || fighter.healRemaining <= 0) return;
    const s = world.scale;
    const time = game.ambientTime;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.shadowColor = 'rgba(76, 255, 132, 0.85)';
    ctx.shadowBlur = 8 * s;
    for (let i = 0; i < 7; i += 1) {
      const phase = (time * 0.62 + i / 7) % 1;
      const rise = -bodyHeight * 0.2 - phase * bodyHeight * 1.2;
      const x = Math.sin(time * 1.8 + i * 1.9) * fighter.radius * 0.8;
      const size = (3.4 + (1 - phase) * 2.2) * s;
      const a = Math.sin(Math.PI * phase) * 0.92 * alpha;
      ctx.fillStyle = `rgba(118, 255, 152, ${a})`;
      ctx.fillRect(x - size * 0.4, rise - size * 1.7, size * 0.8, size * 3.4);
      ctx.fillRect(x - size * 1.7, rise - size * 0.4, size * 3.4, size * 0.8);
    }
    ctx.restore();
  }

  function drawMeditationAura(fighter) {
    const s = world.scale;
    const time = game.ambientTime;
    const palette = fighter.palette;
    ctx.save();
    ctx.translate(fighter.x, fighter.y);
    ctx.globalCompositeOperation = 'lighter';
    const radius = fighter.radius * 1.8;
    const glow = ctx.createRadialGradient(0, -12 * s, 0, 0, -12 * s, radius * 1.6);
    glow.addColorStop(0, fighter.team === 'player' ? 'rgba(109, 230, 193, 0.2)' : 'rgba(238, 153, 121, 0.15)');
    glow.addColorStop(0.7, 'rgba(88, 156, 120, 0.045)');
    glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, -12 * s, radius * 1.6, 0, TAU);
    ctx.fill();

    ctx.strokeStyle = palette.trim;
    ctx.globalAlpha = 0.4;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.ellipse(0, 1 * s, radius, radius * 0.31, 0, 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = 0.23;
    ctx.beginPath();
    ctx.ellipse(0, 1 * s, radius * 0.73, radius * 0.23, 0, 0, TAU);
    ctx.stroke();

    // Rising motes while meditating.
    for (let i = 0; i < 7; i += 1) {
      const baseAngle = (i / 7) * TAU;
      const a = baseAngle + time * 0.28;
      const rising = ((time * (8 + i * 1.8) + i * 13) % 58) * s;
      ctx.fillStyle = `rgba(${fighter.team === 'player' ? '151, 245, 211' : '255, 189, 158'}, ${0.16 + (i % 3) * 0.05})`;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * radius * 0.85, -rising - 3 * s, (0.8 + (i % 3) * 0.5) * s, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawMeditatingBody(fighter) {
    const s = world.scale;
    const palette = fighter.palette;
    ctx.save();
    ctx.translate(0, Math.sin(game.ambientTime * 1.8) * 0.6 * s);

    // Pooled robe.
    const grad = ctx.createRadialGradient(0, -8 * s, 0, 0, -5 * s, 25 * s);
    grad.addColorStop(0, palette.robeMid);
    grad.addColorStop(0.62, palette.robeOuter);
    grad.addColorStop(1, 'rgba(4, 10, 8, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(0, -2 * s, 25 * s, 10 * s, 0, 0, TAU);
    ctx.fill();

    // Crossed legs.
    ctx.strokeStyle = palette.robeOuter;
    ctx.lineWidth = Math.max(3, 5 * s);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-13 * s, -5 * s);
    ctx.quadraticCurveTo(0, -1 * s, 12 * s, -6 * s);
    ctx.stroke();
    ctx.strokeStyle = palette.robeLight;
    ctx.globalAlpha = 0.45;
    ctx.beginPath();
    ctx.moveTo(-8 * s, -7 * s);
    ctx.quadraticCurveTo(0, -3 * s, 8 * s, -8 * s);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Torso.
    ctx.beginPath();
    ctx.moveTo(-9 * s, -11 * s);
    ctx.quadraticCurveTo(-16 * s, -23 * s, -7 * s, -29 * s);
    ctx.quadraticCurveTo(0, -33 * s, 7 * s, -29 * s);
    ctx.quadraticCurveTo(16 * s, -23 * s, 9 * s, -11 * s);
    ctx.closePath();
    ctx.fillStyle = palette.robeMid;
    ctx.fill();
    ctx.strokeStyle = palette.robeOuter;
    ctx.lineWidth = 1;
    ctx.stroke();

    // Hands resting.
    ctx.fillStyle = palette.skin;
    ctx.beginPath();
    ctx.ellipse(-7 * s, -11 * s, 3.7 * s, 2.2 * s, -0.3, 0, TAU);
    ctx.ellipse(7 * s, -11 * s, 3.7 * s, 2.2 * s, 0.3, 0, TAU);
    ctx.fill();

    // Head, slightly bowed.
    ctx.fillStyle = palette.skin;
    ctx.beginPath();
    ctx.ellipse(0, -32 * s, 5.8 * s, 6.6 * s, 0.08, 0, TAU);
    ctx.fill();
    ctx.fillStyle = palette.hair;
    ctx.beginPath();
    ctx.arc(0, -33.5 * s, 6.3 * s, Math.PI * 1.02, Math.PI * 2.04);
    ctx.quadraticCurveTo(5 * s, -28.5 * s, 2.8 * s, -29.3 * s);
    ctx.quadraticCurveTo(0, -30 * s, -4.4 * s, -28.6 * s);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.arc(-1.2 * s, -38.5 * s, 2.7 * s, 0, TAU);
    ctx.fill();

    // Sash.
    ctx.strokeStyle = palette.sash;
    ctx.lineWidth = 1.5 * s;
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.moveTo(-8 * s, -18 * s);
    ctx.quadraticCurveTo(0, -15 * s, 8 * s, -18 * s);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawSword(fighter) {
    const s = world.scale;
    const palette = fighter.palette;
    let angle;
    let handX;
    let handY;
    const bodyHeight = 54 * s;

    if (fighter.swing) {
      const t = clamp(fighter.swing.elapsed / fighter.swing.duration, 0, 1);
      const eased = easeOutCubic(t);
      angle = lerp(fighter.swing.startAngle, fighter.swing.endAngle, eased);
      handX = 3 * s;
      handY = -bodyHeight * 0.53;
    } else {
      handX = 5 * s;
      handY = -bodyHeight * 0.5;
      // Idle sword rests low and angled.
      angle = fighter.facing * 0.2 + 1.15;
    }

    // The whole body is mirrored for a left-facing stance. Convert the desired
    // screen-space sword angle back into that mirrored local space.
    if (Math.cos(fighter.facing) < 0) angle = Math.PI - angle;

    const hand = { x: handX, y: handY };
    const bladeLength = 33 * s;
    const bladeStartX = hand.x + Math.cos(angle) * 8 * s;
    const bladeStartY = hand.y + Math.sin(angle) * 8 * s;
    const bladeEndX = hand.x + Math.cos(angle) * bladeLength;
    const bladeEndY = hand.y + Math.sin(angle) * bladeLength;

    // Arm.
    ctx.strokeStyle = palette.robeLight;
    ctx.lineWidth = Math.max(2.5, 4.6 * s);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(1 * s, -bodyHeight * 0.67);
    ctx.quadraticCurveTo(hand.x + 2 * s, hand.y - 5 * s, hand.x, hand.y);
    ctx.stroke();

    // Hand.
    ctx.fillStyle = palette.skin;
    ctx.beginPath();
    ctx.arc(hand.x, hand.y, 2.5 * s, 0, TAU);
    ctx.fill();

    // Blade glow.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = palette.bladeGlow;
    ctx.globalAlpha = 0.25;
    ctx.lineWidth = Math.max(2.5, 4.4 * s);
    ctx.beginPath();
    ctx.moveTo(bladeStartX, bladeStartY);
    ctx.lineTo(bladeEndX, bladeEndY);
    ctx.stroke();
    ctx.restore();

    const bladeGradient = ctx.createLinearGradient(bladeStartX, bladeStartY, bladeEndX, bladeEndY);
    bladeGradient.addColorStop(0, 'rgba(216, 239, 234, 0.45)');
    bladeGradient.addColorStop(0.65, palette.blade);
    bladeGradient.addColorStop(1, '#f5fbf1');
    ctx.strokeStyle = bladeGradient;
    ctx.lineWidth = Math.max(1.2, 1.8 * s);
    ctx.beginPath();
    ctx.moveTo(bladeStartX, bladeStartY);
    ctx.lineTo(bladeEndX, bladeEndY);
    ctx.stroke();

    // Guard and pommel.
    const guardAngle = angle + Math.PI / 2;
    ctx.strokeStyle = palette.sash;
    ctx.lineWidth = Math.max(1.5, 2.2 * s);
    ctx.beginPath();
    ctx.moveTo(hand.x + Math.cos(guardAngle) * 4.2 * s, hand.y + Math.sin(guardAngle) * 4.2 * s);
    ctx.lineTo(hand.x - Math.cos(guardAngle) * 4.2 * s, hand.y - Math.sin(guardAngle) * 4.2 * s);
    ctx.stroke();
    ctx.fillStyle = palette.sash;
    ctx.beginPath();
    ctx.arc(hand.x - Math.cos(angle) * 6 * s, hand.y - Math.sin(angle) * 6 * s, 1.8 * s, 0, TAU);
    ctx.fill();

    // Sword tassel.
    const tasselX = hand.x - Math.cos(angle) * 4 * s;
    const tasselY = hand.y - Math.sin(angle) * 4 * s;
    ctx.strokeStyle = fighter.team === 'player' ? 'rgba(104, 215, 182, 0.55)' : 'rgba(229, 132, 106, 0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(tasselX, tasselY);
    ctx.quadraticCurveTo(tasselX - 3 * s, tasselY + 8 * s, tasselX + 1 * s + Math.sin(game.ambientTime * 3) * 1.5 * s, tasselY + 15 * s);
    ctx.stroke();
  }

  function drawSwordArc(fighter) {
    const swing = fighter.swing;
    if (!swing) return;
    const s = world.scale;
    const t = clamp(swing.elapsed / swing.duration, 0, 1);
    const fade = 1 - Math.max(0, (t - 0.4) / 0.6);
    if (fade <= 0) return;
    const sweep = swing.elapsed < swing.hitAt
      ? easeOutCubic(swing.elapsed / swing.hitAt) * 0.82
      : lerp(0.82, 1, easeOutCubic((swing.elapsed - swing.hitAt) / (swing.duration - swing.hitAt)));
    const start = swing.startAngle;
    const current = swing.startAngle + (swing.endAngle - swing.startAngle) * sweep;
    const reach = getMeleeReach(fighter);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.translate(0, -12 * s);
    ctx.shadowColor = fighter.team === 'player' ? 'rgba(55, 117, 216, 0.55)' : 'rgba(200, 75, 74, 0.45)';
    ctx.shadowBlur = 18 * s;

    // Broad curved sword light, in deep blue for the player and dark crimson for the enemy.
    const segments = 26;
    for (let i = 0; i < segments; i += 1) {
      const a0 = lerp(start, current, i / segments);
      const a1 = lerp(start, current, (i + 1) / segments);
      const progress = (i + 1) / segments;
      const alpha = fade * (0.09 + progress * 0.28) * (0.76 + 0.24 * Math.sin(progress * Math.PI));
      ctx.strokeStyle = fighter.team === 'player'
        ? `rgba(46, 101, 191, ${alpha})`
        : `rgba(153, 52, 61, ${alpha})`;
      ctx.lineWidth = lerp(5, 22, progress) * s;
      ctx.beginPath();
      ctx.arc(0, 0, reach - (1 - progress) * 6 * s, a0, a1 + 0.013);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;

    // Fine bright edge.
    ctx.strokeStyle = fighter.team === 'player'
      ? `rgba(117, 187, 255, ${0.72 * fade})`
      : `rgba(247, 138, 125, ${0.6 * fade})`;
    ctx.lineWidth = 1.8 * s;
    ctx.beginPath();
    ctx.arc(0, 0, reach + 1.5 * s, start, current);
    ctx.stroke();

    // Deep core arc, deliberately blue as the technique's base color.
    ctx.strokeStyle = `rgba(13, 42, 104, ${0.48 * fade})`;
    ctx.lineWidth = 7 * s;
    ctx.beginPath();
    ctx.arc(0, 0, reach * 0.88, start + 0.09, current - 0.03);
    ctx.stroke();

    // Furthest pale edge, a thin crescent that catches the eye.
    ctx.strokeStyle = `rgba(179, 220, 255, ${0.32 * fade})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, reach * 0.99, start + (current - start) * 0.2, current);
    ctx.stroke();

    // Leading glint.
    const glintX = Math.cos(current) * reach;
    const glintY = Math.sin(current) * reach;
    ctx.fillStyle = `rgba(235, 248, 255, ${0.8 * fade})`;
    ctx.beginPath();
    ctx.arc(glintX, glintY, 2.4 * s, 0, TAU);
    ctx.fill();

    // A short-lived crescent glint near the strike frame, never a filled fan.
    if (swing.elapsed < swing.hitAt + 0.08) {
      const flash = 1 - clamp((swing.elapsed - swing.hitAt) / 0.09, 0, 1);
      if (flash > 0) {
        ctx.strokeStyle = `rgba(190, 225, 255, ${0.3 * flash})`;
        ctx.lineWidth = 2.2 * s;
        ctx.beginPath();
        ctx.arc(0, 0, reach * 0.72, start + (current - start) * 0.55, current);
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  function drawFighterTopMarks(fighter, bodyHeight) {
    if (fighter.hp <= 0) return;
    const s = world.scale;
    ctx.save();
    // Local coordinates: the fighter body has already been translated by the caller.
    ctx.fillStyle = fighter.team === 'player' ? 'rgba(135, 236, 203, 0.6)' : 'rgba(241, 150, 127, 0.58)';
    ctx.beginPath();
    ctx.moveTo(0, -bodyHeight - 19 * s);
    ctx.lineTo(3 * s, -bodyHeight - 15 * s);
    ctx.lineTo(0, -bodyHeight - 11 * s);
    ctx.lineTo(-3 * s, -bodyHeight - 15 * s);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawAfterimages() {
    for (const image of game.afterimages) {
      const alpha = (image.life / image.maxLife) * 0.22;
      ctx.save();
      ctx.translate(image.x, image.y);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = image.palette.robeMid;
      ctx.beginPath();
      ctx.ellipse(0, -22 * world.scale, 9 * world.scale, 22 * world.scale, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = image.palette.trim;
      ctx.beginPath();
      ctx.arc(0, -43 * world.scale, 4.5 * world.scale, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawGroundEffects() {
    // Ground rings and shadows sit below all bodies.
    for (const effect of game.effects) {
      if (effect.type !== 'ring') continue;
      const progress = 1 - effect.life / effect.maxLife;
      ctx.save();
      ctx.globalAlpha = (1 - progress) * 0.35;
      ctx.strokeStyle = effect.color;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.ellipse(effect.x, effect.y, effect.size * (0.4 + progress), effect.size * (0.14 + progress * 0.34), 0, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawProjectile(projectile) {
    if (projectile.dead) return;
    const s = world.scale;
    const yOffset = -16 * s;
    const trail = projectile.trail;
    ctx.save();

    // Colored trail, matched to the spirit orb. Two layers keep it legible
    // against both the dark stone and busy foreground cover.
    if (trail.length > 1) {
      ctx.globalCompositeOperation = 'lighter';
      for (let pass = 0; pass < 2; pass += 1) {
        for (let i = trail.length - 1; i > 0; i -= 1) {
          const p0 = trail[i];
          const p1 = trail[i - 1];
          const falloff = 1 - i / trail.length;
          const alpha = falloff * (pass === 0 ? 0.13 : 0.52);
          ctx.strokeStyle = pass === 0
            ? hexToRgba(projectile.color, alpha)
            : hexToRgba(projectile.color, alpha);
          ctx.lineWidth = Math.max(1, (pass === 0 ? 9 : 3.2) * falloff * s);
          ctx.beginPath();
          ctx.moveTo(p0.x, p0.y + yOffset);
          ctx.lineTo(p1.x, p1.y + yOffset);
          ctx.stroke();
        }
      }
      // A traveling ribbon of color just behind the orb.
      const last = trail[0];
      const tail = trail[Math.min(7, trail.length - 1)];
      const ribbon = ctx.createLinearGradient(last.x, last.y + yOffset, tail.x, tail.y + yOffset);
      ribbon.addColorStop(0, hexToRgba(projectile.softColor, 0.58));
      ribbon.addColorStop(0.34, hexToRgba(projectile.color, 0.34));
      ribbon.addColorStop(1, hexToRgba(projectile.color, 0));
      ctx.strokeStyle = ribbon;
      ctx.lineWidth = Math.max(1.5, 2.8 * s);
      ctx.beginPath();
      ctx.moveTo(last.x, last.y + yOffset);
      ctx.lineTo(tail.x, tail.y + yOffset);
      ctx.stroke();
      // A few colored motes make the trail readable on any background.
      for (let i = 3; i < trail.length; i += 6) {
        const p = trail[i];
        const falloff = 1 - i / trail.length;
        ctx.fillStyle = hexToRgba(projectile.softColor, 0.14 + falloff * 0.24);
        ctx.beginPath();
        ctx.arc(p.x, p.y + yOffset, (1 + falloff * 1.7) * s, 0, TAU);
        ctx.fill();
      }
    }

    ctx.translate(projectile.x, projectile.y + yOffset);
    ctx.globalCompositeOperation = 'lighter';
    const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, projectile.radius * 5.2);
    halo.addColorStop(0, hexToRgba(projectile.softColor, 0.38));
    halo.addColorStop(0.3, hexToRgba(projectile.color, 0.2));
    halo.addColorStop(1, hexToRgba(projectile.color, 0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, 0, projectile.radius * 5.2, 0, TAU);
    ctx.fill();

    // Orbiting rune ring.
    ctx.strokeStyle = hexToRgba(projectile.softColor, 0.28);
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.ellipse(0, 0, projectile.radius * 1.9, projectile.radius * 0.9, game.ambientTime * 2.4, 0, TAU);
    ctx.stroke();

    ctx.fillStyle = projectile.color;
    ctx.beginPath();
    ctx.arc(0, 0, projectile.radius * 1.55, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#f0fbff';
    ctx.beginPath();
    ctx.arc(0, 0, projectile.radius * 0.8, 0, TAU);
    ctx.fill();
    ctx.restore();

    // Tiny ground glint below the flying orb.
    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = projectile.color;
    ctx.beginPath();
    ctx.ellipse(projectile.x, projectile.y, projectile.radius * 2.2, projectile.radius * 0.5, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function hexToRgba(hex, alpha) {
    if (!hex || hex[0] !== '#') return `rgba(200, 200, 200, ${alpha})`;
    let value = hex.slice(1);
    if (value.length === 3) value = value.split('').map((c) => c + c).join('');
    const r = parseInt(value.slice(0, 2), 16);
    const g = parseInt(value.slice(2, 4), 16);
    const b = parseInt(value.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function drawEffects() {
    ctx.save();
    for (const effect of game.effects) {
      if (effect.type === 'ring') continue;
      const lifeRatio = clamp(effect.life / effect.maxLife, 0, 1);
      const yOffset = effect.type === 'wind' ? -10 * world.scale : 0;
      ctx.globalAlpha = lifeRatio;
      if (effect.type === 'spark') {
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = effect.color;
        ctx.lineWidth = Math.max(0.8, effect.size * 0.55);
        ctx.beginPath();
        ctx.moveTo(effect.x, effect.y + yOffset);
        ctx.lineTo(effect.x - effect.vx * 0.025, effect.y + yOffset - effect.vy * 0.025);
        ctx.stroke();
      } else if (effect.type === 'wind') {
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = hexToRgba(effect.color, lifeRatio * 0.28);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(effect.x, effect.y + yOffset);
        ctx.quadraticCurveTo(
          effect.x - effect.vx * 0.05,
          effect.y + yOffset - 6 * world.scale,
          effect.x - effect.vx * 0.15,
          effect.y + yOffset - 2 * world.scale
        );
        ctx.stroke();
      } else if (effect.type === 'ink') {
        ctx.fillStyle = hexToRgba(effect.color, lifeRatio * 0.6);
        ctx.beginPath();
        ctx.ellipse(effect.x, effect.y, effect.size, effect.size * 0.45, Math.atan2(effect.vy, effect.vx), 0, TAU);
        ctx.fill();
      } else if (effect.type === 'dust') {
        ctx.fillStyle = hexToRgba(effect.color, lifeRatio * 0.22);
        ctx.beginPath();
        ctx.arc(effect.x, effect.y, effect.size, 0, TAU);
        ctx.fill();
      } else if (effect.type === 'slashFlash') {
        ctx.globalCompositeOperation = 'lighter';
        const radius = effect.size * (1.2 - lifeRatio * 0.2);
        ctx.strokeStyle = hexToRgba(effect.color, lifeRatio * 0.42);
        ctx.lineWidth = 2 * lifeRatio;
        ctx.beginPath();
        ctx.arc(effect.x, effect.y, radius, -0.7, 1.4);
        ctx.stroke();
      } else if (effect.type === 'clashFlash') {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.translate(effect.x, effect.y);
        const progress = 1 - lifeRatio;
        const scale = 0.7 + progress * 0.5;
        const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, effect.size * scale);
        glow.addColorStop(0, `rgba(255, 248, 208, ${lifeRatio * 0.65})`);
        glow.addColorStop(0.32, `rgba(255, 221, 128, ${lifeRatio * 0.22})`);
        glow.addColorStop(1, 'rgba(255, 214, 120, 0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(0, 0, effect.size * scale, 0, TAU);
        ctx.fill();
        for (let i = 0; i < 4; i += 1) {
          const angle = (i / 4) * TAU + 0.35;
          ctx.strokeStyle = `rgba(255, 239, 181, ${lifeRatio * 0.5})`;
          ctx.lineWidth = (2.2 - progress * 1.4) * world.scale;
          ctx.beginPath();
          ctx.moveTo(Math.cos(angle) * effect.size * 0.28, Math.sin(angle) * effect.size * 0.28);
          ctx.lineTo(Math.cos(angle) * effect.size * scale, Math.sin(angle) * effect.size * scale);
          ctx.stroke();
        }
        ctx.restore();
      }
    }
    ctx.restore();
  }

  function drawFloaters() {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const floater of game.floaters) {
      const ratio = clamp(floater.life / floater.maxLife, 0, 1);
      ctx.globalAlpha = Math.min(1, ratio * 2.2);
      ctx.font = `700 ${floater.size}px ${getCanvasSerif()}`;
      ctx.strokeStyle = 'rgba(3, 8, 6, 0.72)';
      ctx.lineWidth = Math.max(2, floater.size * 0.14);
      ctx.strokeText(floater.text, floater.x, floater.y);
      ctx.fillStyle = floater.color;
      ctx.fillText(floater.text, floater.x, floater.y);
    }
    ctx.restore();
  }

  function renderGame() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, viewW, viewH);
    drawBackdrop(game.ambientTime);

    const shakeAmount = game.shake;
    const shakeX = shakeAmount > 0.1 ? (Math.random() - 0.5) * shakeAmount : 0;
    const shakeY = shakeAmount > 0.1 ? (Math.random() - 0.5) * shakeAmount : 0;

    ctx.save();
    ctx.translate(shakeX, shakeY);

    drawArena(game.ambientTime);
    drawGroundEffects();
    drawAfterimages();
    if (game.player) drawFighterBuffs(game.player);
    if (game.enemy) drawFighterBuffs(game.enemy);

    if (game.player) drawShadow(game.player);
    if (game.enemy) drawShadow(game.enemy);
    for (const obstacle of world.obstacles) {
      ctx.save();
      ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
      ctx.beginPath();
      ctx.ellipse(obstacle.x, obstacle.y + 2 * world.scale, obstacle.radius * 1.1, obstacle.radius * 0.24, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    const drawables = [];
    for (const obstacle of world.obstacles) {
      drawables.push({ type: 'obstacle', y: obstacle.y, ref: obstacle });
    }
    if (game.player) drawables.push({ type: 'fighter', y: game.player.y, ref: game.player });
    if (game.enemy) drawables.push({ type: 'fighter', y: game.enemy.y, ref: game.enemy });
    for (const projectile of game.projectiles) {
      drawables.push({ type: 'projectile', y: projectile.y, ref: projectile });
    }
    drawables.sort((a, b) => a.y - b.y);

    for (const item of drawables) {
      if (item.type === 'obstacle') {
        drawObstacle(item.ref);
      } else if (item.type === 'fighter') {
        drawFighter(item.ref);
      } else {
        drawProjectile(item.ref);
      }
    }

    drawGiantSwords();
    drawEffects();
    drawFloaters();
    drawCastBar(game.player);
    drawCastBar(game.enemy);

    if (game.playerHurtFlash > 0.01) {
      ctx.save();
      const flash = ctx.createRadialGradient(
        viewW / 2,
        viewH / 2,
        Math.min(viewW, viewH) * 0.2,
        viewW / 2,
        viewH / 2,
        Math.max(viewW, viewH) * 0.72
      );
      flash.addColorStop(0, 'rgba(115, 21, 15, 0)');
      flash.addColorStop(0.7, `rgba(145, 32, 23, ${game.playerHurtFlash * 0.16})`);
      flash.addColorStop(1, `rgba(185, 47, 32, ${game.playerHurtFlash * 0.28})`);
      ctx.fillStyle = flash;
      ctx.fillRect(0, 0, viewW, viewH);
      ctx.restore();
    }

    ctx.restore();

    // Inner vignette to settle the canvas into the page.
    const edge = ctx.createRadialGradient(
      viewW / 2,
      viewH * 0.48,
      Math.min(viewW, viewH) * 0.26,
      viewW / 2,
      viewH * 0.48,
      Math.max(viewW, viewH) * 0.72
    );
    edge.addColorStop(0, 'rgba(0, 0, 0, 0)');
    edge.addColorStop(0.76, 'rgba(0, 0, 0, 0.08)');
    edge.addColorStop(1, 'rgba(0, 0, 0, 0.38)');
    ctx.fillStyle = edge;
    ctx.fillRect(0, 0, viewW, viewH);
  }

  /* =======================================================================
     09. HUD、设置、界面与初始化
     ======================================================================= */

  // BUFF 栏固定定义：只有这四种图标可能出现；顺手牵羊是一次性技能，永远不显示。
  const BUFF_BAR_DEFS = Object.freeze({
    haste: { glyph: '疾', label: '轻身术' },
    heal: { glyph: '桃', label: '桃' },
    blood: { glyph: '血', label: '嗜血' },
    stun: { glyph: '晕', label: '眩晕' },
  });

  // 当前增益/减益列表：嗜血、桃、轻身术为增益；眩晕为减益。
  function buffEntries(fighter) {
    if (!fighter) return [];
    const list = [];
    if (fighter.speedBoostTimer > 0) {
      list.push({ kind: 'haste', seconds: fighter.speedBoostTimer });
    }
    if (fighter.healRemaining > 0) {
      list.push({ kind: 'heal', seconds: fighter.healRemaining });
    }
    if (fighter.damageBoostTimer > 0) {
      list.push({ kind: 'blood', seconds: fighter.damageBoostTimer });
    }
    if (fighter.stunRemaining > 0) {
      list.push({ kind: 'stun', seconds: fighter.stunRemaining });
    }
    return list;
  }

  function renderBuffBar(container, fighter) {
    if (!container) return;
    // 图标与文字只从固定定义表取，顺手牵羊等一次性技能不可能出现在这里。
    const entries = buffEntries(fighter)
      .filter((entry) => Object.prototype.hasOwnProperty.call(BUFF_BAR_DEFS, entry.kind))
      .map((entry) => {
        const def = BUFF_BAR_DEFS[entry.kind];
        return { kind: entry.kind, seconds: entry.seconds, glyph: def.glyph, label: def.label };
      });
    const signature = `${entries.length}|${entries
      .map((entry) => `${entry.kind}:${Math.ceil(entry.seconds)}`)
      .join('|')}`;
    if (container.dataset.signature === signature) return;
    container.dataset.signature = signature;
    if (entries.length === 0) {
      container.textContent = '';
      return;
    }
    const fragment = document.createDocumentFragment();
    for (const entry of entries) {
      const chip = document.createElement('span');
      chip.className = 'buff-chip';
      chip.dataset.kind = entry.kind;
      chip.title = `${entry.label} · ${entry.seconds.toFixed(1)} 秒`;
      const glyph = document.createElement('span');
      glyph.className = 'buff-glyph';
      glyph.textContent = entry.glyph;
      const time = document.createElement('span');
      time.className = 'buff-time';
      time.textContent = `${Math.ceil(entry.seconds)}s`;
      chip.append(glyph, time);
      fragment.appendChild(chip);
    }
    container.textContent = '';
    container.appendChild(fragment);
  }

  function updateHud(force = false) {
    if (!game.player || !game.enemy) return;
    const player = game.player;
    const enemy = game.enemy;
    const local = isOnlineGuest() ? enemy : player;

    const playerHpPercent = clamp((player.hp / player.maxHp) * 100, 0, 100);
    const enemyHpPercent = clamp((enemy.hp / enemy.maxHp) * 100, 0, 100);
    const playerManaPercent = clamp((player.mana / player.maxMana) * 100, 0, 100);
    const enemyManaPercent = clamp((enemy.mana / enemy.maxMana) * 100, 0, 100);

    dom.playerHpFill.style.width = `${playerHpPercent}%`;
    dom.enemyHpFill.style.width = `${enemyHpPercent}%`;
    dom.playerManaFill.style.width = `${playerManaPercent}%`;
    dom.enemyManaFill.style.width = `${enemyManaPercent}%`;
    setText(dom.playerHpText, `${Math.ceil(player.hp)} / ${player.maxHp}`);
    setText(dom.enemyHpText, `${Math.ceil(enemy.hp)} / ${enemy.maxHp}`);
    setText(dom.playerManaText, `${Math.floor(player.mana)} / ${player.maxMana}`);
    setText(dom.enemyManaText, `${Math.floor(enemy.mana)} / ${enemy.maxMana}`);
    renderBuffBar(dom.playerBuffs, player);
    renderBuffBar(dom.enemyBuffs, enemy);

    setText(
      dom.playerState,
      player.hp <= 0
        ? '道消'
        : player.stunRemaining > 0
          ? '眩晕'
          : player.throwRemaining > 0
            ? '被掷'
            : player.rootTimer > 0
              ? '打坐'
            : player.dodgeRemaining > 0
              ? '闪身'
              : player.healRemaining > 0
                ? '回春'
                : player.speedBoostTimer > 0
                  ? '疾行'
                  : '凝神'
    );
    let enemyStateText = '观势';
    if (enemy.hp <= 0) {
      enemyStateText = '道消';
    } else if (enemy.stunRemaining > 0) {
      enemyStateText = '眩晕';
    } else if (enemy.throwRemaining > 0) {
      enemyStateText = '被掷';
    } else if (enemy.rootTimer > 0) {
      enemyStateText = '打坐';
    } else if (game.ai) {
      switch (game.ai.mode) {
        case 'pursue':
          enemyStateText = '逼近';
          break;
        case 'attack':
          enemyStateText = '出招';
          break;
        case 'strafe':
          enemyStateText = '游身';
          break;
        case 'hide':
          enemyStateText = '退守';
          break;
        case 'evade':
          enemyStateText = '游斗';
          break;
        default:
          enemyStateText = '观势';
      }
    }
    setText(dom.enemyState, enemyStateText);

    if (game.online.active) {
      const onlineState = (fighter, isLocal) => {
        if (!fighter) return '观势';
        if (fighter.hp <= 0) return '道消';
        if (fighter.stunRemaining > 0) return '眩晕';
        if (fighter.dodgeRemaining > 0) return '闪身';
        return isLocal ? '斗法' : '道友';
      };
      setText(dom.playerState, onlineState(player, !isOnlineGuest()));
      setText(dom.enemyState, onlineState(enemy, isOnlineGuest()));
    }

    setText(dom.playerEssenceChip, `${player.essence}`);
    setText(dom.enemyEssenceChip, `${enemy.essence}`);
    updateQuickActions(local);
    updateCardHud(local);
    updateStealPlusBadges();

    if (game.online.active && game.online.code) {
      const transport = game.online.rtc.ready
        ? '直连'
        : game.online.rtc.pc
          ? '连接中'
          : '中继';
      const rtt = game.online.rtt > 0 ? ` ${Math.round(game.online.rtt)}ms` : '';
      setText(dom.memoryNote, `联机 · ${transport}${rtt} · ${game.online.code}`);
    } else {
      const memory = getPlayerProfile();
      setText(
        dom.memoryNote,
        memory.matches > 0 ? `对手已观 ${memory.matches} 战` : '山门论剑'
      );
    }

    if (!force) {
      // Keep the numeric HUD in sync even for fractional values; cheap enough at 60fps.
    }
  }

  /* ------------------------------ 卡牌与精魄 ------------------------------ */

  function cardById(id) {
    return CARD_LIBRARY[id] || null;
  }

  function ensureEssencePips() {
    if (!dom.essencePips || dom.essencePips.children.length === CONFIG.essenceMax) return;
    dom.essencePips.textContent = '';
    for (let i = 0; i < CONFIG.essenceMax; i += 1) {
      const pip = document.createElement('i');
      pip.className = 'essence-pip';
      dom.essencePips.appendChild(pip);
    }
  }

  function shuffleArray(list) {
    for (let i = list.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const temp = list[i];
      list[i] = list[j];
      list[j] = temp;
    }
    return list;
  }

  function initCards() {
    ensureEssencePips();
    // 每局开始时把双方牌库重新洗牌；每个槽位预抽一张「下一张」，出牌后由它顶上。
    game.cards = { deck: shuffleArray(CARD_DECK.slice()), hand: [], preview: [] };
    game.enemyCards = { deck: shuffleArray(CARD_DECK_AI.slice()), hand: [], preview: [] };
    for (let i = 0; i < CARD_HAND_SIZE; i += 1) {
      if (game.cards.deck.length > 0) game.cards.hand.push(game.cards.deck.shift());
      if (game.enemyCards.deck.length > 0) game.enemyCards.hand.push(game.enemyCards.deck.shift());
    }
    for (let i = 0; i < CARD_HAND_SIZE; i += 1) {
      game.cards.preview.push(game.cards.deck.length > 0 ? game.cards.deck.shift() : null);
      game.enemyCards.preview.push(game.enemyCards.deck.length > 0 ? game.enemyCards.deck.shift() : null);
    }
    if (game.player) game.player.stealPlusTimers = [];
    if (game.enemy) game.enemy.stealPlusTimers = [];
    renderCardHand();
  }

  function handState(fighter) {
    return fighter && fighter.team === 'enemy' ? game.enemyCards : game.cards;
  }

  function localCardState() {
    return isOnlineGuest() ? game.enemyCards : game.cards;
  }

  function otherFighter(fighter) {
    return fighter === game.player ? game.enemy : game.player;
  }

  // 可被顺手牵羊偷走的增益：嗜血、桃、轻身术。
  function hasStealableBuff(fighter) {
    return Boolean(
      fighter &&
      (fighter.speedBoostTimer > 0 || fighter.healRemaining > 0 || fighter.damageBoostTimer > 0)
    );
  }

  // 随机偷一个增益：从对手身上移除，并在自己身上以「完整持续时间」重新生效（会重置持续时间）。
  // 标记某个增益「刚刚获得」，顺手牵羊按这个序号偷最新拿到的那个。
  function markBuffApplied(fighter, kind) {
    if (!fighter || !fighter.buffAppliedAt) return;
    game.buffSerial += 1;
    fighter.buffAppliedAt[kind] = game.buffSerial;
  }

  function applyWindBuff(fighter, duration) {
    if (!fighter) return;
    fighter.speedBoostTimer = duration;
    markBuffApplied(fighter, 'speed');
    if (fighter.stunRemaining > 0) {
      fighter.stunRemaining = 0;
      spawnFloater(fighter.x, fighter.y - 74 * world.scale, '解晕', '#ffe6a8', 0.8, 14);
      if (fighter === game.player) showToast('轻身术解除了眩晕', '', 1000);
    }
  }

  function stealOneBuff(fighter) {
    const opponent = otherFighter(fighter);
    if (!opponent) return null;
    const options = [];
    if (opponent.speedBoostTimer > 0) options.push('speed');
    if (opponent.healRemaining > 0) options.push('heal');
    if (opponent.damageBoostTimer > 0) options.push('blood');
    if (options.length === 0) return null;
    // 固定偷「最新获得」的增益；时间序号相同（理论上不会）时按顺序取第一个。
    let pick = options[0];
    let newest = -1;
    for (const kind of options) {
      const appliedAt = (opponent.buffAppliedAt && opponent.buffAppliedAt[kind]) || 0;
      if (appliedAt > newest) {
        newest = appliedAt;
        pick = kind;
      }
    }
    if (pick === 'speed') {
      opponent.speedBoostTimer = 0;
      applyWindBuff(fighter, CARD_LIBRARY.wind.duration);
      return '轻身术';
    }
    if (pick === 'heal') {
      fighter.healRemaining = CARD_LIBRARY.heal.duration;
      fighter.healRate = CARD_LIBRARY.heal.healPerSecond;
      opponent.healRemaining = 0;
      markBuffApplied(fighter, 'heal');
      return '桃';
    }
    fighter.damageBoostTimer = CARD_LIBRARY.blood.duration;
    opponent.damageBoostTimer = 0;
    markBuffApplied(fighter, 'blood');
    return '嗜血';
  }

  function canPlayCard(fighter, card) {
    if (!fighter || !card || !canUseCards(fighter) || fighter.essence < card.cost) return false;
    // 桃一局最多 3 次。
    if (card.id === 'heal' && fighter.healUses >= CONFIG.healUsesPerMatch) return false;
    // 顺手牵羊：对手没有增益时不能出。
    if ((card.id === 'steal' || card.id === 'stealPlus') && !hasStealableBuff(otherFighter(fighter))) return false;
    return true;
  }

  function renderCardHand() {
    if (!dom.cardHand) return;
    const state = localCardState();
    const hand = state && Array.isArray(state.hand) ? state.hand : [];
    const player = getLocalFighter();
    const cardKeys = [1, 2, 3, 4, 5].map((i) => game.bindings[`card${i}`]).join(',');
    const signature = `${hand.join('|')}#${cardKeys}`;
    if (game.cardDrag || game.online.cardSignature === signature) return;
    game.online.cardSignature = signature;
    dom.cardHand.textContent = '';
    const fragment = document.createDocumentFragment();
    hand.forEach((id, index) => {
      const card = cardById(id);
      if (!card) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'game-card';
      button.dataset.card = id;
      button.dataset.slot = `${index}`;
      if (card.temporary) button.classList.add('is-temporary');
      button.style.setProperty('--tone', card.tone);
      const healExhausted = card.id === 'heal' && player && player.healUses >= CONFIG.healUsesPerMatch;
      const stealBlocked =
        (card.id === 'steal' || card.id === 'stealPlus') && player && !hasStealableBuff(otherFighter(player));
      const keyCode = game.bindings[`card${index + 1}`];
      button.setAttribute(
        'aria-label',
        `${card.name}，${card.cost} 费，快捷键 ${bindingLabel(keyCode)}：${card.text}${healExhausted ? '（本局已用尽）' : ''}`
      );
      if (!player || player.essence < card.cost || game.mode !== 'battle' || healExhausted || stealBlocked) {
        button.classList.add('is-unaffordable');
      }
      const keycap = document.createElement('span');
      keycap.className = 'keycap card-keycap';
      keycap.textContent = bindingGlyph(keyCode);
      keycap.title = `快捷键 ${bindingLabel(keyCode)}`;
      keycap.setAttribute('aria-hidden', 'true');
      const cost = document.createElement('span');
      cost.className = 'card-cost';
      cost.textContent = `${card.cost}`;
      const art = document.createElement('span');
      art.className = 'card-art';
      art.textContent = card.art;
      const name = document.createElement('span');
      name.className = 'card-name';
      name.textContent = card.name;
      const text = document.createElement('span');
      text.className = 'card-text';
      text.textContent =
        card.id === 'heal' && player
          ? `${card.text}（已用 ${player.healUses}/${CONFIG.healUsesPerMatch}）`
          : card.text;
      button.append(keycap, cost, art, name, text);
      if (card.temporary) {
        const timer = document.createElement('span');
        timer.className = 'card-timer';
        button.appendChild(timer);
      }
      fragment.appendChild(button);
    });
    dom.cardHand.appendChild(fragment);
  }

  function updateQuickActions(local) {
    if (!local || !dom.dodgeBtn) return;
    const ready = local.dodgeCooldown <= 0.001 && local.dodgeRemaining <= 0;
    dom.dodgeBtn.classList.toggle('is-empty', !ready);
    setText(
      dom.dodgeCd,
      local.dodgeRemaining > 0
        ? '冲刺'
        : local.dodgeCooldown > 0
          ? `${local.dodgeCooldown.toFixed(1)}s`
          : '就绪'
    );

    const counterReady = (local.counterCooldown || 0) <= 0.001;
    if (dom.counterBtn) dom.counterBtn.classList.toggle('is-empty', !counterReady);
    setText(dom.counterCd, counterReady ? '就绪' : `${(local.counterCooldown || 0).toFixed(1)}s`);
  }

  function updateStealPlusBadges() {
    if (!dom.cardHand) return;
    const local = getLocalFighter();
    if (!local) return;
    const timers = Array.isArray(local.stealPlusTimers) ? local.stealPlusTimers : [];
    for (const element of dom.cardHand.querySelectorAll('.game-card')) {
      if (element.dataset.card !== 'stealPlus') continue;
      const slot = Number(element.dataset.slot);
      const badge = element.querySelector('.card-timer');
      if (!badge) continue;
      const timer = timers.find((entry) => entry.slot === slot);
      badge.textContent = timer ? `${Math.max(0, timer.remaining).toFixed(1)}s` : '';
    }
  }

  function updateCardHud(local) {
    ensureEssencePips();
    setText(dom.essenceValue, `${local ? local.essence : 0}`);
    if (dom.essencePips) {
      const pips = dom.essencePips.children;
      for (let i = 0; i < pips.length; i += 1) {
        pips[i].classList.toggle('is-filled', Boolean(local) && i < local.essence);
      }
    }
    if (!localCardState()) initCards();
    if (!dom.cardHand) return;
    for (const element of dom.cardHand.querySelectorAll('.game-card')) {
      const card = cardById(element.dataset.card);
      const healExhausted = Boolean(
        card && card.id === 'heal' && local && local.healUses >= CONFIG.healUsesPerMatch
      );
      const stealBlocked = Boolean(
        card &&
          (card.id === 'steal' || card.id === 'stealPlus') &&
          local &&
          !hasStealableBuff(otherFighter(local))
      );
      const affordable = Boolean(
        local &&
          card &&
          local.essence >= card.cost &&
          game.mode === 'battle' &&
          !healExhausted &&
          !stealBlocked
      );
      element.classList.toggle('is-unaffordable', !affordable);
    }
  }

  function addStealPlusTimer(fighter, slot) {
    if (!fighter) return;
    if (!Array.isArray(fighter.stealPlusTimers)) fighter.stealPlusTimers = [];
    fighter.stealPlusTimers = fighter.stealPlusTimers.filter((timer) => timer.slot !== slot);
    fighter.stealPlusTimers.push({ slot, remaining: CONFIG.stealPlusDuration });
  }

  function removeStealPlusTimer(fighter, slot) {
    if (!fighter || !Array.isArray(fighter.stealPlusTimers)) return;
    fighter.stealPlusTimers = fighter.stealPlusTimers.filter((timer) => timer.slot !== slot);
  }

  function shiftStealPlusTimers(fighter, removedSlot) {
    if (!fighter || !Array.isArray(fighter.stealPlusTimers)) return;
    for (const timer of fighter.stealPlusTimers) {
      if (timer.slot > removedSlot) timer.slot -= 1;
    }
  }

  // 顺手牵羊+ 到期：销毁临时牌，并从牌库里随机刷一张牌补到同一槽位。
  function expireStealPlus(fighter, slot) {
    const state = handState(fighter);
    if (!state) return;
    const timers = Array.isArray(fighter.stealPlusTimers) ? fighter.stealPlusTimers : [];
    const timerIndex = timers.findIndex((timer) => timer.slot === slot);
    if (timerIndex >= 0) timers.splice(timerIndex, 1);
    if (!Array.isArray(state.hand) || state.hand[slot] !== 'stealPlus') return;

    if (state.deck.length > 0) {
      const pick = Math.floor(Math.random() * state.deck.length);
      state.hand[slot] = state.deck.splice(pick, 1)[0];
    } else {
      state.hand.splice(slot, 1);
      if (Array.isArray(state.preview)) state.preview.splice(slot, 1);
      shiftStealPlusTimers(fighter, slot);
    }

    if (fighter === game.player) {
      renderCardHand();
      showToast('顺手牵羊+ 已销毁，刷新一张牌', '', 1100);
      if (
        game.cardDrag &&
        game.cardDrag.element &&
        game.cardDrag.element.dataset.card === 'stealPlus' &&
        Number(game.cardDrag.element.dataset.slot) === slot
      ) {
        if (game.cardDrag.ghost) game.cardDrag.ghost.remove();
        game.cardDrag.element.classList.remove('is-dragging');
        game.cardDrag = null;
      }
    }
  }

  function consumeCardFromHand(fighter, cardId) {
    const state = handState(fighter);
    if (!state) return;
    const index = state.hand.indexOf(cardId);
    if (index < 0) return;
    const previews = Array.isArray(state.preview) ? state.preview : null;

    if (cardId === 'stealPlus') {
      // 临时牌销毁，绝不进入牌库；同槽位按正常规则由预抽牌顶上。
      removeStealPlusTimer(fighter, index);
      const promoted = previews ? previews[index] : null;
      if (promoted) {
        state.hand[index] = promoted;
      } else {
        state.hand.splice(index, 1);
        shiftStealPlusTimers(fighter, index);
      }
      if (previews) {
        if (promoted) {
          previews[index] = state.deck.length > 0 ? state.deck.shift() : null;
        } else {
          previews.splice(index, 1);
        }
      }
    } else {
      // 打出的普通牌沉到牌库底。
      state.deck.push(cardId);
      if (cardId === 'steal') {
        // 顺手牵羊发动后，同一槽位留下临时牌「顺手牵羊+」；预抽位保留。
        state.hand[index] = 'stealPlus';
        addStealPlusTimer(fighter, index);
      } else {
        const promoted = previews ? previews[index] : null;
        if (promoted) {
          // 每个槽位有自己的「下一张」，出牌后由它顶上。
          state.hand[index] = promoted;
        } else {
          state.hand.splice(index, 1);
          shiftStealPlusTimers(fighter, index);
        }
        if (previews) {
          if (promoted) {
            previews[index] = state.deck.length > 0 ? state.deck.shift() : null;
          } else {
            previews.splice(index, 1);
          }
        }
      }
    }
    if (fighter === game.player) renderCardHand();
  }

  // 把某张牌从本局的手牌、预告与牌库里彻底移除（下一局 initCards 会重新加载整套卡组）。
  function purgeCardFromPool(fighter, cardId) {
    const state = handState(fighter);
    if (!state) return;
    for (let i = state.deck.length - 1; i >= 0; i -= 1) {
      if (state.deck[i] === cardId) state.deck.splice(i, 1);
    }
    const previews = Array.isArray(state.preview) ? state.preview : null;
    const keptCards = [];
    const keptPreviews = [];
    const removedIndices = [];
    for (let i = 0; i < state.hand.length; i += 1) {
      if (state.hand[i] === cardId) {
        removedIndices.push(i);
        continue;
      }
      const preview = previews ? previews[i] : null;
      keptCards.push(state.hand[i]);
      if (previews) {
        // 预告位若也是这张牌，就从牌库补一张新的预告。
        keptPreviews.push(
          preview && preview !== cardId ? preview : state.deck.length > 0 ? state.deck.shift() : null
        );
      }
    }
    state.hand = keptCards;
    if (previews) state.preview = keptPreviews;
    if (Array.isArray(fighter.stealPlusTimers)) {
      fighter.stealPlusTimers = fighter.stealPlusTimers
        .map((timer) => ({
          ...timer,
          slot: timer.slot - removedIndices.filter((i) => i < timer.slot).length,
        }))
        .filter((timer) => state.hand[timer.slot] === 'stealPlus');
    }
    if (fighter === game.player) renderCardHand();
  }

  function playCard(fighter, card, targetPoint) {
    if (!fighter || !card || !canPlayCard(fighter, card)) {
      if (fighter === game.player) {
        if (card && card.id === 'heal' && fighter.healUses >= CONFIG.healUsesPerMatch) {
          showToast('桃本局已用尽（最多 3 次）', 'warn', 1200);
        } else if (card && (card.id === 'steal' || card.id === 'stealPlus')) {
          showToast('对手没有可偷取的增益（无事发生）', 'warn', 1100);
        } else {
          showToast(playerEssenceShort(fighter, card) ? '精魄不足' : '此刻无法出牌', 'warn', 1100);
        }
      }
      return false;
    }
    if ((card.id === 'steal' || card.id === 'stealPlus') && !hasStealableBuff(otherFighter(fighter))) {
      if (fighter === game.player) showToast('对手没有可偷取的增益（无事发生）', 'warn', 1100);
      return false;
    }
    fighter.essence -= card.cost;
    fighter.meditationTimer = 0;
    fighter.stats.cardsPlayed += 1;
    if (fighter === game.player) game.match.cardsPlayed += 1;
    if (card.id === 'heal') fighter.healUses += 1;
    let consume = true;

    if (card.id === 'greatsword') {
      const x = clamp(targetPoint ? targetPoint.x : fighter.x, world.play.x, world.play.x + world.play.w);
      const y = clamp(targetPoint ? targetPoint.y : fighter.y, world.play.y, world.play.y + world.play.h);
      game.giantSwords.push({
        x,
        y,
        radius: card.radius * world.scale,
        delay: card.delay,
        elapsed: 0,
        struck: false,
        life: 1.5,
        team: fighter.team,
        damage: card.damage,
        owner: fighter,
      });
      spawnRipple(x, y, '#ffe0a0', 0.5, card.radius * world.scale);
      spawnFloater(x, y - 16 * world.scale, '巨剑术', '#ffe9b0', 0.8, 14);
    } else if (card.id === 'wind') {
      applyWindBuff(fighter, card.duration);
      spawnRipple(fighter.x, fighter.y, '#9fe8d6', 0.45, fighter.radius * 2);
      spawnFloater(fighter.x, fighter.y - 58 * world.scale, '轻身', '#b8f0e0', 0.9, 14);
    } else if (card.id === 'heal') {
      fighter.healRemaining = card.duration;
      fighter.healRate = card.healPerSecond;
      markBuffApplied(fighter, 'heal');
      spawnRipple(fighter.x, fighter.y, '#f0b6b6', 0.45, fighter.radius * 2);
      spawnFloater(fighter.x, fighter.y - 58 * world.scale, '桃', '#ffd0d0', 0.9, 14);
    } else if (card.id === 'goldfinger') {
      // 金手指：当前手牌与预告全部洗回牌库，再重新摸满手牌与预告。
      // 顺手牵羊+ 是临时牌，绝不进入牌库。
      const state = handState(fighter);
      state.deck.push(...state.hand.filter((id) => id !== 'stealPlus'));
      if (Array.isArray(state.preview)) {
        state.deck.push(...state.preview.filter(Boolean));
        state.preview.length = 0;
      }
      state.hand.length = 0;
      fighter.stealPlusTimers = [];
      shuffleArray(state.deck);
      while (state.hand.length < CARD_HAND_SIZE && state.deck.length > 0) {
        state.hand.push(state.deck.shift());
      }
      if (Array.isArray(state.preview)) {
        while (state.preview.length < CARD_HAND_SIZE) {
          state.preview.push(state.deck.length > 0 ? state.deck.shift() : null);
        }
      }
      consume = false;
      spawnRipple(fighter.x, fighter.y, '#e6c86a', 0.55, fighter.radius * 2.4);
      spawnFloater(fighter.x, fighter.y - 58 * world.scale, '换牌', '#ffe9b0', 0.9, 14);
      if (fighter === game.player) renderCardHand();
    } else if (card.id === 'stillness') {
      fighter.rootTimer = card.duration;
      fighter.rootReward = true;
      fighter.meditationTimer = card.duration;
      fighter.castDuration = card.duration;
      fighter.moving = false;
      spawnRipple(fighter.x, fighter.y, '#9fb6d8', 0.55, fighter.radius * 2);
      spawnFloater(fighter.x, fighter.y - 58 * world.scale, '打坐', '#c8d8f0', 0.9, 14);
    } else if (card.id === 'blink') {
      const x = clamp(
        targetPoint ? targetPoint.x : fighter.x,
        world.play.x + fighter.radius,
        world.play.x + world.play.w - fighter.radius
      );
      const y = clamp(
        targetPoint ? targetPoint.y : fighter.y,
        world.play.y + fighter.radius,
        world.play.y + world.play.h - fighter.radius
      );
      spawnDust(fighter.x, fighter.y, 12, fighter.palette.robeLight);
      addAfterimage(fighter);
      spawnRipple(fighter.x, fighter.y, '#b7a4e8', 0.45, fighter.radius * 1.8);
      fighter.x = x;
      fighter.y = y;
      fighter.prevX = x;
      fighter.prevY = y;
      resolveObstaclePenetration(fighter);
      clampFighterToArena(fighter);
      const hadStun = fighter.stunRemaining > 0;
      fighter.stunRemaining = 0;
      spawnDust(fighter.x, fighter.y, 10, fighter.palette.robeLight);
      spawnRipple(fighter.x, fighter.y, '#d9c8ff', 0.5, fighter.radius * 2);
      spawnFloater(fighter.x, fighter.y - 58 * world.scale, '缩地', '#d9c8ff', 0.9, 14);
      if (hadStun) {
        spawnFloater(fighter.x, fighter.y - 80 * world.scale, '解晕', '#e6dcff', 0.8, 14);
        if (fighter === game.player) showToast('缩地解除了眩晕', '', 1000);
      }
    } else if (card.id === 'blood') {
      fighter.damageBoostTimer = card.duration;
      markBuffApplied(fighter, 'blood');
      spawnRipple(fighter.x, fighter.y, '#d96a6a', 0.5, fighter.radius * 2.2);
      spawnFloater(fighter.x, fighter.y - 58 * world.scale, '攻击翻倍', '#ffb0a0', 0.9, 14);
    } else if (card.id === 'steal' || card.id === 'stealPlus') {
      const stolen = stealOneBuff(fighter);
      if (!stolen) return false;
      spawnRipple(fighter.x, fighter.y, '#c9a7e8', 0.5, fighter.radius * 2.2);
      spawnFloater(fighter.x, fighter.y - 58 * world.scale, `偷取·${stolen}`, '#e2c8ff', 0.9, 14);
      if (fighter === game.player) showToast(`顺手牵羊：偷到${stolen}`, '', 1000);
    } else if (card.id === 'hammer') {
      const target = fighter === game.player ? game.enemy : game.player;
      if (!target || target.hp <= 0) return false;
      const hadSpeed = target.speedBoostTimer > 0;
      applyStun(target, CONFIG.stunDuration);
      target.speedBoostTimer = 0;
      if (target.buffAppliedAt) target.buffAppliedAt.speed = 0;
      target.swing = null;
      target.dodgeRemaining = 0;
      target.moving = false;
      spawnRipple(target.x, target.y, '#b8c8dc', 0.5, target.radius * 2.2);
      spawnFloater(target.x, target.y - 58 * world.scale, `眩晕 ${CONFIG.stunDuration} 秒`, '#dce8ff', 0.9, 15);
      if (hadSpeed) {
        spawnFloater(target.x, target.y - 82 * world.scale, '轻身被破', '#c8d8f0', 0.85, 14);
        if (fighter === game.player) showToast('玄武锤清除了对手的轻身术', '', 1100);
      }
    }

    if (consume) consumeCardFromHand(fighter, card.id);
    // 桃用尽 3 次后从本局卡组移除，下一局重新加载。
    if (card.id === 'heal' && fighter.healUses >= CONFIG.healUsesPerMatch) {
      purgeCardFromPool(fighter, 'heal');
    }
    updateHud(true);
    return true;
  }

  function playerEssenceShort(fighter, card) {
    return Boolean(fighter && card && fighter.essence < card.cost);
  }

  function isPointInsideArena(x, y) {
    const play = world.play;
    return x >= play.x && x <= play.x + play.w && y >= play.y && y <= play.y + play.h;
  }

  // 单体指向卡（玄武锤等）需要拖到目标精灵身上。
  function isPointOnEnemy(x, y) {
    const enemy = game.enemy;
    if (!enemy || enemy.hp <= 0) return false;
    const dx = x - enemy.x;
    const dy = y - (enemy.y - 20 * world.scale);
    return Math.hypot(dx, dy) <= enemy.radius * 2.4;
  }

  function beginCardDrag(cardElement, event) {
    if (game.mode !== 'battle' || game.paused || game.settingsOpen) return;
    const card = cardById(cardElement.dataset.card);
    const player = getLocalFighter();
    const state = localCardState();
    if (!card || !player || !state) return;
    if (!canPlayCard(player, card)) {
      showToast(
        card.id === 'heal' && player.healUses >= CONFIG.healUsesPerMatch
          ? '桃本局已用尽（最多 3 次）'
          : player.essence < card.cost
            ? '精魄不足'
            : '此刻无法出牌',
        'warn',
        1200
      );
      return;
    }
    const rect = cardElement.getBoundingClientRect();
    const ghost = cardElement.cloneNode(true);
    ghost.classList.add('card-ghost');
    ghost.classList.remove('is-dragging', 'is-unaffordable');
    ghost.style.left = `${event.clientX}px`;
    ghost.style.top = `${event.clientY}px`;
    ghost.style.width = `${rect.width}px`;
    ghost.style.minHeight = `${rect.height}px`;
    document.body.appendChild(ghost);
    cardElement.classList.add('is-dragging');
    game.cardDrag = {
      id: card.id,
      slot: Number(cardElement.dataset.slot),
      ghost,
      element: cardElement,
    };
  }

  function updateCardDrag(event) {
    if (!game.cardDrag || !game.cardDrag.ghost) return;
    game.cardDrag.ghost.style.left = `${event.clientX}px`;
    game.cardDrag.ghost.style.top = `${event.clientY}px`;
  }

  function finishCardDrag(event) {
    const drag = game.cardDrag;
    if (!drag) return;
    game.cardDrag = null;
    if (drag.ghost) drag.ghost.remove();
    if (drag.element) drag.element.classList.remove('is-dragging');
    const card = cardById(drag.id);
    const player = getLocalFighter();
    if (!card || !player) return;
    // 在手牌区松开 = 撤回：这张牌留在原槽位，视为没有打出。
    if (isPointInsideHandArea(event.clientX, event.clientY)) {
      showToast('已放回手牌', '', 700);
      return;
    }
    let target = null;
    if (card.targeting === 'ground') {
      if (!isPointInsideArena(event.clientX, event.clientY)) return;
      target = { x: event.clientX, y: event.clientY };
    } else if (card.targeting === 'enemy') {
      if (!isPointOnEnemy(event.clientX, event.clientY)) {
        showToast(`${card.name}需要拖到对手身上`, 'warn', 1100);
        return;
      }
      target = { x: game.enemy.x, y: game.enemy.y };
    } else {
      target = { x: player.x, y: player.y };
    }
    if (isOnlineGuest()) {
      sendGuestCardAction(drag.slot, card.id, target);
      return;
    }
    playCard(player, card, target);
  }

  // 手牌区（卡牌行的外框，留一点容错）。
  function isPointInsideHandArea(x, y) {
    if (!dom.cardHand) return false;
    const rect = dom.cardHand.getBoundingClientRect();
    const pad = 14;
    return x >= rect.left - pad && x <= rect.right + pad && y >= rect.top - pad && y <= rect.bottom + pad;
  }

  function playCardByIndex(index) {
    if (game.mode !== 'battle' || game.paused || game.settingsOpen) return;
    const state = localCardState();
    const id = state && state.hand[index];
    const card = cardById(id);
    const player = getLocalFighter();
    if (!card || !player) return;
    if (!canPlayCard(player, card)) {
      showToast(
        card.id === 'heal' && player.healUses >= CONFIG.healUsesPerMatch
          ? '桃本局已用尽（最多 3 次）'
          : player.essence < card.cost
            ? '精魄不足'
            : '此刻无法出牌',
        'warn',
        1200
      );
      return;
    }
    const point =
      card.targeting === 'ground'
        ? {
            x: clamp(input.mouseX, world.play.x, world.play.x + world.play.w),
            y: clamp(input.mouseY, world.play.y, world.play.y + world.play.h),
          }
        : card.targeting === 'enemy' && game.enemy
          ? { x: game.enemy.x, y: game.enemy.y }
          : { x: player.x, y: player.y };
    if (isOnlineGuest()) {
      sendGuestCardAction(index, card.id, point);
      return;
    }
    playCard(player, card, point);
  }

  function requestCounter() {
    if (isOnlineGuest()) {
      sendGuestAction('counter', getGuestAimAngle(true));
      return;
    }
    if (!tryCounter(game.player)) warnPlayer('需在对方刀光期间反制', true);
  }

  /* ------------------------------ 巨剑术与增益 ------------------------------ */

  function updateGiantSwords(dt) {
    for (const sword of game.giantSwords) {
      sword.elapsed += dt;
      if (sword.struck || sword.elapsed < sword.delay) continue;
      sword.struck = true;
      game.shake = Math.max(game.shake, 14);
      spawnRipple(sword.x, sword.y, '#ffe6b0', 0.6, sword.radius * 1.7);
      spawnRipple(sword.x, sword.y, '#fff4d0', 0.34, sword.radius * 1.1);
      spawnDust(sword.x, sword.y, 18, '#e9d8ad', 1.6);
      const target = sword.team === 'player' ? game.enemy : game.player;
      if (!target || target.hp <= 0) continue;
      if (dist(sword.x, sword.y, target.x, target.y) > sword.radius + target.radius * 0.6) continue;
      const didHit = damageFighter(target, sword.damage, {
        source: 'sword',
        attacker: sword.owner,
        showText: true,
      });
      if (didHit) {
        spawnInkSplash(target.x, target.y - 18 * world.scale, target.palette, 18);
        spawnFloater(target.x, target.y - 46 * world.scale, '巨剑', '#ffe9b0', 0.85, 15);
      }
    }
    game.giantSwords = game.giantSwords.filter((sword) => sword.elapsed < sword.delay + sword.life);
  }

  function drawGreatswordShape(scale) {
    const length = 196 * scale;
    const half = 16 * scale;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgba(255, 246, 220, 0.94)';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(half * 0.58, -length * 0.2);
    ctx.lineTo(half, -length * 0.82);
    ctx.lineTo(-half, -length * 0.82);
    ctx.lineTo(-half * 0.58, -length * 0.2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 245, 0.9)';
    ctx.fillRect(-half * 0.16, -length * 0.8, half * 0.32, length * 0.66);
    ctx.fillStyle = 'rgba(214, 186, 122, 0.95)';
    ctx.fillRect(-half * 1.9, -length * 0.87, half * 3.8, 9 * scale);
    ctx.fillRect(-half * 0.24, -length, half * 0.48, length * 0.15);
    ctx.restore();
  }

  function drawGiantSwords() {
    for (const sword of game.giantSwords) {
      const scale = world.scale;
      const progress = clamp(sword.elapsed / sword.delay, 0, 1);
      const faded = sword.struck ? clamp(1 - (sword.elapsed - sword.delay) / sword.life, 0, 1) : 1;
      ctx.save();
      ctx.translate(sword.x, sword.y);
      ctx.globalAlpha = faded;
      // 地面阵纹
      ctx.strokeStyle = 'rgba(255, 222, 158, 0.78)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(0, 0, sword.radius * (0.62 + progress * 0.38), sword.radius * 0.4 * (0.62 + progress * 0.38), 0, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([6 * scale, 8 * scale]);
      ctx.strokeStyle = 'rgba(200, 174, 116, 0.52)';
      ctx.beginPath();
      ctx.ellipse(0, 0, sword.radius, sword.radius * 0.4, 0, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      // 巨剑
      if (!sword.struck) {
        const fall = 1 - progress;
        ctx.translate(0, -sword.radius * 2.6 * fall);
        drawGreatswordShape(scale);
      } else {
        const impact = clamp((sword.elapsed - sword.delay) / 0.18, 0, 1);
        ctx.globalAlpha = faded * (1 - impact);
        ctx.fillStyle = 'rgba(255, 240, 200, 0.6)';
        ctx.beginPath();
        ctx.ellipse(0, 0, sword.radius * (1 + impact * 0.6), sword.radius * 0.4 * (1 + impact * 0.6), 0, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  function drawFighterBuffs(fighter) {
    if (!fighter || fighter.hp <= 0) return;
    const scale = world.scale;
    ctx.save();
    ctx.translate(fighter.x, fighter.y);
    if (fighter.speedBoostTimer > 0) {
      ctx.strokeStyle = `rgba(159, 232, 214, ${0.16 + 0.1 * Math.sin(game.ambientTime * 6)})`;
      ctx.lineWidth = 1.4;
      for (let i = 0; i < 3; i += 1) {
        const offset = (game.ambientTime * 90 * scale + i * 22 * scale) % 44;
        ctx.beginPath();
        ctx.arc(0, -10 * scale, (18 + offset * 0.5) * scale, -0.9, 0.9);
        ctx.stroke();
      }
    }
    if (fighter.healRemaining > 0) {
      ctx.strokeStyle = `rgba(240, 182, 182, ${0.2 + 0.12 * Math.sin(game.ambientTime * 5)})`;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.ellipse(0, 0, fighter.radius * 1.6, fighter.radius * 0.55, 0, 0, TAU);
      ctx.stroke();
    }
    if (fighter.damageBoostTimer > 0) {
      ctx.strokeStyle = `rgba(217, 106, 106, ${0.26 + 0.14 * Math.sin(game.ambientTime * 7)})`;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.ellipse(0, 0, fighter.radius * 1.75, fighter.radius * 0.6, 0, 0, TAU);
      ctx.stroke();
    }
    if (fighter.rootTimer > 0) {
      ctx.strokeStyle = `rgba(159, 182, 216, ${0.32 + 0.12 * Math.sin(game.ambientTime * 4)})`;
      ctx.lineWidth = 1.6;
      for (let i = 0; i < 4; i += 1) {
        const angle = (i / 4) * TAU + Math.PI / 4;
        const px = Math.cos(angle) * fighter.radius * 1.25;
        const py = Math.sin(angle) * fighter.radius * 0.45;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px * 0.5, py - 16 * scale);
        ctx.stroke();
      }
    }
    if (fighter.stunRemaining > 0) {
      for (let i = 0; i < 3; i += 1) {
        const angle = game.ambientTime * 5 + (i / 3) * TAU;
        ctx.fillStyle = 'rgba(230, 240, 255, 0.85)';
        ctx.beginPath();
        ctx.arc(Math.cos(angle) * 16 * scale, -44 * scale + Math.sin(angle) * 5 * scale, 2.2 * scale, 0, TAU);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function updateMemoryLabels() {
    const profile = getPlayerProfile();
    setText(dom.startMemory, getMemoryLine());
    setText(dom.memoryNote, profile.matches > 0 ? `对手已观 ${profile.matches} 战` : '山门论剑');
    if (profile.ready) {
      // No extra text is needed here; the start line already describes the learned rhythm.
    }
  }

  /* =======================================================================
      Online rooms, host-authoritative relay and guest view
     ======================================================================= */

  const ONLINE_CODE_LENGTH = 5;
  const ONLINE_INPUT_INTERVAL = 33;
  const ONLINE_SNAPSHOT_INTERVAL = 33;
  const RTC_CHUNK_SIZE = 16 * 1024;
  const RTC_ICE_SERVERS = [
    {
      urls: [
        'stun:stun.l.google.com:19302',
        'stun:stun1.l.google.com:19302',
        'stun:stun.cloudflare.com:3478',
        'stun:stun.miwifi.com:3478',
        'stun:stun.qq.com:3478',
      ],
    },
  ];

  function normalizeOnlineCode(value) {
    return String(value || '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, ONLINE_CODE_LENGTH);
  }

  function isOnlineHost() {
    return game.online.active && game.online.role === 'host';
  }

  function isOnlineGuest() {
    return game.online.active && game.online.role === 'guest';
  }

  function getLocalFighter() {
    return isOnlineGuest() ? game.enemy : game.player;
  }

  function getLocalOpponent() {
    return isOnlineGuest() ? game.player : game.enemy;
  }

  function onlineInviteUrl(code) {
    const url = new URL(window.location.href);
    url.search = '';
    url.hash = '';
    url.searchParams.set('room', code);
    return url.href;
  }

  function setOnlineError(message = '') {
    if (!dom.onlineError) return;
    dom.onlineError.hidden = !message;
    dom.onlineError.textContent = message;
  }

  function setOnlineCopyHint(message = '') {
    if (!dom.onlineCopyHint) return;
    dom.onlineCopyHint.textContent = message;
  }

  function setOnlineHudButton(active) {
    if (!dom.settingsBtn) return;
    dom.settingsBtn.classList.toggle('is-online-leave', Boolean(active));
    dom.settingsBtn.setAttribute('aria-label', active ? '离开联机对局' : '打开战斗设置');
    const text = dom.settingsBtn.querySelector('.settings-text');
    if (text) text.textContent = active ? '离开' : '设置';
    const icon = dom.settingsBtn.querySelector('span[aria-hidden="true"]');
    if (icon) icon.textContent = active ? '↩' : '⚙';
  }

  function onlineSocketUrl() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws`;
  }

  function updateOnlineRoomUi() {
    if (!dom.onlineRoom) return;
    const role = game.online.role;
    const hasRoom = Boolean(role && game.online.code);
    dom.onlineSetup.hidden = hasRoom;
    dom.onlineRoom.hidden = !hasRoom;
    if (!hasRoom) return;

    setText(dom.onlineCode, game.online.code);
    setText(dom.onlineRole, role === 'host' ? '房主' : '挑战者');
    setText(dom.onlinePeer, game.online.peerJoined ? '已入场' : '尚未入场');
    if (role === 'host') {
      setText(
        dom.onlineStatus,
        game.online.peerJoined ? '好友已入场 · 请开启对局' : '等待好友加入…'
      );
      dom.onlineStartBtn.hidden = false;
      dom.onlineStartBtn.disabled = !game.online.peerJoined;
      setText(dom.onlineStartBtn, game.online.peerJoined ? '开始对战' : '等待好友');
    } else {
      setText(dom.onlineStatus, '已加入房间 · 等待房主开启对局');
      dom.onlineStartBtn.hidden = true;
    }
  }

  function showOnlineSetup(message = '') {
    game.online.role = null;
    game.online.code = null;
    game.online.peerJoined = false;
    if (dom.onlineRoom) dom.onlineRoom.hidden = true;
    if (dom.onlineSetup) dom.onlineSetup.hidden = false;
    if (dom.onlineStartBtn) {
      dom.onlineStartBtn.hidden = false;
      dom.onlineStartBtn.disabled = true;
      setText(dom.onlineStartBtn, '等待好友');
    }
    if (dom.onlineCreateBtn) {
      dom.onlineCreateBtn.disabled = false;
      setText(dom.onlineCreateBtn, '创建房间');
    }
    if (dom.onlineJoinBtn) {
      dom.onlineJoinBtn.disabled = false;
      setText(dom.onlineJoinBtn, '加入房间');
    }
    setOnlineError(message);
  }

  function openOnlineScreen(prefill = '') {
    if (game.mode !== 'start' || game.online.active) return;
    if (game.settingsOpen) closeSettings(false, true);
    game.online.lobbyOpen = true;
    dom.onlineScreen.hidden = false;
    dom.onlineScreen.style.zIndex = '36';
    setOnlineError('');
    setOnlineCopyHint('');
    if (!dom.onlineCodeInput) return;

    const queryCode = normalizeOnlineCode(new URLSearchParams(window.location.search).get('room'));
    const code = normalizeOnlineCode(prefill) || queryCode;
    dom.onlineCodeInput.value = code;
    if (game.online.role && game.online.code) {
      updateOnlineRoomUi();
    } else {
      showOnlineSetup();
    }

    if (!window.isSecureContext && window.location.protocol === 'file:') {
      setOnlineError('联机版需要通过已部署的网页地址打开，不能直接双击本地 HTML。');
    }
    window.setTimeout(() => {
      if (code) dom.onlineCodeInput.focus({ preventScroll: true });
    }, 40);
  }

  function closeOnlineScreen() {
    if (!dom.onlineScreen || dom.onlineScreen.hidden) return;
    if (game.online.role && game.online.code) {
      leaveOnlineRoom({ toStart: false });
      return;
    }
    if (game.online.socket) {
      try {
        game.online.socket.close();
      } catch (error) {
        // The socket may already be closing.
      }
    }
    game.online.socket = null;
    game.online.connected = false;
    game.online.connecting = false;
    game.online.connectPromise = null;
    game.online.lobbyOpen = false;
    dom.onlineScreen.hidden = true;
  }

  async function copyOnlineInvite() {
    if (!game.online.code) return;
    const link = onlineInviteUrl(game.online.code);
    let copied = false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(link);
        copied = true;
      }
    } catch (error) {
      copied = false;
    }
    if (!copied) {
      const helper = document.createElement('textarea');
      helper.value = link;
      helper.style.position = 'fixed';
      helper.style.opacity = '0';
      document.body.appendChild(helper);
      helper.select();
      try {
        copied = document.execCommand('copy');
      } catch (error) {
        copied = false;
      }
      helper.remove();
    }
    if (copied) {
      setOnlineCopyHint('已复制，可直接发给好友');
    } else {
      window.prompt('复制下面的邀请链接发给好友：', link);
      setOnlineCopyHint('已打开邀请链接');
    }
    window.setTimeout(() => setOnlineCopyHint(''), 3200);
  }

  function ensureOnlineSocket() {
    if (game.online.socket && game.online.socket.readyState === WebSocket.OPEN) {
      return Promise.resolve(game.online.socket);
    }
    if (game.online.connectPromise) return game.online.connectPromise;
    if (!window.WebSocket) {
      return Promise.reject(new Error('当前浏览器不支持联机'));
    }
    if (window.location.protocol === 'file:') {
      return Promise.reject(new Error('联机版必须通过部署后的网址打开'));
    }

    game.online.connecting = true;
    game.online.connectPromise = new Promise((resolve, reject) => {
      let settled = false;
      let socket;
      try {
        socket = new WebSocket(onlineSocketUrl());
      } catch (error) {
        game.online.connecting = false;
        game.online.connectPromise = null;
        reject(error);
        return;
      }
      game.online.socket = socket;
      const timeout = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        game.online.connecting = false;
        game.online.connectPromise = null;
        try {
          socket.close();
        } catch (error) {
          // ignore
        }
        reject(new Error('连接超时，请确认联机服务器已启动'));
      }, 9000);

      socket.addEventListener('open', () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        game.online.connected = true;
        game.online.connecting = false;
        game.online.connectPromise = null;
        resolve(socket);
      });

      socket.addEventListener('message', (event) => {
        let message;
        try {
          message = JSON.parse(event.data);
        } catch (error) {
          return;
        }
        handleOnlineSocketMessage(message);
      });

      socket.addEventListener('error', () => {
        if (!settled) {
          settled = true;
          window.clearTimeout(timeout);
          game.online.connecting = false;
          game.online.connectPromise = null;
          reject(new Error('无法连接联机服务器'));
        }
      });

      socket.addEventListener('close', () => {
        window.clearTimeout(timeout);
        game.online.connected = false;
        game.online.connecting = false;
        game.online.connectPromise = null;
        if (game.online.socket === socket) game.online.socket = null;
        handleOnlineSocketClose();
      });
    });
    return game.online.connectPromise;
  }

  function handleOnlineSocketMessage(message) {
    if (!message || typeof message !== 'object') return;
    if (message.t === 'hello') return;

    if (message.t === 'room') {
      game.online.role = message.role === 'guest' ? 'guest' : 'host';
      game.online.code = normalizeOnlineCode(message.code);
      game.online.peerJoined = Boolean(message.peer);
      game.online.connected = true;
      setOnlineError('');
      updateOnlineRoomUi();
      return;
    }

    if (message.t === 'peer-joined') {
      game.online.peerJoined = true;
      updateOnlineRoomUi();
      startRtcHost();
      return;
    }

    if (message.t === 'peer-left') {
      game.online.peerJoined = false;
      closeOnlineRtc();
      if (game.online.active) {
        handleOnlinePeerLost();
        return;
      }
      if (game.online.role === 'guest') {
        showOnlineSetup('房主已离开房间');
        setOnlineError('房主已离开房间，请重新创建或加入。');
      } else {
        updateOnlineRoomUi();
        setOnlineError('好友已离开，房间仍保留。');
      }
      return;
    }

    if (message.t === 'relay') {
      if (message.from === 'guest' && game.online.role === 'host') {
        handleGuestRelay(message.d);
      } else if (message.from === 'host' && game.online.role === 'guest') {
        handleHostRelay(message.d);
      }
      return;
    }

    if (message.t === 'error') {
      setOnlineError(String(message.message || '联机发生错误'));
      return;
    }

    if (message.t === 'left') {
      return;
    }
  }

  function handleOnlineSocketClose() {
    closeOnlineRtc();
    if (game.online.leaving) {
      game.online.leaving = false;
      return;
    }
    if (game.online.active) {
      handleOnlinePeerLost('联机连接已断开');
      return;
    }
    if (game.online.lobbyOpen || game.online.role) {
      showOnlineSetup('连接已断开，请重新进入联机');
      setOnlineError('连接已断开，请重新创建或加入房间。');
      game.online.role = null;
      game.online.code = null;
      game.online.peerJoined = false;
    }
  }

  async function createOnlineRoom() {
    setOnlineError('');
    closeOnlineRtc();
    if (window.location.protocol === 'file:') {
      setOnlineError('联机版必须通过部署后的网址打开，不能直接双击本地文件。');
      return;
    }
    dom.onlineCreateBtn.disabled = true;
    dom.onlineJoinBtn.disabled = true;
    setText(dom.onlineCreateBtn, '正在创建…');
    try {
      await ensureOnlineSocket();
      if (!game.online.connected) throw new Error('尚未连接服务器');
      game.online.socket.send(JSON.stringify({ t: 'create' }));
    } catch (error) {
      setOnlineError(error.message || '创建房间失败');
      dom.onlineCreateBtn.disabled = false;
      dom.onlineJoinBtn.disabled = false;
      setText(dom.onlineCreateBtn, '创建房间');
    }
  }

  async function joinOnlineRoom() {
    setOnlineError('');
    closeOnlineRtc();
    const code = normalizeOnlineCode(dom.onlineCodeInput.value);
    dom.onlineCodeInput.value = code;
    if (code.length !== ONLINE_CODE_LENGTH) {
      setOnlineError('请输入 5 位房间号');
      dom.onlineCodeInput.focus();
      return;
    }
    if (window.location.protocol === 'file:') {
      setOnlineError('联机版必须通过部署后的网址打开，不能直接双击本地文件。');
      return;
    }
    dom.onlineCreateBtn.disabled = true;
    dom.onlineJoinBtn.disabled = true;
    setText(dom.onlineJoinBtn, '正在加入…');
    try {
      await ensureOnlineSocket();
      if (!game.online.connected) throw new Error('尚未连接服务器');
      game.online.socket.send(JSON.stringify({ t: 'join', code }));
    } catch (error) {
      setOnlineError(error.message || '加入房间失败');
      dom.onlineCreateBtn.disabled = false;
      dom.onlineJoinBtn.disabled = false;
      setText(dom.onlineJoinBtn, '加入房间');
    }
  }

  function sendOnlineMessage(payload, replacer = null) {
    if (!game.online.socket || game.online.socket.readyState !== WebSocket.OPEN) return false;
    try {
      game.online.socket.send(JSON.stringify(payload, replacer));
      return true;
    } catch (error) {
      return false;
    }
  }

  function rtcSupported() {
    return typeof window.RTCPeerConnection === 'function';
  }

  function rtcChannelOpen() {
    const rtc = game.online.rtc;
    return Boolean(rtc.ready && rtc.channel && rtc.channel.readyState === 'open');
  }

  function sendOnlineSignaling(data) {
    return sendOnlineMessage({ t: 'relay', d: data });
  }

  function notifyRtcFallback() {
    const rtc = game.online.rtc;
    if (rtc.fallbackNotified || rtc.ready) return;
    rtc.fallbackNotified = true;
    if (game.online.lobbyOpen || game.online.active) {
      showToast('点对点直连未建立，已改用服务器中继', 'warn', 2800);
    }
  }

  function closeOnlineRtc() {
    const rtc = game.online.rtc;
    if (!rtc) return;
    if (rtc.fallbackTimer) {
      window.clearTimeout(rtc.fallbackTimer);
      rtc.fallbackTimer = 0;
    }
    if (rtc.channel) {
      rtc.channel.onopen = null;
      rtc.channel.onclose = null;
      rtc.channel.onerror = null;
      rtc.channel.onmessage = null;
      try {
        rtc.channel.close();
      } catch (error) {
        // ignore
      }
    }
    if (rtc.pc) {
      rtc.pc.onicecandidate = null;
      rtc.pc.ondatachannel = null;
      rtc.pc.onconnectionstatechange = null;
      rtc.pc.oniceconnectionstatechange = null;
      try {
        rtc.pc.close();
      } catch (error) {
        // ignore
      }
    }
    rtc.pc = null;
    rtc.channel = null;
    rtc.ready = false;
    rtc.state = 'idle';
    rtc.remoteSet = false;
    rtc.pendingIce = [];
    rtc.chunks.clear();
    rtc.fallbackNotified = false;
  }

  function queueRtcIce(candidate) {
    if (!candidate) return;
    const rtc = game.online.rtc;
    if (!rtc.pc || !rtc.remoteSet) {
      rtc.pendingIce.push(candidate);
      return;
    }
    rtc.pc.addIceCandidate(candidate).catch(() => {});
  }

  function flushRtcIce() {
    const rtc = game.online.rtc;
    if (!rtc.pc || !rtc.remoteSet) return;
    const candidates = rtc.pendingIce.splice(0);
    for (const candidate of candidates) {
      rtc.pc.addIceCandidate(candidate).catch(() => {});
    }
  }

  function setupRtcChannel(channel) {
    const rtc = game.online.rtc;
    rtc.channel = channel;
    channel.onopen = () => {
      if (game.online.rtc.channel !== channel) return;
      rtc.ready = true;
      rtc.state = 'open';
      if (rtc.fallbackTimer) {
        window.clearTimeout(rtc.fallbackTimer);
        rtc.fallbackTimer = 0;
      }
      if (game.online.lobbyOpen || game.online.active) {
        showToast('点对点直连已建立', '', 1600);
      }
    };
    channel.onclose = () => {
      if (game.online.rtc.channel !== channel) return;
      const wasReady = rtc.ready;
      rtc.ready = false;
      rtc.state = 'closed';
      if (wasReady && game.online.active) {
        showToast('点对点直连断开，已切回服务器中继', 'warn', 2200);
      }
    };
    channel.onerror = () => {
      rtc.ready = false;
      rtc.state = 'error';
    };
    channel.onmessage = (event) => handleRtcChannelMessage(event);
  }

  function createRtcPeer(isHost) {
    if (!rtcSupported()) return null;
    const rtc = game.online.rtc;
    const pc = new RTCPeerConnection({ iceServers: RTC_ICE_SERVERS });
    rtc.pc = pc;
    rtc.ready = false;
    rtc.state = 'connecting';
    rtc.remoteSet = false;
    pc.onicecandidate = (event) => {
      if (event.candidate) sendOnlineSignaling({ kind: 'rtc-ice', candidate: event.candidate });
    };
    pc.ondatachannel = (event) => {
      if (!isHost) setupRtcChannel(event.channel);
    };
    pc.onconnectionstatechange = () => {
      if (game.online.rtc.pc !== pc) return;
      rtc.state = pc.connectionState;
      if (pc.connectionState === 'failed') {
        rtc.ready = false;
        notifyRtcFallback();
      } else if (pc.connectionState === 'connected') {
        rtc.state = 'connected';
      }
    };
    pc.oniceconnectionstatechange = () => {
      if (game.online.rtc.pc !== pc) return;
      if (pc.iceConnectionState === 'failed') {
        rtc.ready = false;
        notifyRtcFallback();
      }
    };
    if (rtc.fallbackTimer) window.clearTimeout(rtc.fallbackTimer);
    rtc.fallbackTimer = window.setTimeout(() => {
      if (!rtc.ready) notifyRtcFallback();
    }, 9000);
    return pc;
  }

  async function startRtcHost() {
    if (game.online.role !== 'host' || !game.online.peerJoined || !rtcSupported()) return;
    const rtc = game.online.rtc;
    if (rtc.pc && rtc.pc.connectionState !== 'closed') return;
    closeOnlineRtc();
    const pc = createRtcPeer(true);
    if (!pc) return;
    setupRtcChannel(pc.createDataChannel('wendao', { ordered: true }));
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      sendOnlineSignaling({ kind: 'rtc-offer', description: pc.localDescription });
    } catch (error) {
      rtc.state = 'offer-failed';
      notifyRtcFallback();
    }
  }

  async function acceptRtcOffer(description) {
    if (game.online.role !== 'guest' || !rtcSupported() || !description) return;
    const rtc = game.online.rtc;
    if (rtc.pc && rtc.pc.connectionState !== 'closed') return;
    // 保留 offer 到达前先收到的 ICE candidate。
    const earlyIce = rtc.pendingIce.slice();
    closeOnlineRtc();
    rtc.pendingIce = earlyIce;
    const pc = createRtcPeer(false);
    if (!pc) return;
    try {
      await pc.setRemoteDescription(description);
      rtc.remoteSet = true;
      flushRtcIce();
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sendOnlineSignaling({ kind: 'rtc-answer', description: pc.localDescription });
    } catch (error) {
      rtc.state = 'answer-failed';
      notifyRtcFallback();
    }
  }

  async function acceptRtcAnswer(description) {
    if (game.online.role !== 'host' || !description) return;
    const rtc = game.online.rtc;
    if (!rtc.pc) return;
    try {
      await rtc.pc.setRemoteDescription(description);
      rtc.remoteSet = true;
      flushRtcIce();
    } catch (error) {
      rtc.state = 'answer-apply-failed';
      notifyRtcFallback();
    }
  }

  function sendP2pPayload(payload, replacer = null) {
    const rtc = game.online.rtc;
    const channel = rtc.channel;
    if (!rtc.ready || !channel || channel.readyState !== 'open') return false;
    try {
      if (payload.d && payload.d.kind === 'snapshot' && channel.bufferedAmount > 512 * 1024) {
        return true;
      }
      const text = JSON.stringify(payload, replacer);
      if (text.length <= RTC_CHUNK_SIZE) {
        channel.send(text);
      } else {
        const id = ++rtc.chunkSeq;
        const total = Math.ceil(text.length / RTC_CHUNK_SIZE);
        for (let index = 0; index < total; index += 1) {
          channel.send(
            JSON.stringify({
              t: 'chunk',
              id,
              index,
              total,
              data: text.slice(index * RTC_CHUNK_SIZE, (index + 1) * RTC_CHUNK_SIZE),
            })
          );
        }
      }
      rtc.sent += 1;
      return true;
    } catch (error) {
      rtc.ready = false;
      rtc.state = 'send-failed';
      return false;
    }
  }

  function sendOnlineRelay(data, replacer = null) {
    const payload = { t: 'relay', d: data };
    if (sendP2pPayload(payload, replacer)) return true;
    return sendOnlineMessage(payload, replacer);
  }

  function maybeSendOnlinePing(now) {
    if (!game.online.active) return;
    if (now - game.online.lastPingAt < 1000) return;
    game.online.lastPingAt = now;
    game.online.pingSeq += 1;
    sendOnlineRelay({
      kind: 'net-ping',
      seq: game.online.pingSeq,
      at: performance.now(),
    });
  }

  function dispatchRtcRelay(data) {
    if (!data || typeof data !== 'object') return;
    // 房间内就要能收到 start；不能依赖 active（active 在开局后才为真）。
    if (game.online.role === 'host') handleGuestRelay(data);
    else if (game.online.role === 'guest') handleHostRelay(data);
  }

  function handleRtcChannelMessage(event) {
    if (typeof event.data !== 'string') return;
    let message;
    try {
      message = JSON.parse(event.data);
    } catch (error) {
      return;
    }
    if (!message || typeof message !== 'object') return;
    const rtc = game.online.rtc;
    rtc.received += 1;
    if (message.t === 'relay') {
      dispatchRtcRelay(message.d);
      return;
    }
    if (message.t === 'chunk') {
      const id = Number(message.id);
      const index = Number(message.index);
      const total = Number(message.total);
      if (!Number.isInteger(id) || !Number.isInteger(index) || !Number.isInteger(total)) return;
      if (index < 0 || index >= total || total <= 0 || total > 4096 || typeof message.data !== 'string') {
        return;
      }
      let entry = rtc.chunks.get(id);
      if (!entry) {
        entry = { parts: new Array(total), received: 0, total, at: Date.now() };
        rtc.chunks.set(id, entry);
      }
      if (entry.total !== total || entry.parts[index] !== undefined) return;
      entry.parts[index] = message.data;
      entry.received += 1;
      if (entry.received >= total) {
        rtc.chunks.delete(id);
        const text = entry.parts.join('');
        try {
          const assembled = JSON.parse(text);
          if (assembled && assembled.t === 'relay') dispatchRtcRelay(assembled.d);
        } catch (error) {
          // ignore malformed chunk set
        }
      }
      if (rtc.chunks.size > 8) {
        const cutoff = Date.now() - 10000;
        for (const [key, value] of rtc.chunks) {
          if (value.at < cutoff) rtc.chunks.delete(key);
        }
      }
    }
  }

  function angleToOnlineDir(angle) {
    const safe = Number.isFinite(angle) ? angle : Math.PI;
    return {
      x: Math.cos(safe) / Math.max(1, world.play.w),
      y: Math.sin(safe) / Math.max(1, world.play.h),
    };
  }

  function onlineDirToAngle(direction, fallback = Math.PI) {
    if (!direction || !Number.isFinite(direction.x) || !Number.isFinite(direction.y)) {
      return fallback;
    }
    const x = direction.x * world.play.w;
    const y = direction.y * world.play.h;
    if (Math.abs(x) < 0.000001 && Math.abs(y) < 0.000001) return fallback;
    return Math.atan2(y, x);
  }

  function sendGuestAction(action, angle, extras = null) {
    if (!isOnlineGuest() || game.mode !== 'battle' || game.paused) return;
    const safeAngle = Number.isFinite(angle) ? angle : Math.PI;
    sendOnlineRelay({
      kind: 'action',
      action,
      aim: angleToOnlineDir(safeAngle),
      angle: safeAngle,
      ...(extras || {}),
    });
  }

  function sendGuestCardAction(slot, cardId, targetPoint) {
    if (!isOnlineGuest() || game.mode !== 'battle' || game.paused) return;
    let target = null;
    if (targetPoint) {
      target = {
        x: (Number(targetPoint.x) - world.play.x) / Math.max(1, world.play.w),
        y: (Number(targetPoint.y) - world.play.y) / Math.max(1, world.play.h),
      };
      target.x = clamp(target.x, 0, 1);
      target.y = clamp(target.y, 0, 1);
    }
    sendOnlineRelay({
      kind: 'action',
      action: 'card',
      slot: Number(slot),
      cardId,
      target,
    });
  }

  function handleGuestRelay(data) {
    if (!data || typeof data !== 'object' || game.online.role !== 'host') return;
    if (data.kind === 'rtc-answer') {
      acceptRtcAnswer(data.description);
      return;
    }
    if (data.kind === 'rtc-ice') {
      queueRtcIce(data.candidate);
      return;
    }
    if (!game.online.active) return;
    if (data.kind === 'net-ping') {
      sendOnlineRelay({ kind: 'net-pong', at: data.at });
      return;
    }
    if (data.kind === 'net-pong') {
      if (Number.isFinite(data.at)) {
        game.online.rtt = Math.max(0, performance.now() - data.at);
      }
      return;
    }
    if (data.kind === 'input') {
      const remote = game.online.remoteInput;
      remote.up = Boolean(data.up);
      remote.down = Boolean(data.down);
      remote.left = Boolean(data.left);
      remote.right = Boolean(data.right);
      if (data.aim) remote.aimAngle = onlineDirToAngle(data.aim, remote.aimAngle);
      else if (Number.isFinite(data.aimAngle)) remote.aimAngle = data.aimAngle;
      remote.seq = Number(data.seq) || remote.seq;
      remote.receivedAt = performance.now();
      return;
    }
    if (data.kind === 'action') {
      const actions = ['melee', 'orb', 'dodge', 'counter', 'card'];
      if (!actions.includes(data.action)) return;
      const angle = data.aim
        ? onlineDirToAngle(data.aim, game.online.remoteInput.aimAngle)
        : Number.isFinite(data.angle)
          ? data.angle
          : game.online.remoteInput.aimAngle;
      if (game.online.pendingActions.length < 8) {
        game.online.pendingActions.push({
          action: data.action,
          angle,
          slot: Number.isFinite(data.slot) ? Math.floor(data.slot) : -1,
          cardId: typeof data.cardId === 'string' ? data.cardId : '',
          target:
            data.target &&
            Number.isFinite(data.target.x) &&
            Number.isFinite(data.target.y)
              ? {
                  x: clamp(data.target.x, 0, 1),
                  y: clamp(data.target.y, 0, 1),
                }
              : null,
          origin:
            data.origin &&
            Number.isFinite(data.origin.x) &&
            Number.isFinite(data.origin.y)
              ? {
                  x: clamp(data.origin.x, 0, 1),
                  y: clamp(data.origin.y, 0, 1),
                }
              : null,
        });
      }
      return;
    }
    if (data.kind === 'rematch-request') {
      showToast('道友请求再战 · 可点“再战一场”', '', 2200);
    }
  }

  function handleHostRelay(data) {
    if (!data || typeof data !== 'object' || game.online.role !== 'guest') return;
    if (data.kind === 'rtc-offer') {
      acceptRtcOffer(data.description);
      return;
    }
    if (data.kind === 'rtc-ice') {
      queueRtcIce(data.candidate);
      return;
    }
    if (data.kind === 'start') {
      beginOnlineBattle('guest');
      return;
    }
    if (!game.online.active) return;
    if (data.kind === 'net-ping') {
      sendOnlineRelay({ kind: 'net-pong', at: data.at });
      return;
    }
    if (data.kind === 'net-pong') {
      if (Number.isFinite(data.at)) {
        game.online.rtt = Math.max(0, performance.now() - data.at);
      }
      return;
    }
    if (data.kind === 'snapshot') {
      applyOnlineSnapshot(data.snapshot);
      return;
    }
    if (data.kind === 'result') {
      applyOnlineResult(data);
      return;
    }
    if (data.kind === 'sfx') {
      if (data.name === 'melee') playMeleeImpact(Boolean(data.empowered), true);
      else if (data.name === 'clash') playClashSound(true);
    }
  }

  function sendOnlineSfx(name, payload = {}) {
    if (!isOnlineHost()) return;
    sendOnlineRelay({ kind: 'sfx', name, ...payload });
  }

  function startOnlineBattleAsHost() {
    if (!isOnlineHost() && !(game.online.role === 'host' && game.online.code)) return;
    if (!game.online.peerJoined) return;
    sendOnlineRelay({ kind: 'start' });
    beginOnlineBattle('host');
  }

  function beginOnlineBattle(role) {
    if (role !== 'host' && role !== 'guest') return;
    game.online.role = role;
    game.online.active = true;
    game.online.lobbyOpen = false;
    game.online.localTeam = role === 'host' ? 'player' : 'enemy';
    game.online.resultSent = false;
    game.online.rematchRequested = false;
    game.online.lastInputSentAt = 0;
    game.online.lastOrbActionAt = 0;
    game.online.cardSignature = '';
    game.online.hostMoveSpeedPercent = game.settings.moveSpeedPercent;
    game.online.rtt = 0;
    game.online.lastPingAt = 0;
    game.online.pingSeq = 0;
    game.online.lastSnapshotAt = 0;
    game.online.lastSnapshotReceivedAt = 0;
    game.online.pendingActions.length = 0;
    game.online.remoteInput.up = false;
    game.online.remoteInput.down = false;
    game.online.remoteInput.left = false;
    game.online.remoteInput.right = false;
    game.online.remoteInput.receivedAt = 0;

    resetMatch();
    game.ai = null;
    game.player.name = '云归';
    game.enemy.name = '道友';
    setText(dom.playerName, game.player.name);
    setText(dom.enemyName, game.enemy.name);
    dom.startScreen.hidden = true;
    dom.settingsScreen.hidden = true;
    dom.onlineScreen.hidden = true;
    dom.resultScreen.hidden = true;
    dom.restartBtn.disabled = false;
    setText(dom.restartBtn, '再战一场');
    setText(dom.backToStartBtn, '离开房间');
    setOnlineHudButton(true);
    game.mode = 'battle';
    setBodyMode('battle');
    game.paused = false;
    game.settingsOpen = false;
    showToast(role === 'host' ? '论剑开始 · 等待道友出手' : '论剑开始 · 道友请出招', '', 1500);
    updateHud(true);
    if (role === 'host' && document.hidden) startOnlineBackgroundTicker();
  }

  function leaveOnlineRoom({ toStart = true, silent = false } = {}) {
    const hadRoom = Boolean(game.online.role || game.online.code);
    stopOnlineBackgroundTicker();
    closeOnlineRtc();
    game.online.leaving = true;
    if (game.online.socket && game.online.socket.readyState === WebSocket.OPEN) {
      try {
        game.online.socket.send(JSON.stringify({ t: 'leave' }));
        game.online.socket.close();
      } catch (error) {
        // ignore
      }
    } else if (game.online.socket) {
      try {
        game.online.socket.close();
      } catch (error) {
        // ignore
      }
    }
    game.online.socket = null;
    game.online.connected = false;
    game.online.connecting = false;
    game.online.connectPromise = null;
    game.online.role = null;
    game.online.code = null;
    game.online.peerJoined = false;
    game.online.active = false;
    game.online.lobbyOpen = false;
    game.online.pendingActions.length = 0;
    game.online.resultSent = false;
    if (dom.onlineScreen) dom.onlineScreen.hidden = true;
    if (dom.onlineRoom) dom.onlineRoom.hidden = true;
    if (dom.onlineSetup) dom.onlineSetup.hidden = false;
    window.setTimeout(() => {
      game.online.leaving = false;
    }, 0);
    if (toStart) {
      returnToStart();
      if (hadRoom && !silent) showToast('已离开联机房间', '', 1300);
    }
  }

  function handleOnlinePeerLost(message = '道友已离开房间') {
    if (!game.online.active && !game.online.lobbyOpen) return;
    if (game.online.active) {
      showToast(message, 'warn', 1700);
      window.setTimeout(() => {
        leaveOnlineRoom({ toStart: true, silent: true });
      }, 550);
    } else {
      game.online.peerJoined = false;
      updateOnlineRoomUi();
    }
  }

  function serializeOnlineSnapshot() {
    return {
      kind: 'snapshot',
      snapshot: {
        time: game.battleTime,
        view: {
          x: world.play.x,
          y: world.play.y,
          w: world.play.w,
          h: world.play.h,
          scale: world.scale,
          moveSpeedPercent: game.settings.moveSpeedPercent,
        },
        player: game.player,
        enemy: game.enemy,
        projectiles: game.projectiles,
        effects: game.effects,
        floaters: game.floaters,
        afterimages: game.afterimages,
        shake: game.shake,
        playerHurtFlash: game.playerHurtFlash,
        enemyHurtFlash: game.enemyHurtFlash,
        endPending: game.endPending,
        winnerTeam: game.winner ? game.winner.team : null,
        match: game.match,
        clashCount: game.clashCount,
        enemyCards: game.enemyCards
          ? {
              hand: [...game.enemyCards.hand],
              preview: Array.isArray(game.enemyCards.preview) ? [...game.enemyCards.preview] : [],
            }
          : null,
        giantSwords: game.giantSwords.map(({ owner, ...sword }) => ({ ...sword })),
      },
    };
  }

  function sendOnlineSnapshot() {
    if (!isOnlineHost() || game.mode !== 'battle') return;
    sendOnlineRelay(serializeOnlineSnapshot(), (key, value) => {
      if (key === 'ownerRef') return undefined;
      return value;
    });
  }

  function stopOnlineBackgroundTicker() {
    if (game.online.bgWorker) {
      try {
        game.online.bgWorker.postMessage('stop');
      } catch (error) {
        // ignore
      }
    }
    game.online.bgAccumulator = 0;
    game.online.bgLastTick = 0;
  }

  function startOnlineBackgroundTicker() {
    if (!isOnlineHost() || !game.online.active) return;
    if (!game.online.bgWorker) {
      try {
        const source =
          "let timer = 0; onmessage = (event) => {" +
          "  if (event.data === 'start') {" +
          "    if (!timer) timer = setInterval(() => postMessage('tick'), 16);" +
          "  } else if (event.data === 'stop') {" +
          "    clearInterval(timer); timer = 0;" +
          "  }" +
          "};";
        const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
        const worker = new Worker(url);
        worker.onmessage = () => tickOnlineBackgroundHost();
        game.online.bgWorker = worker;
        game.online.bgWorkerUrl = url;
      } catch (error) {
        game.online.bgWorker = null;
        return;
      }
    }
    game.online.bgAccumulator = 0;
    game.online.bgLastTick = performance.now();
    try {
      game.online.bgWorker.postMessage('start');
    } catch (error) {
      // ignore
    }
  }

  function tickOnlineBackgroundHost() {
    if (
      !document.hidden ||
      !isOnlineHost() ||
      !game.online.active ||
      game.mode !== 'battle' ||
      game.paused ||
      game.settingsOpen
    ) {
      return;
    }
    const now = performance.now();
    if (!game.online.bgLastTick) game.online.bgLastTick = now;
    const delta = Math.min(0.2, Math.max(0, (now - game.online.bgLastTick) / 1000));
    game.online.bgLastTick = now;
    game.online.bgAccumulator += delta;
    let steps = 0;
    while (game.online.bgAccumulator >= STEP && steps < 8) {
      game.online.bgAccumulator -= STEP;
      steps += 1;
      step(STEP);
      if (game.mode !== 'battle') break;
    }
    if (steps === 8) game.online.bgAccumulator = 0;
    if (now - game.online.lastSnapshotAt >= ONLINE_SNAPSHOT_INTERVAL) {
      game.online.lastSnapshotAt = now;
      sendOnlineSnapshot();
    }
  }

  function installOnlineFighter(incoming, previous) {
    const fighter = incoming || previous;
    if (!fighter) return fighter;
    // 客机的挥剑预览不能被还没有剑光的快照覆盖。
    if (previous && previous.swing && previous.swing.preview && !fighter.swing) {
      fighter.swing = previous.swing;
    }
    const previousNetX = previous && Number.isFinite(previous.netX) ? previous.netX : null;
    const previousNetY = previous && Number.isFinite(previous.netY) ? previous.netY : null;
    fighter.netX = Number(fighter.x) || 0;
    fighter.netY = Number(fighter.y) || 0;
    if (previous && Number.isFinite(previous.x) && Number.isFinite(previous.y)) {
      const jump = dist(previous.x, previous.y, fighter.netX, fighter.netY);
      const netJump =
        previousNetX !== null && previousNetY !== null
          ? dist(previousNetX, previousNetY, fighter.netX, fighter.netY)
          : 0;
      // 服务端位置突然大跳（缩地、击飞、重生）时直接接管；普通行走误差交给预测。
      if (netJump > 220 * world.scale) {
        fighter.x = fighter.netX;
        fighter.y = fighter.netY;
      } else if (jump < 185 * world.scale) {
        fighter.x = previous.x;
        fighter.y = previous.y;
      }
    }
    return fighter;
  }

  function transformOnlineSnapshot(snapshot) {
    const view = snapshot.view;
    if (!view || !view.w || !view.h) return snapshot;
    const sx = world.play.w / view.w;
    const sy = world.play.h / view.h;
    const ss = world.scale / view.scale;
    const mapX = (x) => world.play.x + (Number(x) - view.x) * sx;
    const mapY = (y) => world.play.y + (Number(y) - view.y) * sy;
    const mapPoint = (point) => {
      if (!point || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))) return;
      point.x = mapX(point.x);
      point.y = mapY(point.y);
    };
    const mapAngle = (angle) => {
      if (!Number.isFinite(angle)) return angle;
      return Math.atan2(Math.sin(angle) * sy, Math.cos(angle) * sx);
    };
    const mapFighter = (fighter) => {
      if (!fighter) return;
      mapPoint(fighter);
      if (Number.isFinite(fighter.prevX)) fighter.prevX = mapX(fighter.prevX);
      if (Number.isFinite(fighter.prevY)) fighter.prevY = mapY(fighter.prevY);
      if (Number.isFinite(fighter.radius)) fighter.radius *= ss;
      if (Number.isFinite(fighter.facing)) fighter.facing = mapAngle(fighter.facing);
      if (Number.isFinite(fighter.aimAngle)) fighter.aimAngle = mapAngle(fighter.aimAngle);
      if (fighter.swing) {
        const swing = fighter.swing;
        const sweep = Number.isFinite(swing.endAngle) && Number.isFinite(swing.startAngle)
          ? swing.endAngle - swing.startAngle
          : null;
        if (Number.isFinite(swing.startAngle)) {
          swing.startAngle = mapAngle(swing.startAngle);
          // 跨越 ±π 时分别映射起止角会让刀光绕成整圈；保留原始扫角。
          if (sweep !== null) swing.endAngle = swing.startAngle + sweep;
        } else if (Number.isFinite(swing.endAngle)) {
          swing.endAngle = mapAngle(swing.endAngle);
        }
        if (Number.isFinite(swing.targetAngle)) swing.targetAngle = mapAngle(swing.targetAngle);
      }
    };

    mapFighter(snapshot.player);
    mapFighter(snapshot.enemy);
    for (const projectile of snapshot.projectiles || []) {
      mapPoint(projectile);
      if (Number.isFinite(projectile.radius)) projectile.radius *= ss;
      if (Number.isFinite(projectile.vx)) projectile.vx *= sx;
      if (Number.isFinite(projectile.vy)) projectile.vy *= sy;
      for (const key of ['speed', 'initialSpeed', 'maxSpeed', 'accel']) {
        if (Number.isFinite(projectile[key])) projectile[key] *= ss;
      }
      if (Array.isArray(projectile.trail)) projectile.trail.forEach(mapPoint);
    }
    for (const effect of snapshot.effects || []) {
      mapPoint(effect);
      if (Number.isFinite(effect.vx)) effect.vx *= sx;
      if (Number.isFinite(effect.vy)) effect.vy *= sy;
      if (Number.isFinite(effect.size)) effect.size *= ss;
      if (Number.isFinite(effect.radius)) effect.radius *= ss;
      if (Number.isFinite(effect.gravity)) effect.gravity *= ss;
    }
    for (const floater of snapshot.floaters || []) {
      mapPoint(floater);
      if (Number.isFinite(floater.size)) floater.size *= ss;
      if (Number.isFinite(floater.vy)) floater.vy *= ss;
      if (Number.isFinite(floater.drift)) floater.drift *= ss;
    }
    for (const afterimage of snapshot.afterimages || []) {
      mapPoint(afterimage);
      if (Number.isFinite(afterimage.facing)) afterimage.facing = mapAngle(afterimage.facing);
    }
    for (const sword of snapshot.giantSwords || []) {
      mapPoint(sword);
      if (Number.isFinite(sword.radius)) sword.radius *= ss;
    }
    if (Number.isFinite(snapshot.shake)) snapshot.shake *= ss;
    return snapshot;
  }

  function applyOnlineSnapshot(snapshot) {
    if (!snapshot || !isOnlineGuest() || game.mode !== 'battle') return;
    if (!snapshot.player || !snapshot.enemy) return;
    transformOnlineSnapshot(snapshot);
    if (snapshot.view && Number.isFinite(snapshot.view.moveSpeedPercent)) {
      game.online.hostMoveSpeedPercent = clamp(snapshot.view.moveSpeedPercent, 50, 200);
    }
    game.player = installOnlineFighter(snapshot.player, game.player);
    game.enemy = installOnlineFighter(snapshot.enemy, game.enemy);
    game.projectiles = Array.isArray(snapshot.projectiles) ? snapshot.projectiles : [];
    game.effects = Array.isArray(snapshot.effects) ? snapshot.effects : [];
    game.floaters = Array.isArray(snapshot.floaters) ? snapshot.floaters : [];
    game.afterimages = Array.isArray(snapshot.afterimages) ? snapshot.afterimages : [];
    game.shake = Number(snapshot.shake) || 0;
    game.playerHurtFlash = Number(snapshot.playerHurtFlash) || 0;
    game.enemyHurtFlash = Number(snapshot.enemyHurtFlash) || 0;
    game.endPending = Boolean(snapshot.endPending);
    game.battleTime = Number(snapshot.time) || 0;
    game.match = snapshot.match || game.match;
    game.clashCount = Number(snapshot.clashCount) || 0;
    game.giantSwords = Array.isArray(snapshot.giantSwords) ? snapshot.giantSwords : [];
    if (snapshot.enemyCards) {
      if (!game.enemyCards) game.enemyCards = { deck: [], hand: [], preview: [] };
      game.enemyCards.hand = Array.isArray(snapshot.enemyCards.hand)
        ? [...snapshot.enemyCards.hand]
        : game.enemyCards.hand;
      game.enemyCards.preview = Array.isArray(snapshot.enemyCards.preview)
        ? [...snapshot.enemyCards.preview]
        : game.enemyCards.preview;
    }
    game.online.lastSnapshotReceivedAt = performance.now();
    game.online.lastAppliedSnapshotAt = game.online.lastSnapshotReceivedAt;
    if (!game.cardDrag) renderCardHand();
  }

  function canPredictGuestMovement(fighter) {
    if (
      !fighter ||
      fighter.hp <= 0 ||
      game.mode !== 'battle' ||
      game.paused ||
      game.endPending ||
      game.settingsOpen ||
      fighter.stunRemaining > 0 ||
      fighter.rootTimer > 0 ||
      fighter.throwRemaining > 0 ||
      fighter.bounceRemaining > 0 ||
      fighter.dodgeRemaining > 0
    ) {
      return false;
    }
    // 近身时以房主权威位置为准，避免双方看到的身位差距被预测放大。
    const host = game.player;
    if (
      host &&
      Number.isFinite(fighter.netX) &&
      Number.isFinite(fighter.netY) &&
      Number.isFinite(host.netX) &&
      Number.isFinite(host.netY) &&
      dist(fighter.netX, fighter.netY, host.netX, host.netY) < 190 * world.scale
    ) {
      return false;
    }
    return true;
  }

  function getGuestPredictedMoveSpeed(fighter) {
    const percent = clamp(
      Number(game.online.hostMoveSpeedPercent) || game.settings.moveSpeedPercent,
      50,
      200
    );
    const boost = fighter && fighter.speedBoostTimer > 0 ? 1.5 : 1;
    return 252 * world.scale * (percent / 100) * boost;
  }

  function updateOnlineGuestView(dt) {
    if (!isOnlineGuest()) return;
    const blend = 1 - Math.exp(-22 * Math.max(0, Math.min(dt, 0.1)));
    const hostFighter = game.player;
    if (hostFighter && Number.isFinite(hostFighter.netX) && Number.isFinite(hostFighter.netY)) {
      const dx = hostFighter.netX - hostFighter.x;
      const dy = hostFighter.netY - hostFighter.y;
      const jump = Math.hypot(dx, dy);
      if (jump > 185 * world.scale) {
        hostFighter.x = hostFighter.netX;
        hostFighter.y = hostFighter.netY;
      } else {
        hostFighter.x += dx * blend;
        hostFighter.y += dy * blend;
      }
    }

    const local = game.enemy;
    if (local) {
      if (local.swing && local.swing.preview) {
        local.swing.elapsed += dt;
        if (local.swing.elapsed >= local.swing.duration) local.swing = null;
      }
      const move = canPredictGuestMovement(local) ? readMovementInput() : null;
      if (move && (move.x !== 0 || move.y !== 0)) {
        // 客机本地先行：输入不再等待房主往返，服务端快照只负责纠偏。
        const direction = norm(move.x, move.y);
        const speed = getGuestPredictedMoveSpeed(local);
        const moved = moveFighter(local, direction.x * speed * dt, direction.y * speed * dt);
        local.moving = moved > 0.05;
      } else {
        local.moving = false;
      }

      if (canPredictGuestMovement(local)) {
        const aim = getGuestAimAngle(false);
        local.aimAngle = aim;
        local.facing = aim;
        if (!local.moving && Number.isFinite(local.netX) && Number.isFinite(local.netY)) {
          // 只修很小的静止误差；拉回大误差会把“预测领先”变成回弹。
          const dx = local.netX - local.x;
          const dy = local.netY - local.y;
          const error = Math.hypot(dx, dy);
          if (error > 3 * world.scale && error < 22 * world.scale) {
            local.x += dx * blend * 0.2;
            local.y += dy * blend * 0.2;
          }
        }
      } else if (Number.isFinite(local.netX) && Number.isFinite(local.netY)) {
        const dx = local.netX - local.x;
        const dy = local.netY - local.y;
        if (Math.hypot(dx, dy) > 185 * world.scale) {
          local.x = local.netX;
          local.y = local.netY;
        } else {
          local.x += dx * blend;
          local.y += dy * blend;
        }
      }
    }
    game.ambientTime += Math.min(dt, 0.05) * 0.35;
  }

  function getGuestAimAngle(autoAim = false) {
    const fighter = game.enemy;
    if (!fighter) return Math.PI;
    if (autoAim && game.player) {
      return Math.atan2(
        game.player.y - 12 * world.scale - (fighter.y - 12 * world.scale),
        game.player.x - fighter.x
      );
    }
    if (input.hasMouse) {
      return Math.atan2(input.mouseY - (fighter.y - 12 * world.scale), input.mouseX - fighter.x);
    }
    if (game.player) {
      return Math.atan2(
        game.player.y - 12 * world.scale - (fighter.y - 12 * world.scale),
        game.player.x - fighter.x
      );
    }
    return Math.PI;
  }

  function sendGuestInput() {
    if (!isOnlineGuest() || game.mode !== 'battle' || game.paused) return;
    const now = performance.now();
    if (now - game.online.lastInputSentAt < ONLINE_INPUT_INTERVAL) return;
    game.online.lastInputSentAt = now;
    game.online.inputSeq += 1;
    const aimAngle = getGuestAimAngle(false);
    const move = readMovementInput();
    sendOnlineRelay({
      kind: 'input',
      up: move.y < 0,
      down: move.y > 0,
      left: move.x < 0,
      right: move.x > 0,
      aim: angleToOnlineDir(aimAngle),
      aimAngle,
      seq: game.online.inputSeq,
    });
    if (input.orbHeld && now - game.online.lastOrbActionAt >= 90) {
      game.online.lastOrbActionAt = now;
      sendGuestAction('orb', aimAngle, { origin: guestOrbOrigin() });
    }
  }

  function processGuestActions(fighter) {
    if (!fighter || game.online.pendingActions.length === 0) return;
    const actions = game.online.pendingActions.splice(0, 6);
    for (const entry of actions) {
      if (entry.action === 'melee') {
        if (canAct(fighter)) {
          const autoAngle = onlineMeleeAimAngle(fighter, entry.angle);
          tryMelee(fighter, autoAngle);
        }
      } else if (entry.action === 'orb') {
        if (canAct(fighter) && !tryCounter(fighter)) {
          const origin = entry.origin
            ? {
                x: world.play.x + entry.origin.x * world.play.w,
                y: world.play.y + entry.origin.y * world.play.h,
              }
            : null;
          tryOrb(fighter, entry.angle, origin);
        }
      } else if (entry.action === 'dodge') {
        if (canAct(fighter)) tryDodge(fighter, entry.angle);
      } else if (entry.action === 'counter') {
        tryCounter(fighter);
      } else if (entry.action === 'card') {
        const state = handState(fighter);
        if (!state || entry.slot < 0 || entry.slot >= state.hand.length) continue;
        if (state.hand[entry.slot] !== entry.cardId) continue;
        const card = cardById(entry.cardId);
        if (!card) continue;
        let target = null;
        if (card.targeting === 'ground' && entry.target) {
          target = {
            x: world.play.x + entry.target.x * world.play.w,
            y: world.play.y + entry.target.y * world.play.h,
          };
        } else if (card.targeting === 'enemy' && game.player) {
          target = { x: game.player.x, y: game.player.y };
        } else {
          target = { x: fighter.x, y: fighter.y };
        }
        playCard(fighter, card, target);
      }
    }
  }

  function updateRemoteFighter(dt) {
    const fighter = game.enemy;
    if (!fighter) return;
    processGuestActions(fighter);

    if (updateThrow(fighter, dt)) {
      if (Number.isFinite(game.online.remoteInput.aimAngle)) {
        fighter.aimAngle = game.online.remoteInput.aimAngle;
      }
      return;
    }

    if (updateBounce(fighter, dt)) {
      if (Number.isFinite(game.online.remoteInput.aimAngle)) {
        fighter.aimAngle = game.online.remoteInput.aimAngle;
      }
      return;
    }
    if (updateDodge(fighter, dt)) {
      if (Number.isFinite(game.online.remoteInput.aimAngle)) {
        fighter.aimAngle = game.online.remoteInput.aimAngle;
      }
      return;
    }
    if (!canAct(fighter)) {
      fighter.moving = false;
      return;
    }

    if (fighter.rootTimer > 0) {
      fighter.moving = false;
      if (Number.isFinite(game.online.remoteInput.aimAngle)) {
        fighter.aimAngle = game.online.remoteInput.aimAngle;
        fighter.facing = game.online.remoteInput.aimAngle;
      }
      return;
    }

    const remote = game.online.remoteInput;
    const fresh = performance.now() - remote.receivedAt < 900;
    let dx = 0;
    let dy = 0;
    if (fresh) {
      if (remote.up) dy -= 1;
      if (remote.down) dy += 1;
      if (remote.left) dx -= 1;
      if (remote.right) dx += 1;
    }
    if (dx !== 0 || dy !== 0) {
      const direction = norm(dx, dy);
      const speed = getMoveSpeed(fighter);
      const moved = moveFighter(fighter, direction.x * speed * dt, direction.y * speed * dt);
      fighter.moving = moved > 0.05;
    } else {
      fighter.moving = false;
    }

    if (Number.isFinite(remote.aimAngle)) {
      fighter.aimAngle = remote.aimAngle;
      fighter.facing = remote.aimAngle;
    }
  }

  function sendOnlineResult() {
    if (!isOnlineHost() || game.online.resultSent) return;
    game.online.resultSent = true;
    sendOnlineRelay({
      kind: 'result',
      winnerTeam: game.winner ? game.winner.team : null,
      match: game.match,
    });
  }

  function applyOnlineResult(data) {
    if (!isOnlineGuest() || !data) return;
    if (data.match) game.match = data.match;
    game.winner =
      data.winnerTeam === 'player'
        ? game.player
        : data.winnerTeam === 'enemy'
          ? game.enemy
          : null;
    completeBattle();
  }

  function handleOnlineRestartRequest() {
    if (!game.online.active) {
      startBattle();
      return;
    }
    if (game.online.role === 'host') {
      if (!game.online.peerJoined) {
        showToast('道友尚未在房间中', 'warn', 1300);
        return;
      }
      startOnlineBattleAsHost();
    } else {
      game.online.rematchRequested = true;
      sendOnlineRelay({ kind: 'rematch-request' });
      setText(dom.restartBtn, '已请求再战');
      dom.restartBtn.disabled = true;
      showToast('已请求再战 · 等待房主开启', '', 1800);
    }
  }

  function openSettings() {
    if (game.online.active) {
      showToast('联机对局中设置由房主决定', 'warn', 1400);
      return;
    }
    if (game.settingsOpen) return;
    releaseAllOrbSources();
    game.settingsOpen = true;
    game.paused = true;
    dom.meleeRangeInput.value = `${game.settings.meleeRange}`;
    dom.orbSpeedInput.value = `${game.settings.orbSpeed}`;
    dom.moveSpeedInput.value = `${game.settings.moveSpeedPercent}`;
    setText(dom.meleeRangeOutput, `${game.settings.meleeRange}`);
    setText(dom.orbSpeedOutput, `${game.settings.orbSpeed}`);
    setText(dom.moveSpeedOutput, `${game.settings.moveSpeedPercent}%`);
    dom.settingsScreen.hidden = false;
    dom.settingsScreen.style.zIndex = game.mode === 'battle' ? '35' : '34';
    window.setTimeout(() => dom.meleeRangeInput.focus({ preventScroll: true }), 30);
  }

  function closeSettings(apply, silent = false) {
    if (!game.settingsOpen && !apply) {
      if (!dom.settingsScreen.hidden) dom.settingsScreen.hidden = true;
      return;
    }
    if (apply) {
      const nextMelee = clamp(Math.round(Number(dom.meleeRangeInput.value) || game.settings.meleeRange), 80, 170);
      const nextSpeed = clamp(Math.round(Number(dom.orbSpeedInput.value) || game.settings.orbSpeed), 260, 560);
      const nextMove = clamp(
        Math.round(Number(dom.moveSpeedInput.value) || game.settings.moveSpeedPercent),
        100,
        300
      );
      game.settings.meleeRange = nextMelee;
      game.settings.orbSpeed = nextSpeed;
      game.settings.moveSpeedPercent = nextMove;
      saveSettings();
      if (!silent && game.mode === 'battle') {
        showToast(
          `设置已应用 · 近战 ${nextMelee} · 灵子初速 ${nextSpeed} · 移速 ${nextMove}%`,
          '',
          1650
        );
      }
    }
    game.settingsOpen = false;
    dom.settingsScreen.hidden = true;
    if (game.mode === 'battle') {
      game.paused = false;
      accumulator = 0;
    } else {
      game.paused = false;
    }
    updateHud(true);
  }

  function updateSettingsDraft() {
    setText(dom.meleeRangeOutput, `${dom.meleeRangeInput.value}`);
    setText(dom.orbSpeedOutput, `${dom.orbSpeedInput.value}`);
    setText(dom.moveSpeedOutput, `${dom.moveSpeedInput.value}%`);
  }

  function renderCardCodex() {
    if (!dom.cardCodexGrid) return;
    const cards = Object.values(CARD_LIBRARY);
    dom.cardCodexGrid.textContent = '';
    const fragment = document.createDocumentFragment();
    for (const card of cards) {
      const count = CARD_DECK.filter((id) => id === card.id).length;
      const article = document.createElement('article');
      article.className = `codex-card${card.temporary ? ' is-temporary' : ''}`;
      article.style.setProperty('--tone', card.tone);

      const top = document.createElement('div');
      top.className = 'codex-card-top';
      const art = document.createElement('span');
      art.className = 'codex-art';
      art.textContent = card.art;
      const cost = document.createElement('span');
      cost.className = 'codex-cost';
      cost.textContent = `${card.cost}`;
      top.append(art, cost);

      const name = document.createElement('h3');
      name.className = 'codex-name';
      name.textContent = card.name;
      const text = document.createElement('p');
      text.className = 'codex-text';
      text.textContent = card.text;
      const foot = document.createElement('div');
      foot.className = 'codex-foot';
      const amount = document.createElement('span');
      amount.textContent = count > 0 ? `卡组 ×${count}` : '临时牌 · 不入卡组';
      foot.appendChild(amount);

      article.append(top, name, text, foot);
      fragment.appendChild(article);
    }
    dom.cardCodexGrid.appendChild(fragment);
    if (dom.codexMeta) {
      setText(dom.codexMeta, `共 ${cards.length} 种卡牌 · 双方共用 ${CARD_DECK.length} 张卡组`);
    }
  }

  function openCardCodex() {
    if (!dom.cardCodexScreen) return;
    renderCardCodex();
    dom.cardCodexScreen.hidden = false;
    dom.cardCodexScreen.style.zIndex = '40';
    if (dom.closeCodexBtn) window.setTimeout(() => dom.closeCodexBtn.focus({ preventScroll: true }), 30);
  }

  function closeCardCodex() {
    if (!dom.cardCodexScreen || dom.cardCodexScreen.hidden) return;
    dom.cardCodexScreen.hidden = true;
    if (dom.cardCodexBtn) dom.cardCodexBtn.focus({ preventScroll: true });
  }

  function bindEvents() {
    window.addEventListener('resize', () => {
      window.clearTimeout(bindEvents.resizeTimer);
      bindEvents.resizeTimer = window.setTimeout(() => resizeCanvas(false), 80);
    });
    window.addEventListener('orientationchange', () => {
      window.setTimeout(() => resizeCanvas(false), 260);
    });
    window.addEventListener('blur', () => {
      input.keys.clear();
      input.keyTime = Object.create(null);
      releaseAllOrbSources();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        input.keys.clear();
        input.keyTime = Object.create(null);
        releaseAllOrbSources();
        if (isOnlineHost() && game.online.active) {
          startOnlineBackgroundTicker();
          showToast('房主页面切到后台，已启用后台同步；请尽快切回前台', 'warn', 2400);
        }
      } else if (!document.hidden) {
        stopOnlineBackgroundTicker();
        lastFrame = 0;
        accumulator = 0;
      }
    });

    dom.startBtn.addEventListener('click', () => startBattle());
    if (dom.keybindBtn) dom.keybindBtn.addEventListener('click', openKeybindScreen);
    if (dom.keybindDoneBtn) dom.keybindDoneBtn.addEventListener('click', closeKeybindScreen);
    if (dom.keybindResetBtn) dom.keybindResetBtn.addEventListener('click', resetBindings);
    if (dom.keybindScreen) {
      dom.keybindScreen.addEventListener('click', (event) => {
        if (event.target === dom.keybindScreen) closeKeybindScreen();
      });
    }
    dom.settingsBtn.addEventListener('click', () => {
      if (game.online.active) {
        leaveOnlineRoom({ toStart: true });
      } else {
        openSettings();
      }
    });
    dom.onlineBtn.addEventListener('click', () => openOnlineScreen());
    dom.onlineCreateBtn.addEventListener('click', () => createOnlineRoom());
    dom.onlineJoinBtn.addEventListener('click', () => joinOnlineRoom());
    dom.onlineBackBtn.addEventListener('click', () => closeOnlineScreen());
    dom.onlineLeaveBtn.addEventListener('click', () => leaveOnlineRoom({ toStart: true }));
    dom.onlineStartBtn.addEventListener('click', () => startOnlineBattleAsHost());
    dom.onlineCopyBtn.addEventListener('click', () => copyOnlineInvite());
    dom.onlineCodeInput.addEventListener('input', () => {
      const normalized = normalizeOnlineCode(dom.onlineCodeInput.value);
      if (dom.onlineCodeInput.value !== normalized) dom.onlineCodeInput.value = normalized;
      setOnlineError('');
    });
    dom.onlineCodeInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        joinOnlineRoom();
      }
    });
    dom.onlineScreen.addEventListener('click', (event) => {
      if (event.target === dom.onlineScreen && !game.online.role) closeOnlineScreen();
    });
    dom.restartBtn.addEventListener('click', () => {
      if (game.online.active) handleOnlineRestartRequest();
      else startBattle();
    });
    dom.backToStartBtn.addEventListener('click', () => {
      if (game.online.active) leaveOnlineRoom({ toStart: true });
      else returnToStart();
    });
    if (dom.cardCodexBtn) dom.cardCodexBtn.addEventListener('click', () => openCardCodex());
    if (dom.closeCodexBtn) dom.closeCodexBtn.addEventListener('click', () => closeCardCodex());
    if (dom.cardCodexScreen) {
      dom.cardCodexScreen.addEventListener('click', (event) => {
        if (event.target === dom.cardCodexScreen) closeCardCodex();
      });
    }
    dom.applySettingsBtn.addEventListener('click', () => closeSettings(true));
    dom.cancelSettingsBtn.addEventListener('click', () => closeSettings(false));
    dom.meleeRangeInput.addEventListener('input', updateSettingsDraft);
    dom.orbSpeedInput.addEventListener('input', updateSettingsDraft);
    dom.moveSpeedInput.addEventListener('input', updateSettingsDraft);
    dom.settingsScreen.addEventListener('click', (event) => {
      if (event.target === dom.settingsScreen) closeSettings(false);
    });

    dom.canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    dom.canvas.addEventListener('pointermove', (event) => {
      input.mouseX = event.clientX;
      input.mouseY = event.clientY;
      input.hasMouse = true;
      input.pointerInside = true;
    });
    dom.canvas.addEventListener('pointerleave', () => {
      input.pointerInside = false;
    });
    dom.canvas.addEventListener('pointerdown', (event) => {
      if (game.mode !== 'battle' || game.paused || game.settingsOpen) return;
      event.preventDefault();
      input.mouseX = event.clientX;
      input.mouseY = event.clientY;
      input.hasMouse = true;
      input.pointerInside = true;
      const code = `Mouse${event.button}`;
      const actions = actionsForCode(code);
      if (actions.length === 0) return;
      const orbBound = actions.includes('orb');
      const counterBound = actions.includes('counter');
      if (actions.includes('melee')) playerMelee(false);
      for (let i = 1; i <= 5; i += 1) {
        if (actions.includes(`card${i}`)) playCardByIndex(i - 1);
      }
      if (actions.includes('dodge')) playerDodge();
      if (counterBound && !orbBound) requestCounter();
      if (orbBound) {
        setOrbSource(`Mouse:${event.button}`, true);
        playerOrb(false, counterBound);
      }
    });

    dom.cardHand.addEventListener('pointerdown', (event) => {
      const cardElement = event.target.closest('.game-card');
      if (!cardElement) return;
      event.preventDefault();
      event.stopPropagation();
      beginCardDrag(cardElement, event);
    });
    dom.dodgeBtn.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      dom.dodgeBtn.blur();
      if (game.mode !== 'battle' || game.paused || game.settingsOpen) return;
      playerDodge();
    });
    if (dom.counterBtn) {
      dom.counterBtn.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        event.stopPropagation();
        dom.counterBtn.blur();
        if (game.mode !== 'battle' || game.paused || game.settingsOpen) return;
        requestCounter();
      });
    }
    // 拖牌期间阻止右键菜单；撤回改为「在手牌区松开左键」。
    window.addEventListener(
      'contextmenu',
      (event) => {
        if (game.cardDrag) event.preventDefault();
      },
      true
    );
    window.addEventListener('pointermove', (event) => {
      if (game.cardDrag) updateCardDrag(event);
    });
    window.addEventListener('pointerup', (event) => {
      if (game.cardDrag) finishCardDrag(event);
      if (event.button >= 0) setOrbSource(`Mouse:${event.button}`, false);
    });
    window.addEventListener('pointercancel', () => {
      releaseAllOrbSources();
      const drag = game.cardDrag;
      if (!drag) return;
      game.cardDrag = null;
      if (drag.ghost) drag.ghost.remove();
      if (drag.element) drag.element.classList.remove('is-dragging');
    });

    window.addEventListener('pointerdown', (event) => {
      if (!dom.keybindScreen || dom.keybindScreen.hidden || !keybindState.listening) return;
      if (event.target.closest('button, input, a, select, textarea')) return;
      event.preventDefault();
      event.stopPropagation();
      captureKeybind(`Mouse${event.button}`);
    }, true);

    window.addEventListener('contextmenu', (event) => {
      if (dom.keybindScreen && !dom.keybindScreen.hidden) event.preventDefault();
    }, true);

    window.addEventListener('keydown', (event) => {
      ensureAudio();
      const code = event.code;
      if (dom.keybindScreen && !dom.keybindScreen.hidden) {
        event.preventDefault();
        if (keybindState.listening) {
          if (code === 'Escape') cancelKeybindListen();
          else if (!event.repeat) captureKeybind(code);
        } else if (code === 'Escape') {
          closeKeybindScreen();
        }
        return;
      }
      const isMovement = isMovementCode(code);

      if (dom.cardCodexScreen && !dom.cardCodexScreen.hidden) {
        if (code === 'Escape') {
          event.preventDefault();
          closeCardCodex();
        }
        return;
      }

      if (game.settingsOpen) {
        if (code === 'Escape') {
          event.preventDefault();
          closeSettings(false);
        }
        return;
      }

      if (game.online.lobbyOpen && code === 'Escape') {
        event.preventDefault();
        if (game.online.role) leaveOnlineRoom({ toStart: false });
        else closeOnlineScreen();
        return;
      }

      if (game.mode === 'battle' && !game.paused) {
        if (isMovement) {
          if (!input.keys.has(code)) {
            input.keySerial += 1;
            input.keyTime[code] = input.keySerial;
          }
          input.keys.add(code);
          if (code.startsWith('Arrow')) event.preventDefault();
        }
        const actions = actionsForCode(code);
        if (actions.length > 0) event.preventDefault();
        if (!event.repeat) {
          const orbBound = actions.includes('orb');
          const counterBound = actions.includes('counter');
          if (actions.includes('dodge')) playerDodge();
          if (actions.includes('melee')) playerMelee(false);
          for (let i = 1; i <= 5; i += 1) {
            if (actions.includes(`card${i}`)) playCardByIndex(i - 1);
          }
          if (counterBound && !orbBound) requestCounter();
          if (orbBound) {
            setOrbSource(`Key:${code}`, true);
            playerOrb(false, counterBound);
          }
        }
        if (code === 'Escape') {
          event.preventDefault();
          if (game.online.active) {
            showToast('联机对局中无法打开设置', 'warn', 1200);
          } else {
            openSettings();
          }
        }
      } else if (game.mode === 'start') {
        if (code === 'Enter' && !event.repeat && !game.online.lobbyOpen) {
          event.preventDefault();
          startBattle();
        }
      } else if (game.mode === 'over') {
        if (code === 'Escape') {
          event.preventDefault();
          if (game.online.active) leaveOnlineRoom({ toStart: true });
          else returnToStart();
        }
      }
    });

    window.addEventListener('keyup', (event) => {
      input.keys.delete(event.code);
      delete input.keyTime[event.code];
      setOrbSource(`Key:${event.code}`, false);
    });

    window.addEventListener('pointerdown', (event) => {
      ensureAudio();
      if (event.target !== dom.canvas) {
        input.hasMouse = false;
      }
    });
  }

  function init() {
    bindEvents();
    resizeCanvas(true);
    resetIdleScene();
    game.mode = 'start';
    setBodyMode('start');
    dom.startScreen.hidden = false;
    dom.settingsScreen.hidden = true;
    dom.resultScreen.hidden = true;
    if (dom.keybindScreen) dom.keybindScreen.hidden = true;
    refreshBindingHints();
    renderKeybindScreen();
    updateMemoryLabels();
    updateHud(true);
    window.requestAnimationFrame(() => {
      resizeCanvas(true);
      updateHud(true);
    });

    if (window.location.protocol === 'file:') {
      dom.onlineBtn.hidden = true;
    }
    const inviteCode = normalizeOnlineCode(new URLSearchParams(window.location.search).get('room'));
    if (inviteCode && window.location.protocol !== 'file:') {
      window.setTimeout(() => openOnlineScreen(inviteCode), 260);
    }

    // Expose a deliberately small diagnostic surface for automated verification and tinkering.
    window.__WENDAO__ = {
      getSnapshot() {
        const serializeFighter = (fighter) =>
          fighter
            ? {
                team: fighter.team,
                x: Number(fighter.x.toFixed(2)),
                y: Number(fighter.y.toFixed(2)),
                radius: Number(fighter.radius.toFixed(2)),
                hp: Number(fighter.hp.toFixed(2)),
                mana: Number(fighter.mana.toFixed(2)),
                maxMana: fighter.maxMana,
                essence: fighter.essence,
                meleeCombo: fighter.meleeCombo,
                rangedCombo: fighter.rangedCombo,
                meleeCooldown: Number(fighter.meleeCooldown.toFixed(3)),
                orbCooldown: Number(fighter.orbCooldown.toFixed(3)),
                dodgeCooldown: Number(fighter.dodgeCooldown.toFixed(3)),
                dodgeRemaining: Number(fighter.dodgeRemaining.toFixed(3)),
                counterCooldown: Number(fighter.counterCooldown.toFixed(2)),
                counterOrbLock: Number((fighter.counterOrbLock || 0).toFixed(2)),
                healUses: fighter.healUses,
                throwRemaining: Number(fighter.throwRemaining.toFixed(2)),
                bounceRemaining: Number(fighter.bounceRemaining.toFixed(3)),
                invuln: Number(fighter.invuln.toFixed(3)),
                regenBlocked: Number(fighter.regenBlocked.toFixed(3)),
                speedBoostTimer: Number(fighter.speedBoostTimer.toFixed(2)),
                buffAppliedAt: { ...(fighter.buffAppliedAt || {}) },
                healRemaining: Number(fighter.healRemaining.toFixed(2)),
                stunRemaining: Number(fighter.stunRemaining.toFixed(2)),
                rootTimer: Number(fighter.rootTimer.toFixed(2)),
                meditationTimer: Number(fighter.meditationTimer.toFixed(2)),
                castDuration: Number((fighter.castDuration || 0).toFixed(2)),
                damageBoostTimer: Number(fighter.damageBoostTimer.toFixed(2)),
                stats: { ...fighter.stats },
                swing: fighter.swing ? { ...fighter.swing } : null,
              }
            : null;
        return {
          mode: game.mode,
          paused: game.paused,
          settingsOpen: game.settingsOpen,
          battleTime: Number(game.battleTime.toFixed(2)),
          settings: { ...game.settings },
          winner: game.winner ? game.winner.team : null,
          player: serializeFighter(game.player),
          enemy: serializeFighter(game.enemy),
          projectiles: game.projectiles.map((p) => ({
            owner: p.owner,
            x: Number(p.x.toFixed(2)),
            y: Number(p.y.toFixed(2)),
            speed: Number(p.speed.toFixed(2)),
            damage: p.damage,
            serial: p.serial,
            manaCost: p.manaCost,
          })),
          cards: game.cards
            ? {
                hand: [...game.cards.hand],
                preview: Array.isArray(game.cards.preview) ? [...game.cards.preview] : [],
                deck: [...game.cards.deck],
                giantSwords: game.giantSwords.map((sword) => ({
                  x: Number(sword.x.toFixed(1)),
                  y: Number(sword.y.toFixed(1)),
                  elapsed: Number(sword.elapsed.toFixed(2)),
                  delay: sword.delay,
                  struck: sword.struck,
                })),
              }
            : null,
          aiCards: game.enemyCards
            ? {
                hand: [...game.enemyCards.hand],
                preview: Array.isArray(game.enemyCards.preview) ? [...game.enemyCards.preview] : [],
                deckSize: game.enemyCards.deck.length,
              }
            : null,
          cardsPlayed: {
            player: game.match.cardsPlayed,
            enemy: game.enemy ? game.enemy.stats.cardsPlayed : 0,
          },
          obstacles: world.obstacles.map((o) => ({
            kind: o.kind,
            x: Number(o.x.toFixed(2)),
            y: Number(o.y.toFixed(2)),
            radius: Number(o.radius.toFixed(2)),
          })),
          arena: { ...world.arena },
          play: { ...world.play },
          meleeReachActual: Number(getMeleeReach(game.player).toFixed(2)),
          historyLength: game.history.length,
          clashCount: game.clashCount,
          match: { ...game.match },
          online: {
            role: game.online.role,
            code: game.online.code,
            peerJoined: game.online.peerJoined,
            active: game.online.active,
            connected: game.online.connected,
            lobbyOpen: game.online.lobbyOpen,
            localTeam: game.online.localTeam,
            lastSnapshotReceivedAt: game.online.lastSnapshotReceivedAt,
          },
          combatLog: game.combatLog.map((entry) => ({ ...entry })),
          ai: game.ai
            ? {
                mode: game.ai.mode,
                lastReason: game.ai.lastReason,
                pathLength: game.ai.path ? game.ai.path.length : 0,
                pathIndex: game.ai.pathIndex,
                path: game.ai.path ? game.ai.path.map((point) => ({ x: +point.x.toFixed(1), y: +point.y.toFixed(1) })) : [],
                thinkTimer: Number(game.ai.thinkTimer.toFixed(2)),
                hideSpot: game.ai.hideSpot ? { x: +game.ai.hideSpot.x.toFixed(1), y: +game.ai.hideSpot.y.toFixed(1) } : null,
                hideTimer: Number(game.ai.hideTimer.toFixed(2)),
                debugTarget: game.ai.debugTarget || null,
              }
            : null,
        };
      },
      dev: {
        setPosition(team, x, y) {
          const fighter = team === 'player' ? game.player : game.enemy;
          if (!fighter) return;
          fighter.x = clamp(x, world.play.x + fighter.radius, world.play.x + world.play.w - fighter.radius);
          fighter.y = clamp(y, world.play.y + fighter.radius, world.play.y + world.play.h - fighter.radius);
          resolveObstaclePenetration(fighter);
          fighter.prevX = fighter.x;
          fighter.prevY = fighter.y;
        },
        setPositions(playerX, playerY, enemyX, enemyY) {
          if (!game.player || !game.enemy) return;
          game.player.x = clamp(
            playerX,
            world.play.x + game.player.radius,
            world.play.x + world.play.w - game.player.radius
          );
          game.player.y = clamp(
            playerY,
            world.play.y + game.player.radius,
            world.play.y + world.play.h - game.player.radius
          );
          game.enemy.x = clamp(
            enemyX,
            world.play.x + game.enemy.radius,
            world.play.x + world.play.w - game.enemy.radius
          );
          game.enemy.y = clamp(
            enemyY,
            world.play.y + game.enemy.radius,
            world.play.y + world.play.h - game.enemy.radius
          );
          resolveObstaclePenetration(game.player);
          resolveObstaclePenetration(game.enemy);
          game.player.prevX = game.player.x;
          game.player.prevY = game.player.y;
          game.enemy.prevX = game.enemy.x;
          game.enemy.prevY = game.enemy.y;
          if (game.ai) {
            game.ai.path = null;
            game.ai.pathIndex = 0;
            game.ai.pathGoal = null;
            game.ai.pathAge = 0;
          }
        },
        setHp(team, hp) {
          const fighter = team === 'player' ? game.player : game.enemy;
          if (fighter) fighter.hp = clamp(hp, 0, fighter.maxHp);
        },
        setInvulnerable(team, seconds) {
          const fighter = team === 'player' ? game.player : game.enemy;
          if (fighter) fighter.invuln = Math.max(0, Number(seconds) || 0);
        },
        setStun(team, seconds) {
          const fighter = team === 'player' ? game.player : game.enemy;
          if (fighter) applyStun(fighter, Math.max(0, Number(seconds) || 0));
        },
        setMana(team, mana) {
          const fighter = team === 'player' ? game.player : game.enemy;
          if (fighter) fighter.mana = clamp(mana, 0, fighter.maxMana);
        },
        setCombo(team, melee, ranged) {
          const fighter = team === 'player' ? game.player : game.enemy;
          if (fighter) {
            fighter.meleeCombo = Math.max(0, Math.floor(melee));
            fighter.rangedCombo = Math.max(0, Math.floor(ranged));
          }
        },
        setFacing(team, angle) {
          const fighter = team === 'player' ? game.player : game.enemy;
          if (fighter) {
            fighter.facing = angle;
            fighter.aimAngle = angle;
          }
        },
        setCooldowns(team, values = {}) {
          const fighter = team === 'player' ? game.player : game.enemy;
          if (!fighter) return;
          if (Number.isFinite(values.dodge)) fighter.dodgeCooldown = values.dodge;
          if (Number.isFinite(values.counter)) fighter.counterCooldown = values.counter;
          if (Number.isFinite(values.melee)) fighter.meleeCooldown = values.melee;
          if (Number.isFinite(values.orb)) fighter.orbCooldown = values.orb;
        },
        setEssence(team, value) {
          const fighter = team === 'player' ? game.player : game.enemy;
          if (fighter) fighter.essence = clamp(Math.round(value), 0, CONFIG.essenceMax);
          updateHud(true);
        },
        setHand(ids) {
          if (!game.cards || !Array.isArray(ids)) return false;
          game.cards.hand = ids.filter((id) => CARD_LIBRARY[id]).slice(0, CARD_HAND_SIZE);
          game.cards.preview = game.cards.hand.map((_, i) => game.cards.deck[i] || null);
          if (game.player) game.player.stealPlusTimers = [];
          renderCardHand();
          updateHud(true);
          return true;
        },
        setEnemyHand(ids) {
          if (!game.enemyCards || !Array.isArray(ids)) return false;
          game.enemyCards.hand = ids.filter((id) => CARD_LIBRARY[id]).slice(0, CARD_HAND_SIZE);
          game.enemyCards.preview = game.enemyCards.hand.map((_, i) => game.enemyCards.deck[i] || null);
          if (game.enemy) game.enemy.stealPlusTimers = [];
          return true;
        },
        playCard(index, x, y) {
          const id = game.cards && game.cards.hand[index];
          const card = cardById(id);
          const player = game.player;
          if (!card || !player) return false;
          const point =
            card.targeting === 'ground'
              ? { x: Number.isFinite(x) ? x : player.x, y: Number.isFinite(y) ? y : player.y }
              : { x: player.x, y: player.y };
          return playCard(player, card, point);
        },
        hand() {
          return game.cards ? [...game.cards.hand] : [];
        },
        setEnemyMode(mode) {
          if (game.ai) game.ai.mode = mode;
        },
        stopPlayer() {
          input.keys.clear();
      input.keyTime = Object.create(null);
        },
        freezeAI(value = true) {
          game.debugFreezeAI = Boolean(value);
        },
        fireOrb(team, angle) {
          const fighter = team === 'player' ? game.player : game.enemy;
          if (fighter) tryOrb(fighter, Number(angle));
        },
        meleeAt(team, angle) {
          const fighter = team === 'player' ? game.player : game.enemy;
          if (fighter) tryMelee(fighter, Number(angle));
        },
        damage(team, amount, source = 'melee') {
          const fighter = team === 'player' ? game.player : game.enemy;
          if (fighter) {
            damageFighter(fighter, Number(amount), { source, showText: true });
          }
        },
        lineOfSight(team) {
          const fighter = team === 'player' ? game.player : game.enemy;
          if (!fighter) return false;
          return hasProjectileLine(fighter, fighter === game.player ? game.enemy : game.player);
        },
        meleeLineOfSight(team) {
          const fighter = team === 'player' ? game.player : game.enemy;
          if (!fighter) return false;
          return hasMeleeLine(fighter, fighter === game.player ? game.enemy : game.player);
        },
        setSettings(meleeRange, orbSpeed, moveSpeedPercent) {
          game.settings.meleeRange = clamp(Math.round(meleeRange), 80, 170);
          game.settings.orbSpeed = clamp(Math.round(orbSpeed), 260, 560);
          if (Number.isFinite(moveSpeedPercent)) {
            game.settings.moveSpeedPercent = clamp(Math.round(moveSpeedPercent), 100, 300);
          }
        },
        faceEachOther() {
          if (!game.player || !game.enemy) return;
          const angle = Math.atan2(game.enemy.y - game.player.y, game.enemy.x - game.player.x);
          game.player.facing = angle;
          game.player.aimAngle = angle;
          game.enemy.facing = angle + Math.PI;
          game.enemy.aimAngle = angle + Math.PI;
        },
      },
      startBattle,
      returnToStart,
      openSettings,
      applySettings: () => closeSettings(true),
      cancelSettings: () => closeSettings(false),
      playerMelee,
      playerOrb,
      playerDodge,
      playCard: (index, x, y) => {
        const id = game.cards && game.cards.hand[index];
        const card = cardById(id);
        const player = game.player;
        if (!card || !player) return false;
        return playCard(player, card, { x: Number.isFinite(x) ? x : player.x, y: Number.isFinite(y) ? y : player.y });
      },
      tryMelee,
      tryOrb,
      tryDodge,
      damageFighter,
      findPath,
      getConfig: () => ({ ...CONFIG }),
      getOnlineState: () => ({
        role: game.online.role,
        code: game.online.code,
        peerJoined: game.online.peerJoined,
        active: game.online.active,
        connected: game.online.connected,
        lobbyOpen: game.online.lobbyOpen,
        localTeam: game.online.localTeam,
        inputSeq: game.online.inputSeq,
        lastSnapshotReceivedAt: game.online.lastSnapshotReceivedAt,
        rtt: game.online.rtt,
        rtc: {
          supported: rtcSupported(),
          ready: game.online.rtc.ready,
          state: game.online.rtc.state,
          pcState: game.online.rtc.pc ? game.online.rtc.pc.connectionState : 'none',
          sent: game.online.rtc.sent,
          received: game.online.rtc.received,
        },
      }),
    };

    lastFrame = 0;
    frameRequest = window.requestAnimationFrame(loop);
  }

  init();
})();


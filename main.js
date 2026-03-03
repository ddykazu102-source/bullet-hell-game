(() => {
  "use strict";

  // ===== Canvas =====
  const canvas = document.getElementById("c");
  const ctx = canvas.getContext("2d", { alpha: false });

  const W = 720, H = 900;
  const TAU = Math.PI * 2;

  let DPR = 1;
  let SCALE = 1;

  function resizeCanvas() {
    const cw = Math.max(1, Math.floor(canvas.clientWidth || W));
    const ch = Math.max(1, Math.floor(canvas.clientHeight || (cw * (H / W))));
    DPR = Math.min(3, Math.max(1, (window.devicePixelRatio || 1)));
    canvas.width  = Math.floor(cw * DPR);
    canvas.height = Math.floor(ch * DPR);
    SCALE = Math.min(cw / W, ch / H);
    ctx.setTransform(SCALE * DPR, 0, 0, SCALE * DPR, 0, 0);
    ctx.imageSmoothingEnabled = true;
  }

  const ro = new ResizeObserver(() => resizeCanvas());
  ro.observe(canvas);
  window.addEventListener("orientationchange", () => setTimeout(resizeCanvas, 50));
  resizeCanvas();

  // ===== UI =====
  const uiState = document.getElementById("uiState");
  const uiDiff  = document.getElementById("uiDiff");
  const uiScore = document.getElementById("uiScore");
  const uiLives = document.getElementById("uiLives");
  const uiBombs = document.getElementById("uiBombs");
  const uiSpells= document.getElementById("uiSpells");
  const uiEnemy = document.getElementById("uiEnemy");
  const uiHi    = document.getElementById("uiHi");
  const uiReplay= document.getElementById("uiReplay");
  const uiCards = document.getElementById("uiCards");
  const uiPhase = document.getElementById("uiPhase");
  const uiGraze = document.getElementById("uiGraze");
  const uiPower = document.getElementById("uiPower");

  // ===== Control mode (keyboard / mouse) =====
  const uiCtrlHint = document.getElementById("uiCtrlHint");
  const ctrlRadios = Array.from(document.querySelectorAll('input[name="ctrlMode"]'));

  const CTRL_KEY = "mini_danmaku_ctrl";
  let controlMode = localStorage.getItem(CTRL_KEY) || "keyboard";

  function applyCtrlUi() {
    for (const r of ctrlRadios) r.checked = (r.value === controlMode);

    if (!uiCtrlHint) return;
    if (controlMode === "mouse") {
      uiCtrlHint.textContent = "マウス：カーソル位置へ追従して移動（自動ショット）。右クリック=BOMB / 中クリック=CARD。※リプレイ保存は無効";
    } else {
      uiCtrlHint.textContent = "キー：矢印/WASDで移動（自動ショット）。Shift=低速 / X=BOMB / C=CARD。リプレイ保存あり";
    }
  }

  function setControlMode(m) {
    controlMode = (m === "mouse") ? "mouse" : "keyboard";
    localStorage.setItem(CTRL_KEY, controlMode);
    applyCtrlUi();

    // マウスに切り替えたら、録画中リプレイは無効化（位置情報を記録できないため）
    if (controlMode === "mouse" && replayMode === "record") {
      replayMode = "off";
      replay = null;
      uiReplay.textContent = "mouse mode";
    }
  }

  for (const r of ctrlRadios) {
    r.addEventListener("change", () => setControlMode(r.value));
  }
  applyCtrlUi();

  // ===== Mouse input =====
  const mouse = { x: W/2, y: H*0.82, inside: false, rdown:false, mdown:false };
  let prevMouseR = false;
  let prevMouseM = false;

  function clamp(v,a,b){ return Math.max(a, Math.min(b,v)); }

  function updateMouseFromEvent(ev) {
    const rect = canvas.getBoundingClientRect();
    const nx = (ev.clientX - rect.left) / rect.width;
    const ny = (ev.clientY - rect.top) / rect.height;
    mouse.x = clamp(nx * W, 0, W);
    mouse.y = clamp(ny * H, 0, H);
    mouse.inside = (nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1);
  }

  canvas.addEventListener("mousemove", (e)=>{ updateMouseFromEvent(e); });
  canvas.addEventListener("mouseenter", (e)=>{ updateMouseFromEvent(e); mouse.inside = true; });
  canvas.addEventListener("mouseleave", ()=>{ mouse.inside = false; mouse.rdown=false; mouse.mdown=false; });
  canvas.addEventListener("contextmenu", (e)=>{ e.preventDefault(); }, {passive:false});
  canvas.addEventListener("mousedown", (e)=>{
    if (controlMode !== "mouse") return;
    updateMouseFromEvent(e);
    if (e.button === 2) mouse.rdown = true;
    if (e.button === 1) mouse.mdown = true;
  });
  canvas.addEventListener("mouseup", (e)=>{
    if (e.button === 2) mouse.rdown = false;
    if (e.button === 1) mouse.mdown = false;
  });

  const uiLifePieces = document.getElementById("uiLifePieces");
  const uiBombPieces = document.getElementById("uiBombPieces");
  const uiSpellTime  = document.getElementById("uiSpellTime");

  // ===== Difficulty =====
  const DIFF_ORDER = ["easy","normal","hard","expert","lunatic"];
  const DIFF = {
    easy:    { enemyHp:1.00, bulletRate:0.80, bulletSpeed:1.00, bulletCount:0.80, enemies:3, startLives:4, startBombs:5, bombCap:7,  maxHand:4, lifeCap:6 },
    normal:  { enemyHp:1.20, bulletRate:1.00, bulletSpeed:1.10, bulletCount:1.00, enemies:3, startLives:5, startBombs:5, bombCap:8,  maxHand:5, lifeCap:6 },
    hard:    { enemyHp:1.80, bulletRate:1.20, bulletSpeed:1.40, bulletCount:1.15, enemies:3, startLives:5, startBombs:5, bombCap:8,  maxHand:5, lifeCap:6 },
    expert:  { enemyHp:2.25, bulletRate:1.35, bulletSpeed:1.90, bulletCount:1.30, enemies:4, startLives:6, startBombs:5, bombCap:6,  maxHand:5, lifeCap:7 },
    lunatic: { enemyHp:3.55, bulletRate:1.55, bulletSpeed:2.30, bulletCount:1.55, enemies:4, startLives:7, startBombs:5, bombCap:5, maxHand:6, lifeCap:7 },
  };

  // ===== Game State =====
  const STATE = { MENU:"MENU", PLAY:"PLAY", OVER:"OVER", CLEAR:"CLEAR" };
  let gameState = STATE.MENU;

  let diffIndex = 1;
  let difficulty = DIFF_ORDER[diffIndex];

  // ===== LocalStorage keys =====
  const HS_KEY = (diff) => `mini_danmaku_hs_${diff}`;
  const REPLAY_KEY = `mini_danmaku_last_replay`;

  function getHi(diff){ return Number(localStorage.getItem(HS_KEY(diff)) || 0); }
  function setHi(diff, v){ localStorage.setItem(HS_KEY(diff), String(v|0)); }

  // ===== RNG (replay-safe) =====
  let rngSeed = 123456789;
  function srand(seed){ rngSeed = (seed|0) || 1; }
  function rand() {
    let x = rngSeed | 0;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    rngSeed = x | 0;
    return ((x >>> 0) / 4294967296);
  }
  function nowSeed(){ return (Date.now() ^ (performance.now()*1000|0))|0; }

  // ===== Fixed timestep =====
  const TICK = 1/60;

  // ===== Input -> bitmask =====
  const BIT = {
    L:1<<0, R:1<<1, U:1<<2, D:1<<3,
    SLOW:1<<4,
    BOMB:1<<5,
    CARD1:1<<6,
    CARD2:1<<7,
    CARD3:1<<8,
    CARDNEXT:1<<9,
  };

  const key = Object.create(null);

  // ===== Touch controls =====
  const touchUI  = document.getElementById("touchUI");
  const menuBtns = document.getElementById("menuBtns");

  const ACT2CODE = {
    left: "ArrowLeft",
    right:"ArrowRight",
    up:   "ArrowUp",
    down: "ArrowDown",
    slow: "ShiftLeft",
    bomb: "KeyX",
    card: "KeyC",
  };

  function setAct(act, down){
    if (down) {
      if (act === "diffUp") {
        if (gameState === STATE.MENU) {
          diffIndex = (diffIndex + DIFF_ORDER.length - 1) % DIFF_ORDER.length;
          difficulty = DIFF_ORDER[diffIndex];
        }
        return;
      }
      if (act === "diffDown") {
        if (gameState === STATE.MENU) {
          diffIndex = (diffIndex + 1) % DIFF_ORDER.length;
          difficulty = DIFF_ORDER[diffIndex];
        }
        return;
      }
      if (act === "start") {
        if (gameState === STATE.MENU) startGame(false);
        return;
      }
      if (act === "replay") {
        if (gameState === STATE.MENU || gameState === STATE.OVER || gameState === STATE.CLEAR) {
          tryStartReplay();
        }
        return;
      }
      if (act === "menu") {
        gameState = STATE.MENU;
        clearKeys();
        return;
      }
    }

    const code = ACT2CODE[act];
    if (!code) return;
    key[code] = !!down;
  }

  function killScroll(e){ e.preventDefault(); }

  if (touchUI) {
    const btns = touchUI.querySelectorAll("[data-act]");
    btns.forEach((btn) => {
      const act = btn.getAttribute("data-act");

      btn.addEventListener("pointerdown", (e) => {
        killScroll(e);
        btn.setPointerCapture?.(e.pointerId);
        setAct(act, true);
      }, { passive:false });

      const up = (e) => { killScroll(e); setAct(act, false); };
      btn.addEventListener("pointerup", up, { passive:false });
      btn.addEventListener("pointercancel", up, { passive:false });
      btn.addEventListener("pointerleave", up, { passive:false });
    });
  }

  function clearKeys() { for (const k in key) key[k] = false; }
  window.addEventListener("blur", clearKeys);
  document.addEventListener("visibilitychange", () => { if (document.hidden) clearKeys(); });

  const BLOCK_KEYS = new Set([
    "ArrowLeft","ArrowRight","ArrowUp","ArrowDown",
    "KeyW","KeyA","KeyS","KeyD",
    "Space",
    "ShiftLeft","ShiftRight",
    "KeyX","KeyC",
    "Digit1","Digit2","Digit3",
  ]);

  window.addEventListener("keydown", (e) => {
    if (BLOCK_KEYS.has(e.code)) e.preventDefault();
    key[e.code] = true;

    if (gameState === STATE.MENU) {
      if (e.code === "ArrowUp")   { diffIndex = (diffIndex + DIFF_ORDER.length - 1) % DIFF_ORDER.length; difficulty = DIFF_ORDER[diffIndex]; }
      if (e.code === "ArrowDown") { diffIndex = (diffIndex + 1) % DIFF_ORDER.length; difficulty = DIFF_ORDER[diffIndex]; }
      if (e.code === "Enter") startGame(false);
      if (e.code === "KeyR") tryStartReplay();
    } else {
      if (e.code === "Escape") { gameState = STATE.MENU; clearKeys(); }
      if ((gameState === STATE.OVER || gameState === STATE.CLEAR) && e.code === "KeyR") tryStartReplay();
    }
  }, { passive: false });

  window.addEventListener("keyup", (e) => {
    if (BLOCK_KEYS.has(e.code)) e.preventDefault();
    key[e.code] = false;
  }, { passive: false });

  function makeInputMaskLive() {
    let m = 0;
    if (key["ArrowLeft"] || key["KeyA"]) m |= BIT.L;
    if (key["ArrowRight"]|| key["KeyD"]) m |= BIT.R;
    if (key["ArrowUp"]   || key["KeyW"]) m |= BIT.U;
    if (key["ArrowDown"] || key["KeyS"]) m |= BIT.D;
    if (key["ShiftLeft"] || key["ShiftRight"]) m |= BIT.SLOW;

    if (key["KeyX"]) m |= BIT.BOMB;
    if (key["KeyC"]) m |= BIT.CARDNEXT;
    if (key["Digit1"]) m |= BIT.CARD1;
    if (key["Digit2"]) m |= BIT.CARD2;
    if (key["Digit3"]) m |= BIT.CARD3;
    return m;
  }

  // ===== Replay =====
  let replayMode = "off";
  let replay = null;

  function saveReplay(meta, frames) {
    localStorage.setItem(REPLAY_KEY, JSON.stringify({ meta, frames }));
  }
  function loadReplay() {
    const s = localStorage.getItem(REPLAY_KEY);
    if (!s) return null;
    try { return JSON.parse(s); } catch { return null; }
  }
  function tryStartReplay() {
    const r = loadReplay();
    if (!r || !r.frames || !r.frames.length) return;

    const d = r.meta?.difficulty;
    if (d && DIFF[d]) {
      difficulty = d;
      diffIndex = DIFF_ORDER.indexOf(d);
      if (diffIndex < 0) diffIndex = 1;
    }
    startGame(true, r);
  }

  // ===== Cards =====
  const CARD_DEF = {
    LASER: {
      id:"LASER",
      name:"光符「レーザー」",
      use: (dp) => spawnCardEffect({ type:"laser", t:0, dur:2.2, dps: 260*dp.enemyHp, w: 8 })
    },
    NOVA: {
      id:"NOVA",
      name:"爆符「ノヴァ」",
      use: (_dp) => {
        const cleared = eBullets.length;
        eBullets.length = 0;
        for (const e of enemies) e.hp -= (e.kind==="zako") ? 999 : 180;
        spawnCardEffect({ type:"nova", t:0, dur:0.7, cleared });
      }
    },
    SLOWTIME: {
      id:"SLOWTIME",
      name:"時符「スロウ」",
      use: (_dp) => spawnCardEffect({ type:"slow", t:0, dur:2.8, mul:0.35 })
    },
    BARRIER: {
      id:"BARRIER",
      name:"護符「バリア」",
      use: (_dp) => {
        player.inv = Math.max(player.inv, 1.4);
        let n=0;
        for (let i=eBullets.length-1;i>=0;i--){
          const b=eBullets[i];
          const dx=b.x-player.x, dy=b.y-player.y;
          if (dx*dx+dy*dy < 140*140) { eBullets.splice(i,1); n++; }
        }
        spawnCardEffect({ type:"barrier", t:0, dur:1.0, cleared:n });
      }
    },
  };

  function drawCardId() {
    const roll = rand();
    if (roll < 0.12) return "NOVA";
    if (roll < 0.44) return "LASER";
    if (roll < 0.72) return "SLOWTIME";
    return "BARRIER";
  }

  // ===== Entities =====
  const player = {
    x: W/2, y: H*0.82,
    r: 5,
    speed: 360,
    slowMul: 0.45,
    inv: 0,
    lives: 3,
    bombs: 3,
    hand: [],
    maxHand: 3,
    shotCool: 0,
    bombCool: 0,
    cardCool: 0,

    // 東方要素
    power: 1,      // 1..4
    powerFrac: 0,  // 0..1
    lifePieces: 0, // 0..(LIFE_PIECES-1)
    bombPieces: 0, // 0..(BOMB_PIECES-1)

    // 決めボム
    hitPending: 0,     // >0 の間にボム入力で生還
    pendingLifeLoss: 0 // 1 だけ想定（拡張可）
  };

  const LIFE_PIECES = 5;
  const BOMB_PIECES = 5;
  const DEATHBOMB_WINDOW = 0.12; // 約7F

  let score = 0;
  let graze = 0;

  const pBullets = [];
  const eBullets = [];
  const enemies  = [];
  const effects  = [];
  const items    = [];
  const cardFx   = [];
  const eLasers  = [];
  let stage = null;

  // 背景スター
  const stars = Array.from({length: 120}, () => ({
    x: rand()*W, y: rand()*H, spd: 20 + rand()*90, r: 0.6 + rand()*1.6
  }));

  function makeStageScript(diffName) {
    const dp = DIFF[diffName];
    const script = [
      { type:"route", dur: 16 },
      { type:"boss",  kind:"mid1" },
      { type:"route", dur: 16 },
      { type:"boss",  kind:"mid2" },
      { type:"route", dur: 16 },
      { type:"boss",  kind:"boss" },
    ];
    if (dp.enemies === 4) script.push({ type:"boss", kind:"extra" });
    return script;
  }

  // ===== helpers =====
  function dist2(ax,ay,bx,by){ const dx=ax-bx, dy=ay-by; return dx*dx+dy*dy; }
  function spawnMsg(msg){ effects.push({ type:"msg", t:0, msg }); }
  function spawnCardEffect(o){ cardFx.push(o); }

  // ===== bullet shapes =====
  // shape: 0=丸,1=米,2=鱗/ナイフ,3=札
  function spawnEnemyBullet(x,y,vx,vy,r, shape=0, bounce=0){
    eBullets.push({ x,y,vx,vy,r, shape, bounce:bounce|0, grazed:false });
  }

  function spawnRing(cx, cy, n, spd, phase, r, shape=0, bounce=0) {
    for (let i=0;i<n;i++){
      const a = phase + (i/n)*TAU;
      spawnEnemyBullet(cx,cy, Math.cos(a)*spd, Math.sin(a)*spd, r, shape, bounce);
    }
  }

  function spawnAimedFan(cx, cy, n, spd, spread, r, tx, ty, shape=1, bounce=0) {
    const base = Math.atan2(ty - cy, tx - cx);
    for (let i=0;i<n;i++){
      const t = (n===1)?0:(i/(n-1)-0.5);
      const a = base + t*spread;
      spawnEnemyBullet(cx,cy, Math.cos(a)*spd, Math.sin(a)*spd, r, shape, bounce);
    }
  }

  // ===== player bullets =====
  function spawnPlayerBullet(x,y,vy, vx=0, dmg=10) {
    pBullets.push({ x, y, vy, vx, r: 3, dmg });
  }

  // ===== Enemy Laser =====
  function spawnEnemyLaser(e, dur=1.35, w=14, lead=0.45) {
    eLasers.push({ x:e.x, y:e.y, tx:player.x, ty:player.y, t:0, dur, lead, w });
  }

  // ===== Items =====
  function spawnItem(x,y,type){
    items.push({ x, y, type, vy: 90, t:0, r: 10 });
  }

  function giveLifePieces(n){
    const dp = DIFF[difficulty];
    const cap = dp.lifeCap ?? 99;
    player.lifePieces += n;
    while (player.lifePieces >= LIFE_PIECES) {
      player.lifePieces -= LIFE_PIECES;
      const before = player.lives;
      player.lives = Math.min(cap, player.lives + 1);
      if (player.lives > before) spawnMsg("EXTEND!");
    }
  }

  function giveBombPieces(n){
    const dp = DIFF[difficulty];
    const cap = dp.bombCap ?? 99;
    player.bombPieces += n;
    while (player.bombPieces >= BOMB_PIECES) {
      player.bombPieces -= BOMB_PIECES;
      const before = player.bombs;
      player.bombs = Math.min(cap, player.bombs + 1);
      if (player.bombs > before) spawnMsg("BOMB +1");
    }
  }

  function gainPower(amountFrac){
    player.powerFrac = Math.min(1, player.powerFrac + amountFrac);
    if (player.powerFrac >= 1 && player.power < 4) {
      player.power++;
      player.powerFrac = 0;
      spawnMsg(`POWER UP! (${player.power})`);
    } else {
      spawnMsg("P");
    }
  }

  // ===== Bomb =====
  let screenFlash = 0;
  let shakeT = 0;

  function doBombCore(isDeathbomb=false) {
    const cleared = eBullets.length;
    eBullets.length = 0;

    // 近い敵にちょいダメ（東方っぽい“ボムで押し切る”感）
    for (const e of enemies) {
      if (e.kind === "zako") e.hp -= 999;
      else e.hp -= 120;
    }

    player.inv = Math.max(player.inv, 1.6);
    player.bombCool = 0.6;

    spawnMsg(isDeathbomb ? `DEATHBOMB! (${cleared} cleared)` : `BOMB! (${cleared} cleared)`);
    screenFlash = Math.max(screenFlash, 0.28);
    shakeT = Math.max(shakeT, 0.40);
  }

  function useBomb(normal=true) {
    if (player.bombCool > 0) return false;
    if (player.bombs <= 0) return false;
    player.bombs--;
    doBombCore(!normal);
    return true;
  }

  // ===== Cards =====
  function gainCard() {
    if (player.hand.length >= player.maxHand) return;
    player.hand.push(drawCardId());
  }

  function useCardAt(index, dp) {
    if (player.cardCool > 0) return;
    if (index < 0 || index >= player.hand.length) return;
    const id = player.hand.splice(index,1)[0];
    const def = CARD_DEF[id];
    if (!def) return;
    player.cardCool = 0.25;
    def.use(dp);
    spawnMsg(def.name);
    screenFlash = Math.max(screenFlash, 0.12);
  }

  // ===== Boss Phase & Spell Bonus =====
  function makeBossPhases(kind) {
    const base = (kind==="boss"||kind==="extra") ? 9.0 : 7.0;
    return [
      { name:"通常 1", type:"NON",   dur: base, pattern: bossPatternNon1 },
      { name:"スペル 1『紅雨』", type:"SPELL", dur: base, pattern: bossPatternSpell1 },
      { name:"通常 2", type:"NON",   dur: base, pattern: bossPatternNon2 },
      { name:"スペル 2『輪廻』", type:"SPELL", dur: base, pattern: bossPatternSpell2 },
      { name:"ラスト『極彩』", type:"SPELL", dur: base, pattern: bossPatternSpell3 },
    ];
  }

  function makeEnemy(kind, dp) {
    const baseHp = (kind === "boss" || kind === "extra") ? 2000 : 1000;
    const hp = Math.round(baseHp * dp.enemyHp);
    const name = (kind === "mid1") ? "Midboss 1"
               : (kind === "mid2") ? "Midboss 2"
               : (kind === "boss") ? "Boss"
               : (kind === "extra")? "Extra Boss"
               : "Enemy";
    return {
      kind, name,
      x: W/2, y: H*0.18,
      r: 26,
      hp, hpMax: hp,
      time: 0,
      score: (kind === "boss" || kind==="extra") ? 8000 : 4000,
      phases: makeBossPhases(kind),
      phaseIdx: 0,
      phaseT: 0,
      cool: 0.2,
      laserCool: 0,

      // スペルボーナス用
      spellFailed: false
    };
  }

  function bossIsSpell(e){
    const ph = e.phases[e.phaseIdx];
    return ph && ph.type === "SPELL";
  }

  function currentSpellTimeLeft(e){
    const ph = e.phases[e.phaseIdx];
    if (!ph || ph.type !== "SPELL") return null;
    return Math.max(0, ph.dur - e.phaseT);
  }

  function calcSpellBonus(e){
    const ph = e.phases[e.phaseIdx];
    if (!ph || ph.type !== "SPELL") return 0;
    if (e.spellFailed) return 0;

    const left = Math.max(0, ph.dur - e.phaseT);
    const ratio = left / ph.dur;

    // スペルボーナス（ざっくり東方っぽい伸び）
    // 残り時間 + かすり + 難易度係数
    const diffMul = (difficulty==="easy")?0.9 :
                    (difficulty==="normal")?1.0 :
                    (difficulty==="hard")?1.15 :
                    (difficulty==="expert")?1.30 : 1.55;

    const base = 12000 * diffMul;
    const timePart = base * (0.45 + 0.55*ratio);
    const grazePart = Math.min(9000, graze * 2.2);
    return Math.floor(timePart + grazePart);
  }

  function switchBossPhase(e){
    e.phaseIdx = Math.min(e.phaseIdx + 1, e.phases.length - 1);
    e.phaseT = 0;
    e.spellFailed = false; // 新スペル開始でリセット
    // 近距離の弾を消す（フェーズ移行っぽさ）
    for (let i=eBullets.length-1;i>=0;i--){
      const b = eBullets[i];
      const dx=b.x-e.x, dy=b.y-e.y;
      if (dx*dx+dy*dy < 260*260) eBullets.splice(i,1);
    }
    const ph = e.phases[e.phaseIdx];
    if (ph) spawnMsg(`>> ${ph.name}`);
  }

  // ===== Patterns =====
  function bossPatternNon1(e, dp, t) {
    e.cool -= TICK;
    if (e.cool <= 0) {
      e.cool = 0.30 / dp.bulletRate;
      const n = Math.max(10, Math.round(16 * dp.bulletCount));
      spawnRing(e.x, e.y, n, 160*dp.bulletSpeed, t*0.9, 4, 0); // 丸
    }
  }
  function bossPatternNon2(e, dp, t) {
    e.cool -= TICK;
    if (e.cool <= 0) {
      e.cool = 0.42 / dp.bulletRate;
      const n = Math.max(3, Math.round(7 * dp.bulletCount));
      spawnAimedFan(e.x, e.y, n, 240*dp.bulletSpeed, 0.85, 5, player.x, player.y, 1, 2); // 米弾
    }
  }
  function bossPatternSpell1(e, dp, t) {
    e.cool -= TICK;
    if (e.cool <= 0) {
      e.cool = 0.20 / dp.bulletRate;
      const n = Math.max(14, Math.round(24 * dp.bulletCount));
      spawnRing(e.x, e.y, n, 190*dp.bulletSpeed, t*1.1, 5, 2); // 鱗
      if (((t*10)|0) % 6 === 0) {
        const m = Math.max(3, Math.round(5*dp.bulletCount));
        spawnAimedFan(e.x, e.y, m, 280*dp.bulletSpeed, 0.55, 5, player.x, player.y, 1); // 米
      }
    }
  }
  function bossPatternSpell2(e, dp, t) {
    e.cool -= TICK;
    if (e.cool <= 0) {
      e.cool = 0.28 / dp.bulletRate;
      const n = Math.max(16, Math.round(26 * dp.bulletCount));
      spawnRing(e.x, e.y, n, 140*dp.bulletSpeed, t*1.3, 4, 0); // 丸
      spawnRing(e.x, e.y, n, 200*dp.bulletSpeed, -t*1.05, 4, 3); // 札
    }

    // lasers (cooldown-based so it always appears)
    e.laserCool = (e.laserCool ?? 0) - TICK;
    if (e.laserCool <= 0) {
      e.laserCool = Math.max(0.55, 1.10 / dp.bulletRate);
      const lead = Math.max(0.30, 0.50 / dp.bulletRate);
      const w    = 12 + Math.round(4 * dp.bulletSpeed);
      spawnEnemyLaser(e, 1.35, w, lead);
    }
  }
function bossPatternSpell3(e, dp, t) {
    e.cool -= TICK;
    if (e.cool <= 0) {
      e.cool = 0.16 / dp.bulletRate;
      const n = Math.max(18, Math.round(28 * dp.bulletCount));
      spawnRing(e.x, e.y, n, 210*dp.bulletSpeed, t*1.5, 4, 2); // 鱗
      const m = Math.max(5, Math.round(9 * dp.bulletCount));
      spawnAimedFan(e.x, e.y, m, 300*dp.bulletSpeed, 0.95, 5, player.x, player.y, 1); // 米
    }
  }

  // ===== Stage / enemies =====
  function spawnEnemy(kind, dp) {
    enemies.push(makeEnemy(kind, dp));
    stage.spawnedBoss = true;
  }

  function spawnZako(x, y, dp) {
    const hp = Math.round(30 * dp.enemyHp);
    enemies.push({
      kind: "zako",
      name: "Zako",
      x, y,
      r: 14,
      hp, hpMax: hp,
      cool: 0.6 / dp.bulletRate,
      time: 0,
      score: 220
    });
  }

  // ===== On enemy defeated =====
  function onEnemyDefeated(e) {
    // スペルボーナス判定（ボスだけ）
    if (e.kind !== "zako") {
      const bonus = calcSpellBonus(e);
      if (bonus > 0) {
        score += bonus;
        spawnMsg(`SPELL BONUS +${bonus}`);
      } else {
        // スペル中に倒してるが失敗なら表示だけ
        const ph = e.phases?.[e.phaseIdx];
        if (ph && ph.type === "SPELL") spawnMsg("SPELL FAILED");
      }
    }

    score += e.score;
    gainCard();
    effects.push({ type:"burst", x:e.x, y:e.y, t:0 });

    // 雑魚ドロップ：P/点/欠片
    if (e.kind === "zako") {
      const r = rand();
      if (r < 0.16) spawnItem(e.x, e.y, "power");
      else spawnItem(e.x, e.y, "point");

      if (rand() < 0.10) spawnItem(e.x + (rand()*40-20), e.y, "lifePiece");
      if (rand() < 0.10) spawnItem(e.x + (rand()*40-20), e.y, "bombPiece");
    }

    // ボス撃破：欠片多め + 点大量
    if (e.kind !== "zako") {
      for (let i=0;i<12;i++) spawnItem(e.x + (rand()*140-70), e.y + (rand()*50-25), "point");
      for (let i=0;i<3;i++) spawnItem(e.x + (rand()*120-60), e.y + (rand()*40-20), "lifePiece");
      for (let i=0;i<3;i++) spawnItem(e.x + (rand()*120-60), e.y + (rand()*40-20), "bombPiece");
      spawnMsg("BOSS DOWN");

      stage.idx++;
      stage.t = 0;
      stage.spawnedBoss = false;

      screenFlash = Math.max(screenFlash, 0.35);
      shakeT = Math.max(shakeT, 0.45);
    }
  }

  // ===== Replay tick state =====
  let tickAcc = 0;
  let prevMask = 0;
  let curMask = 0;

  function maskPressed(bit){ return ((curMask & bit) !== 0) && ((prevMask & bit) === 0); }
  function maskDown(bit){ return (curMask & bit) !== 0; }

  function resetAll(isReplay, replayData) {
    pBullets.length = 0;
    eBullets.length = 0;
    enemies.length  = 0;
    effects.length  = 0;
    items.length    = 0;
    cardFx.length   = 0;
    eLasers.length  = 0;

    player.x = W/2; player.y = H*0.82;
    player.inv = 1.2;

    const dp = DIFF[difficulty];
    player.lives = dp.startLives ?? 3;
    player.bombs = dp.startBombs ?? 3;
    player.maxHand = dp.maxHand ?? 3;
    player.hand.length = 0;
    player.shotCool = 0;
    player.bombCool = 0;
    player.cardCool = 0;

    player.power = 1;
    player.powerFrac = 0;
    player.lifePieces = 0;
    player.bombPieces = 0;
    player.hitPending = 0;
    player.pendingLifeLoss = 0;

    score = 0;
    graze = 0;

    if (isReplay) srand(replayData.meta.seed|0);
    else srand(nowSeed());

    stage = {
      script: makeStageScript(difficulty),
      idx: 0,
      t: 0,
      spawnedBoss: false,
      routeSpawnCool: 0,
    };

    prevMask = 0;
    curMask = 0;
    tickAcc = 0;

    if (isReplay) {
      replayMode = "play";
      replay = { meta: replayData.meta, frames: replayData.frames, pos: 0 };
    } else {
      if (controlMode === "mouse") {
        replayMode = "off";
        replay = null;
      } else {
        replayMode = "record";
        replay = { meta: { version:3, difficulty, seed: rngSeed|0, startedAt: Date.now() }, frames: [], pos: 0 };
      }
    }
  }

  function startGame(isReplay, replayData=null) {
    clearKeys();
    resetAll(isReplay, replayData);
    gameState = STATE.PLAY;
  }

  function finalizeRun() {
    const hi = getHi(difficulty);
    if (score > hi) setHi(difficulty, score);

    if (replayMode === "record" && replay?.frames?.length) {
      const meta = { ...replay.meta, endedAt: Date.now(), score, result: gameState };
      saveReplay(meta, replay.frames);
    }
    replayMode = "off";
    replay = null;
  }

  // ===== Loop =====
  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.05, (now - last)/1000);
    last = now;

    if (gameState === STATE.PLAY) {
      tickAcc += dt;
      while (tickAcc >= TICK) {
        tickAcc -= TICK;
        tickOne();
      }
    }

    render();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  function applyCardFx(dp) {
    for (let i=cardFx.length-1;i>=0;i--){
      const fx = cardFx[i];
      fx.t += TICK;

      if (fx.type === "laser") {
        const w = fx.w ?? 8;
        const half = w * 0.5;
        for (const e of enemies) {
          if (e.y > player.y) continue;
          const dx = Math.abs(e.x - player.x);
          if (dx <= (e.r + half)) e.hp -= fx.dps * TICK;
        }
      }

      if (fx.t >= fx.dur) cardFx.splice(i,1);
    }
  }

  function updateStage(dp) {
    const node = stage.script[stage.idx];
    if (!node) return;

    stage.t += TICK;

    if (node.type === "route") {
      stage.routeSpawnCool -= TICK;
      if (stage.routeSpawnCool <= 0) {
        stage.routeSpawnCool = 0.55 / dp.bulletRate;
        const count = (difficulty === "lunatic" || difficulty === "expert") ? 2 : 1;
        for (let k=0;k<count;k++){
          const x = 80 + rand()*(W-160);
          spawnZako(x, -20 - 40*k, dp);
        }
      }

      if (stage.t >= node.dur) {
        stage.idx++;
        stage.t = 0;
      }
    } else if (node.type === "boss") {
      if (!stage.spawnedBoss) spawnEnemy(node.kind, dp);
    }
  }

  function tickOne() {
    const dp = DIFF[difficulty];

    prevMask = curMask;
    if (replayMode === "play") {
      curMask = (replay.pos < replay.frames.length) ? (replay.frames[replay.pos] | 0) : 0;
      replay.pos++;
    } else {
      curMask = makeInputMaskLive();
      if (replayMode === "record" && replay) {
        replay.frames.push(curMask & 0xFFFF);
        if (replay.frames.length > 60*60*30) replay.frames.length = 60*60*30;
      }
    }

    // cooldowns
    player.inv = Math.max(0, player.inv - TICK);
    player.shotCool = Math.max(0, player.shotCool - TICK);
    player.bombCool = Math.max(0, player.bombCool - TICK);
    player.cardCool = Math.max(0, player.cardCool - TICK);

    screenFlash = Math.max(0, screenFlash - TICK);
    shakeT = Math.max(0, shakeT - TICK);

    // 決めボム猶予更新
    if (player.hitPending > 0) {
      player.hitPending = Math.max(0, player.hitPending - TICK);

      // 猶予中にボムが押されたら生還
      if (maskPressed(BIT.BOMB) && player.bombs > 0 && player.bombCool <= 0) {
        // ライフ減少をキャンセル
        player.pendingLifeLoss = 0;
        player.hitPending = 0;
        useBomb(false); // deathbomb扱い
        return; // このtickはここで終える（事故防止）
      }

      // 猶予が切れたら被弾確定
      if (player.hitPending === 0 && player.pendingLifeLoss > 0) {
        player.lives -= player.pendingLifeLoss;
        player.pendingLifeLoss = 0;
        player.inv = 1.6;
        eBullets.length = 0;
        spawnMsg("HIT!");
        if (player.lives <= 0) {
          gameState = STATE.OVER;
          finalizeRun();
        }
        // 被弾確定時も続行
      }
    }

    // movement
    const slow = maskDown(BIT.SLOW);
    const spd = player.speed * (slow ? player.slowMul : 1);

    // mouse mode: snap to cursor (no lag)
    if (controlMode === "mouse" && replayMode !== "play" && mouse.inside) {
      player.x = Math.max(20, Math.min(W - 20, mouse.x));
      player.y = Math.max(20, Math.min(H - 20, mouse.y));
    } else {
      let mx = 0, my = 0;
      if (maskDown(BIT.L)) mx -= 1;
      if (maskDown(BIT.R)) mx += 1;
      if (maskDown(BIT.U)) my -= 1;
      if (maskDown(BIT.D)) my += 1;
      const mlen = Math.hypot(mx, my) || 1;
      mx /= mlen; my /= mlen;

      player.x = Math.max(20, Math.min(W - 20, player.x + mx * spd * TICK));
      player.y = Math.max(20, Math.min(H - 20, player.y + my * spd * TICK));
    }

    // actions
    if (maskPressed(BIT.BOMB)) useBomb(true);

    // mouse shortcuts (right click = bomb, middle click = card)
    if (controlMode === "mouse" && replayMode !== "play") {
      if (mouse.rdown && !prevMouseR) useBomb(true);
      if (mouse.mdown && !prevMouseM) useCardAt(0, dp);
      prevMouseR = mouse.rdown;
      prevMouseM = mouse.mdown;
    }
    if (maskPressed(BIT.CARD1)) useCardAt(0, dp);
    if (maskPressed(BIT.CARD2)) useCardAt(1, dp);
    if (maskPressed(BIT.CARD3)) useCardAt(2, dp);
    if (maskPressed(BIT.CARDNEXT)) useCardAt(0, dp);

    // auto shot (POWER)
    if (player.shotCool <= 0) {
      const base = 0.090;
      const rate = base * (player.power >= 4 ? 0.82 : player.power === 3 ? 0.88 : player.power === 2 ? 0.94 : 1);
      player.shotCool = rate;

      const y = player.y - 14;
      const vy = 580;
      const dmg = 10 + (player.power-1)*2;

      spawnPlayerBullet(player.x, y, vy, 0, dmg);
      if (player.power >= 2) {
        spawnPlayerBullet(player.x-10, y, vy, -30, dmg);
        spawnPlayerBullet(player.x+10, y, vy,  30, dmg);
      }
      if (player.power >= 3) {
        spawnPlayerBullet(player.x-18, y, vy, -70, dmg-1);
        spawnPlayerBullet(player.x+18, y, vy,  70, dmg-1);
      }
      if (player.power >= 4) {
        spawnPlayerBullet(player.x-26, y, vy, -110, dmg-2);
        spawnPlayerBullet(player.x+26, y, vy,  110, dmg-2);
      }
    }

    // stage
    updateStage(dp);

    // card effects
    applyCardFx(dp);

    // slow effect for enemy bullets
    let slowMul2 = 1;
    for (const fx of cardFx) if (fx.type==="slow") slowMul2 = Math.min(slowMul2, fx.mul);

    // ===== enemy lasers update / collide =====
    for (let i=eLasers.length-1;i>=0;i--){
      const L = eLasers[i];
      L.t += TICK;

      if (L.t < L.lead) { L.tx = player.x; L.ty = player.y; }

      const boss = enemies.find(e=>e.kind!=="zako");
      if (boss) { L.x = boss.x; L.y = boss.y; }

      // レーザー被弾（決めボム猶予）
      if (player.inv <= 0 && player.hitPending === 0 && L.t >= L.lead && L.t <= L.dur) {
        const ax=L.x, ay=L.y, bx=L.tx, by=L.ty;
        const px=player.x, py=player.y;

        const abx = bx-ax, aby = by-ay;
        const apx = px-ax, apy = py-ay;
        const ab2 = abx*abx + aby*aby || 1;
        let u = (apx*abx + apy*aby) / ab2;
        u = Math.max(0, Math.min(1, u));
        const cx = ax + abx*u, cy = ay + aby*u;

        const dx = px-cx, dy = py-cy;
        const d2 = dx*dx + dy*dy;

        const hitR = player.r + (L.w*0.5);
        if (d2 <= hitR*hitR) {
          // スペル中なら失敗
          const b = enemies.find(e=>e.kind!=="zako");
          if (b && bossIsSpell(b)) b.spellFailed = true;

          player.hitPending = DEATHBOMB_WINDOW;
          player.pendingLifeLoss = 1;
        }
      }

      if (L.t > L.dur) eLasers.splice(i,1);
    }

    // update player bullets
    for (let i=pBullets.length-1;i>=0;i--){
      const b = pBullets[i];
      b.y -= b.vy*TICK;
      b.x += b.vx*TICK;
      if (b.y < -40 || b.x < -80 || b.x > W+80) pBullets.splice(i,1);
    }

    // enemy bullets update + bounce + graze
    const grazeExtra = (maskDown(BIT.SLOW) ? 14 : 10);
    const grazeR = player.r + grazeExtra;

    for (let i=eBullets.length-1;i>=0;i--){
      const b = eBullets[i];

      b.x += b.vx*TICK*slowMul2;
      b.y += b.vy*TICK*slowMul2;

      if ((b.bounce|0) > 0) {
        let hit = false;
        if (b.x - b.r < 0) { b.x = b.r; b.vx =  Math.abs(b.vx); hit = true; }
        else if (b.x + b.r > W) { b.x = W-b.r; b.vx = -Math.abs(b.vx); hit = true; }
        if (b.y - b.r < 0) { b.y = b.r; b.vy =  Math.abs(b.vy); hit = true; }
        else if (b.y + b.r > H) { b.y = H-b.r; b.vy = -Math.abs(b.vy); hit = true; }
        if (hit) b.bounce = (b.bounce|0) - 1;
      }

      // graze（弾1個につき1回）
      if (player.inv <= 0 && !b.grazed) {
        const dx = b.x - player.x, dy = b.y - player.y;
        const d2 = dx*dx + dy*dy;
        const rr2 = (b.r + grazeR) * (b.r + grazeR);
        const hh2 = (b.r + player.r) * (b.r + player.r);
        if (d2 <= rr2 && d2 > hh2) {
          b.grazed = true;
          graze++;
          score += 3;
          effects.push({ type:"graze", x: player.x, y: player.y, t:0 });
        }
      }

      if (b.x < -80 || b.x > W+80 || b.y < -80 || b.y > H+80) eBullets.splice(i,1);
    }

    // enemies update
    for (const e of enemies) {
      e.time += TICK;

      if (e.kind === "zako") {
        e.y += 90*TICK;
        e.x += Math.sin(e.time*3.0)*40*TICK;

        e.cool -= TICK;
        if (e.cool <= 0) {
          e.cool = 0.85 / dp.bulletRate;
          const n = Math.max(3, Math.round(5 * dp.bulletCount));
          spawnAimedFan(e.x, e.y, n, 160 * dp.bulletSpeed, 0.55, 4, player.x, player.y, 1);
        }
      } else {
        e.x = W/2 + Math.sin(e.time*0.9)*180;
        e.y = H*0.18 + Math.sin(e.time*0.7)*18;

        e.phaseT += TICK;
        const ph = e.phases[e.phaseIdx];
        if (ph && e.phaseT >= ph.dur) {
          switchBossPhase(e);
        }

        const cur = e.phases[e.phaseIdx];
        if (cur) cur.pattern(e, dp, e.time);
      }
    }

    // collide player bullets -> enemies
    for (let i=pBullets.length-1;i>=0;i--){
      const b = pBullets[i];
      let hit = false;
      for (const e of enemies) {
        if (dist2(b.x,b.y,e.x,e.y) <= (b.r+e.r)*(b.r+e.r)) {
          e.hp -= (b.dmg|0);
          hit = true;
          break;
        }
      }
      if (hit) pBullets.splice(i,1);
    }

    // remove dead enemies
    for (let i=enemies.length-1;i>=0;i--){
      const e = enemies[i];
      if (e.hp <= 0) {
        enemies.splice(i,1);
        onEnemyDefeated(e);
      }
    }

    // collide enemy bullets -> player (決めボム猶予)
    if (player.inv <= 0 && player.hitPending === 0) {
      for (let i=eBullets.length-1;i>=0;i--){
        const b = eBullets[i];
        if (dist2(b.x,b.y,player.x,player.y) <= (b.r+player.r)*(b.r+player.r)) {
          const boss = enemies.find(e=>e.kind!=="zako");
          if (boss && bossIsSpell(boss)) boss.spellFailed = true;

          player.hitPending = DEATHBOMB_WINDOW;
          player.pendingLifeLoss = 1;
          break;
        }
      }
    }

    // ===== items update / collect =====
    const collectLine = H * 0.25;
    const autoCollect = (player.y < collectLine);

    for (let i=items.length-1;i>=0;i--){
      const it = items[i];
      it.t += TICK;

      if (autoCollect) {
        const dx = player.x - it.x;
        const dy = player.y - it.y;
        it.x += dx * 6.0 * TICK;
        it.y += dy * 6.0 * TICK;
      } else {
        it.y += it.vy * TICK;
      }

      if (dist2(it.x,it.y,player.x,player.y) <= (it.r + 18)*(it.r + 18)) {
        if (it.type === "lifePiece") giveLifePieces(1);
        if (it.type === "bombPiece") giveBombPieces(1);
        if (it.type === "power") gainPower(0.25);
        if (it.type === "point") { score += 25; }
        items.splice(i,1);
        continue;
      }
      if (it.y > H + 80 || it.x < -120 || it.x > W+120) items.splice(i,1);
    }

    // effects
    for (let i=effects.length-1;i>=0;i--){
      effects[i].t += TICK;
      if (effects[i].t > 1.2) effects.splice(i,1);
    }

    // clear
    if (stage.idx >= stage.script.length && enemies.length === 0) {
      gameState = STATE.CLEAR;
      finalizeRun();
    }

    // UI
    if (uiState) uiState.textContent = gameState;
    if (uiDiff) uiDiff.textContent = difficulty;
    if (uiScore) uiScore.textContent = String(score|0);
    if (uiLives) uiLives.textContent = String(player.lives|0);
    if (uiBombs) uiBombs.textContent = String(player.bombs|0);
    if (uiSpells) uiSpells.textContent = `${player.hand.length}/${player.maxHand}`;
    if (uiHi) uiHi.textContent = String(getHi(difficulty)|0);
    if (uiGraze) uiGraze.textContent = String(graze|0);
    if (uiPower) uiPower.textContent = String(player.power|0);
    if (uiLifePieces) uiLifePieces.textContent = `${player.lifePieces}/${LIFE_PIECES}`;
    if (uiBombPieces) uiBombPieces.textContent = `${player.bombPieces}/${BOMB_PIECES}`;

    if (uiReplay) {
      uiReplay.textContent =
        (replayMode === "play") ? `再生中 ${replay.pos}/${replay.frames.length}`
        : (replayMode === "record") ? `記録中 ${replay.frames.length}`
        : "-";
    }

    const boss = enemies.find(e=>e.kind!=="zako");
    if (uiEnemy) uiEnemy.textContent = boss?.name ?? "Route";
    if (uiPhase) uiPhase.textContent = boss ? (() => {
      const ph2 = boss.phases[boss.phaseIdx];
      return ph2 ? `${ph2.type} / ${ph2.name}` : "-";
    })() : "-";

    if (uiSpellTime) {
      if (boss && bossIsSpell(boss)) {
        const left = currentSpellTimeLeft(boss);
        uiSpellTime.textContent = `${left.toFixed(1)}s`;
      } else {
        uiSpellTime.textContent = "-";
      }
    }

    if (uiCards) {
      uiCards.textContent =
        player.hand.map((id, i) => `${i+1}:${CARD_DEF[id].name.replace(/^.+?「|」$/g,"")}`).join("  ") || "-";
    }
  }

  // ===== Render =====
  function drawEnemyBullet(b) {
    // 形状描き分け（東方っぽさ）
    const a = Math.atan2(b.vy, b.vx);
    const x=b.x, y=b.y;

    if (b.shape === 0) {
      ctx.beginPath();
      ctx.arc(x,y,b.r,0,TAU);
      ctx.fillStyle = "rgba(255,106,162,0.95)";
      ctx.fill();
    } else if (b.shape === 1) {
      // 米弾：楕円
      ctx.save();
      ctx.translate(x,y);
      ctx.rotate(a);
      ctx.beginPath();
      ctx.ellipse(0,0, b.r*1.7, b.r*0.9, 0, 0, TAU);
      ctx.fillStyle = "rgba(178,107,255,0.95)";
      ctx.fill();
      ctx.restore();
    } else if (b.shape === 2) {
      // 鱗/ナイフ：ひし形
      ctx.save();
      ctx.translate(x,y);
      ctx.rotate(a);
      ctx.beginPath();
      ctx.moveTo(b.r*2.0, 0);
      ctx.lineTo(0, b.r*1.0);
      ctx.lineTo(-b.r*1.6, 0);
      ctx.lineTo(0, -b.r*1.0);
      ctx.closePath();
      ctx.fillStyle = "rgba(255,60,90,0.95)";
      ctx.fill();
      ctx.restore();
    } else {
      // 札：長方形
      ctx.save();
      ctx.translate(x,y);
      ctx.rotate(a);
      ctx.beginPath();
      ctx.rect(-b.r*0.8, -b.r*2.0, b.r*1.6, b.r*4.0);
      ctx.fillStyle = "rgba(255,245,190,0.92)";
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.25)";
      ctx.stroke();
      ctx.restore();
    }

    // grazed表現
    if (b.grazed) {
      ctx.beginPath();
      ctx.arc(x,y,b.r+1,0,TAU);
      ctx.strokeStyle = "rgba(255,255,255,0.22)";
      ctx.stroke();
    }
  }

  function render() {
    // bg
    ctx.clearRect(0,0,W,H);
    ctx.fillStyle = "#070a14";
    ctx.fillRect(0,0,W,H);

    // stars
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    for (const s of stars) {
      s.y += s.spd * (1/60);
      if (s.y > H+10) { s.y = -10; s.x = rand()*W; }
      ctx.globalAlpha = 0.10 + (s.spd/110)*0.35;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // collect line
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, H*0.25);
    ctx.lineTo(W, H*0.25);
    ctx.stroke();

    // enemy bullets
    for (const b of eBullets) drawEnemyBullet(b);

    // lasers
    for (const L of eLasers) {
      const aimx = L.tx, aimy = L.ty;
      const pre = (L.t < L.lead);
      if (pre) {
        // telegraph
        ctx.save();
        ctx.setLineDash([6, 6]);
        ctx.strokeStyle = "rgba(255,255,255,0.28)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(L.x, L.y);
        ctx.lineTo(aimx, aimy);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      } else {
        // glow + core
        const wob = 0.6 + 0.4*Math.sin(L.t*22);
        const w = L.w * wob;
        ctx.save();
        ctx.lineCap = "round";
        // outer glow
        ctx.strokeStyle = "rgba(255,80,120,0.18)";
        ctx.lineWidth = w * 2.1;
        ctx.beginPath();
        ctx.moveTo(L.x, L.y);
        ctx.lineTo(aimx, aimy);
        ctx.stroke();
        // main beam
        ctx.strokeStyle = "rgba(255,80,120,0.68)";
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.moveTo(L.x, L.y);
        ctx.lineTo(aimx, aimy);
        ctx.stroke();
        // inner core
        ctx.strokeStyle = "rgba(255,255,255,0.55)";
        ctx.lineWidth = Math.max(2, w * 0.22);
        ctx.beginPath();
        ctx.moveTo(L.x, L.y);
        ctx.lineTo(aimx, aimy);
        ctx.stroke();
        ctx.restore();
      }
    }

    // items
    for (const it of items) {
      if (it.type === "lifePiece") {
        ctx.beginPath();
        ctx.arc(it.x, it.y, 10, 0, TAU);
        ctx.fillStyle = "rgba(120,255,170,0.95)";
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.65)";
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.font = "900 12px system-ui";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "rgba(10,10,20,0.92)";
        ctx.fillText("L", it.x, it.y+0.5);
        ctx.lineWidth = 1;
      } else if (it.type === "bombPiece") {
        ctx.beginPath();
        ctx.arc(it.x, it.y, 10, 0, TAU);
        ctx.fillStyle = "rgba(255,190,90,0.95)";
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.65)";
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.font = "900 12px system-ui";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "rgba(10,10,20,0.92)";
        ctx.fillText("B", it.x, it.y+0.5);
        ctx.lineWidth = 1;
      } else if (it.type === "power") {
        ctx.beginPath();
        ctx.arc(it.x, it.y, 9, 0, TAU);
        ctx.fillStyle = "rgba(180,170,255,0.92)";
        ctx.fill();
        ctx.font = "900 12px system-ui";
        ctx.textAlign = "center";
        ctx.fillStyle = "rgba(10,10,20,0.9)";
        ctx.fillText("P", it.x, it.y+4);
      } else {
        ctx.beginPath();
        ctx.arc(it.x, it.y, 8, 0, TAU);
        ctx.fillStyle = "rgba(255,255,210,0.88)";
        ctx.fill();
      }
    }

    // player bullets
    for (const b of pBullets) {
      ctx.beginPath();
      ctx.arc(b.x,b.y,b.r,0,TAU);
      ctx.fillStyle = "rgba(154,255,255,0.95)";
      ctx.fill();
    }

    // enemies
    const boss = enemies.find(e=>e.kind!=="zako");
    for (const e of enemies) {
      ctx.beginPath();
      ctx.arc(e.x,e.y,e.r,0,TAU);
      ctx.fillStyle = (e.kind==="zako") ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.16)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.22)";
      ctx.stroke();
    }

    // boss hp
    if (boss) {
      const bw = 360, bh = 10;
      const bx = (W-bw)/2, by = 24;
      const t = Math.max(0, boss.hp/boss.hpMax);
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      ctx.fillRect(bx,by,bw,bh);
      ctx.fillStyle = "rgba(255,60,90,0.95)";
      ctx.fillRect(bx,by,bw*t,bh);
      ctx.strokeStyle = "rgba(255,255,255,0.25)";
      ctx.strokeRect(bx,by,bw,bh);

      const ph = boss.phases[boss.phaseIdx];
      ctx.font = "700 16px system-ui";
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.textAlign = "center";
      const left = (ph && ph.type==="SPELL") ? `  ${Math.max(0, ph.dur-boss.phaseT).toFixed(1)}s` : "";
      const fail = (ph && ph.type==="SPELL" && boss.spellFailed) ? "  (FAILED)" : "";
      ctx.fillText(ph ? `${ph.type} / ${ph.name}${left}${fail}` : "", W/2, 60);
    }

    // player
    ctx.beginPath();
    ctx.arc(player.x, player.y, 10, 0, TAU);
    ctx.fillStyle = (player.inv>0 || player.hitPending>0) ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.14)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.stroke();

    // hitbox on slow
    const slow = (replayMode === "play") ? ((curMask & BIT.SLOW)!==0) : ((makeInputMaskLive() & BIT.SLOW)!==0);
    if (slow) {
      ctx.beginPath();
      ctx.arc(player.x, player.y, player.r, 0, TAU);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
    }

    // overlays
    ctx.textAlign = "center";
    if (gameState === STATE.MENU) {
      ctx.font = "800 42px system-ui";
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.fillText("MENU", W/2, H*0.42);
      ctx.font = "700 24px system-ui";
      ctx.fillText(`Difficulty: ${difficulty.toUpperCase()}`, W/2, H*0.48);
      ctx.font = "16px system-ui";
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.fillText("↑↓ change / Enter start / R replay(last)", W/2, H*0.54);
    } else if (gameState === STATE.OVER) {
      ctx.font = "900 48px system-ui";
      ctx.fillStyle = "rgba(255,120,150,0.95)";
      ctx.fillText("GAME OVER", W/2, H*0.5);
      ctx.font = "16px system-ui";
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      ctx.fillText("Esc: menu   R: replay(last)", W/2, H*0.56);
    } else if (gameState === STATE.CLEAR) {
      ctx.font = "900 48px system-ui";
      ctx.fillStyle = "rgba(160,255,190,0.95)";
      ctx.fillText("CLEAR!", W/2, H*0.5);
      ctx.font = "16px system-ui";
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      ctx.fillText("Esc: menu   R: replay(last)", W/2, H*0.56);
    }

    // effects
    for (const ef of effects) {
      if (ef.type === "msg") {
        ctx.font = "800 22px system-ui";
        ctx.textAlign = "center";
        ctx.fillStyle = "rgba(255,255,255,0.85)";
        ctx.fillText(ef.msg, W/2, H*0.25 - ef.t*20);
      } else if (ef.type === "burst") {
        const p = Math.min(1, ef.t/0.35);
        const rr = 10 + p*40;
        ctx.beginPath();
        ctx.arc(ef.x, ef.y, rr, 0, TAU);
        ctx.strokeStyle = `rgba(255,255,255,${0.35*(1-p)})`;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.lineWidth = 1;
      } else if (ef.type === "graze") {
        const p = Math.min(1, ef.t/0.35);
        ctx.font = "900 14px system-ui";
        ctx.textAlign = "center";
        ctx.fillStyle = `rgba(255,255,255,${0.6*(1-p)})`;
        ctx.fillText("GRAZE", ef.x, ef.y - 26 - p*12);
      }
    }

    // HUD bottom
    ctx.textAlign = "left";
    ctx.font = "14px system-ui";
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.fillText(`Score:${score}  Graze:${graze}  Power:${player.power}  L:${player.lives}(${player.lifePieces}/${LIFE_PIECES})  B:${player.bombs}(${player.bombPieces}/${BOMB_PIECES})`, 16, H-18);

    ctx.textAlign = "right";
    ctx.fillText(`Enemy Bullets:${eBullets.length}`, W-16, H-18);

    if (screenFlash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${screenFlash})`;
      ctx.fillRect(0,0,W,H);
    }

    // スマホ MENUボタン表示
    if (menuBtns) {
      const show = (gameState === STATE.MENU || gameState === STATE.OVER || gameState === STATE.CLEAR);
      menuBtns.style.display = show ? "flex" : "none";
    }
  }
})();
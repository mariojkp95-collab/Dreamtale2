
// ====== Config base (isometric) ======
const mapCols=10, mapRows=10;
const isoTileW=128, isoTileH=64;   // rapporto 2:1
const screenW=1024, screenH=768;
const c = document.getElementById('game'); c.width=screenW; c.height=screenH;
const ctx = c.getContext('2d');
const $ = id => document.getElementById(id);
const dbg=$('dbg');

// HUD refs
const hpText=$('hptext'), hpFill=$('hpfill');
const mpText=$('mptext'), mpFill=$('mpfill');
const coinsEl=$('coins'), potsEl=$('pots'), lvlEl=$('lvl');
const xpFill=$('xpfill'), xpText=$('xptext');
const optPathHighlight=$('optPathHighlight');

// Panels
const minimap=$('minimap'); const mmctx=minimap.getContext('2d');
const minimapBox=$('minimapBox'), questPanel=$('questPanel');
const btnHideMinimap=$('btnHideMinimap'), btnHideQuest=$('btnHideQuest');
const btnToggleMinimap=$('btnToggleMinimap'), btnToggleQuest=$('btnToggleQuest');
const btnQuestReset=$('btnQuestReset');

// Title & death
const titleScreen=$('titleScreen'), deathScreen=$('deathScreen');
const btnStart=$('btnStart'), btnReset=$('btnReset'), btnMenu=$('btnMenu'), btnRespawn=$('btnRespawn');

// Skill bar
const skill1=$('skill1'), skill1cd=$('skill1cd');

// EXP/LVL
const MAX_LVL=99, XP_COIN=5, XP_POTION=2, XP_SLIME=15;
function expNeededFor(level){ return Math.floor(50*Math.pow(level,1.5)); }

// Combat/player
const ATTACK_CD_MS=400, PLAYER_ATK_MIN=5, PLAYER_ATK_MAX=9;
let lastAttackTs=0;

// Enemy AI
const AGGRO_RANGE=4, AGGRO_MEMORY_MS=2500, ENEMY_REPATH_MS=400;
const ENEMY_ATK_MIN=3, ENEMY_ATK_MAX=6, ENEMY_ATK_CD_MS=900;

// Drops
const DROP_COIN_CHANCE=.35, DROP_POTION_CHANCE=.10;

// Fireball skill
const FB_MP_COST=10, FB_COOLDOWN_MS=2000, FB_SPEED=10; // px per frame
let fbReadyTs=0;
let projectiles=[];

// Quest
const QUEST_TARGET=30, QUEST_REWARD_XP=30;
$('qtarget').textContent=QUEST_TARGET; $('qmax').textContent=QUEST_TARGET; $('qreward').textContent=QUEST_REWARD_XP;
const qfill=$('qfill'), qcount=$('qcount');

// Save keys
const SAVE_KEY='dreamtale_iso_save_v2';
const UI_KEY='dreamtale_iso_ui_v2';

// ===== Assets (tolleranti) =====
const IMGS={}, SRC={
  tile:'assets/tile_ground.png',
  tree:'assets/tree.png',
  player:'assets/player.png',
  enemy:'assets/enemy.png',
  coin:'assets/coin.png',
  potion:'assets/potion.png',
  fireball:'assets/fireball.png'
};
function makePlaceholder(w=64,h=64,label='?'){
  const cvs=document.createElement('canvas'); cvs.width=w; cvs.height=h;
  const x=cvs.getContext('2d'); x.fillStyle='#222'; x.fillRect(0,0,w,h);
  x.strokeStyle='#f00'; x.lineWidth=3; x.strokeRect(2,2,w-4,h-4);
  x.fillStyle='#fff'; x.font='bold 16px system-ui'; x.textAlign='center'; x.textBaseline='middle';
  x.fillText(label, w/2, h/2); const img=new Image(); img.src=cvs.toDataURL(); return img;
}
async function loadAll(){
  await Promise.all(Object.entries(SRC).map(([k,src])=>new Promise(res=>{
    const im=new Image(); im.onload=()=>{IMGS[k]=im;res()}; im.onerror=()=>{IMGS[k]=makePlaceholder(64,64,k[0]);res()}; im.src=src;
  })));
}

// ===== Map & math (isometric) =====
let map=[], objects=[];
function rngSeed(seed){ let s=seed>>>0; return ()=>{ s = (s*1664525 + 1013904223)>>>0; return s/2**32; }; }
let rnd=rngSeed(1337);

function genMap(){
  map = Array.from({length:mapRows}, ()=>Array.from({length:mapCols}, ()=>0)); // 0 ground, 1 tree (blocked)
  for(let i=0;i<14;i++){
    const x=Math.floor(rnd()*mapCols), y=Math.floor(rnd()*mapRows);
    if(x===0&&y===0) continue; map[y][x]=1;
  }
}

// world offset to center
const worldOffsetX = screenW/2;
const worldOffsetY = 180;

function isoToScreen(ix,iy){
  // tile center
  const sx = (ix - iy)*(isoTileW/2) + worldOffsetX;
  const sy = (ix + iy)*(isoTileH/2) + worldOffsetY;
  return {x:sx, y:sy};
}
function screenToIso(sx,sy){
  const x = ((sx - worldOffsetX)/ (isoTileW/2) + (sy - worldOffsetY)/(isoTileH/2))/2;
  const y = ((sy - worldOffsetY)/(isoTileH/2) - (sx - worldOffsetX)/(isoTileW/2))/2;
  return {x, y};
}

function isWalkableTile(x,y){ return x>=0 && y>=0 && x<mapCols && y<mapRows && map[y][x]===0; }
function isEnemyAt(x,y){ return enemies.some(e=>e.x===x && e.y===y); }
function isWalkableDynamic(x,y){ return isWalkableTile(x,y) && !isEnemyAt(x,y); }

// ===== Entities =====
const player={x:2,y:2,hp:100,maxHp:100,mp:100,maxMp:100,coins:0,potions:0,lvl:1,exp:0};
let enemies=[], coins=[], potions=[], walking=false, pathQueue=[];

function randEmpty(exclude=[]){
  let tries=0;
  while(tries<500){
    const x=Math.floor(rnd()*mapCols), y=Math.floor(rnd()*mapRows);
    if(!isWalkableTile(x,y)) {tries++;continue}
    if(x===player.x&&y===player.y) {tries++;continue}
    if(exclude.some(p=>p.x===x&&p.y===y)) {tries++;continue}
    return {x,y};
  } return {x:0,y:0};
}
function spawnEnemy(){
  const p=randEmpty([...enemies,...coins,...potions]);
  const maxHp=25+Math.floor(player.lvl*1.3);
  enemies.push({x:p.x,y:p.y,hp:maxHp,maxHp,lastAtk:0,ai:'idle',aggroUntil:0,path:[],nextRepath:0});
}
function spawnAll(){
  enemies=[]; coins=[]; potions=[];
  for(let i=0;i<3;i++) spawnEnemy();
  for(let i=0;i<6;i++) coins.push(randEmpty([...coins,...enemies]));
  for(let i=0;i<2;i++) potions.push(randEmpty([...coins,...enemies,...potions]));
}

// ===== UI updates =====
function updateHUD(){
  const hpR=Math.max(0,Math.min(1,player.hp/player.maxHp));
  const mpR=Math.max(0,Math.min(1,player.mp/player.maxMp));
  hpText.textContent=`${player.hp}/${player.maxHp}`; hpFill.style.width=`${hpR*100}%`;
  mpText.textContent=`${player.mp}/${player.maxMp}`; mpFill.style.width=`${mpR*100}%`;
  coinsEl.textContent=player.coins; potsEl.textContent=player.potions; lvlEl.textContent=player.lvl;
  const need=expNeededFor(player.lvl); const r=(player.lvl>=MAX_LVL)?1:player.exp/need;
  xpFill.style.width=(Math.max(0,Math.min(1,r))*100)+'%'; xpText.textContent=`EXP ${Math.floor(r*100)}%`;
  qcount.textContent=questCount; qfill.style.width=Math.min(100,(questCount/QUEST_TARGET*100))+'%';
}
function gainExp(n){
  if(player.lvl>=MAX_LVL) return;
  player.exp+=n;
  while(player.lvl<MAX_LVL && player.exp>=expNeededFor(player.lvl)){
    player.exp-=expNeededFor(player.lvl); player.lvl++;
  }
  updateHUD(); saveGame();
}

// ===== Save/UI state =====
function saveGame(){
  try{ localStorage.setItem(SAVE_KEY, JSON.stringify({player,enemies,coins,potions,map})); }catch{}
}
function loadGame(){
  try{
    const d=JSON.parse(localStorage.getItem(SAVE_KEY)||'null'); if(!d||!d.player) return false;
    Object.assign(player,d.player); enemies=d.enemies||[]; coins=d.coins||[]; potions=d.potions||[]; map=d.map||map;
    return true;
  }catch{ return false; }
}
function saveUI(){ try{ localStorage.setItem(UI_KEY, JSON.stringify({ mini:minimapBox.classList.contains('collapsed'), quest:questPanel.classList.contains('collapsed') })); }catch{} }
function loadUI(){ try{ const u=JSON.parse(localStorage.getItem(UI_KEY)||'{}'); if(u.mini) minimapBox.classList.add('collapsed'); if(u.quest) questPanel.classList.add('collapsed'); }catch{} }

// ===== Pathfinding (BFS) =====
function findPath(sx,sy,tx,ty, dynamic=true){
  const ok = dynamic? isWalkableDynamic : isWalkableTile;
  if(!ok(tx,ty)) return null;
  const key=(x,y)=>`${x},${y}`, q=[{x:sx,y:sy}], prev=new Map(), seen=new Set([key(sx,sy)]);
  const dirs=[[1,0],[-1,0],[0,1],[0,-1]];
  while(q.length){
    const cur=q.shift();
    if(cur.x===tx && cur.y===ty){
      const path=[]; let k=key(tx,ty);
      while(prev.has(k)){ const p=prev.get(k); const [cx,cy]=k.split(',').map(Number); path.push({x:cx,y:cy}); k=key(p.x,p.y); }
      path.reverse(); return path;
    }
    for(const d of dirs){
      const nx=cur.x+d[0], ny=cur.y+d[1], kk=key(nx,ny);
      if(!ok(nx,ny) || seen.has(kk)) continue;
      seen.add(kk); prev.set(kk,cur); q.push({x:nx, y:ny});
    }
  }
  return null;
}

// ===== Input & movement =====
let questCount=0, questDone=false;
function stepTo(nx,ny){
  if(!isWalkableDynamic(nx,ny)) return;
  player.x=nx; player.y=ny;
  // collect
  for(let i=coins.length-1;i>=0;i--) if(coins[i].x===nx&&coins[i].y===ny){ coins.splice(i,1); player.coins++; gainExp(XP_COIN); if(!questDone){ questCount=Math.min(QUEST_TARGET, questCount+1); if(questCount===QUEST_TARGET){questDone=true; gainExp(QUEST_REWARD_XP);} } }
  for(let i=potions.length-1;i>=0;i--) if(potions[i].x===nx&&potions[i].y===ny){ potions.splice(i,1); player.potions++; player.hp=Math.min(player.maxHp,player.hp+10); gainExp(XP_POTION); }
  updateHUD(); draw(); saveGame();
}
function canvasToTile(evt){
  const rect=c.getBoundingClientRect();
  const clientX = evt.clientX ?? (evt.touches?.[0]?.clientX) ?? (evt.changedTouches?.[0]?.clientX);
  const clientY = evt.clientY ?? (evt.touches?.[0]?.clientY) ?? (evt.changedTouches?.[0]?.clientY);
  const sx=(clientX-rect.left)*(c.width/rect.width), sy=(clientY-rect.top)*(c.height/rect.height);
  const iso=screenToIso(sx,sy);
  const tx=Math.round(iso.x), ty=Math.round(iso.y);
  return {tx,ty,sx,sy};
}
function handleTap(evt){
  if(deathScreen.classList.contains('show')) return;
  const {tx,ty, sx, sy} = canvasToTile(evt);
  lastClick={sx,sy};
  const enemy = enemies.find(e=>e.x===tx&&e.y===ty && Math.abs(e.x-player.x)+Math.abs(e.y-player.y)===1);
  if(enemy){ // melee
    const now=performance.now(); if(now-lastAttackTs>=ATTACK_CD_MS){
      lastAttackTs=now; enemy.hp=Math.max(0, enemy.hp - (PLAYER_ATK_MIN + Math.floor(Math.random()*(PLAYER_ATK_MAX-PLAYER_ATK_MIN+1))));
      if(enemy.hp===0){ onEnemyDeath(enemy); }
      draw(); saveGame();
    }
    return;
  }
  const path=findPath(player.x,player.y,tx,ty,true);
  if(path && path.length){ pathQueue=path; walking=true; }
}

// ===== Enemy utils =====
function onEnemyDeath(enemy){
  if(Math.random()<DROP_COIN_CHANCE) coins.push({x:enemy.x,y:enemy.y});
  else if(Math.random()<DROP_POTION_CHANCE) potions.push({x:enemy.x,y:enemy.y});
  gainExp(XP_SLIME);
  const np=randEmpty([...enemies,...coins,...potions]);
  enemy.x=np.x; enemy.y=np.y;
  enemy.maxHp=25+Math.floor(player.lvl*1.3); enemy.hp=enemy.maxHp;
  enemy.ai='idle'; enemy.aggroUntil=0; enemy.path=[]; enemy.nextRepath=0;
}

function enemyAdjAttack(e, ts){
  const dist = Math.abs(e.x-player.x)+Math.abs(e.y-player.y);
  if(dist===1 && (ts - (e.lastAtk||0))>=ENEMY_ATK_CD_MS){
    e.lastAtk=ts;
    const dmg = Math.floor(ENEMY_ATK_MIN + Math.random()*(ENEMY_ATK_MAX-ENEMY_ATK_MIN+1));
    player.hp = Math.max(0, player.hp - dmg);
    if(player.hp<=0) onDeath();
  }
}

function enemyAI(ts){
  enemies.forEach(e=>{
    const dist = Math.abs(e.x-player.x)+Math.abs(e.y-player.y);
    if(dist<=AGGRO_RANGE){ e.ai='aggro'; e.aggroUntil=ts+AGGRO_MEMORY_MS; }
    else if(e.ai==='aggro' && ts>e.aggroUntil){ e.ai='idle'; e.path=[]; }

    enemyAdjAttack(e, ts);

    if(e.ai==='aggro'){
      if(ts >= (e.nextRepath||0)){
        const candidates=[[1,0],[-1,0],[0,1],[0,-1]].map(d=>({x:player.x-d[0], y:player.y-d[1]}))
          .filter(p=>isWalkableTile(p.x,p.y) && !(p.x===player.x&&p.y===player.y));
        let target = candidates.find(p=>!isEnemyAt(p.x,p.y)) || {x:player.x,y:player.y};
        e.path = findPath(e.x,e.y,target.x,target.y,false) || [];
        e.nextRepath = ts + ENEMY_REPATH_MS;
      }
      if(e.path && e.path.length){
        const step=e.path.shift();
        if(isWalkableTile(step.x,step.y) && !(step.x===player.x&&step.y===player.y) && !enemies.some(o=>o!==e && o.x===step.x && o.y===step.y)){
          e.x=step.x; e.y=step.y;
        }else{ e.path=[]; }
      }
    } else {
      if(Math.random()<0.25){
        const dirs=[[1,0],[-1,0],[0,1],[0,-1],[0,0]];
        const d=dirs[Math.floor(Math.random()*dirs.length)];
        const nx=e.x+d[0], ny=e.y+d[1];
        if(isWalkableTile(nx,ny) && !(nx===player.x&&ny===player.y) && !enemies.some(o=>o!==e && o.x===nx && o.y===ny)){
          e.x=nx; e.y=ny;
        }
      }
    }
  });
}

// ===== Fireball skill (AoE) =====
const FB_COOLDOWN_MS=2000, FB_MP_COST=10, FB_SPEED=10;
let fbReadyTs=0;
let projectiles=[];
function tryCastFireball(targetSx, targetSy){
  const now=performance.now();
  if(now < fbReadyTs) return;             // cooldown
  if(player.mp < FB_MP_COST) return;      // mana
  const pScreen = isoToScreen(player.x, player.y);
  const dx = targetSx - pScreen.x;
  const dy = (targetSy - 40) - (pScreen.y - 32);
  const len = Math.hypot(dx, dy) || 1;
  const vx = FB_SPEED * dx/len;
  const vy = FB_SPEED * dy/len;
  projectiles.push({type:'fireball', x:pScreen.x, y:pScreen.y-32, vx, vy, life:90});
  player.mp = Math.max(0, player.mp - FB_MP_COST);
  fbReadyTs = now + FB_COOLDOWN_MS;
}
function updateProjectiles(){
  for(let i=projectiles.length-1;i>=0;i--){
    const p = projectiles[i];
    p.x += p.vx; p.y += p.vy; p.life--;
    if(p.life<=0 || p.x<0 || p.y<0 || p.x>screenW || p.y>screenH){
      const iso=screenToIso(p.x, p.y);
      const tx=Math.round(iso.x), ty=Math.round(iso.y);
      enemies.forEach(e=>{
        const d = Math.max(Math.abs(e.x-tx), Math.abs(e.y-ty)); // raggio 1
        if(d<=1){
          e.hp = Math.max(0, e.hp - (10 + Math.floor(Math.random()*8)));
          if(e.hp===0) onEnemyDeath(e);
        }
      });
      // piccolo flash
      ctx.save(); ctx.globalAlpha=0.35; ctx.fillStyle='#ff7b00'; ctx.beginPath(); ctx.arc(p.x, p.y, 36, 0, Math.PI*2); ctx.fill(); ctx.restore();
      projectiles.splice(i,1);
    }
  }
  // cooldown UI
  const now=performance.now();
  const remain = Math.max(0, fbReadyTs - now);
  const pct = remain/FB_COOLDOWN_MS;
  if(skill1cd){ skill1cd.style.height = (pct*100)+'%'; }
}

// ===== Rendering (isometric) =====
function draw(){
  ctx.clearRect(0,0,screenW,screenH);
  // draw ground tiles
  for(let y=0;y<mapRows;y++){
    for(let x=0;x<mapCols;x++){
      const s=isoToScreen(x,y);
      ctx.drawImage(IMGS.tile, s.x-isoTileW/2, s.y-isoTileH/2, isoTileW, isoTileH);
    }
  }
  if(optPathHighlight && optPathHighlight.checked && pathQueue.length){
    ctx.save(); ctx.globalAlpha=.25; ctx.fillStyle='#60a5fa';
    pathQueue.forEach(p=>{ const s=isoToScreen(p.x,p.y); ctx.beginPath(); ctx.moveTo(s.x, s.y-isoTileH/2); ctx.lineTo(s.x+isoTileW/2, s.y); ctx.lineTo(s.x, s.y+isoTileH/2); ctx.lineTo(s.x-isoTileW/2, s.y); ctx.closePath(); ctx.fill(); });
    ctx.restore();
  }
  // collect drawables with z-order = x+y
  const drawables=[];
  // coins/potions
  coins.forEach(o=>{ const s=isoToScreen(o.x,o.y); drawables.push({z:o.x+o.y, fn:()=>ctx.drawImage(IMGS.coin, s.x-24, s.y-32, 48,48)}); });
  potions.forEach(o=>{ const s=isoToScreen(o.x,o.y); drawables.push({z:o.x+o.y, fn:()=>ctx.drawImage(IMGS.potion, s.x-24, s.y-48, 48,64)}); });
  // trees (blocked tiles)
  for(let y=0;y<mapRows;y++) for(let x=0;x<mapCols;x++) if(map[y][x]===1){
    const s=isoToScreen(x,y); drawables.push({z:x+y+0.5, fn:()=>ctx.drawImage(IMGS.tree, s.x-64, s.y-140, 128,160)});
  }
  // enemies
  enemies.forEach(e=>{
    const s=isoToScreen(e.x,e.y);
    drawables.push({z:e.x+e.y+0.25, fn:()=>ctx.drawImage(IMGS.enemy, s.x-48, s.y-96, 96,128)});
  });
  // player
  { const s=isoToScreen(player.x,player.y); drawables.push({z:player.x+player.y+0.25, fn:()=>ctx.drawImage(IMGS.player, s.x-48, s.y-96, 96,128)}); }
  // sort by z
  drawables.sort((a,b)=>a.z-b.z);
  drawables.forEach(d=>d.fn());

  // projectiles on top
  projectiles.forEach(p=>{
    if(p.type==='fireball'){ ctx.drawImage(IMGS.fireball, p.x-24, p.y-24, 48,48); }
  });

  drawMinimap();
  if(dbg) dbg.textContent = `ISO ok | p:(${player.x},${player.y}) mobs:${enemies.length} path:${pathQueue.length} proj:${projectiles.length}`;
}

function drawMinimap(){
  const w=minimap.width, h=minimap.height;
  mmctx.clearRect(0,0,w,h);
  const sx=w/mapCols, sy=h/mapRows;
  for(let y=0;y<mapRows;y++){
    for(let x=0;x<mapCols;x++){
      mmctx.fillStyle = map[y][x]===1? '#334155' : '#1e293b';
      mmctx.fillRect(x*sx, y*sy, sx, sy);
    }
  }
  mmctx.fillStyle='#facc15'; coins.forEach(o=>mmctx.fillRect(o.x*sx+1,o.y*sy+1,sx-2,sy-2));
  mmctx.fillStyle='#22c55e'; potions.forEach(o=>mmctx.fillRect(o.x*sx+1,o.y*sy+1,sx-2,sy-2));
  mmctx.fillStyle='#ef4444'; enemies.forEach(e=>mmctx.fillRect(e.x*sx+1,e.y*sy+1,sx-2,sy-2));
  mmctx.fillStyle='#60a5fa'; mmctx.fillRect(player.x*sx+1,player.y*sy+1,sx-2,sy-2);
}

// ===== Timers =====
setInterval(()=>{
  const ts=performance.now();
  // walking
  if(walking && pathQueue.length){
    const peek=pathQueue[0];
    if(!isWalkableDynamic(peek.x,peek.y)){
      const dest=pathQueue[pathQueue.length-1];
      const np=findPath(player.x,player.y,dest.x,dest.y,true);
      pathQueue=(np&&np.length)?np:[]; if(!pathQueue.length) walking=false;
    } else {
      const next=pathQueue.shift(); stepTo(next.x,next.y);
      if(!pathQueue.length) walking=false;
    }
  }
  enemyAI(ts);
  updateProjectiles();
  draw();
}, 100);

// ===== Death & respawn =====
function onDeath(){
  deathScreen.classList.add('show');
  walking=false; pathQueue.length=0;
  const lost=Math.floor(player.coins*0.10);
  player.coins=Math.max(0,player.coins-lost);
  saveGame();
}
function respawn(){
  player.hp=player.maxHp; player.mp=player.maxMp; player.x=2; player.y=2;
  spawnAll(); updateHUD(); draw(); saveGame();
  deathScreen.classList.remove('show');
}

// ===== Bind UI =====
btnHideMinimap.addEventListener('click', ()=>{ minimapBox.classList.add('collapsed'); saveUI(); });
btnHideQuest  .addEventListener('click', ()=>{ questPanel.classList.add('collapsed'); saveUI(); });
btnToggleMinimap.addEventListener('click', ()=>{ minimapBox.classList.toggle('collapsed'); saveUI(); });
btnToggleQuest  .addEventListener('click', ()=>{ questPanel.classList.toggle('collapsed'); saveUI(); });
btnQuestReset.addEventListener('click', ()=>{ questCount=0; questDone=false; updateHUD(); saveGame(); });

btnStart.addEventListener('click', ()=>{ titleScreen.classList.remove('show'); titleScreen.style.display='none'; });
btnReset.addEventListener('click', ()=>{ localStorage.removeItem(SAVE_KEY); localStorage.removeItem(UI_KEY); location.reload(); });
btnMenu.addEventListener('click', ()=>{ deathScreen.classList.remove('show'); titleScreen.classList.add('show'); });
btnRespawn.addEventListener('click', respawn);

// Skill input
let lastClick=null;
skill1.addEventListener('click', (e)=>{
  lastClick = lastClick || {sx:screenW/2, sy:screenH/2};
  tryCastFireball(lastClick.sx, lastClick.sy);
});
window.addEventListener('keydown', (e)=>{
  if(e.key==='1'){ 
    lastClick = lastClick || {sx:screenW/2, sy:screenH/2};
    tryCastFireball(lastClick.sx, lastClick.sy);
  }
});

// Click-to-move & aim
c.addEventListener('pointerdown', (e)=>{
  const rect=c.getBoundingClientRect();
  const sx=(e.clientX-rect.left)*(c.width/rect.width), sy=(e.clientY-rect.top)*(c.height/rect.height);
  lastClick={sx,sy};
  handleTap(e);
});
c.addEventListener('click', handleTap);

// ===== Init =====
(async function(){
  await loadAll();
  genMap();
  const loaded = loadGame();
  if(!loaded){ spawnAll(); }
  updateHUD(); draw();
  if(dbg) dbg.textContent="Isometric engine ready";
})();

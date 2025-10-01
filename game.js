// Banner: segnala che game.js è partito
(function(){
  const b = window.__BOOT_BANNER__;
  if(b){ b.textContent = 'boot: game.js caricato ✓'; }
})();

// ===== Config base =====
const mapCols=10, mapRows=10;
const isoTileW=128, isoTileH=64;
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
const btnQuestReset=$('btnQuestReset');

// Death
const deathScreen=$('deathScreen');

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

// Fireball
const FB_MP_COST=10, FB_COOLDOWN_MS=2000, FB_SPEED=10;
let fbReadyTs=0;
let projectiles=[];

// Quest
const QUEST_TARGET=30, QUEST_REWARD_XP=30;
$('qtarget').textContent=QUEST_TARGET; $('qmax').textContent=QUEST_TARGET; $('qreward').textContent=QUEST_REWARD_XP;
const qfill=$('qfill'), qcount=$('qcount');

// Save keys
const SAVE_KEY='dreamtale_iso_save_v2_5';
const UI_KEY='dreamtale_iso_ui_v2_5';

// ===== Global handlers =====
window.startGame = function(){
  const t = document.getElementById('titleScreen');
  if (t) { t.classList.remove('show'); t.style.display = 'none'; }
};
window.resetSave = function(){
  try{ localStorage.removeItem(SAVE_KEY); localStorage.removeItem(UI_KEY); }catch{}
  location.reload();
};
window.backToMenu = function(){
  try{ deathScreen.classList.remove('show'); }catch{}
  const t = document.getElementById('titleScreen');
  if (t) { t.classList.add('show'); t.style.display = 'grid'; }
};
window.toggleMinimap = function(){ minimapBox.classList.toggle('collapsed'); saveUI(); };
window.hideMinimap   = function(){ minimapBox.classList.add('collapsed'); saveUI(); };
window.toggleQuest   = function(){ questPanel.classList.toggle('collapsed'); saveUI(); };
window.hideQuest     = function(){ questPanel.classList.add('collapsed'); saveUI(); };

// ===== Assets con placeholder =====
const IMGS={}, SRC={
  tile:'assets/tile_ground.png',
  tree:'assets/tree.png',
  player:'assets/player.png',
  enemy:'assets/enemy.png',
  coin:'assets/coin.png',
  potion:'assets/potion.png',
  fireball:'assets/fireball.png'
};
function placeholderCanvas(w,h,draw){
  const cvs=document.createElement('canvas'); cvs.width=w; cvs.height=h;
  const x=cvs.getContext('2d'); draw(x,w,h); const img=new Image(); img.src=cvs.toDataURL(); return img;
}
function makeTileFallback(){
  return placeholderCanvas(isoTileW,isoTileH,(x,w,h)=>{
    x.beginPath(); x.moveTo(w/2,0); x.lineTo(w,h/2); x.lineTo(w/2,h); x.lineTo(0,h/2); x.closePath();
    x.fillStyle='#3E5E3B'; x.fill(); x.strokeStyle='#223821'; x.lineWidth=2; x.stroke();
  });
}
function makeSpriteFallback(color='#9ca3af'){
  return placeholderCanvas(96,128,(x,w,h)=>{
    x.fillStyle=color; x.fillRect(w/2-12, h/2-28, 24, 56);
    x.fillStyle='#0006'; x.beginPath(); x.ellipse(w/2, h-10, 20, 6, 0, 0, Math.PI*2); x.fill();
  });
}
async function loadAll(){
  const tileFallback = makeTileFallback();
  const playerFallback = makeSpriteFallback('#9fb4ff');
  const enemyFallback  = makeSpriteFallback('#8be9fd');
  const coinFallback = placeholderCanvas(48,48,(x,w,h)=>{ x.fillStyle='#f5c427'; x.beginPath(); x.arc(w/2,h/2,20,0,Math.PI*2); x.fill(); });
  const potionFallback = placeholderCanvas(48,64,(x,w,h)=>{ x.strokeStyle='#8080a0'; x.lineWidth=3; x.strokeRect(8,12,32,40); x.fillStyle='#c03c64bb'; x.fillRect(10,28,28,22); });
  const fireballFallback = placeholderCanvas(48,48,(x,w,h)=>{ x.fillStyle='#ff7800'; x.beginPath(); x.arc(w/2,h/2,18,0,Math.PI*2); x.fill(); });

  const fallbacks = {tile:tileFallback, player:playerFallback, enemy:enemyFallback, coin:coinFallback, potion:potionFallback, fireball:fireballFallback};

  await Promise.all(Object.entries(SRC).map(([k,src])=>new Promise(res=>{
    const im=new Image();
    im.onload=()=>{IMGS[k]=im;res()};
    im.onerror=()=>{IMGS[k]=fallbacks[k] || makeSpriteFallback();res()};
    im.src=src;
  })));
}

// ===== Mappa & math isometrico =====
let map=[];
function rngSeed(seed){ let s=seed>>>0; return ()=>{ s = (s*1664525 + 1013904223)>>>0; return s/2**32; }; }
let rnd=rngSeed(1337);

function genMap(){
  map = Array.from({length:mapRows}, ()=>Array.from({length:mapCols}, ()=>0));
  for(let i=0;i<14;i++){
    const x=Math.floor(rnd()*mapCols), y=Math.floor(rnd()*mapRows);
    if(x===0&&y===0) continue; map[y][x]=1;
  }
}
const worldOffsetX = screenW/2;
theWorldOffsetY = 180; // typo fixed in next line, keep constant below
const worldOffsetY = 180;

function isoToScreen(ix,iy){
  return { x:(ix - iy)*(isoTileW/2) + worldOffsetX, y:(ix + iy)*(isoTileH/2) + worldOffsetY };
}
function screenToIso(sx,sy){
  const x = ((sx - worldOffsetX)/ (isoTileW/2) + (sy - worldOffsetY)/(isoTileH/2))/2;
  const y = ((sy - worldOffsetY)/(isoTileH/2) - (sx - worldOffsetX)/(isoTileW/2))/2;
  return {x, y};
}
function isWalkableTile(x,y){ return x>=0 && y>=0 && x<mapCols && y<mapRows && map[y][x]===0; }
function isEnemyAt(x,y){ return enemies.some(e=>e.x===x && e.y===y); }
function isWalkableDynamic(x,y){ return isWalkableTile(x,y) && !isEnemyAt(x,y); }
function manhattan(ax,ay,bx,by){ return Math.abs(ax-bx)+Math.abs(ay-by); }

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

// ===== UI =====
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

function saveGame(){ try{ localStorage.setItem(SAVE_KEY, JSON.stringify({player,enemies,coins,potions,map})); }catch{} }
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
  const enemy = enemies.find(e=>e.x===tx&&e.y===ty && manhattan(e.x,e.y,player.x,player.y)===1);
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

// ===== Enemy utils/AI =====
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
  const dist = manhattan(e.x,e.y,player.x,player.y);
  if(dist===1 && (ts - (e.lastAtk||0))>=ENEMY_ATK_CD_MS){
    e.lastAtk=ts;
    const dmg = Math.floor(ENEMY_ATK_MIN + Math.random()*(ENEMY_ATK_MAX-ENEMY_ATK_MIN+1));
    player.hp = Math.max(0, player.hp - dmg);
    if(player.hp<=0) onDeath();
  }
}
function enemyAI(ts){
  enemies.forEach(e=>{
    const dist = manhattan(e.x,e.y,player.x,player.y);
    if(dist<=AGGRO_RANGE){ e.ai='aggro'; e.aggroUntil=ts+AGGRO_MEMORY_MS; }
    else if(e.ai==='aggro' && ts>e.aggroUntil){ e.ai='idle'; e.path=[]; }

    enemyAdjAttack(e, ts);

    if(e.ai==='aggro'){
      if(ts >= (e.nextRepath||0)){
        const candidates=[[1,0],[-1,0],[0,1],[0,-1)].map(d=>({x:player.x-d[0], y:player.y-d[1]}))
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

// ===== Fireball AoE =====
let lastClick=null;
function tryCastFireball(targetSx, targetSy){
  const now=performance.now();
  if(now < fbReadyTs) return;
  if(player.mp < FB_MP_COST) return;
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
        const d = Math.max(Math.abs(e.x-tx), Math.abs(e.y-ty));
        if(d<=1){
          e.hp = Math.max(0, e.hp - (10 + Math.floor(Math.random()*8)));
          if(e.hp===0) onEnemyDeath(e);
        }
      });
      ctx.save(); ctx.globalAlpha=0.35; ctx.fillStyle='#ff7b00'; ctx.beginPath(); ctx.arc(p.x, p.y, 36, 0, Math.PI*2); ctx.fill(); ctx.restore();
      projectiles.splice(i,1);
    }
  }
  const now=performance.now();
  const remain = Math.max(0, fbReadyTs - now);
  const pct = remain/FB_COOLDOWN_MS;
  if(skill1cd){ skill1cd.style.height = (pct*100)+'%'; }
}

// ===== Rendering con fallback =====
function drawIsoTile(x,y){
  const s=isoToScreen(x,y);
  const img=IMGS.tile;
  if(img && img.width){ ctx.drawImage(img, s.x-isoTileW/2, s.y-isoTileH/2, isoTileW, isoTileH); }
  else {
    ctx.beginPath();
    ctx.moveTo(s.x, s.y-isoTileH/2);
    ctx.lineTo(s.x+isoTileW/2, s.y);
    ctx.lineTo(s.x, s.y+isoTileH/2);
    ctx.lineTo(s.x-isoTileW/2, s.y);
    ctx.closePath();
    ctx.fillStyle='#2f4f2f'; ctx.fill();
    ctx.strokeStyle='#1e3820'; ctx.stroke();
  }
}
function drawSprite(img, sx, sy, w, h, colorFallback='#9ca3af'){
  if(img && img.width){ ctx.drawImage(img, sx, sy, w, h); }
  else {
    ctx.fillStyle=colorFallback;
    ctx.fillRect(sx + w/2 - 12, sy + h/2 - 28, 24, 56);
    ctx.fillStyle='#0006';
    ctx.beginPath(); ctx.ellipse(sx+w/2, sy+h-8, 18, 6, 0, 0, Math.PI*2); ctx.fill();
  }
}

function draw(){
  ctx.clearRect(0,0,screenW,screenH);
  // terreno
  for(let y=0;y<mapRows;y++) for(let x=0;x<mapCols;x++) drawIsoTile(x,y);

  if(optPathHighlight && optPathHighlight.checked && pathQueue.length){
    ctx.save(); ctx.globalAlpha=.25; ctx.fillStyle='#60a5fa';
    pathQueue.forEach(p=>{ const s=isoToScreen(p.x,p.y); ctx.beginPath(); ctx.moveTo(s.x, s.y-isoTileH/2); ctx.lineTo(s.x+isoTileW/2, s.y); ctx.lineTo(s.x, s.y+isoTileH/2); ctx.lineTo(s.x-isoTileW/2, s.y); ctx.closePath(); ctx.fill(); });
    ctx.restore();
  }

  const drawables=[];
  coins.forEach(o=>{ const s=isoToScreen(o.x,o.y); drawables.push({z:o.x+o.y, fn:()=>drawSprite(IMGS.coin, s.x-24, s.y-32, 48,48, '#f5c427')}); });
  potions.forEach(o=>{ const s=isoToScreen(o.x,o.y); drawables.push({z:o.x+o.y, fn:()=>drawSprite(IMGS.potion, s.x-24, s.y-48, 48,64, '#c03c64')}); });
  for(let y=0;y<mapRows;y++) for(let x=0;x<mapCols;x++) if(map[y][x]===1){
    const s=isoToScreen(x,y); drawables.push({z:x+y+0.5, fn:()=>drawSprite(IMGS.tree, s.x-64, s.y-140, 128,160, '#3b7a3b')});
  }
  enemies.forEach(e=>{ const s=isoToScreen(e.x,e.y); drawables.push({z:e.x+e.y+0.25, fn:()=>drawSprite(IMGS.enemy, s.x-48, s.y-96, 96,128, '#8be9fd')}); });
  { const s=isoToScreen(player.x,player.y); drawables.push({z:player.x+player.y+0.25, fn:()=>drawSprite(IMGS.player, s.x-48, s.y-96, 96,128, '#9fb4ff')}); }

  drawables.sort((a,b)=>a.z-b.z);
  drawables.forEach(d=>d.fn());

  projectiles.forEach(p=>{ drawSprite(IMGS.fireball, p.x-24, p.y-24, 48,48, '#ff7800'); });

  drawMinimap();
  if(dbg) dbg.textContent = `ISO v2.5 | p:(${player.x},${player.y}) mobs:${enemies.length} path:${pathQueue.length} proj:${projectiles.length}`;
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

// ===== Loop =====
setInterval(()=>{
  const ts=performance.now();
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

// ===== Bind extra =====
btnQuestReset.addEventListener('click', ()=>{ questCount=0; questDone=false; updateHUD(); saveGame(); });

skill1.addEventListener('click', ()=>{
  lastClick = lastClick || {sx:screenW/2, sy:screenH/2};
  tryCastFireball(lastClick.sx, lastClick.sy);
});
window.addEventListener('keydown', (e)=>{
  if(e.key==='1'){
    lastClick = lastClick || {sx:screenW/2, sy:screenH/2};
    tryCastFireball(lastClick.sx, lastClick.sy);
  }
});

// Click-to-move & aim — **FIX: un solo handler corretto**
let lastClick=null;
c.addEventListener('pointerdown', (e)=>{
  const r=c.getBoundingClientRect();
  const sx=(e.clientX-r.left)*(c.width/r.width), sy=(e.clientY-r.top)*(c.height/r.height);
  lastClick={sx,sy};
  handleTap(e);
});
c.addEventListener('click', handleTap);

// ===== Init =====
window.addEventListener('error', (e)=>{
  const b = window.__BOOT_BANNER__;
  if(b){ b.textContent = 'ERRORE game.js: ' + (e && e.message ? e.message : 'sconosciuto'); b.style.color='#fca5a5'; }
});
(async function(){
  try{
    await loadAll();
    genMap();
    const loaded = loadGame();
    if(!loaded){ spawnAll(); }
    // ripristina stato UI
    loadUI();
    updateHUD(); draw();
    const b = window.__BOOT_BANNER__;
    if(b){ b.textContent = 'ready: tutto ok ✓ (iso2.5)'; }
  }catch(err){
    const b = window.__BOOT_BANNER__;
    if(b){ b.textContent = 'ERRORE in init: '+(err && err.message ? err.message : err); b.style.color='#fca5a5'; }
    console.error(err);
  }
})();

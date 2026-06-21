'use strict';
/* ═══ STORAGE ════════════════════════════════════════════════════ */
const SESSION_KEY = 'lm_session';
let user = null;
let D = { people:[], nid:1 };
const storeKey = () => `lm_data_${user.emp}`;
const pinKey   = () => `lm_pin_${user.emp}`;
const encKeyId = () => `lm_ek_${user.emp}`;   // 암호화 키 저장 키

/* ═══ 레이어2 — AES-GCM 암호화 저장 ════════════════════════════
   Web Crypto API (브라우저 내장, 서버 불필요)
   - AES-GCM 256bit : 군사급 대칭키 암호화
   - 기기마다 고유 키 생성 → 다른 기기에서 복사해도 복호화 불가
   - 개발자도구 localStorage 탭에서 암호문만 보임
   ⚠ 키도 같은 브라우저에 저장되므로 PIN 잠금(레이어6)과 함께 써야 최강
════════════════════════════════════════════════════════════════ */

/* 암호화 키 불러오기 or 최초 생성 */
async function getEncKey(){
  try{
    const stored=localStorage.getItem(encKeyId());
    if(stored){
      const raw=Uint8Array.from(atob(stored),c=>c.charCodeAt(0));
      return await crypto.subtle.importKey('raw',raw,{name:'AES-GCM'},false,['encrypt','decrypt']);
    }
  }catch(e){}
  /* 처음 실행 — 256bit 키 생성 */
  const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt','decrypt']);
  const exported=await crypto.subtle.exportKey('raw',key);
  localStorage.setItem(encKeyId(),btoa(String.fromCharCode(...new Uint8Array(exported))));
  return key;
}

/* 평문 JSON → 암호문 Base64 저장 */
async function saveEncrypted(storageKey,data){
  try{
    const key=await getEncKey();
    const iv=crypto.getRandomValues(new Uint8Array(12));          // 96bit IV (매번 새로)
    const enc=await crypto.subtle.encrypt(
      {name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify(data))
    );
    localStorage.setItem(storageKey,JSON.stringify({
      v:1,
      iv:btoa(String.fromCharCode(...iv)),
      ct:btoa(String.fromCharCode(...new Uint8Array(enc))),
    }));
  }catch(e){ console.warn('암호화 저장 실패',e); }
}

/* 암호문 Base64 → 평문 JSON 복원 */
async function loadDecrypted(storageKey){
  try{
    const raw=localStorage.getItem(storageKey); if(!raw) return null;
    const {v,iv,ct}=JSON.parse(raw);
    /* v가 없으면 구버전 평문 → 그대로 파싱 후 재암호화 */
    if(!v){
      const plain=JSON.parse(raw);
      return plain;
    }
    const key=await getEncKey();
    const dec=await crypto.subtle.decrypt(
      {name:'AES-GCM',iv:Uint8Array.from(atob(iv),c=>c.charCodeAt(0))},
      key,
      Uint8Array.from(atob(ct),c=>c.charCodeAt(0))
    );
    return JSON.parse(new TextDecoder().decode(dec));
  }catch(e){ return null; }
}

/* save / load — 비동기 래퍼 */
function save(){
  saveEncrypted(storeKey(),D).catch(()=>{
    /* 암호화 실패 시 평문으로 fallback (서비스 중단 방지) */
    try{ localStorage.setItem(storeKey(),JSON.stringify(D)); }catch(e){ toast('저장 실패','⚠'); }
  });
}
function load(){
  /* 비동기지만 init()에서 await으로 호출 */
  return loadDecrypted(storeKey()).then(r=>{
    if(r){ D=r; }
    D.people=D.people||[]; D.nid=D.nid||1;
    /* 구버전 평문 데이터가 있으면 즉시 재암호화 */
    const raw=localStorage.getItem(storeKey());
    if(raw){ try{ const t=JSON.parse(raw); if(!t.v) save(); }catch(e){} }
  });
}

/* 일정 저장도 암호화 */
function saveScheds(){
  saveEncrypted(`lm_sched_${user.emp}`,SCHEDS).catch(()=>{
    try{ localStorage.setItem(`lm_sched_${user.emp}`,JSON.stringify(SCHEDS)); }catch(e){}
  });
}
function loadScheds(){
  return loadDecrypted(`lm_sched_${user.emp}`).then(r=>{
    SCHEDS=Array.isArray(r)?r:[];
  });
}

/* ═══ 상수 ═══════════════════════════════════════════════════════ */
const REL = {
  customer:{ lbl:'기존 고객', col:'#1A6FD4', sh:'고객' },
  friend:  { lbl:'지인',      col:'#15803D', sh:'지인' },
  prospect:{ lbl:'신규 고객', col:'#9333EA', sh:'신규' },
};
const SCRIPTS = {
  customer:'고객님, 저와 함께 준비하신 보장이 잘 작동하고 있는지 확인차 연락드렸어요. 혹시 주변에 보험 관련 고민이 있으신 분 계시면 편하게 소개해 주세요 😊',
  friend:  '안녕하세요! 요즘 어떻게 지내세요? 저 요즘 보험 쪽 일을 하고 있는데, 주변에 노후 준비나 건강 보장 고민하시는 분 있으면 소개해 주시면 정말 감사하겠습니다!',
  prospect:'반갑습니다! 지금 어떤 보장이 준비되어 있는지 한번 같이 확인해 보시겠어요? 부담 없이 현황만 점검해 드립니다.',
};

/* ═══ 파이프라인 ══════════════════════════════════════════════════
   5단계 영업 파이프라인 — 상세 시트 내 체크리스트 + 타임라인
   person.pipeline = { stage:-1~4, dates:[null|'YYYY-MM-DD'×5], history:[] }
════════════════════════════════════════════════════════════════ */
const PIPELINE_STAGES = [
  { label:'고객등록', icon:'👤', col:'#15803D', bg:'#ECFDF5',
    script:'안녕하세요! 오늘 고객님 정보를 정리했습니다. 앞으로 잘 부탁드립니다 😊 혹시 보장 내용 관련해서 궁금한 점이 생기시면 편하게 연락 주세요.' },
  { label:'보장분석', icon:'🔍', col:'#D97706', bg:'#FFFBEB',
    script:'고객님, 현재 갖고 계신 보장 내용을 같이 정리해 드리려고 합니다. 10분 정도 시간 내주시면 지금 어떤 보장이 있고, 부족한 부분이 뭔지 한눈에 확인하실 수 있습니다.' },
  { label:'가입설계', icon:'📋', col:'#1A6FD4', bg:'#EFF6FF',
    script:'고객님 상황에 딱 맞는 설계를 준비했습니다. 부담 없이 한번 같이 살펴보시겠어요? 가입하지 않으셔도 되니 편하게 보시면서 궁금한 점 물어봐 주세요.' },
  { label:'보험가입', icon:'✅', col:'#9333EA', bg:'#F5F3FF',
    script:'가입해 주셔서 진심으로 감사합니다! 앞으로도 보장 잘 챙겨드릴게요 😊 주변에 보험 고민하시는 분 계시면 편하게 소개해 주시면 감사하겠습니다.' },
  { label:'지인소개', icon:'🔗', col:'#E85A00', bg:'#FFF0E8',
    script:'고객님, 지난번에 소개해 주신 분 덕분에 정말 도움이 됐습니다. 진심으로 감사드립니다 🙏 앞으로도 좋은 인연 이어갈 수 있도록 최선을 다하겠습니다.' },
];

function ensurePipeline(p){
  if(!p.pipeline) p.pipeline={ stage:-1, dates:[null,null,null,null,null], history:[] };
  if(!p.pipeline.dates||p.pipeline.dates.length<5)
    p.pipeline.dates=Array(5).fill(null).map((_,i)=>(p.pipeline.dates||[])[i]||null);
  if(!p.pipeline.history) p.pipeline.history=[];
  return p.pipeline;
}

function toggleStage(personId,stageIdx){
  const p=D.people.find(x=>x.id===personId); if(!p) return;
  const pl=ensurePipeline(p);
  const today=new Date().toISOString().slice(0,10);
  const wasChecked=pl.dates[stageIdx]!==null;
  if(wasChecked){
    for(let i=stageIdx;i<5;i++) pl.dates[i]=null;
    pl.stage=stageIdx-1;
    pl.history.push({date:today,action:'uncheck',stage:stageIdx});
    toast(PIPELINE_STAGES[stageIdx].label+' 단계 해제','↩');
  } else {
    for(let i=0;i<=stageIdx;i++) if(!pl.dates[i]) pl.dates[i]=today;
    pl.stage=stageIdx;
    pl.history.push({date:today,action:'check',stage:stageIdx});
    toast(PIPELINE_STAGES[stageIdx].icon+' '+PIPELINE_STAGES[stageIdx].label+' 완료!','✅');
    if(stageIdx===4) setTimeout(()=>toast(p.name+'님 지인소개까지 완료! 🎉','🎊'),800);

    /* ── 보험가입(3단계) 완료 → 소개자 감사 일정 자동 생성 ── */
    if(stageIdx===3 && p.ref){
      const refP=D.people.find(x=>x.id===p.ref);
      if(refP){
        const thanksTitle=`[감사 연락] ${refP.name}님께 — ${p.name} 가입 완료`;
        /* 이미 동일 일정 없을 때만 생성 */
        const alreadyExists=SCHEDS.some(s=>s.personId===refP.id&&s.title===thanksTitle);
        if(!alreadyExists){
          SCHEDS.push({
            id:Date.now(),
            date:today,
            time:'',
            title:thanksTitle,
            personId:refP.id,
            memo:`${p.name}님이 보험가입을 완료했습니다. ${refP.name}님께 감사 연락을 드리세요 🙏`,
            autoGenerated:true,
          });
          saveScheds();
          setTimeout(()=>toast(`📅 ${refP.name}님께 감사 연락 일정이 자동 생성됐습니다`,'🙏'),1200);
        }
      }
    }
  }
  save(); openDetail(personId);
}

function renderPipelineHTML(p){
  const pl=ensurePipeline(p);
  const completedCount=pl.dates.filter(d=>d!==null).length;
  const pct=Math.round(completedCount/5*100);

  const stageRows=PIPELINE_STAGES.map((st,i)=>{
    const done  =pl.dates[i]!==null;
    const active=!done&&(i===0||pl.dates[i-1]!==null);
    const locked=!done&&!active;
    const dateStr=pl.dates[i]?`<span class="pl-date">${pl.dates[i]}</span>`:'';
    const stateClass=done?'done':active?'active':'locked';
    const checkIcon=done?'✓':active?'→':'';
    return `<div class="pl-row ${stateClass}" onclick="${locked?'':('toggleStage('+p.id+','+i+')')}" style="cursor:${locked?'default':'pointer'}">
      <div class="pl-check ${stateClass}" style="${done?'background:'+st.col+';color:#fff;border-color:'+st.col:''}">
        ${checkIcon}
      </div>
      <div class="pl-info">
        <span class="pl-icon">${st.icon}</span>
        <span class="pl-label" style="${done?'color:'+st.col:''}">
          ${esc(st.label)}${active&&!done?' <span class="pl-now">진행 중</span>':''}
        </span>
      </div>
      ${dateStr}
    </div>`;
  }).join('');

  let histHTML='';
  if(pl.history&&pl.history.length>0){
    const recent=[...pl.history].reverse().slice(0,5);
    histHTML=`<div class="pl-history">
      <div class="pl-hist-title">⏱ 진행 히스토리</div>
      ${recent.map(h=>{
        const st=PIPELINE_STAGES[h.stage];
        const isCheck=h.action==='check';
        return `<div class="pl-hist-row">
          <div class="pl-hist-dot" style="background:${isCheck?st.col:'#9C8878'}"></div>
          <div class="pl-hist-body">
            <span class="pl-hist-action" style="color:${isCheck?st.col:'#9C8878'}">${isCheck?'완료':'해제'}</span>
            <span class="pl-hist-stage">${st.icon} ${esc(st.label)}</span>
            <span class="pl-hist-date">${h.date}</span>
          </div>
        </div>`;
      }).join('')}
    </div>`;
  }

  /* ── 현재 단계 스크립트 ── */
  const curStageIdx = pl.dates.filter(Boolean).length - 1;
  let pipelineScriptHTML = '';
  if(curStageIdx >= 0 && curStageIdx < PIPELINE_STAGES.length){
    const cst = PIPELINE_STAGES[curStageIdx];
    pipelineScriptHTML = `<div class="pl-script-box">
      <div class="pl-script-label">
        <span>${cst.icon} ${esc(cst.label)} 단계 — 추천 스크립트</span>
        <button class="sb-copy" onclick="copyPipelineScript(${p.id})">📋 복사</button>
      </div>
      <div class="pl-script-text" id="plScript_${p.id}">${esc(cst.script)}</div>
    </div>`;
  }

  return `<div class="pl-section">
    <div class="pl-title">📊 영업 파이프라인</div>
    <div class="pl-progress-wrap">
      <div class="pl-progress-bar"><div class="pl-progress-fill" style="width:${pct}%"></div></div>
      <span class="pl-pct">${completedCount}/5 · ${pct}%</span>
    </div>
    <div class="pl-stages">${stageRows}</div>
    ${histHTML}
  </div>${pipelineScriptHTML}`;
}



/* ═══ 레이어4 — 개발자도구 접근 억제 ══════════════════════════
   목적: D.people 등 메모리 데이터 콘솔 노출 방지
   한계: 완벽 차단은 불가 — 암호화(레이어2)가 진짜 방어선
════════════════════════════════════════════════════════════════ */
(function lockDevTools(){
  /* 1) 프로덕션 환경에서 console 출력 전면 차단 */
  if(location.hostname!=='localhost'&&location.hostname!=='127.0.0.1'){
    const noop=()=>{};
    ['log','warn','info','debug','table','dir','dirxml','group','groupEnd','trace','count','time','timeEnd'].forEach(m=>{
      try{ Object.defineProperty(console,m,{value:noop,writable:false,configurable:false}); }catch(e){}
    });
  }

  /* 2) 우클릭 컨텍스트 메뉴 차단 */
  document.addEventListener('contextmenu',e=>{
    e.preventDefault();
    return false;
  },{capture:true});

  /* 3) 키보드 단축키 차단
       F12 / Ctrl+Shift+I,J,C / Ctrl+U (소스 보기) / Ctrl+S (저장) */
  document.addEventListener('keydown',e=>{
    const ctrl=e.ctrlKey||e.metaKey;
    const shift=e.shiftKey;
    if(
      e.key==='F12'||
      (ctrl&&shift&&['I','i','J','j','C','c','K','k'].includes(e.key))||
      (ctrl&&['U','u','S','s'].includes(e.key))
    ){
      e.preventDefault();
      e.stopPropagation();
      return false;
    }
  },{capture:true});

  /* 4) DevTools 열림 감지 기능 제거 — 사용성 불편으로 비활성화 */
})();


const esc = s => String(s||'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rc     = id => D.people.filter(p=>p.ref===id).length;
const isHub  = id => rc(id)>=2;
const ago    = d  => d ? Math.floor((Date.now()-new Date(d))/86400000) : null;
const nodeR  = p  => 18+Math.min(rc(p.id)*5,22);
const visible= p  => ST.filt==='all'||p.rel===ST.filt;
function lighten(hex){
  const n=parseInt(hex.slice(1),16);
  const r=Math.min(255,((n>>16)&255)+50),g=Math.min(255,((n>>8)&255)+50),b=Math.min(255,(n&255)+50);
  return '#'+(r<<16|g<<8|b).toString(16).padStart(6,'0');
}

let _toastT;
function toast(msg,ic='✅'){
  const t=document.getElementById('toast');
  t.innerHTML=ic+' '+esc(msg); t.classList.add('on');
  clearTimeout(_toastT); _toastT=setTimeout(()=>t.classList.remove('on'),2400);
}

/* ═══ 시트 시스템 ════════════════════════════════════════════════ */
const overlay=document.getElementById('overlay');
function openSheet(id){ closeSheet(); document.getElementById(id).classList.add('on'); overlay.classList.add('on'); }
function closeSheet(){ document.querySelectorAll('.sheet').forEach(s=>s.classList.remove('on')); overlay.classList.remove('on'); }
overlay.addEventListener('click',closeSheet);

/* ═══ CANVAS ════════════════════════════════════════════════════ */
const cvs=document.getElementById('cvs');
const ctx=cvs.getContext('2d');
let W=0,H=0,DPR=1;
const POS={};
let ST={ filt:'all', selId:null, editId:null, relPick:'customer', zoom:1, ox:0, oy:0, drag:null, dragNode:null };

function resize(){
  const wrap=document.getElementById('mapWrap');
  DPR=window.devicePixelRatio||1;
  /* mapWrap이 숨겨져 있으면 clientWidth가 0 — 부모(main-container)로 대체 */
  let ww = wrap.clientWidth, wh = wrap.clientHeight;
  if(ww === 0 || wh === 0){
    const mc = document.getElementById('app');
    ww = mc ? mc.clientWidth  : window.innerWidth;
    wh = mc ? mc.clientHeight : window.innerHeight;
    /* 헤더·탭 높이 빼기 */
    const hdr = document.querySelector('.hdr');
    const nav = document.querySelector('.nav');
    wh -= (hdr ? hdr.offsetHeight : 52) + (nav ? nav.offsetHeight : 56);
    wh = Math.max(wh, 200);
  }
  W = ww; H = wh;
  cvs.width=W*DPR; cvs.height=H*DPR;
  cvs.style.width=W+'px'; cvs.style.height=H+'px';
  ctx.setTransform(DPR,0,0,DPR,0,0);
}
const w2s=(x,y)=>({sx:x*ST.zoom+ST.ox,sy:y*ST.zoom+ST.oy});
const s2w=(sx,sy)=>({x:(sx-ST.ox)/ST.zoom,y:(sy-ST.oy)/ST.zoom});

/* ── 허브 중심 계층 정적 레이아웃 ──────────────────────────────
   규칙:
   1) 허브(소개 2명+)는 화면 중심 가까이 배치
   2) 각 허브 주변에 그 자식들을 원형으로 배치
   3) 루트 노드(ref 없는)는 허브가 아니면 외곽 배치
   4) 노드 겹침 방지: 최소 간격 = (r1+r2+20)px
   5) 한 번 배치하면 고정 (물리 시뮬 없음)
──────────────────────────────────────────────────────────────── */
let _layoutDone = false;

function initPos(){
  /* 캔버스 크기 준비 안 된 경우 보정 */
  if(W===0||H===0) return;

  const ppl = D.people;
  if(!ppl.length) return;

  /* 이미 위치 있는 노드는 그대로 유지 (추가된 노드만 새로 배치) */
  const newNodes = ppl.filter(p=>!POS[p.id]);
  if(!newNodes.length) return;

  /* 전체 재배치 필요 여부: 처음 배치이거나 삭제/추가 비율이 크면 재계산 */
  const needFull = Object.keys(POS).length === 0;

  if(needFull){
    _doFullLayout(ppl);
  } else {
    /* 신규 노드만 빈 자리에 삽입 */
    newNodes.forEach(p => _placeNewNode(p, ppl));
  }
}

function _doFullLayout(ppl){
  const cx = W/2, cy = H/2;

  const sorted = [...ppl].sort((a,b) => rc(b.id) - rc(a.id));
  const hubs      = sorted.filter(p => rc(p.id) >= 2);
  const placed    = new Set();

  /* ─── 허브 배치 ─── */
  /* 허브가 1개면 중심, 2개 이상이면 중심 기준 충분히 벌려서 배치 */
  const hubGap = Math.max(130, W * 0.22);
  hubs.forEach((p, i) => {
    let x, y;
    if(hubs.length === 1){
      x = cx; y = cy;
    } else {
      const a = (i / hubs.length) * Math.PI * 2 - Math.PI/2;
      x = cx + Math.cos(a) * hubGap;
      y = cy + Math.sin(a) * hubGap;
    }
    POS[p.id] = { x, y };
    placed.add(p.id);
  });

  /* ─── 허브 자식 배치 ─── */
  hubs.forEach(hub => {
    const children = ppl.filter(p => p.ref === hub.id && !placed.has(p.id));
    if(!children.length) return;
    const rHub   = nodeR(hub);
    /* 자식 간격: 자식 노드 지름 + 여유 30px */
    const childDiam   = nodeR(children[0]) * 2 + 30;
    const circumNeeded = childDiam * children.length;
    /* 원 반경 = 둘레가 자식들 간격을 충분히 수용하는 크기 */
    const orbitR = Math.max(rHub + 75, circumNeeded / (2 * Math.PI));
    /* 부모와 연결되지 않는 방향(위쪽)부터 시작 */
    children.forEach((child, i) => {
      const a = (i / children.length) * Math.PI * 2 - Math.PI/2;
      const nx = POS[hub.id].x + Math.cos(a) * orbitR;
      const ny = POS[hub.id].y + Math.sin(a) * orbitR;
      POS[child.id] = { x: _clamp(nx, 36, W-36), y: _clamp(ny, 36, H-36) };
      placed.add(child.id);

      /* 손자 배치 */
      const grandChildren = ppl.filter(p => p.ref === child.id && !placed.has(p.id));
      if(!grandChildren.length) return;
      const gcDiam  = nodeR(grandChildren[0]) * 2 + 24;
      const gcOrbit = Math.max(nodeR(child) + 60, gcDiam * grandChildren.length / (2*Math.PI));
      grandChildren.forEach((gc, j) => {
        /* 부모 방향 반대쪽으로 펼침 */
        const ga = a + (j - (grandChildren.length-1)/2) * (Math.PI * 2 / Math.max(grandChildren.length, 3));
        POS[gc.id] = {
          x: _clamp(POS[child.id].x + Math.cos(ga)*gcOrbit, 36, W-36),
          y: _clamp(POS[child.id].y + Math.sin(ga)*gcOrbit, 36, H-36)
        };
        placed.add(gc.id);
      });
    });
  });

  /* ─── 나머지(독립 노드) 외곽 배치 ─── */
  const remaining = ppl.filter(p => !placed.has(p.id));
  const outerR    = Math.min(W, H) * 0.40;
  remaining.forEach((p, i) => {
    const a = (i / Math.max(1, remaining.length)) * Math.PI * 2 - Math.PI/2;
    POS[p.id] = {
      x: _clamp(cx + Math.cos(a) * outerR, 36, W-36),
      y: _clamp(cy + Math.sin(a) * outerR, 36, H-36)
    };
    placed.add(p.id);
  });

  /* ─── 겹침 해소 — 충분히 반복 ─── */
  for(let pass = 0; pass < 20; pass++) _resolveOverlaps(ppl);
}

function _placeNewNode(p, ppl){
  let bx = W * 0.85, by = 50;
  if(p.ref && POS[p.ref]){
    const parent = POS[p.ref];
    const siblings = ppl.filter(q => q.ref===p.ref && POS[q.id] && q.id!==p.id);
    const usedAngles = siblings.map(s => Math.atan2(POS[s.id].y-parent.y, POS[s.id].x-parent.x));
    let bestA = 0, bestGap = 0;
    for(let a = 0; a < Math.PI*2; a += 0.2){
      const gap = usedAngles.reduce((mn,ua)=>Math.min(mn, Math.abs(ua-a)), Math.PI*2);
      if(gap > bestGap){ bestGap=gap; bestA=a; }
    }
    const parentNode = ppl.find(q=>q.id===p.ref) || p;
    const dist = nodeR(parentNode) + nodeR(p) + 40;
    bx = parent.x + Math.cos(bestA)*dist;
    by = parent.y + Math.sin(bestA)*dist;
  }
  POS[p.id] = { x: _clamp(bx, 36, W-36), y: _clamp(by, 36, H-36) };
  for(let i=0; i<10; i++) _resolveOverlaps(ppl);
}

function _resolveOverlaps(ppl){
  for(let i=0; i<ppl.length; i++){
    for(let j=i+1; j<ppl.length; j++){
      const a=ppl[i], b=ppl[j];
      const pa=POS[a.id], pb=POS[b.id];
      if(!pa||!pb) continue;
      /* 최소 거리 = 두 노드 반지름 합 + 여유 24px */
      const minDist = nodeR(a) + nodeR(b) + 24;
      const dx=pb.x-pa.x, dy=pb.y-pa.y;
      const d=Math.sqrt(dx*dx+dy*dy)||0.1;
      if(d < minDist){
        const push = (minDist - d) / 2 + 1;
        const nx=dx/d, ny=dy/d;
        /* 허브는 더 안 밀리고, 리프 쪽을 많이 밀어냄 */
        const wa = isHub(a.id) ? 0.15 : 0.5;
        const wb = isHub(b.id) ? 0.15 : 0.5;
        pa.x = _clamp(pa.x - nx*push*wa, 24, W-24);
        pa.y = _clamp(pa.y - ny*push*wa, 24, H-24);
        pb.x = _clamp(pb.x + nx*push*wb, 24, W-24);
        pb.y = _clamp(pb.y + ny*push*wb, 24, H-24);
      }
    }
  }
}

function _clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }

/* 연결망 전체 재배치 (노드 추가/삭제 후 호출) */
function relayout(){
  Object.keys(POS).forEach(k => delete POS[k]);
  /* 연결망 뷰가 보이는 상태면 즉시 배치, 숨겨져 있으면 플래그만 세움 */
  const mapVisible = document.getElementById('vMap').classList.contains('show');
  if(mapVisible){
    resize();   /* 최신 크기 반영 */
    initPos();
  }
  /* mapVisible이 false면 showMainView('vMap') 호출 시 initPos가 실행됨 */
}

function draw(){
  ctx.clearRect(0,0,W,H);
  /* 엣지 */
  for(const p of D.people){
    if(!p.ref) continue;
    const a=POS[p.ref],b=POS[p.id]; if(!a||!b) continue;
    const pa=w2s(a.x,a.y),pb=w2s(b.x,b.y);
    const refP=D.people.find(x=>x.id===p.ref)||{rel:'all'};
    const show=visible(p)&&visible(refP);
    ctx.lineWidth=show?1.8:0.5;
    const g2=ctx.createLinearGradient(pa.sx,pa.sy,pb.sx,pb.sy);
    g2.addColorStop(0,show?'rgba(100,140,200,.55)':'rgba(0,0,0,.04)');
    g2.addColorStop(1,show?'rgba(60,100,180,.22)':'rgba(0,0,0,.02)');
    ctx.strokeStyle=g2;
    ctx.beginPath(); ctx.moveTo(pa.sx,pa.sy);
    ctx.quadraticCurveTo((pa.sx+pb.sx)/2,(pa.sy+pb.sy)/2-12,pb.sx,pb.sy);
    ctx.stroke();
    if(show){
      const ang=Math.atan2(pb.sy-pa.sy,pb.sx-pa.sx),rr=nodeR(p)*ST.zoom;
      const ax=pb.sx-Math.cos(ang)*rr,ay=pb.sy-Math.sin(ang)*rr;
      ctx.fillStyle='rgba(80,130,220,.55)';
      ctx.beginPath(); ctx.moveTo(ax,ay);
      ctx.lineTo(ax-Math.cos(ang-.45)*7,ay-Math.sin(ang-.45)*7);
      ctx.lineTo(ax-Math.cos(ang+.45)*7,ay-Math.sin(ang+.45)*7);
      ctx.closePath(); ctx.fill();
    }
  }
  /* 노드 */
  for(const p of D.people){
    const pp=POS[p.id]; if(!pp) continue;
    const s=w2s(pp.x,pp.y),r=nodeR(p)*ST.zoom,show=visible(p),hub=isHub(p.id),sel=ST.selId===p.id;
    const col=REL[p.rel].col;
    if(!show){ ctx.beginPath(); ctx.arc(s.sx,s.sy,r*.5,0,Math.PI*2); ctx.fillStyle='rgba(0,0,0,.06)'; ctx.fill(); continue; }
    if(hub||sel){
      const gr=ctx.createRadialGradient(s.sx,s.sy,0,s.sx,s.sy,r*2.4);
      gr.addColorStop(0,col+(sel?'44':'28')); gr.addColorStop(1,'transparent');
      ctx.beginPath(); ctx.arc(s.sx,s.sy,r*2.4,0,Math.PI*2); ctx.fillStyle=gr; ctx.fill();
    }
    const bg=ctx.createRadialGradient(s.sx-r*.25,s.sy-r*.25,0,s.sx,s.sy,r);
    bg.addColorStop(0,lighten(col)); bg.addColorStop(1,col);
    ctx.beginPath(); ctx.arc(s.sx,s.sy,r,0,Math.PI*2); ctx.fillStyle=bg; ctx.fill();
    ctx.lineWidth=sel?3.5:(hub?2.2:1.2);
    ctx.strokeStyle=sel?'#fff':(hub?'rgba(255,255,255,.85)':'rgba(255,255,255,.3)'); ctx.stroke();
    ctx.fillStyle='rgba(255,255,255,.95)'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.font=`700 ${Math.max(11,r*.78)}px Pretendard,sans-serif`;
    ctx.fillText((p.name||'?').charAt(0),s.sx,s.sy);
    if(hub){ ctx.font=`${Math.max(10,r*.6)}px Arial`; ctx.fillText('⭐',s.sx+r*.72,s.sy-r*.72); }
    if(ST.zoom>.7){
      ctx.font=`600 ${Math.max(10,11*Math.min(ST.zoom,1.4))}px Pretendard,sans-serif`;
      ctx.fillStyle='rgba(50,30,10,.8)';
      ctx.fillText(p.name||'?',s.sx,s.sy+r+11);
    }
  }
}
/* 물리 시뮬 없음 — draw만 rAF로 반복 (드래그 반응용) */
function loop(){ draw(); requestAnimationFrame(loop); }

/* ── 터치/마우스 인터랙션 ── */
function nodeAt(sx,sy){
  for(let i=D.people.length-1;i>=0;i--){
    const p=D.people[i]; if(!visible(p)) continue;
    const pp=POS[p.id]; if(!pp) continue;
    const s=w2s(pp.x,pp.y),r=nodeR(p)*ST.zoom;
    if(Math.hypot(sx-s.sx,sy-s.sy)<=r+6) return p;
  } return null;
}
function gxy(e){
  const r=cvs.getBoundingClientRect();
  const t=(e.touches&&e.touches.length>0)?e.touches[0]:(e.changedTouches&&e.changedTouches.length>0)?e.changedTouches[0]:e;
  return{x:t.clientX-r.left,y:t.clientY-r.top};
}
let moved=false,sp=null,tapId=null,pDist=0,pinching=false;
function resetDrag(){ ST.drag=null; ST.dragNode=null; moved=false; tapId=null; }
function onDn(e){
  if(e.touches&&e.touches.length>1){pinching=true;resetDrag();return;}
  pinching=false;
  const{x,y}=gxy(e); sp={x,y}; moved=false;
  const n=nodeAt(x,y);
  if(n){ST.dragNode=n.id;tapId=n.id;ST.drag={x,y};}
  else{tapId=null;ST.drag={x,y,ps:{ox:ST.ox,oy:ST.oy}};}
}
function onMv(e){
  if(pinching||!ST.drag)return;
  const{x,y}=gxy(e);
  if(Math.hypot(x-sp.x,y-sp.y)>10){moved=true;tapId=null;}
  if(ST.dragNode){const w=s2w(x,y);POS[ST.dragNode].x=w.x;POS[ST.dragNode].y=w.y;}
  else if(ST.drag.ps){ST.ox=ST.drag.ps.ox+(x-ST.drag.x);ST.oy=ST.drag.ps.oy+(y-ST.drag.y);}
}
function onUp(){
  if(pinching){pinching=false;pDist=0;resetDrag();return;}
  if(!moved&&tapId!==null){const id=tapId;resetDrag();openDetail(id);return;}
  resetDrag();
}
// 마우스
cvs.addEventListener('mousedown',onDn);
window.addEventListener('mousemove',e=>{
  onMv(e);
  if(!ST.drag){
    const{x,y}=gxy(e),n=nodeAt(x,y),tip=document.getElementById('tip');
    if(n){cvs.style.cursor='pointer';tip.style.cssText=`display:block;left:${x+14}px;top:${y-8}px`;tip.textContent=n.name+' · '+REL[n.rel].sh+(rc(n.id)?` · 소개 ${rc(n.id)}명`:'');}
    else{cvs.style.cursor='default';tip.style.display='none';}
  }
});
window.addEventListener('mouseup',onUp);
// 터치 — 모두 passive:false
cvs.addEventListener('touchstart',e=>{
  if(e.touches.length===2){
    pinching=true; pDist=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);
    ST.drag=null; ST.dragNode=null; e.preventDefault(); return;
  }
  onDn(e); e.preventDefault();
},{passive:false});
cvs.addEventListener('touchmove',e=>{
  if(e.touches.length===2&&pinching){
    const d=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);
    if(pDist>0){
      const scale=d/pDist,r=cvs.getBoundingClientRect();
      const mx=(e.touches[0].clientX+e.touches[1].clientX)/2-r.left;
      const my=(e.touches[0].clientY+e.touches[1].clientY)/2-r.top;
      ST.ox=mx-(mx-ST.ox)*scale; ST.oy=my-(my-ST.oy)*scale;
      ST.zoom=Math.max(.3,Math.min(3.5,ST.zoom*scale));
    }
    pDist=d; e.preventDefault(); return;
  }
  if(e.touches.length===1){onMv(e);e.preventDefault();}
},{passive:false});
cvs.addEventListener('touchend',  e=>{if(e.touches.length===0)pinching=false;onUp();},{passive:false});
cvs.addEventListener('touchcancel',()=>{resetDrag();pinching=false;pDist=0;});
cvs.addEventListener('wheel',e=>{
  e.preventDefault();
  const{x,y}=gxy(e),f=e.deltaY>0?.88:1.14;
  ST.ox=x-(x-ST.ox)*f; ST.oy=y-(y-ST.oy)*f; ST.zoom=Math.max(.3,Math.min(3.5,ST.zoom*f));
},{passive:false});
// 줌 버튼
document.getElementById('btnZoomIn').onclick   =()=>{ST.zoom=Math.min(3.5,ST.zoom*1.2);};
document.getElementById('btnZoomOut').onclick  =()=>{ST.zoom=Math.max(.3,ST.zoom/1.2);};
document.getElementById('btnZoomReset').onclick=()=>{ST.zoom=1;ST.ox=ST.oy=0;toast('화면 초기화');};
// 필터
document.getElementById('filterBar').addEventListener('click',e=>{
  const pill=e.target.closest('.fpill'); if(!pill) return;
  document.querySelectorAll('.fpill').forEach(p=>{p.classList.remove('on');p.style.cssText='';});
  pill.classList.add('on'); ST.filt=pill.dataset.f;
  const c=pill.dataset.f==='all'?'var(--brand)':REL[pill.dataset.f].col;
  pill.style.cssText=`background:${c};color:#fff;border-color:${c};`;
});

/* ═══ 인맥 폼 ════════════════════════════════════════════════════ */
document.getElementById('fabAdd').addEventListener('click',()=>openForm());
/* ─── 인맥 추가/수정 폼 2단계 ─── */
function showFormStep(step){
  document.getElementById('formStep1').style.display = step===1?'block':'none';
  document.getElementById('formStep2').style.display = step===2?'block':'none';
}

function openForm(editId){
  ST.editId=editId||null;
  const isEdit=!!editId;
  document.getElementById('formTitle').textContent=isEdit?'인맥 수정':'인맥 추가';

  /* 소개해준사람 목록 채우기 */
  const sel=document.getElementById('fRef');
  sel.innerHTML='<option value="">— 직접 알게 됨 —</option>';
  D.people.filter(p=>p.id!==editId).forEach(p=>{
    sel.innerHTML+=`<option value="${p.id}">${esc(p.name)}</option>`;
  });

  if(isEdit){
    /* 수정 시: 2단계 폼으로 바로 표시 */
    const p=D.people.find(x=>x.id===editId);
    ST.relPick=p.rel||'customer';
    document.getElementById('fName').value=p.name||'';
    document.getElementById('fRegion').value=p.region||'';
    sel.value=p.ref||'';
    document.getElementById('fDate').value=p.lastContact||'';
    document.getElementById('fMemo').value=p.memo||'';
    document.querySelectorAll('.rel-opt').forEach(o=>{
      o.classList.toggle('selected',o.dataset.r===p.rel);
      if(o.dataset.r===p.rel) o.style.background=REL[p.rel].col;
      else o.style.background='';
    });
    showFormStep(2);
  } else {
    /* 추가 시: 1단계부터 */
    ST.relPick='customer';
    document.getElementById('fName').value='';
    document.getElementById('fRegion').value='';
    sel.value='';
    document.getElementById('fDate').value='';
    document.getElementById('fMemo').value='';
    document.querySelectorAll('.rel-opt').forEach(o=>{
      o.classList.remove('selected'); o.style.background='';
    });
    /* customer 기본 선택 */
    const defOpt=document.querySelector('.rel-opt[data-r="customer"]');
    if(defOpt){ defOpt.classList.add('selected'); defOpt.style.background=REL['customer'].col; }
    showFormStep(1);
  }
  openSheet('shForm');
}
document.getElementById('relRow').addEventListener('click',e=>{
  const o=e.target.closest('.rel-opt'); if(!o) return;
  ST.relPick=o.dataset.r;
  document.querySelectorAll('.rel-opt').forEach(x=>{x.classList.remove('selected');x.style.background='';});
  o.classList.add('selected'); o.style.background=REL[o.dataset.r].col;
});

/* ── 2단계 폼 이벤트 ── */
document.getElementById('btnStep1Next').addEventListener('click',()=>{
  const name=document.getElementById('fName').value.trim();
  if(!name){toast('이름을 입력하세요','⚠');return;}
  if(!guardSensitive([{id:'fName',label:'이름/별칭'}])) return;
  showFormStep(2);
});
document.getElementById('btnStep1Skip').addEventListener('click',()=>{
  const name=document.getElementById('fName').value.trim();
  if(!name){toast('이름을 입력하세요','⚠');return;}
  if(!guardSensitive([{id:'fName',label:'이름/별칭'}])) return;
  const obj={name,rel:ST.relPick,region:'',ref:null,lastContact:'',memo:''};
  if(ST.editId){Object.assign(D.people.find(x=>x.id===ST.editId),obj);toast(name+' 수정 완료','✏');}
  else{obj.id=D.nid++;obj.created=new Date().toISOString();D.people.push(obj);toast(name+' 추가 완료 — 나중에 상세정보를 채워보세요','✅');}
  save(); refresh(); closeSheet();
});
document.getElementById('btnStep2Back').addEventListener('click',()=>showFormStep(1));

/* fabAddToday → 오늘 뷰에서 추가 */
document.getElementById('fabAddToday').addEventListener('click',()=>openForm());
/* ═══ 민감정보 입력 차단 ════════════════════════════════════════
   차단 패턴:
   ① 연속 6자리 이상 숫자 (주민번호 앞자리·뒷자리, 계좌번호 등)
   ② 전화번호 형식: 010-XXXX-XXXX / 010XXXXXXXX
   ③ 주민번호 형식: XXXXXX-XXXXXXX / XXXXXXXXXXXXX (13자리 연속)
   ④ 이메일 패턴 (개인정보 수집 방지)
═══════════════════════════════════════════════════════════════ */
const SENSITIVE_PATTERNS = [
  {
    /* 6자리 이상 연속 숫자 — 단, 연도(20xx, 19xx) 단독 표현은 허용 */
    re: /(?<!\d)(?!(?:19|20)\d{2}(?!\d))\d{6,}/,
    msg: '연속된 숫자 6자리 이상은 입력할 수 없습니다\n(주민번호·계좌번호 등 민감정보 보호)',
  },
  {
    re: /01[016789][^\d]?\d{3,4}[^\d]?\d{4}/,
    msg: '휴대폰 번호는 입력할 수 없습니다',
  },
  {
    re: /[가-힣a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/,
    msg: '이메일 주소는 입력할 수 없습니다',
  },
];

/**
 * 민감정보 검사
 * @param {string} text 검사할 문자열
 * @returns {string|null} 위반 메시지 또는 null(통과)
 */
function checkSensitive(text) {
  if (!text) return null;
  for (const { re, msg } of SENSITIVE_PATTERNS) {
    if (re.test(text)) return msg;
  }
  return null;
}

/**
 * 필드 + 경고 UI 연결 — 입력 중 실시간 감지
 * @param {HTMLElement} el  input 또는 textarea
 * @param {HTMLElement} warn 경고 문구 표시용 요소 (hint-warn)
 */
function bindSensitiveCheck(el, warn) {
  if (!el) return;
  el.addEventListener('input', () => {
    const msg = checkSensitive(el.value);
    if (msg) {
      warn.textContent = '🚫 ' + msg;
      warn.style.color = 'var(--red)';
      warn.style.fontWeight = '700';
      el.style.borderColor = 'var(--red)';
    } else {
      warn.textContent = '⚠ 주민번호·연락처·계약금액 등 민감정보는 입력하지 마세요';
      warn.style.color = '';
      warn.style.fontWeight = '';
      el.style.borderColor = '';
    }
  });
}

/* 인맥 추가 폼의 이름·지역·메모 필드에 실시간 감지 적용 */
(function initSensitiveBindings() {
  const warnEl = document.querySelector('.hint-warn');
  if (!warnEl) return;
  ['fName', 'fRegion', 'fMemo'].forEach(id => {
    bindSensitiveCheck(document.getElementById(id), warnEl);
  });
  /* 일정 폼 제목·메모에도 적용 (일정 시트에 경고 영역 추가) */
  const schedWarn = document.querySelector('#shSched .hint-warn');
  if (schedWarn) {
    ['sTitle', 'sMemo'].forEach(id => {
      bindSensitiveCheck(document.getElementById(id), schedWarn);
    });
  }
})();

/**
 * 저장 전 최종 민감정보 검사 — 통과하면 true 반환
 * fields: [{id, label}]
 */
function guardSensitive(fields) {
  for (const { id, label } of fields) {
    const el = document.getElementById(id);
    if (!el) continue;
    const msg = checkSensitive(el.value);
    if (msg) {
      toast(`[${label}] ${msg}`, '🚫');
      el.focus();
      el.style.borderColor = 'var(--red)';
      setTimeout(() => { el.style.borderColor = ''; }, 2000);
      return false;
    }
  }
  return true;
}

document.getElementById('btnSave').addEventListener('click',()=>{
  const name=document.getElementById('fName').value.trim();
  if(!name){toast('이름을 입력하세요','⚠');return;}
  /* 민감정보 최종 검사 */
  if(!guardSensitive([
    {id:'fName',   label:'이름/별칭'},
    {id:'fRegion', label:'활동 지역'},
    {id:'fMemo',   label:'메모'},
  ])) return;
  const obj={
    name, rel:ST.relPick,
    region:document.getElementById('fRegion').value.trim(),
    ref:document.getElementById('fRef').value?+document.getElementById('fRef').value:null,
    lastContact:document.getElementById('fDate').value,
    memo:document.getElementById('fMemo').value.trim(),
  };
  if(ST.editId){Object.assign(D.people.find(x=>x.id===ST.editId),obj);toast(name+' 수정 완료','✏');}
  else{obj.id=D.nid++;obj.created=new Date().toISOString();D.people.push(obj);toast(name+' 추가','✅');}
  save(); refresh(); closeSheet();
});

/* ═══ 상세 보기 ══════════════════════════════════════════════════ */
/* ═══ 지역 커뮤니티 접점 탐색 v2 ══════════════════════════════
   고객 데이터(직업 추정, 소개 경로, 지역)를 바탕으로
   실제 접근 가능한 커뮤니티 유형을 자동 추론하고,
   오프라인 거점 + 접근 문자 초안까지 제공
════════════════════════════════════════════════════════════════ */

/* 검색 URL 헬퍼 — 앱 설치 없이 브라우저에서 바로 열리는 것만 */
const urlGoogle     = (r,kw) => `https://www.google.com/search?q=${encodeURIComponent(r+' '+kw)}`;
const urlKakaoMap   = (r,kw) => `https://map.kakao.com/?q=${encodeURIComponent(r+' '+kw)}`;
const urlNaverPlace = (r,kw) => `https://map.naver.com/p/search/${encodeURIComponent(r+' '+kw)}`;

/* 커뮤니티 유형 정의 — 채널은 앱 설치 불필요한 웹 검색만 */
const COMM_TYPES = [
  {
    id:'momcafe', ic:'👶', label:'맘카페·학부모',
    priority: (p) => /자녀|아이|아들|딸|학부모|육아|어린이|초등|중학|고등/i.test(p.memo||'') ? 2 : 0,
    channels:[
      { name:'구글 검색',  url:(r)=>urlGoogle(r,'맘카페 모임'),     ic:'🔍' },
      { name:'카카오맵',   url:(r)=>urlKakaoMap(r,'키즈카페'),       ic:'📍' },
      { name:'네이버 지도',url:(r)=>urlNaverPlace(r,'문화센터'),      ic:'🗺' },
    ],
    offline:{ label:'키즈카페·문화센터 찾기', url:(r)=>urlKakaoMap(r,'키즈카페') },
    script:(r,name)=>`안녕하세요 ${name}님! 혹시 ${r} 지역 맘카페나 학부모 모임 활동하세요? 자녀 교육이나 건강 보장 관련 정보 나누는 모임 있으면 저도 참여하고 싶어서요 😊 혹시 소개받을 수 있을까요?`,
  },
  {
    id:'health', ic:'💪', label:'헬스장·운동 모임',
    priority: (p) => /운동|헬스|테니스|골프|등산|러닝|배드민턴|수영|필라테스|요가/i.test(p.memo||'') ? 2 : 0,
    channels:[
      { name:'카카오맵',   url:(r)=>urlKakaoMap(r,'헬스장'),         ic:'📍' },
      { name:'네이버 지도',url:(r)=>urlNaverPlace(r,'헬스장'),         ic:'🗺' },
      { name:'구글 검색',  url:(r)=>urlGoogle(r,'운동 모임 동호회'),   ic:'🔍' },
    ],
    offline:{ label:'헬스장·체육관 찾기', url:(r)=>urlKakaoMap(r,'헬스장') },
    script:(r,name)=>`${name}님, 요즘 운동 열심히 하시죠? 저도 ${r}에서 운동 모임 함께하고 싶은데요. 혹시 다니시는 헬스장이나 운동 동호회 있으시면 한번 소개해 주실 수 있을까요?`,
  },
  {
    id:'local', ic:'🏘', label:'주민·동네 모임',
    priority: (p) => 1,
    channels:[
      { name:'구글 검색',  url:(r)=>urlGoogle(r,'주민 모임 커뮤니티'), ic:'🔍' },
      { name:'카카오맵',   url:(r)=>urlKakaoMap(r,'주민센터'),          ic:'📍' },
      { name:'네이버 지도',url:(r)=>urlNaverPlace(r,'주민센터'),          ic:'🗺' },
    ],
    offline:{ label:'주민센터·복지관 찾기', url:(r)=>urlKakaoMap(r,'주민센터') },
    script:(r,name)=>`안녕하세요 ${name}님! ${r} 지역에서 주민 모임이나 동네 커뮤니티 활동하세요? 저도 지역 분들과 교류를 넓히고 싶은데, 혹시 아시는 모임 있으시면 소개 부탁드려도 될까요?`,
  },
  {
    id:'hobby', ic:'🎯', label:'취미·동호회',
    priority: (p) => /독서|영화|사진|음악|요리|낚시|캠핑|보드|게임|등산/i.test(p.memo||'') ? 2 : 0,
    channels:[
      { name:'구글 검색',  url:(r)=>urlGoogle(r,'취미 동호회 모임'), ic:'🔍' },
      { name:'카카오맵',   url:(r)=>urlKakaoMap(r,'문화센터'),        ic:'📍' },
      { name:'네이버 지도',url:(r)=>urlNaverPlace(r,'문화센터'),       ic:'🗺' },
    ],
    offline:{ label:'문화센터·강좌 찾기', url:(r)=>urlKakaoMap(r,'문화센터') },
    script:(r,name)=>`${name}님, 취미 활동 즐겨 하세요? 저도 ${r} 지역 동호회나 취미 모임에 관심이 있어서요. 혹시 활동하시는 모임 있으시면 한번 소개해 주시겠어요?`,
  },
  {
    id:'work', ic:'🏢', label:'직장인·비즈니스',
    priority: (p) => /자영업|사업|직장|회사|대표|사장|부장|팀장|임원|CEO/i.test(p.memo||'') ? 2 : 0,
    channels:[
      { name:'구글 검색',  url:(r)=>urlGoogle(r,'직장인 모임 네트워크'), ic:'🔍' },
      { name:'카카오맵',   url:(r)=>urlKakaoMap(r,'공유오피스'),          ic:'📍' },
      { name:'네이버 지도',url:(r)=>urlNaverPlace(r,'공유오피스'),          ic:'🗺' },
    ],
    offline:{ label:'공유오피스·비즈니스센터', url:(r)=>urlKakaoMap(r,'공유오피스') },
    script:(r,name)=>`안녕하세요 ${name}님! ${r} 지역에서 비즈니스 네트워크 모임 혹시 참여하고 계신가요? 직장인이나 자영업자 분들과 교류하는 모임이 있다면 소개해 주시면 정말 감사하겠습니다.`,
  },
  {
    id:'senior', ic:'👴', label:'시니어·실버 모임',
    priority: (p) => /부모님|어머니|아버지|어르신|시니어|은퇴|노후/i.test(p.memo||'') ? 2 : 0,
    channels:[
      { name:'구글 검색',  url:(r)=>urlGoogle(r,'시니어 실버 모임'), ic:'🔍' },
      { name:'카카오맵',   url:(r)=>urlKakaoMap(r,'복지관'),          ic:'📍' },
      { name:'네이버 지도',url:(r)=>urlNaverPlace(r,'복지관'),          ic:'🗺' },
    ],
    offline:{ label:'복지관·경로당 찾기', url:(r)=>urlKakaoMap(r,'복지관') },
    script:(r,name)=>`${name}님, ${r} 지역 어르신들 모임이나 복지관 프로그램 같은 것 혹시 아세요? 노후 준비에 관심 있으신 분들께 도움이 될 정보를 나눠드리고 싶어서요.`,
  },
];

/* 고객 맥락 기반 커뮤니티 유형 우선순위 정렬 */
function rankCommTypes(p){
  return [...COMM_TYPES]
    .map(t => ({ ...t, score: t.priority(p) }))
    .sort((a,b) => b.score - a.score);
}

/* 커뮤니티 섹션 렌더링 */
function renderCommHTML(p){
  if(!p.region){
    return `<div class="comm-box">
      <div class="comm-empty">📍 활동 지역을 입력하면<br>지역 커뮤니티 접점을 제안해드립니다</div>
    </div>`;
  }

  const ranked = rankCommTypes(p);
  const topType = ranked[0]; // 가장 유력한 유형

  const typeCards = ranked.map((t,i) => `
    <div class="comm-type-card${i===0?' comm-type-top':''}" onclick="toggleCommDetail('${t.id}_${p.id}')">
      <div class="comm-type-hdr">
        <span class="comm-type-ic">${t.ic}</span>
        <span class="comm-type-label">${t.label}</span>
        ${i===0&&t.score>=2?'<span class="comm-rec-badge">추천</span>':''}
        <span class="comm-type-arr" id="comm-arr-${t.id}_${p.id}">›</span>
      </div>
      <div class="comm-type-body hide" id="comm-detail-${t.id}_${p.id}">
        <!-- 오프라인 거점 -->
        <a class="comm-offline-btn" href="${t.offline.url(p.region)}" target="_blank" rel="noopener">
          📍 ${t.offline.label} (카카오맵)
        </a>
        <!-- 온라인 채널 -->
        <div class="comm-channels">
          ${t.channels.map(ch=>`<a class="comm-ch-btn" href="${ch.url(p.region)}" target="_blank" rel="noopener">${ch.ic} ${ch.name}</a>`).join('')}
        </div>
        <!-- 접근 문자 초안 -->
        <div class="comm-script-wrap">
          <div class="comm-script-label">💬 접근 문자 초안</div>
          <div class="comm-script-text">${esc(t.script(p.region, p.name))}</div>
          <button class="comm-script-copy" onclick="copyCommScript('${t.id}',${p.id});event.stopPropagation()">📋 복사</button>
        </div>
      </div>
    </div>
  `).join('');

  /* 메모 단서가 있으면 추론 근거 표시 */
  const hint = topType.score >= 2
    ? `<div class="comm-infer-hint">💡 메모 내용을 바탕으로 <b>${topType.label}</b>을 우선 추천합니다</div>`
    : '';

  return `<div class="comm-box-v2">
    <div class="comm-v2-title">🗺 ${esc(p.region)} 지역 커뮤니티 접점</div>
    ${hint}
    <div class="comm-v2-desc">채널을 열면 오프라인 거점·온라인 커뮤니티·문자 초안이 나옵니다</div>
    ${typeCards}
    <div class="comm-note">외부 서비스로 이동 · 개인정보 미전송</div>
  </div>`;
}

function toggleCommDetail(uid){
  const body = document.getElementById('comm-detail-'+uid);
  const arr  = document.getElementById('comm-arr-'+uid);
  if(!body) return;
  const isOpen = !body.classList.contains('hide');
  /* 다른 것 닫기 */
  document.querySelectorAll('.comm-type-body').forEach(el=>{
    el.classList.add('hide');
  });
  document.querySelectorAll('.comm-type-arr').forEach(el=>{ el.textContent='›'; });
  if(!isOpen){
    body.classList.remove('hide');
    if(arr) arr.textContent='↓';
  }
}

function copyCommScript(typeId, personId){
  const t = COMM_TYPES.find(x=>x.id===typeId);
  const p = D.people.find(x=>x.id===personId);
  if(!t||!p) return;
  const text = t.script(p.region, p.name);
  if(navigator.clipboard&&window.isSecureContext){
    navigator.clipboard.writeText(text).then(()=>toast('문자 초안 복사 완료','📋')).catch(()=>_fallbackCopy(text));
  } else { _fallbackCopy(text); }
}

/* ═══ 상세 보기 ══════════════════════════════════════════════════ */
function cfURL(r,kw){return `https://search.naver.com/search.naver?where=article&query=${encodeURIComponent(r+' '+kw)}`;}
function cmURL(r,kw){return `https://map.naver.com/p/search/${encodeURIComponent(r+' '+kw)}`;}

function openDetail(id){
  const p=D.people.find(x=>x.id===id); if(!p) return;
  ST.selId=id;
  const col=REL[p.rel].col, rcN=rc(id), hub=isHub(id);
  const refP=p.ref?D.people.find(x=>x.id===p.ref):null;
  const kids=D.people.filter(x=>x.ref===id);
  let lastTxt='없음',dayTxt='';
  if(p.lastContact){const d=ago(p.lastContact);lastTxt=p.lastContact;dayTxt=d===0?'(오늘)':`(${d}일 전)`;}
  // 소개 경로
  let chain=[p],cur=p;
  for(let i=0;i<5;i++){const nx=cur.ref?D.people.find(x=>x.id===cur.ref):null;if(!nx)break;chain.push(nx);cur=nx;}
  chain.reverse();
  const pathHTML=chain.length>1?chain.map(x=>`<span style="color:${REL[x.rel].col};font-weight:600">${esc(x.name)}</span>`).join(' → '):'없음';

  /* ── 관계 온도 계산 ── */
  const tempScore = calcRelationshipTemp(p);
  const tempHTML  = renderTempHTML(tempScore);

  /* ── 내가 소개한 사람 현황 (소개자인 경우) ── */
  let referralStatusHTML = '';
  const myReferrals = D.people.filter(x=>x.ref===id);
  if(myReferrals.length > 0){
    const items = myReferrals.map(r=>{
      const pl=ensurePipeline(r);
      const done=pl.dates.filter(Boolean).length;
      const st=done>0?PIPELINE_STAGES[Math.min(done-1,4)]:null;
      const stLabel=st?`${st.icon} ${st.label}`:'미시작';
      const stCol=st?st.col:'var(--txt3)';
      return `<div class="referral-row">
        <div class="referral-av" style="background:${REL[r.rel].col}">${esc((r.name||'?').charAt(0))}</div>
        <div class="referral-info">
          <div class="referral-name">${esc(r.name)}<span class="pbadge" style="background:${REL[r.rel].col}22;color:${REL[r.rel].col};margin-left:6px">${REL[r.rel].sh}</span></div>
          <div class="referral-stage" style="color:${stCol}">${stLabel}</div>
        </div>
        <button class="referral-go" onclick="closeSheet();setTimeout(()=>openDetail(${r.id}),200)">›</button>
      </div>`;
    }).join('');
    referralStatusHTML=`<div class="referral-section">
      <div class="referral-title">🔗 내가 소개한 사람 현황 (${myReferrals.length}명)</div>
      ${items}
    </div>`;
  }

  document.getElementById('detBody').innerHTML=`
    <div class="d-hero">
      <div class="d-av" style="background:linear-gradient(135deg,${lighten(col)},${col})">${esc((p.name||'?').charAt(0))}</div>
      <div class="d-name">${esc(p.name)}${hub?' ⭐':''}</div>
      <div class="d-sub">${REL[p.rel].lbl}${p.region?' · '+esc(p.region):''}</div>
      <div class="d-chips">
        <span class="dchip" style="background:${col}22;color:${col}">${rcN}명 소개</span>
        ${hub?`<span class="dchip" style="background:var(--green-bg);color:var(--green)">핵심 허브</span>`:''}
        ${refP?`<span class="dchip" style="background:var(--blue-bg);color:var(--blue)">${esc(refP.name)} 소개</span>`:'<span class="dchip" style="background:#F5F0EB;color:var(--txt3)">직접 인맥</span>'}
      </div>
    </div>
    ${tempHTML}
    <div class="kv-box">
      <div class="kv"><span class="k">소개해 준 사람</span><span class="v">${refP?esc(refP.name):'직접 알게 됨'}</span></div>
      <div class="kv"><span class="k">소개 경로</span><span class="v" style="max-width:64%;text-align:right">${pathHTML}</span></div>
      <div class="kv"><span class="k">소개받은 인맥</span><span class="v">${kids.length?kids.map(x=>esc(x.name)).join(', '):'없음'}</span></div>
      <div class="kv"><span class="k">최근 접촉</span><span class="v">${esc(lastTxt)} <span style="color:var(--txt3)">${esc(dayTxt)}</span></span></div>
      ${p.memo?`<div class="kv"><span class="k">메모</span><span class="v" style="max-width:60%">${esc(p.memo)}</span></div>`:''}
    </div>
    <div class="script-box">
      <div class="sb-label">💬 오프닝 스크립트
        <button class="sb-copy" onclick="copyScript(${id})" title="복사">📋 복사</button>
      </div>
      <div class="sb-text" id="sbText_${id}">${esc(SCRIPTS[p.rel]||SCRIPTS.customer)}</div>
    </div>
    ${renderPipelineHTML(p)}
    ${renderContactResultHTML(p)}
    ${referralStatusHTML}
    <button class="btn btn-primary" onclick="markContact(${id})">📞 오늘 접촉함 · 타이밍 갱신</button>
    <button class="btn btn-ghost"   onclick="addReferred(${id})">🔗 이 사람이 소개한 인맥 추가</button>
    <button class="btn btn-ghost"   onclick="openForm(${id})">✏ 수정</button>
    <button class="btn btn-danger"  onclick="delPerson(${id})">🗑 삭제</button>
    ${renderCommHTML(p)}
  `;
  openSheet('shDetail');
}
function markContact(id){const p=D.people.find(x=>x.id===id);p.lastContact=new Date().toISOString().slice(0,10);save();refresh();openDetail(id);toast('접촉일 오늘로 갱신','📞');}

/* ─── 소개 요청 결과 기록 ─── */
const CONTACT_RESULTS = [
  { key:'success', label:'소개해줌 ✅', col:'#15803D', bg:'#ECFDF5' },
  { key:'refuse',  label:'거절함 ❌',   col:'#DC2626', bg:'#FEF2F2' },
  { key:'pending', label:'나중에 🕐',   col:'#D97706', bg:'#FFFBEB' },
];

function recordContactResult(personId, resultKey){
  const p=D.people.find(x=>x.id===personId); if(!p) return;
  if(!p.contactLog) p.contactLog=[];
  p.contactLog.push({ date:new Date().toISOString().slice(0,10), result:resultKey });
  p.lastContact=new Date().toISOString().slice(0,10);
  save(); openDetail(personId);
  const r=CONTACT_RESULTS.find(x=>x.key===resultKey);
  toast('소개 결과 기록: '+r.label, '📝');
}

function renderContactResultHTML(p){
  if(p.rel==='prospect') return ''; // 신규 고객은 미표시
  const log=(p.contactLog||[]).slice(-4).reverse();
  const resultBtns=CONTACT_RESULTS.map(r=>
    `<button class="cr-btn" style="background:${r.bg};color:${r.col};border-color:${r.col}44"
      onclick="recordContactResult(${p.id},'${r.key}')">${r.label}</button>`
  ).join('');
  let histHTML='';
  if(log.length){
    histHTML=`<div class="cr-hist">`+log.map(l=>{
      const r=CONTACT_RESULTS.find(x=>x.key===l.result)||{label:l.result,col:'#9C8878'};
      return `<div class="cr-hist-row">
        <span class="cr-hist-date">${l.date}</span>
        <span class="cr-hist-result" style="color:${r.col}">${r.label}</span>
      </div>`;
    }).join('')+`</div>`;
  }
  return `<div class="cr-section">
    <div class="cr-title">💬 소개 요청 결과</div>
    <div class="cr-btns">${resultBtns}</div>
    ${histHTML}
  </div>`;
}


function copyScript(id){
  const p=D.people.find(x=>x.id===id); if(!p) return;
  const text=SCRIPTS[p.rel]||SCRIPTS.customer;
  if(navigator.clipboard&&window.isSecureContext){
    navigator.clipboard.writeText(text)
      .then(()=>toast('스크립트가 복사됐습니다','📋'))
      .catch(()=>_fallbackCopy(text));
  } else {
    _fallbackCopy(text);
  }
}
function copyPipelineScript(id){
  const p=D.people.find(x=>x.id===id); if(!p) return;
  const pl=ensurePipeline(p);
  const curStageIdx=pl.dates.filter(Boolean).length-1;
  if(curStageIdx<0||curStageIdx>=PIPELINE_STAGES.length) return;
  const text=PIPELINE_STAGES[curStageIdx].script;
  if(navigator.clipboard&&window.isSecureContext){
    navigator.clipboard.writeText(text)
      .then(()=>toast('파이프라인 스크립트 복사 완료','📋'))
      .catch(()=>_fallbackCopy(text));
  } else {
    _fallbackCopy(text);
  }
}
function _fallbackCopy(text){
  const ta=document.createElement('textarea');
  ta.value=text; ta.style.cssText='position:fixed;opacity:0;top:0;left:0';
  document.body.appendChild(ta); ta.focus(); ta.select();
  try{ document.execCommand('copy'); toast('스크립트가 복사됐습니다','📋'); }
  catch{ toast('복사 실패 — 직접 선택해 주세요','⚠'); }
  document.body.removeChild(ta);
}
function delPerson(id){const p=D.people.find(x=>x.id===id);if(!confirm(`${p.name}님을 삭제할까요?`))return;D.people.filter(x=>x.ref===id).forEach(x=>x.ref=null);D.people=D.people.filter(x=>x.id!==id);delete POS[id];save();refresh();closeSheet();toast('삭제됐습니다','🗑');}
function addReferred(id){const p=D.people.find(x=>x.id===id);closeSheet();setTimeout(()=>{openForm();document.getElementById('fRef').value=id;document.getElementById('formTitle').textContent=`${p.name}님이 소개한 인맥`;},200);}

/* ═══ 인맥 목록 ══════════════════════════════════════════════════ */
function renderList(){
  const q=document.getElementById('srchInput').value.trim().toLowerCase();
  let ppl=[...D.people]; if(q) ppl=ppl.filter(p=>(p.name||'').toLowerCase().includes(q)||(p.region||'').toLowerCase().includes(q));
  ppl.sort((a,b)=>rc(b.id)-rc(a.id));
  const box=document.getElementById('plist');
  if(!ppl.length){box.innerHTML=`<div class="empty"><div class="empty-icon">${q?'🔍':'👥'}</div><p>${q?'검색 결과가 없습니다':'아직 등록된 인맥이 없어요<br>연결망 화면의 + 버튼으로 추가하세요'}</p></div>`;return;}
  box.innerHTML=ppl.map(p=>{
    const col=REL[p.rel].col,rcN=rc(p.id),hub=isHub(p.id),refP=p.ref?D.people.find(x=>x.id===p.ref):null;
    return `<div class="pcard" onclick="openDetail(${p.id})">
      <div class="pav" style="background:linear-gradient(135deg,${lighten(col)},${col})">${esc((p.name||'?').charAt(0))}</div>
      <div class="pi">
        <div class="pn">${esc(p.name)}${hub?' ⭐':''}<span class="pbadge" style="background:${col}22;color:${col}">${REL[p.rel].sh}</span></div>
        <div class="pm">${p.region?esc(p.region):'지역 미입력'}${refP?' · '+esc(refP.name)+' 소개':''}</div>
      </div>
      <div class="prc"><div class="prc-n">${rcN}</div><div class="prc-l">소개</div></div>
    </div>`;
  }).join('');
}
document.getElementById('srchInput').addEventListener('input',renderList);

/* ═══ 연락 알림 ══════════════════════════════════════════════════ */
function buildAlerts(threshold){
  const items=[],seen=new Set();
  D.people.forEach(p=>{
    const d=ago(p.lastContact);
    /* 개인 설정 → 유형별 기본값 → 전역 기준일 순으로 적용 */
    const thr = threshold ?? p.alertDays ?? DEFAULT_THR[p.rel] ?? alertThreshold;
    if(p.rel==='customer'||p.rel==='friend'){
      if(d===null){
        items.push({p,lvl:2,reason:'접촉 기록이 없습니다. 첫 연락을 시작해보세요.'});
      } else if(d>=thr){
        const lvl = d>=thr*3 ? 2 : 1;
        items.push({p,lvl,reason:`마지막 접촉 후 ${d}일 경과 (기준 ${thr}일) — 연락이 필요합니다.`});
      }
    }
    if(p.rel==='prospect'){
      if(d===null){
        items.push({p,lvl:1,reason:'신규 고객인데 접촉 기록이 없습니다.'});
      } else if(d>=thr){
        items.push({p,lvl:1,reason:`신규 고객 — 마지막 접촉 후 ${d}일 경과 (기준 ${thr}일)`});
      }
    }
  });
  D.people.forEach(p=>{
    if(p.rel==='customer'&&rc(p.id)===0){
      const d=ago(p.lastContact);
      const thr = p.alertDays ?? DEFAULT_THR[p.rel] ?? alertThreshold;
      if(d!==null&&d<thr)return;
      items.push({p,lvl:0,reason:'아직 소개를 받지 못한 고객입니다. 소개 요청을 시도해보세요.'});
    }
  });
  return items
    .filter(it=>{const k=it.p.id+'_'+it.lvl;if(seen.has(k))return false;seen.add(k);return true;})
    .sort((a,b)=>b.lvl-a.lvl || ago(a.p.lastContact??'1900-01-01')-ago(b.p.lastContact??'1900-01-01'));
}

function renderAlerts(){
  const thr=alertThreshold;
  const items=buildAlerts(thr),box=document.getElementById('alertBody');
  if(!items.length){
    box.innerHTML=`<div class="empty"><div class="empty-icon">🎉</div><p>기준 <b>${thr}일</b> 이내에 챙길 항목이 없습니다<br>접촉일을 기록하면 알림을 알려드립니다</p></div>`;
    return;
  }
  const urgent=items.filter(i=>i.lvl>0), dead=items.filter(i=>i.lvl===0);
  let html='';
  if(urgent.length){
    html+=`<div class="sec-ttl">🔔 연락 필요 — 기준 ${thr}일 이상 경과 (${urgent.length}명)</div>`;
    html+=urgent.map(it=>{
      const col=REL[it.p.rel].col;
      const d=ago(it.p.lastContact);
      const urgentClass = it.lvl>=2 ? ' urgent' : '';
      return `<div class="acard${urgentClass}">
        <div class="at">
          <span style="width:9px;height:9px;border-radius:50%;background:${col};display:inline-block;flex-shrink:0"></span>
          ${esc(it.p.name)}
          <span style="font-size:11px;color:var(--txt3)">${REL[it.p.rel].sh}${it.p.region?' · '+esc(it.p.region):''}</span>
          ${d!==null?`<span style="margin-left:auto;font-size:11px;font-weight:700;color:${it.lvl>=2?'var(--red)':'var(--amber)'}">${d}일 경과</span>`:'<span style="margin-left:auto;font-size:11px;color:var(--txt3)">기록 없음</span>'}
        </div>
        <div class="ad">${it.reason}</div>
        <div class="abtn-row">
          <button class="abtn pri" onclick="markContact(${it.p.id})">오늘 접촉함</button>
          <button class="abtn sec" onclick="openDetail(${it.p.id})">상세 보기</button>
        </div>
      </div>`;
    }).join('');
  }
  if(dead.length){
    html+=`<div class="sec-ttl" style="margin-top:16px">🌱 소개 확장 여지 (${dead.length}명)</div>`;
    html+=dead.map(it=>`<div class="acard">
      <div class="at">🌱 ${esc(it.p.name)}</div>
      <div class="ad">${it.reason}</div>
      <div class="abtn-row">
        <button class="abtn pri" onclick="addReferred(${it.p.id})">소개 인맥 추가</button>
        <button class="abtn sec" onclick="openDetail(${it.p.id})">상세 보기</button>
      </div>
    </div>`).join('');
  }
  box.innerHTML=html;
}

/* ─── 알림 필터 버튼 이벤트 ─── */
document.getElementById('alertFilterRow').addEventListener('click', e=>{
  const btn = e.target.closest('.af-btn'); if(!btn) return;
  document.querySelectorAll('.af-btn').forEach(b=>b.classList.remove('on'));
  btn.classList.add('on');
  const customWrap = document.getElementById('afCustomWrap');
  if(btn.dataset.d==='custom'){
    customWrap.classList.remove('hide');
    document.getElementById('afCustomInput').focus();
  } else {
    customWrap.classList.add('hide');
    alertThreshold = +btn.dataset.d;
    renderAlerts();
  }
});
document.getElementById('afApply').addEventListener('click', ()=>{
  const v = parseInt(document.getElementById('afCustomInput').value);
  if(!v||v<1){toast('올바른 일 수를 입력하세요','⚠');return;}
  alertThreshold = v;
  renderAlerts();
  toast(`기준일 ${v}일로 변경됐습니다`,'🔔');
});
document.getElementById('afCustomInput').addEventListener('keydown', e=>{
  if(e.key==='Enter') document.getElementById('afApply').click();
});


/* ═══════════════════════════════════════════════════════════
   일정 (SCHEDULE) — localStorage에 사번별 저장
═══════════════════════════════════════════════════════════ */
/* ─── 알림 기준일 설정 ─── */
let alertThreshold = 10;  // 기본 10일

const schedKey = () => `lm_sched_${user.emp}`;
let SCHEDS = [];   // [{ id, date:'YYYY-MM-DD', time:'HH:MM'|'', title, personId|null, memo }]

/* saveScheds / loadScheds 는 상단 레이어2 암호화 섹션에 정의됨 */

/* ─── 달력 상태 ─── */
let calYear  = new Date().getFullYear();
let calMonth = new Date().getMonth();   // 0-based
let calSelDate = toDateStr(new Date()); // 'YYYY-MM-DD'
let schedEditId = null;

function toDateStr(d) {
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
function parseDate(s) { const [y,m,d]=s.split('-').map(Number); return new Date(y,m-1,d); }

/* ─── 달력 렌더링 ─── */
function renderCal() {
  const MONTHS = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
  document.getElementById('calMonthLabel').textContent = `${calYear}년 ${MONTHS[calMonth]}`;

  const firstDay = new Date(calYear, calMonth, 1).getDay(); // 0=일
  const lastDate = new Date(calYear, calMonth+1, 0).getDate();
  const prevLast = new Date(calYear, calMonth, 0).getDate();
  const todayStr = toDateStr(new Date());

  const grid = document.getElementById('calGrid');
  grid.innerHTML = '';

  // 이전달 빈칸
  for (let i=0; i<firstDay; i++) {
    const d = prevLast - firstDay + 1 + i;
    const ds = `${calYear}-${String(calMonth).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    grid.appendChild(makeCell(d, ds, true));
  }
  // 이번달
  for (let d=1; d<=lastDate; d++) {
    const ds = `${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const cell = makeCell(d, ds, false);
    if (ds===todayStr)    cell.classList.add('today');
    if (ds===calSelDate)  cell.classList.add('selected');
    const dow = new Date(calYear,calMonth,d).getDay();
    if (dow===0) cell.classList.add('sun');
    if (dow===6) cell.classList.add('sat');
    grid.appendChild(cell);
  }
  // 다음달 빈칸
  const filled = firstDay + lastDate;
  const remain = filled % 7 === 0 ? 0 : 7 - (filled % 7);
  for (let i=1; i<=remain; i++) {
    const ds = `${calYear}-${String(calMonth+2).padStart(2,'0')}-${String(i).padStart(2,'0')}`;
    grid.appendChild(makeCell(i, ds, true));
  }

  renderDayScheds(calSelDate);
}

function makeCell(day, dateStr, otherMonth) {
  const cell = document.createElement('div');
  cell.className = 'cal-cell' + (otherMonth?' other-month':'');
  cell.innerHTML = `<div class="cal-day">${day}</div>`;

  // 일정 점
  const dayScheds = SCHEDS.filter(s=>s.date===dateStr);
  if (dayScheds.length) {
    const dots = document.createElement('div');
    dots.className = 'cal-dots';
    dayScheds.slice(0,3).forEach(s=>{
      const dot = document.createElement('div');
      dot.className = 'cal-dot';
      // 관련 인맥 색상 or 브랜드색
      const person = s.personId ? D.people.find(p=>p.id===s.personId) : null;
      dot.style.background = person ? REL[person.rel].col : 'var(--brand)';
      dots.appendChild(dot);
    });
    cell.appendChild(dots);
  }

  cell.addEventListener('click', () => {
    calSelDate = dateStr;
    renderCal();
  });
  return cell;
}

function renderDayScheds(dateStr) {
  const hdr = document.getElementById('calDayHeader');
  const list = document.getElementById('calSchedList');
  const d = parseDate(dateStr);
  const DOW = ['일','월','화','수','목','금','토'];
  const [y,m,day2] = dateStr.split('-').map(Number);
  hdr.innerHTML = `${y}년 ${m}월 ${day2}일 (${DOW[d.getDay()]}) <span>+ 버튼으로 일정 추가</span>`;

  const dayScheds = SCHEDS.filter(s=>s.date===dateStr).sort((a,b)=>(a.time||'99:99').localeCompare(b.time||'99:99'));
  if (!dayScheds.length) {
    list.innerHTML = '<div class="empty"><div class="empty-icon">📅</div><p>이 날 일정이 없습니다<br>오른쪽 위 + 버튼으로 추가하세요</p></div>';
    return;
  }
  list.innerHTML = dayScheds.map(s => {
    const person = s.personId ? D.people.find(p=>p.id===s.personId) : null;
    return `<div class="sched-card">
      <div class="sched-time">${s.time||'—'}</div>
      <div class="sched-info">
        <div class="sched-name">${esc(s.title)}</div>
        ${person?`<div class="sched-person">👤 ${esc(person.name)} (${REL[person.rel].sh})</div>`:''}
        ${s.memo?`<div class="sched-memo">${esc(s.memo)}</div>`:''}
      </div>
      <button class="sched-del" onclick="editSched(${s.id})">✏</button>
      <button class="sched-del" onclick="deleteSched(${s.id})" style="margin-left:4px">🗑</button>
    </div>`;
  }).join('');
}

/* ─── 일정 추가/수정 폼 ─── */
document.getElementById('btnAddSched').addEventListener('click', () => openSchedForm(null));

function openSchedForm(editId) {
  schedEditId = editId;
  document.getElementById('schedTitle').textContent = editId ? '일정 수정' : '일정 추가';

  // 인맥 목록 채우기
  const sel = document.getElementById('sPerson');
  sel.innerHTML = '<option value="">— 선택 안 함 —</option>';
  [...D.people].sort((a,b)=>a.name.localeCompare(b.name,'ko')).forEach(p => {
    sel.innerHTML += `<option value="${p.id}">${esc(p.name)} (${REL[p.rel].sh})</option>`;
  });

  if (editId) {
    const s = SCHEDS.find(x=>x.id===editId);
    document.getElementById('sDate').value  = s.date;
    document.getElementById('sTime').value  = s.time||'';
    document.getElementById('sTitle').value = s.title;
    sel.value = s.personId||'';
    document.getElementById('sMemo').value  = s.memo||'';
  } else {
    document.getElementById('sDate').value  = calSelDate;
    document.getElementById('sTime').value  = '';
    document.getElementById('sTitle').value = '';
    sel.value = '';
    document.getElementById('sMemo').value  = '';
  }
  openSheet('shSched');
}

document.getElementById('btnSchedSave').addEventListener('click', () => {
  const date  = document.getElementById('sDate').value;
  const title = document.getElementById('sTitle').value.trim();
  if (!date)  { toast('날짜를 선택하세요','⚠'); return; }
  if (!title) { toast('제목을 입력하세요','⚠'); return; }
  /* 민감정보 최종 검사 */
  if(!guardSensitive([
    {id:'sTitle', label:'일정 제목'},
    {id:'sMemo',  label:'메모'},
  ])) return;

  const obj = {
    date, title,
    time:     document.getElementById('sTime').value||'',
    personId: document.getElementById('sPerson').value ? +document.getElementById('sPerson').value : null,
    memo:     document.getElementById('sMemo').value.trim(),
  };

  if (schedEditId) {
    Object.assign(SCHEDS.find(x=>x.id===schedEditId), obj);
    toast('일정 수정 완료','✏');
  } else {
    obj.id = Date.now();
    SCHEDS.push(obj);
    toast('일정 추가 완료','📅');
  }
  calSelDate = date;
  calYear  = +date.slice(0,4);
  calMonth = +date.slice(5,7)-1;
  saveScheds(); renderCal(); closeSheet();
});

function editSched(id)   { openSchedForm(id); }
function deleteSched(id) {
  if (!confirm('이 일정을 삭제할까요?')) return;
  SCHEDS = SCHEDS.filter(s=>s.id!==id);
  saveScheds(); renderCal(); toast('일정 삭제','🗑');
}

/* 달력 이전/다음 달 버튼 */
document.getElementById('calPrev').addEventListener('click', () => {
  calMonth--; if(calMonth<0){calMonth=11;calYear--;} renderCal();
});
document.getElementById('calNext').addEventListener('click', () => {
  calMonth++; if(calMonth>11){calMonth=0;calYear++;} renderCal();
});

/* ═══ 내비게이션 ════════════════════════════════════════════════ */
function showMainView(id){
  document.querySelectorAll('.main-view').forEach(v=>v.classList.remove('show'));
  const el=document.getElementById(id);
  if(el) el.classList.add('show');
  /* 연결망 뷰 진입 시: 크기 재계산 + 미배치 노드 배치 */
  if(id==='vMap'){
    setTimeout(()=>{
      resize();
      initPos();   /* POS에 없는 노드만 새로 배치 */
    }, 30);        /* CSS transition 후 clientWidth가 확정되는 시점 */
  }
}
document.querySelectorAll('.nitem').forEach(ni=>{
  ni.addEventListener('click',()=>{
    document.querySelectorAll('.nitem').forEach(n=>n.classList.remove('on'));
    ni.classList.add('on');
    closeAllViews();
    const v=ni.dataset.v;
    if(v==='today'){  showMainView('vToday'); renderTodayFull(); }
    else if(v==='map'){ showMainView('vMap'); }
    else {
      showMainView('vMap'); // 연결망은 뒤에 유지
      if(v==='list'){   document.getElementById('vList').classList.add('show');   renderList(); }
      if(v==='cal'){    document.getElementById('vCal').classList.add('show');    renderCal(); }
      if(v==='alerts'){ document.getElementById('vAlert').classList.add('show'); renderAlerts(); }
    }
  });
});
function closeAllViews(){ document.querySelectorAll('.view').forEach(v=>v.classList.remove('show')); }
function closeView(){
  closeAllViews();
  document.querySelectorAll('.nitem').forEach(n=>n.classList.remove('on'));
  /* 현재 메인뷰 기준으로 탭 복원 */
  const activeMain=document.querySelector('.main-view.show');
  if(activeMain&&activeMain.id==='vMap'){
    document.querySelector('.nitem[data-v="map"]').classList.add('on');
  } else {
    document.querySelector('.nitem[data-v="today"]').classList.add('on');
  }
}

/* ═══ 관계 온도 지수 (Relationship Health Score) ════════════════
   최대 100점 = 접촉 신선도(50) + 소개 기여도(30) + 파이프라인 활력(20)
════════════════════════════════════════════════════════════════ */
function calcRelationshipTemp(p){
  let freshScore=0, referScore=0, pipeScore=0;

  /* 1) 접촉 신선도 (최대 50점) */
  const d=ago(p.lastContact);
  const thr=getPersonThr(p);
  if(d===null){
    freshScore=0;
  } else if(d===0){
    freshScore=50;
  } else if(d<=thr*0.5){
    freshScore=Math.round(50*(1-d/(thr*0.5))*0.3+35);  // 35~50
  } else if(d<=thr){
    freshScore=Math.round(35*(1-(d-thr*0.5)/(thr*0.5))); // 0~35
  } else {
    freshScore=0;
  }

  /* 2) 소개 기여도 (최대 30점) */
  const rcN=rc(p.id);
  referScore=Math.min(30, rcN*10);

  /* 3) 파이프라인 활력 (최대 20점) */
  if(p.pipeline){
    const pl=ensurePipeline(p);
    const done=pl.dates.filter(Boolean).length;
    const hist=pl.history||[];
    /* 최근 90일 내 활동이 있으면 활력 인정 */
    const recentActivity=hist.filter(h=>{
      if(!h.date) return false;
      return ago(h.date)<=90;
    }).length;
    pipeScore=Math.min(20, done*3 + recentActivity*2);
  }

  const total=freshScore+referScore+pipeScore;
  let emoji='',label='',color='';
  if(total>=80){    emoji='🔥🔥🔥'; label='매우 좋음'; color='#E85A00'; }
  else if(total>=60){emoji='🔥🔥';  label='좋음';     color='#D97706'; }
  else if(total>=40){emoji='🌡';    label='보통';     color='#1A6FD4'; }
  else if(total>=20){emoji='❄';    label='식어가는 중'; color='#9333EA'; }
  else{              emoji='🥶';    label='위험';     color='#DC2626'; }

  return {total,freshScore,referScore,pipeScore,emoji,label,color};
}

function renderTempHTML(t){
  return `<div class="temp-box">
    <div class="temp-row">
      <span class="temp-emoji">${t.emoji}</span>
      <div class="temp-info">
        <div class="temp-label">관계 온도 <span style="color:${t.color};font-weight:700">${t.label}</span></div>
        <div class="temp-score-row">
          <span title="접촉 신선도">접촉 ${t.freshScore}/50</span>
          <span title="소개 기여도">소개 ${t.referScore}/30</span>
          <span title="파이프라인 활력">활동 ${t.pipeScore}/20</span>
        </div>
      </div>
      <div class="temp-total" style="color:${t.color}">${t.total}</div>
    </div>
    <div class="temp-bar-wrap">
      <div class="temp-bar-fill" style="width:${t.total}%;background:${t.color}"></div>
    </div>
  </div>`;
}

/* ═══ 소개 성공률 계산 ══════════════════════════════════════════
   정의: 기존 고객(customer) 중 소개를 1명 이상 받은 비율
   = (rc(id)>=1 인 customer 수) / (전체 customer 수) × 100
═══════════════════════════════════════════════════════════════ */
function calcSuccessRate(){
  const customers=D.people.filter(p=>p.rel==='customer');
  if(!customers.length) return null;
  const withRef=customers.filter(p=>rc(p.id)>=1).length;
  return Math.round(withRef/customers.length*100);
}

/* ─── 첫 실행 온보딩 ─── */
/* ═══ 온보딩 튜토리얼 ══════════════════════════════════════════ */
function checkOnboard(){
  const seen = localStorage.getItem('lm_onboard_seen');
  if(!seen && D.people.length === 0){
    document.getElementById('onboardOverlay').style.display = 'flex';
    obGoTo(1);
  } else {
    document.getElementById('onboardOverlay').style.display = 'none';
  }
}
function obGoTo(n){
  [1,2,3].forEach(i=>{
    const el = document.getElementById('obSlide'+i);
    if(el) el.classList.toggle('hide', i!==n);
  });
}
function skipOnboard(){
  document.getElementById('onboardOverlay').style.display = 'none';
  localStorage.setItem('lm_onboard_seen','1');
  openForm();
}
function closeOnboard(){ skipOnboard(); }
function startWithSample(){
  document.getElementById('onboardOverlay').style.display = 'none';
  localStorage.setItem('lm_onboard_seen','1');
  loadSample();
}

/* ═══ 통계 갱신 ═════════════════════════════════════════════════ */
function refresh(){
  /* 통계 바 제거됨 — 레이아웃만 갱신 */
  relayout();
  document.getElementById('cvHint').style.display=D.people.length?'none':'flex';
  renderTodayDash();
  renderList(); renderAlerts();
}

/* ═══ 소개 예측 점수 (Referral Prediction Score) ══════════════
   "이 고객이 30일 안에 소개해줄 확률"을 0~100%로 계산
   ─────────────────────────────────────────────────────────────
   변수 5개:
   1) 파이프라인 완료 여부 (+35)  : 보험가입까지 완료 → 소개 요청 적기
   2) 최근 접촉 신선도 (+25)     : 최근 접촉일수록 관계 온기 있음
   3) 소개 이력 (+20)            : 과거에 소개한 사람은 또 소개함
   4) 접촉 빈도 추세 (+15)       : 최근 3개월 접촉이 그 전보다 잦으면 상승
   5) 관계 유형 보정 (×0.7~1.0)  : 기존 고객 > 지인 > 신규
════════════════════════════════════════════════════════════════ */
function calcReferralScore(p){
  let score = 0;
  const details = {};

  /* 1) 파이프라인 완료 */
  if(p.pipeline){
    const pl = ensurePipeline(p);
    const done = pl.dates.filter(Boolean).length;
    if(done >= 4){       // 보험가입 완료
      score += 35; details.pipeline = 35;
    } else if(done >= 2){
      score += 15; details.pipeline = 15;
    } else {
      details.pipeline = 0;
    }
  } else { details.pipeline = 0; }

  /* 2) 최근 접촉 신선도 */
  const d = ago(p.lastContact);
  if(d === null){
    details.fresh = 0;
  } else if(d <= 7){
    score += 25; details.fresh = 25;
  } else if(d <= 14){
    score += 18; details.fresh = 18;
  } else if(d <= 30){
    score += 10; details.fresh = 10;
  } else {
    details.fresh = 0;
  }

  /* 3) 소개 이력 */
  const refCount = rc(p.id);
  if(refCount >= 3){
    score += 20; details.history = 20;
  } else if(refCount >= 1){
    score += 12; details.history = 12;
  } else {
    details.history = 0;
  }

  /* 4) 접촉 빈도 추세 (contactLog 활용) */
  const log = p.contactLog || [];
  const now = Date.now();
  const recent90  = log.filter(l => ago(l.date) !== null && ago(l.date) <= 90).length;
  const prev90    = log.filter(l => { const a=ago(l.date); return a!==null && a>90 && a<=180; }).length;
  if(recent90 > prev90 && recent90 >= 2){
    score += 15; details.trend = 15;
  } else if(recent90 >= 1){
    score += 7; details.trend = 7;
  } else {
    details.trend = 0;
  }

  /* 5) 관계 유형 보정 */
  const mult = p.rel==='customer' ? 1.0 : p.rel==='friend' ? 0.85 : 0.7;
  score = Math.round(score * mult);
  score = Math.min(98, Math.max(0, score));

  /* 레벨 분류 */
  let level, color, emoji, msg;
  if(score >= 70){
    level='high';   color='#15803D'; emoji='🔥';
    msg='소개 요청하기 딱 좋은 타이밍이에요';
  } else if(score >= 45){
    level='mid';    color='#D97706'; emoji='✨';
    msg='연락하면 소개로 이어질 가능성이 높아요';
  } else if(score >= 20){
    level='low';    color='#1A6FD4'; emoji='💬';
    msg='먼저 관계를 더 쌓아보세요';
  } else {
    level='cold';   color='#9C8878'; emoji='❄️';
    msg='접촉 기록을 쌓으면 예측이 정확해져요';
  }

  return { score, level, color, emoji, msg, details };
}

/* 오늘 연락 1순위를 선정하는 함수 */
function pickTodayHero(){
  /* 기존 고객 + 지인 중 소개 예측 점수 상위 1명 */
  const candidates = D.people
    .filter(p => p.rel==='customer' || p.rel==='friend')
    .map(p => ({ p, rs: calcReferralScore(p), temp: calcRelationshipTemp(p) }))
    .filter(x => x.rs.score >= 20)   /* 너무 낮으면 제외 */
    .sort((a,b) => b.rs.score - a.rs.score);

  return candidates[0] || null;
}

/* ─── 오늘 할 일 풀뷰 렌더링 (전면 재작성) ─── */
function renderTodayFull(){
  /* 날짜 헤더 */
  const hdrEl = document.getElementById('todayDateHdr');
  if(hdrEl){
    const now = new Date();
    const DOW = ['일','월','화','수','목','금','토'];
    hdrEl.innerHTML = `
      <div class="today-date-main">${now.getMonth()+1}월 ${now.getDate()}일 (${DOW[now.getDay()]})</div>
      <div class="today-date-sub">${D.people.length ? '오늘 챙길 분을 확인하세요' : '먼저 인맥을 추가해보세요'}</div>`;
  }

  renderTodayHero();
  renderTodayList();
}

/* ═══ 오늘 할 일 — 관리 목적 / 기회 발굴 2섹션 ════════════════

   관리 목적  : 관계온도가 낮거나 오래 연락 못 한 사람 → 먼저 챙겨야 할 분
   기회 발굴  : 파이프라인 완료 직후, 소개 이력 있음, 최근 접촉 후 온도 높음
               → 소개 요청하기 좋은 타이밍인 분

   공통 원칙  : 숫자(% · 점수)는 보여주지 않음, 이유만 한 줄로 표시
════════════════════════════════════════════════════════════════ */

/* 사람별 오늘의 역할 분류 */
function classifyPerson(p){
  const temp = calcRelationshipTemp(p);
  const rs   = calcReferralScore(p);
  const d    = ago(p.lastContact);
  const pl   = ensurePipeline(p);
  const pipelineDone = pl.dates.filter(Boolean).length;

  /* ── 기회 발굴 조건 (우선 판단) ─────────────────────────────
     1) 파이프라인 4단계(보험가입) 방금 완료 → 소개 요청 타이밍
     2) 소개 이력 1건 이상 + 최근 14일 이내 연락 → 다시 소개 요청 가능
     3) 관계온도 높고(60+) 소개예측 점수 높음(50+) → 지금이 적기
  ──────────────────────────────────────────────────────────── */
  if(pipelineDone >= 4 && rs.score >= 40){
    let reason = '';
    if(pipelineDone === 4) reason = '보험가입 완료 — 소개 요청 드리기 좋은 시점이에요';
    else if(pipelineDone === 5) reason = '지인소개까지 완료 — 추가 소개를 부탁해보세요';
    else reason = '영업 진행이 잘 되고 있어요 — 소개 요청해보세요';
    return { type:'opportunity', reason };
  }

  if(rc(p.id) >= 1 && d !== null && d <= 14 && temp.total >= 50){
    return { type:'opportunity', reason: `최근 소개 이력 있음 — 다시 한번 부탁드려보세요` };
  }

  if(temp.total >= 65 && rs.score >= 50){
    return { type:'opportunity', reason: '관계가 좋을 때 소개 요청 드리면 성공률이 높아요' };
  }

  /* ── 관리 목적 조건 ─────────────────────────────────────────
     1) 관계온도 낮음(40 미만) → 식어가는 관계 복구 필요
     2) 오래 연락 안 함(기준일 초과) → 안부 연락 필요
     3) 접촉 기록 없음 → 첫 연락 필요
  ──────────────────────────────────────────────────────────── */
  const thr = getPersonThr(p);
  if(d === null){
    return { type:'manage', reason: '아직 한 번도 연락하지 않았어요 — 첫 연락을 드려보세요' };
  }
  if(temp.total < 35){
    return { type:'manage', reason: `${d}일째 연락이 없어요 — 관계가 식기 전에 안부를 물어보세요` };
  }
  if(d >= thr){
    return { type:'manage', reason: `마지막 연락이 ${d}일 전이에요 — 안부 연락 드릴 시간이에요` };
  }

  return null; // 오늘 챙길 필요 없음
}

/* 오늘 할 일 전체 렌더링 */
function renderTodayFull(){
  /* 날짜 헤더 */
  const hdrEl = document.getElementById('todayDateHdr');
  if(hdrEl){
    const now = new Date();
    const DOW = ['일','월','화','수','목','금','토'];
    hdrEl.innerHTML = `
      <div class="today-date-main">${now.getMonth()+1}월 ${now.getDate()}일 (${DOW[now.getDay()]})</div>
      <div class="today-date-sub">${D.people.length ? '오늘 챙길 분을 확인하세요' : '먼저 인맥을 추가해보세요'}</div>`;
  }

  const heroBox = document.getElementById('todayHero');
  const dashBox = document.getElementById('todayDash');
  if(heroBox) heroBox.innerHTML = '';
  if(!dashBox) return;

  if(!D.people.length){
    dashBox.innerHTML = `<div class="tl-empty">
      <div class="tl-empty-ic">👥</div>
      <div class="tl-empty-msg">아직 등록된 인맥이 없어요</div>
      <button class="btn btn-primary" onclick="openForm()" style="margin:0 24px">＋ 인맥 추가하기</button>
    </div>`;
    return;
  }

  /* 분류 */
  const manage     = [];
  const opportunity = [];
  D.people.forEach(p => {
    if(p.rel==='prospect') return; // 신규 고객은 관리 목적만
    const cls = classifyPerson(p);
    if(!cls) return;
    if(cls.type === 'manage')      manage.push({ p, reason: cls.reason });
    if(cls.type === 'opportunity') opportunity.push({ p, reason: cls.reason });
  });

  /* 신규 고객은 관리 목적으로만 */
  D.people.filter(p=>p.rel==='prospect').forEach(p=>{
    const d = ago(p.lastContact);
    const thr = getPersonThr(p);
    if(d===null || d>=thr){
      manage.push({ p, reason: d===null ? '첫 연락을 드려보세요' : `${d}일 전 연락 — 팔로업이 필요해요` });
    }
  });

  /* 관리 목적: 관계온도 낮은 순 정렬 */
  manage.sort((a,b) => calcRelationshipTemp(a.p).total - calcRelationshipTemp(b.p).total);
  /* 기회 발굴: 소개예측 점수 높은 순 */
  opportunity.sort((a,b) => calcReferralScore(b.p).score - calcReferralScore(a.p).score);

  /* 오늘 일정 */
  const today = new Date().toISOString().slice(0,10);
  const todayScheds = (SCHEDS||[])
    .filter(s => s.date === today)
    .sort((a,b) => (a.time||'').localeCompare(b.time||''));

  let html = '';

  /* ── 기회 발굴 섹션 ── */
  if(opportunity.length){
    html += `<div class="tl-section">
      <div class="tl-section-hdr opp">
        <span class="tl-section-ic">🌟</span>
        <span class="tl-section-ttl">소개 요청하기 좋은 타이밍</span>
      </div>`;
    opportunity.slice(0,3).forEach(({p, reason})=>{
      const col = REL[p.rel].col;
      html += `<div class="tl-row" onclick="openDetail(${p.id})">
        <div class="tl-av" style="background:linear-gradient(135deg,${lighten(col)},${col})">${esc((p.name||'?').charAt(0))}</div>
        <div class="tl-info">
          <div class="tl-name">${esc(p.name)}<span class="pbadge" style="background:${col}22;color:${col};margin-left:6px">${REL[p.rel].sh}</span></div>
          <div class="tl-reason opp">${reason}</div>
        </div>
        <button class="tl-done opp" onclick="event.stopPropagation();markContact(${p.id});renderTodayFull()">연락완료</button>
      </div>`;
    });
    html += `</div>`;
  }

  /* ── 관리 목적 섹션 ── */
  if(manage.length){
    html += `<div class="tl-section">
      <div class="tl-section-hdr mgmt">
        <span class="tl-section-ic">📞</span>
        <span class="tl-section-ttl">먼저 안부를 챙겨야 할 분</span>
      </div>`;
    manage.slice(0,4).forEach(({p, reason})=>{
      const col = REL[p.rel].col;
      html += `<div class="tl-row" onclick="openDetail(${p.id})">
        <div class="tl-av" style="background:linear-gradient(135deg,${lighten(col)},${col})">${esc((p.name||'?').charAt(0))}</div>
        <div class="tl-info">
          <div class="tl-name">${esc(p.name)}<span class="pbadge" style="background:${col}22;color:${col};margin-left:6px">${REL[p.rel].sh}</span></div>
          <div class="tl-reason mgmt">${reason}</div>
        </div>
        <button class="tl-done mgmt" onclick="event.stopPropagation();markContact(${p.id});renderTodayFull()">연락완료</button>
      </div>`;
    });
    html += `</div>`;
  }

  /* ── 오늘 일정 ── */
  if(todayScheds.length){
    html += `<div class="tl-section">
      <div class="tl-section-hdr sched">
        <span class="tl-section-ic">📅</span>
        <span class="tl-section-ttl">오늘 일정</span>
      </div>`;
    todayScheds.slice(0,3).forEach(s=>{
      const person = s.personId ? D.people.find(p=>p.id===s.personId) : null;
      html += `<div class="tl-row" onclick="document.querySelector('.nitem[data-v=cal]').click()">
        <div class="tl-time">${s.time||'—'}</div>
        <div class="tl-info">
          <div class="tl-name">${esc(s.title)}</div>
          ${person?`<div class="tl-reason">${esc(person.name)}님과의 일정</div>`:''}
        </div>
        <span class="tl-arr">›</span>
      </div>`;
    });
    html += `</div>`;
  }

  /* ── 할 일 없을 때 ── */
  if(!manage.length && !opportunity.length && !todayScheds.length){
    html = `<div class="tl-empty">
      <div class="tl-empty-ic">🎉</div>
      <div class="tl-empty-msg">오늘은 모두 잘 관리되고 있어요!</div>
    </div>`;
  }

  dashBox.innerHTML = html;
}

/* renderTodayHero는 renderTodayFull로 통합됨 */
function renderTodayHero(){}

/* 나머지 할 일 목록 */
function renderTodayList(){}

function renderTodayDash(){
  const activeTab = document.querySelector('.nitem.on');
  if(activeTab && activeTab.dataset.v==='today') renderTodayFull();
}

function renderTempSummary(){}

/* ─── 고객 유형별 기본 알림 주기 ─── */
const DEFAULT_THR = { customer:30, friend:15, prospect:7 };

function getPersonThr(p){
  /* 개인 설정이 있으면 우선, 없으면 유형별 기본값 */
  return p.alertDays ?? DEFAULT_THR[p.rel] ?? alertThreshold;
}

/* ═══ 내보내기 / 가져오기 ════════════════════════════════════════ */
document.getElementById('btnExport').addEventListener('click',()=>{
  if(!D.people.length){toast('내보낼 데이터가 없습니다','ℹ');return;}
  openSheet('shExport');
});

/* ═══ 레이어5 — 내보내기 보안 헬퍼 ═════════════════════════════
   1) 내보내기 전 보안 경고 확인 팝업
   2) 메모 포함 여부 선택 (민감정보 선택적 제외)
   3) 파일명에 날짜 자동 포함 (내부 관리용 식별)
════════════════════════════════════════════════════════════════ */

/** 내보내기 공통 보안 확인 — false면 중단 */
function confirmExport(format){
  return confirm(
    `📤 ${format} 내보내기\n\n`+
    `⚠ 보안 주의사항\n`+
    `• 파일에 이름·지역·메모가 포함됩니다\n`+
    `• 개인 PC의 안전한 환경에서만 내보내세요\n`+
    `• 이메일·메신저로 파일을 공유하지 마세요\n`+
    `• 사용 후 파일을 즉시 삭제하는 것을 권장합니다\n\n`+
    `계속 진행하시겠습니까?`
  );
}

/** 메모 포함 여부 확인 — true면 포함 */
function confirmIncludeMemo(){
  return confirm(
    `📝 메모 포함 여부\n\n`+
    `메모 항목을 파일에 포함할까요?\n\n`+
    `[확인] 포함 — 메모 내용이 그대로 저장됩니다\n`+
    `[취소] 제외 — 메모를 "(제외됨)"으로 마스킹합니다\n\n`+
    `민감한 내용이 메모에 있다면 "취소"를 권장합니다`
  );
}

/* ─── Excel 내보내기 (순수 JS, 외부 라이브러리 없음) ─── */
document.getElementById('btnExportExcel').addEventListener('click',()=>{
  closeSheet();
  /* 레이어5: 보안 확인 */
  if(!confirmExport('Excel')) return;
  const includeMemo = confirmIncludeMemo();

  const today = new Date().toISOString().slice(0,10);
  const rows = [
    ['이름/별칭','관계유형','활동지역','소개해준사람','최근접촉일','경과일수','메모','소개수','허브여부']
  ];
  D.people.forEach(p=>{
    const refP = p.ref ? D.people.find(x=>x.id===p.ref) : null;
    const days = ago(p.lastContact);
    rows.push([
      p.name||'',
      REL[p.rel]?.lbl||'',
      p.region||'',
      refP?refP.name:'직접 인맥',
      p.lastContact||'',
      days!==null?days:'',
      includeMemo ? (p.memo||'') : '(제외됨)',   /* 레이어5: 선택적 마스킹 */
      rc(p.id),
      isHub(p.id)?'O':'',
    ]);
  });

  // XML 스프레드시트 형식 (xlsx 라이브러리 없이 Excel 열리는 XML)
  const escX = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const colWidths = [120,80,120,100,100,70,160,60,60];
  const colTags = colWidths.map(w=>`<Column ss:Width="${w}"/>`).join('');

  const xmlRows = rows.map((row,ri)=>{
    const cells = row.map((cell,ci)=>{
      const val = escX(cell);
      const isNum = ri>0 && (ci===5||ci===7) && val!=='';
      return isNum
        ? `<Cell><Data ss:Type="Number">${val}</Data></Cell>`
        : `<Cell><Data ss:Type="String">${val}</Data></Cell>`;
    }).join('');
    const style = ri===0 ? ' ss:StyleID="Header"' : '';
    return `<Row${style}>${cells}</Row>`;
  }).join('');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Styles>
  <Style ss:ID="Header">
    <Font ss:Bold="1" ss:Color="#FFFFFF"/>
    <Interior ss:Color="#E85A00" ss:Pattern="Solid"/>
    <Alignment ss:Horizontal="Center"/>
  </Style>
</Styles>
<Worksheet ss:Name="LinkMap 인맥">
<Table>${colTags}${xmlRows}</Table>
</Worksheet>
</Workbook>`;

  const blob = new Blob(['﻿'+xml], {type:'application/vnd.ms-excel;charset=UTF-8'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `LinkMap_인맥_${today}.xls`;
  a.click();
  toast('Excel 저장 완료','📊');
});

/* ─── PDF 내보내기 (브라우저 print API) ─── */
document.getElementById('btnExportPdf').addEventListener('click',()=>{
  closeSheet();
  /* 레이어5: 보안 확인 */
  if(!confirmExport('PDF')) return;
  const includeMemo = confirmIncludeMemo();

  const today = new Date().toISOString().slice(0,10);

  const tableRows = D.people.map((p,i)=>{
    const refP = p.ref ? D.people.find(x=>x.id===p.ref) : null;
    const days = ago(p.lastContact);
    const colDot = {'customer':'#1A6FD4','friend':'#15803D','prospect':'#C05C00'}[p.rel]||'#999';
    const memoCell = includeMemo ? (p.memo||'') : '<span style="color:#9C8878;font-style:italic">(제외됨)</span>';
    return `<tr style="${i%2===0?'background:#FFF8F4':''}">
      <td>${i+1}</td>
      <td><b>${p.name||''}</b>${isHub(p.id)?' ⭐':''}</td>
      <td><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${colDot};margin-right:5px;vertical-align:middle"></span>${REL[p.rel]?.lbl||''}</td>
      <td>${p.region||'—'}</td>
      <td>${refP?refP.name:'직접 인맥'}</td>
      <td>${p.lastContact||'—'}</td>
      <td style="color:${days!==null&&days>=90?'#DC2626':days!==null&&days>=45?'#D97706':'inherit'};font-weight:${days!==null&&days>=45?'700':'400'}">${days!==null?days+'일':'-'}</td>
      <td style="text-align:center;font-weight:700;color:#E85A00">${rc(p.id)}</td>
      <td>${memoCell}</td>
    </tr>`;
  }).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>LinkMap 인맥 목록 — ${today}</title>
<style>
  @page{size:A4 landscape;margin:15mm}
  body{font-family:'Apple SD Gothic Neo','Malgun Gothic',sans-serif;font-size:11px;color:#1C1410}
  h1{font-size:18px;color:#E85A00;margin:0 0 4px}
  .sub{font-size:11px;color:#9C8878;margin-bottom:16px}
  table{width:100%;border-collapse:collapse;font-size:10.5px}
  th{background:#E85A00;color:#fff;padding:7px 6px;text-align:left;white-space:nowrap}
  td{padding:6px 6px;border-bottom:1px solid #E4D9D0;vertical-align:top}
  .foot{margin-top:12px;font-size:10px;color:#9C8878}
  .warn{background:#FEF2F2;border:1px solid #FECACA;border-radius:6px;padding:8px 12px;margin-bottom:12px;font-size:11px;color:#DC2626}
</style></head><body>
<h1>🔗 LinkMap — 인맥 목록</h1>
<div class="sub">출력일: ${today} &nbsp;|&nbsp; 총 ${D.people.length}명${includeMemo?'':' &nbsp;|&nbsp; 메모 제외됨'}</div>
<div class="warn">⚠ 본 문서는 내부 영업관리 전용 자료입니다. 외부 유출을 금지합니다. 사용 후 즉시 파기하세요.</div>
<table>
<thead><tr><th>#</th><th>이름/별칭</th><th>관계유형</th><th>활동지역</th><th>소개해준사람</th><th>최근접촉일</th><th>경과일</th><th>소개수</th><th>메모</th></tr></thead>
<tbody>${tableRows}</tbody>
</table>
</body></html>`;

  const w = window.open('','_blank','width=900,height=650');
  w.document.write(html);
  w.document.close();
  setTimeout(()=>{ w.print(); }, 600);
  toast('PDF 인쇄 창 열림','📄');
});

/* ─── JSON 백업 (복원용) ─── */
document.getElementById('btnExportJson').addEventListener('click',()=>{
  closeSheet();
  /* 레이어5: 보안 확인 */
  if(!confirmExport('JSON 백업')) return;

  /* JSON 백업은 평문으로 저장 (복원 목적 — 암호화 키 없이도 복원 가능해야 함)
     단, 파일 자체는 안전한 곳(카카오 나에게 전송 등)에 보관 권장 */
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([JSON.stringify(D,null,2)],{type:'application/json'}));
  a.download=`LinkMap_백업_${new Date().toISOString().slice(0,10)}.json`; a.click();
  localStorage.setItem('lm_last_backup', new Date().toISOString().slice(0,10));
  toast('JSON 백업 완료 — 안전한 곳에 보관하세요','💾');
});
document.getElementById('btnImport').addEventListener('click',()=>document.getElementById('fileIn').click());
document.getElementById('fileIn').addEventListener('change',e=>{
  const f=e.target.files[0]; if(!f) return;
  const r=new FileReader();
  r.onload=ev=>{try{const imp=JSON.parse(ev.target.result);if(!Array.isArray(imp.people))throw 0;if(D.people.length&&!confirm('현재 데이터를 덮어씁니다. 계속할까요?'))return;D=imp;if(!D.nid)D.nid=Math.max(0,...D.people.map(p=>p.id||0))+1;Object.keys(POS).forEach(k=>delete POS[k]);save();refresh();toast('복원 완료','⬆');}catch{toast('파일을 읽을 수 없습니다','⚠');}};
  r.readAsText(f); e.target.value='';
});

/* ═══ 설정 ══════════════════════════════════════════════════════ */
document.getElementById('btnSetting').addEventListener('click',()=>{
  const hasPin=!!localStorage.getItem(pinKey());
  const c=prompt(`설정\n\n1. 샘플 데이터 불러오기\n2. 비밀번호 잠금 ${hasPin?'해제':'설정'}\n3. 전체 데이터 초기화`);
  if(c==='1') loadSample();
  else if(c==='2'){hasPin?clearPin():setupPin();}
  else if(c==='3'){if(confirm('모든 데이터를 삭제합니다. 되돌릴 수 없습니다.')){D={people:[],nid:1};Object.keys(POS).forEach(k=>delete POS[k]);save();refresh();toast('초기화 완료','🗑');}}
});
function loadSample(){
  if(D.people.length&&!confirm('샘플을 불러오면 현재 데이터를 덮어씁니다.'))return;
  const t=Date.now(),dago=n=>new Date(t-n*86400000).toISOString().slice(0,10);
  D={nid:12,people:[
    {id:1,name:'이정훈',rel:'customer',region:'성남시 분당구',ref:null,lastContact:dago(125),memo:'자영업, 자녀 2명'},
    {id:2,name:'박서연',rel:'customer',region:'성남시 분당구',ref:1,lastContact:dago(18),memo:'이정훈 직장 동료'},
    {id:3,name:'최민호',rel:'customer',region:'용인시 수지구',ref:1,lastContact:dago(98),memo:''},
    {id:4,name:'헬스장 형',rel:'friend',region:'성남시 분당구',ref:null,lastContact:dago(8),memo:'운동 모임 지인'},
    {id:5,name:'김지아',rel:'customer',region:'성남시 분당구',ref:2,lastContact:dago(4),memo:'박서연 대학 친구'},
    {id:6,name:'정우성',rel:'prospect',region:'수원시 영통구',ref:2,lastContact:null,memo:'신규, 미팅 예정'},
    {id:7,name:'한소희',rel:'customer',region:'용인시 수지구',ref:3,lastContact:dago(55),memo:''},
    {id:8,name:'대학 후배',rel:'friend',region:'서울시 강남구',ref:4,lastContact:dago(25),memo:''},
    {id:9,name:'윤도현',rel:'prospect',region:'성남시 분당구',ref:5,lastContact:null,memo:'김지아 지인'},
    {id:10,name:'서지원',rel:'customer',region:'수원시 영통구',ref:7,lastContact:dago(155),memo:''},
    {id:11,name:'이하윤',rel:'customer',region:'성남시 분당구',ref:2,lastContact:dago(30),memo:''},
  ]};
  Object.keys(POS).forEach(k=>delete POS[k]); save(); refresh(); toast('샘플 로드 완료','✨');
}

/* ═══ 비밀번호 잠금 ══════════════════════════════════════════════ */
let pinIn='',pinMode='check',pinFirst='';
const hashP=s=>{let h=0;for(let i=0;i<s.length;i++){h=(h<<5)-h+s.charCodeAt(i);h|=0;}return String(h);};
function buildPad(){
  const pad=document.getElementById('ppad'); pad.innerHTML='';
  ['1','2','3','4','5','6','7','8','9','⌫','0','✓'].forEach(k=>{
    const b=document.createElement('button');
    b.className='pk'+(k==='⌫'||k==='✓'?' fn':''); b.textContent=k;
    b.addEventListener('click',()=>{
      if(k==='⌫'){pinIn=pinIn.slice(0,-1);drawDots();}
      else if(k==='✓'){submitPin();}
      else if(pinIn.length<4){pinIn+=k;drawDots();if(pinIn.length===4)setTimeout(submitPin,140);}
    });
    pad.appendChild(b);
  });
}
function drawDots(){const d=document.getElementById('pdots');d.innerHTML='';for(let i=0;i<4;i++){const s=document.createElement('div');s.className='pdot'+(i<pinIn.length?' on':'');d.appendChild(s);}}
function submitPin(){
  if(pinIn.length<4)return;
  const pk=pinKey();
  if(pinMode==='check'){
    if(hashP(pinIn)===localStorage.getItem(pk)) document.getElementById('lockScreen').classList.add('hide');
    else{pinIn='';drawDots();document.getElementById('lockD').textContent='비밀번호가 틀렸습니다. 다시 입력하세요.';}
  } else if(pinMode==='set'){
    pinFirst=pinIn;pinIn='';pinMode='confirm';drawDots();
    document.getElementById('lockT').textContent='비밀번호 확인';
    document.getElementById('lockD').textContent='같은 번호를 한 번 더 입력하세요';
  } else {
    if(pinIn===pinFirst){localStorage.setItem(pk,hashP(pinIn));document.getElementById('lockScreen').classList.add('hide');toast('비밀번호 잠금 설정됐습니다','🔐');}
    else{pinIn='';pinMode='set';pinFirst='';drawDots();document.getElementById('lockT').textContent='비밀번호 설정';document.getElementById('lockD').textContent='번호가 다릅니다. 다시 설정하세요.';}
  }
}
function setupPin(){pinMode='set';pinIn='';pinFirst='';document.getElementById('lockT').textContent='비밀번호 설정';document.getElementById('lockD').textContent='사용할 4자리 번호를 입력하세요';buildPad();drawDots();document.getElementById('lockScreen').classList.remove('hide');}
function clearPin(){if(confirm('비밀번호 잠금을 해제할까요?')){localStorage.removeItem(pinKey());toast('잠금이 해제됐습니다','🔓');}}
function checkLock(){if(!localStorage.getItem(pinKey()))return;pinMode='check';pinIn='';buildPad();drawDots();document.getElementById('lockT').textContent='잠금 해제';document.getElementById('lockD').textContent='4자리 비밀번호를 입력하세요';document.getElementById('lockScreen').classList.remove('hide');}

/* ═══ 웹 푸시 알림 ══════════════════════════════════════════════
   Service Worker + Notification API 사용
   GitHub Pages는 HTTPS이므로 SW 등록 가능
   iOS 16.4+ PWA 홈화면 추가 상태에서만 푸시 수신 가능
═══════════════════════════════════════════════════════════════ */
const PUSH_KEY='lm_push_'+( (()=>{try{return JSON.parse(localStorage.getItem(SESSION_KEY)||'{}').emp||'x';}catch{return 'x';}})() );

/* Service Worker 등록 */
async function registerSW(){
  if(!('serviceWorker' in navigator)) return null;
  try{
    const reg=await navigator.serviceWorker.register('sw.js',{scope:'./'});
    return reg;
  }catch(e){ console.warn('SW 등록 실패',e); return null; }
}

/* 알림 권한 요청 + SW 등록 */
async function requestPushPermission(){
  if(!('Notification' in window)){
    toast('이 브라우저는 알림을 지원하지 않습니다','⚠'); return;
  }
  if(Notification.permission==='granted'){
    toast('이미 알림이 허용되어 있습니다','🔔'); 
    localStorage.setItem(PUSH_KEY,'1');
    scheduleDailyCheck();
    return;
  }
  if(Notification.permission==='denied'){
    toast('브라우저 설정에서 알림을 허용해 주세요','⚠'); return;
  }
  const perm=await Notification.requestPermission();
  if(perm==='granted'){
    localStorage.setItem(PUSH_KEY,'1');
    await registerSW();
    scheduleDailyCheck();
    toast('알림이 설정됐습니다! 매일 연락 알림을 받습니다 🔔','✅');
  } else {
    toast('알림 허용을 거부하셨습니다','ℹ');
  }
}

/* 알림 전송 (SW 있으면 SW로, 없으면 Notification 직접) */
async function sendPushNotification(title, body, tag='linkmap'){
  if(Notification.permission!=='granted') return;
  const reg=('serviceWorker' in navigator)?await navigator.serviceWorker.getRegistration('./'):null;
  if(reg&&reg.showNotification){
    await reg.showNotification(title,{
      body, tag, icon:'icon-192.png', badge:'icon-192.png',
      data:{url:'./app.html'},
      vibrate:[200,100,200],
    });
  } else {
    const n=new Notification(title,{body,icon:'icon-192.png',tag});
    n.onclick=()=>{ window.focus(); n.close(); };
  }
}

/* 연락 필요 인원 체크 후 알림 발송 */
async function checkAndNotify(){
  if(Notification.permission!=='granted') return;
  if(!localStorage.getItem(PUSH_KEY)) return;
  const urgent=buildAlerts().filter(i=>i.lvl>=2);
  const warn  =buildAlerts().filter(i=>i.lvl===1);
  if(urgent.length){
    const names=urgent.slice(0,3).map(i=>i.p.name).join(', ');
    await sendPushNotification(
      `🚨 긴급 연락 필요 — ${urgent.length}명`,
      `${names}${urgent.length>3?` 외 ${urgent.length-3}명`:''}에게 오늘 바로 연락하세요!`
    );
  } else if(warn.length){
    const names=warn.slice(0,3).map(i=>i.p.name).join(', ');
    await sendPushNotification(
      `🔔 연락 알림 — ${warn.length}명`,
      `${names}${warn.length>3?` 외 ${warn.length-3}명`:''}에게 연락할 타이밍입니다`
    );
  }
}

/* 하루 한 번 체크 스케줄 (앱이 열려있는 동안) */
let _pushTimer=null;
function scheduleDailyCheck(){
  clearInterval(_pushTimer);
  // 즉시 한 번 체크
  setTimeout(checkAndNotify, 3000);
  // 이후 1시간마다 반복 체크 (앱 열린 동안)
  _pushTimer=setInterval(checkAndNotify, 60*60*1000);
}

/* 푸시 버튼 이벤트 */
document.getElementById('btnPush').addEventListener('click', async ()=>{
  const isOn=localStorage.getItem(PUSH_KEY)==='1'&&Notification.permission==='granted';
  if(isOn){
    if(confirm('푸시 알림을 끄시겠습니까?')){
      localStorage.removeItem(PUSH_KEY);
      clearInterval(_pushTimer);
      toast('알림이 꺼졌습니다','🔕');
      document.getElementById('btnPush').textContent='🔔';
    }
  } else {
    await requestPushPermission();
  }
  updatePushBtn();
});

function updatePushBtn(){
  const isOn=localStorage.getItem(PUSH_KEY)==='1'&&Notification.permission==='granted';
  const btn=document.getElementById('btnPush');
  btn.textContent = isOn ? '🔕' : '🔔';
  btn.title       = isOn ? '푸시 알림 끄기' : '푸시 알림 설정';
  btn.style.background = isOn ? 'var(--brand)' : '';
  btn.style.color      = isOn ? '#fff' : '';
}

/* ═══ 초기화 ════════════════════════════════════════════════════ */
async function init(){
  try{
    const s=localStorage.getItem(SESSION_KEY);
    if(!s){window.location.href='index.html';return;}
    user=JSON.parse(s);
  }catch(e){window.location.href='index.html';return;}
  await load();
  await loadScheds();
  resize(); relayout(); loop(); checkLock();
  refresh();
  checkOnboard();
  window.addEventListener('resize',resize);
  registerSW();
  updatePushBtn();
  if(localStorage.getItem(PUSH_KEY)==='1'&&Notification.permission==='granted'){
    scheduleDailyCheck();
  }
  checkBackupReminder();
  /* 첫 화면 = 오늘 할 일 */
  showMainView('vToday');
  renderTodayFull();
}

function checkBackupReminder(){
  const last=localStorage.getItem('lm_last_backup');
  if(!last) return;
  const daysSince=Math.floor((Date.now()-new Date(last))/86400000);
  if(daysSince>=30){
    setTimeout(()=>toast(`마지막 백업이 ${daysSince}일 전입니다 — ⬇ 버튼으로 백업하세요`,'💾'),3000);
  }
}

init();

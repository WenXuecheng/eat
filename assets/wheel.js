// Standalone Custom Wheel (independent from search module)
(function(){
  if (window.__cw_initialized) return; // prevent double init
  const els = {
    canvas: document.getElementById('cw-canvas'),
    spin: document.getElementById('cw-spin'),
    reset: document.getElementById('cw-reset'),
    add: document.getElementById('cw-add'),
    tbody: document.getElementById('cw-tbody'),
    result: document.getElementById('cw-result'),
  };
  if (!els.canvas || !els.tbody) return;
  window.__cw_initialized = true;

  const COLORS = ['#4f8cff','#3ecf8e','#ffcc66','#ff6b6b','#a78bfa','#22d3ee','#f97316','#10b981','#93c5fd','#fde047'];
  const STORE = 'custom_wheel_items_v1';
  const state = { items: [], angle: 0, spinning: false };

  function load(){
    try { const raw = localStorage.getItem(STORE); if (raw) { const a = JSON.parse(raw); if (Array.isArray(a)) return a; } } catch {}
    return [
      { color: '#4f8cff', text: '选项1' }, { color: '#3ecf8e', text: '选项2' },
      { color: '#ffcc66', text: '选项3' }, { color: '#ff6b6b', text: '选项4' },
      { color: '#a78bfa', text: '选项5' }, { color: '#22d3ee', text: '选项6' },
      { color: '#f97316', text: '选项7' }, { color: '#10b981', text: '选项8' }
    ];
  }
  function save(){ try { localStorage.setItem(STORE, JSON.stringify(state.items)); } catch {} }

  function rebuildTable(){
    els.tbody.innerHTML = '';
    state.items.forEach((it, idx) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><input type="color" value="${it.color}"></td>
        <td><input type="text" value="${escapeHtml(it.text)}" placeholder="输入文本"></td>
        <td>
          <div class="actions">
            <button class="rb-btn rb-btn-ghost" data-act="up">上移</button>
            <button class="rb-btn rb-btn-ghost" data-act="down">下移</button>
            <button class="rb-btn rb-btn-outline" data-act="del">删除</button>
          </div>
        </td>`;
      const inputs = tr.querySelectorAll('input');
      inputs[0].addEventListener('change', (e)=>{ state.items[idx].color = e.target.value; draw(); save(); });
      inputs[1].addEventListener('input', (e)=>{ state.items[idx].text = e.target.value; draw(); save(); });
      tr.querySelector('.actions').addEventListener('click', (e)=>{
        const btn = e.target.closest('button'); if (!btn) return; const act = btn.getAttribute('data-act');
        if (act === 'del') state.items.splice(idx,1);
        if (act === 'up' && idx>0) { const t=state.items[idx-1]; state.items[idx-1]=state.items[idx]; state.items[idx]=t; }
        if (act === 'down' && idx<state.items.length-1) { const t=state.items[idx+1]; state.items[idx+1]=state.items[idx]; state.items[idx]=t; }
        rebuildTable(); draw(); save();
      });
      els.tbody.appendChild(tr);
    });
  }

  function draw(){
    const cv = els.canvas; const ctx = cv.getContext('2d');
    const W = cv.width, H = cv.height, cx=W/2, cy=H/2, r=Math.min(cx,cy)-6;
    ctx.clearRect(0,0,W,H);
    const n = Math.max(1, state.items.length), a = Math.PI*2/n;
    ctx.save(); ctx.translate(cx,cy); ctx.rotate(state.angle);
    for (let i=0;i<n;i++){
      const it = state.items[i]; const start=i*a, end=start+a;
      ctx.beginPath(); ctx.moveTo(0,0); ctx.arc(0,0,r,start,end); ctx.closePath();
      ctx.fillStyle = it.color || COLORS[i%COLORS.length]; ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 2; ctx.stroke();
      const mid=(start+end)/2; ctx.save(); ctx.rotate(mid);
      ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillStyle='#fff'; ctx.font='16px ui-sans-serif, system-ui, -apple-system, Segoe UI';
      const label = (it.text||'').trim() || `#${i+1}`; ctx.translate(r*0.6,0);
      wrapFillText(ctx,label,0,0,r*0.6,18); ctx.restore();
    }
    ctx.beginPath(); ctx.arc(0,0,r*0.15,0,Math.PI*2); ctx.fillStyle='rgba(0,0,0,0.35)'; ctx.fill(); ctx.restore();
  }
  function wrapFillText(ctx, text, x, y, maxWidth, lineHeight){
    const chars = text.split(''); let line='', lines=[];
    for (const ch of chars){ const test=line+ch; if (ctx.measureText(test).width>maxWidth && line){ lines.push(line); line=ch; } else { line=test; } }
    if (line) lines.push(line); const total=lines.length*lineHeight; let yy=y-total/2+lineHeight/2; for (const l of lines){ ctx.fillText(l,x,yy); yy+=lineHeight; }
  }
  function easeOutCubic(t){ return 1 - Math.pow(1-t,3); }
  function spin(){
    if (state.spinning || !state.items.length) return; state.spinning=true; setResult('抽取中…');
    const n = state.items.length, seg = Math.PI*2/n; const idx = Math.floor(Math.random()*n);
    const segCenter = idx*seg + seg/2; const current = state.angle % (Math.PI*2);
    const baseTarget = -Math.PI/2 - segCenter; let delta = ((baseTarget - current) % (Math.PI*2) + Math.PI*2) % (Math.PI*2);
    const total = delta + 5*(Math.PI*2); const duration=6000; const start=performance.now();
    function step(ts){ const t=Math.min(1,(ts-start)/duration); const k=easeOutCubic(t); state.angle=current+total*k; draw(); if(t<1) requestAnimationFrame(step); else { state.spinning=false; const chosen=state.items[idx]; setResult('结果：'+(chosen.text||`#${idx+1}`)); } }
    requestAnimationFrame(step);
  }
  function setResult(value){
    if (!els.result) return;
    const safe = escapeHtml(value);
    els.result.innerHTML = '结果：<span class="cw-value">' + safe + '</span>';
    // pop animation
    els.result.classList.remove('cw-pop');
    void els.result.offsetWidth;
    els.result.classList.add('cw-pop');
  }
  function escapeHtml(s){ const str=(s==null)?'':String(s); return str.replace(/[&<>\"]/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

  // init
  state.items = load(); rebuildTable(); draw(); setResult('—');
  els.spin && els.spin.addEventListener('click', spin);
  els.reset && els.reset.addEventListener('click', ()=>{ state.items = load().slice(0,8); rebuildTable(); draw(); setResult('结果：—'); save(); });
  els.add && els.add.addEventListener('click', ()=>{ state.items.push({ color: COLORS[state.items.length%COLORS.length], text: '' }); rebuildTable(); draw(); save(); });
})();

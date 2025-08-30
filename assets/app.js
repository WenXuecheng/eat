/*
  2GIS Where-To-Eat Spinner
  - Uses 2GIS Maps API for the map layer.
  - Restaurant data source is pluggable. By default, a Demo Mode generates mock restaurants.
  - For real data, provide a 2GIS Directory API key by setting window.TWO_GIS_API_KEY.
  - Then implement loadRestaurants2GIS(center, radius) using JSONP to the 2GIS Catalog API.
*/

// Optional: provide your 2GIS Directory API key here or via devtools: window.TWO_GIS_API_KEY = '...'
// For debugging per user request, we set a temporary default key.
// NOTE: Remove/override this in production.
window.TWO_GIS_API_KEY = window.TWO_GIS_API_KEY || '63296a27-dfc8-48f6-837e-e332369cc356';

(function () {
  const els = {
    address: document.getElementById('address'),
    geolocate: document.getElementById('btn-geolocate'),
    apiKey: document.getElementById('apiKey'),
    saveKey: document.getElementById('btn-save-key'),
    keyword: document.getElementById('keyword'),
    search: document.getElementById('btn-search'),
    radius: document.getElementById('radius'),
    maxCount: document.getElementById('maxCount'),
    stats: document.getElementById('stats'),
    presetBtns: Array.from(document.querySelectorAll('[data-kw]')),
    wheel: document.getElementById('wheel'),
    spin: document.getElementById('btn-spin'),
    selection: document.getElementById('selection'),
    map: document.getElementById('map'),
  };

  let map, centerMarker, searchCircle;
  // Default to Moscow center like index 2.html. Address input defaults to "Moskva Dovatora 9".
  let currentCenter = { lat: 55.751244, lng: 37.618423 };
  let restaurants = []; // current result set
  let markers = [];
  const DEFAULT_RADIUS = 2000; // meters
  let lastSearchTotal = null; // API reported total results if available

  // Spinner state
  const ctx = els.wheel.getContext('2d');
  let spinState = {
    spinning: false,
    rotation: 0,
    target: 0,
    start: 0,
    startTime: 0,
    duration: 0,
    items: [],
  };

  // Colors palette for wheel segments
  const COLORS = [
    '#4f8cff', '#3ecf8e', '#ffcc66', '#ff6b6b', '#a78bfa', '#f59e0b', '#22d3ee', '#34d399',
    '#f472b6', '#60a5fa', '#f97316', '#10b981', '#e879f9', '#f43f5e', '#93c5fd', '#fde047'
  ];

  function initMap() {
    if (!window.DG) {
      console.error('2GIS DG object not found. Ensure the loader.js is available.');
      return;
    }
    DG.then(function () {
      map = DG.map('map', {
        center: [currentCenter.lat, currentCenter.lng],
        zoom: 14,
        fullscreenControl: false,
        zoomControl: true,
      });

      const yellowIcon = DG.divIcon({
        className: 'custom-yellow-icon',
        html: '<div style="width:18px;height:18px;background:#FFD700;border-radius:50%;border:3px solid #333;box-shadow:0 0 0 2px rgba(255,215,0,0.25)"></div>',
        iconSize: [18,18], iconAnchor: [9,9], popupAnchor: [0,-10]
      });
      centerMarker = DG.marker([currentCenter.lat, currentCenter.lng], { draggable: true, icon: yellowIcon, title: '中心点（可拖动）' }).addTo(map);
      centerMarker.on('dragend', () => {
        const ll = centerMarker.getLatLng();
        currentCenter = { lat: ll.lat, lng: ll.lng };
        // auto-refresh results on drag, like index 2.html
        handleSearch(currentCenter);
      });
    });
  }

  function useGeolocation() {
    // Geolocation requires a secure context (HTTPS) or localhost.
    if (!isSecureAllowed()) {
      alert('定位需要在 HTTPS 或 localhost 环境下运行。\n请用本地服务器访问（例如 http://localhost:3000）或部署到支持 HTTPS 的站点。\n我将尝试使用 IP 近似定位。');
      locateByIP();
      return;
    }
    if (!navigator.geolocation) {
      alert('当前浏览器不支持定位');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        currentCenter = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        DG.then(() => {
          map.setView([currentCenter.lat, currentCenter.lng], 15);
          centerMarker.setLatLng([currentCenter.lat, currentCenter.lng]);
        });
        // Fill address field by reverse geocoding
        reverseGeocode(currentCenter).then((addr) => {
          if (addr && els.address) els.address.value = addr;
        }).catch(() => {});
      },
      (err) => {
        console.warn('Geolocation error', err);
        let reason = '未知错误';
        if (err && typeof err.code === 'number') {
          if (err.code === 1) reason = '权限被拒绝（请在浏览器地址栏右侧允许定位权限）';
          else if (err.code === 2) reason = '位置不可用（请检查设备定位服务）';
          else if (err.code === 3) reason = '定位超时（网络或信号较差）';
        } else if (err && err.message) {
          reason = err.message;
        }
        alert('定位失败：' + reason + '\n我将尝试使用 IP 近似定位。');
        locateByIP();
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 }
    );
  }

  // Fallback: IP-based approximate location via ipapi.co JSONP
  function locateByIP() {
    // Use ipapi.co JSONP endpoint (HTTPS) for CORS-free fallback
    const url = 'https://ipapi.co/jsonp/';
    return jsonp(url, {}).then((data) => {
      const lat = data && (data.latitude || data.lat);
      const lng = data && (data.longitude || data.lon || data.lng);
      if (typeof lat === 'number' && typeof lng === 'number') {
        const ll = { lat, lng };
        currentCenter = ll;
        DG.then(() => {
          if (map && centerMarker) {
            map.setView([ll.lat, ll.lng], 13);
            centerMarker.setLatLng([ll.lat, ll.lng]);
          }
        });
        reverseGeocode(ll).then((addr) => {
          if (addr && els.address) els.address.value = addr;
        }).catch(() => {});
        return ll;
      } else {
        throw new Error('IP 定位返回无坐标');
      }
    }).catch((e) => {
      console.warn('IP 近似定位失败', e);
    });
  }

  // Load restaurants strictly via 2GIS (no demo fallback)
  async function loadRestaurants(center) {
    const key = (els.apiKey && els.apiKey.value ? els.apiKey.value : window.TWO_GIS_API_KEY) || '';
    if (!key) {
      alert('请先在页面中保存 2GIS API Key');
      return [];
    }
    const keyword = getQueryKeyword();
    try {
      const radius = getRadiusMeters();
      const limit = getMaxCount();
      const list = await loadRestaurants2GIS(center, radius, key, keyword);
      const finalList = Array.isArray(list) ? list.slice(0, limit) : [];
      // draw or update search circle
      drawSearchCircle(center, radius);
      if (els.stats) {
        els.stats.textContent = '结果：' + finalList.length + (lastSearchTotal != null ? (' / ' + lastSearchTotal) : '');
      }
      return finalList;
    } catch (e) {
      console.warn('2GIS 加载失败', e);
      alert('从 2GIS 获取数据失败，请检查关键词和 API Key');
      return [];
    }
  }

  // 2GIS Directory API: paginate nearby; fallback to keyword-only; no forced type filter
  function loadRestaurants2GIS(center, radiusMeters, apiKey, keyword) {
    const endpoint = 'https://catalog.api.2gis.com/3.0/items';
    const radius = String(Math.max(100, Math.min(3000, Math.floor(radiusMeters))));
    const qNearby = translateZhToRu(keyword) || 'restaurant';

    // Demo key limits; safe defaults even for paid keys
    const DEMO_PAGE_SIZE_MAX = 10;
    const DEMO_PAGE_MAX = 5;

    async function fetchPage(params) {
      const url = `${endpoint}?${params.toString()}`;
      // console.debug('2GIS GET', url);
      const res = await fetch(url, { mode: 'cors' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }

    async function nearbyPaginated() {
      const all = [];
      lastSearchTotal = null;
      for (let page = 1; page <= DEMO_PAGE_MAX; page++) {
        const p = new URLSearchParams({
          key: apiKey,
          q: qNearby,
          point: `${center.lng},${center.lat}`,
          radius,
          page: String(page),
          page_size: String(DEMO_PAGE_SIZE_MAX),
          fields: 'items.name,items.point,items.address,items.contact_groups,items.rating,items.links,items.external_content'
        });
        const data = await fetchPage(p);
        if (lastSearchTotal == null && data && data.result && typeof data.result.total === 'number') {
          lastSearchTotal = data.result.total;
        }
        const items = (data && data.result && data.result.items) || [];
        if (!items.length) break;
        all.push(...items);
        // If we know total and already have enough, we could break early
      }
      return all;
    }

    async function keywordOnly() {
      const rawKw = (els.keyword && els.keyword.value || '').trim();
      const addrText = (els.address && els.address.value || '').trim();
      const qOnly = [rawKw || keyword || 'food', addrText].filter(Boolean).join(' ');
      const p = new URLSearchParams({
        key: apiKey,
        q: qOnly,
        page: '1',
        page_size: String(DEMO_PAGE_SIZE_MAX),
        fields: 'items.name,items.point,items.address,items.contact_groups,items.rating,items.links,items.external_content'
      });
      const data = await fetchPage(p);
      if (data && data.result && typeof data.result.total === 'number') {
        lastSearchTotal = data.result.total;
      }
      return (data && data.result && data.result.items) || [];
    }

    // Try nearby first; if empty, fallback to keyword-only
    return nearbyPaginated()
      .then(async (items) => {
        if (items && items.length) return items.map(map2GisItem).filter(Boolean);
        const items2 = await keywordOnly();
        return items2.map(map2GisItem).filter(Boolean);
      })
      .catch(async () => {
        // Fallback to one-shot JSONP keyword-only if fetch/CORS fails
        const rawKw = (els.keyword && els.keyword.value || '').trim();
        const addrText = (els.address && els.address.value || '').trim();
        const qOnly = [rawKw || keyword || 'food', addrText].filter(Boolean).join(' ');
        const params = { key: apiKey, q: qOnly, page: '1', page_size: String(DEMO_PAGE_SIZE_MAX), fields: 'items.name,items.point,items.address,items.contact_groups,items.rating,items.links,items.external_content' };
        return jsonpPreferDG(endpoint, params).then((res) => {
          if (res && res.result && typeof res.result.total === 'number') {
            lastSearchTotal = res.result.total;
          }
          const items = (res && res.result && res.result.items) || [];
          return items.map(map2GisItem).filter(Boolean);
        });
      });
  }

  function getQueryKeyword() {
    const v = (els.keyword && els.keyword.value || '').trim();
    return v || '餐厅';
  }

  // Basic zh->ru keyword translation for 2GIS search
  function translateZhToRu(q) {
    if (!q) return '';
    // If already contains Cyrillic, assume Russian and return as-is
    if (/[\u0400-\u04FF]/.test(q)) return q;
    const dict = new Map([
      ['餐厅','ресторан'], ['饭店','ресторан'], ['美食','еда'], ['吃饭','еда'],
      ['咖啡','кафе'], ['茶','чай'], ['奶茶','чай с молоком'], ['甜品','десерт'],
      ['酒吧','бар'], ['啤酒','пиво'],
      ['酒店','отель'], ['宾馆','гостиница'],
      ['公园','парк'], ['商场','торговый центр'], ['超市','супермаркет'],
      ['火锅','хот-пот'], ['烤肉','гриль'], ['烧烤','барбекю'],
      ['披萨','пицца'], ['汉堡','гамбургер'], ['炸鸡','жареная курица'],
      ['面馆','лапша'], ['拉面','лапша'], ['米线','рисовая лапша'], ['小吃','закуски'],
      ['日料','японская кухня'], ['寿司','суши'], ['韩餐','корейская кухня'],
      ['川菜','сычуаньская кухня'], ['粤菜','кантонская кухня'], ['东北菜','маньчжурская кухня']
    ]);
    for (const [k, v] of dict.entries()) {
      if (q.includes(k)) return v;
    }
    // Fallback: try common English synonyms if user typed English
    const enDict = new Map([
      ['restaurant','ресторан'], ['cafe','кафе'], ['bar','бар'], ['hotel','отель'],
      ['park','парк'], ['mall','торговый центр'], ['supermarket','супермаркет'],
      ['pizza','пицца'], ['burger','гамбургер'], ['sushi','суши'], ['bbq','барбекю']
    ]);
    const low = q.toLowerCase();
    for (const [k, v] of enDict.entries()) {
      if (low.includes(k)) return v;
    }
    return q; // last resort: send as-is
  }

  function map2GisItem(it) {
    const point = it.point || (it.geometry && it.geometry.centroid);
    const lat = point ? (point.lat || point.latitude) : undefined;
    const lng = point ? (point.lon || point.lng || point.longitude) : undefined;
    if (typeof lat !== 'number' || typeof lng !== 'number') return null;
    const rating = it.rating && (it.rating.value || it.rating.rating || it.rating.total_rating || it.rating);
    const address = (it.address && (it.address.name || it.address.address_name || it.address.full_name)) || it.address_name || '';
    const phones = [];
    if (it.contact_groups && Array.isArray(it.contact_groups)) {
      it.contact_groups.forEach((g) => {
        (g.contacts || []).forEach((c) => { if (c.type === 'phone' && c.value) phones.push(String(c.value)); });
      });
    }
    const url = (it.links && (it.links.site_url || it.links.firm_card)) || (it.external_content && it.external_content.site_url) || '';
    return { id: String(it.id || it.hash || it.branch_id || Math.random()), name: it.name || '未命名', lat, lng, address, rating, url, phones };
  }

  // removed demo generators

  function updateMapMarkers(list) {
    // Clear old
    markers.forEach(m => map.removeLayer(m));
    markers = [];
    const bounds = [];
    list.forEach(item => {
      const marker = DG.marker([item.lat, item.lng]).addTo(map).bindPopup(`<b>${escapeHtml(item.name)}</b>`);
      markers.push(marker);
      bounds.push([item.lat, item.lng]);
    });
    if (bounds.length) {
      try { map.fitBounds(bounds, { padding: [30, 30] }); } catch {}
    }
  }

  function drawWheel(items) {
    const cw = Math.max(els.wheel.clientWidth, 1);
    const ch = Math.max(els.wheel.clientHeight, 1);
    const cx = cw / 2, cy = ch / 2;
    const r = Math.min(cx, cy) - 6;
    ctx.clearRect(0, 0, cw, ch);

    if (!items.length) {
      // Draw placeholder circle
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = '#2a3046';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = '#2a3046';
      ctx.textAlign = 'center';
      ctx.font = '14px system-ui, -apple-system, Segoe UI';
      ctx.fillText('请先搜索饭店', cx, cy);
      return;
    }

    const seg = (Math.PI * 2) / items.length;
    for (let i = 0; i < items.length; i++) {
      const start = spinState.rotation + i * seg;
      const end = start + seg;
      // slice
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, start, end);
      ctx.closePath();
      ctx.fillStyle = COLORS[i % COLORS.length];
      ctx.globalAlpha = 0.9;
      ctx.fill();
      ctx.globalAlpha = 1;

      // slice border
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, start, end);
      ctx.closePath();
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.stroke();

      // label outside the wheel for readability
      const mid = (start + end) / 2;
      const rx = cx + Math.cos(mid) * (r + 16);
      const ry = cy + Math.sin(mid) * (r + 16);
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#0e1320';
      ctx.font = 'bold 13px system-ui, -apple-system, Segoe UI';
      const label = truncate(items[i].name, 18);
      // optional guide line
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(mid) * r, cy + Math.sin(mid) * r);
      ctx.lineTo(rx, ry);
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(0,0,0,0.2)';
      ctx.stroke();
      // text
      drawTextWithShadowAt(ctx, label, rx, ry);
      ctx.restore();
    }

    // center hub
    ctx.beginPath();
    ctx.arc(cx, cy, 18, 0, Math.PI * 2);
    ctx.fillStyle = '#0e1320';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#4f8cff';
    ctx.stroke();
  }

  function drawTextWithShadow(ctx, text) {
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 2;
    ctx.fillText(text, 0, 0);
    ctx.shadowColor = 'transparent';
  }

  function drawTextWithShadowAt(ctx, text, x, y) {
    ctx.save();
    ctx.translate(x, y);
    drawTextWithShadow(ctx, text);
    ctx.restore();
  }

  function truncate(s, n) {
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"]+/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  }

  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

  function startSpin() {
    if (spinState.spinning || !spinState.items.length) return;
    // 4–6 full rotations + random offset
    const fullTurns = 4 + Math.floor(Math.random() * 3);
    const randomOffset = Math.random() * Math.PI * 2;
    spinState.start = spinState.rotation % (Math.PI * 2);
    spinState.target = spinState.start + fullTurns * Math.PI * 2 + randomOffset;
    spinState.startTime = performance.now();
    spinState.duration = 2500 + Math.random() * 1200; // ms
    spinState.spinning = true;
    els.spin.disabled = true;
    requestAnimationFrame(tickSpin);
  }

  function tickSpin(ts) {
    const t = Math.min(1, (ts - spinState.startTime) / spinState.duration);
    const k = easeOutCubic(t);
    spinState.rotation = spinState.start + (spinState.target - spinState.start) * k;
    drawWheel(spinState.items);
    if (t < 1) {
      requestAnimationFrame(tickSpin);
    } else {
      spinState.spinning = false;
      els.spin.disabled = false;
      onSpinEnd();
    }
  }

  function onSpinEnd() {
    const items = spinState.items;
    if (!items.length) return;
    const seg = (Math.PI * 2) / items.length;
    // pointer at angle 0 (upwards). Wheel rotation is clockwise drawing; selected index is reverse of rotation.
    const a = (Math.PI * 2 - (spinState.rotation % (Math.PI * 2))) % (Math.PI * 2);
    const idx = Math.floor(a / seg) % items.length;
    const chosen = items[idx];
    showSelection(chosen);
    // focus marker
    const m = markers[idx];
    if (m) { m.openPopup(); map.setView(m.getLatLng(), Math.max(map.getZoom(), 15)); }
  }

  function showSelection(item) {
    els.selection.classList.remove('hidden');
    els.selection.innerHTML = `
      <h3>结果：${escapeHtml(item.name)}</h3>
      <div class="row"><span class="muted">地址：</span><span>${escapeHtml(item.address || '暂无')}</span></div>
      <div class="row"><span class="muted">评分：</span><span>${item.rating ? escapeHtml(String(item.rating)) : '暂无'}</span></div>
      ${item.phones && item.phones.length ? `<div class="row"><span class="muted">电话：</span><span>${item.phones.map(escapeHtml).join(' / ')}</span></div>` : ''}
      ${item.url ? `<div class="row"><a href="${item.url}" target="_blank" rel="noopener">查看详情</a></div>` : ''}
    `;
  }

  async function handleSearch(centerOverride) {
    // If a center is provided (e.g., marker drag), skip address geocoding
    if (!centerOverride) {
      // Get center either from input address or current map marker
      const addr = (els.address.value || '').trim();
      if (addr) {
        try {
          const p = await geocodeAddress(addr);
          if (p) {
            currentCenter = p;
            DG.then(() => {
              map.setView([p.lat, p.lng], 15);
              centerMarker.setLatLng([p.lat, p.lng]);
            });
          }
        } catch (e) {
          alert('地址解析失败，请尝试更换写法或使用定位');
          console.warn('Geocode failed', e);
          return;
        }
      }
    } else {
      currentCenter = { lat: centerOverride.lat, lng: centerOverride.lng };
      DG.then(() => {
        map.setView([currentCenter.lat, currentCenter.lng], 15);
        centerMarker.setLatLng([currentCenter.lat, currentCenter.lng]);
      });
    }

    restaurants = await loadRestaurants(currentCenter);
    if (!restaurants.length) {
      if (els.stats) {
        els.stats.textContent = '结果：0' + (lastSearchTotal != null ? (' / ' + lastSearchTotal) : '');
      }
      alert('未找到符合关键词的地点，请更换关键词再试');
      return;
    }
    // Always show all results on the map, but only sample up to 12 for the wheel
    const MAX_WHEEL = 12;
    const wheelItems = sampleMax(restaurants, MAX_WHEEL);

    updateMapMarkers(restaurants);
    spinState.items = wheelItems;
    spinState.rotation = 0;
    drawWheel(wheelItems);
    els.spin.disabled = false;
  }

  // Prefer geocoding via 2GIS Catalog when API key is available; fallback to Nominatim
  async function geocodeAddress(address) {
    const key = (els.apiKey && els.apiKey.value ? els.apiKey.value : window.TWO_GIS_API_KEY) || '';
    if (key) {
      const endpoint = 'https://catalog.api.2gis.com/3.0/items';
      const p = new URLSearchParams({ key, q: address, fields: 'items.point,items.address' });
      const res = await fetch(`${endpoint}?${p.toString()}`, { mode: 'cors' });
      if (!res.ok) throw new Error('Geocode HTTP ' + res.status);
      const data = await res.json();
      const it = data && data.result && data.result.items && data.result.items[0];
      const point = it && it.point;
      if (point && typeof point.lat === 'number' && typeof point.lon === 'number') {
        return { lat: point.lat, lng: point.lon };
      }
      // If 2GIS returns nothing for the address, fall back to Nominatim below
    }
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('format', 'json');
    url.searchParams.set('q', address);
    url.searchParams.set('limit', '1');
    const res2 = await fetch(url.toString(), { headers: { 'Accept-Language': 'zh-CN' } });
    if (!res2.ok) throw new Error('Geocode HTTP ' + res2.status);
    const arr = await res2.json();
    if (!arr.length) return null;
    return { lat: parseFloat(arr[0].lat), lng: parseFloat(arr[0].lon) };
  }

  // Event bindings
  els.geolocate.addEventListener('click', useGeolocation);
  if (els.saveKey) {
    els.saveKey.addEventListener('click', () => {
      const v = (els.apiKey && els.apiKey.value || '').trim();
      window.TWO_GIS_API_KEY = v;
      try { localStorage.setItem('two_gis_api_key', v); } catch {}
      if (els.demo) els.demo.checked = false;
      alert('API Key 已保存（已关闭示例数据）');
    });
  }
  els.search.addEventListener('click', handleSearch);
  // Press Enter in keyword or address triggers search
  if (els.keyword) {
    els.keyword.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleSearch();
    });
  }
  if (els.address) {
    els.address.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleSearch();
    });
  }
  if (els.presetBtns && els.presetBtns.length) {
    els.presetBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const kw = btn.getAttribute('data-kw') || '';
        if (els.keyword) els.keyword.value = kw;
        handleSearch();
      });
    });
  }
  els.spin.addEventListener('click', startSpin);

  if (els.radius) {
    els.radius.addEventListener('change', () => handleSearch(currentCenter));
    els.radius.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleSearch(currentCenter); });
  }
  if (els.maxCount) {
    els.maxCount.addEventListener('change', () => handleSearch(currentCenter));
    els.maxCount.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleSearch(currentCenter); });
  }

  // Initial draw
  // Prefill saved key
  try {
    const saved = localStorage.getItem('two_gis_api_key');
    if (saved) {
      window.TWO_GIS_API_KEY = saved;
      if (els.apiKey) els.apiKey.value = saved;
    }
  } catch {}
  setupResponsiveWheel();
  drawWheel([]);
  initMap();

  // Utility: take up to n random unique items
  function sampleMax(arr, n) {
    if (arr.length <= n) return arr.slice();
    // Fisher-Yates shuffle up to n
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a.slice(0, n);
  }

  // Responsive canvas sizing with device pixel ratio
  function setupResponsiveWheel() {
    const resizeWheel = () => {
      const dpr = window.devicePixelRatio || 1;
      const wrap = els.wheel.parentElement; // .wheel-wrap
      const maxPx = 420;
      const cssSize = Math.max(220, Math.min(maxPx, wrap.clientWidth || maxPx));
      els.wheel.style.width = cssSize + 'px';
      els.wheel.style.height = cssSize + 'px';
      els.wheel.width = Math.floor(cssSize * dpr);
      els.wheel.height = Math.floor(cssSize * dpr);
      const ctx2 = els.wheel.getContext('2d');
      ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawWheel(spinState.items);
    };
    window.addEventListener('resize', resizeWheel);
    window.addEventListener('orientationchange', resizeWheel);
    resizeWheel();
  }
})();

// Lightweight JSONP helper
function jsonp(url, params) {
  return new Promise((resolve, reject) => {
    const cbName = '__jsonp_cb_' + Math.random().toString(36).slice(2);
    const qs = new URLSearchParams(params || {});
    qs.set('callback', cbName);
    const src = url + '?' + qs.toString();
    const script = document.createElement('script');
    let cleaned = false;
    function cleanup() {
      if (cleaned) return; cleaned = true;
      try { delete window[cbName]; } catch { window[cbName] = undefined; }
      if (script.parentNode) script.parentNode.removeChild(script);
    }
    const timeout = setTimeout(() => { cleanup(); reject(new Error('JSONP timeout')); }, 12000);
    window[cbName] = (data) => { clearTimeout(timeout); cleanup(); resolve(data); };
    script.onerror = () => { clearTimeout(timeout); cleanup(); reject(new Error('JSONP script error')); };
    script.src = src;
    document.head.appendChild(script);
  });
  }

  function getRadiusMeters() {
    const v = (els.radius && parseInt(els.radius.value, 10)) || DEFAULT_RADIUS;
    return Math.max(100, Math.min(3000, v));
  }

  function getMaxCount() {
    const v = (els.maxCount && parseInt(els.maxCount.value, 10)) || 50;
    return Math.max(1, Math.min(200, v));
  }

  function drawSearchCircle(center, radius) {
    DG.then(() => {
      try {
        if (searchCircle) { try { map.removeLayer(searchCircle); } catch {} }
        searchCircle = DG.circle([center.lat, center.lng], radius, {
          color: '#0066ff',
          weight: 2,
          opacity: 0.9,
          fillColor: '#99ccff',
          fillOpacity: 0.15,
        }).addTo(map);
      } catch {}
    });
  }
// Prefer DG.ajax.jsonp when available (from 2GIS Maps API)
function jsonpPreferDG(url, params) {
  return new Promise((resolve, reject) => {
    try {
      if (window.DG && DG.ajax && typeof DG.ajax.jsonp === 'function') {
        DG.ajax.jsonp(url, params, (data) => resolve(data));
        return;
      }
    } catch {}
    jsonp(url, params).then(resolve).catch(reject);
  });
}

// Reverse geocode lat/lng to address (Nominatim)
async function reverseGeocode(ll) {
  const url = new URL('https://nominatim.openstreetmap.org/reverse');
  url.searchParams.set('format', 'json');
  url.searchParams.set('lat', String(ll.lat));
  url.searchParams.set('lon', String(ll.lng));
  const res = await fetch(url.toString(), { headers: { 'Accept-Language': 'zh-CN' } });
  if (!res.ok) return '';
  const data = await res.json();
  return (data && (data.display_name || data.name)) || '';
}

// Helper: allow geolocation on https or localhost
function isSecureAllowed() {
  try {
    if (window.isSecureContext) return true;
    const h = location.hostname;
    return h === 'localhost' || h === '127.0.0.1' || h.endsWith('.localhost');
  } catch { return false; }
}

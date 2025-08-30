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
    presetSelect: document.getElementById('presetSelect'),
    panelStats: document.getElementById('panelStats'),
    resultsGrid: document.getElementById('resultsGrid'),
    presetBtns: Array.from(document.querySelectorAll('[data-kw]')),
    start: document.getElementById('btn-start'),
    selection: document.getElementById('selection'),
    map: document.getElementById('map'),
  };

  let map, centerMarker, searchCircle;
  // Default to Moscow center like map.html. Address input defaults to "Moskva Dovatora 9".
  let currentCenter = { lat: 55.751244, lng: 37.618423 };
  let restaurants = []; // current result set
  let markers = [];
  const DEFAULT_RADIUS = 1000; // meters
  let lastSearchTotal = null; // API reported total results if available

  // Shuffle state for results grid
  let shuffleState = { running: false, timer: null, items: [], lastIdx: -1 };

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
        // auto-refresh results on drag, like map.html
        handleSearch(currentCenter);
      });

      // If address input has a preset value, center to it on load
      const presetAddr = (els.address && els.address.value || '').trim();
      if (presetAddr) {
        geocodeAddress(presetAddr).then((p) => {
          if (p) {
            currentCenter = p;
            map.setView([p.lat, p.lng], 15);
            centerMarker.setLatLng([p.lat, p.lng]);
          }
        }).catch(() => {});
      }
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
    const keyword = getQueryKeywordEnglish();
    try {
      const radius = getRadiusMeters();
      const limit = getMaxCount();
      const list = await loadRestaurants2GIS(center, radius, key, keyword, limit);
      const finalList = Array.isArray(list) ? list : [];
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

  // 2GIS Directory API: nearby search with english tokens and lon,lat
  function loadRestaurants2GIS(center, radiusMeters, apiKey, keywordEn, limit) {
    const endpoint = 'https://catalog.api.2gis.com/3.0/items';
    const radius = String(Math.max(100, Math.min(3000, Math.floor(radiusMeters))));
    const qNearby = keywordEn || 'restaurant';
    const DEMO_PAGE_SIZE_MAX = 10;
    const DEMO_PAGE_MAX = 5;
    const target = Math.max(1, Math.min(200, Number(limit) || 50));

    async function fetchPage(params) {
      const url = `${endpoint}?${params.toString()}`;
      const res = await fetch(url, { mode: 'cors' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }

    async function nearbyPaginated() {
      const all = [];
      lastSearchTotal = null;
      for (let page = 1; page <= DEMO_PAGE_MAX && all.length < target; page++) {
        const p = new URLSearchParams({
          key: apiKey,
          q: qNearby,
          point: `${center.lng},${center.lat}`,
          radius,
          page: String(page),
          page_size: String(Math.min(DEMO_PAGE_SIZE_MAX, target - all.length) || 1),
          fields: 'items.name,items.address,items.point,items.schedule'
        });
        const data = await fetchPage(p);
        if (lastSearchTotal == null && data && data.result && typeof data.result.total === 'number') {
          lastSearchTotal = data.result.total;
        }
        const items = (data && data.result && data.result.items) || [];
        if (!items.length) break;
        all.push(...items);
      }
      return all;
    }

    return nearbyPaginated().then((items) => items.map(map2GisItem).filter(Boolean));
  }

  function getQueryKeywordEnglish() {
    const raw = (els.keyword && els.keyword.value || '').trim();
    if (!raw) return 'fastfood';
    const low = raw.toLowerCase();
    const known = ['fastfood','restaurant','hotel','cafe','bar','subway','bus stop','bus station'];
    if (known.includes(low)) return low;
    const map = [
      [/快餐/, 'fastfood'],
      [/饭店|餐厅|美食|吃饭|馆子|餐馆/, 'restaurant'],
      [/酒店|宾馆/, 'hotel'],
      [/咖啡|咖啡厅|咖啡店/, 'cafe'],
      [/酒吧/, 'bar'],
      [/地铁站|地铁口|地铁/, 'subway'],
      [/公交车站|公交站|公交|公车站|巴士站/, 'bus stop']
    ];
    for (const [re, en] of map) { if (re.test(raw)) return en; }
    for (const k of known) { if (low.includes(k)) return k; }
    return 'fastfood';
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
    updateResultsPanel(list);
  }
  
  function updateResultsPanel(list) {
    if (els.panelStats) els.panelStats.textContent = '结果：' + list.length + (lastSearchTotal != null ? (' / ' + lastSearchTotal) : '');
    if (!els.resultsGrid) return;
    els.resultsGrid.classList.add('inf-menu');
    const center = currentCenter;
    const items = list.map((it) => ({
      it,
      dist: haversine(center.lat, center.lng, it.lat, it.lng)
    }));
    els.resultsGrid.innerHTML = '';
    // Build first segment
    items.forEach(({ it, dist }) => {
      const cell = document.createElement('div');
      cell.className = 'results-cell';
      const km = dist >= 1000 ? (dist / 1000).toFixed(2) + ' km' : Math.round(dist) + ' m';
      cell.innerHTML = `<div class="name">${escapeHtml(it.name)}</div><div class="addr">${escapeHtml(it.address || '')}<span class="dist">${km}</span></div>`;
      cell.addEventListener('click', () => {
        try { map.setView([it.lat, it.lng], Math.max(map.getZoom(), 15)); } catch {}
        showSelection(it);
      });
      els.resultsGrid.appendChild(cell);
    });
    // Duplicate for seamless loop
    items.forEach(({ it, dist }) => {
      const cell = document.createElement('div');
      cell.className = 'results-cell';
      const km = dist >= 1000 ? (dist / 1000).toFixed(2) + ' km' : Math.round(dist) + ' m';
      cell.innerHTML = `<div class="name">${escapeHtml(it.name)}</div><div class="addr">${escapeHtml(it.address || '')}<span class="dist">${km}</span></div>`;
      cell.addEventListener('click', () => {
        try { map.setView([it.lat, it.lng], Math.max(map.getZoom(), 15)); } catch {}
        showSelection(it);
      });
      els.resultsGrid.appendChild(cell);
    });
    shuffleState.items = list.slice();
    if (els.start) els.start.disabled = list.length === 0;
    initInfiniteAutoScroll(els.resultsGrid, list.length);
  }

  // Auto-scrolling state for infinite menu
  const autoScroll = { running: false, raf: 0, last: 0, speed: 28, segHeight: 0, container: null, resumeTimer: 0, touchY: 0 };
  function initInfiniteAutoScroll(container, segCount) {
    try {
      autoScroll.container = container;
      container.scrollTop = 0;
      requestAnimationFrame(() => {
        autoScroll.segHeight = Math.max(1, Math.floor(container.scrollHeight / 2));
        startAutoScroll();
      });
      // install wheel/touch handlers once
      if (!container.__infHandlersInstalled) {
        const onWheel = (e) => {
          try {
            e.preventDefault();
            pauseAutoScroll();
            const c = autoScroll.container;
            c.scrollTop += e.deltaY;
            if (c.scrollTop < 0) c.scrollTop += autoScroll.segHeight;
            if (c.scrollTop >= autoScroll.segHeight) c.scrollTop -= autoScroll.segHeight;
            clearTimeout(autoScroll.resumeTimer);
            autoScroll.resumeTimer = setTimeout(resumeAutoScroll, 900);
          } catch {}
        };
        const onTouchStart = (e) => { try { autoScroll.touchY = e.touches && e.touches[0] ? e.touches[0].clientY : 0; pauseAutoScroll(); } catch {} };
        const onTouchMove = (e) => {
          try {
            if (!e.touches || !e.touches[0]) return;
            const y = e.touches[0].clientY;
            const dy = autoScroll.touchY ? (autoScroll.touchY - y) : 0;
            autoScroll.touchY = y;
            const c = autoScroll.container;
            c.scrollTop += dy;
            if (c.scrollTop < 0) c.scrollTop += autoScroll.segHeight;
            if (c.scrollTop >= autoScroll.segHeight) c.scrollTop -= autoScroll.segHeight;
            e.preventDefault();
            clearTimeout(autoScroll.resumeTimer);
            autoScroll.resumeTimer = setTimeout(resumeAutoScroll, 900);
          } catch {}
        };
        container.addEventListener('wheel', onWheel, { passive: false });
        container.addEventListener('touchstart', onTouchStart, { passive: true });
        container.addEventListener('touchmove', onTouchMove, { passive: false });
        container.__infHandlersInstalled = true;
      }
    } catch {}
  }
  function startAutoScroll() {
    if (!autoScroll.container) return;
    autoScroll.running = true;
    autoScroll.last = performance.now();
    cancelAnimationFrame(autoScroll.raf);
    const tick = (ts) => {
      if (!autoScroll.running) return;
      const dt = Math.max(0, ts - autoScroll.last);
      autoScroll.last = ts;
      const c = autoScroll.container;
      c.scrollTop += (autoScroll.speed * dt) / 1000;
      if (c.scrollTop >= autoScroll.segHeight) c.scrollTop -= autoScroll.segHeight;
      autoScroll.raf = requestAnimationFrame(tick);
    };
    autoScroll.raf = requestAnimationFrame(tick);
    autoScroll.container.addEventListener('mouseenter', pauseAutoScroll, { passive: true });
    autoScroll.container.addEventListener('mouseleave', resumeAutoScroll, { passive: true });
  }
  function pauseAutoScroll() { autoScroll.running = false; cancelAnimationFrame(autoScroll.raf); }
  function resumeAutoScroll() { if (!autoScroll.running) startAutoScroll(); }

  // Inside-IIFE helpers so they can access `els`
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
        if (searchCircle) { try { map.removeLayer(searchCircle); } catch {}
        }
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

  

  // Wheel removed

  function drawTextWithShadow() {}
  function drawTextWithShadowAt() {}

  function truncate(s, n) {
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"]+/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  }

  function haversine(lat1, lon1, lat2, lon2) {
    const toRad = (d) => d * Math.PI / 180;
    const R = 6371000; // meters
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat/2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  function startShuffle() {
    if (!shuffleState.items.length || shuffleState.running) return;
    shuffleState.running = true;
    if (els.start) els.start.disabled = true;
    const cells = els.resultsGrid ? Array.from(els.resultsGrid.children) : [];
    const t0 = performance.now();
    let speed = 100;
    function step() {
      if (!shuffleState.running) return;
      const now = performance.now();
      const elapsed = now - t0;
      const p = Math.min(1, elapsed / 3000);
      speed = 50 + Math.floor(250 * (1 - easeOutCubic(1 - p)));
      if (cells.length) {
        const idx = Math.floor(Math.random() * cells.length);
        if (shuffleState.lastIdx >= 0 && shuffleState.lastIdx < cells.length) cells[shuffleState.lastIdx].classList.remove('active');
        cells[idx].classList.add('active');
        shuffleState.lastIdx = idx;
      }
      if (elapsed >= 3000) {
        shuffleState.running = false;
        if (els.start) els.start.disabled = false;
        const idxFinal = shuffleState.lastIdx >= 0 ? shuffleState.lastIdx : 0;
        const baseLen = Math.max(1, shuffleState.items.length);
        const chosen = shuffleState.items[idxFinal % baseLen] || shuffleState.items[0];
        if (chosen) showSelection(chosen);
        return;
      }
      shuffleState.timer = setTimeout(step, speed);
    }
    step();
  }

  function showSelection(item) {
    els.selection.classList.remove('hidden');
    els.selection.classList.add('rb-shape-blur');
    els.selection.classList.remove('is-visible');
    els.selection.innerHTML = `
      <div class="sb-inner">
        <h3>结果：${escapeHtml(item.name)}</h3>
        <div class="row"><span class="muted">地址：</span><span>${escapeHtml(item.address || '暂无')}</span></div>
        <div class="row"><span class="muted">评分：</span><span>${item.rating ? escapeHtml(String(item.rating)) : '暂无'}</span></div>
        ${item.phones && item.phones.length ? `<div class="row"><span class="muted">电话：</span><span>${item.phones.map(escapeHtml).join(' / ')}</span></div>` : ''}
        ${item.url ? `<div class="row"><a href="${item.url}" target="_blank" rel="noopener">查看详情</a></div>` : ''}
      </div>
    `;
    triggerShapeBlur(els.selection);
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
    // Show all results
    updateMapMarkers(restaurants);
  }

  // Geocoding strictly via 2GIS Catalog: items?q=address&fields=items.point
  async function geocodeAddress(address) {
    const key = (els.apiKey && els.apiKey.value ? els.apiKey.value : window.TWO_GIS_API_KEY) || '';
    if (!key) throw new Error('缺少 2GIS API Key');
    const endpoint = 'https://catalog.api.2gis.com/3.0/items';
    const p = new URLSearchParams({ key, q: address, fields: 'items.point' });
    const res = await fetch(`${endpoint}?${p.toString()}`, { mode: 'cors' });
    if (!res.ok) throw new Error('Geocode HTTP ' + res.status);
    const data = await res.json();
    const it = data && data.result && data.result.items && data.result.items[0];
    const point = it && it.point;
    if (point && typeof point.lat === 'number' && typeof point.lon === 'number') {
      return { lat: point.lat, lng: point.lon };
    }
    return null;
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
  els.search.addEventListener('click', () => handleSearch());
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
  if (els.presetSelect) {
    els.presetSelect.addEventListener('change', () => {
      const v = els.presetSelect.value || '';
      if (v && els.keyword) {
        els.keyword.value = v;
        handleSearch();
      }
    });
  }
  if (els.start) els.start.addEventListener('click', startShuffle);

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
  // No wheel initialization
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

  // Gradual Blur helper (Reactbits style)
  function applyGradualBlur(nodes) {
    if (!nodes || !nodes.length) return;
    nodes.forEach((el, idx) => {
      try {
        el.classList.add('rb-gb');
        const delay = idx * 60;
        setTimeout(() => { el.classList.add('is-visible'); }, delay);
      } catch {}
    });
  }

  // Scroll Stack enhancer: set index variable for sticky stacking
  function applyScrollStack(container) {
    if (!container) return;
    const kids = Array.from(container.children);
    kids.forEach((el, i) => {
      try { el.style.setProperty('--i', String(i)); } catch {}
    });
  }

  // Shape Blur helper
  function triggerShapeBlur(el) {
    if (!el) return;
    try {
      // restart animation by toggling class and forcing reflow
      el.classList.remove('is-visible');
      void el.offsetWidth;
      el.classList.add('is-visible');
    } catch {}
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

// (moved inside IIFE)
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

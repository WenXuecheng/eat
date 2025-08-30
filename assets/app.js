/*
  2GIS Where-To-Eat Spinner
  - Uses 2GIS Maps API for the map layer.
  - Restaurant data source is pluggable. By default, a Demo Mode generates mock restaurants.
  - For real data, provide a 2GIS Directory API key by setting window.TWO_GIS_API_KEY.
  - Then implement loadRestaurants2GIS(center, radius) using JSONP to the 2GIS Catalog API.
*/

// Optional: provide your 2GIS Directory API key here or via devtools: window.TWO_GIS_API_KEY = '...'
window.TWO_GIS_API_KEY = window.TWO_GIS_API_KEY || '';

(function () {
  const els = {
    address: document.getElementById('address'),
    geolocate: document.getElementById('btn-geolocate'),
    radius: document.getElementById('radius'),
    search: document.getElementById('btn-search'),
    demo: document.getElementById('demo-mode'),
    wheel: document.getElementById('wheel'),
    spin: document.getElementById('btn-spin'),
    selection: document.getElementById('selection'),
    map: document.getElementById('map'),
  };

  let map, centerMarker, radiusCircle;
  let currentCenter = { lat: 31.2304, lng: 121.4737 }; // default: Shanghai
  let restaurants = []; // current result set
  let markers = [];

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

      centerMarker = DG.marker([currentCenter.lat, currentCenter.lng], { draggable: true }).addTo(map);
      centerMarker.on('dragend', () => {
        const ll = centerMarker.getLatLng();
        currentCenter = { lat: ll.lat, lng: ll.lng };
        drawRadius();
      });

      drawRadius();
    });
  }

  function drawRadius() {
    const r = Number(els.radius.value || 1000);
    if (radiusCircle) {
      map.removeLayer(radiusCircle);
    }
    radiusCircle = DG.circle([currentCenter.lat, currentCenter.lng], r, {
      color: '#4f8cff', weight: 1, fillOpacity: 0.08
    }).addTo(map);
  }

  function useGeolocation() {
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
          drawRadius();
        });
      },
      (err) => {
        console.warn('Geolocation error', err);
        alert('定位失败：' + err.message);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  // NOTE: For real 2GIS data, implement this using 2GIS Directory API (Catalog API) JSONP.
  async function loadRestaurants(center, radiusMeters) {
    if (!els.demo.checked) {
      if (window.TWO_GIS_API_KEY) {
        try {
          const list = await loadRestaurants2GIS(center, radiusMeters, window.TWO_GIS_API_KEY);
          if (Array.isArray(list) && list.length) {
            return list;
          }
        } catch (e) {
          console.warn('2GIS 加载失败，切换到示例数据', e);
        }
      }
    }
    return generateDemoRestaurants(center, radiusMeters, 12);
  }

  // Placeholder for 2GIS Directory API integration (JSONP to avoid CORS in static page)
  function loadRestaurants2GIS(center, radiusMeters, apiKey) {
    return new Promise((resolve, reject) => {
      // TODO: 实现 2GIS Catalog API 请求（JSONP）。
      // 参考方向：catalog.api.2gis.com/3.0/items 或者 2GIS Search API，按经纬度+半径过滤
      // 需传入 fields=items.point,items.address,items.rating 等。
      // 前端可使用 DG.ajax.jsonp(url, params, callback)（Maps API 提供的 JSONP 工具）。
      // 返回格式需要映射为：[{ id, name, lat, lng, address, rating, url, phones: [] }]
      // 这里先直接 reject，调用方会回退到 Demo 数据。
      reject(new Error('2GIS API 未实现'));
    });
  }

  function generateDemoRestaurants(center, radiusMeters, count) {
    const out = [];
    for (let i = 0; i < count; i++) {
      const p = randomPointInCircle(center, radiusMeters);
      out.push({
        id: 'demo-' + i,
        name: `演示餐厅 ${i + 1}`,
        lat: p.lat,
        lng: p.lng,
        address: '示例地址 · 仅用于演示',
        rating: (Math.random() * 2 + 3).toFixed(1),
        url: '#',
        phones: []
      });
    }
    return out;
  }

  function randomPointInCircle(center, radiusMeters) {
    // Random distance and bearing
    const r = radiusMeters * Math.sqrt(Math.random());
    const t = Math.random() * Math.PI * 2;
    // Convert meters to degrees approximately
    const dx = (r * Math.cos(t)) / 111320; // meters per degree lon at equator ~111.32km
    const dy = (r * Math.sin(t)) / 110540; // meters per degree lat ~110.54km
    return { lat: center.lat + dy, lng: center.lng + dx };
  }

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
    const cw = els.wheel.width;
    const ch = els.wheel.height;
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

      // label
      const mid = (start + end) / 2;
      const rx = cx + Math.cos(mid) * (r * 0.68);
      const ry = cy + Math.sin(mid) * (r * 0.68);
      ctx.save();
      ctx.translate(rx, ry);
      ctx.rotate(mid + Math.PI / 2);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#0e1320';
      ctx.font = 'bold 13px system-ui, -apple-system, Segoe UI';
      const label = truncate(items[i].name, 18);
      drawTextWithShadow(ctx, label);
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

  async function handleSearch() {
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
            drawRadius();
          });
        }
      } catch (e) {
        alert('地址解析失败，请尝试更换写法或使用定位');
        console.warn('Geocode failed', e);
        return;
      }
    }

    const r = Number(els.radius.value || 1000);
    restaurants = await loadRestaurants(currentCenter, r);
    if (!restaurants.length) {
      alert('未找到附近饭店');
      return;
    }
    // Limit to max 12 randomly sampled items for the wheel
    const MAX_WHEEL = 12;
    const wheelItems = sampleMax(restaurants, MAX_WHEEL);

    updateMapMarkers(wheelItems);
    spinState.items = wheelItems;
    spinState.rotation = 0;
    drawWheel(wheelItems);
    els.spin.disabled = false;
  }

  // Simple geocoding via OpenStreetMap Nominatim (no key). Replace with 2GIS geocoder if desired.
  async function geocodeAddress(address) {
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('format', 'json');
    url.searchParams.set('q', address);
    url.searchParams.set('limit', '1');
    const res = await fetch(url.toString(), { headers: { 'Accept-Language': 'zh-CN' } });
    if (!res.ok) throw new Error('Geocode HTTP ' + res.status);
    const arr = await res.json();
    if (!arr.length) return null;
    return { lat: parseFloat(arr[0].lat), lng: parseFloat(arr[0].lon) };
  }

  // Event bindings
  els.geolocate.addEventListener('click', useGeolocation);
  els.search.addEventListener('click', handleSearch);
  els.spin.addEventListener('click', startSpin);
  els.radius.addEventListener('change', drawRadius);

  // Initial draw
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
})();

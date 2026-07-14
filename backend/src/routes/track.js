const express = require('express');
const router = express.Router();
const { query } = require('../database/connection');
const { getLocation, getTripByToken } = require('../services/redisService');

// ── Helper: load the latest trip + location for a token ──────────────
async function loadTrip(token) {
  const tripResult = await query(
    `SELECT t.*, u.name as user_name, u.phone as user_phone
     FROM trips t JOIN users u ON t.user_id = u.id
     WHERE t.share_token = $1`,
    [token]
  );

  if (!tripResult.rows.length) return null;

  const trip = tripResult.rows[0];
  const location = await getLocation(trip.id);

  const lat = location?.lat ?? trip.last_lat ?? null;
  const lng = location?.lng ?? trip.last_lng ?? null;

  return { trip, lat, lng };
}

// ── JSON endpoint the live page polls every few seconds ─────────────
// GET /track/:token/location  →  { lat, lng, status, updatedAt }
router.get('/:token/location', async (req, res, next) => {
  try {
    const data = await loadTrip(req.params.token);
    if (!data) {
      return res.status(404).json({ success: false, message: 'Trip not found' });
    }
    res.json({
      success: true,
      lat: data.lat,
      lng: data.lng,
      status: data.trip.status,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

// ── The public tracking page for trusted contacts ───────────────────
// GET /track/:token
router.get('/:token', async (req, res, next) => {
  try {
    const { token } = req.params;
    const data = await loadTrip(token);

    if (!data) {
      return res
        .status(404)
        .send(notFoundPage());
    }

    const { trip, lat, lng } = data;

    res.send(
      trackingPage({
        token,
        userName: trip.user_name || 'Your Contact',
        destination: trip.destination || 'Not specified',
        startedAt: trip.started_at,
        userPhone: trip.user_phone || '',
        lat,
        lng,
        status: trip.status || 'active',
      })
    );
  } catch (err) {
    next(err);
  }
});

function notFoundPage() {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Trip Not Found — SAATHI</title>
  <style>body{font-family:-apple-system,Segoe UI,sans-serif;background:#F8F5FF;color:#2C2251;text-align:center;padding:60px 20px;}</style>
  </head><body><h1>🛡️ SAATHI</h1><p style="margin-top:16px;color:#666;">This tracking link is invalid or expired.</p></body></html>`;
}

// ── Full HTML page with a live Leaflet map ──────────────────────────
function trackingPage(p) {
  const hasLocation = p.lat != null && p.lng != null;
  const startedText = p.startedAt ? new Date(p.startedAt).toLocaleString() : 'Unknown';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Tracking ${p.userName} — SAATHI</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #F8F5FF; color: #2C2251; }
    .header { background: linear-gradient(135deg, #7C5CBF, #A65C84); color: white; padding: 16px 20px; text-align: center; }
    .header h1 { font-size: 20px; font-weight: 600; }
    .header p { font-size: 13px; opacity: 0.85; margin-top: 4px; }
    .status-bar { color: white; text-align: center; padding: 12px; font-weight: 600; font-size: 16px; }
    .info { padding: 18px 20px; background: white; margin: 12px; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
    .info h2 { font-size: 22px; color: #7C5CBF; margin-bottom: 10px; }
    .info p { font-size: 14px; color: #555; margin: 6px 0; }
    .live-dot { display:inline-block; width:9px; height:9px; border-radius:50%; background:#1D9E75; margin-right:6px; animation: pulse 1.4s infinite; }
    @keyframes pulse { 0%{opacity:1} 50%{opacity:.3} 100%{opacity:1} }
    #map { height: 360px; margin: 0 12px; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08); z-index: 0; }
    .no-loc { text-align:center; color:#888; padding: 30px 16px; }
    .actions { padding: 16px 12px; display: flex; flex-direction: column; gap: 10px; }
    .btn { display: block; padding: 14px; border-radius: 12px; text-align: center; font-size: 16px; font-weight: 600; text-decoration: none; }
    .btn-maps { background: #1D9E75; color: white; }
    .btn-call { background: #7C5CBF; color: white; }
    .btn-sos { background: #E8607A; color: white; }
    .footer { text-align: center; padding: 16px; font-size: 12px; color: #888; }
  </style>
</head>
<body>
  <div class="header"><h1>🛡️ SAATHI</h1><p>Live Safety Tracker</p></div>

  <div class="status-bar" id="statusBar"></div>

  <div class="info">
    <h2>${p.userName}</h2>
    <p>Destination: <strong>${p.destination}</strong></p>
    <p>Trip started: <strong>${startedText}</strong></p>
    <p><span class="live-dot"></span>Last seen: <strong id="lastSeen">just now</strong></p>
  </div>

  ${hasLocation
      ? `<div id="map"></div>`
      : `<div class="no-loc">📍 Waiting for location… this page will update automatically.</div>`}

  <div class="actions">
    ${hasLocation ? `<a id="mapsLink" href="https://www.google.com/maps?q=${p.lat},${p.lng}" target="_blank" class="btn btn-maps">🧭 Open in Google Maps</a>` : ''}
    <a href="tel:${p.userPhone}" class="btn btn-call">📞 Call ${p.userName}</a>
    <a href="tel:112" class="btn btn-sos">🚨 Call Emergency 112</a>
  </div>

  <div class="footer">Powered by SAATHI Women Safety App • Updates live every 5s</div>

  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    var TOKEN = ${JSON.stringify(p.token)};
    var hasLocation = ${hasLocation};
    var map = null, marker = null;

    function statusInfo(status) {
      if (status === 'sos') return { text: '🚨 SOS ACTIVE', color: '#E8607A' };
      if (status === 'safe') return { text: '✅ Arrived Safely', color: '#1D9E75' };
      return { text: '📍 Trip Active', color: '#7C5CBF' };
    }

    function applyStatus(status) {
      var s = statusInfo(status);
      var bar = document.getElementById('statusBar');
      bar.textContent = s.text;
      bar.style.background = s.color;
    }

    applyStatus(${JSON.stringify(p.status)});

    if (hasLocation) {
      map = L.map('map').setView([${hasLocation ? p.lat : 0}, ${hasLocation ? p.lng : 0}], 16);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap'
      }).addTo(map);
      marker = L.marker([${hasLocation ? p.lat : 0}, ${hasLocation ? p.lng : 0}]).addTo(map);
    }

    async function refresh() {
      try {
        var res = await fetch('/track/' + TOKEN + '/location', { cache: 'no-store' });
        if (!res.ok) return;
        var data = await res.json();
        if (!data.success) return;

        if (data.status) applyStatus(data.status);

        if (data.lat != null && data.lng != null) {
          document.getElementById('lastSeen').textContent = new Date().toLocaleTimeString();
          var link = document.getElementById('mapsLink');
          if (link) link.href = 'https://www.google.com/maps?q=' + data.lat + ',' + data.lng;

          if (!map) { location.reload(); return; }
          marker.setLatLng([data.lat, data.lng]);
          map.panTo([data.lat, data.lng]);
        }
      } catch (e) { /* ignore transient errors */ }
    }

    setInterval(refresh, 5000);
  </script>
</body>
</html>`;
}

module.exports = router;
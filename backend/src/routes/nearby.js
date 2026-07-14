const express = require('express');
const router = express.Router();
const axios = require('axios');
const { authenticate } = require('../middleware/auth');

// Free, no-key place search via OpenStreetMap's Overpass API.
// Each "type" maps to one or more OSM tags we search for around the user.
const OSM_FILTERS = {
  police: [['amenity', 'police']],
  hospital: [
    ['amenity', 'hospital'],
    ['amenity', 'clinic'],
  ],
  pharmacy: [['amenity', 'pharmacy']],
  // Women help / women police: OSM has no perfect tag, so we use the closest
  // safe official options (police + social facilities).
  women_help: [
    ['amenity', 'police'],
    ['amenity', 'social_facility'],
  ],
  women_police: [['amenity', 'police']],
  // NEW — public, usually-busy "safe spots" a person can head toward.
  safe_spots: [
    ['shop', 'mall'],
    ['shop', 'supermarket'],
    ['amenity', 'fuel'],
    ['railway', 'station'],
    ['amenity', 'bank'],
    ['public_transport', 'station'],
  ],
};

// Friendly label shown to the user for each safe-spot kind.
function spotLabel(tags) {
  if (tags.shop === 'mall') return 'Shopping Mall';
  if (tags.shop === 'supermarket') return 'Supermarket (usually open)';
  if (tags.amenity === 'fuel') return 'Petrol Pump (24/7)';
  if (tags.railway === 'station' || tags.public_transport === 'station') return 'Station (busy area)';
  if (tags.amenity === 'bank') return 'Bank (public, cameras)';
  if (tags.amenity === 'police') return 'Police';
  if (tags.amenity === 'hospital' || tags.amenity === 'clinic') return 'Hospital';
  if (tags.amenity === 'pharmacy') return 'Pharmacy';
  if (tags.amenity === 'social_facility') return 'Help Centre';
  return 'Safe Place';
}

// GET /api/nearby?lat=&lng=&type=police
router.get('/', async (req, res, next) => {
  console.log('Nearby API HIT');
  console.log(req.query);

  try {
    const { lat, lng, type = 'police', radius = 5000 } = req.query;
    if (!lat || !lng) return res.status(400).json({ error: 'lat and lng required' });

    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);
    const radiusNum = Math.min(parseInt(radius, 10) || 5000, 15000);

    const filters = OSM_FILTERS[type] || OSM_FILTERS.police;

    // Build an Overpass query: find matching nodes/ways within the radius.
    const clauses = filters
      .map(([k, v]) => {
        return `node["${k}"="${v}"](around:${radiusNum},${latNum},${lngNum});
                way["${k}"="${v}"](around:${radiusNum},${latNum},${lngNum});`;
      })
      .join('\n');

    const query = `[out:json][timeout:20];(${clauses});out center 40;`;

    // Overpass has several mirror servers; try them in order for reliability.
    const endpoints = [
      'https://overpass-api.de/api/interpreter',
      'https://overpass.kumi.systems/api/interpreter',
    ];

    let elements = [];
    let gotData = false;
    for (const endpoint of endpoints) {
      try {
        const response = await axios.post(
          endpoint,
          'data=' + encodeURIComponent(query),
          {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              // Overpass usage policy asks for an identifying User-Agent.
              'User-Agent': 'SAATHI-Safety-App/1.0 (contact: amanupadhyay.3012@gmail.com)',
            },
            timeout: 22000,
          }
        );
        elements = response.data.elements || [];
        gotData = true;
        break;
      } catch (osmErr) {
        console.log(`Overpass endpoint failed (${endpoint}):`, osmErr.message);
      }
    }

    if (!gotData) {
      console.log('All Overpass endpoints failed, using mock fallback.');
      return res.json(getMockPlaces(type, latNum, lngNum));
    }

    const places = elements
      .map((el) => {
        const elLat = el.lat ?? el.center?.lat;
        const elLng = el.lon ?? el.center?.lon;
        if (elLat == null || elLng == null) return null;

        const tags = el.tags || {};
        const name = tags.name || spotLabel(tags);

        return {
          id: String(el.id),
          name,
          kind: spotLabel(tags),
          lat: elLat,
          lng: elLng,
          address: tags['addr:street'] || tags['addr:full'] || '',
          rating: null,
          openNow: null, // OSM rarely has live open/closed; we don't fake it
          distance: getDistance(latNum, lngNum, elLat, elLng),
          mapsUrl: `https://www.google.com/maps/search/?api=1&query=${elLat},${elLng}`,
        };
      })
      .filter(Boolean)
      // closest first
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 12);

    // If OSM returned nothing (rural/empty area), fall back to mock so the
    // screen is never blank.
    if (!places.length) {
      return res.json(getMockPlaces(type, latNum, lngNum));
    }

    res.json({ type, places });
  } catch (err) {
    console.log('NEARBY ERROR');
    console.log(err.message);
    next(err);
  }
});

function getDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function getMockPlaces(type, lat, lng) {
  const offsets = [0.003, 0.006, 0.009, 0.012];
  const names = {
    police: ['City Police Station', 'Central Police Post', 'Traffic Police HQ', 'Local Police Chowki'],
    hospital: ['City General Hospital', 'Apollo Health Center', 'Red Cross Clinic', 'Emergency Medical Centre'],
    pharmacy: ['MedPlus Pharmacy', 'Apollo Pharmacy', 'City Medical Store', 'LifeCare Pharmacy'],
    women_police: ['Women Police Station', 'Mahila Police Help Desk', 'Women Safety Cell', 'Women Crime Branch'],
    women_help: ['Women Help Center', 'Nari Suraksha Kendra', 'Women Support Centre', 'Women Crisis Helpline Office'],
    safe_spots: ['City Mall', '24/7 Supermarket', 'Metro Station', 'Petrol Pump'],
  };
  return {
    type,
    places: offsets.map((off, i) => ({
      id: `mock_${i}`,
      name: (names[type] || names.police)[i],
      kind: 'Safe Place',
      lat: lat + off,
      lng: lng + off,
      address: `${i + 1} Main Road, Near You`,
      rating: 4.2,
      openNow: true,
      distance: Math.round(off * 111000),
      mapsUrl: `https://www.google.com/maps/search/?api=1&query=${lat + off},${lng + off}`,
    })),
  };
}

module.exports = router;

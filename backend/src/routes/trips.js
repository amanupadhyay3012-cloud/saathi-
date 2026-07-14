const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../database/connection');
const { authenticate } = require('../middleware/auth');
const { setLocation, setActiveTrip, delActiveTrip, setTripToken } = require('../services/redisService');
const { sendTripStartNotification, sendSafeArrivalNotification } = require('../services/smsService');

// POST /api/trips/start
router.post('/start', async (req, res, next) => {
  try {

    const userResult = await query(
      'SELECT id FROM users LIMIT 1'
    );

    if (!userResult.rows.length) {
      return res.status(500).json({
        success: false,
        message: 'No users found in database'
      });
    }

    const userId = userResult.rows[0].id;

    const {
      destination,
      durationMins,
      lat,
      lng,
      checkinIntervalMins
    } = req.body;

    const shareToken = crypto.randomBytes(24).toString('hex');
    const tripId = uuidv4();

    const checkinDeadline = durationMins
      ? new Date(Date.now() + durationMins * 60 * 1000)
      : null;

    await query(
      `
      INSERT INTO trips (
        id,
        user_id,
        destination,
        duration_mins,
        share_token,
        status,
        checkin_deadline,
        checkin_interval_mins,
        last_lat,
        last_lng
      )
      VALUES (
        $1,$2,$3,$4,$5,
        'active',
        $6,$7,$8,$9
      )
      `,
      [
        tripId,
        userId,
        destination,
        durationMins,
        shareToken,
        checkinDeadline,
        checkinIntervalMins || 60,
        lat,
        lng
      ]
    );

    await setActiveTrip(userId, tripId);
    await setTripToken(shareToken, tripId);

    if (lat && lng) {
      await setLocation(tripId, lat, lng, 0, 0);
    }

    res.status(201).json({
      success: true,
      tripId,
      shareToken,
      trackingUrl: `${process.env.BASE_URL}/track/${shareToken}`
    });

  } catch (err) {
    console.log('START TRIP ERROR:', err);
    next(err);
  }
});

// PUT /api/trips/:id/location — update live GPS position
router.put('/:id/location', authenticate, async (req, res, next) => {
  try {
    const { lat, lng, speed, heading } = req.body;
    const { id } = req.params;

    await query(
      'UPDATE trips SET last_lat = $1, last_lng = $2, last_speed = $3 WHERE id = $4 AND user_id = $5',
      [lat, lng, speed || 0, id, req.user.id]
    );

    await setLocation(id, lat, lng, speed || 0, heading || 0);

    const io = req.app.get('io');
    if (io) {
      io.to(`trip_${id}`).emit('location_changed', { lat, lng, speed, heading, timestamp: new Date().toISOString() });
    }

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// PUT /api/trips/:id/checkin — manual check-in
router.put('/:id/checkin', authenticate, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { durationExtendMins } = req.body;

    const result = await query(
      'SELECT * FROM trips WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Trip not found' });

    const trip = result.rows[0];
    const newDeadline = durationExtendMins
      ? new Date(Date.now() + durationExtendMins * 60 * 1000)
      : new Date(Date.now() + trip.checkin_interval_mins * 60 * 1000);

    await query(
      'UPDATE trips SET last_checkin_at = NOW(), checkin_deadline = $1 WHERE id = $2',
      [newDeadline, id]
    );

    res.json({ success: true, nextCheckinDeadline: newDeadline });
  } catch (err) {
    next(err);
  }
});

// PUT /api/trips/:id/end — end trip safely
router.put('/:id/end', authenticate, async (req, res, next) => {
  try {
    const { id } = req.params;

    await query(
      `UPDATE trips SET status = 'safe', ended_at = NOW() WHERE id = $1 AND user_id = $2`,
      [id, req.user.id]
    );
    await delActiveTrip(req.user.id);

    // Notify contacts of safe arrival
    const contacts = await query(
      'SELECT * FROM trusted_contacts WHERE user_id = $1',
      [req.user.id]
    );
    for (const contact of contacts.rows) {
      sendSafeArrivalNotification({
        toPhone: contact.phone,
        userName: req.user.name || 'Your contact',
      }).catch(console.error);
    }

    res.json({ success: true, message: 'Trip ended safely. Contacts notified.' });
  } catch (err) {
    next(err);
  }
});

// GET /api/trips/active
router.get('/active', authenticate, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT * FROM trips WHERE user_id = $1 AND status = 'active' ORDER BY started_at DESC LIMIT 1`,
      [req.user.id]
    );
    if (!result.rows.length) return res.json({ active: false });

    const t = result.rows[0];
    res.json({
      active: true,
      trip: {
        id: t.id,
        destination: t.destination,
        shareToken: t.share_token,
        checkinDeadline: t.checkin_deadline,
        lastLat: t.last_lat,
        lastLng: t.last_lng,
        startedAt: t.started_at,
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/trips/history
router.get('/history', authenticate, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT id, destination, status, started_at, ended_at FROM trips
       WHERE user_id = $1 ORDER BY started_at DESC LIMIT 20`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

module.exports = router;

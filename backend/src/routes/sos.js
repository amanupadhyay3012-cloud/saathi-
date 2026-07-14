const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { query } = require('../database/connection');
const { authenticate } = require('../middleware/auth');
const { sendSosSmS, sendSosWhatsApp } = require('../services/smsService');

// POST /api/sos/trigger
router.post('/trigger', authenticate, async (req, res, next) => {
  try {
    const { triggerType, lat, lng, tripId, address, contacts: bodyContacts } = req.body;

    const incidentId = uuidv4();
    let shareToken = null;

    if (tripId) {
      const tripResult = await query('SELECT share_token FROM trips WHERE id = $1', [tripId]);
      if (tripResult.rows.length) shareToken = tripResult.rows[0].share_token;
      await query(`UPDATE trips SET status = 'sos' WHERE id = $1`, [tripId]);
    }
    if (!shareToken) {
      shareToken = require('crypto').randomBytes(24).toString('hex');
    }

    await query(
      `INSERT INTO incidents (id, user_id, trip_id, trigger_type, lat, lng, address, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'active')`,
      [incidentId, req.user.id, tripId || null, triggerType || 'button', lat, lng, address]
    );

    // Prefer contacts sent by the app; fall back to contacts saved on the server.
    let contactList;
    if (Array.isArray(bodyContacts) && bodyContacts.length) {
      contactList = bodyContacts
        .map((c) => ({
          id: null,
          name: c.name || 'Your contact',
          phone: c.phone,
          notify_sms: c.notifySms !== false,
          notify_whatsapp: c.notifyWhatsapp !== false,
        }))
        .filter((c) => c.phone);
    } else {
      const dbContacts = await query('SELECT * FROM trusted_contacts WHERE user_id = $1', [req.user.id]);
      contactList = dbContacts.rows;
    }

    // Can we actually send real messages, or are we only simulating (mock)?
    const live =
      process.env.MOCK_OTP !== 'true' &&
      !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);

    const alertPromises = [];
    for (const contact of contactList) {
      if (contact.notify_sms) {
        alertPromises.push(
          sendSosSmS({ toPhone: contact.phone, userName: req.user.name || 'Your contact', lat, lng, shareToken, incidentId })
            .then(async () => {
              await query(
                `INSERT INTO sos_alerts (id, incident_id, contact_id, channel, status)
                 VALUES ($1, $2, $3, 'sms', 'sent')`,
                [uuidv4(), incidentId, contact.id || null]
              ).catch(() => {});
            })
            .catch(console.error)
        );
      }
      if (contact.notify_whatsapp) {
        alertPromises.push(
          sendSosWhatsApp({ toPhone: contact.phone, userName: req.user.name || 'Your contact', lat, lng, shareToken })
            .then(async () => {
              await query(
                `INSERT INTO sos_alerts (id, incident_id, contact_id, channel, status)
                 VALUES ($1, $2, $3, 'whatsapp', 'sent')`,
                [uuidv4(), incidentId, contact.id || null]
              ).catch(() => {});
            })
            .catch(console.error)
        );
      }
    }

    Promise.all(alertPromises).catch(console.error);

    const io = req.app.get('io');
    if (io && tripId) {
      io.to(`trip_${tripId}`).emit('sos_triggered', { incidentId, lat, lng, timestamp: new Date().toISOString() });
    }

    res.status(201).json({
      success: true,
      incidentId,
      shareToken,
      contactsAlerted: contactList.length,
      delivery: live ? 'live' : 'mock',
      trackingUrl: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/track/${shareToken}`,
      message: `SOS ${live ? 'sent to' : 'simulated for'} ${contactList.length} contact(s)`,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/sos/:id/cancel
router.post('/:id/cancel', authenticate, async (req, res, next) => {
  try {
    const { pin } = req.body;
    const { id } = req.params;

    // Verify PIN
    const userResult = await query(
      'SELECT sos_cancel_pin FROM users WHERE id = $1',
      [req.user.id]
    );
    const user = userResult.rows[0];

    if (user.sos_cancel_pin && pin !== user.sos_cancel_pin) {
      return res.status(401).json({ error: 'Incorrect PIN' });
    }

    // Update incident
    const result = await query(
      `UPDATE incidents SET status = 'false_alarm', resolved_at = NOW()
       WHERE id = $1 AND user_id = $2 RETURNING *`,
      [id, req.user.id]
    );

    if (!result.rows.length) return res.status(404).json({ error: 'Incident not found' });

    const incident = result.rows[0];

    // Restore trip status if applicable
    if (incident.trip_id) {
      await query(`UPDATE trips SET status = 'active' WHERE id = $1`, [incident.trip_id]);
    }

    res.json({ success: true, message: 'SOS cancelled. Contacts will be notified.' });
  } catch (err) {
    next(err);
  }
});

// GET /api/sos/active
router.get('/active', authenticate, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT * FROM incidents WHERE user_id = $1 AND status = 'active' ORDER BY created_at DESC LIMIT 1`,
      [req.user.id]
    );
    if (!result.rows.length) return res.json({ active: false });
    res.json({ active: true, incident: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// GET /api/sos/history
router.get('/history', authenticate, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT * FROM incidents WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
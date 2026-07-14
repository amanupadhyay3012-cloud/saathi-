const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { query } = require('../database/connection');
const { authenticate } = require('../middleware/auth');

// Every circle route needs a logged-in user
router.use(authenticate);

// Make a 6-char invite code. We skip 0/O/1/I so codes are easy to read aloud.
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function makeCode() {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

// POST /api/circles  -> create a new circle
router.post('/', async (req, res, next) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Circle name is required' });
    }

    // Pick a code that isn't already taken (retry on the rare collision)
    let code = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = makeCode();
      const existing = await query('SELECT id FROM circles WHERE invite_code = $1', [candidate]);
      if (existing.rows.length === 0) {
        code = candidate;
        break;
      }
    }
    if (!code) {
      return res.status(500).json({ success: false, message: 'Could not generate a unique code, please try again' });
    }

    const circleId = uuidv4();
    await query(
      'INSERT INTO circles (id, name, invite_code, created_by) VALUES ($1, $2, $3, $4)',
      [circleId, name.trim(), code, req.user.id]
    );

    // The creator becomes the first member, as the owner
    await query(
      'INSERT INTO circle_members (circle_id, user_id, role) VALUES ($1, $2, $3)',
      [circleId, req.user.id, 'owner']
    );

    return res.json({
      success: true,
      circle: { id: circleId, name: name.trim(), invite_code: code, role: 'owner' },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/circles/join  -> join an existing circle by code
router.post('/join', async (req, res, next) => {
  try {
    let { code } = req.body;
    if (!code || !code.trim()) {
      return res.status(400).json({ success: false, message: 'Invite code is required' });
    }
    code = code.trim().toUpperCase();

    const circleResult = await query(
      'SELECT id, name, invite_code FROM circles WHERE invite_code = $1',
      [code]
    );
    if (circleResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'No circle found with that code' });
    }
    const circle = circleResult.rows[0];

    const member = await query(
      'SELECT id FROM circle_members WHERE circle_id = $1 AND user_id = $2',
      [circle.id, req.user.id]
    );
    if (member.rows.length > 0) {
      return res.status(409).json({ success: false, message: 'You are already in this circle' });
    }

    await query(
      'INSERT INTO circle_members (circle_id, user_id, role) VALUES ($1, $2, $3)',
      [circle.id, req.user.id, 'member']
    );

    return res.json({
      success: true,
      circle: { id: circle.id, name: circle.name, invite_code: circle.invite_code, role: 'member' },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/circles  -> list the circles I'm in, each with its members
router.get('/', async (req, res, next) => {
  try {
    const circlesResult = await query(
      `SELECT c.id, c.name, c.invite_code, c.created_by, cm.role
       FROM circles c
       JOIN circle_members cm ON cm.circle_id = c.id
       WHERE cm.user_id = $1
       ORDER BY c.created_at ASC`,
      [req.user.id]
    );

    const circles = [];
    for (const c of circlesResult.rows) {
      const membersResult = await query(
        `SELECT cm.user_id, u.name, u.phone, cm.role,
                cm.share_lat, cm.share_lng, cm.status, cm.location_updated_at
         FROM circle_members cm
         JOIN users u ON u.id = cm.user_id
         WHERE cm.circle_id = $1
         ORDER BY cm.joined_at ASC`,
        [c.id]
      );

      circles.push({
        id: c.id,
        name: c.name,
        invite_code: c.invite_code,
        role: c.role,
        is_owner: c.created_by === req.user.id,
        members: membersResult.rows.map((m) => ({
          user_id: m.user_id,
          name: m.name,
          phone: m.phone,
          role: m.role,
          is_me: m.user_id === req.user.id,
          lat: m.share_lat,
          lng: m.share_lng,
          status: m.status,
          location_updated_at: m.location_updated_at,
        })),
      });
    }

    return res.json({ success: true, circles });
  } catch (err) {
    next(err);
  }
});

// POST /api/circles/:id/leave  -> leave a circle
router.post('/:id/leave', async (req, res, next) => {
  try {
    const circleId = req.params.id;

    const del = await query(
      'DELETE FROM circle_members WHERE circle_id = $1 AND user_id = $2 RETURNING id',
      [circleId, req.user.id]
    );
    if (del.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'You are not in this circle' });
    }

    // If the circle is now empty, delete it so we don't leave orphans behind
    const remaining = await query(
      'SELECT id FROM circle_members WHERE circle_id = $1 LIMIT 1',
      [circleId]
    );
    if (remaining.rows.length === 0) {
      await query('DELETE FROM circles WHERE id = $1', [circleId]);
    }

    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/circles/location  -> publish my location to all my circles
// Privacy-first: the app calls this ONLY during an active trip or SOS.
// Send status:'idle' to stop sharing and wipe my coordinates.
router.post('/location', async (req, res, next) => {
  try {
    const { lat, lng, status } = req.body;
    const allowed = ['idle', 'trip', 'sos'];
    const newStatus = allowed.includes(status) ? status : 'trip';

    if (newStatus === 'idle') {
      await query(
        `UPDATE circle_members
         SET share_lat = NULL, share_lng = NULL, status = 'idle', location_updated_at = NOW()
         WHERE user_id = $1`,
        [req.user.id]
      );
      return res.json({ success: true, status: 'idle' });
    }

    if (lat == null || lng == null) {
      return res.status(400).json({ success: false, message: 'lat and lng are required' });
    }

    await query(
      `UPDATE circle_members
       SET share_lat = $1, share_lng = $2, status = $3, location_updated_at = NOW()
       WHERE user_id = $4`,
      [lat, lng, newStatus, req.user.id]
    );

    return res.json({ success: true, status: newStatus });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

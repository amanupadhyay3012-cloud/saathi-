const express = require('express');
const router = express.Router();
const { query } = require('../database/connection');
const { authenticate } = require('../middleware/auth');

// GET /api/user/profile
router.get('/profile', authenticate, async (req, res, next) => {
  try {
    const result = await query(
      'SELECT id, phone, name, avatar_url, sos_trigger_type, plan, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    const user = result.rows[0];
    res.json({
      id: user.id,
      phone: user.phone,
      name: user.name,
      avatarUrl: user.avatar_url,
      sosTriggerType: user.sos_trigger_type,
      plan: user.plan,
      createdAt: user.created_at,
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/user/profile
router.put('/profile', authenticate, async (req, res, next) => {
  try {
    const { name, avatarUrl, sosTriggerType, sosCancelPin } = req.body;

    await query(
      `UPDATE users SET
        name = COALESCE($1, name),
        avatar_url = COALESCE($2, avatar_url),
        sos_trigger_type = COALESCE($3, sos_trigger_type),
        sos_cancel_pin = COALESCE($4, sos_cancel_pin),
        updated_at = NOW()
      WHERE id = $5`,
      [name, avatarUrl, sosTriggerType, sosCancelPin, req.user.id]
    );

    res.json({ success: true, message: 'Profile updated' });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/user/account
router.delete('/account', authenticate, async (req, res, next) => {
  try {
    await query('UPDATE users SET is_active = false WHERE id = $1', [req.user.id]);
    res.json({ success: true, message: 'Account deactivated' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

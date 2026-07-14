const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { query } = require('../database/connection');
const { authenticate } = require('../middleware/auth');

const MAX_FREE_CONTACTS = 3;
const MAX_PREMIUM_CONTACTS = 10;

// GET /api/contacts
router.get('/', authenticate, async (req, res, next) => {
  try {
    const result = await query(
      'SELECT * FROM trusted_contacts WHERE user_id = $1 ORDER BY priority_order, created_at',
      [req.user.id]
    );
    res.json(result.rows.map(c => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      relationship: c.relationship,
      notifySms: c.notify_sms,
      notifyWhatsapp: c.notify_whatsapp,
      notifyPush: c.notify_push,
      priorityOrder: c.priority_order,
    })));
  } catch (err) {
    next(err);
  }
});

// POST /api/contacts
router.post('/', authenticate, async (req, res, next) => {
  try {
    const { name, phone, relationship, notifySms, notifyWhatsapp, notifyPush } = req.body;
    if (!name || !phone) return res.status(400).json({ error: 'Name and phone are required' });

    // Check contact limit based on plan
    const countResult = await query(
      'SELECT COUNT(*) FROM trusted_contacts WHERE user_id = $1',
      [req.user.id]
    );
    const count = parseInt(countResult.rows[0].count);
    const limit = req.user.plan === 'free' ? MAX_FREE_CONTACTS : MAX_PREMIUM_CONTACTS;

    if (count >= limit) {
      return res.status(403).json({
        error: `Contact limit reached (${limit} for ${req.user.plan} plan)`,
        code: 'CONTACT_LIMIT_REACHED',
      });
    }

    const result = await query(
      `INSERT INTO trusted_contacts (id, user_id, name, phone, relationship, notify_sms, notify_whatsapp, notify_push, priority_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [uuidv4(), req.user.id, name, phone, relationship, notifySms ?? true, notifyWhatsapp ?? true, notifyPush ?? true, count + 1]
    );

    const c = result.rows[0];
    res.status(201).json({
      id: c.id, name: c.name, phone: c.phone,
      relationship: c.relationship,
      notifySms: c.notify_sms, notifyWhatsapp: c.notify_whatsapp,
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/contacts/:id
router.put('/:id', authenticate, async (req, res, next) => {
  try {
    const { name, phone, relationship, notifySms, notifyWhatsapp, notifyPush } = req.body;

    const result = await query(
      `UPDATE trusted_contacts
       SET name = COALESCE($1, name),
           phone = COALESCE($2, phone),
           relationship = COALESCE($3, relationship),
           notify_sms = COALESCE($4, notify_sms),
           notify_whatsapp = COALESCE($5, notify_whatsapp),
           notify_push = COALESCE($6, notify_push)
       WHERE id = $7 AND user_id = $8 RETURNING *`,
      [name, phone, relationship, notifySms, notifyWhatsapp, notifyPush, req.params.id, req.user.id]
    );

    if (!result.rows.length) return res.status(404).json({ error: 'Contact not found' });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/contacts/:id
router.delete('/:id', authenticate, async (req, res, next) => {
  try {
    const result = await query(
      'DELETE FROM trusted_contacts WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.id, req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Contact not found' });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

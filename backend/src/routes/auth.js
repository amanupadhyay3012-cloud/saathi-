const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../database/connection');
const { sendOtp, verifyOtp } = require('../services/smsService');
const { generateTokens } = require('../middleware/auth');

// POST /api/auth/send-otp
router.post('/send-otp', async (req, res, next) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'Phone number required' });

    const cleanPhone = phone.replace(/\s/g, '');
    await sendOtp(cleanPhone);

    res.json({ success: true, message: 'OTP sent successfully' });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/verify-otp
router.post('/verify-otp', async (req, res, next) => {
  try {
    const { phone, code } = req.body;
    if (!phone || !code) return res.status(400).json({ error: 'Phone and OTP code required' });

    const cleanPhone = phone.replace(/\s/g, '');
    const isValid = await verifyOtp(cleanPhone, code);

    if (!isValid) return res.status(401).json({ error: 'Invalid or expired OTP' });

    // Upsert user
    let userResult = await query(
      'SELECT * FROM users WHERE phone = $1',
      [cleanPhone]
    );

    let user;
    let isNewUser = false;

    if (!userResult.rows.length) {
      const insertResult = await query(
        `INSERT INTO users (id, phone) VALUES ($1, $2) RETURNING *`,
        [uuidv4(), cleanPhone]
      );
      user = insertResult.rows[0];
      isNewUser = true;
    } else {
      user = userResult.rows[0];
      await query('UPDATE users SET last_seen_at = NOW() WHERE id = $1', [user.id]);
    }

    const { accessToken, refreshToken } = generateTokens(user.id);

    // Store refresh token
    await query(
      `INSERT INTO refresh_tokens (id, user_id, token, expires_at) VALUES ($1, $2, $3, NOW() + INTERVAL '30 days')`,
      [uuidv4(), user.id, refreshToken]
    );

    res.json({
      success: true,
      isNewUser,
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        phone: user.phone,
        name: user.name,
        avatarUrl: user.avatar_url,
        plan: user.plan,
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/refresh
router.post('/refresh', async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ error: 'Refresh token required' });

    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);

    const tokenResult = await query(
      'SELECT * FROM refresh_tokens WHERE token = $1 AND expires_at > NOW()',
      [refreshToken]
    );

    if (!tokenResult.rows.length) {
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }

    const { accessToken, refreshToken: newRefreshToken } = generateTokens(decoded.userId);

    // Rotate refresh token
    await query('DELETE FROM refresh_tokens WHERE token = $1', [refreshToken]);
    await query(
      `INSERT INTO refresh_tokens (id, user_id, token, expires_at) VALUES ($1, $2, $3, NOW() + INTERVAL '30 days')`,
      [uuidv4(), decoded.userId, newRefreshToken]
    );

    res.json({ accessToken, refreshToken: newRefreshToken });
  } catch (err) {
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid refresh token' });
    }
    next(err);
  }
});

// POST /api/auth/logout
router.post('/logout', async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      await query('DELETE FROM refresh_tokens WHERE token = $1', [refreshToken]);
    }
    res.json({ success: true, message: 'Logged out' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

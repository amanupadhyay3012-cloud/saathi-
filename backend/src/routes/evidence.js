const express = require('express');
const router = express.Router();
const multer = require('multer');
const AWS = require('aws-sdk');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../database/connection');
const { authenticate } = require('../middleware/auth');

const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION || 'ap-south-1',
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('audio/') || file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('Only audio and video files allowed'));
    }
  },
});

// POST /api/evidence/upload
router.post('/upload', authenticate, upload.single('file'), async (req, res, next) => {
  try {
    const { incidentId } = req.body;
    const file = req.file;

    if (!file) return res.status(400).json({ error: 'No file provided' });

    const evidenceId = uuidv4();
    const ext = file.mimetype.startsWith('audio/') ? 'aac' : 'mp4';
    const key = `evidence/${req.user.id}/${evidenceId}.${ext}`;
    const type = file.mimetype.startsWith('audio/') ? 'audio' : 'video';

    let fileUrl = `mock-url/${key}`;

    // Upload to S3 if configured
    if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_ACCESS_KEY_ID !== 'your_aws_access_key') {
      const s3Result = await s3.upload({
        Bucket: process.env.AWS_S3_BUCKET,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
        ServerSideEncryption: 'AES256',
        Metadata: { userId: req.user.id, incidentId: incidentId || '' },
      }).promise();
      fileUrl = s3Result.Location;
    }

    await query(
      `INSERT INTO evidence (id, user_id, incident_id, type, file_url, file_size_bytes)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [evidenceId, req.user.id, incidentId || null, type, fileUrl, file.size]
    );

    res.status(201).json({ success: true, evidenceId, url: fileUrl });
  } catch (err) {
    next(err);
  }
});

// GET /api/evidence
router.get('/', authenticate, async (req, res, next) => {
  try {
    const result = await query(
      'SELECT id, type, file_url, file_size_bytes, duration_secs, created_at FROM evidence WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/evidence/:id
router.delete('/:id', authenticate, async (req, res, next) => {
  try {
    const result = await query(
      'DELETE FROM evidence WHERE id = $1 AND user_id = $2 RETURNING file_url',
      [req.params.id, req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });

    // Delete from S3 if real URL
    const fileUrl = result.rows[0].file_url;
    if (!fileUrl.startsWith('mock-url')) {
      const key = fileUrl.split('.amazonaws.com/')[1];
      if (key) {
        s3.deleteObject({ Bucket: process.env.AWS_S3_BUCKET, Key: key }, () => {});
      }
    }

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

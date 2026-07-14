const { query } = require('../database/connection');
const { sendSosSmS, sendSosWhatsApp } = require('./smsService');
const { v4: uuidv4 } = require('uuid');

// Called every minute by cron job
const checkExpiredTimers = async (io) => {
  const now = new Date();

  // Find active trips where check-in deadline has passed
  const result = await query(`
    SELECT t.id, t.user_id, t.share_token, t.checkin_deadline,
           u.name as user_name, u.phone as user_phone,
           t.last_lat, t.last_lng
    FROM trips t
    JOIN users u ON t.user_id = u.id
    WHERE t.status = 'active'
      AND t.checkin_deadline IS NOT NULL
      AND t.checkin_deadline < $1
  `, [now]);

  for (const trip of result.rows) {
    console.log(`⏰ Check-in expired for trip ${trip.id} — triggering auto SOS`);

    // Create incident
    const incidentResult = await query(`
      INSERT INTO incidents (id, user_id, trip_id, trigger_type, lat, lng, status)
      VALUES ($1, $2, $3, 'timer', $4, $5, 'active')
      RETURNING id
    `, [uuidv4(), trip.user_id, trip.id, trip.last_lat, trip.last_lng]);

    const incidentId = incidentResult.rows[0].id;

    // Update trip to SOS status
    await query(`UPDATE trips SET status = 'sos' WHERE id = $1`, [trip.id]);

    // Get contacts and alert them
    const contacts = await query(`
      SELECT * FROM trusted_contacts WHERE user_id = $1
    `, [trip.user_id]);

    for (const contact of contacts.rows) {
      if (contact.notify_sms) {
        await sendSosSmS({
          toPhone: contact.phone,
          userName: trip.user_name,
          lat: trip.last_lat,
          lng: trip.last_lng,
          shareToken: trip.share_token,
          incidentId,
        }).catch(console.error);
      }
      if (contact.notify_whatsapp) {
        await sendSosWhatsApp({
          toPhone: contact.phone,
          userName: trip.user_name,
          lat: trip.last_lat,
          lng: trip.last_lng,
          shareToken: trip.share_token,
        }).catch(console.error);
      }
    }

    // Emit socket event
    if (io) {
      io.to(`trip_${trip.id}`).emit('sos_auto_triggered', {
        incidentId,
        reason: 'check_in_timer_expired',
        timestamp: now.toISOString(),
      });
    }
  }
};

module.exports = { checkExpiredTimers };

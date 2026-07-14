const twilio = require('twilio');

const client = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
  ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null;

// ── OTP ─────────────────────────────────────────────────────
const sendOtp = async (phone) => {
  if (process.env.MOCK_OTP === 'true') {
    console.log(`[MOCK OTP] ${phone} → ${process.env.MOCK_OTP_CODE || '123456'}`);
    return { success: true, mock: true };
  }
  if (!client) throw new Error('Twilio not configured');
  const verification = await client.verify.v2
    .services(process.env.TWILIO_VERIFY_SERVICE_SID)
    .verifications.create({ to: phone, channel: 'sms' });
  return { success: true, sid: verification.sid };
};

const verifyOtp = async (phone, code) => {
  if (process.env.MOCK_OTP === 'true') {
    return code === (process.env.MOCK_OTP_CODE || '123456');
  }
  if (!client) throw new Error('Twilio not configured');
  const result = await client.verify.v2
    .services(process.env.TWILIO_VERIFY_SERVICE_SID)
    .verificationChecks.create({ to: phone, code });
  return result.status === 'approved';
};

// ── SOS SMS alert ────────────────────────────────────────────
const sendSosSmS = async ({ toPhone, userName, lat, lng, shareToken, incidentId }) => {
  const trackingUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/track/${shareToken}`;
  const mapsUrl = `https://maps.google.com/?q=${lat},${lng}`;
  const message = `🚨 EMERGENCY ALERT from SAATHI\n\n${userName} has triggered an SOS!\n\n📍 Last location:\n${mapsUrl}\n\n🔴 Live tracking:\n${trackingUrl}\n\nPlease contact them immediately or call 112.`;

  if (process.env.MOCK_OTP === 'true' || !client) {
    console.log(`[MOCK SMS] To: ${toPhone}\n${message}`);
    return { success: true, mock: true };
  }

  const msg = await client.messages.create({
    body: message,
    from: process.env.TWILIO_PHONE_NUMBER,
    to: toPhone,
  });
  return { success: true, sid: msg.sid };
};

// ── SOS WhatsApp alert ───────────────────────────────────────
const sendSosWhatsApp = async ({ toPhone, userName, lat, lng, shareToken }) => {
  const trackingUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/track/${shareToken}`;
  const mapsUrl = `https://maps.google.com/?q=${lat},${lng}`;
  const message = `🚨 *EMERGENCY ALERT — SAATHI*\n\n*${userName}* needs help!\n\n📍 *Current location:*\n${mapsUrl}\n\n🔴 *Watch live on map:*\n${trackingUrl}\n\n_Please check on them immediately or call 112._`;

  if (process.env.MOCK_OTP === 'true' || !client) {
    console.log(`[MOCK WHATSAPP] To: ${toPhone}\n${message}`);
    return { success: true, mock: true };
  }

  const msg = await client.messages.create({
    body: message,
    from: process.env.TWILIO_WHATSAPP_NUMBER,
    to: `whatsapp:${toPhone}`,
  });
  return { success: true, sid: msg.sid };
};

// ── Trip started notification ────────────────────────────────
const sendTripStartNotification = async ({ toPhone, userName, destination, shareToken }) => {
  const trackingUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/track/${shareToken}`;
  const message = `👋 Hi! ${userName} started a safe trip to ${destination || 'their destination'}.\n\nTrack them live here: ${trackingUrl}\n\nPowered by SAATHI Safety App`;

  if (process.env.MOCK_OTP === 'true' || !client) {
    console.log(`[MOCK TRIP SMS] To: ${toPhone}\n${message}`);
    return { success: true, mock: true };
  }

  const msg = await client.messages.create({
    body: message,
    from: process.env.TWILIO_PHONE_NUMBER,
    to: toPhone,
  });
  return { success: true, sid: msg.sid };
};

// ── Trip safe arrival ────────────────────────────────────────
const sendSafeArrivalNotification = async ({ toPhone, userName }) => {
  const message = `✅ ${userName} has arrived safely! No need to worry. — SAATHI`;

  if (process.env.MOCK_OTP === 'true' || !client) {
    console.log(`[MOCK SAFE SMS] To: ${toPhone}\n${message}`);
    return { success: true, mock: true };
  }

  await client.messages.create({
    body: message,
    from: process.env.TWILIO_PHONE_NUMBER,
    to: toPhone,
  });
};

module.exports = {
  sendOtp, verifyOtp,
  sendSosSmS, sendSosWhatsApp,
  sendTripStartNotification, sendSafeArrivalNotification,
};

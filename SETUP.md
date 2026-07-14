# SAATHI — Local Setup Guide

## Prerequisites

Install these first:
- Node.js v18+ → https://nodejs.org
- PostgreSQL 14+ → https://postgresql.org/download
- Redis → https://redis.io/docs/getting-started
- Expo CLI → `npm install -g expo-cli`
- Expo Go app on your phone → App Store / Play Store

---

## Step 1 — Database Setup

```bash
# Create PostgreSQL database
psql -U postgres
CREATE DATABASE saathi_db;
\q

# Run migrations
cd saathi/backend
psql -U postgres -d saathi_db -f src/database/migrations/001_initial.sql
```

---

## Step 2 — Backend Setup

```bash
cd saathi/backend

# Install dependencies
npm install

# Copy env file
cp .env.example .env

# Edit .env — the minimum for local dev (mock OTP mode):
# PORT=5000
# DATABASE_URL=postgresql://postgres:yourpassword@localhost:5432/saathi_db
# REDIS_URL=redis://localhost:6379
# JWT_SECRET=any-long-random-string-here
# JWT_REFRESH_SECRET=another-long-random-string
# MOCK_OTP=true           ← uses code 123456 for all OTPs
# MOCK_OTP_CODE=123456

# Start Redis (in a separate terminal)
redis-server

# Start backend
npm run dev
# → Server running on http://localhost:5000
# → Health check: http://localhost:5000/health
```

---

## Step 3 — Mobile App Setup

```bash
cd saathi/mobile

# Install dependencies
npm install

# Update the API base URL for your device
# Edit: src/services/api.js → BASE_URL

# Android emulator:
# export const BASE_URL = 'http://10.0.2.2:5000';

# iOS simulator:
# export const BASE_URL = 'http://localhost:5000';

# Real phone on same WiFi:
# Find your computer's local IP: ifconfig | grep "inet 192"
# export const BASE_URL = 'http://192.168.1.XXX:5000';

# Start Expo
npx expo start

# Scan the QR code with Expo Go app
```

---

## Step 4 — Test the App

1. Open the app on your phone
2. Enter any phone number
3. OTP code is always `123456` in dev mode (MOCK_OTP=true)
4. Complete profile setup
5. Add a trusted contact
6. Test SOS — check backend console for "[MOCK SMS]" logs

---

## Optional — Add Real SMS (Twilio)

1. Create account at https://twilio.com
2. Get Account SID, Auth Token, Verify Service SID
3. Add to .env:
   ```
   MOCK_OTP=false
   TWILIO_ACCOUNT_SID=ACxxxxxxxx
   TWILIO_AUTH_TOKEN=xxxxxxxx
   TWILIO_VERIFY_SERVICE_SID=VAxxxxxxxx
   TWILIO_PHONE_NUMBER=+1XXXXXXXXXX
   ```

## Optional — Real Maps (Google Maps)

1. Get API key from https://console.cloud.google.com
2. Enable: Maps SDK Android, Maps SDK iOS, Places API, Geocoding API
3. Add to .env: `GOOGLE_MAPS_API_KEY=your_key`

## Optional — Evidence Storage (AWS S3)

1. Create S3 bucket named `saathi-evidence`
2. Enable server-side encryption (AES-256)
3. Add to .env:
   ```
   AWS_ACCESS_KEY_ID=your_key
   AWS_SECRET_ACCESS_KEY=your_secret
   AWS_REGION=ap-south-1
   AWS_S3_BUCKET=saathi-evidence
   ```

---

## Project Structure

```
saathi/
├── mobile/                    React Native (Expo) App
│   ├── App.js                 Root entry
│   ├── src/
│   │   ├── screens/           All 13 screens
│   │   ├── navigation/        Stack + Tab navigator
│   │   ├── context/           Global state (AppContext)
│   │   ├── services/          API, Location, SOS, Notifications
│   │   └── utils/             Colors, helpers
│
├── backend/                   Node.js + Express API
│   ├── server.js              Entry + Socket.io
│   ├── src/
│   │   ├── routes/            auth, users, contacts, trips, sos, evidence, nearby, track
│   │   ├── services/          SMS, Redis, Timer
│   │   ├── middleware/        Auth (JWT), errorHandler
│   │   └── database/          PostgreSQL connection + SQL migrations
│
└── README.md
```

---

## Troubleshooting

| Issue | Fix |
|---|---|
| "Cannot connect to backend" | Check BASE_URL in api.js matches your IP |
| "OTP not working" | Ensure MOCK_OTP=true in .env and use 123456 |
| "Location permission denied" | Manually grant in phone settings |
| "Redis connection failed" | Run `redis-server` in a separate terminal |
| "DB migration error" | Check DATABASE_URL in .env is correct |
| Shake not working | Test on real device, not simulator |

---

## Emergency Numbers (India)
- 112 — National Emergency
- 1091 — Women's Helpline
- 100 — Police
- 102 — Ambulance

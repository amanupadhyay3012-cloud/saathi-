# SAATHI — Women Safety App

A complete personal safety companion app with React Native (Expo) frontend and Node.js backend.

---

## Project Structure

```
saathi/
├── mobile/     → React Native (Expo) app
├── backend/    → Node.js + Express API server
└── README.md
```

---

## Quick Start

### 1. Backend Setup

```bash
cd backend
npm install
cp .env.example .env
# Fill in your .env values (DB, Redis, Twilio, JWT secret)

# Run PostgreSQL migrations
psql -U postgres -d saathi_db -f src/database/migrations/001_initial.sql

# Start server
npm run dev
```

### 2. Mobile App Setup

```bash
cd mobile
npm install

# Update src/services/api.js → BASE_URL to your backend IP
# e.g., http://192.168.1.10:5000

npx expo start
# Scan QR code with Expo Go app
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Mobile | React Native + Expo SDK 50 |
| Navigation | React Navigation v6 |
| Backend | Node.js + Express |
| Database | PostgreSQL |
| Cache | Redis |
| Real-time | Socket.io |
| Auth | JWT + OTP (Twilio Verify) |
| Maps | react-native-maps + Google Maps |
| SMS | Twilio / MSG91 |
| Storage | AWS S3 (evidence files) |
| Notifications | Expo Push Notifications |

---

## Environment Variables

### Backend `.env`
```
PORT=5000
DATABASE_URL=postgresql://postgres:password@localhost:5432/saathi_db
REDIS_URL=redis://localhost:6379
JWT_SECRET=your_super_secret_key_here
JWT_REFRESH_SECRET=your_refresh_secret_here
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxx
TWILIO_VERIFY_SERVICE_SID=VAxxxxxxxxxxxxxxxx
TWILIO_PHONE_NUMBER=+1XXXXXXXXXX
AWS_ACCESS_KEY_ID=your_aws_key
AWS_SECRET_ACCESS_KEY=your_aws_secret
AWS_REGION=ap-south-1
AWS_S3_BUCKET=saathi-evidence
GOOGLE_MAPS_API_KEY=your_google_maps_key
NODE_ENV=development
```

---

## Key Features (MVP)
- Emergency SOS button (one tap + shake trigger + power button)
- Live location sharing with trusted contacts
- Fake call feature
- Auto check-in timer with auto-SOS
- Nearby police stations and hospitals
- Silent audio recording on SOS trigger
- Encrypted evidence storage
- WhatsApp + SMS alerts with live tracking link

---

## App Screens

1. Splash Screen
2. Onboarding (3 steps)
3. Phone OTP Login
4. Home / Guardian Screen
5. SOS Active Screen
6. Safe Trip Screen
7. Trusted Contacts List
8. Add Contact
9. Fake Call Setup + Active Call UI
10. Nearby Help Map
11. Check-In Timer
12. Evidence Recordings
13. Settings

---

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| POST | /api/auth/send-otp | Send OTP to phone |
| POST | /api/auth/verify-otp | Verify OTP + return JWT |
| POST | /api/auth/refresh | Refresh access token |
| GET | /api/user/profile | Get user profile |
| PUT | /api/user/profile | Update profile |
| GET | /api/contacts | List contacts |
| POST | /api/contacts | Add contact |
| DELETE | /api/contacts/:id | Remove contact |
| POST | /api/trips/start | Start safe trip |
| PUT | /api/trips/:id/checkin | Check in during trip |
| PUT | /api/trips/:id/end | End trip safely |
| GET | /api/trips/:id/location | Get live location (for contacts) |
| POST | /api/sos/trigger | 🚨 Trigger SOS |
| POST | /api/sos/:id/cancel | Cancel SOS with PIN |
| POST | /api/evidence/upload | Upload encrypted evidence |
| GET | /api/evidence | List user's evidence |
| DELETE | /api/evidence/:id | Delete evidence |
| GET | /api/nearby | Nearby police/hospitals |
| GET | /track/:token | Public live tracking page |

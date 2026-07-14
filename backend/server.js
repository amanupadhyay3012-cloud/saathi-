require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const cron = require('node-cron');
const circleRoutes = require('./src/routes/circles');
const { connectDB, runMigrations } = require('./src/database/connection');
const { connectRedis } = require('./src/services/redisService');
const { checkExpiredTimers } = require('./src/services/timerService');
const errorHandler = require('./src/middleware/errorHandler');

// Routes
console.log('Nearby API HIT');
const authRoutes = require('./src/routes/auth');
const userRoutes = require('./src/routes/users');
const contactRoutes = require('./src/routes/contacts');
const tripRoutes = require('./src/routes/trips');
const sosRoutes = require('./src/routes/sos');
const evidenceRoutes = require('./src/routes/evidence');
const nearbyRoutes = require('./src/routes/nearby');
const trackRoutes = require('./src/routes/track');

const app = express();
const server = http.createServer(app);

const allowedOrigin = process.env.FRONTEND_URL || '*';
// Socket.io for real-time location
const io = new Server(server, {
  cors: {
    origin: allowedOrigin,
    methods: ['GET', 'POST'],
  },
});

// Make io accessible in routes
app.set('io', io);

// Security middleware
app.use(helmet());

app.use(
  cors({
    origin: allowedOrigin,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Body parser with limit
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests. Please try again later.',
  },
});

const sosLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'SOS rate limit exceeded. Please wait before trying again.',
  },
});

app.use('/api', apiLimiter);
app.use('/api/sos', sosLimiter);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/contacts', contactRoutes);
app.use('/api/trips', tripRoutes);
app.use('/api/sos', sosRoutes);
app.use('/api/evidence', evidenceRoutes);
app.use('/api/nearby', nearbyRoutes);
app.use('/track', trackRoutes);
app.use('/api/circles', circleRoutes);
// Health check
app.get('/health', (req, res) => {
  res.json({
    success: true,
    status: 'ok',
    app: 'SAATHI Backend',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// Socket.io events for real-time location tracking
io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);

  socket.on('join_trip', ({ tripId }) => {
    if (!tripId) return;

    socket.join(`trip_${tripId}`);
    console.log(`Socket joined trip room: trip_${tripId}`);
  });

  socket.on('watch_trip', ({ tripToken }) => {
    if (!tripToken) return;

    socket.join(`track_${tripToken}`);
    console.log(`Watcher joined: track_${tripToken}`);
  });

  socket.on('location_update', ({ tripId, lat, lng, speed, heading, timestamp }) => {
    if (!tripId || lat === undefined || lng === undefined) return;

    io.to(`trip_${tripId}`).emit('location_changed', {
      lat,
      lng,
      speed,
      heading,
      timestamp: timestamp || new Date().toISOString(),
    });
  });

  socket.on('sos_triggered', ({ tripId, incidentId }) => {
    if (!tripId) return;

    io.to(`trip_${tripId}`).emit('sos_alert', {
      incidentId,
      timestamp: new Date().toISOString(),
    });
  });

  socket.on('disconnect', () => {
    console.log('Socket disconnected:', socket.id);
  });
});

// Cron: check expired check-in timers every minute
cron.schedule('* * * * *', async () => {
  try {
    await checkExpiredTimers(io);
  } catch (err) {
    console.error('Timer check error:', err.message);
  }
});

// 404 handler — keep this after all routes
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
  });
});

// Error handler — keep this last
app.use(errorHandler);

// Start server
const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    await connectDB();
    await runMigrations();
    await connectRedis();

    server.listen(PORT, () => {
      console.log(`\n🛡️  SAATHI Backend running on port ${PORT}`);
      console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🔗 Health check: http://localhost:${PORT}/health\n`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

startServer();
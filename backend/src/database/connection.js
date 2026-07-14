const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

let pool;

const connectDB = async () => {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });

  try {
    const client = await pool.connect();
    console.log('✅ PostgreSQL connected');
    client.release();
  } catch (err) {
    console.error('❌ PostgreSQL connection failed:', err.message);
    throw err;
  }
};

const query = async (text, params) => {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  if (process.env.NODE_ENV === 'development') {
    console.log('DB Query:', { text: text.substring(0, 80), duration, rows: res.rowCount });
  }
  return res;
};

const getClient = async () => {
  const client = await pool.connect();
  const originalQuery = client.query.bind(client);
  const release = client.release.bind(client);
  client.release = () => {
    client.query = originalQuery;
    client.release = release;
    return release();
  };
  return client;
};

const runMigrations = async () => {
  try {
    const sqlPath = path.join(__dirname, 'migrations', '001_initial.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    await pool.query(sql);
    console.log('✅ Migrations applied (tables ready)');
  } catch (err) {
    console.error('⚠️  Migration error:', err.message);
  }
};

module.exports = { connectDB, runMigrations, query, getClient };

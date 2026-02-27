/**
 * MediLock - Database Configuration
 * MySQL Connection with connection pooling
 */

const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'Shri@3109',
  database: process.env.DB_NAME || 'medilock',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  // SSL configuration for production
  ssl: (process.env.NODE_ENV === 'production' || (process.env.DB_HOST && process.env.DB_HOST !== 'localhost' && process.env.DB_HOST !== '127.0.0.1')) ? {
    rejectUnauthorized: false
  } : undefined
});

// Test connection on startup
const testConnection = async () => {
  try {
    const connection = await pool.getConnection();
    console.log('✓ Database connected successfully');
    console.log(`  Host: ${process.env.DB_HOST || 'localhost'}`);
    console.log(`  Database: ${process.env.DB_NAME || 'medilock'}`);
    console.log(`  SSL: ${connection.config.ssl ? 'Enabled' : 'Disabled'}`);
    console.log(`  Location: India Data Center (DPDP Compliant)`);
    connection.release();
    return true;
  } catch (error) {
    console.error('✗ Database connection failed:', error.message);
    return false;
  }
};

// Execute query with automatic connection management
const query = async (sql, params) => {
  try {
    const [rows] = await pool.execute(sql, params);
    return rows;
  } catch (error) {
    console.error('Database query error:', error.message);
    throw error;
  }
};

// Execute transaction
const transaction = async (callback) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    connection.release();
    return result;
  } catch (error) {
    await connection.rollback();
    connection.release();
    throw error;
  }
};

// Get single row
const getOne = async (sql, params) => {
  const rows = await query(sql, params);
  return rows[0] || null;
};

// Get all rows
const getAll = async (sql, params) => {
  return await query(sql, params);
};

// Insert and return last insert ID
const insert = async (sql, params) => {
  const result = await query(sql, params);
  return result.insertId;
};

// Update and return affected rows
const update = async (sql, params) => {
  const result = await query(sql, params);
  return result.affectedRows;
};

// Delete and return affected rows
const remove = async (sql, params) => {
  const result = await query(sql, params);
  return result.affectedRows;
};

module.exports = {
  pool,
  query,
  getOne,
  getAll,
  insert,
  update,
  remove,
  transaction,
  testConnection
};

const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
require('dotenv').config();

async function resetPassword() {
  console.log('Connecting to database...');
  try {
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      port: parseInt(process.env.DB_PORT),
      database: process.env.DB_NAME,
      ssl: { rejectUnauthorized: false }
    });

    const email = 'patient1@medilock.in';
    const newPassword = 'admin123';
    
    console.log(`Generating new hash for password: ${newPassword}`);
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(newPassword, salt);

    console.log(`Updating password for ${email}...`);
    const [result] = await connection.execute(
      'UPDATE users SET password_hash = ? WHERE email = ?',
      [hash, email]
    );

    if (result.affectedRows > 0) {
      console.log('✅ Password updated successfully!');
    } else {
      console.log('❌ User not found. Please check the email.');
    }

    await connection.end();
  } catch (error) {
    console.error('Error:', error);
  }
}

resetPassword();
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const email = process.argv[2] || 'dr.sharma@medilock.in';
const password = process.argv[3] || 'admin123';

async function fixLogin() {
  console.log(`\n🔧 Fixing login for: ${email}`);
  console.log(`📡 Connecting to: ${process.env.DB_HOST || 'localhost'}`);

  try {
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD,
      port: parseInt(process.env.DB_PORT || 3306),
      database: process.env.DB_NAME || 'medilock',
      ssl: (process.env.DB_HOST && process.env.DB_HOST !== 'localhost' && process.env.DB_HOST !== '127.0.0.1') ? { rejectUnauthorized: false } : undefined
    });

    console.log('✓ Database connected');

    // 1. Check User
    const [users] = await connection.execute('SELECT * FROM users WHERE email = ?', [email]);
    
    if (users.length === 0) {
      console.log(`❌ User ${email} not found!`);
      console.log('  -> Please register this user first via the registration page.');
      await connection.end();
      return;
    }

    const user = users[0];
    console.log(`✓ User found (ID: ${user.id}, Role: ${user.role})`);

    // 2. Check Role Profile
    if (user.role === 'doctor') {
      const [doctors] = await connection.execute('SELECT * FROM doctors WHERE user_id = ?', [user.id]);
      if (doctors.length === 0) {
        console.log('⚠️ Missing Doctor Profile! Creating default profile...');
        await connection.execute(
          'INSERT INTO doctors (user_id, specialization, consultation_fee, is_available) VALUES (?, ?, ?, ?)', 
          [user.id, 'General Medicine', 500, true]
        );
        console.log('✓ Doctor profile created');
      } else {
        console.log('✓ Doctor profile exists');
      }
    } else if (user.role === 'patient') {
      const [patients] = await connection.execute('SELECT * FROM patients WHERE user_id = ?', [user.id]);
      if (patients.length === 0) {
        console.log('⚠️ Missing Patient Profile! Creating default profile...');
        await connection.execute(
          'INSERT INTO patients (user_id, date_of_birth, gender) VALUES (?, ?, ?)', 
          [user.id, '1990-01-01', 'other']
        );
        console.log('✓ Patient profile created');
      } else {
        console.log('✓ Patient profile exists');
      }
    }

    // 3. Reset Password
    console.log(`🔄 Resetting password to: ${password}`);
    const salt = await bcrypt.genSalt(12);
    const hash = await bcrypt.hash(password, salt);
    
    await connection.execute(
      'UPDATE users SET password_hash = ?, is_active = 1, otp_verified = 0 WHERE id = ?', 
      [hash, user.id]
    );
    
    console.log('✓ Password updated');
    console.log('✓ Account activated');
    console.log('✓ OTP requirement disabled (for easy login)');
    console.log('\n✅ Login fix complete! Try logging in now.');

    await connection.end();
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

fixLogin();
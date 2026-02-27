const mysql = require('mysql2/promise');
require('dotenv').config();

async function checkUsers() {
  console.log('Connecting to Database...');
  try {
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      port: process.env.DB_PORT,
      database: process.env.DB_NAME,
      ssl: { rejectUnauthorized: false }
    });

    console.log('Connected! Fetching users...');
    const [rows] = await connection.execute('SELECT id, email, role FROM users');
    
    console.log('\n--- USERS IN CLOUD DATABASE ---');
    rows.forEach(user => {
      console.log(`ID: ${user.id} | Email: ${user.email} | Role: ${user.role}`);
    });
    console.log('-------------------------------\n');
    console.log('NOTE: Default password for sample users is: admin123');
    
    await connection.end();
  } catch (error) {
    console.error('Error:', error.message);
  }
}

checkUsers();
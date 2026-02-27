const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function setupDatabase() {
  console.log('Connecting to database...');
  
  try {
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      port: process.env.DB_PORT,
      database: process.env.DB_NAME,
      multipleStatements: true,
      ssl: { rejectUnauthorized: false }
    });

    console.log('Connected! Reading schema...');
    
    // Read the schema file
    const schemaPath = path.join(__dirname, '..', 'database', 'schema.sql');
    let schemaSql = fs.readFileSync(schemaPath, 'utf8');

    // Remove "CREATE DATABASE" lines since we are using the default Aiven DB
    schemaSql = schemaSql.replace(/CREATE DATABASE.*;/g, '');
    schemaSql = schemaSql.replace(/USE medilock;/g, '');

    console.log('Running schema...');
    await connection.query(schemaSql);

    console.log('✅ Database setup complete! Tables created successfully.');
    await connection.end();
  } catch (error) {
    console.error('❌ Error setting up database:', error);
  }
}

setupDatabase();
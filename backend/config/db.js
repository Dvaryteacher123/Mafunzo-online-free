const mysql = require('mysql2/promise');
require('dotenv').config(); // Inasoma data kutoka kwenye .env file

// Kuunda connection pool (hii ni bora kuliko connection moja kwa ajili ya performance)
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'mfumo_wako_db',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Kujaribu kuunganisha ili kuhakikisha configuration ni sahihi
pool.getConnection()
    .then(connection => {
        console.log("✅ Database imeunganishwa kwa mafanikio!");
        connection.release();
    })
    .catch(err => {
        console.error("❌ Imeshindikana kuunganisha na Database:", err.message);
    });

module.exports = pool;


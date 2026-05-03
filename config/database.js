const mysql = require('mysql');
//Database Connection

const connection=mysql.createPool({
    connectionLimit: 6,
    host: "climavert12.mysql.database.azure.com",
    user: "Climavert_12",
    password: "Tazeen_12",
    database: "carboncredit",
    port: 3306,
    ssl: true
})
connection.getConnection((err, conn) => {
    if (err) {
        return console.log(err);
    }
    // One-time migration: add chain_listing_id column if it doesn't exist
    conn.query(
        `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'marketplace' AND COLUMN_NAME = 'chain_listing_id'`,
        (checkErr, rows) => {
            if (checkErr) { console.warn('[DB Migration] check failed:', checkErr.message); return; }
            if (rows[0].cnt === 0) {
                conn.query(
                    `ALTER TABLE marketplace ADD COLUMN chain_listing_id INT NULL`,
                    (alterErr) => {
                        if (alterErr) console.warn('[DB Migration] chain_listing_id:', alterErr.message);
                        else console.log('[DB Migration] Added chain_listing_id column to marketplace.');
                    }
                );
            }
        }
    );
    conn.release();
    console.log("Database connected successfully!");
});

module.exports = connection;
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const pg_1 = require("pg");
const pool = new pg_1.Pool({ connectionString: process.env.DATABASE_URL });
async function resetDb() {
    try {
        console.log('Dropping public schema...');
        await pool.query('DROP SCHEMA public CASCADE;');
        console.log('Recreating public schema...');
        await pool.query('CREATE SCHEMA public;');
        console.log('Granting permissions...');
        await pool.query('GRANT ALL ON SCHEMA public TO public;');
        console.log('Database reset successfully!');
    }
    catch (err) {
        console.error('Error resetting database:', err);
    }
    finally {
        await pool.end();
    }
}
resetDb();

import { db } from './index'
import { sql } from 'drizzle-orm/'

async function testConnection() {
    try {
        const result = await db.execute(sql`SELECT 1`)
        console.log('✅ Database connected successfully!')
        console.log('Result:', result)
    } catch (error) {
        console.error('❌ Database connection failed!')
        console.error(error)
    } finally {
        process.exit(0)
    }
}

testConnection()
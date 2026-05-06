const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const cors = require('cors');
const port = process.env.port || 8080;


const app = express();

app.use(cors());
const pool = new Pool({
    user: process.env.DB_USER || 'neondb_owner',
    host: process.env.DB_HOST || 'ep-super-scene-ances3km.c-6.us-east-1.aws.neon.tech',
    database: process.env.DB_NAME || 'neondb',
    password: process.env.DB_PASSWORD || 'npg_uxdP7Y8mhMnC',
    port: process.env.DB_PORT || 5432,
    ssl: {
        rejectUnauthorized: false   // ✅ required for Neon
    }
});


app.use(express.static('public'));
app.use(express.json());


// Fetch all stock
app.get('/api/stock', async (req, res) => {
    try {
        console.log('Fetching stock...');
        const result = await pool.query('SELECT id, name, current_stock, required_stock, category FROM medicines');
        console.log('Stock result:', result.rows);
        res.json(result.rows);
    } catch (err) {
        res.status(500).send(err.message);
    }
});


// Fetch wanting list (stock below threshold)
app.get('/api/wanting-list', async (req, res) => {
    try {
        const query = 'SELECT id, name, current_stock, required_stock, category FROM medicines WHERE current_stock < required_stock';
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (err) {
        res.status(500).send(err.message);
    }
});

app.post('/api/record-sale', async (req, res) => {
    const { id, qty } = req.body;

    try {
        // Update query with a check to prevent negative stock
        const query = `
            UPDATE medicines 
            SET current_stock = current_stock - $1 
            WHERE id = $2 AND current_stock >= $1
            RETURNING *;
        `;
        const result = await pool.query(query, [qty, id]);

        if (result.rowCount === 0) {
            return res.status(400).json({ error: "Insufficient stock or item not found." });
        }

        res.json({ message: "Sale successful", updatedItem: result.rows[0] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/add-medicine', async (req, res) => {
    const { name, category, current_stock, required_stock, price } = req.body;

    try {
        // DO NOT include 'id' in the column list or values
        const query = `
            INSERT INTO medicines (name, current_stock, required_stock, price, category) 
            VALUES ($1, $2, $3, $4, $5) 
            RETURNING *;
        `;
        
        const values = [
            name, 
            current_stock || 0, 
            required_stock || 0, 
            price || 0.00, 
            category
        ];
        
        const result = await pool.query(query, values);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Database Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});


app.listen(port, () => console.log('Server running on http://localhost:3000'));

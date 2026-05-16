const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const cors = require('cors');
const port = process.env.PORT || 3000; // Capitalized PORT for consistency

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

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Point directly to the index.html inside the public folder
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Fetch all stock with strip-to-tablet calculation adjustments
app.get('/api/stock', async (req, res) => {
    try {
        console.log('Fetching stock...');
        const query = `
            SELECT id, name, required_stock, category, price_per_strip, tablets_per_strip, strips_stock, loose_tablets_stock,
            ROUND(strips_stock + (loose_tablets_stock::NUMERIC / tablets_per_strip), 2) AS current_stock,
            ROUND((strips_stock * price_per_strip) + (loose_tablets_stock::NUMERIC * (price_per_strip / tablets_per_strip)), 2) AS total_mrp
            FROM medicines
            WHERE (strips_stock > 0 OR loose_tablets_stock > 0)
            ORDER BY name ASC;
        `;
        const result = await pool.query(query);
        console.log('Stock result:', result.rows);
        res.json(result.rows);
    } catch (err) {
        res.status(500).send(err.message);
    }
});

// Fetch wanting list (checks if cumulative fractional stock is lower than required_stock)
app.get('/api/wanting-list', async (req, res) => {
    try {
        const query = `
            SELECT id, name, required_stock, category, price_per_strip, tablets_per_strip, strips_stock, loose_tablets_stock,
            ROUND(strips_stock + (loose_tablets_stock::NUMERIC / tablets_per_strip), 2) AS current_stock
            FROM medicines 
            WHERE (strips_stock + (loose_tablets_stock::NUMERIC / tablets_per_strip)) < required_stock;
        `;
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (err) {
        res.status(500).send(err.message);
    }
});

// Record a sale by reducing total inventory at the unit (tablet) level
app.post('/api/record-sale', async (req, res) => {
    const { id, qty } = req.body; // qty expected as individual units/tablets sold

    try {
        // 1. Fetch current stock details first to perform accurate unit conversion math
        const checkQuery = 'SELECT strips_stock, loose_tablets_stock, tablets_per_strip FROM medicines WHERE id = $1';
        const checkResult = await pool.query(checkQuery, [id]);

        if (checkResult.rowCount === 0) {
            return res.status(404).json({ error: "Medicine item not found." });
        }

        const { strips_stock, loose_tablets_stock, tablets_per_strip } = checkResult.rows[0];
        
        // Convert everything to individual units to check limits accurately
        const totalUnitsAvailable = (strips_stock * tablets_per_strip) + loose_tablets_stock;

        if (totalUnitsAvailable < qty) {
            return res.status(400).json({ error: "Insufficient inventory stock available." });
        }

        // 2. Compute remaining balance split back into strips and loose remainders
        const netUnitsRemaining = totalUnitsAvailable - qty;
        const newStripsStock = Math.floor(netUnitsRemaining / tablets_per_strip);
        const newLooseStock = netUnitsRemaining % tablets_per_strip;

        // 3. Persist recalculated structural distribution values back into the DB
        const updateQuery = `
            UPDATE medicines 
            SET strips_stock = $1, loose_tablets_stock = $2 
            WHERE id = $3
            RETURNING *;
        `;
        const result = await pool.query(updateQuery, [newStripsStock, newLooseStock, id]);

        res.json({ message: "Sale successful", updatedItem: result.rows[0] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Add new entry with expanded parameters mapped to new UI fields
app.post('/api/add-medicine', async (req, res) => {
    const { name, category, required_stock, price_per_strip, tablets_per_strip, strips_stock, loose_tablets_stock } = req.body;

    try {
        const query = `
            INSERT INTO medicines (name, category, required_stock, price_per_strip, tablets_per_strip, strips_stock, loose_tablets_stock) 
            VALUES ($1, $2, $3, $4, $5, $6, $7) 
            RETURNING *;
        `;
        
        const values = [
            name, 
            category,
            required_stock || 0, 
            price_per_strip || 0.00, 
            tablets_per_strip || 10,
            strips_stock || 0,
            loose_tablets_stock || 0
        ];
        
        const result = await pool.query(query, values);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Database Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});


// Dedicated API to calculate total financial value of all available stock combined
app.get('/api/stock-total-value', async (req, res) => {
    try {
        const query = `
            SELECT 
                ROUND(
                    SUM(
                        (strips_stock * price_per_strip) + 
                        (loose_tablets_stock::NUMERIC * (price_per_strip / tablets_per_strip))
                    ), 2
                ) AS total_inventory_value
            FROM medicines
            -- Calculates only from items currently carrying physical stock
            WHERE (strips_stock > 0 OR loose_tablets_stock > 0);
        `;
        const result = await pool.query(query);
        
        // Return the raw number fallback to 0 if inventory is completely empty
        const totalValue = result.rows[0].total_inventory_value || 0.00;
        res.json({ total_value: parseFloat(totalValue) });
    } catch (err) {
        console.error('Value Calculation Error:', err.message);
        res.status(500).send('Server error computing total stock valuation.');
    }
});


app.listen(port, () => console.log(`Server running on http://localhost:${port}`));

const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware za mfumo
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Route ya kupima kama server inafanya kazi
app.get('/', (req, res) => {
    res.json({ success: true, message: "Global Learning Platform Backend is running successfully!" });
});

// Kuunganisha Routes za AI na Payments
const aiRoutes = require('./routes/aiRoutes');
const paymentRoutes = require('./routes/paymentRoutes');

app.use('/api/ai', aiRoutes);
app.use('/api/payments', paymentRoutes);

// Kuwasha Seva
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});


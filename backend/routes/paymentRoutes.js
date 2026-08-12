const express = require('express');
const router = express.Router();
const axios = require('axios');

const HARAKAPAY_API_KEY = process.env.HARAKAPAY_API_KEY;
const HARAKAPAY_BASE_URL = process.env.HARAKAPAY_BASE_URL || 'https://harakapay.net';

// 1. Kuanzisha ombi la malipo (Gift/Support) kupitia USSD Push ya HarakaPay
router.post('/collect', async (req, res) => {
    const { phone, amount, description } = req.body;

    if (!phone || !amount) {
        return res.status(400).json({ success: false, error: "Namba ya simu na kiasi zinahitajika!" });
    }

    try {
        const response = await axios.post(`${HARAKAPAY_BASE_URL}/api/v1/collect`, {
            phone,
            amount: Number(amount),
            description: description || 'Platform Gift/Support',
            webhook_url: `${process.env.APP_URL}/api/payments/webhook`
        }, {
            headers: { 
                'X-API-Key': HARAKAPAY_API_KEY,
                'Content-Type': 'application/json'
            }
        });

        res.json(response.data);
    } catch (error) {
        console.error("HarakaPay Collect Error:", error.response?.data || error.message);
        res.status(500).json({ success: false, error: "Imeshindikana kuanzisha malipo kupitia HarakaPay." });
    }
});

// 2. Webhook ya kupokea matokeo ya malipo kutoka HarakaPay
router.post('/webhook', (req, res) => {
    const paymentData = req.body;
    
    // Hapa unapokea takwimu kama order_id, status ('completed' au 'failed'), amount, n.k.
    console.log("HarakaPay Webhook Received:", paymentData);

    // Ni muhimu kurudisha status 200 kwa mujibu wa nyaraka za HarakaPay
    res.status(200).json({ success: true, message: "Webhook received successfully" });
});

module.exports = router;


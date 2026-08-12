const express = require('express');
const router = express.Router();
const axios = require('axios');

// POST /api/ai/chat
router.post('/chat', async (req, res) => {
    const { message } = req.body;

    if (!message) {
        return res.status(400).json({ success: false, error: "Ujumbe unahitajika!" });
    }

    try {
        const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
            model: 'openai/gpt-4o',
            messages: [
                { role: 'user', content: message }
            ]
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': process.env.APP_URL || 'https://my-learning-platform.onrender.com',
                'X-Title': 'Global Learning Platform'
            }
        });

        const reply = response.data.choices[0].message.content;
        res.json({ success: true, reply });

    } catch (error) {
        console.error("OpenRouter AI Error:", error.response?.data || error.message);
        res.status(500).json({ success: false, error: "Imeshindikana kuwasiliana na AI kwa sasa." });
    }
});

module.exports = router;


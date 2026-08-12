const express = require('express');
const router = express.Router();
const axios = require('axios');

// POST /api/ai/ask
router.post('/ask', async (req, res) => {
    const { prompt } = req.body;

    if (!prompt) {
        return res.status(400).json({ success: false, error: "Swali au ujumbe unahitajika!" });
    }

    try {
        const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
            model: "openai/gpt-4o", // Unaweza kubadilisha mfumo ukipenda (mfano: anthropic/claude-3-sonnet)
            messages: [
                { 
                    role: "system", 
                    content: "Wewe ni mwalimu na msaidizi mahiri wa kimataifa wa Global Learning Platform. Jibu maswali ya wanafunzi kwa lugha fasaha na kwa ufasaha mkubwa." 
                },
                { 
                    role: "user", 
                    content: prompt 
                }
            ]
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': process.env.APP_URL || 'https://my-learning-platform.onrender.com',
                'X-Title': 'Global Learning Platform'
            }
        });

        const aiReply = response.data.choices[0].message.content;
        res.json({ success: true, reply: aiReply });

    } catch (error) {
        console.error("OpenRouter AI Error:", error.response?.data || error.message);
        res.status(500).json({ 
            success: false, 
            error: "Imeshindikana kuwasiliana na mfumo wa AI kwa sasa. Jaribu tena baadae." 
        });
    }
});

module.exports = router;


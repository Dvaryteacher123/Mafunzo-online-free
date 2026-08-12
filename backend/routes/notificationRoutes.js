const express = require('express');
const router = express.Router();

// Hapa utaunganisha na Database pool yako (mfano mysql2 au sqlite3)
// const db = require('../config/db');

// 1. GET: Kupata arifa zote zinazoonekana kwa watumiaji
router.get('/', async (req, res) => {
    try {
        // Mfano wa query ya database:
        // const [rows] = await db.query('SELECT * FROM notifications WHERE is_published = TRUE ORDER BY created_at DESC');
        
        // Data za mfano kwa ajili ya majaribio:
        const notifications = [
            { id: 1, title: "Karibu kwenye Mfumo Mpya!", message: "Sasa unaweza kujifunza na kutumia AI bila kikomo.", type: "info", created_at: "2026-08-12" },
            { id: 2, title: "Malipo ya HarakaPay Yako Hewani", message: "Unaweza kutoa zawadi ya kusupport mfumo kupitia simu yako.", type: "success", created_at: "2026-08-11" }
        ];

        res.json({ success: true, notifications });
    } catch (error) {
        console.error("Fetch Notifications Error:", error);
        res.status(500).json({ success: false, error: "Imeshindikana kupata arifa." });
    }
});

// 2. POST: Kuongeza arifa mpya (Inatumiwa na Admin Panel)
router.post('/', async (req, res) => {
    const { title, message, type } = req.body;

    if (!title || !message) {
        return res.status(400).json({ success: false, error: "Kichwa cha habari na ujumbe vinahitajika!" });
    }

    try {
        // Mfano wa kuweka kwenye database:
        // await db.query('INSERT INTO notifications (title, message, type) VALUES (?, ?, ?)', [title, message, type || 'info']);

        res.json({ success: true, message: "Arifa imechapishwa kwa mafanikio!" });
    } catch (error) {
        console.error("Create Notification Error:", error);
        res.status(500).json({ success: false, error: "Imeshindikana kuchapisha arifa." });
    }
});

// 3. DELETE: Kufuta arifa kwa kutumia ID yake
router.delete('/:id', async (req, res) => {
    const { id } = req.params;

    try {
        // Mfano wa kufuta kwenye database:
        // await db.query('DELETE FROM notifications WHERE id = ?', [id]);

        res.json({ success: true, message: "Arifa imefutwa kwa mafanikio!" });
    } catch (error) {
        console.error("Delete Notification Error:", error);
        res.status(500).json({ success: false, error: "Imeshindikana kufuta arifa." });
    }
});

module.exports = router;


// Middleware ya kulinda routes za Admin
const authenticateAdmin = (req, res, next) => {
    // Tunachukua token kutoka kwenye Header ya Authorization
    const authHeader = req.headers['authorization'];
    
    // Token inatarajiwa kuwa kwenye format: "Bearer <token>"
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ success: false, error: "Hujaruhusiwa! Token haipatikani." });
    }

    // Katika mfumo huu wa mfano, tunaangalia kama token ni ile tuliyoiweka kwenye authRoutes
    // Katika mfumo mkubwa, hapa ndipo ungeverify JWT (JSON Web Token)
    if (token === "admin-secure-token-xyz") {
        next(); // Kila kitu kiko sawa, ruhusu maombi yaendelee kwenye Route husika
    } else {
        return res.status(403).json({ success: false, error: "Token si sahihi au imeisha muda wake!" });
    }
};

module.exports = authenticateAdmin;


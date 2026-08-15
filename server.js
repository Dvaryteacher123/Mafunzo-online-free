// ============================================
// SERVER.JS - SOLO CHAT COMPLETE BACKEND
// ============================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const path = require('path');
const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 5000;

// ============================================
// MIDDLEWARE
// ============================================
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
}));

app.use(cors({
    origin: '*',
    credentials: true
}));

app.use(compression());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(morgan('dev'));
app.use(express.static(__dirname));

// ============================================
// FIREBASE INITIALIZATION
// ============================================
let db = null;
let firebaseInitialized = false;

console.log('========================================');
console.log('🚀 SOLO CHAT SERVER STARTING...');
console.log('========================================');

try {
    if (!process.env.FIREBASE_PROJECT_ID || 
        !process.env.FIREBASE_CLIENT_EMAIL || 
        !process.env.FIREBASE_PRIVATE_KEY) {
        console.error('❌ Firebase credentials missing!');
    } else {
        let privateKey = process.env.FIREBASE_PRIVATE_KEY;
        privateKey = privateKey.replace(/^"|"$/g, '');
        privateKey = privateKey.replace(/\\n/g, '\n');
        
        const serviceAccount = {
            projectId: process.env.FIREBASE_PROJECT_ID.trim(),
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL.trim(),
            privateKey: privateKey
        };

        console.log('🔑 Initializing Firebase...');
        console.log('📦 Project ID:', serviceAccount.projectId);

        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            storageBucket: process.env.FIREBASE_STORAGE_BUCKET
        });

        db = getFirestore();
        firebaseInitialized = true;
        console.log('✅ Firebase initialized successfully!');
        
        // TEST CONNECTION
        testFirebaseConnection();
    }
} catch (error) {
    console.error('❌ Firebase error:', error.message);
    firebaseInitialized = false;
}

async function testFirebaseConnection() {
    try {
        console.log('🔍 Testing Firebase connection...');
        const usersSnap = await db.collection('users').limit(1).get();
        console.log(`✅ Firebase test complete! Users: ${usersSnap.size}`);
    } catch (error) {
        console.error('❌ Firebase test failed:', error.message);
    }
}

function checkFirebase(res) {
    if (!firebaseInitialized || !db) {
        return res.status(503).json({ error: 'Service unavailable' });
    }
    return null;
}

// ============================================
// JWT HELPER
// ============================================
const JWT_SECRET = process.env.JWT_SECRET || 'solo-chat-secret-key-2026';
const JWT_EXPIRES = '7d';

function generateToken(userId, email, role) {
    return jwt.sign(
        { uid: userId, email, role },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES }
    );
}

function verifyToken(token) {
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch (error) {
        return null;
    }
}

// ============================================
// AUTHENTICATION MIDDLEWARE
// ============================================
const authenticate = async (req, res, next) => {
    if (!firebaseInitialized) {
        return res.status(503).json({ error: 'Service unavailable' });
    }

    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const token = authHeader.split('Bearer ')[1];
        const decoded = verifyToken(token);
        if (!decoded) {
            return res.status(401).json({ error: 'Invalid or expired token' });
        }

        const userDoc = await db.collection('users').doc(decoded.uid).get();
        if (!userDoc.exists) {
            return res.status(401).json({ error: 'User not found' });
        }

        const userData = userDoc.data();
        if (userData.isBlocked) {
            return res.status(403).json({ error: 'Your account has been blocked' });
        }

        req.user = { uid: decoded.uid, ...userData };
        next();
    } catch (error) {
        console.error('Auth error:', error);
        return res.status(401).json({ error: 'Authentication failed' });
    }
};

const requireRole = (roles) => {
    return (req, res, next) => {
        if (!req.user) return res.status(401).json({ error: 'Authentication required' });
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }
        next();
    };
};

// ============================================
// WEB ROUTES
// ============================================
app.get('/', (req, res) => {
    const indexPath = path.join(__dirname, 'index.html');
    const fs = require('fs');
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        res.send(`
            <!DOCTYPE html>
            <html>
            <head><title>Solo Chat</title>
            <style>
                body { background: #0a0a0f; color: white; font-family: Arial; display: flex; 
                       justify-content: center; align-items: center; height: 100vh; margin: 0; text-align: center; }
                h1 { color: #6c5ce7; font-size: 4em; }
                .sub { color: #00d4ff; }
                .error { color: #ff6b6b; }
            </style>
            </head>
            <body>
                <div>
                    <h1>Solo <span style="color:#00d4ff;">Chat</span></h1>
                    <p class="sub">Meet people. Start conversations. Stay connected.</p>
                    <p class="error">⚠️ index.html not found</p>
                    <p style="color:#666;">Please upload index.html</p>
                </div>
            </body>
            </html>
        `);
    }
});

app.get('/home.html', authenticate, (req, res) => {
    const homePath = path.join(__dirname, 'home.html');
    const fs = require('fs');
    if (fs.existsSync(homePath)) {
        res.sendFile(homePath);
    } else {
        res.send(`
            <!DOCTYPE html>
            <html>
            <head><title>Solo Chat - Dashboard</title>
            <style>
                body { background: #0a0a0f; color: white; font-family: Arial; display: flex; 
                       justify-content: center; align-items: center; height: 100vh; margin: 0; text-align: center; }
                h1 { color: #6c5ce7; }
                .sub { color: #00d4ff; }
                .welcome { font-size: 1.5em; margin: 20px 0; }
                .btn { padding: 12px 24px; background: #6c5ce7; color: white; border: none; border-radius: 8px; 
                       cursor: pointer; font-size: 16px; }
                .btn:hover { background: #7c6cf0; }
            </style>
            </head>
            <body>
                <div>
                    <h1>Solo <span style="color:#00d4ff;">Chat</span></h1>
                    <p class="welcome">👋 Welcome back, ${req.user?.displayName || 'User'}!</p>
                    <p class="sub">You are logged in. Dashboard coming soon...</p>
                    <button class="btn" onclick="window.location.href='/'">Back to Home</button>
                    <button class="btn" style="background:#ff6b6b;margin-left:10px;" onclick="logout()">Logout</button>
                </div>
                <script>
                    function logout() {
                        localStorage.removeItem('authToken');
                        localStorage.removeItem('currentUser');
                        window.location.href = '/';
                    }
                </script>
            </body>
            </html>
        `);
    }
});

app.get('/admin', (req, res) => {
    const adminPath = path.join(__dirname, 'admin.html');
    const fs = require('fs');
    if (fs.existsSync(adminPath)) {
        res.sendFile(adminPath);
    } else {
        res.send('<h1>admin.html not found</h1>');
    }
});

// ============================================
// AUTH ROUTES
// ============================================

// CHECK USERNAME AVAILABILITY
app.get('/api/auth/check-username', async (req, res) => {
    const error = checkFirebase(res);
    if (error) return error;

    try {
        const { username } = req.query;
        if (!username) {
            return res.status(400).json({ error: 'Username required' });
        }

        if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
            return res.status(400).json({ 
                error: 'Username must be 3-20 characters and contain only letters, numbers and underscore',
                available: false 
            });
        }

        const snapshot = await db.collection('users')
            .where('username', '==', username.toLowerCase())
            .limit(1)
            .get();

        res.json({ available: snapshot.empty });
    } catch (error) {
        console.error('Error checking username:', error);
        res.status(500).json({ error: 'Failed to check username' });
    }
});

// REGISTER
app.post('/api/auth/register', async (req, res) => {
    console.log('📝 Register attempt:', req.body.email);
    
    const error = checkFirebase(res);
    if (error) return error;

    try {
        const { email, password, displayName, username, phone, dob, country, gender, role } = req.body;

        if (!email || !password || !displayName || !username) {
            return res.status(400).json({ error: 'Email, password, username and name required' });
        }

        if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
            return res.status(400).json({ 
                error: 'Username must be 3-20 characters and contain only letters, numbers and underscore'
            });
        }

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({ error: 'Invalid email format' });
        }

        if (password.length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters' });
        }

        // Check if email exists
        const existingEmail = await db.collection('users')
            .where('email', '==', email.toLowerCase())
            .limit(1)
            .get();

        if (!existingEmail.empty) {
            return res.status(400).json({ error: 'Email already registered' });
        }

        // Check if username exists
        const existingUsername = await db.collection('users')
            .where('username', '==', username.toLowerCase())
            .limit(1)
            .get();

        if (!existingUsername.empty) {
            return res.status(400).json({ error: 'Username already taken' });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const userUid = 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        
        const userData = {
            email: email.toLowerCase(),
            displayName: displayName.trim(),
            username: username.toLowerCase(),
            phone: phone || '',
            dob: dob || '',
            country: country || '',
            gender: gender || 'prefer_not_to_say',
            role: role || 'user',
            passwordHash: hashedPassword,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            lastLogin: new Date().toISOString(),
            isActive: true,
            isBlocked: false,
            isVerified: false,
            isOnline: false,
            lastSeen: new Date().toISOString(),
            status: 'Available',
            bio: '',
            interests: [],
            profilePicture: '',
            coverPhoto: '',
            friends: [],
            blockedUsers: [],
            settings: {
                privacy: {
                    whoCanMessage: 'everyone',
                    whoCanAdd: 'everyone',
                    showOnlineStatus: true,
                    showLastSeen: true,
                    showProfile: true,
                    allowFriendRequests: true,
                    readReceipts: true,
                    typingIndicator: true
                },
                notifications: {
                    newMessages: true,
                    friendRequests: true,
                    calls: true,
                    mentions: true,
                    system: true
                },
                appearance: {
                    theme: 'dark',
                    fontSize: 'medium',
                    chatBackground: 'default'
                },
                language: 'sw'
            },
            permissions: ['view_profile', 'send_messages', 'create_chats']
        };

        await db.collection('users').doc(userUid).set(userData);

        console.log('✅ User registered:', email);

        // Generate token for auto-login
        const token = generateToken(userUid, email, 'user');

        res.status(201).json({
            message: 'User created successfully',
            token,
            user: {
                uid: userUid,
                email: userData.email,
                displayName: userData.displayName,
                username: userData.username,
                role: userData.role,
                isVerified: userData.isVerified
            }
        });
    } catch (error) {
        console.error('❌ Registration error:', error);
        res.status(500).json({ error: error.message || 'Registration failed' });
    }
});

// LOGIN
app.post('/api/auth/login', async (req, res) => {
    console.log('🔐 Login attempt:', req.body.email);
    
    const error = checkFirebase(res);
    if (error) return error;

    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password required' });
        }

        // Search by email or username
        let userSnapshot = await db.collection('users')
            .where('email', '==', email.toLowerCase())
            .limit(1)
            .get();

        if (userSnapshot.empty) {
            userSnapshot = await db.collection('users')
                .where('username', '==', email.toLowerCase())
                .limit(1)
                .get();
        }

        if (userSnapshot.empty) {
            console.log('❌ User not found:', email);
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const userDoc = userSnapshot.docs[0];
        const userData = userDoc.data();
        const userUid = userDoc.id;

        // Check if user is blocked
        if (userData.isBlocked) {
            return res.status(403).json({ error: 'Your account has been blocked. Contact support.' });
        }

        const isValidPassword = await bcrypt.compare(password, userData.passwordHash || '');
        if (!isValidPassword) {
            console.log('❌ Invalid password for:', email);
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Update last login
        await db.collection('users').doc(userUid).update({
            lastLogin: new Date().toISOString(),
            isOnline: true,
            lastSeen: new Date().toISOString()
        });

        const token = generateToken(userUid, userData.email, userData.role);

        console.log('✅ Login successful:', email);

        res.json({
            success: true,
            token,
            user: {
                uid: userUid,
                email: userData.email,
                displayName: userData.displayName,
                username: userData.username,
                role: userData.role,
                isVerified: userData.isVerified || false,
                isOnline: true,
                lastSeen: new Date().toISOString(),
                profilePicture: userData.profilePicture || '',
                status: userData.status || 'Available',
                settings: userData.settings || {}
            }
        });
    } catch (error) {
        console.error('❌ Login error:', error);
        res.status(500).json({ error: error.message || 'Login failed' });
    }
});

// VERIFY TOKEN / GET CURRENT USER
app.get('/api/auth/me', authenticate, async (req, res) => {
    try {
        const userDoc = await db.collection('users').doc(req.user.uid).get();
        if (!userDoc.exists) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        const userData = userDoc.data();
        delete userData.passwordHash;
        
        res.json({
            user: {
                uid: req.user.uid,
                ...userData
            }
        });
    } catch (error) {
        console.error('Error fetching user:', error);
        res.status(500).json({ error: 'Failed to fetch user' });
    }
});

// LOGOUT (client side - just update status)
app.post('/api/auth/logout', authenticate, async (req, res) => {
    try {
        await db.collection('users').doc(req.user.uid).update({
            isOnline: false,
            lastSeen: new Date().toISOString()
        });
        res.json({ message: 'Logged out successfully' });
    } catch (error) {
        console.error('Logout error:', error);
        res.status(500).json({ error: 'Logout failed' });
    }
});

// ============================================
// USER ROUTES
// ============================================

// GET USER PROFILE
app.get('/api/users/:uid', async (req, res) => {
    const error = checkFirebase(res);
    if (error) return error;

    try {
        const { uid } = req.params;
        const userDoc = await db.collection('users').doc(uid).get();
        
        if (!userDoc.exists) {
            return res.status(404).json({ error: 'User not found' });
        }

        const userData = userDoc.data();
        delete userData.passwordHash;
        
        res.json({
            uid,
            ...userData
        });
    } catch (error) {
        console.error('Error fetching user:', error);
        res.status(500).json({ error: 'Failed to fetch user' });
    }
});

// UPDATE USER PROFILE
app.put('/api/users/:uid', authenticate, async (req, res) => {
    const error = checkFirebase(res);
    if (error) return error;

    try {
        const { uid } = req.params;
        
        // Check if user is updating their own profile or is admin
        if (req.user.uid !== uid && req.user.role !== 'admin' && req.user.role !== 'superadmin') {
            return res.status(403).json({ error: 'You can only update your own profile' });
        }

        const updateData = {
            ...req.body,
            updatedAt: new Date().toISOString()
        };

        // Remove sensitive fields
        delete updateData.passwordHash;
        delete updateData.createdAt;
        delete updateData.permissions;

        await db.collection('users').doc(uid).update(updateData);
        
        res.json({ message: 'Profile updated successfully' });
    } catch (error) {
        console.error('Error updating user:', error);
        res.status(500).json({ error: 'Failed to update user' });
    }
});

// UPDATE USER STATUS
app.put('/api/users/:uid/status', authenticate, async (req, res) => {
    const error = checkFirebase(res);
    if (error) return error;

    try {
        const { uid } = req.params;
        const { status } = req.body;

        if (req.user.uid !== uid) {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        await db.collection('users').doc(uid).update({
            status: status,
            updatedAt: new Date().toISOString()
        });

        res.json({ message: 'Status updated successfully', status });
    } catch (error) {
        console.error('Error updating status:', error);
        res.status(500).json({ error: 'Failed to update status' });
    }
});

// ============================================
// FRIEND SYSTEM
// ============================================

// SEND FRIEND REQUEST
app.post('/api/friends/request', authenticate, async (req, res) => {
    const error = checkFirebase(res);
    if (error) return error;

    try {
        const { targetUid } = req.body;
        
        if (!targetUid) {
            return res.status(400).json({ error: 'Target user ID required' });
        }

        if (targetUid === req.user.uid) {
            return res.status(400).json({ error: 'You cannot add yourself' });
        }

        // Check if target user exists
        const targetDoc = await db.collection('users').doc(targetUid).get();
        if (!targetDoc.exists) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Check if already friends
        const userData = await db.collection('users').doc(req.user.uid).get();
        const userFriends = userData.data().friends || [];
        if (userFriends.includes(targetUid)) {
            return res.status(400).json({ error: 'Already friends' });
        }

        // Check if request already exists
        const existingRequest = await db.collection('friendRequests')
            .where('from', '==', req.user.uid)
            .where('to', '==', targetUid)
            .where('status', '==', 'pending')
            .limit(1)
            .get();

        if (!existingRequest.empty) {
            return res.status(400).json({ error: 'Friend request already sent' });
        }

        // Create friend request
        await db.collection('friendRequests').add({
            from: req.user.uid,
            to: targetUid,
            status: 'pending',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        });

        // Create notification
        await db.collection('notifications').add({
            userId: targetUid,
            type: 'friend_request',
            from: req.user.uid,
            message: `${req.user.displayName} sent you a friend request`,
            read: false,
            createdAt: new Date().toISOString()
        });

        res.json({ message: 'Friend request sent successfully' });
    } catch (error) {
        console.error('Error sending friend request:', error);
        res.status(500).json({ error: 'Failed to send friend request' });
    }
});

// ACCEPT FRIEND REQUEST
app.put('/api/friends/accept', authenticate, async (req, res) => {
    const error = checkFirebase(res);
    if (error) return error;

    try {
        const { requestId, fromUid } = req.body;

        if (!requestId || !fromUid) {
            return res.status(400).json({ error: 'Request ID and from user ID required' });
        }

        // Update friend request
        await db.collection('friendRequests').doc(requestId).update({
            status: 'accepted',
            updatedAt: new Date().toISOString()
        });

        // Add to friends list for both users
        const userRef = db.collection('users').doc(req.user.uid);
        const fromRef = db.collection('users').doc(fromUid);

        const userDoc = await userRef.get();
        const fromDoc = await fromRef.get();

        const userFriends = userDoc.data().friends || [];
        const fromFriends = fromDoc.data().friends || [];

        if (!userFriends.includes(fromUid)) {
            await userRef.update({
                friends: [...userFriends, fromUid],
                updatedAt: new Date().toISOString()
            });
        }

        if (!fromFriends.includes(req.user.uid)) {
            await fromRef.update({
                friends: [...fromFriends, req.user.uid],
                updatedAt: new Date().toISOString()
            });
        }

        // Create notification
        await db.collection('notifications').add({
            userId: fromUid,
            type: 'friend_accepted',
            from: req.user.uid,
            message: `${req.user.displayName} accepted your friend request`,
            read: false,
            createdAt: new Date().toISOString()
        });

        res.json({ message: 'Friend request accepted' });
    } catch (error) {
        console.error('Error accepting friend request:', error);
        res.status(500).json({ error: 'Failed to accept friend request' });
    }
});

// REJECT FRIEND REQUEST
app.put('/api/friends/reject', authenticate, async (req, res) => {
    const error = checkFirebase(res);
    if (error) return error;

    try {
        const { requestId } = req.body;

        if (!requestId) {
            return res.status(400).json({ error: 'Request ID required' });
        }

        await db.collection('friendRequests').doc(requestId).update({
            status: 'rejected',
            updatedAt: new Date().toISOString()
        });

        res.json({ message: 'Friend request rejected' });
    } catch (error) {
        console.error('Error rejecting friend request:', error);
        res.status(500).json({ error: 'Failed to reject friend request' });
    }
});

// GET FRIEND REQUESTS
app.get('/api/friends/requests', authenticate, async (req, res) => {
    const error = checkFirebase(res);
    if (error) return error;

    try {
        const snapshot = await db.collection('friendRequests')
            .where('to', '==', req.user.uid)
            .where('status', '==', 'pending')
            .orderBy('createdAt', 'desc')
            .get();

        const requests = [];
        for (const doc of snapshot.docs) {
            const data = doc.data();
            const fromUser = await db.collection('users').doc(data.from).get();
            const fromData = fromUser.data();
            requests.push({
                id: doc.id,
                ...data,
                fromUser: {
                    uid: data.from,
                    displayName: fromData?.displayName || 'Unknown',
                    username: fromData?.username || '',
                    profilePicture: fromData?.profilePicture || ''
                }
            });
        }

        res.json(requests);
    } catch (error) {
        console.error('Error fetching friend requests:', error);
        res.status(500).json({ error: 'Failed to fetch friend requests' });
    }
});

// GET FRIENDS LIST
app.get('/api/friends', authenticate, async (req, res) => {
    const error = checkFirebase(res);
    if (error) return error;

    try {
        const userDoc = await db.collection('users').doc(req.user.uid).get();
        const userData = userDoc.data();
        const friendIds = userData.friends || [];

        const friends = [];
        for (const uid of friendIds) {
            const friendDoc = await db.collection('users').doc(uid).get();
            if (friendDoc.exists) {
                const data = friendDoc.data();
                delete data.passwordHash;
                friends.push({
                    uid,
                    ...data
                });
            }
        }

        res.json(friends);
    } catch (error) {
        console.error('Error fetching friends:', error);
        res.status(500).json({ error: 'Failed to fetch friends' });
    }
});

// REMOVE FRIEND
app.delete('/api/friends/:uid', authenticate, async (req, res) => {
    const error = checkFirebase(res);
    if (error) return error;

    try {
        const { uid } = req.params;

        const userRef = db.collection('users').doc(req.user.uid);
        const friendRef = db.collection('users').doc(uid);

        const userDoc = await userRef.get();
        const friendDoc = await friendRef.get();

        if (!userDoc.exists || !friendDoc.exists) {
            return res.status(404).json({ error: 'User not found' });
        }

        const userFriends = userDoc.data().friends || [];
        const friendFriends = friendDoc.data().friends || [];

        await userRef.update({
            friends: userFriends.filter(id => id !== uid),
            updatedAt: new Date().toISOString()
        });

        await friendRef.update({
            friends: friendFriends.filter(id => id !== req.user.uid),
            updatedAt: new Date().toISOString()
        });

        res.json({ message: 'Friend removed' });
    } catch (error) {
        console.error('Error removing friend:', error);
        res.status(500).json({ error: 'Failed to remove friend' });
    }
});

// ============================================
// CHAT SYSTEM
// ============================================

// GET CHATS LIST
app.get('/api/chats', authenticate, async (req, res) => {
    const error = checkFirebase(res);
    if (error) return error;

    try {
        const snapshot = await db.collection('chats')
            .where('participants', 'array-contains', req.user.uid)
            .orderBy('updatedAt', 'desc')
            .get();

        const chats = [];
        for (const doc of snapshot.docs) {
            const data = doc.data();
            const otherParticipant = data.participants.find(id => id !== req.user.uid);
            let otherUser = null;
            
            if (otherParticipant) {
                const userDoc = await db.collection('users').doc(otherParticipant).get();
                if (userDoc.exists) {
                    const userData = userDoc.data();
                    delete userData.passwordHash;
                    otherUser = { uid: otherParticipant, ...userData };
                }
            }

            // Get last message
            let lastMessage = null;
            if (data.lastMessageId) {
                const msgDoc = await db.collection('messages').doc(data.lastMessageId).get();
                if (msgDoc.exists) {
                    lastMessage = { id: msgDoc.id, ...msgDoc.data() };
                }
            }

            chats.push({
                id: doc.id,
                ...data,
                otherUser,
                lastMessage
            });
        }

        res.json(chats);
    } catch (error) {
        console.error('Error fetching chats:', error);
        res.status(500).json({ error: 'Failed to fetch chats' });
    }
});

// GET MESSAGES FOR A CHAT
app.get('/api/chats/:chatId/messages', authenticate, async (req, res) => {
    const error = checkFirebase(res);
    if (error) return error;

    try {
        const { chatId } = req.params;
        const { limit = 50, before } = req.query;

        let query = db.collection('messages')
            .where('chatId', '==', chatId)
            .orderBy('createdAt', 'desc')
            .limit(parseInt(limit));

        if (before) {
            const beforeDoc = await db.collection('messages').doc(before).get();
            if (beforeDoc.exists) {
                query = query.startAfter(beforeDoc);
            }
        }

        const snapshot = await query.get();
        const messages = [];
        snapshot.forEach(doc => {
            messages.push({ id: doc.id, ...doc.data() });
        });

        res.json(messages.reverse());
    } catch (error) {
        console.error('Error fetching messages:', error);
        res.status(500).json({ error: 'Failed to fetch messages' });
    }
});

// SEND MESSAGE
app.post('/api/chats/:chatId/messages', authenticate, async (req, res) => {
    const error = checkFirebase(res);
    if (error) return error;

    try {
        const { chatId } = req.params;
        const { text, type = 'text', mediaUrl, replyTo } = req.body;

        if (!text && !mediaUrl) {
            return res.status(400).json({ error: 'Message content required' });
        }

        // Check if user is in chat
        const chatDoc = await db.collection('chats').doc(chatId).get();
        if (!chatDoc.exists) {
            return res.status(404).json({ error: 'Chat not found' });
        }

        const chatData = chatDoc.data();
        if (!chatData.participants.includes(req.user.uid)) {
            return res.status(403).json({ error: 'You are not in this chat' });
        }

        const messageData = {
            chatId,
            senderId: req.user.uid,
            text: text || '',
            type,
            mediaUrl: mediaUrl || '',
            replyTo: replyTo || null,
            readBy: [req.user.uid],
            deliveredTo: [req.user.uid],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        const messageRef = await db.collection('messages').add(messageData);

        // Update chat last message
        await db.collection('chats').doc(chatId).update({
            lastMessageId: messageRef.id,
            updatedAt: new Date().toISOString()
        });

        // Send notification to other participants
        const otherParticipants = chatData.participants.filter(id => id !== req.user.uid);
        for (const userId of otherParticipants) {
            await db.collection('notifications').add({
                userId,
                type: 'new_message',
                from: req.user.uid,
                chatId,
                messageId: messageRef.id,
                message: text || 'New message',
                read: false,
                createdAt: new Date().toISOString()
            });
        }

        res.json({
            id: messageRef.id,
            ...messageData
        });
    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({ error: 'Failed to send message' });
    }
});

// MARK MESSAGES AS READ
app.put('/api/chats/:chatId/read', authenticate, async (req, res) => {
    const error = checkFirebase(res);
    if (error) return error;

    try {
        const { chatId } = req.params;

        const snapshot = await db.collection('messages')
            .where('chatId', '==', chatId)
            .where('senderId', '!=', req.user.uid)
            .get();

        const batch = db.batch();
        snapshot.forEach(doc => {
            const data = doc.data();
            const readBy = data.readBy || [];
            if (!readBy.includes(req.user.uid)) {
                batch.update(doc.ref, {
                    readBy: [...readBy, req.user.uid],
                    updatedAt: new Date().toISOString()
                });
            }
        });

        await batch.commit();

        res.json({ message: 'Messages marked as read' });
    } catch (error) {
        console.error('Error marking messages as read:', error);
        res.status(500).json({ error: 'Failed to mark messages as read' });
    }
});

// ============================================
// SEARCH USERS
// ============================================
app.get('/api/search/users', authenticate, async (req, res) => {
    const error = checkFirebase(res);
    if (error) return error;

    try {
        const { q, limit = 20 } = req.query;

        if (!q || q.length < 2) {
            return res.json([]);
        }

        const searchLower = q.toLowerCase();

        // Search by username or displayName
        const usersSnapshot = await db.collection('users')
            .where('isActive', '==', true)
            .get();

        const results = [];
        usersSnapshot.forEach(doc => {
            const data = doc.data();
            if (doc.id === req.user.uid) return;
            
            const match = data.username?.toLowerCase().includes(searchLower) ||
                         data.displayName?.toLowerCase().includes(searchLower);
            
            if (match) {
                delete data.passwordHash;
                results.push({ uid: doc.id, ...data });
            }
        });

        // Sort by relevance and limit
        results.sort((a, b) => {
            const aMatch = a.username?.toLowerCase().startsWith(searchLower) ? 0 : 1;
            const bMatch = b.username?.toLowerCase().startsWith(searchLower) ? 0 : 1;
            return aMatch - bMatch;
        });

        res.json(results.slice(0, parseInt(limit)));
    } catch (error) {
        console.error('Error searching users:', error);
        res.status(500).json({ error: 'Failed to search users' });
    }
});

// ============================================
// NOTIFICATIONS
// ============================================

// GET NOTIFICATIONS
app.get('/api/notifications', authenticate, async (req, res) => {
    const error = checkFirebase(res);
    if (error) return error;

    try {
        const { limit = 20, unreadOnly } = req.query;

        let query = db.collection('notifications')
            .where('userId', '==', req.user.uid)
            .orderBy('createdAt', 'desc')
            .limit(parseInt(limit));

        if (unreadOnly === 'true') {
            query = query.where('read', '==', false);
        }

        const snapshot = await query.get();
        const notifications = [];
        snapshot.forEach(doc => {
            notifications.push({ id: doc.id, ...doc.data() });
        });

        res.json(notifications);
    } catch (error) {
        console.error('Error fetching notifications:', error);
        res.status(500).json({ error: 'Failed to fetch notifications' });
    }
});

// MARK NOTIFICATION AS READ
app.put('/api/notifications/:id/read', authenticate, async (req, res) => {
    const error = checkFirebase(res);
    if (error) return error;

    try {
        const { id } = req.params;

        const notifDoc = await db.collection('notifications').doc(id).get();
        if (!notifDoc.exists) {
            return res.status(404).json({ error: 'Notification not found' });
        }

        const data = notifDoc.data();
        if (data.userId !== req.user.uid) {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        await db.collection('notifications').doc(id).update({
            read: true,
            updatedAt: new Date().toISOString()
        });

        res.json({ message: 'Notification marked as read' });
    } catch (error) {
        console.error('Error marking notification as read:', error);
        res.status(500).json({ error: 'Failed to mark notification as read' });
    }
});

// MARK ALL NOTIFICATIONS AS READ
app.put('/api/notifications/read-all', authenticate, async (req, res) => {
    const error = checkFirebase(res);
    if (error) return error;

    try {
        const snapshot = await db.collection('notifications')
            .where('userId', '==', req.user.uid)
            .where('read', '==', false)
            .get();

        const batch = db.batch();
        snapshot.forEach(doc => {
            batch.update(doc.ref, {
                read: true,
                updatedAt: new Date().toISOString()
            });
        });

        await batch.commit();

        res.json({ message: 'All notifications marked as read' });
    } catch (error) {
        console.error('Error marking all notifications as read:', error);
        res.status(500).json({ error: 'Failed to mark notifications as read' });
    }
});

// ============================================
// BLOCK USER
// ============================================
app.post('/api/users/:uid/block', authenticate, async (req, res) => {
    const error = checkFirebase(res);
    if (error) return error;

    try {
        const { uid } = req.params;

        if (uid === req.user.uid) {
            return res.status(400).json({ error: 'You cannot block yourself' });
        }

        const userRef = db.collection('users').doc(req.user.uid);
        const userDoc = await userRef.get();
        const blockedUsers = userDoc.data().blockedUsers || [];

        if (blockedUsers.includes(uid)) {
            return res.status(400).json({ error: 'User already blocked' });
        }

        await userRef.update({
            blockedUsers: [...blockedUsers, uid],
            updatedAt: new Date().toISOString()
        });

        // Remove from friends if they were friends
        const friends = userDoc.data().friends || [];
        if (friends.includes(uid)) {
            await userRef.update({
                friends: friends.filter(id => id !== uid)
            });
            // Also remove from other user's friends
            const friendRef = db.collection('users').doc(uid);
            const friendDoc = await friendRef.get();
            const friendFriends = friendDoc.data().friends || [];
            await friendRef.update({
                friends: friendFriends.filter(id => id !== req.user.uid)
            });
        }

        res.json({ message: 'User blocked successfully' });
    } catch (error) {
        console.error('Error blocking user:', error);
        res.status(500).json({ error: 'Failed to block user' });
    }
});

// UNBLOCK USER
app.delete('/api/users/:uid/block', authenticate, async (req, res) => {
    const error = checkFirebase(res);
    if (error) return error;

    try {
        const { uid } = req.params;

        const userRef = db.collection('users').doc(req.user.uid);
        const userDoc = await userRef.get();
        const blockedUsers = userDoc.data().blockedUsers || [];

        if (!blockedUsers.includes(uid)) {
            return res.status(400).json({ error: 'User is not blocked' });
        }

        await userRef.update({
            blockedUsers: blockedUsers.filter(id => id !== uid),
            updatedAt: new Date().toISOString()
        });

        res.json({ message: 'User unblocked successfully' });
    } catch (error) {
        console.error('Error unblocking user:', error);
        res.status(500).json({ error: 'Failed to unblock user' });
    }
});

// ============================================
// ADMIN ROUTES
// ============================================

// GET ALL USERS (Admin only)
app.get('/api/admin/users', authenticate, requireRole(['admin', 'superadmin']), async (req, res) => {
    const error = checkFirebase(res);
    if (error) return error;

    try {
        const snapshot = await db.collection('users').get();
        const users = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            delete data.passwordHash;
            users.push({ uid: doc.id, ...data });
        });
        res.json(users);
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

// BAN/UNBAN USER (Admin only)
app.put('/api/admin/users/:uid/ban', authenticate, requireRole(['admin', 'superadmin']), async (req, res) => {
    const error = checkFirebase(res);
    if (error) return error;

    try {
        const { uid } = req.params;
        const { isBlocked } = req.body;

        if (typeof isBlocked !== 'boolean') {
            return res.status(400).json({ error: 'isBlocked must be a boolean' });
        }

        await db.collection('users').doc(uid).update({
            isBlocked,
            updatedAt: new Date().toISOString()
        });

        res.json({ 
            message: `User ${isBlocked ? 'banned' : 'unbanned'} successfully`,
            isBlocked
        });
    } catch (error) {
        console.error('Error banning/unbanning user:', error);
        res.status(500).json({ error: 'Failed to update user' });
    }
});

// ============================================
// API STATUS
// ============================================
app.get('/api/status', (req, res) => {
    res.json({
        status: 'online',
        service: 'Solo Chat API',
        version: '1.0.0',
        firebase: firebaseInitialized ? 'connected' : 'disconnected',
        timestamp: new Date().toISOString()
    });
});

// ============================================
// CATCH-ALL
// ============================================
app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
        console.log('❌ API endpoint not found:', req.path);
        return res.status(404).json({ 
            error: 'API endpoint not found',
            path: req.path,
            method: req.method
        });
    }
    
    const indexPath = path.join(__dirname, 'index.html');
    const fs = require('fs');
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        res.send('<h1>index.html not found</h1>');
    }
});

// ============================================
// ERROR HANDLING
// ============================================
app.use((err, req, res, next) => {
    console.error('❌ Server error:', err);
    res.status(500).json({ 
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
    });
});

// ============================================
// START SERVER
// ============================================
app.listen(PORT, '0.0.0.0', () => {
    console.log('========================================');
    console.log(`🚀 SOLO CHAT SERVER RUNNING`);
    console.log(`📡 Port: ${PORT}`);
    console.log(`🔗 http://localhost:${PORT}`);
    console.log(`🔗 http://localhost:${PORT}/admin`);
    console.log(`🔥 Firebase: ${firebaseInitialized ? '✅ Connected' : '❌ Not connected'}`);
    console.log(`🔐 Auth: JWT with 7d expiry`);
    console.log('========================================');
    console.log('📋 Available Routes:');
    console.log('   POST /api/auth/register - Sign up');
    console.log('   POST /api/auth/login - Sign in');
    console.log('   GET  /api/auth/me - Get current user');
    console.log('   GET  /api/users/:uid - Get user profile');
    console.log('   PUT  /api/users/:uid - Update profile');
    console.log('   POST /api/friends/request - Send friend request');
    console.log('   GET  /api/friends - Get friends list');
    console.log('   GET  /api/chats - Get chats');
    console.log('   GET  /api/chats/:chatId/messages - Get messages');
    console.log('   POST /api/chats/:chatId/messages - Send message');
    console.log('   GET  /api/notifications - Get notifications');
    console.log('   GET  /api/search/users - Search users');
    console.log('========================================');
});

process.on('SIGTERM', () => {
    console.log('🛑 Shutting down...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('🛑 Shutting down...');
    process.exit(0);
});

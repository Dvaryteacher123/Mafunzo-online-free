// ============================================
// SERVER.JS - FULLY FIXED WITH AUTH ROUTES
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

try {
    if (!process.env.FIREBASE_PROJECT_ID || 
        !process.env.FIREBASE_CLIENT_EMAIL || 
        !process.env.FIREBASE_PRIVATE_KEY) {
        console.error('❌ Firebase credentials missing');
    } else {
        let privateKey = process.env.FIREBASE_PRIVATE_KEY;
        privateKey = privateKey.replace(/^"|"$/g, '');
        privateKey = privateKey.replace(/\\n/g, '\n');
        
        const serviceAccount = {
            projectId: process.env.FIREBASE_PROJECT_ID.trim(),
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL.trim(),
            privateKey: privateKey
        };

        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            storageBucket: process.env.FIREBASE_STORAGE_BUCKET
        });

        db = getFirestore();
        firebaseInitialized = true;
        console.log('✅ Firebase initialized successfully');
    }
} catch (error) {
    console.error('❌ Firebase error:', error.message);
}

function checkFirebase(res) {
    if (!firebaseInitialized || !db) {
        return res.status(503).json({ error: 'Firebase service unavailable' });
    }
    return null;
}

// ============================================
// WEB ROUTES
// ============================================
app.get('/', (req, res) => {
    const indexPath = path.join(__dirname, 'index.html');
    const fs = require('fs');
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        res.send('<h1>index.html not found</h1>');
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
// AUTH ROUTES - MUHIMU SANA!
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

        if (!/^[a-zA-Z0-9_]{3,30}$/.test(username)) {
            return res.status(400).json({ 
                error: 'Username must be 3-30 characters and contain only letters, numbers and underscore',
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

// LOGIN - HII NI ROUTE MUHIMU!
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
            return res.status(403).json({ error: 'Your account has been blocked.' });
        }

        const isValidPassword = await bcrypt.compare(password, userData.passwordHash || '');
        if (!isValidPassword) {
            console.log('❌ Invalid password for:', email);
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Generate JWT token
        const token = jwt.sign(
            { uid: userUid, email: userData.email, role: userData.role },
            process.env.JWT_SECRET || 'fallback-secret',
            { expiresIn: '7d' }
        );

        await db.collection('users').doc(userUid).update({
            lastLogin: new Date().toISOString()
        });

        console.log('✅ Login successful:', email);

        res.json({
            success: true,
            token,
            user: {
                uid: userUid,
                email: userData.email,
                displayName: userData.displayName,
                username: userData.username || '',
                role: userData.role,
                permissions: userData.permissions || [],
                isBlocked: userData.isBlocked || false
            }
        });
    } catch (error) {
        console.error('❌ Login error:', error);
        res.status(500).json({ error: error.message || 'Login failed' });
    }
});

// REGISTER
app.post('/api/auth/register', async (req, res) => {
    console.log('📝 Register attempt:', req.body.email);
    
    const error = checkFirebase(res);
    if (error) return error;

    try {
        const { email, password, displayName, username, phone, role } = req.body;

        if (!email || !password || !displayName || !username) {
            return res.status(400).json({ error: 'Email, password, username and name required' });
        }

        if (!/^[a-zA-Z0-9_]{3,30}$/.test(username)) {
            return res.status(400).json({ 
                error: 'Username must be 3-30 characters and contain only letters, numbers and underscore'
            });
        }

        const existingEmail = await db.collection('users')
            .where('email', '==', email.toLowerCase())
            .limit(1)
            .get();

        if (!existingEmail.empty) {
            return res.status(400).json({ error: 'Email already registered' });
        }

        const existingUsername = await db.collection('users')
            .where('username', '==', username.toLowerCase())
            .limit(1)
            .get();

        if (!existingUsername.empty) {
            return res.status(400).json({ error: 'Username already taken' });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Create user in Firebase Auth (optional - for future use)
        let userUid = 'user-' + Date.now();
        
        // Try to create in Firebase Auth
        try {
            const adminAuth = require('firebase-admin/auth').getAuth();
            const userRecord = await adminAuth.createUser({
                email: email.toLowerCase(),
                password,
                displayName
            });
            userUid = userRecord.uid;
        } catch (authError) {
            console.log('⚠️ Firebase Auth not available, using custom UID');
        }

        const userData = {
            email: email.toLowerCase(),
            displayName: displayName.trim(),
            username: username.toLowerCase(),
            phone: phone || '',
            role: role || 'student',
            passwordHash: hashedPassword,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            lastLogin: new Date().toISOString(),
            isActive: true,
            isBlocked: false,
            permissions: ['view_courses', 'view_lessons'],
            photoURL: null,
            bio: null
        };

        await db.collection('users').doc(userUid).set(userData);

        console.log('✅ User registered:', email);

        res.status(201).json({
            message: 'User created successfully',
            uid: userUid
        });
    } catch (error) {
        console.error('❌ Registration error:', error);
        res.status(500).json({ error: error.message || 'Registration failed' });
    }
});

// ============================================
// COURSES ROUTES
// ============================================

app.get('/api/courses', async (req, res) => {
    const error = checkFirebase(res);
    if (error) return error;

    try {
        const { category, level, featured, search } = req.query;
        
        let query = db.collection('courses');
        
        if (category) query = query.where('category', '==', category);
        if (level) query = query.where('level', '==', level);
        if (featured === 'true') query = query.where('isFeatured', '==', true);
        
        const snapshot = await query.get();
        const courses = [];
        snapshot.forEach(doc => {
            courses.push({ id: doc.id, ...doc.data() });
        });

        // Check if user is admin (has token)
        const authHeader = req.headers.authorization;
        let isAdmin = false;
        if (authHeader) {
            try {
                const token = authHeader.split('Bearer ')[1];
                const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret');
                const userDoc = await db.collection('users').doc(decoded.uid).get();
                const userData = userDoc.data();
                if (['super_admin', 'content_admin', 'editor'].includes(userData?.role)) {
                    isAdmin = true;
                }
            } catch (e) {}
        }

        // If not admin, filter published courses only
        let result = courses;
        if (!isAdmin) {
            result = courses.filter(c => c.status === 'published');
        }

        if (search) {
            const searchLower = search.toLowerCase();
            result = result.filter(course => 
                (course.title || '').toLowerCase().includes(searchLower) ||
                (course.description || '').toLowerCase().includes(searchLower) ||
                (course.category || '').toLowerCase().includes(searchLower) ||
                (course.instructor || '').toLowerCase().includes(searchLower)
            );
        }

        console.log(`📚 Returning ${result.length} courses`);
        res.json(result);
    } catch (error) {
        console.error('❌ Error fetching courses:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch courses' });
    }
});

app.get('/api/courses/:id', async (req, res) => {
    const error = checkFirebase(res);
    if (error) return error;

    try {
        const courseDoc = await db.collection('courses').doc(req.params.id).get();
        
        if (!courseDoc.exists) {
            return res.status(404).json({ error: 'Course not found' });
        }
        
        res.json({ id: req.params.id, ...courseDoc.data() });
    } catch (error) {
        console.error('❌ Error fetching course:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch course' });
    }
});

app.post('/api/courses', async (req, res) => {
    const error = checkFirebase(res);
    if (error) return error;

    try {
        const courseData = {
            ...req.body,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            enrolledStudents: 0,
            rating: 0,
            reviews: 0,
            status: req.body.status || 'draft'
        };
        
        const docRef = await db.collection('courses').add(courseData);
        console.log(`✅ Course created: ${docRef.id}`);
        
        res.status(201).json({ 
            id: docRef.id, 
            message: 'Course created successfully' 
        });
    } catch (error) {
        console.error('❌ Error creating course:', error);
        res.status(500).json({ error: error.message || 'Failed to create course' });
    }
});

app.put('/api/courses/:id', async (req, res) => {
    const error = checkFirebase(res);
    if (error) return error;

    try {
        const updateData = {
            ...req.body,
            updatedAt: new Date().toISOString()
        };
        
        await db.collection('courses').doc(req.params.id).update(updateData);
        res.json({ message: 'Course updated successfully' });
    } catch (error) {
        console.error('❌ Error updating course:', error);
        res.status(500).json({ error: error.message || 'Failed to update course' });
    }
});

app.delete('/api/courses/:id', async (req, res) => {
    const error = checkFirebase(res);
    if (error) return error;

    try {
        await db.collection('courses').doc(req.params.id).delete();
        res.json({ message: 'Course deleted successfully' });
    } catch (error) {
        console.error('❌ Error deleting course:', error);
        res.status(500).json({ error: error.message || 'Failed to delete course' });
    }
});

// ============================================
// CATEGORIES ROUTES
// ============================================

app.get('/api/categories', async (req, res) => {
    const error = checkFirebase(res);
    if (error) return error;

    try {
        const snapshot = await db.collection('categories')
            .where('isActive', '==', true)
            .orderBy('sortOrder')
            .get();
        
        const categories = [];
        snapshot.forEach(doc => {
            categories.push({ id: doc.id, ...doc.data() });
        });
        res.json(categories);
    } catch (error) {
        console.error('❌ Error fetching categories:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch categories' });
    }
});

app.post('/api/categories', async (req, res) => {
    const error = checkFirebase(res);
    if (error) return error;

    try {
        const categoryData = {
            ...req.body,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            isActive: true,
            courseCount: 0
        };
        
        const docRef = await db.collection('categories').add(categoryData);
        res.status(201).json({ 
            id: docRef.id, 
            message: 'Category created successfully' 
        });
    } catch (error) {
        console.error('❌ Error creating category:', error);
        res.status(500).json({ error: error.message || 'Failed to create category' });
    }
});

app.put('/api/categories/:id', async (req, res) => {
    const error = checkFirebase(res);
    if (error) return error;

    try {
        const updateData = {
            ...req.body,
            updatedAt: new Date().toISOString()
        };
        
        await db.collection('categories').doc(req.params.id).update(updateData);
        res.json({ message: 'Category updated successfully' });
    } catch (error) {
        console.error('❌ Error updating category:', error);
        res.status(500).json({ error: error.message || 'Failed to update category' });
    }
});

app.delete('/api/categories/:id', async (req, res) => {
    const error = checkFirebase(res);
    if (error) return error;

    try {
        await db.collection('categories').doc(req.params.id).delete();
        res.json({ message: 'Category deleted successfully' });
    } catch (error) {
        console.error('❌ Error deleting category:', error);
        res.status(500).json({ error: error.message || 'Failed to delete category' });
    }
});

// ============================================
// NOTIFICATIONS ROUTES
// ============================================

app.get('/api/notifications', async (req, res) => {
    const error = checkFirebase(res);
    if (error) return error;

    try {
        const now = new Date().toISOString();
        const snapshot = await db.collection('notifications')
            .where('expiresAt', '>', now)
            .orderBy('createdAt', 'desc')
            .limit(20)
            .get();
        
        const notifications = [];
        snapshot.forEach(doc => {
            notifications.push({ id: doc.id, ...doc.data() });
        });
        res.json(notifications);
    } catch (error) {
        console.error('❌ Error fetching notifications:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch notifications' });
    }
});

app.post('/api/notifications', async (req, res) => {
    const error = checkFirebase(res);
    if (error) return error;

    try {
        const notificationData = {
            ...req.body,
            createdAt: new Date().toISOString(),
            isRead: false
        };
        
        const docRef = await db.collection('notifications').add(notificationData);
        res.status(201).json({ 
            id: docRef.id, 
            message: 'Notification created successfully' 
        });
    } catch (error) {
        console.error('❌ Error creating notification:', error);
        res.status(500).json({ error: error.message || 'Failed to create notification' });
    }
});

app.delete('/api/notifications/:id', async (req, res) => {
    const error = checkFirebase(res);
    if (error) return error;

    try {
        await db.collection('notifications').doc(req.params.id).delete();
        res.json({ message: 'Notification deleted successfully' });
    } catch (error) {
        console.error('❌ Error deleting notification:', error);
        res.status(500).json({ error: error.message || 'Failed to delete notification' });
    }
});

// ============================================
// OTHER ROUTES
// ============================================

app.post('/api/messages', async (req, res) => {
    const error = checkFirebase(res);
    if (error) return error;

    try {
        const { name, email, subject, message } = req.body;
        
        if (!name || !email || !message) {
            return res.status(400).json({ error: 'Name, email and message required' });
        }
        
        const messageData = {
            name,
            email,
            subject: subject || 'General Inquiry',
            message,
            isRead: false,
            replied: false,
            createdAt: new Date().toISOString()
        };
        
        await db.collection('messages').add(messageData);
        res.status(201).json({ message: 'Message sent successfully' });
    } catch (error) {
        console.error('❌ Error sending message:', error);
        res.status(500).json({ error: error.message || 'Failed to send message' });
    }
});

app.get('/api/messages', async (req, res) => {
    const error = checkFirebase(res);
    if (error) return error;

    try {
        let query = db.collection('messages').orderBy('createdAt', 'desc');
        
        if (req.query.unreadOnly === 'true') {
            query = query.where('isRead', '==', false);
        }
        
        const snapshot = await query.get();
        const messages = [];
        snapshot.forEach(doc => {
            messages.push({ id: doc.id, ...doc.data() });
        });
        res.json(messages);
    } catch (error) {
        console.error('❌ Error fetching messages:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch messages' });
    }
});

app.put('/api/messages/:id/read', async (req, res) => {
    const error = checkFirebase(res);
    if (error) return error;

    try {
        await db.collection('messages').doc(req.params.id).update({
            isRead: true,
            readAt: new Date().toISOString()
        });
        res.json({ message: 'Message marked as read' });
    } catch (error) {
        console.error('❌ Error marking message read:', error);
        res.status(500).json({ error: error.message || 'Failed to update message' });
    }
});

app.get('/api/homepage', async (req, res) => {
    const error = checkFirebase(res);
    if (error) return error;

    try {
        const doc = await db.collection('homepage').doc('settings').get();
        
        if (doc.exists) {
            res.json(doc.data());
        } else {
            res.json({
                heroTitle: 'Jifunze. Jenga. Kua.',
                heroDescription: 'Jipatie ujuzi mpya na kuboresha taaluma yako.',
                heroCTA: 'Anza Sasa',
                heroImage: '',
                statistics: [],
                websiteName: 'PhoneFix Pro',
                websiteDescription: 'Jifunze ujuzi mpya na ujenge mustakabali wako.',
                featuredCourses: []
            });
        }
    } catch (error) {
        console.error('❌ Error fetching homepage:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch homepage settings' });
    }
});

app.put('/api/homepage', async (req, res) => {
    const error = checkFirebase(res);
    if (error) return error;

    try {
        const updateData = {
            ...req.body,
            updatedAt: new Date().toISOString()
        };
        
        await db.collection('homepage').doc('settings').set(updateData, { merge: true });
        res.json({ message: 'Homepage settings updated successfully' });
    } catch (error) {
        console.error('❌ Error updating homepage:', error);
        res.status(500).json({ error: error.message || 'Failed to update homepage settings' });
    }
});

app.get('/api/settings', async (req, res) => {
    const error = checkFirebase(res);
    if (error) return error;

    try {
        const doc = await db.collection('settings').doc('platform').get();
        
        if (doc.exists) {
            res.json(doc.data());
        } else {
            res.json({
                websiteName: 'PhoneFix Pro',
                websiteLogo: null,
                socialLinks: {},
                contactInfo: {},
                footerContent: {
                    copyright: '&copy; 2026 PhoneFix Pro. Haki zote zimehifadhiwa.'
                },
                seoSettings: {}
            });
        }
    } catch (error) {
        console.error('❌ Error fetching settings:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch settings' });
    }
});

app.put('/api/settings', async (req, res) => {
    const error = checkFirebase(res);
    if (error) return error;

    try {
        const updateData = {
            ...req.body,
            updatedAt: new Date().toISOString()
        };
        
        await db.collection('settings').doc('platform').set(updateData, { merge: true });
        res.json({ message: 'Settings updated successfully' });
    } catch (error) {
        console.error('❌ Error updating settings:', error);
        res.status(500).json({ error: error.message || 'Failed to update settings' });
    }
});

app.get('/api/stats', async (req, res) => {
    const error = checkFirebase(res);
    if (error) return error;

    try {
        const coursesSnap = await db.collection('courses').get();
        const usersSnap = await db.collection('users').get();
        const messagesSnap = await db.collection('messages').where('isRead', '==', false).get();
        const notificationsSnap = await db.collection('notifications').get();
        
        res.json({
            totalCourses: coursesSnap.size,
            publishedCourses: coursesSnap.docs.filter(d => d.data().status === 'published').length,
            totalUsers: usersSnap.size,
            unreadMessages: messagesSnap.size,
            totalNotifications: notificationsSnap.size,
            totalStudents: usersSnap.docs.filter(d => d.data().role === 'student').length
        });
    } catch (error) {
        console.error('❌ Error fetching stats:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch statistics' });
    }
});

app.get('/api/users', async (req, res) => {
    const error = checkFirebase(res);
    if (error) return error;

    try {
        const snapshot = await db.collection('users').get();
        const users = [];
        
        snapshot.forEach(doc => {
            const userData = doc.data();
            delete userData.passwordHash;
            users.push({ id: doc.id, ...userData });
        });
        
        res.json(users);
    } catch (error) {
        console.error('❌ Error fetching users:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch users' });
    }
});

app.put('/api/users/:id/block', async (req, res) => {
    const error = checkFirebase(res);
    if (error) return error;

    try {
        const { isBlocked } = req.body;
        if (typeof isBlocked !== 'boolean') {
            return res.status(400).json({ error: 'isBlocked must be a boolean' });
        }

        await db.collection('users').doc(req.params.id).update({
            isBlocked: isBlocked,
            updatedAt: new Date().toISOString()
        });
        
        res.json({ 
            message: `User ${isBlocked ? 'blocked' : 'unblocked'} successfully`,
            isBlocked 
        });
    } catch (error) {
        console.error('❌ Error blocking/unblocking user:', error);
        res.status(500).json({ error: error.message || 'Failed to update user' });
    }
});

// ============================================
// API STATUS
// ============================================
app.get('/api/status', (req, res) => {
    res.json({
        status: 'online',
        firebase: firebaseInitialized ? 'connected' : 'disconnected',
        timestamp: new Date().toISOString(),
        version: '3.0.0'
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
        message: err.message || 'Something went wrong'
    });
});

// ============================================
// START SERVER
// ============================================
app.listen(PORT, '0.0.0.0', () => {
    console.log('========================================');
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📚 PhoneFix Pro API`);
    console.log(`🔗 http://localhost:${PORT}`);
    console.log(`🔗 http://localhost:${PORT}/admin`);
    console.log(`🔥 Firebase: ${firebaseInitialized ? '✅ Connected' : '❌ Not connected'}`);
    console.log(`🔐 Auth routes: /api/auth/login, /api/auth/register`);
    console.log('========================================');
});

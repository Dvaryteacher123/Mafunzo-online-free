// ============================================
// SERVER.JS - FULLY FIXED WITH DEBUG
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
// FIREBASE INITIALIZATION - WITH DEBUG
// ============================================
console.log('========================================');
console.log('🚀 STARTING SERVER...');
console.log('========================================');

let db = null;
let firebaseInitialized = false;

try {
    // Check if credentials exist
    console.log('📋 Checking environment variables...');
    console.log('FIREBASE_PROJECT_ID:', process.env.FIREBASE_PROJECT_ID ? '✅ SET' : '❌ MISSING');
    console.log('FIREBASE_CLIENT_EMAIL:', process.env.FIREBASE_CLIENT_EMAIL ? '✅ SET' : '❌ MISSING');
    console.log('FIREBASE_PRIVATE_KEY:', process.env.FIREBASE_PRIVATE_KEY ? '✅ SET' : '❌ MISSING');

    if (!process.env.FIREBASE_PROJECT_ID || 
        !process.env.FIREBASE_CLIENT_EMAIL || 
        !process.env.FIREBASE_PRIVATE_KEY) {
        console.error('❌ Firebase credentials missing!');
    } else {
        // Parse private key
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
        console.log('📧 Client Email:', serviceAccount.clientEmail);

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
    console.error('❌ Firebase initialization error:', error.message);
    console.error('❌ Full error:', error);
    firebaseInitialized = false;
}

// Test Firebase connection
async function testFirebaseConnection() {
    try {
        console.log('🔍 Testing Firebase connection...');
        
        // Test courses collection
        const coursesSnap = await db.collection('courses').limit(5).get();
        console.log(`📚 Courses found: ${coursesSnap.size}`);
        coursesSnap.forEach(doc => {
            console.log(`   - ${doc.id}: ${doc.data().title || 'Untitled'}`);
        });
        
        // Test categories collection
        const catSnap = await db.collection('categories').limit(5).get();
        console.log(`🏷️ Categories found: ${catSnap.size}`);
        
        // Test notifications collection
        const notifSnap = await db.collection('notifications').limit(5).get();
        console.log(`🔔 Notifications found: ${notifSnap.size}`);
        
        console.log('✅ Firebase test complete!');
    } catch (error) {
        console.error('❌ Firebase test failed:', error.message);
    }
}

function checkFirebase(res) {
    if (!firebaseInitialized || !db) {
        return res.status(503).json({ 
            error: 'Firebase service unavailable',
            message: 'Please check your Firebase credentials'
        });
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
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>PhoneFix Pro</title>
                <style>
                    body { background: #0a0a0f; color: white; font-family: Arial; display: flex; 
                           justify-content: center; align-items: center; height: 100vh; margin: 0; text-align: center; }
                    h1 { color: #6c5ce7; }
                    .error { color: #ff6b6b; }
                    .info { color: #00d4ff; }
                </style>
            </head>
            <body>
                <div>
                    <h1>PhoneFix <span style="color:#00d4ff;">Pro</span></h1>
                    <p class="error">⚠️ index.html not found</p>
                    <p class="info">Please upload index.html file</p>
                    <p style="color:#666;font-size:12px;">Path: ${__dirname}</p>
                </div>
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
// COURSES ROUTES - WITH DEBUG
// ============================================

// GET all courses
app.get('/api/courses', async (req, res) => {
    console.log('📚 GET /api/courses called');
    
    const error = checkFirebase(res);
    if (error) return error;

    try {
        const { category, level, featured, search } = req.query;
        
        console.log('📚 Query params:', { category, level, featured, search });
        
        let query = db.collection('courses');
        
        if (category) query = query.where('category', '==', category);
        if (level) query = query.where('level', '==', level);
        if (featured === 'true') query = query.where('isFeatured', '==', true);
        
        const snapshot = await query.get();
        const courses = [];
        
        snapshot.forEach(doc => {
            courses.push({ 
                id: doc.id, 
                ...doc.data() 
            });
        });

        console.log(`📚 Total courses in database: ${courses.length}`);
        
        // Log each course
        courses.forEach((c, i) => {
            console.log(`   ${i+1}. ${c.title} | Status: ${c.status}`);
        });

        // Filter published courses for public
        const published = courses.filter(c => c.status === 'published');
        console.log(`📚 Published courses: ${published.length}`);

        // If search, filter
        if (search) {
            const searchLower = search.toLowerCase();
            const filtered = published.filter(course => 
                (course.title || '').toLowerCase().includes(searchLower) ||
                (course.description || '').toLowerCase().includes(searchLower) ||
                (course.category || '').toLowerCase().includes(searchLower) ||
                (course.instructor || '').toLowerCase().includes(searchLower)
            );
            console.log(`📚 Search results: ${filtered.length}`);
            return res.json(filtered);
        }
        
        // Return published courses
        console.log(`✅ Returning ${published.length} published courses`);
        res.json(published);
        
    } catch (error) {
        console.error('❌ Error fetching courses:', error);
        res.status(500).json({ 
            error: 'Failed to fetch courses',
            message: error.message
        });
    }
});

// GET single course
app.get('/api/courses/:id', async (req, res) => {
    console.log(`📚 GET /api/courses/${req.params.id}`);
    
    const error = checkFirebase(res);
    if (error) return error;

    try {
        const courseDoc = await db.collection('courses').doc(req.params.id).get();
        
        if (!courseDoc.exists) {
            console.log(`❌ Course not found: ${req.params.id}`);
            return res.status(404).json({ error: 'Course not found' });
        }
        
        console.log(`✅ Course found: ${req.params.id}`);
        res.json({ id: req.params.id, ...courseDoc.data() });
    } catch (error) {
        console.error('❌ Error fetching course:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch course' });
    }
});

// POST create course
app.post('/api/courses', async (req, res) => {
    console.log('📚 POST /api/courses - Creating course...');
    console.log('📚 Body:', req.body);
    
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
        console.log(`✅ Course created successfully: ${docRef.id}`);
        
        res.status(201).json({ 
            id: docRef.id, 
            message: 'Course created successfully' 
        });
    } catch (error) {
        console.error('❌ Error creating course:', error);
        res.status(500).json({ error: error.message || 'Failed to create course' });
    }
});

// PUT update course
app.put('/api/courses/:id', async (req, res) => {
    console.log(`📚 PUT /api/courses/${req.params.id}`);
    
    const error = checkFirebase(res);
    if (error) return error;

    try {
        const updateData = {
            ...req.body,
            updatedAt: new Date().toISOString()
        };
        
        await db.collection('courses').doc(req.params.id).update(updateData);
        console.log(`✅ Course updated: ${req.params.id}`);
        
        res.json({ message: 'Course updated successfully' });
    } catch (error) {
        console.error('❌ Error updating course:', error);
        res.status(500).json({ error: error.message || 'Failed to update course' });
    }
});

// DELETE course
app.delete('/api/courses/:id', async (req, res) => {
    console.log(`📚 DELETE /api/courses/${req.params.id}`);
    
    const error = checkFirebase(res);
    if (error) return error;

    try {
        await db.collection('courses').doc(req.params.id).delete();
        console.log(`✅ Course deleted: ${req.params.id}`);
        
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
    console.log('🏷️ GET /api/categories');
    
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
        
        console.log(`🏷️ Categories found: ${categories.length}`);
        res.json(categories);
    } catch (error) {
        console.error('❌ Error fetching categories:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch categories' });
    }
});

app.post('/api/categories', async (req, res) => {
    console.log('🏷️ POST /api/categories - Creating...');
    
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
        console.log(`✅ Category created: ${docRef.id}`);
        
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
    console.log(`🏷️ PUT /api/categories/${req.params.id}`);
    
    const error = checkFirebase(res);
    if (error) return error;

    try {
        const updateData = {
            ...req.body,
            updatedAt: new Date().toISOString()
        };
        
        await db.collection('categories').doc(req.params.id).update(updateData);
        console.log(`✅ Category updated: ${req.params.id}`);
        
        res.json({ message: 'Category updated successfully' });
    } catch (error) {
        console.error('❌ Error updating category:', error);
        res.status(500).json({ error: error.message || 'Failed to update category' });
    }
});

app.delete('/api/categories/:id', async (req, res) => {
    console.log(`🏷️ DELETE /api/categories/${req.params.id}`);
    
    const error = checkFirebase(res);
    if (error) return error;

    try {
        await db.collection('categories').doc(req.params.id).delete();
        console.log(`✅ Category deleted: ${req.params.id}`);
        
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
    console.log('🔔 GET /api/notifications');
    
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
        
        console.log(`🔔 Notifications found: ${notifications.length}`);
        res.json(notifications);
    } catch (error) {
        console.error('❌ Error fetching notifications:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch notifications' });
    }
});

app.post('/api/notifications', async (req, res) => {
    console.log('🔔 POST /api/notifications - Creating...');
    
    const error = checkFirebase(res);
    if (error) return error;

    try {
        const notificationData = {
            ...req.body,
            createdAt: new Date().toISOString(),
            isRead: false
        };
        
        const docRef = await db.collection('notifications').add(notificationData);
        console.log(`✅ Notification created: ${docRef.id}`);
        
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
    console.log(`🔔 DELETE /api/notifications/${req.params.id}`);
    
    const error = checkFirebase(res);
    if (error) return error;

    try {
        await db.collection('notifications').doc(req.params.id).delete();
        console.log(`✅ Notification deleted: ${req.params.id}`);
        
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
// CATCH-ALL
// ============================================
app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ 
            error: 'API endpoint not found',
            path: req.path
        });
    }
    
    const indexPath = path.join(__dirname, 'index.html');
    const fs = require('fs');
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        res.status(200).send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>PhoneFix Pro</title>
                <style>
                    body { background: #0a0a0f; color: white; font-family: Arial; display: flex; 
                           justify-content: center; align-items: center; height: 100vh; margin: 0; text-align: center; }
                    h1 { color: #6c5ce7; }
                    .error { color: #ff6b6b; }
                </style>
            </head>
            <body>
                <div>
                    <h1>PhoneFix <span style="color:#00d4ff;">Pro</span></h1>
                    <p class="error">⚠️ index.html not found</p>
                    <p>Please upload index.html file</p>
                </div>
            </body>
            </html>
        `);
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

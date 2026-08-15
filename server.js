// ============================================
// SERVER.JS - NO AUTHENTICATION REQUIRED
// Premium Educational Platform - Full Public Access
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
const { getAuth } = require('firebase-admin/auth');
const bcrypt = require('bcryptjs');

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
app.use(morgan('combined'));
app.use(express.static(__dirname));

// ============================================
// FIREBASE INITIALIZATION
// ============================================
let db = null;
let auth = null;
let firebaseInitialized = false;

try {
    if (!process.env.FIREBASE_PROJECT_ID || 
        !process.env.FIREBASE_CLIENT_EMAIL || 
        !process.env.FIREBASE_PRIVATE_KEY) {
        console.warn('⚠️ Firebase credentials missing');
    } else {
        const serviceAccount = {
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
        };

        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            storageBucket: process.env.FIREBASE_STORAGE_BUCKET
        });

        db = getFirestore();
        auth = getAuth();
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
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/admin/', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// ============================================
// API STATUS
// ============================================
app.get('/api/status', (req, res) => {
    res.json({
        status: 'online',
        firebase: firebaseInitialized ? 'connected' : 'disconnected',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        auth: 'disabled - public access'
    });
});

// ============================================
// ALL ROUTES - NO AUTHENTICATION REQUIRED
// ============================================

// ============================================
// COURSES ROUTES - All public
// ============================================

// GET all courses - PUBLIC
app.get('/api/courses', async (req, res) => {
    const error = checkFirebase(res);
    if (error) return error;

    try {
        const { category, level, featured, search } = req.query;
        
        let query = db.collection('courses');
        
        // Show all courses (including drafts) since no auth
        // But we can filter by status if needed
        if (req.query.status) {
            query = query.where('status', '==', req.query.status);
        }
        
        if (category) query = query.where('category', '==', category);
        if (level) query = query.where('level', '==', level);
        if (featured === 'true') query = query.where('isFeatured', '==', true);
        
        const snapshot = await query.get();
        const courses = [];
        snapshot.forEach(doc => {
            courses.push({ id: doc.id, ...doc.data() });
        });

        if (search) {
            const searchLower = search.toLowerCase();
            return res.json(courses.filter(course => 
                course.title?.toLowerCase().includes(searchLower) ||
                course.description?.toLowerCase().includes(searchLower) ||
                course.category?.toLowerCase().includes(searchLower) ||
                course.instructor?.toLowerCase().includes(searchLower)
            ));
        }
        
        res.json(courses);
    } catch (error) {
        console.error('Error fetching courses:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch courses' });
    }
});

// GET single course - PUBLIC
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
        console.error('Error fetching course:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch course' });
    }
});

// POST create course - PUBLIC (No auth)
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
        res.status(201).json({ 
            id: docRef.id, 
            message: 'Course created successfully' 
        });
    } catch (error) {
        console.error('Error creating course:', error);
        res.status(500).json({ error: error.message || 'Failed to create course' });
    }
});

// PUT update course - PUBLIC (No auth)
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
        console.error('Error updating course:', error);
        res.status(500).json({ error: error.message || 'Failed to update course' });
    }
});

// DELETE course - PUBLIC (No auth)
app.delete('/api/courses/:id', async (req, res) => {
    const error = checkFirebase(res);
    if (error) return error;

    try {
        await db.collection('courses').doc(req.params.id).delete();
        res.json({ message: 'Course deleted successfully' });
    } catch (error) {
        console.error('Error deleting course:', error);
        res.status(500).json({ error: error.message || 'Failed to delete course' });
    }
});

// ============================================
// CATEGORIES ROUTES - All public
// ============================================

// GET all categories - PUBLIC
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
        console.error('Error fetching categories:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch categories' });
    }
});

// POST create category - PUBLIC (No auth)
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
        console.error('Error creating category:', error);
        res.status(500).json({ error: error.message || 'Failed to create category' });
    }
});

// PUT update category - PUBLIC (No auth)
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
        console.error('Error updating category:', error);
        res.status(500).json({ error: error.message || 'Failed to update category' });
    }
});

// DELETE category - PUBLIC (No auth)
app.delete('/api/categories/:id', async (req, res) => {
    const error = checkFirebase(res);
    if (error) return error;

    try {
        await db.collection('categories').doc(req.params.id).delete();
        res.json({ message: 'Category deleted successfully' });
    } catch (error) {
        console.error('Error deleting category:', error);
        res.status(500).json({ error: error.message || 'Failed to delete category' });
    }
});

// ============================================
// LESSONS ROUTES - All public
// ============================================

// GET lessons for a course - PUBLIC
app.get('/api/courses/:courseId/lessons', async (req, res) => {
    const error = checkFirebase(res);
    if (error) return error;

    try {
        const snapshot = await db.collection('lessons')
            .where('courseId', '==', req.params.courseId)
            .orderBy('order')
            .get();
        
        const lessons = [];
        snapshot.forEach(doc => {
            lessons.push({ id: doc.id, ...doc.data() });
        });
        res.json(lessons);
    } catch (error) {
        console.error('Error fetching lessons:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch lessons' });
    }
});

// POST create lesson - PUBLIC (No auth)
app.post('/api/lessons', async (req, res) => {
    const error = checkFirebase(res);
    if (error) return error;

    try {
        const lessonData = {
            ...req.body,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        
        const docRef = await db.collection('lessons').add(lessonData);
        res.status(201).json({ 
            id: docRef.id, 
            message: 'Lesson created successfully' 
        });
    } catch (error) {
        console.error('Error creating lesson:', error);
        res.status(500).json({ error: error.message || 'Failed to create lesson' });
    }
});

// ============================================
// HOMEPAGE ROUTES - All public
// ============================================

// GET homepage settings - PUBLIC
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
                heroDescription: 'Jipatie ujuzi mpya na kuboresha taaluma yako kwa mafunzo ya kisasa.',
                heroCTA: 'Anza Sasa',
                heroImage: '',
                statistics: [],
                websiteName: 'Educational Platform',
                websiteDescription: '',
                featuredCourses: []
            });
        }
    } catch (error) {
        console.error('Error fetching homepage:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch homepage settings' });
    }
});

// PUT update homepage - PUBLIC (No auth)
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
        console.error('Error updating homepage:', error);
        res.status(500).json({ error: error.message || 'Failed to update homepage settings' });
    }
});

// ============================================
// USERS ROUTES - All public
// ============================================

// GET all users - PUBLIC (No auth)
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
        console.error('Error fetching users:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch users' });
    }
});

// ============================================
// MESSAGES ROUTES - All public
// ============================================

// POST contact message - PUBLIC
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
        console.error('Error sending message:', error);
        res.status(500).json({ error: error.message || 'Failed to send message' });
    }
});

// GET messages - PUBLIC (No auth)
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
        console.error('Error fetching messages:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch messages' });
    }
});

// PUT mark message as read - PUBLIC (No auth)
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
        console.error('Error marking message read:', error);
        res.status(500).json({ error: error.message || 'Failed to update message' });
    }
});

// ============================================
// NOTIFICATIONS ROUTES - All public
// ============================================

// GET notifications - PUBLIC
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
        console.error('Error fetching notifications:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch notifications' });
    }
});

// POST create notification - PUBLIC (No auth)
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
        console.error('Error creating notification:', error);
        res.status(500).json({ error: error.message || 'Failed to create notification' });
    }
});

// DELETE notification - PUBLIC (No auth)
app.delete('/api/notifications/:id', async (req, res) => {
    const error = checkFirebase(res);
    if (error) return error;

    try {
        await db.collection('notifications').doc(req.params.id).delete();
        res.json({ message: 'Notification deleted successfully' });
    } catch (error) {
        console.error('Error deleting notification:', error);
        res.status(500).json({ error: error.message || 'Failed to delete notification' });
    }
});

// ============================================
// MEDIA ROUTES - All public
// ============================================

// POST upload media - PUBLIC (No auth)
app.post('/api/media', async (req, res) => {
    const error = checkFirebase(res);
    if (error) return error;

    try {
        const mediaData = {
            ...req.body,
            uploadDate: new Date().toISOString(),
            isPublic: req.body.isPublic || false
        };
        
        const docRef = await db.collection('media').add(mediaData);
        res.status(201).json({ 
            id: docRef.id, 
            message: 'Media uploaded successfully' 
        });
    } catch (error) {
        console.error('Error uploading media:', error);
        res.status(500).json({ error: error.message || 'Failed to upload media' });
    }
});

// GET media - PUBLIC (No auth)
app.get('/api/media', async (req, res) => {
    const error = checkFirebase(res);
    if (error) return error;

    try {
        const snapshot = await db.collection('media')
            .orderBy('uploadDate', 'desc')
            .get();
        
        const media = [];
        snapshot.forEach(doc => {
            media.push({ id: doc.id, ...doc.data() });
        });
        res.json(media);
    } catch (error) {
        console.error('Error fetching media:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch media' });
    }
});

// DELETE media - PUBLIC (No auth)
app.delete('/api/media/:id', async (req, res) => {
    const error = checkFirebase(res);
    if (error) return error;

    try {
        await db.collection('media').doc(req.params.id).delete();
        res.json({ message: 'Media deleted successfully' });
    } catch (error) {
        console.error('Error deleting media:', error);
        res.status(500).json({ error: error.message || 'Failed to delete media' });
    }
});

// ============================================
// SETTINGS ROUTES - All public
// ============================================

// GET settings - PUBLIC
app.get('/api/settings', async (req, res) => {
    const error = checkFirebase(res);
    if (error) return error;

    try {
        const doc = await db.collection('settings').doc('platform').get();
        
        if (doc.exists) {
            res.json(doc.data());
        } else {
            res.json({
                websiteName: 'Educational Platform',
                websiteLogo: null,
                socialLinks: {},
                contactInfo: {},
                footerContent: {},
                seoSettings: {}
            });
        }
    } catch (error) {
        console.error('Error fetching settings:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch settings' });
    }
});

// PUT update settings - PUBLIC (No auth)
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
        console.error('Error updating settings:', error);
        res.status(500).json({ error: error.message || 'Failed to update settings' });
    }
});

// ============================================
// STATS ROUTE - Public
// ============================================

// GET stats - PUBLIC (No auth)
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
        console.error('Error fetching stats:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch statistics' });
    }
});

// ============================================
// AUTH ROUTES - Still available if needed
// ============================================

// LOGIN (optional - kept for compatibility)
app.post('/api/auth/login', async (req, res) => {
    const error = checkFirebase(res);
    if (error) return error;

    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password required' });
        }

        const userSnapshot = await db.collection('users')
            .where('email', '==', email)
            .limit(1)
            .get();

        if (userSnapshot.empty) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const userDoc = userSnapshot.docs[0];
        const userData = userDoc.data();
        const userUid = userDoc.id;

        const isValidPassword = await bcrypt.compare(password, userData.passwordHash || '');
        if (!isValidPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = jwt.sign(
            { uid: userUid, email: userData.email, role: userData.role },
            process.env.JWT_SECRET || 'fallback-secret',
            { expiresIn: '7d' }
        );

        await db.collection('users').doc(userUid).update({
            lastLogin: new Date().toISOString()
        });

        res.json({
            success: true,
            token,
            user: {
                uid: userUid,
                email: userData.email,
                displayName: userData.displayName,
                role: userData.role,
                permissions: userData.permissions || []
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: error.message || 'Login failed' });
    }
});

// ============================================
// CATCH-ALL ROUTE
// ============================================
app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'API endpoint not found' });
    }
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ 
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
    });
});

// ============================================
// START SERVER
// ============================================
app.listen(PORT, '0.0.0.0', () => {
    console.log('🚀 ==========================================');
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`📚 Educational Platform - PUBLIC ACCESS`);
    console.log(`🔗 http://localhost:${PORT}`);
    console.log(`🔗 http://localhost:${PORT}/admin`);
    console.log(`🔓 Authentication: DISABLED - All routes are public`);
    console.log(`🔥 Firebase: ${firebaseInitialized ? '✅ Connected' : '❌ Not connected'}`);
    console.log('==========================================');
});

process.on('SIGTERM', () => {
    console.log('🛑 Received SIGTERM, shutting down gracefully...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('🛑 Received SIGINT, shutting down gracefully...');
    process.exit(0);
});

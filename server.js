// ============================================
// SERVER.JS - COMPLETE VERSION
// Premium Educational Platform
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
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 5000;

// ============================================
// MIDDLEWARE
// ============================================
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors({ origin: '*', credentials: true }));
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
    if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PRIVATE_KEY) {
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
        console.log('✅ Firebase initialized');
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
// AUTHENTICATION MIDDLEWARE
// ============================================
const authenticate = async (req, res, next) => {
    if (!firebaseInitialized) {
        return res.status(503).json({ error: 'Firebase service unavailable' });
    }

    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const token = authHeader.split('Bearer ')[1];
        if (!token) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret');
        const userDoc = await db.collection('users').doc(decoded.uid).get();
        
        if (!userDoc.exists) {
            return res.status(401).json({ error: 'User not found' });
        }

        req.user = { uid: decoded.uid, ...userDoc.data() };
        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Session expired. Please login again.' });
        }
        return res.status(401).json({ error: 'Invalid authentication' });
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

const requirePermission = (permission) => {
    return (req, res, next) => {
        if (!req.user) return res.status(401).json({ error: 'Authentication required' });
        const hasPermission = req.user.permissions?.includes(permission) || req.user.role === 'super_admin';
        if (!hasPermission) {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }
        next();
    };
};

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
// AUTH ROUTES - PUBLIC
// ============================================
app.post('/api/auth/login', async (req, res) => {
    const error = checkFirebase(res);
    if (error) return error;

    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password required' });
        }

        const userSnapshot = await db.collection('users')
            .where('email', '==', email).limit(1).get();

        if (userSnapshot.empty) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const userDoc = userSnapshot.docs[0];
        const userData = userDoc.data();
        const userUid = userDoc.id;

        const adminRoles = ['super_admin', 'content_admin', 'media_admin', 'support_admin', 'editor'];
        if (!adminRoles.includes(userData.role)) {
            return res.status(403).json({ error: 'Access denied. Admin only.' });
        }

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

app.post('/api/auth/register', async (req, res) => {
    const error = checkFirebase(res);
    if (error) return error;

    try {
        const { email, password, displayName, role } = req.body;
        if (!email || !password || !displayName) {
            return res.status(400).json({ error: 'Email, password and name required' });
        }

        const existingUser = await db.collection('users')
            .where('email', '==', email).limit(1).get();

        if (!existingUser.empty) {
            return res.status(400).json({ error: 'Email already registered' });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const userRecord = await auth.createUser({ email, password, displayName });

        const userData = {
            email,
            displayName,
            role: role || 'student',
            passwordHash: hashedPassword,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            lastLogin: new Date().toISOString(),
            isActive: true,
            permissions: ['view_courses', 'view_lessons'],
            photoURL: null,
            phone: null,
            bio: null
        };

        await db.collection('users').doc(userRecord.uid).set(userData);

        res.status(201).json({
            message: 'User created successfully',
            uid: userRecord.uid
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: error.message || 'Registration failed' });
    }
});

// ============================================
// PUBLIC ROUTES - No auth required
// ============================================
app.get('/api/courses', async (req, res) => {
    const error = checkFirebase(res);
    if (error) return error;

    try {
        const { category, level, featured, search } = req.query;
        let query = db.collection('courses').where('status', '==', 'published');
        
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

app.get('/api/homepage', async (req, res) => {
    const error = checkFirebase(res);
    if (error) return error;

    try {
        const doc = await db.collection('homepage').doc('settings').get();
        
        if (doc.exists) {
            res.json(doc.data());
        } else {
            res.json({
                heroTitle: '',
                heroDescription: '',
                heroCTA: 'Get Started',
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

app.get('/api/notifications', async (req, res) => {
    const error = checkFirebase(res);
    if (error) return error;

    try {
        const now = new Date().toISOString();
        const snapshot = await db.collection('notifications')
            .where('expiresAt', '>', now)
            .orderBy('createdAt', 'desc')
            .limit(10)
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

// ============================================
// PROTECTED ROUTES - Auth required
// ============================================

// Stats
app.get('/api/stats', authenticate, requireRole(['super_admin', 'content_admin']), async (req, res) => {
    const error = checkFirebase(res);
    if (error) return error;

    try {
        const coursesSnap = await db.collection('courses').get();
        const usersSnap = await db.collection('users').get();
        const messagesSnap = await db.collection('messages').where('isRead', '==', false).get();
        
        res.json({
            totalCourses: coursesSnap.size,
            publishedCourses: coursesSnap.docs.filter(d => d.data().status === 'published').length,
            totalUsers: usersSnap.size,
            unreadMessages: messagesSnap.size,
            totalStudents: usersSnap.docs.filter(d => d.data().role === 'student').length
        });
    } catch (error) {
        console.error('Error fetching stats:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch statistics' });
    }
});

// Courses - Protected
app.post('/api/courses', authenticate, requirePermission('create_courses'), async (req, res) => {
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

app.put('/api/courses/:id', authenticate, requirePermission('edit_courses'), async (req, res) => {
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

app.delete('/api/courses/:id', authenticate, requirePermission('delete_courses'), async (req, res) => {
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

// Categories - Protected
app.post('/api/categories', authenticate, requirePermission('manage_categories'), async (req, res) => {
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

app.put('/api/categories/:id', authenticate, requirePermission('manage_categories'), async (req, res) => {
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

app.delete('/api/categories/:id', authenticate, requirePermission('manage_categories'), async (req, res) => {
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

// Lessons - Protected
app.post('/api/lessons', authenticate, requirePermission('create_lessons'), async (req, res) => {
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

// Homepage - Protected
app.put('/api/homepage', authenticate, requireRole(['super_admin']), async (req, res) => {
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

// Users - Protected
app.get('/api/users', authenticate, requireRole(['super_admin']), async (req, res) => {
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

// Messages - Protected
app.get('/api/messages', authenticate, requirePermission('view_messages'), async (req, res) => {
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

app.put('/api/messages/:id/read', authenticate, requirePermission('view_messages'), async (req, res) => {
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

// Notifications - Protected
app.post('/api/notifications', authenticate, requirePermission('create_notifications'), async (req, res) => {
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

// Media - Protected
app.post('/api/media', authenticate, requirePermission('upload_media'), async (req, res) => {
    const error = checkFirebase(res);
    if (error) return error;

    try {
        const mediaData = {
            ...req.body,
            uploadedBy: req.user.uid,
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

app.get('/api/media', authenticate, requirePermission('view_media'), async (req, res) => {
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

// Settings - Protected
app.put('/api/settings', authenticate, requireRole(['super_admin']), async (req, res) => {
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
// CATCH-ALL
// ============================================
app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'API endpoint not found' });
    }
    res.status(404).sendFile(path.join(__dirname, 'index.html'));
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
    console.log(`📚 Educational Platform`);
    console.log(`🔗 http://localhost:${PORT}`);
    console.log(`🔗 http://localhost:${PORT}/admin`);
    console.log(`🔥 Firebase: ${firebaseInitialized ? '✅ Connected' : '❌ Not connected'}`);
    console.log('==========================================');
});

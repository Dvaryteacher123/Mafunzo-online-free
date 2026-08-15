// ============================================
// SERVER.JS - COMPLETE BACKEND
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

// Serve static files from current directory
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

        // Check if user is blocked
        const userData = userDoc.data();
        if (userData.isBlocked) {
            return res.status(403).json({ error: 'Your account has been blocked. Please contact support.' });
        }

        req.user = { uid: decoded.uid, ...userData };
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
        const hasPermission = req.user.permissions?.includes(permission) || 
                            req.user.role === 'super_admin';
        if (!hasPermission) {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }
        next();
    };
};

// ============================================
// WEB ROUTES
// ============================================

// Serve index.html for root
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Serve admin.html for /admin
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
        version: '1.0.0'
    });
});

// ============================================
// AUTH ROUTES - PUBLIC
// ============================================

// CHECK USERNAME AVAILABILITY - NEW!
app.get('/api/auth/check-username', async (req, res) => {
    const error = checkFirebase(res);
    if (error) return error;

    try {
        const { username } = req.query;
        if (!username) {
            return res.status(400).json({ error: 'Username required' });
        }

        // Validate username format
        if (!/^[a-zA-Z0-9_]{3,30}$/.test(username)) {
            return res.status(400).json({ 
                error: 'Username must be 3-30 characters and contain only letters, numbers and underscore',
                available: false 
            });
        }

        // Case-insensitive check
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

// LOGIN
app.post('/api/auth/login', async (req, res) => {
    const error = checkFirebase(res);
    if (error) return error;

    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password required' });
        }

        // Check if user exists by email or username
        let userSnapshot = await db.collection('users')
            .where('email', '==', email.toLowerCase())
            .limit(1)
            .get();

        // If not found by email, try username
        if (userSnapshot.empty) {
            userSnapshot = await db.collection('users')
                .where('username', '==', email.toLowerCase())
                .limit(1)
                .get();
        }

        if (userSnapshot.empty) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const userDoc = userSnapshot.docs[0];
        const userData = userDoc.data();
        const userUid = userDoc.id;

        // Check if user is blocked
        if (userData.isBlocked) {
            return res.status(403).json({ error: 'Your account has been blocked. Please contact support.' });
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
                username: userData.username || '',
                role: userData.role,
                permissions: userData.permissions || [],
                isBlocked: userData.isBlocked || false
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: error.message || 'Login failed' });
    }
});

// REGISTER - With username validation
app.post('/api/auth/register', async (req, res) => {
    const error = checkFirebase(res);
    if (error) return error;

    try {
        const { email, password, displayName, username, phone, role } = req.body;

        if (!email || !password || !displayName || !username) {
            return res.status(400).json({ error: 'Email, password, username and name required' });
        }

        // Validate username format
        if (!/^[a-zA-Z0-9_]{3,30}$/.test(username)) {
            return res.status(400).json({ 
                error: 'Username must be 3-30 characters and contain only letters, numbers and underscore'
            });
        }

        // Check if email already exists
        const existingEmail = await db.collection('users')
            .where('email', '==', email.toLowerCase())
            .limit(1)
            .get();

        if (!existingEmail.empty) {
            return res.status(400).json({ error: 'Email already registered' });
        }

        // Check if username already exists (case-insensitive)
        const existingUsername = await db.collection('users')
            .where('username', '==', username.toLowerCase())
            .limit(1)
            .get();

        if (!existingUsername.empty) {
            return res.status(400).json({ error: 'Username already taken' });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Create user in Firebase Auth
        const userRecord = await auth.createUser({
            email: email.toLowerCase(),
            password,
            displayName
        });

        // Create user in Firestore
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
// PUBLIC ROUTES - No authentication required
// ============================================

// GET all courses (published only for public)
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

// GET single course
app.get('/api/courses/:id', async (req, res) => {
    const error = checkFirebase(res);
    if (error) return error;

    try {
        const courseDoc = await db.collection('courses').doc(req.params.id).get();
        
        if (!courseDoc.exists) {
            return res.status(404).json({ error: 'Course not found' });
        }
        
        const courseData = courseDoc.data();
        
        // If course is not published, check if user is admin via token
        if (courseData.status !== 'published') {
            const authHeader = req.headers.authorization;
            if (!authHeader) {
                return res.status(403).json({ error: 'Course not available' });
            }
            
            try {
                const token = authHeader.split('Bearer ')[1];
                const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret');
                const userDoc = await db.collection('users').doc(decoded.uid).get();
                const userData = userDoc.data();
                
                if (!['super_admin', 'content_admin', 'editor'].includes(userData?.role)) {
                    return res.status(403).json({ error: 'Course not available' });
                }
            } catch (err) {
                return res.status(403).json({ error: 'Course not available' });
            }
        }
        
        res.json({ id: req.params.id, ...courseData });
    } catch (error) {
        console.error('Error fetching course:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch course' });
    }
});

// GET all categories (public)
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

// GET homepage settings (public)
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

// GET notifications (public)
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

// POST contact message (public)
app.post('/api/messages', async (req, res) => {
    const error = checkFirebase(res);
    if (error) return error;

    try {
        const { name, email, subject, message } = req.body;
        
        if (!name || !email || !message) {
            return res.status(400).json({ error: 'Name, email and message required' });
        }
        
        const messageData = {
            name: name.trim(),
            email: email.toLowerCase().trim(),
            subject: subject || 'General Inquiry',
            message: message.trim(),
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

// GET settings (public)
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
// PROTECTED ROUTES - Authentication required
// ============================================

// GET stats (admin only)
app.get('/api/stats', authenticate, requireRole(['super_admin', 'content_admin']), async (req, res) => {
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
// COURSES - Protected CRUD
// ============================================

// POST create course (admin only)
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

// PUT update course (admin only)
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

// DELETE course (admin only)
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

// ============================================
// CATEGORIES - Protected CRUD
// ============================================

// POST create category (admin only)
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

// PUT update category (admin only)
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

// DELETE category (admin only)
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

// ============================================
// LESSONS - Protected CRUD
// ============================================

// GET lessons for a course (public if course published)
app.get('/api/courses/:courseId/lessons', async (req, res) => {
    const error = checkFirebase(res);
    if (error) return error;

    try {
        // Check if course is published
        const courseDoc = await db.collection('courses').doc(req.params.courseId).get();
        if (!courseDoc.exists) {
            return res.status(404).json({ error: 'Course not found' });
        }
        
        const courseData = courseDoc.data();
        if (courseData.status !== 'published') {
            // Check if user is admin
            const authHeader = req.headers.authorization;
            if (!authHeader) {
                return res.status(403).json({ error: 'Lessons not available' });
            }
            try {
                const token = authHeader.split('Bearer ')[1];
                const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret');
                const userDoc = await db.collection('users').doc(decoded.uid).get();
                const userData = userDoc.data();
                if (!['super_admin', 'content_admin', 'editor'].includes(userData?.role)) {
                    return res.status(403).json({ error: 'Lessons not available' });
                }
            } catch (err) {
                return res.status(403).json({ error: 'Lessons not available' });
            }
        }

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

// POST create lesson (admin only)
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

// ============================================
// HOMEPAGE - Protected
// ============================================

// PUT update homepage (admin only)
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

// ============================================
// USERS - Protected (Admin only)
// ============================================

// GET all users (admin only)
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

// GET single user (admin only)
app.get('/api/users/:id', authenticate, requireRole(['super_admin']), async (req, res) => {
    const error = checkFirebase(res);
    if (error) return error;

    try {
        const userDoc = await db.collection('users').doc(req.params.id).get();
        if (!userDoc.exists) {
            return res.status(404).json({ error: 'User not found' });
        }
        const userData = userDoc.data();
        delete userData.passwordHash;
        res.json({ id: req.params.id, ...userData });
    } catch (error) {
        console.error('Error fetching user:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch user' });
    }
});

// UPDATE user (admin only)
app.put('/api/users/:id', authenticate, requireRole(['super_admin']), async (req, res) => {
    const error = checkFirebase(res);
    if (error) return error;

    try {
        const updateData = {
            ...req.body,
            updatedAt: new Date().toISOString()
        };
        
        delete updateData.passwordHash;
        await db.collection('users').doc(req.params.id).update(updateData);
        res.json({ message: 'User updated successfully' });
    } catch (error) {
        console.error('Error updating user:', error);
        res.status(500).json({ error: error.message || 'Failed to update user' });
    }
});

// BLOCK/UNBLOCK user (admin only)
app.put('/api/users/:id/block', authenticate, requireRole(['super_admin']), async (req, res) => {
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
        console.error('Error blocking/unblocking user:', error);
        res.status(500).json({ error: error.message || 'Failed to update user' });
    }
});

// ============================================
// MESSAGES - Protected (Admin only)
// ============================================

// GET messages (admin only)
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

// GET single message (admin only)
app.get('/api/messages/:id', authenticate, requirePermission('view_messages'), async (req, res) => {
    const error = checkFirebase(res);
    if (error) return error;

    try {
        const msgDoc = await db.collection('messages').doc(req.params.id).get();
        if (!msgDoc.exists) {
            return res.status(404).json({ error: 'Message not found' });
        }
        res.json({ id: req.params.id, ...msgDoc.data() });
    } catch (error) {
        console.error('Error fetching message:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch message' });
    }
});

// Mark message as read (admin only)
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

// ============================================
// NOTIFICATIONS - Protected (Admin only)
// ============================================

// POST create notification (admin only)
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

// DELETE notification (admin only)
app.delete('/api/notifications/:id', authenticate, requirePermission('create_notifications'), async (req, res) => {
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
// MEDIA - Protected (Admin only)
// ============================================

// POST upload media metadata (admin only)
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

// GET media (admin only)
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

// DELETE media (admin only)
app.delete('/api/media/:id', authenticate, requirePermission('manage_media'), async (req, res) => {
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
// SETTINGS - Protected (Admin only)
// ============================================

// PUT update settings (admin only)
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
// ADMIN ACCESS - Protected (Super Admin only)
// ============================================

// GET admin users (super admin only)
app.get('/api/admin-users', authenticate, requireRole(['super_admin']), async (req, res) => {
    const error = checkFirebase(res);
    if (error) return error;

    try {
        const adminRoles = ['super_admin', 'content_admin', 'media_admin', 'support_admin', 'editor'];
        const snapshot = await db.collection('users')
            .where('role', 'in', adminRoles)
            .get();
        
        const users = [];
        snapshot.forEach(doc => {
            const userData = doc.data();
            delete userData.passwordHash;
            users.push({ id: doc.id, ...userData });
        });
        res.json(users);
    } catch (error) {
        console.error('Error fetching admin users:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch admin users' });
    }
});

// UPDATE admin user role (super admin only)
app.put('/api/admin-users/:id/role', authenticate, requireRole(['super_admin']), async (req, res) => {
    const error = checkFirebase(res);
    if (error) return error;

    try {
        const { role } = req.body;
        const validRoles = ['super_admin', 'content_admin', 'media_admin', 'support_admin', 'editor', 'student'];
        
        if (!validRoles.includes(role)) {
            return res.status(400).json({ error: 'Invalid role' });
        }

        await db.collection('users').doc(req.params.id).update({
            role: role,
            permissions: getDefaultPermissions(role),
            updatedAt: new Date().toISOString()
        });
        
        res.json({ message: 'User role updated successfully' });
    } catch (error) {
        console.error('Error updating user role:', error);
        res.status(500).json({ error: error.message || 'Failed to update user role' });
    }
});

// ============================================
// ACTIVITY LOGS - Protected (Admin only)
// ============================================

// GET activity logs (admin only)
app.get('/api/activity-logs', authenticate, requireRole(['super_admin', 'content_admin']), async (req, res) => {
    const error = checkFirebase(res);
    if (error) return error;

    try {
        const { limit = 50 } = req.query;
        const snapshot = await db.collection('activityLogs')
            .orderBy('timestamp', 'desc')
            .limit(parseInt(limit))
            .get();
        
        const logs = [];
        snapshot.forEach(doc => {
            logs.push({ id: doc.id, ...doc.data() });
        });
        res.json(logs);
    } catch (error) {
        console.error('Error fetching activity logs:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch activity logs' });
    }
});

// ============================================
// HELPER FUNCTION
// ============================================
function getDefaultPermissions(role) {
    const permissions = {
        student: ['view_courses', 'view_lessons'],
        editor: ['view_courses', 'edit_courses', 'create_courses', 'edit_lessons'],
        content_admin: ['view_courses', 'create_courses', 'edit_courses', 'delete_courses', 
                       'create_lessons', 'edit_lessons', 'manage_categories'],
        media_admin: ['upload_media', 'manage_media', 'view_media'],
        support_admin: ['view_messages', 'reply_messages', 'view_users', 'create_notifications'],
        super_admin: ['*']
    };
    return permissions[role] || permissions.student;
}

// ============================================
// CATCH-ALL ROUTE
// ============================================

// Handle 404s
app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'API endpoint not found' });
    }
    // For any other route, serve index.html
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Error handling middleware
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
    console.log(`🔗 http://localhost:${PORT}/index.html`);
    console.log(`🔥 Firebase: ${firebaseInitialized ? '✅ Connected' : '❌ Not connected'}`);
    console.log('==========================================');
});

// ============================================
// GRACEFUL SHUTDOWN
// ============================================
process.on('SIGTERM', () => {
    console.log('🛑 Received SIGTERM, shutting down gracefully...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('🛑 Received SIGINT, shutting down gracefully...');
    process.exit(0);
});

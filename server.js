// ============================================================
// SERVER.JS - EduPro Learning Platform (PataLink)
// ============================================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const admin = require('firebase-admin');
const { body, validationResult } = require('express-validator');

// ============================================================
// 1. FIREBASE ADMIN INITIALIZATION
// ============================================================

const serviceAccount = {
    type: 'service_account',
    project_id: process.env.FIREBASE_PROJECT_ID,
    private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
    private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
    client_id: process.env.FIREBASE_CLIENT_ID,
    auth_uri: 'https://accounts.google.com/o/oauth2/auth',
    token_uri: 'https://oauth2.googleapis.com/token',
    auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
    client_x509_cert_url: process.env.FIREBASE_CLIENT_CERT_URL,
};

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: process.env.FIREBASE_PROJECT_ID,
});

const db = admin.firestore();
const auth = admin.auth();

// ============================================================
// 2. EXPRESS APP SETUP
// ============================================================

const app = express();
const PORT = process.env.PORT || 10000;

// ============================================================
// 3. MIDDLEWARE
// ============================================================

app.use(cors({
    origin: process.env.FRONTEND_URL || '*',
    credentials: true,
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ============================================================
// 4. SERVE STATIC FILES (HTML, CSS, JS, Assets)
// ============================================================

// Serve static files from current directory
app.use(express.static(__dirname));

// ============================================================
// 5. ROUTE: SERVE index.html at root (/)
// ============================================================

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ============================================================
// 6. ROUTE: SERVE admin.html at /admin
// ============================================================

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// ============================================================
// 7. ROUTE: Serve admin.html at /admin/ (with trailing slash)
// ============================================================

app.get('/admin/', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// ============================================================
// 8. ROUTE: Firebase client config for frontend
// ============================================================

app.get('/api/firebase-config', (req, res) => {
    res.json({
        apiKey: process.env.FIREBASE_API_KEY,
        authDomain: process.env.FIREBASE_AUTH_DOMAIN,
        projectId: process.env.FIREBASE_PROJECT_ID,
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
        messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
        appId: process.env.FIREBASE_APP_ID,
    });
});

// ============================================================
// 9. HEALTH CHECK
// ============================================================

app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        status: 'online',
        timestamp: new Date().toISOString(),
        version: '2.0.0',
    });
});

// ============================================================
// 10. LOGGING MIDDLEWARE
// ============================================================

app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
});

// ============================================================
// 11. MAINTENANCE MODE MIDDLEWARE
// ============================================================

const checkMaintenance = async (req, res, next) => {
    // Skip maintenance check for static files and admin routes
    if (req.path.startsWith('/api/admin/') || 
        req.path === '/api/auth/verify' ||
        req.path === '/api/firebase-config' ||
        req.path === '/' ||
        req.path === '/admin' ||
        req.path === '/admin/' ||
        req.path.endsWith('.html') ||
        req.path.endsWith('.css') ||
        req.path.endsWith('.js') ||
        req.path.endsWith('.webp') ||
        req.path.endsWith('.png') ||
        req.path.endsWith('.jpg') ||
        req.path.endsWith('.svg')) {
        return next();
    }

    try {
        const doc = await db.collection('settings').doc('maintenance').get();
        if (doc.exists && doc.data().enabled === true) {
            return res.status(503).json({
                success: false,
                error: 'maintenance',
                message: 'Platform is currently under maintenance. Please try again later.',
            });
        }
        next();
    } catch (err) {
        console.error('Maintenance check error:', err);
        next();
    }
};

app.use(checkMaintenance);

// ============================================================
// 12. AUTHENTICATION MIDDLEWARE
// ============================================================

const verifyToken = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ success: false, error: 'Unauthorized: No token provided' });
        }

        const token = authHeader.split('Bearer ')[1];
        const decodedToken = await auth.verifyIdToken(token);
        req.user = decodedToken;

        const userDoc = await db.collection('users').doc(decodedToken.uid).get();
        if (!userDoc.exists) {
            return res.status(404).json({ success: false, error: 'User profile not found' });
        }

        req.userProfile = userDoc.data();
        req.userProfile.uid = decodedToken.uid;

        next();
    } catch (err) {
        console.error('Token verification error:', err);
        return res.status(401).json({ success: false, error: 'Unauthorized: Invalid token' });
    }
};

const verifyAdmin = async (req, res, next) => {
    try {
        if (!req.userProfile) {
            return res.status(401).json({ success: false, error: 'Unauthorized' });
        }

        if (req.userProfile.role !== 'admin') {
            await logAdminAction(
                req.userProfile.uid,
                req.userProfile.username || 'Unknown',
                'unauthorized_admin_access',
                `Attempted to access ${req.path}`
            );
            return res.status(403).json({ success: false, error: 'Forbidden: Admin access required' });
        }

        next();
    } catch (err) {
        console.error('Admin verification error:', err);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
};

// ============================================================
// 13. VALIDATION HELPER
// ============================================================

const validate = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            success: false,
            errors: errors.array().map(e => e.msg),
        });
    }
    next();
};

// ============================================================
// 14. LOGGING HELPER
// ============================================================

const logAdminAction = async (adminId, adminName, action, target) => {
    try {
        await db.collection('adminLogs').add({
            adminId,
            admin: adminName || 'Admin',
            action,
            target: target || '',
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });
    } catch (err) {
        console.error('Logging error:', err);
    }
};

// ============================================================
// 15. AUTH ENDPOINTS
// ============================================================

app.get('/api/auth/verify', verifyToken, async (req, res) => {
    try {
        res.json({
            success: true,
            user: {
                uid: req.user.uid,
                ...req.userProfile,
            },
        });
    } catch (err) {
        console.error('Verify error:', err);
        res.status(500).json({ success: false, error: 'Failed to verify user' });
    }
});

// ============================================================
// 16. ADMIN - USERS
// ============================================================

app.get('/api/admin/users', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const { limit = 50, offset = 0, search = '', status = 'all' } = req.query;

        let query = db.collection('users');

        if (status !== 'all') {
            query = query.where('status', '==', status);
        }

        const snapshot = await query
            .orderBy('createdAt', 'desc')
            .limit(parseInt(limit) + parseInt(offset))
            .get();

        let users = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            if (search) {
                const searchLower = search.toLowerCase();
                if (!data.username?.toLowerCase().includes(searchLower) &&
                    !data.email?.toLowerCase().includes(searchLower)) {
                    return;
                }
            }
            users.push({
                id: doc.id,
                ...data,
            });
        });

        users = users.slice(parseInt(offset));

        const totalSnapshot = await db.collection('users').get();
        const total = totalSnapshot.size;

        res.json({
            success: true,
            users,
            total,
            limit: parseInt(limit),
            offset: parseInt(offset),
        });
    } catch (err) {
        console.error('Get users error:', err);
        res.status(500).json({ success: false, error: 'Failed to fetch users' });
    }
});

app.get('/api/admin/users/:id', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const doc = await db.collection('users').doc(req.params.id).get();
        if (!doc.exists) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }
        res.json({
            success: true,
            user: { id: doc.id, ...doc.data() },
        });
    } catch (err) {
        console.error('Get user error:', err);
        res.status(500).json({ success: false, error: 'Failed to fetch user' });
    }
});

app.put('/api/admin/users/:id',
    verifyToken,
    verifyAdmin,
    [
        body('username').optional().isString().isLength({ min: 3 }).withMessage('Username must be at least 3 characters'),
        body('email').optional().isEmail().withMessage('Invalid email'),
        body('role').optional().isIn(['student', 'admin']).withMessage('Invalid role'),
        body('status').optional().isIn(['active', 'suspended', 'pending']).withMessage('Invalid status'),
    ],
    validate,
    async (req, res) => {
        try {
            const { id } = req.params;
            const updates = req.body;

            Object.keys(updates).forEach(key => {
                if (updates[key] === undefined) delete updates[key];
            });

            updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();

            await db.collection('users').doc(id).update(updates);

            await logAdminAction(
                req.user.uid,
                req.userProfile.username,
                'update_user',
                `Updated user ${id}`
            );

            res.json({
                success: true,
                message: 'User updated successfully',
            });
        } catch (err) {
            console.error('Update user error:', err);
            res.status(500).json({ success: false, error: 'Failed to update user' });
        }
    }
);

app.delete('/api/admin/users/:id', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        const userDoc = await db.collection('users').doc(id).get();
        const username = userDoc.exists ? userDoc.data().username : 'Unknown';

        await db.collection('users').doc(id).delete();

        try {
            await auth.deleteUser(id);
        } catch (authErr) {
            console.error('Auth delete error:', authErr);
        }

        await logAdminAction(
            req.user.uid,
            req.userProfile.username,
            'delete_user',
            `Deleted user ${username} (${id})`
        );

        res.json({
            success: true,
            message: 'User deleted successfully',
        });
    } catch (err) {
        console.error('Delete user error:', err);
        res.status(500).json({ success: false, error: 'Failed to delete user' });
    }
});

// ============================================================
// 17. ADMIN - COURSES
// ============================================================

app.get('/api/courses', async (req, res) => {
    try {
        const { limit = 50, featured, popular, trending, category } = req.query;

        let query = db.collection('courses');

        if (featured === 'true') query = query.where('isFeatured', '==', true);
        if (popular === 'true') query = query.where('isPopular', '==', true);
        if (trending === 'true') query = query.where('isTrending', '==', true);
        if (category) query = query.where('category', '==', category);

        const snapshot = await query
            .orderBy('createdAt', 'desc')
            .limit(parseInt(limit))
            .get();

        const courses = [];
        snapshot.forEach(doc => {
            courses.push({ id: doc.id, ...doc.data() });
        });

        res.json({
            success: true,
            courses,
            count: courses.length,
        });
    } catch (err) {
        console.error('Get courses error:', err);
        res.status(500).json({ success: false, error: 'Failed to fetch courses' });
    }
});

app.get('/api/courses/:id', async (req, res) => {
    try {
        const doc = await db.collection('courses').doc(req.params.id).get();
        if (!doc.exists) {
            return res.status(404).json({ success: false, error: 'Course not found' });
        }
        res.json({
            success: true,
            course: { id: doc.id, ...doc.data() },
        });
    } catch (err) {
        console.error('Get course error:', err);
        res.status(500).json({ success: false, error: 'Failed to fetch course' });
    }
});

app.post('/api/admin/courses',
    verifyToken,
    verifyAdmin,
    [
        body('title').isString().notEmpty().withMessage('Title is required'),
        body('description').optional().isString(),
        body('category').optional().isString(),
        body('difficulty').optional().isIn(['Beginner', 'Intermediate', 'Advanced']),
        body('instructor').optional().isString(),
        body('duration').optional().isString(),
    ],
    validate,
    async (req, res) => {
        try {
            const data = {
                ...req.body,
                published: req.body.published || false,
                isFeatured: req.body.isFeatured || false,
                isPopular: req.body.isPopular || false,
                isTrending: req.body.isTrending || false,
                studentsCount: 0,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            };

            const docRef = await db.collection('courses').add(data);

            await logAdminAction(
                req.user.uid,
                req.userProfile.username,
                'add_course',
                `Added course "${data.title}"`
            );

            res.status(201).json({
                success: true,
                message: 'Course created successfully',
                id: docRef.id,
            });
        } catch (err) {
            console.error('Create course error:', err);
            res.status(500).json({ success: false, error: 'Failed to create course' });
        }
    }
);

app.put('/api/admin/courses/:id',
    verifyToken,
    verifyAdmin,
    [
        body('title').optional().isString(),
        body('description').optional().isString(),
        body('category').optional().isString(),
        body('difficulty').optional().isIn(['Beginner', 'Intermediate', 'Advanced']),
        body('instructor').optional().isString(),
        body('duration').optional().isString(),
        body('published').optional().isBoolean(),
        body('isFeatured').optional().isBoolean(),
        body('isPopular').optional().isBoolean(),
        body('isTrending').optional().isBoolean(),
    ],
    validate,
    async (req, res) => {
        try {
            const { id } = req.params;
            const updates = req.body;
            updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();

            await db.collection('courses').doc(id).update(updates);

            await logAdminAction(
                req.user.uid,
                req.userProfile.username,
                'update_course',
                `Updated course ${id}`
            );

            res.json({
                success: true,
                message: 'Course updated successfully',
            });
        } catch (err) {
            console.error('Update course error:', err);
            res.status(500).json({ success: false, error: 'Failed to update course' });
        }
    }
);

app.delete('/api/admin/courses/:id', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        const courseDoc = await db.collection('courses').doc(id).get();
        const courseTitle = courseDoc.exists ? courseDoc.data().title : 'Unknown';

        const lessons = await db.collection('lessons').where('courseId', '==', id).get();
        const batch = db.batch();
        lessons.docs.forEach(doc => batch.delete(doc.ref));

        const videos = await db.collection('videos').where('courseId', '==', id).get();
        videos.docs.forEach(doc => batch.delete(doc.ref));

        batch.delete(courseDoc.ref);
        await batch.commit();

        await logAdminAction(
            req.user.uid,
            req.userProfile.username,
            'delete_course',
            `Deleted course "${courseTitle}"`
        );

        res.json({
            success: true,
            message: 'Course and associated content deleted successfully',
        });
    } catch (err) {
        console.error('Delete course error:', err);
        res.status(500).json({ success: false, error: 'Failed to delete course' });
    }
});

// ============================================================
// 18. ADMIN - LESSONS
// ============================================================

app.get('/api/lessons', async (req, res) => {
    try {
        const { courseId, limit = 50 } = req.query;

        let query = db.collection('lessons');
        if (courseId) query = query.where('courseId', '==', courseId);

        const snapshot = await query
            .orderBy('order', 'asc')
            .limit(parseInt(limit))
            .get();

        const lessons = [];
        snapshot.forEach(doc => {
            lessons.push({ id: doc.id, ...doc.data() });
        });

        res.json({
            success: true,
            lessons,
            count: lessons.length,
        });
    } catch (err) {
        console.error('Get lessons error:', err);
        res.status(500).json({ success: false, error: 'Failed to fetch lessons' });
    }
});

app.post('/api/admin/lessons',
    verifyToken,
    verifyAdmin,
    [
        body('title').isString().notEmpty().withMessage('Title is required'),
        body('courseId').isString().notEmpty().withMessage('Course ID is required'),
        body('description').optional().isString(),
        body('order').optional().isNumeric(),
        body('published').optional().isBoolean(),
    ],
    validate,
    async (req, res) => {
        try {
            const data = {
                ...req.body,
                order: parseInt(req.body.order) || 0,
                published: req.body.published || false,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            };

            const docRef = await db.collection('lessons').add(data);

            await logAdminAction(
                req.user.uid,
                req.userProfile.username,
                'add_lesson',
                `Added lesson "${data.title}" to course ${data.courseId}`
            );

            res.status(201).json({
                success: true,
                message: 'Lesson created successfully',
                id: docRef.id,
            });
        } catch (err) {
            console.error('Create lesson error:', err);
            res.status(500).json({ success: false, error: 'Failed to create lesson' });
        }
    }
);

app.put('/api/admin/lessons/:id',
    verifyToken,
    verifyAdmin,
    [
        body('title').optional().isString(),
        body('description').optional().isString(),
        body('courseId').optional().isString(),
        body('order').optional().isNumeric(),
        body('published').optional().isBoolean(),
    ],
    validate,
    async (req, res) => {
        try {
            const { id } = req.params;
            const updates = req.body;
            if (updates.order !== undefined) updates.order = parseInt(updates.order);
            updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();

            await db.collection('lessons').doc(id).update(updates);

            await logAdminAction(
                req.user.uid,
                req.userProfile.username,
                'update_lesson',
                `Updated lesson ${id}`
            );

            res.json({
                success: true,
                message: 'Lesson updated successfully',
            });
        } catch (err) {
            console.error('Update lesson error:', err);
            res.status(500).json({ success: false, error: 'Failed to update lesson' });
        }
    }
);

app.delete('/api/admin/lessons/:id', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        const doc = await db.collection('lessons').doc(id).get();
        const title = doc.exists ? doc.data().title : 'Unknown';

        await db.collection('lessons').doc(id).delete();

        await logAdminAction(
            req.user.uid,
            req.userProfile.username,
            'delete_lesson',
            `Deleted lesson "${title}"`
        );

        res.json({
            success: true,
            message: 'Lesson deleted successfully',
        });
    } catch (err) {
        console.error('Delete lesson error:', err);
        res.status(500).json({ success: false, error: 'Failed to delete lesson' });
    }
});

// ============================================================
// 19. ADMIN - VIDEOS
// ============================================================

app.get('/api/videos', async (req, res) => {
    try {
        const { courseId, lessonId, limit = 50 } = req.query;

        let query = db.collection('videos');
        if (courseId) query = query.where('courseId', '==', courseId);
        if (lessonId) query = query.where('lessonId', '==', lessonId);

        const snapshot = await query
            .orderBy('createdAt', 'desc')
            .limit(parseInt(limit))
            .get();

        const videos = [];
        snapshot.forEach(doc => {
            videos.push({ id: doc.id, ...doc.data() });
        });

        res.json({
            success: true,
            videos,
            count: videos.length,
        });
    } catch (err) {
        console.error('Get videos error:', err);
        res.status(500).json({ success: false, error: 'Failed to fetch videos' });
    }
});

app.post('/api/admin/videos',
    verifyToken,
    verifyAdmin,
    [
        body('title').isString().notEmpty().withMessage('Title is required'),
        body('videoUrl').isURL().withMessage('Valid video URL is required'),
        body('courseId').isString().notEmpty().withMessage('Course ID is required'),
        body('description').optional().isString(),
        body('thumbnail').optional().isURL(),
        body('lessonId').optional().isString(),
        body('published').optional().isBoolean(),
    ],
    validate,
    async (req, res) => {
        try {
            const data = {
                ...req.body,
                published: req.body.published || false,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            };

            const docRef = await db.collection('videos').add(data);

            await logAdminAction(
                req.user.uid,
                req.userProfile.username,
                'add_video',
                `Added video "${data.title}"`
            );

            res.status(201).json({
                success: true,
                message: 'Video added successfully',
                id: docRef.id,
            });
        } catch (err) {
            console.error('Create video error:', err);
            res.status(500).json({ success: false, error: 'Failed to add video' });
        }
    }
);

app.put('/api/admin/videos/:id',
    verifyToken,
    verifyAdmin,
    [
        body('title').optional().isString(),
        body('description').optional().isString(),
        body('videoUrl').optional().isURL(),
        body('thumbnail').optional().isURL(),
        body('courseId').optional().isString(),
        body('lessonId').optional().isString(),
        body('published').optional().isBoolean(),
    ],
    validate,
    async (req, res) => {
        try {
            const { id } = req.params;
            const updates = req.body;
            updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();

            await db.collection('videos').doc(id).update(updates);

            await logAdminAction(
                req.user.uid,
                req.userProfile.username,
                'update_video',
                `Updated video ${id}`
            );

            res.json({
                success: true,
                message: 'Video updated successfully',
            });
        } catch (err) {
            console.error('Update video error:', err);
            res.status(500).json({ success: false, error: 'Failed to update video' });
        }
    }
);

app.delete('/api/admin/videos/:id', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        const doc = await db.collection('videos').doc(id).get();
        const title = doc.exists ? doc.data().title : 'Unknown';

        await db.collection('videos').doc(id).delete();

        await logAdminAction(
            req.user.uid,
            req.userProfile.username,
            'delete_video',
            `Deleted video "${title}"`
        );

        res.json({
            success: true,
            message: 'Video deleted successfully',
        });
    } catch (err) {
        console.error('Delete video error:', err);
        res.status(500).json({ success: false, error: 'Failed to delete video' });
    }
});

// ============================================================
// 20. ADMIN - NOTIFICATIONS
// ============================================================

app.post('/api/admin/notifications',
    verifyToken,
    verifyAdmin,
    [
        body('title').isString().notEmpty().withMessage('Title is required'),
        body('message').isString().notEmpty().withMessage('Message is required'),
        body('audience').isIn(['all', 'active', 'selected']).withMessage('Invalid audience'),
        body('userIds').optional().isArray(),
        body('priority').optional().isIn(['normal', 'high', 'urgent']),
    ],
    validate,
    async (req, res) => {
        try {
            const { title, message, audience, userIds, priority = 'normal' } = req.body;

            let targetUsers = [];

            if (audience === 'all') {
                const snapshot = await db.collection('users').get();
                targetUsers = snapshot.docs.map(doc => doc.id);
            } else if (audience === 'active') {
                const snapshot = await db.collection('users').where('status', '==', 'active').get();
                targetUsers = snapshot.docs.map(doc => doc.id);
            } else if (audience === 'selected' && userIds && userIds.length > 0) {
                targetUsers = userIds;
            } else {
                return res.status(400).json({
                    success: false,
                    error: 'No valid users selected',
                });
            }

            if (targetUsers.length === 0) {
                return res.status(400).json({
                    success: false,
                    error: 'No users found for the selected audience',
                });
            }

            const batch = db.batch();
            targetUsers.forEach(userId => {
                const ref = db.collection('notifications').doc();
                batch.set(ref, {
                    userId,
                    title,
                    message,
                    priority,
                    read: false,
                    type: 'admin',
                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                });
            });

            await batch.commit();

            await logAdminAction(
                req.user.uid,
                req.userProfile.username,
                'send_notification',
                `Sent "${title}" to ${targetUsers.length} users`
            );

            res.json({
                success: true,
                message: `Notification sent to ${targetUsers.length} users`,
                count: targetUsers.length,
            });
        } catch (err) {
            console.error('Send notification error:', err);
            res.status(500).json({ success: false, error: 'Failed to send notification' });
        }
    }
);

app.get('/api/admin/notifications/history', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const { limit = 50 } = req.query;

        const snapshot = await db.collection('notifications')
            .orderBy('createdAt', 'desc')
            .limit(parseInt(limit))
            .get();

        const notifications = [];
        snapshot.forEach(doc => {
            notifications.push({ id: doc.id, ...doc.data() });
        });

        res.json({
            success: true,
            notifications,
            count: notifications.length,
        });
    } catch (err) {
        console.error('Get notification history error:', err);
        res.status(500).json({ success: false, error: 'Failed to fetch notifications' });
    }
});

app.delete('/api/admin/notifications/history', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const snapshot = await db.collection('notifications').get();
        const batch = db.batch();
        snapshot.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();

        await logAdminAction(
            req.user.uid,
            req.userProfile.username,
            'clear_notification_history',
            'Cleared all notification history'
        );

        res.json({
            success: true,
            message: 'Notification history cleared',
        });
    } catch (err) {
        console.error('Clear notification history error:', err);
        res.status(500).json({ success: false, error: 'Failed to clear notification history' });
    }
});

// ============================================================
// 21. ADMIN - ANNOUNCEMENTS
// ============================================================

app.get('/api/announcements', async (req, res) => {
    try {
        const { limit = 50, published } = req.query;

        let query = db.collection('announcements');
        if (published !== undefined) {
            query = query.where('status', '==', published === 'true');
        }

        const snapshot = await query
            .orderBy('createdAt', 'desc')
            .limit(parseInt(limit))
            .get();

        const announcements = [];
        snapshot.forEach(doc => {
            announcements.push({ id: doc.id, ...doc.data() });
        });

        res.json({
            success: true,
            announcements,
            count: announcements.length,
        });
    } catch (err) {
        console.error('Get announcements error:', err);
        res.status(500).json({ success: false, error: 'Failed to fetch announcements' });
    }
});

app.post('/api/admin/announcements',
    verifyToken,
    verifyAdmin,
    [
        body('title').isString().notEmpty().withMessage('Title is required'),
        body('content').isString().notEmpty().withMessage('Content is required'),
        body('priority').optional().isIn(['normal', 'high', 'urgent']),
        body('status').optional().isBoolean(),
    ],
    validate,
    async (req, res) => {
        try {
            const data = {
                ...req.body,
                status: req.body.status !== undefined ? req.body.status : true,
                priority: req.body.priority || 'normal',
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            };

            const docRef = await db.collection('announcements').add(data);

            await logAdminAction(
                req.user.uid,
                req.userProfile.username,
                'add_announcement',
                `Published announcement "${data.title}"`
            );

            res.status(201).json({
                success: true,
                message: 'Announcement published',
                id: docRef.id,
            });
        } catch (err) {
            console.error('Create announcement error:', err);
            res.status(500).json({ success: false, error: 'Failed to create announcement' });
        }
    }
);

app.put('/api/admin/announcements/:id',
    verifyToken,
    verifyAdmin,
    [
        body('title').optional().isString(),
        body('content').optional().isString(),
        body('priority').optional().isIn(['normal', 'high', 'urgent']),
        body('status').optional().isBoolean(),
    ],
    validate,
    async (req, res) => {
        try {
            const { id } = req.params;
            const updates = req.body;
            updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();

            await db.collection('announcements').doc(id).update(updates);

            await logAdminAction(
                req.user.uid,
                req.userProfile.username,
                'update_announcement',
                `Updated announcement ${id}`
            );

            res.json({
                success: true,
                message: 'Announcement updated',
            });
        } catch (err) {
            console.error('Update announcement error:', err);
            res.status(500).json({ success: false, error: 'Failed to update announcement' });
        }
    }
);

app.delete('/api/admin/announcements/:id', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        const doc = await db.collection('announcements').doc(id).get();
        const title = doc.exists ? doc.data().title : 'Unknown';

        await db.collection('announcements').doc(id).delete();

        await logAdminAction(
            req.user.uid,
            req.userProfile.username,
            'delete_announcement',
            `Deleted announcement "${title}"`
        );

        res.json({
            success: true,
            message: 'Announcement deleted',
        });
    } catch (err) {
        console.error('Delete announcement error:', err);
        res.status(500).json({ success: false, error: 'Failed to delete announcement' });
    }
});

app.delete('/api/admin/announcements', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const snapshot = await db.collection('announcements').get();
        const batch = db.batch();
        snapshot.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();

        await logAdminAction(
            req.user.uid,
            req.userProfile.username,
            'clear_announcements',
            'Cleared all announcements'
        );

        res.json({
            success: true,
            message: 'All announcements cleared',
        });
    } catch (err) {
        console.error('Clear announcements error:', err);
        res.status(500).json({ success: false, error: 'Failed to clear announcements' });
    }
});

// ============================================================
// 22. ADMIN - RESOURCES
// ============================================================

app.get('/api/resources', async (req, res) => {
    try {
        const { limit = 50, category } = req.query;

        let query = db.collection('resources');
        if (category) query = query.where('category', '==', category);

        const snapshot = await query
            .orderBy('createdAt', 'desc')
            .limit(parseInt(limit))
            .get();

        const resources = [];
        snapshot.forEach(doc => {
            resources.push({ id: doc.id, ...doc.data() });
        });

        res.json({
            success: true,
            resources,
            count: resources.length,
        });
    } catch (err) {
        console.error('Get resources error:', err);
        res.status(500).json({ success: false, error: 'Failed to fetch resources' });
    }
});

app.post('/api/admin/resources',
    verifyToken,
    verifyAdmin,
    [
        body('title').isString().notEmpty().withMessage('Title is required'),
        body('url').isURL().withMessage('Valid URL is required'),
        body('description').optional().isString(),
        body('category').optional().isString(),
        body('visibility').optional().isIn(['public', 'private']),
    ],
    validate,
    async (req, res) => {
        try {
            const data = {
                ...req.body,
                visibility: req.body.visibility || 'public',
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
            };

            const docRef = await db.collection('resources').add(data);

            await logAdminAction(
                req.user.uid,
                req.userProfile.username,
                'add_resource',
                `Added resource "${data.title}"`
            );

            res.status(201).json({
                success: true,
                message: 'Resource added',
                id: docRef.id,
            });
        } catch (err) {
            console.error('Create resource error:', err);
            res.status(500).json({ success: false, error: 'Failed to add resource' });
        }
    }
);

app.delete('/api/admin/resources/:id', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        const doc = await db.collection('resources').doc(id).get();
        const title = doc.exists ? doc.data().title : 'Unknown';

        await db.collection('resources').doc(id).delete();

        await logAdminAction(
            req.user.uid,
            req.userProfile.username,
            'delete_resource',
            `Deleted resource "${title}"`
        );

        res.json({
            success: true,
            message: 'Resource deleted',
        });
    } catch (err) {
        console.error('Delete resource error:', err);
        res.status(500).json({ success: false, error: 'Failed to delete resource' });
    }
});

app.delete('/api/admin/resources', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const snapshot = await db.collection('resources').get();
        const batch = db.batch();
        snapshot.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();

        await logAdminAction(
            req.user.uid,
            req.userProfile.username,
            'clear_resources',
            'Cleared all resources'
        );

        res.json({
            success: true,
            message: 'All resources cleared',
        });
    } catch (err) {
        console.error('Clear resources error:', err);
        res.status(500).json({ success: false, error: 'Failed to clear resources' });
    }
});

// ============================================================
// 23. ADMIN - HOMEPAGE SETTINGS
// ============================================================

app.get('/api/homepage', async (req, res) => {
    try {
        const doc = await db.collection('settings').doc('homepage').get();
        res.json({
            success: true,
            settings: doc.exists ? doc.data() : {},
        });
    } catch (err) {
        console.error('Get homepage settings error:', err);
        res.status(500).json({ success: false, error: 'Failed to fetch homepage settings' });
    }
});

app.put('/api/admin/homepage',
    verifyToken,
    verifyAdmin,
    [
        body('heroTitle').optional().isString(),
        body('heroDesc').optional().isString(),
        body('heroImage').optional().isURL(),
        body('heroBtnText').optional().isString(),
        body('featuredTitle').optional().isString(),
    ],
    validate,
    async (req, res) => {
        try {
            const updates = {
                ...req.body,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            };

            await db.collection('settings').doc('homepage').set(updates, { merge: true });

            await logAdminAction(
                req.user.uid,
                req.userProfile.username,
                'update_homepage',
                'Updated homepage settings'
            );

            res.json({
                success: true,
                message: 'Homepage settings updated',
            });
        } catch (err) {
            console.error('Update homepage error:', err);
            res.status(500).json({ success: false, error: 'Failed to update homepage settings' });
        }
    }
);

// ============================================================
// 24. ADMIN - SYSTEM SETTINGS
// ============================================================

app.get('/api/settings', async (req, res) => {
    try {
        const doc = await db.collection('settings').doc('general').get();
        res.json({
            success: true,
            settings: doc.exists ? doc.data() : {},
        });
    } catch (err) {
        console.error('Get settings error:', err);
        res.status(500).json({ success: false, error: 'Failed to fetch settings' });
    }
});

app.put('/api/admin/settings',
    verifyToken,
    verifyAdmin,
    [
        body('siteName').optional().isString(),
        body('logo').optional().isURL(),
        body('description').optional().isString(),
        body('contactEmail').optional().isEmail(),
        body('contactPhone').optional().isString(),
        body('registrationEnabled').optional().isBoolean(),
        body('loginEnabled').optional().isBoolean(),
        body('footer').optional().isString(),
    ],
    validate,
    async (req, res) => {
        try {
            const updates = {
                ...req.body,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            };

            await db.collection('settings').doc('general').set(updates, { merge: true });

            await logAdminAction(
                req.user.uid,
                req.userProfile.username,
                'update_settings',
                'Updated system settings'
            );

            res.json({
                success: true,
                message: 'Settings updated',
            });
        } catch (err) {
            console.error('Update settings error:', err);
            res.status(500).json({ success: false, error: 'Failed to update settings' });
        }
    }
);

// ============================================================
// 25. ADMIN - MAINTENANCE
// ============================================================

app.get('/api/maintenance', async (req, res) => {
    try {
        const doc = await db.collection('settings').doc('maintenance').get();
        res.json({
            success: true,
            maintenance: doc.exists ? doc.data() : { enabled: false },
        });
    } catch (err) {
        console.error('Get maintenance error:', err);
        res.status(500).json({ success: false, error: 'Failed to fetch maintenance status' });
    }
});

app.put('/api/admin/maintenance',
    verifyToken,
    verifyAdmin,
    [
        body('enabled').isBoolean().withMessage('Enabled must be boolean'),
        body('title').optional().isString(),
        body('message').optional().isString(),
    ],
    validate,
    async (req, res) => {
        try {
            const { enabled, title, message } = req.body;

            const data = {
                enabled,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            };

            if (title !== undefined) data.title = title;
            if (message !== undefined) data.message = message;

            await db.collection('settings').doc('maintenance').set(data, { merge: true });

            await logAdminAction(
                req.user.uid,
                req.userProfile.username,
                enabled ? 'enable_maintenance' : 'disable_maintenance',
                enabled ? 'Enabled maintenance mode' : 'Disabled maintenance mode'
            );

            res.json({
                success: true,
                message: enabled ? 'Maintenance mode enabled' : 'Maintenance mode disabled',
                maintenance: data,
            });
        } catch (err) {
            console.error('Update maintenance error:', err);
            res.status(500).json({ success: false, error: 'Failed to update maintenance' });
        }
    }
);

// ============================================================
// 26. ADMIN - ACTIVITY LOGS
// ============================================================

app.get('/api/admin/logs', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const { limit = 50 } = req.query;

        const snapshot = await db.collection('adminLogs')
            .orderBy('timestamp', 'desc')
            .limit(parseInt(limit))
            .get();

        const logs = [];
        snapshot.forEach(doc => {
            logs.push({ id: doc.id, ...doc.data() });
        });

        res.json({
            success: true,
            logs,
            count: logs.length,
        });
    } catch (err) {
        console.error('Get logs error:', err);
        res.status(500).json({ success: false, error: 'Failed to fetch logs' });
    }
});

// ============================================================
// 27. ADMIN - ANALYTICS
// ============================================================

app.get('/api/admin/analytics', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const [users, courses, lessons, videos, notifications, announcements, resources] = await Promise.all([
            db.collection('users').get(),
            db.collection('courses').get(),
            db.collection('lessons').get(),
            db.collection('videos').get(),
            db.collection('notifications').get(),
            db.collection('announcements').get(),
            db.collection('resources').get(),
        ]);

        const activeUsers = users.docs.filter(d => d.data().status === 'active').length;

        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const newUsers = users.docs.filter(d => {
            const date = d.data().createdAt;
            if (!date) return false;
            return date.seconds * 1000 > thirtyDaysAgo.getTime();
        }).length;

        res.json({
            success: true,
            analytics: {
                totalUsers: users.size,
                activeUsers,
                newUsers,
                totalCourses: courses.size,
                totalLessons: lessons.size,
                totalVideos: videos.size,
                totalNotifications: notifications.size,
                totalAnnouncements: announcements.size,
                totalResources: resources.size,
                completionRate: Math.round(Math.random() * 30 + 60),
            },
        });
    } catch (err) {
        console.error('Get analytics error:', err);
        res.status(500).json({ success: false, error: 'Failed to fetch analytics' });
    }
});

// ============================================================
// 28. USER - PROFILE
// ============================================================

app.get('/api/user/profile', verifyToken, async (req, res) => {
    try {
        res.json({
            success: true,
            profile: req.userProfile,
        });
    } catch (err) {
        console.error('Get profile error:', err);
        res.status(500).json({ success: false, error: 'Failed to fetch profile' });
    }
});

app.put('/api/user/profile',
    verifyToken,
    [
        body('username').optional().isString().isLength({ min: 3 }),
        body('displayName').optional().isString(),
        body('bio').optional().isString(),
    ],
    validate,
    async (req, res) => {
        try {
            const updates = req.body;
            updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();

            await db.collection('users').doc(req.user.uid).update(updates);

            res.json({
                success: true,
                message: 'Profile updated',
            });
        } catch (err) {
            console.error('Update profile error:', err);
            res.status(500).json({ success: false, error: 'Failed to update profile' });
        }
    }
);

// ============================================================
// 29. USER - PROGRESS
// ============================================================

app.get('/api/user/progress', verifyToken, async (req, res) => {
    try {
        const doc = await db.collection('users').doc(req.user.uid).get();
        const data = doc.exists ? doc.data() : {};
        res.json({
            success: true,
            progress: data.progress || {},
            completedLessons: data.completedLessons || [],
            savedCourses: data.savedCourses || [],
            certificates: data.certificates || [],
        });
    } catch (err) {
        console.error('Get progress error:', err);
        res.status(500).json({ success: false, error: 'Failed to fetch progress' });
    }
});

app.put('/api/user/progress/lesson',
    verifyToken,
    [
        body('lessonId').isString().notEmpty(),
        body('completed').isBoolean(),
    ],
    validate,
    async (req, res) => {
        try {
            const { lessonId, completed } = req.body;
            const userRef = db.collection('users').doc(req.user.uid);

            if (completed) {
                await userRef.update({
                    completedLessons: admin.firestore.FieldValue.arrayUnion(lessonId),
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                });
            } else {
                await userRef.update({
                    completedLessons: admin.firestore.FieldValue.arrayRemove(lessonId),
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                });
            }

            res.json({
                success: true,
                message: 'Progress updated',
            });
        } catch (err) {
            console.error('Update progress error:', err);
            res.status(500).json({ success: false, error: 'Failed to update progress' });
        }
    }
);

app.put('/api/user/saved-courses',
    verifyToken,
    [
        body('courseId').isString().notEmpty(),
        body('saved').isBoolean(),
    ],
    validate,
    async (req, res) => {
        try {
            const { courseId, saved } = req.body;
            const userRef = db.collection('users').doc(req.user.uid);

            if (saved) {
                await userRef.update({
                    savedCourses: admin.firestore.FieldValue.arrayUnion(courseId),
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                });
            } else {
                await userRef.update({
                    savedCourses: admin.firestore.FieldValue.arrayRemove(courseId),
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                });
            }

            res.json({
                success: true,
                message: saved ? 'Course saved' : 'Course removed from saved',
            });
        } catch (err) {
            console.error('Save course error:', err);
            res.status(500).json({ success: false, error: 'Failed to update saved courses' });
        }
    }
);

// ============================================================
// 30. USER - NOTIFICATIONS
// ============================================================

app.get('/api/user/notifications', verifyToken, async (req, res) => {
    try {
        const { limit = 20 } = req.query;

        const snapshot = await db.collection('notifications')
            .where('userId', '==', req.user.uid)
            .orderBy('createdAt', 'desc')
            .limit(parseInt(limit))
            .get();

        const notifications = [];
        snapshot.forEach(doc => {
            notifications.push({ id: doc.id, ...doc.data() });
        });

        res.json({
            success: true,
            notifications,
            count: notifications.length,
        });
    } catch (err) {
        console.error('Get notifications error:', err);
        res.status(500).json({ success: false, error: 'Failed to fetch notifications' });
    }
});

app.put('/api/user/notifications/:id/read', verifyToken, async (req, res) => {
    try {
        const { id } = req.params;

        const doc = await db.collection('notifications').doc(id).get();
        if (!doc.exists || doc.data().userId !== req.user.uid) {
            return res.status(403).json({ success: false, error: 'Not authorized' });
        }

        await db.collection('notifications').doc(id).update({ read: true });

        res.json({
            success: true,
            message: 'Notification marked as read',
        });
    } catch (err) {
        console.error('Mark read error:', err);
        res.status(500).json({ success: false, error: 'Failed to mark notification as read' });
    }
});

app.put('/api/user/notifications/read-all', verifyToken, async (req, res) => {
    try {
        const snapshot = await db.collection('notifications')
            .where('userId', '==', req.user.uid)
            .where('read', '==', false)
            .get();

        const batch = db.batch();
        snapshot.docs.forEach(doc => {
            batch.update(doc.ref, { read: true });
        });
        await batch.commit();

        res.json({
            success: true,
            message: 'All notifications marked as read',
        });
    } catch (err) {
        console.error('Mark all read error:', err);
        res.status(500).json({ success: false, error: 'Failed to mark all as read' });
    }
});

// ============================================================
// 31. CONTACT MESSAGES
// ============================================================

app.post('/api/contact',
    [
        body('name').isString().notEmpty().withMessage('Name is required'),
        body('email').isEmail().withMessage('Valid email is required'),
        body('subject').isString().notEmpty().withMessage('Subject is required'),
        body('message').isString().notEmpty().withMessage('Message is required'),
    ],
    validate,
    async (req, res) => {
        try {
            const data = {
                ...req.body,
                read: false,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
            };

            await db.collection('contactMessages').add(data);

            res.status(201).json({
                success: true,
                message: 'Message sent successfully',
            });
        } catch (err) {
            console.error('Contact error:', err);
            res.status(500).json({ success: false, error: 'Failed to send message' });
        }
    }
);

app.get('/api/admin/contact-messages', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const { limit = 50, read } = req.query;

        let query = db.collection('contactMessages');
        if (read !== undefined) {
            query = query.where('read', '==', read === 'true');
        }

        const snapshot = await query
            .orderBy('createdAt', 'desc')
            .limit(parseInt(limit))
            .get();

        const messages = [];
        snapshot.forEach(doc => {
            messages.push({ id: doc.id, ...doc.data() });
        });

        res.json({
            success: true,
            messages,
            count: messages.length,
        });
    } catch (err) {
        console.error('Get contact messages error:', err);
        res.status(500).json({ success: false, error: 'Failed to fetch messages' });
    }
});

app.put('/api/admin/contact-messages/:id/read', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        await db.collection('contactMessages').doc(id).update({ read: true });
        res.json({
            success: true,
            message: 'Message marked as read',
        });
    } catch (err) {
        console.error('Mark contact read error:', err);
        res.status(500).json({ success: false, error: 'Failed to mark as read' });
    }
});

// ============================================================
// 32. CATCH-ALL ROUTE - Serve index.html for SPA-like behavior
// ============================================================

// This must be LAST - handles any route not matched by API or static files
app.get('*', (req, res) => {
    // If the request is for an API endpoint that doesn't exist
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ 
            success: false, 
            error: 'Endpoint not found' 
        });
    }
    // For all other routes, serve index.html
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ============================================================
// 33. ERROR HANDLER
// ============================================================

app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({
        success: false,
        error: 'Internal server error',
    });
});

// ============================================================
// 34. START SERVER
// ============================================================

app.listen(PORT, () => {
    console.log(`🚀 EduPro Server running on port ${PORT}`);
    console.log(`📚 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔒 Firebase Project: ${process.env.FIREBASE_PROJECT_ID}`);
    console.log(`📄 Serving index.html at http://localhost:${PORT}/`);
    console.log(`📄 Serving admin.html at http://localhost:${PORT}/admin`);
});

module.exports = app;

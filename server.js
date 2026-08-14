// ============================================
// SERVER.JS - COMPLETE BACKEND + WEB SERVER
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
const { v4: uuidv4 } = require('uuid');

// ============================================
// INITIALIZE EXPRESS
// ============================================
const app = express();
const PORT = process.env.PORT || 5000;

// ============================================
// MIDDLEWARE
// ============================================
app.use(helmet({
  contentSecurityPolicy: false, // Allow inline scripts for simplicity
  crossOriginEmbedderPolicy: false
}));

app.use(cors({
  origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*',
  credentials: true
}));

app.use(compression());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(morgan('combined'));

// ============================================
// SERVE STATIC FILES
// ============================================
// Serve current directory for static files (HTML, CSS, JS)
app.use(express.static(__dirname));

// ============================================
// INITIALIZE FIREBASE ADMIN
// ============================================
let db = null;
let auth = null;
let firebaseInitialized = false;

try {
  // Check if all required env vars exist
  if (!process.env.FIREBASE_PROJECT_ID || 
      !process.env.FIREBASE_CLIENT_EMAIL || 
      !process.env.FIREBASE_PRIVATE_KEY) {
    console.warn('⚠️ Firebase credentials missing. Some features will not work.');
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
  console.error('❌ Firebase initialization error:', error.message);
}

// ============================================
// HELPER FUNCTIONS
// ============================================

// Check if Firebase is ready
function checkFirebase(res) {
  if (!firebaseInitialized || !db) {
    return res.status(503).json({ 
      error: 'Firebase service unavailable. Please check your credentials.' 
    });
  }
  return null;
}

// Log activity (only if Firebase is available)
async function logActivity(userId, action, target, details = {}) {
  if (!firebaseInitialized || !db) return;
  try {
    await db.collection('activityLogs').add({
      userId,
      action,
      target,
      details,
      timestamp: new Date().toISOString(),
      ipAddress: 'server',
      userAgent: 'system'
    });
  } catch (error) {
    console.error('Error logging activity:', error);
  }
}

// Get default permissions
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
// AUTHENTICATION MIDDLEWARE
// ============================================
const authenticate = async (req, res, next) => {
  if (!firebaseInitialized) {
    return res.status(503).json({ error: 'Firebase service unavailable' });
  }

  try {
    const token = req.headers.authorization?.split('Bearer ')[1];
    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret-change-me');
    const userDoc = await db.collection('users').doc(decoded.uid).get();
    
    if (!userDoc.exists) {
      return res.status(401).json({ error: 'User not found' });
    }

    req.user = { uid: decoded.uid, ...userDoc.data() };
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

const requireRole = (roles) => {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
};

const requirePermission = (permission) => {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const hasPermission = req.user.permissions?.includes(permission) || 
                         req.user.role === 'super_admin';
    if (!hasPermission) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
};

// ============================================
// ROUTES - WEB PAGES
// ============================================

// Serve index.html for root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Serve admin.html for /admin route
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// Serve admin.html for /admin/ (with trailing slash)
app.get('/admin/', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// ============================================
// ROUTES - API STATUS
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
// ROUTES - AUTH
// ============================================

// Register
app.post('/api/auth/register', async (req, res) => {
  const error = checkFirebase(res);
  if (error) return error;

  try {
    const { email, password, displayName, role } = req.body;

    if (!email || !password || !displayName) {
      return res.status(400).json({ error: 'Email, password and name required' });
    }

    // Check if user exists
    const existingUser = await db.collection('users')
      .where('email', '==', email).limit(1).get();

    if (!existingUser.empty) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create user in Firebase Auth
    const userRecord = await auth.createUser({
      email,
      password,
      displayName
    });

    // Create user in Firestore
    const userData = {
      email,
      displayName,
      role: role || 'student',
      passwordHash: hashedPassword,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastLogin: new Date().toISOString(),
      isActive: true,
      permissions: getDefaultPermissions(role || 'student'),
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

// Login
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

    const isValidPassword = await bcrypt.compare(password, userData.passwordHash || '');
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { uid: userUid, email: userData.email, role: userData.role },
      process.env.JWT_SECRET || 'fallback-secret-change-me',
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    await db.collection('users').doc(userUid).update({
      lastLogin: new Date().toISOString()
    });

    await logActivity(userUid, 'login', 'auth', { email });

    res.json({
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
// ROUTES - COURSES
// ============================================

// Get all courses (public)
app.get('/api/courses', async (req, res) => {
  const error = checkFirebase(res);
  if (error) return error;

  try {
    const { category, level, featured, search } = req.query;
    
    let query = db.collection('courses');
    
    // Only show published courses to public
    if (!req.headers.authorization) {
      query = query.where('status', '==', 'published');
    }
    
    if (category) query = query.where('category', '==', category);
    if (level) query = query.where('level', '==', level);
    if (featured === 'true') query = query.where('isFeatured', '==', true);
    
    const snapshot = await query.get();
    const courses = [];
    snapshot.forEach(doc => {
      courses.push({ id: doc.id, ...doc.data() });
    });

    // Search filter
    if (search) {
      const searchLower = search.toLowerCase();
      const filtered = courses.filter(course => 
        course.title?.toLowerCase().includes(searchLower) ||
        course.description?.toLowerCase().includes(searchLower) ||
        course.category?.toLowerCase().includes(searchLower) ||
        course.instructor?.toLowerCase().includes(searchLower)
      );
      return res.json(filtered);
    }
    
    res.json(courses);
  } catch (error) {
    console.error('Error fetching courses:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch courses' });
  }
});

// Get single course
app.get('/api/courses/:id', async (req, res) => {
  const error = checkFirebase(res);
  if (error) return error;

  try {
    const courseDoc = await db.collection('courses').doc(req.params.id).get();
    
    if (!courseDoc.exists) {
      return res.status(404).json({ error: 'Course not found' });
    }
    
    const courseData = courseDoc.data();
    
    // Check if course is published or user has access
    if (courseData.status !== 'published') {
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        return res.status(403).json({ error: 'Course not available' });
      }
      
      try {
        const token = authHeader.split('Bearer ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret-change-me');
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

// Create course (admin only)
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
    await logActivity(req.user.uid, 'create_course', 'courses', { 
      courseId: docRef.id,
      title: courseData.title 
    });
    
    res.status(201).json({ 
      id: docRef.id, 
      message: 'Course created successfully' 
    });
  } catch (error) {
    console.error('Error creating course:', error);
    res.status(500).json({ error: error.message || 'Failed to create course' });
  }
});

// Update course
app.put('/api/courses/:id', authenticate, requirePermission('edit_courses'), async (req, res) => {
  const error = checkFirebase(res);
  if (error) return error;

  try {
    const updateData = {
      ...req.body,
      updatedAt: new Date().toISOString()
    };
    
    await db.collection('courses').doc(req.params.id).update(updateData);
    await logActivity(req.user.uid, 'update_course', 'courses', { 
      courseId: req.params.id 
    });
    
    res.json({ message: 'Course updated successfully' });
  } catch (error) {
    console.error('Error updating course:', error);
    res.status(500).json({ error: error.message || 'Failed to update course' });
  }
});

// Delete course
app.delete('/api/courses/:id', authenticate, requirePermission('delete_courses'), async (req, res) => {
  const error = checkFirebase(res);
  if (error) return error;

  try {
    const courseDoc = await db.collection('courses').doc(req.params.id).get();
    const courseData = courseDoc.data();
    
    await db.collection('courses').doc(req.params.id).delete();
    await logActivity(req.user.uid, 'delete_course', 'courses', { 
      courseId: req.params.id,
      title: courseData?.title 
    });
    
    res.json({ message: 'Course deleted successfully' });
  } catch (error) {
    console.error('Error deleting course:', error);
    res.status(500).json({ error: error.message || 'Failed to delete course' });
  }
});

// ============================================
// ROUTES - LESSONS
// ============================================

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
    await logActivity(req.user.uid, 'create_lesson', 'lessons', { 
      lessonId: docRef.id,
      title: lessonData.title 
    });
    
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
// ROUTES - CATEGORIES
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
    console.error('Error fetching categories:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch categories' });
  }
});

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
    await logActivity(req.user.uid, 'create_category', 'categories', { 
      categoryId: docRef.id,
      name: categoryData.name 
    });
    
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
    await logActivity(req.user.uid, 'update_category', 'categories', { 
      categoryId: req.params.id 
    });
    
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
    const categoryDoc = await db.collection('categories').doc(req.params.id).get();
    const categoryData = categoryDoc.data();
    
    await db.collection('categories').doc(req.params.id).delete();
    await logActivity(req.user.uid, 'delete_category', 'categories', { 
      categoryId: req.params.id,
      name: categoryData?.name 
    });
    
    res.json({ message: 'Category deleted successfully' });
  } catch (error) {
    console.error('Error deleting category:', error);
    res.status(500).json({ error: error.message || 'Failed to delete category' });
  }
});

// ============================================
// ROUTES - HOMEPAGE
// ============================================

app.get('/api/homepage', async (req, res) => {
  const error = checkFirebase(res);
  if (error) return error;

  try {
    const doc = await db.collection('homepage').doc('settings').get();
    
    if (doc.exists) {
      res.json(doc.data());
    } else {
      // Return default empty state
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

app.put('/api/homepage', authenticate, requireRole(['super_admin']), async (req, res) => {
  const error = checkFirebase(res);
  if (error) return error;

  try {
    const updateData = {
      ...req.body,
      updatedAt: new Date().toISOString()
    };
    
    await db.collection('homepage').doc('settings').set(updateData, { merge: true });
    await logActivity(req.user.uid, 'update_homepage', 'homepage', {
      updates: Object.keys(req.body)
    });
    
    res.json({ message: 'Homepage settings updated successfully' });
  } catch (error) {
    console.error('Error updating homepage:', error);
    res.status(500).json({ error: error.message || 'Failed to update homepage settings' });
  }
});

// ============================================
// ROUTES - USERS
// ============================================

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
    await logActivity(req.user.uid, 'update_user', 'users', { 
      userId: req.params.id 
    });
    
    res.json({ message: 'User updated successfully' });
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ error: error.message || 'Failed to update user' });
  }
});

// ============================================
// ROUTES - MESSAGES
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
    console.error('Error sending message:', error);
    res.status(500).json({ error: error.message || 'Failed to send message' });
  }
});

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

// ============================================
// ROUTES - NOTIFICATIONS
// ============================================

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
    await logActivity(req.user.uid, 'create_notification', 'notifications', { 
      notificationId: docRef.id,
      title: notificationData.title 
    });
    
    res.status(201).json({ 
      id: docRef.id, 
      message: 'Notification created successfully' 
    });
  } catch (error) {
    console.error('Error creating notification:', error);
    res.status(500).json({ error: error.message || 'Failed to create notification' });
  }
});

// ============================================
// ROUTES - MEDIA
// ============================================

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
    await logActivity(req.user.uid, 'upload_media', 'media', { 
      mediaId: docRef.id,
      fileName: mediaData.fileName 
    });
    
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

// ============================================
// ROUTES - SETTINGS
// ============================================

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

app.put('/api/settings', authenticate, requireRole(['super_admin']), async (req, res) => {
  const error = checkFirebase(res);
  if (error) return error;

  try {
    const updateData = {
      ...req.body,
      updatedAt: new Date().toISOString()
    };
    
    await db.collection('settings').doc('platform').set(updateData, { merge: true });
    await logActivity(req.user.uid, 'update_settings', 'settings', {
      updates: Object.keys(req.body)
    });
    
    res.json({ message: 'Settings updated successfully' });
  } catch (error) {
    console.error('Error updating settings:', error);
    res.status(500).json({ error: error.message || 'Failed to update settings' });
  }
});

// ============================================
// ROUTES - STATISTICS
// ============================================

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

// ============================================
// CATCH-ALL ROUTE - Handle 404s
// ============================================

// For any other route, serve index.html (SPA behavior)
// But also handle API 404s
app.use((req, res) => {
  // If it's an API route, return JSON error
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }
  
  // For non-API routes, try to serve index.html
  // This handles client-side routing
  res.status(404).sendFile(path.join(__dirname, 'index.html'));
});

// ============================================
// ERROR HANDLING MIDDLEWARE
// ============================================

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
  console.log(`📚 Educational Platform API is ready`);
  console.log(`🔗 http://localhost:${PORT}`);
  console.log(`🔗 http://localhost:${PORT}/admin`);
  console.log(`🔒 Environment: ${process.env.NODE_ENV || 'development'}`);
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

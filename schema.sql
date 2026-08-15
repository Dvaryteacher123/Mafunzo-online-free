CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(30) UNIQUE NOT NULL,
  display_name VARCHAR(80) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  avatar_url TEXT DEFAULT '',
  bio TEXT DEFAULT '',
  country VARCHAR(80) DEFAULT '',
  interests TEXT DEFAULT '',
  role VARCHAR(20) DEFAULT 'user',
  plan VARCHAR(20) DEFAULT 'free',
  premium_expires_at TIMESTAMPTZ NULL,
  online BOOLEAN DEFAULT FALSE,
  last_seen TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS conversations (
  id SERIAL PRIMARY KEY,
  is_random BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id INT REFERENCES conversations(id) ON DELETE CASCADE,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  conversation_id INT REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id INT REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  seen_at TIMESTAMPTZ NULL
);

CREATE TABLE IF NOT EXISTS friends (
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  friend_id INT REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, friend_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL,
  title VARCHAR(120) NOT NULL,
  body TEXT DEFAULT '',
  read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rooms (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) UNIQUE NOT NULL,
  description TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS room_members (
  room_id INT REFERENCES rooms(id) ON DELETE CASCADE,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (room_id, user_id)
);

CREATE TABLE IF NOT EXISTS plans (
  id SERIAL PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  price INTEGER NOT NULL,
  duration_days INTEGER NOT NULL,
  features TEXT DEFAULT '',
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  plan_id INT REFERENCES plans(id),
  phone VARCHAR(30) NOT NULL,
  amount INTEGER NOT NULL,
  provider VARCHAR(40) DEFAULT 'harakapay',
  provider_order_id VARCHAR(120) UNIQUE,
  status VARCHAR(30) DEFAULT 'pending',
  raw_response JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ NULL
);

CREATE TABLE IF NOT EXISTS reports (
  id SERIAL PRIMARY KEY,
  reporter_id INT REFERENCES users(id) ON DELETE CASCADE,
  reported_id INT REFERENCES users(id) ON DELETE CASCADE,
  reason VARCHAR(120) NOT NULL,
  details TEXT DEFAULT '',
  status VARCHAR(30) DEFAULT 'open',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO plans (name, price, duration_days, features)
SELECT 'Premium 7 Days', 2000, 7, 'Unlimited random chat, premium badge'
WHERE NOT EXISTS (SELECT 1 FROM plans WHERE name='Premium 7 Days');

INSERT INTO plans (name, price, duration_days, features)
SELECT 'Premium 30 Days', 5000, 30, 'Unlimited chat, advanced matching, premium rooms'
WHERE NOT EXISTS (SELECT 1 FROM plans WHERE name='Premium 30 Days');

INSERT INTO rooms (name, description)
SELECT 'Tanzania 🇹🇿', 'Chat na watu wa Tanzania'
WHERE NOT EXISTS (SELECT 1 FROM rooms WHERE name='Tanzania 🇹🇿');

INSERT INTO rooms (name, description)
SELECT 'Football ⚽', 'Football chat room'
WHERE NOT EXISTS (SELECT 1 FROM rooms WHERE name='Football ⚽');

INSERT INTO rooms (name, description)
SELECT 'Gaming 🎮', 'Gaming chat room'
WHERE NOT EXISTS (SELECT 1 FROM rooms WHERE name='Gaming 🎮');

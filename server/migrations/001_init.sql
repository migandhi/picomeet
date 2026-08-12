CREATE TABLE IF NOT EXISTS users (
  id               INTEGER PRIMARY KEY,
  username         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name     TEXT NOT NULL,
  pass             TEXT NOT NULL,                 -- s1$salt$hash (scrypt)
  role             TEXT NOT NULL DEFAULT 'user',  -- admin | host | user
  active           INTEGER NOT NULL DEFAULT 1,
  plan             TEXT NOT NULL DEFAULT 'basic',
  max_rooms        INTEGER NOT NULL DEFAULT 1,    -- simultaneous ACTIVE meetings
  max_participants INTEGER NOT NULL DEFAULT 8,    -- per room ceiling
  max_minutes      INTEGER NOT NULL DEFAULT 0,    -- per meeting; 0 = unlimited
  expires_at       INTEGER,                       -- subscription end (unix s); NULL = never
  notes            TEXT,
  created_at       INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS rooms (
  id               INTEGER PRIMARY KEY,
  code             TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name             TEXT NOT NULL,
  owner_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode             TEXT NOT NULL DEFAULT 'auto',  -- auto | seminar | lecture
  max_participants INTEGER,                       -- NULL = inherit from owner
  guest_ok         INTEGER NOT NULL DEFAULT 1,
  knock            INTEGER NOT NULL DEFAULT 0,    -- lobby / admit control
  pin              TEXT,                          -- optional numeric room PIN
  persistent       INTEGER NOT NULL DEFAULT 1,
  created_at       INTEGER NOT NULL,
  last_used_at     INTEGER
);
CREATE INDEX IF NOT EXISTS idx_rooms_owner ON rooms(owner_id);
CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  ua         TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS meetings (
  id                  INTEGER PRIMARY KEY,
  room_id             INTEGER,
  code                TEXT NOT NULL,
  owner_id            INTEGER,
  started_at          INTEGER NOT NULL,
  ended_at            INTEGER,
  peak_participants   INTEGER NOT NULL DEFAULT 0,
  participant_seconds INTEGER NOT NULL DEFAULT 0,
  signaling_bytes     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_meetings_started ON meetings(started_at);
CREATE TABLE IF NOT EXISTS audit (
  id     INTEGER PRIMARY KEY,
  at     INTEGER NOT NULL,
  actor  TEXT,
  action TEXT NOT NULL,
  detail TEXT
);
CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT NOT NULL);

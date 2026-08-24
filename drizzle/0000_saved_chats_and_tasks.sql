CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL,
    title TEXT NOT NULL,
    completed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_chats_updated_at ON chats(updated_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id, id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_tasks_completed_created ON tasks(completed, created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_tasks_chat_id ON tasks(chat_id);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_rooms" (
    "channel_id" TEXT NOT NULL PRIMARY KEY,
    "guild_id" TEXT NOT NULL,
    "parent_id" TEXT,
    "name" TEXT NOT NULL,
    "workspace_dir" TEXT NOT NULL,
    "tmux_session" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'bypassPermissions',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "agent" TEXT NOT NULL DEFAULT 'claude',
    "project_id" TEXT,
    CONSTRAINT "rooms_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects" ("category_id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_rooms" ("archived", "channel_id", "created_at", "created_by", "guild_id", "mode", "name", "parent_id", "project_id", "tmux_session", "workspace_dir") SELECT "archived", "channel_id", "created_at", "created_by", "guild_id", "mode", "name", "parent_id", "project_id", "tmux_session", "workspace_dir" FROM "rooms";
DROP TABLE "rooms";
ALTER TABLE "new_rooms" RENAME TO "rooms";
CREATE UNIQUE INDEX "rooms_tmux_session_key" ON "rooms"("tmux_session");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

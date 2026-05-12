-- CreateTable
CREATE TABLE "rooms" (
    "channel_id" TEXT NOT NULL PRIMARY KEY,
    "guild_id" TEXT NOT NULL,
    "parent_id" TEXT,
    "name" TEXT NOT NULL,
    "workspace_dir" TEXT NOT NULL,
    "tmux_session" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,
    "archived" BOOLEAN NOT NULL DEFAULT false
);

-- CreateIndex
CREATE UNIQUE INDEX "rooms_tmux_session_key" ON "rooms"("tmux_session");

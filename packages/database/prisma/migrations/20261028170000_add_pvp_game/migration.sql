-- Persistent PvP profiles, catalog, inventory, and match history
CREATE TYPE "GameItemType" AS ENUM ('CHARACTER', 'WEAPON', 'SKIN');
CREATE TYPE "GameMode" AS ENUM ('TEAM', 'FREE_FOR_ALL');
CREATE TYPE "GameMatchStatus" AS ENUM ('WAITING', 'ACTIVE', 'COMPLETED');
CREATE TABLE "GameProfile" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "xp" INTEGER NOT NULL DEFAULT 0,
  "level" INTEGER NOT NULL DEFAULT 1,
  "coins" INTEGER NOT NULL DEFAULT 150,
  "kills" INTEGER NOT NULL DEFAULT 0,
  "deaths" INTEGER NOT NULL DEFAULT 0,
  "wins" INTEGER NOT NULL DEFAULT 0,
  "losses" INTEGER NOT NULL DEFAULT 0,
  "selectedCharacterId" TEXT NOT NULL DEFAULT 'rookie',
  "selectedWeaponId" TEXT NOT NULL DEFAULT 'blaster',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GameProfile_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "GameItem" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" "GameItemType" NOT NULL,
  "description" TEXT NOT NULL,
  "price" INTEGER NOT NULL DEFAULT 0,
  "unlockLevel" INTEGER NOT NULL DEFAULT 1,
  "rarity" TEXT NOT NULL DEFAULT 'common',
  "stats" JSONB NOT NULL,
  "isStarter" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GameItem_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "GameInventory" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GameInventory_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "GameMatch" (
  "id" TEXT NOT NULL,
  "mode" "GameMode" NOT NULL,
  "status" "GameMatchStatus" NOT NULL DEFAULT 'WAITING',
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt" TIMESTAMP(3),
  CONSTRAINT "GameMatch_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "GameMatchPlayer" (
  "id" TEXT NOT NULL,
  "matchId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "team" TEXT,
  "kills" INTEGER NOT NULL DEFAULT 0,
  "deaths" INTEGER NOT NULL DEFAULT 0,
  "placement" INTEGER,
  "xpEarned" INTEGER NOT NULL DEFAULT 0,
  "coinsEarned" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GameMatchPlayer_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GameProfile_userId_key" ON "GameProfile"("userId");
CREATE INDEX "GameProfile_level_xp_idx" ON "GameProfile"("level", "xp");
CREATE INDEX "GameProfile_wins_kills_idx" ON "GameProfile"("wins", "kills");
CREATE UNIQUE INDEX "GameItem_slug_key" ON "GameItem"("slug");
CREATE INDEX "GameItem_type_unlockLevel_idx" ON "GameItem"("type", "unlockLevel");
CREATE UNIQUE INDEX "GameInventory_userId_itemId_key" ON "GameInventory"("userId", "itemId");
CREATE INDEX "GameInventory_userId_acquiredAt_idx" ON "GameInventory"("userId", "acquiredAt");
CREATE INDEX "GameMatch_mode_status_startedAt_idx" ON "GameMatch"("mode", "status", "startedAt");
CREATE UNIQUE INDEX "GameMatchPlayer_matchId_userId_key" ON "GameMatchPlayer"("matchId", "userId");
CREATE INDEX "GameMatchPlayer_userId_createdAt_idx" ON "GameMatchPlayer"("userId", "createdAt");
ALTER TABLE "GameProfile" ADD CONSTRAINT "GameProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GameInventory" ADD CONSTRAINT "GameInventory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GameInventory" ADD CONSTRAINT "GameInventory_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "GameItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GameMatchPlayer" ADD CONSTRAINT "GameMatchPlayer_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "GameMatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GameMatchPlayer" ADD CONSTRAINT "GameMatchPlayer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

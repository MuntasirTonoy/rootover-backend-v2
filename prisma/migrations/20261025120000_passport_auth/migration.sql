-- Auth moves from Clerk to Passport (passport-local + passport-jwt):
-- passwords are stored as bcrypt hashes and tokenVersion revokes older tokens.

-- DropIndex
DROP INDEX "User_clerkId_key";

-- AlterTable
-- Existing rows get "!", which never matches a bcrypt hash: those accounts
-- cannot log in until a password is set (the seed recreates every user).
ALTER TABLE "User" DROP COLUMN "clerkId",
ADD COLUMN     "passwordHash" TEXT NOT NULL DEFAULT '!',
ADD COLUMN     "tokenVersion" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP DEFAULT;

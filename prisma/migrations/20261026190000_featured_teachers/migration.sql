-- Admins pick the teachers the home page features (courses already had "featured").

-- AlterTable
ALTER TABLE "TeacherProfile" ADD COLUMN "featured" BOOLEAN NOT NULL DEFAULT false;

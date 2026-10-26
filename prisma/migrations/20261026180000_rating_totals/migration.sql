-- Ratings become anonymous: one 1-5 star rating per buyer, kept only as a
-- running total and count on the course. Existing reviews are folded into the
-- totals (so averages don't change) and their authors marked as having rated.

-- AlterTable
ALTER TABLE "Course" ADD COLUMN "ratingSum" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "ratingCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Enrollment" ADD COLUMN "ratedAt" TIMESTAMP(3);

-- Carry the existing reviews over
UPDATE "Course" AS c
SET "ratingSum" = r.total, "ratingCount" = r.n
FROM (
  SELECT "courseId", SUM("rating")::INTEGER AS total, COUNT(*)::INTEGER AS n
  FROM "Review"
  GROUP BY "courseId"
) AS r
WHERE r."courseId" = c."id";

UPDATE "Enrollment" AS e
SET "ratedAt" = r."date"
FROM "Review" AS r
WHERE r."courseId" = e."courseId" AND r."studentId" = e."studentId";

-- DropForeignKey
ALTER TABLE "Review" DROP CONSTRAINT "Review_courseId_fkey";

-- DropForeignKey
ALTER TABLE "Review" DROP CONSTRAINT "Review_studentId_fkey";

-- DropTable
DROP TABLE "Review";

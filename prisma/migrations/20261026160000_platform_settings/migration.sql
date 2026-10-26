-- Admin-editable registration fee and sale commission, confirmed by an emailed code.

-- AlterEnum
ALTER TYPE "OtpPurpose" ADD VALUE 'admin_settings';

-- CreateTable
CREATE TABLE "PlatformSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "commissionRate" DOUBLE PRECISION NOT NULL,
    "registrationFee" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "PlatformSettings_pkey" PRIMARY KEY ("id")
);

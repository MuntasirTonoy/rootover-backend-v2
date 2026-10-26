-- CreateEnum
CREATE TYPE "PaymentPurpose" AS ENUM ('course_purchase', 'registration_fee');

-- CreateEnum
CREATE TYPE "PaymentState" AS ENUM ('initiated', 'processing', 'completed', 'failed', 'cancelled', 'expired');

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "purpose" "PaymentPurpose" NOT NULL,
    "provider" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "courseId" TEXT,
    "applicationId" TEXT,
    "couponId" TEXT,
    "couponReleased" BOOLEAN NOT NULL DEFAULT false,
    "quote" JSONB,
    "amount" INTEGER NOT NULL,
    "state" "PaymentState" NOT NULL DEFAULT 'initiated',
    "providerPaymentId" TEXT,
    "trxId" TEXT,
    "payerNumber" TEXT,
    "failureReason" TEXT,
    "purchaseId" TEXT,
    "registrationFeeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Payment_providerPaymentId_key" ON "Payment"("providerPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_trxId_key" ON "Payment"("trxId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_purchaseId_key" ON "Payment"("purchaseId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_registrationFeeId_key" ON "Payment"("registrationFeeId");

-- CreateIndex
CREATE INDEX "Payment_userId_createdAt_idx" ON "Payment"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Payment_state_createdAt_idx" ON "Payment"("state", "createdAt");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "TeacherApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_registrationFeeId_fkey" FOREIGN KEY ("registrationFeeId") REFERENCES "RegistrationFee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

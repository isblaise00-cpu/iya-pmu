-- AlterTable
ALTER TABLE `results` ADD COLUMN `isSent` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `sms_campaigns` MODIFY `message` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `sms_logs` MODIFY `message` TEXT NOT NULL;

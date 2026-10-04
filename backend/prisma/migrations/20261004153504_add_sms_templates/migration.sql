/*
  Warnings:

  - You are about to alter the column `source` on the `sport_results` table. The data in that column could be lost. The data in that column will be cast from `VarChar(255)` to `VarChar(191)`.

*/
-- AlterTable
ALTER TABLE `sport_events` MODIFY `sport` VARCHAR(191) NOT NULL,
    MODIFY `league` VARCHAR(191) NOT NULL,
    MODIFY `homeTeam` VARCHAR(191) NOT NULL,
    MODIFY `awayTeam` VARCHAR(191) NOT NULL,
    MODIFY `kickoff` VARCHAR(191) NOT NULL,
    MODIFY `externalId` VARCHAR(191) NOT NULL;

-- AlterTable
ALTER TABLE `sport_pronostics` MODIFY `sport` VARCHAR(191) NOT NULL;

-- AlterTable
ALTER TABLE `sport_results` MODIFY `sport` VARCHAR(191) NOT NULL,
    MODIFY `outcome` VARCHAR(191) NULL,
    MODIFY `source` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `sms_templates` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `category` VARCHAR(191) NOT NULL DEFAULT 'general',
    `message` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- RedefineIndex
CREATE INDEX `sport_events_sport_date_idx` ON `sport_events`(`sport`, `date`);
DROP INDEX `ix_sport_events_sport_date` ON `sport_events`;

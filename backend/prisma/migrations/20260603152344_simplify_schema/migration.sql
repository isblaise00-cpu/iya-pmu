/*
  Warnings:

  - You are about to drop the column `baseHorse` on the `pronostics` table. All the data in the column will be lost.
  - You are about to drop the column `confidenceScore` on the `pronostics` table. All the data in the column will be lost.
  - You are about to drop the column `outsider` on the `pronostics` table. All the data in the column will be lost.
  - You are about to drop the column `quarte` on the `pronostics` table. All the data in the column will be lost.
  - You are about to drop the column `quinte` on the `pronostics` table. All the data in the column will be lost.
  - You are about to drop the column `rawData` on the `pronostics` table. All the data in the column will be lost.
  - You are about to drop the column `sourcesPdf` on the `pronostics` table. All the data in the column will be lost.
  - You are about to drop the column `tierce` on the `pronostics` table. All the data in the column will be lost.
  - You are about to drop the column `allocationXof` on the `races` table. All the data in the column will be lost.
  - You are about to drop the column `country` on the `races` table. All the data in the column will be lost.
  - You are about to drop the column `discipline` on the `races` table. All the data in the column will be lost.
  - You are about to drop the column `pdfFetchedAt` on the `races` table. All the data in the column will be lost.
  - You are about to drop the column `rawPdfText` on the `races` table. All the data in the column will be lost.
  - You are about to drop the column `startTime` on the `races` table. All the data in the column will be lost.
  - You are about to drop the column `updatedAt` on the `races` table. All the data in the column will be lost.
  - You are about to alter the column `raceType` on the `races` table. The data in that column could be lost. The data in that column will be cast from `Enum(EnumId(0))` to `VarChar(191)`.
  - You are about to drop the `horses` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE `horses` DROP FOREIGN KEY `horses_raceId_fkey`;

-- AlterTable
ALTER TABLE `pronostics` DROP COLUMN `baseHorse`,
    DROP COLUMN `confidenceScore`,
    DROP COLUMN `outsider`,
    DROP COLUMN `quarte`,
    DROP COLUMN `quinte`,
    DROP COLUMN `rawData`,
    DROP COLUMN `sourcesPdf`,
    DROP COLUMN `tierce`,
    ADD COLUMN `horses` JSON NULL,
    MODIFY `commentary` TEXT NULL;

-- AlterTable
ALTER TABLE `races` DROP COLUMN `allocationXof`,
    DROP COLUMN `country`,
    DROP COLUMN `discipline`,
    DROP COLUMN `pdfFetchedAt`,
    DROP COLUMN `rawPdfText`,
    DROP COLUMN `startTime`,
    DROP COLUMN `updatedAt`,
    MODIFY `raceType` VARCHAR(191) NULL,
    MODIFY `raceName` VARCHAR(191) NULL,
    MODIFY `hippodrome` VARCHAR(191) NULL,
    MODIFY `distance` INTEGER NULL,
    MODIFY `numHorses` INTEGER NULL,
    MODIFY `pdfUrl` VARCHAR(500) NULL;

-- AlterTable
ALTER TABLE `results` MODIFY `arrivalOrder` JSON NULL;

-- DropTable
DROP TABLE `horses`;

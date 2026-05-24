-- AlterTable
ALTER TABLE `pronostics` ADD COLUMN `proposals` JSON NULL,
    ADD COLUMN `raceId` INTEGER NULL,
    ADD COLUMN `sourcesPdf` JSON NULL;

-- CreateTable
CREATE TABLE `races` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `date` DATE NOT NULL,
    `raceType` ENUM('TIERCE', 'QUARTE', 'QUARTE_PLUS', 'QUINTE_PLUS', 'COUPLE', 'AUTRE') NOT NULL,
    `discipline` ENUM('TROT_ATTELE', 'TROT_MONTE', 'PLAT', 'OBSTACLE', 'AUTRE') NOT NULL,
    `raceName` VARCHAR(191) NOT NULL,
    `hippodrome` VARCHAR(191) NOT NULL,
    `country` VARCHAR(191) NOT NULL DEFAULT 'FR',
    `distance` INTEGER NOT NULL,
    `numHorses` INTEGER NOT NULL,
    `startTime` DATETIME(3) NULL,
    `allocationXof` INTEGER NULL,
    `pdfUrl` VARCHAR(191) NULL,
    `pdfFetchedAt` DATETIME(3) NULL,
    `rawPdfText` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `races_date_key`(`date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `horses` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `raceId` INTEGER NOT NULL,
    `number` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `driver` VARCHAR(191) NULL,
    `trainer` VARCHAR(191) NULL,
    `owner` VARCHAR(191) NULL,
    `sex` VARCHAR(191) NULL,
    `age` INTEGER NULL,
    `distance` INTEGER NULL,
    `chrono` VARCHAR(191) NULL,
    `recentPerf` VARCHAR(191) NULL,
    `gainsXof` INTEGER NULL,
    `oddsParisTurf` VARCHAR(191) NULL,
    `oddsTierceMag` VARCHAR(191) NULL,
    `externalData` JSON NULL,

    UNIQUE INDEX `horses_raceId_number_key`(`raceId`, `number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `pronostics_raceId_key` ON `pronostics`(`raceId`);

-- AddForeignKey
ALTER TABLE `horses` ADD CONSTRAINT `horses_raceId_fkey` FOREIGN KEY (`raceId`) REFERENCES `races`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pronostics` ADD CONSTRAINT `pronostics_raceId_fkey` FOREIGN KEY (`raceId`) REFERENCES `races`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;


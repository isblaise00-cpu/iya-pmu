-- CreateTable
CREATE TABLE `sport_events` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `sport` VARCHAR(20) NOT NULL,
    `date` DATE NOT NULL,
    `league` VARCHAR(100) NOT NULL,
    `homeTeam` VARCHAR(100) NOT NULL,
    `awayTeam` VARCHAR(100) NOT NULL,
    `kickoff` VARCHAR(5) NOT NULL,
    `externalId` VARCHAR(100) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ix_sport_events_sport_date`(`sport`, `date`),
    UNIQUE INDEX `sport_events_sport_externalId_key`(`sport`, `externalId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sport_pronostics` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `eventId` INTEGER NOT NULL,
    `sport` VARCHAR(20) NOT NULL,
    `date` DATE NOT NULL,
    `modelProbs` JSON NOT NULL,
    `predictions` JSON NOT NULL,
    `valueBets` JSON NOT NULL,
    `commentary` TEXT NOT NULL,
    `confidence` INTEGER NOT NULL,
    `isSent` BOOLEAN NOT NULL DEFAULT false,
    `modifiedByAdmin` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `sport_pronostics_eventId_key`(`eventId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sport_results` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `eventId` INTEGER NOT NULL,
    `sport` VARCHAR(20) NOT NULL,
    `homeScore` INTEGER NULL,
    `awayScore` INTEGER NULL,
    `outcome` VARCHAR(10) NULL,
    `source` VARCHAR(255) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `sport_results_eventId_key`(`eventId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `sport_pronostics` ADD CONSTRAINT `sport_pronostics_eventId_fkey` FOREIGN KEY (`eventId`) REFERENCES `sport_events`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sport_results` ADD CONSTRAINT `sport_results_eventId_fkey` FOREIGN KEY (`eventId`) REFERENCES `sport_events`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

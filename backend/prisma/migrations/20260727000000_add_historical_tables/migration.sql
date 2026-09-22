-- CreateTable historical_races
CREATE TABLE `historical_races` (
    `id`         INTEGER      NOT NULL AUTO_INCREMENT,
    `date`       DATE         NOT NULL,
    `raceType`   VARCHAR(20)  NULL,
    `hippodrome` VARCHAR(255) NULL,
    `programUrl` VARCHAR(500) NULL,
    `resultUrl`  VARCHAR(500) NULL,
    `createdAt`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `historical_races_date_idx`(`date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable historical_horses
CREATE TABLE `historical_horses` (
    `id`              INTEGER      NOT NULL AUTO_INCREMENT,
    `raceId`          INTEGER      NOT NULL,
    `horseNumber`     INTEGER      NOT NULL,
    `horseName`       VARCHAR(100) NOT NULL,
    `jockey`          VARCHAR(100) NULL,
    `trainer`         VARCHAR(100) NULL,
    `odds`            DOUBLE       NULL,
    `arrivalPosition` INTEGER      NULL,

    INDEX `historical_horses_raceId_idx`(`raceId`),
    INDEX `historical_horses_horseName_idx`(`horseName`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `historical_horses` ADD CONSTRAINT `historical_horses_raceId_fkey`
    FOREIGN KEY (`raceId`) REFERENCES `historical_races`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

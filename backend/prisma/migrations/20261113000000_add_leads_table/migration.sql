CREATE TABLE `leads` (
  `id`           INT          NOT NULL AUTO_INCREMENT,
  `phone`        VARCHAR(191) NOT NULL,
  `lastCommand`  VARCHAR(191) NOT NULL,
  `requestCount` INT          NOT NULL DEFAULT 1,
  `firstSeenAt`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `lastSeenAt`   DATETIME(3)  NOT NULL,

  UNIQUE INDEX `leads_phone_key` (`phone`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

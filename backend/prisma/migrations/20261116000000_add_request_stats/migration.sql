CREATE TABLE `request_stats` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `date` DATETIME(3) NOT NULL,
  `count` INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `request_stats_date_key` (`date`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

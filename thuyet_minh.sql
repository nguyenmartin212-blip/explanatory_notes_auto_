CREATE DATABASE IF NOT EXISTS Thuyet_minh_da_ngon_ngu
CHARACTER SET utf8mb4
COLLATE utf8mb4_unicode_ci;

USE Thuyet_minh_da_ngon_ngu;


CREATE TABLE regions (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  code        VARCHAR(10)  NOT NULL UNIQUE,
  name_vi     VARCHAR(50)  NOT NULL
);


CREATE TABLE languages (
  code        VARCHAR(10)  PRIMARY KEY,
  name        VARCHAR(50)  NOT NULL,
  tts_voice   VARCHAR(60)  NULL,
  is_active   BOOLEAN      NOT NULL DEFAULT TRUE
);


CREATE TABLE categories (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  name_vi     VARCHAR(80)  NOT NULL
);


CREATE TABLE pois (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  region_id       INT           NOT NULL,
  category_id     INT           NULL,
  name_vi         VARCHAR(200)  NOT NULL,
  description_vi  TEXT          NOT NULL,
  latitude        DECIMAL(9,6)  NOT NULL,
  longitude       DECIMAL(9,6)  NOT NULL,
  trigger_radius  INT           NOT NULL DEFAULT 50,
  audio_priority  INT           NOT NULL DEFAULT 0,
  cover_image_url VARCHAR(500)  NULL,
  is_active       BOOLEAN       NOT NULL DEFAULT FALSE,
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_poi_region   FOREIGN KEY (region_id)   REFERENCES regions(id),
  CONSTRAINT fk_poi_category FOREIGN KEY (category_id) REFERENCES categories(id),
  INDEX idx_poi_region (region_id),
  INDEX idx_poi_active (is_active),
  INDEX idx_poi_latlng (latitude, longitude)
);


CREATE TABLE poi_images (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  poi_id      INT           NOT NULL,
  image_url   VARCHAR(500)  NOT NULL,
  caption     VARCHAR(255)  NULL,
  sort_order  INT           NOT NULL DEFAULT 0,
  CONSTRAINT fk_img_poi FOREIGN KEY (poi_id) REFERENCES pois(id) ON DELETE CASCADE
);


CREATE TABLE poi_localizations (
  id                    INT AUTO_INCREMENT PRIMARY KEY,
  poi_id                INT           NOT NULL,
  lang_code             VARCHAR(10)   NOT NULL,
  name                  VARCHAR(200)  NOT NULL,
  description           TEXT          NOT NULL,
  audio_url             VARCHAR(500)  NULL,
  audio_status          ENUM('none','processing','ready','failed') NOT NULL DEFAULT 'none',
  content_hash          CHAR(32)      NULL,
  is_machine_translated BOOLEAN       NOT NULL DEFAULT TRUE,
  updated_at            DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_loc_poi  FOREIGN KEY (poi_id)    REFERENCES pois(id) ON DELETE CASCADE,
  CONSTRAINT fk_loc_lang FOREIGN KEY (lang_code) REFERENCES languages(code),
  UNIQUE KEY uq_poi_lang (poi_id, lang_code)
);


CREATE TABLE admin_users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  username      VARCHAR(50)  NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role          ENUM('super_admin','admin') NOT NULL DEFAULT 'admin',
  is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
);


CREATE TABLE audit_logs (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT          NULL,
  action      VARCHAR(50)  NOT NULL,
  resource    VARCHAR(50)  NOT NULL,
  resource_id INT          NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_log_user FOREIGN KEY (user_id) REFERENCES admin_users(id) ON DELETE SET NULL,
  INDEX idx_log_time (created_at)
);


INSERT INTO regions (code, name_vi) VALUES
  ('north',   'Miền Bắc'),
  ('central', 'Miền Trung'),
  ('south',   'Miền Nam');


INSERT INTO languages (code, name, tts_voice) VALUES
  ('vi', 'Tiếng Việt', 'vi-VN-HoaiMyNeural'),
  ('en', 'English',    'en-US-JennyNeural'),
  ('zh', '中文',        'zh-CN-XiaoxiaoNeural'),
  ('ja', '日本語',      'ja-JP-NanamiNeural'),
  ('ko', '한국어',      'ko-KR-SunHiNeural');


INSERT INTO categories (name_vi) VALUES
  ('Di tích lịch sử'), ('Thiên nhiên'), ('Văn hóa - Tâm linh'), ('Biển đảo');


INSERT INTO pois (region_id, category_id, name_vi, description_vi, latitude, longitude, trigger_radius, is_active) VALUES
  (1, 1, 'Văn Miếu - Quốc Tử Giám',
      'Văn Miếu - Quốc Tử Giám được xây dựng năm 1070, là trường đại học đầu tiên của Việt Nam.',
      21.028511, 105.835500, 80, TRUE),
  (2, 1, 'Phố cổ Hội An',
      'Phố cổ Hội An là thương cảng sầm uất từ thế kỷ 16 và là Di sản văn hóa thế giới.',
      15.879900, 108.326000, 100, TRUE),
  (3, 1, 'Dinh Độc Lập',
      'Dinh Độc Lập là nơi ghi dấu sự kiện thống nhất đất nước ngày 30 tháng 4 năm 1975.',
      10.777000, 106.695300, 80, TRUE);


CREATE TABLE qr_codes (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  code        VARCHAR(40)  NOT NULL UNIQUE,
  label       VARCHAR(150) NOT NULL,
  poi_id      INT          NULL,
  is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_qr_poi FOREIGN KEY (poi_id) REFERENCES pois(id) ON DELETE SET NULL
);


CREATE TABLE visitor_devices (
  id            CHAR(36)    PRIMARY KEY,
  first_seen_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  preferred_lang VARCHAR(10) NULL,
  device_type   ENUM('mobile','tablet','desktop','unknown') NOT NULL DEFAULT 'unknown',
  INDEX idx_dev_lastseen (last_seen_at)
);


CREATE TABLE visit_sessions (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  device_id     CHAR(36)    NOT NULL,
  qr_code_id    INT         NULL,
  lang_code     VARCHAR(10) NULL,
  started_at    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ses_device FOREIGN KEY (device_id)  REFERENCES visitor_devices(id) ON DELETE CASCADE,
  CONSTRAINT fk_ses_qr     FOREIGN KEY (qr_code_id) REFERENCES qr_codes(id) ON DELETE SET NULL,
  INDEX idx_ses_lastseen (last_seen_at),
  INDEX idx_ses_started  (started_at)
);


CREATE TABLE visit_events (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  session_id  BIGINT      NOT NULL,
  event_type  ENUM('qr_scan','view_poi','play_audio','finish_audio','change_lang') NOT NULL,
  poi_id      INT         NULL,
  lang_code   VARCHAR(10) NULL,
  created_at  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_evt_session FOREIGN KEY (session_id) REFERENCES visit_sessions(id) ON DELETE CASCADE,
  CONSTRAINT fk_evt_poi     FOREIGN KEY (poi_id)     REFERENCES pois(id) ON DELETE SET NULL,
  INDEX idx_evt_type_time (event_type, created_at),
  INDEX idx_evt_poi (poi_id)
);
SELECT COUNT(DISTINCT device_id) AS online_now
FROM visit_sessions
WHERE last_seen_at >= NOW() - INTERVAL 90 SECOND;
SELECT DATE(created_at) AS ngay, COUNT(*) AS luot_quet
FROM visit_events
WHERE event_type = 'qr_scan' AND created_at >= NOW() - INTERVAL 7 DAY
GROUP BY DATE(created_at)
ORDER BY ngay;
SELECT q.label, COUNT(*) AS so_luot
FROM visit_sessions s
JOIN qr_codes q ON q.id = s.qr_code_id
GROUP BY q.id, q.label
ORDER BY so_luot DESC;
SELECT p.name_vi, COUNT(*) AS luot_nghe
FROM visit_events e
JOIN pois p ON p.id = e.poi_id
WHERE e.event_type = 'play_audio'
GROUP BY p.id, p.name_vi
ORDER BY luot_nghe DESC
LIMIT 5;
SELECT lang_code, COUNT(*) AS so_phien
FROM visit_sessions
WHERE lang_code IS NOT NULL
GROUP BY lang_code
ORDER BY so_phien DESC;

-- Main domain setting
INSERT INTO settings(key,value) VALUES ('main_domain','wifiy.link')
ON CONFLICT (key) DO NOTHING;

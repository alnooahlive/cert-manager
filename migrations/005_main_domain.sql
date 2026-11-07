-- Main domain setting
INSERT INTO settings(key,value) VALUES ('main_domain','alnooah.pro')
ON CONFLICT (key) DO NOTHING;

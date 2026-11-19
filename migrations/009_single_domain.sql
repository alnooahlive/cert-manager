-- One unified domain for every network/router: no subdomains
UPDATE settings SET value='wifiy.link' WHERE key='main_domain';
UPDATE routers SET hotspot_dns_name='wifiy.link' WHERE hotspot_dns_name IS DISTINCT FROM 'wifiy.link';

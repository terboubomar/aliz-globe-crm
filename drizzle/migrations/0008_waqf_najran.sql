-- Waqf Burger's Najran branch is now open (owner, 2026-11-10).
INSERT INTO public.branches (brand_id, name, code, city, district, region, active)
SELECT 'waqf', 'برجر واقف - نجران', 'BR-31', 'نجران', NULL, 'NAJRAN', true
WHERE NOT EXISTS (SELECT 1 FROM public.branches WHERE code = 'BR-31' OR (brand_id = 'waqf' AND name = 'برجر واقف - نجران'));

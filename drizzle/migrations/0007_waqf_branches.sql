-- Waqf Burger's current branches (owner's list, 2026-11-10; upcoming openings not added),
-- and Bahrain as a region for the Janusan branch.
ALTER TABLE public.branches DROP CONSTRAINT IF EXISTS branches_region_check;
ALTER TABLE public.branches ADD CONSTRAINT branches_region_check
  CHECK (region IS NULL OR region IN ('RIYADH', 'MAKKAH', 'MADINAH', 'QASSIM', 'EASTERN', 'ASIR', 'TABUK',
    'HAIL', 'NORTHERN', 'JAZAN', 'NAJRAN', 'BAHA', 'JOUF', 'BAHRAIN'));
UPDATE public.branches SET city = 'القطيف', district = 'سيهات' WHERE brand_id = 'waqf' AND code = 'BR-01';
INSERT INTO public.branches (brand_id, name, code, city, district, region, active)
SELECT * FROM (VALUES
  ('waqf', 'برجر واقف - غرناطة', 'BR-02', 'الدمام', 'غرناطة', 'EASTERN', true),
  ('waqf', 'برجر واقف - الضاحية', 'BR-03', 'الدمام', 'الضاحية', 'EASTERN', true),
  ('waqf', 'برجر واقف - الريان', 'BR-04', 'الدمام', 'الريان', 'EASTERN', true),
  ('waqf', 'برجر واقف - عبدالله فؤاد', 'BR-05', 'الدمام', 'عبدالله فؤاد', 'EASTERN', true),
  ('waqf', 'برجر واقف - الخبر الشمالية', 'BR-06', 'الخبر', 'الخبر الشمالية', 'EASTERN', true),
  ('waqf', 'برجر واقف - العزيزية', 'BR-07', 'الخبر', 'العزيزية', 'EASTERN', true),
  ('waqf', 'برجر واقف - الفيصلية', 'BR-08', 'حفر الباطن', 'الفيصلية', 'EASTERN', true),
  ('waqf', 'برجر واقف - الراشدية', 'BR-09', 'الأحساء', 'الراشدية', 'EASTERN', true),
  ('waqf', 'برجر واقف - السلام', 'BR-10', 'الأحساء', 'السلام', 'EASTERN', true),
  ('waqf', 'برجر واقف - الستنين', 'BR-11', 'الأحساء', 'الستنين', 'EASTERN', true),
  ('waqf', 'برجر واقف - القارة', 'BR-12', 'الأحساء', 'القارة', 'EASTERN', true),
  ('waqf', 'برجر واقف - المطيرفي', 'BR-13', 'الأحساء', 'المطيرفي', 'EASTERN', true),
  ('waqf', 'برجر واقف - منتزة الملك عبدالله', 'BR-14', 'الأحساء', 'منتزة الملك عبدالله', 'EASTERN', true),
  ('waqf', 'برجر واقف - الجفر', 'BR-15', 'الأحساء', 'الجفر', 'EASTERN', true),
  ('waqf', 'برجر واقف - تاروت', 'BR-16', 'القطيف', 'تاروت', 'EASTERN', true),
  ('waqf', 'برجر واقف - صفوى', 'BR-17', 'القطيف', 'صفوى', 'EASTERN', true),
  ('waqf', 'برجر واقف - البحاري', 'BR-18', 'القطيف', 'البحاري', 'EASTERN', true),
  ('waqf', 'برجر واقف - عنك', 'BR-19', 'القطيف', 'عنك', 'EASTERN', true),
  ('waqf', 'برجر واقف - المونسية', 'BR-20', 'الرياض', 'المونسية', 'RIYADH', true),
  ('waqf', 'برجر واقف - ظهرة لبن', 'BR-21', 'الرياض', 'ظهرة لبن', 'RIYADH', true),
  ('waqf', 'برجر واقف - اليرموك', 'BR-22', 'الرياض', 'اليرموك', 'RIYADH', true),
  ('waqf', 'برجر واقف - السعادة', 'BR-23', 'الرياض', 'السعادة', 'RIYADH', true),
  ('waqf', 'برجر واقف - الفلاح', 'BR-24', 'الرياض', 'الفلاح', 'RIYADH', true),
  ('waqf', 'برجر واقف - العارض', 'BR-25', 'الرياض', 'العارض', 'RIYADH', true),
  ('waqf', 'برجر واقف - طويق', 'BR-26', 'الرياض', 'طويق', 'RIYADH', true),
  ('waqf', 'برجر واقف - أبحر الشمالية', 'BR-27', 'جدة', 'أبحر الشمالية', 'MAKKAH', true),
  ('waqf', 'برجر واقف - قربان', 'BR-28', 'المدينة المنورة', 'قربان', 'MADINAH', true),
  ('waqf', 'برجر واقف - المروج', 'BR-29', 'عرعر', 'المروج', 'NORTHERN', true),
  ('waqf', 'برجر واقف - جنوسان', 'BR-30', 'البديع', 'جنوسان', 'BAHRAIN', true)
) AS v(brand_id, name, code, city, district, region, active)
WHERE NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.code = v.code);

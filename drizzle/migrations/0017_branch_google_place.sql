-- Read-only Google ratings: each branch can be linked to its Google Maps place.
-- Only the place id is stored; ratings and reviews are read live from Google.
ALTER TABLE public.branches ADD COLUMN IF NOT EXISTS google_place_id text UNIQUE;

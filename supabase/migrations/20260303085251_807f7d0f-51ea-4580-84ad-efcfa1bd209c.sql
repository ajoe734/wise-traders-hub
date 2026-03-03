
-- Create announcement status enum
CREATE TYPE public.announcement_status AS ENUM ('draft', 'published');

-- Create announcements table
CREATE TABLE public.announcements (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  status announcement_status NOT NULL DEFAULT 'draft',
  published_at TIMESTAMPTZ,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;

-- Company admins full CRUD
CREATE POLICY "Company admins full access announcements"
ON public.announcements FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'company_admin'))
WITH CHECK (public.has_role(auth.uid(), 'company_admin'));

-- Authenticated users can view published announcements
CREATE POLICY "Authenticated users can view published announcements"
ON public.announcements FOR SELECT
TO authenticated
USING (status = 'published');

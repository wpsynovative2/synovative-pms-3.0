-- =============================================================================
-- Synovative PMS — baseline 3/8: master data
--
-- The departments and services the app starts with (PRD §5). Both are edited
-- from the app afterwards (Departments & Services), so this is only a seed.
-- =============================================================================

insert into departments (name) values
  ('3D Artists'),
  ('Accounts & Finance'),
  ('Business Development Executives'),
  ('Content Writers / Copywriters / Brand Strategists'),
  ('Graphic Designers'),
  ('Human Resources & Admin'),
  ('Inside Sales Executives'),
  ('Performance Marketers'),
  ('Project Managers'),
  ('Social Media Marketing'),
  ('Videographers / Video Editors / Motion Graphics'),
  ('Website Developers')
on conflict do nothing;

insert into services (name) values
  ('3D Walkthrough Animation'),
  ('AI Video Production & Digital Presenter Creation'),
  ('Bhoomi Pooja Event'),
  ('Brand PPT Creation'),
  ('Brochure Design and Conceptualization'),
  ('CGI Video'),
  ('CP Meet Campaign'),
  ('Campaign Design'),
  ('Channel Partner Kit'),
  ('Corporate Brand Identity & Communication'),
  ('Creative Post'),
  ('Design and Conceptualization'),
  ('Domain'),
  ('Drone Rental'),
  ('Drone Shoot and Edit'),
  ('Facebook Ads Campaign'),
  ('Festival and Event Creative'),
  ('General Campaign Design'),
  ('Google Ads'),
  ('Hoarding Design and Conceptualization'),
  ('Hoarding Design and Edits'),
  ('Hoarding Printing and Installation'),
  ('Hosting'),
  ('Influencer Artist'),
  ('Landing Page'),
  ('Leads Automation'),
  ('Licensed Images'),
  ('Logo Design'),
  ('Monthly Retainer'),
  ('Motion Graphics'),
  ('Newspaper Insertion'),
  ('Online Reputation Management (ORM)'),
  ('Pamphlet Design'),
  ('Performance Marketing'),
  ('Project Launch Campaign Design'),
  ('Reel Editing'),
  ('SEO Service'),
  ('Site Branding and Conceptualization'),
  ('Social Account Setup'),
  ('Social Media Management Services'),
  ('Static Creative Design'),
  ('Storyboard Video'),
  ('Video Editing'),
  ('Video Shoot & Editing'),
  ('Videography & Photography'),
  ('Voice-Over'),
  ('Website Annual Renewal'),
  ('Website Design and Development'),
  ('Website Maintenance'),
  ('YouTube Ads')
on conflict do nothing;


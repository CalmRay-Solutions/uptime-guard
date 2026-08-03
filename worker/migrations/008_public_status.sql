-- Opt-in public status page per project.
ALTER TABLE projects ADD COLUMN public INTEGER NOT NULL DEFAULT 0;
ALTER TABLE projects ADD COLUMN public_slug TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_slug ON projects(public_slug);

# LOCAL TEST ONLY
export SUPABASE_URL=http://localhost:54321
export SUPABASE_SERVICE_ROLE_KEY=$(node -p 'require("/opt/bwr/keys.json").service')
export SITE_URL=http://localhost:5173
export ANTHROPIC_API_KEY=mock-key
export ANTHROPIC_BASE_URL=http://localhost:54321/mock-anthropic
export SUPABASE_ANON_KEY=$(node -p 'require("/opt/bwr/keys.json").anon')
export CRON_SECRET=local-cron-secret-123456

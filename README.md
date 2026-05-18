# Opsfield v3 — Campaign Operations Intelligence

Live election dashboard with AI analysis, real data feeds, and persistent sessions via Supabase.

## What's in this folder

```
opsfield/
├── index.html          ← Full dashboard (frontend)
├── vercel.json         ← Vercel deployment config
├── README.md           ← This file
└── api/
    ├── polls.js        ← Live polling data (538 / Silver Bulletin)
    ├── markets.js      ← Polymarket prediction prices
    └── db.js           ← Supabase persistence (scenarios, notes, chat)
```

---

## Step 1 — Set up Supabase (free, ~5 minutes)

### 1a. Create a Supabase account
1. Go to supabase.com and click "Start for free"
2. Sign in with GitHub
3. Click "New project"
4. Name it "opsfield", choose any region, set a database password, click "Create project"
5. Wait ~1 minute for it to spin up

### 1b. Create the database tables
1. In your Supabase project, click "SQL Editor" in the left sidebar
2. Click "New query"
3. Paste in this SQL and click "Run":

  create table scenarios (
    id uuid default gen_random_uuid() primary key,
    user_email text not null,
    name text not null,
    sliders jsonb not null,
    created_at timestamptz default now()
  );

  create table notes (
    id uuid default gen_random_uuid() primary key,
    user_email text not null,
    title text,
    content text,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
  );

  create table chat_sessions (
    id uuid default gen_random_uuid() primary key,
    user_email text not null,
    messages jsonb default '[]',
    created_at timestamptz default now(),
    updated_at timestamptz default now()
  );

  create index on scenarios(user_email);
  create index on notes(user_email);
  create index on chat_sessions(user_email);

You should see "Success. No rows returned." — that means it worked.

### 1c. Get your API keys
1. In Supabase, click "Project Settings" (gear icon, bottom left) -> "API"
2. Copy two things:
   - Project URL (looks like https://abcdefgh.supabase.co)
   - service_role key (click "Reveal" to see it)

Keep these — you'll paste them into Vercel in Step 3.

---

## Step 2 — Deploy to Vercel

### 2a. Put it on GitHub
1. Go to github.com -> sign in -> "+" -> "New repository"
2. Name it "opsfield" -> "Create repository"
3. Click "uploading an existing file"
4. Drag in everything from this folder
5. Click "Commit changes"

### 2b. Deploy on Vercel
1. Go to vercel.com -> sign in with GitHub
2. Click "Add New -> Project" -> find "opsfield" -> "Import" -> "Deploy"
3. Wait ~60 seconds -> you get a live URL

---

## Step 3 — Add your Supabase keys to Vercel

1. In Vercel, go to your opsfield project
2. Click "Settings" -> "Environment Variables"
3. Add these two variables:

   Name: SUPABASE_URL
   Value: (your Project URL from step 1c)

   Name: SUPABASE_SERVICE_KEY
   Value: (your service_role key from step 1c)

4. Click Save for each one
5. Go to "Deployments" -> click the three dots on your latest deployment -> "Redeploy"

Your app is now fully live with persistence enabled.

---

## Step 4 — Enable AI chat

1. Go to console.anthropic.com -> sign up (free) -> "API Keys" -> "Create Key"
2. Copy the key (starts with sk-ant-...)
3. Open your live Opsfield URL, log in, paste the key into the API key field
4. Saved to your browser — only do this once per device

---

## What persists across sessions

  AI chat history    -> Supabase chat_sessions table
  What-if scenarios  -> Supabase scenarios table
  Analysis notes     -> Supabase notes table
  API key            -> Browser localStorage (device only)

---

## Adding real users

Open index.html and find the USERS object near the top of the script section:

  const USERS = {
    'director@campaign.com': { pass: 'ops2026', role: 'Campaign Director', initials: 'CD' },
    // Add new users here:
    'yourname@email.com': { pass: 'yourpassword', role: 'Your Role', initials: 'YR' },
  };

Save and re-upload to GitHub. Vercel auto-redeploys in ~30 seconds.

---

## Demo accounts

  director@campaign.com  /  ops2026   ->  Campaign Director
  analyst@campaign.com   /  data2026  ->  Data Analyst
  press@campaign.com     /  media2026 ->  Press Secretary

/** Interactive demo tour definitions for showcasing user journeys. */

export type DemoPersona = {
  id: string;
  label: string;
  description: string;
  email: string;
  password: string;
  colour: string;
};

export type TourStep = {
  /** Route to navigate to */
  route: string;
  /** Heading shown in the overlay */
  title: string;
  /** Explanation shown in the overlay */
  body: string;
  /** Optional CSS selector to highlight */
  highlight?: string;
};

export type DemoJourney = {
  id: string;
  title: string;
  description: string;
  persona: string;
  icon: string;
  steps: TourStep[];
};

// ---------------------------------------------------------------------------
// Personas
// ---------------------------------------------------------------------------

export const demoPersonas: DemoPersona[] = [
  {
    id: "admin",
    label: "Demo Administrator",
    description:
      "Full access to all workflows, settings, and company management.",
    email: "demo.admin@example.com",
    password: "DemoAdmin123!",
    colour: "bg-blue-600",
  },
  {
    id: "user",
    label: "Demo Recruiter",
    description:
      "Standard user who manages candidates, jobs, and applications.",
    email: "demo.user@example.com",
    password: "DemoUser123!",
    colour: "bg-emerald-600",
  },
];

// ---------------------------------------------------------------------------
// Journeys
// ---------------------------------------------------------------------------

export const demoJourneys: DemoJourney[] = [
  {
    id: "overview",
    title: "Dashboard Overview",
    description:
      "See the main dashboard with KPIs, queue snapshots, and quick-action cards.",
    persona: "admin",
    icon: "📊",
    steps: [
      {
        route: "/overview",
        title: "Welcome to the Dashboard",
        body: "This is your operational hub. Quick-action cards link to every major workflow so you can jump straight into what needs attention.",
      },
      {
        route: "/overview",
        title: "Quick Actions",
        body: "Each card represents a key area — applications board, match review, jobs, candidates, timesheets, and settings. Click any to dive deeper.",
      },
    ],
  },
  {
    id: "job-ingest",
    title: "Job Ingestion",
    description:
      "Upload job descriptions and watch the AI extract structured role data.",
    persona: "admin",
    icon: "📋",
    steps: [
      {
        route: "/jobs",
        title: "Jobs List",
        body: "The Jobs page shows all ingested roles. You can upload new job descriptions via CSV or paste them directly.",
      },
      {
        route: "/jobs",
        title: "Upload a Job",
        body: "Click the upload button to add a new role. The AI will extract the title, skills, location, rate, and client details automatically.",
      },
      {
        route: "/ingest/linkedin-feed",
        title: "LinkedIn Feed",
        body: "Opportunities ingested from LinkedIn appear here with source URLs and timestamps, ready for review and conversion into jobs.",
      },
    ],
  },
  {
    id: "candidate-management",
    title: "Candidate Management",
    description:
      "Upload CVs, review AI-extracted profiles, and manage vetting status.",
    persona: "admin",
    icon: "👤",
    steps: [
      {
        route: "/candidates",
        title: "Candidates List",
        body: "All candidates are shown with their vetting status, key skills, and availability. Upload new CVs to add candidates.",
      },
      {
        route: "/candidates",
        title: "AI Profile Extraction",
        body: "When you upload a CV, the AI extracts skills, certifications, experience, and suggests matching roles — hands-free.",
      },
      {
        route: "/candidates",
        title: "Vetting Workflow",
        body: "Each candidate moves through vetting stages. Admins can approve, flag, or return candidates for additional information.",
      },
    ],
  },
  {
    id: "match-review",
    title: "Match Review",
    description:
      "Review AI-scored candidate–job matches and approve or reject outreach drafts.",
    persona: "admin",
    icon: "🎯",
    steps: [
      {
        route: "/match-review",
        title: "Review Queue",
        body: "The match review queue shows AI-scored pairings of candidates to jobs. Each card includes a fit score and reasoning.",
      },
      {
        route: "/match-review",
        title: "Draft Inspection",
        body: "For each match, a draft outreach email is generated using your tone and template settings. Review, edit, or approve it here.",
      },
    ],
  },
  {
    id: "applications-board",
    title: "Applications Board",
    description:
      "Track applications through a Kanban board from new to placed.",
    persona: "admin",
    icon: "📌",
    steps: [
      {
        route: "/applications",
        title: "Kanban Board",
        body: "Applications flow through stages: New → Shortlisted → Interviewing → Offered → Placed. Drag cards to progress them.",
      },
      {
        route: "/applications",
        title: "Stage Progression",
        body: "Each stage transition is tracked with timestamps. Click a card to see full history, notes, and linked candidate/job details.",
      },
      {
        route: "/opportunity-recommendations",
        title: "Opportunity Recommendations",
        body: "Select an engineer to see AI-ranked opportunities based on skills, availability, rate, and location proximity.",
      },
    ],
  },
  {
    id: "client-management",
    title: "Client & Vacancy Management",
    description:
      "Manage client accounts, contacts, and track vacancy pipelines.",
    persona: "admin",
    icon: "🏢",
    steps: [
      {
        route: "/clients",
        title: "Client Accounts",
        body: "View and manage all client accounts. Each client has contacts categorised by role — hiring manager, billing, technical lead.",
      },
      {
        route: "/vacancies",
        title: "Vacancy Pipeline",
        body: "Track vacancies from open through to filled. Link candidates and monitor progression across your client base.",
      },
    ],
  },
  {
    id: "timesheets-finance",
    title: "Timesheets & Finance",
    description:
      "Log hours, review monthly totals, and export CSV reports for invoicing.",
    persona: "admin",
    icon: "💷",
    steps: [
      {
        route: "/timesheets",
        title: "Timesheet Logging",
        body: "Log contractor hours against placements. The system tracks month-to-date totals and flags discrepancies.",
      },
      {
        route: "/timesheets",
        title: "CSV Export",
        body: "Export approved timesheets as CSV for your finance team. Data includes placement, hours, rates, and billing references.",
      },
    ],
  },
  {
    id: "settings-config",
    title: "Settings & Configuration",
    description:
      "Configure AI behaviour, matching rules, email tone, and templates.",
    persona: "admin",
    icon: "⚙️",
    steps: [
      {
        route: "/settings",
        title: "AI & Rules Settings",
        body: "Configure LiteLLM gateway usage, set matching thresholds, and define skill weightings.",
      },
      {
        route: "/settings",
        title: "Email Templates & Tone",
        body: "Customise email templates and tone of voice for AI-generated outreach. Rules ensure brand consistency across all communications.",
      },
    ],
  },
  {
    id: "admin-portal",
    title: "Admin Portal",
    description:
      "Company branding, billing model, finance reports, and user management.",
    persona: "admin",
    icon: "🔐",
    steps: [
      {
        route: "/admin",
        title: "Admin Portal",
        body: "The admin portal lets company admins configure branding, billing models (percentage or per-hour), and manage team members.",
      },
    ],
  },
  {
    id: "candidate-signup",
    title: "Candidate Self-Service Signup",
    description:
      "Public-facing CV upload with AI extraction for candidate onboarding.",
    persona: "user",
    icon: "✍️",
    steps: [
      {
        route: "/candidate-signup",
        title: "Public Signup Page",
        body: "Candidates can upload their CV directly. The AI extracts skills, certifications, and experience to build a structured profile automatically.",
      },
    ],
  },
  {
    id: "multi-tenant",
    title: "Multi-Tenant Isolation",
    description:
      "See how data is isolated between tenants with separate company contexts.",
    persona: "admin",
    icon: "🏗️",
    steps: [
      {
        route: "/overview",
        title: "Tenant Isolation",
        body: "Each company operates in its own tenant. Data, settings, and users are fully isolated. The Demo Instance and Acme Operations are separate organisations.",
      },
    ],
  },
];

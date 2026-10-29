const TECH_KEYWORDS = [
  "JavaScript", "TypeScript", "Python", "Java", "C#", "C++", "Go", "Golang", "Rust",
  "PHP", "Ruby", "Swift", "Kotlin", "Scala", "Dart", "Elixir",
  "React", "Vue", "Vue.js", "Angular", "Svelte", "Next.js", "Nuxt", "Remix",
  "HTML", "CSS", "SASS", "SCSS", "Tailwind", "TailwindCSS", "Bootstrap",
  "Material UI", "Chakra UI", "Styled Components",
  "Node.js", "Express", "NestJS", "FastAPI", "Django", "Flask", "Spring Boot",
  "Rails", "ASP.NET", "Laravel",
  "React Native", "Flutter", "iOS", "Android", "SwiftUI",
  "SQL", "PostgreSQL", "MySQL", "MongoDB", "Redis", "Elasticsearch", "DynamoDB",
  "Cassandra", "SQLite", "MariaDB",
  "AWS", "Azure", "GCP", "Google Cloud", "Docker", "Kubernetes", "K8s", "Terraform",
  "Ansible", "Jenkins", "GitHub Actions", "GitLab CI", "CI/CD", "Linux", "Nginx",
  "Redux", "Zustand", "MobX", "RxJS", "GraphQL", "REST", "gRPC", "WebSocket",
  "Webpack", "Vite", "Rollup",
  "Jest", "Vitest", "Cypress", "Playwright", "Selenium", "TDD",
  "Microservices", "Serverless", "Agile", "Scrum", "DevOps",
  "OAuth", "JWT", "Git", "GitHub", "GitLab",
  "Kafka", "RabbitMQ", "Machine Learning", "AI",
  "Figma", "Storybook", "Prisma", "TypeORM",
];

export function extractSkillsFromDescription(description: string, title?: string): string[] {
  const text = [description, title].filter(Boolean).join(" ");
  if (!text) return [];
  const found = new Set<string>();
  for (const skill of TECH_KEYWORDS) {
    const escaped = skill.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\b${escaped}\\b`, "i").test(text)) {
      found.add(skill);
    }
  }
  return Array.from(found);
}

function extractBulletSection(description: string, headerKeywords: string[]): string[] {
  const lines = description.split("\n");
  const items: string[] = [];
  let inSection = false;

  for (const line of lines) {
    const trimmed = line.trim();
    const lower = trimmed.toLowerCase();

    if (headerKeywords.some((k) => lower.includes(k))) {
      inSection = true;
      continue;
    }

    if (inSection) {
      if (
        trimmed.length > 0 &&
        !trimmed.startsWith("-") &&
        !trimmed.startsWith("•") &&
        !trimmed.startsWith("*") &&
        !/^\d+[.)]\s/.test(trimmed)
      ) {
        if (trimmed.length < 60 && (trimmed.endsWith(":") || /^[A-Z][A-Za-z\s]+$/.test(trimmed))) {
          if (items.length > 0) break;
        } else if (trimmed.length > 10) {
          items.push(trimmed);
        }
      } else {
        const cleaned = trimmed.replace(/^[-•*]\s*/, "").replace(/^\d+[.)]\s*/, "").trim();
        if (cleaned.length > 2) items.push(cleaned);
      }
      if (items.length >= 10) break;
    }
  }
  return items;
}

export interface ParsedJobDetails {
  coreSkills: string[];
  niceToHaveSkills: string[];
  benefits: string[];
  interviewProcess: string[];
  responsibilities: string[];
}

export function extractSections(description: string, title?: string): ParsedJobDetails {
  if (!description && !title) {
    return { coreSkills: [], niceToHaveSkills: [], benefits: [], interviewProcess: [], responsibilities: [] };
  }

  const allSkills = extractSkillsFromDescription(description, title);
  const splitAt = Math.ceil(allSkills.length * 0.6);

  return {
    coreSkills: allSkills.slice(0, splitAt),
    niceToHaveSkills: allSkills.slice(splitAt),
    benefits: extractBulletSection(description, [
      "benefits", "what we offer", "perks", "we offer", "our offer",
      "why join", "compensation", "what you'll get", "what you get",
    ]),
    interviewProcess: extractBulletSection(description, [
      "interview process", "hiring process", "selection process",
      "our process", "application process", "recruitment process",
    ]),
    responsibilities: extractBulletSection(description, [
      "responsibilities", "what you'll do", "your role", "you will",
      "your responsibilities", "the role", "about the role",
    ]),
  };
}

export function formatPostedDate(dateStr: string | null | undefined): { relative: string; absolute: string; full: string } {
  if (!dateStr) return { relative: "", absolute: "", full: "--" };
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return { relative: "", absolute: "", full: "--" };

  const diffDays = Math.floor((Date.now() - date.getTime()) / 86_400_000);

  let relative: string;
  if (diffDays < 0) relative = "Upcoming";
  else if (diffDays === 0) relative = "Today";
  else if (diffDays === 1) relative = "Yesterday";
  else if (diffDays < 7) relative = `${diffDays}d ago`;
  else if (diffDays < 30) relative = `${Math.floor(diffDays / 7)}w ago`;
  else if (diffDays < 365) relative = `${Math.floor(diffDays / 30)}mo ago`;
  else relative = `${Math.floor(diffDays / 365)}y ago`;

  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const absolute = `${dd}/${mm}/${date.getFullYear()}`;

  return { relative, absolute, full: `(${relative}) ${absolute}` };
}

// Skill categories inferred from having specific technologies
const SKILL_CATEGORY_INDICATORS: Record<string, string[]> = {
  "full-stack development": ["react", "node", "next.js", "nuxt", "express", "nestjs", "django", "flask", "rails", "laravel", "spring boot", "asp.net", "fastapi"],
  "full-stack developer": ["react", "node", "next.js", "nuxt", "express", "nestjs", "django", "flask", "rails", "laravel", "spring boot", "asp.net", "fastapi"],
  "fullstack development": ["react", "node", "next.js", "nuxt", "express", "nestjs", "django", "flask", "rails", "laravel", "spring boot", "asp.net", "fastapi"],
  "mobile development": ["react native", "flutter", "swift", "swiftui", "kotlin", "ios", "android", "dart"],
  "mobile developer": ["react native", "flutter", "swift", "swiftui", "kotlin", "ios", "android", "dart"],
  "frontend development": ["react", "vue", "angular", "svelte", "next.js", "html", "css", "tailwind", "javascript", "typescript"],
  "frontend developer": ["react", "vue", "angular", "svelte", "next.js", "html", "css", "tailwind", "javascript", "typescript"],
  "backend development": ["node", "express", "nestjs", "django", "flask", "fastapi", "spring boot", "rails", "laravel", "asp.net", "go", "rust", "java", "python"],
  "backend developer": ["node", "express", "nestjs", "django", "flask", "fastapi", "spring boot", "rails", "laravel", "asp.net", "go", "rust", "java", "python"],
  "devops": ["docker", "kubernetes", "k8s", "terraform", "ansible", "jenkins", "github actions", "gitlab ci", "ci/cd", "aws", "azure", "gcp"],
  "cloud": ["aws", "azure", "gcp", "google cloud", "docker", "kubernetes", "serverless"],
  "web development": ["html", "css", "javascript", "typescript", "react", "vue", "angular", "node"],
};

// Aliases for normalizing skill names
const SKILL_ALIASES: Record<string, string> = {
  "js": "javascript",
  "ts": "typescript",
  "react.js": "react",
  "reactjs": "react",
  "node.js": "node",
  "nodejs": "node",
  "vue.js": "vue",
  "vuejs": "vue",
  "golang": "go",
  "c++": "cpp",
  "c#": "csharp",
  "postgres": "postgresql",
  "k8s": "kubernetes",
  "tailwindcss": "tailwind",
};

function normalizeSkill(skill: string): string {
  const lower = skill.toLowerCase().trim();
  return SKILL_ALIASES[lower] ?? lower;
}

export function matchSkillsWithResume(
  jobSkills: string[],
  userSkills: string[],
): { skill: string; hasSkill: boolean }[] {
  const userNormalized = userSkills.map((s) => normalizeSkill(s));
  const userLowerSet = new Set(userNormalized);

  return jobSkills.map((skill) => {
    const normalized = normalizeSkill(skill);

    // 1. Exact match
    if (userLowerSet.has(normalized)) {
      return { skill, hasSkill: true };
    }

    // 2. Substring match (either direction): "React" matches "React Native"
    for (const userSkill of userNormalized) {
      if (normalized.includes(userSkill) || userSkill.includes(normalized)) {
        return { skill, hasSkill: true };
      }
    }

    // 3. Category inference: if job requires "Mobile Development" and user has "React Native"
    const indicators = SKILL_CATEGORY_INDICATORS[normalized];
    if (indicators) {
      const hasAny = indicators.some((ind) => {
        const normInd = normalizeSkill(ind);
        return userLowerSet.has(normInd) || userNormalized.some((u) => u.includes(normInd) || normInd.includes(u));
      });
      if (hasAny) return { skill, hasSkill: true };
    }

    // 4. Reverse: user has a category and job requires a specific skill in it
    for (const [category, indicators] of Object.entries(SKILL_CATEGORY_INDICATORS)) {
      if (userLowerSet.has(category) && indicators.some((ind) => normalizeSkill(ind) === normalized)) {
        return { skill, hasSkill: true };
      }
    }

    return { skill, hasSkill: false };
  });
}

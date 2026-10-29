use crate::sources::RawJobListing;
use std::collections::HashSet;

pub struct PreFilterConfig {
    pub target_roles: Vec<String>,
    pub skills: Vec<String>,
    pub regions: Vec<String>,
    pub excluded_companies: Vec<String>,
    pub excluded_keywords: Vec<String>,
    pub existing_hashes: HashSet<String>,
}

/// Non-tech job title blocklist — titles containing these words are almost certainly irrelevant
const TITLE_BLOCKLIST: &[&str] = &[
    "nurse", "nursing", "registered nurse", "lpn",
    "truck driver", "cdl", "delivery driver",
    "cashier", "retail associate", "store manager",
    "warehouse", "forklift", "picker", "packer",
    "accountant", "bookkeeper", "cpa",
    "dentist", "dental", "hygienist",
    "pharmacist", "pharmacy",
    "teacher", "substitute teacher", "tutor",
    "janitor", "custodian", "housekeeper",
    "cook", "chef", "barista", "bartender", "server", "waitress", "waiter",
    "security guard", "security officer",
    "electrician", "plumber", "hvac", "carpenter", "welder",
    "mechanic", "automotive",
    "veterinarian", "veterinary",
    "real estate agent", "realtor",
    "hair stylist", "cosmetologist", "beautician",
    "receptionist", "front desk",
    "phlebotomist", "medical assistant", "cna",
    "paramedic", "emt",
    "social worker", "case manager",
    "insurance agent", "claims adjuster",
    "loan officer", "mortgage",
    "dispatcher",
    "fitness trainer", "personal trainer",
];

/// Tech-related keywords that indicate a potentially relevant job
const TECH_INDICATORS: &[&str] = &[
    "software", "developer", "engineer", "frontend", "backend", "fullstack",
    "full-stack", "full stack", "react", "angular", "vue", "typescript",
    "javascript", "python", "rust", "golang", "java", "kotlin", "swift",
    "ios", "android", "mobile", "web", "devops", "sre", "cloud",
    "aws", "azure", "gcp", "docker", "kubernetes", "api", "microservice",
    "database", "sql", "nosql", "mongodb", "postgresql", "redis",
    "machine learning", "data engineer", "data scientist", "ai ", "ml ",
    "ci/cd", "agile", "scrum", "node", "django", "flask", "spring",
    "graphql", "rest", "grpc", "terraform", "ansible",
    "product manager", "product owner", "technical",
    "ux designer", "ui designer", "design system",
    "qa engineer", "test engineer", "sdet", "automation",
    "cybersecurity", "security engineer", "infosec",
    "architect", "platform", "infrastructure",
];

/// EU/DACH regions for geography filtering
const EU_REGIONS: &[&str] = &[
    "germany", "deutschland", "berlin", "munich", "münchen", "hamburg",
    "frankfurt", "cologne", "köln", "düsseldorf", "stuttgart",
    "austria", "österreich", "vienna", "wien",
    "switzerland", "schweiz", "zurich", "zürich",
    "netherlands", "amsterdam", "rotterdam",
    "belgium", "brussels", "bruxelles",
    "france", "paris", "lyon",
    "ireland", "dublin",
    "spain", "madrid", "barcelona",
    "portugal", "lisbon",
    "italy", "milan", "rome",
    "sweden", "stockholm",
    "denmark", "copenhagen",
    "finland", "helsinki",
    "norway", "oslo",
    "poland", "warsaw", "krakow",
    "czech", "prague",
    "luxembourg",
    "remote", "worldwide", "anywhere", "global", "eu ", "europe", "european",
    "emea", "dach",
];

#[derive(Debug, Clone)]
pub struct PreFilterResult {
    pub passed: Vec<RawJobListing>,
    pub rejected_count: usize,
}

impl PreFilterConfig {
    pub fn from_settings(
        settings: &std::collections::HashMap<String, String>,
        skills: Vec<String>,
        existing_hashes: HashSet<String>,
    ) -> Self {
        let target_roles: Vec<String> = settings
            .get("target_roles")
            .and_then(|v| serde_json::from_str(v).ok())
            .unwrap_or_default();

        let excluded_companies: Vec<String> = settings
            .get("excluded_companies")
            .and_then(|v| serde_json::from_str(v).ok())
            .or_else(|| {
                settings.get("excluded_companies").map(|v| {
                    v.split(',')
                        .map(|s| s.trim().to_lowercase())
                        .filter(|s| !s.is_empty())
                        .collect()
                })
            })
            .unwrap_or_default();

        let excluded_keywords: Vec<String> = settings
            .get("excluded_keywords")
            .and_then(|v| serde_json::from_str(v).ok())
            .or_else(|| {
                settings.get("excluded_keywords").map(|v| {
                    v.split(',')
                        .map(|s| s.trim().to_lowercase())
                        .filter(|s| !s.is_empty())
                        .collect()
                })
            })
            .unwrap_or_default();

        let regions: Vec<String> = settings
            .get("regions")
            .and_then(|v| serde_json::from_str(v).ok())
            .unwrap_or_else(|| vec!["Germany".into(), "EU".into()]);

        Self {
            target_roles,
            skills,
            regions,
            excluded_companies,
            excluded_keywords,
            existing_hashes,
        }
    }
}

pub fn run_prefilter(jobs: Vec<RawJobListing>, config: &PreFilterConfig) -> PreFilterResult {
    let total = jobs.len();
    let passed: Vec<RawJobListing> = jobs
        .into_iter()
        .filter(|job| !is_duplicate(job, &config.existing_hashes))
        .filter(|job| !is_blocked_title(job))
        .filter(|job| !is_excluded_company(job, &config.excluded_companies))
        .filter(|job| !has_excluded_keywords(job, &config.excluded_keywords))
        .filter(|job| has_location_match(job, &config.regions))
        .filter(|job| has_tech_relevance(job, &config.skills, &config.target_roles))
        .collect();

    PreFilterResult {
        rejected_count: total - passed.len(),
        passed,
    }
}

fn is_duplicate(job: &RawJobListing, existing: &HashSet<String>) -> bool {
    existing.contains(&job.dedup_hash())
}

fn is_blocked_title(job: &RawJobListing) -> bool {
    let title_lower = job.title.to_lowercase();
    TITLE_BLOCKLIST
        .iter()
        .any(|blocked| title_lower.contains(blocked))
}

fn is_excluded_company(job: &RawJobListing, excluded: &[String]) -> bool {
    if excluded.is_empty() {
        return false;
    }
    let company = job
        .company
        .as_deref()
        .unwrap_or("")
        .to_lowercase();
    excluded.iter().any(|ex| company.contains(ex))
}

fn has_excluded_keywords(job: &RawJobListing, excluded: &[String]) -> bool {
    if excluded.is_empty() {
        return false;
    }
    let title_lower = job.title.to_lowercase();
    let desc_lower = job
        .description
        .as_deref()
        .unwrap_or("")
        .to_lowercase();
    excluded
        .iter()
        .any(|kw| title_lower.contains(kw) || desc_lower.contains(kw))
}

fn has_location_match(job: &RawJobListing, user_regions: &[String]) -> bool {
    let location = job
        .location
        .as_deref()
        .unwrap_or("")
        .to_lowercase();

    // If no location data, let it pass (benefit of the doubt)
    if location.is_empty() {
        return true;
    }

    // Check against EU region list
    let matches_eu = EU_REGIONS.iter().any(|r| location.contains(r));

    // Also check user's configured regions
    let matches_user = user_regions
        .iter()
        .any(|r| location.contains(&r.to_lowercase()));

    matches_eu || matches_user
}

fn has_tech_relevance(
    job: &RawJobListing,
    skills: &[String],
    target_roles: &[String],
) -> bool {
    let title_lower = job.title.to_lowercase();
    let desc_lower = job
        .description
        .as_deref()
        .unwrap_or("")
        .to_lowercase();
    let combined = format!("{} {}", title_lower, desc_lower);

    // Check if title matches any tech indicator
    let has_tech = TECH_INDICATORS.iter().any(|t| combined.contains(t));

    // Check if any user skill appears in the job
    let has_skill = skills
        .iter()
        .any(|s| combined.contains(&s.to_lowercase()));

    // Check if title has overlap with target roles (word-level)
    let has_role_overlap = target_roles.iter().any(|role| {
        let role_words: Vec<&str> = role
            .split_whitespace()
            .filter(|w| w.len() > 2)
            .collect();
        role_words
            .iter()
            .any(|w| title_lower.contains(&w.to_lowercase()))
    });

    has_tech || has_skill || has_role_overlap
}
